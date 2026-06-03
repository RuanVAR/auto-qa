-- Failure evidence on a TestRun: screenshots + a screen recording captured at fail time.
ALTER TABLE "test_runs" ADD COLUMN "failureScreenshotUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "test_runs" ADD COLUMN "failureRecordingUrl" TEXT;
