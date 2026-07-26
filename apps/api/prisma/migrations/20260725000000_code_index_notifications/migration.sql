-- G-3 Phase 6: durable, deduplicated code-index completion notifications.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CODE_INDEX_READY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CODE_INDEX_FAILED';

ALTER TABLE "notifications" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "notifications_dedupeKey_key"
  ON "notifications"("dedupeKey");
