-- =============================================================================
-- Il cron della riconciliazione moriva ogni notte per statement_timeout
-- Applicato su NZ + Made + Zago il 04/09/2026.
-- =============================================================================
--
-- COSA SUCCEDEVA. Su NZ il job `reconcile-recurring-daily` (45 5 * * *) falliva
-- da 28 notti consecutive, dall'08/08/2026, sempre con lo stesso errore e sempre
-- dopo esattamente 120 secondi:
--
--   ERROR: canceling statement due to statement timeout
--   CONTEXT: SQL function "invoice_number_keys" during startup
--            SQL function "invoice_cited_in_text" statement 1
--
-- 120 secondi e' il `statement_timeout` di default del ruolo. Prima funzionava:
-- dal 24/07 al 07/08 il job e' andato a buon fine 15 volte, con una durata media
-- di 41,9 secondi. Poi il volume e' cresciuto e ha superato il limite.
--
-- PERCHE' NON E' UN BUG DI LOGICA. Il costo e' movimenti x scadenze candidate.
-- Misura del 04/09 su NZ:
--   1.197 movimenti in uscita non riconciliati
--     283 scadenze candidate
--     105 ms per singola valutazione (EXPLAIN ANALYZE su un movimento reale)
-- Solo il primo dei sette passi vale quindi circa 125 secondi. Il job non fa
-- nulla di sbagliato: gli serve piu' tempo di quanto gliene fosse concesso.
-- Made e Zago non hanno mai fallito (35 successi su 35): hanno molto meno
-- arretrato da valutare.
--
-- IL RIMEDIO, E UN PRIMO TENTATIVO SBAGLIATO. La prima versione di questa
-- migration metteva `SET LOCAL statement_timeout = '20min'` DENTRO la funzione.
-- Non funziona, ed e' stato verificato sul campo: il job e' morto di nuovo a 120
-- secondi netti. PostgreSQL arma il timer all'inizio dello statement, quindi
-- cambiare `statement_timeout` mentre quello statement e' gia' in esecuzione non
-- ha alcun effetto su di esso.
--
-- Il SET deve stare PRIMA della chiamata, e il posto giusto e' il comando del
-- cron job:
--
--   SET statement_timeout = '20min'; SELECT public.run_daily_reconciliation();
--
-- Verificato: con questo comando il giro e' arrivato in fondo in 430,8 secondi
-- (7 minuti e 11), contro i 120 in cui moriva. La funzione conserva comunque il
-- SET LOCAL, innocuo, perche' serve a chi la chiamasse da una sessione propria.
-- In piu' restituisce `durata_sec`, cosi' il tempo resta scritto in
-- cron.job_run_details e il prossimo rallentamento si vede prima che diventi un
-- fallimento.
--
-- RESTA DA FARE. I 105 ms per movimento sono tanti, e crescono con l'arretrato.
-- La cura vera e' non valutare `invoice_cited_in_text` su ogni candidato:
-- pre-calcolare le chiavi del numero fattura in una colonna generata con indice
-- GIN e ridurre il filtro a un lookup. E' un intervento a se', da fare con i
-- test di non regressione del motore v3.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb;
  v_group jsonb;
  v_bij jsonb;
  v_amt jsonb;
  v_close jsonb;
  v_util jsonb;
  v_riba jsonb;
  v_t0 timestamptz := clock_timestamp();
BEGIN
  -- Il job notturno puo' durare piu' dei 2 minuti di default: qui il tempo serve.
  SET LOCAL statement_timeout = '20min';

  v_disp := public.rerun_distinta_reconciliation();
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  v_riba := public.rerun_riba_provisional_close();

  RETURN jsonb_build_object('distinte', v_disp, 'granitici', v_group, 'biettivo', v_bij,
                            'importo_anonimo', v_amt, 'chiusi_non_fornitore', v_close,
                            'chiusi_utenze', v_util, 'riba_provvisorie', v_riba,
                            'run_at', now(),
                            'durata_sec', round(extract(epoch from (clock_timestamp() - v_t0))::numeric, 1));
END;
$function$;

COMMENT ON FUNCTION public.run_daily_reconciliation() IS
  'Giro notturno di riconciliazione (cron reconcile-recurring-daily, 45 5 * * *). Alza il statement_timeout a 20 minuti per la sola durata della chiamata: con il volume di NZ i 2 minuti di default non bastano piu'' e il job falliva ogni notte. Restituisce il conteggio di ogni passo piu'' la durata in secondi.';

-- --- Verifica ---------------------------------------------------------------
-- select status, start_time, end_time, left(return_message, 200)
--   from cron.job_run_details where jobid = (select jobid from cron.job where jobname='reconcile-recurring-daily')
--   order by start_time desc limit 3;
-- Atteso alla prossima esecuzione: status 'succeeded' e il JSON con 'durata_sec'.
