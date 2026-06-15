-- Domain auto-join toggle: gates the "request to join this org by email domain" flow.
ALTER TABLE "organisations" ADD COLUMN "autoJoinEnabled" BOOLEAN NOT NULL DEFAULT false;
