use crate::shell::docker_cmd;
use crate::types::EnvInfo;

async fn out(args: &[&str]) -> Result<String, String> {
    let o = docker_cmd()
        .args(args)
        .output()
        .await
        .map_err(|e| format!("docker 不可用 / docker not available: {e}"))?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        let mut combined = o.stdout.clone();
        combined.extend_from_slice(&o.stderr);
        Err(String::from_utf8_lossy(&combined).trim().to_string())
    }
}

fn parse_platforms(inspect: &str) -> Vec<String> {
    inspect
        .lines()
        .find_map(|l| l.strip_prefix("Platforms:"))
        .map(|l| l.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default()
}

/// 宿主机架构（amd64/arm64）：优先问 docker daemon，退化用编译期目标
pub async fn host_arch() -> String {
    match out(&["info", "--format", "{{.Architecture}}"]).await {
        Ok(a) => normalize_arch(&a),
        Err(_) => normalize_arch(std::env::consts::ARCH),
    }
}

fn normalize_arch(raw: &str) -> String {
    match raw.trim().to_lowercase().as_str() {
        "x86_64" | "amd64" => "amd64".into(),
        "aarch64" | "arm64" => "arm64".into(),
        other => other.into(),
    }
}

pub async fn probe(builder: &str) -> EnvInfo {
    let mut env = EnvInfo::default();
    match out(&["--version"]).await {
        Ok(v) => { env.docker_ok = true; env.docker_version = v; }
        Err(_) => return env,
    }
    env.host_arch = host_arch().await;
    if let Ok(v) = out(&["buildx", "version"]).await {
        env.buildx_ok = true;
        env.buildx_version = v;
    }
    env.daemon_ok = out(&["info", "--format", "{{.ServerVersion}}"]).await.is_ok();
    if env.daemon_ok && env.buildx_ok {
        if let Ok(text) = out(&["buildx", "inspect", builder]).await {
            env.builder_ok = true;
            env.builder_platforms = parse_platforms(&text);
        }
    }
    env
}

/// config：可选 buildkitd.toml 路径（离线 mirror 场景由导入流程提供）
pub async fn ensure_builder(builder: &str, config: Option<&str>) -> Result<EnvInfo, String> {
    if !out(&["--version"]).await.is_ok() { return Err("docker_missing".into()); }
    if !out(&["buildx", "version"]).await.is_ok() { return Err("buildx_missing".into()); }
    if !out(&["info", "--format", "{{.ServerVersion}}"]).await.is_ok() { return Err("daemon_missing".into()); }
    let exists = out(&["buildx", "inspect", builder]).await.is_ok();
    if !exists {
        let mut create: Vec<&str> = vec!["buildx", "create", "--name", builder, "--driver", "docker-container"];
        if let Some(c) = config {
            create.extend(["--config", c]);
            // 与 bootstrap_offline_env 一致：Linux 离线 mirror 需宿主网络栈走 127.0.0.1
            if cfg!(target_os = "linux") { create.extend(["--driver-opt", "network=host"]); }
        }
        out(&create)
            .await
            .map_err(|e| format!("builder_create_failed: {e}"))?;
    }
    out(&["buildx", "inspect", "--bootstrap", builder])
        .await
        .map_err(|e| format!("builder_bootstrap_failed: {e}"))?;
    Ok(probe(builder).await)
}

pub async fn install_qemu() -> Result<String, String> {
    out(&["run", "--privileged", "--rm", "tonistiigi/binfmt", "--install", "all"]).await
}