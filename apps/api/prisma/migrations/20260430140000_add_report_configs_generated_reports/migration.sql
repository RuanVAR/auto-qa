-- ── Enums ──────────────────────────────────────────────────────────────
CREATE TYPE "ReportType" AS ENUM ('FEATURE', 'MODULE', 'PROJECT', 'PHASE');
CREATE TYPE "ReportFormat" AS ENUM ('HTML', 'PDF');

-- ── Report Config (saved setup / template) ────────────────────────────
CREATE TABLE "report_configs" (
  "id"              TEXT NOT NULL,
  "projectId"       TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "type"            "ReportType" NOT NULL,
  "featureId"       TEXT,
  "moduleId"        TEXT,
  "phaseId"         TEXT,
  "environmentId"   TEXT,
  "includeSession"  BOOLEAN NOT NULL DEFAULT false,
  "includeFeature"  BOOLEAN NOT NULL DEFAULT true,
  "includeProject"  BOOLEAN NOT NULL DEFAULT false,
  "includeCharts"   BOOLEAN NOT NULL DEFAULT true,
  "createdById"     TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "report_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_configs_projectId_createdAt_idx" ON "report_configs"("projectId", "createdAt");

ALTER TABLE "report_configs"
  ADD CONSTRAINT "report_configs_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "report_configs_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Generated Report (immutable snapshot) ─────────────────────────────
CREATE TABLE "generated_reports" (
  "id"             TEXT NOT NULL,
  "configId"       TEXT,
  "projectId"      TEXT NOT NULL,
  "type"           "ReportType" NOT NULL,
  "format"         "ReportFormat" NOT NULL,
  "title"          TEXT NOT NULL,
  "payload"        JSONB NOT NULL,
  "artifactPath"   TEXT,
  "generatedById"  TEXT NOT NULL,
  "generatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generated_reports_projectId_generatedAt_idx" ON "generated_reports"("projectId", "generatedAt");

ALTER TABLE "generated_reports"
  ADD CONSTRAINT "generated_reports_configId_fkey"
    FOREIGN KEY ("configId") REFERENCES "report_configs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "generated_reports_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "generated_reports_generatedById_fkey"
    FOREIGN KEY ("generatedById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
