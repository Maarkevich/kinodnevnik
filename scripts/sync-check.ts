/**
 * Интеграционный прогон правил слияния на fake-IndexedDB.
 * Запуск: npm run check:sync (браузер не нужен).
 * Пути относительные — скрипт должен работать не только в песочнице автора.
 * Проверяет ровно то, что требует спецификация 9.2–9.4 и 16.
 */
import { SyncService } from '../src/app/services/sync.service';

class FakeDb {
  stores = new Map();
  constructor(names) { for (const n of names) this.stores.set(n, new Map()); }
  keyPathOf(name) {
    return { entries: 'entryId', watchlist: 'key', favorites: 'key', lists: 'id',
             listItems: null, profiles: 'id', settings: 'k', titles: 'mediaKey',
             overrides: 'mediaKey', tombstones: 'key', snapshots: 'id', tmdbCache: 'cacheKey',
             imageQueue: 'url' }[name];
  }
  async run(stores, mode, fn) {
    const self = this;
    const tx = {
      db: this,
      // в реальном IDB у транзакции есть objectStore(); Some paths in
      // SyncService его зовут — хелпер обязан это поддерживать.
      objectStore(name: string) {
        return {
          async getAll() { return [...self.stores.get(name).values()]; },
          async put(v: any) { const kp = self.keyPathOf(name); const k = kp ? v[kp] : JSON.stringify(Object.values(v)); self.stores.get(name).set(k, JSON.parse(JSON.stringify(v))); return k; },
          async get(k: string) { return self.stores.get(name).get(k); },
          async delete(k: any) { self.stores.get(name).delete(Array.isArray(k) ? JSON.stringify(k) : k); },
          async clear() { self.stores.set(name, new Map()); },
        };
      },
    };
    const value = await fn(tx);
    return value;
  }
  async all(tx, name) { return [...this.stores.get(name).values()]; }
  async get(tx, name, key) { return this.stores.get(name).get(key); }
  async put(tx, name, value) {
    const kp = this.keyPathOf(name);
    const key = kp ? value[kp] : JSON.stringify(Object.values(value));
    this.stores.get(name).set(key, JSON.parse(JSON.stringify(value)));
    return key;
  }
  async del(tx, name, key) { this.stores.get(name).delete(Array.isArray(key) ? JSON.stringify(key) : key); }
  async clear(tx, name) { this.stores.set(name, new Map()); }
  wrap(p) { return p; }
}

const db = new FakeDb(['entries','watchlist','favorites','lists','listItems','profiles','settings','titles','overrides','tombstones','snapshots','tmdbCache','imageQueue']);
const sync = new SyncService(db);

const E = (o) => ({
  entryId: 'e1', dedupKey: '', id: 603, media_type: 'movie', title: 'Матрица',
  titleOriginal: 'The Matrix', titleRu: 'Матрица', poster_path: null, watchedAt: '2026-11-05',
  dateUnknown: false, userEdited: false, rewatch: false, rating: 4, review: '', tags: [],
  liked: false, status: null, progress: null,
  createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z', schema: 2, ...o,
});
const bundle = (entries, extra = {}) => ({
  app: 'kinodnevnik', version: 2, exportedAt: '2026-11-10T00:00:00.000Z',
  entries, watchlist: [], favorites: [], lists: [], listItems: [], profiles: [],
  settings: null, overrides: [], tombstones: [], ...extra,
});

let fails = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) fails++;
};

// ── 1. Идемпотентность: X, X, X == X ────────────────────────────────────────
await db.clear(null, 'entries');
const X = bundle([E({ entryId: 'a' })]);
const r1 = await sync.importBundle(X);
const r2 = await sync.importBundle(X);
const r3 = await sync.importBundle(X);
const after3 = await sync.buildBundle();
check('идемпотентность: 3 импорта одного файла = 1 запись', after3.entries.length === 1, `записей ${after3.entries.length}`);
check('первый импорт добавил 1', r1.added === 1);
check('повтор засчитан как «уже было»', r3.identical === 1 && r3.added === 0, JSON.stringify({a:r3.added,i:r3.identical}));

// ── 2. Разные entryId одного просмотра ≠ дубль ──────────────────────────────
await db.clear(null, 'entries');
await sync.importBundle(bundle([E({ entryId: 'phone-uuid', rating: 4, updatedAt: '2026-11-05T10:00:00.000Z' })]));
await sync.importBundle(bundle([E({ entryId: 'laptop-uuid', rating: 5, updatedAt: '2026-11-05T12:00:00.000Z' })]));
const merged = (await sync.buildBundle()).entries;
check('независимые устройства не дали дубль', merged.length === 1, `записей ${merged.length}`);
check('взята более свежая оценка', merged[0]?.rating === 5, `rating=${merged[0]?.rating}`);

// ── 3. userEdited важнее более свежего updatedAt ────────────────────────────
await db.clear(null, 'entries');
await sync.importBundle(bundle([E({ entryId: 'local', rating: 5, userEdited: true, updatedAt: '2026-11-05T10:00:00.000Z' })]));
const rUser = await sync.importBundle(bundle([E({ entryId: 'remote', rating: 2, userEdited: false, updatedAt: '2026-11-06T10:00:00.000Z' })]));
const userMerge = (await sync.buildBundle()).entries;
check('ручная правка не затёрта свежим импортом', userMerge[0]?.rating === 5, `rating=${userMerge[0]?.rating}`);
check('конфликт зафиксирован в отчёте', rUser.conflicts.length === 1 && rUser.conflicts[0].reason === 'userEdited-local', rUser.conflicts[0]?.reason);

// ── 4. Пересмотры одного дня НЕ схлопываются ────────────────────────────────
await db.clear(null, 'entries');
await sync.importBundle(bundle([
  E({ entryId: 'rw1', watchedAt: '2026-11-05', createdAt: '2026-11-05T08:00:00.000Z' }),
  E({ entryId: 'rw2', watchedAt: '2026-11-05', createdAt: '2026-11-05T20:00:00.000Z' }),
]));
const rw = (await sync.buildBundle()).entries;
check('два просмотра одного дня = две записи', rw.length === 2, `записей ${rw.length}`);

// ── 5. Недатированные записи не схлопываются ────────────────────────────────
await db.clear(null, 'entries');
await sync.importBundle(bundle([
  E({ entryId: 'nd1', watchedAt: null, dateUnknown: true }),
  E({ entryId: 'nd2', watchedAt: null, dateUnknown: true }),
]));
const nd = (await sync.buildBundle()).entries;
check('записи без даты не схлопнулись', nd.length === 2, `записей ${nd.length}`);

// ── 6. Tombstone: удалённое не возвращается ─────────────────────────────────
await db.clear(null, 'entries');
await db.clear(null, 'tombstones');
const victim = E({ entryId: 'v', id: 155, watchedAt: '2026-11-01', updatedAt: '2026-11-01T10:00:00.000Z' });
await sync.importBundle(bundle([victim]));
const key = (await sync.buildBundle()).entries[0].dedupKey;
await sync.recordDeletion('entries', key, '2026-11-01T10:00:00.000Z');
// DiaryService.remove при удалении ещё и удаляет запись из entries
await db.run(['entries'], 'readwrite', async (tx) => { await db.del(tx, 'entries', (await sync.buildBundle()).entries[0]?.entryId ?? ''); });
check('после удаления записи нет', (await sync.buildBundle()).entries.length === 0);
const rTomb = await sync.importBundle(bundle([victim]));
check('импорт не воскресил удалённое', (await sync.buildBundle()).entries.length === 0, `записей ${(await sync.buildBundle()).entries.length}`);
check('отчёт показал отклонение', rTomb.blockedByTombstone === 1, `blocked=${rTomb.blockedByTombstone}`);

// ── 7. Правка после удаления сильнее надгробия ───────────────────────────────
const editedLater = E({ entryId: 'v2', id: 155, watchedAt: '2026-11-01', updatedAt: '2099-01-01T00:00:00.000Z' });
await sync.importBundle(bundle([editedLater]));
check('обновлённая после удаления запись вернулась', (await sync.buildBundle()).entries.length === 1);

// ── 8. Экспорт не содержит ключей API ────────────────────────────────────────
await db.put(null, 'settings', { k: 'app', v: { language: 'ru-RU', tmdbApiKey: 'SECRET-123', region: 'RU' } });
const exp = await sync.buildBundle();
check('ключа нет в экспорте', !JSON.stringify(exp.settings).includes('SECRET-123'), JSON.stringify(exp.settings));

// ── 9. Undo импорта возвращает состояние ─────────────────────────────────────
await db.clear(null, 'entries');
await db.clear(null, 'tombstones');
await sync.importBundle(bundle([E({ entryId: 'base', id: 1 })]));
const beforeUndo = (await sync.buildBundle()).entries.length;
const rep = await sync.importBundle(bundle([E({ entryId: 'base', id: 1 }), E({ entryId: 'new', id: 2 })]));
check('импорт добавил запись', (await sync.buildBundle()).entries.length === 2);
const undone = await sync.undoImport(rep.snapshotId);
const afterUndo = (await sync.buildBundle()).entries.length;
check('undo вернул прежнее состояние', undone && afterUndo === beforeUndo, `после отката ${afterUndo}`);

// ── 10. Неподдерживаемый формат отклоняется ──────────────────────────────────
let rejected = false;
try { await sync.readBackupFile({ name: 'x.json', arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ app: 'other' })).buffer }); }
catch { rejected = true; }
check('чужой формат отклонён', rejected);

console.log(`\n${fails === 0 ? '✅ все проверки слияния пройдены' : `❌ провалено: ${fails}`}`);
process.exit(fails ? 1 : 0);
