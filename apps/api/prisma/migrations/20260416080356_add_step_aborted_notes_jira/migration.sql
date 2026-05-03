-- AlterEnum
ALTER TYPE "StepStatus" ADD VALUE 'ABORTED';

-- AlterTable
ALTER TABLE "run_steps" ADD COLUMN     "jiraIssueKey" TEXT,
ADD COLUMN     "notes" TEXT;
