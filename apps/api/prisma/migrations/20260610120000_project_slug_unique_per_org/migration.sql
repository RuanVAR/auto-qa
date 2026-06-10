-- Project slug uniqueness moves from platform-wide to per-organisation.
-- All existing slugs are globally unique, so (orgId, slug) pairs are already
-- unique — this migration is data-safe.

-- DropIndex
DROP INDEX "projects_slug_key";

-- CreateIndex
CREATE UNIQUE INDEX "projects_orgId_slug_key" ON "projects"("orgId", "slug");
