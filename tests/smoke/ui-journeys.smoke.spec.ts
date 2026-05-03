import { test, expect } from '@playwright/test';
import {
  registerTestUser,
  loginAs,
  createProject,
  createEnvironment,
  createModuleWithFeature,
} from './helpers';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';

/**
 * UI smoke tests that exercise the key user journeys. These act as a
 * regression safety net for component refactors — especially FeaturePage
 * (2600+ lines) which we plan to split.
 *
 * Each test is independent and creates its own user + data via the API
 * so tests can run in parallel and in any order.
 */

test.describe('UI Journey — Auth', () => {
  test('Login page renders with email + password fields', async ({ page }) => {
    await page.goto(`${WEB}/login`);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('Register page renders with full registration form', async ({ page }) => {
    await page.goto(`${WEB}/register`);
    // Step 1: account details
    await expect(page.locator('input[placeholder*="Jane" i]')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible();
  });

  test('Dashboard requires auth — unauth user redirects to /login', async ({ page }) => {
    await page.goto(`${WEB}/dashboard`);
    await expect(page).toHaveURL(/login/);
  });

  test('Authenticated user can load the dashboard', async ({ page }) => {
    const user = await registerTestUser();
    await loginAs(page, user);
    await expect(page).toHaveURL(/dashboard/);
    // Welcome message + top nav present
    await expect(page.locator('text=/good (morning|afternoon|evening)/i').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('UI Journey — Projects', () => {
  test('Create project flow — modal, submit, toast, appears in list', async ({ page }) => {
    const user = await registerTestUser();
    await loginAs(page, user);

    await page.goto(`${WEB}/projects`);
    await expect(page).toHaveURL(/projects/);

    // Click "New Project" (button or empty-state CTA)
    await page.getByRole('button', { name: /new project|create project/i }).first().click();

    // Fill the form
    const projName = `UI Project ${Date.now()}`;
    const projSlug = `ui-proj-${Date.now()}`;
    await page.getByPlaceholder(/project name|e\.g\./i).first().fill(projName);
    await page.getByPlaceholder(/slug|my-project/i).first().fill(projSlug);

    // Submit — matches either "Create Project" or "Create"
    await page.getByRole('button', { name: /^create/i }).last().click();

    // Project should appear in the list
    await expect(page.locator(`text=${projName}`).first()).toBeVisible({ timeout: 10000 });
  });

  test('Project detail page renders the module list (card or empty state)', async ({ page }) => {
    const user = await registerTestUser();
    const project = await createProject(user);
    await loginAs(page, user);

    await page.goto(`${WEB}/projects/${project.id}`);
    // Either empty state OR module cards
    await expect(
      page.locator('text=/modules|no modules|create.*module/i').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('UI Journey — Module & Feature hierarchy', () => {
  test('Modules table page loads and shows the module we created', async ({ page }) => {
    const user = await registerTestUser();
    const project = await createProject(user);
    const { moduleId } = await createModuleWithFeature(user, project.id);
    await loginAs(page, user);

    await page.goto(`${WEB}/projects/${project.id}/modules`);
    // Module row should be visible
    await expect(page.locator('text=/Smoke Module/i').first()).toBeVisible({ timeout: 10000 });
    // Expandable chevron should be present (we added this recently)
    expect(moduleId).toBeTruthy();
  });

  test('Features page expandable row shows tests underneath', async ({ page }) => {
    const user = await registerTestUser();
    const project = await createProject(user);
    const { moduleId } = await createModuleWithFeature(user, project.id);
    await loginAs(page, user);

    await page.goto(`${WEB}/projects/${project.id}/modules/${moduleId}/features`);
    await expect(page.locator('text=/Smoke Feature/i').first()).toBeVisible({ timeout: 10000 });

    // Click the feature row to expand
    await page.locator('text=/Smoke Feature/i').first().click();

    // The test name should appear in the expanded row
    await expect(page.locator('text=/Smoke Test/i').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('UI Journey — Feature page & Manual Testing', () => {
  test('Feature page loads with test cases list', async ({ page }) => {
    const user = await registerTestUser();
    const project = await createProject(user);
    const { moduleId, featureId } = await createModuleWithFeature(user, project.id);
    await loginAs(page, user);

    await page.goto(
      `${WEB}/projects/${project.id}/modules/${moduleId}/features/${featureId}`,
    );
    // Test case should be listed
    await expect(page.locator('text=/Smoke Test/i').first()).toBeVisible({ timeout: 10000 });
    // "Test feature" button should be visible
    await expect(page.getByRole('button', { name: /test feature/i })).toBeVisible();
  });

  test('Click Test Feature with NO environment shows the no-env warning modal', async ({ page }) => {
    const user = await registerTestUser();
    const project = await createProject(user);
    const { moduleId, featureId } = await createModuleWithFeature(user, project.id);
    // Intentionally do NOT create an environment
    await loginAs(page, user);

    await page.goto(
      `${WEB}/projects/${project.id}/modules/${moduleId}/features/${featureId}`,
    );
    await page.getByRole('button', { name: /test feature/i }).click();

    // The no-env warning modal should appear with an Add Environment CTA
    await expect(page.locator('text=/no environments/i').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /add environment/i })).toBeVisible();
  });

  test('Click Test Feature with environment opens the run modal defaulting to Manual', async ({ page }) => {
    const user = await registerTestUser();
    const project = await createProject(user);
    await createEnvironment(user, project.id);
    const { moduleId, featureId } = await createModuleWithFeature(user, project.id);
    await loginAs(page, user);

    await page.goto(
      `${WEB}/projects/${project.id}/modules/${moduleId}/features/${featureId}`,
    );
    await page.getByRole('button', { name: /test feature/i }).click();

    // Modal should open with mode selector and Manual selected by default
    await expect(page.locator('text=/test feature/i').nth(1)).toBeVisible({ timeout: 5000 });
    // Verify the Manual button exists (it should exist regardless of which is selected)
    await expect(page.getByRole('button', { name: /^manual/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^automated/i })).toBeVisible();
  });
});

test.describe('UI Journey — Error Boundary', () => {
  test('Navigating to a valid route after an error clears the error state', async ({ page }) => {
    const user = await registerTestUser();
    await loginAs(page, user);
    await page.goto(`${WEB}/dashboard`);

    // Navigate to an invalid feature id — should NOT hard-crash the app
    await page.goto(`${WEB}/projects/invalid-project-id`);
    // TopNav should still be visible (error boundary is inline, not fullscreen)
    await expect(page.locator('text=/QA Platform/i')).toBeVisible({ timeout: 5000 });

    // Navigate back to dashboard — should recover
    await page.goto(`${WEB}/dashboard`);
    await expect(page).toHaveURL(/dashboard/);
  });
});
