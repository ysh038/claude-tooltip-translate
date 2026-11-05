import { DEFAULTS, LANGS } from '../core/settings.js';
import { engineFor } from '../core/engines.js';

const $ = (id) => document.getElementById(id);

(async () => {
  const s = await chrome.storage.local.get(DEFAULTS);
  for (const id of ['hoverEnabled', 'selectionEnabled']) {
    $(id).checked = s[id];
    $(id).addEventListener('change', () => chrome.storage.local.set({ [id]: $(id).checked }));
  }
  const st = $('status');
  const engines = ['hover', 'selection'].map((src) => engineFor(src, s));
  const checks = await Promise.all(engines.map((p) => p.available(s).catch((e) => ({ ok: false, reason: e.message }))));
  const bad = checks.find((c) => !c.ok);
  if (bad) {
    st.textContent = '⚠ ' + bad.reason + ' 설정을 확인하세요.';
    st.className = 'small err';
  } else {
    const [h, sel] = engines.map((p) => p.describe?.(s) || p.label);
    const to = `→ ${(LANGS[s.targetLang] || {}).label || s.targetLang}`;
    st.textContent = h === sel ? `${h} · ${to}` : `오버 ${h} · 드래그 ${sel} · ${to}`;
  }
})();

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
