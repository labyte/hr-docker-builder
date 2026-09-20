import { useTranslation } from 'react-i18next';
import { App, Button, Space } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, ReloadOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import { errText } from '../utils';

export default function EnvBanner() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const env = useStore((s) => s.env);
  const envBusy = useStore((s) => s.envBusy);
  const fixBuilder = useStore((s) => s.fixBuilder);
  const installQemu = useStore((s) => s.installQemu);

  if (!env) return null;

  const actions = [];

  if (!env.dockerOk) {
    return <CompactBar color="error" icon={<CloseCircleFilled />} label={t('env.dockerMissing')} />;
  }
  if (!env.buildxOk) {
    return <CompactBar color="error" icon={<CloseCircleFilled />} label={t('env.buildxMissing')} />;
  }
  if (!env.daemonOk) {
    return <CompactBar color="warning" icon={<ExclamationCircleFilled />} label={t('env.daemonMissing')} />;
  }
  if (!env.builderOk) {
    actions.push(
      <Button key="fix" size="small" type="link" loading={envBusy} onClick={async () => {
        try { await fixBuilder(); message.success(t('env.fixOk')); } catch (e) { message.error(errText(e)); }
      }}>{t('env.fix')}</Button>
    );
    return <CompactBar color="warning" icon={<ExclamationCircleFilled />} label={t('env.builderMissing', { builder: '' })} actions={actions} />;
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

  return <CompactBar color="success" icon={<CheckCircleFilled />} label={`Docker ✓ ${plat ? `Plat: ${plat}` : ''}`} actions={actions} />;
}

function CompactBar({ color, icon, label, actions }: { color: string; icon: React.ReactNode; label: string; actions?: React.ReactNode[] }) {
  return (
    <div style={{ display:'flex', alignItems:'center', padding:'2px 12px', background: color==='success'?'#f6ffed':color==='warning'?'#fffbe6':'#fff2f0', borderBottom:`1px solid ${color==='success'?'#b7eb8f':color==='warning'?'#ffe58f':'#ffa39e'}`, fontSize:12, gap:8, minHeight:28 }}>
      <span style={{ color: color==='success'?'#52c41a':color==='warning'?'#faad14':'#ff4d4f' }}>{icon}</span>
      <span style={{ flex:1 }}>{label}</span>
      {actions && <Space size={4}>{actions}</Space>}
      <Button size="small" type="text" icon={<ReloadOutlined />} loading={false} onClick={() => void useStore.getState().refreshEnv()} />
    </div>
  );
}