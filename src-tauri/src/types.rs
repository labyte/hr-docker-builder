use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

// ── 产物去向：多选组合 ──
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Outputs {
    pub export_file: bool,
    pub load_local: bool,
    pub push: bool,
}
impl Default for Outputs {
    fn default() -> Self {
        Self { export_file: true, load_local: false, push: false }
    }
}

// ── 全局设置（跨项目共享） ──
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct GlobalSettings {
    pub language: String,
    pub registry: String,
    pub builder_name: String,
    pub tag_template: String,
    pub concurrency: usize,
    pub fail_fast: bool,
}
impl Default for GlobalSettings {
    fn default() -> Self {
        Self {
            language: "auto".into(),
            registry: String::new(),
            builder_name: "hr-builder".into(),
            tag_template: "{version}-{arch}-{time}".into(),
            concurrency: 1,
            fail_fast: false,
        }
    }
}

// ── 项目（一组程序的打包清单） ──
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub id: String,
    pub name: String,
    /// 默认目标架构
    pub default_arch: String,
    pub outputs: Outputs,
    /// 该项目专属的镜像导出目录（为空则继承全局设置）
    pub export_dir: String,
    pub programs: Vec<Program>,
}
impl Default for Project {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            default_arch: "amd64".into(),
            outputs: Outputs::default(),
            export_dir: String::new(),
            programs: vec![],
        }
    }
}

// ── 程序（单个 Docker 构建目标） ──
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Program {
    pub id: String,
    pub name: String,
    pub project_file: String,
    pub dockerfile: String,
    pub context: String,
    pub image: String,
    pub default_version: String,
    pub build_args: HashMap<String, String>,
    pub enabled: bool,
    pub nuget_packages_dir: String,
    pub last_build: Option<LastBuild>,
}
impl Default for Program {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            project_file: String::new(),
            dockerfile: String::new(),
            context: String::new(),
            image: String::new(),
            default_version: "0.1.0".into(),
            build_args: HashMap::new(),
            enabled: true,
            nuget_packages_dir: String::new(),
            last_build: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LastBuild {
    pub time: String,
    pub tag: String,
    pub arch: String,
    pub ok: bool,
}

// ── 根配置 ──
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub version: u32,
    pub global: GlobalSettings,
    pub projects: Vec<Project>,
}
impl Default for AppConfig {
    fn default() -> Self {
        Self { version: 1, global: GlobalSettings::default(), projects: vec![] }
    }
}

// ── 构建请求（前端 → 后端） ──
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StartBuildRequest {
    pub program_ids: Vec<String>,
    pub project_id: String,
    pub arches: Vec<String>,
    pub outputs: Outputs,
    pub concurrency: usize,
    pub fail_fast: bool,
    pub export_dir: String,
}

// ── 构建任务（内部） ──
#[derive(Clone, Debug)]
pub struct BuildTask {
    pub task_id: String,
    pub program: Program,
    pub arch: String,
    pub registry: String,
    pub builder_name: String,
    pub tag_template: String,
    pub outputs: Outputs,
    pub export_dir: String,
    pub log_dir: PathBuf,
    pub ts: String,
}

// ── 事件负载 ──
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    pub task_id: String,
    pub project_id: String,
    pub line: String,
    pub stream: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvent {
    pub program_id: String,
    pub arch: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub export_file: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QueueDone {
    pub success: usize,
    pub failed: usize,
    pub canceled: usize,
    pub skipped: usize,
    pub export_files: Vec<String>,
    pub log_dir: String,
}

// ── 环境检测 ──
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvInfo {
    pub docker_ok: bool,
    pub buildx_ok: bool,
    pub daemon_ok: bool,
    pub builder_ok: bool,
    pub builder_platforms: Vec<String>,
    pub docker_version: String,
    pub buildx_version: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PathIssue {
    pub program_id: String,
    pub field: String,
    pub message: String,
}