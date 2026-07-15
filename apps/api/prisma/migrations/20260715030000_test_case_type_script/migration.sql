-- SCRIPT tests: full Playwright JS in config.script, executed in the
-- worker's vm sandbox.
ALTER TYPE "TestCaseType" ADD VALUE IF NOT EXISTS 'SCRIPT';
