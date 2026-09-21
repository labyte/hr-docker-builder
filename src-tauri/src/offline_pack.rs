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

async fn run_ok(args: &[&str]) -> Result<(), String> {
    let o = docker_cmd().args(args).output().await.map_err(|e| format!("docker {} 启动失败: {e}", args.first().unwrap_or(&"")))?;
    if o.status.success() { return Ok(()); }
    let mut combined = o.stdout.clone();
    combined.extend_from_slice(&o.stderr);
    Err(format!("docker {} 失败: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&combined).trim()))
}

async fn run_ignore(args: &[&str]) { let _ = docker_cmd().args(args).output().await; }

fn emit_line(app: &AppHandle, run_id: &str, line: &str, stream: &str) {
    let _ = app.emit("build-log", LogEvent { task_id: run_id.into(), project_id: run_id.into(), line: line.into(), stream: stream.into() });
}

async fn pull_image(image: &str) -> Result<(), String> {
    run_ok(&["pull", image]).await.map_err(|e| format!("pull {image} 失败: {e}"))
}

/// 供 commands 使用：若 mirror 配置存在（导入离线包生成于数据根目录），返回 buildkitd.toml 路径
pub fn offline_mirror_config(root: &Path) -> Option<String> {
    let toml = root.join("offline").join("buildkitd.toml");
    toml.is_file().then(|| toml.to_string_lossy().to_string())
}

pub async fn offline_registry_running() -> bool {
    match docker_cmd().args(["ps", "--filter", "name=hr-offline-reg", "--format", "{{.Names}}"]).output().await {
        Ok(o) => !String::from_utf8_lossy(&o.stdout).trim().is_empty(),
        Err(_) => false,
    }
}

fn mirror_toml(regs: &[RegistryEntry]) -> String {
    let mut s = String::from("# HR Docker Builder 离线镜像 mirror 配置（导入离线包自动生成）\n");
    for r in regs {
        s.push_str(&format!(
            "\n[registry.\"{}\"]\n  mirrors = [\"host.docker.internal:{}\"]\n\n[registry.\"host.docker.internal:{}\"]\n  http = true\n  insecure = true\n",
            r.host, r.port, r.port
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

    // 3. 拉取（本机架构）：工具镜像 + 全部基础镜像
    let mut all: Vec<&str> = TOOL_IMAGES.iter().map(|s| *s).collect();
    all.extend(bases.iter().map(|s| s.as_str()));
    for img in &all {
        emit_line(app, run_id, &format!("Pulling {img}..."), "stdout");
        pull_image(img).await?;
    }

    // 4. 启动临时本地 registry（每个上游一个，端口 5000+i）
    for r in regs.values() {
        let name = format!("hr-offline-reg-{}", r.index);
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
        run_ok(&["buildx", "imagetools", "create", "-t", &target, orig]).await?;
    }

    // 6. 导出 registry 卷数据
    for r in regs.values() {
        let name = format!("hr-offline-reg-{}", r.index);
        let out = dir.join("registry-data").join(r.index.to_string());
        fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        run_ok(&["cp", &format!("{name}:/var/lib/registry/."), out.to_str().unwrap_or(".")]).await?;
    }
    for r in regs.values() { run_ignore(&["rm", "-f", &format!("hr-offline-reg-{}", r.index)]).await; }

    // 7. images.tar：工具镜像 + 基础镜像（本机架构，docker load 用）
    let tar = dir.join("images.tar");
    let mut args: Vec<&str> = vec!["save", "-o", tar.to_str().ok_or("导出路径非法")?];
    args.extend(all.iter().copied());
    emit_line(app, run_id, "docker save → images.tar ...", "stdout");
    run_ok(&args).await?;

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
    run_ok(&["load", "-i", tar.to_str().ok_or("路径非法")?]).await?;

    // 2. 启动各上游对应的本地 registry 并灌入数据
    for r in &manifest.registries {
        let name = format!("hr-offline-reg-{}", r.index);
        run_ignore(&["rm", "-f", &name]).await;
        let bind = format!("{}:{}:5000", publish_bind(), r.port);
        emit_line(app, run_id, &format!("启动本地 registry（{} → :{}）", r.host, r.port), "stdout");
        run_ok(&["run", "-d", "--name", &name, "--restart", "unless-stopped", "-p", &bind, "registry:2"]).await?;
        let data = dir.join("registry-data").join(r.index.to_string());
        if data.is_dir() {
            run_ok(&["cp", &format!("{}/.", data.to_str().ok_or("路径非法")?), &format!("{name}:/var/lib/registry/")]).await?;
            run_ok(&["restart", &name]).await?;
        } else {
            emit_line(app, run_id, &format!("警告: 缺少数据目录 {}，该上游镜像无法镜像", data.display()), "stderr");
        }
    }

    // 3. 生成 buildkitd.toml（供 hr-builder --config）与镜像清单备份
    let off_dir = root.join("offline");
    fs::create_dir_all(&off_dir).map_err(|e| e.to_string())?;
    fs::write(off_dir.join("buildkitd.toml"), mirror_toml(&manifest.registries)).map_err(|e| e.to_string())?;
    if let Ok(j) = serde_json::to_string_pretty(&manifest.registries) {
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
