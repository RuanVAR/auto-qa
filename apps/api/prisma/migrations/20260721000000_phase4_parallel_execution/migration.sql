-- Phase 4.1 — Parallel test execution within a run
-- (docs/plan/06-PHASE-4-SCALE.md §4.1). Hand-written: the raw
-- `prisma migrate diff` also contains unrelated pre-existing drift
-- (authoringMethod/recordedAt/recordedDurationSec/slowMoMs — tracked
-- separately) that must not be included here.

ALTER TABLE "features" ADD COLUMN "concurrency" INTEGER;

ALTER TABLE "feature_runs" ADD COLUMN "concurrency" INTEGER;

ALTER TABLE "test_definitions" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
