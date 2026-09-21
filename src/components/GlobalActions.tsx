import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Dropdown, Modal, Radio, Space, Tooltip, Typography } from 'antd';
import { CloudDownloadOutlined, CloudUploadOutlined, GlobalOutlined, SettingOutlined } from '@ant-design/icons';

// 立体感图标按钮：白底 + 描边 + 轻投影；图标纯色 + drop-shadow 微浮雕
const btnStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e0e2e8',
  boxShadow: '0 1.5px 4px rgba(20,30,60,.14), inset 0 -1px 0 rgba(20,30,60,.04)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const lift = (color: string): React.CSSProperties => ({
  color, fontSize: 13, filter: 'drop-shadow(0 1px 0.4px rgba(0,0,0,.30))',
});
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import { errText } from '../utils';
import { api } from '../api';

interface Props { onOpenSettings: () => void; onOpenAbout: () => void }

// 全局功能区：离线包导出/导入、设置、语言——挂在 Docker 环境栏右端（与构建操作区分离）
export default function GlobalActions({ onOpenSettings, onOpenAbout }: Props) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const selectedId = useStore((s) => s.selectedProjectId);
  const selectedProject = useStore((s) => s.config.projects.find(p => p.id === s.selectedProjectId));
  const setLang = useStore((s) => s.setLang);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scope, setScope] = useState<'all' | 'current'>('all');

  const confirmExport = async () => {
    setScopeOpen(false);
    const dir = await openDialog({ directory: true });
    if (!dir || typeof dir !== 'string') { setScope('all'); return; }
    setOfflineBusy(true);
    try { await api.exportOfflinePack(dir, scope === 'current' ? selectedId : null); } catch (e) { message.error(errText(e)); }
    setOfflineBusy(false);
    setScope('all');
  };
  const handleImport = async () => {
    const dir = await openDialog({ directory: true });
    if (!dir || typeof dir !== 'string') return;
    setOfflineBusy(true);
    try { await api.importOfflinePack(dir); } catch (e) { message.error(errText(e)); }
    setOfflineBusy(false);
  };

  return (
    <>
      <Space size={12}>
        <Tooltip title={t('toolbar.exportPack')}>
          <Button shape="circle" size="small" style={btnStyle}
            icon={<span style={lift('#1677ff')}><CloudUploadOutlined /></span>} loading={offlineBusy} onClick={() => setScopeOpen(true)} />
        </Tooltip>
        <Tooltip title={t('toolbar.importPack')}>
          <Button shape="circle" size="small" style={btnStyle}
            icon={<span style={lift('#52c41a')}><CloudDownloadOutlined /></span>} loading={offlineBusy} onClick={() => void handleImport()} />
        </Tooltip>
        {/* 下拉触发按钮不挂 Tooltip，避免悬浮提示遮挡菜单 */}
        <Dropdown menu={{ items: [{ key: 'settings', label: t('toolbar.settings') }, { key: 'about', label: t('toolbar.about') }], onClick: ({ key }) => (key === 'settings' ? onOpenSettings() : onOpenAbout()) }}>
          <Button shape="circle" size="small" style={btnStyle} icon={<span style={lift('#722ed1')}><SettingOutlined /></span>} />
        </Dropdown>
        <Dropdown menu={{ selectedKeys: [i18n.language], items: [{ key: 'zh-CN', label: '中文' }, { key: 'en', label: 'English' }], onClick: ({ key }) => setLang(String(key)) }}>
          <Button shape="circle" size="small" style={btnStyle} icon={<span style={lift('#fa8c16')}><GlobalOutlined /></span>} />
        </Dropdown>
      </Space>

      <Modal
        open={scopeOpen}
        title={t('export.scopeTitle')}
        okText={t('common.ok')}
        cancelText={t('common.cancel')}
        onOk={() => void confirmExport()}
        onCancel={() => { setScopeOpen(false); setScope('all'); }}
        width={400}
        destroyOnClose
      >
        <Radio.Group value={scope} onChange={e => setScope(e.target.value)}>
          <Space direction="vertical" size={8}>
            <Radio value="all">{t('export.scopeAll')}</Radio>
            <Radio value="current" disabled={!selectedId}>
              {t('export.scopeCurrent')}{selectedProject ? `：${selectedProject.name}` : ''}
            </Radio>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('export.scopeHint')}</Typography.Text>
          </Space>
        </Radio.Group>
      </Modal>
    </>
  );
}
