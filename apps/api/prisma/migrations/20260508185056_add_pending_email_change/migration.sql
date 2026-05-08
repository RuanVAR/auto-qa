-- Add pending email-change verification fields. The two-step flow:
--   1. requestEmailChange() stashes new email + token
--   2. confirmEmailChange() promotes pendingEmail → email and clears the trio
ALTER TABLE "users" ADD COLUMN "pendingEmail" TEXT;
ALTER TABLE "users" ADD COLUMN "pendingEmailToken" TEXT;
ALTER TABLE "users" ADD COLUMN "pendingEmailRequestedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_pendingEmailToken_key" ON "users"("pendingEmailToken");
