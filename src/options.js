import { DEFAULTS, LANGS, EDITION } from '../core/settings.js';
import { PROVIDERS, engineFor, getProvider, modelChoices } from '../core/engines.js';
import { listModels } from '../providers/anthropic-api.js';
import { engineStatus } from '../core/status-client.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['apiKey', 'targetLang', 'fallbackLang', 'hoverEnabled', 'hoverModifier', 'hoverDelay',
  'hoverSkipTarget', 'showAlternatives', 'selectionEnabled', 'selectionMode', 'contextMode',
  'hoverEngine', 'selectionEngine'];
const ENGINE_FIELDS = { hoverEngine: 'hover', selectionEngine: 'selection' };
const SINGLE = PROVIDERS.length === 1; // 개인용: claude -p 하나뿐 → 엔진 선택 없이 이름·상태만

let savedTimer = 0;
function flashSaved() {
  $('saved').hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').hidden = true), 1200);
}

function fillLangs() {
  for (const id of ['targetLang', 'fallbackLang']) {
    $(id).innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  }
}

function fillEngines() {
  $('engineMulti').hidden = SINGLE;
  $('engineSingle').hidden = !SINGLE;
  if (SINGLE) { $('engineName').textContent = PROVIDERS[0].label; return; }
  for (const id of Object.keys(ENGINE_FIELDS)) {
    $(id).innerHTML = PROVIDERS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  }
}

const setStatus = (el, av) => { el.textContent = av?.ok ? '사용 가능' : '⚠ ' + (av?.reason || '알 수 없음'); el.className = av?.ok ? 'ok' : 'err'; };

// 선택된 엔진이 지금 쓸 수 있는 상태인지 표시 (확인은 background가 함)
async function refreshEngineStatus() {
  const s = await chrome.storage.local.get(DEFAULTS);
  const st = await engineStatus();
  if (SINGLE) return setStatus($('engineStatus'), st.hover);
  for (const [id, source] of Object.entries(ENGINE_FIELDS)) {
    const p = engineFor(source, s);
    if ($(id).value !== p.id) $(id).value = p.id; // 이 에디션에 없는 엔진이 저장돼 있던 경우
    setStatus($(id + 'Status'), st[source]);
  }
}

// 이 빌드에 없는 엔진 전용 섹션(예: 개인용의 Claude API)은 숨김
function hideAbsentProviders() {
  for (const el of document.querySelectorAll('[data-provider]')) el.hidden = !getProvider(el.dataset.provider);
}

// provider가 선언한 모델 선택(models)·안내(help)를 그린다.
// 정적 HTML에 [data-models-slot=<id>]가 있으면 그 자리에, 없으면 provider 섹션을 새로 만든다
function renderProviderSettings(s) {
  for (const p of PROVIDERS) {
    const mc = modelChoices(p, s);
    if (!mc && !p.help) continue;
    let slot = document.querySelector(`[data-models-slot="${p.id}"]`);
    if (!slot) {
      const sec = document.createElement('section');
      sec.dataset.provider = p.id;
      const h = document.createElement('h2'); h.textContent = p.label; sec.append(h);
      if (p.help) { const d = document.createElement('p'); d.className = 'muted small'; d.textContent = p.help; sec.append(d); }
      slot = document.createElement('div'); sec.append(slot);
      $('providerSettings').append(sec);
    }
    if (!mc) continue;
    const label = document.createElement('label'); label.className = 'row col';
    const span = document.createElement('span'); span.textContent = '모델';
    const sel = document.createElement('select'); sel.id = mc.key;
    for (const c of mc.choices) sel.add(new Option(`${c.label} — ${c.hint}`, c.value));
    sel.value = mc.current;
    sel.addEventListener('change', async () => {
      await chrome.storage.local.set({ [mc.key]: sel.value });
      flashSaved();
      refreshEngineStatus();
    });
    label.append(span, sel);
    slot.append(label);
  }
}

function readField(id) {
  const el = $(id);
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range') return Number(el.value);
  return el.value.trim();
}

async function init() {
  document.body.dataset.edition = EDITION.name;
  fillLangs();
  fillEngines();
  hideAbsentProviders();
  const s = await chrome.storage.local.get(DEFAULTS);
  renderProviderSettings(s);
  for (const id of FIELDS) {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = s[id];
    else el.value = s[id];
  }
  $('hoverDelayVal').textContent = s.hoverDelay + 'ms';
  if (s.apiKey) $('keyStatus').textContent = 'API 키가 저장되어 있습니다.';

  for (const id of FIELDS) {
    const el = $(id);
    const ev = el.tagName === 'INPUT' && el.type !== 'checkbox' ? 'input' : 'change';
    el.addEventListener(ev, async () => {
      if (id === 'hoverDelay') $('hoverDelayVal').textContent = el.value + 'ms';
      await chrome.storage.local.set({ [id]: readField(id) });
      flashSaved();
      if (id in ENGINE_FIELDS || id === 'apiKey') refreshEngineStatus();
    });
  }
  // 팝업 등 다른 곳에서 모델을 바꾸면 여기도 반영
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    for (const p of PROVIDERS) {
      const k = p.models?.key;
      if (k && ch[k] && $(k) && $(k).value !== ch[k].newValue) $(k).value = ch[k].newValue;
    }
  });
  await refreshEngineStatus();
}

$('toggleKey').addEventListener('click', () => {
  const k = $('apiKey');
  k.type = k.type === 'password' ? 'text' : 'password';
  $('toggleKey').textContent = k.type === 'password' ? '보기' : '숨기기';
});

$('loadModels').addEventListener('click', async () => {
  const key = $('apiKey').value.trim();
  const st = $('keyStatus');
  if (!key) { st.textContent = 'API 키를 먼저 입력하세요.'; st.className = 'err'; return; }
  st.textContent = '확인 중…'; st.className = 'muted';
  try {
    const { apiBase } = await chrome.storage.local.get({ apiBase: DEFAULTS.apiBase });
    await listModels(key, apiBase); // 키가 유효한지만 확인 (모델은 최신 세대 고정 선택지)
    st.textContent = '연결 성공 · API 키가 유효합니다.';
    st.className = 'ok';
  } catch (e) {
    st.textContent = '실패: ' + e.message;
    st.className = 'err';
  }
});

$('runTest').addEventListener('click', () => {
  const text = $('testText').value.trim();
  if (!text) return;
  const out = $('testOut'), meta = $('testMeta');
  out.textContent = '…'; meta.textContent = '';
  const port = chrome.runtime.connect({ name: 'translate' });
  port.onMessage.addListener((m) => {
    if (m.type === 'delta') out.textContent = m.full;
    else if (m.type === 'done') {
      out.textContent = m.text;
      const who = [m.engine, m.model].filter(Boolean).join(' · ');
      meta.textContent = m.cached ? `캐시된 결과 · ${who}` : `첫 글자 ${m.ttft}ms · 전체 ${m.ms}ms · ${who}`;
      port.disconnect();
    } else if (m.type === 'error') {
      out.textContent = '⚠ ' + m.message;
      port.disconnect();
    }
  });
  port.postMessage({ source: 'selection', mode: /\s/.test(text) ? 'text' : 'word', text });
});

init();
