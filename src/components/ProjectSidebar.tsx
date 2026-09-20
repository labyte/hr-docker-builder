import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Input, List, Modal, Popconfirm, Tooltip, Typography } from 'antd';
import { AppstoreOutlined, CloudUploadOutlined, CopyOutlined, DeleteOutlined, DesktopOutlined, EditOutlined, FolderOpenOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import type { Project } from '../types';

export default function ProjectSidebar() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const projects = useStore((s) => s.config.projects);
  const selectedId = useStore((s) => s.selectedProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const upsertProject = useStore((s) => s.upsertProject);
  const removeProject = useStore((s) => s.removeProject);
  const copyProject = useStore((s) => s.copyProject);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const archColor = (a: string) => a === 'amd64' ? '#1677ff' : a === 'arm64' ? '#52c41a' : '#722ed1';

  const outputIcon = (p: Project) => (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {p.outputs.exportFile && <Tooltip title="导出文件"><SaveOutlined style={{ fontSize: 12, color: '#1677ff' }} /></Tooltip>}
      {p.outputs.loadLocal && <Tooltip title="本地加载"><DesktopOutlined style={{ fontSize: 12, color: '#52c41a' }} /></Tooltip>}
      {p.outputs.push && <Tooltip title="推送 Registry"><CloudUploadOutlined style={{ fontSize: 12, color: '#fa8c16' }} /></Tooltip>}
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
          return (
            <div
              className="sidebar-item"
              onClick={() => selectProject(p.id)}
              onMouseEnter={() => setHovered(p.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                cursor: 'pointer', padding: '8px 10px 6px 12px', position: 'relative',
                margin: '0 8px 6px 8px',
                border: sel ? '1px solid #91caff' : '1px solid #eee',
                borderRadius: 8,
                background: sel ? '#e6f4ff' : '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AppstoreOutlined style={{ fontSize: 18, color: sel ? '#1677ff' : '#8c8c8c', flexShrink: 0 }} />
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, paddingLeft: 23 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: archColor(p.defaultArch), background: `${archColor(p.defaultArch)}18`, padding: '1px 5px', borderRadius: 3 }}>{p.defaultArch}</span>
                <span style={{ fontSize: 11, color: '#999', display:'inline-flex', alignItems:'center', gap:4 }}>{outputIcon(p)}</span>
              </div>
              {hovered === p.id && (
                <div style={{ position: 'absolute', right: 2, top: 4, display: 'flex', background: sel ? '#e6f4ff' : '#fafbfc', borderRadius: 4 }}>
                  <Tooltip title={t('sidebar.copy')}>
                    <Button size="small" type="text" icon={<CopyOutlined style={{ fontSize: 12 }} />}
                      onClick={async (e) => { e.stopPropagation(); const c = await copyProject(p.id); if (c) { selectProject(c.id); message.success(t('sidebar.copied')); } }} />
                  </Tooltip>
                  <Tooltip title={t('common.edit')}>
                    <Button size="small" type="text" icon={<EditOutlined style={{ fontSize: 12 }} />}
                      onClick={(e) => { e.stopPropagation(); setEditing(p); setEditOpen(true); }} />
                  </Tooltip>
                  <Popconfirm title={t('sidebar.deleteConfirm')} onConfirm={async () => { const ok = await removeProject(p.id); if (!ok) message.warning(t('errors.saveBlocked')); }} okText={t('common.ok')} cancelText={t('common.cancel')}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                      onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>
                </div>
              )}
            </div>
          );
        }}
      />
      <div style={{ padding: '8px 12px', borderTop: '1px solid #e8e8ee' }}>
        <Button type="dashed" block icon={<PlusOutlined />} onClick={() => { setEditing(null); setEditOpen(true); }}>
          {t('sidebar.newProject')}
        </Button>
      </div>
      <ProjectEditModal open={editOpen} initial={editing} onClose={() => setEditOpen(false)}
        onSave={async (p) => { const ok = await upsertProject(p); if (ok) message.success(t('common.saved')); }} />
    </div>
  );
}

function ProjectEditModal({ open, initial, onClose, onSave }: { open: boolean; initial: Project | null; onClose: () => void; onSave: (p: Project) => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [exportDir, setExportDir] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setExportDir(initial?.exportDir ?? '');
  }, [open, initial]);

  return (
    <Modal
      open={open}
      title={initial ? t('sidebar.editProject') : t('sidebar.newProject')}
      onOk={async () => {
        const p: Project = initial
          ? { ...initial, name: name || initial.name, exportDir }
          : { id: `prj-${Date.now().toString(36)}`, name: name || t('sidebar.projectName'), defaultArch: 'amd64', outputs: { exportFile: true, loadLocal: false, push: false }, exportDir, programs: [] };
        await onSave(p);
        setName('');
        setExportDir('');
        onClose();
      }}
      onCancel={() => { setName(''); setExportDir(''); onClose(); }}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
    >
      <Input placeholder={t('sidebar.projectName')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Input placeholder={t('sidebar.exportDir')} value={exportDir} onChange={(e) => setExportDir(e.target.value)} style={{ flex: 1 }} />
        <Button icon={<FolderOpenOutlined />} onClick={async () => { const d = await openDialog({ directory: true }); if (typeof d === 'string') setExportDir(d); }}>
          {t('form.pickDir')}
        </Button>
      </div>
    </Modal>
  );
}