-- Test Recorder phase 1: track how a TestDefinition was authored.
-- RECORDED rows are produced by the in-browser recorder; future rows from AI
-- and import flows get their own values rather than being lumped into MANUAL.

CREATE TYPE "AuthoringMethod" AS ENUM ('MANUAL', 'RECORDED', 'AI_GENERATED', 'IMPORTED');

ALTER TABLE "test_definitions" ADD COLUMN "authoringMethod" "AuthoringMethod" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "test_definitions" ADD COLUMN "recordedAt" TIMESTAMP(3);
ALTER TABLE "test_definitions" ADD COLUMN "recordedDurationSec" INTEGER;
