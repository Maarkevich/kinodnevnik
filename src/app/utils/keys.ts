import { MediaKind, WatchedEntry } from '../models/storage.models';

/**
 * Семантический ключ записи просмотра (спецификация, 8.4).
 *
 *   movie:603:2026-11-05:0
 *   tv:1396:2026-01-02:1        ← второй просмотр того же тайтла в тот же день
 *   movie:603:na:<entryId>      ← запись без даты
 *
 * Почему без даты — через entryId, а не через seq:
 * наивная схема «посчитать порядковый номер в группе» ломается при слиянии.
 * Два устройства независимо создают по одной записи без даты, обе получают
 * seq=0, сливаются в одну — и легитимный пересмотр без даты исчезает.
 * Спецификация прямо запрещает схлопывать такие записи, поэтому у недатированных
 * ключ делаем заведомо уникальным: они не сливаются никогда.
 */
export function computeDedupKey(
  input: Pick<WatchedEntry, 'media_type' | 'id' | 'watchedAt' | 'dateUnknown' | 'entryId'>,
  sameDaySeq = 0,
): string {
  const date = input.dateUnknown ? null : normalizeDate(input.watchedAt);

  if (!date) {
    return `${input.media_type}:${input.id}:na:${input.entryId}`;
  }

  return `${input.media_type}:${input.id}:${date}:${sameDaySeq}`;
}

/** Календарная дата YYYY-MM-DD из любого вида ISO-строки. */
export function normalizeDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Пересчёт ключей для набора записей одного тайтла. Используется миграцией и
 * «нормализацией дублей»: порядок задаётся createdAt, поэтому результат
 * детерминирован и не зависит от того, в каком порядке лежали данные.
 */
export function recomputeDedupKeys(entries: WatchedEntry[]): WatchedEntry[] {
  const groups = new Map<string, WatchedEntry[]>();

  for (const e of entries) {
    const date = normalizeDate(e.watchedAt);
    // Записи без даты не группируются вовсе.
    const gk = date ? `${e.media_type}:${e.id}:${date}` : `single:${e.entryId}`;
    const list = groups.get(gk) ?? [];
    list.push(e);
    groups.set(gk, list);
  }

  const result: WatchedEntry[] = [];

  for (const [gk, list] of groups) {
    const ordered = [...list].sort((a, b) =>
      (a.createdAt || '').localeCompare(b.createdAt || '') ||
      a.entryId.localeCompare(b.entryId),
    );

    ordered.forEach((e, i) => {
      const date = normalizeDate(e.watchedAt);
      e.dedupKey = gk.startsWith('single:')
        ? computeDedupKey(e)
        : computeDedupKey(e, i);
      // Второй и последующие просмотры в один день — это пересмотр по определению.
      if (date && i > 0) {
        e.rewatch = true;
      }
      result.push(e);
    });
  }

  return result;
}

/** Ключ элемента коллекции (отложенные/избранное/списки). */
export function mediaKey(mediaType: MediaKind, id: number): string {
  return `${mediaType}:${id}`;
}

/** Ключ отметки серии: тот же формат, что у донора, — старые данные читаются. */
export function episodeKey(tvId: number, season: number, episode: number): string {
  return `${tvId}-${season}-${episode}`;
}
