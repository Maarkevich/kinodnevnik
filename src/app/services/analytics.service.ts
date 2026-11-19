import { Injectable } from '@angular/core';
import { WatchedEntry } from '../models/storage.models';
import { normalizeDate } from '../utils/keys';
import { RuLocaleService } from './ru-locale.service';

/**
 * Аналитика (спецификация, раздел 13).
 *
 * Время просмотра из продукта выведено целиком — вместе с донорской
 * импутацией `runtimeMinutes || 45 : 108`. Вместо часов остаются счётчики,
 * и ни одна цифра здесь не додумывается: если данных меньше порога,
 * возвращается null, а UI обязан показать «нет данных».
 */

export const MIN_SAMPLE = {
  averageRating: 3,
  genreAffinity: 5,
  directorAffinity: 3,
  obscurity: 10,
  ageAtViewing: 3,
  crowdDelta: 5,
} as const;

export interface Coverage {
  sample: number;
  total: number;
}

export interface Metric<T> {
  value: T | null;
  coverage: Coverage;
  /** Истинно, когда значения ниже порога и value === null. */
  insufficient: boolean;
}

export interface HistogramBar {
  score: number;
  label: string;
  count: number;
}

export interface PacePoint {
  monthKey: string;
  label: string;
  count: number;
}

export interface AffinityRow {
  name: string;
  count: number;
  avgRating: number;
  /** Байесовская оценка: сглаживание к общему среднему. */
  weighted: number;
}

export interface CountryRow {
  code: string;
  name: string;
  count: number;
}

export interface AnalyticsSummary {
  generatedAt: string;
  totalEntries: number;
  completed: number;
  dated: number;
  undated: number;
  rewatchCount: number;
  ratedCount: number;

  averageRating: Metric<number>;
  histogram: HistogramBar[];
  /** 100% в одной корзине — рисовать такой график бессмысленно. */
  histogramDegenerate: boolean;
  peakScore: number | null;

  pace: PacePoint[];
  paceTotal: number;

  genres: AffinityRow[];
  directors: AffinityRow[];

  obscurity: Metric<number>;
  ageAtViewing: Metric<number>;
  crowdDelta: Metric<number>;
  crowdSample: number;

  countries: CountryRow[];
  languageTop: { code: string; name: string; count: number }[];
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private memoKey = '';
  private memo: AnalyticsSummary | null = null;

  constructor(private readonly locale: RuLocaleService) {}

  summarize(entries: WatchedEntry[], year: number | 'all' = 'all', now = new Date()): AnalyticsSummary {
    const completedAll = entries.filter(isCompleted);
    const enriched = completedAll.filter((e) => (e.snapshot?.genres?.length ?? 0) > 0).length;

    // Мемоизация по (год, число записей, число обогащённых) — как в аудите донора.
    const key = `${year}|${completedAll.length}|${enriched}`;
    if (key === this.memoKey && this.memo) {
      return this.memo;
    }

    const scoped =
      year === 'all'
        ? completedAll
        : completedAll.filter((e) => (normalizeDate(e.watchedAt) ?? normalizeDate(e.createdAt) ?? '').startsWith(`${year}-`));

    const dated = scoped.filter((e) => e.watchedAt && !e.dateUnknown);
    const undated = scoped.length - dated.length;

    const rated = scoped.filter((e) => typeof e.rating === 'number' && (e.rating as number) > 0);
    const ratings = rated.map((e) => e.rating as number);

    const averageRating = metric(
      ratings.length >= MIN_SAMPLE.averageRating ? mean(ratings) : null,
      ratings.length,
      scoped.length,
      MIN_SAMPLE.averageRating,
    );

    const histogram = buildHistogram(rated);
    const nonZero = histogram.filter((b) => b.count > 0);
    const histogramDegenerate = nonZero.length <= 1 && rated.length > 0;
    const peakScore = nonZero.length ? nonZero.reduce((a, b) => (b.count > a.count ? b : a)).score : null;

    const pace = buildPace(dated, now);

    const priorMean = ratings.length ? mean(ratings) : 3.5;
    const genres = affinity(
      rated,
      (e) => e.snapshot?.genres ?? [],
      MIN_SAMPLE.genreAffinity,
      priorMean,
    ).map((r) => ({ ...r, name: r.name }));

    const directors = affinity(
      rated,
      (e) => e.snapshot?.directors ?? [],
      MIN_SAMPLE.directorAffinity,
      priorMean,
    );

    const withVotes = scoped.filter((e) => typeof e.snapshot?.tmdbVoteCount === 'number');
    const obscurity = metric(
      withVotes.length >= MIN_SAMPLE.obscurity ? obscurityIndex(withVotes) : null,
      withVotes.length,
      scoped.length,
      MIN_SAMPLE.obscurity,
    );

    const ages: number[] = [];
    for (const e of dated) {
      const release = e.snapshot?.release_date ?? e.release_date ?? e.first_air_date;
      if (!release) {
        continue;
      }
      const w = Number((e.watchedAt as string).slice(0, 4));
      const r = Number(release.slice(0, 4));
      if (Number.isFinite(w) && Number.isFinite(r) && w >= r) {
        ages.push(w - r);
      }
    }
    const ageAtViewing = metric(
      ages.length >= MIN_SAMPLE.ageAtViewing ? mean(ages) : null,
      ages.length,
      scoped.length,
      MIN_SAMPLE.ageAtViewing,
    );

    // Дельта с консенсусом: TMDb по 10-балльной, наши звёзды по 5-балльной.
    const deltas: number[] = [];
    for (const e of rated) {
      const tmdb = e.snapshot?.tmdbVoteAverage;
      if (typeof tmdb === 'number' && tmdb > 0) {
        deltas.push((e.rating as number) - tmdb / 2);
      }
    }
    const crowdDelta = metric(
      deltas.length >= MIN_SAMPLE.crowdDelta ? mean(deltas) : null,
      deltas.length,
      rated.length,
      MIN_SAMPLE.crowdDelta,
    );

    const countryCounts = new Map<string, number>();
    for (const e of scoped) {
      for (const code of e.snapshot?.production_countries ?? []) {
        const c = (code || '').trim().toUpperCase();
        if (c.length === 2) {
          countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
        }
      }
    }
    const countries: CountryRow[] = [...countryCounts.entries()]
      .map(([code, count]) => ({ code, name: this.locale.countryName(code), count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));

    const langCounts = new Map<string, number>();
    for (const e of scoped) {
      const l = (e.snapshot?.original_language ?? '').toLowerCase();
      if (l) {
        langCounts.set(l, (langCounts.get(l) ?? 0) + 1);
      }
    }
    const languageTop = [...langCounts.entries()]
      .map(([code, count]) => ({ code, name: this.locale.languageName(code), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const result: AnalyticsSummary = {
      generatedAt: now.toISOString(),
      totalEntries: entries.length,
      completed: scoped.length,
      dated: dated.length,
      undated,
      rewatchCount: scoped.filter((e) => e.rewatch).length,
      ratedCount: rated.length,
      averageRating,
      histogram,
      histogramDegenerate,
      peakScore,
      pace,
      paceTotal: pace.reduce((s, p) => s + p.count, 0),
      genres,
      directors,
      obscurity,
      ageAtViewing,
      crowdDelta,
      crowdSample: deltas.length,
      countries,
      languageTop,
    };

    this.memoKey = key;
    this.memo = result;
    return result;
  }

  /** Список лет, доступных для фильтра. */
  years(entries: WatchedEntry[]): number[] {
    const set = new Set<number>();
    for (const e of entries) {
      const d = normalizeDate(e.watchedAt) ?? normalizeDate(e.createdAt);
      if (d) {
        set.add(Number(d.slice(0, 4)));
      }
    }
    return [...set].sort((a, b) => b - a);
  }
}

function isCompleted(e: WatchedEntry): boolean {
  return e.status !== 'watching' && e.status !== 'rewatching';
}

function metric<T>(value: T | null, sample: number, total: number, minSample: number): Metric<T> {
  return {
    value,
    coverage: { sample, total },
    insufficient: value === null || sample < minSample,
  };
}

function mean(list: number[]): number {
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function buildHistogram(rated: WatchedEntry[]): HistogramBar[] {
  const scores = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const counts = new Map<number, number>(scores.map((s) => [s, 0]));
  for (const e of rated) {
    const r = e.rating as number;
    if (counts.has(r)) {
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
  }
  return scores.map((score) => ({ score, label: score.toFixed(1).replace('.', ','), count: counts.get(score) ?? 0 }));
}

function buildPace(dated: WatchedEntry[], now: Date): PacePoint[] {
  const buckets = new Map<string, PacePoint>();
  const order: string[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('ru', { month: 'short' })
      .format(d)
      .replace(/\.$/, '')
      .replace(/^./, (c) => c.toUpperCase());
    buckets.set(key, { monthKey: key, label, count: 0 });
    order.push(key);
  }

  for (const e of dated) {
    const key = (e.watchedAt as string).slice(0, 7);
    const b = buckets.get(key);
    if (b) {
      b.count++;
    }
  }

  return order.map((k) => buckets.get(k) as PacePoint);
}

/**
 * Байесовская афинность: сглаживание к общему среднему, чтобы «10/10 по
 * одному фильму» не возглавляло список. Порог выборки обязателен.
 */
function affinity(
  rated: WatchedEntry[],
  extract: (e: WatchedEntry) => string[],
  minSample: number,
  priorMean: number,
): AffinityRow[] {
  const acc = new Map<string, { sum: number; count: number }>();

  for (const e of rated) {
    for (const raw of extract(e)) {
      const name = (raw || '').trim();
      if (!name) {
        continue;
      }
      const cur = acc.get(name) ?? { sum: 0, count: 0 };
      cur.sum += e.rating as number;
      cur.count += 1;
      acc.set(name, cur);
    }
  }

  const rows: AffinityRow[] = [];
  for (const [name, { sum, count }] of acc) {
    if (count < minSample) {
      continue;
    }
    const avg = sum / count;
    // m — вес априоры: столько же «виртуальных» оценок, сколько порог выборки.
    const m = minSample;
    rows.push({ name, count, avgRating: avg, weighted: (count * avg + m * priorMean) / (count + m) });
  }

  return rows.sort((a, b) => b.weighted - a.weighted || b.count - a.count).slice(0, 12);
}

/**
 * Индекс нишевости 0–100 по количеству оценок TMDb.
 * Меньше голосов => выше нишевость. Считаем по медиане логарифма, чтобы
 * один блокбастер не утянул показатель.
 */
function obscurityIndex(entries: WatchedEntry[]): number {
  const logs = entries
    .map((e) => Math.log10((e.snapshot?.tmdbVoteCount as number) + 1))
    .sort((a, b) => a - b);
  const median = logs[Math.floor(logs.length / 2)];
  // log10 голосов: 6 ≈ мейнстрим, 2.5 ≈ нишевое.
  return Math.max(0, Math.min(100, Math.round((6 - median) * 25)));
}
