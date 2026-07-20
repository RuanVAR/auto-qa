-- Phase 3 — Failure fingerprinting (§3.2) and first-pass triage (§3.4)
-- (docs/plan/05-PHASE-3-INTELLIGENCE.md). Hand-written for the same reason as
-- the Phase 2 migrations: the raw diff also carries unrelated pre-existing
-- drops tracked separately (spawned follow-up task).
--
-- Down (on paper):
--   DROP INDEX run_steps_failureFingerprint_createdAt_idx;
--   ALTER TABLE run_steps DROP COLUMN "failureFingerprint", DROP COLUMN "triageBucket",
--     DROP COLUMN "triageBucketOverridden";
--   -- TriageBucket enum cannot be dropped while any column references it.

-- CreateEnum
CREATE TYPE "TriageBucket" AS ENUM ('PRODUCT', 'AUTOMATION', 'ENVIRONMENT');

-- AlterTable
ALTER TABLE "run_steps" ADD COLUMN "failureFingerprint" TEXT;
ALTER TABLE "run_steps" ADD COLUMN "triageBucket" "TriageBucket";
ALTER TABLE "run_steps" ADD COLUMN "triageBucketOverridden" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "run_steps_failureFingerprint_createdAt_idx" ON "run_steps"("failureFingerprint", "createdAt");
