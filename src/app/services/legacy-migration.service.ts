import { Injectable } from '@angular/core';
import {
  AppSettings,
  CustomList,
  DEFAULT_SETTINGS,
  FavoriteItem,
  ListItemEntry,
  UserProfile,
  WatchedEntry,
  WatchlistItem,
} from '../models/storage.models';
import { computeDedupKey, mediaKey, normalizeDate, recomputeDedupKeys } from '../utils/keys';
import { DbService } from './db.service';

const FLAG = 'legacy_migration_v1';
/** Резервные копии исходников localStorage держим 30 дней (спецификация, 8.6). */
const BACKUP_PREFIX = 'kd_migrated_backup_';
const BACKUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface MigrationResult {
  ran: boolean;
  entries: number;
  watchlist: number;
  favorites: number;
  lists: number;
  cacheEntries: number;
  skippedFields: string[];
}

/**
 * Однократный перенос из localStorage донора в IndexedDB.
 *
 * Имена ключей и полей взяты из кода донора, а не наугад:
 *   mva_watched   — объект {entryId: WatchedEntry}
 *   mva_watchlist — объект {"movie:603": WatchlistEntry}
 *   mva_favorites — массив (лимит 4)
 *   mva_lists     — объект {id: UserList} c items внутри
 *   mva_settings  — объект настроек
 *   tmdb_cache_v2:<path>?<params> — МНОГО ключей, а не один объект
 *
 * Поля `theme`, `primaryColor`, `autoCheckUpdates`, `customCover`,
 * `defaultMediaTab` из продукта выведены и при переносе игнорируются —
 * но не удаляются из типа, чтобы старые копии читались вечно.
 */
@Injectable({ providedIn: 'root' })
export class LegacyMigrationService {
  constructor(private readonly db: DbService) {}

  async run(): Promise<MigrationResult> {
    const skipped: string[] = [];
    this.cleanupOldBackups();

    if (typeof localStorage === 'undefined') {
      return empty(skipped);
    }

    const done = await this.db.run('settings', 'readonly', (tx) =>
      this.db.get<{ k: string; v: boolean }>(tx, 'settings', FLAG),
    );
    if (done?.v === true) {
      return empty(skipped);
    }

    const legacy = collectLegacyKeys();
    if (legacy.data.length === 0 && legacy.cache.length === 0) {
      // Пустое устройство: флаг ставим, чтобы не сканировать при каждом старте.
      await this.markDone();
      return empty(skipped);
    }

    const now = new Date().toISOString();
    const parsed = parseAll(legacy);

    const entries = migrateEntries(parsed.watched, now, skipped);
    const watchlist = migrateWatchlist(parsed.watchlist, now);
    const favorites = migrateFavorites(parsed.favorites, now);
    const { lists, listItems } = migrateLists(parsed.lists, now);
    const profile = migrateProfile(parsed.profile, parsed.settings, now);
    const settings = migrateSettings(parsed.settings, now, skipped);
    const cache = migrateCache(legacy.cache);

    await this.db.run(
      ['entries', 'watchlist', 'favorites', 'lists', 'listItems', 'profiles', 'settings', 'tmdbCache'],
      'readwrite',
      async (tx) => {
        for (const e of entries) {
          await this.db.put(tx, 'entries', e);
        }
        for (const w of watchlist) {
          await this.db.put(tx, 'watchlist', w);
        }
        for (const f of favorites) {
          await this.db.put(tx, 'favorites', f);
        }
        for (const l of lists) {
          await this.db.put(tx, 'lists', l);
        }
        for (const li of listItems) {
          await this.db.put(tx, 'listItems', li);
        }
        if (profile) {
          await this.db.put(tx, 'profiles', profile);
        }
        await this.db.put(tx, 'settings', { k: 'app', v: settings });
        for (const c of cache) {
          await this.db.put(tx, 'tmdbCache', c);
        }
        await this.db.put(tx, 'settings', { k: FLAG, v: true });
      },
    );

    // Страховка: исходники не удаляем молча, а перекладываем в помеченные
    // ключи на 30 дней. Если миграция окажется кривой, данные ещё можно вернуть.
    stashBackup(legacy);

    return {
      ran: true,
      entries: entries.length,
      watchlist: watchlist.length,
      favorites: favorites.length,
      lists: lists.length,
      cacheEntries: cache.length,
      skippedFields: skipped,
    };
  }

  private async markDone(): Promise<void> {
    await this.db.run('settings', 'readwrite', (tx) => this.db.put(tx, 'settings', { k: FLAG, v: true }));
  }

  private cleanupOldBackups(): void {
    const cutoff = Date.now() - BACKUP_TTL_MS;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(BACKUP_PREFIX)) {
        continue;
      }
      const stamp = Number(k.slice(BACKUP_PREFIX.length));
      if (Number.isFinite(stamp) && stamp < cutoff) {
        doomed.push(k);
      }
    }
    for (const k of doomed) {
      localStorage.removeItem(k);
    }
  }
}

function empty(skipped: string[]): MigrationResult {
  return { ran: false, entries: 0, watchlist: 0, favorites: 0, lists: 0, cacheEntries: 0, skippedFields: skipped };
}

interface LegacyKeys {
  data: string[];
  cache: string[];
}

function collectLegacyKeys(): LegacyKeys {
  const data: string[] = [];
  const cache: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || k.startsWith(BACKUP_PREFIX)) {
      continue;
    }
    // Кэш — отдельностью: у донора это много ключей с префиксом.
    if (k.startsWith('tmdb_cache_v2:')) {
      cache.push(k);
    } else if (k.startsWith('mva_')) {
      data.push(k);
    }
  }
  return { data, cache };
}

type Json = Record<string, unknown>;

function parseAll(legacy: LegacyKeys): {
  watched: Json;
  watchlist: Json;
  favorites: unknown[];
  lists: Json;
  profile: Json | null;
  settings: Json | null;
} {
  const read = <T,>(key: string, fallback: T): T => {
    const raw = localStorage.getItem(`mva_${key}`);
    if (!raw) {
      return fallback;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  return {
    watched: read<Json>('watched', {}),
    watchlist: read<Json>('watchlist', {}),
    favorites: read<unknown[]>('favorites', []),
    lists: read<Json>('lists', {}),
    profile: read<Json | null>('profile', null),
    settings: read<Json | null>('settings', null),
  };
}

function migrateEntries(raw: Json, now: string, skipped: string[]): WatchedEntry[] {
  const list = Object.values(raw).filter((v): v is Json => !!v && typeof v === 'object');

  const mapped = list.map((e): WatchedEntry | null => {
    if (typeof e['id'] !== 'number' || typeof e['media_type'] !== 'string') {
      return null;
    }
    const kind = e['media_type'] === 'tv' ? 'tv' : 'movie';
    const title = str(e['title']);
    const entryId = str(e['entryId']) || `mig-${Math.random().toString(36).slice(2, 10)}`;
    const watchedAt = normalizeDate(str(e['watchedAt']));

    if (e['runtimeMinutes'] !== undefined) {
      skipped.push('runtimeMinutes');
    }

    return {
      entryId,
      dedupKey: '',
      id: e['id'] as number,
      media_type: kind,
      title,
      titleOriginal: str(e['original_title'] ?? e['original_name']) || title,
      titleRu: hasCyrillic(title) ? title : null,
      poster_path: nullableStr(e['poster_path']),
      watchedAt,
      dateUnknown: e['dateUnknown'] === true || !watchedAt,
      approximateDate: typeof e['approximateDate'] === 'boolean' ? e['approximateDate'] : false,
      importerCreated: e['importerCreated'] === true,
      // Правки из донора не отличить от импортированных — считаем не ручными,
      // чтобы свежая локальная правка при слиянии имела приоритет.
      userEdited: e['userEdited'] === true,
      rewatch: e['rewatch'] === true,
      rating: typeof e['rating'] === 'number' ? (e['rating'] as number) : null,
      review: str(e['review']),
      tags: Array.isArray(e['tags']) ? (e['tags'] as unknown[]).filter((t): t is string => typeof t === 'string') : [],
      liked: e['liked'] === true,
      sourceKey: nullableStr(e['sourceKey']) ?? undefined,
      release_date: nullableStr(e['release_date']),
      first_air_date: nullableStr(e['first_air_date']),
      status: null,
      progress: null,
      createdAt: str(e['addedAt']) || str(e['createdAt']) || now,
      updatedAt: str(e['updatedAt']) || str(e['addedAt']) || now,
      schema: 2,
      snapshot: migrateSnapshot(e['snapshot'], e['id'] as number, kind, title, now),
    };
  });

  const clean = mapped.filter((x): x is WatchedEntry => x !== null);
  // Ключи считаем все сразу: порядок внутри одного дня должен быть детерминирован.
  const withKeys = recomputeDedupKeys(clean);
  for (const e of withKeys) {
    e.dedupKey = computeDedupKey(e, seqOf(e, withKeys));
  }
  return withKeys;
}

function seqOf(entry: WatchedEntry, all: WatchedEntry[]): number {
  if (!entry.watchedAt || entry.dateUnknown) {
    return 0;
  }
  const same = all
    .filter(
      (e) =>
        e.media_type === entry.media_type &&
        e.id === entry.id &&
        normalizeDate(e.watchedAt) === normalizeDate(entry.watchedAt),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.entryId.localeCompare(b.entryId));
  return same.findIndex((e) => e.entryId === entry.entryId);
}

function migrateSnapshot(raw: unknown, id: number, kind: 'movie' | 'tv', title: string, now: string) {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const s = raw as Json;
  const snapTitle = str(s['title']) || title;
  return {
    id,
    media_type: kind,
    title: snapTitle,
    titleOriginal: str(s['titleOriginal']) || snapTitle,
    titleRu: hasCyrillic(snapTitle) ? snapTitle : null,
    poster: nullableStr(s['poster'] ?? s['poster_path']),
    backdrop: nullableStr(s['backdrop'] ?? s['backdrop_path']),
    release_date: nullableStr(s['release_date'] ?? s['first_air_date']),
    runtime_minutes: typeof s['runtimeMinutes'] === 'number' ? (s['runtimeMinutes'] as number) : null,
    genres: asStrings(s['genres']),
    genreIds: asNumbers(s['genreIds'] ?? s['genre_ids']),
    directors: asStrings(s['directors']),
    tmdbVoteAverage: typeof s['tmdbVoteAverage'] === 'number' ? (s['tmdbVoteAverage'] as number) : null,
    tmdbVoteCount: typeof s['tmdbVoteCount'] === 'number' ? (s['tmdbVoteCount'] as number) : null,
    original_language: nullableStr(s['originalLanguage'] ?? s['original_language']),
    production_countries: asStrings(s['productionCountries'] ?? s['production_countries']),
  };
}

function migrateWatchlist(raw: Json, now: string): WatchlistItem[] {
  return Object.values(raw)
    .filter((v): v is Json => {
      if (!v || typeof v !== 'object') {
        return false;
      }
      return typeof (v as Json)['id'] === 'number';
    })
    .map((w) => {
      const kind = w['media_type'] === 'tv' ? 'tv' : 'movie';
      const title = str(w['title']);
      return {
        key: mediaKey(kind, w['id'] as number),
        id: w['id'] as number,
        media_type: kind,
        title,
        titleOriginal: str(w['original_name'] ?? w['original_title']) || title,
        titleRu: hasCyrillic(title) ? title : null,
        poster_path: nullableStr(w['poster_path']),
        addedAt: str(w['addedAt']) || now,
        updatedAt: str(w['updatedAt']) || str(w['addedAt']) || now,
      };
    });
}

function migrateFavorites(raw: unknown[], now: string): FavoriteItem[] {
  return raw
    .filter((v): v is Json => {
      if (!v || typeof v !== 'object') {
        return false;
      }
      return typeof (v as Json)['id'] === 'number';
    })
    .slice(0, 4)
    .map((f, i) => {
      const kind = f['media_type'] === 'tv' ? 'tv' : 'movie';
      const title = str(f['title']);
      return {
        key: mediaKey(kind, f['id'] as number),
        id: f['id'] as number,
        media_type: kind,
        title,
        poster_path: nullableStr(f['poster_path']),
        order: typeof f['order'] === 'number' ? (f['order'] as number) : i,
        addedAt: str(f['addedAt']) || now,
        updatedAt: str(f['updatedAt']) || str(f['addedAt']) || now,
      };
    });
}

function migrateLists(raw: Json, now: string): { lists: CustomList[]; listItems: ListItemEntry[] } {
  const lists: CustomList[] = [];
  const listItems: ListItemEntry[] = [];

  for (const value of Object.values(raw)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const l = value as Json;
    const id = str(l['id']) || `list-${lists.length}`;
    lists.push({
      id,
      title: str(l['name'] ?? l['title']) || 'Список',
      description: nullableStr(l['description']) ?? undefined,
      createdAt: str(l['createdAt']) || now,
      updatedAt: str(l['updatedAt']) || str(l['createdAt']) || now,
    });

    const items = Array.isArray(l['items']) ? (l['items'] as unknown[]) : [];
    for (const it of items) {
      if (!it || typeof it !== 'object') {
        continue;
      }
      const item = it as Json;
      if (typeof item['id'] !== 'number') {
        continue;
      }
      const kind = item['media_type'] === 'tv' ? 'tv' : 'movie';
      listItems.push({
        listId: id,
        mediaKey: mediaKey(kind, item['id'] as number),
        id: item['id'] as number,
        media_type: kind,
        addedAt: str(item['addedAt']) || now,
        updatedAt: str(item['updatedAt']) || str(item['addedAt']) || now,
      });
    }
  }

  return { lists, listItems };
}

function migrateProfile(raw: Json | null, settings: Json | null, now: string): UserProfile | null {
  if (!raw && !settings) {
    return null;
  }
  const p = (raw ?? {}) as Json;
  const s = (settings ?? {}) as Json;
  const name = str(p['displayName'] ?? s['displayName'] ?? p['name']);
  // Донорский дефолт 'Movie Fan' — не имя пользователя, а заглушка.
  const displayName = name && name !== 'Movie Fan' ? name : '';

  return {
    id: 'self',
    name: displayName,
    bio: str(p['bio']),
    avatarPath: nullableStr(p['avatarBase64'] ?? p['avatarPath']),
    coverPath: nullableStr(p['coverBase64'] ?? p['coverPath']),
    joinedAt: str(p['joinedAt']) || now,
    updatedAt: now,
  };
}

function migrateSettings(raw: Json | null, now: string, skipped: string[]): AppSettings {
  const s = (raw ?? {}) as Json;

  for (const dropped of ['theme', 'primaryColor', 'autoCheckUpdates', 'customCover', 'defaultMediaTab']) {
    if (s[dropped] !== undefined) {
      skipped.push(dropped);
    }
  }

  const language = str(s['language']);
  const region = str(s['region']);

  return {
    // Приложение русское: язык контента приводим к ru, если донор не хранил
    // осознанный выбор отличного от английского.
    language: !language || language.startsWith('en') ? DEFAULT_SETTINGS.language : language,
    region: !region || region === 'US' ? DEFAULT_SETTINGS.region : region,
    includeAdult: s['includeAdult'] === true,
    fadeWatched: typeof s['fadeWatched'] === 'boolean' ? (s['fadeWatched'] as boolean) : true,
    defaultTab: 'diary',
    excludeLanguages: Array.isArray(s['excludeLanguages'])
      ? (s['excludeLanguages'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    originalTitleMode: 'mismatch',
    displayName: str(s['displayName']) && str(s['displayName']) !== 'Movie Fan' ? str(s['displayName']) : '',
    bio: '',
    episodeWatched:
      s['episodeWatched'] && typeof s['episodeWatched'] === 'object'
        ? (s['episodeWatched'] as Record<string, boolean>)
        : {},
    // Ключ, который пользователь ввёл сам в доноре, остаётся его и живёт локально.
    tmdbApiKey: nullableStr(s['tmdbApiKey']) ?? undefined,
    hapticsEnabled: typeof s['hapticsEnabled'] === 'boolean' ? (s['hapticsEnabled'] as boolean) : true,
  };
}

function migrateCache(keys: string[]) {
  return keys
    .map((k) => {
      const raw = localStorage.getItem(k);
      if (!raw) {
        return null;
      }
      try {
        return {
          // savedAt = 0: кэш из донора считается устаревшим и годится только
          // как фолбэк офлайн, а не как свежий ответ.
          cacheKey: k.slice('tmdb_cache_v2:'.length),
          savedAt: 0,
          data: JSON.parse(raw),
        };
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

function stashBackup(legacy: LegacyKeys): void {
  const stamp = Date.now();
  try {
    const dump: Record<string, unknown> = {};
    for (const k of [...legacy.data, ...legacy.cache]) {
      const v = localStorage.getItem(k);
      if (v !== null) {
        dump[k] = v;
      }
    }
    localStorage.setItem(`${BACKUP_PREFIX}${stamp}`, JSON.stringify(dump));
    for (const k of [...legacy.data, ...legacy.cache]) {
      localStorage.removeItem(k);
    }
  } catch {
    // Квота localStorage может не позволить копию. Тогда исходники НЕ удаляем:
    // лучше повторная миграция, чем потеря данных.
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const nullableStr = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const hasCyrillic = (v: string): boolean => /[а-яё]/i.test(v);
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const asNumbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);
