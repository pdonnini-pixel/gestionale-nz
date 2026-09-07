-- =============================================================================
-- Gli stipendi non venivano mai chiusi, e nessuno se n'era accorto
-- Applicato su NZ + Made + Zago il 04/09/2026.
-- =============================================================================
--
-- `close_non_supplier_movements` ha da sempre la regola che riconosce gli
-- emolumenti e li chiude per natura, come fa con F24, giroconti e spese banca.
-- Non è mai scattata, per un effetto collaterale delle esclusioni: gli stipendi
-- si pagano con flussi CBI, e la loro causale contiene «IMPORTO BONIFICI» e
-- «A FAVORE», due delle parole che escludono un movimento dalla chiusura.
--
--   «Causale: DISPOSIZ.PER EMOLUMENTI - Descrizione: FILIALE DISPONENTE 2430
--    ID FLUSSO CBI: 136498058 NUM. TOT. PAGAMENTI: 4 IMPORTO BONIFICI: 10.959,00
--    IMPORTO COMMISSIONI: 5,00 ORD.ORIG:»
--
-- Quell'esclusione era stata messa per non scambiare per spese bancarie i bonifici
-- veri ai fornitori (la parola COMMISSIONI compare in entrambi), ed è giusta: solo
-- che teneva fuori anche i cedolini, che una fattura da cercare non ce l'hanno.
--
-- EFFETTO MISURATO su NZ al 04/09/2026, prima dell'intervento:
--   171 movimenti fermi in «da riconciliare» per 935.193,93 EUR
--   dal 09/01/2025 al 10/08/2026, tutti su MPS
--   tutti con causale inequivocabile: «VOSTRA DISPOSIZIONE PER EMOLUMENTI
--   (STIPENDI, ...)» oppure «DISPOSIZ.PER EMOLUMENTI»
--   nessuno di essi porta anche un'altra esclusione (effetti, mutui, prestiti,
--   assegni): verificato, sono zero
--
-- IL RIMEDIO lascia intatte tutte le esclusioni e apre una sola porta: quando la
-- natura è «stipendi», «IMPORTO BONIFICI» e «A FAVORE» non escludono più. Le altre
-- esclusioni continuano a valere anche per gli emolumenti, per prudenza, benché
-- oggi non ne ricorra nessuna.
--
-- ESITO dell'esecuzione: 174 movimenti chiusi (171 stipendi per 935.193,93 EUR,
-- 2 spese banca per 630,00, 1 carte per 13,20). Uscite non riconciliate scese da
-- 1.200 a 1.024.
--
-- Backup pre-modifica: public._bkp_stipendi_20260904 (171 righe complete).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.close_non_supplier_movements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH cand AS (
    SELECT bt.id, upper(coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')) AS d
    FROM public.bank_transactions bt
    WHERE bt.amount < 0 AND COALESCE(bt.is_reconciled, false) = false AND bt.status IN ('posted', 'booked')
  ),
  match AS (
    SELECT id, d,
      CASE
        WHEN d ~ '(EMOLUMENTI|STIPEND|\ySALARI|RETRIBUZ|BUSTA PAGA)' THEN 'stipendi'
        WHEN d ~ '(\yF24\y|DELEGA UNIFICATA|\yDELEGHE\y|IMPOSTE E TASSE|IMPOSTE/TASSE|\yIRPEF\y|\yINPS\y|\yIRAP\y|RITENUT|\yTRIBUT|DIRITTO CAMERALE|\yTARI\y|CBILL|PAGOPA)' THEN 'tasse'
        WHEN d ~ '(PAG\.?POS|\yCARTA\y|MASTERCARD|\yVISA\y|\yBANCOMAT\y|PRELIEV)' THEN 'carte'
        WHEN d ~ '(GIROCONTO|GIROFONDI|\yTRASFERIMENTO\y)' THEN 'giroconti'
        WHEN d ~ '(COMMISSION|\yONERI\y|COMPETENZE|\yBOLLO\y|INTERESS|PAGOBANCOMAT)' THEN 'spese_banca'
        ELSE NULL
      END AS categoria
    FROM cand
    -- ESCLUSIONI: bonifici a fornitore, RiBa, finanziamenti, assegni, e i flussi
    -- CBI con "IMPORTO BONIFICI" (disposizioni di bonifico reali: la parola
    -- COMMISSIONI nella causale non deve farli scambiare per spese bancarie).
    --
    -- ECCEZIONE per gli stipendi: si pagano proprio con flussi CBI, quindi la loro
    -- causale contiene sempre «IMPORTO BONIFICI» e «A FAVORE». Ma un cedolino non
    -- ha una fattura fornitore da cercare, e la sua natura è certa dalla causale:
    -- per questi due termini l'esclusione non si applica. Le altre restano.
    WHERE ( d !~ '(A FAVORE|EFFETTI RITIRAT|RIMBORSO FINANZIAMENT|\yMUTU|PRESTIT|\yASSEGNO|IMPORTO BONIFICI)'
            OR ( d ~ '(EMOLUMENTI|STIPEND|\ySALARI|RETRIBUZ|BUSTA PAGA)'
                 AND d !~ '(EFFETTI RITIRAT|RIMBORSO FINANZIAMENT|\yMUTU|PRESTIT|\yASSEGNO)' ) )
  ),
  upd AS (
    UPDATE public.bank_transactions bt
    SET is_reconciled = true, reconciled_at = now(), category = m.categoria,
        note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (non-fornitore: ' || m.categoria || ')'
    FROM match m
    WHERE m.id = bt.id AND m.categoria IS NOT NULL
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('chiusi', v_n);
END;
$function$;

-- --- Verifica ---------------------------------------------------------------
-- select category, count(*), round(sum(-amount),2) from bank_transactions
--   where reconciled_at > now() - interval '5 minutes' and amount < 0 group by 1;
-- Atteso su NZ: stipendi 171 / 935.193,93.
