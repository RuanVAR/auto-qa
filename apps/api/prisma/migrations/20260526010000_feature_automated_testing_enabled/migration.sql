-- Per-feature automated-testing gate. Default FALSE for both new and
-- existing features — opt-in by design per product spec.
ALTER TABLE "features"
  ADD COLUMN "automatedTestingEnabled" BOOLEAN NOT NULL DEFAULT false;
