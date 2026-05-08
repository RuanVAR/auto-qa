/*
  Warnings:

  - You are about to drop the column `clickupBugListId` on the `features` table. All the data in the column will be lost.
  - You are about to drop the column `externalSystem` on the `issues` table. All the data in the column will be lost.
  - You are about to drop the column `externalTicketId` on the `issues` table. All the data in the column will be lost.
  - You are about to drop the column `externalTicketUrl` on the `issues` table. All the data in the column will be lost.
  - You are about to drop the column `pushedExternallyAt` on the `issues` table. All the data in the column will be lost.
  - You are about to drop the `feature_ticket_links` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `org_plugins` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `project_plugin_configs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `project_plugin_status_mappings` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "MappingDirection" AS ENUM ('OUTBOUND', 'INBOUND', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "MappingTargetType" AS ENUM ('PHASE', 'ISSUE_STATUS');

-- CreateEnum
CREATE TYPE "InboundSource" AS ENUM ('MANUAL_REFRESH', 'WEBHOOK', 'BULK_SYNC');

-- CreateEnum
CREATE TYPE "SuggestionKind" AS ENUM ('AUTO_APPLIED', 'PENDING_APPROVAL', 'UNMAPPED');

-- DropForeignKey
ALTER TABLE "feature_runs" DROP CONSTRAINT "feature_runs_environmentId_fkey";

-- DropForeignKey
ALTER TABLE "feature_ticket_links" DROP CONSTRAINT "feature_ticket_links_featureId_fkey";

-- DropForeignKey
ALTER TABLE "feature_ticket_links" DROP CONSTRAINT "feature_ticket_links_linkedById_fkey";

-- DropForeignKey
ALTER TABLE "feature_ticket_links" DROP CONSTRAINT "feature_ticket_links_orgPluginId_fkey";

-- DropForeignKey
ALTER TABLE "org_plugins" DROP CONSTRAINT "org_plugins_createdById_fkey";

-- DropForeignKey
ALTER TABLE "org_plugins" DROP CONSTRAINT "org_plugins_orgId_fkey";

-- DropForeignKey
ALTER TABLE "project_plugin_configs" DROP CONSTRAINT "project_plugin_configs_orgPluginId_fkey";

-- DropForeignKey
ALTER TABLE "project_plugin_configs" DROP CONSTRAINT "project_plugin_configs_projectId_fkey";

-- DropForeignKey
ALTER TABLE "project_plugin_status_mappings" DROP CONSTRAINT "project_plugin_status_mappings_orgPluginId_fkey";

-- DropForeignKey
ALTER TABLE "project_plugin_status_mappings" DROP CONSTRAINT "project_plugin_status_mappings_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "project_plugin_status_mappings" DROP CONSTRAINT "project_plugin_status_mappings_projectId_fkey";

-- DropForeignKey
ALTER TABLE "project_plugin_status_mappings" DROP CONSTRAINT "project_plugin_status_mappings_projectPluginConfigId_fkey";

-- DropForeignKey
ALTER TABLE "test_runs" DROP CONSTRAINT "test_runs_environmentId_fkey";

-- DropIndex
DROP INDEX "generated_reports_featureId_generatedAt_idx";

-- DropIndex
DROP INDEX "generated_reports_moduleId_generatedAt_idx";

-- AlterTable
ALTER TABLE "access_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "feature_phases" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "feature_runs" ALTER COLUMN "environmentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "features" DROP COLUMN "clickupBugListId";

-- AlterTable
ALTER TABLE "issue_comments" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "issues" DROP COLUMN "externalSystem",
DROP COLUMN "externalTicketId",
DROP COLUMN "externalTicketUrl",
DROP COLUMN "pushedExternallyAt",
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "org_invites" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "org_members" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "organisations" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "project_members" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "test_runs" ALTER COLUMN "environmentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "accountStatus" SET DEFAULT 'PENDING_ACTIVATION';

-- DropTable
DROP TABLE "feature_ticket_links";

-- DropTable
DROP TABLE "org_plugins";

-- DropTable
DROP TABLE "project_plugin_configs";

-- DropTable
DROP TABLE "project_plugin_status_mappings";

-- DropEnum
DROP TYPE "OrgPluginType";

-- DropEnum
DROP TYPE "TicketLinkType";

-- CreateTable
CREATE TABLE "org_plugin_installs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "pluginVersion" TEXT NOT NULL,
    "displayLabel" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "secretsCiphertext" BYTEA NOT NULL,
    "secretsKeyId" TEXT NOT NULL,
    "lastHealthOk" BOOLEAN NOT NULL DEFAULT false,
    "lastHealthAt" TIMESTAMP(3),
    "lastHealthError" TEXT,
    "installedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_plugin_installs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_plugin_bindings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "bindingConfig" JSONB NOT NULL,
    "enabledCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoApplyInboundStatus" BOOLEAN NOT NULL DEFAULT false,
    "notifyUnmappedStatus" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_plugin_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_plugin_bindings" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "bindingConfig" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "module_plugin_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_plugin_bindings" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "bindingConfig" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_plugin_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_status_mappings" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "direction" "MappingDirection" NOT NULL,
    "targetType" "MappingTargetType" NOT NULL,
    "platformValue" TEXT NOT NULL,
    "externalValue" TEXT NOT NULL,

    CONSTRAINT "plugin_status_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_links" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "featureId" TEXT,
    "moduleId" TEXT,
    "projectId" TEXT,
    "findingId" TEXT,
    "issueId" TEXT,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT NOT NULL,
    "externalTitle" TEXT,
    "externalStatus" TEXT,
    "externalStatusColor" TEXT,
    "externalStatusType" TEXT,
    "externalAssignees" JSONB,
    "externalLastUpdatedAt" TIMESTAMP(3),
    "lastOutboundSyncAt" TIMESTAMP(3),
    "lastOutboundSyncError" TEXT,
    "lastInboundSyncAt" TIMESTAMP(3),
    "lastInboundSyncError" TEXT,
    "lastInboundSource" "InboundSource",
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_status_suggestions" (
    "id" TEXT NOT NULL,
    "ticketLinkId" TEXT NOT NULL,
    "externalStatus" TEXT NOT NULL,
    "mappedStatus" TEXT,
    "suggestionKind" "SuggestionKind" NOT NULL,
    "appliedById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "dismissedById" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_status_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_links" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "projectId" TEXT,
    "moduleId" TEXT,
    "featureId" TEXT,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "cachedMarkdown" TEXT,
    "cachedAt" TIMESTAMP(3),
    "cacheExpiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doc_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_webhook_endpoints" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "signingSecret" TEXT NOT NULL,
    "externalId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "eventType" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "payload" JSONB,
    "responseStatus" INTEGER,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_plugin_installs_orgId_pluginId_idx" ON "org_plugin_installs"("orgId", "pluginId");

-- CreateIndex
CREATE UNIQUE INDEX "org_plugin_installs_orgId_pluginId_displayLabel_key" ON "org_plugin_installs"("orgId", "pluginId", "displayLabel");

-- CreateIndex
CREATE INDEX "project_plugin_bindings_orgId_projectId_idx" ON "project_plugin_bindings"("orgId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_plugin_bindings_projectId_installId_key" ON "project_plugin_bindings"("projectId", "installId");

-- CreateIndex
CREATE UNIQUE INDEX "module_plugin_bindings_moduleId_installId_key" ON "module_plugin_bindings"("moduleId", "installId");

-- CreateIndex
CREATE UNIQUE INDEX "feature_plugin_bindings_featureId_installId_key" ON "feature_plugin_bindings"("featureId", "installId");

-- CreateIndex
CREATE INDEX "plugin_status_mappings_bindingId_direction_idx" ON "plugin_status_mappings"("bindingId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "plugin_status_mappings_bindingId_direction_targetType_platf_key" ON "plugin_status_mappings"("bindingId", "direction", "targetType", "platformValue", "externalValue");

-- CreateIndex
CREATE INDEX "ticket_links_orgId_featureId_idx" ON "ticket_links"("orgId", "featureId");

-- CreateIndex
CREATE INDEX "ticket_links_orgId_issueId_idx" ON "ticket_links"("orgId", "issueId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_links_installId_externalId_featureId_key" ON "ticket_links"("installId", "externalId", "featureId");

-- CreateIndex
CREATE INDEX "ticket_status_suggestions_ticketLinkId_appliedAt_idx" ON "ticket_status_suggestions"("ticketLinkId", "appliedAt");

-- CreateIndex
CREATE INDEX "doc_links_orgId_featureId_idx" ON "doc_links"("orgId", "featureId");

-- CreateIndex
CREATE INDEX "doc_links_orgId_moduleId_idx" ON "doc_links"("orgId", "moduleId");

-- CreateIndex
CREATE INDEX "doc_links_orgId_projectId_idx" ON "doc_links"("orgId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "plugin_webhook_endpoints_path_key" ON "plugin_webhook_endpoints"("path");

-- CreateIndex
CREATE INDEX "webhook_events_orgId_receivedAt_idx" ON "webhook_events"("orgId", "receivedAt");

-- CreateIndex
CREATE INDEX "webhook_events_installId_receivedAt_idx" ON "webhook_events"("installId", "receivedAt");

-- CreateIndex
CREATE INDEX "generated_reports_moduleId_generatedAt_idx" ON "generated_reports"("moduleId", "generatedAt");

-- CreateIndex
CREATE INDEX "generated_reports_featureId_generatedAt_idx" ON "generated_reports"("featureId", "generatedAt");

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_runs" ADD CONSTRAINT "feature_runs_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_plugin_installs" ADD CONSTRAINT "org_plugin_installs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_plugin_installs" ADD CONSTRAINT "org_plugin_installs_installedById_fkey" FOREIGN KEY ("installedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plugin_bindings" ADD CONSTRAINT "project_plugin_bindings_installId_fkey" FOREIGN KEY ("installId") REFERENCES "org_plugin_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plugin_bindings" ADD CONSTRAINT "project_plugin_bindings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_plugin_bindings" ADD CONSTRAINT "module_plugin_bindings_installId_fkey" FOREIGN KEY ("installId") REFERENCES "org_plugin_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_plugin_bindings" ADD CONSTRAINT "module_plugin_bindings_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_plugin_bindings" ADD CONSTRAINT "feature_plugin_bindings_installId_fkey" FOREIGN KEY ("installId") REFERENCES "org_plugin_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_plugin_bindings" ADD CONSTRAINT "feature_plugin_bindings_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_status_mappings" ADD CONSTRAINT "plugin_status_mappings_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "project_plugin_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_installId_fkey" FOREIGN KEY ("installId") REFERENCES "org_plugin_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_status_suggestions" ADD CONSTRAINT "ticket_status_suggestions_ticketLinkId_fkey" FOREIGN KEY ("ticketLinkId") REFERENCES "ticket_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_status_suggestions" ADD CONSTRAINT "ticket_status_suggestions_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_status_suggestions" ADD CONSTRAINT "ticket_status_suggestions_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_installId_fkey" FOREIGN KEY ("installId") REFERENCES "org_plugin_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_webhook_endpoints" ADD CONSTRAINT "plugin_webhook_endpoints_installId_fkey" FOREIGN KEY ("installId") REFERENCES "org_plugin_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_installId_fkey" FOREIGN KEY ("installId") REFERENCES "org_plugin_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
