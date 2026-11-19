import { Injectable } from '@angular/core';

export const DB_NAME = 'kinodnevnik';
export const DB_VERSION = 1;

export const DB_STORES = [
  'entries',
  'watchlist',
  'favorites',
  'lists',
  'listItems',
  'profiles',
  'settings',
  'titles',
  'overrides',
  'tombstones',
  'tmdbCache',
  'imageQueue',
  'snapshots',
] as const;

export type StoreName = (typeof DB_STORES)[number];

export interface SchemaMigration {
  from: number;
  to: number;
  upgrade: (db: IDBDatabase, tx: IDBTransaction) => void;
}

/**
 * Единственная точка доступа к IndexedDB.
 *
 * Две ловушки, которые здесь закрыты осознанно:
 *
 * 1. Обработчики `oncomplete`/`onabort` навешиваются ДО запуска user-кода.
 *    Если навешивать после (как это часто пишут), транзакция без запросов
 *    авто-коммитится мгновенно, обработчик уже не сработает, и промис
 *    не разрешится никогда — приложение зависает на пустом месте.
 *
 * 2. Внутри `run()` нельзя ждать ничего, кроме IDB-запросов. `await` на
 *    микротаске IDB-транзакцию не убивает, а вот `await fetch(...)` или
 *    `setTimeout` — убивает: транзакция закрывается, и следующий запрос
 *    падает с TransactionInactiveError.
 */
@Injectable({ providedIn: 'root' })
export class DbService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private readonly migrations: SchemaMigration[] = [
    {
      from: 0,
      to: 1,
      upgrade: (db) => {
        if (!db.objectStoreNames.contains('entries')) {
          const s = db.createObjectStore('entries', { keyPath: 'entryId' });
          s.createIndex('byMedia', ['media_type', 'id']);
          s.createIndex('byWatchedAt', 'watchedAt');
          s.createIndex('byStatus', 'status');
          s.createIndex('byUpdated', 'updatedAt');
          // Семантический ключ дедупликации (спецификация, 8.4).
          s.createIndex('byDedupKey', 'dedupKey');
        }
        if (!db.objectStoreNames.contains('watchlist')) {
          const s = db.createObjectStore('watchlist', { keyPath: 'key' });
          s.createIndex('byAdded', 'addedAt');
          s.createIndex('byUpdated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('favorites')) {
          const s = db.createObjectStore('favorites', { keyPath: 'key' });
          s.createIndex('byOrder', 'order');
        }
        if (!db.objectStoreNames.contains('lists')) {
          const s = db.createObjectStore('lists', { keyPath: 'id' });
          s.createIndex('byUpdated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('listItems')) {
          const s = db.createObjectStore('listItems', { keyPath: ['listId', 'mediaKey'] });
          s.createIndex('byList', 'listId');
          s.createIndex('byMediaKey', 'mediaKey');
        }
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'k' });
        }
        if (!db.objectStoreNames.contains('titles')) {
          const s = db.createObjectStore('titles', { keyPath: 'mediaKey' });
          s.createIndex('byUpdated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('overrides')) {
          db.createObjectStore('overrides', { keyPath: 'mediaKey' });
        }
        if (!db.objectStoreNames.contains('tombstones')) {
          const s = db.createObjectStore('tombstones', { keyPath: 'key' });
          s.createIndex('byDeletedAt', 'deletedAt');
        }
        if (!db.objectStoreNames.contains('tmdbCache')) {
          const s = db.createObjectStore('tmdbCache', { keyPath: 'cacheKey' });
          s.createIndex('bySavedAt', 'savedAt');
        }
        if (!db.objectStoreNames.contains('imageQueue')) {
          const s = db.createObjectStore('imageQueue', { keyPath: 'url' });
          s.createIndex('byQueuedAt', 'queuedAt');
        }
        if (!db.objectStoreNames.contains('snapshots')) {
          const s = db.createObjectStore('snapshots', { keyPath: 'id' });
          s.createIndex('byCreatedAt', 'createdAt');
        }
      },
    },
  ];

  open(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB недоступен в этом браузере'));
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);
      // Причина отката, если миграции нет: IDB не умеет пробрасывать Error
      // через abort(), поэтому держим её здесь и отдаём в onerror.
      let abortReason: string | null = null;

      req.onupgradeneeded = (ev) => {
        const db = req.result;
        const tx = req.transaction;
        if (!tx) {
          return;
        }
        let v = ev.oldVersion;
        while (v < (ev.newVersion ?? DB_VERSION)) {
          const step = this.migrations.find((m) => m.from === v);
          if (!step) {
            // Явный отказ вместо тихой порчи данных (спецификация, 11.5.2г).
            abortReason = `Нет миграции схемы БД с версии ${v} — обновление невозможно`;
            tx.abort();
            return;
          }
          step.upgrade(db, tx);
          v = step.to;
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        // Firefox: SW может увести соединение из-под ног.
        db.onclose = () => {
          this.dbPromise = null;
        };
        resolve(db);
      };

      req.onerror = () => {
        this.dbPromise = null;
        reject(abortReason ? new Error(abortReason) : (req.error ?? new Error('Не удалось открыть базу')));
      };

      req.onblocked = () => {
        this.dbPromise = null;
        reject(new Error('База занята другой вкладкой — закройте её и повторите'));
      };
    });

    return this.dbPromise;
  }

  /**
   * Выполняет fn внутри одной транзакции. Возврат fn разрешается только
   * после oncomplete, поэтому запись гарантированно лежит на диске к моменту,
   * когда вызывающий код увидит результат.
   */
  async run<T>(stores: StoreName | readonly StoreName[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.open();
    const names = Array.isArray(stores) ? [...stores] : [stores as StoreName];
    const tx = db.transaction(names, mode);

    // 1. Обработчики — до user-кода.
    const settled = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Транзакция отменена'));
      tx.onerror = () => reject(tx.error ?? new Error('Ошибка транзакции'));
    });

    let value: T;
    try {
      value = await fn(tx);
    } catch (err) {
      try {
        tx.abort();
      } catch {
        /* уже завершена */
      }
      throw err;
    }

    await settled;
    return value;
  }

  wrap<R>(req: IDBRequest<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Ошибка IDB-запроса'));
    });
  }

  /** Все значения хранилища. */
  all<T>(tx: IDBTransaction, store: StoreName): Promise<T[]> {
    return this.wrap(tx.objectStore(store).getAll() as IDBRequest<T[]>);
  }

  get<T>(tx: IDBTransaction, store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return this.wrap(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
  }

  put(tx: IDBTransaction, store: StoreName, value: unknown): Promise<IDBValidKey> {
    return this.wrap(tx.objectStore(store).put(value));
  }

  del(tx: IDBTransaction, store: StoreName, key: IDBValidKey): Promise<undefined> {
    return this.wrap(tx.objectStore(store).delete(key));
  }

  clear(tx: IDBTransaction, store: StoreName): Promise<undefined> {
    return this.wrap(tx.objectStore(store).clear());
  }

  /** Только для тестов и «удалить все данные». */
  async wipeAll(): Promise<void> {
    await this.run(DB_STORES, 'readwrite', async (tx) => {
      for (const name of DB_STORES) {
        tx.objectStore(name).clear();
      }
    });
  }
}
