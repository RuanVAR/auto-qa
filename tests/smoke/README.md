# Smoke Tests

Playwright-based smoke tests for the QA Automation Platform. These run after every significant change to catch regressions before they ship.

## Test Files

| File | What it covers |
|------|----------------|
| `api.smoke.spec.ts` | Core API health: register, login, create project/env/test, trigger run |
| `ui.smoke.spec.ts` | Shallow page-load checks — does each major route render without page errors |
| `ui-journeys.smoke.spec.ts` | **User journey tests** — auth, create project, module/feature hierarchy, manual test start. These are the regression safety net for component refactors. |
| `helpers.ts` | Shared helpers: `registerTestUser`, `loginAs`, `createProject`, `createEnvironment`, `createModuleWithFeature` |

## Running

```bash
# Start the stack first
pnpm docker:up
pnpm dev        # (or start api/web/worker individually)

# Run all smoke tests
pnpm test:smoke

# Run a single file
pnpm test:smoke tests/smoke/ui-journeys.smoke.spec.ts

# Run with UI / headed browser for debugging
pnpm test:smoke --headed
pnpm test:smoke --ui
```

## Environment

| Variable | Default | Notes |
|----------|---------|-------|
| `WEB_URL` | `http://localhost:3000` | Frontend base URL |
| `API_URL` | `http://localhost:3001` | API base URL |

## Test Environment Requirements

The UI journey tests require that **registration approval is disabled** in the test environment — otherwise `registerTestUser` will fail because new accounts would be stuck in `PENDING_APPROVAL`.

Ensure this row exists in the `platformConfig` table:

```sql
INSERT INTO "PlatformConfig" (key, value)
VALUES ('requireRegistrationApproval', 'false')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

Or via the Admin UI → Platform Config → toggle `requireRegistrationApproval` off.

## Adding New Journey Tests

1. Use helpers to create test data via the API — much faster than clicking through the UI.
2. Only use the UI for the actual flow you're protecting.
3. Make each test independent — register a fresh user per test so they can parallelize.
4. Prefer `getByRole`, `getByLabel`, and text-matching regexes over CSS selectors where possible — these survive design tweaks.

Example:

```ts
test('My journey', async ({ page }) => {
  const user = await registerTestUser();
  const project = await createProject(user);
  await loginAs(page, user);
  await page.goto(`${WEB}/projects/${project.id}`);
  // ... UI assertions
});
```
