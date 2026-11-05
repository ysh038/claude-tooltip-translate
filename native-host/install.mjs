// native messaging host 설치 (macOS, 개인용)
//   npm run host:install     설치 / 갱신 — native-host/*.mjs를 고쳤거나 node·claude 경로가 바뀌면 다시 실행
//   npm run host:uninstall   제거
//
// 하는 일:
//   1) host 코드(host.mjs, claude-pool.mjs)를 ~/Library/Application Support/claude-tooltip-translate/host/ 로 복사
//      → macOS는 Chrome이 띄운 프로세스가 ~/Desktop·~/Documents 등을 읽는 걸 막을 수 있음(TCC).
//        저장소가 그런 폴더에 있어도 동작하도록 사본을 실행한다. (2026-11-05 실제로 겪음: "Native host has exited")
//   2) 같은 폴더에 config.json(claude 절대 경로 — Chrome이 띄운 프로세스는 PATH가 짧음), run.sh(진입점)
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
export const INSTALL_DIR = path.join(AS, 'claude-tooltip-translate', 'host');
export const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'claude-tooltip-translate');
const HOST_FILES = ['host.mjs', 'claude-pool.mjs'];

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

/** run.sh 생성 — Chrome이 띄우는 실행 파일. stderrLog를 주면 시작 실패 원인이 로그 파일에 남는다 */
export function writeRunScript(file, { nodeBin, env = {}, hostPath = path.join(HERE, 'host.mjs'), stderrLog = null }) {
  const exports = Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join('\n');
  const redirect = stderrLog ? ` 2>>${JSON.stringify(stderrLog)}` : '';
  fs.writeFileSync(file, `#!/bin/sh\n${exports}\nexec ${JSON.stringify(nodeBin)} ${JSON.stringify(hostPath)} "$@"${redirect}\n`);
  fs.chmodSync(file, 0o755);
}

const isExec = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };

function findClaude() {
  const candidates = [];
  try { candidates.push(execFileSync('/bin/sh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim()); } catch {}
  candidates.push(path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude');
  return candidates.find(isExec);
}

// node를 업그레이드해도 깨지지 않도록, 지금 node와 같은 실체를 가리키는 고정 경로(symlink)를 우선
function findNode() {
  const real = fs.realpathSync(process.execPath);
  const candidates = [];
  try { candidates.push(execFileSync('/bin/sh', ['-lc', 'command -v node'], { encoding: 'utf8' }).trim()); } catch {}
  candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node');
  return candidates.find((p) => { try { return fs.realpathSync(p) === real; } catch { return false; } }) || process.execPath;
}

function install() {
  if (process.platform !== 'darwin') throw new Error('지금은 macOS만 지원합니다.');
  const { name, extId } = personalEdition();
  const claudeBin = findClaude();
  if (!claudeBin) throw new Error('claude 실행 파일을 찾지 못했습니다. Claude Code를 설치하고 로그인한 뒤 다시 실행해 주세요.');
  const nodeBin = findNode();

  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  for (const f of HOST_FILES) fs.copyFileSync(path.join(HERE, f), path.join(INSTALL_DIR, f));
  fs.writeFileSync(path.join(INSTALL_DIR, 'package.json'), '{ "type": "module" }\n');
  fs.writeFileSync(path.join(INSTALL_DIR, 'config.json'), JSON.stringify({ claudeBin }, null, 2) + '\n');
  const runPath = path.join(INSTALL_DIR, 'run.sh');
  writeRunScript(runPath, { nodeBin, hostPath: path.join(INSTALL_DIR, 'host.mjs'), stderrLog: path.join(LOG_DIR, 'host.stderr.log') });
  // 예전 방식(저장소 안 run.sh/config.json) 흔적 정리
  for (const f of ['config.json', 'run.sh']) fs.rmSync(path.join(HERE, f), { force: true });

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
  console.log(`node:    ${nodeBin}`);
  console.log(`host:    ${INSTALL_DIR}`);
  console.log(`확장 ID: ${extId}`);
  console.log(`설치됨:  ${done.join(', ') || '(설치된 브라우저 없음)'}`);
  console.log('\n확장을 다시 로드(chrome://extensions에서 새로고침)하면 적용됩니다.');
  console.log(`문제가 있으면: ${path.join(LOG_DIR, 'host.log')}, host.stderr.log`);
}

function uninstall() {
  const { name } = personalEdition();
  for (const [label, dir] of BROWSERS) {
    const f = path.join(AS, dir, 'NativeMessagingHosts', `${name}.json`);
    if (fs.existsSync(f)) { fs.rmSync(f); console.log(`제거: ${label}`); }
  }
  for (const f of ['config.json', 'run.sh']) fs.rmSync(path.join(HERE, f), { force: true });
  fs.rmSync(path.dirname(INSTALL_DIR), { recursive: true, force: true });
  console.log(`제거: ${path.dirname(INSTALL_DIR)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try { process.argv.includes('--uninstall') ? uninstall() : install(); }
  catch (e) { console.error('실패:', e.message); process.exit(1); }
}
