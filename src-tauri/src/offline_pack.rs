use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::shell::docker_cmd;

use crate::types::LogEvent;

/// 离线包 manifest，导入时用于校验完整性
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PackManifest {
    pub version: u32,
    pub created_at: String,
    pub images: Vec<String>,
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

// ── 导出离线包 ──
pub async fn export_pack(
    app: &AppHandle,
    dockerfiles: Vec<String>,
    dest_dir: &str,
    run_id: &str,
) -> Result<PackManifest, String> {
    let dir = Path::new(dest_dir);
    fs::create_dir_all(dir).map_err(|e| format!("无法创建目录: {e}"))?;

    // 1. 收集镜像
    let mut images: Vec<String> = vec![
        "tonistiigi/binfmt:latest".into(),
        "moby/buildkit:buildx-stable-1".into(),
    ];
    for df in &dockerfiles {
        images.extend(images_from_file(df));
    }
    // 去重（保留顺序）
    let mut seen = HashSet::new();
    let images: Vec<String> = images.into_iter().filter(|i| seen.insert(i.clone())).collect();

    if images.is_empty() {
        return Err("no_images".into());
    }

    // 2. docker pull 每个镜像
    for img in &images {
        emit_line(app, run_id, &format!("Pulling {img}..."), "stdout");
        pull_image(img).await?;
        emit_line(app, run_id, &format!("Pulled {img}"), "stdout");
    }

    // 3. docker save → tar
    let tar_path = dir.join("offline-pack.tar");
    emit_line(app, run_id, &format!("Saving to {}...", tar_path.display()), "stdout");
    let mut cmd = docker_cmd();
    cmd.args(["save", "-o"]).arg(&tar_path);
    for img in &images {
        cmd.arg(img);
    }
    let out = cmd.output().await.map_err(|e| format!("docker save 失败: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("docker save 失败: {err}"));
    }

    // 4. 写 manifest
    let manifest = PackManifest {
        version: 1,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        images: images.clone(),
    };
    let mj = serde_json::to_string_pretty(&manifest).map_err(|e| format!("json 序列化失败: {e}"))?;
    fs::write(dir.join("manifest.json"), mj).map_err(|e| format!("写 manifest 失败: {e}"))?;

    emit_line(app, run_id, &format!("离线包导出完成: {}（{} 个镜像）", tar_path.display(), images.len()), "stdout");
    Ok(manifest)
}

async fn pull_image(image: &str) -> Result<(), String> {
    let out = docker_cmd()
        .args(["pull", image])
        .output()
        .await
        .map_err(|e| format!("docker pull {image} 失败: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("pull {image} 失败: {err}"));
    }
    Ok(())
}

// ── 导入离线包 ──
pub async fn import_pack(app: &AppHandle, tar_path: &str, run_id: &str) -> Result<Vec<String>, String> {
    let tp = Path::new(tar_path);
    if !tp.is_file() {
        return Err(format!("文件不存在: {tar_path}"));
    }

    // 1. docker load
    emit_line(app, run_id, "Importing offline pack (docker load)...", "stdout");
    let out = docker_cmd()
        .args(["load", "-i", tar_path])
        .output()
        .await
        .map_err(|e| format!("docker load 失败: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("docker load 失败: {err}"));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    emit_line(app, run_id, &stdout, "stdout");

    // 2. 读取 manifest（同行目录，fallback 不报错）
    let manifest_dir = tp.parent().unwrap_or(Path::new("."));
    let manifest_path = manifest_dir.join("manifest.json");
    let images: Vec<String> = if let Ok(raw) = fs::read_to_string(&manifest_path) {
        serde_json::from_str::<PackManifest>(&raw)
            .map(|m| m.images)
            .unwrap_or_default()
    } else {
        vec![]
    };

    emit_line(app, run_id, &format!("导入完成，共 {} 个镜像", images.len()), "stdout");
    Ok(images)
}

/// 导入后执行环境自举（离线机）：
/// 创建 builder → bootstrap → 注册 QEMU
pub async fn bootstrap_offline_env(
    app: &AppHandle,
    builder_name: &str,
    run_id: &str,
) -> Result<String, String> {
    // 1. 已有同名 builder？删了重建（确保用本地镜像）
    let _ = docker_cmd()
        .args(["buildx", "rm", builder_name])
        .output()
        .await;

    emit_line(app, run_id, &format!("Creating builder {builder_name}..."), "stdout");
    let out = docker_cmd()
        .args(["buildx", "create", "--name", builder_name, "--driver", "docker-container"])
        .output()
        .await
        .map_err(|e| format!("builder create 失败: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("builder create 失败: {err}"));
    }

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

    Ok(format!("builder {builder_name} ready"))
}

fn emit_line(app: &AppHandle, pid: &str, line: &str, stream: &str) {
    let _ = app.emit(
        "build-log",
        LogEvent {
            task_id: pid.into(),
            project_id: pid.into(),
            line: line.into(),
            stream: stream.into(),
        },
    );
}