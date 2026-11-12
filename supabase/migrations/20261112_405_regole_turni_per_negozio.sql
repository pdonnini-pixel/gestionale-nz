-- =====================================================================
-- Migrazione 405 — Turni: le regole del 12/11/2026 come scelte del negozio
--                  (giorni caldi sulle fasce, riposi, straordinari pari,
--                  apertura e chiusura fra responsabile e vice) e i periodi
--                  speciali con regole proprie
-- =====================================================================
-- PERCHE': decisioni di Patrizio del 12/11/2026 (ORGANICO_TURNI_NOTES.md, sezione
-- «Regole per negozio, giorni caldi sulle fasce, riposi, periodi speciali»).
-- Sostituiscono, per i giorni caldi, lo schema fisso dell'11/11 («una persona la
-- prima mezz'ora, tutte fino a un'ora dalla chiusura»): ora le persone le
-- decidono le fasce del sabato e della domenica, con MODA sopra.
--
-- COSA:
--   1. outlet_shift_rules, sette scelte nuove. NULL = come prima: nessun negozio
--      cambia finche' qualcuno non le scrive.
--        riposi_min_settimana     riposi a testa nella settimana, se possibile
--                                 (per legge mai meno di 1: vincolo 1..6)
--        straordinari_pari        straordinari il piu' possibile pari fra tutte
--        caldi_tutti_al_lavoro    nei giorni caldi lavorano tutte (NULL = si'
--                                 dove giorni_pieni e' acceso)
--        caldi_straordinari       nei giorni caldi straordinari ammessi (idem)
--        caldi_fasce_festivi      'sabato' | 'domenica': le fasce che usano
--                                 festivi e giorni speciali nei feriali (NULL = sabato)
--        caldi_guida_apre_chiude  nei giorni caldi una fra responsabile e vice
--                                 apre, l'altra chiude, a turno (NULL = apre
--                                 sempre la responsabile, come l'11/11)
--        caldi_ore_apertura       ore di chi fa l'apertura (NULL = 9)
--   2. employee_riposi: per ogni persona i giorni in cui riposa di preferenza e
--      quelli in cui non riposa mai, anche piu' di uno (1 = lunedi' ... 5 =
--      venerdi': sabato, domenica ed eventi non si scelgono, li' si lavora).
--      RLS e recinti come employee_giorno_libero (395). I giorni liberi decisi A
--      MANO della 395 si copiano qui come preferiti; quelli scelti dal sistema no
--      (senza una scelta il riposo lo decide la turnazione).
--   3. outlet_events, quattro colonne per giorni speciali e periodi speciali:
--        tipo             'giorno' (vale come un sabato) | 'periodo' (regole
--                         proprie); NULL = evento di prima, nessun cambio
--        regole           jsonb, solo per i periodi. Forma:
--                         { "apre": "10:00", "chiude": "21:00",
--                           "fasce": [ { "dalle": "10:00", "alle": "11:00", "persone": 2 } ],
--                           "moda": true, "tutti": true, "straordinari": true,
--                           "guida": true, "ferie": false, "permessi": false,
--                           "riposi_min": 1 }
--                         Ogni campo e' facoltativo: assente = regola del negozio
--                         nei giorni caldi. "riposi_min" mai sotto 1 (lo impone
--                         anche il frontend: src/lib/eventiTurni.ts).
--        regole_origine   'sabato' | 'domenica' | 'evento' | 'manuale'
--        controllo_moda   jsonb: l'esito del confronto con gli ingressi dello
--                         stesso periodo dell'anno prima, come l'ha visto chi ha
--                         confermato il periodo
--
-- NO DATA LOSS: ADD COLUMN senza default, CREATE TABLE, un INSERT in una tabella
-- nuova. Nessuna riga esistente cambiata o cancellata.
-- Tenant: NZ e Zago (Made non riceve piu' migration dal 03/11/2026).
-- Roma Soratte accende le scelte con la NZ_ONLY 406.
-- =====================================================================

BEGIN;

-- 1. Le scelte del negozio
ALTER TABLE public.outlet_shift_rules
  ADD COLUMN IF NOT EXISTS riposi_min_settimana smallint,
  ADD COLUMN IF NOT EXISTS straordinari_pari boolean,
  ADD COLUMN IF NOT EXISTS caldi_tutti_al_lavoro boolean,
  ADD COLUMN IF NOT EXISTS caldi_straordinari boolean,
  ADD COLUMN IF NOT EXISTS caldi_fasce_festivi text,
  ADD COLUMN IF NOT EXISTS caldi_guida_apre_chiude boolean,
  ADD COLUMN IF NOT EXISTS caldi_ore_apertura numeric;

ALTER TABLE public.outlet_shift_rules DROP CONSTRAINT IF EXISTS outlet_shift_rules_riposi_min_settimana_check;
ALTER TABLE public.outlet_shift_rules ADD CONSTRAINT outlet_shift_rules_riposi_min_settimana_check
  CHECK (riposi_min_settimana IS NULL OR riposi_min_settimana BETWEEN 1 AND 6);
ALTER TABLE public.outlet_shift_rules DROP CONSTRAINT IF EXISTS outlet_shift_rules_caldi_fasce_festivi_check;
ALTER TABLE public.outlet_shift_rules ADD CONSTRAINT outlet_shift_rules_caldi_fasce_festivi_check
  CHECK (caldi_fasce_festivi IS NULL OR caldi_fasce_festivi IN ('sabato', 'domenica'));
ALTER TABLE public.outlet_shift_rules DROP CONSTRAINT IF EXISTS outlet_shift_rules_caldi_ore_apertura_check;
ALTER TABLE public.outlet_shift_rules ADD CONSTRAINT outlet_shift_rules_caldi_ore_apertura_check
  CHECK (caldi_ore_apertura IS NULL OR caldi_ore_apertura BETWEEN 4 AND 12);

COMMENT ON COLUMN public.outlet_shift_rules.riposi_min_settimana IS
  'Riposi a testa nella settimana, se possibile (Patrizio, 12/11/2026). Per legge mai meno di 1. NULL = regola spenta: resta il massimo dei giorni di lavoro, e il sistema continua a scegliere un giorno libero fisso.';
COMMENT ON COLUMN public.outlet_shift_rules.straordinari_pari IS
  'Straordinari il piu'' possibile pari fra tutte (Patrizio, 12/11/2026). NULL o false = come prima.';
COMMENT ON COLUMN public.outlet_shift_rules.caldi_tutti_al_lavoro IS
  'Giorni caldi: lavorano tutte, con orari che seguono fasce e MODA. NULL = si'' dove giorni_pieni e'' acceso.';
COMMENT ON COLUMN public.outlet_shift_rules.caldi_straordinari IS
  'Giorni caldi: straordinari ammessi. NULL = si'' dove giorni_pieni e'' acceso.';
COMMENT ON COLUMN public.outlet_shift_rules.caldi_fasce_festivi IS
  'Giorni caldi: festivi e giorni speciali che cadono in un feriale usano le fasce del sabato o della domenica. NULL = sabato.';
COMMENT ON COLUMN public.outlet_shift_rules.caldi_guida_apre_chiude IS
  'Giorni caldi: una fra responsabile e vice fa l''apertura, l''altra la chiusura, a turno (Patrizio, 12/11/2026). NULL o false = apre sempre la responsabile.';
COMMENT ON COLUMN public.outlet_shift_rules.caldi_ore_apertura IS
  'Giorni caldi: ore di chi fa l''apertura (9 = 10-19 in un negozio che apre alle 10). NULL = 9.';

-- 2. Riposi di ognuno
CREATE TABLE IF NOT EXISTS public.employee_riposi (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  preferiti   smallint[] NOT NULL DEFAULT '{}',
  mai         smallint[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid DEFAULT auth.uid(),
  CONSTRAINT employee_riposi_preferiti_feriali CHECK (preferiti <@ ARRAY[1, 2, 3, 4, 5]::smallint[]),
  CONSTRAINT employee_riposi_mai_feriali CHECK (mai <@ ARRAY[1, 2, 3, 4, 5]::smallint[]),
  CONSTRAINT employee_riposi_non_tutti_e_due CHECK (NOT (preferiti && mai))
);
COMMENT ON TABLE public.employee_riposi IS
  'Riposi di ogni persona (Patrizio, 12/11/2026): preferiti = giorni in cui riposa di preferenza, mai = giorni in cui non riposa mai (1 = lunedi'' ... 5 = venerdi''), anche piu'' di uno. Il sistema li rispetta il piu'' possibile senza rompere le regole principali; senza preferiti il riposo lo decide la turnazione.';
CREATE INDEX IF NOT EXISTS employee_riposi_company_idx ON public.employee_riposi (company_id);

ALTER TABLE public.employee_riposi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_riposi_select ON public.employee_riposi;
CREATE POLICY employee_riposi_select ON public.employee_riposi FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS employee_riposi_write ON public.employee_riposi;
CREATE POLICY employee_riposi_write ON public.employee_riposi FOR ALL TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()));
DROP POLICY IF EXISTS cash_operator_block ON public.employee_riposi;
CREATE POLICY cash_operator_block ON public.employee_riposi AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
DROP POLICY IF EXISTS dipendente_block ON public.employee_riposi;
CREATE POLICY dipendente_block ON public.employee_riposi AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
DROP POLICY IF EXISTS responsabile_block ON public.employee_riposi;
CREATE POLICY responsabile_block ON public.employee_riposi AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile');
DROP POLICY IF EXISTS solo_con_profilo ON public.employee_riposi;
CREATE POLICY solo_con_profilo ON public.employee_riposi AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.get_my_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);
DROP POLICY IF EXISTS demo_nascosto ON public.employee_riposi;
CREATE POLICY demo_nascosto ON public.employee_riposi AS RESTRICTIVE FOR ALL TO authenticated
  USING (employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]))
  WITH CHECK (employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]));

REVOKE ALL ON public.employee_riposi FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_riposi TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_riposi TO service_role;

-- I giorni liberi decisi a mano (395) diventano il giorno preferito. Solo feriali;
-- quelli scelti dal sistema non si copiano. La tabella della 395 resta com'e'.
INSERT INTO public.employee_riposi (employee_id, company_id, preferiti)
SELECT g.employee_id, g.company_id, ARRAY[g.giorno]::smallint[]
  FROM public.employee_giorno_libero g
 WHERE g.origine = 'manuale' AND g.giorno BETWEEN 1 AND 5
ON CONFLICT (employee_id) DO NOTHING;

-- 3. Giorni speciali e periodi speciali
ALTER TABLE public.outlet_events
  ADD COLUMN IF NOT EXISTS tipo text,
  ADD COLUMN IF NOT EXISTS regole jsonb,
  ADD COLUMN IF NOT EXISTS regole_origine text,
  ADD COLUMN IF NOT EXISTS controllo_moda jsonb;

ALTER TABLE public.outlet_events DROP CONSTRAINT IF EXISTS outlet_events_tipo_check;
ALTER TABLE public.outlet_events ADD CONSTRAINT outlet_events_tipo_check
  CHECK (tipo IS NULL OR tipo IN ('giorno', 'periodo'));
ALTER TABLE public.outlet_events DROP CONSTRAINT IF EXISTS outlet_events_regole_origine_check;
ALTER TABLE public.outlet_events ADD CONSTRAINT outlet_events_regole_origine_check
  CHECK (regole_origine IS NULL OR regole_origine IN ('sabato', 'domenica', 'evento', 'manuale'));
ALTER TABLE public.outlet_events DROP CONSTRAINT IF EXISTS outlet_events_regole_forma_check;
ALTER TABLE public.outlet_events ADD CONSTRAINT outlet_events_regole_forma_check
  CHECK (regole IS NULL OR (jsonb_typeof(regole) = 'object'
         -- per legge almeno un giorno di riposo a settimana
         AND (NOT (regole ? 'riposi_min')
              OR CASE WHEN jsonb_typeof(regole -> 'riposi_min') = 'number' THEN (regole ->> 'riposi_min')::numeric >= 1 ELSE false END)));
ALTER TABLE public.outlet_events DROP CONSTRAINT IF EXISTS outlet_events_giorno_singolo_check;
ALTER TABLE public.outlet_events ADD CONSTRAINT outlet_events_giorno_singolo_check
  CHECK (tipo IS DISTINCT FROM 'giorno' OR data_dal = data_al);

COMMENT ON COLUMN public.outlet_events.tipo IS
  'giorno = giorno speciale singolo, vale come un sabato; periodo = dal giorno X al giorno Y con regole proprie (colonna regole). NULL = evento di prima del 12/11/2026.';
COMMENT ON COLUMN public.outlet_events.regole IS
  'Regole del periodo speciale: { apre, chiude, fasce: [{dalle, alle, persone}], moda, tutti, straordinari, guida, ferie, permessi, riposi_min }. Campi facoltativi: assente = regola del negozio nei giorni caldi. riposi_min mai sotto 1.';
COMMENT ON COLUMN public.outlet_events.regole_origine IS
  'Da dove sono partite le regole del periodo: sabato, domenica, evento (copiate da un altro evento), manuale.';
COMMENT ON COLUMN public.outlet_events.controllo_moda IS
  'Esito del controllo sugli ingressi MODA dello stesso periodo dell''anno prima (3 giorni di margine, confronto con le settimane vicine), come visto alla conferma.';

-- Le fasce scritte dentro le regole di un periodo sono fabbisogno come le «persone in piu'»:
-- le decide solo la direzione. Stessa funzione della 319, con un controllo in piu'.
CREATE OR REPLACE FUNCTION public.outlet_events_fabbisogno()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.persone_extra, 0) <> COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.persone_extra END, 0)
     AND NOT public.organico_puo_decidere_fabbisogno() THEN
    RAISE EXCEPTION 'Le persone in piu'' di un evento sono fabbisogno: le decide solo la direzione (profilo Super Advisor).';
  END IF;
  IF (NEW.regole -> 'fasce') IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.regole -> 'fasce' END)
     AND NOT public.organico_puo_decidere_fabbisogno() THEN
    RAISE EXCEPTION 'Le persone per fascia di un periodo sono fabbisogno: le decide solo la direzione (profilo Super Advisor).';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMIT;

-- VERIFICA (su ogni tenant):
-- SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='outlet_shift_rules'
--           AND column_name IN ('riposi_min_settimana','straordinari_pari','caldi_tutti_al_lavoro','caldi_straordinari','caldi_fasce_festivi','caldi_guida_apre_chiude','caldi_ore_apertura')) AS regole,  -- 7
--        (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='outlet_events'
--           AND column_name IN ('tipo','regole','regole_origine','controllo_moda')) AS eventi,                                                                                                           -- 4
--        has_table_privilege('authenticated','public.employee_riposi','select') AS auth,                                                                                                              -- true
--        has_table_privilege('service_role','public.employee_riposi','insert') AS srv,                                                                                                                -- true
--        has_table_privilege('anon','public.employee_riposi','select') AS anon,                                                                                                                       -- false
--        (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.employee_riposi'::regclass) AS policy,                                                                                              -- 7
--        (SELECT count(*) FROM public.outlet_shift_rules WHERE riposi_min_settimana IS NOT NULL OR straordinari_pari IS NOT NULL OR caldi_guida_apre_chiude IS NOT NULL) AS negozi_accesi;              -- 0 prima della 406
