import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalController, ToastController } from '@ionic/angular';
import { MediaKind, WatchedEntry } from '../../models/storage.models';
import { DiaryService, todayIso } from '../../services/diary.service';
import { HapticService } from '../../services/haptic.service';
import { PosterService } from '../../services/poster.service';
import { SettingsService } from '../../services/settings.service';
import { TitleDisplayService } from '../../services/title-display.service';

export interface QuickLogDraft {
  id: number;
  kind: MediaKind;
  title: string;
  titleOriginal?: string;
  titleRu?: string | null;
  poster?: string | null;
  snapshot?: WatchedEntry['snapshot'];
}

/**
 * Лист быстрой записи (спецификация, 1.2 П5 и 10.1).
 * Оценка, дата, статус, «понравилось», метки, текст — всё в одном месте,
 * большим пальцем снизу.
 */
@Component({
  selector: 'kd-quick-log',
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Запись просмотра</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()" aria-label="Закрыть">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="kd-ql-body">
        <div class="kd-ql-head">
          <div class="kd-ql-poster kd-poster-interactive">
            <img *ngIf="data.poster" [src]="poster.url(data.poster, 'poster')" [alt]="title.primary" />
            <div *ngIf="!data.poster" class="kd-poster-fallback">{{ poster.initial(title.primary) }}</div>
          </div>
          <div class="kd-ql-names">
            <div class="kd-ql-title">{{ title.primary }}</div>
            <div class="kd-ql-original" *ngIf="title.secondary">{{ title.secondary }}</div>
            <div class="kd-ql-year" *ngIf="year">{{ year }}</div>
          </div>
        </div>

        <div class="kd-ql-block">
          <div class="kd-eyebrow">Оценка</div>
          <kd-star-rating [value]="rating" (valueChange)="rating = $event"></kd-star-rating>
        </div>

        <div class="kd-ql-block">
          <div class="kd-eyebrow">Когда</div>
          <div class="kd-ql-dates">
            <ion-datetime
              presentation="date"
                      [value]="watchedAt"
              (ionChange)="onDate($event)"
              locale="ru-RU"
              aria-label="Дата просмотра"
            ></ion-datetime>
            <ion-checkbox labelPlacement="end" [checked]="dateUnknown" (ionChange)="dateUnknown = !dateUnknown">
              Точную дату не помню
            </ion-checkbox>
          </div>
        </div>

        <div class="kd-ql-block">
          <div class="kd-eyebrow">Статус</div>
          <ion-radio-group [value]="status" (ionChange)="onStatus($event)">
            <div class="kd-ql-radios">
              <ion-radio value="" aria-label="Просмотрено">Просмотрено</ion-radio>
              <ion-radio value="watching">Смотрю</ion-radio>
              <ion-radio value="rewatching">Пересматриваю</ion-radio>
              <ion-radio value="dropped">Брошено</ion-radio>
            </div>
          </ion-radio-group>

          <div class="kd-ql-rewatch" *ngIf="status === ''">
            <ion-checkbox labelPlacement="end" [checked]="rewatch" (ionChange)="rewatch = !rewatch">
              Это пересмотр
            </ion-checkbox>
          </div>
        </div>

        <div class="kd-ql-block">
          <div class="kd-eyebrow">Метки</div>
          <input
            class="kd-input"
            [(ngModel)]="tagsRaw"
            placeholder="через запятую"
            aria-label="Метки через запятую"
          />
        </div>

        <div class="kd-ql-block">
          <div class="kd-eyebrow">Мысли</div>
          <textarea
            class="kd-input kd-ql-textarea"
            rows="4"
            maxlength="1000"
            [(ngModel)]="review"
            placeholder="Что запомнилось?"
            aria-label="Текст рецензии"
          ></textarea>
          <div class="kd-ql-counter">{{ review.length }} / 1000</div>
        </div>

        <div class="kd-ql-block">
          <ion-checkbox labelPlacement="end" [checked]="liked" (ionChange)="liked = !liked">
            Понравилось
          </ion-checkbox>
        </div>
      </div>
    </ion-content>

    <ion-footer class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="end">
          <ion-button fill="clear" (click)="close()">Отмена</ion-button>
          <ion-button (click)="save()">Сохранить</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-footer>
  `,
  styleUrls: ['./quick-log.component.scss'],
  standalone: false,
})
export class QuickLogComponent implements OnInit, OnDestroy {
  rating: number | null = null;
  watchedAt = todayIso();
  dateUnknown = false;
  rewatch = false;
  liked = false;
  status: '' | 'watching' | 'rewatching' | 'dropped' = '';
  review = '';
  tagsRaw = '';

  existing: WatchedEntry | null = null;

  private readonly keydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      void this.modal.dismiss();
    }
  };

  /**
   * Заполняется Ionic: `componentProps` присваиваются прямо на экземпляр
   * компонента (см. angular-delegate.mjs: Object.assign(instance, params)).
   * Инжектировать их нельзя — интерфейс не является DI-токеном (NG2003),
   * а у ModalController нет getData().
   */
  data!: QuickLogDraft;

  constructor(
    private readonly modal: ModalController,
    private readonly toast: ToastController,
    private readonly diary: DiaryService,
    private readonly settings: SettingsService,
    private readonly haptic: HapticService,
    public readonly poster: PosterService,
    private readonly titles: TitleDisplayService,
  ) {}

  get title() {
    // Геттер читается из шаблона; до ngOnInit данных ещё нет.
    if (!this.data) {
      return { primary: '', secondary: null, overridden: false };
    }
    return this.titles.resolve({
      kind: this.data.kind,
      id: this.data.id,
      titleRu: this.data.titleRu,
      titleOriginal: this.data.titleOriginal,
      titleLocalized: this.data.title,
    });
  }

  get year(): string {
    return this.data?.snapshot?.release_date?.slice(0, 4) ?? '';
  }

  async ngOnInit(): Promise<void> {
    await this.titles.load();
    // Правка существующей записи: подтягиваем то, что уже сохранено.
    const found = this.diary.snapshot.find(
      (e) => e.id === this.data.id && e.media_type === this.data.kind && !e.dateUnknown,
    );
    if (found) {
      this.existing = found;
      this.rating = found.rating ?? null;
      this.watchedAt = found.watchedAt ?? todayIso();
      this.dateUnknown = found.dateUnknown === true;
      this.rewatch = found.rewatch === true;
      this.liked = found.liked === true;
      this.review = found.review ?? '';
      this.tagsRaw = (found.tags ?? []).join(', ');
      this.status = (found.status ?? '') as typeof this.status;
    }
    window.addEventListener('keydown', this.keydown);
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.keydown);
  }

  onDate(event: CustomEvent): void {
    const v = String(event.detail?.value ?? '');
    if (v) {
      this.watchedAt = v.slice(0, 10);
      this.dateUnknown = false;
    }
  }

  onStatus(event: CustomEvent): void {
    this.status = (String(event.detail?.value ?? '') as typeof this.status) || '';
  }

  async save(): Promise<void> {
    const tags = this.tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);

    await this.diary.save({
      entryId: this.existing?.entryId,
      id: this.data.id,
      media_type: this.data.kind,
      title: this.data.title,
      titleOriginal: this.data.titleOriginal ?? this.data.title,
      titleRu: this.data.titleRu ?? null,
      poster_path: this.data.poster ?? null,
      // «Смотрю» без даты — не просмотр; дату всё равно фиксируем, иначе
      // запись выпадет из ленты и из статистики.
      watchedAt: this.dateUnknown ? null : this.watchedAt,
      dateUnknown: this.dateUnknown,
      rewatch: this.rewatch,
      rating: this.rating ?? null,
      review: this.review,
      tags,
      liked: this.liked,
      status: this.status || null,
      snapshot: this.data.snapshot,
      userEdited: true,
    });

    this.haptic.success(this.settings.value.hapticsEnabled !== false);
    await this.toastPresent(this.status ? 'Отмечено как «' + this.statusLabel() + '»' : 'Записано');
    await this.modal.dismiss({ saved: true });
  }

  close(): void {
    void this.modal.dismiss();
  }

  private statusLabel(): string {
    return this.status === 'watching'
      ? 'Смотрю'
      : this.status === 'rewatching'
        ? 'Пересматриваю'
        : this.status === 'dropped'
          ? 'Брошено'
          : '';
  }

  private async toastPresent(message: string): Promise<void> {
    const t = await this.toast.create({
      message,
      duration: 2200,
      position: 'bottom',
      cssClass: 'kd-toast-glass',
    });
    await t.present();
  }
}
