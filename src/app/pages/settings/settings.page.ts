import { Component, OnInit } from '@angular/core';
import { DiaryService } from '../../services/diary.service';
import { ToastController } from '@ionic/angular';
import { ImportReport, SyncService } from '../../services/sync.service';
import { StorageInfo, StorageQuotaService } from '../../services/storage-quota.service';
import { SettingsService } from '../../services/settings.service';
import { TmdbService } from '../../services/tmdb.service';
import { TitleDisplayService } from '../../services/title-display.service';
import { TitleOverride } from '../../models/storage.models';
import { ConflictReason } from '../../services/sync.service';
import { HapticService } from '../../services/haptic.service';
import { APP_VERSION } from '../../../environments/version';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage implements OnInit {
  keyInput = '';
  keyStatus: { ok: boolean | null; message: string } = { ok: null, message: '' };
  checking = false;

  storage: StorageInfo = { usage: null, quota: null, ratio: null, persisted: null, supported: false };
  lastExport = '';
  report: ImportReport | null = null;
  busy = false;

  overrides: TitleOverride[] = [];

  readonly version = APP_VERSION;

  constructor(
    private readonly settings: SettingsService,
    private readonly tmdb: TmdbService,
    public readonly quota: StorageQuotaService,
    private readonly sync: SyncService,
    private readonly titles: TitleDisplayService,
    private readonly toast: ToastController,
    private readonly diary: DiaryService,
    public readonly haptics: HapticService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.settings.load();
    await this.titles.load();
    this.keyInput = this.settings.value.tmdbApiKey ?? '';
    this.overrides = this.titles.list();
    await this.refresh();
  }

  get current() {
    return this.settings.value;
  }

  /** Настройки наружу: сам сервис компоненту видеть не нужно. */
  get hapticsSupported(): boolean {
    return this.haptics.supported;
  }

  reasonLabel(reason: ConflictReason): string {
    switch (reason) {
      case 'userEdited-local':
        return 'оставлена ваша правка';
      case 'userEdited-incoming':
        return 'взята правка из файла';
      case 'lww-incoming':
        return 'взята более свежая версия';
      case 'lww-local':
        return 'оставлена локальная версия';
      default:
        return 'равные времена — оставлена локальная';
    }
  }

  async saveKey(): Promise<void> {
    const value = this.keyInput.trim();
    await this.settings.patch({ tmdbApiKey: value || undefined });
    this.keyStatus = {
      ok: value ? null : null,
      message: value ? 'Ключ сохранён на этом устройстве' : 'Ключ удалён с устройства',
    };
    await this.say(this.keyStatus.message);
  }

  async checkKey(): Promise<void> {
    this.checking = true;
    const result = await this.tmdb.validateKey(this.keyInput);
    this.keyStatus = { ok: result.ok, message: result.message };
    if (result.ok) {
      await this.settings.patch({ tmdbApiKey: this.keyInput.trim() });
    }
    this.checking = false;
  }

  async exportBackup(): Promise<void> {
    this.busy = true;
    try {
      const { blob, filename } = await this.sync.exportFile();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.lastExport = new Date().toLocaleString('ru-RU');
      await this.say(`Файл выгружен: ${filename}`);
    } catch (err) {
      await this.say(err instanceof Error ? err.message : 'Не удалось выгрузить');
    } finally {
      this.busy = false;
    }
  }

  async importBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.busy = true;
    try {
      const bundle = await this.sync.readBackupFile(file);
      this.report = await this.sync.importBundle(bundle);
      await this.diary.load();
      await this.refresh();
      await this.say('Синхронизация завершена');
    } catch (err) {
      await this.say(err instanceof Error ? err.message : 'Файл не прочитан');
    } finally {
      this.busy = false;
      input.value = '';
    }
  }

  async undoImport(): Promise<void> {
    if (!this.report) {
      return;
    }
    this.busy = true;
    const ok = await this.sync.undoImport(this.report.snapshotId);
    if (ok) {
      this.report = null;
      await this.diary.load();
      await this.say('Импорт отменён');
    } else {
      await this.say('Снимок не найден — откат невозможен');
    }
    this.busy = false;
  }

  async persist(): Promise<void> {
    const result = await this.quota.requestPersist();
    await this.refresh();
    await this.say(
      result === true
        ? 'Хранилище закреплено'
        : result === null
          ? 'Браузер не поддерживает закрепление — установите приложение на экран'
          : 'Браузер отказал в закреплении',
    );
  }

  async clearApiCache(): Promise<void> {
    const n = await this.quota.clearApiCache();
    await this.refresh();
    await this.say(`Кэш TMDb очищен: ${n} записей`);
  }

  async setFade(value: boolean): Promise<void> {
    await this.settings.patch({ fadeWatched: value });
  }

  async setAdult(value: boolean): Promise<void> {
    await this.settings.patch({ includeAdult: value });
  }

  async setOriginalMode(value: string): Promise<void> {
    await this.settings.patch({
      originalTitleMode: value as 'mismatch' | 'always' | 'never',
    });
  }

  async setHaptics(value: boolean): Promise<void> {
    await this.settings.patch({ hapticsEnabled: value });
  }

  async removeOverride(o: TitleOverride): Promise<void> {
    const [kind, id] = o.mediaKey.split(':');
    await this.titles.remove(kind as 'movie' | 'tv', Number(id));
    this.overrides = this.titles.list();
  }

  private async refresh(): Promise<void> {
    this.storage = await this.quota.info();
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2600, position: 'bottom', cssClass: 'kd-toast-glass' });
    await t.present();
  }
}
