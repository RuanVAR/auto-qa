-- Per-environment Playwright slow-motion delay. Lets devs slow auto runs
-- locally (e.g. 200ms between actions) for visual debugging while UAT /
-- Prod runs stay at full speed.
ALTER TABLE "environments" ADD COLUMN "slowMoMs" INTEGER NOT NULL DEFAULT 0;
