# Claude 툴팁 번역 — 프로젝트 안내 (Claude Code용)

웹페이지에서 **단어에 마우스를 올리면(hover)** 또는 **드래그하면** LLM으로 문맥에 맞게 번역해 툴팁으로 보여주는 Chrome 확장(MV3).
현재는 **개인용**이 목표이고, 써보고 괜찮으면 **상업용(웹 스토어) 버전**을 같은 코드베이스에서 별도 빌드로 낸다.
자세한 로드맵은 `docs/PLAN.md` 참고.

## 핵심 요구사항
- 속도가 최우선. 단, 다의어는 앞뒤 문맥을 보고 적절히 의역해야 함 → 속도와 의역 품질의 균형이 핵심 설계 포인트
- UI 문구는 한국어. 기본 번역 방향: → 한국어 (이미 한국어면 → 영어)

## 현재 상태 (0단계 완료: provider 구조 + 에디션 빌드)
```
src/        확장 진입점·정적 파일: background.js, content.js, options.*, popup.*, ui.css, icons/, manifest.json(베이스)
core/       settings.js(DEFAULTS·EDITION), prompts.js, provider.js(인터페이스·ProviderError), engines.js(선택 로직), cache.js
providers/  anthropic-api.js(구현됨), chrome-builtin.js·claude-cli.js(1단계용 자리, available()=false)
editions/   personal.json, store.json — providers 목록, manifest 덮어쓰기, 기본 설정
scripts/    build.mjs(esbuild → dist/<에디션>), check-store.mjs, edition-rules.mjs(개인용 전용 목록)
tests/      e2e.mjs
```
- **확장 로드는 루트가 아니라 `dist/personal`** (`npm run build:personal`, 개발 중엔 `npm run dev`로 watch)
- 빌드: `src/*.js`를 esbuild로 번들. background/options/popup은 ESM, content는 IIFE. `__EDITION__`은 define으로 치환, `edition:providers`는 에디션 providers만 import하는 가상 모듈 → store 번들엔 claude-cli 코드가 물리적으로 없음
- 에디션 manifest = `src/manifest.json` + `editions/<이름>.json`의 `manifest`(permissions는 합집합) + `package.json` version
- background: port 1개 = 요청 1개(disconnect 시 abort). 요청 `{source:'hover'|'selection', mode, text, context, title}` → `engineFor(source)`로 provider 선택 → `available()` → 캐시(키에 provider id·cacheTag 포함) → `translate()`
- 설정 `hoverEngine` / `selectionEngine`: 저장된 id가 에디션에 없으면 첫 provider로 대체. 옵션 페이지에 엔진 선택 + 사용 가능 여부 표시
- content.js는 `CONTENT_KEYS`만 읽음(API 키를 content script로 가져가지 않음)
- 오류는 provider가 `ProviderError(message, {code, needsSetup})`로 던짐. `needsSetup`이면 툴팁에 "설정 열기"
- `apiBase`는 UI에 노출 안 된 테스트용 오버라이드
- 검사: `npm run check:store`(store 빌드 후 nativeMessaging·manifest key·`claude-cli`/`connectNative`/`claude -p` 문자열 검사). `build.mjs`도 store 에디션에 개인용 전용 provider가 있으면 빌드 거부
- `npm test` = check:store + e2e. e2e는 personal·store 두 빌드 각각에 대해 가짜 SSE 서버 + Playwright로 hover/드래그/더블클릭/캐시/엔진 분리/옵션/팝업 검증 (32개)
  - 확장 로드 시 headless는 `channel: 'chromium'` 필요
- CI 설정 파일은 아직 없음 → 원격 저장소 생기면 `npm ci && npx playwright install chromium && npm test`
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
