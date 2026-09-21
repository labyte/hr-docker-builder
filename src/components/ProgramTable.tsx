import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Empty, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, WarningOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useStore } from '../store';
import type { Program, StatusEvent } from '../types';

const STATUS_COLOR: Record<string, string> = { running:'processing', success:'success', failed:'error', canceled:'default', skipped:'default' };

function StatusTags({ ev }: { ev?: Record<string, StatusEvent> }) {
  const { t } = useTranslation();
  if (!ev) return <Typography.Text type="secondary">—</Typography.Text>;
  return <Space size={4} wrap>{Object.values(ev).map(s => (
    <Tooltip key={s.arch} title={s.message ? s.message : undefined}>
      <Tag color={STATUS_COLOR[s.status] ?? 'default'}>{s.arch} · {t(`status.${s.status}`)}</Tag>
    </Tooltip>
  ))}</Space>;
}

interface Props { onEdit: (p: Program) => void }

export default function ProgramTable({ onEdit }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const selectedProjectId = useStore(s => s.selectedProjectId);
  const project = useStore(s => s.config.projects.find(p => p.id === s.selectedProjectId));
  const programs = project?.programs ?? [];
  const issues = useStore(s => s.issues);
  const selectedIds = useStore(s => s.selectedIds);
  const setSelected = useStore(s => s.setSelected);
  const statuses = useStore(s => s.statuses);
  const running = useStore(s => s.running);
  const removeProgram = useStore(s => s.removeProgram);

  const issueSet = useMemo(() => {
    const set = new Set<string>();
    for (const i of issues) set.add(i.programId);
    return set;
  }, [issues]);

  const columns: ColumnsType<Program> = useMemo(() => [
    {
      title: t('table.name'), dataIndex: 'name', width: 220,
      render: (_, r) => (
        <Space size={4}>
          <span style={{ fontWeight: 500 }}>{r.name}</span>
          {!r.enabled && <Tag>{t('table.disabled')}</Tag>}
          {issueSet.has(r.id) && <Tooltip title={t('table.pathIssue')}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>}
        </Space>
      ),
    },
    { title: t('table.image'), dataIndex: 'image', width: 240, render: (_, r) => <span style={{ fontFamily:'monospace', fontSize:12 }}>{r.image}:{r.defaultVersion}</span> },
    { title: t('table.dockerfile'), dataIndex: 'dockerfile', ellipsis:{ showTitle:false }, render: (v:string) => <Tooltip title={v}><span style={{ fontFamily:'monospace', fontSize:12 }}>{v}</span></Tooltip> },
    { title: t('table.status'), width: 220, render: (_, r) => <StatusTags ev={statuses[r.id]} /> },
    {
      title: t('table.lastBuild'), width: 180,
      render: (_, r) => {
        const lb = r.lastBuild;
        if (!lb) return <Typography.Text type="secondary">—</Typography.Text>;
        return <Tooltip title={`${lb.tag} (${lb.arch})`}><Tag color={lb.ok ? 'success' : 'error'}>{lb.time}</Tag></Tooltip>;
      },
    },
    {
      title: t('table.actions'), width: 110,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" type="text" icon={<EditOutlined />} disabled={running} onClick={() => onEdit(r)} />
          <Popconfirm title={t('table.deleteConfirm')} onConfirm={async () => {
            const ok = await removeProgram(selectedProjectId!, r.id);
            if (!ok) message.warning(t('errors.saveBlocked'));
          }} okText={t('common.ok')} cancelText={t('common.cancel')}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={running} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [t, statuses, issueSet, running, removeProgram, onEdit, message, selectedProjectId]);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ flex:1, overflow:'auto', padding:'12px' }}>
        <Table<Program>
          size="small" rowKey="id" columns={columns} dataSource={programs} pagination={false}
          locale={{ emptyText: <Empty description={t('table.empty')} style={{ padding:'36px 0' }} /> }}
          rowSelection={{ selectedRowKeys: selectedIds, onChange: keys => setSelected(keys.map(String)) }}
        />
      </div>
    </div>
  );
}