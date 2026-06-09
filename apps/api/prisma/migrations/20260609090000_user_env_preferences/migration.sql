-- CreateTable
CREATE TABLE "user_env_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_env_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_env_preferences_environmentId_idx" ON "user_env_preferences"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "user_env_preferences_userId_projectId_key" ON "user_env_preferences"("userId", "projectId");

-- AddForeignKey
ALTER TABLE "user_env_preferences" ADD CONSTRAINT "user_env_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_env_preferences" ADD CONSTRAINT "user_env_preferences_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_env_preferences" ADD CONSTRAINT "user_env_preferences_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
