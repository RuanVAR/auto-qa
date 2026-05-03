-- ── OrgInvite: pre-scoped project + env assignments ──────────────────────────
ALTER TABLE "org_invites"
  ADD COLUMN "projectAssignments" JSONB;

-- ── FeatureRun: handover trail ────────────────────────────────────────────────
ALTER TABLE "feature_runs"
  ADD COLUMN "promotedFromId" TEXT;

ALTER TABLE "feature_runs"
  ADD CONSTRAINT "feature_runs_promotedFromId_fkey"
    FOREIGN KEY ("promotedFromId") REFERENCES "feature_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "feature_runs_promotedFromId_idx" ON "feature_runs"("promotedFromId");

-- ── PhaseSignoff: per-env audit of QA→UAT decisions ───────────────────────────
CREATE TYPE "SignoffDecision" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "phase_signoffs" (
  "id"            TEXT NOT NULL,
  "decision"      "SignoffDecision" NOT NULL,
  "note"          TEXT,
  "signedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "featureRunId"  TEXT NOT NULL,
  "environmentId" TEXT NOT NULL,
  "signedById"    TEXT NOT NULL,
  CONSTRAINT "phase_signoffs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "phase_signoffs_featureRunId_signedAt_idx" ON "phase_signoffs"("featureRunId", "signedAt");

ALTER TABLE "phase_signoffs"
  ADD CONSTRAINT "phase_signoffs_featureRunId_fkey"
    FOREIGN KEY ("featureRunId") REFERENCES "feature_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "phase_signoffs"
  ADD CONSTRAINT "phase_signoffs_environmentId_fkey"
    FOREIGN KEY ("environmentId") REFERENCES "environments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "phase_signoffs"
  ADD CONSTRAINT "phase_signoffs_signedById_fkey"
    FOREIGN KEY ("signedById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
