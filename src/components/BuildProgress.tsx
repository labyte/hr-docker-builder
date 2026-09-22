import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Progress, Typography } from 'antd';
import { useStore } from '../store';

// 底部构建进度条：位于日志控制台之外、仅横跨工作区（不含项目侧栏）的细条；
// 条件渲染——没有构建（既不在运行也无结果汇总）时整体隐藏，不占任何空间
export default function BuildProgress() {
  const { t } = useTranslation();
  const running = useStore(s => s.running);
  const summary = useStore(s => s.summary);
  const statuses = useStore(s => s.statuses);
  const totalTasks = useStore(s => s.totalTasks);

  // 已完成任务数（终态：成功/失败/取消/跳过），与程序表格状态标签同源
  const doneTasks = useMemo(() => {
    let n = 0;
    for (const perArch of Object.values(statuses))
      for (const s of Object.values(perArch))
        if (s.status === 'success' || s.status === 'failed' || s.status === 'canceled' || s.status === 'skipped') n++;
    return n;
  }, [statuses]);

  if (!running && !summary) return null;
  const pct = totalTasks > 0 ? Math.min(100, Math.round((doneTasks / totalTasks) * 100)) : (summary ? 100 : 0);
  const barStatus: 'active' | 'success' | 'exception' = summary ? (summary.failed > 0 ? 'exception' : 'success') : 'active';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 16px', background: '#fafbfc', borderTop: '1px solid #e8e8ee', flexShrink: 0 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {t('log.progress')}{totalTasks > 0 ? ` ${Math.min(doneTasks, totalTasks)}/${totalTasks}` : ''}
      </Typography.Text>
      <Progress percent={pct} size="small" status={barStatus} style={{ flex: 1, marginBottom: 0 }} />
    </div>
  );
}
