import { Injectable } from '@angular/core';
import { DbService } from './db.service';

export interface StorageInfo {
  usage: number | null;
  quota: number | null;
  ratio: number | null;
  /** null — движок не поддерживает запрос закреплённого хранилища. */
  persisted: boolean | null;
  supported: boolean;
}

/**
 * Квота и закрепление хранилища (спецификация, 12.1, 11.5).
 *
 * В доноре квота localStorage считалась как 10 МБ на глаз (строка 2108).
 * Здесь берём реальные цифры у движка. На iOS `navigator.storage.persist()`
 * не реализован — это не ошибка кода, а ограничение WebKit, поэтому статус
 * показывается как «неизвестно», а не как «не закреплено».
 */
@Injectable({ providedIn: 'root' })
export class StorageQuotaService {
  /** Вытеснять картинки начинаем при этом заполнении. */
  static readonly EVICT_RATIO = 0.6;

  constructor(private readonly db: DbService) {}

  get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.storage;
  }

  async info(): Promise<StorageInfo> {
    if (!this.supported) {
      return { usage: null, quota: null, ratio: null, persisted: null, supported: false };
    }

    let usage: number | null = null;
    let quota: number | null = null;
    let persisted: boolean | null = null;

    try {
      const est = await navigator.storage.estimate();
      usage = typeof est.usage === 'number' ? est.usage : null;
      quota = typeof est.quota === 'number' ? est.quota : null;
    } catch {
      /* estimate может быть недоступен */
    }

    try {
      persisted = typeof navigator.storage.persisted === 'function' ? await navigator.storage.persisted() : null;
    } catch {
      persisted = null;
    }

    return {
      usage,
      quota,
      ratio: usage !== null && quota && quota > 0 ? usage / quota : null,
      persisted,
      supported: true,
    };
  }

  /**
   * Запрос закрепления. Возвращает итоговое состояние, а не «удалось ли
   * вызвать метод» — на iOS вызов просто не поддержан.
   */
  async requestPersist(): Promise<boolean | null> {
    if (!this.supported || typeof navigator.storage.persist !== 'function') {
      return null;
    }
    try {
      await navigator.storage.persist();
      return await this.info().then((i) => i.persisted);
    } catch {
      return null;
    }
  }

  async isRoomy(): Promise<boolean> {
    const i = await this.info();
    return i.ratio === null ? true : i.ratio < StorageQuotaService.EVICT_RATIO;
  }

  /** Очистка кэша ответов TMDb. Данные пользователя не трогаются. */
  async clearApiCache(): Promise<number> {
    return this.db.run('tmdbCache', 'readwrite', async (tx) => {
      const n = (await this.db.all(tx, 'tmdbCache')).length;
      await this.db.clear(tx, 'tmdbCache');
      return n;
    });
  }

  /** Очередь докачки картинок. */
  async clearImageQueue(): Promise<number> {
    return this.db.run('imageQueue', 'readwrite', async (tx) => {
      const n = (await this.db.all(tx, 'imageQueue')).length;
      await this.db.clear(tx, 'imageQueue');
      return n;
    });
  }

  /**
   * Аварийное освобождение места: сначала volatile-кэш, как в доноре, но
   * в IndexedDB и без потери дневника.
   */
  async freeSpace(): Promise<{ apiCache: number; images: number }> {
    const apiCache = await this.clearApiCache();
    const images = await this.clearImageQueue();
    return { apiCache, images };
  }

  bytes(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return 'нет данных';
    }
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    let n = value;
    let u = 0;
    while (n >= 1024 && u < units.length - 1) {
      n /= 1024;
      u++;
    }
    return `${n.toFixed(n < 10 && u > 0 ? 1 : 0).replace('.', ',')} ${units[u]}`;
  }
}
