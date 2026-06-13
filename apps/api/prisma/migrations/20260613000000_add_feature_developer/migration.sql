-- Optional assigned developer on a feature (any project member).
ALTER TABLE "features" ADD COLUMN "developerId" TEXT;

CREATE INDEX "features_developerId_idx" ON "features"("developerId");

ALTER TABLE "features"
  ADD CONSTRAINT "features_developerId_fkey"
  FOREIGN KEY ("developerId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
