import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * Сеть. Заменила Capacitor-модуль @capacitor/network.
 *
 * `navigator.onLine` в браузерах означает «есть ли маршрут», а не «сервер
 * отвечает», поэтому по нему мы только показываем баннер, но никогда не
 * считаем его признаком недоступности API — это делает fetch с таймаутом.
 */
@Injectable({ providedIn: 'root' })
export class NetworkService implements OnDestroy {
  private readonly subject = new BehaviorSubject<boolean>(readState());
  readonly online$: Observable<boolean> = this.subject.asObservable();

  private readonly onOnline = () => this.subject.next(true);
  private readonly onOffline = () => this.subject.next(false);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
  }

  get online(): boolean {
    return this.subject.value;
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }
}

function readState(): boolean {
  if (typeof navigator === 'undefined') {
    return true;
  }
  return navigator.onLine !== false;
}
