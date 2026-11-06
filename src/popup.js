import { DEFAULTS, LANGS } from '../core/settings.js';
import { engineFor, modelChoices } from '../core/engines.js';
import { engineStatus } from '../core/status-client.js';

const $ = (id) => document.getElementById(id);
const SOURCE_LABEL = { hover: '마우스 오버', selection: '드래그' };

// 쓰고 있는 엔진(오버·드래그가 같으면 하나)의 모델을 세그먼트 버튼으로 고른다
function renderModels(s) {
  const box = $('models');
  box.textContent = '';
  const groups = [];
  for (const src of ['hover', 'selection']) {
    const p = engineFor(src, s);
    const g = groups.find((x) => x.p === p);
    if (g) g.sources.push(src); else groups.push({ p, sources: [src] });
  }
  for (const { p, sources } of groups) {
    const mc = modelChoices(p, s);
    if (!mc) continue;
    const wrap = document.createElement('div');
    wrap.className = 'pmodel';
    const title = document.createElement('div');
    title.className = 'plabel';
    title.textContent = groups.length > 1 ? `모델 · ${sources.map((x) => SOURCE_LABEL[x]).join('·')}` : '모델';
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', title.textContent);
    const hint = document.createElement('div');
    hint.className = 'small muted phint';
    for (const c of mc.choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c.label;
      b.title = c.hint;
      b.dataset.value = c.value;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(c.value === mc.current));
      b.addEventListener('click', async () => {
        if (c.value === s[mc.key]) return;
        s[mc.key] = c.value;
        await chrome.storage.local.set({ [mc.key]: c.value });
        render(s);
      });
      seg.append(b);
    }
    hint.textContent = (mc.choices.find((c) => c.value === mc.current) || {}).hint || '';
    wrap.append(title, seg, hint);
    box.append(wrap);
  }
}

async function renderStatus(s) {
  const st = $('status');
  const engines = ['hover', 'selection'].map((src) => engineFor(src, s));
  const st2 = await engineStatus();
  const bad = [st2.hover, st2.selection].find((c) => !c?.ok);
  if (bad) {
    st.textContent = '⚠ ' + bad.reason + ' 설정을 확인하세요.';
    st.className = 'small err';
  } else {
    const [h, sel] = engines.map((p) => p.describe?.(s) || p.label);
    const to = `→ ${(LANGS[s.targetLang] || {}).label || s.targetLang}`;
    st.textContent = h === sel ? `${h} · ${to}` : `오버 ${h} · 드래그 ${sel} · ${to}`;
    st.className = 'small muted';
  }
}

function render(s) {
  renderModels(s);
  renderStatus(s);
}

(async () => {
  const s = await chrome.storage.local.get(DEFAULTS);
  for (const id of ['hoverEnabled', 'selectionEnabled']) {
    $(id).checked = s[id];
    $(id).addEventListener('change', () => chrome.storage.local.set({ [id]: $(id).checked }));
  }
  render(s);
})();

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
