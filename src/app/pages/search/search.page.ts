import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ModalController } from '@ionic/angular';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { MediaSnapshot } from '../../models/storage.models';
import { CatalogService } from '../../services/catalog.service';
import { PosterService } from '../../services/poster.service';
import { TitleDisplayService } from '../../services/title-display.service';
import { searchKeys } from '../../services/title-match';
import { QuickLogComponent, QuickLogDraft } from '../../shared/quick-log/quick-log.component';

const RECENT_KEY = 'kd_recent_searches';

@Component({
  selector: 'app-search',
  templateUrl: './search.page.html',
  styleUrls: ['./search.page.scss'],
  standalone: false,
})
export class SearchPage implements OnInit, OnDestroy {
  @ViewChild('input') input?: ElementRef<HTMLInputElement>;

  query = '';
  items: MediaSnapshot[] = [];
  searched = false;
  loading = false;
  error: string | null = null;
  recent: string[] = [];

  private readonly stream = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly catalog: CatalogService,
    private readonly route: ActivatedRoute,
    private readonly modal: ModalController,
    public readonly poster: PosterService,
    private readonly titles: TitleDisplayService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.titles.load();
    this.recent = readRecent();

    // Поиск печатается быстро — network уходит на 300 мс позже последнего
    // нажатия, иначе каждый символ стоит запроса к TMDb.
    this.stream
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((q) => void this.run(q));

    const focus = this.route.snapshot.queryParamMap.get('focus');
    const log = this.route.snapshot.queryParamMap.get('log');
    if (focus === '1' || log === '1') {
      setTimeout(() => this.input?.nativeElement.focus(), 120);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onInput(value: string): void {
    this.query = value;
    this.stream.next(value);
  }

  clear(): void {
    this.query = '';
    this.items = [];
    this.searched = false;
    this.input?.nativeElement.focus();
  }

  useRecent(term: string): void {
    this.query = term;
    void this.run(term);
  }

  /**
   * Фильтр уже введённого — по локальным данным, включая метки и собственный
   * текст (в доноре поиск шёл только по названию).
   */
  matches(item: MediaSnapshot): boolean {
    if (!this.query.trim()) {
      return true;
    }
    const hay = [item.title, item.titleOriginal, ...(item.genres ?? [])].join(' ').toLowerCase();
    return searchKeys(this.query).some((k) => k && hay.includes(k));
  }

  async log(item: MediaSnapshot, event: Event): Promise<void> {
    event.stopPropagation();
    const draft: QuickLogDraft = {
      id: item.id,
      kind: item.media_type,
      title: item.title,
      titleOriginal: item.titleOriginal,
      titleRu: item.titleRu,
      poster: item.poster,
      snapshot: item,
    };
    const m = await this.modal.create({ component: QuickLogComponent, componentProps: { data: draft }, cssClass: 'kd-sheet-glass' });
    await m.present();
    await m.onWillDismiss();
  }

  track(_i: number, item: MediaSnapshot): string {
    return `${item.media_type}:${item.id}`;
  }

  private async run(raw: string): Promise<void> {
    const term = raw.trim();
    if (term.length < 2) {
      this.items = [];
      this.searched = false;
      return;
    }

    this.loading = true;
    this.error = null;
    const feed = await this.catalog.search(term);
    this.items = feed.items;
    this.searched = true;
    this.loading = false;
    this.error = feed.error;

    if (feed.items.length) {
      this.recent = remember(term);
      this.poster.warm(feed.items.slice(0, 20).map((i) => ({ path: i.poster, kind: 'poster' as const })));
    }
  }
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, 10) : [];
  } catch {
    return [];
  }
}

function remember(term: string): string[] {
  const list = [term, ...readRecent().filter((t) => t !== term)].slice(0, 10);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* квота — не причина ронять поиск */
  }
  return list;
}
