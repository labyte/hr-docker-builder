import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Modal, Space, Tag, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { getVersion } from '@tauri-apps/api/app';
import icon from '../assets/app-icon-128.png';

const REPO = 'https://github.com/labyte/hr-docker-builder';

export default function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [ver, setVer] = useState('');

  useEffect(() => {
    if (open && !ver) getVersion().then(setVer).catch(() => setVer('?'));
  }, [open, ver]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); message.success(t('about.copied')); }
    catch { message.error(text); }
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} title={t('about.title')} width={480} destroyOnClose>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '8px 0 16px' }}>
        <img src={icon} width={72} height={72} alt="" style={{ borderRadius: 16 }} />
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('app.title')}</Typography.Title>
          <Typography.Text type="secondary">HR Docker Builder</Typography.Text>
          <div style={{ marginTop: 6 }}><Tag color="blue">v{ver || '…'}</Tag></div>
        </div>
      </div>
      <Typography.Paragraph style={{ color: 'rgba(0,0,0,.65)' }}>{t('about.desc')}</Typography.Paragraph>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <div><Typography.Text strong>{t('about.repo')}：</Typography.Text><Typography.Text code>{REPO}</Typography.Text>{' '}
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copy(REPO)}>{t('about.copyLink')}</Button></div>
        <div><Typography.Text strong>{t('about.releases')}：</Typography.Text><Typography.Text code>{REPO}/releases</Typography.Text>{' '}
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copy(`${REPO}/releases`)}>{t('about.copyLink')}</Button></div>
        <div><Typography.Text strong>{t('about.stack')}：</Typography.Text>Tauri 2 · React 18 · Ant Design · Rust</div>
      </Space>
      <Typography.Paragraph style={{ marginTop: 20, marginBottom: 0, textAlign: 'center' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('about.copyright')}</Typography.Text>
      </Typography.Paragraph>
    </Modal>
  );
}
