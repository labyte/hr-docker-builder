import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Dropdown, Empty, Segmented, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { CopyFilled, DeleteFilled, EditFilled, EllipsisOutlined, PlusOutlined, WarningFilled } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useStore } from '../store';
import { errText } from '../utils';
import type { Program, StatusEvent } from '../types';

const STATUS_COLOR: Record<string, string> = { running:'processing', success:'success', failed:'error', canceled:'default', skipped:'default' };

type SortMode = 'name' | 'enabled' | 'lastBuild';

function StatusTags({ ev }: { ev?: Record<string, StatusEvent> }) {
  const { t } = useTranslation();
  if (!ev) return <Typography.Text type="secondary">—</Typography.Text>;
  return <Space size={4} wrap>{Object.values(ev).map(s => {
    const stepLabel = s.step ? ` ${t(s.step, s.step)}` : '';
    const tooltip = [s.message, s.step ? t(s.step, s.step) : null].filter(Boolean).join(' · ') || undefined;
    return (
      <Tooltip key={s.arch} title={tooltip}>
        <Tag color={STATUS_COLOR[s.status] ?? 'default'}>{s.arch} · {t(`status.${s.status}`)}{stepLabel}</Tag>
      </Tooltip>
    );
  })}</Space>;
}

interface Props { onEdit: (p: Program) => void; onAddProgram: () => void }

export default function ProgramTable({ onEdit, onAddProgram }: Props) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const selectedProjectId = useStore(s => s.selectedProjectId);
  const project = useStore(s => s.config.projects.find(p => p.id === s.selectedProjectId));
  const programs = project?.programs ?? [];
  const issues = useStore(s => s.issues);
  const setProgramsEnabled = useStore(s => s.setProgramsEnabled);
  const statuses = useStore(s => s.statuses);
  const running = useStore(s => s.running);
  const removeProgram = useStore(s => s.removeProgram);
  const copyProgram = useStore(s => s.copyProgram);
  const upsertProject = useStore(s => s.upsertProject);

  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const issueSet = useMemo(() => {
    const set = new Set<string>();
    for (const i of issues) set.add(i.programId);
    return set;
  }, [issues]);

  const enabledIds = useMemo(() => programs.filter(p => p.enabled).map(p => p.id), [programs]);

  const displayPrograms = useMemo(() => {
    const list = [...programs];
    if (sortMode === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'enabled') {
      list.sort((a, b) => (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0) || a.name.localeCompare(b.name));
    } else if (sortMode === 'lastBuild') {
      list.sort((a, b) => {
        const ta = a.lastBuild ? new Date(a.lastBuild.time).getTime() : 0;
        const tb = b.lastBuild ? new Date(b.lastBuild.time).getTime() : 0;
        return tb - ta;
      });
    }
    return list;
  }, [programs, sortMode]);

  const handleBatchDelete = async () => {
    if (!selectedProjectId || !enabledIds.length) return;
    const count = enabledIds.length;
    setDeletingIds(new Set(enabledIds));
    try {
      const confirmed = await new Promise<boolean>(resolve => {
        modal.confirm({
          title: t('table.batchDeleteConfirm', { count }),
          okText: t('common.ok'), cancelText: t('common.cancel'), okButtonProps: { danger: true },
          onOk: () => resolve(true), onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
      const err = await upsertProject({ ...project!, programs: programs.filter(p => !enabledIds.includes(p.id)) });
      if (err) message.warning(errText(err));
    } finally {
      setDeletingIds(new Set());
    }
  };

  const columns: ColumnsType<Program> = useMemo(() => [
    {
      title: t('table.name'), dataIndex: 'name', width: '14%', ellipsis: { showTitle: false },
      render: (_, r) => (
        <Tooltip title={r.name} placement="topLeft">
          <span>
            <span style={{ fontWeight: 500 }}>{r.name}</span>
            {issueSet.has(r.id) && <WarningFilled style={{ color: '#faad14' }} />}
          </span>
        </Tooltip>
      ),
    },
    { title: t('table.image'), dataIndex: 'image', width: '16%', ellipsis: { showTitle: false }, render: (_, r) => <Tooltip title={`${r.image}:${r.defaultVersion}`} placement="topLeft"><span style={{ fontFamily:'monospace', fontSize:12 }}>{r.image}:{r.defaultVersion}</span></Tooltip> },
    { title: t('table.dockerfile'), dataIndex: 'dockerfile', width: '24%', ellipsis:{ showTitle:false }, render: (v:string) => <Tooltip title={v}><span style={{ fontFamily:'monospace', fontSize:12 }}>{v}</span></Tooltip> },
    { title: t('table.status'), width: '12%', render: (_, r) => <StatusTags ev={statuses[r.id]} /> },
    {
      title: t('table.lastBuild'), width: '13%',
      render: (_, r) => {
        const lb = r.lastBuild;
        if (!lb) return <Typography.Text type="secondary">—</Typography.Text>;
        return <Tooltip title={`${lb.tag} (${lb.arch})`}><Tag color={lb.ok ? 'success' : 'error'}>{lb.time}</Tag></Tooltip>;
      },
    },
    {
      title: t('table.actions'), width: '8%',
      render: (_, r) => {
        const menuItems = [
          { key: 'edit', icon: <EditFilled />, label: t('common.edit'), onClick: () => onEdit(r) },
          { key: 'copy', icon: <CopyFilled />, label: t('table.copy'),
            onClick: async () => {
              if (!selectedProjectId) return;
              const err = await copyProgram(selectedProjectId, r.id);
              if (err) message.warning(errText(err));
              else message.success(t('table.copied'));
            } },
          { type: 'divider' as const },
          { key: 'delete', icon: <DeleteFilled />, label: t('table.delete'), danger: true,
            onClick: async () => {
              if (!selectedProjectId) return;
              setDeletingIds(new Set([r.id]));
              try {
                const confirmed = await new Promise<boolean>(resolve => {
                  modal.confirm({
                    title: t('table.deleteConfirm'),
                    okText: t('common.ok'), cancelText: t('common.cancel'), okButtonProps: { danger: true },
                    onOk: () => resolve(true), onCancel: () => resolve(false),
                  });
                });
                if (!confirmed) return;
                const err = await removeProgram(selectedProjectId, r.id);
                if (err) message.warning(errText(err));
              } finally { setDeletingIds(new Set()); }
            } },
        ];
        return (
          <Dropdown trigger={['click']} menu={{ items: menuItems }} disabled={running}>
            <Button size="small" type="text" icon={<EllipsisOutlined />} disabled={running}
              onClick={(e) => e.stopPropagation()} style={{ fontSize: 14 }} />
          </Dropdown>
        );
      },
    },
  ], [t, statuses, issueSet, running, onEdit, message, modal, selectedProjectId, copyProgram, removeProgram]);

  const selectedCount = enabledIds.length;
  const totalCount = programs.length;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 0', flexShrink: 0 }}>
        {selectedCount > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
            {t('table.selected', { count: selectedCount, total: totalCount })}
          </Typography.Text>
        )}
        {totalCount > 0 && (
          <>
            <span style={{ fontSize: 12, color: '#888', flexShrink: 0 }}>{t('table.sort')}</span>
            <Segmented size="small" value={sortMode} onChange={v => setSortMode(v as SortMode)}
              options={[
                { label: t('table.sortName'), value: 'name' },
                { label: t('table.sortEnabled'), value: 'enabled' },
                { label: t('table.sortLastBuild'), value: 'lastBuild' },
              ]}
            />
          </>
        )}
        <Tooltip title={t('table.add')}>
          <Button type="primary" shape="circle" size="small" icon={<PlusOutlined />}
            disabled={running || !selectedProjectId} onClick={onAddProgram} />
        </Tooltip>
        {selectedCount > 0 && (
          <Button size="small" danger type="text" icon={<DeleteFilled />} onClick={handleBatchDelete}
            disabled={running} style={{ fontSize: 12 }}>
            {t('table.delete')}
          </Button>
        )}
      </div>
      <div style={{ flex:1, overflow:'auto', padding:'12px' }}>
        <Table<Program>
          size="small" rowKey="id" columns={columns} dataSource={displayPrograms} pagination={false} tableLayout="fixed"
          locale={{ emptyText: <Empty description={t('table.empty')} style={{ padding:'36px 0' }} /> }}
          onRow={(record) => ({
            style: deletingIds.has(record.id) ? { background: '#fff1f0' } : undefined,
          })}
          rowSelection={{
            selectedRowKeys: enabledIds,
            onChange: keys => {
              if (!selectedProjectId) return;
              void setProgramsEnabled(selectedProjectId, keys.map(String))
                .then(err => { if (err) message.warning(errText(err)); });
            },
            getCheckboxProps: () => ({ disabled: running }),
          }}
        />
      </div>
    </div>
  );
}
