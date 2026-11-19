import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { APP_VERSION } from '../../environments/version';

const PENDING_ROUTE = 'kd_pending_route';

/**
 * Обновления PWA (спецификация, 11.5.3).
 *
 * GitHub Pages отдаёт всё с `cache-control: max-age=600` и переопределить
 * это нельзя, поэтому свежесть обеспечивает service worker: он сам проверяет
 * новую версию при старте, при возврате в приложение и каждые 30 минут.
 *
 * Две ловушки, закрытые здесь:
 *
 * 1. Регистрировать `./sw.js` нельзя — относительный путь разрешается от
 *    URL страницы, а не от <base>. На deep-ссылке /kinodnevnik/movie/603
 *    браузер ищет /kinodnevnik/movie/sw.js, получает 404, и SW не
 *    регистрируется никогда. Берём путь из <base href>.
 *
 * 2. Молча перезагружать приложение нельзя: если пользователь посреди ввода
 *    записи, SKIP_WAITING + reload выбросит незаполненную форму.
 */
@Injectable({ providedIn: 'root' })
export class SwUpdateService implements OnDestroy {
  private readonly available = new BehaviorSubject<boolean>(false);
  readonly updateAvailable$: Observable<boolean> = this.available.asObservable();

  private registration: ServiceWorkerRegistration | null = null;
  private waiting: ServiceWorker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') {
      void this.check();
    }
  };

  private readonly onFocus = () => void this.check();

  private readonly onControllerChange = () => {
    // Перехват контроллера означает, что новая версия уже активна.
    this.restoreRoute();
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  constructor(
    private readonly zone: NgZone,
  ) {}

  get version(): typeof APP_VERSION {
    return APP_VERSION;
  }

  async init(): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    // Вне HTTPS SW не работает; на локальном http это не ошибка, а режим.
    if (!window.isSecureContext) {
      return;
    }

    // Зоны тут быть не должно: интервал и слушатели не должны вызывать CD.
    this.zone.runOutsideAngular(async () => {
      try {
        const url = new URL('sw.js', document.baseURI).href;
        const scope = new URL('./', document.baseURI).pathname;

        this.registration = await navigator.serviceWorker.register(url, { scope });

        navigator.serviceWorker.addEventListener('controllerchange', this.onControllerChange);
        document.addEventListener('visibilitychange', this.onVisible);
        window.addEventListener('focus', this.onFocus);

        if (this.registration.waiting && navigator.serviceWorker.controller) {
          this.waiting = this.registration.waiting;
          this.available.next(true);
        }

        this.registration.addEventListener('updatefound', () => {
          const installing = this.registration?.installing;
          if (!installing) {
            return;
          }
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              this.waiting = installing;
              this.zone.run(() => this.available.next(true));
            }
          });
        });

        await this.check();

        this.timer = setInterval(() => void this.check(), environment.updateCheckIntervalMs);
      } catch {
        // SW не зарегистрировался — приложение всё равно полностью работает.
      }
    });
  }

  async check(): Promise<void> {
    try {
      await this.registration?.update();
    } catch {
      /* офлайн: следующая проверка всё равно случится */
    }
  }

  /**
   * Применить обновление. Путь и несохранённый ввод сохраняем, чтобы
   * перезагрузка не вернула пользователя в начало.
   */
  apply(currentRoute?: string): void {
    if (currentRoute && typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(PENDING_ROUTE, currentRoute);
      } catch {
        /* sessionStorage может быть закрыт в приватном режиме */
      }
    }

    const worker = this.waiting ?? this.registration?.waiting;
    if (worker) {
      worker.postMessage({ type: 'SKIP_WAITING' });
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  dismiss(): void {
    this.available.next(false);
  }

  ngOnDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisible);
      window.removeEventListener('focus', this.onFocus);
      navigator?.serviceWorker?.removeEventListener?.('controllerchange', this.onControllerChange);
    }
  }

  private restoreRoute(): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }
    try {
      const saved = sessionStorage.getItem(PENDING_ROUTE);
      if (!saved) {
        return;
      }
      sessionStorage.removeItem(PENDING_ROUTE);
      const here = window.location.pathname + window.location.search;
      if (saved !== here && saved.startsWith('/')) {
        window.history.replaceState(null, '', saved);
      }
    } catch {
      /* noop */
    }
  }
}
