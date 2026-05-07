-- Drop the FK from feature_runs first
ALTER TABLE "feature_runs" DROP CONSTRAINT IF EXISTS "feature_runs_featurePhaseId_fkey";

-- Drop the stub table with wrong columns
DROP TABLE IF EXISTS "feature_phases";

-- Recreate with correct schema matching Prisma model
CREATE TABLE "feature_phases" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "status" "PhaseStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "promotedAt" TIMESTAMP(3),
    "promotedById" TEXT,
    "notes" TEXT,
    "handoverSentTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "handoverSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_phases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_phases_featureId_phaseId_key" ON "feature_phases"("featureId", "phaseId");

-- Foreign keys
ALTER TABLE "feature_phases" ADD CONSTRAINT "feature_phases_featureId_fkey"
    FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "feature_phases" ADD CONSTRAINT "feature_phases_phaseId_fkey"
    FOREIGN KEY ("phaseId") REFERENCES "project_phases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "feature_phases" ADD CONSTRAINT "feature_phases_promotedById_fkey"
    FOREIGN KEY ("promotedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Restore FK from feature_runs
ALTER TABLE "feature_runs" ADD CONSTRAINT "feature_runs_featurePhaseId_fkey"
    FOREIGN KEY ("featurePhaseId") REFERENCES "feature_phases"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
