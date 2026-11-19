import { RuLocaleService } from './ru-locale.service';

describe('RuLocaleService', () => {
  const l = new RuLocaleService('ru');

  describe('плюралы', () => {
    const forms = { one: 'фильм', few: 'фильма', many: 'фильмов' };

    it('склоняет по русским правилам', () => {
      expect(l.plural(1, forms)).toBe('1 фильм');
      expect(l.plural(21, forms)).toBe('21 фильм');
      expect(l.plural(22, forms)).toBe('22 фильма');
      expect(l.plural(25, forms)).toBe('25 фильмов');
      expect(l.plural(11, forms)).toBe('11 фильмов');
      expect(l.plural(114, forms)).toBe('114 фильмов');
      expect(l.plural(0, forms)).toBe('0 фильмов');
    });

    it('не разделяет число и пробелом — только неразрывный', () => {
      expect(l.plural(4567, forms)).toContain('\u00a0');
    });
  });

  describe('числа и проценты', () => {
    it('разделяет тысячи неразрывным пробелом', () => {
      expect(l.integer(4567)).toBe('4\u00a0567');
    });

    it('ставит запятую как десятичный разделитель', () => {
      expect(l.decimal(4.5)).toBe('4,5');
      expect(l.rating(4.27)).toBe('4,3★');
    });

    it('ставит пробел перед процентом', () => {
      expect(l.percent(12.5, 1)).toBe('12,5\u00a0%');
    });

    it('не падает на мусоре, а отдаёт «нет данных»', () => {
      expect(l.integer(NaN)).toBe('нет данных');
      expect(l.rating(null)).toBe('нет данных');
      expect(l.percent(undefined)).toBe('нет данных');
      expect(l.rating(Infinity)).toBe('нет данных');
    });
  });

  describe('даты', () => {
    it('ставит день перед месяцем и годом', () => {
      expect(l.dateMedium('1999-03-31')).toBe('31 мар. 1999 г.');
    });

    it('месяц с заглавной и без точки на конце', () => {
      expect(l.dayShort(new Date(2026, 10, 5))).toBe('5 нояб');
      expect(l.monthYear(new Date(2026, 10, 1))).toBe('Ноябрь 2026 г.');
    });

    it('неделя начинается с понедельника', () => {
      const days = l.weekdays('short');
      expect(days[0]).toBe('пн');
      expect(days[6]).toBe('вс');
    });

    it('для неизвестной даты — текст, а не Invalid Date', () => {
      expect(l.dateMedium(null)).toBe('дата неизвестна');
      expect(l.dateMedium('не дата')).toBe('дата неизвестна');
    });
  });

  describe('названия языков и стран', () => {
    it('переводит коды TMDb, включая устаревший cn', () => {
      expect(l.languageName('cn')).toBe('китайский');
      expect(l.languageName('ko')).toBe('корейский');
      expect(l.languageName('xx')).toBe('без языка');
      expect(l.countryName('KR')).toBe('Северная Корея');
      expect(l.countryName('XX')).toBe('без страны');
    });

    it('не падает на пустом и на мусорном коде', () => {
      expect(l.languageName(null)).toBe('');
      expect(l.languageName('')).toBe('');
      expect(l.countryName('ZZZ').length).toBeGreaterThan(0);
    });
  });

  it('сообщает, есть ли у движка данные локали', () => {
    expect(l.localeDataAvailable('en')).toBe(true);
    expect(typeof l.localeDataAvailable('ru')).toBe('boolean');
  });
});
