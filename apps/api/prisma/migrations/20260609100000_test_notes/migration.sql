-- CreateTable
CREATE TABLE "test_notes" (
    "id" TEXT NOT NULL,
    "testDefinitionId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "lastEditedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_notes_testDefinitionId_key" ON "test_notes"("testDefinitionId");

-- AddForeignKey
ALTER TABLE "test_notes" ADD CONSTRAINT "test_notes_testDefinitionId_fkey" FOREIGN KEY ("testDefinitionId") REFERENCES "test_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_notes" ADD CONSTRAINT "test_notes_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
