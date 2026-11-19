/**
 * Точка входа Karma. Файл нужен, чтобы `ng test` не падал на отсутствующем
 * polyfills-импорте; реальные тесты подключаются через tsconfig.spec.json.
 */

import { getTestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting(), {
  teardown: { destroyAfterEach: true },
});
