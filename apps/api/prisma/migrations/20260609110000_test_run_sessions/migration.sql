-- Named manual Test Runs (TestRunSession) — umbrella over per-feature runs.
-- Scoped to ONLY the TestRunSession additions; pre-existing drift columns
-- (environments.slowMoMs, test_definitions.authoringMethod/recordedAt/...) are
-- intentionally left untouched here.

-- CreateEnum
CREATE TYPE "RunSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- AlterTable
ALTER TABLE "test_runs" ADD COLUMN "testRunSessionId" TEXT;
ALTER TABLE "feature_runs" ADD COLUMN "testRunSessionId" TEXT;
ALTER TABLE "issues" ADD COLUMN "testRunSessionId" TEXT;

-- CreateTable
CREATE TABLE "test_run_sessions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RunSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "lastHeartbeatAt" TIMESTAMP(3),
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,
    "startedFromFeatureId" TEXT,
    "environmentId" TEXT,
    "createdById" TEXT,

    CONSTRAINT "test_run_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_run_sessions_projectId_status_idx" ON "test_run_sessions"("projectId", "status");
CREATE INDEX "test_run_sessions_createdById_startedAt_idx" ON "test_run_sessions"("createdById", "startedAt");
CREATE INDEX "test_run_sessions_status_lastHeartbeatAt_idx" ON "test_run_sessions"("status", "lastHeartbeatAt");
CREATE INDEX "feature_runs_testRunSessionId_idx" ON "feature_runs"("testRunSessionId");
CREATE INDEX "issues_testRunSessionId_idx" ON "issues"("testRunSessionId");
CREATE INDEX "test_runs_testRunSessionId_status_idx" ON "test_runs"("testRunSessionId", "status");

-- AddForeignKey
ALTER TABLE "test_run_sessions" ADD CONSTRAINT "test_run_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_run_sessions" ADD CONSTRAINT "test_run_sessions_startedFromFeatureId_fkey" FOREIGN KEY ("startedFromFeatureId") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "test_run_sessions" ADD CONSTRAINT "test_run_sessions_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "test_run_sessions" ADD CONSTRAINT "test_run_sessions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_testRunSessionId_fkey" FOREIGN KEY ("testRunSessionId") REFERENCES "test_run_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "feature_runs" ADD CONSTRAINT "feature_runs_testRunSessionId_fkey" FOREIGN KEY ("testRunSessionId") REFERENCES "test_run_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_testRunSessionId_fkey" FOREIGN KEY ("testRunSessionId") REFERENCES "test_run_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
