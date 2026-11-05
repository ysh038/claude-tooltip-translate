// 에디션별 확장 빌드: src/ + core/ + providers/ → dist/<edition>/
//   node scripts/build.mjs                 모든 에디션
//   node scripts/build.mjs personal        개인용만
//   node scripts/build.mjs personal --watch
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PERSONAL_ONLY_PROVIDERS, PERSONAL_ONLY_PERMISSIONS } from './edition-rules.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const STATIC = ['options.html', 'popup.html', 'ui.css', 'icons'];

export const EDITIONS = fs.readdirSync(path.join(ROOT, 'editions'))
  .filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

export function loadEdition(name) {
  const file = path.join(ROOT, 'editions', `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`알 수 없는 에디션: ${name} (editions/ 에 ${EDITIONS.join(', ')})`);
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const id of cfg.providers) {
    if (!fs.existsSync(path.join(ROOT, 'providers', `${id}.js`))) throw new Error(`[${name}] provider 파일 없음: providers/${id}.js`);
  }
  if (name === 'store') {
    const bad = cfg.providers.filter((p) => PERSONAL_ONLY_PROVIDERS.includes(p));
    const badPerm = (cfg.manifest?.permissions || []).filter((p) => PERSONAL_ONLY_PERMISSIONS.includes(p));
    if (bad.length || badPerm.length) throw new Error(`store 에디션에 개인용 전용 항목이 있습니다: ${[...bad, ...badPerm].join(', ')}`);
  }
  return cfg;
}

const union = (a = [], b = []) => [...new Set([...a, ...b])];

function makeManifest(cfg) {
  const base = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const { permissions, host_permissions, ...rest } = cfg.manifest || {};
  return {
    ...base,
    ...rest,
    version,
    permissions: union(base.permissions, permissions),
    host_permissions: union(base.host_permissions, host_permissions)
  };
}

// import { PROVIDERS } from 'edition:providers' → 에디션에 포함된 provider만 import
function editionPlugin(cfg) {
  return {
    name: 'edition',
    setup(b) {
      b.onResolve({ filter: /^edition:providers$/ }, () => ({ path: 'providers', namespace: 'edition' }));
      b.onLoad({ filter: /.*/, namespace: 'edition' }, () => ({
        contents: cfg.providers.map((id, i) => `import p${i} from ${JSON.stringify(path.join(ROOT, 'providers', `${id}.js`))};`).join('\n') +
          `\nexport const PROVIDERS = [${cfg.providers.map((_, i) => `p${i}`).join(', ')}];\n`,
        resolveDir: ROOT,
        loader: 'js'
      }));
    }
  };
}

/**
 * @param {string} name 에디션 이름
 * @param {{ outdir?: string, watch?: boolean, quiet?: boolean }} [opts]
 * @returns {Promise<string>} 출력 디렉터리
 */
export async function build(name, { outdir = path.join(ROOT, 'dist', name), watch = false, quiet = false } = {}) {
  const cfg = loadEdition(name);
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  for (const f of STATIC) fs.cpSync(path.join(SRC, f), path.join(outdir, f), { recursive: true });
  fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify(makeManifest(cfg), null, 2) + '\n');

  const common = {
    bundle: true,
    outdir,
    target: 'chrome120',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: quiet ? 'silent' : 'warning',
    define: { __EDITION__: JSON.stringify({ name: cfg.name, providers: cfg.providers, defaults: cfg.defaults || {}, nativeHost: cfg.nativeHost || null }) },
    plugins: [editionPlugin(cfg)]
  };
  const configs = [
    // background는 manifest에서 type: module, options/popup은 <script type="module">
    { ...common, format: 'esm', entryPoints: ['background', 'options', 'popup'].map((n) => path.join(SRC, `${n}.js`)) },
    // content script는 ES module이 아니므로 IIFE
    { ...common, format: 'iife', entryPoints: [path.join(SRC, 'content.js')] }
  ];

  if (watch) {
    for (const c of configs) await (await esbuild.context(c)).watch();
    console.log(`[${name}] watching → ${path.relative(ROOT, outdir)} (html/css/manifest 변경 시 재시작)`);
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    if (!quiet) console.log(`[${name}] → ${path.relative(ROOT, outdir) || outdir}`);
  }
  return outdir;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const watch = args.includes('--watch');
  const names = args.filter((a) => !a.startsWith('--'));
  try {
    for (const n of names.length ? names : EDITIONS) await build(n, { watch });
  } catch (e) {
    console.error('빌드 실패:', e.message);
    process.exit(1);
  }
}
