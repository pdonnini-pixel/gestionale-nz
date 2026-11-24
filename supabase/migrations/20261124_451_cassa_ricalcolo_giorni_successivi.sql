-- 20261124_451_cassa_ricalcolo_giorni_successivi.sql
--
-- La cassa attesa dei giorni dopo si ricalcola da sola.
--
-- Il problema, trovato il 24/11/2026 su Brugnato. La cassa attesa di una
-- giornata parte dall'ultima chiusura precedente confermata o verificata
-- (`fn_cash_closing_compute`): fondo contato + contanti da versare di quel
-- giorno. Quel calcolo pero' avviene solo quando si tocca la riga di quella
-- giornata. Quindi se una chiusura vecchia viene riaperta, riconfermata o
-- corretta nel fondo contato, i giorni dopo restano fermi al numero vecchio e
-- nessuno lo dice a nessuno: l'istruttoria dei controlli guarda la giornata di
-- oggi e quella di ieri, mai le altre.
--
-- Il caso: Brugnato, uscita di cassa di 20,00 EUR registrata il 20/11 con
-- importo 0,00. Sistemata il 24/11, il 20 e il 21 tornavano a zero ma il 22
-- continuava a mostrare un'eccedenza di 359,10 EUR che non esisteva, dal
-- lunedi' mattina, senza nemmeno una segnalazione accanto.
--
-- Il rimedio: dopo ogni cambio che sposta il punto di partenza della catena
-- (lo stato, il fondo contato, i contanti da versare), le chiusure successive
-- dello stesso negozio vengono ritoccate con un UPDATE a vuoto, che fa
-- ripartire il trigger BEFORE e ricalcolare i campi derivati.
--
-- Cosa NON tocca, per la regola «il gestionale non riscrive i numeri contati a
-- mano»: `cash_float_declared`, `cash_pending_declared`, `total_receipts`, le
-- righe, le spese, i versamenti, lo stato e `bank_verified_at`. Si muovono solo
-- i campi calcolati (`cash_float_expected`, `cash_difference`,
-- `channels_total`, `receipts_difference`, ...), che sono la fotografia dei
-- dati veri e devono tornare giusti.
--
-- Perche' non manda nessun messaggio: l'UPDATE non cambia `status`, quindi
-- `trg_cash_closing_report_dispatch` (AFTER UPDATE OF status) e
-- `allinea_chiusura_confermata` (AFTER UPDATE OF status) non partono; e non
-- cambia `total_receipts`, quindi `trg_cash_closing_reproject` non riproietta
-- niente in `daily_revenue`. Il ricalcolo e' silenzioso di proposito: se dopo
-- il ricalcolo un giorno ha una differenza vera, la fa vedere la pagina e la
-- raccoglie l'istruttoria, non una mail in mezzo alla notte.
--
-- DELETE non e' coperto: cancellare una chiusura e' un'operazione eccezionale
-- (regola NO DATA LOSS) e un trigger sul DELETE girerebbe anche durante le
-- cancellazioni a cascata. Se un giorno si cancella una chiusura a mano, si
-- chiama `ricalcola_cassa_successive` a mano subito dopo.

BEGIN;

CREATE OR REPLACE FUNCTION public.ricalcola_cassa_successive(
  p_outlet_id uuid,
  p_dal       date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r     record;
  v_n   integer := 0;
BEGIN
  IF p_outlet_id IS NULL OR p_dal IS NULL THEN RETURN 0; END IF;

  -- In ordine di data, dal piu' vecchio al piu' nuovo. Si va avanti fino alla
  -- prima giornata confermata (o verificata) con il fondo contato scritto:
  -- quella diventa il nuovo punto di partenza della catena, quindi i giorni
  -- dopo di lei non cambiano. Misurato il 24/11/2026 su Brugnato: spostando di
  -- 100 i contanti da versare del 21, la cassa attesa del 22 si muove e quella
  -- del 23 no, perche' il 23 riparte dal fondo CONTATO del 22, che nessuno ha
  -- toccato. In pratica si ritocca una riga sola, non tutte quelle dopo.
  FOR r IN
    SELECT id, status, cash_float_declared
      FROM public.outlet_daily_closings
     WHERE outlet_id = p_outlet_id AND closing_date > p_dal
     ORDER BY closing_date
  LOOP
    -- UPDATE a vuoto: fa partire il trigger BEFORE (fn_cash_closing_compute),
    -- che riscrive i campi calcolati e aggiorna updated_at da solo.
    UPDATE public.outlet_daily_closings SET updated_at = updated_at WHERE id = r.id;
    v_n := v_n + 1;

    EXIT WHEN r.status IN ('confermata', 'verificata') AND r.cash_float_declared IS NOT NULL;
  END LOOP;

  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.ricalcola_cassa_successive(uuid, date) IS
  'Ricalcola i campi derivati (cassa attesa e differenza) delle chiusure di un negozio successive a una data, dopo che il punto di partenza della catena e'' cambiato. Non tocca nessun numero contato a mano e non manda messaggi (migration 451).';

-- Solo il database la chiama: dal trigger, dal cron o dal service role.
REVOKE ALL ON FUNCTION public.ricalcola_cassa_successive(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ricalcola_cassa_successive(uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.ricalcola_cassa_successive(uuid, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ricalcola_cassa_successive(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_cassa_ricalcola_successive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Il ricalcolo fa partire questo stesso trigger sulle righe dei giorni dopo:
  -- si lavora solo alla prima chiamata, altrimenti si girerebbe a vuoto per
  -- ogni giornata della catena.
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  -- I confronti stanno qui e non nella clausola WHEN del trigger: in un
  -- trigger che prende anche l'INSERT la WHEN non puo' nominare OLD.
  IF TG_OP = 'UPDATE'
     AND NEW.status                IS NOT DISTINCT FROM OLD.status
     AND NEW.cash_float_declared   IS NOT DISTINCT FROM OLD.cash_float_declared
     AND NEW.cash_pending_declared IS NOT DISTINCT FROM OLD.cash_pending_declared
  THEN
    RETURN NULL;
  END IF;

  PERFORM public.ricalcola_cassa_successive(NEW.outlet_id, NEW.closing_date);
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.trg_cassa_ricalcola_successive() IS
  'Dopo un cambio di stato, di fondo contato o di contanti da versare, rimanda al ricalcolo delle chiusure successive dello stesso negozio (migration 451).';

DROP TRIGGER IF EXISTS trg_cassa_ricalcola_successive ON public.outlet_daily_closings;

CREATE TRIGGER trg_cassa_ricalcola_successive
AFTER INSERT OR UPDATE OF status, cash_float_declared, cash_pending_declared
ON public.outlet_daily_closings
FOR EACH ROW
WHEN (pg_trigger_depth() <= 1)
EXECUTE FUNCTION public.trg_cassa_ricalcola_successive();

COMMIT;

-- Verifica, su NZ e su Zago:
--
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--  WHERE tgrelid = 'public.outlet_daily_closings'::regclass AND NOT tgisinternal
--  ORDER BY tgname;
--
-- Prova che la catena si risistema (in una transazione annullata):
--
-- BEGIN;
--   UPDATE public.outlet_daily_closings SET cash_pending_declared = cash_pending_declared + 100
--    WHERE id = '<una chiusura confermata>';
--   SELECT closing_date, cash_float_expected, cash_difference
--     FROM public.outlet_daily_closings
--    WHERE outlet_id = '<quel negozio>' AND closing_date >= '<quella data>'
--    ORDER BY closing_date;   -- i giorni dopo devono essersi spostati di 100
-- ROLLBACK;
