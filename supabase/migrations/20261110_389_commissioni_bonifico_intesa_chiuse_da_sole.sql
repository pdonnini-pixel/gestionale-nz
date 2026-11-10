-- 389 — Le commissioni sui bonifici di Intesa si chiudono da sole
--
-- La chiusura notturna dei movimenti non-fornitore (close_non_supplier_movements,
-- dentro run_daily_reconciliation) salta ogni causale che contiene «A FAVORE»,
-- per non scambiare un bonifico a fornitore per una spesa bancaria. Intesa pero'
-- scrive l'addebito della sola commissione cosi':
--   «COMM. BEU INTER. Bonifico da Voi disposto a favore di: BENEFICIARI DIVERSI - COMMISSIONI ...»
-- e quindi le 10 commissioni da 1,00 EUR del 06/11/2026 su NZ sono rimaste aperte
-- per tre chiusure di fila (07, 08, 09/11), in Riconciliazione e in Prima Nota.
--
-- Correzione: una causale che COMINCIA con «COMM. BEU» e' la sola commissione,
-- e per lei l'esclusione «A FAVORE» non si applica. Tutto il resto e' identico
-- alla versione in produzione (guardie 380 e 364 comprese).
-- Nessun dato cancellato: la funzione continua a fare solo UPDATE di
-- is_reconciled / category / note sui movimenti aperti che riconosce.
--
-- Tenant: NZ + Zago (regola #0, aggiornamento 03/11/2026).

BEGIN;

CREATE OR REPLACE FUNCTION public.close_non_supplier_movements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_n INT;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  PERFORM public.richiedi_profilo_gestionale(); -- migration 364
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
    -- ha una fattura fornitore da cercare, e la sua natura e' certa dalla causale:
    -- per questi due termini l'esclusione non si applica. Le altre restano.
    --
    -- ECCEZIONE per la commissione di Intesa (migration 389): la causale che
    -- comincia con «COMM. BEU» e' l'addebito della sola commissione; «a favore di»
    -- li' descrive il bonifico a cui si riferisce, non un pagamento da agganciare.
    WHERE ( d !~ '(A FAVORE|EFFETTI RITIRAT|RIMBORSO FINANZIAMENT|\yMUTU|PRESTIT|\yASSEGNO|IMPORTO BONIFICI)'
            OR ( d ~ '(EMOLUMENTI|STIPEND|\ySALARI|RETRIBUZ|BUSTA PAGA)'
                 AND d !~ '(EFFETTI RITIRAT|RIMBORSO FINANZIAMENT|\yMUTU|PRESTIT|\yASSEGNO)' )
            OR ( d ~ '^\s*COMM\.\s*BEU\y'
                 AND d !~ '(EFFETTI RITIRAT|RIMBORSO FINANZIAMENT|\yMUTU|PRESTIT|\yASSEGNO|IMPORTO BONIFICI)' ) )
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

COMMIT;

-- Verifica (su ogni tenant):
--   SELECT pg_get_functiondef('public.close_non_supplier_movements'::regproc) ~ 'COMM\\\.\\s\*BEU' AS ok;
