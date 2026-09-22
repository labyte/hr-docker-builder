import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import i18n from './i18n';
import { api } from './api';
import type { AppConfig, ConfigCorruptEvent, EnvInfo, LogLine, Outputs, PathIssue, Program, Project, QueueDone, StatusEvent } from './types';

const LOG_CAP = 3000;
const ALL_CAP = 6000;

export const defaultOutputs = (): Outputs => ({ exportFile: true, loadLocal: false, push: false });

const defaultConfig = (): AppConfig => ({
  version: 1,
  global: { language: 'auto', registry: '', builderName: 'hr-builder', exportArchSuffix: true, concurrency: 1, failFast: false, dataDir: '', buildArgPresets: [], nugetPackagesDir: '' },
  projects: [],
});

let listenersReady = false;

export interface BuilderState {
  config: AppConfig;
  issues: PathIssue[];
  env: EnvInfo | null;
  envBusy: boolean;
  selectedProjectId: string | null;

  // 当前选中项目的设置（工具栏绑定）；并发/失败策略以 config.global 为唯一数据源
  arch: string;
  outputs: Outputs;

  running: boolean;
  /** 正在进行的离线任务（导出/导入/修复）：按钮忙碌态与互斥提示用；空闲为 null */
  offlineOp: 'export' | 'import' | 'repair' | null;
  /** 本次构建总任务数（程序数 × 架构数），进度条分母 */
  totalTasks: number;
  statuses: Record<string, Record<string, StatusEvent>>;
  logs: Record<string, LogLine[]>;
  allLogs: LogLine[];
  summary: QueueDone | null;
  lang: string;
  /** 配置文件损坏通知（App 层弹窗消费一次后置空） */
  corruptNotice: ConfigCorruptEvent | null;

  init: () => Promise<void>;
  refreshEnv: () => Promise<void>;
  fixBuilder: () => Promise<void>;
  installQemu: () => Promise<void>;
  repairMirror: () => Promise<string | null>;
  setOfflineOp: (op: 'export' | 'import' | 'repair' | null) => void;
  /** 保存配置：成功返回 null，失败返回后端错误 key（queue_running / busy_* 等），调用方经 errText 提示 */
  persist: (cfg: AppConfig) => Promise<string | null>;
  selectProject: (id: string | null) => void;
  setProgramsEnabled: (projectId: string, enabledIds: string[]) => Promise<string | null>;
  setArch: (a: string) => void;
  setOutputs: (o: Outputs) => void;
  setConcurrency: (n: number) => void;
  setFailFast: (b: boolean) => void;
  upsertProject: (p: Project) => Promise<string | null>;
  removeProject: (id: string) => Promise<string | null>;
  copyProject: (id: string) => Promise<Project | null>;
  upsertProgram: (projectId: string, p: Program) => Promise<string | null>;
  removeProgram: (projectId: string, id: string) => Promise<string | null>;
  saveGlobal: (patch: Partial<AppConfig['global']>) => Promise<string | null>;
  startBuild: () => Promise<string | null>;
  cancelBuild: () => Promise<void>;
  clearLogs: () => void;
  setLang: (l: string) => void;
}

export const useStore = create<BuilderState>((set, get) => ({
  config: defaultConfig(),
  issues: [],
  env: null,
  envBusy: false,
  selectedProjectId: null,
  arch: 'amd64',
  outputs: defaultOutputs(),
  running: false,
  offlineOp: null,
  totalTasks: 0,
  statuses: {},
  logs: {},
  allLogs: [],
  summary: null,
  lang: i18n.language,
  corruptNotice: null,

  init: async () => {
    // 先注册监听再拉配置：get_config 会冲刷 config-corrupt 通知，须先就绪才能收到
    if (!listenersReady) {
      listenersReady = true;
      await listen<LogLine>('build-log', ({ payload }) => {
        set((s) => {
          const prev = s.logs[payload.projectId] ?? [];
          return { logs: { ...s.logs, [payload.projectId]: [...prev, payload].slice(-LOG_CAP) }, allLogs: [...s.allLogs, payload].slice(-ALL_CAP) };
        });
      });
      await listen<StatusEvent>('build-status', ({ payload }) => {
        set((s) => ({ statuses: { ...s.statuses, [payload.programId]: { ...(s.statuses[payload.programId] ?? {}), [payload.arch]: payload } } }));
      });
      await listen<QueueDone>('queue-done', async ({ payload }) => {
        // 导出/导入完成时同步清掉离线任务忙碌标记（修复不走 queue-done，由 repairMirror 自行清理）
        set({ running: false, summary: payload, ...(payload.kind === 'build' ? {} : { offlineOp: null }) });
        // 构建期间后端已把 lastBuild 写盘：重拉配置保持同步，
        // 防止前端旧副本在下次保存时把它回滚覆盖
        try { set({ config: await api.getConfig() }); } catch (e) { console.error(e); }
      });
      await listen<ConfigCorruptEvent>('config-corrupt', ({ payload }) => set({ corruptNotice: payload }));
      i18n.on('languageChanged', (l) => set({ lang: l }));
    }
    try {
      const config = await api.getConfig();
      set({ config,
        selectedProjectId: config.projects[0]?.id ?? null,
        arch: config.projects[0]?.defaultArch ?? 'amd64',
        outputs: config.projects[0]?.outputs ?? defaultOutputs(),
      });
      if (!localStorage.getItem('ui-lang') && config.global.language !== 'auto') {
        void i18n.changeLanguage(config.global.language);
      }
    } catch (e) { console.error(e); }
  },

  refreshEnv: async () => { set({ envBusy: true }); try { set({ env: await api.checkEnv() }); } finally { set({ envBusy: false }); } },
  fixBuilder: async () => { set({ envBusy: true }); try { set({ env: await api.ensureBuilder() }); } finally { set({ envBusy: false }); } },
  installQemu: async () => { set({ envBusy: true }); try { await api.installQemu(); set({ env: await api.checkEnv() }); } finally { set({ envBusy: false }); } },
  // 一键修复离线 mirror：拉起/在线重建 registry 容器 + 按 mirror 配置重建 builder；返回 null 成功 / 错误串
  repairMirror: async () => {
    set({ envBusy: true, offlineOp: 'repair' });
    try { await api.repairOfflineMirror(); set({ env: await api.checkEnv() }); return null; }
    catch (e) { return String(e); }
    finally { set({ envBusy: false, offlineOp: null }); }
  },
  setOfflineOp: (op) => set({ offlineOp: op }),

  persist: async (cfg) => {
    // 保存失败（queue_running / busy_*）不应用到 state：UI 自动回退，返回错误 key 供调用方经 errText 具体提示
    try { set({ config: cfg, issues: await api.saveConfig(cfg) }); return null; }
    catch (e) { return String(e); }
  },

  selectProject: (id) => {
    const proj = get().config.projects.find(p => p.id === id);
    set({ selectedProjectId: id, arch: proj?.defaultArch ?? 'amd64', outputs: proj?.outputs ?? defaultOutputs() });
  },
  // 表格复选框勾选 = 参与构建：批量写回 enabled 并持久化（一次保存）
  setProgramsEnabled: async (projectId, enabledIds) => {
    const s = get(); const prj = s.config.projects.find(p => p.id === projectId); if (!prj) return `project_not_found:${projectId}`;
    const on = new Set(enabledIds);
    if (!prj.programs.some(p => p.enabled !== on.has(p.id))) return null;
    return s.upsertProject({ ...prj, programs: prj.programs.map(p => ({ ...p, enabled: on.has(p.id) })) });
  },
  setArch: (a) => { set({ arch: a }); updateProject(get, a); },
  setOutputs: (o) => { set({ outputs: o }); updateProject(get, undefined, o); },
  setConcurrency: (n) => { void get().saveGlobal({ concurrency: n }); },
  setFailFast: (b) => { void get().saveGlobal({ failFast: b }); },

  upsertProject: async (p) => {
    const s = get(); const exists = s.config.projects.some(x => x.id === p.id);
    const projects = exists ? s.config.projects.map(x => x.id === p.id ? p : x) : [...s.config.projects, p];
    const err = await s.persist({ ...s.config, projects });
    // 项目设置里改了架构/去向：即时同步工具条展示
    if (!err && s.selectedProjectId === p.id) set({ arch: p.defaultArch, outputs: p.outputs });
    return err;
  },
  removeProject: async (id) => {
    const s = get();
    const err = await s.persist({ ...s.config, projects: s.config.projects.filter(x => x.id !== id) });
    if (!err && s.selectedProjectId === id) set({ selectedProjectId: s.config.projects[0]?.id ?? null });
    return err;
  },
  copyProject: async (id) => {
    const s = get(); const src = s.config.projects.find(p => p.id === id); if (!src) return null;
    const clone: Project = { ...src, id: `prj-${Date.now().toString(36)}`, name: `${src.name} (副本)`, createdAt: new Date().toISOString() };
    // 持久化被拒（构建/离线任务运行中）时不返回副本，避免 UI 选中一个未落库的项目
    const err = await s.upsertProject(clone);
    return err ? null : clone;
  },
  upsertProgram: async (projectId, prog) => {
    const s = get(); const prj = s.config.projects.find(p => p.id === projectId); if (!prj) return `project_not_found:${projectId}`;
    const exists = prj.programs.some(x => x.id === prog.id);
    const programs = exists ? prj.programs.map(x => x.id === prog.id ? prog : x) : [...prj.programs, prog];
    return s.upsertProject({ ...prj, programs });
  },
  removeProgram: async (projectId, id) => {
    const s = get(); const prj = s.config.projects.find(p => p.id === projectId); if (!prj) return `project_not_found:${projectId}`;
    return s.upsertProject({ ...prj, programs: prj.programs.filter(x => x.id !== id) });
  },
  saveGlobal: async (patch) => {
    const s = get();
    return s.persist({ ...s.config, global: { ...s.config.global, ...patch } });
  },

  startBuild: async () => {
    const s = get();
    if (!s.selectedProjectId) return 'no_project';
    if (!s.outputs.exportFile && !s.outputs.loadLocal && !s.outputs.push) return 'no_outputs';
    const arches = s.arch === 'both' ? ['amd64', 'arm64'] : [s.arch];
    const prj = s.config.projects.find(p => p.id === s.selectedProjectId);
    // 复选框勾选即参与构建
    const programIds = (prj?.programs ?? []).filter(p => p.enabled).map(p => p.id);
    if (!programIds.length) return 'no_projects';
    try {
      await api.startBuild({ programIds, projectId: s.selectedProjectId!, arches, outputs: s.outputs, concurrency: s.config.global.concurrency, failFast: s.config.global.failFast, exportDir: prj?.exportDir ?? '' });
      set({ running: true, summary: null, statuses: {}, totalTasks: programIds.length * arches.length });
      return null;
    } catch (e) { return String(e); }
  },

  cancelBuild: () => api.cancelBuild(),
  clearLogs: () => set({ logs: {}, allLogs: [], summary: null }),
  setLang: (l) => { localStorage.setItem('ui-lang', l); void i18n.changeLanguage(l); get().saveGlobal({ language: l }); },
}));

function updateProject(get: () => BuilderState, arch?: string, outputs?: Outputs) {
  const s = get(); if (!s.selectedProjectId) return;
  const proj = s.config.projects.find(p => p.id === s.selectedProjectId); if (!proj) return;
  const update: Partial<Project> = {};
  if (arch !== undefined) update.defaultArch = arch;
  if (outputs !== undefined) update.outputs = outputs;
  const p2 = { ...proj, ...update };
  void s.upsertProject(p2);
}