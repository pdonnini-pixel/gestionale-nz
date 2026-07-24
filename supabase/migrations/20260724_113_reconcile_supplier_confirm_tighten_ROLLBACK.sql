-- =====================================================================
-- ROLLBACK Migrazione 113
-- =====================================================================
-- ⚠️ SCONSIGLIATO: riporta la conferma fornitore alla logica "larga" (qualsiasi
-- parola >=4 lettere), reintroducendo le collisioni su parole generiche
-- (PROPCO/GRUPPO…). Siccome i tre matcher (biettivo/gruppo/punteggio) passano tutti
-- dall'helper `supplier_confirmed_in_text`, basta ridefinire l'helper: non serve
-- toccare i matcher. Gli UNDO di dati (scollegamenti) NON vengono ripristinati (non è
-- data loss: il motore li ri-deriva).
-- ⚠️ REGOLA #0 — NZ + Made + Zago.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.supplier_confirmed_in_text(p_name text, p_vat text, p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    (p_vat IS NOT NULL AND p_vat <> '' AND position(lower(p_vat) in lower(coalesce(p_text, ''))) > 0)
    OR EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(coalesce(p_name, '')), '[^a-z0-9]+') w
      WHERE length(w) >= 4
        AND position(w in lower(coalesce(p_text, ''))) > 0
    );
$function$;
