import { Injectable, OnDestroy } from '@angular/core';
import { environment } from '../../environments/environment';
import { QueuedImage } from '../models/storage.models';
import { DbService } from './db.service';

export type ImageKind = 'poster' | 'backdrop' | 'logo' | 'profile';

const BATCH = 20;

/**
 * Единая точка по картинкам TMDb (спецификация, 11.3).
 *
 * Контент из image.tmdb.org в офлайне недоступен, а дневник без постеров
 * выглядит сломанным. Реальное кэширование делает service worker
 * (stale-while-revalidate); эта служба лишь добавляет картинки в очередь
 * фоновой прогрева, чтобы они попали в кэш ДО того, как пользователю
 * понадобится офлайн.
 *
 * Прогрев идёт пачками по 20 в idle и НИКОГДА во время активного скролла:
 * 18 одновременных fetch картинок на среднем Android — это подвисание ленты.
 */
@Injectable({ providedIn: 'root' })
export class PosterService implements OnDestroy {
  private queue: QueuedImage[] = [];
  private seen = new Set<string>();
  private idleHandle: number | null = null;
  private flushing = false;
  private scrollMark = 0;

  constructor(private readonly db: DbService) {
    if (typeof window !== 'undefined') {
      // Прогрев откладывается, пока пользователь крутит ленту.
      window.addEventListener('scroll', () => (this.scrollMark = Date.now()), { passive: true, capture: true });
    }
  }

  url(path: string | null | undefined, kind: ImageKind = 'poster'): string {
    if (!path) {
      return '';
    }
    if (/^https?:\/\//.test(path)) {
      return path;
    }
    const clean = path.startsWith('/') ? path : `/${path}`;
    return `${environment.tmdbImageBaseUrl}/${size(kind, this.isWide())}${clean}`;
  }

  /** Подогрев кэша для набора путей. Вызывается из лент, а не из шаблона. */
  warm(items: { path: string | null | undefined; kind?: ImageKind }[]): void {
    for (const item of items) {
      const url = this.url(item.path, item.kind ?? 'poster');
      if (!url || this.seen.has(url)) {
        continue;
      }
      this.seen.add(url);
      this.queue.push({ url, kind: item.kind ?? 'poster', queuedAt: new Date().toISOString(), attempts: 0 });
    }
    this.schedule();
  }

  /** Буква для градиентной заглушки, когда постера нет. */
  initial(title: string | null | undefined): string {
    const t = (title ?? '').trim();
    return t ? t.charAt(0).toUpperCase() : '?';
  }

  get pending(): number {
    return this.queue.length;
  }

  async flush(): Promise<number> {
    if (this.flushing || this.queue.length === 0) {
      return 0;
    }
    // Не начинаем, пока пользователь скроллит.
    if (Date.now() - this.scrollMark < 400) {
      this.schedule(600);
      return 0;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 0;
    }

    this.flushing = true;
    const batch = this.queue.splice(0, BATCH);

    try {
      await this.db.run('imageQueue', 'readwrite', async (tx) => {
        for (const item of batch) {
          await this.db.put(tx, 'imageQueue', item);
        }
      });

      await Promise.all(
        batch.map(async (item) => {
          try {
            // no-cors: нам не нужно читать ответ, достаточно, чтобы SW положил
            // его в кэш. Оpaque-ответы кэшируются.
            await fetch(item.url, { mode: 'no-cors' });
            await this.db.run('imageQueue', 'readwrite', (tx) => this.db.del(tx, 'imageQueue', item.url));
          } catch {
            item.attempts++;
            // После трёх попыток перестаём тянуть — сеть может быть реально нет.
            if (item.attempts < 3) {
              this.queue.push(item);
            } else {
              await this.db.run('imageQueue', 'readwrite', (tx) => this.db.del(tx, 'imageQueue', item.url));
            }
          }
        }),
      );
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) {
        this.schedule();
      }
    }

    return batch.length;
  }

  ngOnDestroy(): void {
    if (this.idleHandle !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
      (window as unknown as { cancelIdleCallback: (h: number) => void }).cancelIdleCallback(this.idleHandle);
    }
  }

  private isWide(): boolean {
    return typeof window !== 'undefined' && window.innerWidth >= 768;
  }

  private schedule(delayMs?: number): void {
    if (this.idleHandle !== null || typeof window === 'undefined') {
      return;
    }
    if ('requestIdleCallback' in window && delayMs === undefined) {
      this.idleHandle = (
        window as unknown as { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => number }
      ).requestIdleCallback(
        () => {
          this.idleHandle = null;
          void this.flush();
        },
        { timeout: 3000 },
      );
      return;
    }
    this.idleHandle = window.setTimeout(() => {
      this.idleHandle = null;
      void this.flush();
    }, delayMs ?? 1200);
  }
}

/** w780 на телефоне и w1280 на планшете+ — конвенция донора, сохранена. */
function size(kind: ImageKind, wide: boolean): string {
  switch (kind) {
    case 'backdrop':
      return wide ? 'w1280' : 'w780';
    case 'logo':
      return wide ? 'w185' : 'w92';
    case 'profile':
      return wide ? 'w185' : 'w185';
    default:
      return wide ? 'w342' : 'w185';
  }
}
