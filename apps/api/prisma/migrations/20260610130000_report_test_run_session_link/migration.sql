-- Link run-scoped reports back to their TestRunSession so a named run can
-- surface + re-email its report.

-- AlterTable
ALTER TABLE "generated_reports" ADD COLUMN "testRunSessionId" TEXT;

-- AddForeignKey
ALTER TABLE "generated_reports"
  ADD CONSTRAINT "generated_reports_testRunSessionId_fkey"
  FOREIGN KEY ("testRunSessionId") REFERENCES "test_run_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "generated_reports_testRunSessionId_generatedAt_idx"
  ON "generated_reports"("testRunSessionId", "generatedAt");
