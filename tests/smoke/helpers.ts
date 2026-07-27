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
 * Authenticate the seeded active organisation admin for UI setup. Public
 * registration deliberately requires platform approval, so UI journeys that
 * are unrelated to approval must not depend on a newly registered account.
 */
export async function registerTestUser(opts?: { namePrefix?: string }): Promise<TestUser> {
  const ctx = await request.newContext({
    extraHTTPHeaders: { 'x-smoke-test': '1' },
  });

  const email = process.env.SMOKE_USER_EMAIL ?? 'ruan15viljoen@gmail.com';
  const password = process.env.SMOKE_USER_PASSWORD ?? 'Demo123!';
  const name = opts?.namePrefix ?? 'Seeded Smoke Admin';
  const orgName = 'Demo Organisation';

  const res = await ctx.post(`${API}/api/v1/auth/login`, {
    data: { email, password },
  });

  if (!res.ok()) {
    throw new Error(
      `registerTestUser login failed: ${res.status()} ${await res.text()}`,
    );
  }

  const body = (await res.json()) as {
    accessToken?: string;
    platformRole?: string;
    activeOrgId?: string | null;
    orgRole?: string | null;
  };

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
  await page.addInitScript((auth) => {
    // Zustand persist key — matches authStore
    window.localStorage.setItem('access_token', auth.token);
    window.localStorage.setItem(
      'qa-auth',
      JSON.stringify({
        state: {
          token: auth.token,
          user: null,
          platformRole: auth.platformRole,
          activeOrgId: auth.activeOrgId,
          orgRole: auth.orgRole,
        },
        version: 0,
      }),
    );
  }, {
    token: user.accessToken,
    platformRole: user.platformRole,
    activeOrgId: user.activeOrgId,
    orgRole: user.orgRole,
  });
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
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const slug = opts?.slug ?? `ui-proj-${suffix}`;
  const res = await ctx.post(`${API}/api/v1/projects`, {
    data: {
      name: opts?.name ?? `Smoke Project ${suffix}`,
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

  // Module creation is intentionally gated on at least one environment.
  // Every hierarchy fixture therefore creates a disposable environment first.
  await ctx.post(`${API}/api/v1/projects/${projectId}/environments`, {
    data: { name: `Fixture Env ${Date.now()}`, type: 'STAGING', baseUrl: 'https://example.com' },
  });

  const modRes = await ctx.post(`${API}/api/v1/projects/${projectId}/modules`, {
    data: { name: `Smoke Module ${Date.now()}`, description: 'Smoke test module' },
  });
  if (!modRes.ok()) throw new Error(`create module failed: ${modRes.status()} ${await modRes.text()}`);
  const mod = (await modRes.json()) as { id: string };

  const featRes = await ctx.post(`${API}/api/v1/modules/${mod.id}/features`, {
    data: { name: `Smoke Feature ${Date.now()}`, description: 'Smoke test feature' },
  });
  if (!featRes.ok()) throw new Error(`create feature failed: ${featRes.status()} ${await featRes.text()}`);
  const feat = (await featRes.json()) as { id: string };

  const testRes = await ctx.post(`${API}/api/v1/projects/${projectId}/tests`, {
    data: {
      name: `Smoke Test ${Date.now()}`,
      featureId: feat.id,
      tags: ['smoke'],
      type: 'UI',
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
  if (!testRes.ok()) throw new Error(`create test failed: ${testRes.status()} ${await testRes.text()}`);
  const testDef = (await testRes.json()) as { id: string };

  await ctx.dispose();
  return { moduleId: mod.id, featureId: feat.id, testDefinitionId: testDef.id };
}
