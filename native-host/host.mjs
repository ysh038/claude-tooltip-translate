// Chrome native messaging host — claude -p 중계 (개인용 전용)
//
// 확장 ↔ host 메시지 (JSON, 4바이트 길이 + 본문):
//   → { type: 'ping' }                                      ← { type: 'pong', version, claudeBin, ok, reason? }
//   → { type: 'warm', jobs: [{ model, system }] }            (대기 프로세스 미리 띄우기)
//   → { type: 'translate', id, model, system, user }         ← { type: 'delta', id, full } … { type: 'done', id, text, ttft, ms }
//                                                             ← { type: 'error', id, code, message }
//   → { type: 'cancel', id }
//   ← { type: 'rate_limit', info }                           (claude가 알려주는 구독 한도 상태)
//
// 직접 실행해서 확인:  node native-host/host.mjs --selftest "She sat on the bank of the river."
// stdout은 Chrome과의 통신 채널이므로 console.log 금지 (로그는 파일로).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudePool } from './claude-pool.mjs';

export const HOST_VERSION = 1;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(os.homedir(), 'Library', 'Logs', 'claude-tooltip-translate', 'host.log');

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8')); } catch {}
  const claudeBin = process.env.CTT_CLAUDE_BIN || cfg.claudeBin || path.join(os.homedir(), '.local', 'bin', 'claude');
  return { claudeBin };
}

function makeLogger() {
  if (process.env.CTT_HOST_LOG === '0') return () => {};
  try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch {}
  return (s) => {
    // 번역 텍스트(페이지 내용)는 로그에 남기지 않는다 — 메타데이터만
    try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${process.pid}] ${s}\n`); } catch {}
  };
}

function checkClaude(claudeBin) {
  try { fs.accessSync(claudeBin, fs.constants.X_OK); return { ok: true }; }
  catch { return { ok: false, reason: `claude 실행 파일을 찾을 수 없습니다: ${claudeBin}\n터미널에서 npm run host:install 을 다시 실행해 주세요.` }; }
}

/* ───────────── native messaging framing ───────────── */
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

function readMessages(onMessage, onEnd) {
  let buf = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const body = buf.subarray(4, 4 + len).toString('utf8');
      buf = buf.subarray(4 + len);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      onMessage(msg);
    }
  });
  process.stdin.on('end', onEnd);
}

function serve() {
  const log = makeLogger();
  const { claudeBin } = loadConfig();
  const pool = new ClaudePool({ claudeBin, emit: send, log });
  log(`start v${HOST_VERSION} claude=${claudeBin}`);

  readMessages((m) => {
    switch (m.type) {
      case 'ping': return send({ type: 'pong', version: HOST_VERSION, claudeBin, ...checkClaude(claudeBin) });
      case 'warm': if (checkClaude(claudeBin).ok) for (const j of m.jobs || []) pool.warm(j); return;
      case 'translate': {
        const c = checkClaude(claudeBin);
        if (!c.ok) return send({ type: 'error', id: m.id, code: 'NO_CLAUDE', message: c.reason });
        return pool.translate(m);
      }
      case 'cancel': return pool.cancel(m.id);
    }
  }, () => {
    // Chrome이 포트를 닫으면 stdin이 끝남 → 자식 프로세스 정리 후 종료
    log(`stop requests=${pool.stats.requests} errors=${pool.stats.errors}`);
    pool.shutdown();
    setTimeout(() => process.exit(0), 50);
  });
  process.on('SIGTERM', () => { pool.shutdown(); process.exit(0); });
}

/* ───────────── 터미널에서 직접 확인 ───────────── */
async function selftest(text) {
  const { claudeBin } = loadConfig();
  const c = checkClaude(claudeBin);
  if (!c.ok) { console.error(c.reason); process.exit(1); }
  const system = 'You are a translation engine. Translate the text inside <text> into natural Korean. Output ONLY the translation.';
  const user = `<text>${text}</text>`;
  const pool = new ClaudePool({
    claudeBin, log: () => {},
    emit: (m) => {
      if (m.type === 'done') {
        console.log(`${m.id}: ${m.text}\n    첫 글자 ${m.ttft}ms · 완성 ${m.ms}ms`);
        if (m.id === 'warm') { pool.shutdown(); process.exit(0); }
        // 두 번째 요청은 미리 띄워 둔 대기 프로세스로
        setTimeout(() => pool.translate({ id: 'warm', model: 'haiku', system, user }), 1500);
      } else if (m.type === 'error') { console.error(`${m.id}: 오류 ${m.code} ${m.message}`); pool.shutdown(); process.exit(1); }
    }
  });
  console.log(`claude: ${claudeBin}`);
  pool.translate({ id: 'cold', model: 'haiku', system, user });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const i = process.argv.indexOf('--selftest');
  if (i >= 0) selftest(process.argv[i + 1] || 'She sat on the bank of the river.');
  else serve();
}
