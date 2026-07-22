-- External tracker lifecycle for reusable defect rules.
ALTER TYPE "MappingTargetType" ADD VALUE IF NOT EXISTS 'DEFECT_STATUS';

ALTER TABLE "ticket_links" ADD COLUMN IF NOT EXISTS "defectId" TEXT;

ALTER TABLE "ticket_links"
  ADD CONSTRAINT "ticket_links_defectId_fkey"
  FOREIGN KEY ("defectId") REFERENCES "defects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "ticket_links_installId_externalId_defectId_key"
  ON "ticket_links"("installId", "externalId", "defectId");

CREATE INDEX IF NOT EXISTS "ticket_links_orgId_defectId_idx"
  ON "ticket_links"("orgId", "defectId");
