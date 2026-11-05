// Anthropic Messages API (사용자 API 키, 스트리밍)
import { buildPrompt } from '../core/prompts.js';
import { ProviderError } from '../core/provider.js';

const headers = (apiKey) => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true'
});

function friendly(status, message, s) {
  switch (status) {
    case 401: return new ProviderError('API 키가 유효하지 않습니다. 설정에서 확인해 주세요.', { code: 401, needsSetup: true });
    case 403: return new ProviderError('이 API 키로는 접근 권한이 없습니다.', { code: 403 });
    case 404: return new ProviderError(`모델을 찾을 수 없습니다: ${s.model}\n설정에서 모델을 다시 선택해 주세요.`, { code: 404, needsSetup: true });
    case 429: return new ProviderError('요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.', { code: 429 });
    case 529: return new ProviderError('Anthropic 서버가 과부하 상태입니다. 잠시 후 다시 시도해 주세요.', { code: 529 });
  }
  if (status >= 500) return new ProviderError(`Anthropic 서버 오류 (${status})`, { code: status });
  return new ProviderError(message || `HTTP ${status}`, { code: status || 'ERR' });
}

async function translate(req, { signal, onDelta = () => {}, settings: s }) {
  const { system, user, maxTokens } = buildPrompt(req, s);
  let res;
  try {
    res = await fetch(`${s.apiBase}/v1/messages`, {
      method: 'POST',
      signal,
      headers: headers(s.apiKey),
      body: JSON.stringify({
        model: s.model,
        max_tokens: maxTokens,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: user }],
        stream: true
      })
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ProviderError('네트워크 오류: API에 연결할 수 없습니다.', { code: 'NETWORK' });
  }

  if (!res.ok) {
    let msg;
    try { const j = await res.json(); msg = j.error?.message; } catch {}
    throw friendly(res.status, msg, s);
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
          throw friendly(0, ev.error?.message || 'stream error', s);
        }
      }
    }
  }
  return full;
}

/** 설정 화면의 "연결 테스트 · 모델 불러오기" — 모델 id 목록 (haiku 먼저) */
export async function listModels(apiKey, apiBase) {
  const res = await fetch(`${apiBase}/v1/models?limit=100`, { headers: headers(apiKey) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
  const ids = (j.data || []).map((m) => m.id);
  ids.sort((a, b) => (b.includes('haiku') - a.includes('haiku')));
  return ids;
}

export default {
  id: 'anthropic-api',
  label: 'Claude API (API 키)',
  async available(s) {
    return s.apiKey ? { ok: true } : { ok: false, reason: 'Claude API 키가 설정되지 않았습니다.' };
  },
  translate,
  cacheTag: (s) => s.model,
  describe: (s) => s.model
};
