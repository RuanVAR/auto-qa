-- Backfill existing manual skips: they were stored as CANCELLED with a child
-- run_step marked SKIPPED (the old fingerprint). Promote those to the new
-- first-class SKIPPED status. Genuine stopped-run CANCELLEDs (no skipped step)
-- stay CANCELLED.
UPDATE "test_runs" tr
SET "status" = 'SKIPPED'
WHERE tr."status" = 'CANCELLED'
  AND EXISTS (
    SELECT 1 FROM "run_steps" rs
    WHERE rs."runId" = tr."id" AND rs."status" = 'SKIPPED'
  );
