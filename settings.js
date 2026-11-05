// 공용 설정 (background / options / popup 에서 import)
export const DEFAULTS = {
  apiKey: '',
  model: 'claude-haiku-4-5',
  targetLang: 'ko',
  fallbackLang: 'en',        // 이미 목표 언어인 텍스트를 만났을 때 번역할 언어
  hoverEnabled: true,
  hoverModifier: 'none',     // none | alt | shift | ctrl | meta
  hoverDelay: 450,           // ms, 마우스를 멈추고 기다리는 시간
  hoverSkipTarget: true,     // 목표 언어 단어(예: 한글)는 hover 무시
  selectionEnabled: true,
  selectionMode: 'auto',     // auto | button
  contextMode: 'sentence',   // none | sentence | paragraph
  showAlternatives: true,    // 단어 번역 시 다른 뜻 표시
  apiBase: 'https://api.anthropic.com'
};

export const LANGS = {
  ko: { label: '한국어', en: 'Korean' },
  en: { label: 'English', en: 'English' },
  ja: { label: '日本語', en: 'Japanese' },
  'zh-CN': { label: '中文(简体)', en: 'Simplified Chinese' },
  'zh-TW': { label: '中文(繁體)', en: 'Traditional Chinese' },
  es: { label: 'Español', en: 'Spanish' },
  fr: { label: 'Français', en: 'French' },
  de: { label: 'Deutsch', en: 'German' },
  vi: { label: 'Tiếng Việt', en: 'Vietnamese' },
  ru: { label: 'Русский', en: 'Russian' }
};

export const langName = (code) => (LANGS[code] || LANGS.ko).en;
