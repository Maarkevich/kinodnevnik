import { Injectable } from '@angular/core';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import {
  AppSettings,
  CustomList,
  FavoriteItem,
  ListItemEntry,
  SECRET_SETTING_KEYS,
  TitleOverride,
  Tombstone,
  UserProfile,
  WatchedEntry,
  WatchlistItem,
} from '../models/storage.models';
import { computeDedupKey, normalizeDate, recomputeDedupKeys } from '../utils/keys';
import { DbService, StoreName } from './db.service';
import { titleSimilarity } from './title-match';

export const TOMBSTONE_TTL_DAYS = 90;
export const SNAPSHOT_TTL_DAYS = 30;

export const BACKUP_FORMAT = 'kinodnevnik';
export const BACKUP_VERSION = 2;

export interface BackupBundle {
  app: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  entries: WatchedEntry[];
  watchlist: WatchlistItem[];
  favorites: FavoriteItem[];
  lists: CustomList[];
  listItems: ListItemEntry[];
  profiles: UserProfile[];
  /** Настройки без ключей API. */
  settings: AppSettings | null;
  overrides: TitleOverride[];
  tombstones: Tombstone[];
}

export interface ConflictRecord {
  dedupKey: string;
  title: string;
  reason: ConflictReason;
  localUpdatedAt: string;
  incomingUpdatedAt: string;
}

export type ConflictReason = 'userEdited-local' | 'userEdited-incoming' | 'lww-incoming' | 'lww-local' | 'tie-local';

export interface ImportReport {
  snapshotId: string;
  added: number;
  updated: number;
  identical: number;
  mergedUndated: number;
  blockedByTombstone: number;
  conflicts: ConflictRecord[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Слияние бэкапов (спецификация, раздел 9).
 *
 * Порядок шагов фиксирован: сначала надгробия, затем дедупликация по
 * семантическому ключу, затем разрешение конфликтов. Всё в одной
 * транзакции IndexedDB — частичный импорт хуже испорченного.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  constructor(private readonly db: DbService) {}

  // ── Экспорт ────────────────────────────────────────────────────────────

  async buildBundle(): Promise<BackupBundle> {
    return this.db.run(
      ['entries', 'watchlist', 'favorites', 'lists', 'listItems', 'profiles', 'settings', 'overrides', 'tombstones'],
      'readonly',
      async (tx) => {
        const [entries, watchlist, favorites, lists, listItems, profiles, settings, overrides, tombstones] =
          await Promise.all([
            this.db.all<WatchedEntry>(tx, 'entries'),
            this.db.all<WatchlistItem>(tx, 'watchlist'),
            this.db.all<FavoriteItem>(tx, 'favorites'),
            this.db.all<CustomList>(tx, 'lists'),
            this.db.all<ListItemEntry>(tx, 'listItems'),
            this.db.all<UserProfile>(tx, 'profiles'),
            this.db.all<{ k: string; v: AppSettings }>(tx, 'settings'),
            this.db.all<TitleOverride>(tx, 'overrides'),
            this.db.all<Tombstone>(tx, 'tombstones'),
          ]);

        const app = settings.find((s) => s.k === 'app')?.v ?? null;

        return {
          app: BACKUP_FORMAT,
          version: BACKUP_VERSION,
          exportedAt: new Date().toISOString(),
          // Ключи API не уезжают никуда (спецификация, 15.3).
          settings: app ? redact(app) : null,
          entries,
          watchlist,
          favorites,
          lists,
          listItems,
          profiles,
          overrides,
          tombstones,
        };
      },
    );
  }

  async exportFile(): Promise<{ blob: Blob; filename: string }> {
    const bundle = await this.buildBundle();
    const gz = gzipSync(strToU8(JSON.stringify(bundle)));
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const filename =
      `kino-dnevnik-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
      `-${p(now.getHours())}${p(now.getMinutes())}.json.gz`;
    return { blob: new Blob([gz as unknown as ArrayBuffer], { type: 'application/gzip' }), filename };
  }

  async readBackupFile(file: File): Promise<BackupBundle> {
    const buf = new Uint8Array(await file.arrayBuffer());
    const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    const text = isGzip ? strFromU8(gunzipSync(buf)) : new TextDecoder().decode(buf);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Файл повреждён или это не резервная копия «Кинодневника».');
    }

    const b = parsed as Partial<BackupBundle>;
    if (!b || b.app !== BACKUP_FORMAT) {
      throw new Error('Формат файла не распознан: это не выгрузка «Кинодневника».');
    }
    if (b.version !== BACKUP_VERSION) {
      throw new Error(`Версия файла ${b.version} не поддерживается текущей сборкой.`);
    }

    return {
      app: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: b.exportedAt ?? new Date().toISOString(),
      entries: asArray<WatchedEntry>(b.entries, isEntry),
      watchlist: asArray<WatchlistItem>(b.watchlist, (x) => typeof x.key === 'string'),
      favorites: asArray<FavoriteItem>(b.favorites, (x) => typeof x.key === 'string'),
      lists: asArray<CustomList>(b.lists, (x) => typeof x.id === 'string'),
      listItems: asArray<ListItemEntry>(b.listItems, (x) => typeof x.listId === 'string'),
      profiles: asArray<UserProfile>(b.profiles, (x) => typeof x.id === 'string'),
      settings: b.settings && typeof b.settings === 'object' ? redact(b.settings) : null,
      overrides: asArray<TitleOverride>(b.overrides, (x) => typeof x.mediaKey === 'string'),
      tombstones: asArray<Tombstone>(b.tombstones, (x) => typeof x.key === 'string'),
    };
  }

  // ── Импорт = синхронизация ─────────────────────────────────────────────

  /**
   * Идемпотентно: импорт одного и того же файла N раз даёт состояние,
   * идентичное одному импорту. Проверяется автотестом (спецификация, 16).
   */
  async importBundle(incoming: BackupBundle): Promise<ImportReport> {
    const snapshotId = `snap-${Date.now()}-${randomToken()}`;
    const report: ImportReport = {
      snapshotId,
      added: 0,
      updated: 0,
      identical: 0,
      mergedUndated: 0,
      blockedByTombstone: 0,
      conflicts: [],
    };

    // 1. Снимок состояния ДО записи — в IndexedDB, не в sessionStorage:
    //    iOS убивает вкладку в фоне, и откат становится невозможен (12.4).
    const before = await this.buildBundle();
    await this.db.run('snapshots', 'readwrite', (tx) =>
      this.db.put(tx, 'snapshots', {
        id: snapshotId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SNAPSHOT_TTL_DAYS * DAY_MS).toISOString(),
        payload: before,
      }),
    );

    // 2. Основное слияние — одной транзакцией.
    await this.db.run(
      ['entries', 'watchlist', 'favorites', 'lists', 'listItems', 'profiles', 'settings', 'overrides', 'tombstones'],
      'readwrite',
      async (tx) => {
        // 2.1. Надгробия объединяем, живые записи не трогаем.
        const localTombstones = await this.db.all<Tombstone>(tx, 'tombstones');
        const tombs = new Map(localTombstones.map((t) => [t.key, t]));
        for (const t of incoming.tombstones) {
          const known = tombs.get(t.key);
          if (!known || ts(t.deletedAt) > ts(known.deletedAt)) {
            tombs.set(t.key, t);
            await this.db.put(tx, 'tombstones', t);
          }
        }

        // 2.2. Дневник.
        /*
         * Ключи пересчитываются на ОБЕИХ сторонах. Иначе импорт теряет
         * пересмотры: два просмотра одного дня в одном файле получали один и
         * тот же dedupKey (seq всегда 0) и схлопывались в одну запись.
         * recomputeDedupKeys детерминирован — порядок внутри пары
         * (media, date) берётся из createdAt, — поэтому два устройства
         * сходятся к одинаковым ключам независимо от очерёдности записей.
         */
        const localEntries = recomputeDedupKeys(await this.db.all<WatchedEntry>(tx, 'entries'));
        const incomingEntries = recomputeDedupKeys([...incoming.entries]);
        for (const e of localEntries) {
          await this.db.put(tx, 'entries', e);
        }
        const byKey = new Map<string, WatchedEntry[]>();
        for (const e of localEntries) {
          const list = byKey.get(e.dedupKey) ?? [];
          list.push(e);
          byKey.set(e.dedupKey, list);
        }

        for (const inc of incomingEntries) {
          if (typeof inc.id !== 'number' || !inc.media_type) {
            continue;
          }
          const key = inc.dedupKey;

          const tomb = tombs.get(key);
          if (tomb && ts(inc.updatedAt || inc.createdAt) <= ts(tomb.deletedAt)) {
            report.blockedByTombstone++;
            continue;
          }

          // Записи без даты не схлопываются никогда: их много и они настоящие.
          const candidates = normalizeDate(inc.watchedAt) ? byKey.get(key) ?? [] : [];
          const existing = candidates.find((c) => !(c.dateUnknown && inc.dateUnknown));

          if (!existing) {
            await this.db.put(tx, 'entries', { ...inc, schema: 2, dedupKey: key });
            const bucket = byKey.get(key) ?? [];
            bucket.push(inc);
            byKey.set(key, bucket);
            report.added++;
            continue;
          }

          if (existing.entryId === inc.entryId && existing.updatedAt === inc.updatedAt) {
            report.identical++;
            continue;
          }

          const merged = mergeEntry(existing, inc, report.conflicts);
          await this.db.put(tx, 'entries', merged);
          const idx = candidates.indexOf(existing);
          if (idx >= 0) {
            candidates[idx] = merged;
          }
          report.updated++;
        }

        // 2.3. Отложенные и избранное: ключ семантический, дубль невозможен.
        report.identical += await this.mergeKeyed<WatchlistItem>(tx, 'watchlist', incoming.watchlist, tombs, report);
        report.identical += await this.mergeKeyed<FavoriteItem>(tx, 'favorites', incoming.favorites, tombs, report);

        // 2.4. Списки и их содержимое.
        report.identical += await this.mergeKeyed<CustomList>(tx, 'lists', incoming.lists, tombs, report, (x) => x.id);

        const localItems = await this.db.all<ListItemEntry>(tx, 'listItems');
        const itemKeys = new Set(localItems.map((i) => `${i.listId}|${i.mediaKey}`));
        for (const li of incoming.listItems) {
          const k = `${li.listId}|${li.mediaKey}`;
          if (itemKeys.has(k)) {
            report.identical++;
            continue;
          }
          const tomb = tombs.get(li.mediaKey);
          if (tomb && ts(li.updatedAt || li.addedAt) <= ts(tomb.deletedAt)) {
            report.blockedByTombstone++;
            continue;
          }
          await this.db.put(tx, 'listItems', li);
          itemKeys.add(k);
          report.added++;
        }

        // 2.5. Ручные названия: побеждает более свежая правка.
        const localOverrides = await this.db.all<TitleOverride>(tx, 'overrides');
        const ovMap = new Map(localOverrides.map((o) => [o.mediaKey, o]));
        for (const ov of incoming.overrides) {
          const cur = ovMap.get(ov.mediaKey);
          if (!cur) {
            await this.db.put(tx, 'overrides', ov);
            report.added++;
          } else if (ts(ov.updatedAt) > ts(cur.updatedAt)) {
            await this.db.put(tx, 'overrides', ov);
            report.updated++;
          } else {
            report.identical++;
          }
        }

        // 2.6. Профиль: локальный не перетирается чужим без явной правки.
        const localProfiles = await this.db.all<UserProfile>(tx, 'profiles');
        const localProfile = localProfiles.find((p) => p.id === 'self');
        for (const p of incoming.profiles) {
          if (localProfile && ts(localProfile.updatedAt) >= ts(p.updatedAt)) {
            continue;
          }
          await this.db.put(tx, 'profiles', p);
        }
      },
    );

    await this.pruneExpired(Date.now());
    return report;
  }

  /** Откат импорта. Секреты и флаг миграции сохраняются. */
  async undoImport(snapshotId: string): Promise<boolean> {
    const snap = await this.db.run('snapshots', 'readonly', (tx) =>
      this.db.get<{ id: string; payload: BackupBundle }>(tx, 'snapshots', snapshotId),
    );
    if (!snap?.payload) {
      return false;
    }
    const bundle = snap.payload;

    await this.db.run(
      ['entries', 'watchlist', 'favorites', 'lists', 'listItems', 'profiles', 'settings', 'overrides', 'tombstones'],
      'readwrite',
      async (tx) => {
        const stores: StoreName[] = ['entries', 'watchlist', 'favorites', 'lists', 'listItems', 'profiles', 'overrides', 'tombstones'];
        for (const name of stores) {
          await this.db.clear(tx, name);
        }

        for (const e of bundle.entries) {
          await this.db.put(tx, 'entries', e);
        }
        for (const w of bundle.watchlist) {
          await this.db.put(tx, 'watchlist', w);
        }
        for (const f of bundle.favorites) {
          await this.db.put(tx, 'favorites', f);
        }
        for (const l of bundle.lists) {
          await this.db.put(tx, 'lists', l);
        }
        for (const li of bundle.listItems) {
          await this.db.put(tx, 'listItems', li);
        }
        for (const p of bundle.profiles) {
          await this.db.put(tx, 'profiles', p);
        }
        for (const o of bundle.overrides) {
          await this.db.put(tx, 'overrides', o);
        }
        for (const t of bundle.tombstones) {
          await this.db.put(tx, 'tombstones', t);
        }

        // Настройки: возвращаем снимок, но ключ API остаётся текущим.
        const current = (await this.db.all<{ k: string; v: unknown }>(tx, 'settings')) ?? [];
        const preserved = current.filter((s) => s.k !== 'app');
        await this.db.clear(tx, 'settings');
        for (const s of preserved) {
          await this.db.put(tx, 'settings', s);
        }
        if (bundle.settings) {
          await this.db.put(tx, 'settings', { k: 'app', v: bundle.settings });
        }
      },
    );

    await this.db.run('snapshots', 'readwrite', (tx) => this.db.del(tx, 'snapshots', snapshotId));
    return true;
  }

  // ── Надгробия ──────────────────────────────────────────────────────────

  async recordDeletion(store: Tombstone['store'], key: string, lastKnownUpdatedAt: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run('tombstones', 'readwrite', (tx) =>
      this.db.put(tx, 'tombstones', {
        key,
        store,
        deletedAt: now,
        lastKnownUpdatedAt,
      } satisfies Tombstone),
    );
  }

  /** Удаляет просроченные надгробия и снимки. */
  async pruneExpired(nowMs = Date.now()): Promise<void> {
    const tombCutoff = nowMs - TOMBSTONE_TTL_DAYS * DAY_MS;
    const snapCutoff = nowMs - SNAPSHOT_TTL_DAYS * DAY_MS;

    await this.db.run(['tombstones', 'snapshots'], 'readwrite', async (tx) => {
      const tombs = await this.db.all<Tombstone>(tx, 'tombstones');
      for (const t of tombs) {
        if (ts(t.deletedAt) < tombCutoff) {
          await this.db.del(tx, 'tombstones', t.key);
        }
      }
      const snaps = await this.db.all<{ id: string; createdAt: string }>(tx, 'snapshots');
      for (const s of snaps) {
        if (ts(s.createdAt) < snapCutoff) {
          await this.db.del(tx, 'snapshots', s.id);
        }
      }
    });
  }

  async lastSnapshotId(): Promise<string | null> {
    const list = await this.db.run('snapshots', 'readonly', (tx) =>
      this.db.all<{ id: string; createdAt: string }>(tx, 'snapshots'),
    );
    if (!list.length) {
      return null;
    }
    return list.sort((a, b) => ts(b.createdAt) - ts(a.createdAt))[0].id;
  }

  // ── Вспомогательное ────────────────────────────────────────────────────

  private async mergeKeyed<T extends { updatedAt: string }>(
    tx: IDBTransaction,
    store: StoreName,
    incoming: T[],
    tombs: Map<string, Tombstone>,
    report: ImportReport,
    keyOf: (x: T) => string = (x) => (x as unknown as { key: string }).key,
  ): Promise<number> {
    const local = await this.db.all<T>(tx, store);
    const map = new Map(local.map((x) => [keyOf(x), x]));
    let identical = 0;

    for (const inc of incoming) {
      const key = keyOf(inc);
      const tomb = tombs.get(key);
      if (tomb && ts(inc.updatedAt) <= ts(tomb.deletedAt)) {
        report.blockedByTombstone++;
        continue;
      }
      const cur = map.get(key);
      if (!cur) {
        await this.db.put(tx, store, inc);
        map.set(key, inc);
        report.added++;
      } else if (ts(inc.updatedAt) > ts(cur.updatedAt)) {
        await this.db.put(tx, store, { ...cur, ...inc });
        map.set(key, { ...cur, ...inc });
        report.updated++;
      } else {
        identical++;
      }
    }
    return identical;
  }
}

/**
 * Разрешение конфликта одной записи (спецификация, 9.4).
 * 1. Ручная правка важнее импортированной.
 * 2. Иначе — более свежий updatedAt.
 * 3. Скалярные поля берём из победителя; теги объединяются.
 */
function mergeEntry(local: WatchedEntry, incoming: WatchedEntry, conflicts: ConflictRecord[]): WatchedEntry {
  let winner: WatchedEntry;
  let reason: ConflictReason;

  if (local.userEdited && !incoming.userEdited) {
    winner = local;
    reason = 'userEdited-local';
  } else if (incoming.userEdited && !local.userEdited) {
    winner = incoming;
    reason = 'userEdited-incoming';
  } else if (ts(incoming.updatedAt) > ts(local.updatedAt)) {
    winner = incoming;
    reason = 'lww-incoming';
  } else if (ts(local.updatedAt) > ts(incoming.updatedAt)) {
    winner = local;
    reason = 'lww-local';
  } else {
    winner = local;
    reason = 'tie-local';
  }

  conflicts.push({
    dedupKey: local.dedupKey,
    title: winner.title,
    reason,
    localUpdatedAt: local.updatedAt,
    incomingUpdatedAt: incoming.updatedAt,
  });

  const sameMediaRenamed =
    local.id === incoming.id &&
    local.title.trim().toLowerCase() !== incoming.title.trim().toLowerCase() &&
    titleSimilarity(local.title, incoming.title) > 0.9;

  return {
    ...winner,
    entryId: local.entryId,
    dedupKey: local.dedupKey,
    createdAt: earlierIso(local.createdAt, incoming.createdAt),
    updatedAt: new Date().toISOString(),
    tags: union(local.tags ?? [], incoming.tags ?? []),
    rewatch: Boolean(local.rewatch || incoming.rewatch || winner.rewatch),
    userEdited: Boolean(local.userEdited || incoming.userEdited),
    // Если названия разошлись несильно — это переименование, берём свежее.
    title: sameMediaRenamed ? winner.title : local.title || winner.title,
    titleRu: winner.titleRu ?? local.titleRu ?? incoming.titleRu ?? null,
    titleOriginal: winner.titleOriginal || local.titleOriginal || incoming.titleOriginal,
    snapshot: winner.snapshot ?? local.snapshot,
    schema: 2,
  };
}

function redact(s: AppSettings): AppSettings {
  const copy = { ...s } as Record<string, unknown>;
  for (const key of SECRET_SETTING_KEYS) {
    delete copy[key];
  }
  return copy as unknown as AppSettings;
}

function asArray<T>(raw: unknown, guard: (x: T) => boolean): T[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((x): x is T => !!x && typeof x === 'object').filter((x) => {
    try {
      return guard(x);
    } catch {
      return false;
    }
  });
}

const isEntry = (x: WatchedEntry): boolean => typeof x.id === 'number' && (x.media_type === 'movie' || x.media_type === 'tv');

function ts(iso: string | null | undefined): number {
  const v = Date.parse(iso ?? '');
  return Number.isFinite(v) ? v : 0;
}

function earlierIso(a: string, b: string): string {
  return ts(a) && ts(b) ? (ts(a) <= ts(b) ? a : b) : a || b;
}

function union<T>(a: T[], b: T[]): T[] {
  return Array.from(new Set([...a, ...b]));
}

function randomToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
