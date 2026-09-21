import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Tag, Typography } from 'antd';
import { getVersion } from '@tauri-apps/api/app';
import icon from '../assets/app-icon-128.png';

export default function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [ver, setVer] = useState('');

  useEffect(() => {
    if (open && !ver) getVersion().then(setVer).catch(() => setVer('?'));
  }, [open, ver]);

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
      <div><Typography.Text strong>{t('about.stack')}：</Typography.Text>Tauri 2 · React 18 · Ant Design · Rust</div>
      <Typography.Paragraph style={{ marginTop: 20, marginBottom: 0, textAlign: 'center' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('about.copyright')}</Typography.Text>
      </Typography.Paragraph>
    </Modal>
  );
}
