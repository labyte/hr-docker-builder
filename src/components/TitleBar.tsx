import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Popover, Space } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, ReloadOutlined, MinusOutlined, BorderOutlined, CopyOutlined, CloseOutlined, LoadingOutlined, StopOutlined } from '@ant-design/icons';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useStore } from '../store';
import { errText } from '../utils';
import GlobalActions from './GlobalActions';
import EnvInfoPanel from './EnvInfo';
import type { EnvInfo } from '../types';

interface Props { onOpenSettings: () => void; onOpenAbout: () => void }

function EnvInfoButton({ env }: { env: EnvInfo | null }) {
  const { t } = useTranslation();
  return (
    <Popover trigger="click" title={t('env.info')} content={<EnvInfoPanel env={env} width={360} />}>
      <Button size="small" type="link">{t('env.info')}</Button>
    </Popover>
  );
}

function WindowControls() {
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(async () => {
      const m = await win.isMaximized().catch(() => false);
      setMaximized(m);
    });
    return () => { unlisten.then(fn => fn()); };
  }, [win]);

  return (
    <div className="titlebar-controls">
      <button className="titlebar-btn" onClick={() => win.minimize()} title="最小化">
        <MinusOutlined style={{ fontSize: 10 }} />
      </button>
      <button className="titlebar-btn" onClick={() => { void win.toggleMaximize(); }} title={maximized ? '还原' : '最大化'}>
        {maximized ? <CopyOutlined style={{ fontSize: 9 }} /> : <BorderOutlined style={{ fontSize: 9 }} />}
      </button>
      <button className="titlebar-btn titlebar-btn-close" onClick={() => win.close()} title="关闭">
        <CloseOutlined style={{ fontSize: 10 }} />
      </button>
    </div>
  );
}

function TaskIndicator() {
  const { t } = useTranslation();
  const running = useStore((s) => s.running);
  const offlineOp = useStore((s) => s.offlineOp);
  const cancelBuild = useStore((s) => s.cancelBuild);
  const cancelOffline = useStore((s) => s.cancelOffline);

  let label: string | null = null;
  let onCancel: (() => void) | null = null;

  if (running) {
    label = t('toolbar.taskBuilding');
    onCancel = () => void cancelBuild();
  } else if (offlineOp === 'export') {
    label = t('toolbar.taskExporting');
    onCancel = () => void cancelOffline();
  } else if (offlineOp === 'import') {
    label = t('toolbar.taskImporting');
    onCancel = () => void cancelOffline();
  } else if (offlineOp === 'repair') {
    label = t('toolbar.taskRepairing');
    onCancel = () => void cancelOffline();
  }

  if (!label) return null;

  return (
    <div className="titlebar-task">
      <LoadingOutlined style={{ fontSize: 12 }} />
      <span>{label}</span>
      <Button type="text" size="small" icon={<StopOutlined style={{ fontSize: 11 }} />} onClick={onCancel ?? undefined} className="titlebar-task-cancel" />
    </div>
  );
}

export default function TitleBar({ onOpenSettings, onOpenAbout }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const env = useStore((s) => s.env);
  const envBusy = useStore((s) => s.envBusy);
  const fixBuilder = useStore((s) => s.fixBuilder);
  const installQemu = useStore((s) => s.installQemu);

  const renderEnvStatus = () => {
    if (!env) {
      return <EnvPill color="warning" icon={<ExclamationCircleFilled />} label={t('env.checking')} refresh />;
    }
    if (!env.dockerOk) {
      return <EnvPill color="error" icon={<CloseCircleFilled />} label={t('env.dockerMissing')} refresh />;
    }
    if (!env.buildxOk) {
      return <EnvPill color="error" icon={<CloseCircleFilled />} label={t('env.buildxMissing')} refresh />;
    }
    if (!env.daemonOk) {
      return <EnvPill color="warning" icon={<ExclamationCircleFilled />} label={t('env.daemonMissing')} refresh />;
    }
    if (!env.builderOk) {
      return (
        <EnvPill color="warning" icon={<ExclamationCircleFilled />} label={t('env.builderMissing', { builder: '' })} refresh
          actions={<Button size="small" type="link" loading={envBusy} onClick={async () => {
            try { await fixBuilder(); message.success(t('env.fixOk')); } catch (e) { message.error(errText(e)); }
          }}>{t('env.fix')}</Button>}
        />
      );
    }
    const missingArch = !env.builderPlatforms.some(p => p.includes('arm64')) || !env.builderPlatforms.some(p => p.includes('amd64'));
    const actions = [];
    if (missingArch) {
      actions.push(
        <Button key="qemu" size="small" type="link" loading={envBusy} onClick={async () => {
          try { await installQemu(); message.success(t('env.qemuOk')); } catch (e) { message.error(errText(e)); }
        }}>{t('env.installQemu')}</Button>
      );
    }
    actions.push(<EnvInfoButton key="env" env={env} />);
    return (
      <EnvPill color="success" icon={<CheckCircleFilled />} label="Docker ✓" refresh
        actions={<Space size={4}>{actions}</Space>}
      />
    );
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="titlebar-title" data-tauri-drag-region>HR Docker Builder</span>
        {renderEnvStatus()}
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        <TaskIndicator />
      </div>
      <div className="titlebar-right">
        <GlobalActions onOpenSettings={onOpenSettings} onOpenAbout={onOpenAbout} />
        <WindowControls />
      </div>
    </div>
  );
}

function EnvPill({ color, icon, label, actions, refresh }: { color: string; icon: React.ReactNode; label: string; actions?: React.ReactNode; refresh?: boolean }) {
  const ic = color === 'success' ? '#52c41a' : color === 'warning' ? '#faad14' : '#ff4d4f';
  const bd = color === 'success' ? '#b7eb8f' : color === 'warning' ? '#ffe58f' : '#ffa39e';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 4px 2px 4px', borderBottom: `2px solid ${bd}`, fontSize: 12, minWidth: 0 }}>
      <span style={{ color: ic, flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0, whiteSpace: 'nowrap' }}>{label}</span>
      {actions}
      {refresh && <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => void useStore.getState().refreshEnv()} style={{ padding: '0 4px' }} />}
    </div>
  );
}
