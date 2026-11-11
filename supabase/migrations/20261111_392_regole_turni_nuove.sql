-- =====================================================================
-- Migrazione 392 — Turni: ore fino al contratto, giorno libero fisso,
--                  orario pubblicato settimana per settimana
-- =====================================================================
-- PERCHE': decisioni di Patrizio dell'11/11/2026, nate dal piano di Roma
-- Soratte (dettagli in ORGANICO_TURNI_NOTES.md, sezione dell'11/11/2026).
--
--   1. «Ore fino al contratto» e' una scelta del negozio: dove e' accesa le ore
--      di contratto che il traffico non chiede vanno comunque in turno, prima
--      venerdi', sabato e domenica. Spenta (default) resta la regola del
--      29/10/2026: le ore restano da assegnare.
--   2. Ogni persona ha, il piu' possibile, lo stesso giorno libero ogni
--      settimana. Lo sceglie il sistema quando fa il piano; poi si puo'
--      cambiare a mano. Serve un posto dove tenerlo, con la provenienza.
--   3. L'orario si prepara sul mese e si pubblica alle ragazze una settimana
--      alla volta. Finora i turni del piano scelto valevano tutti subito per
--      l'app, le timbrature e gli avvisi, anche in bozza: da qui valgono solo
--      quelli pubblicati. Senza piano scelto non cambia niente (pubblicati o
--      messi a mano).
--
-- COME:
--   1. outlet_shift_rules.riempi_contratto boolean (NULL = spenta).
--   2. Tabella employee_giorno_libero: una riga per persona, giorno 1-7,
--      origine 'sistema' | 'manuale'. RLS come employee_availability; scrive
--      chi tiene l'organico.
--   3. timbrature_turni_ufficiali: nel ramo «piano scelto» si aggiunge
--      s.stato = 'pubblicato'. Stessa firma, stesse altre righe.
--
-- NO DATA LOSS: ADD COLUMN senza default, CREATE TABLE, CREATE OR REPLACE di
-- una funzione di sola lettura. Nessuna riga cambiata o cancellata.
-- Tenant: NZ e Zago (Made non riceve piu' migration dal 03/11/2026).
-- =====================================================================

BEGIN;

-- 1. Ore fino al contratto, scelta del negozio
ALTER TABLE public.outlet_shift_rules ADD COLUMN IF NOT EXISTS riempi_contratto boolean;
COMMENT ON COLUMN public.outlet_shift_rules.riempi_contratto IS
  'Ore fino al contratto (Patrizio, 11/11/2026): true = le ore di contratto che il traffico non chiede vanno in turno, prima venerdi'', sabato e domenica. NULL o false = restano da assegnare.';

-- 2. Giorno libero fisso
CREATE TABLE IF NOT EXISTS public.employee_giorno_libero (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  giorno      smallint NOT NULL CHECK (giorno BETWEEN 1 AND 7),
  origine     text NOT NULL DEFAULT 'sistema' CHECK (origine IN ('sistema', 'manuale')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid DEFAULT auth.uid()
);
COMMENT ON TABLE public.employee_giorno_libero IS
  'Giorno libero fisso di ogni persona (1 = lunedi'' ... 7 = domenica). Lo sceglie il sistema quando fa il piano dei turni (origine sistema); chi lo cambia a mano lascia origine manuale, e il sistema non lo tocca piu''.';
CREATE INDEX IF NOT EXISTS employee_giorno_libero_company_idx ON public.employee_giorno_libero (company_id);

ALTER TABLE public.employee_giorno_libero ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_giorno_libero_select ON public.employee_giorno_libero;
CREATE POLICY employee_giorno_libero_select ON public.employee_giorno_libero FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));

DROP POLICY IF EXISTS employee_giorno_libero_write ON public.employee_giorno_libero;
CREATE POLICY employee_giorno_libero_write ON public.employee_giorno_libero FOR ALL TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()));

-- Recinti come sulle altre tabelle dell'organico: niente cassa, niente
-- dipendente, niente profilo mancante, niente dipendente di prova.
DROP POLICY IF EXISTS cash_operator_block ON public.employee_giorno_libero;
CREATE POLICY cash_operator_block ON public.employee_giorno_libero AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');

DROP POLICY IF EXISTS dipendente_block ON public.employee_giorno_libero;
CREATE POLICY dipendente_block ON public.employee_giorno_libero AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');

DROP POLICY IF EXISTS responsabile_block ON public.employee_giorno_libero;
CREATE POLICY responsabile_block ON public.employee_giorno_libero AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile');

DROP POLICY IF EXISTS solo_con_profilo ON public.employee_giorno_libero;
CREATE POLICY solo_con_profilo ON public.employee_giorno_libero AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.get_my_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);

DROP POLICY IF EXISTS demo_nascosto ON public.employee_giorno_libero;
CREATE POLICY demo_nascosto ON public.employee_giorno_libero AS RESTRICTIVE FOR ALL TO authenticated
  USING (employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]))
  WITH CHECK (employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_giorno_libero TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_giorno_libero TO service_role;

-- 3. Turni ufficiali: del piano scelto valgono solo quelli pubblicati
CREATE OR REPLACE FUNCTION public.timbrature_turni_ufficiali(p_company_id uuid, p_dal date, p_al date)
 RETURNS TABLE(shift_id uuid, outlet_id uuid, employee_id uuid, data date, inizio time without time zone, fine time without time zone, pausa_minuti smallint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id, s.outlet_id, s.employee_id, s.data, s.inizio, s.fine, s.pausa_minuti
    FROM public.shifts s
    LEFT JOIN public.shift_plans p
      ON p.outlet_id = s.outlet_id AND p.mese = date_trunc('month', s.data)::date AND p.stato = 'scelto'
   WHERE s.company_id = p_company_id
     AND s.data BETWEEN p_dal AND p_al
     AND s.stato <> 'annullato'
     -- piano scelto: l'orario si pubblica settimana per settimana (392), vale solo il pubblicato
     AND ((p.id IS NOT NULL AND s.plan_id = p.id AND s.stato = 'pubblicato')
          OR (p.id IS NULL AND s.plan_id IS NULL AND (s.stato = 'pubblicato' OR s.origine = 'manuale'))
          OR (s.plan_id IS NULL AND s.employee_id = ANY ((SELECT public.dipendenti_demo_ids())::uuid[])));
$function$;

COMMIT;

-- VERIFICA (su ogni tenant):
-- SELECT has_table_privilege('authenticated','public.employee_giorno_libero','select') AS auth,
--        has_table_privilege('service_role','public.employee_giorno_libero','insert') AS srv,
--        (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.employee_giorno_libero'::regclass) AS policy,  -- 7
--        (SELECT count(*) FROM information_schema.columns WHERE table_name = 'outlet_shift_rules' AND column_name = 'riempi_contratto') AS col,  -- 1
--        pg_get_functiondef('public.timbrature_turni_ufficiali(uuid,date,date)'::regprocedure) ~ 's.plan_id = p.id AND s.stato = ''pubblicato''' AS ufficiali;  -- true
