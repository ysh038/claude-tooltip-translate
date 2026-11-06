// 번역 엔진(provider) 인터페이스
//
// 각 provider 모듈은 아래 모양의 객체를 default export 한다.
//
// {
//   id: 'anthropic-api',              // 설정에 저장되는 값. 바꾸지 말 것
//   label: 'Claude API (API 키)',      // 설정 화면에 보이는 이름
//   available(settings) → Promise<{ ok: boolean, reason?: string }>
//       번역 가능한 상태인지. ok=false면 reason을 사용자에게 그대로 보여준다(한국어)
//   translate(req, { signal, onDelta, settings }) → Promise<string>
//       req: TranslateRequest. onDelta(fullTextSoFar)로 스트리밍(선택).
//       signal이 abort되면 AbortError로 끝나야 한다.
//       사용자에게 보여줄 오류는 ProviderError로 던진다.
//   cacheTag?(settings) → string     // 같은 입력이라도 결과가 달라지는 설정(모델 등)
//   describe?(settings) → string     // 툴팁 메타에 표시 (예: 모델 이름)
//   models?: { key, choices: [{ value, label, hint }] }
//       고를 수 있는 모델 (각 계열의 최신 버전만). key = 저장되는 설정 이름.
//       설정 화면(select)과 툴바 팝업(세그먼트 버튼)에 자동으로 표시된다
//   help?: string                    // 설정 화면 provider 섹션에 보일 안내 문구
// }

/**
 * @typedef {object} TranslateRequest
 * @property {'word'|'text'} mode   단어 사전 모드 / 문장 번역 모드
 * @property {string} text          번역할 텍스트
 * @property {string} [context]     주변 문맥 (대상은 ⟦ ⟧로 표시)
 * @property {string} [title]       페이지 제목
 */

export class ProviderError extends Error {
  /**
   * @param {string} message      사용자에게 보여줄 한국어 메시지
   * @param {object} [opts]
   * @param {string|number} [opts.code]
   * @param {boolean} [opts.needsSetup]  true면 툴팁에 "설정 열기" 링크 표시
   */
  constructor(message, { code = 'ERR', needsSetup = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.needsSetup = needsSetup;
  }
}

const REQUIRED = ['id', 'label', 'available', 'translate'];

export function assertProvider(p) {
  for (const k of REQUIRED) if (!p || p[k] == null) throw new Error(`provider에 '${k}'가 없습니다: ${p?.id}`);
  return p;
}
