-- Add display order to environments so they appear consistently in pickers
-- Existing rows default to 0; admins can set explicit order via the UI.

ALTER TABLE "environments" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "environments_projectId_order_idx" ON "environments"("projectId", "order");
