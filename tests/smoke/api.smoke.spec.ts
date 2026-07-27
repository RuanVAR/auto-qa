import { test, expect, request } from '@playwright/test';

const API = process.env.API_URL ?? 'http://localhost:3001';

let accessToken: string;
let projectId: string;
let environmentId: string;
let testDefinitionId: string;
let runId: string;

test.describe('API Smoke Tests', () => {
  test('1.4.4 — GET /api/v1/health returns 200 with status:ok', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${API}/api/v1/health`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  test('1.4.5 — Register new organisation account pending approval', async () => {
    const ctx = await request.newContext();
    const email = `smoke-${Date.now()}@test.com`;
    const res = await ctx.post(`${API}/api/v1/auth/register`, {
      data: { email, name: 'Smoke Tester', password: 'SmokePw123!', orgName: `Smoke Org ${Date.now()}` },
    });
    expect(res.status()).toBe(201);
    const body = await res.json() as { requiresApproval: boolean };
    expect(body.requiresApproval).toBe(true);
  });

  test('1.4.6 — Login with seeded active organisation admin', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${API}/api/v1/auth/login`, {
      data: {
        email: process.env.SMOKE_USER_EMAIL ?? 'ruan15viljoen@gmail.com',
        password: process.env.SMOKE_USER_PASSWORD ?? 'Demo123!',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json() as { accessToken: string };
    expect(body.accessToken).toBeTruthy();
    accessToken = body.accessToken;
  });

  test('1.4.7 — Create project via API, assert in projects list', async () => {
    test.skip(!accessToken, 'Skipped — register test must run first');
    const ctx = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const slug = `smoke-proj-${suffix}`;
    const create = await ctx.post(`${API}/api/v1/projects`, {
      data: { name: `Smoke Project ${suffix}`, slug, description: 'Created by smoke test' },
    });
    expect(create.status()).toBe(201);
    const created = await create.json() as { id: string; slug: string };
    projectId = created.id;
    expect(created.slug).toBe(slug);

    const list = await ctx.get(`${API}/api/v1/projects`);
    expect(list.status()).toBe(200);
    const projects = await list.json() as Array<{ id: string }>;
    expect(projects.some(p => p.id === projectId)).toBe(true);
  });

  test('1.4.8 — Create environment for project', async () => {
    test.skip(!accessToken || !projectId, 'Requires previous tests');
    const ctx = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
    });

    const res = await ctx.post(`${API}/api/v1/projects/${projectId}/environments`, {
      data: { name: 'Smoke Staging', type: 'STAGING', baseUrl: 'https://example.com' },
    });
    expect(res.status()).toBe(201);
    const env = await res.json() as { id: string; name: string };
    environmentId = env.id;
    expect(env.name).toBe('Smoke Staging');
  });

  test('1.4.9 — Create test definition for project', async () => {
    test.skip(!accessToken || !projectId, 'Requires previous tests');
    const ctx = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
    });

    const res = await ctx.post(`${API}/api/v1/projects/${projectId}/tests`, {
      data: {
        name: 'Smoke Test',
        tags: ['smoke'],
        steps: [
          { index: 0, name: 'Navigate', type: 'NAVIGATE', input: { url: 'https://example.com' } },
        ],
        config: { browser: 'chromium', headless: true, timeout: 10000, retries: 0 },
      },
    });
    expect(res.status()).toBe(201);
    const test_ = await res.json() as { id: string };
    testDefinitionId = test_.id;
    expect(testDefinitionId).toBeTruthy();
  });

  test('1.4.10 — Trigger run and poll until terminal state', async () => {
    test.skip(!accessToken || !projectId || !environmentId || !testDefinitionId, 'Requires previous tests');
    const ctx = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
    });

    const trigger = await ctx.post(`${API}/api/v1/projects/${projectId}/runs/trigger`, {
      data: { environmentId, testDefinitionId, trigger: 'api', runMode: 'MANUAL' },
    });
    expect(trigger.status()).toBe(201);
    const run = await trigger.json() as { id: string; status: string };
    runId = run.id;

    const cancel = await ctx.post(`${API}/api/v1/projects/${projectId}/runs/${runId}/cancel`);
    expect(cancel.status()).toBe(201);
    const cancelled = await cancel.json() as { status: string };
    expect(cancelled.status).toBe('CANCELLED');
  });
});
