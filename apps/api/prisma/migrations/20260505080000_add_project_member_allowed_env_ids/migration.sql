-- Add allowedEnvironmentIds to ProjectMember for environment-scoped RBAC
ALTER TABLE "project_members" ADD COLUMN IF NOT EXISTS "allowedEnvironmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
