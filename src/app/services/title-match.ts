/**
 * Нормализация и сходство названий (спецификация, 9.5).
 *
 * Логика перенесена из донорского tmdb-matcher.ts, но без сетевой части:
 * Letterboxd из продукта удалён, а сопоставление названий осталось нужным
 * для поиска дублей при слиянии.
 */

/**
 * ЙЦУКЕН: если раскладка английская, а думать пользователь продолжает по-русски,
 * «фильм» выходит как `abkmv`, «сериал» — как `cthbfk`. Таблица разворачивает
 * набранное обратно в кириллицу.
 */
const RU_LAYOUT: Record<string, string> = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
  '[': 'х', ']': 'ъ', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о',
  k: 'л', l: 'д', ';': 'ж', "'": 'э', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и',
  n: 'т', m: 'ь', ',': 'б', '.': 'ю', '/': '.',
};

export function normalizeTitle(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Годы в скобках, номера сезонов и пунктуация не значимы для сходства.
    .replace(/\((?:19|20)\d{2}\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fromRuLayout(input: string): string {
  let out = '';
  for (const ch of input.toLowerCase()) {
    out += RU_LAYOUT[ch] ?? ch;
  }
  return out;
}

/** Обе раскладки сразу: поиск должен работать независимо от языка клавиатуры. */
export function searchKeys(query: string): string[] {
  const direct = normalizeTitle(query);
  const swapped = normalizeTitle(fromRuLayout(query));
  return Array.from(new Set([direct, swapped].filter(Boolean)));
}

function bigrams(s: string): Set<string> {
  const compact = s.replace(/\s+/g, '');
  const set = new Set<string>();
  for (let i = 0; i < compact.length - 1; i++) {
    set.add(compact.slice(i, i + 2));
  }
  return set;
}

/**
 * Сходство двух названий в [0..1]: максимум из жаккарда по словам и
 * Дайса по биграммам. Биграммы ловят опечатки, слова — перестановку.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) {
    return 0;
  }
  if (na === nb) {
    return 1;
  }

  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) {
      inter++;
    }
  }
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union ? inter / union : 0;

  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (!ba.size || !bb.size) {
    return jaccard;
  }
  let overlap = 0;
  for (const g of ba) {
    if (bb.has(g)) {
      overlap++;
    }
  }
  return Math.max(jaccard, (2 * overlap) / (ba.size + bb.size));
}

/** Порог «это тот же тайтл» для слияния дублей (спецификация, 9.5). */
export const SAME_TITLE_THRESHOLD = 0.9;
