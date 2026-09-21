use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};

use crate::build_queue;
use crate::env_checker;
use crate::offline_pack;
use crate::project_store;
use crate::project_store::effective_root;
use crate::types::{AppConfig, EnvInfo, PathIssue, StartBuildRequest};
use chrono::Local;

#[derive(Default)]
pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub queue_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

#[tauri::command]
pub fn get_config(app: AppHandle, state: State<AppState>) -> Result<AppConfig, String> {
    let cfg = project_store::load(&app)?;
    *state.config.lock().unwrap() = cfg.clone();
    Ok(cfg)
}

#[tauri::command]
pub fn save_config(app: AppHandle, state: State<AppState>, config: AppConfig) -> Result<Vec<PathIssue>, String> {
    if state.queue_cancel.lock().unwrap().is_some() { return Err("queue_running".into()); }
    project_store::save(&app, &config)?;
    *state.config.lock().unwrap() = config.clone();
    Ok(project_store::validate(&config))
}

#[tauri::command]
pub async fn check_env(state: State<'_, AppState>) -> Result<EnvInfo, String> {
    let builder = state.config.lock().unwrap().global.builder_name.clone();
    Ok(env_checker::probe(&builder).await)
}

#[tauri::command]
pub async fn ensure_builder(app: AppHandle, state: State<'_, AppState>) -> Result<EnvInfo, String> {
    let (builder, root) = {
        let cfg = state.config.lock().unwrap();
        (cfg.global.builder_name.clone(), effective_root(&app, &cfg.global))
    };
    // 离线机若已导入 registry mirror 且容器在跑，builder 需带 mirror 配置创建
    let config = match offline_pack::offline_registry_running().await {
        true => offline_pack::offline_mirror_config(&root),
        false => None,
    };
    env_checker::ensure_builder(&builder, config.as_deref()).await
}

#[tauri::command]
pub async fn install_qemu() -> Result<String, String> {
    env_checker::install_qemu().await
}

#[tauri::command]
pub fn start_build(app: AppHandle, state: State<AppState>, req: StartBuildRequest) -> Result<String, String> {
    {
        let mut q = state.queue_cancel.lock().unwrap();
        if q.is_some() { return Err("queue_running".into()); }
        *q = Some(Arc::new(AtomicBool::new(false)));
    }
    if let Err(e) = validate_request(&state, &req) {
        *state.queue_cancel.lock().unwrap() = None;
        return Err(e);
    }
    let run_id = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let app2 = app.clone();
    let req2 = req.clone();
    let rid = run_id.clone();
    tauri::async_runtime::spawn(async move { build_queue::run(app2, req2, rid).await; });
    Ok(run_id)
}

fn validate_request(state: &State<AppState>, req: &StartBuildRequest) -> Result<(), String> {
    let cfg = state.config.lock().unwrap();
    if req.program_ids.is_empty() { return Err("no_programs".into()); }
    if req.arches.is_empty() { return Err("no_arches".into()); }
    if !req.outputs.export_file && !req.outputs.load_local && !req.outputs.push { return Err("no_outputs".into()); }
    if req.outputs.push && cfg.global.registry.trim().is_empty() { return Err("registry_not_configured".into()); }
    let project = cfg.projects.iter().find(|p| p.id == req.project_id)
        .ok_or_else(|| format!("project_not_found:{}", req.project_id))?;
    for pid in &req.program_ids {
        let Some(prog) = project.programs.iter().find(|x| &x.id == pid) else { return Err(format!("program_not_found:{pid}")); };
        if prog.dockerfile.trim().is_empty() || !std::path::Path::new(&prog.dockerfile).is_file() { return Err(format!("dockerfile_invalid:{pid}")); }
        // 上下文：程序级为空则跟随项目级 context_dir
        let ctx = if prog.context.trim().is_empty() { project.context_dir.as_str() } else { prog.context.as_str() };
        if ctx.trim().is_empty() || !std::path::Path::new(ctx).is_dir() { return Err(format!("context_invalid:{pid}")); }
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_build(state: State<AppState>) {
    if let Some(flag) = state.queue_cancel.lock().unwrap().as_ref() { flag.store(true, std::sync::atomic::Ordering::Relaxed); }
}

/// 解析当前生效的导出目录：项目设置了就用它，否则数据根目录/exports；确保存在后返回
#[tauri::command]
pub fn get_export_dir(app: AppHandle, state: State<'_, AppState>, export_dir: String) -> Result<String, String> {
    let dir = if !export_dir.trim().is_empty() {
        export_dir.trim().to_string()
    } else {
        let root = effective_root(&app, &state.config.lock().unwrap().global);
        root.join("exports").to_string_lossy().to_string()
    };
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir)
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    #[cfg(target_os = "macos")]
    let mut cmd = { let mut c = crate::shell::std_cmd("open"); c.arg("-R").arg(p); c };
    #[cfg(target_os = "windows")]
    let mut cmd = { let mut c = crate::shell::std_cmd("explorer"); c.arg(format!("/select,{}", p.to_string_lossy())); c };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = { let mut c = crate::shell::std_cmd("xdg-open"); c.arg(p.parent().unwrap_or(std::path::Path::new("/"))); c };
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

// ── 离线依赖包 ──

#[tauri::command]
pub async fn export_offline_pack(app: AppHandle, state: State<'_, AppState>, dest_dir: String, project_id: Option<String>) -> Result<String, String> {
    let cfg = state.config.lock().unwrap().clone();
    // 范围：指定项目则仅收集该项目的 Dockerfile，否则全部项目
    let scope_label = match &project_id {
        Some(pid) => {
            let prj = cfg.projects.iter().find(|p| &p.id == pid).ok_or_else(|| format!("project_not_found:{pid}"))?;
            format!("项目「{}」", prj.name)
        }
        None => "全项目".into(),
    };
    let scope_projects = match &project_id {
        Some(pid) => cfg.projects.iter().filter(|p| &p.id == pid).collect::<Vec<_>>(),
        None => cfg.projects.iter().collect::<Vec<_>>(),
    };
    let dockerfiles: Vec<String> = scope_projects.iter()
        .flat_map(|p| p.programs.iter())
        .filter(|p| !p.dockerfile.is_empty())
        .map(|p| p.dockerfile.clone())
        .collect();
    if dockerfiles.is_empty() { return Err("no_dockerfiles".into()); }
    let rid = Local::now().format("offline-%Y%m%d-%H%M%S").to_string();
    let rid2 = rid.clone();
    let app2 = app.clone();
    let did = dest_dir.clone();
    tauri::async_runtime::spawn(async move {
        use crate::types::{LogEvent, QueueDone};
        match offline_pack::export_pack(&app2, dockerfiles, &did, &rid2).await {
            Ok(m) => {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: format!("成功[{scope_label}]: {} 个镜像（含多架构 mirror 数据）→ {}/offline-pack", m.images.len(), did.trim_end_matches('/')), stream: "stdout".into() });
                let _ = app2.emit("queue-done", QueueDone { success: 1, failed: 0, canceled: 0, skipped: 0, export_files: vec![format!("{}/offline-pack", did.trim_end_matches('/'))], log_dir: dest_dir.clone() });
            }
            Err(e) => {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: format!("导出失败: {e}"), stream: "stderr".into() });
                let _ = app2.emit("queue-done", QueueDone { success: 0, failed: 1, canceled: 0, skipped: 0, export_files: vec![], log_dir: dest_dir });
            }
        }
    });
    Ok(rid)
}

#[tauri::command]
pub async fn import_offline_pack(app: AppHandle, state: State<'_, AppState>, pack_dir: String) -> Result<String, String> {
    let (builder, root) = {
        let cfg = state.config.lock().unwrap();
        (cfg.global.builder_name.clone(), effective_root(&app, &cfg.global))
    };
    let rid = Local::now().format("import-%Y%m%d-%H%M%S").to_string();
    let rid2 = rid.clone();
    let app2 = app.clone();
    let tp = pack_dir.clone();
    let bn = builder.clone();
    tauri::async_runtime::spawn(async move {
        use crate::types::{LogEvent, QueueDone};
        if let Err(e) = offline_pack::import_pack(&app2, &tp, &rid2, &root).await {
            let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: format!("导入失败: {e}"), stream: "stderr".into() });
            let _ = app2.emit("queue-done", QueueDone { success: 0, failed: 1, canceled: 0, skipped: 0, export_files: vec![], log_dir: tp });
            return;
        }
        match offline_pack::bootstrap_offline_env(&app2, &bn, &rid2, &root).await {
            Ok(msg) => {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: msg, stream: "stdout".into() });
                let _ = app2.emit("queue-done", QueueDone { success: 1, failed: 0, canceled: 0, skipped: 0, export_files: vec![], log_dir: tp });
            }
            Err(e) => {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: format!("自举失败: {e}"), stream: "stderr".into() });
                let _ = app2.emit("queue-done", QueueDone { success: 0, failed: 1, canceled: 0, skipped: 0, export_files: vec![], log_dir: tp });
            }
        }
    });
    Ok(rid)
}