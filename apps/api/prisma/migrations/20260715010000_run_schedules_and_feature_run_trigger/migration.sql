-- How the run started: manual | scheduled | api | ci | promotion.
ALTER TABLE "feature_runs" ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'manual';

-- Recurring AUTOMATED feature runs (cron per feature+env).
CREATE TABLE "run_schedules" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "cronExpr" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastFeatureRunId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "run_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "run_schedules_enabled_nextRunAt_idx" ON "run_schedules"("enabled", "nextRunAt");
CREATE INDEX "run_schedules_projectId_idx" ON "run_schedules"("projectId");

ALTER TABLE "run_schedules" ADD CONSTRAINT "run_schedules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "run_schedules" ADD CONSTRAINT "run_schedules_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "run_schedules" ADD CONSTRAINT "run_schedules_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "run_schedules" ADD CONSTRAINT "run_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
