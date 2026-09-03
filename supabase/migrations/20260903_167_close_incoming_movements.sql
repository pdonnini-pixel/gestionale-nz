-- =============================================================================
-- Entrate: chiusura per natura degli incassi che non hanno una controparte
-- =============================================================================
--
-- IL PROBLEMA. Il motore di riconciliazione ha sempre lavorato solo sulle uscite:
-- ogni `try_match_*` filtra `amount < 0`. Risultato, sul 2026: uscite riconciliate
-- al 56,7%, entrate allo 0,0% su 4.261 movimenti. Incassi POS, versamenti di
-- contante e accrediti restavano per sempre nella lista "da riconciliare".
--
-- PERCHE' NON BASTA ESTENDERE IL MOTORE. Un incasso POS non ha un documento da
-- agganciare: `daily_revenue`, `invoices` e `pos_imports` sono vuote, non esiste
-- un ciclo attivo caricato. Cercare una controparte che non c'e' e' inutile.
-- Quello che serve e' distinguere l'incasso che si spiega da solo (POS, versamento
-- in cassa continua) da quello che una persona deve davvero guardare.
--
-- COSA FA. Stesso schema gia' usato per le uscite da `close_non_supplier_movements`:
-- marca il movimento come riconciliato assegnandogli una `category` e una nota che
-- dice perche'. Non inventa abbinamenti, non tocca importi.
--
--   incassi_pos   POS, PagoBancomat, circuiti, Numia (il gestore dei terminali)
--   versamenti    contante, cassa continua, ATM
--   finanziarie   interessi attivi, storni, accredito competenze
--
-- COSA RESTA FUORI, apposta: bonifici in entrata, erogazioni di finanziamento,
-- giroconti, fideiussioni. Sono gli unici che possono avere una controparte
-- (rimborsi da fornitore, note di credito incassate, versamenti soci) e vanno
-- guardati da una persona. Su NZ al 03/09/2026 sono 90 movimenti in tutto: 83
-- bonifici per 1.211.644,52 €, un finanziamento da 64.100,00 €, 5 fideiussioni e
-- un giroconto.
--
-- Effetto atteso su NZ: 7.766 entrate chiuse per natura, 90 da guardare.
--
-- SICUREZZA. Di default gira in `dry_run`: conta e basta, non scrive niente.
-- Per eseguire davvero serve `select public.close_incoming_movements(false);`,
-- che va lanciato solo con l'ok esplicito di Patrizio (7.766 righe di tabella viva).
-- NON e' agganciata al cron: e' un'operazione una tantum, decisa da una persona.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.close_incoming_movements(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_res jsonb; v_n int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _inc_match (id uuid, categoria text) ON COMMIT DROP;
  DELETE FROM _inc_match;

  INSERT INTO _inc_match (id, categoria)
  SELECT x.id,
    CASE
      WHEN d ~ '(P\.?O\.?S\.?|PAGOBANCOMAT|\yCARTE\y|MASTERCARD|\yVISA\y|AMERICAN EXPRESS|CIRCUITO|ACCREDITO POS|INCASSO TRAMITE|NUMIA|INCASSI INTERNAZIONALI)' THEN 'incassi_pos'
      WHEN d ~ '(VERSAMENTO|VERS\.|CASSA CONTIN|\yATM\y)' THEN 'versamenti'
      WHEN d ~ '(INTERESS|STORNO|ACCREDITO COMPETENZE)' THEN 'finanziarie'
      ELSE NULL
    END
  FROM (
    SELECT bt.id,
           upper(coalesce(bt.description,'') || ' ' || coalesce(bt.counterpart,'') || ' ' || coalesce(bt.merchant_name,'')) AS d
    FROM public.bank_transactions bt
    WHERE bt.amount > 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted','booked')
  ) x
  -- Esclusioni: tutto cio' che puo' avere una controparte da cercare.
  WHERE d !~ '(BONIFICO|BON ISTANT|A VOSTRO FAVORE|A FAVORE DI|\yGIROCONTO\y|GIROC|FINANZIAMENT|\yMUTU|ANTICIPO|FIDEIUSSION|FIDEJ)';

  DELETE FROM _inc_match WHERE categoria IS NULL;

  SELECT jsonb_object_agg(categoria, n) INTO v_res
  FROM (SELECT categoria, count(*) n FROM _inc_match GROUP BY categoria) y;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'da_chiudere', COALESCE(v_res, '{}'::jsonb),
      'totale', (SELECT count(*) FROM _inc_match),
      'valore', (SELECT round(sum(bt.amount),2) FROM public.bank_transactions bt JOIN _inc_match m ON m.id = bt.id));
  END IF;

  UPDATE public.bank_transactions bt
  SET is_reconciled = true,
      reconciled_at = now(),
      category = m.categoria,
      note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (entrata: ' || m.categoria || ')'
  FROM _inc_match m
  WHERE m.id = bt.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('dry_run', false, 'chiusi', v_n, 'per_categoria', COALESCE(v_res, '{}'::jsonb));
END;
$function$;

COMMENT ON FUNCTION public.close_incoming_movements(boolean) IS
  'Chiude per natura gli incassi che non hanno una controparte documentale (POS, versamenti, interessi), lasciando aperti bonifici, finanziamenti e giroconti, che una persona deve guardare. Di default e'' in dry run: per scrivere serve close_incoming_movements(false).';

REVOKE ALL ON FUNCTION public.close_incoming_movements(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_incoming_movements(boolean) TO authenticated, service_role;

COMMIT;
