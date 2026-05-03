-- TestRun hot-query indexes
CREATE INDEX IF NOT EXISTS "test_runs_featureRunId_status_idx" ON "test_runs"("featureRunId", "status");
CREATE INDEX IF NOT EXISTS "test_runs_status_createdAt_idx" ON "test_runs"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "test_runs_environmentId_projectId_idx" ON "test_runs"("environmentId", "projectId");
CREATE INDEX IF NOT EXISTS "test_runs_testDefinitionId_completedAt_idx" ON "test_runs"("testDefinitionId", "completedAt");
CREATE INDEX IF NOT EXISTS "test_runs_triggeredById_createdAt_idx" ON "test_runs"("triggeredById", "createdAt");

-- FeatureRun hot-query indexes
CREATE INDEX IF NOT EXISTS "feature_runs_featureId_status_idx" ON "feature_runs"("featureId", "status");
CREATE INDEX IF NOT EXISTS "feature_runs_status_lastHeartbeatAt_idx" ON "feature_runs"("status", "lastHeartbeatAt");
CREATE INDEX IF NOT EXISTS "feature_runs_featureId_createdAt_idx" ON "feature_runs"("featureId", "createdAt");

-- Issue hot-query indexes
CREATE INDEX IF NOT EXISTS "issues_assignedToId_status_idx" ON "issues"("assignedToId", "status");
CREATE INDEX IF NOT EXISTS "issues_testRunId_idx" ON "issues"("testRunId");
CREATE INDEX IF NOT EXISTS "issues_projectId_createdAt_idx" ON "issues"("projectId", "createdAt");
