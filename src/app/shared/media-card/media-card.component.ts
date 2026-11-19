import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';
import { MediaSnapshot } from '../../models/storage.models';
import { PosterService } from '../../services/poster.service';
import { TitleDisplayService } from '../../services/title-display.service';

/**
 * Карточка постера. Единая для лент, подборок и поиска — как один
 * <app-list-card> в доноре: иначе размеры расходятся от экрана к экрану.
 */
@Component({
  selector: 'kd-media-card',
  template: `
    <a class="kd-media-card" [href]="link" (click)="open($event)">
      <div class="kd-media-card-image kd-poster-interactive">
        <img
          *ngIf="snapshot.poster; else fallback"
          [src]="poster.url(snapshot.poster, 'poster')"
          [alt]="title.primary"
          loading="lazy"
          decoding="async"
        />
        <ng-template #fallback>
          <div class="kd-poster-fallback" aria-hidden="true">{{ poster.initial(title.primary) }}</div>
        </ng-template>

        <span class="kd-media-card-kind">{{ kindLabel }}</span>

        <span class="kd-media-card-rating" *ngIf="snapshot.tmdbVoteAverage"
          >{{ rating }}<ion-icon name="star" aria-hidden="true"></ion-icon
        ></span>
      </div>

      <div class="kd-media-card-title">{{ title.primary }}</div>
      <div class="kd-media-card-original" *ngIf="title.secondary">{{ title.secondary }}</div>
    </a>
  `,
  styleUrls: ['./media-card.component.scss'],
  standalone: false,
})
export class MediaCardComponent {
  @Input({ required: true }) snapshot!: MediaSnapshot;

  constructor(
    public readonly poster: PosterService,
    public readonly titles: TitleDisplayService,
    private readonly router: Router,
  ) {}

  get title() {
    return this.titles.resolve({
      kind: this.snapshot.media_type,
      id: this.snapshot.id,
      titleRu: this.snapshot.titleRu,
      titleOriginal: this.snapshot.titleOriginal,
      titleLocalized: this.snapshot.title,
    });
  }

  get rating(): string {
    return (this.snapshot.tmdbVoteAverage ?? 0).toFixed(1).replace('.', ',');
  }

  get kindLabel(): string {
    const genres = this.snapshot.genreIds ?? [];
    const lang = (this.snapshot.original_language ?? '').toLowerCase();
    if (this.snapshot.media_type === 'tv' && lang === 'ja' && genres.includes(16)) {
      return 'Аниме';
    }
    if (this.snapshot.media_type === 'tv' && (lang === 'ko' || lang === 'zh' || lang === 'th')) {
      return 'Дорама';
    }
    if (genres.includes(16)) {
      return this.snapshot.media_type === 'tv' ? 'Мультсериал' : 'Мультфильм';
    }
    return this.snapshot.media_type === 'tv' ? 'Сериал' : 'Фильм';
  }

  get link(): string {
    return `/${this.snapshot.media_type}/${this.snapshot.id}`;
  }

  /**
   * href остаётся в разметке намеренно: он даёт «открыть в новой вкладке» и
   * среднюю кнопку мыши на десктопе. Обычный клик перехватываем на роутер,
   * чтобы не терять SPA-навигацию и анимацию Ionic.
   */
  open(event: MouseEvent): void {
    if (event.metaKey || event.ctrlKey || event.button === 1) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.router.navigate([this.link]);
  }
}
