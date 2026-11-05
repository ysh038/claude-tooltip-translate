// native host 단위 테스트 — 가짜 claude(tests/fake-claude.mjs)로 프로토콜·대기 프로세스·취소·오류 처리 검증
// 실행: npm run test:host
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = path.join(ROOT, 'tests', 'fake-claude.mjs');
fs.chmodSync(FAKE, 0o755);
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'ctt-host-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !extra ? '' : `  (${extra})`)); if (!ok) failed++; };

function startHost(claudeBin, fakeLog) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'native-host', 'host.mjs')], {
    env: { ...process.env, CTT_CLAUDE_BIN: claudeBin, CTT_HOST_LOG: '0', FAKE_CLAUDE_LOG: fakeLog || '' },
    stdio: ['pipe', 'pipe', 'inherit']
  });
  const msgs = [];
  let buf = Buffer.alloc(0);
  proc.stdout.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0);
      if (buf.length < 4 + n) break;
      msgs.push({ ...JSON.parse(buf.subarray(4, 4 + n).toString('utf8')), at: Date.now() });
      buf = buf.subarray(4 + n);
    }
  });
  const send = (m) => {
    const b = Buffer.from(JSON.stringify(m)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length, 0);
    proc.stdin.write(Buffer.concat([h, b]));
  };
  const waitFor = async (pred, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = msgs.find(pred); if (m) return m; await sleep(20); }
    return null;
  };
  const exited = new Promise((r) => proc.on('exit', r));
  return { proc, msgs, send, waitFor, exited };
}

const readLog = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const JOB = { model: 'haiku', system: 'Test system prompt' };

try {
  // 1) 정상 흐름
  const LOG = path.join(SP, 'fake.log');
  const h = startHost(FAKE, LOG);
  h.send({ type: 'ping' });
  const pong = await h.waitFor((m) => m.type === 'pong');
  check('ping → pong ok', pong?.ok === true && pong.version >= 1);

  const t0 = Date.now();
  h.send({ type: 'translate', id: 'a', ...JOB, user: 'Word: bank\nContext: the ⟦bank⟧ of the river' });
  const done = await h.waitFor((m) => m.type === 'done' && m.id === 'a');
  check('translate streams deltas then done', h.msgs.some((m) => m.type === 'delta' && m.id === 'a') && done?.text.startsWith('강둑'));
  check('done does not wait for post_turn_summary', done && done.at - t0 < 1400, done && `${done.at - t0}ms`);
  check('rate limit info forwarded', !!(await h.waitFor((m) => m.type === 'rate_limit', 500)));

  // 첫 요청 뒤 같은 (모델, 프롬프트)용 대기 프로세스가 미리 떠 있어야 함
  await sleep(300);
  const tSend = Date.now();
  h.send({ type: 'translate', id: 'b', ...JOB, user: 'Word: river' });
  await h.waitFor((m) => m.type === 'done' && m.id === 'b');
  const log1 = readLog(LOG);
  const msgB = log1.filter((e) => e.event === 'msg').pop();
  const startB = log1.find((e) => e.event === 'start' && e.pid === msgB?.pid);
  check('second request uses pre-spawned process', startB && startB.t < tSend);
  check('finished process is terminated', log1.some((e) => e.event === 'exit' && e.pid === msgB?.pid) ||
    (await sleep(300), readLog(LOG).some((e) => e.event === 'exit' && e.pid === msgB?.pid)));
  check('one process per request (no conversation reuse)', new Set(log1.filter((e) => e.event === 'msg').map((e) => e.pid)).size === 2);

  // warm: 다른 프롬프트용 대기 프로세스
  const before = readLog(LOG).filter((e) => e.event === 'start').length;
  h.send({ type: 'warm', jobs: [{ model: 'haiku', system: 'Another prompt' }] });
  await sleep(400);
  check('warm spawns a spare', readLog(LOG).filter((e) => e.event === 'start').length === before + 1);

  // 취소: 진행 중인 프로세스 종료, done 안 옴
  h.send({ type: 'translate', id: 'c', ...JOB, user: 'SLOW text' });
  await sleep(300);
  const msgC = readLog(LOG).filter((e) => e.event === 'msg').pop();
  h.send({ type: 'cancel', id: 'c' });
  await sleep(400);
  check('cancel kills the running process', readLog(LOG).some((e) => e.event === 'exit' && e.pid === msgC?.pid));
  check('cancelled request gets no done', !(await h.waitFor((m) => m.id === 'c' && m.type === 'done', 600)));

  // 로그인 안 됨
  h.send({ type: 'translate', id: 'd', ...JOB, user: 'AUTHFAIL' });
  const errD = await h.waitFor((m) => m.id === 'd' && m.type === 'error');
  check('auth failure reported as error', errD && /AUTH/i.test(errD.code) && /login/i.test(errD.message));

  // 동시 요청 2개 (hover + 드래그)
  h.send({ type: 'translate', id: 'e1', ...JOB, user: 'Word: one' });
  h.send({ type: 'translate', id: 'e2', model: 'haiku', system: 'Another prompt', user: '<text>two</text>' });
  const [e1, e2] = await Promise.all([h.waitFor((m) => m.id === 'e1' && m.type === 'done'), h.waitFor((m) => m.id === 'e2' && m.type === 'done')]);
  check('concurrent requests both complete', !!(e1 && e2));

  // Chrome이 포트를 닫으면(stdin 종료) host 종료 + 자식 정리
  h.proc.stdin.end();
  const code = await Promise.race([h.exited, sleep(3000).then(() => 'timeout')]);
  await sleep(300);
  const final = readLog(LOG);
  const alive = final.filter((e) => e.event === 'start').map((e) => e.pid).filter((pid) => !final.some((x) => x.event === 'exit' && x.pid === pid));
  check('host exits on stdin close and cleans up children', code === 0 && alive.length === 0, `code=${code} alive=${alive}`);

  // 2) claude 실행 파일 없음
  const h2 = startHost(path.join(SP, 'no-such-claude'));
  h2.send({ type: 'ping' });
  const pong2 = await h2.waitFor((m) => m.type === 'pong');
  check('missing claude → pong ok:false with reason', pong2 && pong2.ok === false && /host:install/.test(pong2.reason));
  h2.send({ type: 'translate', id: 'x', ...JOB, user: 'hi' });
  const err2 = await h2.waitFor((m) => m.id === 'x' && m.type === 'error');
  check('missing claude → translate error NO_CLAUDE', err2?.code === 'NO_CLAUDE');
  h2.proc.stdin.end();
  await h2.exited;
} catch (e) {
  console.error(e); failed++;
} finally {
  fs.rmSync(SP, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
}
