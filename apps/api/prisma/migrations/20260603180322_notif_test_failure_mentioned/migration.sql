-- New notification type for @mentions in a test failure reason.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEST_FAILURE_MENTIONED';
