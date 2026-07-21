-- Phase 3 completion: persistent failure resolution, quarantine lifecycle,
-- CI commit attribution, and browser diagnostic artifacts. This is additive
-- by design; historical schema drift must not cause populated columns to drop.

CREATE TYPE "FailureResolution" AS ENUM ('UNRESOLVED', 'DEFECT', 'MUTED');
CREATE TYPE "DefectStatus" AS ENUM ('OPEN', 'RESOLVED', 'CLOSED');
CREATE TYPE "QuarantineStatus" AS ENUM ('ACTIVE', 'QUARANTINED');

ALTER TYPE "ArtifactType" ADD VALUE IF NOT EXISTS 'CONSOLE_LOG';
ALTER TYPE "ArtifactType" ADD VALUE IF NOT EXISTS 'NETWORK_LOG';

ALTER TABLE "test_definitions"
  ADD COLUMN "quarantineStatus" "QuarantineStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "quarantinedAt" TIMESTAMP(3),
  ADD COLUMN "quarantineReason" TEXT,
  ADD COLUMN "healthyRunsSince" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "test_runs"
  ADD COLUMN "commitSha" TEXT,
  ADD COLUMN "branch" TEXT;

ALTER TABLE "feature_runs"
  ADD COLUMN "commitSha" TEXT,
  ADD COLUMN "branch" TEXT;

ALTER TABLE "run_steps"
  ADD COLUMN "resolution" "FailureResolution" NOT NULL DEFAULT 'UNRESOLVED',
  ADD COLUMN "muteReason" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedById" TEXT;

CREATE TABLE "defects" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "testDefinitionId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "DefectStatus" NOT NULL DEFAULT 'OPEN',
  "messagePattern" TEXT,
  "stackPattern" TEXT,
  "stepTypeIn" "StepType"[] NOT NULL DEFAULT ARRAY[]::"StepType"[],
  "category" "TriageBucket",
  "issueId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "defects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "defect_matches" (
  "id" TEXT NOT NULL,
  "defectId" TEXT NOT NULL,
  "testRunId" TEXT NOT NULL,
  "runStepId" TEXT NOT NULL,
  "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "defect_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "defect_matches_defectId_runStepId_key" ON "defect_matches"("defectId", "runStepId");
CREATE INDEX "defects_projectId_status_idx" ON "defects"("projectId", "status");
CREATE INDEX "defects_testDefinitionId_idx" ON "defects"("testDefinitionId");
CREATE INDEX "defect_matches_testRunId_idx" ON "defect_matches"("testRunId");

ALTER TABLE "defects"
  ADD CONSTRAINT "defects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "defects_testDefinitionId_fkey" FOREIGN KEY ("testDefinitionId") REFERENCES "test_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "defects_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "defect_matches"
  ADD CONSTRAINT "defect_matches_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "defects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "defect_matches_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "defect_matches_runStepId_fkey" FOREIGN KEY ("runStepId") REFERENCES "run_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
