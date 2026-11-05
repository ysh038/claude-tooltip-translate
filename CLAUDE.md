# Claude 툴팁 번역 — 프로젝트 안내 (Claude Code용)

웹페이지에서 **단어에 마우스를 올리면(hover)** 또는 **드래그하면** LLM으로 문맥에 맞게 번역해 툴팁으로 보여주는 Chrome 확장(MV3).
현재는 **개인용**이 목표이고, 써보고 괜찮으면 **상업용(웹 스토어) 버전**을 같은 코드베이스에서 별도 빌드로 낸다.
자세한 로드맵은 `docs/PLAN.md` 참고.

## 핵심 요구사항
- 속도가 최우선. 단, 다의어는 앞뒤 문맥을 보고 적절히 의역해야 함 → 속도와 의역 품질의 균형이 핵심 설계 포인트
- UI 문구는 한국어. 기본 번역 방향: → 한국어 (이미 한국어면 → 영어)

## 현재 상태 (v1.0.0, 동작 확인됨)
- `manifest.json` MV3 / `background.js` 서비스워커: Anthropic Messages API **스트리밍** 호출, LRU 캐시(memory + storage.session), port 1개 = 요청 1개(disconnect 시 abort)
- `content.js`: Shadow DOM 툴팁, `caretPositionFromPoint` + `Intl.Segmenter`로 단어 감지, 문맥 추출(문장/±350자, 대상은 `⟦ ⟧`로 표시), hover/선택 처리
- `options.html/js`, `popup.html/js`, `settings.js`(공용 DEFAULTS), `ui.css`, `icons/`
- `settings.js`의 `apiBase`는 UI에 노출 안 된 테스트용 오버라이드
- `tests/e2e.mjs`: 가짜 SSE 서버 + Playwright로 hover/드래그/더블클릭/캐시/옵션 테스트 검증 완료
  - 확장 로드 시 headless는 `channel: 'chromium'` 필요
- **실제 Anthropic API 키로는 아직 테스트 안 함**

## 확정된 결정
1. **개인용 먼저, 상업용은 투트랙.** 개인용 2~4주 사용 후 상업 버전 여부 결정
2. **번역 엔진을 교체 가능한 구조(provider)로 리팩터링**: `chrome-builtin`, `claude-cli`, `anthropic-api` (+ 상업용에서 openai, gemini)
3. **에디션은 브랜치가 아니라 빌드 설정으로 구분**: `build:personal` / `build:store`
4. **`claude-cli` provider와 native host는 개인용 빌드에만.** store 빌드에 섞이면 CI에서 실패하게 할 것
   - 이유: Anthropic은 Free/Pro/Max 구독 OAuth를 다른 제품·도구·Agent SDK에서 쓰는 것과, 구독 자격증명으로 사용자 요청을 대신 처리하는 것을 금지(2026-02). 공식 Claude Code 바이너리에 본인 구독으로 로그인하는 건 허용되지만, 스크립트 자동 호출은 문서상 명시되지 않은 회색지대 → 개인용에서만 본인 판단으로 사용
   - https://code.claude.com/docs/en/legal-and-compliance
5. **개인용 hover = 2단계 표시**: Chrome 내장 Translator로 즉시 직역 → `claude -p`의 문맥 기반 결과로 교체
6. **개인용 드래그 번역 = `claude -p`**: native messaging host가 프로세스를 상주시켜(`--input-format stream-json --output-format stream-json`) 스트리밍, 20~30 요청마다 재시작(대화 누적 방지)

## 실측 (사용자 MacBook, 2026-11-05)
| 방식 | 시간 |
|---|---|
| `claude -p "..."` 기본 | 5.4s |
| `claude -p --model haiku --system-prompt "..." --tools "" --strict-mcp-config "..."` | 3.45s |
| 위 옵션, 인증 실패로 모델 호출 없이 종료 (= 시동 비용) | 1.6s |
| API 직접 호출 (Haiku) | 약 1s (추정, 미측정) |
→ 상주 프로세스로 시동 비용 제거 시 드래그 번역 ~2s 목표. hover에는 `claude -p` 단독으로는 부적합.
→ 옵션 플래그 이름은 Claude Code 버전마다 다를 수 있으니 `claude --help`로 확인.

## 브랜치 / 릴리스 규칙
- `main`: 항상 동작. 개인용 빌드는 매일 main에서
- `feat/*`, `fix/*`: 짧게 쓰고 바로 main에 머지
- 태그: `personal-vX.Y.Z`, `store-vX.Y.Z`
- `release/store`: 웹 스토어 심사 중 핫픽스가 필요할 때만 잠깐 생성 → main으로 머지

## 작업 시 주의
- 확장 코드에는 런타임 외부 의존성 없이(번들러는 OK). 툴팁 스타일은 Shadow DOM 안에서만
- 사용자 API 키는 `chrome.storage.local`에만. 로그에 찍지 않기
- 변경 후 `tests/e2e.mjs`가 통과해야 함
