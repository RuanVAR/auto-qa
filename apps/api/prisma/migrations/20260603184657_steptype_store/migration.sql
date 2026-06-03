-- STORE is a supported executable step type (worker step.runner handles it);
-- add it to the enum so recorder-generated STORE steps materialise into RunStep.
ALTER TYPE "StepType" ADD VALUE IF NOT EXISTS 'STORE';
