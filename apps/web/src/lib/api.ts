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

function clearLocalAuthAndRedirect() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
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
  list: () => api.get('/api/v1/projects').then(r => r.data),
  get: (id: string) => api.get(`/api/v1/projects/${id}`).then(r => r.data),
  create: (data: object) => api.post('/api/v1/projects', data).then(r => r.data),
  update: (id: string, data: object) => api.put(`/api/v1/projects/${id}`, data).then(r => r.data),
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
};
export const testsApi = {
  list: (projectId: string, featureId?: string) =>
    api.get(`/api/v1/projects/${projectId}/tests`, { params: featureId ? { featureId } : undefined }).then(r => r.data),
  get: (projectId: string, id: string) => api.get(`/api/v1/projects/${projectId}/tests/${id}`).then(r => r.data),
  create: (projectId: string, data: object) => api.post(`/api/v1/projects/${projectId}/tests`, data).then(r => r.data),
  update: (projectId: string, id: string, data: object) => api.put(`/api/v1/projects/${projectId}/tests/${id}`, data).then(r => r.data),
  duplicate: (id: string) => api.post(`/api/v1/tests/${id}/duplicate`).then(r => r.data),
  appendSteps: (_projectId: string, id: string, body: {
    steps: Array<Record<string, unknown>>;
    meta?: { recordedAt?: string; recordedDurationSec?: number };
  }) => api.post(`/api/v1/tests/${id}/append-steps`, body).then(r => r.data),
  /**
   * Quick-mark a test as PASSED/FAILED without entering test mode.
   * Creates a lightweight TestRun (no RunSteps) and attaches to the current
   * QA work session.
   */
  mark: (testDefinitionId: string, data: { status: 'PASSED' | 'FAILED'; notes?: string; environmentId?: string }) =>
    api.post(`/api/v1/tests/${testDefinitionId}/mark`, data).then(r => r.data),
  /**
   * Returns the latest TestRun result per testDefinitionId for a feature.
   * Covers quick-mark, manual, and automated runs — not just FeatureRun data.
   */
  getLatestStatuses: (featureId: string, envId?: string | null) =>
    api.get(`/api/v1/features/${featureId}/test-statuses`, {
      params: envId ? { envId } : undefined,
    }).then(r => r.data as Array<{ testDefinitionId: string; status: string; completedAt: string; environmentId: string | null }>),
};
export const runsApi = {
  list: (projectId: string) => api.get(`/api/v1/projects/${projectId}/runs`).then(r => r.data),
  get: (id: string) => api.get(`/api/v1/runs/${id}`).then(r => r.data),
  stats: (projectId: string) => api.get(`/api/v1/projects/${projectId}/runs/stats`).then(r => r.data),
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
  markTestRunStatus: (runId: string, data: { status: 'PASSED' | 'FAILED' | 'SKIPPED'; notes?: string }) =>
    api.patch(`/api/v1/runs/${runId}/status`, data).then(r => r.data),
};
export const runsApiFiltered = {
  list: (projectId: string, params?: { status?: string; testId?: string; envId?: string; page?: number; limit?: number }) =>
    api.get(`/api/v1/projects/${projectId}/runs`, { params }).then(r => r.data),
};
export const artifactsApi = { list: (runId: string) => api.get(`/api/v1/runs/${runId}/artifacts`).then(r => r.data) };
export const modulesApi = {
  list: (projectId: string) => api.get(`/api/v1/projects/${projectId}/modules`).then(r => r.data),
  listFeatures: (moduleId: string) => api.get(`/api/v1/modules/${moduleId}/features`).then(r => r.data),
  create: (projectId: string, data: object) => api.post(`/api/v1/projects/${projectId}/modules`, data).then(r => r.data),
  update: (projectId: string, id: string, data: object) => api.put(`/api/v1/projects/${projectId}/modules/${id}`, data).then(r => r.data),
  remove: (projectId: string, id: string) => api.delete(`/api/v1/projects/${projectId}/modules/${id}`).then(r => r.data),
};
export const featuresApi = {
  list: (moduleId: string) => api.get(`/api/v1/modules/${moduleId}/features`).then(r => r.data),
  get: (id: string) => api.get(`/api/v1/features/${id}`).then(r => r.data),
  create: (moduleId: string, data: object) => api.post(`/api/v1/modules/${moduleId}/features`, data).then(r => r.data),
  update: (id: string, data: object) => api.put(`/api/v1/features/${id}`, data).then(r => r.data),
  draftStatus: (id: string) => api.get(`/api/v1/features/${id}/draft-status`).then(r => r.data),
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
};

export const adminApi = {
  getStats: () => api.get('/api/v1/admin/stats').then(r => r.data),
  getOrgDetail: (orgId: string) => api.get(`/api/v1/admin/orgs/${orgId}`).then(r => r.data),
  getAuditLogs: (page = 1, limit = 10) => api.get(`/api/v1/admin/audit-logs?page=${page}&limit=${limit}`).then(r => r.data),
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
    assignedToId?: string; search?: string; page?: number; limit?: number;
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
    format?: 'HTML' | 'PDF';
    /** Optional list of email addresses — when present + non-empty, the
     *  rendered report is sent immediately after generation. */
    recipientEmails?: string[];
    /** Optional free-form note appended into the generated report. */
    additionalText?: string;
  }) =>
    api.post(`/api/v1/projects/${projectId}/reports/generate`, dto).then(r => r.data),

  /** Pre-populated recipient list for the Generate-and-Email modal —
   *  ORG_ADMINs + project OWNER/TECH_LEAD/MANAGER. */
  defaultRecipients: (projectId: string): Promise<Array<{ email: string; name: string | null; role: string }>> =>
    api.get(`/api/v1/projects/${projectId}/report-default-recipients`).then(r => r.data),

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
   * Push a platform Issue to ClickUp as a ticket. Wraps:
   *   - cascade resolution (where does this land?)
   *   - createIssue dispatch
   *   - attach evidence (best-effort, falls back to URL list in description)
   *   - TicketLink persisted with issueId
   */
  pushIssue: (issueId: string): Promise<{ ok: boolean; externalId: string; externalUrl: string; attachments: unknown }> =>
    api.post(`/api/v1/issues/${issueId}/push-to-clickup`).then((r) => r.data),

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
      parent?: { spaceId?: string; folderId?: string; listId?: string };
    },
  ): Promise<{ items: Array<{ externalId: string; externalUrl: string; title: string; summary?: string; pageId?: string }> }> =>
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
