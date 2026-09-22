import { useTranslation } from 'react-i18next';
import { InputNumber, Switch, Tooltip } from 'antd';
import { useStore } from '../store';

// 顶栏快捷构建设置：并发数 + 失败策略——从设置弹窗迁出的高频调整项，
// 与「设置 → 构建」共用 config.global 数据源，双向实时同步
export default function QuickSettings() {
  const { t } = useTranslation();
  const global = useStore(s => s.config.global);
  const running = useStore(s => s.running);
  const setConcurrency = useStore(s => s.setConcurrency);
  const setFailFast = useStore(s => s.setFailFast);
  return (
    <Tooltip title={t('toolbar.quickTip')}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid #d9d9d9', borderRadius: 8, padding: '3px 12px', fontSize: 12, background: '#fff', whiteSpace: 'nowrap' }}>
        <span style={{ color: '#8c8c8c' }}>{t('toolbar.concurrency')}</span>
        <InputNumber
          size="small" min={1} max={8} style={{ width: 56 }} value={global.concurrency} disabled={running}
          onChange={v => { if (typeof v === 'number') setConcurrency(Math.min(8, Math.max(1, Math.round(v)))); }}
        />
        <span style={{ color: '#e0e0e0' }}>|</span>
        <span style={{ color: '#8c8c8c' }}>{t('toolbar.failPolicy')}</span>
        <Switch
          size="small" checked={global.failFast} disabled={running}
          checkedChildren={t('toolbar.failFast')} unCheckedChildren={t('toolbar.failFastKeep')}
          onChange={b => setFailFast(b)}
        />
      </div>
    </Tooltip>
  );
}
