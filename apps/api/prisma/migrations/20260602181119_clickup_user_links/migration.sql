-- Maps QA-platform users to ClickUp users per install/workspace, so assigning
-- an issue can also assign the linked ClickUp task.
CREATE TABLE "clickup_user_links" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "qaUserId" TEXT NOT NULL,
    "clickupUserId" INTEGER NOT NULL,
    "clickupUsername" TEXT,
    "clickupEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "clickup_user_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clickup_user_links_installId_qaUserId_key" ON "clickup_user_links"("installId", "qaUserId");
CREATE UNIQUE INDEX "clickup_user_links_installId_clickupUserId_key" ON "clickup_user_links"("installId", "clickupUserId");
CREATE INDEX "clickup_user_links_orgId_idx" ON "clickup_user_links"("orgId");

ALTER TABLE "clickup_user_links" ADD CONSTRAINT "clickup_user_links_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clickup_user_links" ADD CONSTRAINT "clickup_user_links_installId_fkey" FOREIGN KEY ("installId") REFERENCES "org_plugin_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clickup_user_links" ADD CONSTRAINT "clickup_user_links_qaUserId_fkey" FOREIGN KEY ("qaUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
