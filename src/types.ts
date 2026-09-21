export interface Outputs {
  exportFile: boolean;
  loadLocal: boolean;
  push: boolean;
}

export interface GlobalSettings {
  language: string;
  registry: string;
  builderName: string;
  tagTemplate: string;
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