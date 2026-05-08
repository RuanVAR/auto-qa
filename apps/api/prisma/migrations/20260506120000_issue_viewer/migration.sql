-- IssueView table
CREATE TABLE IF NOT EXISTS "issue_views" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "viewCount" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "issue_views_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "issue_views_issueId_userId_key" ON "issue_views"("issueId", "userId");
CREATE INDEX IF NOT EXISTS "issue_views_issueId_lastViewedAt_idx" ON "issue_views"("issueId", "lastViewedAt");
ALTER TABLE "issue_views" ADD CONSTRAINT "issue_views_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_views" ADD CONSTRAINT "issue_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- notificationPrefs on users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notificationPrefs" JSONB NOT NULL DEFAULT '{}';

-- New NotificationType enum values
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ISSUE_MENTIONED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ISSUE_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ISSUE_STATUS_CHANGED';
