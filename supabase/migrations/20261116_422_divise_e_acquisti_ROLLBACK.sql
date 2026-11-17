-- Rollback della 422 (divise e acquisti).
-- ATTENZIONE: cancella i capi registrati, le divise, gli sconti, i gestori e il registro.
-- Prima salvare tutto:
--   SELECT * FROM public.employee_capi; SELECT * FROM public.employee_divise;
--   SELECT * FROM public.employee_divise_sconti; SELECT * FROM public.divise_impostazioni;
--   SELECT * FROM public.divise_gestori; SELECT * FROM public.divise_registro;
--   SELECT * FROM public.divise_richieste;
-- e chiedere la conferma di Patrizio (regola NO DATA LOSS).
BEGIN;
DROP FUNCTION IF EXISTS public.app_dipendente_divise();
DROP FUNCTION IF EXISTS public.divise_gestore_imposta(uuid, boolean);
DROP FUNCTION IF EXISTS public.divise_impostazioni_salva(numeric, numeric);
DROP FUNCTION IF EXISTS public.divise_solo_super_advisor();
DROP FUNCTION IF EXISTS public.divise_sconti_persona_imposta(uuid, numeric, numeric);
DROP FUNCTION IF EXISTS public.divise_capo_annulla(uuid, text);
DROP FUNCTION IF EXISTS public.divise_capo_correggi_prezzo(uuid, numeric);
DROP FUNCTION IF EXISTS public.divise_capi_segna(uuid[], text, boolean);
DROP FUNCTION IF EXISTS public.divise_gestione_controlla();
DROP FUNCTION IF EXISTS public.divise_non_proprio(uuid);
DROP FUNCTION IF EXISTS public.divise_registra(uuid, text, text, integer, jsonb, uuid);
DROP FUNCTION IF EXISTS public.divise_timbratrice_apri(uuid, text);
DROP FUNCTION IF EXISTS public.divise_attive();
DROP FUNCTION IF EXISTS public.divise_chi_e(uuid, text);
DROP FUNCTION IF EXISTS public.divise_scrivi_registro(uuid, uuid, uuid, text, jsonb);
DROP TRIGGER IF EXISTS trg_divise_registro_fermo ON public.divise_registro;
DROP TABLE IF EXISTS public.divise_registro;
DROP TABLE IF EXISTS public.divise_richieste;
DROP TABLE IF EXISTS public.employee_capi;
DROP TABLE IF EXISTS public.employee_divise;
DROP TABLE IF EXISTS public.employee_divise_sconti;
DROP TABLE IF EXISTS public.divise_gestori;
DROP TABLE IF EXISTS public.divise_impostazioni;
DROP FUNCTION IF EXISTS public.divise_posso_gestire();
DROP FUNCTION IF EXISTS public.divise_registro_fermo();
COMMIT;
