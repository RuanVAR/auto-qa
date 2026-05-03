import axios from 'axios';

export const API_BASE = (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? 'http://localhost:3001';

export const api = axios.create({ baseURL: API_BASE, headers: { 'Content-Type': 'application/json' } });
api.interceptors.request.use((c) => { const t = localStorage.getItem('access_token'); if (t) c.headers.Authorization = `Bearer ${t}`; return c; });

// ─── Response interceptor — handle token expiry ──────────────────────────────
// On any 401 response (token expired or invalid), clear local auth, attempt
// to end the active work session (best-effort), then redirect to login.
// This runs once per response — re-entry is guarded by checking the current
// path so we don't redirect loop on the login page itself.
let _handling401 = false;
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const status = error?.response?.status;
    if (status === 401 && !_handling401) {
      _handling401 = true;
      try {
        // Best-effort: tell the backend to end the session with 'token-expired'
        // reason. We use a separate axios call to avoid re-entering the
        // interceptor if this also 401s.
        await axios.post(`${API_BASE}/api/v1/work-sessions/end`,
          { reason: 'token-expired' },
          { headers: { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` } },
        ).catch(() => {});
      } finally {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        _handling401 = false;
      }
    }
    return Promise.reject(error);
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
  list: (projectId: string) => api.get(`/api/v1/projects/${projectId}/environments`).then(r => r.data),
  create: (projectId: string, data: object) => api.post(`/api/v1/projects/${projectId}/environments`, data).then(r => r.data),
};
export const testsApi = {
  list: (projectId: string, featureId?: string) =>
    api.get(`/api/v1/projects/${projectId}/tests`, { params: featureId ? { featureId } : undefined }).then(r => r.data),
  get: (projectId: string, id: string) => api.get(`/api/v1/projects/${projectId}/tests/${id}`).then(r => r.data),
  create: (projectId: string, data: object) => api.post(`/api/v1/projects/${projectId}/tests`, data).then(r => r.data),
  update: (projectId: string, id: string, data: object) => api.put(`/api/v1/projects/${projectId}/tests/${id}`, data).then(r => r.data),
  duplicate: (id: string) => api.post(`/api/v1/tests/${id}/duplicate`).then(r => r.data),
  /**
   * Quick-mark a test as PASSED/FAILED without entering test mode.
   * Creates a lightweight TestRun (no RunSteps) and attaches to the current
   * QA work session.
   */
  mark: (testDefinitionId: string, data: { status: 'PASSED' | 'FAILED'; notes?: string; environmentId?: string }) =>
    api.post(`/api/v1/tests/${testDefinitionId}/mark`, data).then(r => r.data),
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
  register: (data: { name: string; email: string; password: string; orgName: string }) =>
    api.post('/api/v1/auth/register', data).then(r => r.data),
  login: (data: { email: string; password: string }) =>
    api.post('/api/v1/auth/login', data).then(r => r.data),
  me: () => api.get('/api/v1/auth/me').then(r => r.data),
  switchOrg: (orgId: string) => api.post(`/api/v1/auth/switch-org/${orgId}`).then(r => r.data),
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
};
export const aiApi = {
  explain: (runId: string) => api.post(`/api/v1/ai/runs/${runId}/explain`).then(r => r.data),
  summarise: (runId: string) => api.post(`/api/v1/ai/runs/${runId}/summarise`).then(r => r.data),
  generateTest: (projectId: string, prompt: string) => api.post(`/api/v1/ai/projects/${projectId}/generate-test`, { prompt }).then(r => r.data),
};

export const statsApi = {
  getProjectStats: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/stats`).then(r => r.data),
  getModuleStats: (projectId: string) =>
    api.get(`/api/v1/projects/${projectId}/modules/stats`).then(r => r.data),
  getFeatureStats: (moduleId: string) =>
    api.get(`/api/v1/modules/${moduleId}/features/stats`).then(r => r.data),
  getSingleFeatureStats: (featureId: string) =>
    api.get(`/api/v1/features/${featureId}/stats`).then(r => r.data),
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

  // Comments
  addComment: (issueId: string, content: string) =>
    api.post(`/api/v1/issues/${issueId}/comments`, { content }).then(r => r.data),
  deleteComment: (commentId: string) =>
    api.delete(`/api/v1/issues/comments/${commentId}`).then(r => r.data),
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
    type: 'FEATURE' | 'MODULE' | 'PROJECT' | 'PHASE';
    featureId?: string; moduleId?: string; phaseId?: string; environmentId?: string;
    includeSession?: boolean; includeFeature?: boolean; includeProject?: boolean;
    includeCharts?: boolean;
    format?: 'HTML' | 'PDF';
  }) =>
    api.post(`/api/v1/projects/${projectId}/reports/generate`, dto).then(r => r.data),

  // History
  list: (projectId: string, params?: { type?: string; environmentId?: string; limit?: number }) =>
    api.get(`/api/v1/projects/${projectId}/reports`, { params }).then(r => r.data),
  get: (id: string) =>
    api.get(`/api/v1/reports/${id}`).then(r => r.data),

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
