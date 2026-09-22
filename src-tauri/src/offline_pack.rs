use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::shell::docker_cmd;

use crate::types::LogEvent;

/// 工具自身运行所需的镜像（docker 原生 save/load 通道，本机架构）
pub const TOOL_IMAGES: &[&str] = &["registry:2", "tonistiigi/binfmt:latest", "moby/buildkit:buildx-stable-1"];

/// 离线包 v2：
/// - images.tar      docker save：工具镜像 + 基础镜像（本机架构）→ 同架构构建走 default builder 用
/// - registry-data/  本地 registry 卷数据（多架构 manifest + blobs）→ 交叉构建时 buildkit 走 mirror 用
/// - manifest.json   镜像清单与上游 registry 端口映射
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RegistryEntry {
    pub host: String,
    pub port: u16,
    pub index: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PackManifest {
    pub version: u32,
    pub created_at: String,
    pub images: Vec<String>,
    #[serde(default)]
    pub registries: Vec<RegistryEntry>,
}

// ── 工具函数：解析 Dockerfile 中的 FROM 行 ──
pub fn parse_from_images(dockerfile: &str) -> Vec<String> {
    let mut images = Vec::new();
    for line in dockerfile.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') { continue; }
        // 匹配 FROM [--platform=...] image[:tag] [AS name]
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.first().map(|w| w.to_uppercase()) == Some("FROM".into()) {
            let img = parts.iter()
                .find(|w| w.contains('/') || w.contains('.') || !w.starts_with("--") && *w != &"FROM")
                .cloned()
                .unwrap_or(parts.get(1).unwrap_or(&""));
            let img = img.trim();
            if !img.is_empty() && img.to_lowercase() != "scratch" {
                images.push(img.to_string());
            }
        }
    }
    images
}

/// 从文件路径读取并解析
fn images_from_file(path: &str) -> Vec<String> {
    let content = fs::read_to_string(path).unwrap_or_default();
    parse_from_images(&content)
}

/// 拆分镜像引用 → (上游 registry host, registry 内路径)
/// 例：aspnet:8.0 → (docker.io, library/aspnet:8.0)；mcr.microsoft.com/dotnet/aspnet:8.0 → (mcr.microsoft.com, dotnet/aspnet:8.0)
/// digest 固定引用（x@sha256:...）返回 None：可按 tag 镜像的通道不覆盖
fn split_ref(img: &str) -> Option<(String, String)> {
    if img.contains('@') { return None; }
    let first = img.split('/').next().unwrap_or("");
    let looks_like_host = first.contains('.') || first.contains(':') || first == "localhost";
    let (host, path) = if img.contains('/') && looks_like_host {
        (first.to_string(), img[first.len() + 1..].to_string())
    } else {
        ("docker.io".to_string(), img.to_string())
    };
    let path = if host == "docker.io" && !path.contains('/') { format!("library/{path}") } else { path };
    Some((host, path))
}

/// 发布地址：Linux 上 host.docker.internal 经网桥访问，不能只绑回环；macOS/Windows 桌面版只绑回环
fn publish_bind() -> &'static str {
    if cfg!(target_os = "linux") { "0.0.0.0" } else { "127.0.0.1" }
}

/// 探测空闲端口：从 preferred 起逐个试绑（与 docker 发布同地址；Windows Hyper-V 保留段同样绑定失败被跳过），
/// 全部被占则返回原值，走 docker run 报错兜底
fn free_port(preferred: u16) -> u16 {
    let addr = publish_bind();
    (preferred..preferred.saturating_add(64))
        .find(|p| std::net::TcpListener::bind((addr, *p)).is_ok())
        .unwrap_or(preferred)
}

async fn run_ok(args: &[&str]) -> Result<(), String> {
    let o = docker_cmd().args(args).output().await.map_err(|e| format!("docker {} 启动失败: {e}", args.first().unwrap_or(&"")))?;
    if o.status.success() { return Ok(()); }
    let mut combined = o.stdout.clone();
    combined.extend_from_slice(&o.stderr);
    Err(format!("docker {} 失败: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&combined).trim()))
}

async fn run_ignore(args: &[&str]) { let _ = docker_cmd().args(args).output().await; }

/// 执行 docker 并把 stdout/stderr 逐行实时转发到前端日志（大镜像复制/拉取期间用户能看到 docker 自身进度），
/// 失败时返回末尾若干行作错误详情；长时间无任何输出时发心跳提示（含已耗时秒数），
/// 覆盖代理黑洞等"进程未退出也无输出"的悬挂场景，避免界面看起来卡死
async fn run_stream(app: &AppHandle, run_id: &str, args: &[&str]) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    let cmd = args.first().unwrap_or(&"");
    let mut child = docker_cmd().args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("docker {cmd} 启动失败: {e}"))?;
    let mut out = BufReader::new(child.stdout.take().ok_or("stdout 未捕获")?).lines();
    let mut err = BufReader::new(child.stderr.take().ok_or("stderr 未捕获")?).lines();
    let (mut out_open, mut err_open) = (true, true);
    let mut tail: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    let start = std::time::Instant::now();
    loop {
        if !out_open && !err_open { break; }
        tokio::select! {
            l = out.next_line(), if out_open => match l {
                Ok(Some(s)) => { emit_line(app, run_id, &s, "stdout"); tail.push_back(s); if tail.len() > 60 { tail.pop_front(); } }
                _ => out_open = false,
            },
            l = err.next_line(), if err_open => match l {
                Ok(Some(s)) => { emit_line(app, run_id, &s, "stderr"); tail.push_back(s); if tail.len() > 60 { tail.pop_front(); } }
                _ => err_open = false,
            },
            _ = tokio::time::sleep(std::time::Duration::from_secs(20)) => {
                emit_line(app, run_id, &format!("…… docker {cmd} 仍在进行：已耗时 {} 秒，近 20 秒无新输出（大镜像复制/网络较慢时属正常）", start.elapsed().as_secs()), "stderr");
            }
        }
    }
    let status = child.wait().await.map_err(|e| format!("等待 docker {cmd} 进程失败: {e}"))?;
    if status.success() { return Ok(()); }
    Err(format!("docker {cmd} 失败: {}", tail.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n").trim()))
}

/// 提取错误里最有信息量的一行（首个含 ERROR/error 的行，截 160 字符）
fn brief_err(e: &str) -> String {
    e.lines()
        .find(|l| l.contains("ERROR") || l.contains("error"))
        .unwrap_or_else(|| e.lines().next().unwrap_or(""))
        .chars().take(160).collect()
}

/// 网络类 docker 操作的重试包装：CDN 流中断（stream CANCEL）/连接重置等瞬时故障短退避重试通常可恢复；
/// 已推入本地 registry 的层按 digest 去重，重试等价于续传
async fn run_ok_retry(app: &AppHandle, run_id: &str, args: &[&str], attempts: u32) -> Result<(), String> {
    let mut last = String::new();
    for i in 0..attempts {
        match run_stream(app, run_id, args).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = e;
                if i + 1 < attempts {
                    let brief = brief_err(&last);
                    emit_line(app, run_id, &format!("[重试 {}/{}] docker {} 瞬时失败：{brief}", i + 1, attempts - 1, args.first().unwrap_or(&"")), "stderr");
                    tokio::time::sleep(std::time::Duration::from_secs(3 * (i as u64 + 1))).await;
                }
            }
        }
    }
    Err(format!("重试 {attempts} 次仍失败: {last}"))
}

fn emit_line(app: &AppHandle, run_id: &str, line: &str, stream: &str) {
    let _ = app.emit("build-log", LogEvent { task_id: run_id.into(), project_id: run_id.into(), line: line.into(), stream: stream.into() });
}

async fn pull_image(app: &AppHandle, run_id: &str, image: &str) -> Result<(), String> {
    run_ok_retry(app, run_id, &["pull", image], 3).await.map_err(|e| format!("pull {image} 失败: {e}"))
}

/// 拆分 registry 引用为 (repo, tag)；仅在 tag 分隔符位于最后一个 '/' 之后时才拆分，无 tag 视为 latest
fn split_repo_tag(target: &str) -> (&str, &str) {
    match target.rfind(':') {
        Some(i) if Some(i) > target.rfind('/') => (&target[..i], &target[i + 1..]),
        _ => (target, "latest"),
    }
}

/// mirror 通道兜底：经守护进程逐平台中转。
/// buildkit 直连复制（imagetools create 从上游 CDN 拉 blob）在部分网络环境（代理 + Azure CDN 的
/// HTTP/2 通路）会被持续 stream CANCEL，重试无效；而守护进程 pull/push 通路实测不受影响。
/// 流程：CLI 本地 manifest inspect 枚举 linux 平台 → 逐平台 pull --platform → tag → push 进本地
/// registry → 纯本地合成 manifest list，全程不再经 buildkit 直连上游
async fn mirror_via_daemon(app: &AppHandle, run_id: &str, orig: &str, target: &str) -> Result<(), String> {
    // 1. 枚举上游平台（docker manifest inspect 在 CLI 本地解析，不经 buildkit）
    let out = docker_cmd().args(["manifest", "inspect", orig]).output().await
        .map_err(|e| format!("docker manifest inspect 启动失败: {e}"))?;
    if !out.status.success() {
        return Err(format!("manifest inspect {orig} 失败: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("manifest JSON 解析失败: {e}"))?;
    let mut platforms: Vec<String> = Vec::new();
    if let Some(ms) = v.get("manifests").and_then(|m| m.as_array()) {
        for m in ms {
            let p = match m.get("platform") { Some(p) => p, None => continue };
            // 只中转 linux 平台（Windows 平台条目守护进程拉不了，离线构建也用不到；unknown 为证明类附件）
            if p.get("os").and_then(|x| x.as_str()) != Some("linux") { continue; }
            let arch = match p.get("architecture").and_then(|x| x.as_str()) { Some(a) => a, None => continue };
            platforms.push(match p.get("variant").and_then(|x| x.as_str()) {
                Some(var) => format!("linux/{arch}/{var}"),
                None => format!("linux/{arch}"),
            });
        }
    }

    // 2. 单平台镜像：主流程步骤 3 已拉取本机架构，直接 tag → push
    if platforms.is_empty() {
        emit_line(app, run_id, &format!("回退：{orig} 为单平台镜像，守护进程直接中转"), "stdout");
        run_ok(&["tag", orig, target]).await?;
        return run_ok_retry(app, run_id, &["push", target], 3).await
            .map_err(|e| format!("push {target} 失败: {e}"));
    }

    // 3. 多平台：逐平台 pull → tag → push（守护进程里同名 tag 会被后一次 pull 覆盖，拉完须立即转存推送）
    let (repo, tag) = split_repo_tag(target);
    let mut refs: Vec<String> = Vec::with_capacity(platforms.len());
    for pf in &platforms {
        let t = format!("{repo}:{tag}-{}", pf.replace('/', "-"));
        emit_line(app, run_id, &format!("回退中转 {orig} [{pf}] → {t}"), "stdout");
        run_ok_retry(app, run_id, &["pull", "--platform", pf, orig], 3).await
            .map_err(|e| format!("pull {orig} [{pf}] 失败: {e}"))?;
        run_ok(&["tag", orig, &t]).await?;
        run_ok_retry(app, run_id, &["push", &t], 3).await
            .map_err(|e| format!("push {t} 失败: {e}"))?;
        refs.push(t);
    }

    // 4. 纯本地合成 manifest list（源与目标都在 localhost，不再触达上游 CDN）
    let mut args: Vec<&str> = vec!["buildx", "imagetools", "create", "--builder", "default", "-t", target];
    args.extend(refs.iter().map(|s| s.as_str()));
    run_ok(&args).await.map_err(|e| format!("本地合成 manifest 失败: {e}"))?;

    // 5. 恢复本机架构 tag：逐平台拉取会把 orig 覆盖成最后一个平台，
    //    重拉一次（层已缓存，秒级）保证后续 docker save 导出的是本机架构镜像
    run_ok_retry(app, run_id, &["pull", orig], 2).await
        .map_err(|e| format!("恢复本机架构 tag 失败: {e}"))
}

/// 单个镜像的多架构 mirror 到本地 registry（导出与在线修复共用）：
/// buildkit 直连复制优先（瞬时故障自动重试续传；固定 --builder default——绕开 hr-builder
/// 可能挂载的 mirror 配置，且其容器内 localhost 目标不可达），
/// 直连通路被 CDN 持续 CANCEL 时回退守护进程逐平台中转
pub async fn mirror_one_image(app: &AppHandle, run_id: &str, orig: &str, target: &str) -> Result<(), String> {
    if let Err(e) = run_ok_retry(app, run_id, &["buildx", "imagetools", "create", "--builder", "default", "-t", target, orig], 2).await {
        emit_line(app, run_id, &format!("buildkit 直连复制失败（{}），回退守护进程逐平台中转", brief_err(&e)), "stderr");
        return mirror_via_daemon(app, run_id, orig, target).await
            .map_err(|e2| format!("复制多架构失败 {orig}: 直连[{}] 回退[{}]", brief_err(&e), brief_err(&e2)));
    }
    Ok(())
}

/// 供 commands 使用：若 mirror 配置存在（导入离线包生成于数据根目录），返回 buildkitd.toml 路径
pub fn offline_mirror_config(root: &Path) -> Option<String> {
    let toml = root.join("offline").join("buildkitd.toml");
    toml.is_file().then(|| toml.to_string_lossy().to_string())
}

/// 运行中的 hr-offline-reg-* 本地 registry 容器名单
pub async fn running_registries() -> Vec<String> {
    match docker_cmd().args(["ps", "--filter", "name=hr-offline-reg", "--format", "{{.Names}}"]).output().await {
        Ok(o) => String::from_utf8_lossy(&o.stdout).lines().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        Err(_) => vec![],
    }
}

pub async fn offline_registry_running() -> bool {
    !running_registries().await.is_empty()
}

/// builder 的 buildkit 容器是否挂载了 mirror 配置（创建时带 --config buildkitd.toml 的代理判据）
pub async fn builder_has_mirror_config(builder: &str) -> bool {
    let name = format!("buildx_buildkit_{}0", builder);
    match docker_cmd().args(["inspect", &name]).output().await {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).contains("buildkitd.toml"),
        _ => false,
    }
}

/// 导入记录：root/offline/registries.json（导入离线包时写入；缺失=从未导入）
pub fn load_registries(root: &Path) -> Option<Vec<RegistryEntry>> {
    let raw = fs::read_to_string(root.join("offline").join("registries.json")).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 拉起已存在的 registry 容器（镜像数据在容器内；容器被删可经 repair_registries 在线重建回填，或重新导入离线包）
pub async fn start_registry(name: &str) -> Result<(), String> {
    run_ok(&["start", name]).await
}

/// 一键修复（在线机）：registry 容器还在（含已停止）则直接拉起；已被删除则用 registry:2 在线重建
/// （镜像通常本机就有：导出/导入通道都带），再按当前各项目 Dockerfile 的 FROM 引用从上游回填
/// 多架构 mirror 数据——在线机无需"导出再导入"即可自愈；无外网且本地无 registry:2 时才要求重新导入
pub async fn repair_registries(
    app: &AppHandle,
    run_id: &str,
    regs: &[RegistryEntry],
    dockerfiles: &[String],
) -> Result<(), String> {
    let mut rebuilt: Vec<&RegistryEntry> = Vec::new();
    for r in regs {
        let name = format!("hr-offline-reg-{}", r.index);
        let exists = docker_cmd().args(["inspect", &name]).output().await
            .map(|o| o.status.success()).unwrap_or(false);
        if exists {
            start_registry(&name).await.map_err(|e| format!("拉起 {name} 失败: {e}"))?;
            continue;
        }
        emit_line(app, run_id, &format!("registry 容器 {name} 缺失，在线重建（{} → :{}）...", r.host, r.port), "stdout");
        let bind = format!("{}:{}:5000", publish_bind(), r.port);
        run_stream(app, run_id, &["run", "-d", "--name", &name, "--restart", "unless-stopped", "-p", &bind, "registry:2"]).await
            .map_err(|e| format!("mirror_rebuild_failed: {e}"))?;
        rebuilt.push(r);
    }
    if rebuilt.is_empty() { return Ok(()); }

    // 收集当前各项目 Dockerfile 的 FROM 引用，按重建 registry 对应的上游 host 回填
    let mut seen = HashSet::new();
    let mut bases: Vec<String> = Vec::new();
    for df in dockerfiles {
        for img in images_from_file(df) {
            if seen.insert(img.clone()) { bases.push(img); }
        }
    }
    for r in &rebuilt {
        let mut count = 0usize;
        for b in &bases {
            if let Some((host, path)) = split_ref(b) {
                if host != r.host { continue; }
                count += 1;
                let target = format!("localhost:{}/{}", r.port, path);
                emit_line(app, run_id, &format!("在线回填 mirror {b} → {target}"), "stdout");
                mirror_one_image(app, run_id, b, &target).await
                    .map_err(|e| format!("mirror_refill_failed: {e}"))?;
            }
        }
        if count == 0 {
            emit_line(app, run_id, &format!("提示：当前各项目 Dockerfile 没有来自 {} 的基础镜像，该 registry 暂为空（构建时 buildkit 会自动回源上游）", r.host), "stderr");
        }
    }
    emit_line(app, run_id, &format!("{} 个 registry 容器已在线重建并回填完成", rebuilt.len()), "stdout");
    Ok(())
}

/// buildkit mirror 寻址：
/// - Windows/macOS Docker Desktop：容器内经 host.docker.internal 访问宿主发布端口
/// - Linux：buildkit 容器默认解析不了 host.docker.internal，创建 builder 时加
///   --driver-opt network=host 共享宿主网络栈，mirror 直接走 127.0.0.1 发布端口
fn mirror_addr(port: u16) -> String {
    if cfg!(target_os = "linux") { format!("127.0.0.1:{}", port) } else { format!("host.docker.internal:{}", port) }
}

fn mirror_toml(regs: &[RegistryEntry]) -> String {
    let mut s = String::from("# HR Docker Builder 离线镜像 mirror 配置（导入离线包自动生成）\n");
    for r in regs {
        let addr = mirror_addr(r.port);
        s.push_str(&format!(
            "\n[registry.\"{}\"]\n  mirrors = [\"{addr}\"]\n\n[registry.\"{addr}\"]\n  http = true\n  insecure = true\n",
            r.host
        ));
    }
    s
}

// ── 导出离线包（在线机）──
pub async fn export_pack(
    app: &AppHandle,
    dockerfiles: Vec<String>,
    dest_dir: &str,
    run_id: &str,
) -> Result<PackManifest, String> {
    let dir = Path::new(dest_dir).join("offline-pack");
    if dir.exists() { let _ = fs::remove_dir_all(&dir); }
    fs::create_dir_all(dir.join("registry-data")).map_err(|e| format!("无法创建目录: {e}"))?;

    // 1. 收集 FROM 引用（digest 引用只进 images 通道，不进 mirror 通道）
    let mut seen = HashSet::new();
    let mut bases: Vec<String> = Vec::new();
    for df in &dockerfiles {
        for img in images_from_file(df) {
            if seen.insert(img.clone()) { bases.push(img); }
        }
    }
    let mut mirrorable: Vec<(String, String, String)> = Vec::new(); // (原引用, host, path)
    for b in &bases {
        match split_ref(b) {
            Some((host, path)) => mirrorable.push((b.clone(), host, path)),
            None => emit_line(app, run_id, &format!("跳过 mirror 通道（digest 固定引用，仅本机架构可用）: {b}"), "stderr"),
        }
    }

    // 2. 上游 host → 端口/序号
    let mut regs: BTreeMap<String, RegistryEntry> = BTreeMap::new();
    for (_, host, _) in &mirrorable {
        if !regs.contains_key(host) {
            let index = regs.len();
            regs.insert(host.clone(), RegistryEntry { host: host.clone(), port: 5000 + index as u16, index });
        }
    }
    // 2.5 端口预解析：5000+i 被本机其他程序占用时自动顺延到空闲端口；
    // manifest 记录实际端口，导入端按 manifest 启动容器与生成 mirror 配置
    for r in regs.values_mut() {
        let effective = free_port(r.port);
        if effective != r.port {
            emit_line(app, run_id, &format!("端口 {} 已被占用，{} 改用端口 {}", r.port, r.host, effective), "stdout");
            r.port = effective;
        }
    }

    // 3. 拉取（本机架构）：工具镜像 + 全部基础镜像
    let mut all: Vec<&str> = TOOL_IMAGES.iter().map(|s| *s).collect();
    all.extend(bases.iter().map(|s| s.as_str()));
    for img in &all {
        emit_line(app, run_id, &format!("Pulling {img}..."), "stdout");
        pull_image(app, run_id, img).await?;
    }

    // 4-6. 启动临时 registry → 多架构复制 → 导出卷数据；
    // 任何一步成败都最终清理临时容器（防止失败早退后容器与端口泄漏占用）
    let mirrored = async {
        // 4. 启动临时本地 registry（每个上游一个，端口为 2.5 预解析结果）；
        // 名称与导入侧 hr-offline-reg-* 隔离：已导入的机器上再次导出时，
        // 不能 rm -f 掉正在服役的离线 mirror（镜像数据在容器层内，删除即丢失）
        for r in regs.values() {
            let name = format!("hr-export-reg-{}", r.index);
            run_ignore(&["rm", "-f", &name]).await;
            let bind = format!("{}:{}:5000", publish_bind(), r.port);
            run_ok(&["run", "-d", "--name", &name, "-p", &bind, "registry:2"])
                .await.map_err(|e| format!("启动本地 registry 失败: {e}"))?;
        }

        // 5. 多架构复制：imagetools 把 manifest list + 全部平台 blobs 原样推入本地 registry
        for (orig, host, path) in &mirrorable {
            let r = &regs[host];
            let target = format!("localhost:{}/{}", r.port, path);
            emit_line(app, run_id, &format!("复制多架构 {orig} → {target}"), "stdout");
            mirror_one_image(app, run_id, orig, &target).await?;
        }

        // 6. 导出 registry 卷数据（cp 大目录无进度输出，心跳提示兜底）
        for r in regs.values() {
            let name = format!("hr-export-reg-{}", r.index);
            let out = dir.join("registry-data").join(r.index.to_string());
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            run_stream(app, run_id, &["cp", &format!("{name}:/var/lib/registry/."), out.to_str().ok_or("导出路径含非法字符")?]).await?;
        }
        Ok::<(), String>(())
    }.await;
    for r in regs.values() { run_ignore(&["rm", "-f", &format!("hr-export-reg-{}", r.index)]).await; }
    mirrored?;

    // 7. images.tar：工具镜像 + 基础镜像（本机架构，docker load 用）
    let tar = dir.join("images.tar");
    let mut args: Vec<&str> = vec!["save", "-o", tar.to_str().ok_or("导出路径非法")?];
    args.extend(all.iter().copied());
    emit_line(app, run_id, "docker save → images.tar ...", "stdout");
    run_stream(app, run_id, &args).await?;

    // 8. manifest.json
    let manifest = PackManifest {
        version: 2,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        images: bases.clone(),
        registries: regs.values().cloned().collect(),
    };
    let mj = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    fs::write(dir.join("manifest.json"), mj).map_err(|e| format!("写 manifest 失败: {e}"))?;

    emit_line(app, run_id, &format!("离线包导出完成: {}（{} 个镜像，{} 个上游 registry mirror）", dir.display(), manifest.images.len(), manifest.registries.len()), "stdout");
    Ok(manifest)
}

// ── 导入离线包（离线机）──
pub async fn import_pack(app: &AppHandle, pack_dir: &str, run_id: &str, root: &Path) -> Result<PackManifest, String> {
    let dir = Path::new(pack_dir);
    let manifest_path = dir.join("manifest.json");
    if !dir.is_dir() || !manifest_path.is_file() {
        return Err(format!("不是有效的离线包目录（缺 manifest.json）: {pack_dir}"));
    }
    let raw = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let manifest: PackManifest = serde_json::from_str(&raw)
        .map_err(|_| "离线包 manifest 解析失败".to_string())?;
    if manifest.version != 2 {
        return Err("检测到 v1 旧格式离线包：请在在线机用 v0.1.5+ 工具重新导出".into());
    }

    // 1. docker load 工具镜像与本机架构基础镜像
    let tar = dir.join("images.tar");
    if !tar.is_file() { return Err(format!("离线包缺少 images.tar: {}", tar.display())); }
    emit_line(app, run_id, "导入镜像库（docker load）...", "stdout");
    run_stream(app, run_id, &["load", "-i", tar.to_str().ok_or("路径非法")?]).await?;

    // 2. 启动各上游对应的本地 registry 并灌入数据（清单端口被占用时自动顺延，后续配置按实际端口生成）
    let mut regs = manifest.registries.clone();
    for r in &mut regs {
        let name = format!("hr-offline-reg-{}", r.index);
        run_ignore(&["rm", "-f", &name]).await;
        let effective = free_port(r.port);
        if effective != r.port {
            emit_line(app, run_id, &format!("端口 {} 已被占用，{} 改用端口 {}", r.port, r.host, effective), "stdout");
            r.port = effective;
        }
        let bind = format!("{}:{}:5000", publish_bind(), r.port);
        emit_line(app, run_id, &format!("启动本地 registry（{} → :{}）", r.host, r.port), "stdout");
        run_ok(&["run", "-d", "--name", &name, "--restart", "unless-stopped", "-p", &bind, "registry:2"]).await?;
        let data = dir.join("registry-data").join(r.index.to_string());
        if data.is_dir() {
            run_stream(app, run_id, &["cp", &format!("{}/.", data.to_str().ok_or("路径非法")?), &format!("{name}:/var/lib/registry/")]).await?;
            run_ok(&["restart", &name]).await?;
        } else {
            emit_line(app, run_id, &format!("警告: 缺少数据目录 {}，该上游镜像无法镜像", data.display()), "stderr");
        }
    }

    // 3. 生成 buildkitd.toml（供 hr-builder --config，使用实际端口）与镜像清单备份
    let off_dir = root.join("offline");
    fs::create_dir_all(&off_dir).map_err(|e| e.to_string())?;
    fs::write(off_dir.join("buildkitd.toml"), mirror_toml(&regs)).map_err(|e| e.to_string())?;
    if let Ok(j) = serde_json::to_string_pretty(&regs) {
        let _ = fs::write(off_dir.join("registries.json"), j);
    }

    emit_line(app, run_id, &format!("导入完成：{} 个镜像，{} 个 registry mirror（交叉构建将自动走本机）", manifest.images.len(), manifest.registries.len()), "stdout");
    Ok(manifest)
}

/// 导入后执行环境自举（离线机）：
/// 以 mirror 配置重建 builder → bootstrap → 注册 QEMU
pub async fn bootstrap_offline_env(
    app: &AppHandle,
    builder_name: &str,
    run_id: &str,
    root: &Path,
) -> Result<String, String> {
    let config = offline_mirror_config(root);

    // 1. 已有同名 builder？删了重建（确保带上 mirror 配置）
    let _ = docker_cmd().args(["buildx", "rm", builder_name]).output().await;

    emit_line(app, run_id, &format!("Creating builder {builder_name}..."), "stdout");
    let mut create: Vec<&str> = vec!["buildx", "create", "--name", builder_name, "--driver", "docker-container"];
    if let Some(p) = &config {
        create.extend(["--config", p.as_str()]);
        // Linux：buildkit 容器需共享宿主网络栈才能经 127.0.0.1 访问 mirror（见 mirror_addr）
        if cfg!(target_os = "linux") { create.extend(["--driver-opt", "network=host"]); }
        emit_line(app, run_id, &format!("使用离线 mirror 配置: {p}"), "stdout");
    }
    run_ok(&create).await.map_err(|e| format!("builder create 失败: {e}"))?;

    emit_line(app, run_id, &format!("Bootstrapping builder {builder_name}..."), "stdout");
    let out = docker_cmd()
        .args(["buildx", "inspect", "--bootstrap", builder_name])
        .output()
        .await
        .map_err(|e| format!("builder bootstrap 失败: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    emit_line(app, run_id, &stdout, "stdout");
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        emit_line(app, run_id, &format!("bootstrap 警告: {err}"), "stderr");
    }

    // 3. 注册 QEMU（尝试，离线时需要 --privileged；失败不阻断）
    emit_line(app, run_id, "Registering QEMU (binfmt)...", "stdout");
    let out = docker_cmd()
        .args(["run", "--privileged", "--rm", "tonistiigi/binfmt", "--install", "all"])
        .output()
        .await;
    match out {
        Ok(o) if o.status.success() => {
            emit_line(app, run_id, "QEMU registered", "stdout");
        }
        _ => {
            emit_line(app, run_id, "QEMU registration failed (may require privileged mode; cross-arch builds of .NET projects use cross-compilation and don't need QEMU)", "stderr");
        }
    }
    Ok("离线环境自举完成".into())
}
