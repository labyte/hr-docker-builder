import { useEffect, useState } from 'react';
import { App as AntdApp, ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import Workbench from './pages/Workbench';
import { useStore } from './store';

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
