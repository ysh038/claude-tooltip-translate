// claude -p 중계 (native messaging host) — **개인용 빌드 전용**
// store 빌드에 이 파일이 들어가면 build.mjs / check-store.mjs가 실패한다. CLAUDE.md "확정된 결정 4" 참고.
//
// background 서비스워커에서 native 포트 1개를 계속 열어 두고 요청을 id로 구분한다.
// (포트가 열려 있는 동안 host와 미리 띄워 둔 claude 프로세스가 유지됨 — native-host/claude-pool.mjs)
import { buildPrompt } from '../core/prompts.js';
import { ProviderError } from '../core/provider.js';
import { EDITION } from '../core/settings.js';

const HOST = EDITION.nativeHost;
const PING_TIMEOUT_MS = 4000;

let port = null;
let lastError = '';
let pong = null;          // 마지막 pong (포트가 끊기면 초기화)
let pingWaiters = [];
let warmedKey = '';
let seq = 0;
const pending = new Map(); // id → { onDelta, resolve, reject }

function hostErrorText(raw) {
  if (/not found/i.test(raw)) return 'claude -p 중계 프로그램이 설치되지 않았습니다.\n터미널에서 프로젝트 폴더로 이동해 npm run host:install 을 실행한 뒤, 확장을 새로고침해 주세요.';
  if (/forbidden/i.test(raw)) return '중계 프로그램이 이 확장을 허용하지 않습니다(확장 ID 불일치).\nnpm run build:personal 후 npm run host:install 을 다시 실행해 주세요.';
  if (/failed to start/i.test(raw)) return '중계 프로그램을 시작하지 못했습니다.\nnpm run host:install 을 다시 실행해 주세요.';
  return `claude -p 중계 프로그램 연결이 끊겼습니다: ${raw}\nnpm run host:install 을 다시 실행해 보세요.\n로그: ~/Library/Logs/claude-tooltip-translate/ (host.log, host.stderr.log)`;
}

function connect() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    lastError = e.message;
    return null;
  }
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    lastError = chrome.runtime.lastError?.message || 'Native host has exited.';
    port = null; pong = null; warmedKey = '';
    const err = new ProviderError(hostErrorText(lastError), { code: 'HOST' });
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    pingWaiters.forEach((w) => w(null)); pingWaiters = [];
  });
  return port;
}

function onHostMessage(m) {
  if (m.type === 'pong') { pong = m; pingWaiters.forEach((w) => w(m)); pingWaiters = []; return; }
  if (m.type === 'rate_limit') { chrome.storage.session.set({ cliRateLimit: { ...m.info, at: Date.now() } }).catch(() => {}); return; }
  const p = pending.get(m.id);
  if (!p) return;
  if (m.type === 'delta') p.onDelta(m.full);
  else if (m.type === 'done') { pending.delete(m.id); p.resolve(m.text); }
  else if (m.type === 'error') { pending.delete(m.id); p.reject(toProviderError(m)); }
}

function toProviderError({ code, message = '' }) {
  if (code === 'NO_CLAUDE') return new ProviderError(message, { code });
  if (/log ?in|authenticat|oauth|credential/i.test(code + ' ' + message)) {
    return new ProviderError('Claude Code에 로그인되어 있지 않습니다.\n터미널에서 claude 를 실행해 로그인해 주세요.', { code: 'AUTH' });
  }
  if (/rate.?limit|usage limit|limit reached/i.test(code + ' ' + message)) {
    return new ProviderError(`Claude 구독 사용 한도에 도달했습니다.\n${message}`, { code: 'LIMIT' });
  }
  return new ProviderError(`claude -p 오류: ${message || code}`, { code });
}

function ping() {
  const p = connect();
  if (!p) return Promise.resolve(null);
  if (pong) return Promise.resolve(pong);
  return new Promise((resolve) => {
    const t = setTimeout(() => { pingWaiters = pingWaiters.filter((w) => w !== done); resolve(null); }, PING_TIMEOUT_MS);
    const done = (m) => { clearTimeout(t); resolve(m); };
    pingWaiters.push(done);
    if (pingWaiters.length === 1) { try { p.postMessage({ type: 'ping' }); } catch {} }
  });
}

// 현재 설정의 프롬프트로 대기 프로세스를 미리 띄워 둔다 (설정이 바뀌었을 때만)
function warm(s) {
  const jobs = ['word', 'text'].map((mode) => ({ model: s.cliModel, system: buildPrompt({ mode, text: '' }, s).system }));
  const key = JSON.stringify(jobs);
  if (key === warmedKey || !port) return;
  warmedKey = key;
  try { port.postMessage({ type: 'warm', jobs }); } catch {}
}

async function available(s) {
  const m = await ping();
  if (!m) return { ok: false, reason: hostErrorText(lastError || 'not found') };
  if (!m.ok) return { ok: false, reason: m.reason };
  warm(s);
  return { ok: true };
}

function translate(req, { signal, onDelta = () => {}, settings: s }) {
  const p = connect();
  if (!p) return Promise.reject(new ProviderError(hostErrorText(lastError), { code: 'HOST' }));
  const id = 'r' + (++seq);
  const { system, user } = buildPrompt(req, s);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      pending.delete(id);
      try { port?.postMessage({ type: 'cancel', id }); } catch {}
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      onDelta,
      resolve: (t) => { cleanup(); resolve(t); },
      reject: (e) => { cleanup(); reject(e); }
    });
    p.postMessage({ type: 'translate', id, model: s.cliModel, system, user });
  });
}

export default {
  id: 'claude-cli',
  label: 'Claude Code 구독 (claude -p)',
  available,
  translate,
  cacheTag: (s) => s.cliModel,
  describe: (s) => `claude -p · ${s.cliModel}`,
  // claude의 별칭(haiku/sonnet/opus)은 항상 그 계열의 최신 모델을 가리킨다
  // 실측(2026-11-06, 대기 프로세스, 단어 1개): 세 모델 모두 완성 ~1.2~1.7s. Opus는 구독 사용량을 더 많이 씀
  models: {
    key: 'cliModel',
    choices: [
      { value: 'haiku', label: 'Haiku', hint: '빠름 · 구독 사용량 적음 (권장)' },
      { value: 'sonnet', label: 'Sonnet', hint: '더 자연스러운 번역' },
      { value: 'opus', label: 'Opus', hint: '가장 정확 · 구독 사용량 많음' }
    ]
  },
  help: '처음 한 번 터미널에서 프로젝트 폴더로 이동해 npm run host:install 을 실행해야 합니다. 본인 Claude 구독으로 claude -p를 호출합니다.'
};
