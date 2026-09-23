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
    /// 镜像名是否追加架构标识：镜像引用为 {镜像名}[-{架构}]:{版本}；
    /// 导出文件名同为 {镜像名}[-{架构}]-{版本}.tar（旧字段名 exportArchSuffix 经 alias 自动迁移）
    #[serde(alias = "exportArchSuffix")]
    pub image_arch_suffix: bool,
    pub concurrency: usize,
    pub fail_fast: bool,
    /// 数据目录（projects/logs/exports/offline）；留空使用系统默认应用数据目录
    pub data_dir: String,
    /// 构建参数预设（每行一条 KEY=VALUE），全项目可用，程序表单中点选
    pub build_arg_presets: Vec<String>,
    /// 离线 NuGet 包目录（全局）；空则回退程序级旧字段（兼容历史配置）
    pub nuget_packages_dir: String,
}
impl Default for GlobalSettings {
    fn default() -> Self {
        Self {
            language: "auto".into(),
            registry: String::new(),
            builder_name: "hr-builder".into(),
            image_arch_suffix: true,
            concurrency: 1,
            fail_fast: false,
            data_dir: String::new(),
            build_arg_presets: vec![],
            nuget_packages_dir: String::new(),
        }
    }
}

// ── 项目（一组程序的打包清单） ──
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub id: String,
    pub name: String,
    /// 创建时间（ISO 字符串；旧配置缺省为空，不显示）
    pub created_at: String,
    /// 默认目标架构
    pub default_arch: String,
    pub outputs: Outputs,
    /// 该项目专属的镜像导出目录（为空则继承全局设置）
    pub export_dir: String,
    /// 项目级构建上下文目录：程序未单独设置 context 时跟随此处
    pub context_dir: String,
    pub programs: Vec<Program>,
}
impl Default for Project {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            created_at: String::new(),
            default_arch: "amd64".into(),
            outputs: Outputs::default(),
            export_dir: String::new(),
            context_dir: String::new(),
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
            default_version: "latest".into(),
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
    /// 宿主架构；与 arch 相同时走 default builder（FROM 优先解析本机镜像）
    pub host_arch: String,
    /// 全局离线 NuGet 目录（空则回退 program 级旧字段）
    pub nuget_packages_dir: String,
    /// 项目级构建上下文（program.context 为空时使用）
    pub project_context_dir: String,
    pub registry: String,
    pub builder_name: String,
    pub image_arch_suffix: bool,
    pub outputs: Outputs,
    pub export_dir: String,
    pub log_dir: PathBuf,
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
    /// 操作类型：build（构建队列）/ export（离线包导出）/ import（离线包导入），前端汇总文案据此切换
    pub kind: String,
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
    /// 宿主架构 amd64/arm64：同架构构建走 default builder（本机镜像优先）
    pub host_arch: String,
    /// 离线 mirror 细分状态（环境信息面板逐项展示 + 一键修复入口）
    pub mirror: MirrorStatus,
}

// ── 离线 mirror 细分状态 ──
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MirrorStatus {
    /// 存在导入记录（registries.json / buildkitd.toml 任一）；false = 从未导入离线包
    pub imported: bool,
    /// buildkitd.toml 存在
    pub config_exists: bool,
    /// 运行中的 hr-offline-reg-* 容器数
    pub containers_running: usize,
    /// 导入记录中的容器总数
    pub containers_total: usize,
    /// builder 的 buildkit 容器已挂载 mirror 配置
    pub builder_configured: bool,
}

// ── 配置损坏通知（load 时记录，get_config 冲刷为 config-corrupt 事件给前端弹窗）──
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConfigCorruptEvent {
    pub path: String,
    pub backup: String,
    pub error: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PathIssue {
    pub program_id: String,
    pub field: String,
    pub message: String,
}