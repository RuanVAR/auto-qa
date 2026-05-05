-- Add allowedEnvironmentIds to ProjectMember for environment-scoped RBAC
ALTER TABLE "ProjectMember" ADD COLUMN IF NOT EXISTS "allowedEnvironmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
