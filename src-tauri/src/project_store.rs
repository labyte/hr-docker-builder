use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::commands::AppState;
use crate::types::{AppConfig, ConfigCorruptEvent, GlobalSettings, PathIssue};

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

fn read_at(app: &AppHandle, p: &Path) -> Result<Option<AppConfig>, String> {
    if !p.exists() { return Ok(None); }
    let raw = fs::read_to_string(p).map_err(|e| e.to_string())?;
    match serde_json::from_str::<AppConfig>(&raw) {
        Ok(cfg) => Ok(Some(cfg)),
        Err(e) => {
            // 损坏保护：绝不静默用空配置顶替——原文件先带时间戳备份，
            // 通知暂存 AppState，待前端 get_config 时以 config-corrupt 事件弹出
            let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "projects.json".into());
            let backup = p.with_file_name(format!("{name}.corrupt-{ts}"));
            if fs::rename(p, &backup).is_err() { let _ = fs::write(&backup, &raw); }
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut v) = state.corrupt_notices.lock() {
                    v.push(ConfigCorruptEvent {
                        path: p.to_string_lossy().to_string(),
                        backup: backup.to_string_lossy().to_string(),
                        error: e.to_string(),
                    });
                }
            }
            Ok(None)
        }
    }
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
    let mut cfg = read_at(app, &default_config_path(app)?)?.unwrap_or_default();
    let custom = cfg.global.data_dir.trim().to_string();
    if !custom.is_empty() {
        let p = PathBuf::from(&custom).join("projects.json");
        match read_at(app, &p)? {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Program, Project};

    fn cfg_with_program(prog: Program) -> AppConfig {
        AppConfig {
            projects: vec![Project {
                id: "p1".into(),
                programs: vec![prog],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn validate_empty_config_no_issues() {
        let cfg = AppConfig::default();
        assert!(validate(&cfg).is_empty());
    }

    #[test]
    fn validate_empty_fields_no_issues() {
        let prog = Program::default();
        let cfg = cfg_with_program(prog);
        assert!(validate(&cfg).is_empty());
    }

    #[test]
    fn validate_nonexistent_dockerfile() {
        let prog = Program { dockerfile: "/nonexistent/Dockerfile".into(), ..Default::default() };
        let issues = validate(&cfg_with_program(prog));
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].field, "dockerfile");
    }

    #[test]
    fn validate_nonexistent_context() {
        let prog = Program { context: "/nonexistent/dir".into(), ..Default::default() };
        let issues = validate(&cfg_with_program(prog));
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].field, "context");
    }

    #[test]
    fn validate_nonexistent_project_file() {
        let prog = Program { project_file: "/nonexistent/app.csproj".into(), ..Default::default() };
        let issues = validate(&cfg_with_program(prog));
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].field, "projectFile");
    }

    #[test]
    fn validate_multiple_issues() {
        let prog = Program {
            dockerfile: "/no/Dockerfile".into(),
            context: "/no/dir".into(),
            project_file: "/no/app.csproj".into(),
            ..Default::default()
        };
        let issues = validate(&cfg_with_program(prog));
        assert_eq!(issues.len(), 3);
    }

    #[test]
    fn validate_existing_dir_no_context_issue() {
        let dir = std::env::temp_dir();
        let prog = Program { context: dir.to_string_lossy().to_string(), ..Default::default() };
        let issues = validate(&cfg_with_program(prog));
        assert!(issues.iter().all(|i| i.field != "context"));
    }
}
