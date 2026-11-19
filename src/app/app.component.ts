import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, Event as RouterEvent } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { Subject, filter, takeUntil } from 'rxjs';
import { DiaryService } from './services/diary.service';
import { InstallService, InstallState } from './services/install.service';
import { LegacyMigrationService } from './services/legacy-migration.service';
import { NetworkService } from './services/network.service';
import { SettingsService } from './services/settings.service';
import { StorageQuotaService } from './services/storage-quota.service';
import { SwUpdateService } from './services/sw-update.service';

type Tab = 'diary' | 'collections' | 'search' | 'profile';

const TAB_ROUTES: Record<Tab, string> = {
  diary: '/diary',
  collections: '/collections',
  search: '/search',
  profile: '/profile',
};

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit, OnDestroy {
  activeTab: Tab = 'diary';
  showTabs = true;

  online = true;
  install: InstallState | null = null;
  updateAvailable = false;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly router: Router,
    private readonly toast: ToastController,
    private readonly settings: SettingsService,
    private readonly diary: DiaryService,
    private readonly migration: LegacyMigrationService,
    private readonly quota: StorageQuotaService,
    private readonly network: NetworkService,
    public readonly updates: SwUpdateService,
    public readonly installer: InstallService,
  ) {
    this.online = this.network.online;
    this.install = this.installer.state;
  }

  async ngOnInit(): Promise<void> {
    this.trackViewport();
    this.trackRoutes();

    this.network.online$.pipe(takeUntil(this.destroy$)).subscribe((v) => (this.online = v));
    this.installer.state$.pipe(takeUntil(this.destroy$)).subscribe((s) => (this.install = s));
    this.updates.updateAvailable$.pipe(takeUntil(this.destroy$)).subscribe((v) => (this.updateAvailable = v));

    await this.updates.init();

    // Порядок важен: настройки нужны до миграции (миграция их пишет),
    // дневник читаем после миграции.
    await this.settings.load();
    const result = await this.migration.run();
    await this.diary.load();

    if (result.ran && result.entries + result.watchlist + result.lists > 0) {
      await this.notify('Данные перенесены из предыдущей версии');
    }

    // Закрепление хранилища просим один раз и молча: на iOS метод не
    // поддержан, и показывать «не удалось» было бы ложной тревогой.
    await this.quota.requestPersist();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  go(tab: Tab): void {
    void this.router.navigate([TAB_ROUTES[tab]]);
  }

  /**
   * Горячие клавиши (спецификация, 12.5). Срабатывают только вне полей
   * ввода и без модификаторов, иначе «n» в тексте имени фильма удалял бы фокус.
   */
  onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true);

    if (event.key === 'Escape') {
      // Закрытие оверлеев оставляет Ionic; здесь снимаем фокус, чтобы Esc
      // из поля поиска возвращал управление экрану.
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }

    if (typing || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key === '/') {
      event.preventDefault();
      void this.router.navigate(['/search'], { queryParams: { focus: '1' } });
    } else if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.quickLog();
    }
  }

  /** ⊕ — быстрая запись. Реализована через поиск с фокусом на поле ввода. */
  quickLog(): void {
    void this.router.navigate(['/search'], { queryParams: { log: '1' } });
  }

  async applyUpdate(): Promise<void> {
    this.updates.apply(this.router.url);
  }

  async installApp(): Promise<void> {
    const accepted = await this.installer.prompt();
    if (!accepted) {
      await this.notify(this.installer.instructions(this.install?.platform ?? 'desktop').join(' → '));
    }
  }

  private trackRoutes(): void {
    this.router.events
      .pipe(
        filter((e: RouterEvent): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntil(this.destroy$),
      )
      .subscribe((e) => {
        const url = e.urlAfterRedirects.split('?')[0];
        const tab = (Object.keys(TAB_ROUTES) as Tab[]).find((t) => url.startsWith(TAB_ROUTES[t]));
        this.activeTab = tab ?? 'diary';
        // Карточка, персона, настройки и профиль-редактор — вложенные экраны,
        // таббар на них мешает и дублирует back-навигацию.
        this.showTabs = !!tab && url === TAB_ROUTES[tab];
      });
  }

  /**
   * --kd-lvh из visualViewport. На iOS 100vh = высота без панели Safari,
   * из-за чего нижняя кнопка уезжает за клавиатуру (спецификация, 12.2).
   */
  private trackViewport(): void {
    const apply = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      if (h > 0) {
        document.documentElement.style.setProperty('--kd-lvh', `${Math.round(h)}px`);
      }
    };
    apply();
    window.visualViewport?.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('scroll', apply);
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({
      message,
      duration: 2800,
      position: 'bottom',
      cssClass: 'kd-toast-glass',
    });
    await t.present();
  }
}
