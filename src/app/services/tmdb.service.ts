import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { CachedApiResponse } from '../models/storage.models';
import { DbService } from './db.service';
import { SettingsService } from './settings.service';

const TIMEOUT_MS = 4000;
const FRESH_MS = 24 * 60 * 60 * 1000;

export interface TmdbError {
  status: number | 'network' | 'no-key';
  message: string;
}

export interface TmdbResult<T> {
  data: T | null;
  /** Отдан ли ответ из кэша (важно для честного офлайн-UX). */
  fromCache: boolean;
  error: TmdbError | null;
}

/**
 * Транспорт до TMDb (спецификация, раздел 7 и 15).
 *
 * Ключ берётся из настроек на устройстве и никогда не берётся из кода.
 * Кэш ключуется путём и параметрами, но НЕ ключом API — иначе смена ключа
 * обнулила бы весь офлайн-кэш.
 */
@Injectable({ providedIn: 'root' })
export class TmdbService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
  ) {}

  hasKey(): boolean {
    return !!this.settings.value.tmdbApiKey?.trim();
  }

  async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<TmdbResult<T>> {
    const key = this.settings.value.tmdbApiKey?.trim() ?? '';
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') {
        clean[k] = String(v);
      }
    }
    // Язык и регион подставляются всегда: без них TMDb отдаёт en-US.
    clean['language'] ??= this.settings.value.language || 'ru-RU';

    const cacheKey = buildCacheKey(path, clean);
    const cached = await this.readCache<T>(cacheKey);

    if (!key) {
      return {
        data: cached?.data ?? null,
        fromCache: !!cached,
        error: { status: 'no-key', message: 'Ключ TMDb не задан' },
      };
    }

    const url = new URL(`${environment.tmdbBaseUrl}${path}`);
    for (const [k, v] of Object.entries(clean)) {
      url.searchParams.set(k, v);
    }
    url.searchParams.set('api_key', key);

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

    try {
      const res = await fetch(url.toString(), { signal: controller?.signal });

      if (!res.ok) {
        return {
          data: cached?.data ?? null,
          fromCache: !!cached,
          error: { status: res.status, message: `TMDb ответил ${res.status}` },
        };
      }

      const data = (await res.json()) as T;
      await this.writeCache(cacheKey, data);
      return { data, fromCache: false, error: null };
    } catch (err) {
      const aborted = controller?.signal.aborted === true;
      return {
        data: cached?.data ?? null,
        fromCache: !!cached,
        error: { status: 'network', message: aborted ? 'Превышено время ожидания' : 'Нет сети' },
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /** Проверка ключа реальным запросом (спецификация, 15.1). */
  async validateKey(candidate: string): Promise<{ ok: boolean; status: number | 'network'; message: string }> {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return { ok: false, status: 'network', message: 'Ключ не задан' };
    }
    try {
      const res = await fetch(`${environment.tmdbBaseUrl}/configuration?api_key=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        return { ok: true, status: res.status, message: 'Ключ рабочий' };
      }
      if (res.status === 401) {
        return { ok: false, status: 401, message: 'TMDb отклонил ключ (401)' };
      }
      return { ok: false, status: res.status, message: `TMDb ответил ${res.status}` };
    } catch {
      return { ok: false, status: 'network', message: 'Не удалось связаться с TMDb' };
    }
  }

  /** URL картинки TMDb. Единственная точка генерации — см. PosterService. */
  imageUrl(path: string | null | undefined, size: string): string {
    if (!path) {
      return '';
    }
    if (/^https?:\/\//.test(path)) {
      return path;
    }
    return `${environment.tmdbImageBaseUrl}/${size}${path}`;
  }

  private async readCache<T>(cacheKey: string): Promise<CachedApiResponse & { data: T } | null> {
    try {
      const rec = await this.db.run('tmdbCache', 'readonly', (tx) =>
        this.db.get<CachedApiResponse>(tx, 'tmdbCache', cacheKey),
      );
      return rec ? (rec as CachedApiResponse & { data: T }) : null;
    } catch {
      return null;
    }
  }

  private async writeCache<T>(cacheKey: string, data: T): Promise<void> {
    try {
      await this.db.run('tmdbCache', 'readwrite', (tx) =>
        this.db.put(tx, 'tmdbCache', { cacheKey, savedAt: Date.now(), data } satisfies CachedApiResponse),
      );
    } catch {
      // Переполнение кэша не должно ломать основной поток.
    }
  }

  async clearCache(): Promise<number> {
    return this.db.run('tmdbCache', 'readwrite', async (tx) => {
      const all = await this.db.all<CachedApiResponse>(tx, 'tmdbCache');
      await this.db.clear(tx, 'tmdbCache');
      return all.length;
    });
  }

  /** Для фоновой дозагрузки: устарел ли запись. */
  isStale(savedAt: number, now = Date.now()): boolean {
    return now - savedAt > FRESH_MS;
  }
}

function buildCacheKey(path: string, params: Record<string, string>): string {
  const q = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');
  return q ? `${path}?${q}` : path;
}
