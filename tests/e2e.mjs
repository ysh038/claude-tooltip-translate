// 가짜 Anthropic SSE 서버 + Playwright로 확장 동작 검증 (personal / store 빌드 각각)
// 실행: npm i && npx playwright install chromium && npm run test:e2e
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { chromium } from 'playwright';
import { build, EDITIONS, loadEdition } from '../scripts/build.mjs';
import { checkStore } from '../scripts/check-store.mjs';
import { hostManifest, personalEdition, writeRunScript } from '../native-host/install.mjs';

const PORT = 8787;
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'ctt-e2e-'));
let failed = 0;
let prefix = '';
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + prefix + name + (ok || !extra ? '' : '  ' + extra)); if (!ok) failed++; };

let log = [];
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/v1/messages')) {
    let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
      const j = JSON.parse(body); log.push({ headers: req.headers, body: j });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' });
      const isWord = j.messages[0].content.startsWith('Word:');
      const out = isWord ? '강둑 (명사)\n은행 · 둑 · 비축' : '그녀는 강둑에 앉아 배들이 떠내려가는 것을 지켜보았다.';
      const parts = out.match(/.{1,4}/gs);
      res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
      const delay = j.messages[0].content.includes('SLOWTEXT') ? 4000 : 0; // 느린 응답 흉내
      let i = 0; setTimeout(() => { const t = setInterval(() => { if (i < parts.length) { res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: parts[i++] } })}\n\n`); } else { res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n'); res.end(); clearInterval(t); } }, 20); }, delay);
    });
    return;
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Geography notes</title><body style="font:20px serif;padding:40px">
  <p id="p1">She sat on the <b>bank</b> of the river and watched the boats drift by. Then she went home.</p>
  <p id="p2">The quick brown fox jumps over the lazy dog.</p>
  <p id="p3">한국어 문장은 무시되어야 합니다.</p>
  <p id="long" style="font-size:4px">${'The river bank was quiet in the morning. '.repeat(170)}</p>
  <p id="slow">SLOWTEXT this one takes a while to answer.</p>
  <div style="height:1600px"></div>
  <p id="huge" style="font-size:2px">${'Too much text to translate at once. '.repeat(600)}</p></body>`);
});

// 테스트용 빌드: localhost 호출 허용
async function buildForTest(edition) {
  const dir = await build(edition, { outdir: path.join(SP, edition), quiet: true });
  const mf = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8')); m.host_permissions.push(`http://localhost:${PORT}/*`);
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  return dir;
}

// 프로필 폴더에 native host 등록 (Chromium은 <user-data-dir>/NativeMessagingHosts를 읽음) — 가짜 claude 사용
function installTestHost(profile) {
  const fake = path.join(path.dirname(new URL(import.meta.url).pathname), 'fake-claude.mjs');
  fs.chmodSync(fake, 0o755);
  const runPath = path.join(SP, 'run-host.sh');
  writeRunScript(runPath, { nodeBin: process.execPath, env: {
    CTT_CLAUDE_BIN: fake, CTT_HOST_LOG: '0', FAKE_CLAUDE_LOG: path.join(SP, 'fake-claude.log'),
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`
  } });
  const { name, extId } = personalEdition();
  const dir = path.join(profile, 'NativeMessagingHosts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(hostManifest({ name, runPath, extId })));
  return extId;
}
const fakeClaudeMsgs = () => { try { return fs.readFileSync(path.join(SP, 'fake-claude.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.event === 'msg'); } catch { return []; } };

async function runSuite(edition) {
  prefix = `[${edition}] `;
  log = [];
  const ext = await buildForTest(edition);
  const profile = path.join(SP, 'profile-' + edition);
  const providers = loadEdition(edition).providers;
  const cli = providers[0] === 'claude-cli'; // 개인용: claude -p만 / store: Claude API가 기본
  const expectId = cli ? installTestHost(profile) : null;
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`], viewport: { width: 1000, height: 600 } });
  // 엔진에 상관없이 "번역 요청 수"와 "마지막 요청 내용"
  const calls = () => (cli ? fakeClaudeMsgs().length : log.length);
  const lastReq = () => (cli ? fakeClaudeMsgs().at(-1) : log.at(-1)?.body) || {};
  const lastContent = () => (cli ? lastReq().content : lastReq().messages?.[0].content) || '';
  try {
    let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
    if (expectId) check('personal build has fixed extension ID', sw.url().split('/')[2] === expectId);
    if (!cli) await sw.evaluate((port) => chrome.storage.local.set({ apiKey: 'test-key', apiBase: `http://localhost:${port}` }), PORT);
    const page = (await ctx.pages())[0] || await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);

    const tipText = () => page.evaluate(() => { const h = document.querySelector('claude-tip-translate'); if (!h) return null; const b = h.shadowRoot.querySelector('.box'); return { hidden: b.hidden, src: h.shadowRoot.querySelector('.src').textContent, body: h.shadowRoot.querySelector('.body').innerText, meta: h.shadowRoot.querySelector('.meta').textContent, link: !!h.shadowRoot.querySelector('.body .link') }; });
    const bankPos = await page.evaluate(() => { const b = document.querySelector('#p1 b').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    const hoverBank = async (wait = 1200) => { await page.mouse.move(bankPos.x - 5, bankPos.y); await page.mouse.move(bankPos.x, bankPos.y); await page.waitForTimeout(wait); };
    const moveAway = async () => { await page.mouse.move(900, 550); await page.waitForTimeout(500); };
    const clearTip = async () => { await page.mouse.click(900, 550); await page.waitForTimeout(200); };

    // hover "bank"
    await hoverBank(1500);
    const h1 = await tipText(); check('hover shows contextual meaning', h1 && !h1.hidden && h1.src === 'bank' && h1.body.startsWith('강둑'), JSON.stringify(h1));
    check('final time shown as seconds', /^\d+\.\ds$/.test(h1?.meta || ''), JSON.stringify(h1?.meta));
    check('context marks target word', /⟦bank⟧/.test(lastContent()));
    if (!cli) {
      const b = lastReq();
      check('API request: latest Haiku, thinking off, no temperature', b.model === 'claude-haiku-5-5' && b.thinking?.type === 'disabled' && !('temperature' in b), JSON.stringify({ model: b.model, thinking: b.thinking, t: b.temperature }));
    }
    // move away -> hide
    await moveAway();
    const h2 = await tipText(); check('hover tooltip hides on leave', h2.hidden);
    // hover korean -> no request
    const n0 = calls();
    const k = await page.evaluate(() => { const b = document.querySelector('#p3').getBoundingClientRect(); return { x: b.x + 30, y: b.y + b.height / 2 }; });
    await page.mouse.move(k.x, k.y); await page.waitForTimeout(900);
    check('korean word hover skipped', calls() - n0 === 0);
    // select sentence p1
    const p = await page.evaluate(() => { const b = document.querySelector('#p1').getBoundingClientRect(); return { x: b.x, y: b.y, height: b.height }; });
    const dragP1 = async () => { await page.mouse.move(p.x + 2, p.y + p.height / 2); await page.mouse.down(); await page.mouse.move(p.x + 500, p.y + p.height / 2, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(1200); };
    await dragP1();
    const s1 = await tipText(); check('selection translates', !s1.hidden && s1.src === '선택 번역' && s1.body.includes('강둑'));
    // dblclick word fox -> word mode
    const f = await page.evaluate(() => { const p = document.querySelector('#p2'); const r = document.createRange(); const t = p.firstChild; const i = t.data.indexOf('fox'); r.setStart(t, i); r.setEnd(t, i + 3); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.dblclick(f.x, f.y); await page.waitForTimeout(1200);
    const d1 = await tipText(); check('double-click uses word mode', !d1.hidden && d1.src === 'fox');
    // 긴 선택(5000자 초과)도 번역, 한도(20000자) 초과는 안내
    const selectAll = (id) => page.evaluate((id) => {
      const el = document.getElementById(id); const r = document.createRange(); r.selectNodeContents(el);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 300, clientY: 200, bubbles: true }));
      return sel.toString().length;
    }, id);
    await clearTip();
    const nL = calls();
    const longLen = await selectAll('long'); await page.waitForTimeout(1500);
    const l1 = await tipText();
    check('long selection (>5000 chars) is translated', longLen > 5000 && !l1.hidden && l1.body.includes('강둑') && calls() === nL + 1 && lastContent().length > 5000, `len=${longLen}`);
    await clearTip();
    const nH = calls();
    const hugeLen = await selectAll('huge'); await page.waitForTimeout(500);
    const g1 = await tipText();
    check('over-limit selection shows a message instead of nothing', hugeLen > 20000 && !g1.hidden && g1.body.includes('너무 깁니다') && calls() === nH, JSON.stringify(g1));
    await clearTip();
    // 느린 응답(4s): 경과 시간이 실시간으로 올라가고, 3초가 지나면 안내 → 끝나면 안내 사라지고 최종 시간
    const slowState = () => page.evaluate(() => { const r = document.querySelector('claude-tip-translate').shadowRoot; return { meta: r.querySelector('.meta').textContent, late: r.querySelector('.meta').classList.contains('late'), slow: r.querySelector('.slow').hidden ? null : r.querySelector('.slow').textContent, body: r.querySelector('.body').innerText }; });
    await selectAll('slow');
    await page.waitForTimeout(1500);
    const sw1 = await slowState();
    await page.waitForTimeout(2000);
    const sw2 = await slowState();
    check('elapsed time ticks while waiting', parseFloat(sw1.meta) >= 1.0 && parseFloat(sw1.meta) < 2.5 && parseFloat(sw2.meta) > parseFloat(sw1.meta) && !sw1.slow, JSON.stringify([sw1, sw2]));
    check('slow notice after 3s', parseFloat(sw2.meta) >= 3 && sw2.late && /오래 걸리고/.test(sw2.slow || ''), JSON.stringify(sw2));
    await page.waitForTimeout(3000);
    const sw3 = await slowState();
    check('notice cleared and final time shown when done', sw3.body.includes('강둑') && sw3.slow === null && !sw3.late && /^\d+\.\ds$/.test(sw3.meta) && parseFloat(sw3.meta) >= 3.5, JSON.stringify(sw3));
    await clearTip();
    // cache: hover bank again
    const n1 = calls();
    await hoverBank(900);
    const c1 = await tipText(); check('repeat hover served from cache', c1.meta === '캐시' && calls() - n1 === 0);
    await moveAway();

    // ── 툴팁 끌어서 옮기기 / 📌 고정 ──
    const boxRect = () => page.evaluate(() => { const r = document.querySelector('claude-tip-translate').shadowRoot; const b = r.querySelector('.box'); const rc = b.getBoundingClientRect(); return { x: Math.round(rc.left), y: Math.round(rc.top), pos: b.style.position, hidden: b.hidden, hint: r.querySelector('.pin').classList.contains('hint'), pinOn: r.querySelector('.pin').classList.contains('on') }; });
    const centerOf = (sel) => page.evaluate((sel) => { const el = document.querySelector('claude-tip-translate').shadowRoot.querySelector(sel); const rc = el.getBoundingClientRect(); return { x: rc.left + Math.min(20, rc.width / 2), y: rc.top + rc.height / 2 }; }, sel);
    const dragFrom = async (pt, dx, dy) => { await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.move(pt.x + dx / 2, pt.y + dy / 2, { steps: 4 }); await page.mouse.move(pt.x + dx, pt.y + dy, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150); };
    const pinStore = () => sw.evaluate(() => chrome.storage.local.get('tipPinned')).then((x) => x.tipPinned ?? null);
    await hoverBank(1500);
    const r0 = await boxRect();
    await dragFrom(await centerOf('.src'), 220, 140);
    const r1 = await boxRect();
    check('drag header moves tooltip (fixed position)', Math.abs(r1.x - r0.x - 220) <= 2 && Math.abs(r1.y - r0.y - 140) <= 2 && r1.pos === 'fixed' && !r1.hidden, JSON.stringify([r0, r1]));
    check('after an unpinned drag the pin button hints', r1.hint && !r1.pinOn);
    await page.mouse.move(950, 580); await page.waitForTimeout(600);
    check('moved hover tooltip stays after mouse leaves the word', !(await boxRect()).hidden);
    await page.evaluate(() => window.scrollBy(0, 200)); await page.waitForTimeout(300);
    const r2 = await boxRect();
    check('moved tooltip stays put on scroll (viewport-fixed)', !r2.hidden && r2.x === r1.x && r2.y === r1.y, JSON.stringify(r2));
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
    // 글자 부분을 끌면 이동이 아니라 글자 선택(복사용)
    const bodyPt = await centerOf('.body .main');
    await dragFrom({ x: bodyPt.x - 15, y: bodyPt.y }, 60, 0);
    const r3 = await boxRect();
    const selTxt = await page.evaluate(() => document.querySelector('claude-tip-translate').shadowRoot.getSelection?.().toString() || getSelection().toString());
    check('dragging the text selects it instead of moving the tooltip', r3.x === r2.x && r3.y === r2.y && selTxt.length > 0, JSON.stringify({ r3, selTxt }));
    // 📌 켜기 → 위치 저장, 다음 번역도 그 자리
    await page.click('claude-tip-translate >> .pin'); await page.waitForTimeout(200);
    const pinned = await pinStore();
    const r4 = await boxRect();
    check('pin saves current position', pinned && Math.abs(pinned.x - r4.x) <= 1 && Math.abs(pinned.y - r4.y) <= 1 && r4.pinOn, JSON.stringify({ pinned, r4 }));
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.mouse.dblclick(f.x, f.y); await page.waitForTimeout(1500);
    const r5 = await boxRect();
    check('pinned: next translation opens at the pinned spot', !r5.hidden && r5.x === pinned.x && r5.y === pinned.y && r5.pos === 'fixed', JSON.stringify({ r5, pinned, fox: f }));
    // 고정 상태에서 끌면 고정 위치가 바뀜
    await dragFrom(await centerOf('.src'), -120, 60);
    const pinned2 = await pinStore();
    check('dragging while pinned updates the pinned spot', pinned2 && Math.abs(pinned2.x - (pinned.x - 120)) <= 2 && Math.abs(pinned2.y - (pinned.y + 60)) <= 2, JSON.stringify(pinned2));
    // 다른 탭에도 적용 (설정 저장) → 해제하면 다시 글자 옆
    await page.click('claude-tip-translate >> .pin'); await page.waitForTimeout(200);
    check('unpin clears the saved spot', (await pinStore()) === null && !(await boxRect()).pinOn);
    await page.keyboard.press('Escape'); await clearTip();
    await hoverBank(1500);
    const r6 = await boxRect();
    check('unpinned: tooltip opens next to the word again', !r6.hidden && r6.pos === 'absolute' && r6.y > bankPos.y && r6.y - bankPos.y < 60, JSON.stringify({ r6, bankPos }));
    await moveAway();

    // 이 에디션에 없는 엔진 id가 저장돼 있으면 첫 provider로 대체
    await sw.evaluate(() => chrome.storage.local.set({ hoverEngine: 'no-such-engine' }));
    await page.waitForTimeout(100);
    await page.mouse.move(f.x, f.y - 40); await page.waitForTimeout(100);
    await hoverBank(1500);
    const u1 = await tipText(); check('unknown engine id falls back', !u1.hidden && u1.body.startsWith('강둑'));
    await moveAway();
    await sw.evaluate(() => chrome.storage.local.remove('hoverEngine'));

    if (providers.length > 1) {
      // 엔진 분리: hover = 아직 준비 중인 chrome-builtin → 설정 안내, 드래그는 계속 기본 엔진
      await sw.evaluate(() => chrome.storage.local.set({ hoverEngine: 'chrome-builtin' }));
      await page.waitForTimeout(100);
      const n2 = calls();
      await hoverBank(900);
      const e1 = await tipText();
      check('unavailable hover engine shows setup error', !e1.hidden && e1.body.includes('준비 중') && e1.link && calls() - n2 === 0);
      await moveAway();
      await dragP1();
      const s2 = await tipText(); check('selection engine independent of hover engine', !s2.hidden && s2.body.includes('강둑'));
      await clearTip();
      await sw.evaluate(() => chrome.storage.local.remove('hoverEngine'));
    }

    // 설정 페이지
    const extId = sw.url().split('/')[2];
    const op = await ctx.newPage(); await op.goto(`chrome-extension://${extId}/options.html`); await op.waitForTimeout(1200);
    const apiSectionHidden = await op.$eval('section[data-provider="anthropic-api"]', (el) => el.hidden);
    if (providers.length === 1) {
      check('single engine: no engine picker, name + status shown', (await op.isHidden('#engineMulti')) && (await op.textContent('#engineName')).includes('claude -p') && (await op.textContent('#engineStatus')).includes('사용 가능'), await op.textContent('#engineStatus'));
    } else {
      const engines = await op.$$eval('#hoverEngine option', (os) => os.map((o) => o.value));
      check('options lists edition engines', JSON.stringify(engines) === JSON.stringify(providers));
      check('options shows engine availability', (await op.textContent('#hoverEngineStatus')).includes('사용 가능'));
    }
    check('API section only in builds with the API engine', apiSectionHidden === !providers.includes('anthropic-api'));
    const modelKey = cli ? 'cliModel' : 'model';
    const modelOpts = await op.$$eval(`#${modelKey} option`, (os) => os.map((o) => o.value));
    check('options model select lists latest-only choices', JSON.stringify(modelOpts) === JSON.stringify(cli ? ['haiku', 'sonnet', 'opus'] : ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']), JSON.stringify(modelOpts));
    await op.click('#runTest'); await op.waitForTimeout(1500);
    check('options page test translation', (await op.textContent('#testOut')).includes('강둑'));
    if (providers.length > 1) {
      await op.selectOption('#selectionEngine', 'chrome-builtin'); await op.waitForTimeout(300);
      const st = await sw.evaluate(() => chrome.storage.local.get('selectionEngine'));
      check('options saves engine choice', st.selectionEngine === 'chrome-builtin' && (await op.textContent('#selectionEngineStatus')).includes('준비 중'));
      const pw = await ctx.newPage(); await pw.setViewportSize({ width: 280, height: 260 }); await pw.goto(`chrome-extension://${extId}/popup.html`); await pw.waitForTimeout(500);
      check('popup warns about unavailable engine', (await pw.textContent('#status')).includes('준비 중'));
      await pw.close();
      await sw.evaluate(() => chrome.storage.local.remove('selectionEngine'));
    }

    // 툴바 팝업: 모델 세그먼트 버튼
    const pp = await ctx.newPage(); await pp.setViewportSize({ width: 280, height: 300 }); await pp.goto(`chrome-extension://${extId}/popup.html`); await pp.waitForTimeout(800);
    const segs = await pp.$$eval('.seg button', (bs) => bs.map((b) => ({ t: b.textContent, on: b.getAttribute('aria-checked') })));
    check('popup shows one model picker (Haiku/Sonnet/Opus), Haiku selected', JSON.stringify(segs) === JSON.stringify([{ t: 'Haiku', on: 'true' }, { t: 'Sonnet', on: 'false' }, { t: 'Opus', on: 'false' }]), JSON.stringify(segs));
    check('popup status shows engine', (await pp.textContent('#status')).includes(cli ? 'claude -p · haiku' : 'claude-haiku-5-5'), await pp.textContent('#status'));
    await pp.click('.seg button:nth-child(2)'); await pp.waitForTimeout(800);
    const saved = await sw.evaluate((k) => chrome.storage.local.get(k), modelKey);
    const sonnet = cli ? 'sonnet' : 'claude-sonnet-5-5';
    check('popup model click saves and updates', saved[modelKey] === sonnet && (await pp.getAttribute('.seg button:nth-child(2)', 'aria-checked')) === 'true' && (await pp.textContent('#status')).includes(cli ? 'claude -p · sonnet' : sonnet) && (await pp.textContent('.phint')).includes('자연스러운'));
    check('options page follows popup model change', (await op.inputValue(`#${modelKey}`)) === sonnet);
    // 바뀐 모델로 실제 요청 (캐시 키에 모델 포함 → 같은 단어도 새로 요청)
    await page.bringToFront();
    const n3 = calls();
    await hoverBank(1500);
    const m1 = await tipText();
    const r = lastReq();
    check('next translation uses the new model', !m1.hidden && m1.body.startsWith('강둑') && calls() === n3 + 1 && (cli ? r.model === 'sonnet' : r.model === sonnet && r.thinking?.type === 'between_tools'), JSON.stringify({ model: r.model, thinking: r.thinking }));
    await moveAway();
    if (!cli) {
      await sw.evaluate(() => chrome.storage.local.set({ model: 'claude-opus-5-5' }));
      await dragP1();
      const o = lastReq();
      check('API Opus request: effort low, thinking not disabled, max_tokens floor', o.model === 'claude-opus-5-5' && o.output_config?.effort === 'low' && !o.thinking && o.max_tokens >= 4000, JSON.stringify({ oc: o.output_config, th: o.thinking, mt: o.max_tokens }));
      await clearTip();
    }
  } finally {
    await ctx.close();
  }
}

server.listen(PORT, async () => {
  try {
    // store 빌드 검사기: store 통과 + personal은 걸러내야 함(검사기가 실제로 동작하는지)
    prefix = '';
    check('store build has no personal-only code', checkStore(await build('store', { outdir: path.join(SP, 'chk-store'), quiet: true })).length === 0);
    check('store check flags personal build', checkStore(await build('personal', { outdir: path.join(SP, 'chk-personal'), quiet: true })).length > 0);
    for (const ed of EDITIONS) await runSuite(ed);
  } catch (e) {
    console.error(e); failed++;
  } finally {
    server.close();
    fs.rmSync(SP, { recursive: true, force: true });
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
  }
});
