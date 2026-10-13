-- 20261013_303_ricavo_giorno_con_fatture.sql
--
-- Il ricavo del giorno proiettato dalla chiusura cassa ignorava le fatture.
-- `project_cash_closing_to_daily_revenue` scriveva in daily_revenue solo
-- `total_receipts` (i corrispettivi), mentre nella chiusura la fattura emessa
-- in negozio sta a parte, nel canale "Fatture" (`invoices_total`), ed e' un
-- incasso vero: l'incasso del giorno e' corrispettivi + fatture, come mostra
-- la riga "= Totale incassato" di Incassi giornalieri.
--
-- Effetto prima: 40 chiusure con fattura avevano un ricavo sottostimato
-- dell'importo della fattura (da 47,90 a 1.080,69 EUR al giorno).
-- Qui si corregge la funzione e si riproiettano quelle giornate.
--
-- Nessun dato cancellato: daily_revenue viene aggiornato in UPSERT dalla
-- stessa funzione che lo alimenta normalmente.

BEGIN;

CREATE OR REPLACE FUNCTION public.project_cash_closing_to_daily_revenue(p_closing_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c        public.outlet_daily_closings%ROWTYPE;
  v_cash   numeric(14,2) := 0;
  v_card   numeric(14,2) := 0;
  v_other  numeric(14,2) := 0;
  v_gross  numeric(14,2) := 0;
  v_vat    numeric := 22;
BEGIN
  SELECT * INTO c FROM public.outlet_daily_closings WHERE id = p_closing_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN ch.kind = 'contanti' THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ch.kind IN ('pos', 'pos_amex') THEN l.amount ELSE 0 END), 0)
  INTO v_cash, v_card
  FROM public.outlet_daily_closing_lines l
  JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
  WHERE l.closing_id = c.id;

  -- incassato del giorno = corrispettivi + fatture emesse in negozio
  v_gross := COALESCE(c.total_receipts, 0) + COALESCE(c.invoices_total, 0);
  v_other := GREATEST(v_gross - v_cash - v_card, 0);

  v_vat := COALESCE(
    (SELECT s.budget_vat_rate FROM public.daily_report_settings s WHERE s.company_id = c.company_id),
    (SELECT NULLIF(co.settings->>'cash_closing_vat_rate', '')::numeric FROM public.companies co WHERE co.id = c.company_id),
    22);

  INSERT INTO public.daily_revenue AS dr
    (company_id, outlet_id, date, gross_revenue, net_revenue, transactions_count,
     avg_ticket, cash_amount, card_amount, other_amount, source, notes)
  VALUES
    (c.company_id, c.outlet_id, c.closing_date, v_gross,
     ROUND(v_gross / (1 + v_vat / 100), 2), 0, 0,
     v_cash, v_card, v_other, 'manuale'::import_source,
     'Chiusura cassa ' || c.id::text)
  ON CONFLICT (company_id, outlet_id, date) DO UPDATE SET
    gross_revenue = EXCLUDED.gross_revenue,
    net_revenue   = EXCLUDED.net_revenue,
    cash_amount   = EXCLUDED.cash_amount,
    card_amount   = EXCLUDED.card_amount,
    other_amount  = EXCLUDED.other_amount,
    source        = EXCLUDED.source,
    notes         = EXCLUDED.notes;
END;
$function$;

-- Riproiezione delle giornate con fattura (le altre restano identiche)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.outlet_daily_closings
     WHERE COALESCE(invoices_total, 0) > 0
       AND status IN ('confermata', 'verificata')
       AND NOT is_closed_day
  LOOP
    PERFORM public.project_cash_closing_to_daily_revenue(r.id);
  END LOOP;
END $$;

COMMIT;

-- Verifica: nessuna giornata con fattura deve restare col ricavo sottostimato
-- SELECT c.closing_date, o.name, c.total_receipts, c.invoices_total, dr.gross_revenue
--   FROM public.outlet_daily_closings c
--   JOIN public.outlets o ON o.id = c.outlet_id
--   LEFT JOIN public.daily_revenue dr ON dr.outlet_id = c.outlet_id AND dr.date = c.closing_date
--  WHERE COALESCE(c.invoices_total, 0) > 0
--    AND dr.gross_revenue IS DISTINCT FROM c.total_receipts + c.invoices_total;
