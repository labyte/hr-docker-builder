use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::types::{AppConfig, PathIssue};

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("projects.json"))
}

pub fn load(app: &AppHandle) -> Result<AppConfig, String> {
    let p = config_path(app)?;
    if !p.exists() { return Ok(AppConfig::default()); }
    let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

pub fn save(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let p = config_path(app)?;
    let tmp = p.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
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