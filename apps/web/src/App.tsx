import { Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { ProtectedRoute, PlatformAdminRoute } from './components/auth/ProtectedRoute';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { SsoCallbackPage } from './pages/auth/SsoCallbackPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProjectsPage } from './pages/projects/ProjectsPage';
import { ProjectDetailPage } from './pages/projects/ProjectDetailPage';
import { ProjectAccessPage } from './pages/projects/ProjectAccessPage';
import ProjectTransferPage from './pages/projects/ProjectTransferPage';
import { SignoffPage } from './pages/projects/SignoffPage';
import { FeatureSignoffPage } from './pages/projects/FeatureSignoffPage';
import { TestsPage } from './pages/tests/TestsPage';
import { TestEditorPage } from './pages/tests/TestEditorPage';
import { RecorderPage } from './pages/tests/RecorderPage';
import { RunsPage } from './pages/runs/RunsPage';
import { RunDetailPage } from './pages/runs/RunDetailPage';
import { TestRunsPage } from './pages/runs/TestRunsPage';
import { TestRunDetailPage } from './pages/runs/TestRunDetailPage';
import { EnvironmentsPage } from './pages/environments/EnvironmentsPage';
import { AiPage } from './pages/ai/AiPage';
import { ModulesPage } from './pages/modules/ModulesPage';
import { FeaturesPage } from './pages/modules/FeaturesPage';
import { FeaturePage } from './pages/modules/FeaturePage';
import { AdminPage } from './pages/admin/AdminPage';
import { AdminOrgDetailPage } from './pages/admin/AdminOrgDetailPage';
import { AdminOrgsPage } from './pages/admin/AdminOrgsPage';
import { OrgTeamPage } from './pages/org/OrgTeamPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { OrgAccessRequestsPage } from './pages/org/OrgAccessRequestsPage';
import OrgTransfersPage from './pages/org/OrgTransfersPage';
import { InviteAcceptPage } from './pages/org/InviteAcceptPage';
import OrgSettingsPage from './pages/org/OrgSettingsPage';
import { OrgAnalyticsPage } from './pages/org/OrgAnalyticsPage';
import OrgAiSettingsPage from './pages/org/OrgAiSettingsPage';
import OrgGitHubSettingsPage from './pages/org/OrgGitHubSettingsPage';
import OrgAiAuditPage from './pages/org/OrgAiAuditPage';
import OrgAuditPage from './pages/org/OrgAuditPage';
import OrgActiveSessionsPage from './pages/org/OrgActiveSessionsPage';
import OrgBrandingPage from './pages/org/OrgBrandingPage';
import OrgGeneralPage from './pages/org/OrgGeneralPage';
import PluginsPage from './pages/org/PluginsPage';
import { IssuePage } from './pages/issues/IssuePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { TestingView } from './pages/testing/TestingView';
import { TestApp } from './pages/testapp/TestApp';
import { Toaster } from './components/ui/Toast';

export default function App() {
  return (
    <ErrorBoundary>
      <Toaster />
      <Routes>
        {/* Full-screen routes — NO Shell wrapper */}
        <Route
          path="/invites/:token/accept"
          element={<InviteAcceptPage />}
        />
        <Route
          path="/projects/:projectId/features/:featureId/test"
          element={
            <ProtectedRoute>
              <TestingView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/:projectId/features/:featureId/record"
          element={
            <ProtectedRoute>
              <RecorderPage />
            </ProtectedRoute>
          }
        />

        {/* Public test target app — no auth required, used as environment baseUrl for QA runs */}
        <Route path="/testapp/*" element={<TestApp />} />

        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/callback" element={<SsoCallbackPage />} />

        {/* Protected app shell */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Shell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="projects/:projectId/access" element={<ProjectAccessPage />} />
          <Route path="projects/:projectId/transfer" element={<ProjectTransferPage />} />
          <Route path="projects/:projectId/sign-off" element={<SignoffPage />} />
          <Route path="projects/:projectId/sign-off/features/:featureId/environments/:envId" element={<FeatureSignoffPage />} />
          <Route path="projects/:projectId/tests" element={<TestsPage />} />
          <Route path="projects/:projectId/tests/:testId/edit" element={<TestEditorPage />} />
          <Route path="projects/:projectId/runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunDetailPage />} />
          {/* Named manual Test Runs (sessions) */}
          <Route path="projects/:projectId/test-runs" element={<TestRunsPage />} />
          <Route path="projects/:projectId/test-runs/:id" element={<TestRunDetailPage />} />
          <Route path="projects/:projectId/environments" element={<EnvironmentsPage />} />
          {/* Module & Feature hierarchy */}
          <Route path="projects/:projectId/modules" element={<ModulesPage />} />
          <Route path="projects/:projectId/modules/:moduleId/features" element={<FeaturesPage />} />
          <Route path="projects/:projectId/modules/:moduleId/features/:featureId" element={<FeaturePage />} />
          {/* AI */}
          <Route path="ai" element={<AiPage />} />
          {/* Settings */}
          <Route path="settings" element={<SettingsPage />} />
          {/* Org */}
          <Route path="org" element={<OrgSettingsPage />} />
          <Route path="org/general" element={<OrgGeneralPage />} />
          <Route path="org/access-requests" element={<OrgAccessRequestsPage />} />
          <Route path="org/transfers" element={<OrgTransfersPage />} />
          <Route path="org/team" element={<OrgTeamPage />} />
          <Route path="org/plugins" element={<PluginsPage />} />
          <Route path="org/branding" element={<OrgBrandingPage />} />
          <Route path="org/ai-settings" element={<OrgAiSettingsPage />} />
          <Route path="org/github" element={<OrgGitHubSettingsPage />} />
          <Route path="org/ai-audit" element={<OrgAiAuditPage />} />
          <Route path="org/audit" element={<OrgAuditPage />} />
          <Route path="org/active-sessions" element={<OrgActiveSessionsPage />} />
          <Route path="org/analytics" element={<OrgAnalyticsPage />} />
          {/* Admin — platform admin only */}
          <Route
            path="admin"
            element={
              <PlatformAdminRoute>
                <AdminPage />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="admin/orgs/:orgId"
            element={
              <PlatformAdminRoute>
                <AdminOrgDetailPage />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="admin/organisations"
            element={
              <PlatformAdminRoute>
                <AdminOrgsPage />
              </PlatformAdminRoute>
            }
          />
          {/* Issue viewer */}
          <Route path="issues/:issueId" element={<IssuePage />} />
          {/* 404 — catch-all */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
