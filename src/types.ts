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
}

export interface Project {
  id: string;
  name: string;
  defaultArch: string;
  outputs: Outputs;
  exportDir: string;
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