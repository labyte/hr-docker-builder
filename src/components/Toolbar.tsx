import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { App, Button, Space, Tooltip } from 'antd';
import { FolderOpenOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import { errText } from '../utils';
import { api } from '../api';
import type { Outputs } from '../types';

const OUTPUT_KEYS: (keyof Outputs)[] = ['exportFile', 'loadLocal', 'push'];

interface Props { onAddProgram: () => void }

export default function Toolbar({ onAddProgram }: Props) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const selectedId = useStore((s) => s.selectedProjectId);
  const selectedProject = useStore((s) => s.config.projects.find(p => p.id === s.selectedProjectId));
  // 架构与产物去向为项目属性：工具条只读展示，编辑入口在项目设置（防误操作）
  const arch = useStore((s) => s.arch);
  const outputs = useStore((s) => s.outputs);
  const running = useStore((s) => s.running);
  const startBuild = useStore((s) => s.startBuild);
  const cancelBuild = useStore((s) => s.cancelBuild);
  const [exportPath, setExportPath] = useState('');

  useEffect(() => {
    if (!selectedId) { setExportPath(''); return; }
    api.getExportDir(selectedProject?.exportDir ?? '').then(setExportPath).catch(() => setExportPath(''));
  }, [selectedId, selectedProject?.exportDir]);

  // 前端省略：保留末两级目录，突出最后文件夹名，完整路径见悬浮提示
  const shortExportPath = (() => {
    if (!exportPath) return '…';
    const segs = exportPath.replace(/[\\/]+$/, '').split(/[\\/]+/).filter(Boolean);
    if (segs.length === 0) return exportPath;
    const tail = segs.slice(-2).join('/');
    return segs.length > 2 ? `…/${tail}` : tail;
  })();

  return (
    <div className="toolbar">
      {/* 当前项目构建配置一览（只读，编辑入口在项目设置） */}
      <Tooltip title={t('toolbar.editInProject')}>
        <span style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: '3px 12px', fontSize: 12, background: '#fff', whiteSpace: 'nowrap' }}>
          <span style={{ color: '#8c8c8c' }}>{t('toolbar.arch')}：</span>
          <span style={{ fontWeight: 500 }}>{selectedId ? t(`toolbar.${arch}`) : '—'}</span>
          <span style={{ margin: '0 10px', color: '#e0e0e0' }}>|</span>
          <span style={{ color: '#8c8c8c' }}>{t('toolbar.outputs')}：</span>
          <span style={{ fontWeight: 500 }}>
            {selectedId
              ? (OUTPUT_KEYS.filter(k => outputs[k]).map(k => t(`toolbar.${k}`)).join(i18n.language.startsWith('zh') ? '，' : ', ') || t('toolbar.noOutputs'))
              : '—'}
          </span>
        </span>
      </Tooltip>

      {selectedId && outputs.exportFile && (
        <Tooltip title={`${t('toolbar.openExportDir')}：${exportPath || '…'}`}>
          <a
            onClick={async () => {
              try { if (exportPath) await api.revealPath(exportPath); } catch (e) { message.error(errText(e)); }
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #d9d9d9', borderRadius: 8, padding: '2px 10px', fontSize: 12, background: '#fff', maxWidth: 260, verticalAlign: 'middle' }}
          >
            <FolderOpenOutlined style={{ color: '#fa8c16', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortExportPath}</span>
          </a>
        </Tooltip>
      )}

      <Space className="toolbar-actions">
        <Button type="primary" ghost icon={<PlusOutlined />} disabled={running || !selectedId} onClick={onAddProgram}>{t('table.add')}</Button>
        {!running ? (
          <Button type="primary" icon={<ThunderboltOutlined />} disabled={!selectedId} onClick={async () => { const err = await startBuild(); if (err) message.error(errText(err)); }}>{t('toolbar.build')}</Button>
        ) : (
          <Button danger onClick={async () => { await cancelBuild(); }}>{t('toolbar.cancel')}</Button>
        )}
      </Space>
    </div>
  );
}
