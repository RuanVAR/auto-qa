-- ── Phase 1: New Enums ────────────────────────────────────────────────────────

CREATE TYPE "PlatformRole" AS ENUM ('USER', 'PLATFORM_ADMIN');

CREATE TYPE "AccountStatus" AS ENUM (
  'PENDING_ACTIVATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED'
);

CREATE TYPE "OrgRole" AS ENUM ('ORG_ADMIN', 'ORG_MEMBER');

CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'TECH_LEAD', 'DEVELOPER', 'QA_ENGINEER', 'MANAGER');

CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- ── Phase 2: Extend existing tables ───────────────────────────────────────────

-- Add new columns to users (baseline only has: id, email, name, passwordHash, role, isActive, createdAt, updatedAt)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "avatarUrl"        TEXT,
  ADD COLUMN IF NOT EXISTS "platformRole"     "PlatformRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS "accountStatus"    "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "activationToken"  TEXT,
  ADD COLUMN IF NOT EXISTS "activationSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedById"     TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approverNote"     TEXT,
  ADD COLUMN IF NOT EXISTS "lastActiveOrgId"  TEXT;

-- Make passwordHash nullable (PLATFORM_ADMIN may be seeded without a hash initially)
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Unique index on activationToken (nullable columns are excluded from unique automatically in PG)
CREATE UNIQUE INDEX IF NOT EXISTS "users_activationToken_key" ON "users"("activationToken");

-- Add requireRegistrationApproval to platform_config
ALTER TABLE "platform_config"
  ADD COLUMN IF NOT EXISTS "requireRegistrationApproval" BOOLEAN NOT NULL DEFAULT false;

-- Add orgId + deletedAt to projects
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "orgId"     TEXT,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Add orgId to audit_logs
ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "orgId" TEXT;

-- ── Phase 3: New tables ────────────────────────────────────────────────────────

-- organisations
CREATE TABLE "organisations" (
    "id"          TEXT         NOT NULL,
    "name"        TEXT         NOT NULL,
    "slug"        TEXT         NOT NULL,
    "logoUrl"     TEXT,
    "website"     TEXT,
    "description" TEXT,
    "isActive"    BOOLEAN      NOT NULL DEFAULT true,
    "deletedAt"   TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId"     TEXT         NOT NULL,
    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organisations_slug_key" ON "organisations"("slug");

-- org_members
CREATE TABLE "org_members" (
    "id"        TEXT         NOT NULL,
    "role"      "OrgRole"    NOT NULL DEFAULT 'ORG_MEMBER',
    "joinedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId"     TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_members_orgId_userId_key" ON "org_members"("orgId", "userId");

-- org_invites
CREATE TABLE "org_invites" (
    "id"          TEXT           NOT NULL,
    "email"       TEXT           NOT NULL,
    "role"        "OrgRole"      NOT NULL DEFAULT 'ORG_MEMBER',
    "token"       TEXT           NOT NULL,
    "status"      "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt"   TIMESTAMP(3)   NOT NULL,
    "acceptedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId"       TEXT           NOT NULL,
    "invitedById" TEXT           NOT NULL,
    CONSTRAINT "org_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_invites_token_key" ON "org_invites"("token");

-- project_members
CREATE TABLE "project_members" (
    "id"        TEXT          NOT NULL,
    "role"      "ProjectRole" NOT NULL DEFAULT 'QA_ENGINEER',
    "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT          NOT NULL,
    "userId"    TEXT          NOT NULL,
    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "project_members"("projectId", "userId");

-- ── Phase 4: Foreign Keys ──────────────────────────────────────────────────────

ALTER TABLE "org_members"
  ADD CONSTRAINT "org_members_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "org_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "org_invites"
  ADD CONSTRAINT "org_invites_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "org_invites_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "project_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
