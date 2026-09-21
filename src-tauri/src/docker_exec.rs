use std::io::Write;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tauri::{AppHandle, Emitter};

use crate::shell::docker_cmd;

use crate::types::{BuildTask, LogEvent, Outputs};

pub async fn execute(
    app: &AppHandle,
    task: &BuildTask,
    cancel: &Arc<AtomicBool>,
) -> Result<String, String> {
    let Outputs { export_file, load_local, push } = task.outputs;

    if push && task.registry.trim().is_empty() {
        return Err("registry_not_configured".into());
    }

    let tag = render_tag(&task.tag_template, &task.program.default_version, &task.arch, &task.ts);
    let local_tag = format!("{}:{}", task.program.image, tag);
    let registry_tag = if push {
        Some(format!("{}/{}:{}", task.registry.trim_end_matches('/'), task.program.image, tag))
    } else {
        None
    };

    let tar_path = if export_file {
        Some(export_path(&task.export_dir, &task.program.image, &tag))
    } else {
        None
    };

    // 同架构 → default(docker 驱动) builder：FROM 优先解析本机 docker 镜像库，
    // 离线环境下本机有基础镜像即可构建；缺省才走外网。
    // 交叉架构 → 仍用 docker-container（hr-builder）：需要 QEMU/独立缓存，
    // 该驱动不共享本机镜像库，离线机请先导入离线包并保证 builder 就绪。
    let use_default = !task.host_arch.is_empty() && task.arch == task.host_arch;

    let mut args: Vec<String> = vec![
        "buildx".into(), "build".into(),
        "--builder".into(), if use_default { "default".into() } else { task.builder_name.clone() },
        "--progress".into(), "plain".into(),
        "--platform".into(), format!("linux/{}", task.arch),
        "-f".into(), task.program.dockerfile.clone(),
    ];

    // tag 策略
    let push_native = !use_default && push && tar_path.is_none() && !load_local;
    match (&registry_tag, use_default) {
        (Some(rt), true) => { args.extend(["-t".into(), local_tag.clone(), "-t".into(), rt.clone()]); }
        (Some(rt), false) if push_native => { args.extend(["-t".into(), rt.clone()]); }
        (Some(rt), false) => { args.extend(["-t".into(), local_tag.clone(), "-t".into(), rt.clone()]); }
        _ => { args.extend(["-t".into(), local_tag.clone()]); }
    }
    for (k, v) in &task.program.build_args {
        args.extend(["--build-arg".into(), format!("{k}={v}")]);
    }
    let nuget_dir = if !task.nuget_packages_dir.is_empty() { task.nuget_packages_dir.as_str() } else { task.program.nuget_packages_dir.as_str() };
    if !nuget_dir.is_empty() {
        args.push("--build-arg".into());
        args.push(format!("NUGET_PACKAGES={}", nuget_dir));
    }
    if let Some(tar) = &tar_path {
        if let Some(parent) = std::path::Path::new(tar).parent() { let _ = std::fs::create_dir_all(parent); }
    }
    if !use_default {
        // default 驱动不支持 --output/--push（构建结果自动进本机镜像库），
        // 导出与推送在构建完成后用 docker save / docker push 单独执行
        if let Some(tar) = &tar_path {
            args.extend(["--output".into(), format!("type=docker,dest={tar}")]);
        } else if load_local {
            args.push("--load".into());
        } else if push_native {
            args.push("--push".into());
        }
    }
    // 上下文：程序级优先，空则跟随项目设置
    let context = if !task.program.context.trim().is_empty() { task.program.context.as_str() } else { task.project_context_dir.as_str() };
    if context.trim().is_empty() { return Err(format!("context_invalid:{}", task.program.id)); }
    args.push(context.into());

    let log_file = task.log_dir.join(format!("{}-{}.log", task.task_id, task.arch));

    // 1) build
    if use_default {
        emit_line(app, task, "[本机优先] 同架构构建走 default builder：FROM 先查本机镜像库，缺失才联网拉取", "stdout");
    }
    let code = stream_cmd(app, task, &log_file, cancel, &args).await?;
    if code != 0 {
        return Err(if cancel.load(Ordering::Relaxed) { "canceled".into() } else { format!("build_failed(exit {code})") });
    }

    if use_default {
        // default 驱动：产物已在本机镜像库（load_local 无需额外步骤）；导出用 save、推送用 push
        if let Some(tar) = &tar_path {
            let code = stream_cmd(app, task, &log_file, cancel, &["save".into(), "-o".into(), tar.clone(), local_tag.clone()]).await?;
            if code != 0 { return Err(format!("docker_save_failed(exit {code})")); }
        }
        if push {
            let rt = registry_tag.clone().unwrap();
            let code = stream_cmd(app, task, &log_file, cancel, &["push".into(), rt]).await?;
            if code != 0 { return Err(format!("docker_push_failed(exit {code})")); }
        }
    } else {
        // 2) need load after export
        let need_load = tar_path.is_some() && (load_local || (push && !push_native));
        if need_load {
            let tar = tar_path.clone().unwrap();
            let code = stream_cmd(app, task, &log_file, cancel, &["load".into(), "-i".into(), tar]).await?;
            if code != 0 { return Err(format!("docker_load_failed(exit {code})")); }
        }
        // 3) push after load
        if push && !push_native {
            let rt = registry_tag.clone().unwrap();
            let code = stream_cmd(app, task, &log_file, cancel, &["push".into(), rt]).await?;
            if code != 0 { return Err(format!("docker_push_failed(exit {code})")); }
        }
    }

    Ok(tag)
}

fn render_tag(template: &str, version: &str, arch: &str, time: &str) -> String {
    template.replace("{version}", version).replace("{arch}", arch).replace("{time}", time)
}

pub fn export_path(export_dir: &str, image: &str, tag: &str) -> String {
    let dir = if export_dir.trim().is_empty() { ".".into() } else { export_dir.trim_end_matches(['/', '\\']).to_string() };
    // 镜像名里的 "/"（如 hr/app）只属于镜像命名空间，文件名中转义为 "-"；镜像内 tag 不受影响
    let safe = image.replace('/', "-");
    format!("{dir}/{safe}-{tag}.tar")
}

async fn stream_cmd(
    app: &AppHandle, task: &BuildTask, log_file: &std::path::Path,
    cancel: &Arc<AtomicBool>, args: &[String],
) -> Result<i32, String> {
    let mut cmd = docker_cmd();
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);

    let display = format!("$ docker {}", args.join(" "));
    emit_line(app, task, &display, "stdout");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_file) {
        let _ = writeln!(f, "{display}");
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn_docker_failed: {e}"))?;
    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take().expect("stderr");

    let file = Arc::new(Mutex::new(
        std::fs::OpenOptions::new().create(true).append(true).open(log_file).map_err(|e| e.to_string())?,
    ));

    let (app1, app2) = (app.clone(), app.clone());
    let (f1, f2) = (file.clone(), file.clone());
    let (tid1, tid2) = (task.task_id.clone(), task.task_id.clone());
    let (pid1, pid2) = (task.program.id.clone(), task.program.id.clone());

    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app1.emit("build-log", LogEvent { task_id: tid1.clone(), project_id: pid1.clone(), line: line.clone(), stream: "stdout".into() });
            if let Ok(mut f) = f1.lock() { let _ = writeln!(f, "{line}"); }
        }
    });
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app2.emit("build-log", LogEvent { task_id: tid2.clone(), project_id: pid2.clone(), line: line.clone(), stream: "stderr".into() });
            if let Ok(mut f) = f2.lock() { let _ = writeln!(f, "[stderr] {line}"); }
        }
    });

    let status = loop {
        tokio::select! {
            s = child.wait() => break s.map_err(|e| e.to_string())?,
            _ = tokio::time::sleep(Duration::from_millis(300)) => {
                if cancel.load(Ordering::Relaxed) { let _ = child.start_kill(); }
            }
        }
    };
    Ok(status.code().unwrap_or(-1))
}

fn emit_line(app: &AppHandle, task: &BuildTask, line: &str, stream: &str) {
    let _ = app.emit("build-log", LogEvent {
        task_id: task.task_id.clone(),
        project_id: task.program.id.clone(),
        line: line.to_string(),
        stream: stream.into(),
    });
}