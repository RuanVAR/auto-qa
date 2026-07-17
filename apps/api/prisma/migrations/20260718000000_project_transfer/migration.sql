-- CreateEnum
CREATE TYPE "ProjectTransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- AlterEnum
-- Safe inside a transaction on PG12+ as long as the new values are not USED in
-- the same transaction (they aren't — nothing is inserted here).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_TRANSFER_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_TRANSFER_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_TRANSFER_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_TRANSFER_CANCELLED';

-- AlterTable
ALTER TABLE "organisations"
  ADD COLUMN "transferCode" TEXT,
  ADD COLUMN "acceptsTransfers" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: every existing org needs a code, otherwise it can never be targeted
-- as a transfer destination. 12 uppercase hex chars (unambiguous alphabet, no
-- O/I/l). Rotatable later via the API.
UPDATE "organisations"
SET "transferCode" = upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 12))
WHERE "transferCode" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "organisations_transferCode_key" ON "organisations"("transferCode");

-- CreateTable
CREATE TABLE "project_transfer_requests" (
    "id" TEXT NOT NULL,
    "status" "ProjectTransferStatus" NOT NULL DEFAULT 'PENDING',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "decisionNote" TEXT,
    "plan" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromOrgId" TEXT NOT NULL,
    "toOrgId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,

    CONSTRAINT "project_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_transfer_requests_token_key" ON "project_transfer_requests"("token");
CREATE INDEX "project_transfer_requests_toOrgId_status_idx" ON "project_transfer_requests"("toOrgId", "status");
CREATE INDEX "project_transfer_requests_fromOrgId_status_idx" ON "project_transfer_requests"("fromOrgId", "status");
CREATE INDEX "project_transfer_requests_projectId_status_idx" ON "project_transfer_requests"("projectId", "status");

-- At most ONE pending transfer per project. Prisma can't express a partial
-- unique index, so it lives here; the service also checks it up-front so the
-- caller gets a clean 409 instead of a raw constraint error.
CREATE UNIQUE INDEX "project_transfer_requests_one_pending_per_project"
  ON "project_transfer_requests"("projectId")
  WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "project_transfer_requests" ADD CONSTRAINT "project_transfer_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_transfer_requests" ADD CONSTRAINT "project_transfer_requests_fromOrgId_fkey" FOREIGN KEY ("fromOrgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_transfer_requests" ADD CONSTRAINT "project_transfer_requests_toOrgId_fkey" FOREIGN KEY ("toOrgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_transfer_requests" ADD CONSTRAINT "project_transfer_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_transfer_requests" ADD CONSTRAINT "project_transfer_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
