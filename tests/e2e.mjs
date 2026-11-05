// 가짜 Anthropic SSE 서버 + Playwright로 확장 동작 검증
// 실행: npm i && npx playwright install chromium && npm run test:e2e
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'ctt-e2e-'));
// 테스트용 확장 사본: localhost 호출 허용
fs.cpSync(ROOT, path.join(SP, 'ext-test'), { recursive: true, filter: (p) => !/node_modules|\.git|tests|docs/.test(path.relative(ROOT, p)) });
const mf = path.join(SP, 'ext-test', 'manifest.json');
const m = JSON.parse(fs.readFileSync(mf, 'utf8')); m.host_permissions.push('http://localhost:8787/*');
fs.writeFileSync(mf, JSON.stringify(m, null, 2));
let failed = 0;
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const log = [];
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/v1/messages')) {
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      const j = JSON.parse(body); log.push({headers:req.headers, body:j});
      res.writeHead(200,{'content-type':'text/event-stream','access-control-allow-origin':'*'});
      const isWord = j.messages[0].content.startsWith('Word:');
      const out = isWord ? '강둑 (명사)\n은행 · 둑 · 비축' : '그녀는 강둑에 앉아 배들이 떠내려가는 것을 지켜보았다.';
      const parts = out.match(/.{1,4}/gs);
      res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
      let i=0; const t=setInterval(()=>{ if(i<parts.length){ res.write(`event: content_block_delta\ndata: ${JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text:parts[i++]}})}\n\n`);} else { res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n'); res.end(); clearInterval(t);} }, 20);
    });
    return;
  }
  if (req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'*'});return res.end();}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><title>Geography notes</title><body style="font:20px serif;padding:40px">
  <p id="p1">She sat on the <b>bank</b> of the river and watched the boats drift by. Then she went home.</p>
  <p id="p2">The quick brown fox jumps over the lazy dog.</p>
  <p id="p3">한국어 문장은 무시되어야 합니다.</p></body>`);
});
server.listen(8787, async () => {
  const ext = path.join(SP,'ext-test');
  const ctx = await chromium.launchPersistentContext(path.join(SP,'profile'), { headless: true, channel: 'chromium', args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`], viewport:{width:1000,height:600} });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({apiKey:'test-key', apiBase:'http://localhost:8787'}));
  const page = (await ctx.pages())[0] || await ctx.newPage();
  await page.goto('http://localhost:8787/');
  await page.waitForTimeout(500);
  // hover "bank"
  const r = await page.evaluate(()=>{const b=document.querySelector('#p1 b').getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2};});
  await page.mouse.move(r.x-5, r.y); await page.mouse.move(r.x, r.y);
  await page.waitForTimeout(1200);
  const tipText = () => page.evaluate(()=>{const h=document.querySelector('claude-tip-translate'); if(!h) return null; const b=h.shadowRoot.querySelector('.box'); return {hidden:b.hidden, src:h.shadowRoot.querySelector('.src').textContent, body:h.shadowRoot.querySelector('.body').innerText, meta:h.shadowRoot.querySelector('.meta').textContent};});
  const h1 = await tipText(); console.log('HOVER:', JSON.stringify(h1)); check('hover shows contextual meaning', h1 && !h1.hidden && h1.src === 'bank' && h1.body.startsWith('강둑'));
  check('context marks target word', /⟦bank⟧/.test(log[0]?.body.messages[0].content || ''));
  // move away -> hide
  await page.mouse.move(900, 550); await page.waitForTimeout(500);
  const h2 = await tipText(); check('hover tooltip hides on leave', h2.hidden);
  // hover korean -> no request
  const n0 = log.length;
  const k = await page.evaluate(()=>{const b=document.querySelector('#p3').getBoundingClientRect(); return {x:b.x+30,y:b.y+b.height/2};});
  await page.mouse.move(k.x,k.y); await page.waitForTimeout(900);
  check('korean word hover skipped', log.length - n0 === 0);
  // select sentence p1
  const p = await page.evaluate(()=>{const b=document.querySelector('#p1').getBoundingClientRect(); return b;});
  await page.mouse.move(p.x+2, p.y+p.height/2); await page.mouse.down(); await page.mouse.move(p.x+500, p.y+p.height/2, {steps:5}); await page.mouse.up();
  await page.waitForTimeout(800);
  const s1 = await tipText(); check('selection translates', !s1.hidden && s1.src === '선택 번역' && s1.body.includes('강둑'));
  // dblclick word fox -> word mode
  const f = await page.evaluate(()=>{const p=document.querySelector('#p2'); const r=document.createRange(); const t=p.firstChild; const i=t.data.indexOf('fox'); r.setStart(t,i); r.setEnd(t,i+3); const b=r.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2};});
  await page.mouse.dblclick(f.x,f.y); await page.waitForTimeout(800);
  const d1 = await tipText(); check('double-click uses word mode', !d1.hidden && d1.src === 'fox');
  // cache: hover bank again
  await page.mouse.click(900,550); await page.waitForTimeout(200);
  const n1=log.length;
  await page.mouse.move(r.x-3, r.y); await page.mouse.move(r.x, r.y); await page.waitForTimeout(900);
  const c1 = await tipText(); check('repeat hover served from cache', c1.meta === '캐시' && log.length - n1 === 0);
  // options page
  const extId = sw.url().split('/')[2];
  const op = await ctx.newPage(); await op.goto(`chrome-extension://${extId}/options.html`); await op.waitForTimeout(400);
  await op.click('#runTest'); await op.waitForTimeout(800);
  check('options page test translation', (await op.textContent('#testOut')).includes('강둑'));
  const pp = await ctx.newPage(); await pp.setViewportSize({width:280,height:200}); await pp.goto(`chrome-extension://${extId}/popup.html`); await pp.waitForTimeout(300);
  await ctx.close(); server.close();
  fs.rmSync(SP, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
});
