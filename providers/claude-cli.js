// claude -p 중계 (native messaging host) — **개인용 빌드 전용**
// store 빌드에 이 파일이 들어가면 scripts/check-store.mjs가 실패한다. CLAUDE.md "확정된 결정 4" 참고.
// TODO(1단계): chrome.runtime.connectNative('<host>')로 native-host/와 stream-json 스트리밍
import { ProviderError } from '../core/provider.js';

export default {
  id: 'claude-cli',
  label: 'Claude Code 구독 (claude -p)',
  async available() {
    return { ok: false, reason: 'claude -p 중계는 아직 준비 중입니다 (1단계).' };
  },
  async translate() {
    throw new ProviderError('claude -p 중계는 아직 준비 중입니다 (1단계).', { code: 'NOT_IMPLEMENTED', needsSetup: true });
  }
};
