-- ── Issue.category column ────────────────────────────────────────────────
-- Re-uses the TestFailureCategory enum so bug-cause analytics and
-- test-failure-cause analytics live on the same axis (same donut, same
-- top-N lists). Optional at the column level for safe rollback; the
-- service stamps 'FUNCTIONALITY' on create when not provided.
ALTER TABLE "issues"
  ADD COLUMN "category" "TestFailureCategory";

-- Backfill existing rows to FUNCTIONALITY so the org-analytics donut
-- starts with a sensible default for every row.
UPDATE "issues" SET "category" = 'FUNCTIONALITY' WHERE "category" IS NULL;

-- ── Hot-query indexes for the org analytics endpoints ────────────────────
-- The analytics donut + leaderboard rely on groupBy({ failureCategory })
-- and groupBy({ category }). Without compound indexes those become
-- sequential scans on big projects.
CREATE INDEX "test_runs_projectId_status_failureCategory_idx"
  ON "test_runs"("projectId", "status", "failureCategory");

CREATE INDEX "test_runs_projectId_failureCategory_createdAt_idx"
  ON "test_runs"("projectId", "failureCategory", "createdAt" DESC);

CREATE INDEX "issues_projectId_category_status_idx"
  ON "issues"("projectId", "category", "status");
