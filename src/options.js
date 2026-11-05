import { DEFAULTS, LANGS, EDITION } from '../core/settings.js';
import { PROVIDERS, engineFor } from '../core/engines.js';
import { listModels } from '../providers/anthropic-api.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['apiKey', 'model', 'targetLang', 'fallbackLang', 'hoverEnabled', 'hoverModifier', 'hoverDelay',
  'hoverSkipTarget', 'showAlternatives', 'selectionEnabled', 'selectionMode', 'contextMode',
  'hoverEngine', 'selectionEngine'];
const ENGINE_FIELDS = { hoverEngine: 'hover', selectionEngine: 'selection' };
const PRESET_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-5'];

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
  for (const id of Object.keys(ENGINE_FIELDS)) {
    $(id).innerHTML = PROVIDERS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  }
}

// 선택된 엔진이 지금 쓸 수 있는 상태인지 표시
async function refreshEngineStatus() {
  const s = await chrome.storage.local.get(DEFAULTS);
  for (const [id, source] of Object.entries(ENGINE_FIELDS)) {
    const p = engineFor(source, s);
    if ($(id).value !== p.id) $(id).value = p.id; // 이 에디션에 없는 엔진이 저장돼 있던 경우
    const st = $(id + 'Status');
    const av = await p.available(s).catch((e) => ({ ok: false, reason: e.message }));
    st.textContent = av.ok ? '사용 가능' : '⚠ ' + av.reason;
    st.className = av.ok ? 'ok' : 'err';
  }
}

function fillModels(list, current) {
  const ids = [...new Set([...(list || []), ...PRESET_MODELS, current].filter(Boolean))];
  $('model').innerHTML = ids.map((id) => `<option value="${id}">${id}</option>`).join('');
  $('model').value = current;
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
  const s = await chrome.storage.local.get({ ...DEFAULTS, modelList: [] });
  fillModels(s.modelList, s.model);
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
      if (id in ENGINE_FIELDS || id === 'apiKey' || id === 'model') refreshEngineStatus();
    });
  }
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
    const ids = await listModels(key, apiBase);
    await chrome.storage.local.set({ modelList: ids });
    fillModels(ids, $('model').value);
    st.textContent = `연결 성공 · 사용 가능한 모델 ${ids.length}개를 불러왔습니다.`;
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
