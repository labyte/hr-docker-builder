import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Col, Form, Input, InputNumber, Menu, Modal, Row, Space, Switch, Typography } from 'antd';
import {
  CloudFilled, DatabaseFilled, HddFilled, InfoCircleFilled, ReloadOutlined, SettingFilled, TagsFilled, ThunderboltFilled,
  FolderOpenFilled,
} from '@ant-design/icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import { errText } from '../utils';
import EnvInfoPanel, { deriveCaps } from './EnvInfo';

interface Props { open: boolean; onClose: () => void }

type Section = 'build' | 'registry' | 'naming' | 'data' | 'nuget' | 'env';

// Docker Desktop 风格：左侧分区菜单，右侧对应表单，各分区独立保存互不影响
export default function SettingsModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [active, setActive] = useState<Section>('build');
  const [buildForm] = Form.useForm();
  const [registryForm] = Form.useForm();
  const [namingForm] = Form.useForm();
  const [dataForm] = Form.useForm();
  const [nugetForm] = Form.useForm();
  const global = useStore((s) => s.config.global);
  const saveGlobal = useStore((s) => s.saveGlobal);
  const env = useStore((s) => s.env);
  const envBusy = useStore((s) => s.envBusy);
  const refreshEnv = useStore((s) => s.refreshEnv);
  const installQemu = useStore((s) => s.installQemu);

  useEffect(() => {
    if (!open) return;
    setActive('build');
    buildForm.setFieldsValue({ concurrency: global.concurrency, failFast: global.failFast, buildArgPresets: (global.buildArgPresets ?? []).join('\n') });
    registryForm.setFieldsValue({ registry: global.registry });
    namingForm.setFieldsValue({ builderName: global.builderName, exportArchSuffix: global.exportArchSuffix });
    dataForm.setFieldsValue({ dataDir: global.dataDir });
    nugetForm.setFieldsValue({ nugetPackagesDir: global.nugetPackagesDir });
  }, [open, global, buildForm, registryForm, namingForm, dataForm, nugetForm]);

  const saveSection = async (form: ReturnType<typeof Form.useForm>[0], patch: (v: any) => object) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let v: any;
    try { v = await form.validateFields(); } catch { return; }
    const ok = await saveGlobal(patch(v));
    if (ok) message.success(t('settings.blockSaved'));
    else message.warning(t('errors.saveBlocked'));
  };

  const SaveBtn = ({ onClick, primary = false }: { onClick: () => void; primary?: boolean }) => (
    <Button type={primary ? 'primary' : 'default'} onClick={onClick}>{t('settings.saveSection')}</Button>
  );

  const menu = {
    key: 'menu',
    style: { width: 168, flex: '0 0 168px' },
    items: [
      { key: 'build', icon: <ThunderboltFilled />, label: t('settings.menuBuild') },
      { key: 'registry', icon: <CloudFilled />, label: t('settings.menuRegistry') },
      { key: 'naming', icon: <TagsFilled />, label: t('settings.menuNaming') },
      { key: 'data', icon: <DatabaseFilled />, label: t('settings.menuData') },
      { key: 'nuget', icon: <HddFilled />, label: t('settings.menuNuget') },
      { key: 'env', icon: <InfoCircleFilled />, label: t('settings.menuEnv') },
    ],
    onClick: ({ key }: { key: string }) => setActive(key as Section),
  };

  const sectionTitle = (text: string, desc?: string) => (
    <div style={{ marginBottom: 18 }}>
      <Typography.Title level={5} style={{ margin: 0 }}>{text}</Typography.Title>
      {desc && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{desc}</Typography.Text>}
    </div>
  );

  return (
    <Modal open={open} title={<Space_ />} onCancel={onClose} footer={null} width={720} destroyOnClose>
      <div style={{ display: 'flex', minHeight: 340 }}>
        <Menu {...menu} selectedKeys={[active]} mode="inline" />
        <div style={{ flex: 1, padding: '0 8px 0 24px', minWidth: 0 }}>

          {active === 'build' && (
            <Form form={buildForm} layout="vertical">
              {sectionTitle(t('settings.menuBuild'), t('settings.buildDesc'))}
              {/* 并发数与失败策略同行展示，节省纵向空间 */}
              <Row gutter={24}>
                <Col span={12}>
                  <Form.Item name="concurrency" label={t('settings.concurrency')} layout="horizontal">
                    <InputNumber min={1} max={8} style={{ width: 96 }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="failFast" label={t('settings.failFast')} layout="horizontal" valuePropName="checked">
                    <Switch checkedChildren={t('toolbar.failFast')} unCheckedChildren={t('toolbar.failFastKeep')} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="buildArgPresets" label={t('settings.buildPresets')} extra={t('settings.buildPresetsHint')}>
                <Input.TextArea rows={3} placeholder={'CONFIGURATION=Release\nNUGET_RESTORE=/ci/nuget'} style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </Form.Item>
              <SaveBtn primary onClick={() => void saveSection(buildForm, (v) => ({ concurrency: Number(v.concurrency ?? 1), failFast: !!v.failFast, buildArgPresets: String(v.buildArgPresets ?? '').split('\n').map((l: string) => l.trim()).filter(Boolean) }))} />
            </Form>
          )}

          {active === 'registry' && (
            <Form form={registryForm} layout="vertical">
              {sectionTitle(t('settings.menuRegistry'), t('settings.registryDesc'))}
              <Form.Item name="registry" label={t('settings.registry')}>
                <Input placeholder="harbor.example.com/hr" />
              </Form.Item>
              <SaveBtn primary onClick={() => void saveSection(registryForm, (v) => ({ registry: (v.registry ?? '').trim() }))} />
            </Form>
          )}

          {active === 'naming' && (
            <Form form={namingForm} layout="vertical">
              {sectionTitle(t('settings.menuNaming'), t('settings.namingDesc'))}
              <Form.Item name="builderName" label={t('settings.builderName')} extra={t('settings.builderNameDesc')}>
                <Input placeholder="hr-builder" />
              </Form.Item>
              <Form.Item name="exportArchSuffix" label={t('settings.exportArchSuffix')} valuePropName="checked" extra={t('settings.exportArchSuffixHint')}>
                <Switch />
              </Form.Item>
              <SaveBtn primary onClick={() => void saveSection(namingForm, (v) => ({ builderName: v.builderName.trim() || 'hr-builder', exportArchSuffix: !!v.exportArchSuffix }))} />
            </Form>
          )}

          {active === 'data' && (
            <Form form={dataForm} layout="vertical">
              {sectionTitle(t('settings.menuData'), t('settings.dataDirHint'))}
              <Form.Item name="dataDir" label={t('settings.dataDir')}>
                <Input
                  placeholder={t('settings.dataDirPlaceholder')}
                  allowClear
                  addonAfter={
                    <FolderOpenFilled
                      style={{ cursor: 'pointer' }}
                      onClick={async () => {
                        const dir = await openDialog({ directory: true });
                        if (dir && typeof dir === 'string') dataForm.setFieldsValue({ dataDir: dir });
                      }}
                    />
                  }
                />
              </Form.Item>
              <SaveBtn primary onClick={() => void saveSection(dataForm, (v) => ({ dataDir: (v.dataDir ?? '').trim() }))} />
            </Form>
          )}

          {active === 'nuget' && (
            <Form form={nugetForm} layout="vertical">
              {sectionTitle(t('settings.menuNuget'), t('settings.nugetDirHint'))}
              <Form.Item name="nugetPackagesDir" label={t('settings.nugetDir')}>
                <Input
                  placeholder="/data/nuget-packages"
                  allowClear
                  addonAfter={
                    <FolderOpenFilled
                      style={{ cursor: 'pointer' }}
                      onClick={async () => {
                        const dir = await openDialog({ directory: true });
                        if (dir && typeof dir === 'string') nugetForm.setFieldsValue({ nugetPackagesDir: dir });
                      }}
                    />
                  }
                />
              </Form.Item>
              <SaveBtn primary onClick={() => void saveSection(nugetForm, (v) => ({ nugetPackagesDir: (v.nugetPackagesDir ?? '').trim() }))} />
            </Form>
          )}

          {active === 'env' && (
            <div>
              {sectionTitle(t('settings.menuEnv'), t('settings.envDesc'))}
              {/* 与顶栏「环境信息」弹层同源：已安装工具 / 提供的能力 / 支持平台 */}
              <EnvInfoPanel env={env} />
              <Space style={{ marginTop: 14 }}>
                <Button icon={<ReloadOutlined />} loading={envBusy} onClick={() => void refreshEnv()}>{t('toolbar.refreshEnv')}</Button>
                {env && !deriveCaps(env).qemu && (
                  <Button type="primary" ghost loading={envBusy} onClick={async () => {
                    try { await installQemu(); message.success(t('env.qemuOk')); } catch (e) { message.error(errText(e)); }
                  }}>{t('env.installQemu')}</Button>
                )}
              </Space>
            </div>
          )}

        </div>
      </div>
    </Modal>
  );
}

// 标题栏占位（保持标题行高与其他弹窗一致）
function Space_() {
  const { t } = useTranslation();
  return <span><SettingFilled style={{ marginRight: 8 }} />{t('settings.title')}</span>;
}
