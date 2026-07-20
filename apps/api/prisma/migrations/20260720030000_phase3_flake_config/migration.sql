-- Phase 3.5 — Flake scoring monitor config, per project
-- (docs/plan/05-PHASE-3-INTELLIGENCE.md §3.5). Hand-written for the same
-- reason as the other Phase 2/3 migrations in this series (unrelated
-- pre-existing drift tracked separately).
--
-- Down (on paper): ALTER TABLE projects DROP COLUMN "flakeConfig";

ALTER TABLE "projects" ADD COLUMN "flakeConfig" JSONB NOT NULL
  DEFAULT '{"passOnRetry":true,"transitionCount":true,"failureRate":false,"failureRateThreshold":0.3,"failureRateWindowDays":14}';
