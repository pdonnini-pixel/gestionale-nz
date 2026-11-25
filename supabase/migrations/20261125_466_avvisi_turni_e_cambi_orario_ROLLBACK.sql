-- ROLLBACK della 466. Toglie trigger, cron e funzioni; la tabella turni_avvisi e la colonna
-- turni_pubblicati_tolti.dopo restano (nessun dato si cancella). Le righe «cambiato» del
-- registro restano: il vincolo torna a escluderle solo per le righe nuove (NOT VALID).
BEGIN;
DROP TRIGGER IF EXISTS trg_shifts_avvisi_e_cambi ON public.shifts;
DROP FUNCTION IF EXISTS public.shifts_avvisi_e_cambi();
DROP FUNCTION IF EXISTS public.turni_avvisi_tick();
DROP FUNCTION IF EXISTS public.turni_avvisi_da_mandare();
DROP FUNCTION IF EXISTS public.app_dipendente_avvisi_turni();
DROP FUNCTION IF EXISTS public.app_dipendente_avvisi_turni_letti(bigint[]);
ALTER TABLE public.turni_pubblicati_tolti DROP CONSTRAINT IF EXISTS turni_pubblicati_tolti_azione_check;
ALTER TABLE public.turni_pubblicati_tolti ADD CONSTRAINT turni_pubblicati_tolti_azione_check
  CHECK (azione IN ('annullato', 'ritirato', 'cancellato')) NOT VALID;
COMMIT;
SELECT cron.unschedule('turni-avvisi-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'turni-avvisi-tick');
