import { DEFAULTS, LANGS } from './settings.js';

const $ = (id) => document.getElementById(id);

(async () => {
  const s = await chrome.storage.local.get(DEFAULTS);
  for (const id of ['hoverEnabled', 'selectionEnabled']) {
    $(id).checked = s[id];
    $(id).addEventListener('change', () => chrome.storage.local.set({ [id]: $(id).checked }));
  }
  const st = $('status');
  if (!s.apiKey) {
    st.textContent = '⚠ API 키가 없습니다. 설정에서 입력하세요.';
    st.className = 'small err';
  } else {
    st.textContent = `${s.model} · → ${(LANGS[s.targetLang] || {}).label || s.targetLang}`;
  }
})();

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
