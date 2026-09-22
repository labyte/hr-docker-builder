import { useTranslation } from 'react-i18next';
import { App, Button, Popover, Space } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, ReloadOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import { errText } from '../utils';
import GlobalActions from './GlobalActions';
import EnvInfoPanel from './EnvInfo';
import QuickSettings from './QuickSettings';
import type { EnvInfo } from '../types';

interface Props { onOpenSettings: () => void; onOpenAbout: () => void }

// 环境信息弹层：点击展示已安装工具 / 提供的能力 / 支持平台——状态栏只保留状态与提示，窗口变窄不再换行
function EnvInfoButton({ env }: { env: EnvInfo | null }) {
  const { t } = useTranslation();
  return (
    <Popover trigger="click" title={t('env.info')} content={<EnvInfoPanel env={env} width={360} />}>
      <Button size="small" type="link">{t('env.info')}</Button>
    </Popover>
  );
}

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

  const missingArch = !env.builderPlatforms.some(p => p.includes('arm64')) || !env.builderPlatforms.some(p => p.includes('amd64'));
  if (missingArch) {
    actions.push(
      <Button key="qemu" size="small" type="link" loading={envBusy} onClick={async () => {
        try { await installQemu(); message.success(t('env.qemuOk')); } catch (e) { message.error(errText(e)); }
      }}>{t('env.installQemu')}</Button>
    );
  }
  // 环境信息按钮排在引导动作之后，保持安装引导突出
  actions.push(<EnvInfoButton key="env" env={env} />);

  return <CompactBar color="success" icon={<CheckCircleFilled />} label="Docker ✓" actions={actions} right={right} />;
}

function CompactBar({ color, icon, label, actions, right }: { color: string; icon: React.ReactNode; label: string; actions?: React.ReactNode[]; right?: React.ReactNode }) {
  const bg = color === 'success' ? '#f6ffed' : color === 'warning' ? '#fffbe6' : '#fff2f0';
  const bd = color === 'success' ? '#b7eb8f' : color === 'warning' ? '#ffe58f' : '#ffa39e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 38, fontSize: 12, padding: '4px 12px', background: '#f7f8fa', borderBottom: '1px solid #e5e6eb' }}>
      {/* Docker 状态区：圆角边框盒子，宽度随内容自适应，不再拉通整行 */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '3px 4px 3px 10px', background: bg, border: `1px solid ${bd}`, borderRadius: 8, minWidth: 0 }}>
        <span style={{ color: color === 'success' ? '#52c41a' : color === 'warning' ? '#faad14' : '#ff4d4f', flexShrink: 0 }}>{icon}</span>
        <span style={{ minWidth: 0 }}>{label}</span>
        {actions && actions.length > 0 && <Space size={4}>{actions}</Space>}
        <Button size="small" type="text" icon={<ReloadOutlined />} loading={false} onClick={() => void useStore.getState().refreshEnv()} />
      </div>
      {/* 快捷构建设置：并发数/失败策略（高频项，与设置弹窗双向同步）——靠右与全局功能区相邻 */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <QuickSettings />
      </div>
      {/* 全局功能区：固定在栏右端 */}
      {right && <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{right}</div>}
    </div>
  );
}