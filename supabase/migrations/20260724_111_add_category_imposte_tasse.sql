-- 20260724_111_add_category_imposte_tasse.sql
-- Aggiunge la cost_category "Imposte e tasse" (mancante nel piano dei conti).
-- Serve al backfill delle categorie storiche (slug legacy `tasse`, ~694k EUR su NZ)
-- e alla categorizzazione futura di F24 / imposte.
--
-- PARITÀ TENANT: additiva, da applicare su NZ + Made + Zago. L'INSERT è per-company
-- e idempotente (non crea duplicati se la categoria esiste già).
--
-- NB: macro_group = 'oneri_diversi'. Le imposte (F24) sono spesso miste
-- (IVA/ritenute/contributi/imposte): la categoria è un contenitore unico; un
-- eventuale affinamento successivo è possibile.

BEGIN;

INSERT INTO cost_categories (company_id, code, name, macro_group, is_fixed, is_recurring, is_active, sort_order)
SELECT c.id, 'IMPOSTE_TASSE', 'Imposte e tasse', 'oneri_diversi'::cost_macro_group, false, false, true, 900
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM cost_categories cc
  WHERE cc.company_id = c.id AND cc.name = 'Imposte e tasse'
);

COMMIT;

-- Verifica:
-- SELECT company_id, code, name, macro_group FROM cost_categories WHERE name = 'Imposte e tasse';
