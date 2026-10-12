-- Migrazione 289 — gli incassi giornalieri seguono la chiusura anche dopo la conferma (12/10/2026)
--
-- daily_revenue è la proiezione della chiusura di cassa, scritta da
-- confirm_cash_closing (173/196) solo nel momento della conferma. Se dopo la
-- conferma cambiano le righe della chiusura (fn_cash_closing_lines_touch
-- ricalcola total_receipts), la proiezione restava vecchia. Caso reale:
-- Franciacorta 30/09/2026, confermata con 0,00 € alle 20:08, poi 2.114,56 €
-- lordi, verificata il 02/10: gli incassi giornalieri dicevano ancora 0.
-- Era l'unica giornata disallineata del 2026.
--
-- Da ora: quando total_receipts di una chiusura confermata o verificata
-- cambia, si rifà la proiezione (stessa funzione della conferma). Il trigger
-- scatta su ogni UPDATE: il totale è ricalcolato da un trigger BEFORE
-- (fn_cash_closing_compute), quindi «UPDATE OF total_receipts» non basterebbe.
-- Vale su ogni tenant. Solo aggiunte.

CREATE OR REPLACE FUNCTION public.fn_cash_closing_reproject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status IN ('confermata', 'verificata')
     AND NEW.total_receipts IS DISTINCT FROM OLD.total_receipts THEN
    PERFORM public.project_cash_closing_to_daily_revenue(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_closing_reproject() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cash_closing_reproject
  AFTER UPDATE ON public.outlet_daily_closings
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_closing_reproject();

-- Riallinea le giornate già disallineate (2026: solo Franciacorta 30/09 su NZ)
SELECT public.project_cash_closing_to_daily_revenue(c.id)
FROM public.outlet_daily_closings c
LEFT JOIN public.daily_revenue d ON d.outlet_id = c.outlet_id AND d.date = c.closing_date
WHERE c.status IN ('confermata', 'verificata')
  AND c.closing_date >= date '2026-01-01'
  AND abs(c.total_receipts - coalesce(d.gross_revenue, 0)) > 0.01;
