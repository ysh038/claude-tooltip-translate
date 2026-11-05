import { DEFAULTS, langName } from './settings.js';

/* ───────────── 캐시 (메모리 + session storage, LRU) ───────────── */
const CACHE_MAX = 600;
const cache = new Map();
let cacheLoaded = null;
let persistTimer = 0;

function loadCache() {
  if (!cacheLoaded) {
    cacheLoaded = chrome.storage.session.get('cache').then(({ cache: arr }) => {
      if (Array.isArray(arr)) for (const [k, v] of arr) if (!cache.has(k)) cache.set(k, v);
    }).catch(() => {});
  }
  return cacheLoaded;
}
async function cacheGet(k) {
  await loadCache();
  if (!cache.has(k)) return null;
  const v = cache.get(k);
  cache.delete(k); cache.set(k, v); // LRU 갱신
  return v;
}
function cacheSet(k, v) {
  cache.set(k, v);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    chrome.storage.session.set({ cache: [...cache] }).catch(() => {});
  }, 500);
}

/* ───────────── 프롬프트 ───────────── */
function buildPrompt(req, s) {
  const T = langName(s.targetLang);
  const F = langName(s.fallbackLang === s.targetLang ? (s.targetLang === 'en' ? 'ko' : 'en') : s.fallbackLang);
  const title = req.title ? `\nPage title: ${req.title}` : '';

  if (req.mode === 'word') {
    const system = [
      `You are an instant pop-up dictionary inside a web browser. The user pointed at a word on a page.`,
      `Answer in ${T}. If the word itself is already ${T}, answer in ${F} instead.`,
      `The target word is marked with ⟦ ⟧ in the context. Use the context to pick the right sense.`,
      ``,
      `Output format (plain text, no markdown, no preamble, no quotes):`,
      `Line 1: the meaning that fits THIS context — short and natural (1–8 words), then the part of speech in parentheses. If the word is inflected, add the base form (e.g. "ran → run"). If it is part of a phrasal verb or idiom in the context, translate the whole expression and show it.`,
      s.showAlternatives
        ? `Line 2: only if the word has other common, clearly different meanings — up to 3, separated by " · ". Otherwise omit the line.`
        : `Output only Line 1.`,
      `Be extremely brief.`
    ].join('\n');
    const user = `Word: ${req.text}${req.context ? `\nContext: ${req.context}` : ''}${title}`;
    return { system, user, maxTokens: s.showAlternatives ? 160 : 80 };
  }

  // 문장/구간 번역
  const system = [
    `You are a translation engine embedded in a web browser.`,
    `Translate the text inside <text> into natural, fluent ${T}. If it is already ${T}, translate it into ${F} instead.`,
    `Prefer natural, idiomatic phrasing over word-for-word translation, but stay faithful to the meaning.`,
    `Use <context> (if given) only to resolve ambiguous words and tone — do not translate the context itself.`,
    `Preserve line breaks, numbers, code, URLs and proper nouns.`,
    `Output ONLY the translation. No notes, no quotes, no preamble.`
  ].join('\n');
  const user = (req.context ? `<context>${req.context}</context>${title ? `\n<page_title>${req.title}</page_title>` : ''}\n` : '') +
    `<text>${req.text}</text>`;
  const maxTokens = Math.min(4096, Math.max(256, Math.ceil(req.text.length * 2.5)));
  return { system, user, maxTokens };
}

/* ───────────── Claude API (스트리밍) ───────────── */
class ApiError extends Error {
  constructor(status, message, type) { super(message); this.status = status; this.type = type; }
}

async function streamClaude(s, { system, user, maxTokens }, signal, onDelta) {
  const res = await fetch(`${s.apiBase}/v1/messages`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': s.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: s.model,
      max_tokens: maxTokens,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
      stream: true
    })
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`, type;
    try { const j = await res.json(); msg = j.error?.message || msg; type = j.error?.type; } catch {}
    throw new ApiError(res.status, msg, type);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r/g, '');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          full += ev.delta.text;
          onDelta(full);
        } else if (ev.type === 'error') {
          throw new ApiError(0, ev.error?.message || 'stream error', ev.error?.type);
        }
      }
    }
  }
  return full;
}

function friendlyError(e, s) {
  if (e.name === 'AbortError') return null;
  switch (e.status) {
    case 401: return 'API 키가 유효하지 않습니다. 설정에서 확인해 주세요.';
    case 403: return '이 API 키로는 접근 권한이 없습니다.';
    case 404: return `모델을 찾을 수 없습니다: ${s.model}\n설정에서 모델을 다시 선택해 주세요.`;
    case 429: return '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
    case 529: return 'Anthropic 서버가 과부하 상태입니다. 잠시 후 다시 시도해 주세요.';
  }
  if (e.status >= 500) return `Anthropic 서버 오류 (${e.status})`;
  if (e instanceof TypeError) return '네트워크 오류: API에 연결할 수 없습니다.';
  return e.message || String(e);
}

/* ───────────── 콘텐츠 스크립트와 통신 (port 1개 = 요청 1개) ───────────── */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate') return;
  const ctrl = new AbortController();
  let alive = true;
  port.onDisconnect.addListener(() => { alive = false; ctrl.abort(); });
  const post = (m) => { if (alive) try { port.postMessage(m); } catch {} };

  port.onMessage.addListener(async (req) => {
    const s = await chrome.storage.local.get(DEFAULTS);
    if (!s.apiKey) return post({ type: 'error', code: 'NO_KEY', message: 'Claude API 키가 설정되지 않았습니다.' });

    const key = [req.mode, s.model, s.targetLang, s.fallbackLang, s.showAlternatives, req.text, req.context || '', req.title || ''].join('\u0001');
    const hit = await cacheGet(key);
    if (hit) return post({ type: 'done', text: hit, cached: true, model: s.model });

    const t0 = performance.now();
    let ttft = 0, lastPost = 0;
    try {
      const text = await streamClaude(s, buildPrompt(req, s), ctrl.signal, (full) => {
        const now = performance.now();
        if (!ttft) ttft = now - t0;
        if (now - lastPost > 30) { lastPost = now; post({ type: 'delta', full }); } // 너무 잦은 렌더 방지
      });
      const out = text.trim();
      if (out) cacheSet(key, out);
      post({ type: 'done', text: out, ttft: Math.round(ttft), ms: Math.round(performance.now() - t0), model: s.model });
    } catch (e) {
      const msg = friendlyError(e, s);
      if (msg) post({ type: 'error', code: e.status || 'ERR', message: msg });
    }
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'openOptions') chrome.runtime.openOptionsPage();
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-hover') return;
  const { hoverEnabled } = await chrome.storage.local.get({ hoverEnabled: DEFAULTS.hoverEnabled });
  await chrome.storage.local.set({ hoverEnabled: !hoverEnabled });
  updateBadge(!hoverEnabled);
});

function updateBadge(hoverOn) {
  chrome.action.setBadgeText({ text: hoverOn ? '' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#888' });
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.hoverEnabled) updateBadge(ch.hoverEnabled.newValue);
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const s = await chrome.storage.local.get(DEFAULTS);
  updateBadge(s.hoverEnabled);
  if (reason === 'install' && !s.apiKey) chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(async () => {
  const s = await chrome.storage.local.get(DEFAULTS);
  updateBadge(s.hoverEnabled);
});
