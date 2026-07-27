-- Shared reusable step definitions and immutable resolved run specifications.
CREATE TABLE "shared_step_folders" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shared_step_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shared_steps" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "folderId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "steps" JSONB NOT NULL,
  "parameters" JSONB NOT NULL DEFAULT '[]',
  "version" INTEGER NOT NULL DEFAULT 1,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shared_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shared_step_references" (
  "id" TEXT NOT NULL,
  "targetSharedStepId" TEXT NOT NULL,
  "testDefinitionId" TEXT,
  "parentSharedStepId" TEXT,
  "stepIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shared_step_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shared_step_references_one_source" CHECK (("testDefinitionId" IS NOT NULL)::integer + ("parentSharedStepId" IS NOT NULL)::integer = 1)
);

ALTER TABLE "test_runs" ADD COLUMN "executedSpec" JSONB;

CREATE UNIQUE INDEX "shared_step_folders_orgId_projectId_parentId_name_key" ON "shared_step_folders"("orgId", "projectId", "parentId", "name");
CREATE INDEX "shared_step_folders_orgId_projectId_idx" ON "shared_step_folders"("orgId", "projectId");
CREATE INDEX "shared_steps_orgId_projectId_isArchived_idx" ON "shared_steps"("orgId", "projectId", "isArchived");
CREATE INDEX "shared_steps_folderId_name_idx" ON "shared_steps"("folderId", "name");
CREATE UNIQUE INDEX "shared_step_references_testDefinitionId_stepIndex_key" ON "shared_step_references"("testDefinitionId", "stepIndex");
CREATE UNIQUE INDEX "shared_step_references_parentSharedStepId_stepIndex_key" ON "shared_step_references"("parentSharedStepId", "stepIndex");
CREATE INDEX "shared_step_references_targetSharedStepId_idx" ON "shared_step_references"("targetSharedStepId");

ALTER TABLE "shared_step_folders" ADD CONSTRAINT "shared_step_folders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_step_folders" ADD CONSTRAINT "shared_step_folders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_step_folders" ADD CONSTRAINT "shared_step_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "shared_step_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shared_steps" ADD CONSTRAINT "shared_steps_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_steps" ADD CONSTRAINT "shared_steps_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_steps" ADD CONSTRAINT "shared_steps_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "shared_step_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shared_step_references" ADD CONSTRAINT "shared_step_references_targetSharedStepId_fkey" FOREIGN KEY ("targetSharedStepId") REFERENCES "shared_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_step_references" ADD CONSTRAINT "shared_step_references_testDefinitionId_fkey" FOREIGN KEY ("testDefinitionId") REFERENCES "test_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_step_references" ADD CONSTRAINT "shared_step_references_parentSharedStepId_fkey" FOREIGN KEY ("parentSharedStepId") REFERENCES "shared_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
