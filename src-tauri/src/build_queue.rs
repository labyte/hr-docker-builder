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
    let (global, project, cancel) = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        let cancel = state.queue_cancel.lock().unwrap().clone().unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let proj = cfg.projects.iter().find(|p| p.id == req.project_id).cloned().unwrap_or_default();
        (cfg.global.clone(), proj, cancel)
    };

    let export_dir = if req.export_dir.trim().is_empty() {
        let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir()).join("exports");
        let _ = std::fs::create_dir_all(&dir);
        dir.to_string_lossy().to_string()
    } else {
        req.export_dir.clone()
    };

    let log_dir: PathBuf = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir())
        .join("logs").join(format!("run-{run_id}"));
    let _ = std::fs::create_dir_all(&log_dir);

    let host_arch = env_checker::host_arch().await;
    let mut tasks: Vec<BuildTask> = Vec::new();
    for pid in &req.program_ids {
        let Some(program) = project.programs.iter().find(|p| &p.id == pid) else { continue };
        for arch in &req.arches {
            tasks.push(BuildTask {
                task_id: format!("{}-{}", program.id, arch),
                program: program.clone(),
                arch: arch.clone(),
                host_arch: host_arch.clone(),
                registry: global.registry.clone(),
                builder_name: global.builder_name.clone(),
                tag_template: global.tag_template.clone(),
                outputs: req.outputs.clone(),
                export_dir: export_dir.clone(),
                log_dir: log_dir.clone(),
                ts: run_id.clone(),
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
                        let f = docker_exec::export_path(&task.export_dir, &task.program.image, &tag);
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
        success: counts.success.load(Ordering::Relaxed),
        failed: counts.failed.load(Ordering::Relaxed),
        canceled: counts.canceled.load(Ordering::Relaxed),
        skipped: counts.skipped.load(Ordering::Relaxed),
        export_files: std::mem::take(&mut *export_files.lock().unwrap()),
        log_dir: log_dir.to_string_lossy().to_string(),
    };
    let _ = app.emit("queue-done", &done);
    let state = app.state::<AppState>();
    *state.queue_cancel.lock().unwrap() = None;
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