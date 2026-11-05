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
      let i = 0; const t = setInterval(() => { if (i < parts.length) { res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: parts[i++] } })}\n\n`); } else { res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n'); res.end(); clearInterval(t); } }, 20);
    });
    return;
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Geography notes</title><body style="font:20px serif;padding:40px">
  <p id="p1">She sat on the <b>bank</b> of the river and watched the boats drift by. Then she went home.</p>
  <p id="p2">The quick brown fox jumps over the lazy dog.</p>
  <p id="p3">한국어 문장은 무시되어야 합니다.</p></body>`);
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
const fakeClaudeCalls = () => { try { return fs.readFileSync(path.join(SP, 'fake-claude.log'), 'utf8').split('\n').filter((l) => l.includes('"msg"')).length; } catch { return 0; } };

async function runSuite(edition) {
  prefix = `[${edition}] `;
  log = [];
  const ext = await buildForTest(edition);
  const profile = path.join(SP, 'profile-' + edition);
  const hasCli = loadEdition(edition).providers.includes('claude-cli');
  const expectId = hasCli ? installTestHost(profile) : null;
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`], viewport: { width: 1000, height: 600 } });
  try {
    let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
    if (expectId) check('personal build has fixed extension ID', sw.url().split('/')[2] === expectId);
    // 공통 테스트는 Claude API(가짜 SSE 서버)로
    await sw.evaluate((port) => chrome.storage.local.set({ apiKey: 'test-key', apiBase: `http://localhost:${port}`, hoverEngine: 'anthropic-api', selectionEngine: 'anthropic-api' }), PORT);
    const page = (await ctx.pages())[0] || await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);

    const tipText = () => page.evaluate(() => { const h = document.querySelector('claude-tip-translate'); if (!h) return null; const b = h.shadowRoot.querySelector('.box'); return { hidden: b.hidden, src: h.shadowRoot.querySelector('.src').textContent, body: h.shadowRoot.querySelector('.body').innerText, meta: h.shadowRoot.querySelector('.meta').textContent, link: !!h.shadowRoot.querySelector('.body .link') }; });
    const bankPos = await page.evaluate(() => { const b = document.querySelector('#p1 b').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    const hoverBank = async (wait = 1200) => { await page.mouse.move(bankPos.x - 5, bankPos.y); await page.mouse.move(bankPos.x, bankPos.y); await page.waitForTimeout(wait); };
    const moveAway = async () => { await page.mouse.move(900, 550); await page.waitForTimeout(500); };

    // hover "bank"
    await hoverBank();
    const h1 = await tipText(); check('hover shows contextual meaning', h1 && !h1.hidden && h1.src === 'bank' && h1.body.startsWith('강둑'));
    check('context marks target word', /⟦bank⟧/.test(log[0]?.body.messages[0].content || ''));
    // move away -> hide
    await moveAway();
    const h2 = await tipText(); check('hover tooltip hides on leave', h2.hidden);
    // hover korean -> no request
    const n0 = log.length;
    const k = await page.evaluate(() => { const b = document.querySelector('#p3').getBoundingClientRect(); return { x: b.x + 30, y: b.y + b.height / 2 }; });
    await page.mouse.move(k.x, k.y); await page.waitForTimeout(900);
    check('korean word hover skipped', log.length - n0 === 0);
    // select sentence p1
    const p = await page.evaluate(() => { const b = document.querySelector('#p1').getBoundingClientRect(); return { x: b.x, y: b.y, height: b.height }; });
    await page.mouse.move(p.x + 2, p.y + p.height / 2); await page.mouse.down(); await page.mouse.move(p.x + 500, p.y + p.height / 2, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(800);
    const s1 = await tipText(); check('selection translates', !s1.hidden && s1.src === '선택 번역' && s1.body.includes('강둑'));
    // dblclick word fox -> word mode
    const f = await page.evaluate(() => { const p = document.querySelector('#p2'); const r = document.createRange(); const t = p.firstChild; const i = t.data.indexOf('fox'); r.setStart(t, i); r.setEnd(t, i + 3); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.dblclick(f.x, f.y); await page.waitForTimeout(800);
    const d1 = await tipText(); check('double-click uses word mode', !d1.hidden && d1.src === 'fox');
    // cache: hover bank again
    await page.mouse.click(900, 550); await page.waitForTimeout(200);
    const n1 = log.length;
    await hoverBank(900);
    const c1 = await tipText(); check('repeat hover served from cache', c1.meta === '캐시' && log.length - n1 === 0);
    await moveAway();

    // 엔진 분리: hover = 아직 준비 중인 chrome-builtin → 설정 안내, 드래그는 계속 anthropic-api
    await sw.evaluate(() => chrome.storage.local.set({ hoverEngine: 'chrome-builtin', selectionEngine: 'anthropic-api' }));
    await page.waitForTimeout(100);
    const n2 = log.length;
    await hoverBank(900);
    const e1 = await tipText();
    check('unavailable hover engine shows setup error', !e1.hidden && e1.body.includes('준비 중') && e1.link && log.length - n2 === 0);
    await moveAway();
    await page.mouse.move(p.x + 2, p.y + p.height / 2); await page.mouse.down(); await page.mouse.move(p.x + 500, p.y + p.height / 2, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(800);
    const s2 = await tipText(); check('selection engine independent of hover engine', !s2.hidden && s2.body.includes('강둑'));
    // 이 에디션에 없는 엔진 id가 저장돼 있으면 첫 provider로 대체
    await page.mouse.click(900, 550);
    await sw.evaluate(() => chrome.storage.local.set({ hoverEngine: 'no-such-engine' }));
    await page.waitForTimeout(100);
    await hoverBank(900);
    const u1 = await tipText(); check('unknown engine id falls back', !u1.hidden && u1.body.startsWith('강둑'));
    await moveAway();
    await sw.evaluate(() => chrome.storage.local.set({ hoverEngine: 'anthropic-api' }));

    // options page
    const extId = sw.url().split('/')[2];
    const op = await ctx.newPage(); await op.goto(`chrome-extension://${extId}/options.html`); await op.waitForTimeout(400);
    const engines = await op.$$eval('#hoverEngine option', (os) => os.map((o) => o.value));
    check('options lists edition engines', JSON.stringify(engines) === JSON.stringify(loadEdition(edition).providers));
    check('options shows engine availability', (await op.textContent('#hoverEngineStatus')).includes('사용 가능'));
    await op.click('#runTest'); await op.waitForTimeout(800);
    check('options page test translation', (await op.textContent('#testOut')).includes('강둑'));
    // 설정 화면에서 엔진 변경 → storage 반영 + 상태 표시
    await op.selectOption('#selectionEngine', 'chrome-builtin'); await op.waitForTimeout(300);
    const st = await sw.evaluate(() => chrome.storage.local.get('selectionEngine'));
    check('options saves engine choice', st.selectionEngine === 'chrome-builtin' && (await op.textContent('#selectionEngineStatus')).includes('준비 중'));
    const pp = await ctx.newPage(); await pp.setViewportSize({ width: 280, height: 200 }); await pp.goto(`chrome-extension://${extId}/popup.html`); await pp.waitForTimeout(300);
    check('popup warns about unavailable engine', (await pp.textContent('#status')).includes('준비 중'));

    if (hasCli) {
      // claude -p 엔진 (native host + 가짜 claude). 저장값을 지우면 개인용 기본값(claude-cli)으로
      await sw.evaluate(() => chrome.storage.local.remove(['hoverEngine', 'selectionEngine']));
      await op.reload(); await op.waitForTimeout(1500);
      check('claude-cli is default engine in personal', (await op.inputValue('#hoverEngine')) === 'claude-cli' && (await op.inputValue('#selectionEngine')) === 'claude-cli');
      check('claude-cli available via native host', (await op.textContent('#hoverEngineStatus')).includes('사용 가능'));
      check('claude-cli settings section rendered', (await op.inputValue('#cliModel')) === 'haiku');
      await page.bringToFront();
      const nApi = log.length, nCli = fakeClaudeCalls();
      await page.mouse.click(900, 550); await page.waitForTimeout(200);
      await hoverBank(1500);
      const ch = await tipText();
      check('hover via claude -p', !ch.hidden && ch.body.startsWith('강둑') && log.length === nApi && fakeClaudeCalls() === nCli + 1, JSON.stringify(ch));
      await moveAway();
      await page.mouse.move(p.x + 2, p.y + p.height / 2); await page.mouse.down(); await page.mouse.move(p.x + 500, p.y + p.height / 2, { steps: 5 }); await page.mouse.up();
      await page.waitForTimeout(1500);
      const cs = await tipText();
      check('selection via claude -p', !cs.hidden && cs.body.includes('강둑') && log.length === nApi);
      await page.mouse.click(900, 550);
      const cp = await ctx.newPage(); await cp.setViewportSize({ width: 280, height: 200 }); await cp.goto(`chrome-extension://${extId}/popup.html`); await cp.waitForTimeout(800);
      check('popup shows claude -p engine', (await cp.textContent('#status')).includes('claude -p'));
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
