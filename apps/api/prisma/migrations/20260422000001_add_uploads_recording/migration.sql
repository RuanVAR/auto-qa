CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "orgId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uploads_token_key" ON "uploads"("token");
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "run_steps" ADD COLUMN "evidenceUrls" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "issues" ADD COLUMN "recordingUrl" TEXT;
