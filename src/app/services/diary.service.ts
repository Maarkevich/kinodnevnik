import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { MediaKind, WatchedEntry, WatchProgress, WatchStatus } from '../models/storage.models';
import { computeDedupKey, normalizeDate } from '../utils/keys';
import { DbService } from './db.service';
import { SyncService } from './sync.service';

export type DiaryFilter = 'all' | 'movie' | 'tv' | 'animation' | 'anime' | 'kdrama';
export type DiarySort = 'date_desc' | 'date_asc' | 'rating_desc' | 'title_asc';

export interface DiaryStats {
  total: number;
  today: number;
  week: number;
  streak: number;
}

export interface SaveEntryInput {
  entryId?: string;
  id: number;
  media_type: MediaKind;
  title: string;
  titleOriginal?: string;
  titleRu?: string | null;
  poster_path?: string | null;
  watchedAt?: string | null;
  dateUnknown?: boolean;
  approximateDate?: boolean;
  rewatch?: boolean;
  rating?: number | null;
  review?: string;
  tags?: string[];
  liked?: boolean;
  release_date?: string | null;
  first_air_date?: string | null;
  status?: WatchStatus;
  progress?: WatchProgress | null;
  snapshot?: WatchedEntry['snapshot'];
  /** true, когда значение изменил человек, а не импорт (спецификация, 9.4). */
  userEdited?: boolean;
}

@Injectable({ providedIn: 'root' })
export class DiaryService {
  private readonly subject = new BehaviorSubject<WatchedEntry[]>([]);
  readonly entries$: Observable<WatchedEntry[]> = this.subject.asObservable();

  constructor(
    private readonly db: DbService,
    private readonly sync: SyncService,
  ) {}

  get snapshot(): WatchedEntry[] {
    return this.subject.value;
  }

  async load(): Promise<WatchedEntry[]> {
    const list = await this.db.run('entries', 'readonly', (tx) => this.db.all<WatchedEntry>(tx, 'entries'));
    const sorted = sortDesc(list);
    this.subject.next(sorted);
    return sorted;
  }

  /**
   * Сохранение записи. Ключ дедупликации проставляется здесь, а не при
   * слиянии: если считать его на лету по позиции в списке, надгробия
   * перестают совпадать с записями.
   */
  async save(input: SaveEntryInput): Promise<WatchedEntry> {
    const now = new Date().toISOString();
    const all = await this.load();

    const existing = input.entryId ? all.find((e) => e.entryId === input.entryId) : undefined;

    const watchedAt =
      input.watchedAt !== undefined ? normalizeDate(input.watchedAt) : existing?.watchedAt ?? null;
    const dateUnknown = input.dateUnknown ?? existing?.dateUnknown ?? !watchedAt;

    const entryId = existing?.entryId ?? newUuid();

    // Номер пересмотра в рамках одного дня: сколько записей того же тайтла
    // с той же датой уже есть (без учёта удаляемой, если правим существующую).
    let seq = 0;
    if (watchedAt && !dateUnknown) {
      seq = all
        .filter(
          (e) =>
            e.entryId !== entryId &&
            e.media_type === input.media_type &&
            e.id === input.id &&
            normalizeDate(e.watchedAt) === watchedAt,
        ).length;
    }

    const draft: WatchedEntry = {
      entryId,
      dedupKey: '',
      id: input.id,
      media_type: input.media_type,
      title: (input.title ?? existing?.title ?? '').trim(),
      titleOriginal: (input.titleOriginal ?? existing?.titleOriginal ?? input.title ?? '').trim(),
      titleRu: input.titleRu !== undefined ? input.titleRu : existing?.titleRu ?? null,
      poster_path: input.poster_path !== undefined ? input.poster_path : existing?.poster_path ?? null,
      watchedAt,
      dateUnknown,
      approximateDate: input.approximateDate ?? existing?.approximateDate ?? false,
      importerCreated: existing?.importerCreated ?? false,
      userEdited: input.userEdited ?? true,
      rewatch: input.rewatch ?? existing?.rewatch ?? seq > 0,
      rating: input.rating !== undefined ? input.rating : existing?.rating ?? null,
      review: input.review !== undefined ? input.review : existing?.review ?? '',
      tags: input.tags ?? existing?.tags ?? [],
      liked: input.liked !== undefined ? input.liked : existing?.liked ?? false,
      sourceKey: existing?.sourceKey,
      release_date: input.release_date ?? existing?.release_date ?? null,
      first_air_date: input.first_air_date ?? existing?.first_air_date ?? null,
      status: input.status !== undefined ? input.status : existing?.status ?? null,
      progress: input.progress !== undefined ? input.progress : existing?.progress ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      schema: 2,
      snapshot: input.snapshot ?? existing?.snapshot,
    };

    draft.dedupKey = computeDedupKey(draft, seq);

    await this.db.run('entries', 'readwrite', (tx) => this.db.put(tx, 'entries', draft));
    await this.load();
    return draft;
  }

  async remove(entryId: string): Promise<WatchedEntry | null> {
    const target = (await this.load()).find((e) => e.entryId === entryId);
    if (!target) {
      return null;
    }

    await this.db.run(['entries', 'tombstones'], 'readwrite', async (tx) => {
      await this.db.del(tx, 'entries', target.entryId);
      await this.db.put(tx, 'tombstones', {
        key: target.dedupKey || computeDedupKey(target),
        store: 'entries',
        deletedAt: new Date().toISOString(),
        lastKnownUpdatedAt: target.updatedAt,
      });
    });

    await this.load();
    return target;
  }

  /** Отмена удаления: запись возвращается, надгробие снимается. */
  async restore(entry: WatchedEntry): Promise<void> {
    await this.db.run(['entries', 'tombstones'], 'readwrite', async (tx) => {
      await this.db.put(tx, 'entries', { ...entry, updatedAt: new Date().toISOString() });
      await this.db.del(tx, 'tombstones', entry.dedupKey || computeDedupKey(entry));
    });
    await this.load();
  }

  /** Активный просмотр завершён: статус снимается, дата становится фактом. */
  async complete(entryId: string, finishedAt?: string): Promise<WatchedEntry | null> {
    const target = (await this.load()).find((e) => e.entryId === entryId);
    if (!target) {
      return null;
    }
    return this.save({
      entryId: target.entryId,
      id: target.id,
      media_type: target.media_type,
      title: target.title,
      titleOriginal: target.titleOriginal,
      titleRu: target.titleRu,
      poster_path: target.poster_path,
      watchedAt: normalizeDate(finishedAt) ?? todayIso(),
      dateUnknown: false,
      rewatch: target.status === 'rewatching' || target.rewatch,
      rating: target.rating,
      review: target.review,
      tags: target.tags,
      liked: target.liked,
      status: null,
      progress: target.progress,
      snapshot: target.snapshot,
    });
  }

  async setStatus(entryId: string, status: WatchStatus): Promise<WatchedEntry | null> {
    const target = (await this.load()).find((e) => e.entryId === entryId);
    if (!target) {
      return null;
    }
    return this.save({
      entryId: target.entryId,
      id: target.id,
      media_type: target.media_type,
      title: target.title,
      titleOriginal: target.titleOriginal,
      titleRu: target.titleRu,
      poster_path: target.poster_path,
      watchedAt: target.watchedAt,
      dateUnknown: target.dateUnknown,
      rewatch: target.rewatch,
      rating: target.rating,
      review: target.review,
      tags: target.tags,
      liked: target.liked,
      status,
      progress: target.progress,
      snapshot: target.snapshot,
    });
  }

  active(entries: WatchedEntry[] = this.subject.value): WatchedEntry[] {
    return entries.filter((e) => e.status === 'watching' || e.status === 'rewatching');
  }

  completed(entries: WatchedEntry[] = this.subject.value): WatchedEntry[] {
    return entries.filter((e) => e.status !== 'watching' && e.status !== 'rewatching');
  }

  filterAndSort(entries: WatchedEntry[], filter: DiaryFilter, sort: DiarySort): WatchedEntry[] {
    const filtered = entries.filter((e) => {
      const genres = e.snapshot?.genreIds ?? [];
      const lang = (e.snapshot?.original_language ?? '').toLowerCase();
      switch (filter) {
        case 'movie':
          return e.media_type === 'movie';
        case 'tv':
          return e.media_type === 'tv';
        case 'animation':
          return genres.includes(16);
        case 'anime':
          return e.media_type === 'tv' && lang === 'ja' && genres.includes(16);
        case 'kdrama':
          return e.media_type === 'tv' && (lang === 'ko' || lang === 'zh' || lang === 'th' || lang === 'ja');
        default:
          return true;
      }
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'title_asc') {
        return a.title.localeCompare(b.title, 'ru');
      }
      if (sort === 'rating_desc') {
        const diff = (b.rating ?? -1) - (a.rating ?? -1);
        if (diff !== 0) {
          return diff;
        }
      }
      if (sort === 'date_asc') {
        return compareDates(a, b);
      }
      return -compareDates(a, b);
    });
  }

  stats(entries: WatchedEntry[] = this.subject.value, now = new Date()): DiaryStats {
    const done = this.completed(entries).filter((e) => e.watchedAt && !e.dateUnknown);

    const today = isoDay(now);
    const weekStart = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));

    const days = new Set(done.map((e) => normalizeDate(e.watchedAt)).filter(Boolean) as string[]);

    // Серия дней подряд: сегодня может быть ещё пусто — тогда считаем со вчерашнего.
    let streak = 0;
    const cursor = new Date(now);
    if (!days.has(isoDay(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (days.has(isoDay(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      total: done.length,
      today: done.filter((e) => normalizeDate(e.watchedAt) === today).length,
      week: done.filter((e) => {
        const d = normalizeDate(e.watchedAt);
        return !!d && d >= weekStart && d <= today;
      }).length,
      streak,
    };
  }
}

function compareDates(a: WatchedEntry, b: WatchedEntry): number {
  const da = a.watchedAt ?? '';
  const db = b.watchedAt ?? '';
  // Записи без даты всегда в конец, независимо от направления сортировки.
  if (!da && db) {
    return -1;
  }
  if (da && !db) {
    return 1;
  }
  if (da !== db) {
    return da.localeCompare(db);
  }
  return (a.createdAt || '').localeCompare(b.createdAt || '');
}

function sortDesc(list: WatchedEntry[]): WatchedEntry[] {
  return [...list].sort((a, b) => {
    const da = a.watchedAt ?? '';
    const db = b.watchedAt ?? '';
    if (da !== db) {
      return db.localeCompare(da);
    }
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayIso(): string {
  return isoDay(new Date());
}

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // crypto.randomUUID доступен только в secure context; локальная разработка
  // по http://IP обязан работать, а не плодить дубли с пустым ключом.
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
