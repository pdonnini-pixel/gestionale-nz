-- ROLLBACK di 20260724_112_backfill_cost_category_from_legacy.sql
-- Ripristina cost_category_id/ai_* allo stato pre-backfill usando la tabella di backup.
-- ⚠️ Eseguire PRIMA che vengano fatte conferme manuali sulla pagina AI Categorie,
--    altrimenti anche quelle verrebbero riportate indietro. La tabella di backup
--    fotografa lo stato al momento del backfill.

BEGIN;

UPDATE cash_movements cm
SET cost_category_id = b.cost_category_id,
    ai_method        = b.ai_method,
    ai_confidence    = b.ai_confidence,
    ai_categorized_at = b.ai_categorized_at
FROM _backup_cash_movements_cat_20260724 b
WHERE cm.id = b.id;

DROP TABLE _backup_cash_movements_cat_20260724;

COMMIT;
