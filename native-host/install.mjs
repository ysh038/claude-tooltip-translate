// native messaging host 설치 (macOS, 개인용)
//   npm run host:install     설치 / 경로 갱신 (저장소를 옮겼거나 node·claude 경로가 바뀌면 다시 실행)
//   npm run host:uninstall   제거
//
// 하는 일:
//   1) native-host/config.json  — claude 실행 파일 절대 경로 (Chrome이 띄운 프로세스는 PATH가 짧음)
//   2) native-host/run.sh       — Chrome이 실행하는 진입점 (node 절대 경로로 host.mjs 실행)
//   3) 브라우저별 NativeMessagingHosts/<host>.json — 고정된 개인용 확장 ID만 허용
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extensionIdFromKey } from '../scripts/ext-id.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const AS = path.join(os.homedir(), 'Library', 'Application Support');

// 앱 폴더가 있는 브라우저에만 설치
const BROWSERS = [
  ['Chrome', 'Google/Chrome'],
  ['Chrome Beta', 'Google/Chrome Beta'],
  ['Chrome Canary', 'Google/Chrome Canary'],
  ['Chromium', 'Chromium'],
  ['Edge', 'Microsoft Edge'],
  ['Brave', 'BraveSoftware/Brave-Browser'],
  ['Arc', 'Arc/User Data'],
  ['Whale', 'Naver/Whale']
];

export function hostManifest({ name, runPath, extId }) {
  return {
    name,
    description: 'Claude 툴팁 번역 — claude -p 중계 (개인용)',
    path: runPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extId}/`]
  };
}

export function personalEdition() {
  const ed = JSON.parse(fs.readFileSync(path.join(ROOT, 'editions', 'personal.json'), 'utf8'));
  return { name: ed.nativeHost, extId: extensionIdFromKey(ed.manifest.key) };
}

/** run.sh 생성 — Chrome이 띄우는 실행 파일 */
export function writeRunScript(file, { nodeBin, env = {} }) {
  const exports = Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join('\n');
  fs.writeFileSync(file, `#!/bin/sh\n${exports}\nexec ${JSON.stringify(nodeBin)} ${JSON.stringify(path.join(HERE, 'host.mjs'))} "$@"\n`);
  fs.chmodSync(file, 0o755);
}

function findClaude() {
  const candidates = [];
  try { candidates.push(execFileSync('/bin/sh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim()); } catch {}
  candidates.push(path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude');
  return candidates.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
}

function install() {
  if (process.platform !== 'darwin') throw new Error('지금은 macOS만 지원합니다.');
  const { name, extId } = personalEdition();
  const claudeBin = findClaude();
  if (!claudeBin) throw new Error('claude 실행 파일을 찾지 못했습니다. Claude Code를 설치하고 로그인한 뒤 다시 실행해 주세요.');

  fs.writeFileSync(path.join(HERE, 'config.json'), JSON.stringify({ claudeBin }, null, 2) + '\n');
  const runPath = path.join(HERE, 'run.sh');
  writeRunScript(runPath, { nodeBin: process.execPath });

  const manifest = JSON.stringify(hostManifest({ name, runPath, extId }), null, 2) + '\n';
  const done = [];
  for (const [label, dir] of BROWSERS) {
    if (!fs.existsSync(path.join(AS, dir))) continue;
    const target = path.join(AS, dir, 'NativeMessagingHosts');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, `${name}.json`), manifest);
    done.push(label);
  }
  console.log(`claude:  ${claudeBin}`);
  console.log(`node:    ${process.execPath}`);
  console.log(`확장 ID: ${extId}`);
  console.log(`설치됨:  ${done.join(', ') || '(설치된 브라우저 없음)'}`);
  console.log('\n확장을 다시 로드(chrome://extensions에서 새로고침)하면 적용됩니다.');
  console.log('직접 확인: npm run host:test');
}

function uninstall() {
  const { name } = personalEdition();
  for (const [label, dir] of BROWSERS) {
    const f = path.join(AS, dir, 'NativeMessagingHosts', `${name}.json`);
    if (fs.existsSync(f)) { fs.rmSync(f); console.log(`제거: ${label}`); }
  }
  for (const f of ['config.json', 'run.sh']) fs.rmSync(path.join(HERE, f), { force: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try { process.argv.includes('--uninstall') ? uninstall() : install(); }
  catch (e) { console.error('실패:', e.message); process.exit(1); }
}
