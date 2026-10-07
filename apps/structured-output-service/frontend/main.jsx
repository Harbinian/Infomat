import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { loadDomainModules } from './bridge.mjs';
import { createWorkbenchController } from './controller.mjs';
import Workbench from './Workbench.jsx';
import './workbench.css';

const theme = {
  token: {
    colorPrimary: '#a44e3c', colorSuccess: '#60775e', colorWarning: '#946528', colorError: '#a43e30',
    colorInfo: '#667961', colorText: '#40362f', colorTextSecondary: '#76695c', colorBgBase: '#f4edde',
    colorBgContainer: '#fcf6e9', colorBgElevated: '#fbf1df', colorBorder: '#d7c8b4',
    colorFillAlter: '#efe4d0', fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 14, fontSizeSM: 13,
    borderRadius: 8, controlHeight: 36, boxShadow: '0 8px 28px rgba(85,60,38,.15)',
  },
  components: {
    Table: { headerBg: '#ede2cd', rowHoverBg: '#f1e5cf', rowSelectedBg: '#eee0c5', cellPaddingBlock: 8 },
    Drawer: { colorBgElevated: '#f7efdf' }, Modal: { contentBg: '#fbf2e2', headerBg: '#fbf2e2' },
    Input: { activeBg: '#fcf6e9' }, Select: { selectorBg: '#fcf6e9', optionSelectedBg: '#e9dcc4' },
    Segmented: { itemSelectedBg: '#fcf6e9', trackBg: '#e8dcc7' },
  },
};

const container = document.getElementById('root');
let controller;
const root = createRoot(container);
try {
  const modules = await loadDomainModules();
  controller = createWorkbenchController({ modules });
  root.render(<ConfigProvider locale={zhCN} theme={theme}><AntApp><Workbench controller={controller} /></AntApp></ConfigProvider>);
  await controller.dispatch({ type: 'init' });
} catch (error) {
  root.render(<div className="startup-error"><h1>工作台暂未打开</h1><p>请确认服务可用后重新打开。</p><button onClick={() => location.reload()}>重新打开</button></div>);
}
if (import.meta.hot) import.meta.hot.dispose(() => { controller?.destroy(); root.unmount(); });
