import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MediaSnapshot } from '../../models/storage.models';
import { CatalogService } from '../../services/catalog.service';
import { PosterService } from '../../services/poster.service';
import { RuLocaleService } from '../../services/ru-locale.service';
import { TitleDisplayService } from '../../services/title-display.service';

@Component({
  selector: 'app-collections',
  templateUrl: './collections.page.html',
  styleUrls: ['./collections.page.scss'],
  standalone: false,
})
export class CollectionsPage implements OnInit {
  items: MediaSnapshot[] = [];
  selected: string | null = null;
  loading = true;
  error: string | null = null;
  fromCache = false;
  page = 1;
  exhausted = false;

  constructor(
    private readonly catalog: CatalogService,
    private readonly router: Router,
    public readonly locale: RuLocaleService,
    public readonly poster: PosterService,
    public readonly titles: TitleDisplayService,
  ) {}

  get collections() {
    return this.catalog.collections();
  }

  async ngOnInit(): Promise<void> {
    await this.titles.load();
    await this.load(1);
  }

  async select(id: string | null): Promise<void> {
    this.selected = id;
    await this.load(1);
  }

  async load(page: number): Promise<void> {
    this.loading = true;
    const feed = this.selected
      ? await this.catalog.collection(this.selected, page)
      : await this.catalog.trending(page);

    this.items = page === 1 ? feed.items : [...this.items, ...feed.items];
    this.error = feed.error;
    this.fromCache = feed.fromCache;
    this.page = page;
    this.exhausted = feed.exhausted;
    this.loading = false;

    this.poster.warm(feed.items.map((i) => ({ path: i.poster, kind: 'poster' as const })));
  }

  async more(): Promise<void> {
    await this.load(this.page + 1);
  }

  trackById(_i: number, item: MediaSnapshot): string {
    return `${item.media_type}:${item.id}`;
  }

  open(item: MediaSnapshot): void {
    void this.router.navigate([item.media_type, item.id]);
  }

  title(item: MediaSnapshot) {
    return this.titles.resolve({
      kind: item.media_type,
      id: item.id,
      titleRu: item.titleRu,
      titleOriginal: item.titleOriginal,
      titleLocalized: item.title,
    });
  }
}
