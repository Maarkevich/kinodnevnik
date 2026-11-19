import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { WatchedEntry } from '../../models/storage.models';
import { AnalyticsService, MIN_SAMPLE } from '../../services/analytics.service';
import { DiaryService } from '../../services/diary.service';
import { RuLocaleService } from '../../services/ru-locale.service';
import { SettingsService } from '../../services/settings.service';

type Tab = 'overview' | 'ratings' | 'activity' | 'people' | 'places';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class ProfilePage implements OnInit {
  tab: Tab = 'overview';
  year: number | 'all' = 'all';
  loading = true;

  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Обзор' },
    { id: 'ratings', label: 'Оценки' },
    { id: 'activity', label: 'Активность' },
    { id: 'people', label: 'Люди' },
    { id: 'places', label: 'Жанры и страны' },
  ];

  constructor(
    private readonly diary: DiaryService,
    private readonly analytics: AnalyticsService,
    private readonly settingsService: SettingsService,
    public readonly locale: RuLocaleService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.diary.load();
    this.loading = false;
  }

  get name(): string {
    return this.settings.displayName || 'Зритель';
  }

  /** Наружу — только текущие настройки, сам сервис компоненту не нужен. */
  get settings() {
    return this.settingsService.value;
  }

  get summary() {
    return this.analytics.summarize(this.diary.snapshot, this.year);
  }

  get years(): number[] {
    return this.analytics.years(this.diary.snapshot);
  }

  get maxHistogram(): number {
    return Math.max(1, ...this.summary.histogram.map((b) => b.count));
  }

  get maxPace(): number {
    return Math.max(1, ...this.summary.pace.map((p) => p.count));
  }

  get recent(): WatchedEntry[] {
    return this.diary.snapshot.slice(0, 8);
  }

  /** Пороги выборки наружу — UI обязан показать «нет данных», а не цифру. */
  get limits(): typeof MIN_SAMPLE {
    return MIN_SAMPLE;
  }

  setTab(t: Tab): void {
    this.tab = t;
  }

  setYear(event: Event): void {
    const v = (event.target as HTMLSelectElement).value;
    this.year = v === 'all' ? 'all' : Number(v);
  }

  go(route: string): void {
    void this.router.navigate([route]);
  }

  /**
   * Тепловая карта 365 дней. Неделя начинается с понедельника — русская
   * конвенция, в доноре она уже соблюдалась.
   */
  get heatmap(): { level: number; label: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const e of this.diary.snapshot) {
      if (e.watchedAt && !e.dateUnknown) {
        counts.set(e.watchedAt.slice(0, 10), (counts.get(e.watchedAt.slice(0, 10)) ?? 0) + 1);
      }
    }

    const cells: { level: number; label: string; count: number }[] = [];
    const today = new Date();
    for (let i = 364; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const count = counts.get(key) ?? 0;
      cells.push({ count, level: count === 0 ? 0 : count >= 4 ? 4 : count >= 3 ? 3 : count >= 2 ? 2 : 1, label: key });
    }
    return cells;
  }
}
