import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Col, Form, Input, Modal, Row, Space, Tag } from 'antd';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import { baseName, dirOf, errText, joinPath } from '../utils';
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
  const presets = useStore(s => s.config.global.buildArgPresets ?? []);

  // 点选预设：同 key 互斥替换；再点移除
  const togglePreset = (p: string) => {
    const key = p.slice(0, p.indexOf('=') + 1);
    const lines = argsText.split('\n').map(l => l.trim()).filter(Boolean);
    const has = lines.includes(p);
    const next = has ? lines.filter(l => l !== p) : [...lines.filter(l => !l.startsWith(key)), p];
    setArgsText(next.join('\n'));
  };

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setArgsText(initial ? formatBuildArgs(initial.buildArgs) : '');
    form.setFieldsValue({
      name: initial?.name ?? '', projectFile: initial?.projectFile ?? '', dockerfile: initial?.dockerfile ?? '', context: initial?.context ?? '',
      image: initial?.image ?? '', defaultVersion: initial?.defaultVersion ?? 'latest',
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
      context: (v.context ?? '').trim(), image: v.image.trim(), defaultVersion: v.defaultVersion.trim() || 'latest', buildArgs: parseBuildArgs(argsText),
      enabled: initial?.enabled ?? true, nugetPackagesDir: initial?.nugetPackagesDir ?? '', lastBuild: initial?.lastBuild ?? null,
    };
    const err = await upsertProgram(selectedProjectId!, prog);
    if (!err) { message.success(t('form.saved')); onClose(); } else { message.warning(errText(err)); }
  };

  return (
    <Modal open={open} title={initial ? t('form.editTitle') : t('form.newTitle')} onOk={onOk} onCancel={onClose} okText={t('common.save')} cancelText={t('common.cancel')} width={640} destroyOnClose>
      <Form form={form} layout="vertical" size="middle">
        <Row gutter={12}>
          <Col span={8}><Form.Item name="name" label={t('form.name')} rules={[{ required:true, message:t('form.required') }]}><Input placeholder="hr-order-api" /></Form.Item></Col>
          <Col span={8}><Form.Item name="image" label={t('form.image')} rules={[{ required:true, message:t('form.required') }]}><Input placeholder="hr/app" /></Form.Item></Col>
          <Col span={8}><Form.Item name="defaultVersion" label={t('form.version')}><Input placeholder="latest" /></Form.Item></Col>
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
        <Form.Item name="context" label={t('form.context')} extra={t('form.contextFollowHint')}>
          <Space.Compact style={{ width:'100%' }}>
            <Form.Item name="context" noStyle><Input placeholder={t('form.contextFollowPlaceholder')} /></Form.Item>
            <Button onClick={async () => { const p = await pickDir(); if (p) form.setFieldValue('context', p); }}>{t('form.pickDir')}</Button>
          </Space.Compact>
        </Form.Item>
        <Form.Item label={t('form.buildArgs')}>
          {presets.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {presets.map(p => (
                <Tag.CheckableTag key={p} checked={argsText.split('\n').some(l => l.trim() === p)} onChange={() => togglePreset(p)} style={{ border: '1px solid #d9d9d9', marginRight: 6 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{p}</span>
                </Tag.CheckableTag>
              ))}
            </div>
          )}
          <Input.TextArea rows={3} value={argsText} onChange={e => setArgsText(e.target.value)} placeholder="CONFIGURATION=Release" style={{ fontFamily:'monospace', fontSize:12 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}