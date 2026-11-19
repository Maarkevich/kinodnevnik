export const environment = {
  production: false,
  // Ключей нет и быть не должно: они вводятся пользователем на устройстве
  // и живут только в IndexedDB (спецификация, раздел 15).
  tmdbBaseUrl: 'https://api.themoviedb.org/3',
  tmdbImageBaseUrl: 'https://image.tmdb.org/t/p',
  tmdbRegion: 'RU',
  shikimoriBaseUrl: 'https://shikimori.one/api',
  updateCheckIntervalMs: 30 * 60 * 1000,
};
