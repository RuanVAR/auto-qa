-- CreateEnum
CREATE TYPE "ExecutedBy" AS ENUM ('AUTOMATED', 'MANUAL');

-- AlterTable
ALTER TABLE "run_steps"
  ADD COLUMN "executedBy"     "ExecutedBy",
  ADD COLUMN "takeoverReason" TEXT,
  ADD COLUMN "takeoverAt"     TIMESTAMP(3);
