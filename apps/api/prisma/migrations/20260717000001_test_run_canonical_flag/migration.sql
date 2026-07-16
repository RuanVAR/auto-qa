-- Result isolation, decided at creation time: stage runs of a pipeline with
-- updatesFeatureStatus=false are excluded from canonical rollups
-- (latest-status / stats / flaky / analytics) via this flag. Stamped rather
-- than derived per query so an opted-in pipeline's runs count normally and a
-- later toggle can't rewrite history.
ALTER TABLE "test_runs" ADD COLUMN "excludedFromCanonical" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "test_runs_excludedFromCanonical_idx" ON "test_runs"("excludedFromCanonical");
