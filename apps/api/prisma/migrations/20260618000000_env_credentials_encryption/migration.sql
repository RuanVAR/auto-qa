-- Phase 5c: per-environment encrypted credentials + encrypt env config at rest.

-- Encrypted-at-rest columns for env variables/headers (dual-read: ciphertext
-- preferred, legacy plaintext JSON kept as fallback until next save).
ALTER TABLE "environments" ADD COLUMN "variablesCiphertext" BYTEA;
ALTER TABLE "environments" ADD COLUMN "variablesKeyId" TEXT;
ALTER TABLE "environments" ADD COLUMN "headersCiphertext" BYTEA;
ALTER TABLE "environments" ADD COLUMN "headersKeyId" TEXT;

-- Named, encrypted login credentials scoped to an environment.
CREATE TABLE "environment_credentials" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretsCiphertext" BYTEA NOT NULL,
    "secretsKeyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "environment_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "environment_credentials_environmentId_name_key" ON "environment_credentials"("environmentId", "name");

ALTER TABLE "environment_credentials" ADD CONSTRAINT "environment_credentials_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
