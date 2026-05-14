-- Phase 0 of AI generation plan: BYOK foundations.
--   1. New AiProvider enum
--   2. New AC_EXTRACTION value on AISummaryType
--   3. ai_summaries: optional runId + org/cost/token/purpose/promptVersion cols
--   4. test_definitions: aiGenerationMetadata audit json
--   5. org_ai_credentials table (one row per org, encrypted secret blob)

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('ANTHROPIC', 'OPENAI', 'GEMINI', 'AZURE', 'OLLAMA', 'OPENAI_COMPATIBLE');

-- AlterEnum
ALTER TYPE "AISummaryType" ADD VALUE 'AC_EXTRACTION';

-- AlterTable: AISummary cost-tracking + optional run
ALTER TABLE "ai_summaries"
  ADD COLUMN "costUsd" DECIMAL(10,6),
  ADD COLUMN "durationMs" INTEGER,
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "orgId" TEXT,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "promptVersion" TEXT,
  ADD COLUMN "purpose" TEXT,
  ALTER COLUMN "runId" DROP NOT NULL;

-- AlterTable: TestDefinition audit json for AI-generated rows
ALTER TABLE "test_definitions" ADD COLUMN "aiGenerationMetadata" JSONB;

-- CreateTable
CREATE TABLE "org_ai_credentials" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "maxTokens" INTEGER NOT NULL DEFAULT 4000,
    "secretsCiphertext" BYTEA NOT NULL,
    "secretsKeyId" TEXT NOT NULL,
    "baseUrl" TEXT,
    "azureInstance" TEXT,
    "azureDeployment" TEXT,
    "azureApiVersion" TEXT,
    "monthlyCapUsd" DECIMAL(10,2) NOT NULL DEFAULT 50.00,
    "rateLimitPerUserPerHour" INTEGER NOT NULL DEFAULT 20,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "org_ai_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_ai_credentials_orgId_key" ON "org_ai_credentials"("orgId");

-- CreateIndex
CREATE INDEX "ai_summaries_orgId_createdAt_idx" ON "ai_summaries"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_ai_credentials" ADD CONSTRAINT "org_ai_credentials_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_ai_credentials" ADD CONSTRAINT "org_ai_credentials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
