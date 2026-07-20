-- Phase 4.5 — Fail-fast / auto-cancellation
-- (docs/plan/06-PHASE-4-SCALE.md §4.5). Hand-written for the same reason as
-- the other Phase 4 migrations (unrelated pre-existing drift filtered out).

ALTER TABLE "features" ADD COLUMN "failFast" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "feature_runs" ADD COLUMN "failFast" BOOLEAN NOT NULL DEFAULT false;
