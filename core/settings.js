// 공용 설정 (background / options / popup / content 에서 import)
// __EDITION__ 은 빌드 시 editions/<name>.json 내용으로 치환된다 (scripts/build.mjs)
export const EDITION = __EDITION__;

export const DEFAULTS = {
  apiKey: '',
  model: 'claude-haiku-5-5',      // anthropic-api 모델 (최신 세대만 선택지로 제공)
  targetLang: 'ko',
  fallbackLang: 'en',        // 이미 목표 언어인 텍스트를 만났을 때 번역할 언어
  hoverEnabled: true,
  hoverModifier: 'none',     // none | alt | shift | ctrl | meta
  hoverDelay: 450,           // ms, 마우스를 멈추고 기다리는 시간
  hoverSkipTarget: true,     // 목표 언어 단어(예: 한글)는 hover 무시
  hoverEngine: 'anthropic-api',     // 마우스 오버 번역에 쓸 provider id
  selectionEnabled: true,
  selectionMode: 'auto',     // auto | button
  selectionEngine: 'anthropic-api', // 드래그(선택) 번역에 쓸 provider id
  contextMode: 'sentence',   // none | sentence | paragraph
  showAlternatives: true,    // 단어 번역 시 다른 뜻 표시
  apiBase: 'https://api.anthropic.com', // UI에 노출 안 된 테스트용 오버라이드
  ...EDITION.defaults
};

// content script가 읽는 키 (API 키 등 민감한 값은 content script로 가져가지 않는다)
export const CONTENT_KEYS = ['hoverEnabled', 'hoverModifier', 'hoverDelay', 'hoverSkipTarget',
  'selectionEnabled', 'selectionMode', 'contextMode', 'targetLang'];

export const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

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

// 이미 목표 언어일 때 대신 번역할 언어 (fallback이 목표와 같으면 ko↔en)
export const fallbackOf = (s) =>
  s.fallbackLang === s.targetLang ? (s.targetLang === 'en' ? 'ko' : 'en') : s.fallbackLang;
