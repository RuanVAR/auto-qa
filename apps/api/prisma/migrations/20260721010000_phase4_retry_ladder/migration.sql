-- Phase 4.2 — De-parallelising retry ladder
-- (docs/plan/06-PHASE-4-SCALE.md §4.2). Hand-written for the same reason as
-- the other Phase 4 migrations (unrelated pre-existing drift filtered out).

ALTER TABLE "features" ADD COLUMN "retryLadderEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "feature_runs" ADD COLUMN "retryLadderEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "currentLadderAttempt" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "test_runs" ADD COLUMN "ladderAttempt" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "passedAtAttempt" INTEGER;
