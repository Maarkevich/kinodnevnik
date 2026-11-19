import { Injectable } from '@angular/core';

/**
 * Виброотклик через navigator.vibrate.
 *
 * В iOS Safari API отсутствует, а в Chrome требует secure context. Сервис
 * обязан становиться no-op, а не бросать: настройка «Виброотклик» показывается
 * только когда метод реально есть.
 */
@Injectable({ providedIn: 'root' })
export class HapticService {
  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  tap(enabled: boolean): void {
    if (!enabled || !this.supported) {
      return;
    }
    try {
      navigator.vibrate(10);
    } catch {
      /* без отказа — это косметика */
    }
  }

  success(enabled: boolean): void {
    if (!enabled || !this.supported) {
      return;
    }
    try {
      navigator.vibrate([8, 30, 12]);
    } catch {
      /* noop */
    }
  }
}
