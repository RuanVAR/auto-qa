-- Link a FeatureRun back to the RunSchedule that started it. `trigger` only
-- records THAT a schedule fired, not which one — ambiguous once a feature+env
-- has more than one schedule. SET NULL on delete keeps run history intact.
ALTER TABLE "feature_runs" ADD COLUMN "runScheduleId" TEXT;

ALTER TABLE "feature_runs"
  ADD CONSTRAINT "feature_runs_runScheduleId_fkey"
  FOREIGN KEY ("runScheduleId") REFERENCES "run_schedules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "feature_runs_runScheduleId_createdAt_idx"
  ON "feature_runs"("runScheduleId", "createdAt");

-- Backfill: existing scheduled runs can be attributed where the schedule's
-- lastFeatureRunId still points at them (the only reliable existing link).
UPDATE "feature_runs" fr
SET "runScheduleId" = rs."id"
FROM "run_schedules" rs
WHERE rs."lastFeatureRunId" = fr."id" AND fr."runScheduleId" IS NULL;
