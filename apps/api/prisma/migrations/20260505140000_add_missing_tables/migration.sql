-- Enums
DO $$ BEGIN
  CREATE TYPE "PhaseRole" AS ENUM ('TESTER', 'MANAGER', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PhaseStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportScope" AS ENUM ('FEATURE', 'MODULE', 'PROJECT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrgPluginType" AS ENUM ('JIRA', 'CLICKUP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TicketLinkType" AS ENUM ('JIRA', 'CLICKUP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ModuleVersion
CREATE TABLE IF NOT EXISTS "module_versions" (
    "id" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moduleId" TEXT NOT NULL,
    CONSTRAINT "module_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "module_versions_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "module_versions_moduleId_versionNumber_key" ON "module_versions"("moduleId", "versionNumber");

-- TestDefinitionVersion
CREATE TABLE IF NOT EXISTS "test_definition_versions" (
    "id" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "testDefinitionId" TEXT NOT NULL,
    CONSTRAINT "test_definition_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "test_definition_versions_testDefinitionId_fkey" FOREIGN KEY ("testDefinitionId") REFERENCES "test_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "test_definition_versions_testDefinitionId_versionNumber_key" ON "test_definition_versions"("testDefinitionId", "versionNumber");

-- ImportLog
CREATE TABLE IF NOT EXISTS "import_logs" (
    "id" TEXT NOT NULL,
    "exportType" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "conflicts" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "importedById" TEXT,
    CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "import_logs_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ProjectPhase
CREATE TABLE IF NOT EXISTS "project_phases" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "color" TEXT,
    "autoPromote" BOOLEAN NOT NULL DEFAULT false,
    "environmentId" TEXT,
    "handoverRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_phases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_phases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_phases_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_phases_projectId_order_key" ON "project_phases"("projectId", "order");

-- PhaseAssignment
CREATE TABLE IF NOT EXISTS "phase_assignments" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PhaseRole" NOT NULL,
    CONSTRAINT "phase_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "phase_assignments_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "project_phases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "phase_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "phase_assignments_phaseId_userId_key" ON "phase_assignments"("phaseId", "userId");

-- FeatureSignOff
CREATE TABLE IF NOT EXISTS "feature_sign_offs" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "signedOffById" TEXT NOT NULL,
    "signedOffAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT,
    "notifiedEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "feature_sign_offs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feature_sign_offs_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "feature_sign_offs_signedOffById_fkey" FOREIGN KEY ("signedOffById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "feature_sign_offs_featureId_key" ON "feature_sign_offs"("featureId");

-- PhaseReportSchedule
CREATE TABLE IF NOT EXISTS "phase_report_schedules" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "scope" "ReportScope" NOT NULL,
    "scopeId" TEXT,
    "name" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "sendTime" TEXT NOT NULL,
    "recipients" TEXT[] NOT NULL,
    "includeCharts" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "phase_report_schedules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "phase_report_schedules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "phase_report_schedules_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "project_phases"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "phase_report_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- OrgPlugin
CREATE TABLE IF NOT EXISTS "org_plugins" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" "OrgPluginType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "connectedAs" TEXT,
    "testedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "org_plugins_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "org_plugins_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "org_plugins_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "org_plugins_orgId_type_key" ON "org_plugins"("orgId", "type");

-- ProjectPluginConfig
CREATE TABLE IF NOT EXISTS "project_plugin_configs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orgPluginId" TEXT NOT NULL,
    "pluginType" "OrgPluginType" NOT NULL,
    "config" JSONB NOT NULL,
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_plugin_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_plugin_configs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_plugin_configs_orgPluginId_fkey" FOREIGN KEY ("orgPluginId") REFERENCES "org_plugins"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_plugin_configs_projectId_pluginType_key" ON "project_plugin_configs"("projectId", "pluginType");

-- ProjectPluginStatusMapping
CREATE TABLE IF NOT EXISTS "project_plugin_status_mappings" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orgPluginId" TEXT NOT NULL,
    "projectPluginConfigId" TEXT NOT NULL,
    "phaseId" TEXT,
    "isSignOff" BOOLEAN NOT NULL DEFAULT false,
    "targetStatus" TEXT NOT NULL,
    CONSTRAINT "project_plugin_status_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_plugin_status_mappings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_plugin_status_mappings_orgPluginId_fkey" FOREIGN KEY ("orgPluginId") REFERENCES "org_plugins"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "project_plugin_status_mappings_projectPluginConfigId_fkey" FOREIGN KEY ("projectPluginConfigId") REFERENCES "project_plugin_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "project_plugin_status_mappings_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "project_phases"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- FeatureTicketLink
CREATE TABLE IF NOT EXISTS "feature_ticket_links" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "type" "TicketLinkType" NOT NULL,
    "orgPluginId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketUrl" TEXT NOT NULL,
    "ticketTitle" TEXT NOT NULL,
    "linkedById" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    CONSTRAINT "feature_ticket_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feature_ticket_links_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "feature_ticket_links_orgPluginId_fkey" FOREIGN KEY ("orgPluginId") REFERENCES "org_plugins"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "feature_ticket_links_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "feature_ticket_links_featureId_type_key" ON "feature_ticket_links"("featureId", "type");
