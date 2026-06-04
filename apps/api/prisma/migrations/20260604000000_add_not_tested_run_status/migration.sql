-- Add NOT_TESTED to the RunStatus enum. Represents a test the user never
-- evaluated before ending a manual session (a normal end, not an abort).
ALTER TYPE "RunStatus" ADD VALUE IF NOT EXISTS 'NOT_TESTED';
