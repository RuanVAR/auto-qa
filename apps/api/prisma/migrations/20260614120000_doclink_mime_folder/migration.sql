-- Google Drive plugin: distinguish a DocLink's render path + folder links.
ALTER TABLE "doc_links" ADD COLUMN "externalMimeType" TEXT;
ALTER TABLE "doc_links" ADD COLUMN "isFolder" BOOLEAN NOT NULL DEFAULT false;
