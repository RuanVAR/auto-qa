-- Add per-organisation brand accent colour (hex #rrggbb, nullable → use default palette)
ALTER TABLE "organisations" ADD COLUMN "primaryColor" TEXT;
