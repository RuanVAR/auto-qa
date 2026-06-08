-- Sign-off system: self-contained config + state + signatures + audit trail.
-- (Hand-authored to include ONLY the sign-off objects; pre-existing schema
--  drift on other tables is intentionally left untouched.)

-- CreateEnum
CREATE TYPE "SignoffStatus" AS ENUM ('AWAITING', 'SIGNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SignoffEventType" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'MODULE_SIGNED', 'CERT_GENERATED', 'CONFIG_CHANGED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'FEATURE_SIGNOFF_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'MODULE_SIGNED_OFF';

-- CreateTable
CREATE TABLE "signoff_approvers" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signoff_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_env_signoffs" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "status" "SignoffStatus" NOT NULL DEFAULT 'AWAITING',
    "eligibleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_env_signoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signoff_approvals" (
    "id" TEXT NOT NULL,
    "featureEnvSignoffId" TEXT NOT NULL,
    "signedById" TEXT NOT NULL,
    "decision" "SignoffDecision" NOT NULL,
    "typedName" TEXT NOT NULL,
    "drawnSignature" TEXT,
    "note" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signoff_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_env_signoffs" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "status" "SignoffStatus" NOT NULL DEFAULT 'SIGNED',
    "signedById" TEXT NOT NULL,
    "typedName" TEXT NOT NULL,
    "drawnSignature" TEXT,
    "note" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "module_env_signoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signoff_events" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "SignoffEventType" NOT NULL,
    "featureId" TEXT,
    "moduleId" TEXT,
    "environmentId" TEXT,
    "actorId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signoff_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signoff_approvers_projectId_idx" ON "signoff_approvers"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "signoff_approvers_projectId_environmentId_userId_key" ON "signoff_approvers"("projectId", "environmentId", "userId");

-- CreateIndex
CREATE INDEX "feature_env_signoffs_environmentId_idx" ON "feature_env_signoffs"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "feature_env_signoffs_featureId_environmentId_key" ON "feature_env_signoffs"("featureId", "environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "signoff_approvals_featureEnvSignoffId_signedById_key" ON "signoff_approvals"("featureEnvSignoffId", "signedById");

-- CreateIndex
CREATE UNIQUE INDEX "module_env_signoffs_moduleId_environmentId_key" ON "module_env_signoffs"("moduleId", "environmentId");

-- CreateIndex
CREATE INDEX "signoff_events_projectId_createdAt_idx" ON "signoff_events"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "signoff_approvers" ADD CONSTRAINT "signoff_approvers_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signoff_approvers" ADD CONSTRAINT "signoff_approvers_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signoff_approvers" ADD CONSTRAINT "signoff_approvers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_env_signoffs" ADD CONSTRAINT "feature_env_signoffs_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_env_signoffs" ADD CONSTRAINT "feature_env_signoffs_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signoff_approvals" ADD CONSTRAINT "signoff_approvals_featureEnvSignoffId_fkey" FOREIGN KEY ("featureEnvSignoffId") REFERENCES "feature_env_signoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signoff_approvals" ADD CONSTRAINT "signoff_approvals_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_env_signoffs" ADD CONSTRAINT "module_env_signoffs_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_env_signoffs" ADD CONSTRAINT "module_env_signoffs_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_env_signoffs" ADD CONSTRAINT "module_env_signoffs_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signoff_events" ADD CONSTRAINT "signoff_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signoff_events" ADD CONSTRAINT "signoff_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
