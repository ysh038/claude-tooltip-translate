# 로드맵

## 목표 구조
```
claude-tooltip-translate/
├─ src/                  확장 진입점(background/content/options/popup) + 정적 파일
├─ core/                 공통: 설정, 프롬프트, 캐시, provider 인터페이스, 엔진 선택
├─ providers/
│  ├─ chrome-builtin     Chrome 내장 Translator (무료·즉시, 직역)
│  ├─ claude-cli         claude -p 중계 (개인용 전용)
│  ├─ anthropic-api      API 키 (현재 구현)
│  └─ openai, gemini     상업용 단계에서 추가
├─ native-host/          macOS native messaging host: claude -p 상주 (개인용 전용)
├─ editions/
│  ├─ personal.json      providers: chrome-builtin, claude-cli, anthropic-api / permissions: + nativeMessaging
│  └─ store.json         providers: chrome-builtin, anthropic-api, openai, gemini
├─ scripts/              build.mjs, check-store.mjs
└─ tests/
```

## 0단계 — 구조 정리 (반나절)
- [x] git 저장소 초기화, 현재 v1.0.0을 첫 커밋 + `personal-v1.0.0` 태그
- [x] 빌드 도구 도입(esbuild) + 에디션별 manifest 생성 → `dist/personal`, `dist/store`
- [x] provider 인터페이스 정의: `translate({mode, text, context, title}, {signal, onDelta}) → Promise<string>`, `available()`, `id/label`
- [x] 기존 Anthropic 호출을 `providers/anthropic-api`로 이동, 프롬프트는 `core/prompts`로
- [x] 설정에 "hover 엔진 / 드래그 엔진" 선택 추가
- [x] store 빌드에 `claude-cli`·`nativeMessaging`이 없는지 검사하는 스크립트(CI용) — `npm run check:store`
- [x] e2e 테스트를 새 구조에 맞게 갱신 (personal·store 각각)

## 1단계 — 개인용 엔진 (1~2일)
- [ ] `native-host/`: Node 스크립트 + host manifest + 설치 스크립트(`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`)
  - `claude -p` 상주(stream-json 입출력), 요청 큐, N회마다 재시작, 실패 시 재기동
  - 확장 ID 고정을 위해 manifest에 `key` 넣기(개인용)
- [ ] `providers/claude-cli`: `chrome.runtime.connectNative`로 스트리밍 수신
- [ ] `providers/chrome-builtin`: Translator API (content script에서 직접 되는지, 안 되면 offscreen document) 확인
- [ ] hover 2단계 표시: 내장 번역 즉시 → claude 결과 오면 교체 (UI에 단계 표시)
- [ ] 사용량 표시(오늘 요청 수), 지연 시간 기록

## 2단계 — 직접 사용 (2~4주)
측정: 하루 사용 횟수 / 체감 속도 / 오역 빈도 / 구독 한도 영향
→ 상업용 진행 여부 결정

## 3단계 — 상업용 (결정 시)
- BYOK provider(Anthropic·OpenAI·Gemini) + Chrome 내장 무료 기본값
- 온보딩, 사이트별 끄기, 개인정보처리방침, 웹 스토어 심사 대응
- 차별점: 문맥 기반 단어 사전 + 2단계 표시
- 자체 서버·구독 결제 모델은 반응 확인 후 별도 결정
