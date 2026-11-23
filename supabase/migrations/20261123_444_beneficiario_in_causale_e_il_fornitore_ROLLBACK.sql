-- =====================================================================
-- ROLLBACK 444 — togli la regola del beneficiario dal ramo «abbinamento per data»
-- =====================================================================
-- Le due funzioni di lettura restano: non decidono niente da sole e non danno
-- fastidio a nessuno. Si toglie solo la riga nel motore.
-- =====================================================================

BEGIN;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.rerun_bijective_reconciliation()'::regprocedure) INTO v_def;
  v_new := replace(v_def,
$o$
      -- 444: se la causale nomina un beneficiario, quello deve essere il
      -- fornitore. Salta il controllo solo chi ha la prova più forte, il numero
      -- di questa fattura citato in causale. Nata dall'addebito Global Blue
      -- agganciato a UNICOOP Firenze perché in causale c'era la parola FIRENZE.
      AND (public.invoice_cited_in_text(coalesce(v_pay.invoice_number, ''),
                                        public.causale_per_numeri(bt.description), 2)
           OR public.beneficiario_coerente(
                coalesce(bt.statement_description, bt.description, ''),
                v_pay.supplier_name, v_pay.supplier_vat))$o$, '');
  IF v_new ~ 'beneficiario_coerente' THEN
    RAISE EXCEPTION 'rerun_bijective_reconciliation: non ho trovato le righe da togliere';
  END IF;
  EXECUTE v_new;
END
$patch$;

COMMIT;

-- Per togliere anche le due funzioni di lettura:
--   DROP FUNCTION IF EXISTS public.beneficiario_coerente(text, text, text);
--   DROP FUNCTION IF EXISTS public.beneficiario_in_causale(text);
