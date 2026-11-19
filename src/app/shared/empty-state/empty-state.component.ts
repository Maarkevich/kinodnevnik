import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Пустое и ошибочное состояние.
 *
 * Отдельный компонент нужен потому, что в доноре главная страница при 500
 * от TMDb рендерила пустой экран — дефект, который так и не закрыли.
 * Здесь «пусто», «не найдено по фильтру» и «не удалось загрузить» —
 * три разных текста с разными действиями.
 */
@Component({
  selector: 'kd-empty-state',
  template: `
    <div class="kd-empty" role="note">
      <div class="kd-empty-title">{{ title }}</div>
      <p class="kd-empty-text" *ngIf="text">{{ text }}</p>

      <div class="kd-empty-actions" *ngIf="actionLabel || retryLabel">
        <ion-button *ngIf="actionLabel" (click)="action.emit()">
          {{ actionLabel }}
        </ion-button>
        <ion-button *ngIf="retryLabel && tone === 'error'" fill="outline" (click)="retry.emit()">
          {{ retryLabel }}
        </ion-button>
      </div>

      <p class="kd-empty-hint" *ngIf="hint">{{ hint }}</p>
    </div>
  `,
  standalone: false,
})
export class EmptyStateComponent {
  @Input({ required: true }) title!: string;
  @Input() text = '';
  @Input() hint = '';
  @Input() actionLabel = '';
  @Input() retryLabel = '';
  /** 'empty' — данных ещё нет; 'error' — попытка не удалась. */
  @Input() tone: 'empty' | 'error' = 'empty';

  readonly action = new EventEmitter<void>();
  readonly retry = new EventEmitter<void>();
}
