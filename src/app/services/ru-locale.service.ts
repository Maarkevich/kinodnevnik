import { Inject, Injectable, LOCALE_ID } from '@angular/core';

/**
 * Русская локаль: числа, проценты, рейтинги, плюралы, названия стран и языков
 * (спецификация, 4.4, 10.3).
 *
 * Всё через Intl. Никаких `replace('.', ',')` руками: так теряются неразрывные
 * пробелы, и «4 567» разъедается переносом строки.
 */
@Injectable({ providedIn: 'root' })
export class RuLocaleService {
  constructor(@Inject(LOCALE_ID) private readonly locale: string) {}

  /**
   * Проверка, что в движке реально есть данные локали.
   *
   * Это не паранойя: `toLocaleString('ru')` НЕ бросает исключение, когда
   * локальных данных нет — он молча возвращает английский вывод. В собранном
   * без full-icu Node и в урезанных WebView получается интерфейс, где весь
   * текст русский, а все числа и даты английские. Выглядит как кривой перевод,
   * хотя перевод корректный.
   */
  localeDataAvailable(locale?: string): boolean {
    const l = locale ?? this.locale;
    if (!l || l.startsWith('en')) {
      return true;
    }
    try {
      const probe = new Date(2021, 0, 2).toLocaleDateString(l);
      const en = new Date(2021, 0, 2).toLocaleDateString('en-US');
      const num = (1234567.5).toLocaleString(l);
      return probe !== en || num !== (1234567.5).toLocaleString('en-US');
    } catch {
      return false;
    }
  }

  /** 4567 → «4 567» с неразрывным пробелом. */
  integer(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return NO_DATA;
    }
    return new Intl.NumberFormat(this.locale, { maximumFractionDigits: 0 }).format(value);
  }

  /** 1234.5 → «1 234,5». */
  decimal(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return NO_DATA;
    }
    return new Intl.NumberFormat(this.locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  /** 4.27 → «4,3★». */
  rating(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return NO_DATA;
    }
    return `${this.decimal(value, 1)}★`;
  }

  /** 12.5 → «12,5 %» — неразрывный пробел перед знаком, запятая как разделитель. */
  percent(value: number | null | undefined, digits = 0): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return NO_DATA;
    }
    return new Intl.NumberFormat(this.locale, {
      style: 'percent',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value / 100);
  }

  /**
   * Русские плюралы через Intl.PluralRules: one/few/many/other покрывают все
   * пять русских форм, включая «21 фильм» и «11 фильмов».
   */
  plural(count: number, forms: { one: string; few: string; many: string; other?: string }): string {
    let category: string;
    try {
      category = new Intl.PluralRules(this.locale).select(count);
    } catch {
      category = manualCategory(count);
    }
    const word =
      category === 'one' ? forms.one : category === 'few' ? forms.few : category === 'many' ? forms.many : forms.other ?? forms.many;
    return `${this.integer(count)} ${word}`;
  }

  /** «2 дня» / «5 дней» — частый случай. */
  days(count: number): string {
    return this.plural(count, { one: 'день', few: 'дня', many: 'дней' });
  }

  items(count: number, what: { one: string; few: string; many: string }): string {
    return this.plural(count, what);
  }

  /**
   * Название языка по ISO-коду: «английский», «корейский».
   * Особые коды TMDb: `cn` (устаревший для китайского), `xx` (неизвестный).
   */
  languageName(code: string | null | undefined): string {
    const raw = (code ?? '').trim().toLowerCase();
    if (!raw) {
      return '';
    }
    if (raw === 'xx') {
      return 'без языка';
    }
    const normalized = raw === 'cn' ? 'zh' : raw;
    const name = this.displayName('language', normalized);
    return name ?? normalized.toUpperCase();
  }

  /** Название страны: «Южная Корея», «Япония». */
  countryName(code: string | null | undefined): string {
    const raw = (code ?? '').trim().toUpperCase();
    if (!raw) {
      return '';
    }
    if (raw === 'XX') {
      return 'без страны';
    }
    const name = this.displayName('region', raw);
    return name ?? raw;
  }

  /**
   * Месяц+год для группировки дневника: «Ноябрь 2026».
   * Русская локаль добавляет « г.» — в заголовке секции оно лишнее,
   * поэтому снимаем (спецификация, 10.3).
   */
  monthYear(date: Date): string {
    const s = new Intl.DateTimeFormat(this.locale, { month: 'long', year: 'numeric' })
      .format(date)
      .replace(/\s*г\.$/, '');
    return upperFirst(s);
  }

  /** День в группе: «5 нояб.» — без точки на конце, чтобы не спорить с локалью. */
  /** День в группе: «5 нояб.» — точка обязательна, это сокращение. */
  dayShort(date: Date): string {
    return new Intl.DateTimeFormat(this.locale, { day: 'numeric', month: 'short' }).format(date);
  }

  /** Дата премьеры в карточке: «31 мар. 1999». */
  dateMedium(iso: string | null | undefined): string {
    const d = parseDate(iso);
    if (!d) {
      return 'дата неизвестна';
    }
    return new Intl.DateTimeFormat(this.locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  }

  /** Дни недели, начиная с понедельника — русская конвенция (спецификация, 5.4). */
  weekdays(style: 'short' | 'narrow' = 'short'): string[] {
    // 2026-11-16 — понедельник.
    const base = new Date(2026, 10, 16);
    const fmt = new Intl.DateTimeFormat(this.locale, { weekday: style });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return upperFirst(fmt.format(d).replace(/\.$/, ''));
    });
  }

  /** «1 час 20 мин» — только для отображения длительности серии, не для сумм. */
  duration(minutes: number): string {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return '—';
    }
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) {
      return `${m} мин`;
    }
    if (m === 0) {
      return `${h} ч`;
    }
    return `${h} ч ${m} мин`;
  }

  private displayName(type: 'language' | 'region', code: string): string | null {
    try {
      if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') {
        return null;
      }
      const dn = new Intl.DisplayNames([this.locale], { type });
      const of = dn.of(code);
      // Если DisplayNames вернул сам код, значит названия у него нет.
      if (!of || of.toLowerCase() === code.toLowerCase()) {
        return null;
      }
      return of;
    } catch {
      // Android WebView < 81, Safari < 14.1
      return null;
    }
  }
}

const NO_DATA = 'нет данных';

function manualCategory(n: number): 'one' | 'few' | 'many' | 'other' {
  const abs = Math.abs(n);
  const d10 = abs % 10;
  const d100 = abs % 100;
  if (d10 === 1 && d100 !== 11) {
    return 'one';
  }
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) {
    return 'few';
  }
  return 'many';
}

function parseDate(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim());
  if (!m) {
    return null;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function upperFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export { parseDate, NO_DATA };
