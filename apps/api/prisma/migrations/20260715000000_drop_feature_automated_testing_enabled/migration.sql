-- Automation availability is env-driven (Environment.supportsAutomation);
-- the per-feature gate is gone. Drop the deprecated, unread column.
ALTER TABLE "features" DROP COLUMN IF EXISTS "automatedTestingEnabled";
