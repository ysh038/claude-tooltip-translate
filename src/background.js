import { DEFAULTS } from '../core/settings.js';
import { engineFor } from '../core/engines.js';
import { ProviderError } from '../core/provider.js';
import { cacheGet, cacheSet } from '../core/cache.js';

/* ───────────── 콘텐츠 스크립트와 통신 (port 1개 = 요청 1개) ─────────────
 * 요청: { source: 'hover'|'selection', mode: 'word'|'text', text, context?, title? }
 * 응답: { type: 'delta', full } … { type: 'done', text, cached?, ttft?, ms?, engine, model? }
 *       또는 { type: 'error', code, message, needsSetup? }
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate') return;
  const ctrl = new AbortController();
  let alive = true;
  port.onDisconnect.addListener(() => { alive = false; ctrl.abort(); });
  const post = (m) => { if (alive) try { port.postMessage(m); } catch {} };

  port.onMessage.addListener(async (req) => {
    const s = await chrome.storage.local.get(DEFAULTS);
    const provider = engineFor(req.source, s);
    const engine = provider.label;
    const model = provider.describe?.(s) || '';

    const av = await provider.available(s).catch((e) => ({ ok: false, reason: e.message }));
    if (!av.ok) return post({ type: 'error', code: 'NOT_READY', needsSetup: true, message: av.reason });

    const req2 = { mode: req.mode, text: req.text, context: req.context || '', title: req.title || '' };
    const key = [provider.id, provider.cacheTag?.(s) ?? '', req2.mode, s.targetLang, s.fallbackLang, s.showAlternatives,
      req2.text, req2.context, req2.title].join('\u0001');
    const hit = await cacheGet(key);
    if (hit) return post({ type: 'done', text: hit, cached: true, engine, model });

    const t0 = performance.now();
    let ttft = 0, lastPost = 0;
    try {
      const text = await provider.translate(req2, {
        signal: ctrl.signal,
        settings: s,
        onDelta: (full) => {
          const now = performance.now();
          if (!ttft) ttft = now - t0;
          if (now - lastPost > 30) { lastPost = now; post({ type: 'delta', full }); } // 너무 잦은 렌더 방지
        }
      });
      const out = text.trim();
      if (out) cacheSet(key, out);
      const ms = performance.now() - t0;
      post({ type: 'done', text: out, ttft: Math.round(ttft || ms), ms: Math.round(ms), engine, model });
    } catch (e) {
      if (e?.name === 'AbortError' || ctrl.signal.aborted) return;
      if (e instanceof ProviderError) post({ type: 'error', code: e.code, message: e.message, needsSetup: e.needsSetup });
      else post({ type: 'error', code: 'ERR', message: e?.message || String(e) });
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
  if (reason === 'install') {
    const ready = await Promise.all(['hover', 'selection'].map((src) => engineFor(src, s).available(s)))
      .then((r) => r.every((x) => x.ok)).catch(() => false);
    if (!ready) chrome.runtime.openOptionsPage();
  }
});
chrome.runtime.onStartup.addListener(async () => {
  const s = await chrome.storage.local.get(DEFAULTS);
  updateBadge(s.hoverEnabled);
});
