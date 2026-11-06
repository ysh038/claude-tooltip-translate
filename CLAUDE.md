# Claude 툴팁 번역 — 프로젝트 안내 (Claude Code용)

웹페이지에서 **단어에 마우스를 올리면(hover)** 또는 **드래그하면** LLM으로 문맥에 맞게 번역해 툴팁으로 보여주는 Chrome 확장(MV3).
현재는 **개인용**이 목표이고, 써보고 괜찮으면 **상업용(웹 스토어) 버전**을 같은 코드베이스에서 별도 빌드로 낸다.
자세한 로드맵은 `docs/PLAN.md` 참고.

## 핵심 요구사항
- 속도가 최우선. 단, 다의어는 앞뒤 문맥을 보고 적절히 의역해야 함 → 속도와 의역 품질의 균형이 핵심 설계 포인트
- UI 문구는 한국어. 기본 번역 방향: → 한국어 (이미 한국어면 → 영어)

## 현재 상태 (0단계 완료 + 1단계 claude -p 엔진 동작)
```
src/        확장 진입점·정적 파일: background.js, content.js, options.*, popup.*, ui.css, icons/, manifest.json(베이스)
core/       settings.js(DEFAULTS·EDITION), prompts.js, provider.js(인터페이스·ProviderError), engines.js(선택 로직), cache.js
providers/  anthropic-api.js, claude-cli.js(구현됨) / chrome-builtin.js(1단계용 자리, available()=false)
native-host/ host.mjs(native messaging), claude-pool.mjs(claude -p 프로세스 풀), install.mjs — 개인용 전용
editions/   personal.json, store.json — providers 목록, manifest 덮어쓰기, 기본 설정
scripts/    build.mjs(esbuild → dist/<에디션>), check-store.mjs, edition-rules.mjs(개인용 전용 목록), ext-id.mjs
tests/      e2e.mjs, host.test.mjs, fake-claude.mjs(가짜 claude — 구독 사용량 안 씀)
```
- **확장 로드는 루트가 아니라 `dist/personal`** (`npm run build:personal`, 개발 중엔 `npm run dev`로 watch)
- 빌드: `src/*.js`를 esbuild로 번들. background/options/popup은 ESM, content는 IIFE. `__EDITION__`은 define으로 치환, `edition:providers`는 에디션 providers만 import하는 가상 모듈 → store 번들엔 claude-cli 코드가 물리적으로 없음
- 에디션 manifest = `src/manifest.json` + `editions/<이름>.json`의 `manifest`(permissions는 합집합) + `package.json` version
- background: port 1개 = 요청 1개(disconnect 시 abort). 요청 `{source:'hover'|'selection', mode, text, context, title}` → `engineFor(source)`로 provider 선택 → `available()` → 캐시(키에 provider id·cacheTag 포함) → `translate()`
- 설정 `hoverEngine` / `selectionEngine`: 저장된 id가 에디션에 없으면 첫 provider로 대체. 옵션 페이지에 엔진 선택 + 사용 가능 여부 표시
- content.js는 `CONTENT_KEYS`만 읽음(API 키를 content script로 가져가지 않음)
- 드래그 최대 `MAX_SELECTION` = 20,000자. 넘으면 툴팁에 안내 (예전엔 5,000자 초과를 조용히 무시해서 "많이 선택하면 아예 안 됨"으로 보였음)
- 툴팁 오른쪽 위 시간은 **content script에서** 요청 시작부터 측정 (확장 내부 통신 포함, hover 대기는 제외하고 title에 따로 표시). 요청 중엔 0.1초마다 `1.2s`처럼 실시간 갱신, 끝나면 최종 시간 하나만 (첫 글자 시간은 title에). `SLOW_MS`(3초) 넘으면 시간이 강조색 + 본문 아래 ⏳ 안내(글자가 나오는 중인지, 10초 넘게 무응답인지에 따라 문구 다름), 완료·오류·취소 시 사라짐
- host 시간 초과는 **무응답 45초**(출력이 계속 오면 오래 걸려도 OK). 취소도 host.log에 `req cancel`로 남음
- 오류는 provider가 `ProviderError(message, {code, needsSetup})`로 던짐. `needsSetup`이면 툴팁에 "설정 열기"
- `apiBase`는 UI에 노출 안 된 테스트용 오버라이드
- provider는 `settings`(선택 항목)·`help`를 선언하면 옵션 페이지에 섹션이 자동 생성됨 → 개인용 전용 문구가 공용 HTML에 들어가지 않게
- **개인용 기본 엔진 = `claude-cli`** (hover·드래그 둘 다, 모델 `haiku`) — 사용자가 지금 API 키를 쓸 수 없음
- claude-cli 흐름: background가 `connectNative('dev.claude_tooltip_translate.cli')` 포트 1개를 계속 열고 요청을 id로 구분 → host가 프로세스 풀로 처리
  - 개인용 manifest에 `key` 고정 → 확장 ID `jholkpnnifillalfkbgodapgegfadipe` (host manifest의 allowed_origins와 일치해야 함)
  - 설치: `npm run host:install` → host 코드를 `~/Library/Application Support/claude-tooltip-translate/host/`로 **복사**하고 거기에 `config.json`(claude 절대 경로)·`run.sh`(node 경로, stderr → 로그) 생성, 브라우저별 `NativeMessagingHosts/*.json` 등록. **`native-host/*.mjs`를 고치면 다시 실행해야 반영됨**
  - 복사하는 이유: 저장소가 `~/Desktop`에 있으면 macOS(TCC)가 Chrome이 띄운 프로세스의 파일 읽기를 막아 "Native host has exited"가 남 (2026-11-05 실제 발생, 터미널에서 직접 실행하면 정상이라 헷갈림)
  - host 로그(메타데이터만, 번역 텍스트 X): `~/Library/Logs/claude-tooltip-translate/host.log`, 시작 실패 등 stderr: `host.stderr.log`
  - 터미널에서 바로 확인: `npm run host:test -- "문장"`
  - rate_limit_event(구독 한도 상태)는 `chrome.storage.session.cliRateLimit`에 저장만 해 둠 (표시는 아직)
- 검사: `npm run check:store`(store 빌드 후 nativeMessaging·manifest key·`claude-cli`/`connectNative`/`claude -p` 문자열 검사). `build.mjs`도 store 에디션에 개인용 전용 provider가 있으면 빌드 거부
- `npm test` = check:store + test:host(18개, 임시 HOME에 설치해 최소 환경 ping까지) + e2e(39개). e2e는 personal·store 두 빌드 각각에 대해 가짜 SSE 서버 + Playwright로 hover/드래그/더블클릭/캐시/엔진 분리/옵션/팝업, personal은 가짜 claude로 native host 경유 hover/드래그까지 검증
  - 확장 로드 시 headless는 `channel: 'chromium'` 필요
  - Chromium은 `<user-data-dir>/NativeMessagingHosts/`의 host manifest를 읽음 → 테스트는 임시 프로필에 등록 (사용자 Chrome 설정 안 건드림)
- CI 설정 파일은 아직 없음 → 원격 저장소 생기면 `npm ci && npx playwright install chromium && npm test`
- **실제 Anthropic API 키로는 아직 테스트 안 함** (claude -p는 임시 프로필 + 실제 claude로 확인함)

## 확정된 결정
1. **개인용 먼저, 상업용은 투트랙.** 개인용 2~4주 사용 후 상업 버전 여부 결정
2. **번역 엔진을 교체 가능한 구조(provider)로 리팩터링**: `chrome-builtin`, `claude-cli`, `anthropic-api` (+ 상업용에서 openai, gemini)
3. **에디션은 브랜치가 아니라 빌드 설정으로 구분**: `build:personal` / `build:store`
4. **`claude-cli` provider와 native host는 개인용 빌드에만.** store 빌드에 섞이면 CI에서 실패하게 할 것
   - 이유: Anthropic은 Free/Pro/Max 구독 OAuth를 다른 제품·도구·Agent SDK에서 쓰는 것과, 구독 자격증명으로 사용자 요청을 대신 처리하는 것을 금지(2026-02). 공식 Claude Code 바이너리에 본인 구독으로 로그인하는 건 허용되지만, 스크립트 자동 호출은 문서상 명시되지 않은 회색지대 → 개인용에서만 본인 판단으로 사용
   - https://code.claude.com/docs/en/legal-and-compliance
5. **개인용 hover = 2단계 표시**: Chrome 내장 Translator로 즉시 직역 → `claude -p`의 문맥 기반 결과로 교체
6. **개인용 hover·드래그 번역 = `claude -p`, 요청 1개 = 프로세스 1개 + 대기 프로세스 미리 띄우기** (2026-11-05 변경)
   - (모델, 시스템 프롬프트)별로 `claude -p --input-format stream-json …` 프로세스를 1개씩 미리 띄워 둠 → 요청이 오면 그 프로세스에 보내고, `assistant` 이벤트(답 완성)에서 바로 결과 반환 → 직후 `rate_limit_event`만 받고(최대 300ms) 종료 → 새 대기 프로세스 보충
   - 원래 계획(한 프로세스 상주, 20~30회마다 재시작)에서 바꾼 이유: 옵션을 줄이니 시동 비용이 0.3s로 작아졌고, 한 프로세스에 계속 보내면 답 뒤의 `post_turn_summary`(추가 모델 호출, ~1.5s)가 끝나야 다음 요청을 받음. 프로세스를 바로 끝내면 문맥 누적·추가 호출·취소 처리가 모두 해결됨
   - 취소 = 해당 프로세스 종료. 15분 안 쓰면 대기 프로세스 정리
   - 사용 옵션: `-p --model <m> --system-prompt <s> --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --disable-slash-commands --no-chrome --input-format stream-json --output-format stream-json --verbose --include-partial-messages`, 빈 임시 폴더에서 실행
   - `--bare`는 OAuth(구독 로그인)를 읽지 않으므로 쓸 수 없음

## 실측 (사용자 MacBook, 2026-11-05)
| 방식 | 시간 |
|---|---|
| `claude -p "..."` 기본 | 5.4s |
| `claude -p --model haiku --system-prompt "..." --tools "" --strict-mcp-config "..."` | 3.45s |
| 위 옵션, 인증 실패로 모델 호출 없이 종료 (= 시동 비용) | 1.6s |
| API 직접 호출 (Haiku) | 약 1s (추정, 미측정) |
| 위 옵션 + `--setting-sources "" --no-session-persistence …` stream-json, 새 프로세스에 바로 요청 | 첫 글자 1.2~1.4s / 완성 1.5~1.8s (init 0.3s) |
| 같은 옵션, **미리 띄워 둔 프로세스**에 요청 | 첫 글자 0.6s / 완성 0.8~1.0s |
| 확장 전체 경로(임시 프로필, 실제 claude, haiku) hover | 멈춘 뒤 표시까지 ~1.5s (hover 대기 0.45s 포함) |
| 확장 전체 경로 드래그 | ~1.3s |
| 확장 전체 경로, 드래그 5,641자 (실제 claude, haiku) | 첫 글자 1.9s / 완료 9.3s, 끝까지 잘림 없음 |
| **실제 Chrome**(사용자 프로필) 첫 4건, host.log 기준 | 첫 글자 0.7~1.7s(한 번 3.1s) / 완성 1.3~3.1s, 모두 대기 프로세스 사용 |
→ 대기 프로세스를 쓰면 API 직접 호출과 비슷. hover에도 쓸 만함 (Chrome 내장 번역 2단계 표시는 선택 사항으로 남김)
→ 한 프로세스에 연속으로 보내면 답 뒤 post_turn_summary 1.5s 때문에 처리량이 요청당 ~3s
→ 옵션 플래그 이름은 Claude Code 버전마다 다를 수 있으니 `claude --help`로 확인.

## 브랜치 / 릴리스 규칙
- `main`: 항상 동작. 개인용 빌드는 매일 main에서
- `feat/*`, `fix/*`: 짧게 쓰고 바로 main에 머지
- 태그: `personal-vX.Y.Z`, `store-vX.Y.Z`
- `release/store`: 웹 스토어 심사 중 핫픽스가 필요할 때만 잠깐 생성 → main으로 머지

## 작업 시 주의
- 확장 코드에는 런타임 외부 의존성 없이(번들러는 OK). 툴팁 스타일은 Shadow DOM 안에서만
- 사용자 API 키는 `chrome.storage.local`에만. 로그에 찍지 않기
- 변경 후 `npm test`가 통과해야 함
- native host는 stdout이 Chrome과의 통신 채널 → `console.log` 금지, 로그는 파일로. 번역 텍스트(페이지 내용)는 로그에 남기지 않기
