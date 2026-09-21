use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::types::{AppConfig, GlobalSettings, PathIssue};

/// 数据根目录：settings.data_dir 非空则用之，否则系统默认应用数据目录。
/// 所有持久化产物（projects.json / logs / exports / offline）统一挂在该根下。
pub fn effective_root(app: &AppHandle, settings: &GlobalSettings) -> PathBuf {
    let custom = settings.data_dir.trim();
    if !custom.is_empty() {
        return PathBuf::from(custom);
    }
    app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir())
}

fn default_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("projects.json"))
}

fn read_at(p: &Path) -> Result<Option<AppConfig>, String> {
    if !p.exists() { return Ok(None); }
    let raw = fs::read_to_string(p).map_err(|e| e.to_string())?;
    Ok(Some(serde_json::from_str(&raw).unwrap_or_default()))
}

fn save_at(p: &Path, cfg: &AppConfig) -> Result<(), String> {
    if let Some(dir) = p.parent() { let _ = fs::create_dir_all(dir); }
    let tmp = p.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    fs::rename(&tmp, p).map_err(|e| e.to_string())?;
    Ok(())
}

/// 加载：系统默认位置保底引导（记录 dataDir 指向）；
/// 自定义目录已有 projects.json 时以自定义为准，否则把当前配置迁移过去。
pub fn load(app: &AppHandle) -> Result<AppConfig, String> {
    let mut cfg = read_at(&default_config_path(app)?)?.unwrap_or_default();
    let custom = cfg.global.data_dir.trim().to_string();
    if !custom.is_empty() {
        let p = PathBuf::from(&custom).join("projects.json");
        match read_at(&p)? {
            Some(c) => cfg = c,
            None => { let _ = save_at(&p, &cfg); }
        }
    }
    Ok(cfg)
}

/// 保存：默认位置保留引导副本（含 dataDir 指针），dataDir 设置时同步写自定义目录（权威数据位）。
pub fn save(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    save_at(&default_config_path(app)?, cfg)?;
    let custom = cfg.global.data_dir.trim();
    if !custom.is_empty() {
        save_at(&PathBuf::from(custom).join("projects.json"), cfg)?;
    }
    Ok(())
}

pub fn validate(cfg: &AppConfig) -> Vec<PathIssue> {
    let mut issues = Vec::new();
    for prj in &cfg.projects {
        for prog in &prj.programs {
            if !prog.dockerfile.is_empty() && !std::path::Path::new(&prog.dockerfile).is_file() {
                issues.push(PathIssue { program_id: prog.id.clone(), field: "dockerfile".into(), message: "notFound".into() });
            }
            if !prog.context.is_empty() && !std::path::Path::new(&prog.context).is_dir() {
                issues.push(PathIssue { program_id: prog.id.clone(), field: "context".into(), message: "notFound".into() });
            }
            if !prog.project_file.is_empty() && !std::path::Path::new(&prog.project_file).is_file() {
                issues.push(PathIssue { program_id: prog.id.clone(), field: "projectFile".into(), message: "notFound".into() });
            }
        }
    }
    issues
}
