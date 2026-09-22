import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { App, Button, Space, Tooltip } from 'antd';
import { FolderOpenFilled, PlusOutlined, ThunderboltFilled } from '@ant-design/icons';
import { useStore } from '../store';
import { errText } from '../utils';
import { api } from '../api';
import type { Outputs } from '../types';

const OUTPUT_KEYS: (keyof Outputs)[] = ['exportFile', 'loadLocal', 'push'];

// 前端省略：保留末两级目录，突出最后文件夹名，完整路径见悬浮提示
function shortenPath(p: string): string {
  if (!p) return '…';
  const segs = p.replace(/[\\/]+$/, '').split(/[\\/]+/).filter(Boolean);
  if (segs.length === 0) return p;
  const tail = segs.slice(-2).join('/');
  return segs.length > 2 ? `…/${tail}` : tail;
}

const pillStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  border: '1px solid #d9d9d9', borderRadius: 8, padding: '2px 10px',
  fontSize: 12, background: '#fff', maxWidth: 260, verticalAlign: 'middle',
};

// 目录胶囊链接：label 标签区分用途 + 文件夹图标 + 短路径，点击打开所在目录
function DirLink({ label, color, path, tip }: { label: string; color: string; path: string; tip: string }) {
  const { message } = App.useApp();
  return (
    <Tooltip title={tip}>
      <a
        onClick={async () => { try { if (path) await api.revealPath(path); } catch (e) { message.error(errText(e)); } }}
        style={pillStyle}
      >
        <span style={{ color: '#8c8c8c', flexShrink: 0 }}>{label}</span>
        <FolderOpenFilled style={{ color, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortenPath(path)}</span>
      </a>
    </Tooltip>
  );
}

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

  const contextDir = selectedProject?.contextDir ?? '';

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

      {/* 目录胶囊：镜像导出目录（勾选「镜像文件」时）+ 项目构建上下文目录（已设置时） */}
      {selectedId && outputs.exportFile && (
        <DirLink label={t('sidebar.imageDir')} color="#fa8c16" path={exportPath} tip={`${t('toolbar.openExportDir')}：${exportPath || '…'}`} />
      )}
      {selectedId && (contextDir.trim() ? (
        <DirLink label={t('sidebar.contextDir')} color="#1677ff" path={contextDir.trim()} tip={`${t('toolbar.openContextDir')}：${contextDir.trim()}`} />
      ) : (
        /* 项目未设置上下文目录：展示默认回退规则（各程序跟随其 Dockerfile 所在目录），无可定位路径故不可点击 */
        <Tooltip title={t('toolbar.contextDefaultTip')}>
          <span style={{ ...pillStyle, cursor: 'default' }}>
            <span style={{ color: '#8c8c8c', flexShrink: 0 }}>{t('sidebar.contextDir')}</span>
            <FolderOpenFilled style={{ color: '#bfbfbf', flexShrink: 0 }} />
            <span style={{ color: '#8c8c8c', whiteSpace: 'nowrap' }}>{t('toolbar.contextDefaultLabel')}</span>
          </span>
        </Tooltip>
      ))}

      {/* 添加程序：靠左、圆形纯图标按钮 */}
      <Tooltip title={t('table.add')}>
        <Button type="primary" shape="circle" size="small" icon={<PlusOutlined />} disabled={running || !selectedId} onClick={onAddProgram} />
      </Tooltip>

      <Space className="toolbar-actions">
        {!running ? (
          <Button type="primary" icon={<ThunderboltFilled />} disabled={!selectedId} onClick={async () => { const err = await startBuild(); if (err) message.error(errText(err)); }}>{t('toolbar.build')}</Button>
        ) : (
          <Button danger onClick={async () => { await cancelBuild(); }}>{t('toolbar.cancel')}</Button>
        )}
      </Space>
    </div>
  );
}
