-- Cache the external task's epic on the TicketLink so the module table can
-- render epic chips per feature row without an API call per feature.
ALTER TABLE "ticket_links" ADD COLUMN "externalEpicName" TEXT;
ALTER TABLE "ticket_links" ADD COLUMN "externalEpicColor" TEXT;
