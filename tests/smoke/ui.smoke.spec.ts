import { test, expect } from '@playwright/test';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';

test.describe('UI Smoke Tests', () => {
  test('1.4.11 — Dashboard page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${WEB}/dashboard`);
    // Should either show the dashboard or redirect to login
    await expect(page).toHaveURL(/dashboard|login/);
    expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
  });

  test('1.4.12 — Projects page loads', async ({ page }) => {
    await page.goto(`${WEB}/projects`);
    await expect(page).toHaveURL(/projects|login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('1.4.13 — 404 page renders for unknown route', async ({ page }) => {
    await page.goto(`${WEB}/this-route-does-not-exist`);
    await expect(page.locator('body')).toContainText(/404|not found/i);
  });
});
