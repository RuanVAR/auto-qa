-- Phase 2 — Selector drift detection (docs/plan/04-PHASE-2-HEALING.md)
--
-- Hand-written rather than `prisma migrate dev`-generated: the raw diff
-- against the live dev DB also included unrelated drops (authoringMethod,
-- recordedAt, recordedDurationSec, slowMoMs, two test_runs indexes) that
-- predate this change and are tracked separately — this migration contains
-- only the Phase 2 additions.
--
-- Down (on paper, not run by Prisma):
--   ALTER TABLE selector_heals DROP CONSTRAINT selector_heals_promotedById_fkey;
--   DROP INDEX selector_heals_testDefinitionId_eligibleForPromotion_promot_idx;
--   DROP INDEX run_steps_testDefinitionId_index_createdAt_idx;
--   ALTER TABLE test_runs DROP COLUMN "healCount";
--   ALTER TABLE selector_heals DROP COLUMN "strategy", DROP COLUMN "eligibleForPromotion",
--     DROP COLUMN "promoted", DROP COLUMN "promotedAt", DROP COLUMN "promotedById";
--   ALTER TABLE run_steps DROP COLUMN "attempts", DROP COLUMN "attemptsToPass",
--     DROP COLUMN "healed", DROP COLUMN "testDefinitionId";
--   ALTER TABLE projects DROP COLUMN "healSensitivity";
--   -- StepStatus.PASSED_HEALED cannot be dropped from a Postgres enum without
--   -- recreating the type; leave it — an unused enum value is inert.

-- AlterEnum
ALTER TYPE "StepStatus" ADD VALUE 'PASSED_HEALED';

-- AlterTable: Project confidence floor
ALTER TABLE "projects" ADD COLUMN "healSensitivity" DOUBLE PRECISION NOT NULL DEFAULT 0.65;

-- AlterTable: TestRun heal visibility
ALTER TABLE "test_runs" ADD COLUMN "healCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: RunStep retry + heal bookkeeping. testDefinitionId is added
-- nullable, backfilled from the parent run, then constrained NOT NULL —
-- expand/migrate/contract per docs/plan/09-CONVENTIONS.md, since existing
-- rows need a value before the constraint can apply.
ALTER TABLE "run_steps" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "run_steps" ADD COLUMN "attemptsToPass" INTEGER;
ALTER TABLE "run_steps" ADD COLUMN "healed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "run_steps" ADD COLUMN "testDefinitionId" TEXT;

UPDATE "run_steps" rs
SET "testDefinitionId" = tr."testDefinitionId"
FROM "test_runs" tr
WHERE tr.id = rs."runId";

ALTER TABLE "run_steps" ALTER COLUMN "testDefinitionId" SET NOT NULL;

CREATE INDEX "run_steps_testDefinitionId_index_createdAt_idx"
  ON "run_steps"("testDefinitionId", "index", "createdAt");

-- AlterTable: SelectorHeal promotion workflow
ALTER TABLE "selector_heals" ADD COLUMN "strategy" TEXT;
ALTER TABLE "selector_heals" ADD COLUMN "eligibleForPromotion" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "selector_heals" ADD COLUMN "promoted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "selector_heals" ADD COLUMN "promotedAt" TIMESTAMP(3);
ALTER TABLE "selector_heals" ADD COLUMN "promotedById" TEXT;

CREATE INDEX "selector_heals_testDefinitionId_eligibleForPromotion_promot_idx"
  ON "selector_heals"("testDefinitionId", "eligibleForPromotion", "promoted");

ALTER TABLE "selector_heals"
  ADD CONSTRAINT "selector_heals_promotedById_fkey"
  FOREIGN KEY ("promotedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
