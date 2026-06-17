-- Marks an environment as a legal target for automated (Playwright) runs.
-- Automated runs are gated on this alongside Feature.automatedTestingEnabled.
ALTER TABLE "environments" ADD COLUMN "supportsAutomation" BOOLEAN NOT NULL DEFAULT false;
