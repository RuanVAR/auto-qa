-- Per-user ClickUp personal tokens: attribute ClickUp actions to the actual
-- user (opt-in; falls back to the org token). Token stored AES-256-GCM via
-- SecretsService — never hashed, never returned to the client.

-- CreateTable
CREATE TABLE "user_clickup_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "secretsCiphertext" BYTEA NOT NULL,
    "secretsKeyId" TEXT NOT NULL,
    "clickupUserId" INTEGER,
    "clickupUsername" TEXT,
    "clickupEmail" TEXT,
    "connectedAs" TEXT,
    "lastHealthOk" BOOLEAN NOT NULL DEFAULT false,
    "lastHealthAt" TIMESTAMP(3),
    "lastHealthError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_clickup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_clickup_tokens_installId_idx" ON "user_clickup_tokens"("installId");

-- CreateIndex
CREATE UNIQUE INDEX "user_clickup_tokens_userId_installId_key" ON "user_clickup_tokens"("userId", "installId");

-- AddForeignKey
ALTER TABLE "user_clickup_tokens" ADD CONSTRAINT "user_clickup_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_clickup_tokens" ADD CONSTRAINT "user_clickup_tokens_installId_fkey" FOREIGN KEY ("installId") REFERENCES "org_plugin_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
