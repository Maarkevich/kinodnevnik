import { Component, Input } from '@angular/core';
import { Coverage } from '../../services/analytics.service';
import { RuLocaleService } from '../../services/ru-locale.service';

/**
 * Плитка метрики с обязательным раскрытием выборки (спецификация, 13.3).
 *
 * Правило: цифра либо точная, либо с «~» и чипом покрытия; если данных
 * меньше порога — «нет данных», а не среднее по умолчанию. Именно это
 * отличает честную аналитику от донорской, где 108 минут на фильм
 * подставлялись молча.
 */
@Component({
  selector: 'kd-metric-card',
  template: `
    <div class="kd-metric">
      <div class="kd-metric-label">{{ label }}</div>

      <div class="kd-metric-value" [class.is-approx]="approximate" [class.is-empty]="!hasValue">
        <span *ngIf="approximate && hasValue" class="kd-metric-tilde">~</span>{{ display }}
      </div>

      <div class="kd-metric-coverage" *ngIf="coverage && hasValue">
        по {{ locale.integer(coverage.sample) }} из {{ locale.integer(coverage.total) }}
      </div>

      <div class="kd-metric-note" *ngIf="!hasValue && note">{{ note }}</div>
    </div>
  `,
  standalone: false,
})
export class MetricCardComponent {
  @Input({ required: true }) label!: string;
  /** null => показываем «нет данных». */
  @Input() value: string | number | null | undefined = null;
  @Input() coverage: Coverage | null = null;
  @Input() approximate = false;
  @Input() note = '';

  constructor(public readonly locale: RuLocaleService) {}

  get hasValue(): boolean {
    return this.value !== null && this.value !== undefined && this.value !== '';
  }

  get display(): string {
    if (!this.hasValue) {
      return 'нет данных';
    }
    return typeof this.value === 'number' ? this.locale.decimal(this.value) : String(this.value);
  }
}
