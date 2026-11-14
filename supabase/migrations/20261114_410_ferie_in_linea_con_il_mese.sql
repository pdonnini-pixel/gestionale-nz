-- 410: ferie e permessi «in linea con il mese» nel piano del mese (Patrizio, 14/11/2026).
--
-- «la regola e' far stare ferie e permessi in linea con il mese, cioe' se devo consumare ferie e
--  permessi li consumo che tanto ogni mese vado a riaccumularli, ma quando arrivo li' poi posso
--  approvarli o cancellarli o spostarli e lui ricalcola tutto, sia i residui che le ore.»
--
-- Quando l'HR crea il piano del mese il sistema propone, persona per persona, ferie e permessi pari
-- a quello che matura nel mese (rateo annuo del tabulato delle paghe diviso dodici, meno quello che
-- e' gia' chiesto o approvato, dall'app o dal gestionale). Le proposte restano PROPOSTE:
--   * sono richieste in bozza (stato 'bozza'), quindi non scalano il saldo (v_leave_disponibilita
--     le conta a parte in ore_in_bozza) e il dipendente non le vede nell'app (app_dipendente_ferie
--     esclude le bozze): verificato sulle funzioni vive di NZ e Zago il 14/11/2026;
--   * portano origine 'piano_mese' e il piano che le ha generate (plan_id), cosi' si distinguono
--     dalle bozze scritte da una persona e si tolgono insieme al piano;
--   * diventano vere solo con ferie_proposta_approva(), che le invia e le fa decidere a
--     leave_decidi: valgono quindi la scala di chi decide e tutti i controlli della 407.
--
-- Cosa cambia nello schema (solo aggiunte, nessuna riga toccata):
--   1. leave_requests.origine ammette anche 'piano_mese';
--   2. leave_requests.plan_id (NULL per tutte le richieste di oggi);
--   3. funzione ferie_proposta_approva(uuid, uuid[]).
-- Si applica a NZ e Zago. Dove manca (Made) il frontend non propone niente e resta com'era.
-- Rollback: 20261114_410_ferie_in_linea_con_il_mese_ROLLBACK.sql

BEGIN;

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_origine_check;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_origine_check
  CHECK (origine IN ('gestionale', 'modulo_cartaceo', 'mail', 'piano_mese'));

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.shift_plans(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.leave_requests.plan_id IS
  'Il piano del mese che ha proposto questa richiesta (origine = piano_mese). NULL per le richieste chieste da una persona. Se il piano si toglie resta NULL: la richiesta, se e'' gia'' stata approvata, non cambia.';
CREATE INDEX IF NOT EXISTS leave_requests_plan_idx ON public.leave_requests (plan_id) WHERE plan_id IS NOT NULL;

-- Approvare una proposta del piano: la bozza diventa inviata e la decide leave_decidi, che applica
-- chi puo' decidere (posso_decidere_ferie o la responsabile nei suoi negozi), la scala (407:
-- nessuno la propria, la responsabile dall'HR, l'HR dal Super Advisor) e la regola del lunedi'.
-- Se leave_decidi rifiuta, l'eccezione annulla tutto e la proposta resta in bozza.
CREATE OR REPLACE FUNCTION public.ferie_proposta_approva(p_request_id uuid, p_giorni uuid[] DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r        public.leave_requests%ROWTYPE;
  v_giorni uuid[];
BEGIN
  SELECT * INTO r FROM public.leave_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.company_id IS DISTINCT FROM (SELECT public.get_my_company_id()) THEN
    RAISE EXCEPTION 'Proposta non trovata.' USING ERRCODE = 'P0002';
  END IF;
  IF r.origine <> 'piano_mese' OR r.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Questa non è una proposta del piano ancora da decidere.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(d.id) INTO v_giorni
    FROM public.leave_request_days d
   WHERE d.request_id = p_request_id AND (p_giorni IS NULL OR d.id = ANY (p_giorni));
  IF v_giorni IS NULL THEN
    RAISE EXCEPTION 'La proposta non ha giorni da approvare.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.leave_requests SET stato = 'inviata', inviata_il = now() WHERE id = p_request_id;
  RETURN public.leave_decidi(p_request_id, v_giorni, 'Proposta del piano del mese, approvata');
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_proposta_approva(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferie_proposta_approva(uuid, uuid[]) TO authenticated, service_role;

COMMIT;

-- VERIFICA (su NZ e su Zago, dopo l'applicazione):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'leave_requests_origine_check';  -- con 'piano_mese'
-- SELECT count(*) FILTER (WHERE plan_id IS NOT NULL) AS con_piano, count(*) AS tutte FROM public.leave_requests;  -- 0 e il totale di prima
-- SELECT has_function_privilege('authenticated', 'public.ferie_proposta_approva(uuid,uuid[])', 'execute') AS auth,
--        has_function_privilege('anon', 'public.ferie_proposta_approva(uuid,uuid[])', 'execute') AS anon;  -- true, false
