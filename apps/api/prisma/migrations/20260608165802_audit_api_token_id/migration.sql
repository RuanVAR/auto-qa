-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "apiTokenId" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_apiTokenId_idx" ON "audit_logs"("apiTokenId");
