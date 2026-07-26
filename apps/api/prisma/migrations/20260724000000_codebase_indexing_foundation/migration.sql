-- G-3 codebase indexing foundation: pgvector, embedding credentials, branch
-- indexes, environment bindings, and generation-scoped derived chunks.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TYPE "RepoIndexStatus" ADD VALUE IF NOT EXISTS 'BLOCKED' BEFORE 'PENDING';

CREATE TYPE "RepoIndexStage" AS ENUM (
  'QUEUED',
  'AUTHENTICATING',
  'DOWNLOADING',
  'SCANNING',
  'CHUNKING',
  'EMBEDDING',
  'SAVING',
  'COMPLETE'
);

CREATE TYPE "EmbeddingProvider" AS ENUM (
  'OPENAI',
  'GEMINI',
  'AZURE',
  'OLLAMA',
  'OPENAI_COMPATIBLE'
);

ALTER TABLE "project_repos"
  ADD CONSTRAINT "project_repos_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "org_embedding_credentials" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" "EmbeddingProvider" NOT NULL,
  "model" TEXT NOT NULL,
  "baseUrl" TEXT,
  "azureDeployment" TEXT,
  "azureApiVersion" TEXT,
  "secretsCiphertext" BYTEA,
  "secretsKeyId" TEXT,
  "dimension" INTEGER NOT NULL,
  "configFingerprint" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "org_embedding_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_embedding_credentials_orgId_key"
  ON "org_embedding_credentials"("orgId");

CREATE TABLE "repo_branch_indexes" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectRepoId" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "status" "RepoIndexStatus" NOT NULL DEFAULT 'PENDING',
  "stage" "RepoIndexStage" NOT NULL DEFAULT 'QUEUED',
  "progressPercent" INTEGER NOT NULL DEFAULT 0,
  "filesProcessed" INTEGER NOT NULL DEFAULT 0,
  "totalFiles" INTEGER,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "activeGeneration" INTEGER,
  "requestedGeneration" INTEGER NOT NULL DEFAULT 0,
  "commitSha" TEXT,
  "embeddingFingerprint" TEXT,
  "embeddingDimension" INTEGER,
  "lastIndexedAt" TIMESTAMP(3),
  "lastRequestedAt" TIMESTAMP(3),
  "requestedById" TEXT,
  "error" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "repo_branch_indexes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "repo_branch_indexes_projectRepoId_branch_key"
  ON "repo_branch_indexes"("projectRepoId", "branch");
CREATE INDEX "repo_branch_indexes_orgId_projectId_status_idx"
  ON "repo_branch_indexes"("orgId", "projectId", "status");

CREATE TABLE "repo_env_bindings" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectRepoId" TEXT NOT NULL,
  "environmentId" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "repo_env_bindings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "repo_env_bindings_orgId_projectId_idx"
  ON "repo_env_bindings"("orgId", "projectId");
CREATE INDEX "repo_env_bindings_environmentId_projectRepoId_idx"
  ON "repo_env_bindings"("environmentId", "projectRepoId");
CREATE UNIQUE INDEX "repo_env_bindings_environmentId_projectRepoId_active_key"
  ON "repo_env_bindings"("environmentId", "projectRepoId")
  WHERE "deletedAt" IS NULL;

CREATE TABLE "code_chunks" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "branchIndexId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "filePath" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "symbol" TEXT,
  "selectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "routes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "embedding" vector NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "code_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "code_chunks_branchIndexId_generation_filePath_chunkIndex_key"
  ON "code_chunks"("branchIndexId", "generation", "filePath", "chunkIndex");
CREATE INDEX "code_chunks_orgId_projectId_idx"
  ON "code_chunks"("orgId", "projectId");
CREATE INDEX "code_chunks_branchIndexId_generation_idx"
  ON "code_chunks"("branchIndexId", "generation");

ALTER TABLE "org_embedding_credentials"
  ADD CONSTRAINT "org_embedding_credentials_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "org_embedding_credentials_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "repo_branch_indexes"
  ADD CONSTRAINT "repo_branch_indexes_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "repo_branch_indexes_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "repo_branch_indexes_projectRepoId_fkey"
    FOREIGN KEY ("projectRepoId") REFERENCES "project_repos"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "repo_branch_indexes_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "repo_env_bindings"
  ADD CONSTRAINT "repo_env_bindings_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "repo_env_bindings_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "repo_env_bindings_projectRepoId_fkey"
    FOREIGN KEY ("projectRepoId") REFERENCES "project_repos"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "repo_env_bindings_environmentId_fkey"
    FOREIGN KEY ("environmentId") REFERENCES "environments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "code_chunks"
  ADD CONSTRAINT "code_chunks_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "code_chunks_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "code_chunks_branchIndexId_fkey"
    FOREIGN KEY ("branchIndexId") REFERENCES "repo_branch_indexes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
