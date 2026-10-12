import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Empty, Switch, Tooltip } from 'antd';
import { FolderOpenFilled, LoadingOutlined, CheckCircleFilled, ExclamationCircleFilled, CloseCircleFilled } from '@ant-design/icons';
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
      <div className="log-wrapper">
        <pre ref={ref} className="log">
          {lines.map((l, i) => (
            <div key={i} className={l.stream === 'stderr' ? 'err' : classify(l.line)}>
              {l.line}
            </div>
          ))}
        </pre>
      </div>
      <div className="log-autoscroll">
        <Switch size="small" checked={autoScroll} onChange={setAutoScroll} />
        <span>{t('log.autoScroll')}</span>
      </div>
    </div>
  );
}

function classify(line: string): string {
  if (/⚠/.test(line)) return 'warn';
  if (/▶|✓|开始构建|完成 ───|DONE|=> \[|exporting|naming to|writing image/.test(line)) return 'ok';
  if (/✗|⊘|失败 ───|取消 ───|跳过 ───|\bERROR\b|error:|failed/i.test(line)) return 'err';
  return '';
}

export default function LogPanel() {
  const { t } = useTranslation();
  const allLogs = useStore((s) => s.allLogs);
  const summary = useStore((s) => s.summary);
  const clearLogs = useStore((s) => s.clearLogs);
  const running = useStore((s) => s.running);
  const totalTasks = useStore((s) => s.totalTasks);
  const statuses = useStore((s) => s.statuses);

  const doneTasks = useMemo(() => {
    let n = 0;
    for (const perArch of Object.values(statuses))
      for (const s of Object.values(perArch))
        if (['success', 'failed', 'canceled', 'skipped'].includes(s.status)) n++;
    return n;
  }, [statuses]);

  const showProgress = totalTasks > 0 && (running || summary?.kind === 'build');

  // 状态图标：构建中 → 旋转；完成 → 按结果着色
  const statusIcon = useMemo(() => {
    if (running) return <LoadingOutlined spin style={{ color: '#1677ff' }} />;
    if (summary?.kind === 'build') {
      const allOk = summary.failed === 0 && summary.canceled === 0 && summary.skipped === 0;
      const allFail = summary.success === 0;
      if (allOk) return <CheckCircleFilled style={{ color: '#52c41a' }} />;
      if (allFail) return <CloseCircleFilled style={{ color: '#ff4d4f' }} />;
      return <ExclamationCircleFilled style={{ color: '#faad14' }} />;
    }
    return null;
  }, [running, summary]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 12px 12px 12px' }}>
      <div className="log-header">
        <span className="log-header-title">{t('log.title')}</span>
        {statusIcon}
        {showProgress && <span style={{ fontSize: 12, color: '#8c8c8c' }}>{Math.min(doneTasks, totalTasks)}/{totalTasks}</span>}
        <span style={{ flex: 1 }} />
        <Button size="small" onClick={clearLogs}>{t('log.clear')}</Button>
        <Tooltip title={summary?.logDir || ''}>
          <Button size="small" icon={<FolderOpenFilled />} onClick={() => {
            const dir = summary?.logDir || '';
            if (dir) void api.revealPath(dir);
          }}>
            {t('log.openDir')}
          </Button>
        </Tooltip>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {allLogs.length === 0 ? (
          <div className="log-wrapper">
            <div className="log" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('log.empty')} />
            </div>
          </div>
        ) : (
          <LogView lines={allLogs} />
        )}
      </div>
    </div>
  );
}
