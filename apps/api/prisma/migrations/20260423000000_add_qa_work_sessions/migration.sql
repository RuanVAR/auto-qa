-- AlterTable
ALTER TABLE "issues" ADD COLUMN     "workSessionId" TEXT;

-- AlterTable
ALTER TABLE "test_runs" ADD COLUMN     "workSessionId" TEXT;

-- CreateTable
CREATE TABLE "qa_work_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedReason" TEXT,
    "lastTestDefinitionId" TEXT,
    "lastFeatureId" TEXT,
    "lastModuleId" TEXT,
    "lastProjectId" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "lastActivityType" TEXT,

    CONSTRAINT "qa_work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qa_work_sessions_userId_orgId_endedAt_idx" ON "qa_work_sessions"("userId", "orgId", "endedAt");

-- CreateIndex
CREATE INDEX "qa_work_sessions_orgId_startedAt_idx" ON "qa_work_sessions"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "issues_workSessionId_idx" ON "issues"("workSessionId");

-- CreateIndex
CREATE INDEX "test_runs_workSessionId_idx" ON "test_runs"("workSessionId");

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "qa_work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "qa_work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_work_sessions" ADD CONSTRAINT "qa_work_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_work_sessions" ADD CONSTRAINT "qa_work_sessions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
