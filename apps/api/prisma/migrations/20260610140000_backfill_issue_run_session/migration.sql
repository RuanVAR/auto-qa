-- Backfill: link issues logged during a run to their TestRunSession, derived
-- from the issue's testRun. Fixes run-detail bug counts + lists for issues
-- created before issue creation learned to stamp testRunSessionId. Idempotent.
UPDATE "issues" i
SET "testRunSessionId" = tr."testRunSessionId"
FROM "test_runs" tr
WHERE i."testRunId" = tr.id
  AND i."testRunSessionId" IS NULL
  AND tr."testRunSessionId" IS NOT NULL;
