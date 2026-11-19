/**
 * Модель данных «Кинодневника» (спецификация, раздел 8).
 *
 * Совместимость с донором обязательна: старые бэкапы должны читаться вечно,
 * поэтому поля, которые донор писал, не удаляются из типов — только
 * игнорируются при чтении.
 */

export type MediaKind = 'movie' | 'tv';

/** Статус незавершённого просмотра (спецификация, 6.6). */
export type WatchStatus = 'watching' | 'rewatching' | 'dropped' | null;

export interface WatchProgress {
  season: number;
  episode: number;
  total?: number;
}

/**
 * Снимок метаданных на момент записи. Именно он делает возможным офлайн и
 * спасает экран тайтла при 404 (спецификация, 10.2 — дефект T-05 донора).
 */
export interface MediaSnapshot {
  id: number;
  media_type: MediaKind;
  /** То, что показываем: русское, если есть, иначе оригинал. */
  title: string;
  titleOriginal: string;
  /** Русское название, если источник его дал. */
  titleRu: string | null;
  poster: string | null;
  backdrop: string | null;
  release_date: string | null;
  /**
   * Сохраняем, но НЕ суммируем: подсчёт времени просмотра из продукта выведен
   * (спецификация, 2.3), вместе с ним уходит и враньё «108 минут по умолчанию».
   */
  runtime_minutes?: number | null;
  genres: string[];
  genreIds: number[];
  directors: string[];
  tmdbVoteAverage: number | null;
  tmdbVoteCount: number | null;
  original_language: string | null;
  production_countries: string[];
}

export interface WatchedEntry {
  /** UUID события просмотра. Одна позиция может иметь много записей — пересмотры. */
  entryId: string;
  /**
   * Семантический ключ дедупликации, вычисляется при каждой записи и хранится
   * отдельным полем, а не пересчитывается по порядку. Пересчёт «по индексу
   * группы» (как это делают наивные реализации) даёт рассинхрон с надгробиями:
   * удалённый второй пересмотр ищется по ключу с seq=0 и не находится.
   */
  dedupKey: string;
  id: number;
  media_type: MediaKind;
  title: string;
  titleOriginal: string;
  titleRu: string | null;
  poster_path: string | null;
  /** Календарная дата YYYY-MM-DD или null. */
  watchedAt: string | null;
  dateUnknown?: boolean;
  /** В доноре это boolean — сохраняем тип, иначе миграция теряет значение. */
  approximateDate?: boolean;
  importerCreated?: boolean;
  /** Ручная правка: имеет приоритет при конфликте слияния (спецификация, 9.4). */
  userEdited?: boolean;
  rewatch?: boolean;
  /** 0.5–5.0 шагом 0.5. */
  rating?: number | null;
  review?: string;
  tags?: string[];
  liked?: boolean;
  sourceKey?: string;
  release_date?: string | null;
  first_air_date?: string | null;
  status: WatchStatus;
  progress: WatchProgress | null;
  createdAt: string;
  /** Часы для разрешения конфликтов. В модели донора отсутствовали. */
  updatedAt: string;
  schema: 2;
  snapshot?: MediaSnapshot;
}

export interface WatchlistItem {
  /** `${media_type}:${id}` — слияние по нему не даёт дублей в принципе. */
  key: string;
  id: number;
  media_type: MediaKind;
  title: string;
  titleOriginal?: string;
  titleRu?: string | null;
  poster_path: string | null;
  addedAt: string;
  updatedAt: string;
  snapshot?: MediaSnapshot;
}

export interface FavoriteItem {
  key: string;
  id: number;
  media_type: MediaKind;
  title: string;
  poster_path: string | null;
  /** Позиция в полосе избранного (лимит 4 — как в доноре). */
  order: number;
  addedAt: string;
  updatedAt: string;
  snapshot?: MediaSnapshot;
}

export interface CustomList {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListItemEntry {
  listId: string;
  mediaKey: string;
  id: number;
  media_type: MediaKind;
  addedAt: string;
  updatedAt: string;
  snapshot?: MediaSnapshot;
}

export interface UserProfile {
  id: string;
  name: string;
  bio: string;
  avatarPath: string | null;
  coverPath: string | null;
  joinedAt: string;
  updatedAt: string;
}

/** Ручное русское название, когда источник его не дал (спецификация, 7.4). */
export interface TitleOverride {
  mediaKey: string;
  titleRu: string;
  note?: string;
  updatedAt: string;
}

/** Надгробие удаления. Без них импорт возвращает удалённое (спецификация, 9.3). */
export interface Tombstone {
  key: string;
  store: 'entries' | 'watchlist' | 'favorites' | 'lists' | 'listItems';
  deletedAt: string;
  lastKnownUpdatedAt: string;
}

export interface BackupSnapshotRecord {
  id: string;
  createdAt: string;
  expiresAt: string;
  payload: unknown;
}

export interface SettingRecord<T = unknown> {
  k: string;
  v: T;
}

export interface CachedTitleRecord {
  mediaKey: string;
  snapshot: MediaSnapshot;
  updatedAt: string;
}

export interface CachedApiResponse {
  cacheKey: string;
  savedAt: number;
  data: unknown;
}

export interface QueuedImage {
  url: string;
  kind: 'poster' | 'backdrop' | 'logo' | 'profile';
  queuedAt: string;
  attempts: number;
}

/** Настройки приложения. */
export interface AppSettings {
  /** Язык названий и описаний в TMDb. */
  language: string;
  region: string;
  includeAdult: boolean;
  fadeWatched: boolean;
  defaultTab: 'diary' | 'collections';
  excludeLanguages: string[];
  originalTitleMode: 'mismatch' | 'always' | 'never';
  displayName: string;
  bio: string;
  episodeWatched: Record<string, boolean>;
  /** Ключи TMDb. В бэкап НЕ выгружаются (спецификация, 15.3). */
  tmdbApiKey?: string;
  hapticsEnabled?: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ru-RU',
  region: 'RU',
  includeAdult: false,
  fadeWatched: true,
  defaultTab: 'diary',
  excludeLanguages: [],
  originalTitleMode: 'mismatch',
  displayName: '',
  bio: '',
  episodeWatched: {},
  hapticsEnabled: true,
};

export const SETTINGS_KEY = 'settings';

/** Ключи, которые никогда не покидают устройство в составе бэкапа. */
export const SECRET_SETTING_KEYS = ['tmdbApiKey', 'tmdbReadToken'];
