import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Empty, Switch, Tabs, Tooltip, Typography } from 'antd';
import { FolderOpenFilled } from '@ant-design/icons';
import { api } from '../api';
import { useStore } from '../store';
import type { LogLine } from '../types';

function LogView({ lines }: { lines: LogLine[] }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLPreElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <pre ref={ref} className="log">
        {lines.map((l, i) => (
          <div key={i} className={l.stream === 'stderr' ? 'err' : classify(l.line)}>
            {l.line}
          </div>
        ))}
      </pre>
      <div className="log-autoscroll">
        <Switch size="small" checked={autoScroll} onChange={setAutoScroll} />
        <span>{t('log.autoScroll')}</span>
      </div>
    </div>
  );
}

function classify(line: string): string {
  if (/DONE|=> \[|exporting|naming to|writing image/.test(line)) return 'ok';
  if (/\bERROR\b|error:|failed/i.test(line)) return 'err';
  return '';
}

export default function LogPanel() {
  const { t } = useTranslation();
  const selectedProject = useStore((s) => s.config.projects.find(p => p.id === s.selectedProjectId));
  const logs = useStore((s) => s.logs);
  const allLogs = useStore((s) => s.allLogs);
  const statuses = useStore((s) => s.statuses);
  const summary = useStore((s) => s.summary);
  const clearLogs = useStore((s) => s.clearLogs);

  const [active, setActive] = useState('all');

  const visiblePrograms = useMemo(
    () => selectedProject?.programs.filter((p) => logs[p.id]?.length || statuses[p.id]) ?? [],
    [selectedProject, logs, statuses],
  );

  const items = [
    { key: 'all', label: t('log.all'), children: <LogView lines={allLogs} /> },
    ...visiblePrograms.map((p) => ({ key: p.id, label: p.name, children: <LogView lines={logs[p.id] ?? []} /> })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 12px 12px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <Typography.Text strong>{t('log.title')}</Typography.Text>
        <Button size="small" onClick={clearLogs}>
          {t('log.clear')}
        </Button>
        {summary && summary.logDir && (
          <Tooltip title={summary.logDir}>
            <Button size="small" icon={<FolderOpenFilled />} onClick={() => void api.revealPath(summary.logDir)}>
              {t('log.openDir')}
            </Button>
          </Tooltip>
        )}
        {/* 结果汇总：带边框胶囊，整行靠右（配色沿用状态栏成功/失败色系） */}
        {summary && (
          <span style={{
            marginLeft: 'auto', fontSize: 12, padding: '2px 10px', borderRadius: 8, whiteSpace: 'nowrap',
            border: `1px solid ${summary.failed > 0 ? '#ffa39e' : '#b7eb8f'}`,
            background: summary.failed > 0 ? '#fff2f0' : '#f6ffed',
            color: summary.failed > 0 ? '#ff4d4f' : '#389e0d',
          }}>
            {t('log.summary', { success: summary.success, failed: summary.failed, canceled: summary.canceled, skipped: summary.skipped })}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {allLogs.length === 0 && !summary ? (
          <div className="log" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('log.empty')} />
          </div>
        ) : (
          <Tabs
            size="small"
            activeKey={active}
            onChange={setActive}
            items={items}
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            className="log-tabs"
          />
        )}
      </div>
    </div>
  );
}
