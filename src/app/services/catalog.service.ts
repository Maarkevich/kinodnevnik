import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { COLLECTIONS, Collection, findCollection } from '../data/collections.config';
import { MediaKind, MediaSnapshot } from '../models/storage.models';
import { DbService } from './db.service';
import { TmdbService } from './tmdb.service';
import { normalizeTitle } from './title-match';

/** У TMDb у сериалов название в `name`, у фильмов — в `title`. */
interface RawMedia {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  original_language?: string;
  vote_average?: number;
  vote_count?: number;
  overview?: string;
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  credits?: {
    crew?: { job: string; department: string; name: string }[];
    cast?: { name: string; character: string; profile_path: string | null; order: number }[];
  };
  production_countries?: { iso_3166_1: string; name: string }[];
  alternative_titles?: { title: string; iso_3166_1: string; type?: string }[];
  results?: Record<string, { link?: string; flatrate?: RawProvider[]; buy?: RawProvider[]; rent?: RawProvider[] }>;
}

interface RawProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priority?: number;
}

export interface WatchWhere {
  link?: string;
  subscription: { name: string; logo: string | null }[];
  purchase: { name: string; logo: string | null }[];
  rent: { name: string; logo: string | null }[];
}

export interface MediaDetails {
  snapshot: MediaSnapshot;
  overview: string;
  runtimeMinutes: number | null;
  seasons: number | null;
  directors: string[];
  cast: { name: string; character: string; profile: string | null }[];
  where: WatchWhere | null;
  /** Русское название удалось получить только из Shikimori. */
  ruTitleSource: 'tmdb' | 'shikimori' | 'none';
}

export interface SeasonEpisode {
  id: number;
  name: string;
  overview: string;
  still: string | null;
  air_date: string | null;
  runtime: number | null;
  watched: boolean;
}

export interface PersonInfo {
  name: string;
  bio: string;
  birthday: string | null;
  deathday: string | null;
  photo: string | null;
  place: string;
}

export interface PersonCredit {
  id: number;
  kind: MediaKind;
  title: string;
  job: string;
  character: string;
  year: string | null;
  poster: string | null;
}

interface RawCredit {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  job?: string;
  character?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
}

function toCredit(c: RawCredit, job: string): PersonCredit {
  return {
    id: c.id,
    kind: c.media_type === 'tv' ? 'tv' : 'movie',
    title: (c.title ?? c.name ?? '').trim(),
    job,
    character: (c.character ?? '').trim(),
    year: (c.release_date ?? c.first_air_date ?? '').slice(0, 4) || null,
    poster: c.poster_path ?? null,
  };
}

export interface FeedPage {
  items: MediaSnapshot[];
  page: number;
  total: number;
  /** Выдача кончается на 500-й странице TMDb — это не ошибка сети. */
  exhausted: boolean;
  error: string | null;
  fromCache: boolean;
}

/**
 * Каталог: подборки, тренды, поиск, карточка тайтла, «где смотреть».
 * Всё через TmdbService — единая точка кэша и ключа.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  constructor(
    private readonly tmdb: TmdbService,
    private readonly db: DbService,
  ) {}

  collections(): readonly Collection[] {
    return COLLECTIONS;
  }

  async collection(id: string, page = 1): Promise<FeedPage> {
    const def = findCollection(id);
    if (!def) {
      return { items: [], page: 1, total: 0, exhausted: true, error: 'Категория не найдена', fromCache: false };
    }

    const params: Record<string, string> = { sort_by: def.sort_by };
    if (def.filters.with_genres) {
      params['with_genres'] = def.filters.with_genres;
    }
    if (def.filters.without_genres) {
      params['without_genres'] = def.filters.without_genres;
    }
    if (def.filters.with_original_language) {
      params['with_original_language'] = def.filters.with_original_language;
    }
    if (def.filters.with_networks) {
      params['with_networks'] = def.filters.with_networks;
    }
    params['page'] = String(page);

    const res = await this.tmdb.get<{ page: number; results: RawMedia[]; total_results: number; total_pages: number }>(
      `/discover/${def.kind}`,
      params,
    );

    const items = (res.data?.results ?? []).map((r) => toSnapshot(r, def.kind));
    return {
      items,
      page: res.data?.page ?? page,
      total: res.data?.total_results ?? 0,
      exhausted: (res.data?.page ?? page) >= (res.data?.total_pages ?? 1),
      error: res.error?.message ?? null,
      fromCache: res.fromCache,
    };
  }

  async trending(page = 1): Promise<FeedPage> {
    const res = await this.tmdb.get<{ page: number; results: RawMedia[]; total_pages: number }>(
      '/trending/all/week',
      { page: String(page) },
    );
    const items = (res.data?.results ?? [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r) => toSnapshot(r, r.media_type as MediaKind));

    return {
      items,
      page: res.data?.page ?? page,
      total: items.length,
      exhausted: (res.data?.page ?? page) >= (res.data?.total_pages ?? 1),
      error: res.error?.message ?? null,
      fromCache: res.fromCache,
    };
  }

  async search(query: string, page = 1): Promise<FeedPage> {
    const res = await this.tmdb.get<{ page: number; results: RawMedia[]; total_pages: number }>(
      '/search/multi',
      { query, page: String(page), include_adult: 'false' },
    );
    const items = (res.data?.results ?? [])
      .filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && (r.title || r.name))
      .map((r) => toSnapshot(r, r.media_type as MediaKind));

    return {
      items,
      page: res.data?.page ?? page,
      total: items.length,
      exhausted: (res.data?.page ?? page) >= (res.data?.total_pages ?? 1),
      error: res.error?.message ?? null,
      fromCache: res.fromCache,
    };
  }

  /**
   * Карточка тайтла. Сначала всегда локальный снимок: экран не имеет права
   * быть пустым, если тайтл уже есть в дневнике (дефект T-05 в доноре).
   */
  async details(kind: MediaKind, id: number): Promise<MediaDetails | null> {
    const local = await this.cachedSnapshot(kind, id);
    const res = await this.tmdb.get<RawMedia>(`/${kind}/${id}`, {
      append_to_response: 'credits,alternative_titles',
    });

    if (!res.data || typeof res.data.id !== 'number') {
      return local ? fromCached(local) : null;
    }

    const raw = res.data;
    const snapshot = toSnapshot(raw, kind);
    const directors = (raw.credits?.crew ?? [])
      .filter((c) => c.job === 'Director' || c.department === 'Directing')
      .slice(0, 3)
      .map((c) => c.name);

    let ruTitleSource: MediaDetails['ruTitleSource'] = snapshot.titleRu ? 'tmdb' : 'none';

    // Обогащение русским названием из Shikimori — только для аниме.
    // Для корейского он даёт ложные совпадения (проверено: «무한도전» →
    // «Мы — детективы»), поэтому расширение строго ограничено.
    if (!snapshot.titleRu && isAnime(kind, raw)) {
      const alt = await this.shikimoriRuTitle(raw);
      if (alt) {
        snapshot.titleRu = alt;
        snapshot.title = alt;
        ruTitleSource = 'shikimori';
      }
    }

    const where = await this.watchWhere(kind, id);

    const details: MediaDetails = {
      snapshot,
      overview: (raw.overview ?? '').trim(),
      runtimeMinutes: raw.runtime ?? raw.episode_run_time?.[0] ?? null,
      seasons: raw.number_of_seasons ?? null,
      directors,
      cast: (raw.credits?.cast ?? []).slice(0, 12).map((c) => ({
        name: c.name,
        character: c.character,
        profile: c.profile_path ?? null,
      })),
      where,
      ruTitleSource,
    };

    await this.saveSnapshot(snapshot);
    return details;
  }

  /**
   * «Где смотреть» (спецификация, 7.6).
   * Если региона RU в ответе нет — возвращаем null, и блок не рендерится
   * вообще. Пустая плашка «нет данных» хуже, чем её отсутствие.
   */
  async watchWhere(kind: MediaKind, id: number): Promise<WatchWhere | null> {
    const res = await this.tmdb.get<RawMedia>(`/${kind}/${id}/watch/providers`, {});
    const ru = res.data?.results?.['RU'];
    if (!ru) {
      return null;
    }
    const map = (list?: RawProvider[]) =>
      (list ?? []).map((p) => ({ name: p.provider_name, logo: this.tmdb.imageUrl(p.logo_path, 'w92') }));

    return {
      link: ru.link,
      subscription: map(ru.flatrate),
      purchase: map(ru.buy),
      rent: map(ru.rent),
    };
  }

  async cachedSnapshot(kind: MediaKind, id: number): Promise<MediaSnapshot | null> {
    const rec = await this.db.run('titles', 'readonly', (tx) =>
      this.db.get<{ mediaKey: string; snapshot: MediaSnapshot }>(tx, 'titles', `${kind}:${id}`),
    );
    return rec?.snapshot ?? null;
  }

  async saveSnapshot(snapshot: MediaSnapshot): Promise<void> {
    await this.db.run('titles', 'readwrite', (tx) =>
      this.db.put(tx, 'titles', {
        mediaKey: `${snapshot.media_type}:${snapshot.id}`,
        snapshot,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  /** Нужен ли ключ вообще (для понятных состояний в UI). */
  hasKey(): boolean {
    return this.tmdb.hasKey();
  }

  /**
   * Сезон: список серий с локальным дополнением. Если сети нет — берём
   * то, что уже сохраняли, и не показываем пустой экран.
   */
  async season(tvId: number, seasonNumber: number): Promise<{ showTitle: string; episodes: SeasonEpisode[] } | null> {
    const res = await this.tmdb.get<RawMedia>(`/tv/${tvId}/season/${seasonNumber}`, {});
    const data = res.data;
    if (!data || !Array.isArray((data as unknown as { episodes?: unknown[] }).episodes)) {
      return null;
    }
    const episodes = ((data as unknown as { episodes: RawMedia[] }).episodes ?? []).map((e) => ({
      id: e.id,
      name: e.name ?? '',
      overview: (e as unknown as { overview?: string }).overview ?? '',
      still: e.backdrop_path ?? null,
      air_date: e.release_date ?? (e as unknown as { air_date?: string }).air_date ?? null,
      runtime: e.runtime ?? null,
      watched: false,
    }));

    return { showTitle: (data.name ?? '').trim(), episodes };
  }

  /** Персона: биография + фильммография. */
  async person(id: number): Promise<{ person: PersonInfo; credits: PersonCredit[] } | null> {
    const res = await this.tmdb.get<RawMedia & { biography?: string; birthday?: string; deathday?: string; place_of_birth?: string; profile_path?: string }>(
      `/person/${id}`,
      { append_to_response: 'combined_credits' },
    );
    const data = res.data;
    if (!data || typeof data.id !== 'number') {
      return null;
    }

    const credits = ((data as unknown as { combined_credits?: { cast?: RawCredit[]; crew?: RawCredit[] } }).combined_credits ?? {});
    const rows: PersonCredit[] = [
      ...(credits.cast ?? []).map((c) => toCredit(c, 'actor')),
      ...(credits.crew ?? []).map((c) => toCredit(c, c.job ?? 'crew')),
    ]
      .filter((c) => !!c.title && (c.kind === 'movie' || c.kind === 'tv'))
      .sort((a, b) => (b.year ?? '0').localeCompare(a.year ?? '0'))
      .slice(0, 60);

    return {
      person: {
        name: (data.name ?? '').trim(),
        bio: (data.biography ?? '').trim(),
        birthday: data.birthday ?? null,
        deathday: data.deathday ?? null,
        photo: data.profile_path ? this.tmdb.imageUrl(data.profile_path, 'w185') : null,
        place: (data.place_of_birth ?? '').trim(),
      },
      credits: rows,
    };
  }

  /**
   * Shikimori как источник русского названия — только аниме и только при
   * совпадении года ±1. Заголовок User-Agent из браузера не поставить
   * (запрещённый заголовок), поэтому полагаемся на открытый CORS.
   */
  private async shikimoriRuTitle(raw: RawMedia): Promise<string | null> {
    const query = (raw.original_name ?? '').trim();
    if (!query) {
      return null;
    }
    const year = raw.first_air_date ? Number(raw.first_air_date.slice(0, 4)) : null;

    try {
      const url = `${environment.shikimoriBaseUrl}/animes?search=${encodeURIComponent(query)}&limit=5`;
      const res = await fetch(url);
      if (!res.ok) {
        return null;
      }
      const list = (await res.json()) as { name?: string; russian?: string; aired_on?: string | null }[];
      if (!Array.isArray(list)) {
        return null;
      }

      const target = normalizeTitle(query);
      for (const c of list) {
        const ru = (c.russian ?? '').trim();
        if (!ru || !/[а-яё]/i.test(ru)) {
          continue;
        }
        const candYear = c.aired_on ? Number(c.aired_on.slice(0, 4)) : null;
        if (year && candYear && Math.abs(year - candYear) > 1) {
          continue;
        }
        if (normalizeTitle(c.name ?? '') === target) {
          return ru;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}

function isAnime(kind: MediaKind, raw: RawMedia): boolean {
  const lang = (raw.original_language ?? '').toLowerCase();
  const genres = raw.genre_ids ?? raw.genres?.map((g) => g.id) ?? [];
  return kind === 'tv' && lang === 'ja' && genres.includes(16);
}

/**
 * Приведение raw → снимок. Русское название определяем по наличию кириллицы
 * в локализованном поле: если её нет, TMDb отдал оригинал (спецификация, 7.4).
 */
export function toSnapshot(raw: RawMedia, fallbackKind: MediaKind): MediaSnapshot {
  const kind: MediaKind = raw.media_type === 'movie' || raw.media_type === 'tv' ? raw.media_type : fallbackKind;
  const localized = (raw.title ?? raw.name ?? '').trim();
  const original = (raw.original_title ?? raw.original_name ?? localized).trim();
  const hasRu = /[а-яё]/i.test(localized);
  const titleRu = hasRu ? localized : null;

  return {
    id: raw.id,
    media_type: kind,
    title: titleRu || original || localized,
    titleOriginal: original,
    titleRu,
    poster: raw.poster_path ?? null,
    backdrop: raw.backdrop_path ?? null,
    release_date: raw.release_date ?? raw.first_air_date ?? null,
    runtime_minutes: raw.runtime ?? raw.episode_run_time?.[0] ?? null,
    genres: raw.genres?.map((g) => g.name) ?? [],
    genreIds: raw.genre_ids ?? [],
    directors: (raw.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name),
    tmdbVoteAverage: typeof raw.vote_average === 'number' ? raw.vote_average : null,
    tmdbVoteCount: typeof raw.vote_count === 'number' ? raw.vote_count : null,
    original_language: raw.original_language ?? null,
    production_countries: (raw.production_countries ?? []).map((c) => c.iso_3166_1),
  };
}

function fromCached(s: MediaSnapshot): MediaDetails {
  return {
    snapshot: s,
    overview: '',
    runtimeMinutes: s.runtime_minutes ?? null,
    seasons: null,
    directors: s.directors ?? [],
    cast: [],
    where: null,
    ruTitleSource: 'none',
  };
}
