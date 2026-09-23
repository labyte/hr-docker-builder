use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::build_queue;
use crate::env_checker;
use crate::offline_pack;
use crate::project_store;
use crate::project_store::effective_root;
use crate::types::{AppConfig, EnvInfo, MirrorStatus, PathIssue, StartBuildRequest};
use chrono::Local;

#[derive(Default)]
pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub queue_cancel: Mutex<Option<Arc<AtomicBool>>>,
    /// 离线任务（导出/导入/一键修复）占用标志：与构建队列及自身互斥（防并发互踩、防中途改配置）；
    /// 记录占用方的错误 key（busy_export / busy_import / busy_repair），互斥拒绝时原样上报，前端据此提示具体在忙什么
    pub offline_busy: Mutex<Option<&'static str>>,
    /// 配置文件损坏通知：load 时记录，get_config 时冲刷为事件（此时前端监听已就绪）
    pub corrupt_notices: Mutex<Vec<crate::types::ConfigCorruptEvent>>,
}

/// 离线任务兜底守卫：正常结束或 panic 都释放 offline_busy 占用并清除 queue_cancel（与构建 QueueGuard 同责）
struct OfflineGuard(AppHandle);
impl Drop for OfflineGuard {
    fn drop(&mut self) {
        if let Some(st) = self.0.try_state::<AppState>() {
            if let Ok(mut b) = st.offline_busy.lock() { *b = None; }
            if let Ok(mut q) = st.queue_cancel.lock() { *q = None; }
        }
    }
}

/// 互斥检查（锁序固定：queue_cancel → offline_busy，各处一致以杜绝交叉竞态）；
/// 通过则占用 offline_busy，返回 Err 表示被谁挡下
fn acquire_offline(state: &State<'_, AppState>, busy_key: &'static str) -> Result<(), String> {
    let q = state.queue_cancel.lock().unwrap();
    let mut b = state.offline_busy.lock().unwrap();
    if q.is_some() { return Err("queue_running".into()); }
    if let Some(k) = *b { return Err(k.into()); }
    *b = Some(busy_key);
    Ok(())
}

#[tauri::command]
pub fn get_config(app: AppHandle, state: State<AppState>) -> Result<AppConfig, String> {
    let cfg = project_store::load(&app)?;
    *state.config.lock().unwrap() = cfg.clone();
    // 冲刷配置损坏通知（前端 init 先注册监听再拉配置，见 store.ts）
    for n in std::mem::take(&mut *state.corrupt_notices.lock().unwrap()) {
        let _ = app.emit("config-corrupt", n);
    }
    Ok(cfg)
}

#[tauri::command]
pub fn save_config(app: AppHandle, state: State<AppState>, config: AppConfig) -> Result<Vec<PathIssue>, String> {
    {
        let q = state.queue_cancel.lock().unwrap();
        let b = state.offline_busy.lock().unwrap();
        if q.is_some() { return Err("queue_running".into()); }
        if let Some(k) = *b { return Err(k.into()); }
    }
    project_store::save(&app, &config)?;
    *state.config.lock().unwrap() = config.clone();
    Ok(project_store::validate(&config))
}

/// 离线 mirror 细分状态：配置文件 / registry 容器（运行中/总数）/ builder 是否挂载 mirror 配置
async fn probe_mirror(root: &std::path::Path, builder: &str) -> MirrorStatus {
    let config_exists = offline_pack::offline_mirror_config(root).is_some();
    let regs = offline_pack::load_registries(root);
    let containers_total = regs.as_ref().map(|v| v.len()).unwrap_or(0);
    let imported = config_exists || regs.is_some();
    let containers_running = offline_pack::running_registries().await.len();
    let builder_configured = imported && offline_pack::builder_has_mirror_config(builder).await;
    MirrorStatus { imported, config_exists, containers_running, containers_total, builder_configured }
}

#[tauri::command]
pub async fn check_env(app: AppHandle, state: State<'_, AppState>) -> Result<EnvInfo, String> {
    let (builder, root) = {
        let cfg = state.config.lock().unwrap();
        (cfg.global.builder_name.clone(), effective_root(&app, &cfg.global))
    };
    let mut env = env_checker::probe(&builder).await;
    env.mirror = probe_mirror(&root, &builder).await;
    Ok(env)
}

/// 一键修复离线 mirror：拉起/在线重建本地 registry 容器（被删时按当前项目 Dockerfile 从上游回填
/// mirror 数据，在线机无需"导出再导入"）→ 以 mirror 配置重建 builder（复用导入自举流程）。
/// 已导入过离线包（registries.json 存在）走记录修复；从未导入则从各项目 Dockerfile 的 FROM
/// 引用在线自建 registry 并写回注册表，等效于在线完成一次导入。无外网时才需真正重新导入。
#[tauri::command]
pub async fn repair_offline_mirror(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let (builder, root, dockerfiles) = {
        let cfg = state.config.lock().unwrap();
        let dfs = cfg.projects.iter()
            .flat_map(|p| p.programs.iter())
            .filter(|p| !p.dockerfile.is_empty())
            .map(|p| p.dockerfile.clone())
            .collect::<Vec<_>>();
        (cfg.global.builder_name.clone(), effective_root(&app, &cfg.global), dfs)
    };
    let loaded = offline_pack::load_registries(&root);
    let regs = match &loaded {
        Some(r) => r.clone(),                                   // 已导入：按记录修复
        None => offline_pack::derive_registries(&dockerfiles),  // 未导入：在线自建
    };
    if regs.is_empty() { return Err("mirror_no_dockerfiles".into()); }
    acquire_offline(&state, "busy_repair")?;
    let _guard = OfflineGuard(app.clone());
    let cancel = Arc::new(AtomicBool::new(false));
    *state.queue_cancel.lock().unwrap() = Some(cancel.clone());
    let rid = Local::now().format("repair-%Y%m%d-%H%M%S").to_string();
    offline_pack::repair_registries(&app, &rid, &regs, &dockerfiles, &cancel).await?;
    // 自建路径写回注册表（buildkitd.toml + registries.json），后续按已导入处理
    if loaded.is_none() {
        offline_pack::write_registries(&root, &regs).map_err(|e| format!("写离线 mirror 注册表失败: {e}"))?;
    }
    offline_pack::bootstrap_offline_env(&app, &builder, &rid, &root).await
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
    let mut env = env_checker::ensure_builder(&builder, config.as_deref()).await?;
    env.mirror = probe_mirror(&root, &builder).await;
    Ok(env)
}

#[tauri::command]
pub async fn install_qemu() -> Result<String, String> {
    env_checker::install_qemu().await
}

#[tauri::command]
pub fn start_build(app: AppHandle, state: State<AppState>, req: StartBuildRequest) -> Result<String, String> {
    {
        let mut q = state.queue_cancel.lock().unwrap();
        let b = state.offline_busy.lock().unwrap();
        if let Some(k) = *b { return Err(k.into()); }
        if q.is_some() { return Err("queue_running".into()); }
        *q = Some(Arc::new(AtomicBool::new(false)));
    }
    if let Err(e) = validate_request(&state, &req) {
        *state.queue_cancel.lock().unwrap() = None;
        return Err(e);
    }
    let run_id = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let app2 = app.clone();
    let app3 = app.clone();
    let req2 = req.clone();
    let rid = run_id.clone();
    let rid2 = run_id.clone();
    // 看护 run()：内层 panic 时（队列锁已由 run 内 Drop 守卫释放）合成 queue-done 让前端脱离 running 卡死
    tauri::async_runtime::spawn(async move {
        let inner = tauri::async_runtime::spawn(async move { build_queue::run(app2, req2, rid).await; });
        if inner.await.is_err() {
            use crate::types::{LogEvent, QueueDone};
            let _ = app3.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: "构建队列异常终止（内部错误），已自动解除占用".into(), stream: "stderr".into() });
            let _ = app3.emit("queue-done", QueueDone { kind: "build".into(), success: 0, failed: 0, canceled: 0, skipped: 0, export_files: vec![], log_dir: String::new() });
        }
    });
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
        // 上下文回退链：程序级 → 项目级 → Dockerfile 所在目录（与 docker_exec 保持一致）
        let df_parent = std::path::Path::new(&prog.dockerfile).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let ctx = if !prog.context.trim().is_empty() { prog.context.as_str() }
                  else if !project.context_dir.trim().is_empty() { project.context_dir.as_str() }
                  else { df_parent.as_str() };
        if ctx.trim().is_empty() || !std::path::Path::new(ctx).is_dir() { return Err(format!("context_invalid:{pid}")); }
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_build(state: State<AppState>) {
    if let Some(flag) = state.queue_cancel.lock().unwrap().as_ref() { flag.store(true, std::sync::atomic::Ordering::Relaxed); }
}

#[tauri::command]
pub fn cancel_offline(state: State<AppState>) {
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
    acquire_offline(&state, "busy_export")?; // 与构建队列及另一次导出/导入/修复互斥
    let root = effective_root(&app, &cfg.global);
    let cancel = Arc::new(AtomicBool::new(false));
    *state.queue_cancel.lock().unwrap() = Some(cancel.clone());
    let rid = Local::now().format("offline-%Y%m%d-%H%M%S").to_string();
    let rid2 = rid.clone();
    let app2 = app.clone();
    let did = dest_dir.clone();
    let log_dir = root.join("logs").join(format!("run-{rid}"));
    let _ = std::fs::create_dir_all(&log_dir);
    let log_dir_str = log_dir.to_string_lossy().to_string();
    tauri::async_runtime::spawn(async move {
        let _guard = OfflineGuard(app2.clone());
        use crate::types::{LogEvent, QueueDone};
        match offline_pack::export_pack(&app2, dockerfiles, &did, &rid2, &cancel).await {
            Ok(m) => {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: format!("成功[{scope_label}]: {} 个镜像（含多架构 mirror 数据）→ {}/offline-pack", m.images.len(), did.trim_end_matches('/')), stream: "stdout".into() });
                let _ = app2.emit("queue-done", QueueDone { kind: "export".into(), success: 1, failed: 0, canceled: 0, skipped: 0, export_files: vec![format!("{}/offline-pack", did.trim_end_matches('/'))], log_dir: log_dir_str });
            }
            Err(e) if e == "canceled" => {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: "导出已取消".into(), stream: "stderr".into() });
                let _ = app2.emit("queue-done", QueueDone { kind: "export".into(), success: 0, failed: 0, canceled: 1, skipped: 0, export_files: vec![], log_dir: log_dir_str });
            }
            Err(e) => {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: format!("导出失败: {e}"), stream: "stderr".into() });
                let _ = app2.emit("queue-done", QueueDone { kind: "export".into(), success: 0, failed: 1, canceled: 0, skipped: 0, export_files: vec![], log_dir: log_dir_str });
            }
        }
    });
    Ok(rid)
}

#[tauri::command]
pub async fn import_offline_pack(app: AppHandle, state: State<'_, AppState>, pack_dir: String) -> Result<String, String> {
    acquire_offline(&state, "busy_import")?; // 与构建队列及另一次导出/导入/修复互斥；导入期间禁止改配置（root 已固定）
    let (builder, root) = {
        let cfg = state.config.lock().unwrap();
        (cfg.global.builder_name.clone(), effective_root(&app, &cfg.global))
    };
    let cancel = Arc::new(AtomicBool::new(false));
    *state.queue_cancel.lock().unwrap() = Some(cancel.clone());
    let rid = Local::now().format("import-%Y%m%d-%H%M%S").to_string();
    let rid2 = rid.clone();
    let app2 = app.clone();
    let tp = pack_dir.clone();
    let bn = builder.clone();
    let log_dir = root.join("logs").join(format!("run-{rid}"));
    let _ = std::fs::create_dir_all(&log_dir);
    let log_dir_str = log_dir.to_string_lossy().to_string();
    tauri::async_runtime::spawn(async move {
        let _guard = OfflineGuard(app2.clone());
        use crate::types::{LogEvent, QueueDone};
        if let Err(e) = offline_pack::import_pack(&app2, &tp, &rid2, &root, &cancel).await {
            if e == "canceled" {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: "导入已取消".into(), stream: "stderr".into() });
                let _ = app2.emit("queue-done", QueueDone { kind: "import".into(), success: 0, failed: 0, canceled: 1, skipped: 0, export_files: vec![], log_dir: log_dir_str });
            } else {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: format!("导入失败: {e}"), stream: "stderr".into() });
                let _ = app2.emit("queue-done", QueueDone { kind: "import".into(), success: 0, failed: 1, canceled: 0, skipped: 0, export_files: vec![], log_dir: log_dir_str });
            }
            return;
        }
        match offline_pack::bootstrap_offline_env(&app2, &bn, &rid2, &root).await {
            Ok(msg) => {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: msg, stream: "stdout".into() });
                let _ = app2.emit("queue-done", QueueDone { kind: "import".into(), success: 1, failed: 0, canceled: 0, skipped: 0, export_files: vec![], log_dir: log_dir_str });
            }
            Err(e) => {
                let _ = app2.emit("build-log", LogEvent { task_id: rid2.clone(), project_id: rid2.clone(), line: format!("自举失败: {e}"), stream: "stderr".into() });
                let _ = app2.emit("queue-done", QueueDone { kind: "import".into(), success: 0, failed: 1, canceled: 0, skipped: 0, export_files: vec![], log_dir: log_dir_str });
            }
        }
    });
    Ok(rid)
}