-- ROLLBACK di 20260724_111_add_category_imposte_tasse.sql
-- Rimuove la categoria "Imposte e tasse" SOLO se non è referenziata da alcun movimento
-- (fail-safe: se il backfill 112 l'ha già usata, NON la cancella).

BEGIN;

DELETE FROM cost_categories cc
WHERE cc.name = 'Imposte e tasse'
  AND NOT EXISTS (
    SELECT 1 FROM cash_movements cm WHERE cm.cost_category_id = cc.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM payables p WHERE p.cost_category_id = cc.id
  );

COMMIT;
