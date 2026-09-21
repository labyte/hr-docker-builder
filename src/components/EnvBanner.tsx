import { useTranslation } from 'react-i18next';
import { App, Button, Space } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, ReloadOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import { errText } from '../utils';
import GlobalActions from './GlobalActions';

interface Props { onOpenSettings: () => void; onOpenAbout: () => void }

export default function EnvBanner({ onOpenSettings, onOpenAbout }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const env = useStore((s) => s.env);
  const envBusy = useStore((s) => s.envBusy);
  const fixBuilder = useStore((s) => s.fixBuilder);
  const installQemu = useStore((s) => s.installQemu);

  // 全局功能区固定在栏右端（设置/语言/离线包），环境未就绪时也可用
  const right = <GlobalActions onOpenSettings={onOpenSettings} onOpenAbout={onOpenAbout} />;

  if (!env) {
    return <CompactBar color="warning" icon={<ExclamationCircleFilled />} label={t('env.checking')} right={right} />;
  }

  const actions = [];

  if (!env.dockerOk) {
    return <CompactBar color="error" icon={<CloseCircleFilled />} label={t('env.dockerMissing')} right={right} />;
  }
  if (!env.buildxOk) {
    return <CompactBar color="error" icon={<CloseCircleFilled />} label={t('env.buildxMissing')} right={right} />;
  }
  if (!env.daemonOk) {
    return <CompactBar color="warning" icon={<ExclamationCircleFilled />} label={t('env.daemonMissing')} right={right} />;
  }
  if (!env.builderOk) {
    actions.push(
      <Button key="fix" size="small" type="link" loading={envBusy} onClick={async () => {
        try { await fixBuilder(); message.success(t('env.fixOk')); } catch (e) { message.error(errText(e)); }
      }}>{t('env.fix')}</Button>
    );
    return <CompactBar color="warning" icon={<ExclamationCircleFilled />} label={t('env.builderMissing', { builder: '' })} actions={actions} right={right} />;
  }

  const plat = env.builderPlatforms.join(', ');
  const missingArch = !env.builderPlatforms.some(p => p.includes('arm64')) || !env.builderPlatforms.some(p => p.includes('amd64'));
  if (missingArch) {
    actions.push(
      <Button key="qemu" size="small" type="link" loading={envBusy} onClick={async () => {
        try { await installQemu(); message.success(t('env.qemuOk')); } catch (e) { message.error(errText(e)); }
      }}>{t('env.installQemu')}</Button>
    );
  }

  return <CompactBar color="success" icon={<CheckCircleFilled />} label={`Docker ✓ ${plat ? `Plat: ${plat}` : ''}`} actions={actions} right={right} />;
}

function CompactBar({ color, icon, label, actions, right }: { color: string; icon: React.ReactNode; label: string; actions?: React.ReactNode[]; right?: React.ReactNode }) {
  const bg = color === 'success' ? '#f6ffed' : color === 'warning' ? '#fffbe6' : '#fff2f0';
  const bd = color === 'success' ? '#b7eb8f' : color === 'warning' ? '#ffe58f' : '#ffa39e';
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 38, fontSize: 12 }}>
      {/* 状态段：背景色只作用于 Docker 状态本身 */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: bg, borderBottom: `1px solid ${bd}` }}>
        <span style={{ color: color === 'success' ? '#52c41a' : color === 'warning' ? '#faad14' : '#ff4d4f' }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {actions && actions.length > 0 && <Space size={4}>{actions}</Space>}
        <Button size="small" type="text" icon={<ReloadOutlined />} loading={false} onClick={() => void useStore.getState().refreshEnv()} />
      </div>
      {/* 全局功能区：独立中性底，与状态解耦 */}
      {right && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '6px 16px', background: '#f7f8fa', borderLeft: '1px solid #ececf1', borderBottom: '1px solid #e5e6eb' }}>
          {right}
        </div>
      )}
    </div>
  );
}