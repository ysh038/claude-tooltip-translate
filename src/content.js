import { DEFAULTS as ALL_DEFAULTS, CONTENT_KEYS, pick } from '../core/settings.js';

(() => {
  if (window.__claudeTipLoaded) return;
  window.__claudeTipLoaded = true;

  /* ───────────── 설정 ───────────── */
  const DEFAULTS = pick(ALL_DEFAULTS, CONTENT_KEYS);
  let S = { ...DEFAULTS };
  try {
    chrome.storage.local.get(DEFAULTS, (v) => { S = { ...S, ...v }; });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      for (const k in ch) if (k in DEFAULTS) S[k] = ch[k].newValue;
      if (!S.hoverEnabled && tip.src === 'hover') hide();
    });
  } catch { return; }

  // 목표 언어 문자 판별 (라틴 문자권은 구분 불가 → 판별 안 함)
  const SCRIPT_RE = {
    ko: /[가-힣ㄱ-ㆎ]/,
    ja: /[぀-ヿ]/,
    'zh-CN': /[一-鿿]/,
    'zh-TW': /[一-鿿]/,
    ru: /[Ѐ-ӿ]/
  };

  const wordSeg = new Intl.Segmenter(undefined, { granularity: 'word' });
  const sentSeg = new Intl.Segmenter(undefined, { granularity: 'sentence' });

  /* ───────────── 툴팁 UI (Shadow DOM으로 페이지 스타일과 격리) ───────────── */
  const CSS = `
    :host { all: initial; }
    .box, .fab {
      position: absolute; box-sizing: border-box; z-index: 1;
      font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Pretendard, "Malgun Gothic", "Segoe UI", sans-serif;
      --bg: #ffffff; --fg: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.10); --hover: rgba(0,0,0,.06); --accent: #c96442;
    }
    @media (prefers-color-scheme: dark) {
      .box, .fab { --bg: #2a2a2c; --fg: #f2f2f2; --muted: #a1a1a6; --line: rgba(255,255,255,.12); --hover: rgba(255,255,255,.08); --accent: #e08a6a; }
    }
    .box {
      width: max-content; min-width: 140px; max-width: min(380px, calc(100vw - 16px)); padding: 8px 12px 10px;
      background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.08);
      animation: in .12s ease-out;
    }
    .box.text { max-width: min(460px, calc(100vw - 16px)); }
    @keyframes in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
    .head { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--muted); margin-bottom: 3px; }
    .src { flex: 1 1 auto; min-width: 0; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .meta { margin-left: auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .btn { all: unset; cursor: pointer; padding: 0 5px; border-radius: 4px; color: var(--muted); font-size: 12px; line-height: 20px; }
    .btn:hover { background: var(--hover); color: var(--fg); }
    .body { white-space: pre-wrap; word-break: keep-all; overflow-wrap: anywhere; max-height: 50vh; overflow: auto; }
    .main { font-size: 15px; font-weight: 600; }
    .sub { font-size: 12.5px; color: var(--muted); margin-top: 3px; }
    .err { color: #d24c3a; font-size: 13px; }
    .link { all: unset; cursor: pointer; color: var(--accent); text-decoration: underline; font-size: 12.5px; margin-top: 6px; display: inline-block; }
    .dots { display: inline-flex; gap: 4px; padding: 6px 0 2px; }
    .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); opacity: .35; animation: b 1s infinite; }
    .dots i:nth-child(2) { animation-delay: .15s; } .dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes b { 0%, 100% { opacity: .25; } 50% { opacity: .9; } }
    .caret::after { content: "▍"; color: var(--accent); animation: b 1s infinite; }
    .fab {
      cursor: pointer; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600;
      background: var(--accent); color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,.2); user-select: none;
    }
    [hidden] { display: none !important; }
  `;

  let host, root, box, elSrc, elMeta, elBody, fab;
  const tip = { src: null, mode: null, port: null, reqId: 0, text: '', done: false, anchor: null, key: null, wordRect: null };

  function ensureUI() {
    if (host && host.isConnected) return;
    host = document.createElement('claude-tip-translate');
    host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="box" hidden>
        <div class="head"><span class="src"></span><span class="meta"></span>
          <button class="btn copy" title="복사">복사</button><button class="btn close" title="닫기 (Esc)">✕</button></div>
        <div class="body"></div>
      </div>
      <div class="fab" hidden>번역</div>`;
    (document.body || document.documentElement).appendChild(host);
    box = root.querySelector('.box');
    elSrc = root.querySelector('.src');
    elMeta = root.querySelector('.meta');
    elBody = root.querySelector('.body');
    fab = root.querySelector('.fab');
    root.querySelector('.close').addEventListener('click', hide);
    root.querySelector('.copy').addEventListener('click', copyText);
    fab.addEventListener('mousedown', (e) => e.preventDefault()); // 선택 해제 방지
    fab.addEventListener('click', () => {
      const p = fab._pending; fab.hidden = true;
      if (p) translate(p);
    });
  }

  function place() {
    const a = tip.anchor; if (!a || box.hidden) return;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = a.left + a.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, vw - bw - 8));
    let top = a.bottom + 8;
    if (top + bh > vh - 8 && a.top - bh - 8 > 8) top = a.top - bh - 8;
    // host는 문서 좌표(absolute) 기준
    const hr = host.getBoundingClientRect();
    box.style.left = (left - hr.left) + 'px';
    box.style.top = (top - hr.top) + 'px';
  }
  let placeRaf = 0;
  const schedulePlace = () => { if (!placeRaf) placeRaf = requestAnimationFrame(() => { placeRaf = 0; place(); }); };

  function render() {
    elBody.textContent = '';
    if (!tip.text) {
      elBody.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    } else if (tip.mode === 'word') {
      const lines = tip.text.split('\n').map((l) => l.trim()).filter(Boolean);
      lines.forEach((l, i) => {
        const d = document.createElement('div');
        d.className = i === 0 ? 'main' : 'sub';
        d.textContent = l;
        elBody.appendChild(d);
      });
      if (!tip.done) elBody.lastChild.classList.add('caret');
    } else {
      const d = document.createElement('div');
      d.textContent = tip.text;
      if (!tip.done) d.className = 'caret';
      elBody.appendChild(d);
    }
    schedulePlace();
  }

  function showError(message, needsSetup) {
    elBody.textContent = '';
    const d = document.createElement('div');
    d.className = 'err'; d.textContent = message;
    elBody.appendChild(d);
    if (needsSetup) {
      const b = document.createElement('button');
      b.className = 'link'; b.textContent = '설정 열기';
      b.addEventListener('click', () => { try { chrome.runtime.sendMessage({ type: 'openOptions' }); } catch {} });
      elBody.appendChild(b);
    }
    elMeta.textContent = '';
    schedulePlace();
  }

  async function copyText() {
    const t = tip.text; if (!t) return;
    try { await navigator.clipboard.writeText(t); }
    catch {
      const ta = document.createElement('textarea'); ta.value = t; root.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    const b = root.querySelector('.copy'); b.textContent = '복사됨'; setTimeout(() => (b.textContent = '복사'), 900);
  }

  /* ───────────── 요청 ───────────── */
  function cancel() {
    tip.reqId++;
    if (tip.port) { try { tip.port.disconnect(); } catch {} tip.port = null; }
  }

  function hide() {
    cancel();
    clearTimeout(hideTimer); hideTimer = 0;
    if (box) box.hidden = true;
    if (fab) fab.hidden = true;
    tip.src = tip.mode = tip.key = tip.wordRect = null;
  }

  function translate({ src, mode, text, context, anchor, key, wordRect }) {
    cancel();
    ensureUI();
    fab.hidden = true;
    Object.assign(tip, { src, mode, anchor, key, wordRect, text: '', done: false });
    box.className = 'box ' + mode;
    box.hidden = false;
    elSrc.textContent = mode === 'word' ? text : '선택 번역';
    elSrc.title = text;
    elMeta.textContent = '';
    render();

    let port;
    try { port = chrome.runtime.connect({ name: 'translate' }); }
    catch { showError('확장 프로그램이 업데이트되었습니다. 페이지를 새로고침해 주세요.'); return; }
    tip.port = port;
    const id = tip.reqId;
    port.onMessage.addListener((m) => {
      if (id !== tip.reqId) return;
      if (m.type === 'delta') { tip.text = m.full; render(); }
      else if (m.type === 'done') {
        tip.text = m.text; tip.done = true; render();
        elMeta.textContent = m.cached ? '캐시' : `${(m.ttft / 1000).toFixed(1)}s / ${(m.ms / 1000).toFixed(1)}s`;
        const who = [m.engine, m.model].filter(Boolean).join(' · ');
        elMeta.title = (m.cached ? '이전 결과 재사용' : '첫 글자 / 전체 시간') + (who ? ' · ' + who : '');
        try { port.disconnect(); } catch {}
        tip.port = null;
      } else if (m.type === 'error') {
        showError(m.message, m.needsSetup);
        try { port.disconnect(); } catch {}
        tip.port = null;
      }
    });
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; });
    port.postMessage({ source: src, mode, text, context, title: (document.title || '').slice(0, 100) });
  }

  /* ───────────── 텍스트/문맥 유틸 ───────────── */
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
    return !!el.isContentEditable;
  }

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p && { node: p.offsetNode, offset: p.offset };
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r && { node: r.startContainer, offset: r.startOffset };
    }
    return null;
  }

  // 마우스 좌표 아래의 단어 찾기 (실제로 글자 위에 있을 때만)
  function wordAt(x, y) {
    const c = caretAt(x, y);
    if (!c || !c.node || c.node.nodeType !== 3) return null;
    const node = c.node, data = node.data, off = c.offset;
    const from = Math.max(0, off - 64), to = Math.min(data.length, off + 64);
    const r = document.createRange();
    for (const seg of wordSeg.segment(data.slice(from, to))) {
      const s = from + seg.index, e = s + seg.segment.length;
      if (e < off || s > off) continue;
      if (!seg.isWordLike) continue;
      r.setStart(node, s); r.setEnd(node, e);
      for (const rc of r.getClientRects()) {
        if (x >= rc.left - 1 && x <= rc.right + 1 && y >= rc.top - 1 && y <= rc.bottom + 1) {
          return { node, start: s, end: e, word: seg.segment, rect: rc };
        }
      }
    }
    return null;
  }

  function blockOf(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const d = getComputedStyle(el).display;
      if (d && !d.startsWith('inline') && d !== 'contents') return el;
      el = el.parentElement;
    }
    return el || document.body;
  }

  const squash = (s) => s.replace(/\s+/g, ' ');

  // 대상 텍스트 주변 문맥 추출 (대상은 ⟦ ⟧로 표시)
  function contextFor(startNode, startOffset, length) {
    if (S.contextMode === 'none') return '';
    try {
      const block = blockOf(startNode);
      const pre = document.createRange();
      pre.setStart(block, 0); pre.setEnd(startNode, startOffset);
      const full = block.textContent || '';
      const a = pre.toString().length, b = Math.min(full.length, a + length);
      let s0, s1;
      if (S.contextMode === 'paragraph') {
        s0 = Math.max(0, a - 350); s1 = Math.min(full.length, b + 350);
      } else {
        const wFrom = Math.max(0, a - 500), wTo = Math.min(full.length, b + 500);
        s0 = a; s1 = b;
        for (const seg of sentSeg.segment(full.slice(wFrom, wTo))) {
          const ss = wFrom + seg.index, se = ss + seg.segment.length;
          if (se > a && ss < b) { s0 = Math.min(s0, ss); s1 = Math.max(s1, se); }
        }
      }
      if (s1 - s0 > 700) { s0 = Math.max(s0, a - 300); s1 = Math.min(s1, b + 300); }
      const ctx = (squash(full.slice(s0, a)) + '⟦' + squash(full.slice(a, b)) + '⟧' + squash(full.slice(b, s1))).trim();
      // 문맥이 대상 자체와 거의 같으면 보낼 필요 없음
      return ctx.length <= length + 4 ? '' : ctx;
    } catch { return ''; }
  }

  function isSingleWord(text) {
    if (text.length > 40 || /\s/.test(text)) return false;
    let n = 0;
    for (const seg of wordSeg.segment(text)) if (seg.isWordLike && ++n > 1) return false;
    return n === 1;
  }

  const inTargetScript = (t) => { const re = SCRIPT_RE[S.targetLang]; return re ? re.test(t) : false; };

  /* ───────────── 1) 마우스 오버 번역 ───────────── */
  let hoverTimer = 0, hideTimer = 0;
  let last = { x: -1, y: -1, target: null };
  const MOD_KEY = { alt: 'Alt', shift: 'Shift', ctrl: 'Control', meta: 'Meta' };
  const modHeld = (e) => ({ alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey })[S.hoverModifier];

  function overOurUI(target) { return host && target === host; }

  function hoverAt(x, y, target) {
    if (!S.hoverEnabled) return;
    if (overOurUI(target) || isEditable(target)) return;
    if (tip.src === 'selection' && box && !box.hidden) return; // 선택 번역 보는 중엔 방해 X
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;

    const w = wordAt(x, y);
    if (!w) return;
    const key = w.word + '|' + w.start;
    if (tip.src === 'hover' && tip.key === key && !box.hidden) return;
    if (/^[\d\s.,:%\-+/]+$/.test(w.word)) return;
    if (S.hoverSkipTarget && inTargetScript(w.word)) return;

    translate({
      src: 'hover', mode: 'word', text: w.word,
      context: contextFor(w.node, w.start, w.end - w.start),
      anchor: w.rect, wordRect: w.rect, key
    });
  }

  function insideRect(x, y, r, pad = 4) {
    return r && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  document.addEventListener('mousemove', (e) => {
    last = { x: e.clientX, y: e.clientY, target: e.target };

    // 오버 툴팁: 단어/툴팁 밖으로 나가면 잠시 후 닫기
    if (tip.src === 'hover' && box && !box.hidden) {
      if (overOurUI(e.target) || insideRect(e.clientX, e.clientY, tip.wordRect)) {
        clearTimeout(hideTimer); hideTimer = 0;
      } else if (!hideTimer) {
        hideTimer = setTimeout(() => { hideTimer = 0; if (tip.src === 'hover') hide(); }, 280);
      }
    }

    clearTimeout(hoverTimer);
    if (!S.hoverEnabled || e.buttons) return;
    if (S.hoverModifier !== 'none' && !modHeld(e)) return;
    const delay = S.hoverModifier === 'none' ? S.hoverDelay : 120;
    const { clientX: x, clientY: y, target } = e;
    hoverTimer = setTimeout(() => hoverAt(x, y, target), delay);
  }, { passive: true, capture: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (box && (!box.hidden || !fab.hidden)) hide(); return; }
    // 수정키 모드: 마우스가 멈춘 상태에서 키를 누르면 즉시 번역
    if (S.hoverEnabled && S.hoverModifier !== 'none' && e.key === MOD_KEY[S.hoverModifier] && !e.repeat && last.x >= 0) {
      hoverAt(last.x, last.y, last.target);
    }
  }, true);

  window.addEventListener('scroll', () => { if (tip.src === 'hover') hide(); }, { passive: true, capture: true });
  window.addEventListener('blur', () => { clearTimeout(hoverTimer); });

  /* ───────────── 2) 드래그(선택) 번역 ───────────── */
  document.addEventListener('mousedown', (e) => {
    if (overOurUI(e.target) || (host && e.composedPath().includes(host))) return;
    clearTimeout(hoverTimer);
    if (box && (!box.hidden || !fab.hidden)) hide();
  }, true);

  document.addEventListener('mouseup', (e) => {
    if (!S.selectionEnabled || e.button !== 0) return;
    if (host && e.composedPath().includes(host)) return;
    const x = e.clientX, y = e.clientY, target = e.target;
    setTimeout(() => handleSelection(x, y, target), 10);
  }, true);

  function handleSelection(x, y, target) {
    let text = '', range = null;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && /^(text|search|url|email|)$/i.test(ae.type))) && ae.contains(target)) {
      try { text = ae.value.substring(ae.selectionStart, ae.selectionEnd); } catch {}
    } else {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      text = sel.toString();
      range = sel.getRangeAt(0);
    }
    text = text.trim();
    if (!text || text.length > 5000) return;
    if (/^[\d\s.,:%\-+/]+$/.test(text)) return;

    const single = isSingleWord(text);
    let context = '';
    if (range && (single || text.length < 200)) {
      const raw = range.toString();
      const lead = raw.length - raw.trimStart().length;
      context = contextFor(range.startContainer, range.startOffset + (range.startContainer.nodeType === 3 ? lead : 0), text.length);
    }
    const anchor = { left: x, width: 0, top: y - 12, bottom: y + 12 };
    const job = { src: 'selection', mode: single ? 'word' : 'text', text, context, anchor, key: 'sel|' + text };

    if (tip.src === 'selection' && tip.key === job.key && box && !box.hidden) return;
    clearTimeout(hoverTimer);

    if (S.selectionMode === 'button') {
      ensureUI();
      if (tip.src === 'hover') hide();
      fab._pending = job;
      fab.hidden = false;
      const hr = host.getBoundingClientRect();
      fab.style.left = (x + 8 - hr.left) + 'px';
      fab.style.top = (y + 12 - hr.top) + 'px';
    } else {
      translate(job);
    }
  }
})();
