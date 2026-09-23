import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Dropdown, Modal, Radio, Space, Typography } from 'antd';
import { GlobalOutlined, InboxOutlined, SettingOutlined } from '@ant-design/icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import { errText } from '../utils';
import { api } from '../api';

interface Props { onOpenSettings: () => void; onOpenAbout: () => void }

export default function GlobalActions({ onOpenSettings, onOpenAbout }: Props) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const selectedId = useStore((s) => s.selectedProjectId);
  const selectedProject = useStore((s) => s.config.projects.find(p => p.id === s.selectedProjectId));
  const setLang = useStore((s) => s.setLang);
  const offlineOp = useStore((s) => s.offlineOp);
  const setOfflineOp = useStore((s) => s.setOfflineOp);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scope, setScope] = useState<'all' | 'current'>('all');

  const busyWarn = (): boolean => {
    if (offlineOp) { message.warning(t(`errors.busy_${offlineOp}`)); return true; }
    return false;
  };

  const confirmExport = async () => {
    setScopeOpen(false);
    const dir = await openDialog({ directory: true });
    if (!dir || typeof dir !== 'string') { setScope('all'); return; }
    setOfflineOp('export');
    try { await api.exportOfflinePack(dir, scope === 'current' ? selectedId : null); }
    catch (e) { setOfflineOp(null); message.error(errText(e)); }
    setScope('all');
  };
  const handleImport = async () => {
    if (busyWarn()) return;
    const dir = await openDialog({ directory: true });
    if (!dir || typeof dir !== 'string') return;
    setOfflineOp('import');
    try { await api.importOfflinePack(dir); }
    catch (e) { setOfflineOp(null); message.error(errText(e)); }
  };

  return (
    <>
      <Space size={8}>
        <Dropdown menu={{ items: [
          { key: 'export', label: t('toolbar.packExport'), disabled: !!offlineOp },
          { key: 'import', label: t('toolbar.packImport'), disabled: !!offlineOp },
        ], onClick: ({ key }) => { if (key === 'export') { if (busyWarn()) return; setScopeOpen(true); } else { void handleImport(); } } }}>
          <Button type="text" size="small" icon={<InboxOutlined />} style={{ gap: 2 }}>{t('toolbar.packGroup')}</Button>
        </Dropdown>
        <Dropdown menu={{ items: [{ key: 'settings', label: t('toolbar.settings') }, { key: 'about', label: t('toolbar.about') }], onClick: ({ key }) => (key === 'settings' ? onOpenSettings() : onOpenAbout()) }}>
          <Button type="text" size="small" icon={<SettingOutlined />} />
        </Dropdown>
        <Dropdown menu={{ selectedKeys: [i18n.language], items: [{ key: 'zh-CN', label: '中文' }, { key: 'en', label: 'English' }], onClick: ({ key }) => setLang(String(key)) }}>
          <Button type="text" size="small" icon={<GlobalOutlined />} />
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
