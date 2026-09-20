use std::io::Write;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tauri::{AppHandle, Emitter};

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

    let mut args: Vec<String> = vec![
        "buildx".into(), "build".into(),
        "--builder".into(), task.builder_name.clone(),
        "--progress".into(), "plain".into(),
        "--platform".into(), format!("linux/{}", task.arch),
        "-f".into(), task.program.dockerfile.clone(),
    ];

    // tag 策略
    let push_native = push && tar_path.is_none() && !load_local;
    match (&registry_tag, tar_path.is_some(), load_local, push) {
        (Some(rt), false, false, true) => { args.extend(["-t".into(), rt.clone()]); }
        (Some(rt), ..) => { args.extend(["-t".into(), local_tag.clone(), "-t".into(), rt.clone()]); }
        _ => { args.extend(["-t".into(), local_tag.clone()]); }
    }
    for (k, v) in &task.program.build_args {
        args.extend(["--build-arg".into(), format!("{k}={v}")]);
    }
    if !task.program.nuget_packages_dir.is_empty() {
        args.push("--build-arg".into());
        args.push(format!("NUGET_PACKAGES={}", task.program.nuget_packages_dir));
    }
    if let Some(tar) = &tar_path {
        if let Some(parent) = std::path::Path::new(tar).parent() { let _ = std::fs::create_dir_all(parent); }
        args.extend(["--output".into(), format!("type=docker,dest={tar}")]);
    } else if load_local {
        args.push("--load".into());
    } else if push_native {
        args.push("--push".into());
    }
    args.push(task.program.context.clone());

    let log_file = task.log_dir.join(format!("{}-{}.log", task.task_id, task.arch));

    // 1) buildx
    let code = stream_cmd(app, task, &log_file, cancel, &args).await?;
    if code != 0 {
        return Err(if cancel.load(Ordering::Relaxed) { "canceled".into() } else { format!("build_failed(exit {code})") });
    }

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

    Ok(tag)
}

fn render_tag(template: &str, version: &str, arch: &str, time: &str) -> String {
    template.replace("{version}", version).replace("{arch}", arch).replace("{time}", time)
}

pub fn export_path(export_dir: &str, image: &str, tag: &str) -> String {
    let dir = if export_dir.trim().is_empty() { ".".into() } else { export_dir.trim_end_matches('/').to_string() };
    format!("{dir}/{image}-{tag}.tar")
}

async fn stream_cmd(
    app: &AppHandle, task: &BuildTask, log_file: &std::path::Path,
    cancel: &Arc<AtomicBool>, args: &[String],
) -> Result<i32, String> {
    let mut cmd = Command::new("docker");
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