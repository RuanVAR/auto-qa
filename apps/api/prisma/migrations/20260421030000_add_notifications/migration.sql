-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('RUN', 'PHASE', 'ASSIGNMENT', 'AI', 'TEAM', 'REPORT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FEATURE_RUN_PASSED', 'FEATURE_RUN_FAILED', 'FEATURE_RUN_PARTIAL', 'TEST_CASE_FAILED', 'FEATURE_PROMOTED', 'PHASE_REQUIRES_SIGN_OFF', 'FEATURE_SIGNED_OFF', 'PHASE_FAILED', 'ASSIGNED_TO_PHASE', 'ADDED_TO_PROJECT', 'ROLE_CHANGED', 'SELECTOR_HEALS_DETECTED', 'DUPLICATE_TESTS_DETECTED', 'TEST_SUGGESTIONS_READY', 'FLAKY_TEST_FLAGGED', 'INVITE_ACCEPTED', 'ACCESS_REQUEST_SUBMITTED', 'ACCESS_REQUEST_APPROVED', 'ACCESS_REQUEST_REJECTED', 'SCHEDULED_REPORT_READY', 'SESSION_REPORT_SENT', 'ENVIRONMENT_UNREACHABLE', 'INTEGRATION_FAILED', 'CREDIT_LOW');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "actionUrl" TEXT,
    "actionLabel" TEXT,
    "secondaryActionUrl" TEXT,
    "secondaryActionLabel" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_orgId_createdAt_idx" ON "notifications"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
