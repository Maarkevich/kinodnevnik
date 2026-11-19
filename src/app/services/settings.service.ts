import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AppSettings, DEFAULT_SETTINGS, SECRET_SETTING_KEYS, SettingRecord } from '../models/storage.models';
import { DbService } from './db.service';

const SETTINGS_ID = 'app';

/**
 * Настройки. Ключи TMDb живут здесь же, но в IndexedDB, и исключаются из
 * любого экспорта (спецификация, 15).
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private current: AppSettings = { ...DEFAULT_SETTINGS };
  private readonly subject = new BehaviorSubject<AppSettings>(this.current);
  private loaded = false;

  constructor(private readonly db: DbService) {}

  readonly settings$: Observable<AppSettings> = this.subject.asObservable();

  get value(): AppSettings {
    return this.current;
  }

  async load(): Promise<AppSettings> {
    if (this.loaded) {
      return this.current;
    }
    const rec = await this.db.run<SettingRecord<AppSettings> | undefined>('settings', 'readonly', (tx) =>
      this.db.get<SettingRecord<AppSettings>>(tx, 'settings', SETTINGS_ID),
    );
    // Неизвестные поля из старых копий отбрасываются, а не ломают старт.
    this.current = { ...DEFAULT_SETTINGS, ...(sanitize(rec?.v)) };
    this.subject.next(this.current);
    this.loaded = true;
    return this.current;
  }

  async patch(changes: Partial<AppSettings>): Promise<AppSettings> {
    await this.load();
    this.current = { ...this.current, ...changes };
    this.subject.next(this.current);
    await this.db.run('settings', 'readwrite', (tx) =>
      this.db.put(tx, 'settings', { k: SETTINGS_ID, v: this.current } satisfies SettingRecord<AppSettings>),
    );
    return this.current;
  }

  /** Только для экспорта: настройки без секретов. */
  redacted(): AppSettings {
    const copy: Record<string, unknown> = { ...this.current };
    for (const key of SECRET_SETTING_KEYS) {
      delete copy[key];
    }
    return copy as unknown as AppSettings;
  }

  /** Слияние настроек при импорте: локальные секреты не перезаписываются. */
  async mergeIncoming(incoming: Partial<AppSettings> | undefined): Promise<void> {
    if (!incoming) {
      return;
    }
    await this.load();
    const safe: Partial<AppSettings> = { ...incoming };
    for (const key of SECRET_SETTING_KEYS) {
      delete (safe as Record<string, unknown>)[key];
    }
    // episodeWatched объединяется по ключу серии, а не заменяется.
    if (incoming.episodeWatched) {
      safe.episodeWatched = { ...this.current.episodeWatched, ...incoming.episodeWatched };
    }
    await this.patch(safe);
  }
}

/**
 * Выборка известных полей из произвольного объекта.
 * Табличный вид: неизвестные поля из старых копий отбрасываются, а не
 * ломают старт, и каждое поле проверяется один раз.
 */
function sanitize(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const copy = (key: string, ok: (v: unknown) => boolean): void => {
    const value = src[key];
    if (value !== undefined && ok(value)) {
      out[key] = value;
    }
  };

  const isString = (v: unknown): boolean => typeof v === 'string';
  const isBool = (v: unknown): boolean => typeof v === 'boolean';
  const oneOf = (...allowed: string[]) => (v: unknown): boolean => typeof v === 'string' && allowed.includes(v);

  copy('language', isString);
  copy('region', isString);
  copy('includeAdult', isBool);
  copy('fadeWatched', isBool);
  copy('defaultTab', oneOf('diary', 'collections'));
  copy('originalTitleMode', oneOf('mismatch', 'always', 'never'));
  copy('displayName', isString);
  copy('bio', isString);
  copy('tmdbApiKey', isString);
  copy('hapticsEnabled', isBool);
  copy('excludeLanguages', (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'));
  copy('episodeWatched', (v) => !!v && typeof v === 'object');

  return out as Partial<AppSettings>;
}
