import { Component, OnDestroy, OnInit } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Subject, takeUntil } from 'rxjs';
import { WatchedEntry } from '../../models/storage.models';
import { DiaryFilter, DiarySort, DiaryStats, DiaryService } from '../../services/diary.service';
import { PosterService } from '../../services/poster.service';
import { RuLocaleService } from '../../services/ru-locale.service';
import { SettingsService } from '../../services/settings.service';
import { QuickLogComponent, QuickLogDraft } from '../../shared/quick-log/quick-log.component';
import { normalizeDate } from '../../utils/keys';

interface DayGroup {
  key: string;
  label: string;
  items: WatchedEntry[];
}

interface MonthGroup {
  key: string;
  label: string;
  days: DayGroup[];
}

@Component({
  selector: 'app-diary',
  templateUrl: './diary.page.html',
  styleUrls: ['./diary.page.scss'],
  standalone: false,
})
export class DiaryPage implements OnInit, OnDestroy {
  loading = true;
  filter: DiaryFilter = 'all';
  sort: DiarySort = 'date_desc';

  stats: DiaryStats = { total: 0, today: 0, week: 0, streak: 0 };
  active: WatchedEntry[] = [];
  rows: WatchedEntry[] = [];
  groups: MonthGroup[] = [];

  /** Постер не загрузился (нет сети или картинку убрали) → показываем заглушку. */
  readonly broken: Record<string, boolean> = {};

  readonly filters: { id: DiaryFilter; label: string }[] = [
    { id: 'all', label: 'Все' },
    { id: 'movie', label: 'Фильмы' },
    { id: 'tv', label: 'Сериалы' },
    { id: 'animation', label: 'Мультфильмы' },
    { id: 'anime', label: 'Аниме' },
    { id: 'kdrama', label: 'Дорамы' },
  ];

  readonly sorts: { id: DiarySort; label: string }[] = [
    { id: 'date_desc', label: 'Сначала новые' },
    { id: 'date_asc', label: 'Сначала старые' },
    { id: 'rating_desc', label: 'По оценке' },
    { id: 'title_asc', label: 'По алфавиту' },
  ];

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly diary: DiaryService,
    private readonly settings: SettingsService,
    private readonly modal: ModalController,
    private readonly toast: ToastController,
    public readonly locale: RuLocaleService,
    public readonly poster: PosterService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.diary.entries$.pipe(takeUntil(this.destroy$)).subscribe((entries) => this.rebuild(entries));
    await this.diary.load();
    this.loading = false;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get fadeWatched(): boolean {
    return this.settings.value.fadeWatched;
  }

  get hasActivity(): boolean {
    return this.stats.today > 0 || this.stats.week > 0 || this.stats.streak > 0;
  }

  setFilter(f: DiaryFilter): void {
    this.filter = f;
    this.rebuild(this.diary.snapshot);
  }

  setSort(s: DiarySort): void {
    this.sort = s;
    this.rebuild(this.diary.snapshot);
  }

  /** Новая запись — лист открытый, без существующей. */
  async create(): Promise<void> {
    const m = await this.modal.create({
      component: QuickLogComponent,
      componentProps: { data: { id: 0, kind: 'movie', title: '' } satisfies QuickLogDraft },
      cssClass: 'kd-sheet-glass',
    });
    await m.present();
    await m.onWillDismiss();
  }

  async open(entry: WatchedEntry): Promise<void> {
    await this.edit(entry);
  }

  trackById(_i: number, e: WatchedEntry): string {
    return e.entryId;
  }

  trackByMonth(_i: number, g: MonthGroup): string {
    return g.key;
  }

  trackByDay(_i: number, d: DayGroup): string {
    return d.key;
  }

  async complete(entry: WatchedEntry, event: Event): Promise<void> {
    event.stopPropagation();
    await this.diary.complete(entry.entryId);
    await this.say('Просмотр завершён');
  }

  async remove(entry: WatchedEntry, event: Event): Promise<void> {
    event.stopPropagation();
    const removed = await this.diary.remove(entry.entryId);
    if (!removed) {
      return;
    }
    const t = await this.toast.create({
      message: `Удалено: ${removed.title}`,
      duration: 5000,
      position: 'bottom',
      cssClass: 'kd-toast-glass',
      buttons: [
        {
          text: 'Отменить',
          role: 'cancel',
          handler: () => void this.diary.restore(removed),
        },
      ],
    });
    await t.present();
  }

  title(entry: WatchedEntry) {
    return { primary: entry.title, secondary: this.showOriginal(entry) ? entry.titleOriginal : null };
  }

  dayLabel(entry: WatchedEntry): string {
    return entry.dateUnknown || !entry.watchedAt ? 'без даты' : this.locale.dayShort(this.dateOf(entry));
  }

  private showOriginal(entry: WatchedEntry): boolean {
    const mode = this.settings.value.originalTitleMode;
    if (mode === 'never') {
      return false;
    }
    return !!entry.titleOriginal && entry.titleOriginal.toLowerCase() !== entry.title.toLowerCase();
  }

  private async edit(entry: WatchedEntry): Promise<void> {
    const draft: QuickLogDraft = {
      id: entry.id,
      kind: entry.media_type,
      title: entry.title,
      titleOriginal: entry.titleOriginal,
      titleRu: entry.titleRu,
      poster: entry.poster_path,
      snapshot: entry.snapshot,
    };
    const m = await this.modal.create({
      component: QuickLogComponent,
      componentProps: { data: draft },
      cssClass: 'kd-sheet-glass',
    });
    await m.present();
    await m.onWillDismiss();
  }

  private rebuild(entries: WatchedEntry[]): void {
    this.stats = this.diary.stats(entries);
    this.active = this.diary.active(entries);
    const completed = this.diary.completed(entries);
    this.rows = this.diary.filterAndSort(completed, this.filter, this.sort);
    this.groups = this.group(this.rows);

    // Прогрев кэша постеров видимой ленты — до того, как пользователь
    // уйдёт в офлайн.
    this.poster.warm(this.rows.slice(0, 40).map((e) => ({ path: e.poster_path, kind: 'poster' as const })));
  }

  private group(rows: WatchedEntry[]): MonthGroup[] {
    const months = new Map<string, MonthGroup>();

    for (const e of rows) {
      const d = this.dateOf(e);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const month = months.get(mKey) ?? { key: mKey, label: this.locale.monthYear(d), days: [] };
      const dKey = e.dateUnknown ? `${mKey}-na` : normalizeDate(e.watchedAt) ?? mKey;
      const day = month.days.find((x) => x.key === dKey) ?? { key: dKey, label: this.dayLabel(e), items: [] };
      day.items.push(e);
      if (!month.days.includes(day)) {
        month.days.push(day);
      }
      months.set(mKey, month);
    }

    return [...months.values()];
  }

  private dateOf(entry: WatchedEntry): Date {
    const d = normalizeDate(entry.watchedAt) ?? normalizeDate(entry.createdAt);
    if (!d) {
      return new Date(entry.createdAt);
    }
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day);
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2000, position: 'bottom', cssClass: 'kd-toast-glass' });
    await t.present();
  }
}
