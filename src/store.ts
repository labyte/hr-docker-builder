import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import i18n from './i18n';
import { api } from './api';
import type { AppConfig, EnvInfo, LogLine, Outputs, PathIssue, Program, Project, QueueDone, StatusEvent } from './types';

const LOG_CAP = 3000;
const ALL_CAP = 6000;

export const defaultOutputs = (): Outputs => ({ exportFile: true, loadLocal: false, push: false });

const defaultConfig = (): AppConfig => ({
  version: 1,
  global: { language: 'auto', registry: '', builderName: 'hr-builder', tagTemplate: '{version}-{arch}-{time}', concurrency: 1, failFast: false },
  projects: [],
});

let listenersReady = false;
let dirtyPersist = false;

export interface BuilderState {
  config: AppConfig;
  issues: PathIssue[];
  env: EnvInfo | null;
  envBusy: boolean;
  selectedProjectId: string | null;
  selectedIds: string[];

  // 当前选中项目的设置（工具栏绑定）
  arch: string;
  outputs: Outputs;
  concurrency: number;
  failFast: boolean;

  running: boolean;
  statuses: Record<string, Record<string, StatusEvent>>;
  logs: Record<string, LogLine[]>;
  allLogs: LogLine[];
  summary: QueueDone | null;
  lang: string;

  init: () => Promise<void>;
  refreshEnv: () => Promise<void>;
  fixBuilder: () => Promise<void>;
  installQemu: () => Promise<void>;
  persist: (cfg: AppConfig) => Promise<boolean>;
  selectProject: (id: string | null) => void;
  setSelected: (ids: string[]) => void;
  setArch: (a: string) => void;
  setOutputs: (o: Outputs) => void;
  setConcurrency: (n: number) => void;
  setFailFast: (b: boolean) => void;
  upsertProject: (p: Project) => Promise<boolean>;
  removeProject: (id: string) => Promise<boolean>;
  copyProject: (id: string) => Promise<Project | null>;
  upsertProgram: (projectId: string, p: Program) => Promise<boolean>;
  removeProgram: (projectId: string, id: string) => Promise<boolean>;
  saveGlobal: (patch: Partial<AppConfig['global']>) => Promise<boolean>;
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
  selectedIds: [],
  arch: 'amd64',
  outputs: defaultOutputs(),
  concurrency: 1,
  failFast: false,
  running: false,
  statuses: {},
  logs: {},
  allLogs: [],
  summary: null,
  lang: i18n.language,

  init: async () => {
    try {
      const config = await api.getConfig();
      set({ config,
        selectedProjectId: config.projects[0]?.id ?? null,
        arch: config.projects[0]?.defaultArch ?? 'amd64',
        outputs: config.projects[0]?.outputs ?? defaultOutputs(),
        concurrency: config.global.concurrency,
        failFast: config.global.failFast,
      });
      if (!localStorage.getItem('ui-lang') && config.global.language !== 'auto') {
        void i18n.changeLanguage(config.global.language);
      }
    } catch (e) { console.error(e); }
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
      await listen<QueueDone>('queue-done', ({ payload }) => {
        set({ running: false, summary: payload });
        if (dirtyPersist) { dirtyPersist = false; void get().persist(get().config); }
      });
      i18n.on('languageChanged', (l) => set({ lang: l }));
    }
  },

  refreshEnv: async () => { set({ envBusy: true }); try { set({ env: await api.checkEnv() }); } finally { set({ envBusy: false }); } },
  fixBuilder: async () => { set({ envBusy: true }); try { set({ env: await api.ensureBuilder() }); } finally { set({ envBusy: false }); } },
  installQemu: async () => { set({ envBusy: true }); try { await api.installQemu(); set({ env: await api.checkEnv() }); } finally { set({ envBusy: false }); } },

  persist: async (cfg) => {
    try { set({ config: cfg, issues: await api.saveConfig(cfg) }); return true; }
    catch (e) { if (String(e).startsWith('queue_running')) dirtyPersist = true; return false; }
  },

  selectProject: (id) => {
    const proj = get().config.projects.find(p => p.id === id);
    set({ selectedProjectId: id, arch: proj?.defaultArch ?? 'amd64', outputs: proj?.outputs ?? defaultOutputs() });
  },
  setSelected: (ids) => set({ selectedIds: ids }),
  setArch: (a) => { set({ arch: a }); updateProject(get, a); },
  setOutputs: (o) => { set({ outputs: o }); updateProject(get, undefined, o); },
  setConcurrency: (n) => { set({ concurrency: n }); get().saveGlobal({ concurrency: n }); },
  setFailFast: (b) => { set({ failFast: b }); get().saveGlobal({ failFast: b }); },

  upsertProject: async (p) => {
    const s = get(); const exists = s.config.projects.some(x => x.id === p.id);
    const projects = exists ? s.config.projects.map(x => x.id === p.id ? p : x) : [...s.config.projects, p];
    return s.persist({ ...s.config, projects });
  },
  removeProject: async (id) => {
    const s = get();
    const ok = await s.persist({ ...s.config, projects: s.config.projects.filter(x => x.id !== id) });
    if (ok && s.selectedProjectId === id) set({ selectedProjectId: s.config.projects[0]?.id ?? null });
    return ok;
  },
  copyProject: async (id) => {
    const s = get(); const src = s.config.projects.find(p => p.id === id); if (!src) return null;
    const clone: Project = { ...src, id: `prj-${Date.now().toString(36)}`, name: `${src.name} (副本)` };
    await s.upsertProject(clone); return clone;
  },
  upsertProgram: async (projectId, prog) => {
    const s = get(); const prj = s.config.projects.find(p => p.id === projectId); if (!prj) return false;
    const exists = prj.programs.some(x => x.id === prog.id);
    const programs = exists ? prj.programs.map(x => x.id === prog.id ? prog : x) : [...prj.programs, prog];
    return s.upsertProject({ ...prj, programs });
  },
  removeProgram: async (projectId, id) => {
    const s = get(); const prj = s.config.projects.find(p => p.id === projectId); if (!prj) return false;
    return s.upsertProject({ ...prj, programs: prj.programs.filter(x => x.id !== id) });
  },
  saveGlobal: async (patch) => {
    const s = get();
    return s.persist({ ...s.config, global: { ...s.config.global, ...patch } });
  },

  startBuild: async () => {
    const s = get();
    if (!s.selectedProjectId) return 'no_project';
    if (!s.selectedIds.length) return 'no_programs';
    if (!s.outputs.exportFile && !s.outputs.loadLocal && !s.outputs.push) return 'no_outputs';
    const arches = s.arch === 'both' ? ['amd64', 'arm64'] : [s.arch];
    const prj = s.config.projects.find(p => p.id === s.selectedProjectId);
    try {
      await api.startBuild({ programIds: s.selectedIds, projectId: s.selectedProjectId!, arches, outputs: s.outputs, concurrency: s.concurrency, failFast: s.failFast, exportDir: prj?.exportDir ?? '' });
      set({ running: true, summary: null, statuses: {} });
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