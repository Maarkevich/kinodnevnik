import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Генерирует src/environments/version.ts и public/version.json.
 * buildId = sha + unix-ts: он же вшивается в sw.js и в sw-manifest.json,
 * и CI сверяет, что они совпадают (спецификация, 11.5.2в).
 */
const root = resolve(process.cwd());
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

let sha = 'local';
try {
  sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  console.warn('[prebuild] git недоступен — sha = local');
}

const builtAt = new Date().toISOString();
const buildId = `${sha}-${Math.floor(Date.now() / 1000)}`;

const info = { app: pkg.version ?? '0.0.0', sha, builtAt, buildId };

mkdirSync(resolve(root, 'src/environments'), { recursive: true });
mkdirSync(resolve(root, 'public'), { recursive: true });

writeFileSync(
  resolve(root, 'src/environments/version.ts'),
  `// Генерируется scripts/prebuild.mjs. Не редактировать и не коммитить.\n` +
    `export const APP_VERSION = ${JSON.stringify(info, null, 2)} as const;\n`,
  'utf8',
);

writeFileSync(resolve(root, 'public/version.json'), JSON.stringify(info, null, 2) + '\n', 'utf8');

console.log(`[prebuild] buildId=${buildId} версия=${info.app}`);
