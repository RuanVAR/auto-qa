-- Phase 2.7: selector healing promotion policy.
-- Auto-application is deliberately opt-in; three matching healed passes is
-- the conservative project default before any selector is promoted.
ALTER TABLE "projects"
  ADD COLUMN "selectorHealAutoApply" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "selectorHealPromotionRuns" INTEGER NOT NULL DEFAULT 3,
  ADD CONSTRAINT "projects_selectorHealPromotionRuns_check"
    CHECK ("selectorHealPromotionRuns" BETWEEN 2 AND 10);

ALTER TABLE "selector_heals"
  ADD COLUMN "autoApplied" BOOLEAN NOT NULL DEFAULT false;
