-- Phase 7: EMIT_METRIC step type (value verification + test-emitted metrics).
ALTER TYPE "StepType" ADD VALUE IF NOT EXISTS 'EMIT_METRIC';
