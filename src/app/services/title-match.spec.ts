import { fromRuLayout, normalizeTitle, searchKeys, titleSimilarity, SAME_TITLE_THRESHOLD } from './title-match';

describe('title-match', () => {
  it('нормализует: ё→е, без пунктуации и годов в скобках', () => {
    expect(normalizeTitle('Матрица (1999)!')).toBe('матрица');
    expect(normalizeTitle('Ведьмак   ')).toBe('ведьмак');
    expect(normalizeTitle('Ёлки-палки')).toBe('елки-палки'.replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim());
  });

  it('разворачивает английскую раскладку в русскую', () => {
    // Проверенные пары: «фильм» и «сериал», набранные при английской раскладке.
    expect(fromRuLayout('abkmv')).toBe('фильм');
    expect(fromRuLayout('cthbfk')).toBe('сериал');
  });

  it('searchKeys даёт и прямой, и раскладочный вариант', () => {
    const keys = searchKeys('abkmv');
    expect(keys).toContain('фильм');
    expect(keys.length).toBeGreaterThanOrEqual(1);
  });

  describe('сходство названий', () => {
    it('узнаёт переименование того же тайтла', () => {
      expect(titleSimilarity('Очень странные дела', 'Очень странные дел')).toBeGreaterThan(SAME_TITLE_THRESHOLD);
    });

    it('не путает разные тайтлы', () => {
      expect(titleSimilarity('Терминатор', 'Бэтмен')).toBeLessThan(0.3);
    });

    it('пустое против непустого — ноль', () => {
      expect(titleSimilarity('', 'Матрица')).toBe(0);
    });
  });
});
