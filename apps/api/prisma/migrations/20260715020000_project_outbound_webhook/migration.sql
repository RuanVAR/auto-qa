-- Outbound webhook per project: signed feature_run.completed events.
ALTER TABLE "projects" ADD COLUMN "webhookUrl" TEXT;
ALTER TABLE "projects" ADD COLUMN "webhookSecretCiphertext" BYTEA;
ALTER TABLE "projects" ADD COLUMN "webhookSecretKeyId" TEXT;
