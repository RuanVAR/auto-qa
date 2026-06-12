-- Make a manual "Skip" a first-class verdict instead of overloading CANCELLED.
-- ADD VALUE must commit before the value can be used, so the backfill lives in
-- a separate migration (next).
ALTER TYPE "RunStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
