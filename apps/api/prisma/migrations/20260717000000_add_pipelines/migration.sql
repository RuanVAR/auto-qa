-- Pipelines: ordered multi-feature automated runs, triggerable as one unit.
-- A stage execution IS a FeatureRun (back-link below); results are isolated
-- from canonical feature stats by default via TestRun."pipelineRunId".

CREATE TYPE "StageFailurePolicy" AS ENUM ('HALT', 'CONTINUE');
CREATE TYPE "PipelineRunStatus" AS ENUM ('RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED');

CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "updatesFeatureStatus" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pipelines_projectId_name_key" ON "pipelines"("projectId", "name");
CREATE INDEX "pipelines_projectId_idx" ON "pipelines"("projectId");

CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "featureId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "onFailure" "StageFailurePolicy" NOT NULL DEFAULT 'HALT',
    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pipeline_stages_pipelineId_order_key" ON "pipeline_stages"("pipelineId", "order");

CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "status" "PipelineRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "stagesSnapshot" JSONB NOT NULL,
    "currentStageOrder" INTEGER NOT NULL DEFAULT 0,
    "stageResults" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pipeline_runs_pipelineId_startedAt_idx" ON "pipeline_runs"("pipelineId", "startedAt");
CREATE INDEX "pipeline_runs_status_idx" ON "pipeline_runs"("status");

ALTER TABLE "pipelines"
  ADD CONSTRAINT "pipelines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "pipelines_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pipeline_stages"
  ADD CONSTRAINT "pipeline_stages_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "pipeline_stages_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "pipeline_stages_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pipeline_runs"
  ADD CONSTRAINT "pipeline_runs_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "pipeline_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FeatureRun back-link: evidence outlives the pipeline-run record (SET NULL).
ALTER TABLE "feature_runs" ADD COLUMN "pipelineRunId" TEXT;
ALTER TABLE "feature_runs"
  ADD CONSTRAINT "feature_runs_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "pipeline_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "feature_runs_pipelineRunId_idx" ON "feature_runs"("pipelineRunId");

-- TestRun denormalized copy — lets canonical-stats queries exclude pipeline
-- stage runs without a join (no FK: the FeatureRun link is authoritative).
ALTER TABLE "test_runs" ADD COLUMN "pipelineRunId" TEXT;

-- RunSchedule: target becomes feature XOR pipeline (service-enforced).
-- Pipeline schedules carry no single environment (env lives per stage).
ALTER TABLE "run_schedules" ALTER COLUMN "featureId" DROP NOT NULL;
ALTER TABLE "run_schedules" ALTER COLUMN "environmentId" DROP NOT NULL;
ALTER TABLE "run_schedules" ADD COLUMN "pipelineId" TEXT;
ALTER TABLE "run_schedules"
  ADD CONSTRAINT "run_schedules_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
