import { computeDedupKey, normalizeDate, recomputeDedupKeys, episodeKey } from '../utils/keys';
import { WatchedEntry } from '../models/storage.models';

function entry(over: Partial<WatchedEntry>): WatchedEntry {
  const base: WatchedEntry = {
    entryId: over.entryId ?? 'e-1',
    dedupKey: '',
    id: 603,
    media_type: 'movie',
    title: 'Матрица',
    titleOriginal: 'The Matrix',
    titleRu: 'Матрица',
    poster_path: null,
    watchedAt: '2026-11-05',
    dateUnknown: false,
    userEdited: false,
    rewatch: false,
    rating: 4.5,
    review: '',
    tags: [],
    liked: false,
    status: null,
    progress: null,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    schema: 2,
  };
  return { ...base, ...over };
}

describe('computeDedupKey', () => {
  it('собирает ключ из типа, id и даты', () => {
    expect(computeDedupKey(entry({}), 0)).toBe('movie:603:2026-11-05:0');
  });

  it('различает пересмотры одного дня порядковым номером', () => {
    const a = computeDedupKey(entry({ entryId: 'x' }), 0);
    const b = computeDedupKey(entry({ entryId: 'y' }), 1);
    expect(a).not.toBe(b);
    expect(b).toBe('movie:603:2026-11-05:1');
  });

  it('для записи без даты делает ключ заведомо уникальным', () => {
    const undated = (id: string) => entry({ entryId: id, watchedAt: null, dateUnknown: true });
    const a = computeDedupKey(undated('a'));
    const b = computeDedupKey(undated('b'));
    // Ключ через entryId: две недатированные записи никогда не схлопнутся.
    expect(a).not.toBe(b);
    expect(a).toContain(':na:');
  });

  it('нормализует дату, отбрасывая время и мусор', () => {
    expect(normalizeDate('2026-11-05T14:30:00.000Z')).toBe('2026-11-05');
    expect(normalizeDate('2026-13-45')).toBeNull();
    expect(normalizeDate(null)).toBeNull();
  });
});

describe('recomputeDedupKeys', () => {
  it('присваивает последовательные номера пересмотрам одного дня', () => {
    const list = [
      entry({ entryId: 'b', createdAt: '2026-11-05T18:00:00.000Z' }),
      entry({ entryId: 'a', createdAt: '2026-11-05T08:00:00.000Z' }),
    ];
    const done = recomputeDedupKeys(list);
    const byId = Object.fromEntries(done.map((e) => [e.entryId, e.dedupKey]));

    // Порядок задаётся createdAt, а не порядком в массиве.
    expect(byId['a']).toBe('movie:603:2026-11-05:0');
    expect(byId['b']).toBe('movie:603:2026-11-05:1');
    expect(byId['b']).toContain(':1');
  });

  it('помечает второй просмотр того же дня как rewatch', () => {
    const done = recomputeDedupKeys([
      entry({ entryId: 'a', createdAt: '2026-11-05T08:00:00.000Z' }),
      entry({ entryId: 'b', createdAt: '2026-11-05T20:00:00.000Z' }),
    ]);
    expect(done.find((e) => e.entryId === 'b')?.rewatch).toBe(true);
  });

  it('не схлопывает недатированные записи', () => {
    const done = recomputeDedupKeys([
      entry({ entryId: 'a', watchedAt: null, dateUnknown: true }),
      entry({ entryId: 'b', watchedAt: null, dateUnknown: true }),
    ]);
    expect(new Set(done.map((e) => e.dedupKey)).size).toBe(2);
  });

  it('детерминирован: один и тот же вход даёт один и тот же результат', () => {
    const input = () => [
      entry({ entryId: 'a', createdAt: '2026-11-05T08:00:00.000Z' }),
      entry({ entryId: 'b', createdAt: '2026-11-05T09:00:00.000Z' }),
    ];
    const first = recomputeDedupKeys(input()).map((e) => e.dedupKey);
    const second = recomputeDedupKeys(input()).map((e) => e.dedupKey);
    expect(first).toEqual(second);
  });
});

describe('episodeKey', () => {
  it('совпадает с форматом ключа донора', () => {
    // Донор хранил episodeWatched как `${tvId}-${season}-${episode}`.
    expect(episodeKey(1396, 2, 5)).toBe('1396-2-5');
  });
});
