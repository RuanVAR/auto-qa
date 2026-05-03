import { http, HttpResponse } from 'msw';

const BASE = 'http://localhost:3001';

export const handlers = [
  // Auth
  http.post(`${BASE}/api/v1/auth/register`, () =>
    HttpResponse.json({ accessToken: 'test-token', tokenType: 'Bearer' }, { status: 201 }),
  ),
  http.post(`${BASE}/api/v1/auth/login`, () =>
    HttpResponse.json({ accessToken: 'test-token', tokenType: 'Bearer' }),
  ),
  http.get(`${BASE}/api/v1/auth/me`, () =>
    HttpResponse.json({ id: 'user-1', email: 'test@example.com', name: 'Test User', role: 'ENGINEER' }),
  ),

  // Projects
  http.get(`${BASE}/api/v1/projects`, () =>
    HttpResponse.json([
      { id: 'proj-1', name: 'Demo App', slug: 'demo-app', description: 'Demo', isActive: true, _count: { testDefinitions: 3, runs: 10, environments: 2 } },
    ]),
  ),
  http.get(`${BASE}/api/v1/projects/:id`, ({ params }) =>
    HttpResponse.json({ id: params.id, name: 'Demo App', slug: 'demo-app', environments: [], _count: { testDefinitions: 3, runs: 10 } }),
  ),
  http.post(`${BASE}/api/v1/projects`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: 'new-proj', ...body, isActive: true }, { status: 201 });
  }),
  http.put(`${BASE}/api/v1/projects/:id`, async ({ params, request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: params.id, ...body });
  }),

  // Runs
  http.get(`${BASE}/api/v1/projects/:projectId/runs`, () =>
    HttpResponse.json([
      { id: 'run-1', status: 'PASSED', trigger: 'manual', createdAt: new Date().toISOString(), _count: { steps: 5, artifacts: 2 } },
      { id: 'run-2', status: 'FAILED', trigger: 'manual', createdAt: new Date().toISOString(), _count: { steps: 3, artifacts: 1 } },
    ]),
  ),
  http.get(`${BASE}/api/v1/projects/:projectId/runs/stats`, () =>
    HttpResponse.json({ total: 10, passed: 7, failed: 2, running: 1, passRate: 70 }),
  ),
  http.get(`${BASE}/api/v1/runs/:id`, ({ params }) =>
    HttpResponse.json({
      id: params.id, status: 'PASSED', trigger: 'manual',
      steps: [
        { id: 's-1', index: 0, name: 'Navigate', type: 'NAVIGATE', status: 'PASSED' },
        { id: 's-2', index: 1, name: 'Click button', type: 'CLICK', status: 'PASSED' },
      ],
      artifacts: [],
      aiSummaries: [],
      testDefinition: { id: 'test-1', name: 'Login test' },
      environment: { id: 'env-1', name: 'Staging', type: 'STAGING' },
    }),
  ),
  http.post(`${BASE}/api/v1/projects/:projectId/runs/trigger`, () =>
    HttpResponse.json({ id: 'new-run', status: 'PENDING' }, { status: 201 }),
  ),
  http.post(`${BASE}/api/v1/runs/:id/cancel`, ({ params }) =>
    HttpResponse.json({ id: params.id, status: 'CANCELLED' }),
  ),

  // AI
  http.post(`${BASE}/api/v1/ai/runs/:id/explain`, () =>
    HttpResponse.json({ explanation: 'The button selector was not found.' }),
  ),
  http.post(`${BASE}/api/v1/ai/runs/:id/summarise`, () =>
    HttpResponse.json({ summary: 'All 5 steps passed. Test is healthy.' }),
  ),
  http.post(`${BASE}/api/v1/ai/projects/:id/generate-test`, () =>
    HttpResponse.json({ name: 'Generated test', steps: [], config: {} }),
  ),

  // Health
  http.get(`${BASE}/api/v1/health`, () =>
    HttpResponse.json({ status: 'ok' }),
  ),
];
