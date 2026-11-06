// 개인용 한 번에 설치:  npm run setup
//   1) 필요한 것 확인 (macOS, Node 18+, claude)
//   2) 개인용 확장 빌드 → dist/personal
//   3) claude -p 중계 프로그램(native host) 등록
//   4) 남은 한 단계(확장 불러오기) 안내 + 폴더 경로 클립보드 복사 + 확장 관리 페이지 열기
// 업데이트할 때도 git pull 후 같은 명령을 다시 실행하면 된다.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'personal');
const ok = (s) => console.log(`  ✓ ${s}`);
const fail = (s) => { console.error(`\n  ✗ ${s}\n`); process.exit(1); };
const step = (s) => console.log(`\n▸ ${s}`);

// 앱 폴더가 있는 브라우저 중 확장 관리 페이지를 열 수 있는 것
const BROWSERS = [
  ['Google Chrome', 'Google/Chrome', 'chrome://extensions'],
  ['Microsoft Edge', 'Microsoft Edge', 'edge://extensions'],
  ['Brave Browser', 'BraveSoftware/Brave-Browser', 'brave://extensions'],
  ['Arc', 'Arc/User Data', 'arc://extensions'],
  ['Whale', 'Naver/Whale', 'whale://extensions'],
  ['Chromium', 'Chromium', 'chrome://extensions']
];

function findClaude() {
  try { return execFileSync('/bin/sh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim(); } catch {}
  return [path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
    .find((p) => fs.existsSync(p));
}

console.log('Claude 툴팁 번역 — 개인용 설치');

step('필요한 것 확인');
if (process.platform !== 'darwin') fail('지금은 macOS만 지원합니다.');
ok('macOS');
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) fail(`Node 18 이상이 필요합니다 (지금 ${process.versions.node}). https://nodejs.org`);
ok(`Node ${process.versions.node}`);
const claude = findClaude();
if (!claude) fail('Claude Code(claude)를 찾지 못했습니다. https://claude.com/claude-code 에서 설치하고, 터미널에서 claude 를 한 번 실행해 로그인해 주세요.');
let ver = '';
try { ver = execFileSync(claude, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim(); } catch {}
ok(`Claude Code ${ver || '(버전 확인 실패)'} — ${claude}`);

step('확장 빌드');
await build('personal', { quiet: true });
ok(path.relative(ROOT, DIST));

step('claude -p 중계 프로그램 등록');
const r = spawnSync(process.execPath, [path.join(ROOT, 'native-host', 'install.mjs')], { encoding: 'utf8' });
if (r.status !== 0) fail('중계 프로그램 등록 실패:\n' + (r.stderr || r.stdout));
for (const line of r.stdout.split('\n')) if (/^(설치됨|확장 ID)/.test(line)) ok(line.replace(/\s+/g, ' '));

// 남은 단계 안내
const AS = path.join(os.homedir(), 'Library', 'Application Support');
const browsers = BROWSERS.filter(([, dir]) => fs.existsSync(path.join(AS, dir)));
try { execFileSync('pbcopy', { input: DIST }); } catch {}
const first = browsers[0];
console.log(`
▸ 마지막 한 단계 — 브라우저에 확장 불러오기 (처음 한 번만)
  1. ${first ? first[2] : 'chrome://extensions'} 를 열고 오른쪽 위(Edge는 왼쪽) "개발자 모드"를 켭니다.
  2. "압축해제된 확장 프로그램을 로드합니다"를 누르고 아래 폴더를 선택합니다.
     ${DIST}
     (경로는 클립보드에 복사돼 있어요. 폴더 선택 창에서 ⌘⇧G → ⌘V → Enter)
  3. 이미 불러온 적이 있다면 확장 카드의 ↻(새로고침)만 누르면 됩니다.

  끝나면 영어 페이지를 새로고침하고 단어에 마우스를 올려 보세요.
  문제가 있으면: ~/Library/Logs/claude-tooltip-translate/ (host.log, host.stderr.log)
`);
if (first && !process.argv.includes('--no-open')) {
  try { execFileSync('open', ['-a', first[0], first[2]]); } catch {}
}
