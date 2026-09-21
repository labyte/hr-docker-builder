import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Empty, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { DeleteFilled, EditFilled, WarningFilled } from '@ant-design/icons';
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
  const setProgramsEnabled = useStore(s => s.setProgramsEnabled);
  const statuses = useStore(s => s.statuses);
  const running = useStore(s => s.running);
  const removeProgram = useStore(s => s.removeProgram);

  const issueSet = useMemo(() => {
    const set = new Set<string>();
    for (const i of issues) set.add(i.programId);
    return set;
  }, [issues]);

  // 复选框勾选即「参与构建」：选中态直接来源于持久化的 enabled 字段
  const enabledIds = useMemo(() => programs.filter(p => p.enabled).map(p => p.id), [programs]);

  // 百分比等比缩放（tableLayout=fixed）：窗口变小时各列同比收窄，不隐藏任何列；操作列保底 9%
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
    { title: t('table.dockerfile'), dataIndex: 'dockerfile', width: '23%', ellipsis:{ showTitle:false }, render: (v:string) => <Tooltip title={v}><span style={{ fontFamily:'monospace', fontSize:12 }}>{v}</span></Tooltip> },
    { title: t('table.status'), width: '18%', render: (_, r) => <StatusTags ev={statuses[r.id]} /> },
    {
      title: t('table.lastBuild'), width: '13%',
      render: (_, r) => {
        const lb = r.lastBuild;
        if (!lb) return <Typography.Text type="secondary">—</Typography.Text>;
        return <Tooltip title={`${lb.tag} (${lb.arch})`}><Tag color={lb.ok ? 'success' : 'error'}>{lb.time}</Tag></Tooltip>;
      },
    },
    {
      title: t('table.actions'), width: '9%',
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" type="text" icon={<EditFilled />} disabled={running} onClick={() => onEdit(r)} />
          <Popconfirm title={t('table.deleteConfirm')} onConfirm={async () => {
            const ok = await removeProgram(selectedProjectId!, r.id);
            if (!ok) message.warning(t('errors.saveBlocked'));
          }} okText={t('common.ok')} cancelText={t('common.cancel')}>
            <Button size="small" type="text" danger icon={<DeleteFilled />} disabled={running} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [t, statuses, issueSet, running, removeProgram, onEdit, message, selectedProjectId]);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ flex:1, overflow:'auto', padding:'12px' }}>
        <Table<Program>
          size="small" rowKey="id" columns={columns} dataSource={programs} pagination={false} tableLayout="fixed"
          locale={{ emptyText: <Empty description={t('table.empty')} style={{ padding:'36px 0' }} /> }}
          rowSelection={{
            selectedRowKeys: enabledIds,
            onChange: keys => {
              if (!selectedProjectId) return;
              void setProgramsEnabled(selectedProjectId, keys.map(String))
                .then(ok => { if (!ok) message.warning(t('errors.saveBlocked')); });
            },
            getCheckboxProps: () => ({ disabled: running }),
          }}
        />
      </div>
    </div>
  );
}