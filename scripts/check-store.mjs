// store 빌드에 개인용 전용 코드(claude-cli provider, native messaging)가 섞이지 않았는지 검사 (CI용)
//   node scripts/check-store.mjs            dist/store를 새로 빌드한 뒤 검사
//   node scripts/check-store.mjs <dir>      이미 빌드된 디렉터리를 검사
// 근거: CLAUDE.md "확정된 결정 4" — 구독 계정 엔진은 개인용 빌드에만
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PERSONAL_ONLY_PERMISSIONS, FORBIDDEN_IN_STORE } from './edition-rules.mjs';

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** @returns {string[]} 위반 목록 (비어 있으면 통과) */
export function checkStore(dir) {
  const errors = [];
  const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const p of mf.permissions || []) if (PERSONAL_ONLY_PERMISSIONS.includes(p)) errors.push(`manifest.permissions에 ${p}`);
  if (mf.key) errors.push('manifest에 key(개인용 확장 ID 고정)가 있음');
  for (const f of walk(dir)) {
    if (!/\.(js|html|json|css)$/.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const re of FORBIDDEN_IN_STORE) if (re.test(text)) errors.push(`${path.relative(dir, f)}: ${re}`);
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let dir = process.argv[2];
  if (!dir) {
    const { build } = await import('./build.mjs');
    dir = await build('store');
  }
  const errors = checkStore(dir);
  if (errors.length) {
    console.error(`store 빌드 검사 실패 (${dir}):\n  - ` + errors.join('\n  - '));
    process.exit(1);
  }
  console.log(`store 빌드 검사 통과: 개인용 전용 코드 없음 (${dir})`);
}
