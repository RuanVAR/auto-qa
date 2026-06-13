import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';

export const API_BASE = (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? 'http://localhost:3001';

export const api = axios.create({ baseURL: API_BASE, headers: { 'Content-Type': 'application/json' } });
api.interceptors.request.use((c) => { const t = localStorage.getItem('access_token'); if (t) c.headers.Authorization = `Bearer ${t}`; return c; });

// ─── Response interceptor — refresh-token aware ──────────────────────────────
//
// Access tokens are 15 min. When one expires the API returns 401; we transparently:
//   1. POST /auth/refresh with the stored refresh token → get a new pair
//   2. Replay the original request with the new access token
//   3. Retry only ONCE per request (`_retried` flag) so a hard 401 still
//      surfaces to the caller instead of looping forever.
//
// Concurrency: if N requests fire and all 401 simultaneously, we don't want
// N parallel refresh calls (each consumes the refresh token, only the first
// would succeed; the rest would 403 and trigger replay-protection that kills
// every session). A single shared promise gates them: requests #2..N await
// the same refresh round-trip and replay against its result.
//
// On hard failure (no refresh token, refresh itself returns 401/403, etc.)
// we clear local state + redirect to /login.

let _refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return null;
  // Use a bare axios call so we don't re-enter our own interceptor.
  const r = await axios.post(`${API_BASE}/api/v1/auth/refresh`, { refreshToken });
  const data = r.data as { accessToken: string; refreshToken: string };
  localStorage.setItem('access_token', data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  return data.accessToken;
}

export function clearLocalAuthAndRedirect() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  // Also drop the Zustand persist blob ('qa-auth') — it holds its own copy
  // of `token`. Without this, the hard redirect below reloads the app, the
  // store rehydrates from 'qa-auth' with the stale token, and ProtectedRoute
  // happily renders the app again on a dead session → "UI does nothing".
  localStorage.removeItem('qa-auth');
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

/**
 * Returns a non-expired access token, refreshing if needed. Use this BEFORE
 * any non-HTTP auth path (WebSocket handshakes, EventSource auth params, …)
 * where the axios refresh interceptor doesn't run.
 *
 * Decodes the JWT's `exp` claim client-side (just for the timestamp — we
 * don't verify the signature here; the server does). If the token expires
 * within the next 30 seconds OR is missing/malformed, triggers a refresh.
 *
 * Returns `null` if there's no usable token AND refresh failed — caller
 * should treat as logged-out and bounce to /login. Also clears local state
 * and redirects automatically on hard failure so the caller can just early-
 * return.
 */
export async function getFreshToken(skewSeconds = 30): Promise<string | null> {
  const current = localStorage.getItem('access_token');
  let needsRefresh = !current;
  if (current) {
    try {
      const [, payloadB64] = current.split('.');
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
      if (typeof payload.exp !== 'number' || payload.exp * 1000 - Date.now() < skewSeconds * 1000) {
        needsRefresh = true;
      }
    } catch {
      needsRefresh = true;
    }
  }
  if (!needsRefresh) return current;
  try {
    _refreshing = _refreshing ?? refreshAccessToken().finally(() => { _refreshing = null; });
    const next = await _refreshing;
    if (!next) {
      clearLocalAuthAndRedirect();
      return null;
    }
    return next;
  } catch {
    clearLocalAuthAndRedirect();
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const status = error?.response?.status;
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    // Don't try to refresh on the refresh endpoint itself (otherwise
    // a bad refresh token loops forever). Bail out + redirect.
    const isRefreshCall = original?.url?.includes('/auth/refresh');

    if (status !== 401 || !original || original._retried || isRefreshCall) {
      // 401 with retry already attempted, or non-401 — give up + redirect on
      // hard auth failures.
      if (status === 401 && (original?._retried || isRefreshCall)) {
        clearLocalAuthAndRedirect();
      }
      return Promise.reject(error);
    }

    original._retried = true;

    try {
      // Single in-flight refresh shared across concurrent 401s.
      _refreshing = _refreshing ?? refreshAccessToken().finally(() => { _refreshing = null; });
      const newToken = await _refreshing;
      if (!newToken) {
        clearLocalAuthAndRedirect();
        return Promise.reject(error);
      }
      // Retry the original request with the new token. Axios mutates
      // `original.headers` between retries, so we set both the lowercased
      // and capital forms to be safe.
      original.headers = original.headers ?? {};
      (original.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
      return api.request(original as AxiosRequestConfig);
    } catch (refreshErr) {
      clearLocalAuthAndRedirect();
      return Promise.reject(refreshErr);
    }
  },
);

export const projectsApi = {
  list: (opts?: { includeArchived?: boolean }) =>
    api.get('/api/v1/projects', {
      params: opts?.includeArchived ? { includeArchived: '1' } : undefined,
    }).then(r => r.data),
  get: (id: string) => api.get(`/api/v1/projects/${id}`).then(r => r.data),
  create: (data: object) => api.post('/api/v1/projects', data).then(r => r.data),
  update: (id: string, data: object) => api.put(`/api/v1/projects/${id}`, data).then(r => r.data),
  archive: (id: string) => api.delete(`/api/v1/projects/${id}`).then(r => r.data),
  restore: (id: string) => api.post(`/api/v1/projects/${id}/restore`).then(r => r.data),
  // Per-env stats rollup for side-by-side reports
  statsByEnv: (id: string, since?: string) =>
    api.get(`/api/v1/projects/${id}/stats/by-env`, { params: since ? { since } : undefined }).then(r => r.data),
  // Member access management
  listMembers: (id: string) => api.get(`/api/v1/projects/${id}/members`).then(r => r.data),
  addMember: (id: string, data: { userId: string; role: string; allowedEnvironmentIds?: string[] }) =>
    api.post(`/api/v1/projects/${id}/members`, data).then(r => r.data),
  updateMember: (id: string, userId: string, data: { role?: string; allowedEnvironmentIds?: string[] }) =>
    api.patch(`/api/v1/projects/${id}/members/${userId}`, data).then(r => r.data),
  removeMember: (id: string, userId: string) =>
    api.delete(`/api/v1/projects/${id}/members/${userId}`).then(r => r.data),
};
export const environmentsApi = {
  list: (projectId: string, opts?: { includeArchived?: boolean }) =>
    api.get(`/api/v1/projects/${projectId}/environments`, {
      params: opts?.includeArchived ? { includeArchived: 'true' } : undefined,
    }).then(r => r.data),
  create: (projectId: string, data: object) => api.post(`/api/v1/projects/${projectId}/environments`, data).then(r => r.data),
  update: (projectId: string, id: string, data: object) => api.put(`/api/v1/projects/${projectId}/environments/${id}`, data).then(r => r.data),
  archive: (projectId: string, id: string) => api.delete(`/api/v1/projects/${projectId}/environments/${id}`).then(r => r.data),
  restore: (projectId: string, id: string) => api.post(`/api/v1/projects/${projectId}/environments/${id}/restore`).then(r => r.data),
  getPreference: (projectId: string): Promise<{ environmentId: string | null }> =>
    api.get(`/api/v1/projects/${projectId}/environments/my-preference`).then(r => r.data),
  setPreference: (projectId: string, environmentId: string): Promise<{ environmentId: string }> =>
    api.put(`/api/v1/projects/${projectId}/environments/my-preference`, { environmentId }).then(r => r.data),
};
export const signoffApi = {
  overview: (projectId: string, includeArchived = false) =>
    api.get(`/api/v1/projects/${projectId}/signoff/overview`, { params: includeArchived ? { includeArchived: true } : {} }).then(r => r.data),
  getConfig: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/signoff/config`).then(r => r.data),
  setConfig: (projectId: string, approvers: { environmentId: string | null; userId: string }[]) =>
    api.put(`/api/v1/projects/${projectId}/signoff/config`, { approvers }).then(r => r.data),
  history: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/signoff/history`).then(r => r.data),
  cell: (featureId: string, envId: string) =>
    api.get(`/api/v1/features/${featureId}/environments/${envId}/signoff`).then(r => r.data),
  submit: (featureId: string, envId: string, body: { decision: 'APPROVED' | 'REJECTED'; typedName: string; drawnSignature?: string; note?: string }) =>
    api.post(`/api/v1/features/${featureId}/environments/${envId}/signoff`, body).then(r => r.data),
  resend: (featureId: string, envId: string) =>
    api.post(`/api/v1/features/${featureId}/environments/${envId}/signoff/resend`).then(r => r.data),
  signOffModule: (moduleId: string, envId: string, body: { typedName: string; drawnSignature?: string; note?: string }) =>
    api.post(`/api/v1/modules/${moduleId}/environments/${envId}/signoff`, body).then(r => r.data),
  certificateUrl: (scope: 'feature' | 'module', id: string, envId: string) =>
    `/api/v1/signoff/certificate?scope=${scope}&id=${id}&envId=${envId}`,
  certificatePdfUrl: (scope: 'feature' | 'module', id: string, envId: string) =>
    `/api/v1/signoff/certificate.pdf?scope=${scope}&id=${id}&envId=${envId}`,
  emailCertificate: (featureId: string, envId: string, recipients?: string[]) =>
    api.post(`/api/v1/features/${featureId}/environments/${envId}/signoff/certificate/email`, { recipients }).then(r => r.data),
};
export const testsApi = {
  list: (projectId: string, featureId?: string) =>
    api.get(`/api/v1/projects/${projectId}/tests`, { params: featureId ? { featureId } : undefined }).then(r => r.data),
  get: (projectId: string, id: string) => api.get(`/api/v1/projects/${projectId}/tests/${id}`).then(r => r.data),
  create: (projectId: string, data: object) => api.post(`/api/v1/projects/${projectId}/tests`, data).then(r => r.data),
  update: (projectId: string, id: string, data: object) => api.put(`/api/v1/projects/${projectId}/tests/${id}`, data).then(r => r.data),
  duplicate: (id: string) => api.post(`/api/v1/tests/${id}/duplicate`).then(r => r.data),
  archive: (projectId: string, id: string) =>
    api.delete(`/api/v1/projects/${projectId}/tests/${id}`).then(r => r.data),
  restore: (projectId: string, id: string) =>
    api.post(`/api/v1/projects/${projectId}/tests/${id}/restore`).then(r => r.data),
  bulkArchive: (projectId: string, ids: string[]) =>
    api.post(`/api/v1/projects/${projectId}/tests/bulk-archive`, { ids }).then(r => r.data as { archived: number }),
  bulkMove: (projectId: string, testIds: string[], targetFeatureId: string) =>
    api.post(`/api/v1/projects/${projectId}/tests/bulk-move`, { testIds, targetFeatureId }).then(r => r.data as { moved: number }),
  appendSteps: (_projectId: string, id: string, body: {
    steps: Array<Record<string, unknown>>;
    meta?: { recordedAt?: string; recordedDurationSec?: number };
  }) => api.post(`/api/v1/tests/${id}/append-steps`, body).then(r => r.data),
  /**
   * Quick-mark a test as PASSED/FAILED without entering test mode.
   * Creates a lightweight TestRun (no RunSteps) and attaches to the current
   * QA work session.
   */
  mark: (
    testDefinitionId: string,
    data: {
      status: 'PASSED' | 'FAILED';
      notes?: string;
      environmentId?: string;
      failureCategory?: string;
      failureNote?: string;
    },
  ) =>
    api.post(`/api/v1/tests/${testDefinitionId}/mark`, data).then(r => r.data),
  /**
   * Returns the latest TestRun result per testDefinitionId for a feature.
   * Covers quick-mark, manual, and automated runs — not just FeatureRun data.
   */
  getLatestStatuses: (featureId: string, envId?: string | null) =>
    api.get(`/api/v1/features/${featureId}/test-statuses`, {
      params: envId ? { envId } : undefined,
    }).then(r => r.data as Array<{
      testDefinitionId: string;
      status: string;
      completedAt: string;
      environmentId: string | null;
      failureCategory: string | null;
      failureNote: string | null;
      failureScreenshotUrls?: string[];
      failureRecordingUrl?: string | null;
    }>),
  /**
   * In-flight TestRuns per test in a feature. Pairs with getLatestStatuses
   * — the FeaturesPage prefers an active run's "RUNNING" badge over the
   * historical pass/fail.
   */
  getActiveRuns: (featureId: string, envId?: string | null) =>
    api.get(`/api/v1/features/${featureId}/active-runs`, {
      params: envId ? { envId } : undefined,
    }).then(r => r.data as Array<{
      id: string;
      testDefinitionId: string;
      status: 'PENDING' | 'QUEUED' | 'RUNNING';
      startedAt: string | null;
      createdAt: string;
      runMode: 'AUTOMATED' | 'MANUAL';
      environmentId: string | null;
    }>),
  /** Project-wide test stats + distinct tags — header of the all-tests page. */
  summary: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/tests/summary`).then(r => r.data as {
      modules: number; features: number; tests: number;
      passed: number; failed: number; openBugs: number; tags: string[];
    }),
  /** Paginated / filterable test browser for the whole project. */
  browse: (projectId: string, params: {
    page?: number; limit?: number; search?: string;
    moduleId?: string; featureId?: string; tags?: string; epics?: string;
    assignedToId?: string; hasBugs?: string;
    status?: 'PASSED' | 'FAILED' | 'OUTSTANDING';
    sort?: 'updated_desc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc';
  }) =>
    api.get(`/api/v1/projects/${projectId}/tests/browse`, { params }).then(r => r.data as {
      items: Array<{
        id: string; name: string; type: string; tags: string[];
        stepCount: number; updatedAt: string;
        featureId: string | null; featureName: string | null;
        moduleId: string | null; moduleName: string | null;
        bugCount: number;
        latestStatus: string | null;
        latestCompletedAt: string | null;
        activeRun: {
          id: string;
          status: 'PENDING' | 'QUEUED' | 'RUNNING';
          startedAt: string | null;
          createdAt: string;
          runMode: 'AUTOMATED' | 'MANUAL';
        } | null;
      }>;
      total: number; page: number; limit: number; pages: number;
    }),
};
export const runsApi = {
  list: (projectId: string) => api.get(`/api/v1/projects/${projectId}/runs`).then(r => r.data),
  get: (id: string) => api.get(`/api/v1/runs/${id}`).then(r => r.data),
  stats: (projectId: string, params?: { testId?: string; featureId?: string }) =>
    api.get(`/api/v1/projects/${projectId}/runs/stats`, { params }).then(r => r.data),
  trend: (projectId: string) => api.get(`/api/v1/projects/${projectId}/runs/trend`).then(r => r.data),
  flaky: (projectId: string) => api.get(`/api/v1/projects/${projectId}/runs/flaky`).then(r => r.data),
  breakdown: (projectId: string) => api.get(`/api/v1/projects/${projectId}/runs/breakdown`).then(r => r.data),
  trigger: (projectId: string, data: object) => api.post(`/api/v1/projects/${projectId}/runs/trigger`, data).then(r => r.data),
  cancel: (id: string) => api.post(`/api/v1/runs/${id}/cancel`).then(r => r.data),
  skipStep: (runId: string, stepId: string) =>
    api.post(`/api/v1/runs/${runId}/steps/${stepId}/skip`).then(r => r.data),
  retryStep: (runId: string, stepId: string) =>
    api.post(`/api/v1/runs/${runId}/steps/${stepId}/retry`).then(r => r.data),
  patchStep: (runId: string, stepId: string, data: { notes?: string; jiraIssueKey?: string }) =>
    api.patch(`/api/v1/runs/${runId}/steps/${stepId}`, data).then(r => r.data),
  markStepStatus: (runId: string, stepId: string, data: { status: 'PASSED' | 'FAILED'; notes?: string; evidenceUrls?: string[] }) =>
    api.patch(`/api/v1/runs/${runId}/steps/${stepId}/status`, data).then(r => r.data),
  completeRun: (runId: string) =>
    api.post(`/api/v1/runs/${runId}/complete`).then(r => r.data),
  getSteps: (runId: string) =>
    api.get(`/api/v1/runs/${runId}/steps`).then(r => r.data),
  // Description-driven manual mode: mark the whole TestRun, not individual steps.
  markTestRunStatus: (
    runId: string,
    data: {
      status: 'PASSED' | 'FAILED' | 'SKIPPED';
      notes?: string;
      failureCategory?: string;
      failureNote?: string;
      failureScreenshotUrls?: string[];
      failureRecordingUrl?: string;
      /** Named manual Test Run (TestRunSession) this mark belongs to, if any. */
      testRunSessionId?: string;
    },
  ) =>
    api.patch(`/api/v1/runs/${runId}/status`, data).then(r => r.data),
};

/**
 * Named manual Test Runs (TestRunSession) — a deliberate QA sitting spanning one
 * or more features, with a name, start/end, results across features, bugs, and
 * a run-scoped report. Distinct from the per-test `runs` (executions) above.
 */
export const testRunSessionsApi = {
  create: (projectId: string, data: { name: string; startedFromFeatureId?: string; environmentId?: string }) =>
    api.post(`/api/v1/projects/${projectId}/test-run-sessions`, data).then(r => r.data),
  list: (
    projectId: string,
    params?: { status?: string; moduleId?: string; featureId?: string; testId?: string; tag?: string; mine?: boolean; page?: number; limit?: number },
  ) =>
    api.get(`/api/v1/projects/${projectId}/test-run-sessions`, { params }).then(r => r.data),
  get: (id: string) => api.get(`/api/v1/test-run-sessions/${id}`).then(r => r.data),
  finish: (id: string) => api.post(`/api/v1/test-run-sessions/${id}/finish`).then(r => r.data),
  abandon: (id: string) => api.post(`/api/v1/test-run-sessions/${id}/abandon`).then(r => r.data),
  heartbeat: (id: string) => api.post(`/api/v1/test-run-sessions/${id}/heartbeat`).then(r => r.data),
  report: (id: string, data?: { recipientEmails?: string[]; additionalText?: string }) =>
    api.post(`/api/v1/test-run-sessions/${id}/report`, data ?? {}).then(r => r.data),
};
export const runsApiFiltered = {
  list: (projectId: string, params?: { status?: string; mode?: string; testId?: string; featureId?: string; envId?: string; page?: number; limit?: number }) =>
    api.get(`/api/v1/projects/${projectId}/runs`, { params }).then(r => r.data),
};
export const artifactsApi = { list: (runId: string) => api.get(`/api/v1/runs/${runId}/artifacts`).then(r => r.data) };

/**
 * Worker / BullMQ queue status — feeds the live capacity chip in the topbar
 * so testers can see "● 2/3 running · 4 queued" before triggering a run.
 */
export const workerApi = {
  status: () =>
    api.get(`/api/v1/worker/status`).then(r => r.data as {
      active: number;
      waiting: number;
      completed: number;
      failed: number;
      concurrency: number;
    }),
};
export const modulesApi = {
  list: (projectId: string) => api.get(`/api/v1/projects/${projectId}/modules`).then(r => r.data),
  listFeatures: (moduleId: string) => api.get(`/api/v1/modules/${moduleId}/features`).then(r => r.data),
  create: (projectId: string, data: object) => api.post(`/api/v1/projects/${projectId}/modules`, data).then(r => r.data),
  update: (projectId: string, id: string, data: object) => api.put(`/api/v1/projects/${projectId}/modules/${id}`, data).then(r => r.data),
  remove: (projectId: string, id: string) => api.delete(`/api/v1/projects/${projectId}/modules/${id}`).then(r => r.data),
  bulkArchive: (projectId: string, ids: string[]) =>
    api.post(`/api/v1/projects/${projectId}/modules/bulk-archive`, { ids }).then(r => r.data as { archived: number }),
  tags: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/modules/tags`).then(r => (r.data as { tags: string[] }).tags),
  browse: (projectId: string, params: {
    page?: number; limit?: number; search?: string; tags?: string;
    sort?: 'order_asc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc' | 'updated_desc';
  }) =>
    api.get(`/api/v1/projects/${projectId}/modules/browse`, { params }).then(r => r.data as {
      items: Array<{ id: string; name: string; description: string | null; order: number; tags: string[]; _count: { features: number } }>;
      total: number; page: number; limit: number; pageCount: number;
    }),
};
export const featuresApi = {
  list: (moduleId: string) => api.get(`/api/v1/modules/${moduleId}/features`).then(r => r.data),
  get: (id: string) => api.get(`/api/v1/features/${id}`).then(r => r.data),
  reorder: (moduleId: string, orderedIds: string[]) =>
    api.post(`/api/v1/modules/${moduleId}/features/reorder`, { orderedIds }).then(r => r.data as { reordered: number }),
  create: (moduleId: string, data: object) => api.post(`/api/v1/modules/${moduleId}/features`, data).then(r => r.data),
  update: (id: string, data: object) => api.put(`/api/v1/features/${id}`, data).then(r => r.data),
  archive: (id: string) => api.delete(`/api/v1/features/${id}`).then(r => r.data),
  draftStatus: (id: string) => api.get(`/api/v1/features/${id}/draft-status`).then(r => r.data),
  bulkArchive: (projectId: string, ids: string[]) =>
    api.post(`/api/v1/projects/${projectId}/features/bulk-archive`, { ids }).then(r => r.data as { archived: number }),
  bulkMove: (projectId: string, featureIds: string[], targetModuleId: string) =>
    api.post(`/api/v1/projects/${projectId}/features/bulk-move`, { featureIds, targetModuleId }).then(r => r.data as { moved: number }),
  listByProject: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/features`).then(r => r.data as Array<{ id: string; name: string; moduleId: string; automatedTestingEnabled: boolean; module: { id: string; name: string } }>),
  tags: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/features/tags`).then(r => r.data as string[]),
  /** Distinct linked epics (tracker-agnostic). Empty array when no plugin/epics. */
  epics: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/features/epics`).then(r => r.data as Array<{ name: string; color: string | null }>),
  browse: (projectId: string, params: {
    page?: number; limit?: number; search?: string;
    moduleId?: string; tags?: string; epics?: string;
    sort?: 'updated_desc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc';
  }) =>
    api.get(`/api/v1/projects/${projectId}/features/browse`, { params }).then(r => r.data as {
      items: Array<{
        id: string; name: string; tags: string[]; updatedAt: string;
        moduleId: string; moduleName: string | null; testCount: number;
        epicName: string | null; epicColor: string | null;
      }>;
      total: number; page: number; limit: number; pageCount: number;
    }),
};
export const featureVersionsApi = {
  list: (featureId: string) => api.get(`/api/v1/features/${featureId}/versions`).then(r => r.data),
  get: (featureId: string, versionId: string) => api.get(`/api/v1/features/${featureId}/versions/${versionId}`).then(r => r.data),
  publish: (featureId: string, data: object) => api.post(`/api/v1/features/${featureId}/versions`, data).then(r => r.data),
  restore: (featureId: string, versionId: string) => api.post(`/api/v1/features/${featureId}/versions/${versionId}/restore`).then(r => r.data),
  diff: (featureId: string, versionId: string, compareTo: string) =>
    api.get(`/api/v1/features/${featureId}/versions/${versionId}/diff`, { params: { compareTo } }).then(r => r.data),
};
export const featureRunsApi = {
  start: (featureId: string, data: object) => api.post(`/api/v1/features/${featureId}/run`, data).then(r => r.data),
  list: (featureId: string, environmentId?: string) =>
    api.get(`/api/v1/features/${featureId}/runs`, { params: environmentId ? { environmentId } : undefined }).then(r => r.data),
  /** Caller's in-progress runs across all features (drives the TopNav pill). */
  myActive: () => api.get('/api/v1/me/active-feature-runs').then(r => r.data),
  /** Bulk-heartbeat all of caller's active manual runs in one shot. */
  bulkHeartbeat: () => api.post('/api/v1/me/active-feature-runs/heartbeat').then(r => r.data),
  /**
   * Recovery hatch — end every active manual session the caller owns. Used
   * by the conflict modal's "End all my sessions" affordance so stragglers
   * from a previous race don't keep blocking the next Start.
   */
  endAllMine: () => api.post('/api/v1/me/active-feature-runs/end-all').then(r => r.data as { ended: number; reason: string }),
  signoff: (id: string, data: { decision: 'APPROVED' | 'REJECTED'; note?: string }) =>
    api.post(`/api/v1/feature-runs/${id}/signoff`, data).then(r => r.data),
  promote: (id: string, data: { targetEnvironmentId: string; note?: string; runMode?: 'AUTOMATED' | 'MANUAL' }) =>
    api.post(`/api/v1/feature-runs/${id}/promote`, data).then(r => r.data),
  get: (id: string) => api.get(`/api/v1/feature-runs/${id}`).then(r => r.data),
  pause: (id: string) => api.post(`/api/v1/feature-runs/${id}/pause`).then(r => r.data),
  resume: (id: string) => api.post(`/api/v1/feature-runs/${id}/resume`).then(r => r.data),
  skipCurrent: (id: string) => api.post(`/api/v1/feature-runs/${id}/skip-current`).then(r => r.data),
  stop: (id: string) => api.post(`/api/v1/feature-runs/${id}/stop`).then(r => r.data),
  heartbeat: (id: string) => api.post(`/api/v1/feature-runs/${id}/heartbeat`).then(r => r.data),
  abandon: (id: string) => api.post(`/api/v1/feature-runs/${id}/abandon`).then(r => r.data),
};
export const authApi = {
  /** Which auth providers + platform branding are enabled on this deployment. Public, cache-friendly. */
  getConfig: () =>
    api.get<{
      providers: { password: boolean; google: boolean; microsoft: boolean };
      branding?: { logoUrl: string | null; appName: string | null };
    }>(
      '/api/v1/auth/config',
    ).then(r => r.data),
  register: (data: { name: string; email: string; password: string; orgName?: string; inviteToken?: string }) =>
    api.post('/api/v1/auth/register', data).then(r => r.data),
  login: (data: { email: string; password: string }) =>
    api.post('/api/v1/auth/login', data).then(r => r.data),
  me: () => api.get('/api/v1/auth/me').then(r => r.data),
  switchOrg: (orgId: string) => api.post(`/api/v1/auth/switch-org/${orgId}`).then(r => r.data),
  /** Logout from this device — revokes the refresh token + blacklists current access JTI. */
  logout: () => {
    const refreshToken = localStorage.getItem('refresh_token');
    return api.post('/api/v1/auth/logout', { refreshToken }).then(r => r.data);
  },
  /** Sign out of every device for the current user. */
  logoutAll: () => api.post('/api/v1/auth/logout-all').then(r => r.data),
  /** List active sessions (refresh-token rows). */
  listSessions: () =>
    api.get<Array<{
      id: string;
      userAgent: string | null;
      ipAddress: string | null;
      createdAt: string;
      lastUsedAt: string;
      expiresAt: string;
    }>>('/api/v1/auth/sessions').then(r => r.data),
  /** Revoke a single session by id. */
  revokeSession: (id: string) => api.delete(`/api/v1/auth/sessions/${id}`).then(r => r.data),
};

export const orgsApi = {
  get: (orgId: string) => api.get(`/api/v1/orgs/${orgId}`).then(r => r.data),
  getOrg: (orgId: string) => api.get(`/api/v1/orgs/${orgId}`).then(r => r.data),
  update: (orgId: string, data: object) => api.patch(`/api/v1/orgs/${orgId}`, data).then(r => r.data),
  getMembers: (orgId: string) => api.get(`/api/v1/orgs/${orgId}/members`).then(r => r.data),
  removeMember: (orgId: string, userId: string) =>
    api.delete(`/api/v1/orgs/${orgId}/members/${userId}`).then(r => r.data),
  updateMemberRole: (orgId: string, userId: string, role: string) =>
    api.patch(`/api/v1/orgs/${orgId}/members/${userId}/role`, { role }).then(r => r.data),
  listInvites: (orgId: string) => api.get(`/api/v1/orgs/${orgId}/invites`).then(r => r.data),
  inviteMember: (orgId: string, dto: { email: string; role: string; name?: string; projectAssignments?: Array<{ projectId: string; role: string; allowedEnvironmentIds?: string[] }> }) =>
    api.post(`/api/v1/orgs/${orgId}/invites`, dto).then(r => r.data),
  cancelInvite: (orgId: string, inviteId: string) =>
    api.delete(`/api/v1/orgs/${orgId}/invites/${inviteId}`).then(r => r.data),
  acceptInvite: (token: string) => api.post(`/api/v1/orgs/invites/${token}/accept`).then(r => r.data),
  previewInvite: (token: string) => api.get(`/api/v1/orgs/invites/${token}/preview`).then(r => r.data),
  /** Public, unauthenticated — org name + logo by slug, for branded login/register pages. */
  publicBranding: (slug: string) =>
    api.get(`/api/v1/orgs/by-slug/${encodeURIComponent(slug)}/branding`)
      .then(r => r.data as { slug: string; name: string; logoUrl: string | null; primaryColor: string | null }),
};

// Per-org BYOK AI credential + spend rollup. The API never returns the
// plaintext key — `apiKey` is either the masked sentinel or null.
export type AiProvider = 'ANTHROPIC' | 'OPENAI' | 'GEMINI' | 'AZURE' | 'OLLAMA' | 'OPENAI_COMPATIBLE';
export interface AiCredential {
  provider: AiProvider;
  model: string;
  maxTokens: number;
  baseUrl: string | null;
  azureInstance: string | null;
  azureDeployment: string | null;
  azureApiVersion: string | null;
  monthlyCapUsd: number;
  rateLimitPerUserPerHour: number;
  active: boolean;
  apiKey: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AiCredentialUpsert {
  provider: AiProvider;
  model?: string;
  apiKey?: string | null;
  maxTokens?: number;
  baseUrl?: string;
  azureInstance?: string;
  azureDeployment?: string;
  azureApiVersion?: string;
  monthlyCapUsd?: number;
  rateLimitPerUserPerHour?: number;
}
export interface AiTestResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  costUsd: number;
  error?: string;
  sampleResponse?: string;
}
export interface AiSpend {
  month: string;
  totalUsd: number;
  byPurpose: Record<string, number>;
  callCount: number;
}

// ── GitHub integration (Layer A — connections) ─────────────────────────────
export type GitAuthKind = 'PAT' | 'APP';
export type GitProvider = 'GITHUB' | 'GITHUB_ENTERPRISE' | 'GITLAB';
export type RepoRole = 'FRONTEND' | 'BACKEND' | 'INFRA' | 'OTHER';
export type RepoIndexStatus = 'PENDING' | 'INDEXING' | 'READY' | 'FAILED';

export interface GitCredential {
  id: string;
  provider: GitProvider;
  authKind: GitAuthKind;
  displayLabel: string | null;
  baseUrl: string | null;
  appInstallationId: string | null;
  connectedAs: string | null;
  lastHealthOk: boolean;
  lastHealthAt: string | null;
  lastHealthError: string | null;
  isEnabled: boolean;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitCredentialUpsert {
  authKind: GitAuthKind;
  provider?: GitProvider;
  displayLabel?: string;
  baseUrl?: string;
  token?: string | null;
  appId?: string;
  privateKey?: string | null;
  appInstallationId?: string;
}

export interface ProjectRepo {
  id: string;
  role: RepoRole;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  status: RepoIndexStatus;
  chunkCount: number;
  lastIndexedAt: string | null;
  createdAt: string;
}

export const githubApi = {
  // Org credential
  getCredential: (orgId: string): Promise<GitCredential | null> =>
    api.get(`/api/v1/orgs/${orgId}/git-credential`).then((r) => r.data),
  upsertCredential: (orgId: string, body: GitCredentialUpsert): Promise<GitCredential> =>
    api.put(`/api/v1/orgs/${orgId}/git-credential`, body).then((r) => r.data),
  removeCredential: (orgId: string) =>
    api.delete(`/api/v1/orgs/${orgId}/git-credential`).then((r) => r.data),
  testCredential: (orgId: string): Promise<GitCredential> =>
    api.post(`/api/v1/orgs/${orgId}/git-credential/test`).then((r) => r.data),
  // Project repos
  listRepos: (projectId: string): Promise<ProjectRepo[]> =>
    api.get(`/api/v1/projects/${projectId}/repos`).then((r) => r.data),
  linkRepo: (
    projectId: string,
    body: { repoOwner: string; repoName: string; role?: RepoRole; defaultBranch?: string },
  ): Promise<ProjectRepo> => api.post(`/api/v1/projects/${projectId}/repos`, body).then((r) => r.data),
  updateRepo: (
    projectId: string,
    repoId: string,
    body: { role?: RepoRole; defaultBranch?: string },
  ): Promise<ProjectRepo> =>
    api.patch(`/api/v1/projects/${projectId}/repos/${repoId}`, body).then((r) => r.data),
  unlinkRepo: (projectId: string, repoId: string) =>
    api.delete(`/api/v1/projects/${projectId}/repos/${repoId}`).then((r) => r.data),
  reindexRepo: (projectId: string, repoId: string): Promise<{ status: RepoIndexStatus }> =>
    api.post(`/api/v1/projects/${projectId}/repos/${repoId}/reindex`).then((r) => r.data),
};

// ── Personal access tokens (MCP / API) ─────────────────────────────────────
export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: 'active' | 'expired' | 'revoked';
}

export const apiTokensApi = {
  list: (): Promise<ApiToken[]> => api.get('/api/v1/me/api-tokens').then((r) => r.data),
  create: (body: { name: string; expiresInDays?: number | null }): Promise<{ token: string; record: ApiToken }> =>
    api.post('/api/v1/me/api-tokens', body).then((r) => r.data),
  regenerate: (id: string): Promise<{ token: string; record: ApiToken }> =>
    api.post(`/api/v1/me/api-tokens/${id}/regenerate`).then((r) => r.data),
  revoke: (id: string) => api.delete(`/api/v1/me/api-tokens/${id}`).then((r) => r.data),
};

// ── Org-admin audit viewer ──────────────────────────────────────────────────
export interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  source: string | null;
  ip: string | null;
  userAgent: string | null;
  apiTokenId: string | null;
  createdAt: string;
  userId: string | null;
  user: { id: string; name: string | null; email: string } | null;
}
export interface AuditFilters {
  limit?: number;
  cursor?: string;
  userId?: string;
  action?: string;
  source?: string;
  entity?: string;
  apiTokenId?: string;
  from?: string;
  to?: string;
}
export const orgAuditApi = {
  list: (orgId: string, filters: AuditFilters = {}): Promise<{ items: AuditRow[]; nextCursor: string | null }> =>
    api.get(`/api/v1/orgs/${orgId}/audit-logs`, { params: filters }).then((r) => r.data),
  members: (orgId: string): Promise<Array<{ id: string; name: string | null; email: string }>> =>
    api.get(`/api/v1/orgs/${orgId}/members`).then((r) =>
      (r.data as Array<Record<string, unknown>>).map((m) => {
        const u = (m.user as Record<string, unknown>) ?? m;
        return { id: String(u.id ?? m.userId), name: (u.name as string) ?? null, email: String(u.email ?? '') };
      }),
    ),
};

export const aiCredentialsApi = {
  get: (orgId: string): Promise<AiCredential | null> =>
    api.get(`/api/v1/orgs/${orgId}/ai-credential`).then((r) => r.data),
  upsert: (orgId: string, body: AiCredentialUpsert): Promise<AiCredential> =>
    api.put(`/api/v1/orgs/${orgId}/ai-credential`, body).then((r) => r.data),
  remove: (orgId: string) =>
    api.delete(`/api/v1/orgs/${orgId}/ai-credential`).then((r) => r.data),
  test: (orgId: string, body: AiCredentialUpsert): Promise<AiTestResult> =>
    api.post(`/api/v1/orgs/${orgId}/ai-credential/test`, body).then((r) => r.data),
  spend: (orgId: string, month?: string): Promise<AiSpend> =>
    api
      .get(`/api/v1/orgs/${orgId}/ai/spend`, { params: month ? { month } : {} })
      .then((r) => r.data),
  audit: (
    orgId: string,
    opts?: { limit?: number; cursor?: string; purpose?: string },
  ): Promise<{
    items: Array<{
      id: string;
      createdAt: string;
      type: string;
      purpose: string | null;
      promptVersion: string | null;
      model: string;
      durationMs: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      costUsd: number | null;
      promptPreview: string;
      responsePreview: string;
    }>;
    nextCursor: string | null;
  }> =>
    api
      .get(`/api/v1/orgs/${orgId}/ai/audit`, {
        params: {
          ...(opts?.limit ? { limit: opts.limit } : {}),
          ...(opts?.cursor ? { cursor: opts.cursor } : {}),
          ...(opts?.purpose ? { purpose: opts.purpose } : {}),
        },
      })
      .then((r) => r.data),
};

export const adminApi = {
  getStats: () => api.get('/api/v1/admin/stats').then(r => r.data),
  getOrgDetail: (orgId: string) => api.get(`/api/v1/admin/orgs/${orgId}`).then(r => r.data),
  getAuditLogs: (page = 1, limit = 10) => api.get(`/api/v1/admin/audit-logs?page=${page}&limit=${limit}`).then(r => r.data),
  createOrg: (data: { name: string; ownerEmail: string; website?: string; description?: string }) =>
    api.post<{ id: string; name: string; slug: string }>('/api/v1/admin/orgs', data).then(r => r.data),
  getBranding: () =>
    api.get<{ logoUrl: string | null; appName: string | null }>('/api/v1/admin/branding').then(r => r.data),
  updateBranding: (data: { logoUrl?: string | null; appName?: string | null }) =>
    api.put<{ logoUrl: string | null; appName: string | null }>('/api/v1/admin/branding', data).then(r => r.data),
  listConfig: () => api.get('/api/v1/admin/config').then(r => r.data),
  createConfig: (data: object) => api.post('/api/v1/admin/config', data).then(r => r.data),
  updateConfig: (key: string, value: string) => api.put(`/api/v1/admin/config/${key}`, { value }).then(r => r.data),
  deleteConfig: (key: string) => api.delete(`/api/v1/admin/config/${key}`).then(r => r.data),
  listUsers: (page = 1, limit = 50, status?: string) =>
    api.get('/api/v1/admin/users', { params: { page, limit, status } }).then(r => r.data),
  updateUser: (id: string, data: object) => api.patch(`/api/v1/admin/users/${id}`, data).then(r => r.data),
  suspendUser: (id: string) => api.post(`/api/v1/admin/users/${id}/suspend`).then(r => r.data),
  reactivateUser: (id: string) => api.post(`/api/v1/admin/users/${id}/reactivate`).then(r => r.data),
  listPendingApprovals: () => api.get('/api/v1/admin/approvals').then(r => r.data),
  approveUser: (userId: string, note?: string) =>
    api.post(`/api/v1/admin/approvals/${userId}/approve`, { note }).then(r => r.data),
  rejectUser: (userId: string, note?: string) =>
    api.post(`/api/v1/admin/approvals/${userId}/reject`, { note }).then(r => r.data),
  listOrgs: (page = 1, limit = 50) => api.get('/api/v1/admin/orgs', { params: { page, limit } }).then(r => r.data),
  listAuditLogs: (page = 1, limit = 50) => api.get('/api/v1/admin/audit-logs', { params: { page, limit } }).then(r => r.data),
  updateOrgStatus: (orgId: string, isActive: boolean) =>
    api.patch(`/api/v1/admin/orgs/${orgId}/status`, { isActive }).then(r => r.data),
  deleteOrg: (orgId: string) => api.delete(`/api/v1/admin/orgs/${orgId}`).then(r => r.data),
  invitePlatformAdmin: (body: { email: string; name?: string }) =>
    api.post('/api/v1/admin/platform-admin-invites', body).then(r => r.data),
};
export const aiApi = {
  explain: (runId: string) => api.post(`/api/v1/ai/runs/${runId}/explain`).then(r => r.data),
  summarise: (runId: string) => api.post(`/api/v1/ai/runs/${runId}/summarise`).then(r => r.data),
  generateTest: (projectId: string, prompt: string) => api.post(`/api/v1/ai/projects/${projectId}/generate-test`, { prompt }).then(r => r.data),
};

export const statsApi = {
  getProjectStats: (projectId: string, envId?: string | null) =>
    api.get(`/api/v1/projects/${projectId}/stats`, { params: envId ? { envId } : undefined }).then(r => r.data),
  getProjectStatsByEnv: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/stats/by-env`).then(r => r.data),
  getModuleStats: (projectId: string, envId?: string | null) =>
    api.get(`/api/v1/projects/${projectId}/modules/stats`, { params: envId ? { envId } : undefined }).then(r => r.data),
  getFeatureStats: (moduleId: string, envId?: string | null) =>
    api.get(`/api/v1/modules/${moduleId}/features/stats`, { params: envId ? { envId } : undefined }).then(r => r.data),
  getSingleFeatureStats: (featureId: string, envId?: string | null) =>
    api.get(`/api/v1/features/${featureId}/stats`, { params: envId ? { envId } : undefined }).then(r => r.data),
  getModuleTags: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/modules/tags`).then(r => r.data),
};

export const accessRequestsApi = {
  createOrgRequest: (orgId: string, data: { message?: string }) =>
    api.post(`/api/v1/orgs/${orgId}/access-requests`, { type: 'ORG', ...data }).then(r => r.data),
  listOrgRequests: (orgId: string) =>
    api.get(`/api/v1/orgs/${orgId}/access-requests`).then(r => r.data),
  reviewOrgRequest: (orgId: string, requestId: string, data: { action: 'APPROVED' | 'REJECTED'; grantedRole?: string; reviewerNote?: string }) =>
    api.patch(`/api/v1/orgs/${orgId}/access-requests/${requestId}`, data).then(r => r.data),
  listMyRequests: () =>
    api.get('/api/v1/me/access-requests').then(r => r.data),
};

export const ssoApi = {
  listAccounts: () => api.get('/api/v1/auth/sso/accounts').then(r => r.data),
  unlinkAccount: (provider: string) => api.delete(`/api/v1/auth/sso/${provider}`).then(r => r.data),
  /** Begin linking an SSO provider to the CURRENT account. Returns a URL to navigate to. */
  startLink: (provider: 'google' | 'microsoft') =>
    api.post<{ url: string }>('/api/v1/auth/sso/link/start', { provider }).then(r => r.data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.patch('/api/v1/auth/me/password', data).then(r => r.data),
};

export const importExportApi = {
  // Export — returns JSON data (not a download trigger — caller handles blob)
  exportProject: (projectId: string): Promise<object> =>
    api.get(`/api/v1/projects/${projectId}/export`).then(r => r.data),
  exportModule: (moduleId: string): Promise<object> =>
    api.get(`/api/v1/modules/${moduleId}/export`).then(r => r.data),
  exportFeature: (featureId: string): Promise<object> =>
    api.get(`/api/v1/features/${featureId}/export`).then(r => r.data),
  exportTestCase: (testId: string): Promise<object> =>
    api.get(`/api/v1/tests/${testId}/export`).then(r => r.data),
  // Preview import (dry run) — now returns conflict list
  previewImport: (projectId: string, envelope: object, opts?: { targetModuleId?: string; targetFeatureId?: string }) =>
    api.post(`/api/v1/projects/${projectId}/import/preview`, { ...envelope, ...opts }).then(r => r.data),
  // Execute import
  importIntoProject: (projectId: string, envelope: object, opts?: { targetModuleId?: string; targetFeatureId?: string }) =>
    api.post(`/api/v1/projects/${projectId}/import`, { ...envelope, ...opts }).then(r => r.data),
  // Feature-level import (convenience — no projectId needed)
  importFeature: (moduleId: string, envelope: object) =>
    api.post(`/api/v1/features/import`, envelope, { params: { moduleId } }).then(r => r.data),
  /**
   * Merge a feature envelope INTO an existing feature. Matches tests by
   * name and updates them in place (snapshots prior state). Creates tests
   * not yet present. Never deletes existing tests not in the envelope.
   */
  mergeIntoFeature: (featureId: string, envelope: object): Promise<{
    updated: number;
    created: number;
    skipped: number;
    items: Array<{ name: string; action: 'updated' | 'created' | 'skipped'; reason?: string }>;
  }> =>
    api.post(`/api/v1/features/${featureId}/import-merge`, envelope).then(r => r.data),
  // Import history
  listImportLogs: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/import-logs`).then(r => r.data),
};

export const testVersionsApi = {
  list: (testId: string) =>
    api.get(`/api/v1/tests/${testId}/versions`).then(r => r.data),
  restore: (testId: string, versionId: string) =>
    api.post(`/api/v1/tests/${testId}/versions/${versionId}/restore`).then(r => r.data),
};

export const moduleVersionsApi = {
  list: (moduleId: string) =>
    api.get(`/api/v1/modules/${moduleId}/versions`).then(r => r.data),
  restore: (moduleId: string, versionId: string) =>
    api.post(`/api/v1/modules/${moduleId}/versions/${versionId}/restore`).then(r => r.data),
};

export const workSessionsApi = {
  /** Active session + live stats (opens one if none exists) */
  current: () => api.get('/api/v1/work-sessions/current').then(r => r.data),
  /** Most recent ENDED session for the user — for the "Last Activity" card */
  last: () => api.get('/api/v1/work-sessions/last').then(r => r.data),
  /** End the active session explicitly */
  end: (reason?: string) => api.post('/api/v1/work-sessions/end', { reason }).then(r => r.data),
  /** Paginated session history */
  list: (params?: { page?: number; limit?: number }) =>
    api.get('/api/v1/work-sessions', { params }).then(r => r.data),
  /** Breakdown grouped by module + feature */
  breakdown: (id: string) => api.get(`/api/v1/work-sessions/${id}/breakdown`).then(r => r.data),
};

/** Comments returned on GET /api/v1/issues/:id (embedded list). */
export type IssueCommentDto = {
  id: string;
  content: string;
  user: { id: string; name: string; avatarUrl?: string };
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export const issuesApi = {
  // Create
  create: (projectId: string, data: {
    type: string;
    /**
     * Root-cause classification — re-uses the TestFailureCategory enum
     * (FUNCTIONALITY, DESIGN_MISMATCH, …, OTHER). Backend defaults to
     * FUNCTIONALITY when omitted; can be inherited from the source
     * TestRun.failureCategory when the issue is logged from a failed run.
     */
    category?: string;
    severity?: string;
    title: string;
    description?: string;
    stepsToReproduce?: string;
    expectedBehaviour?: string;
    actualBehaviour?: string;
    screenshotUrls?: string[];
    recordingUrl?: string;
    moduleId?: string;
    featureId?: string;
    testDefinitionId?: string;
    testRunId?: string;
    runStepId?: string;
    assignedToId?: string;
  }) =>
    api.post(`/api/v1/projects/${projectId}/issues`, data).then(r => r.data),

  // List / filter
  list: (projectId: string, params?: {
    status?: string; type?: string; severity?: string;
    moduleId?: string; featureId?: string; testDefinitionId?: string;
    testRunId?: string; assignedToId?: string; search?: string; page?: number; limit?: number;
  }) =>
    api.get(`/api/v1/projects/${projectId}/issues`, { params }).then(r => r.data),

  // Stats
  projectStats: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/issues/stats`).then(r => r.data),
  moduleStats: (moduleId: string) =>
    api.get(`/api/v1/modules/${moduleId}/issues/stats`).then(r => r.data),
  featureStats: (featureId: string) =>
    api.get(`/api/v1/features/${featureId}/issues/stats`).then(r => r.data),
  testStats: (testId: string) =>
    api.get(`/api/v1/tests/${testId}/issues/stats`).then(r => r.data),

  // Get / update / delete
  get: (id: string) =>
    api.get(`/api/v1/issues/${id}`).then(r => r.data),
  update: (id: string, data: object) =>
    api.patch(`/api/v1/issues/${id}`, data).then(r => r.data),
  changeStatus: (id: string, data: { status: string; note?: string }) =>
    api.post(`/api/v1/issues/${id}/status`, data).then(r => r.data),
  remove: (id: string) =>
    api.delete(`/api/v1/issues/${id}`).then(r => r.data),
  hardDelete: (id: string) =>
    api.delete(`/api/v1/issues/${id}/hard`).then(r => r.data),

  // Comments (no separate list route — comments embedded on GET /issues/:id)
  addComment: (issueId: string, content: string) =>
    api.post(`/api/v1/issues/${issueId}/comments`, { content }).then(r => r.data),
  listComments: (issueId: string): Promise<IssueCommentDto[]> =>
    api
      .get<{
        comments?: Array<{
          id: string;
          content: string;
          user: { id: string; name: string; avatarUrl?: string | null };
          createdAt: string;
          updatedAt: string;
          deletedAt?: string | null;
        }>;
      }>(`/api/v1/issues/${issueId}`)
      .then((r) => (r.data.comments ?? []).map(c => ({
        id: c.id,
        content: c.content,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        ...(c.deletedAt != null ? { deletedAt: c.deletedAt } : {}),
        user: {
          id: c.user.id,
          name: c.user.name,
          ...(c.user.avatarUrl != null ? { avatarUrl: c.user.avatarUrl } : {}),
        },
      }))),
  deleteComment: (commentId: string) =>
    api.delete(`/api/v1/issues/comments/${commentId}`).then(r => r.data),

  // Views
  recordView: (issueId: string) =>
    api.post(`/api/v1/issues/${issueId}/view`, {}).then(r => r.data),
  getViewers: (issueId: string) =>
    api.get(`/api/v1/issues/${issueId}/views`).then(r => r.data),

  // Mentionable users
  getMentionable: (issueId: string) =>
    api.get(`/api/v1/issues/${issueId}/mentionable`).then(r => r.data),
};

/** R2 — Reports (saved configs + generated snapshots). */
export const reportsApi = {
  // Saved templates
  listConfigs: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/report-configs`).then(r => r.data),
  createConfig: (projectId: string, dto: object) =>
    api.post(`/api/v1/projects/${projectId}/report-configs`, dto).then(r => r.data),
  deleteConfig: (id: string) =>
    api.delete(`/api/v1/report-configs/${id}`).then(r => r.data),

  // On-demand generation
  generate: (projectId: string, dto: {
    configId?: string;
    type: 'FEATURE' | 'MODULE' | 'PROJECT' | 'PHASE' | 'SESSION';
    featureId?: string; moduleId?: string; phaseId?: string; workSessionId?: string;
    environmentId?: string;
    includeSession?: boolean; includeFeature?: boolean; includeProject?: boolean;
    includeCharts?: boolean;
    /** Include the per-test pass/fail/bug list in the report. */
    includeTests?: boolean;
    /** Optional list of email addresses — when present + non-empty, the
     *  rendered report is sent immediately after generation. */
    recipientEmails?: string[];
    /** Optional free-form note appended into the generated report. */
    additionalText?: string;
    /** Optional active-filter spec — adds a "Filtered tests" section. */
    appliedFilters?: {
      search?: string; tags?: string[]; epics?: string[];
      moduleId?: string; featureId?: string;
      status?: 'PASSED' | 'FAILED' | 'OUTSTANDING';
    };
  }) =>
    api.post(`/api/v1/projects/${projectId}/reports/generate`, dto).then(r => r.data),

  /** Pre-populated recipient list for the Generate-and-Email modal —
   *  ORG_ADMINs + project OWNER/TECH_LEAD/MANAGER. */
  defaultRecipients: (projectId: string): Promise<Array<{ email: string; name: string | null; role: string }>> =>
    api.get(`/api/v1/projects/${projectId}/report-default-recipients`).then(r => r.data),

  /** Rendered HTML of a stored report — for in-app preview (instant, no PDF wait). */
  previewHtml: (id: string): Promise<string> =>
    api.get(`/api/v1/reports/${id}/preview`, { responseType: 'text' }).then(r => r.data),

  /** Re-send an already-generated report to a fresh recipient list. */
  email: (id: string, recipientEmails: string[]) =>
    api.post(`/api/v1/reports/${id}/email`, { recipientEmails }).then(r => r.data),

  // History — cascade-aware. moduleId includes all reports under that module
  // (incl. its features). featureId narrows to one feature. Neither = full
  // project Reports table.
  list: (
    projectId: string,
    params?: {
      type?: string;
      environmentId?: string;
      moduleId?: string;
      featureId?: string;
      limit?: number;
    },
  ) =>
    api.get(`/api/v1/projects/${projectId}/reports`, { params }).then(r => r.data),
  get: (id: string) =>
    api.get(`/api/v1/reports/${id}`).then(r => r.data),

  /** Most recent report at a given scope — powers LatestReportCard. */
  latest: (projectId: string, params?: { moduleId?: string; featureId?: string }) =>
    api.get(`/api/v1/projects/${projectId}/reports/latest`, { params }).then(r => r.data),

  /** Build the inline-render URL — used as <iframe src> or <a href>. */
  downloadUrl: (id: string, inline = false) =>
    `${API_BASE}/api/v1/reports/${id}/download${inline ? '?inline=1' : ''}`,
};

/** R4 — Scheduled reports. */
export const reportSchedulesApi = {
  list: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/report-schedules`).then(r => r.data),
  create: (projectId: string, dto: object) =>
    api.post(`/api/v1/projects/${projectId}/report-schedules`, dto).then(r => r.data),
  update: (id: string, dto: object) =>
    api.patch(`/api/v1/report-schedules/${id}`, dto).then(r => r.data),
  remove: (id: string) =>
    api.delete(`/api/v1/report-schedules/${id}`).then(r => r.data),
  runNow: (id: string) =>
    api.post(`/api/v1/report-schedules/${id}/run-now`).then(r => r.data),
};

/**
 * Org-level BI analytics. Every endpoint takes the same filter envelope
 * (project / module / feature / user / env / date range) and the backend
 * intersects with the caller's visible-projects scope:
 *   - ORG_ADMIN sees every project
 *   - Members see only projects they're a member of (env-RBAC applied)
 */
export type AnalyticsFilters = {
  projectId?: string;
  moduleId?: string;
  featureId?: string;
  userId?: string;
  environmentId?: string;
  /** Donut-click filters — narrow other widgets while the donut itself
   *  keeps showing the full mix. */
  failureCategory?: string;
  issueCategory?: string;
  issueType?: string;
  fromDate?: string;  // ISO
  toDate?: string;    // ISO
};
const analyticsParams = (f: AnalyticsFilters | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!f) return out;
  if (f.projectId) out.projectId = f.projectId;
  if (f.moduleId) out.moduleId = f.moduleId;
  if (f.featureId) out.featureId = f.featureId;
  if (f.userId) out.userId = f.userId;
  if (f.environmentId) out.environmentId = f.environmentId;
  if (f.failureCategory) out.failureCategory = f.failureCategory;
  if (f.issueCategory) out.issueCategory = f.issueCategory;
  if (f.issueType) out.issueType = f.issueType;
  if (f.fromDate) out.fromDate = f.fromDate;
  if (f.toDate) out.toDate = f.toDate;
  return out;
};
export const analyticsApi = {
  visibleProjects: (orgId: string) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/visible-projects`).then(r => r.data as Array<{ id: string; name: string }>),
  kpis: (orgId: string, filters?: AnalyticsFilters) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/kpis`, { params: analyticsParams(filters) })
      .then(r => r.data as { totalRuns: number; avgRunsPerDay: number; avgFailsPerDay: number; openIssues: number; avgResolutionMs: number }),
  runsTrend: (orgId: string, filters?: AnalyticsFilters) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/runs-trend`, { params: analyticsParams(filters) })
      .then(r => r.data as { total: number; avgPerDay: number; days: Array<{ date: string; total: number; tested: number; passed: number; failed: number; skipped: number }> }),
  failureCategories: (orgId: string, filters?: AnalyticsFilters) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/failure-categories`, { params: analyticsParams(filters) })
      .then(r => r.data as Array<{ category: string | null; count: number }>),
  issueCategories: (orgId: string, filters?: AnalyticsFilters) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/issue-categories`, { params: analyticsParams(filters) })
      .then(r => r.data as Array<{ category: string | null; count: number }>),
  issueTypes: (orgId: string, filters?: AnalyticsFilters) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/issue-types`, { params: analyticsParams(filters) })
      .then(r => r.data as Array<{ type: string; count: number }>),
  failuresByFeature: (orgId: string, filters?: AnalyticsFilters & { limit?: number }) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/failures-by-feature`, { params: { ...analyticsParams(filters), ...(filters?.limit ? { limit: filters.limit } : {}) } })
      .then(r => r.data as Array<{ featureId: string; featureName: string; moduleName: string; total: number; failed: number; passRate: number | null }>),
  failuresByModule: (orgId: string, filters?: AnalyticsFilters & { limit?: number }) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/failures-by-module`, { params: { ...analyticsParams(filters), ...(filters?.limit ? { limit: filters.limit } : {}) } })
      .then(r => r.data as Array<{ moduleId: string; moduleName: string; total: number; failed: number; featureCount: number; passRate: number | null }>),
  failuresByProject: (orgId: string, filters?: AnalyticsFilters) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/failures-by-project`, { params: analyticsParams(filters) })
      .then(r => r.data as Array<{ projectId: string; projectName: string; total: number; passed: number; failed: number; passRate: number | null }>),
  bugResolutionTime: (orgId: string, filters?: AnalyticsFilters) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/bug-resolution-time`, { params: analyticsParams(filters) })
      .then(r => r.data as { count: number; avgMs: number; p50Ms: number; p90Ms: number }),
  assigneeLeaderboard: (orgId: string, filters?: AnalyticsFilters & { limit?: number }) =>
    api.get(`/api/v1/orgs/${orgId}/analytics/assignee-leaderboard`, { params: { ...analyticsParams(filters), ...(filters?.limit ? { limit: filters.limit } : {}) } })
      .then(r => r.data as Array<{ userId: string; userName: string; userEmail: string; runsTriggered: number; issuesReported: number; issuesResolved: number; avgResolutionMs: number }>),
};

/** R1 + R3 — Phases lifecycle. */
export const phasesApi = {
  list: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/phases`).then(r => r.data),
  create: (projectId: string, dto: object) =>
    api.post(`/api/v1/projects/${projectId}/phases`, dto).then(r => r.data),
  update: (phaseId: string, dto: object) =>
    api.patch(`/api/v1/phases/${phaseId}`, dto).then(r => r.data),
  remove: (phaseId: string) =>
    api.delete(`/api/v1/phases/${phaseId}`).then(r => r.data),
  reorder: (projectId: string, orderedIds: string[]) =>
    api.post(`/api/v1/projects/${projectId}/phases/reorder`, { orderedIds }).then(r => r.data),
  assign: (phaseId: string, dto: { userId: string; role: 'TESTER' | 'MANAGER' | 'VIEWER' }) =>
    api.post(`/api/v1/phases/${phaseId}/assignments`, dto).then(r => r.data),
  unassign: (phaseId: string, userId: string) =>
    api.delete(`/api/v1/phases/${phaseId}/assignments/${userId}`).then(r => r.data),

  // FeaturePhase
  listForFeature: (featureId: string, autoCreate = false) =>
    api.get(`/api/v1/features/${featureId}/phases`, { params: autoCreate ? { autoCreate: 1 } : undefined }).then(r => r.data),
  startFeaturePhase: (id: string) =>
    api.post(`/api/v1/feature-phases/${id}/start`).then(r => r.data),
  setFeaturePhaseStatus: (id: string, dto: { status: string; notes?: string }) =>
    api.post(`/api/v1/feature-phases/${id}/status`, dto).then(r => r.data),
  promoteFeaturePhase: (id: string, notes?: string) =>
    api.post(`/api/v1/feature-phases/${id}/promote`, notes ? { notes } : {}).then(r => r.data),

  // Sign-off
  signOff: (featureId: string, message?: string) =>
    api.post(`/api/v1/features/${featureId}/sign-off`, message ? { message } : {}).then(r => r.data),
  getSignOff: (featureId: string) =>
    api.get(`/api/v1/features/${featureId}/sign-off`).then(r => r.data),
};

export const uploadsApi = {
  upload: async (file: File): Promise<{ id: string; token: string; url: string; filename: string; mimeType: string; sizeBytes: number }> => {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post('/api/v1/uploads', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data as { id: string; token: string; url: string; filename: string; mimeType: string; sizeBytes: number };
  },
  remove: (token: string) => api.delete(`/api/v1/uploads/${token}`),
};

// ─── Plugin Registry (5.3) ───────────────────────────────────────────────────

export type PluginCapability =
  | 'createIssue'
  | 'linkTicket'
  | 'syncPhaseStatus'
  | 'pullTicketStatus'
  | 'fetchTicketContext'
  | 'attachArtifacts'
  | 'listDocs'
  | 'fetchDoc'
  | 'sendNotification'
  | 'listEntities'
  | 'webhookListener';

export type PluginCatalogEntry = {
  id: string;
  name: string;
  description: string;
  version: string;
  iconUrl?: string;
  capabilities: PluginCapability[];
  fieldHints?: { field: string; kind: string; label?: string; helpText?: string }[];
};

export type PluginInstall = {
  id: string;
  orgId: string;
  pluginId: string;
  pluginVersion: string;
  displayLabel: string | null;
  isEnabled: boolean;
  config: Record<string, unknown>;
  lastHealthOk: boolean;
  lastHealthAt: string | null;
  lastHealthError: string | null;
  installedById: string;
  createdAt: string;
  updatedAt: string;
};

export interface ClickUpMemberRow {
  clickupUserId: number;
  username: string;
  email: string | null;
  color: string | null;
  linkedQaUserId: string | null;
  suggestedQaUserId: string | null;
}
export interface ClickUpQaUserRow {
  id: string;
  name: string;
  email: string | null;
  linkedClickupUserId: number | null;
}

/** QA ↔ ClickUp user links (org-admin). All gated server-side on a healthy install. */
export const clickupLinksApi = {
  health: (orgId: string): Promise<{ installed: boolean; healthy: boolean }> =>
    api.get(`/api/v1/orgs/${orgId}/clickup/health`).then((r) => r.data),
  members: (orgId: string): Promise<{ members: ClickUpMemberRow[]; qaUsers: ClickUpQaUserRow[] }> =>
    api.get(`/api/v1/orgs/${orgId}/clickup/members`).then((r) => r.data),
  link: (orgId: string, body: { qaUserId: string; clickupUserId: number; clickupUsername?: string; clickupEmail?: string }) =>
    api.put(`/api/v1/orgs/${orgId}/clickup/links`, body).then((r) => r.data),
  unlink: (orgId: string, qaUserId: string) =>
    api.delete(`/api/v1/orgs/${orgId}/clickup/links/${qaUserId}`).then((r) => r.data),
};

export interface ClickUpTokenStatus {
  installed: boolean;
  healthy: boolean;
  hasToken: boolean;
  tokenHealthy?: boolean;
  connectedAs?: string | null;
  updatedAt?: string | null;
}

/**
 * The logged-in user's OWN ClickUp personal token (for their active org). Lets
 * their ClickUp actions be attributed to them. Opt-in; falls back to the org
 * token. The secret is never returned — only status + connectedAs.
 */
export const userClickupApi = {
  status: (): Promise<ClickUpTokenStatus> =>
    api.get('/api/v1/me/clickup-token').then((r) => r.data),
  set: (token: string): Promise<{ hasToken: boolean; healthy: boolean; connectedAs: string | null }> =>
    api.put('/api/v1/me/clickup-token', { token }).then((r) => r.data),
  remove: (): Promise<{ hasToken: boolean }> =>
    api.delete('/api/v1/me/clickup-token').then((r) => r.data),
};

export const pluginsApi = {
  catalog: (): Promise<PluginCatalogEntry[]> =>
    api.get('/api/v1/plugins').then((r) => r.data),

  listInstalls: (orgId: string): Promise<PluginInstall[]> =>
    api.get(`/api/v1/orgs/${orgId}/plugin-installs`).then((r) => r.data),

  getInstall: (orgId: string, id: string): Promise<PluginInstall | null> =>
    api.get(`/api/v1/orgs/${orgId}/plugin-installs/${id}`).then((r) => r.data),

  install: (
    orgId: string,
    body: { pluginId: string; displayLabel?: string; config: unknown; secrets: Record<string, string> },
  ): Promise<PluginInstall> =>
    api.post(`/api/v1/orgs/${orgId}/plugin-installs`, body).then((r) => r.data),

  update: (
    orgId: string,
    id: string,
    body: Partial<{ config: unknown; secrets: Record<string, string>; displayLabel: string | null; isEnabled: boolean }>,
  ): Promise<PluginInstall> =>
    api.patch(`/api/v1/orgs/${orgId}/plugin-installs/${id}`, body).then((r) => r.data),

  uninstall: (orgId: string, id: string): Promise<void> =>
    api.delete(`/api/v1/orgs/${orgId}/plugin-installs/${id}`).then((r) => r.data),

  healthCheck: (orgId: string, id: string): Promise<{ ok: boolean; error?: string; connectedAs?: string }> =>
    api.post(`/api/v1/orgs/${orgId}/plugin-installs/${id}/health-check`).then((r) => r.data),

  /**
   * Generic capability dispatch — used by the binding form's cascading picker
   * (listEntities) and by all the read capabilities (linkTicket, pullTicketStatus,
   * fetchTicketContext, listDocs, fetchDoc). Write capabilities flow through the
   * same endpoint but throw on the server when CLICKUP_DEV_WRITE_MODE != 'live'.
   */
  dispatch: <T = unknown>(
    orgId: string,
    installId: string,
    body: { capability: PluginCapability; payload?: unknown; bindingId?: string },
  ): Promise<T> =>
    api.post(`/api/v1/orgs/${orgId}/plugin-installs/${installId}/dispatch`, body).then((r) => r.data as T),

  /**
   * One-click "create a parent task in ClickUp for this feature, then auto-wire
   * subsequent issues as subtasks under it". Resolves the list from the
   * feature's cascade (feature → module → project).
   */
  pushFeature: (
    featureId: string,
    body?: { description?: string },
  ): Promise<{ ok: boolean; externalId: string; externalUrl: string; listId: string }> =>
    api.post(`/api/v1/features/${featureId}/push-to-clickup`, body ?? {}).then((r) => r.data),

  /**
   * Link an existing ClickUp task as the feature parent. Counterpart of
   * pushFeature — same end-state (FeaturePluginBinding + TicketLink with
   * targetMode=subtask), but no ClickUp write.
   */
  linkFeature: (
    featureId: string,
    body: { ticketRef: string },
  ): Promise<{ ok: boolean; externalId: string; externalUrl: string; externalTitle?: string }> =>
    api.post(`/api/v1/features/${featureId}/link-clickup-task`, body).then((r) => r.data),

  unlinkFeature: (featureId: string): Promise<void> =>
    api.post(`/api/v1/features/${featureId}/unlink-clickup-task`).then((r) => r.data),

  /**
   * Current status of a feature's linked ClickUp task + the list of statuses
   * it can be moved to. 404 when the feature has no linked task — callers
   * treat that as "hide the control".
   */
  getFeatureClickUpStatus: (
    featureId: string,
  ): Promise<{
    linked: boolean;
    externalId: string;
    externalUrl: string;
    externalTitle: string | null;
    currentStatus: string;
    currentStatusColor?: string;
    statuses: Array<{ status: string; color?: string; type?: string }>;
    /** Epic the linked task belongs to (from its ClickUp custom fields). */
    epic: { name: string; color?: string } | null;
  }> =>
    api.get(`/api/v1/features/${featureId}/clickup-task-status`).then((r) => r.data),

  /** Move a feature's linked ClickUp task to a new status (outbound write). */
  setFeatureClickUpStatus: (
    featureId: string,
    status: string,
  ): Promise<{ ok: boolean; externalStatus: string; syncedAt: string }> =>
    api.post(`/api/v1/features/${featureId}/clickup-task-status`, { status }).then((r) => r.data),

  /** Default issue assignee for a feature, from its linked ClickUp task's
   *  assignee mapped to a QA user. `assignee: null` when none resolves. */
  getFeatureSuggestedAssignee: (
    featureId: string,
  ): Promise<{ assignee: { qaUserId: string; name: string; email: string } | null }> =>
    api.get(`/api/v1/features/${featureId}/clickup-suggested-assignee`).then((r) => r.data),

  /** Current status + selectable statuses for an issue's linked ClickUp task. */
  getIssueClickUpStatus: (
    issueId: string,
  ): Promise<{
    linked: boolean;
    externalId: string;
    externalUrl: string;
    externalTitle: string | null;
    currentStatus: string;
    currentStatusColor?: string;
    statuses: Array<{ status: string; color?: string; type?: string }>;
    epic: { name: string; color?: string } | null;
  }> =>
    api.get(`/api/v1/issues/${issueId}/clickup-task-status`).then((r) => r.data),

  /** Move an issue's linked ClickUp task to a new status (outbound write). */
  setIssueClickUpStatus: (
    issueId: string,
    status: string,
  ): Promise<{ ok: boolean; externalStatus: string; syncedAt: string }> =>
    api.post(`/api/v1/issues/${issueId}/clickup-task-status`, { status }).then((r) => r.data),

  /** Post a comment on a feature's linked ClickUp task (e.g. a failure reason). */
  postFeatureClickUpComment: (
    featureId: string,
    comment: string,
  ): Promise<{ ok: boolean }> =>
    api.post(`/api/v1/features/${featureId}/clickup-task-comment`, { comment }).then((r) => r.data),

  /** Attach evidence files to a feature's linked ClickUp task. */
  postFeatureClickUpAttachments: (
    featureId: string,
    artifacts: { url: string; filename: string; contentType?: string; sizeBytes?: number; kind?: string }[],
  ): Promise<{ uploaded: unknown[]; fallbackToDescription: unknown[] }> =>
    api.post(`/api/v1/features/${featureId}/clickup-task-attachments`, { artifacts }).then((r) => r.data),

  /**
   * Push a platform Issue to ClickUp as a ticket. Wraps:
   *   - cascade resolution (where does this land?)
   *   - createIssue dispatch
   *   - attach evidence (best-effort, falls back to URL list in description)
   *   - TicketLink persisted with issueId
   */
  pushIssue: (
    issueId: string,
    opts?: { customItemId?: string; placement?: 'feature-subtask' | 'module-list' },
  ): Promise<{ ok: boolean; externalId: string; externalUrl: string; attachments: unknown }> =>
    api.post(`/api/v1/issues/${issueId}/push-to-clickup`, opts ?? {}).then((r) => r.data),

  /**
   * Fetch the ClickUp workspace's custom task types (Bug / Enhancement / etc).
   * Used by LogIssueModal to populate the "ClickUp task type" dropdown when
   * push-to-ClickUp is enabled. Returns empty array if the workspace hasn't
   * customised types or the project has no healthy ClickUp install.
   */
  listClickUpTaskTypes: (projectId: string):
    Promise<{ items: Array<{ id: string; label: string; numericId: number }> }> =>
    api.get(`/api/v1/projects/${projectId}/clickup-task-types`).then((r) => r.data),

  /** Bootstrap "Generate from ClickUp" — preview is dry-run, run executes. */
  bootstrapPreview: (
    projectId: string,
    body: { scope: { spaceId?: string; folderId?: string; listIds?: string[] }; depth: 'module' | 'feature' | 'test' },
  ): Promise<BootstrapPreview> =>
    api.post(`/api/v1/projects/${projectId}/clickup-bootstrap/preview`, body).then((r) => r.data),

  bootstrapRun: (
    projectId: string,
    body: {
      scope: { spaceId?: string; folderId?: string; listIds?: string[] };
      depth: 'module' | 'feature' | 'test';
      tagPrefix?: string;
      selectedTaskIds?: string[];
    },
  ): Promise<BootstrapRunResult> =>
    api.post(`/api/v1/projects/${projectId}/clickup-bootstrap`, body).then((r) => r.data),
};

export type BootstrapSampleFeature = {
  taskId: string;
  taskName: string;
  status: string;
  /** Workspace task type label (Bug / Enhancement / …) or "Task" for default. */
  taskType: string;
  alreadyLinked: boolean;
  tests: Array<{ id: string; name: string }>;
  moreTests: number;
};

export type BootstrapPreview = {
  lists: Array<{ id: string; name: string; alreadyImported: boolean }>;
  totals: {
    modules: number;
    features: number;
    tests: number;
    skipped: { modules: number; features: number; tests: number };
  };
  samples: Array<{
    listId: string;
    listName: string;
    moduleAlreadyExists: boolean;
    topTasksCount: number;
    testsCount: number;
    /** Full list of top-level tasks (not just first 2). Used for checkbox selection in the preview. */
    features: BootstrapSampleFeature[];
    /** Distinct status labels across `features` — used for status-grouping chips in the wizard. */
    statuses: string[];
    /** Distinct task-type labels across `features` — used for task-type chips in the wizard. */
    taskTypes: string[];
    /** @deprecated kept for transitional back-compat. Use `features` instead. */
    sampleFeatures: BootstrapSampleFeature[];
  }>;
};

export type BootstrapRunResult = {
  created: { modules: number; features: number; tests: number };
  skipped: { modules: number; features: number; tests: number };
  errors: Array<{ scope: string; externalId: string; message: string }>;
};

// ─── Docs (local + linked) ───────────────────────────────────────────────────

export type DocScopeKind = 'project' | 'module' | 'feature' | 'test';

export type LocalDocSummary = {
  id: string;
  title: string;
  summary: string | null;
  updatedAt: string;
  createdAt: string;
  author: { id: string; name: string } | null;
  editor: { id: string; name: string } | null;
};

export type LocalDoc = LocalDocSummary & {
  markdown: string;
  orgId: string;
  projectId: string | null;
  moduleId: string | null;
  featureId: string | null;
  testDefinitionId: string | null;
};

export type LinkedDoc = {
  id: string;
  externalId: string;
  externalUrl: string;
  title: string;
  summary: string | null;
  pageId: string | null;
  cachedMarkdown: string | null;
  cachedAt: string | null;
  cacheExpiresAt: string | null;
  install: { id: string; pluginId: string; displayLabel: string | null };
};

export type DocPageNode = { id: string; label: string; meta?: { parentPageId: string | null } };

const docsBase = (kind: DocScopeKind, id: string): string => {
  if (kind === 'project') return `projects/${id}`;
  if (kind === 'module') return `modules/${id}`;
  if (kind === 'feature') return `features/${id}`;
  return `tests/${id}`;
};

export const docsApi = {
  // Local docs
  listLocal: (kind: DocScopeKind, id: string): Promise<LocalDocSummary[]> =>
    api.get(`/api/v1/${docsBase(kind, id)}/docs`).then((r) => r.data),

  getLocal: (id: string): Promise<LocalDoc> =>
    api.get(`/api/v1/docs/${id}`).then((r) => r.data),

  createLocal: (
    kind: DocScopeKind,
    id: string,
    body: { title: string; markdown?: string; summary?: string },
  ): Promise<LocalDoc> =>
    api.post(`/api/v1/${docsBase(kind, id)}/docs`, body).then((r) => r.data),

  updateLocal: (
    id: string,
    body: { title?: string; markdown?: string; summary?: string },
  ): Promise<LocalDoc> =>
    api.patch(`/api/v1/docs/${id}`, body).then((r) => r.data),

  deleteLocal: (id: string): Promise<void> =>
    api.delete(`/api/v1/docs/${id}`).then((r) => r.data),

  // Linked (external) docs
  listLinked: (kind: DocScopeKind, id: string): Promise<LinkedDoc[]> =>
    api.get(`/api/v1/${docsBase(kind, id)}/doc-links`).then((r) => r.data),

  link: (
    kind: DocScopeKind,
    id: string,
    body: { installId: string; externalId: string; externalUrl: string; title: string; summary?: string; pageId?: string },
  ): Promise<LinkedDoc> =>
    api.post(`/api/v1/${docsBase(kind, id)}/doc-links`, body).then((r) => r.data),

  unlink: (linkId: string): Promise<void> =>
    api.delete(`/api/v1/doc-links/${linkId}`).then((r) => r.data),

  refreshLinked: (linkId: string): Promise<LinkedDoc> =>
    api.post(`/api/v1/doc-links/${linkId}/refresh`).then((r) => r.data),

  getLinkedContent: (linkId: string): Promise<{ id: string; title: string; externalUrl: string; markdown: string; cached: boolean }> =>
    api.get(`/api/v1/doc-links/${linkId}/content`).then((r) => r.data),

  // ClickUp doc page tree (for the link UI)
  getDocPages: (orgId: string, installId: string, docId: string): Promise<{ items: DocPageNode[] }> =>
    api.get(`/api/v1/orgs/${orgId}/plugin-installs/${installId}/docs/${docId}/pages`).then((r) => r.data),

  searchRemoteDocs: (
    orgId: string,
    installId: string,
    body?: {
      query?: string;
      limit?: number;
      parent?: { workspaceId?: string; spaceId?: string; folderId?: string; listId?: string };
    },
  ): Promise<{ items: Array<{ externalId: string; externalUrl: string; title: string; summary?: string; pageId?: string; updatedAt?: string }> }> =>
    api.post(`/api/v1/orgs/${orgId}/plugin-installs/${installId}/docs/search`, body ?? {}).then((r) => r.data),
};

export interface AcSourceLink {
  id: string;
  testId: string;
  installId: string;
  docId: string;
  pageId: string;
  sectionSlug: string | null;
  pageTitle: string | null;
  sectionTitle: string | null;
  itemFingerprint: string | null;
  itemTitle: string | null;
  externalUrl: string;
  lastSyncedAt: string | null;
  lastSyncedContent: string | null;
  lastSyncedHash: string | null;
  lastAppliedAt: string | null;
  lastAppliedHash: string | null;
  previousDescription: string | null;
  previousAppliedAt: string | null;
}

export interface PageSection {
  slug: string;
  title: string;
  level: number;
}

export interface SectionItem {
  index: number;
  title: string;
  marker: 'ordered' | 'unordered';
  fingerprint: string;
  preview: string;
  content: string;
}

export const acLinksApi = {
  get: (testId: string): Promise<{ link: AcSourceLink | null; availableInstallId: string | null }> =>
    api.get(`/api/v1/tests/${testId}/ac-source`).then((r) => r.data),

  set: (testId: string, body: {
    installId: string;
    docId: string;
    pageId: string;
    sectionSlug: string | null;
    pageTitle?: string | null;
    sectionTitle?: string | null;
    itemFingerprint?: string | null;
    itemTitle?: string | null;
    externalUrl: string;
  }): Promise<AcSourceLink> =>
    api.put(`/api/v1/tests/${testId}/ac-source`, body).then((r) => r.data),

  unlink: (testId: string): Promise<{ ok: true }> =>
    api.delete(`/api/v1/tests/${testId}/ac-source`).then((r) => r.data),

  sync: (testId: string): Promise<{ link: AcSourceLink; currentDescription: string; hasChanges: boolean }> =>
    api.post(`/api/v1/tests/${testId}/ac-source/sync`).then((r) => r.data),

  apply: (testId: string): Promise<{ ok: true }> =>
    api.post(`/api/v1/tests/${testId}/ac-source/apply`).then((r) => r.data),

  undo: (testId: string): Promise<{ ok: true }> =>
    api.post(`/api/v1/tests/${testId}/ac-source/undo`).then((r) => r.data),

  listSections: (testId: string, body: { installId: string; docId: string; pageId: string }):
    Promise<{ pageTitle: string; externalUrl: string; sections: PageSection[] }> =>
    api.post(`/api/v1/tests/${testId}/ac-source/sections`, body).then((r) => r.data),

  listSectionItems: (testId: string, body: { installId: string; docId: string; pageId: string; sectionSlug: string | null }):
    Promise<{ items: SectionItem[] }> =>
    api.post(`/api/v1/tests/${testId}/ac-source/section-items`, body).then((r) => r.data),
};

export const notesApi = {
  get: (projectId: string): Promise<{ content: string }> =>
    api.get(`/api/v1/projects/${projectId}/notes/me`).then(r => r.data),
  save: (projectId: string, content: string): Promise<{ content: string }> =>
    api.put(`/api/v1/projects/${projectId}/notes/me`, { content }).then(r => r.data),
};

export type TestNote = { content: string; updatedAt: string | null; lastEditedBy: string | null };
export const testNotesApi = {
  get: (testId: string): Promise<TestNote> =>
    api.get(`/api/v1/tests/${testId}/notes`).then(r => r.data),
  save: (testId: string, content: string): Promise<TestNote> =>
    api.put(`/api/v1/tests/${testId}/notes`, { content }).then(r => r.data),
  presence: (featureId: string): Promise<string[]> =>
    api.get(`/api/v1/features/${featureId}/test-notes-presence`).then(r => r.data),
};

export const notificationsApi = {
  list: (params?: { unreadOnly?: boolean; page?: number; limit?: number }) =>
    api.get('/api/v1/notifications', { params }).then(r => r.data),
  unreadCount: () =>
    api.get('/api/v1/notifications/unread-count').then(r => r.data as { count: number }),
  markRead: (id: string) =>
    api.patch(`/api/v1/notifications/${id}/read`).then(r => r.data),
  markAllRead: () =>
    api.patch('/api/v1/notifications/mark-all-read').then(r => r.data),
};

// ─── Test recorder ──────────────────────────────────────────────────────────
//
// Creates a short-lived pairing session that the Chrome extension joins via
// a 6-char code. See apps/api/src/modules/recorder/ and the
// apps/recorder-extension package for the other ends.

export const recorderApi = {
  createSession: () =>
    api.post('/api/v1/recorder/sessions').then(r => r.data as {
      id: string;
      code: string;
      expiresAt: string;
    }),
};

// ─── Active sessions (org-admin) ─────────────────────────────────────────────
//
// Org-admin visibility + control over open manual test sessions. The escape
// hatch when a tester's session lingers as RUNNING/PAUSED and blocks new ones.

export interface ActiveSession {
  id: string;
  status: string;
  startedAt: string | null;
  createdAt: string;
  lastHeartbeatAt: string | null;
  featureId: string;
  featureName: string;
  moduleName: string;
  projectId: string;
  user: { id: string; name: string; email: string } | null;
}

export const activeSessionsApi = {
  list: (orgId: string) =>
    api.get(`/api/v1/orgs/${orgId}/active-sessions`).then(r => r.data as ActiveSession[]),
  end: (orgId: string, id: string) =>
    api.post(`/api/v1/orgs/${orgId}/active-sessions/${id}/end`).then(r => r.data as { ended: number }),
  endAll: (orgId: string) =>
    api.post(`/api/v1/orgs/${orgId}/active-sessions/end-all`).then(r => r.data as { ended: number }),
};
