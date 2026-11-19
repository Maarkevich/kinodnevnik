import { MediaKind } from '../models/storage.models';

/**
 * Категории — это данные, а не разметка (спецификация, 7.3).
 *
 * Ключевой факт, проверенный на живом API: жанра «дорама» в TMDb НЕТ
 * (поиск keyword по «дорама»/«kdrama» пуст), а фильтр по студиям
 * (`with_networks`) для корейских сетей отдаёт 0. Поэтому «Дорамы» —
 * это сохранённый discover-запрос, а не поле в TMDb.
 *
 * Доля названий кириллицей в топ-60 по популярности (замерено):
 *   ko без жанра 50% | ko + драма/мелодрама 75% | ko + ток-шоу 6%
 * Отсюда правило: категорию дорам строим СТРОГО с жанровым фильтром,
 * иначе в неё сваливается корейское варьете без русских названий.
 */

export interface CollectionFilters {
  with_genres?: string;
  without_genres?: string;
  with_original_language?: string;
  with_networks?: string;
}

export interface Collection {
  id: string;
  title: string;
  kind: MediaKind;
  filters: CollectionFilters;
  sort_by: string;
  /** Ручные ID, которые всегда добавляем в начало выдачи. */
  pinned?: number[];
}

export const TMDB_GENRE = {
  animation: 16,
  drama: 18,
  romance: 10749,
  soap: 10766,
  reality: 10764,
  talk: 10767,
} as const;

export const COLLECTIONS: readonly Collection[] = [
  {
    id: 'animation-tv',
    title: 'Мультсериалы',
    kind: 'tv',
    filters: { with_genres: String(TMDB_GENRE.animation) },
    sort_by: 'popularity.desc',
  },
  {
    id: 'animation',
    title: 'Мультфильмы',
    kind: 'movie',
    filters: { with_genres: String(TMDB_GENRE.animation) },
    sort_by: 'popularity.desc',
  },
  {
    id: 'anime',
    title: 'Аниме',
    kind: 'tv',
    // ja + 16: 5500 тайтлов, 85% с русским названием.
    filters: { with_original_language: 'ja', with_genres: String(TMDB_GENRE.animation) },
    sort_by: 'popularity.desc',
  },
  {
    id: 'kdrama',
    title: 'Корейские дорамы',
    kind: 'tv',
    filters: {
      with_original_language: 'ko',
      with_genres: `${TMDB_GENRE.drama}|${TMDB_GENRE.romance}`,
    },
    sort_by: 'popularity.desc',
  },
  {
    id: 'cdrama',
    title: 'Китайские дорамы',
    kind: 'tv',
    // 45% русских названий без жанра → берём драму.
    filters: { with_original_language: 'zh', with_genres: String(TMDB_GENRE.drama) },
    sort_by: 'popularity.desc',
  },
  {
    id: 'tdrama',
    title: 'Тайские дорамы',
    kind: 'tv',
    // Покрытие худшее: 35% без жанра, 51% с драмой.
    filters: { with_original_language: 'th', with_genres: String(TMDB_GENRE.drama) },
    sort_by: 'popularity.desc',
  },
  {
    id: 'jdrama',
    title: 'Японские дорамы',
    kind: 'tv',
    // Драма, но не анимация — иначе сливается с категорией «Аниме».
    filters: {
      with_original_language: 'ja',
      with_genres: String(TMDB_GENRE.drama),
      without_genres: String(TMDB_GENRE.animation),
    },
    sort_by: 'popularity.desc',
  },
  {
    id: 'turkish',
    title: 'Турецкие сериалы',
    kind: 'tv',
    filters: { with_original_language: 'tr' },
    sort_by: 'popularity.desc',
  },
  {
    id: 'spanish',
    title: 'Испанские сериалы',
    kind: 'tv',
    filters: { with_original_language: 'es' },
    sort_by: 'popularity.desc',
  },
  {
    id: 'russian',
    title: 'Русские сериалы',
    kind: 'tv',
    filters: { with_original_language: 'ru' },
    sort_by: 'popularity.desc',
  },
  {
    id: 'reality',
    title: 'Реалити и ток-шоу',
    kind: 'tv',
    filters: { with_genres: `${TMDB_GENRE.reality}|${TMDB_GENRE.talk}` },
    sort_by: 'popularity.desc',
  },
];

export function findCollection(id: string | null): Collection | undefined {
  return id ? COLLECTIONS.find((c) => c.id === id) : undefined;
}

/** Чипы фильтра дневника — переиспользуют те же жанры, что и подборки. */
export const DIARY_FILTER_LABELS: Record<string, string> = {
  all: 'Все',
  movie: 'Фильмы',
  tv: 'Сериалы',
  animation: 'Мультфильмы',
  anime: 'Аниме',
  kdrama: 'Дорамы',
};
