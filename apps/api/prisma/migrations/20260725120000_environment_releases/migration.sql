-- Stack-neutral environment release tracking. A release is the QA-facing
-- version for one environment; component rows retain each independently
-- deployed repository/artifact revision.

CREATE TYPE "EnvironmentReleaseSource" AS ENUM (
  'CI_API',
  'GITHUB_DEPLOYMENT',
  'REPO_INFERRED',
  'MANUAL'
);

CREATE TYPE "EnvironmentReleaseStatus" AS ENUM (
  'PENDING',
  'SUCCESS',
  'FAILED',
  'ROLLED_BACK'
);

CREATE TYPE "VersionSourceMode" AS ENUM (
  'AUTO',
  'CI_ONLY',
  'GIT_TAG',
  'MANIFEST',
  'CUSTOM'
);

CREATE TYPE "VersionFileFormat" AS ENUM (
  'AUTO',
  'JSON',
  'TOML',
  'YAML',
  'XML',
  'PROPERTIES',
  'TEXT'
);

ALTER TABLE "repo_env_bindings"
  ADD COLUMN "versionSource" "VersionSourceMode" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "versionFilePath" TEXT,
  ADD COLUMN "versionFileFormat" "VersionFileFormat" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "versionSelector" TEXT,
  ADD COLUMN "componentName" TEXT;

CREATE TABLE "environment_releases" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "environmentId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "source" "EnvironmentReleaseSource" NOT NULL,
  "status" "EnvironmentReleaseStatus" NOT NULL DEFAULT 'SUCCESS',
  "commitSha" TEXT,
  "branch" TEXT,
  "artifactDigest" TEXT,
  "externalDeploymentId" TEXT,
  "pipelineUrl" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "deployedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "environment_releases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "environment_releases_projectId_idempotencyKey_key"
  ON "environment_releases"("projectId", "idempotencyKey");
CREATE INDEX "environment_releases_environmentId_status_deployedAt_idx"
  ON "environment_releases"("environmentId", "status", "deployedAt" DESC);
CREATE INDEX "environment_releases_orgId_projectId_idx"
  ON "environment_releases"("orgId", "projectId");

CREATE TABLE "environment_release_components" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "projectRepoId" TEXT,
  "componentKey" TEXT NOT NULL,
  "componentName" TEXT NOT NULL,
  "version" TEXT,
  "commitSha" TEXT,
  "branch" TEXT,
  "artifactDigest" TEXT,
  "manifestPath" TEXT,
  "metadata" JSONB,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "environment_release_components_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "environment_release_components_releaseId_componentKey_key"
  ON "environment_release_components"("releaseId", "componentKey");
CREATE INDEX "environment_release_components_orgId_projectId_idx"
  ON "environment_release_components"("orgId", "projectId");
CREATE INDEX "environment_release_components_projectRepoId_idx"
  ON "environment_release_components"("projectRepoId");

CREATE TABLE "project_deploy_tokens" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "allowedEnvironmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "lastUsedIp" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_deploy_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_deploy_tokens_tokenHash_key"
  ON "project_deploy_tokens"("tokenHash");
CREATE INDEX "project_deploy_tokens_orgId_projectId_revokedAt_idx"
  ON "project_deploy_tokens"("orgId", "projectId", "revokedAt");
CREATE INDEX "project_deploy_tokens_expiresAt_idx"
  ON "project_deploy_tokens"("expiresAt");

CREATE TABLE "github_webhook_deliveries" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectRepoId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "signatureOk" BOOLEAN NOT NULL,
  "outcome" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "github_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "github_webhook_deliveries_projectRepoId_deliveryId_key"
  ON "github_webhook_deliveries"("projectRepoId", "deliveryId");
CREATE INDEX "github_webhook_deliveries_orgId_projectId_processedAt_idx"
  ON "github_webhook_deliveries"("orgId", "projectId", "processedAt" DESC);

ALTER TABLE "test_runs" ADD COLUMN "environmentReleaseId" TEXT;
ALTER TABLE "feature_runs" ADD COLUMN "environmentReleaseId" TEXT;
CREATE INDEX "test_runs_environmentReleaseId_idx" ON "test_runs"("environmentReleaseId");
CREATE INDEX "feature_runs_environmentReleaseId_idx" ON "feature_runs"("environmentReleaseId");

ALTER TABLE "environment_releases"
  ADD CONSTRAINT "environment_releases_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "environment_releases_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "environment_releases_environmentId_fkey"
    FOREIGN KEY ("environmentId") REFERENCES "environments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "environment_release_components"
  ADD CONSTRAINT "environment_release_components_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "environment_release_components_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "environment_release_components_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "environment_releases"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "environment_release_components_projectRepoId_fkey"
    FOREIGN KEY ("projectRepoId") REFERENCES "project_repos"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_deploy_tokens"
  ADD CONSTRAINT "project_deploy_tokens_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "project_deploy_tokens_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "project_deploy_tokens_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "github_webhook_deliveries"
  ADD CONSTRAINT "github_webhook_deliveries_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "github_webhook_deliveries_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "github_webhook_deliveries_projectRepoId_fkey"
    FOREIGN KEY ("projectRepoId") REFERENCES "project_repos"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "test_runs"
  ADD CONSTRAINT "test_runs_environmentReleaseId_fkey"
    FOREIGN KEY ("environmentReleaseId") REFERENCES "environment_releases"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "feature_runs"
  ADD CONSTRAINT "feature_runs_environmentReleaseId_fkey"
    FOREIGN KEY ("environmentReleaseId") REFERENCES "environment_releases"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
