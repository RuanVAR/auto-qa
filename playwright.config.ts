import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { 'x-smoke-test': '1' },
  },
  projects: [
    { name: 'chromium', use: { channel: 'chromium' } },
  ],
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
});
