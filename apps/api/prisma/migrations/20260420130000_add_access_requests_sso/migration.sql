-- CreateEnum
CREATE TYPE "AccessRequestType" AS ENUM ('ORG', 'PROJECT');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SsoProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- AlterTable: organisations — add SSO fields
ALTER TABLE "organisations"
  ADD COLUMN IF NOT EXISTS "ssoDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "ssoEnforced" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allowedSsoDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: users — drop isActive if it exists (was removed in prior migration)
ALTER TABLE "users" DROP COLUMN IF EXISTS "isActive";

-- CreateTable: access_requests
CREATE TABLE IF NOT EXISTS "access_requests" (
    "id" TEXT NOT NULL,
    "type" "AccessRequestType" NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "grantedRole" TEXT,
    "reviewerNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "requesterId" TEXT NOT NULL,
    "reviewedById" TEXT,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user_sso_accounts
CREATE TABLE IF NOT EXISTS "user_sso_accounts" (
    "id" TEXT NOT NULL,
    "provider" "SsoProvider" NOT NULL,
    "providerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "user_sso_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_sso_accounts_provider_providerId_key"
  ON "user_sso_accounts"("provider", "providerId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "user_sso_accounts" ADD CONSTRAINT "user_sso_accounts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
