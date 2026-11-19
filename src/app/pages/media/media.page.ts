import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ModalController, ToastController } from '@ionic/angular';
import { MediaKind } from '../../models/storage.models';
import { CatalogService, MediaDetails } from '../../services/catalog.service';
import { DiaryService } from '../../services/diary.service';
import { PosterService } from '../../services/poster.service';
import { RuLocaleService } from '../../services/ru-locale.service';
import { TitleDisplayService } from '../../services/title-display.service';
import { QuickLogComponent, QuickLogDraft } from '../../shared/quick-log/quick-log.component';

/**
 * Карточка тайтла.
 *
 * Ключевое отличие от донора (их дефект T-05): экран строится из локального
 * снимка и не бывает пустым, если тайтл уже есть в дневнике. Сеть лишь
 * дополняет то, что уже известно.
 */
@Component({
  selector: 'app-media',
  templateUrl: './media.page.html',
  styleUrls: ['./media.page.scss'],
  standalone: false,
})
export class MediaPage implements OnInit {
  kind: MediaKind = 'movie';
  id = 0;

  details: MediaDetails | null = null;
  /** true, когда показываем локальный снимок, а не ответ сети. */
  partial = false;
  loading = true;
  failed = false;
  noKey = false;

  logsForTitle = 0;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly catalog: CatalogService,
    private readonly diary: DiaryService,
    private readonly modal: ModalController,
    private readonly toast: ToastController,
    public readonly locale: RuLocaleService,
    public readonly poster: PosterService,
    public readonly titles: TitleDisplayService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.kind = this.route.snapshot.url.join('/') === 'tv' ? 'tv' : 'movie';
    this.id = Number(this.route.snapshot.paramMap.get('id') ?? 0);
    if (this.route.snapshot.routeConfig?.path?.startsWith('tv')) {
      this.kind = 'tv';
    }

    await this.titles.load();

    // 1. Локальный снимок — мгновенно, без сети.
    const cached = await this.catalog.cachedSnapshot(this.kind, this.id);
    if (cached) {
      this.details = {
        snapshot: cached,
        overview: '',
        runtimeMinutes: cached.runtime_minutes ?? null,
        seasons: null,
        directors: cached.directors ?? [],
        cast: [],
        where: null,
        ruTitleSource: 'none',
      };
      this.partial = true;
    }

    // 2. Свежие данные, если есть ключ и сеть.
    const fresh = await this.catalog.details(this.kind, this.id);
    if (fresh) {
      this.details = fresh;
      this.partial = false;
    } else if (!cached) {
      this.failed = true;
      this.noKey = !this.catalog.hasKey?.();
    }

    this.logsForTitle = this.diary.snapshot.filter((e) => e.id === this.id && e.media_type === this.kind).length;
    this.loading = false;

    if (this.details?.snapshot.poster) {
      this.poster.warm([
        { path: this.details.snapshot.poster, kind: 'poster' },
        { path: this.details.snapshot.backdrop, kind: 'backdrop' },
      ]);
    }
  }

  get snapshot() {
    return this.details?.snapshot ?? null;
  }

  get title() {
    const s = this.snapshot;
    if (!s) {
      return { primary: 'Тайтл не найден', secondary: null, overridden: false };
    }
    return this.titles.resolve({
      kind: s.media_type,
      id: s.id,
      titleRu: s.titleRu,
      titleOriginal: s.titleOriginal,
      titleLocalized: s.title,
    });
  }

  get year(): string {
    return this.snapshot?.release_date?.slice(0, 4) ?? '';
  }

  get releaseText(): string {
    return this.snapshot?.release_date ? this.locale.dateMedium(this.snapshot.release_date) : '';
  }

  /** 10-балльная шкала TMDb приводится к нашим 5 звёздам. */
  get communityRating(): string {
    const v = this.snapshot?.tmdbVoteAverage;
    return v ? (v / 2).toFixed(1).replace('.', ',') : '';
  }

  get votes(): string {
    const v = this.snapshot?.tmdbVoteCount ?? 0;
    return this.locale.integer(v);
  }

  async log(): Promise<void> {
    const s = this.snapshot;
    if (!s) {
      return;
    }
    const draft: QuickLogDraft = {
      id: s.id,
      kind: s.media_type,
      title: s.title,
      titleOriginal: s.titleOriginal,
      titleRu: s.titleRu,
      poster: s.poster,
      snapshot: s,
    };
    const m = await this.modal.create({ component: QuickLogComponent, componentProps: { data: draft }, cssClass: 'kd-sheet-glass' });
    await m.present();
    await m.onWillDismiss();
    this.logsForTitle = this.diary.snapshot.filter((e) => e.id === this.id && e.media_type === this.kind).length;
  }

  async saveManualTitle(): Promise<void> {
    const s = this.snapshot;
    if (!s) {
      return;
    }
    const input = window.prompt('Русское название (сохранится только на этом устройстве)', s.titleRu ?? '');
    if (input === null) {
      return;
    }
    const value = input.trim();
    if (!value) {
      return;
    }
    await this.titles.set(s.media_type, s.id, value);
    s.titleRu = value;
    s.title = value;
    const t = await this.toast.create({
      message: 'Название сохранено на устройстве',
      duration: 2200,
      position: 'bottom',
      cssClass: 'kd-toast-glass',
    });
    await t.present();
  }
}
