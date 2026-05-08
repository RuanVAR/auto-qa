-- Track who a report was emailed to + when.
-- recipientEmails is denormalised onto the report row (rather than a separate
-- many-to-many table) because: (a) audit-only — never queried for filtering,
-- (b) typically <10 recipients per report, (c) supports free-text emails the
-- sender adds that don't correspond to platform users.
ALTER TABLE "generated_reports"
  ADD COLUMN "recipientEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "emailedAt"       TIMESTAMP(3);
