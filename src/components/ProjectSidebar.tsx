import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Checkbox, Dropdown, Input, List, Modal, Segmented, Tooltip, Typography } from 'antd';
import { CloudFilled, CopyFilled, DeleteFilled, HomeFilled, EditFilled, FolderOpenFilled, PlusOutlined, SaveFilled } from '@ant-design/icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import { errText } from '../utils';
import type { Outputs, Project } from '../types';

const OUTPUT_KEYS: (keyof Outputs)[] = ['exportFile', 'loadLocal', 'push'];
const defaultOutputs = (): Outputs => ({ exportFile: true, loadLocal: false, push: false });

const fmtDate = (iso: string, lang: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  if (lang.startsWith('zh')) return `${String(d.getFullYear()).slice(2)}年${d.getMonth() + 1}月${d.getDate()}日`;
  return d.toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: 'numeric' });
};

export default function ProjectSidebar() {
  const { t, i18n } = useTranslation();
  const { message, modal } = App.useApp();
  const projects = useStore((s) => s.config.projects);
  const selectedId = useStore((s) => s.selectedProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const upsertProject = useStore((s) => s.upsertProject);
  const removeProject = useStore((s) => s.removeProject);
  const copyProject = useStore((s) => s.copyProject);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const archColor = (a: string) => a === 'amd64' ? '#1677ff' : a === 'arm64' ? '#52c41a' : '#722ed1';

  const outputIcon = (p: Project) => (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {p.outputs.exportFile && <Tooltip title={t('toolbar.exportFile')}><SaveFilled style={{ fontSize: 12, color: '#1677ff' }} /></Tooltip>}
      {p.outputs.loadLocal && <Tooltip title="本地加载"><HomeFilled style={{ fontSize: 12, color: '#52c41a' }} /></Tooltip>}
      {p.outputs.push && <Tooltip title="推送 Registry"><CloudFilled style={{ fontSize: 12, color: '#fa8c16' }} /></Tooltip>}
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fafbfc', borderRight: '1px solid #e8e8ee' }}>
      <div style={{ padding: '10px 12px 6px' }}>
        <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>
          {t('sidebar.title')}
        </Typography.Text>
      </div>
      <List
        size="small"
        style={{ flex: 1, overflow: 'auto' }}
        dataSource={projects}
        split={false}
        locale={{ emptyText: <span style={{ fontSize: 12, color: '#999' }}>{t('sidebar.empty')}</span> }}
        renderItem={(p) => {
          const sel = selectedId === p.id;
          const menuItems = [
            { key: 'copy', icon: <CopyFilled />, label: t('sidebar.copy'),
              onClick: async (info: { domEvent: React.MouseEvent | React.KeyboardEvent }) => {
                info.domEvent.stopPropagation();
                const c = await copyProject(p.id);
                if (c) { selectProject(c.id); message.success(t('sidebar.copied')); }
              } },
            { key: 'edit', icon: <EditFilled />, label: t('common.edit'),
              onClick: () => { setEditing(p); setEditOpen(true); } },
            { type: 'divider' as const },
            { key: 'delete', icon: <DeleteFilled />, label: t('table.delete'), danger: true,
              onClick: () => modal.confirm({
                title: t('sidebar.deleteConfirm', { name: p.name }), okText: t('common.ok'), cancelText: t('common.cancel'), okButtonProps: { danger: true },
                onOk: async () => { const err = await removeProject(p.id); if (err) message.warning(errText(err)); },
              }) },
          ];
          return (
            <Dropdown key={p.id} trigger={['contextMenu']} menu={{ items: menuItems }}>
            <div
              className="sidebar-item"
              onClick={() => selectProject(p.id)}
              style={{
                cursor: 'pointer', padding: '8px 10px', position: 'relative',
                margin: '0 8px 6px 8px',
                border: sel ? '2px solid #69b1ff' : '2px solid #e6e8ee',
                borderRadius: 8,
                background: sel ? '#e6f4ff' : '#fff',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Typography.Text
                      ellipsis
                      style={{ fontSize: 13, fontWeight: sel ? 600 : 400, lineHeight: '20px', flex: 1, minWidth: 0 }}
                    >
                      {p.name}
                    </Typography.Text>
                    <span style={{ fontSize: 11, color: '#bbb', flexShrink: 0, marginLeft: 'auto' }}>
                      {p.programs.length}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 7 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: archColor(p.defaultArch), background: `${archColor(p.defaultArch)}18`, padding: '1px 5px', borderRadius: 3 }}>{p.defaultArch}</span>
                    <span style={{ fontSize: 11, color: '#999', display:'inline-flex', alignItems:'center', gap:4 }}>{outputIcon(p)}</span>
                    {p.createdAt && <span style={{ fontSize: 10, color: '#bbb', marginLeft: 'auto' }}>{fmtDate(p.createdAt, i18n.language)}</span>}
                  </div>
                </div>
            </div>
            </Dropdown>
          );
        }}
      />
      <div style={{ padding: '8px 12px', borderTop: '1px solid #e8e8ee' }}>
        <Button type="dashed" block icon={<PlusOutlined />} onClick={() => { setEditing(null); setEditOpen(true); }}>
          {t('sidebar.newProject')}
        </Button>
      </div>
      <ProjectEditModal open={editOpen} initial={editing} onClose={() => setEditOpen(false)}
        onSave={async (p) => { const err = await upsertProject(p); if (!err) message.success(t('common.saved')); else message.warning(errText(err)); }} />
    </div>
  );
}

function ProjectEditModal({ open, initial, onClose, onSave }: { open: boolean; initial: Project | null; onClose: () => void; onSave: (p: Project) => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [exportDir, setExportDir] = useState('');
  const [contextDir, setContextDir] = useState('');
  const [arch, setArch] = useState('amd64');
  const [outputs, setOutputs] = useState<Outputs>(defaultOutputs());

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setExportDir(initial?.exportDir ?? '');
    setContextDir(initial?.contextDir ?? '');
    setArch(initial?.defaultArch ?? 'amd64');
    setOutputs(initial?.outputs ?? defaultOutputs());
  }, [open, initial]);

  const reset = () => { setName(''); setExportDir(''); setContextDir(''); setArch('amd64'); setOutputs(defaultOutputs()); };
  const checkedOutputs = OUTPUT_KEYS.filter(k => outputs[k]).map(String);

  // 行内标签：定宽右对齐，让各行控件纵向对齐
  const LABEL = { fontSize: 12, width: 80, flexShrink: 0, textAlign: 'right' } as const;

  return (
    <Modal
      open={open}
      title={initial ? t('sidebar.editProject') : t('sidebar.newProject')}
      onOk={async () => {
        const p: Project = initial
          ? { ...initial, name: name || initial.name, exportDir, contextDir, defaultArch: arch, outputs }
          : { id: `prj-${Date.now().toString(36)}`, name: name || t('sidebar.projectName'), createdAt: new Date().toISOString(), defaultArch: arch, outputs, exportDir, contextDir, programs: [] };
        await onSave(p);
        reset();
        onClose();
      }}
      onCancel={() => { reset(); onClose(); }}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Typography.Text type="secondary" style={LABEL}>{t('sidebar.projectName')}</Typography.Text>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus style={{ flex: 1 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <Typography.Text type="secondary" style={LABEL}>{t('toolbar.arch')}</Typography.Text>
        <Segmented value={arch} onChange={v => setArch(String(v))}
          options={[
            { label: t('toolbar.amd64'), value: 'amd64' },
            { label: t('toolbar.arm64'), value: 'arm64' },
            { label: t('toolbar.both'), value: 'both' },
          ]} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <Typography.Text type="secondary" style={LABEL}>{t('toolbar.outputs')}</Typography.Text>
        <Checkbox.Group
          value={checkedOutputs}
          onChange={v => {
            const next = defaultOutputs();
            next.exportFile = next.loadLocal = next.push = false;
            for (const key of v as string[]) { if (key in next) next[key as keyof Outputs] = true; }
            setOutputs(next);
          }}
          options={OUTPUT_KEYS.map(k => ({ label: t(`toolbar.${k}`), value: k }))}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <Typography.Text type="secondary" style={LABEL}>{t('sidebar.imageDir')}</Typography.Text>
        <Input placeholder={t('sidebar.imageDirPlaceholder')} value={exportDir} onChange={(e) => setExportDir(e.target.value)} style={{ flex: 1 }} />
        <Button icon={<FolderOpenFilled />} onClick={async () => { const d = await openDialog({ directory: true }); if (typeof d === 'string') setExportDir(d); }}>
          {t('form.pickDir')}
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 12 }}>
        <Typography.Text type="secondary" style={{ ...LABEL, lineHeight: '32px' }}>{t('sidebar.contextDir')}</Typography.Text>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input placeholder={t('sidebar.projectContextPlaceholder')} value={contextDir} onChange={(e) => setContextDir(e.target.value)} style={{ flex: 1 }} />
            <Button icon={<FolderOpenFilled />} onClick={async () => { const d = await openDialog({ directory: true }); if (typeof d === 'string') setContextDir(d); }}>
              {t('form.pickDir')}
            </Button>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{t('sidebar.projectContextHint')}</Typography.Text>
        </div>
      </div>
    </Modal>
  );
}