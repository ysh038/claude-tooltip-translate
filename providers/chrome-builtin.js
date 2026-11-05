// Chrome 내장 Translator API (무료·즉시, 직역) — 1단계에서 구현
// TODO(1단계): Translator API가 서비스워커에서 안 되면 offscreen document 또는 content script에서 호출
import { ProviderError } from '../core/provider.js';

export default {
  id: 'chrome-builtin',
  label: 'Chrome 내장 번역 (무료·직역)',
  async available() {
    return { ok: false, reason: 'Chrome 내장 번역은 아직 준비 중입니다 (1단계).' };
  },
  async translate() {
    throw new ProviderError('Chrome 내장 번역은 아직 준비 중입니다 (1단계).', { code: 'NOT_IMPLEMENTED', needsSetup: true });
  }
};
