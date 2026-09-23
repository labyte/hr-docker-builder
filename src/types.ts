export interface Outputs {
  exportFile: boolean;
  loadLocal: boolean;
  push: boolean;
}

export interface GlobalSettings {
  language: string;
  registry: string;
  builderName: string;
  /** 镜像名是否追加架构标识：镜像引用 {镜像名}[-{架构}]:{版本}，导出文件 {镜像名}[-{架构}]-{版本}.tar */
  imageArchSuffix: boolean;
  concurrency: number;
  failFast: boolean;
  /** 数据目录（projects/logs/exports），留空为系统默认 */
  dataDir: string;
  /** 构建参数预设 KEY=VALUE，全项目可用 */
  buildArgPresets: string[];
  /** 离线 NuGet 包目录（全局） */
  nugetPackagesDir: string;
}

export interface Project {
  id: string;
  name: string;
  /** 创建时间 ISO 字符串；旧数据可为空 */
  createdAt: string;
  defaultArch: string;
  outputs: Outputs;
  exportDir: string;
  /** 项目级构建上下文：程序未设置 context 时跟随此处 */
  contextDir: string;
  programs: Program[];
}

export interface Program {
  id: string;
  name: string;
  projectFile: string;
  dockerfile: string;
  context: string;
  image: string;
  defaultVersion: string;
  buildArgs: Record<string, string>;
  enabled: boolean;
  nugetPackagesDir: string;
  lastBuild: LastBuild | null;
}

export interface LastBuild {
  time: string;
  tag: string;
  arch: string;
  ok: boolean;
}

export interface AppConfig {
  version: number;
  global: GlobalSettings;
  projects: Project[];
}

export interface EnvInfo {
  dockerOk: boolean;
  buildxOk: boolean;
  daemonOk: boolean;
  builderOk: boolean;
  builderPlatforms: string[];
  dockerVersion: string;
  buildxVersion: string;
  /** 宿主架构（amd64/arm64，后端已归一化）：同架构走 default builder 本机镜像优先 */
  hostArch: string;
  /** 离线 mirror 细分状态（环境信息面板逐项展示 + 一键修复入口） */
  mirror: MirrorStatus;
}

export interface MirrorStatus {
  /** 存在导入记录；false = 从未导入离线包（在线环境可忽略） */
  imported: boolean;
  /** buildkitd.toml 存在 */
  configExists: boolean;
  /** 运行中的本地 registry 容器数 */
  containersRunning: number;
  /** 导入记录中的容器总数 */
  containersTotal: number;
  /** builder 已挂载 mirror 配置 */
  builderConfigured: boolean;
}

export interface StartBuildRequest {
  programIds: string[];
  projectId: string;
  arches: string[];
  outputs: Outputs;
  concurrency: number;
  failFast: boolean;
  exportDir: string;
}

export interface LogLine {
  taskId: string;
  projectId: string;
  line: string;
  stream: string;
}

export interface StatusEvent {
  programId: string;
  arch: string;
  status: string;
  message?: string | null;
  tag?: string | null;
  exportFile?: string | null;
}

export interface QueueDone {
  /** 操作类型：build 构建队列 / export 离线包导出 / import 离线包导入，汇总胶囊文案据此切换 */
  kind: 'build' | 'export' | 'import';
  success: number;
  failed: number;
  canceled: number;
  skipped: number;
  exportFiles: string[];
  logDir: string;
}

export interface PathIssue {
  programId: string;
  field: string;
  message: string;
}

/** 配置文件损坏通知：后端已把原文件备份，前端弹窗提示手动恢复 */
export interface ConfigCorruptEvent {
  path: string;
  backup: string;
  error: string;
}