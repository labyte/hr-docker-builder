import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { App, Button, Checkbox, Divider, Dropdown, Segmented, Space, Tooltip } from 'antd';
import {
  BranchesOutlined, CloudDownloadOutlined, CloudUploadOutlined, ExportOutlined,
  FolderOpenOutlined, GlobalOutlined, SettingOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import { errText } from '../utils';
import { api } from '../api';
import type { Outputs } from '../types';

const OUTPUT_KEYS: (keyof Outputs)[] = ['exportFile', 'loadLocal', 'push'];

interface Props { onOpenSettings: () => void; onOpenAbout: () => void }

function Group(props: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return <div className="tb-group"><span className="tb-group-label">{props.icon}{props.label}</span>{props.children}</div>;
}

export default function Toolbar({ onOpenSettings, onOpenAbout }: Props) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const selectedId = useStore((s) => s.selectedProjectId);
  const selectedProject = useStore((s) => s.config.projects.find(p => p.id === s.selectedProjectId));
  const arch = useStore((s) => s.arch);
  const setArch = useStore((s) => s.setArch);
  const outputs = useStore((s) => s.outputs);
  const setOutputs = useStore((s) => s.setOutputs);
  const running = useStore((s) => s.running);
  const startBuild = useStore((s) => s.startBuild);
  const cancelBuild = useStore((s) => s.cancelBuild);
  const setLang = useStore((s) => s.setLang);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const disabled = running || !selectedId;

  const checkedOutputs = OUTPUT_KEYS.filter(k => outputs[k]).map(k => String(k));

  const handleExport = async () => {
    const dir = await openDialog({ directory: true });
    if (!dir || typeof dir !== 'string') return;
    setOfflineBusy(true);
    try { await api.exportOfflinePack(dir); } catch (e) { message.error(errText(e)); }
    setOfflineBusy(false);
  };
  const handleImport = async () => {
    const dir = await openDialog({ directory: true });
    if (!dir || typeof dir !== 'string') return;
    setOfflineBusy(true);
    try { await api.importOfflinePack(dir); } catch (e) { message.error(errText(e)); }
    setOfflineBusy(false);
  };

  return (
    <div className="toolbar">
      <Group icon={<BranchesOutlined />} label={t('toolbar.arch')}>
        <Segmented
          size="small"
          value={arch}
          onChange={v => setArch(String(v))}
          disabled={disabled}
          options={[
            { label: t('toolbar.amd64'), value: 'amd64' },
            { label: t('toolbar.arm64'), value: 'arm64' },
            { label: t('toolbar.both'), value: 'both' },
          ]}
        />
      </Group>

      <Group icon={<ExportOutlined />} label={t('toolbar.outputs')}>
        <Checkbox.Group
          value={checkedOutputs}
          disabled={disabled}
          onChange={v => {
            const next = { exportFile: false, loadLocal: false, push: false };
            for (const key of v as string[]) { if (key in next) next[key as keyof Outputs] = true; }
            setOutputs(next);
          }}
          options={OUTPUT_KEYS.map(k => ({ label: t(`toolbar.${k}`), value: k }))}
        />
      </Group>

      <Space className="toolbar-actions">
        {!running ? (
          <Button type="primary" icon={<ThunderboltOutlined />} disabled={!selectedId} onClick={async () => { const err = await startBuild(); if (err) message.error(errText(err)); }}>{t('toolbar.build')}</Button>
        ) : (
          <Button danger onClick={async () => { await cancelBuild(); }}>{t('toolbar.cancel')}</Button>
        )}
        <Divider type="vertical" />
        <Tooltip title={t('toolbar.exportPack')}><Button icon={<CloudDownloadOutlined />} loading={offlineBusy} onClick={handleExport} /></Tooltip>
        <Tooltip title={t('toolbar.importPack')}><Button icon={<CloudUploadOutlined />} loading={offlineBusy} onClick={handleImport} /></Tooltip>
        {selectedProject?.exportDir && (
          <Tooltip title={selectedProject.exportDir}>
            <Button icon={<FolderOpenOutlined />} onClick={() => void api.revealPath(selectedProject.exportDir)} />
          </Tooltip>
        )}
        <Divider type="vertical" />
        <Dropdown menu={{ items: [{ key: 'settings', label: t('toolbar.settings') }, { key: 'about', label: t('toolbar.about') }], onClick: ({ key }) => (key === 'settings' ? onOpenSettings() : onOpenAbout()) }}>
          <Tooltip title={t('toolbar.settings')}><Button icon={<SettingOutlined />} /></Tooltip>
        </Dropdown>
        <Dropdown menu={{ selectedKeys: [i18n.language], items: [{ key: 'zh-CN', label: '中文' }, { key: 'en', label: 'English' }], onClick: ({ key }) => setLang(String(key)) }}>
          <Tooltip title={t('toolbar.language')}><Button icon={<GlobalOutlined />} /></Tooltip>
        </Dropdown>
      </Space>
    </div>
  );
}