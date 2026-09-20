import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Checkbox, Col, Form, Input, Modal, Row, Space } from 'antd';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import { baseName, dirOf, joinPath } from '../utils';
import type { Program } from '../types';

interface Props { open: boolean; initial: Program | null; onClose: () => void }

function parseBuildArgs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) { const idx = line.indexOf('='); if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim(); }
  return out;
}
function formatBuildArgs(args: Record<string, string>): string { return Object.entries(args).map(([k, v]) => `${k}=${v}`).join('\n'); }

async function pickFile(exts?: string[]): Promise<string | null> { const r = await openDialog({ multiple:false, filters: exts ? [{ name:'files', extensions:exts }] : undefined }); return typeof r === 'string' ? r : null; }
async function pickDir(): Promise<string | null> { const r = await openDialog({ directory:true }); return typeof r === 'string' ? r : null; }

export default function ProgramFormModal({ open, initial, onClose }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [argsText, setArgsText] = useState('');
  const selectedProjectId = useStore(s => s.selectedProjectId);
  const upsertProgram = useStore(s => s.upsertProgram);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setArgsText(initial ? formatBuildArgs(initial.buildArgs) : 'CONFIGURATION=Release');
    form.setFieldsValue({
      name: initial?.name ?? '', projectFile: initial?.projectFile ?? '', dockerfile: initial?.dockerfile ?? '', context: initial?.context ?? '',
      image: initial?.image ?? '', defaultVersion: initial?.defaultVersion ?? '0.1.0', enabled: initial?.enabled ?? true, nugetPackagesDir: initial?.nugetPackagesDir ?? '',
    });
  }, [open, initial, form]);

  const suggest = () => {
    const pf = form.getFieldValue('projectFile') as string; if (!pf) return;
    const dir = dirOf(pf); const stem = baseName(pf).replace(/\.(csproj|sln)$/i, '').toLowerCase();
    const cur = form.getFieldsValue();
    form.setFieldsValue({ name: cur.name || stem, image: cur.image || stem, dockerfile: cur.dockerfile || joinPath(dir, 'Dockerfile'), context: cur.context || dir });
  };

  const onOk = async () => {
    const v = await form.validateFields();
    const prog: Program = {
      id: initial?.id ?? `pg-${Date.now().toString(36)}`, name: v.name.trim(), projectFile: v.projectFile.trim(), dockerfile: v.dockerfile.trim(),
      context: v.context.trim(), image: v.image.trim(), defaultVersion: v.defaultVersion.trim() || '0.1.0', buildArgs: parseBuildArgs(argsText),
      enabled: !!v.enabled, nugetPackagesDir: (v.nugetPackagesDir ?? '').trim(), lastBuild: initial?.lastBuild ?? null,
    };
    const ok = await upsertProgram(selectedProjectId!, prog);
    if (ok) { message.success(t('form.saved')); onClose(); } else { message.warning(t('errors.saveBlocked')); }
  };

  return (
    <Modal open={open} title={initial ? t('form.editTitle') : t('form.newTitle')} onOk={onOk} onCancel={onClose} okText={t('common.save')} cancelText={t('common.cancel')} width={640} destroyOnClose>
      <Form form={form} layout="vertical" size="middle">
        <Row gutter={12}>
          <Col span={12}><Form.Item name="name" label={t('form.name')} rules={[{ required:true, message:t('form.required') }]}><Input placeholder="hr-order-api" /></Form.Item></Col>
          <Col span={12}><Form.Item name="image" label={t('form.image')} rules={[{ required:true, message:t('form.required') }]}><Input placeholder="hr-order-api" /></Form.Item></Col>
        </Row>
        <Form.Item label={t('form.projectFile')}>
          <Space.Compact style={{ width:'100%' }}>
            <Form.Item name="projectFile" noStyle><Input placeholder="src/Order.Api/Order.Api.csproj" /></Form.Item>
            <Button onClick={async () => { const p = await pickFile(['csproj','sln']); if (p) form.setFieldValue('projectFile', p); }}>{t('form.pickFile')}</Button>
            <Button onClick={suggest}>{t('form.suggestFromProject')}</Button>
          </Space.Compact>
        </Form.Item>
        <Form.Item name="dockerfile" label={t('form.dockerfile')} rules={[{ required:true, message:t('form.required') }]}>
          <Space.Compact style={{ width:'100%' }}>
            <Form.Item name="dockerfile" noStyle><Input placeholder="Dockerfile" /></Form.Item>
            <Button onClick={async () => { const p = await pickFile(['*']); if (p) form.setFieldValue('dockerfile', p); }}>{t('form.pickFile')}</Button>
          </Space.Compact>
        </Form.Item>
        <Form.Item name="context" label={t('form.context')} rules={[{ required:true, message:t('form.required') }]}>
          <Space.Compact style={{ width:'100%' }}>
            <Form.Item name="context" noStyle><Input placeholder="src/" /></Form.Item>
            <Button onClick={async () => { const p = await pickDir(); if (p) form.setFieldValue('context', p); }}>{t('form.pickDir')}</Button>
          </Space.Compact>
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="defaultVersion" label={t('form.version')}><Input placeholder="1.0.0" /></Form.Item></Col>
          <Col span={12}><Form.Item name="nugetPackagesDir" label={t('form.nugetDir')}>
            <Space.Compact style={{ width:'100%' }}>
              <Form.Item name="nugetPackagesDir" noStyle><Input placeholder="/data/nuget-packages" /></Form.Item>
              <Button onClick={async () => { const p = await pickDir(); if (p) form.setFieldValue('nugetPackagesDir', p); }}>{t('form.pickDir')}</Button>
            </Space.Compact>
          </Form.Item></Col>
        </Row>
        <Form.Item label={t('form.buildArgs')}>
          <Input.TextArea rows={3} value={argsText} onChange={e => setArgsText(e.target.value)} placeholder="CONFIGURATION=Release" style={{ fontFamily:'monospace', fontSize:12 }} />
        </Form.Item>
        <Form.Item name="enabled" valuePropName="checked" noStyle><Checkbox>{t('form.enabled')}</Checkbox></Form.Item>
      </Form>
    </Modal>
  );
}