-- Ephemeral "Preview" runs — triggered from the test editor's Preview
-- button so a tester can watch a test execute live without polluting
-- history / pass rate / per-test badges. Filtered out of every history
-- and stats query in code; the column exists purely as a marker.

ALTER TABLE "test_runs"
  ADD COLUMN "isPreview" BOOLEAN NOT NULL DEFAULT false;

-- Most queries that surface history additionally filter isPreview=false.
-- Index on (projectId, isPreview, createdAt) keeps "show me real runs in
-- this project, newest first" fast even after preview rows accumulate.
CREATE INDEX "test_runs_projectId_isPreview_createdAt_idx"
  ON "test_runs" ("projectId", "isPreview", "createdAt" DESC);
