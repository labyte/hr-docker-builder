import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App as AntdApp, ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import Workbench from './pages/Workbench';
import { useStore } from './store';

// 配置损坏提示：后端已把原文件备份为 .corrupt-*，这里弹窗一次指引手动恢复
function CorruptNotice() {
  const { t } = useTranslation();
  const { modal } = AntdApp.useApp();
  const notice = useStore((s) => s.corruptNotice);
  useEffect(() => {
    if (!notice) return;
    useStore.setState({ corruptNotice: null });
    modal.warning({
      title: t('errors.configCorruptTitle'),
      content: <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>{t('errors.configCorruptBody', { backup: notice.backup })}</div>,
      width: 520,
    });
  }, [notice, modal, t]);
  return null;
}

export default function App() {
  const lang = useStore((s) => s.lang);
  const init = useStore((s) => s.init);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    init().finally(() => setReady(true));
  }, [init]);

  return (
    <ConfigProvider
      locale={lang === 'zh-CN' ? zhCN : enUS}
      theme={{ token: { fontSize: 13 } }}
    >
      <AntdApp>
        <CorruptNotice />
        {ready ? (
          <Workbench />
        ) : (
          <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin size="large" />
          </div>
        )}
      </AntdApp>
    </ConfigProvider>
  );
}
