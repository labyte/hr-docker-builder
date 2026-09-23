import { useTranslation } from 'react-i18next';
import { App, Button, Space, Spin, Tag, Typography } from 'antd';
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { useStore } from '../store';
import { errText } from '../utils';
import type { EnvInfo } from '../types';

export interface EnvCaps {
  hostArch: string;
  /** 跨架构目标：amd64↔arm64 的另一侧；宿主未知时为 amd64/arm64 */
  crossArch: string;
  canAmd64: boolean;
  canArm64: boolean;
  /** 跨架构仿真（QEMU/binfmt）是否可用 */
  qemu: boolean;
}

export function deriveCaps(env: EnvInfo): EnvCaps {
  const plats = env.builderPlatforms ?? [];
  const hostArch = env.hostArch || '';
  const canAmd64 = plats.some(p => p.includes('amd64'));
  const canArm64 = plats.some(p => p.includes('arm64'));
  const crossArch = hostArch === 'amd64' ? 'arm64' : hostArch === 'arm64' ? 'amd64' : 'amd64/arm64';
  const qemu = hostArch === 'amd64' ? canArm64 : hostArch === 'arm64' ? canAmd64 : (canAmd64 && canArm64);
  return { hostArch, crossArch, canAmd64, canArm64, qemu };
}

// 单行 ✓/✗ 条目：名称 + 详情说明
function Row({ ok, name, detail }: { ok: boolean; name: string; detail?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12 }}>
      {ok ? <CheckCircleFilled style={{ color: '#52c41a', fontSize: 12 }} /> : <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 12 }} />}
      <span style={{ fontWeight: 500, flexShrink: 0 }}>{name}</span>
      {detail && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{detail}</Typography.Text>}
    </div>
  );
}

const SectionLabel = ({ text }: { text: string }) => (
  <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.4px' }}>{text}</Typography.Text>
);

/** 环境信息面板：已安装工具 / 提供的能力 / 支持平台——顶栏弹层与全局设置「Docker 环境」分区共用 */
export default function EnvInfoPanel({ env, width }: { env: EnvInfo | null; width?: number }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const builderName = useStore(s => s.config.global.builderName);
  const envBusy = useStore(s => s.envBusy);
  const repairMirror = useStore(s => s.repairMirror);
  if (!env) {
    return (
      <div style={{ width, fontSize: 12 }}>
        <Spin size="small" /> <Typography.Text type="secondary">{t('env.checking')}</Typography.Text>
      </div>
    );
  }
  const caps = deriveCaps(env);
  const mirror = env.mirror;
  const mirrorReady = mirror.configExists && mirror.containersRunning > 0
    && mirror.containersRunning >= mirror.containersTotal && mirror.builderConfigured;
  return (
    <div style={{ width, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <SectionLabel text={t('env.tools')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <Row ok={env.dockerOk && env.daemonOk} name="Docker Engine" detail={env.dockerVersion || undefined} />
          <Row ok={env.buildxOk} name="Buildx" detail={env.buildxVersion || undefined} />
          <Row ok={caps.qemu} name="QEMU / binfmt" detail={caps.qemu ? t('env.qemuInstalled') : t('env.qemuMissing')} />
          <Row ok={env.builderOk} name={t('env.toolBuilder', { name: builderName })} detail={env.builderOk ? t('env.builderReady') : t('env.builderNotReady')} />
        </div>
      </div>
      {/* 离线 mirror 细分：配置文件 / registry 容器 / builder 挂载——未就绪且导入过时提供一键修复 */}
      <div>
        <SectionLabel text={t('env.mirror')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {!mirror.imported ? (
            <Row ok={false} name={t('env.mirrorNotImported')} />
          ) : (
            <>
              <Row ok={mirror.configExists} name={t('env.mirrorConfig')} />
              <Row ok={mirror.containersRunning > 0 && mirror.containersRunning >= mirror.containersTotal}
                name={t('env.mirrorContainers')} detail={`${mirror.containersRunning}/${mirror.containersTotal} ${t('env.mirrorRunning')}`} />
              <Row ok={mirror.builderConfigured} name={t('env.mirrorBuilder')} />
            </>
          )}
        </div>
        {!mirrorReady && (
          <Button size="small" type="link" style={{ paddingLeft: 0, marginTop: 2 }} loading={envBusy}
            onClick={async () => {
              const err = await repairMirror();
              if (err) message.error(errText(err)); else message.success(t('env.mirrorRepairOk'));
            }}>
            {t('env.mirrorRepair')}
          </Button>
        )}
      </div>
      <div>
        <SectionLabel text={t('env.capabilities')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <Row ok={env.daemonOk && !!caps.hostArch} name={t('env.capNative')} detail={caps.hostArch ? `linux/${caps.hostArch} · ${t('env.nativeHint')}` : undefined} />
          <Row ok={caps.qemu} name={t('env.capCross')} detail={caps.qemu ? `linux/${caps.crossArch} · QEMU` : t('env.crossUnsupported')} />
        </div>
      </div>
      <div>
        <SectionLabel text={`${t('env.platforms')} (${env.builderPlatforms.length})`} />
        <div style={{ marginTop: 4 }}>
          <Space size={4} wrap>
            {env.builderPlatforms.map(p => <Tag key={p} style={{ marginInlineEnd: 0, fontSize: 11 }}>{p}</Tag>)}
          </Space>
        </div>
      </div>
    </div>
  );
}
