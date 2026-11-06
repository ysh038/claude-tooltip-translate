// popup/options → background에 엔진 상태를 묻는다.
// (popup/options가 직접 provider.available()을 부르면 claude-cli는 그 페이지만의 native host와
//  대기 claude 프로세스를 따로 띄웠다가 페이지가 닫힐 때 버린다 → background의 host 하나만 쓰도록)
export async function engineStatus() {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'engineStatus' });
    if (r) return r;
  } catch (e) {
    return { hover: { ok: false, reason: e.message }, selection: { ok: false, reason: e.message } };
  }
  return { hover: { ok: false, reason: '확장 백그라운드 응답 없음' }, selection: { ok: false, reason: '확장 백그라운드 응답 없음' } };
}
