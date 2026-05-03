import { request, Page, APIRequestContext } from '@playwright/test';

const API = process.env.API_URL ?? 'http://localhost:3001';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';

export interface TestUser {
  email: string;
  password: string;
  name: string;
  orgName: string;
  accessToken: string;
  activeOrgId: string | null;
  platformRole: string;
  orgRole: string | null;
}

/**
 * Register a fresh user + org via the API, returning a token and IDs.
 * Used by UI tests to skip the registration UX and go straight to
 * whatever flow they actually want to test.
 *
 * Relies on the `x-smoke-test` header or a seeded config that disables
 * registration approval in the test environment.
 */
export async function registerTestUser(opts?: { namePrefix?: string }): Promise<TestUser> {
  const ctx = await request.newContext({
    extraHTTPHeaders: { 'x-smoke-test': '1' },
  });

  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 7);
  const email = `${opts?.namePrefix ?? 'ui-smoke'}-${ts}-${rnd}@test.com`;
  const password = 'SmokePw123!';
  const name = `UI Smoke ${rnd}`;
  const orgName = `Smoke Org ${ts}${rnd}`;

  const res = await ctx.post(`${API}/api/v1/auth/register`, {
    data: { email, password, name, orgName },
  });

  if (!res.ok()) {
    throw new Error(
      `registerTestUser failed: ${res.status()} ${await res.text()}`,
    );
  }

  const body = (await res.json()) as {
    accessToken?: string;
    platformRole?: string;
    activeOrgId?: string | null;
    orgRole?: string | null;
    requiresApproval?: boolean;
  };

  if (body.requiresApproval) {
    throw new Error(
      'registerTestUser: backend returned requiresApproval=true. ' +
        'Smoke env must have platformConfig.requireRegistrationApproval=false.',
    );
  }

  if (!body.accessToken) {
    throw new Error('registerTestUser: no accessToken in response');
  }

  await ctx.dispose();

  return {
    email,
    password,
    name,
    orgName,
    accessToken: body.accessToken,
    activeOrgId: body.activeOrgId ?? null,
    platformRole: body.platformRole ?? 'USER',
    orgRole: body.orgRole ?? null,
  };
}

/** Seed localStorage with the token BEFORE any app JS runs, then navigate. */
export async function loginAs(page: Page, user: TestUser): Promise<void> {
  // Inject token before the app boots so ProtectedRoute sees it on first render
  await page.addInitScript((token) => {
    // Zustand persist key — matches authStore
    window.localStorage.setItem('access_token', token);
    window.localStorage.setItem(
      'qa-auth',
      JSON.stringify({
        state: {
          token,
          user: null,
          platformRole: 'USER',
          activeOrgId: null,
          orgRole: null,
        },
        version: 0,
      }),
    );
  }, user.accessToken);
  await page.goto(`${WEB}/dashboard`);
}

/** Authenticated API request context for data setup. */
export async function apiAs(user: TestUser): Promise<APIRequestContext> {
  return request.newContext({
    extraHTTPHeaders: {
      Authorization: `Bearer ${user.accessToken}`,
      'x-smoke-test': '1',
    },
  });
}

export async function createProject(
  user: TestUser,
  opts?: { name?: string; slug?: string },
): Promise<{ id: string; slug: string; name: string }> {
  const ctx = await apiAs(user);
  const slug = opts?.slug ?? `ui-proj-${Date.now()}`;
  const res = await ctx.post(`${API}/api/v1/projects`, {
    data: {
      name: opts?.name ?? 'Smoke Project',
      slug,
      description: 'Created by UI smoke test',
    },
  });
  if (!res.ok()) {
    throw new Error(`createProject failed: ${res.status()} ${await res.text()}`);
  }
  const json = (await res.json()) as { id: string; slug: string; name: string };
  await ctx.dispose();
  return json;
}

export async function createEnvironment(
  user: TestUser,
  projectId: string,
  opts?: { name?: string; baseUrl?: string },
): Promise<{ id: string }> {
  const ctx = await apiAs(user);
  const res = await ctx.post(
    `${API}/api/v1/projects/${projectId}/environments`,
    {
      data: {
        name: opts?.name ?? 'Smoke Env',
        type: 'STAGING',
        baseUrl: opts?.baseUrl ?? 'https://example.com',
      },
    },
  );
  if (!res.ok()) {
    throw new Error(`createEnvironment failed: ${res.status()} ${await res.text()}`);
  }
  const json = (await res.json()) as { id: string };
  await ctx.dispose();
  return json;
}

export async function createModuleWithFeature(
  user: TestUser,
  projectId: string,
): Promise<{ moduleId: string; featureId: string; testDefinitionId: string }> {
  const ctx = await apiAs(user);

  const modRes = await ctx.post(`${API}/api/v1/projects/${projectId}/modules`, {
    data: { name: `Smoke Module ${Date.now()}`, description: 'Smoke test module' },
  });
  const mod = (await modRes.json()) as { id: string };

  const featRes = await ctx.post(`${API}/api/v1/modules/${mod.id}/features`, {
    data: { name: `Smoke Feature ${Date.now()}`, description: 'Smoke test feature' },
  });
  const feat = (await featRes.json()) as { id: string };

  const testRes = await ctx.post(`${API}/api/v1/projects/${projectId}/tests`, {
    data: {
      name: `Smoke Test ${Date.now()}`,
      featureId: feat.id,
      tags: ['smoke'],
      type: 'MANUAL',
      steps: [
        {
          index: 0,
          name: 'Navigate home',
          type: 'NAVIGATE',
          input: { url: 'https://example.com', description: 'Go to the home page' },
        },
      ],
      config: { browser: 'chromium', headless: true, timeout: 10000, retries: 0 },
    },
  });
  const testDef = (await testRes.json()) as { id: string };

  await ctx.dispose();
  return { moduleId: mod.id, featureId: feat.id, testDefinitionId: testDef.id };
}
