import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * Собирает sw.js из src/sw.ts и sw-manifest.json из ФАКТИЧЕСКОГО списка
 * файлов сборки (спецификация, 11.5.2б).
 *
 * Ключевое: в прекеш попадают только те файлы, что реально лежат на диске.
 * Одна несуществующая строка в cache.addAll валит активацию SW целиком, и
 * приложение тихо остаётся без офлайна — это уже ломало PWA avtoklavi,
 * где в прекеш попало 146 картинок.
 */
const root = resolve(process.cwd());

const candidates = [
  resolve(root, 'dist/kinodnevnik/browser'),
  resolve(root, 'dist/kinodnevnik'),
];
const target = candidates.find((p) => existsSync(p));

if (!target) {
  console.error('[build-sw] Нет каталога сборки. Сначала выполните ng build.');
  process.exit(1);
}

const versionPath = resolve(root, 'public/version.json');
if (!existsSync(versionPath)) {
  console.error('[build-sw] Нет public/version.json — выполните prebuild.');
  process.exit(1);
}
const version = JSON.parse(readFileSync(versionPath, 'utf8'));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// index.html обслуживается network-first и обязан быть в кэше как фолбэк,
// поэтому не исключаем его из прекеша полностью — см. sw.ts.
const NEVER_PRECACHE = new Set(['sw.js', 'sw-manifest.json', 'version.json', '404.html']);

/*
 * Иконки ionicons — 1357 файлов. Прекешивать их нельзя: это ~1.5 МБ на
 * установке ради глифов, которые приложение никогда не покажет все разом.
 * Стратегия cacheFirst в sw.ts допишет каждую в кэш при первом запросе,
 * а для офлайна это эквивалентно: иконка, которую пользователь уже видел,
 * у него есть.
 */
const PRECACHE_SKIP_DIRS = ['svg/'];

const files = walk(target)
  .map((abs) => relative(target, abs).split('\\').join('/'))
  .filter(
    (rel) =>
      !NEVER_PRECACHE.has(rel) &&
      !rel.endsWith('.map') &&
      !PRECACHE_SKIP_DIRS.some((d) => rel.startsWith(d)),
  )
  .sort();

// Проверка «каждый путь существует» — на этом падает сборка, а не рантайм.
for (const rel of files) {
  if (!existsSync(resolve(target, rel))) {
    console.error(`[build-sw] Файл из прекеша отсутствует: ${rel}`);
    process.exit(1);
  }
}

const manifest = {
  buildId: version.buildId,
  app: version.app,
  builtAt: version.builtAt,
  files: files.map((f) => `./${f}`),
};

writeFileSync(resolve(target, 'sw-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const swSource = readFileSync(resolve(root, 'src/sw.ts'), 'utf8');
const compiled = ts.transpileModule(swSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    strict: true,
    lib: ['ES2022', 'WebWorker'],
  },
});

if (compiled.diagnostics?.length) {
  for (const d of compiled.diagnostics) {
    console.error(`[build-sw] ${d.messageText}`);
  }
  process.exit(1);
}

const banner =
  `const KD_BUILD_ID = ${JSON.stringify(version.buildId)};\n` +
  `const KD_PRECACHE_FILES = ${JSON.stringify(manifest.files)};\n`;

writeFileSync(resolve(target, 'sw.js'), banner + compiled.outputText, 'utf8');

// GitHub Pages не делает rewrite для SPA: 404.html = копия index.html.
const index = resolve(target, 'index.html');
if (existsSync(index)) {
  copyFileSync(index, resolve(target, '404.html'));
}

console.log(`[build-sw] sw.js + sw-manifest.json: ${files.length} файлов, buildId=${version.buildId}`);
