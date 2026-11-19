import { Injectable } from '@angular/core';
import { MediaKind, TitleOverride } from '../models/storage.models';
import { mediaKey } from '../utils/keys';
import { DbService } from './db.service';
import { SettingsService } from './settings.service';

export interface ResolvedTitle {
  /** Основной заголовок — русское название или оригинал. */
  primary: string;
  /** Вторая, серая строка. Пустая — значит не показывать. */
  secondary: string | null;
  /** Название задал пользователь вручную. */
  overridden: boolean;
}

/**
 * Правила вывода названий (спецификация, 7.4).
 *
 * 25–50% азиатского каталога TMDb не имеет русского названия, и дозагрузить
 * его некуда: alternative_titles/translations дают 1 из 8, Shikimori для
 * не-аниме врёт. Поэтому оригинал — это не «непереведено», а корректное
 * состояние, и показывать его надо первым, а не прятать.
 */
@Injectable({ providedIn: 'root' })
export class TitleDisplayService {
  private overrides = new Map<string, TitleOverride>();
  private loaded = false;

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    const list = await this.db.run('overrides', 'readonly', (tx) => this.db.all<TitleOverride>(tx, 'overrides'));
    this.overrides = new Map(list.map((o) => [o.mediaKey, o]));
    this.loaded = true;
  }

  get mode(): 'mismatch' | 'always' | 'never' {
    return this.settings.value.originalTitleMode;
  }

  resolve(input: {
    kind: MediaKind;
    id: number;
    titleRu?: string | null;
    titleOriginal?: string | null;
    /** Локализованное поле от TMDb, когда русского названия нет. */
    titleLocalized?: string | null;
  }): ResolvedTitle {
    const key = mediaKey(input.kind, input.id);
    const manual = this.overrides.get(key)?.titleRu?.trim() ?? '';

    const ru = manual || (hasCyrillic(input.titleRu) ? (input.titleRu as string) : '');
    const original = (input.titleOriginal ?? '').trim();
    const localized = (input.titleLocalized ?? '').trim();

    // Если русского нет, первым идёт оригинал; локализованное поле в этом
    // случае и есть оригинал (TMDb отдаёт его при отсутствии перевода).
    const primary = ru || original || localized;

    let secondary: string | null = null;
    if (this.mode === 'never') {
      secondary = null;
    } else if (this.mode === 'always') {
      secondary = original && !sameText(original, primary) ? original : null;
    } else {
      // mismatch: показываем оригинал, только когда он реально отличается
      secondary = original && !sameText(original, primary) ? original : null;
    }

    return { primary, secondary, overridden: !!manual };
  }

  async set(mediaType: MediaKind, id: number, titleRu: string, note?: string): Promise<TitleOverride> {
    await this.load();
    const record: TitleOverride = {
      mediaKey: mediaKey(mediaType, id),
      titleRu: titleRu.trim(),
      note: note?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    await this.db.run('overrides', 'readwrite', (tx) => this.db.put(tx, 'overrides', record));
    this.overrides.set(record.mediaKey, record);
    return record;
  }

  async remove(mediaType: MediaKind, id: number): Promise<void> {
    await this.load();
    const key = mediaKey(mediaType, id);
    await this.db.run('overrides', 'readwrite', (tx) => this.db.del(tx, 'overrides', key));
    this.overrides.delete(key);
  }

  list(): TitleOverride[] {
    return [...this.overrides.values()].sort((a, b) => a.mediaKey.localeCompare(b.mediaKey));
  }
}

function hasCyrillic(value: string | null | undefined): boolean {
  return !!value && /[а-яё]/i.test(value);
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
