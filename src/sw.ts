/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
declare const KD_BUILD_ID: string;
declare const KD_PRECACHE_FILES: string[];

/**
 * Service Worker «Кинодневника» — пишется руками, не @angular/pwa.
 *
 * Причина в спецификации (11.2): ngsw не умеет ни отдельный кэш картинок с
 * LRU-вытеснением, ни проверку квоты перед записью, ни раздельные стратегии
 * для «данных пользователя» и «кэша API». Плюс прекеш из ngsw формируется
 * декларативно и потому способен включить путь, которого нет в сборке, —
 * а это валит активацию SW целиком.
 *
 * Стратегии:
 *   app shell          cache-first (имена файлов содержат хэш → они вечные)
 *   index.html         network-first, НО обязательно кладётся в кэш:
 *                      иначе офлайн-холодный старт нечем отдать
 *   api.themoviedb.org network-first с таймаутом 4 с, фолбэк в кэш
 *   image.tmdb.org     stale-while-revalidate, LRU 600, квота 60%
 */

const BUILD = typeof KD_BUILD_ID !== 'undefined' ? KD_BUILD_ID : 'dev';
const PRECACHE: string[] = typeof KD_PRECACHE_FILES !== 'undefined' ? KD_PRECACHE_FILES : [];

const SHELL = `kd-shell-${BUILD}`;
const API = `kd-api-${BUILD}`;
const IMAGES = 'kd-images-v1';

const MAX_IMAGE_ENTRIES = 600;
const QUOTA_LIMIT = 0.6;
const API_TIMEOUT_MS = 4000;

// ── install: прекеш только существующих файлов ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Добавляем по одному и считаем успех: cache.addAll падает целиком на
      // одном 404, и тогда SW не активируется никогда.
      let ok = 0;
      for (const url of PRECACHE) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            await cache.put(url, res);
            ok++;
          }
        } catch {
          /* отсутствие файла в сборке — не причина не ставить SW */
        }
      }
      console.info(`[sw] прекеш: ${ok}/${PRECACHE.length}`);
      await self.skipWaiting();
    })(),
  );
});

// ── activate: чистка старых версий кэшей ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, API, IMAGES]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

// ── fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (url.hostname === 'api.themoviedb.org') {
    event.respondWith(apiFirst(req));
    return;
  }

  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(imageSWR(req));
    return;
  }

  if (!sameOrigin) {
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(navigate(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

/**
 * Навигация: всегда пробуем сеть (там лежит index.html со свежими хэшами
 * бандлов), но кэшируем ответ, чтобы офлайн-старт был чем отдать.
 */
async function navigate(req: Request): Promise<Response> {
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res.ok) {
      const cache = await caches.open(SHELL);
      await cache.put('./index.html', res.clone());
    }
    return res;
  } catch {
    const shell = await caches.open(SHELL);
    const cached = (await shell.match('./index.html')) ?? (await shell.match(req));
    if (cached) {
      return cached;
    }
    return offlineFallback();
  }
}

async function cacheFirst(req: Request): Promise<Response> {
  const shell = await caches.open(SHELL);
  const hit = await shell.match(req);
  if (hit) {
    return hit;
  }
  try {
    const res = await fetch(req);
    if (res.ok) {
      await shell.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('Ресурс недоступен офлайн', { status: 504 });
  }
}

async function apiFirst(req: Request): Promise<Response> {
  const cache = await caches.open(API);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(req, { signal: controller.signal });
    if (res.ok) {
      await cache.put(req, res.clone());
    }
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) {
      // 203 — «восстановлено из кэша»: приложение покажет это как факт, а не как свежий ответ.
      return new Response(hit.body, { status: 203, statusText: 'Cached', headers: hit.headers });
    }
    return new Response(JSON.stringify({ offline: true }), {
      status: 504,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function imageSWR(req: Request): Promise<Response> {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req);

  const refresh = (async () => {
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') {
        if (await hasRoom()) {
          await cache.put(req, res.clone());
          await trim(cache);
        }
      }
      return res;
    } catch {
      return null;
    }
  })();

  if (hit) {
    // refresh уже запущен строкой выше (`})();`) — здесь только отбрасываем
    // промис. Вызов `refresh()` дал бы TypeError на КАЖДОМ попадании в кэш,
    // то есть картинки ломались бы именно в офлайне.
    void refresh;
    return hit;
  }

  const fresh = await refresh;
  if (fresh) {
    return fresh;
  }
  return new Response('', { status: 504 });
}

/** Квота: при заполнении сверх лимита картинки не пишем, но и не падаем. */
async function hasRoom(): Promise<boolean> {
  if (!navigator.storage?.estimate) {
    return true;
  }
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return quota === 0 || usage / quota < QUOTA_LIMIT;
  } catch {
    return true;
  }
}

/**
 * LRU. cache.keys() отдаёт записи в порядке вставки, поэтому удаление
 * первых элементов и есть вытеснение самых старых.
 */
async function trim(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  if (keys.length <= MAX_IMAGE_ENTRIES) {
    return;
  }
  const excess = keys.length - MAX_IMAGE_ENTRIES;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

function offlineFallback(): Response {
  return new Response(
    '<!doctype html><html lang="ru"><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Кинодневник</title>' +
      '<body style="background:#16191c;color:#e9ecef;font-family:system-ui;padding:24px">' +
      '<h1>Нет соединения</h1><p>Сохраните страницу на домашний экран — тогда дневник доступен офлайн.</p>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export {};
