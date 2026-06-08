-- CreateEnum
CREATE TYPE "GitProvider" AS ENUM ('GITHUB', 'GITHUB_ENTERPRISE', 'GITLAB');

-- CreateEnum
CREATE TYPE "GitAuthKind" AS ENUM ('APP', 'PAT');

-- CreateEnum
CREATE TYPE "RepoRole" AS ENUM ('FRONTEND', 'BACKEND', 'INFRA', 'OTHER');

-- CreateEnum
CREATE TYPE "RepoIndexStatus" AS ENUM ('PENDING', 'INDEXING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "org_git_credentials" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "GitProvider" NOT NULL DEFAULT 'GITHUB',
    "authKind" "GitAuthKind" NOT NULL,
    "displayLabel" TEXT,
    "baseUrl" TEXT,
    "appInstallationId" TEXT,
    "secretsCiphertext" BYTEA NOT NULL,
    "secretsKeyId" TEXT NOT NULL,
    "lastHealthOk" BOOLEAN NOT NULL DEFAULT false,
    "lastHealthAt" TIMESTAMP(3),
    "lastHealthError" TEXT,
    "connectedAs" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_git_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_repos" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "role" "RepoRole" NOT NULL DEFAULT 'OTHER',
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "secretsCiphertext" BYTEA,
    "secretsKeyId" TEXT,
    "includeGlobs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeGlobs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RepoIndexStatus" NOT NULL DEFAULT 'PENDING',
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "lastIndexedAt" TIMESTAMP(3),
    "webhookSecret" TEXT,
    "webhookExternalId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_repos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_git_credentials_orgId_idx" ON "org_git_credentials"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "org_git_credentials_orgId_provider_displayLabel_key" ON "org_git_credentials"("orgId", "provider", "displayLabel");

-- CreateIndex
CREATE INDEX "project_repos_orgId_projectId_idx" ON "project_repos"("orgId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_repos_projectId_repoOwner_repoName_key" ON "project_repos"("projectId", "repoOwner", "repoName");

-- AddForeignKey
ALTER TABLE "org_git_credentials" ADD CONSTRAINT "org_git_credentials_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "org_git_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
