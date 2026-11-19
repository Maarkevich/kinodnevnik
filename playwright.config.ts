import { defineConfig, devices } from '@playwright/test';

/**
 * Базовый URL: прод-сборка, развёрнутая на пути GitHub Pages.
 * Локально: `npx http.server` в корне с /kinodnevnik/ → dist/kinodnevnik/browser.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8790',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 5'] } }],
});
