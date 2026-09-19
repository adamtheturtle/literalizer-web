import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  testDir: 'tests/browser',
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
  },
  webServer: {
    command: 'python3 -m http.server 4173 --directory dist',
    reuseExistingServer: !process.env.CI,
    url: 'http://127.0.0.1:4173',
  },
});
