import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CatalogService } from '../../services/catalog.service';
import { SettingsService } from '../../services/settings.service';
import { episodeKey } from '../../utils/keys';

interface Episode {
  id: number;
  name: string;
  overview: string;
  still: string | null;
  air_date: string | null;
  runtime: number | null;
  watched: boolean;
}

/**
 * Сезоны и серии. Отметка серии хранится в настройках по ключу
 * `tvId-season-episode` — тот же формат, что у донора, поэтому старые
 * данные читаются без переноса.
 */
@Component({
  selector: 'app-season',
  templateUrl: './season.page.html',
  styleUrls: ['./season.page.scss'],
  standalone: false,
})
export class SeasonPage implements OnInit {
  tvId = 0;
  seasonNumber = 1;
  showTitle = '';
  episodes: Episode[] = [];
  loading = true;
  failed = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.tvId = Number(this.route.snapshot.paramMap.get('id') ?? 0);
    this.seasonNumber = Number(this.route.snapshot.paramMap.get('seasonNumber') ?? 1);

    const res = await this.catalog.season(this.tvId, this.seasonNumber);
    if (res) {
      this.showTitle = res.showTitle;
      this.episodes = res.episodes.map((e) => ({
        ...e,
        still: e.still,
        watched: this.isWatched(e.id),
      }));
    } else {
      this.failed = true;
    }
    this.loading = false;
  }

  /** Отметка серии хранится в настройках по ключу `tvId-season-episode`. */
  private isWatched(episodeId: number): boolean {
    return this.settings.value.episodeWatched[episodeKey(this.tvId, this.seasonNumber, episodeId)] === true;
  }

  get watchedCount(): number {
    return this.episodes.filter((e) => e.watched).length;
  }

  trackById(_i: number, ep: Episode): number {
    return ep.id;
  }

  goBack(): void {
    void this.router.navigate(['/tv', this.tvId]);
  }

  /**
   * Прогресс считается по фактическому числу серий сезона.
   * Донорское «сезон = 10 серий» (episodes / 10) убрано: оно округляло
   * на глазок и врало на мини-сериалах и аниме по 12 серий.
   */
  get progressPct(): number {
    return this.episodes.length ? Math.round((this.watchedCount / this.episodes.length) * 100) : 0;
  }

  async toggle(ep: Episode): Promise<void> {
    const map = { ...this.settings.value.episodeWatched };
    const key = episodeKey(this.tvId, this.seasonNumber, ep.id);
    if (map[key]) {
      delete map[key];
      ep.watched = false;
    } else {
      map[key] = true;
      ep.watched = true;
    }
    await this.settings.patch({ episodeWatched: map });
  }
}
