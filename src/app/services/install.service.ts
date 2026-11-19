import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type Platform = 'ios' | 'android' | 'desktop' | 'unknown';

export interface InstallState {
  platform: Platform;
  /** Уже запущено как установленное приложение. */
  standalone: boolean;
  /** Chrome/Edge: можно предложить установку штатным промптом. */
  promptable: boolean;
  /** iOS: промпта нет, показываем инструкцию. */
  needsManualHint: boolean;
  /** Не устанавливать PWA = данные живут в обычном вкладочном хранилище iOS,
   *  которое чистится через 7 дней (спецификация, 12.1). */
  atRisk: boolean;
}

const DISMISS_KEY = 'kd_install_dismissed_at';
const DISMISS_DAYS = 14;

/**
 * Установка на устройство.
 *
 * На iOS это не косметика: непроинсталлированное веб-приложение теряет
 * хранилище быстрее, а `navigator.storage.persist()` там не реализован.
 * Поэтому для iOS отдельная инструкция, а не попытка «вызвать промпт».
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private deferred: BeforeInstallPromptEvent | null = null;

  private readonly subject = new BehaviorSubject<InstallState>(this.detect());
  readonly state$: Observable<InstallState> = this.subject.asObservable();

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.subject.next(this.detect());
    });

    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.subject.next(this.detect());
    });

    // Смена режима standalone происходит только с перезапуском, но пересчитаем
    // хотя бы при возврате на вкладку.
    document.addEventListener('visibilitychange', () => this.subject.next(this.detect()));
  }

  get state(): InstallState {
    return this.subject.value;
  }

  /** Пользователь уже отказался недавно — не напоминать. */
  get dismissed(): boolean {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    const raw = Number(localStorage.getItem(DISMISS_KEY) ?? '0');
    if (!Number.isFinite(raw) || raw <= 0) {
      return false;
    }
    return Date.now() - raw < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  }

  dismiss(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      } catch {
        /* noop */
      }
    }
    this.subject.next(this.detect());
  }

  /**
   * Штатная установка. Возвращает false, когда промпта нет (iOS, Firefox,
   * уже установлено) — вызывающий обязан показать ручную инструкцию.
   */
  async prompt(): Promise<boolean> {
    if (!this.deferred) {
      return false;
    }
    this.deferred.prompt();
    try {
      const outcome = await this.deferred.userChoice;
      this.deferred = null;
      this.subject.next(this.detect());
      return outcome.outcome === 'accepted';
    } catch {
      this.deferred = null;
      return false;
    }
  }

  /** Текст инструкции под платформу. */
  instructions(platform: Platform): string[] {
    switch (platform) {
      case 'ios':
        return [
          'Нажмите «Поделиться» в Safari',
          'Выберите «На экран «Домой»»',
          'Так данные останутся на устройстве',
        ];
      case 'android':
        return ['Меню браузера (⋮)', '«Добавить на главный экран»'];
      default:
        return ['Иконка установки в адресной строке браузера'];
    }
  }

  private detect(): InstallState {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const platform: Platform = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)
      ? 'ios'
      : /Android/.test(ua)
        ? 'android'
        : ua
          ? 'desktop'
          : 'unknown';

    const standalone =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches === true ||
        // iOS до 15.4 matchMedia не отдаёт standalone
        (navigator as unknown as { standalone?: boolean }).standalone === true);

    return {
      platform,
      standalone,
      promptable: this.deferred !== null,
      needsManualHint: !standalone && (platform === 'ios' || this.deferred === null),
      atRisk: !standalone,
    };
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
