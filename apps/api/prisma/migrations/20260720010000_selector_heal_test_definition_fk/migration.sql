-- Phase 2.7 follow-up: SelectorHeal.testDefinitionId was a bare column with
-- no relation since the model's original design — needed now for the review
-- queue's `include: { testDefinition }` query. Safe as a same-day follow-up
-- rather than amending 20260720000000 (already applied): "never edit an
-- applied migration" per docs/plan/09-CONVENTIONS.md.
--
-- No backfill needed — table is empty in every environment this has shipped
-- to (verified: 0 rows in dev before this migration).
--
-- Down (on paper):
--   ALTER TABLE selector_heals DROP CONSTRAINT selector_heals_testDefinitionId_fkey;

ALTER TABLE "selector_heals"
  ADD CONSTRAINT "selector_heals_testDefinitionId_fkey"
  FOREIGN KEY ("testDefinitionId") REFERENCES "test_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
