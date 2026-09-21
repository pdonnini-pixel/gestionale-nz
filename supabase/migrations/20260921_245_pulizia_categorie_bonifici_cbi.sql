-- 20260921_245 — Un bonifico non e' una spesa bancaria: pulizia e guardia permanente
--
-- PROBLEMA
-- 20 movimenti fra maggio e luglio 2026, per 210.150,74 EUR (il piu' grande da
-- 56.033,64 del 13/07), portano category = 'spese_banca'. Sono disposizioni di
-- bonifico CBI, non commissioni.
--
-- CAUSA
-- close_non_supplier_movements() classificava sulla causale, e la causale del
-- flusso CBI di MPS contiene sempre la parola COMMISSIONI, perche' la banca
-- scrive «IMPORTO BONIFICI: 56.031,89 IMPORTO COMMISSIONI: 1,75». Il motore
-- leggeva «commissioni» e chiudeva il bonifico come spesa bancaria.
-- L'errore e' stato riconosciuto a luglio: i movimenti sono stati riaperti (la
-- nota dice «riaperto (bonifico reale chiuso per errore come spesa banca)») e la
-- regola corretta con l'esclusione di IMPORTO BONIFICI, ma l'etichetta e'
-- rimasta scritta addosso ai movimenti gia' toccati.
--
-- DOVE FACEVA DANNO
-- La categoria non entra in contabilita', ma decide come il movimento viene
-- letto: filtro della pagina Banche, chiusure automatiche e soprattutto la riga
-- dell'export Prima Nota per lo studio, dove quei bonifici a fornitore uscivano
-- sotto «Spese e commissioni bancarie».
--
-- FIX
-- 1. Pulizia una tantum: category -> NULL su quei movimenti (nessun importo,
--    nessuno stato, nessun aggancio toccato: solo l'etichetta sbagliata).
-- 2. Guardia permanente: clean_bank_category_conflicts(), chiamata ogni notte
--    dentro run_daily_reconciliation(), rifa' la stessa pulizia se l'etichetta
--    dovesse tornare da un'altra strada (arricchimento A-Cube incluso).

-- 1) Guardia permanente ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.clean_bank_category_conflicts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH upd AS (
    UPDATE public.bank_transactions bt
    SET category = NULL,
        note = COALESCE(bt.note || ' | ', '') || 'etichetta spese bancarie rimossa: disposizione di bonifico, non commissione'
    WHERE bt.category IN ('spese_banca', 'commissioni_incasso', 'fees')
      -- Disposizione di pagamento CBI: la banca scorpora l'importo dei bonifici
      -- dalle commissioni. Gli stipendi passano dallo stesso tipo di flusso ma
      -- hanno una loro causale e una loro categoria: non si toccano.
      AND bt.description ~ 'IMPORTO BONIFICI'
      AND bt.description !~ '(EMOLUMENTI|STIPEND)'
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('etichette_corrette', v_n);
END;
$function$;

REVOKE ALL ON FUNCTION public.clean_bank_category_conflicts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clean_bank_category_conflicts() FROM anon;
GRANT EXECUTE ON FUNCTION public.clean_bank_category_conflicts() TO authenticated, service_role;

-- 2) La guardia entra nella catena notturna -------------------------------
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb; v_group jsonb; v_bij jsonb; v_amt jsonb; v_close jsonb;
  v_util jsonb; v_riba jsonb; v_cash jsonb; v_fisc jsonb; v_cat jsonb;
  v_t0 timestamptz := clock_timestamp();
BEGIN
  SET LOCAL statement_timeout = '20min';

  v_disp := public.rerun_distinta_reconciliation();
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  v_riba := public.rerun_riba_provisional_close();
  v_cash := public.rerun_cash_card_provisional_close();
  -- Scadenze fiscali gia' addebitate in banca (F24, IVA, IRAP, INPS, TARI...).
  v_fisc := public.close_paid_fiscal_deadlines();
  -- Etichette che contraddicono la natura del movimento.
  v_cat := public.clean_bank_category_conflicts();

  RETURN jsonb_build_object('distinte', v_disp, 'granitici', v_group, 'biettivo', v_bij,
                            'importo_anonimo', v_amt, 'chiusi_non_fornitore', v_close,
                            'chiusi_utenze', v_util, 'riba_provvisorie', v_riba,
                            'contanti_carte_provvisorie', v_cash,
                            'scadenze_fiscali', v_fisc, 'etichette', v_cat,
                            'run_at', now(),
                            'durata_sec', round(extract(epoch from (clock_timestamp() - v_t0))::numeric, 1));
END;
$function$;

REVOKE ALL ON FUNCTION public.run_daily_reconciliation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_daily_reconciliation() FROM anon;
GRANT EXECUTE ON FUNCTION public.run_daily_reconciliation() TO authenticated, service_role;

-- 3) Pulizia una tantum ---------------------------------------------------
SELECT public.clean_bank_category_conflicts();

-- Verifica:
--   SELECT count(*) FROM bank_transactions
--   WHERE category IN ('spese_banca','commissioni_incasso','fees')
--     AND description ~ 'IMPORTO BONIFICI' AND description !~ '(EMOLUMENTI|STIPEND)';
--   -- atteso: 0
