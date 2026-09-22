import { invoke } from '@tauri-apps/api/core';
import type { AppConfig, EnvInfo, PathIssue, StartBuildRequest } from './types';

export const api = {
  getConfig: () => invoke<AppConfig>('get_config'),
  saveConfig: (config: AppConfig) => invoke<PathIssue[]>('save_config', { config }),
  checkEnv: () => invoke<EnvInfo>('check_env'),
  ensureBuilder: () => invoke<EnvInfo>('ensure_builder'),
  installQemu: () => invoke<string>('install_qemu'),
  startBuild: (req: StartBuildRequest) => invoke<string>('start_build', { req }),
  cancelBuild: () => invoke<void>('cancel_build'),
  revealPath: (path: string) => invoke<void>('reveal_path', { path }),
  getExportDir: (exportDir: string) => invoke<string>('get_export_dir', { exportDir }),
  exportOfflinePack: (destDir: string, projectId?: string | null) => invoke<string>('export_offline_pack', { destDir, projectId: projectId ?? null }),
  importOfflinePack: (packDir: string) => invoke<string>('import_offline_pack', { packDir }),
  repairOfflineMirror: () => invoke<string>('repair_offline_mirror'),
};
