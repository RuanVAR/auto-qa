-- Add cascade-up scope keys to GeneratedReport so feature-level reports
-- can be queried at module + project scope without joining ReportConfig.
ALTER TABLE "generated_reports"
  ADD COLUMN "moduleId"  TEXT,
  ADD COLUMN "featureId" TEXT;

-- Foreign keys with ON DELETE SET NULL — preserve historical reports even
-- if the feature/module is deleted (audit trail).
ALTER TABLE "generated_reports"
  ADD CONSTRAINT "generated_reports_moduleId_fkey"
    FOREIGN KEY ("moduleId") REFERENCES "modules"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "generated_reports"
  ADD CONSTRAINT "generated_reports_featureId_fkey"
    FOREIGN KEY ("featureId") REFERENCES "features"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes powering the cascade queries:
--   project Reports tab → WHERE projectId = ?
--   module Reports tab  → WHERE moduleId  = ?
--   feature Reports tab → WHERE featureId = ?
CREATE INDEX "generated_reports_moduleId_generatedAt_idx"
  ON "generated_reports"("moduleId", "generatedAt" DESC);

CREATE INDEX "generated_reports_featureId_generatedAt_idx"
  ON "generated_reports"("featureId", "generatedAt" DESC);

-- Backfill existing rows by reading scope from ReportConfig where present.
-- Ad-hoc reports (configId NULL) stay scoped to project only — that matches
-- their original intent.
UPDATE "generated_reports" gr
SET "moduleId"  = rc."moduleId",
    "featureId" = rc."featureId"
FROM "report_configs" rc
WHERE gr."configId" = rc."id"
  AND ( rc."moduleId" IS NOT NULL OR rc."featureId" IS NOT NULL );

-- For feature-scoped reports without a moduleId, derive moduleId from the feature.
UPDATE "generated_reports" gr
SET "moduleId" = f."moduleId"
FROM "features" f
WHERE gr."featureId" = f."id"
  AND gr."moduleId" IS NULL;
