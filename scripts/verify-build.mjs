import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Гейты качества сборки (спецификация, 16 и 17.2).
 *
 * Каждый из них ловит класс бага, который иначе уезжает в прод:
 *  1. Расхождение buildId между sw.js и sw-manifest.json → приложение
 *     никогда не предложит обновление.
 *  2. Путь прекеша, которого нет в сборке → cache.addAll падает целиком,
 *     SW не активируется, офлайн не работает.
 *  3. Английский литерал в бандле → остаток донорского UI.
 *  4. Закоммиченный ключ TMDb → секрет в публичном репозитории.
 */

const dist = existsSync('dist/kinodnevnik/browser') ? 'dist/kinodnevnik/browser' : 'dist/kinodnevnik';
const fail = [];
const note = (m) => console.log(`  ${m}`);

// 1. buildId
const manifest = JSON.parse(readFileSync(join(dist, 'sw-manifest.json'), 'utf8'));
const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
if (!manifest.buildId || !sw.includes(manifest.buildId)) {
  fail.push(`buildId расходится: manifest=${manifest.buildId}, в sw.js не найден`);
}
note(`buildId совпадает: ${manifest.buildId}`);

// 2. существование файлов прекеша
const missing = manifest.files.filter(
  (f) => !existsSync(join(dist, f.replace(/^\.\//, ''))),
);
if (missing.length) fail.push(`в прекеше ${missing.length} несуществующих файлов: ${missing.slice(0, 5)}`);
else note(`файлы прекеша на месте: ${manifest.files.length}`);

// 3. index.html должен быть в прекеше — иначе офлайн-старт нечем отдать
if (!manifest.files.some((f) => f.endsWith('index.html'))) {
  fail.push('index.html отсутствует в прекеше: холодный офлайн-старт невозможен');
}

// 4. английские литералы UI в бандле
const ENGLISH = [
  'Watchlist',
  'Favourites',
  'Total Watch Time',
  'Backlog Time',
  'No diary entries yet',
  'Import from Letterboxd',
  'Export to Letterboxd',
  'Storage quota exceeded',
  'See all',
  'Date unknown',
];
const bundle = readdirSync(dist)
  .filter((f) => f.endsWith('.js') || f.endsWith('.html'))
  .map((f) => readFileSync(join(dist, f), 'utf8'))
  .join('\n');

// Ищем как законченные слова в кавычках/тексте, чтобы не ловить имена классов
// и URL (themoviedb.org содержит «db», а WatchlistItem — это код, не UI).
const foundEnglish = ENGLISH.filter((w) =>
  new RegExp(`(['"\`>])\\s*${w}\\b[^<'"\\\`]{0,40}`).test(bundle),
);
if (foundEnglish.length) fail.push(`английские строки UI в сборке: ${foundEnglish.join(', ')}`);
else note('английских литералов UI не найдено');

// 5. секретов в сборке нет
const KEY_PATTERNS = [
  /api_key=[a-f0-9]{32}/i,
  /eyJhbGciOiJIUzI1NiJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
];
const leaks = KEY_PATTERNS.filter((re) => re.test(bundle));
if (leaks.length) fail.push(`в бандле обнаружены похожие на ключи строки (${leaks.length} паттерна)`);
else note('ключей API в бандле нет');

// 6. кириллица в сборке есть (иначе перевод просто не применился)
const cyrillic = (bundle.match(/[а-яё]/g) || []).length;
if (cyrillic < 200) fail.push(`кириллицы в сборке подозрительно мало: ${cyrillic} символов`);
else note(`кириллица в сборке: ${cyrillic} символов`);

if (fail.length) {
  console.error('\n❌ verify-build: ПРОВАЛ');
  for (const f of fail) console.error('   ' + f);
  process.exit(1);
}
console.log('\n✅ verify-build: все гейты пройдены');
