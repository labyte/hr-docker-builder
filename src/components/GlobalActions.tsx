import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Dropdown, Modal, Radio, Space, Tooltip, Typography } from 'antd';
import { DownloadOutlined, UploadOutlined, GlobalOutlined, SettingOutlined, LoadingOutlined } from '@ant-design/icons';

// 立体感图标按钮：白底 + 描边 + 轻投影；图标统一黑白 + drop-shadow 微浮雕
const btnStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e0e2e8',
  boxShadow: '0 1.5px 4px rgba(20,30,60,.14), inset 0 -1px 0 rgba(20,30,60,.04)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const lift: React.CSSProperties = {
  color: '#262626', fontSize: 13, filter: 'drop-shadow(0 1px 0.4px rgba(0,0,0,.30))',
};
// 离线包分组框：组名 + 导出/导入文字按钮——含义一目了然，详细说明放在悬浮提示
const groupStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: '#fff', border: '1px solid #e0e2e8', borderRadius: 8, padding: '2px 8px',
  boxShadow: '0 1.5px 4px rgba(20,30,60,.14), inset 0 -1px 0 rgba(20,30,60,.04)',
};
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
  // 离线任务忙碌标记由 store 统一维护（queue-done / repairMirror 清理），跨组件互斥提示同源
  const offlineOp = useStore((s) => s.offlineOp);
  const setOfflineOp = useStore((s) => s.setOfflineOp);
  const cancelOffline = useStore((s) => s.cancelOffline);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scope, setScope] = useState<'all' | 'current'>('all');

  // 已有离线任务在跑：点击其他离线操作时即时提示具体是哪个任务
  const busyWarn = (): boolean => {
    if (offlineOp) { message.warning(t(`errors.busy_${offlineOp}`)); return true; }
    return false;
  };

  const confirmExport = async () => {
    setScopeOpen(false);
    const dir = await openDialog({ directory: true });
    if (!dir || typeof dir !== 'string') { setScope('all'); return; }
    setOfflineOp('export');
    // invoke 成功仅代表任务已提交（后台执行），忙碌标记保持到 queue-done；被拒（互斥/校验）则立即复位
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
      <Space size={16}>
        <div style={groupStyle}>
          <span style={{ color: '#8c8c8c', fontSize: 12, flexShrink: 0 }}>{t('toolbar.packGroup')}</span>
          <Tooltip title={offlineOp === 'export' ? undefined : t('toolbar.packExportTip')}>
            <Button size="small"
              icon={offlineOp === 'export' ? <LoadingOutlined /> : <UploadOutlined />}
              danger={offlineOp === 'export'}
              onClick={offlineOp === 'export' ? () => void cancelOffline() : () => { if (busyWarn()) return; setScopeOpen(true); }}>
              {offlineOp === 'export' ? t('toolbar.cancelPack') : t('toolbar.packExport')}
            </Button>
          </Tooltip>
          <Tooltip title={offlineOp === 'import' ? undefined : t('toolbar.packImportTip')}>
            <Button size="small"
              icon={offlineOp === 'import' ? <LoadingOutlined /> : <DownloadOutlined />}
              danger={offlineOp === 'import'}
              onClick={offlineOp === 'import' ? () => void cancelOffline() : () => void handleImport()}>
              {offlineOp === 'import' ? t('toolbar.cancelPack') : t('toolbar.packImport')}
            </Button>
          </Tooltip>
        </div>
        {/* 下拉触发按钮不挂 Tooltip，避免悬浮提示遮挡菜单 */}
        <Dropdown menu={{ items: [{ key: 'settings', label: t('toolbar.settings') }, { key: 'about', label: t('toolbar.about') }], onClick: ({ key }) => (key === 'settings' ? onOpenSettings() : onOpenAbout()) }}>
          <Button shape="circle" size="small" style={btnStyle} icon={<span style={lift}><SettingOutlined /></span>} />
        </Dropdown>
        <Dropdown menu={{ selectedKeys: [i18n.language], items: [{ key: 'zh-CN', label: '中文' }, { key: 'en', label: 'English' }], onClick: ({ key }) => setLang(String(key)) }}>
          <Button shape="circle" size="small" style={btnStyle} icon={<span style={lift}><GlobalOutlined /></span>} />
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
