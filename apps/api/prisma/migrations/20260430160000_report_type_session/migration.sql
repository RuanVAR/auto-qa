-- Add SESSION variant to ReportType enum.
-- Postgres: enum extension is a single-statement, idempotent IF NOT EXISTS.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'SESSION';
