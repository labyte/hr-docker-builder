import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('ui-lang') : null;
const guess = stored ?? ((navigator.language || 'en').startsWith('zh') ? 'zh-CN' : 'en');

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  lng: guess,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
