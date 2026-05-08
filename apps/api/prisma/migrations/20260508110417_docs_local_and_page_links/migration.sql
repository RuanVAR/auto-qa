-- AlterTable
ALTER TABLE "doc_links" ADD COLUMN     "pageId" TEXT,
ADD COLUMN     "testDefinitionId" TEXT;

-- CreateTable
CREATE TABLE "docs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "moduleId" TEXT,
    "featureId" TEXT,
    "testDefinitionId" TEXT,
    "title" TEXT NOT NULL,
    "markdown" TEXT NOT NULL DEFAULT '',
    "summary" TEXT,
    "authorId" TEXT,
    "editorId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "docs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "docs_orgId_featureId_idx" ON "docs"("orgId", "featureId");

-- CreateIndex
CREATE INDEX "docs_orgId_moduleId_idx" ON "docs"("orgId", "moduleId");

-- CreateIndex
CREATE INDEX "docs_orgId_projectId_idx" ON "docs"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "docs_orgId_testDefinitionId_idx" ON "docs"("orgId", "testDefinitionId");

-- CreateIndex
CREATE INDEX "doc_links_orgId_testDefinitionId_idx" ON "doc_links"("orgId", "testDefinitionId");

-- AddForeignKey
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_testDefinitionId_fkey" FOREIGN KEY ("testDefinitionId") REFERENCES "test_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "docs" ADD CONSTRAINT "docs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "docs" ADD CONSTRAINT "docs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "docs" ADD CONSTRAINT "docs_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "docs" ADD CONSTRAINT "docs_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "docs" ADD CONSTRAINT "docs_testDefinitionId_fkey" FOREIGN KEY ("testDefinitionId") REFERENCES "test_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "docs" ADD CONSTRAINT "docs_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "docs" ADD CONSTRAINT "docs_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
