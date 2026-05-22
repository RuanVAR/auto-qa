-- Structured failure reason on a TestRun — captured when QA marks a test
-- FAILED. Powers the "view reason" popover and the failure-type analytics.
CREATE TYPE "TestFailureCategory" AS ENUM (
  'FUNCTIONALITY',
  'DESIGN_MISMATCH',
  'MISSING_ELEMENT',
  'CONTENT_ERROR',
  'DATA_VALIDATION',
  'PERFORMANCE',
  'INTEGRATION',
  'CRASH_ERROR',
  'REGRESSION',
  'ENVIRONMENT',
  'TEST_ISSUE',
  'OTHER'
);

ALTER TABLE "test_runs" ADD COLUMN "failureCategory" "TestFailureCategory";
ALTER TABLE "test_runs" ADD COLUMN "failureNote" TEXT;
