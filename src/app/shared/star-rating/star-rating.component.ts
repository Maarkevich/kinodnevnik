import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Звёздный рейтинг 0,5–5,0 шагом 0,5 (спецификация, 10.1).
 *
 * Поведение перенесено из донора: тап по левой половине звезды даёт .5,
 * повторный тап по текущему значению сбрасывает оценку. Зона касания —
 * вся высота звезды, минимум 44px: в доноре было 28px, что не проходило
 * WCAG 2.5.5, и они это исправили — откатывать нельзя.
 */
@Component({
  selector: 'kd-star-rating',
  template: `
    <div class="kd-stars" role="group" [attr.aria-label]="ariaLabel">
      <button
        *ngFor="let star of stars; trackBy: trackByStar"
        type="button"
        class="kd-star"
        [class.is-filled]="star <= filled"
        [attr.aria-label]="star + ' из 5'"
        [attr.aria-pressed]="star === value"
        [disabled]="readonly"
        (click)="pick(star, $event)"
      >
        <ion-icon [name]="star <= filled ? 'star' : 'star-outline'" aria-hidden="true"></ion-icon>
      </button>
      <span class="kd-star-value" *ngIf="filled > 0">{{ valueLabel }}</span>
    </div>
  `,
  styleUrls: ['./star-rating.component.scss'],
  standalone: false,
})
export class StarRatingComponent {
  @Input() value: number | null = null;
  @Input() readonly = false;
  @Output() readonly valueChange = new EventEmitter<number | null>();

  readonly stars = [1, 2, 3, 4, 5];

  /** Шаблон не должен думать о null: один геттер, одна проверка. */
  get filled(): number {
    return this.value ?? 0;
  }

  get valueLabel(): string {
    return (this.value ?? 0).toFixed(1).replace('.', ',');
  }

  get ariaLabel(): string {
    return this.value ? `Оценка ${this.valueLabel} из 5` : 'Поставить оценку';
  }

  pick(star: number, event: MouseEvent): void {
    if (this.readonly) {
      return;
    }
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const leftHalf = rect.width > 0 && event.clientX - rect.left < rect.width / 2;
    const next = leftHalf ? star - 0.5 : star;

    // Повторный тап по текущему значению снимает оценку.
    this.valueChange.emit(this.value === next ? null : next);
  }

  trackByStar(_i: number, s: number): number {
    return s;
  }
}
