-- CreateTable: FeaturePhase (stub for future testing-phases feature)
CREATE TABLE IF NOT EXISTS "feature_phases" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'QA',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_phases_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add featurePhaseId to feature_runs
ALTER TABLE "feature_runs" ADD COLUMN IF NOT EXISTS "featurePhaseId" TEXT;

-- AddForeignKey (deferred — table may be empty now)
ALTER TABLE "feature_runs" ADD CONSTRAINT "feature_runs_featurePhaseId_fkey"
  FOREIGN KEY ("featurePhaseId") REFERENCES "feature_phases"("id")
  ON UPDATE CASCADE ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
