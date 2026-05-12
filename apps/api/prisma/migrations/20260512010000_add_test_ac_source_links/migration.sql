-- CreateTable
CREATE TABLE "test_ac_source_links" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "sectionSlug" TEXT,
    "pageTitle" TEXT,
    "sectionTitle" TEXT,
    "externalUrl" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncedContent" TEXT,
    "lastSyncedHash" TEXT,
    "lastAppliedAt" TIMESTAMP(3),
    "lastAppliedHash" TEXT,
    "previousDescription" TEXT,
    "previousAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_ac_source_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_ac_source_links_testId_key" ON "test_ac_source_links"("testId");

-- CreateIndex
CREATE INDEX "test_ac_source_links_installId_idx" ON "test_ac_source_links"("installId");

-- AddForeignKey
ALTER TABLE "test_ac_source_links" ADD CONSTRAINT "test_ac_source_links_testId_fkey" FOREIGN KEY ("testId") REFERENCES "test_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_ac_source_links" ADD CONSTRAINT "test_ac_source_links_installId_fkey" FOREIGN KEY ("installId") REFERENCES "org_plugin_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
