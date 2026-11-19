import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

/**
 * Навигация (спецификация, 6.1). Первая вкладка — Дневник, а не тренды TMDb:
 * побочный эффект правильный, главная собирается из локальных данных и
 * потому не может быть пустой при 500 от API.
 */
const routes: Routes = [
  { path: '', redirectTo: 'diary', pathMatch: 'full' },
  { path: 'diary', loadChildren: () => import('./pages/diary/diary.module').then((m) => m.DiaryPageModule) },
  {
    path: 'collections',
    loadChildren: () => import('./pages/collections/collections.module').then((m) => m.CollectionsPageModule),
  },
  { path: 'search', loadChildren: () => import('./pages/search/search.module').then((m) => m.SearchPageModule) },
  { path: 'profile', loadChildren: () => import('./pages/profile/profile.module').then((m) => m.ProfilePageModule) },
  { path: 'movie/:id', loadChildren: () => import('./pages/media/media.module').then((m) => m.MediaPageModule) },
  { path: 'tv/:id', loadChildren: () => import('./pages/media/media.module').then((m) => m.MediaPageModule) },
  {
    path: 'tv/:id/season/:seasonNumber',
    loadChildren: () => import('./pages/season/season.module').then((m) => m.SeasonPageModule),
  },
  {
    path: 'person/:id',
    loadChildren: () => import('./pages/person/person.module').then((m) => m.PersonPageModule),
  },
  { path: 'list/:id', loadChildren: () => import('./pages/list/list.module').then((m) => m.ListPageModule) },
  {
    path: 'settings',
    loadChildren: () => import('./pages/settings/settings.module').then((m) => m.SettingsPageModule),
  },
  {
    path: 'edit-profile',
    loadChildren: () => import('./pages/edit-profile/edit-profile.module').then((m) => m.EditProfilePageModule),
  },
  // GitHub Pages не умеет server-side rewrite: deep link отдаёт 404.html,
  // который и есть копия index.html (спецификация, 17.2). Поэтому неизвестный
  // путь ведём на дневник, а не в тупик.
  { path: '**', redirectTo: 'diary' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules, scrollPositionRestoration: 'top' })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
