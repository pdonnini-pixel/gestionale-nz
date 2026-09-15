-- =====================================================================
-- Migrazione 118 — Utenze (addebiti permanenti): chiusura automatica senza fattura
-- =====================================================================
-- REGOLA (Patrizio): le utenze con addebito permanente (RID/SDD) — HERA, Enel,
-- Enegan, Acea… — di norma NON si agganciano a una fattura (la bolletta non viene
-- registrata come fattura passiva). Vanno "chiuse come utenza": movimento marcato
-- riconciliato e categorizzato, senza fattura — come già si fa con F24, bolli,
-- stipendi (close_non_supplier_movements). Oggi però questi addebiti restano aperti
-- perché sono "A FAVORE <fornitore>" e la chiusura non-fornitore li esclude apposta.
--
-- SOLUZIONE (sotto controllo dell'utente):
--   • flag `is_utility` sul fornitore (lo spunta l'utente in Fornitori);
--   • close_utility_movements(): gli addebiti in uscita intestati a un fornitore
--     `is_utility`, che NON hanno una fattura agganciata né una proposta pendente,
--     si chiudono da soli (is_reconciled=true, categoria 'utenze'). Se invece una
--     bolletta È caricata come fattura, i matcher la agganciano PRIMA (precedenza
--     alla fattura) e questa funzione non la tocca.
--   • agganciata a run_daily_reconciliation come ultimo passo.
--
-- Additiva/idempotente. NON distruttiva (solo is_reconciled/category; reversibile a
-- mano rimettendo is_reconciled=false). ⚠️ REGOLA #0 — NZ + Made + Zago.
-- =====================================================================

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS is_utility boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.suppliers.is_utility IS 'Utenza con addebito permanente (RID/SDD): i suoi addebiti senza fattura si chiudono come utenza';

CREATE OR REPLACE FUNCTION public.close_utility_movements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH upd AS (
    UPDATE public.bank_transactions bt
    SET is_reconciled = true,
        reconciled_at = now(),
        category = COALESCE(bt.category, 'utenze'),
        note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (utenza — addebito permanente)'
    WHERE bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      -- niente fattura agganciata né proposta pendente: la fattura ha sempre la precedenza
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_log rl
        WHERE rl.bank_transaction_id = bt.id AND rl.status IN ('applied', 'to_confirm'))
      -- beneficiario = fornitore marcato come utenza (per P.IVA o nome distintivo)
      AND EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.company_id = bt.company_id
          AND COALESCE(s.is_utility, false) = true
          AND public.supplier_confirmed_in_text(
                s.name, COALESCE(s.vat_number, s.partita_iva),
                coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')))
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('chiusi_utenze', v_n);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.close_utility_movements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_utility_movements() TO authenticated, service_role;

-- run_daily_reconciliation: aggiunge la chiusura utenze come ultimo passo.
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group jsonb;
  v_bij jsonb;
  v_amt jsonb;
  v_close jsonb;
  v_util jsonb;
BEGIN
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  RETURN jsonb_build_object('granitici', v_group, 'biettivo', v_bij, 'importo_anonimo', v_amt,
                            'chiusi_non_fornitore', v_close, 'chiusi_utenze', v_util, 'run_at', now());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.run_daily_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_daily_reconciliation() TO service_role;
