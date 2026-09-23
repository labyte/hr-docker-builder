use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::commands::AppState;
use crate::docker_exec;
use crate::env_checker;
use crate::project_store;
use crate::types::{BuildTask, QueueDone, StartBuildRequest, StatusEvent};

struct Counts { success: AtomicUsize, failed: AtomicUsize, canceled: AtomicUsize, skipped: AtomicUsize }

pub async fn run(app: AppHandle, req: StartBuildRequest, run_id: String) {
    // panic 兜底：run() 以任何路径退出（含 panic）都释放队列锁，避免应用永久卡在 queue_running
    struct QueueGuard(AppHandle);
    impl Drop for QueueGuard {
        fn drop(&mut self) {
            if let Some(state) = self.0.try_state::<AppState>() {
                if let Ok(mut q) = state.queue_cancel.lock() { *q = None; }
            }
        }
    }
    let _queue_guard = QueueGuard(app.clone());

    let (global, project, cancel) = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        let cancel = state.queue_cancel.lock().unwrap().clone().unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let proj = cfg.projects.iter().find(|p| p.id == req.project_id).cloned().unwrap_or_default();
        (cfg.global.clone(), proj, cancel)
    };

    let root = project_store::effective_root(&app, &global);

    let export_dir = if req.export_dir.trim().is_empty() {
        let dir = root.join("exports");
        let _ = std::fs::create_dir_all(&dir);
        dir.to_string_lossy().to_string()
    } else {
        req.export_dir.clone()
    };

    let log_dir: PathBuf = root.join("logs").join(format!("run-{run_id}"));
    let _ = std::fs::create_dir_all(&log_dir);

    let host_arch = env_checker::host_arch().await;
    let mut tasks: Vec<BuildTask> = Vec::new();
    for pid in &req.program_ids {
        let Some(program) = project.programs.iter().find(|p| &p.id == pid) else { continue };
        if !program.enabled { continue; } // 后端兜底：未参与构建的程序不入队
        for arch in &req.arches {
            tasks.push(BuildTask {
                task_id: format!("{}-{}", program.id, arch),
                program: program.clone(),
                arch: arch.clone(),
                host_arch: host_arch.clone(),
                nuget_packages_dir: global.nuget_packages_dir.clone(),
                project_context_dir: project.context_dir.clone(),
                registry: global.registry.clone(),
                builder_name: global.builder_name.clone(),
                image_arch_suffix: global.image_arch_suffix,
                outputs: req.outputs.clone(),
                export_dir: export_dir.clone(),
                log_dir: log_dir.clone(),
            });
        }
    }

    let counts = Arc::new(Counts { success: AtomicUsize::new(0), failed: AtomicUsize::new(0), canceled: AtomicUsize::new(0), skipped: AtomicUsize::new(0) });
    let export_files = Arc::new(Mutex::new(Vec::<String>::new()));
    let any_fail = Arc::new(AtomicBool::new(false));
    let sem = Arc::new(Semaphore::new(req.concurrency.max(1)));
    let fail_fast = req.fail_fast;

    let mut set = JoinSet::new();
    for task in tasks {
        let app = app.clone();
        let sem = sem.clone();
        let cancel = cancel.clone();
        let counts = counts.clone();
        let export_files = export_files.clone();
        let any_fail = any_fail.clone();
        set.spawn(async move {
            let emit = |status: &str, message: Option<String>, tag: Option<String>, export_file: Option<String>| {
                let _ = app.emit("build-status", StatusEvent {
                    program_id: task.program.id.clone(),
                    arch: task.arch.clone(),
                    status: status.into(),
                    message,
                    tag,
                    export_file,
                });
            };
            if cancel.load(Ordering::Relaxed) { counts.skipped.fetch_add(1, Ordering::Relaxed); emit("skipped", None, None, None); return; }
            if fail_fast && any_fail.load(Ordering::Relaxed) { counts.skipped.fetch_add(1, Ordering::Relaxed); emit("skipped", Some("failFast".into()), None, None); return; }
            let _permit = match sem.acquire().await {
                Ok(p) => p,
                Err(_) => { counts.canceled.fetch_add(1, Ordering::Relaxed); emit("canceled", None, None, None); return; }
            };
            if cancel.load(Ordering::Relaxed) { counts.skipped.fetch_add(1, Ordering::Relaxed); emit("skipped", None, None, None); return; }
            emit("running", None, None, None);
            match docker_exec::execute(&app, &task, &cancel).await {
                Ok(tag) => {
                    counts.success.fetch_add(1, Ordering::Relaxed);
                    let ef = if task.outputs.export_file {
                        // 文件名与实际落盘一致：{镜像名[-架构]}-{版本}.tar
                        let f = docker_exec::export_file_path(&task);
                        export_files.lock().unwrap().push(f.clone());
                        Some(f)
                    } else { None };
                    emit("success", None, Some(tag.clone()), ef);
                    save_history(&app, &task, &tag, true);
                }
                Err(msg) => {
                    if msg == "canceled" { counts.canceled.fetch_add(1, Ordering::Relaxed); emit("canceled", None, None, None); }
                    else { any_fail.store(true, Ordering::Relaxed); counts.failed.fetch_add(1, Ordering::Relaxed); emit("failed", Some(msg.clone()), None, None); save_history(&app, &task, "", false); }
                }
            }
        });
    }
    drop(sem);
    while set.join_next().await.is_some() {}

    let done = QueueDone {
        kind: "build".into(),
        success: counts.success.load(Ordering::Relaxed),
        failed: counts.failed.load(Ordering::Relaxed),
        canceled: counts.canceled.load(Ordering::Relaxed),
        skipped: counts.skipped.load(Ordering::Relaxed),
        export_files: std::mem::take(&mut *export_files.lock().unwrap()),
        log_dir: log_dir.to_string_lossy().to_string(),
    };
    // 先解锁再发 queue-done：前端收到完成事件后立即开始下一队列/保存配置时不会被误拒
    {
        let state = app.state::<AppState>();
        *state.queue_cancel.lock().unwrap() = None;
    }
    let _ = app.emit("queue-done", &done);
}

fn save_history(app: &AppHandle, task: &BuildTask, tag: &str, ok: bool) {
    let state = app.state::<AppState>();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let cfg_clone = {
        let mut cfg = state.config.lock().unwrap();
        for prj in &mut cfg.projects {
            if let Some(prog) = prj.programs.iter_mut().find(|p| p.id == task.program.id) {
                prog.last_build = Some(crate::types::LastBuild { time: now.clone(), tag: tag.to_string(), arch: task.arch.clone(), ok });
            }
        }
        cfg.clone()
    };
    let _ = project_store::save(app, &cfg_clone);
}