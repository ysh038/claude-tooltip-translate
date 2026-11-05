// 개인용 빌드에만 들어갈 수 있는 항목 (CLAUDE.md "확정된 결정 4")
export const PERSONAL_ONLY_PROVIDERS = ['claude-cli'];
export const PERSONAL_ONLY_PERMISSIONS = ['nativeMessaging'];
// store 빌드 결과물에 나오면 안 되는 코드 패턴
export const FORBIDDEN_IN_STORE = [/claude-cli/, /connectNative/, /sendNativeMessage/, /nativeMessaging/, /claude -p/, /claude_tooltip_translate\.cli/];
