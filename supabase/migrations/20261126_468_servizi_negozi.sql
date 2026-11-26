-- 468 · Servizi del negozio: scarico merce e pulizie prima dell'apertura (Patrizio, 26/11/2026)
--
-- Valmontone riceve la merce il martedì: se la consegna cade all'apertura servono due persone
-- dall'apertura. Il giorno e l'ora possono cambiare nel periodo, quindi oltre alla consegna
-- abituale serve un calendario con data e ora. Il lunedì e il venerdì il negozio apre alle 9 per
-- le pulizie (lavoro vero, non vendita). Ogni negozio può avere giorni e ore diversi.
--
--   outlet_servizi   regole ricorrenti per negozio: tipo ('scarico' | 'pulizie'), giorno della
--                    settimana, fascia oraria, persone. Una riga per tipo e giorno.
--   outlet_consegne  calendario delle consegne: una riga per negozio e data, vale al posto della
--                    consegna abituale di quel giorno (spostata, ora cambiata, annullata).
--
-- Chi scrive: chi gestisce l'organico (organico_puo_scrivere) dalla pagina Turni, riquadro
-- «Servizi negozi»; la responsabile del negozio (Patrizio, 26/11/2026: «anche la responsabile
-- del negozio») solo il calendario delle consegne dei suoi negozi, dalla sua pagina, con le
-- funzioni responsabile_servizi / responsabile_consegna_salva / responsabile_consegna_togli che
-- controllano i negozi come responsabile_negozi() (attendance_confermatori).
--
-- NO DATA LOSS: solo CREATE TABLE e CREATE FUNCTION. Rollback in _ROLLBACK.
-- Parità tenant: NZ e Zago (Made fuori dal 03/11/2026; il frontend senza tabelle torna a prima).

BEGIN;

CREATE TABLE IF NOT EXISTS public.outlet_servizi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  outlet_id   uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('scarico', 'pulizie')),
  giorno      smallint NOT NULL CHECK (giorno BETWEEN 1 AND 7),
  dalle       time NOT NULL,
  alle        time NOT NULL,
  persone     smallint NOT NULL DEFAULT 2 CHECK (persone BETWEEN 1 AND 10),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid DEFAULT auth.uid(),
  CONSTRAINT outlet_servizi_fascia CHECK (alle > dalle),
  CONSTRAINT outlet_servizi_unico UNIQUE (outlet_id, tipo, giorno)
);
COMMENT ON TABLE public.outlet_servizi IS
  'Servizi ricorrenti del negozio (migration 468, Patrizio 26/11/2026): scarico merce (in quelle ore servono almeno «persone», di norma 2) e pulizie prima dell''apertura (ore di lavoro, non vendita).';

CREATE TABLE IF NOT EXISTS public.outlet_consegne (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  outlet_id    uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  data         date NOT NULL,
  dalle        time,
  alle         time,
  persone      smallint CHECK (persone IS NULL OR persone BETWEEN 1 AND 10),
  annullata    boolean NOT NULL DEFAULT false,
  nota         text CHECK (nota IS NULL OR length(nota) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid DEFAULT auth.uid(),
  CONSTRAINT outlet_consegne_fascia CHECK (dalle IS NULL OR alle IS NULL OR alle > dalle),
  CONSTRAINT outlet_consegne_unica UNIQUE (outlet_id, data)
);
COMMENT ON TABLE public.outlet_consegne IS
  'Calendario delle consegne (migration 468): la riga di una data vale al posto della consegna abituale di quel giorno. annullata = nessuno scarico che chieda personale (anche quando chi consegna ha le chiavi).';
CREATE INDEX IF NOT EXISTS outlet_consegne_negozio_data ON public.outlet_consegne (outlet_id, data);

-- ── RLS: come le altre tabelle dell'organico (outlet_special_days) ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outlet_servizi', 'outlet_consegne'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()))', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere())) WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))', t || '_write', t);
    EXECUTE format('DROP POLICY IF EXISTS cash_operator_block ON public.%I', t);
    EXECUTE format('CREATE POLICY cash_operator_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (COALESCE((SELECT public.get_my_role())::text, '''') <> ''operatore_cassa'') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '''') <> ''operatore_cassa'')', t);
    EXECUTE format('DROP POLICY IF EXISTS dipendente_block ON public.%I', t);
    EXECUTE format('CREATE POLICY dipendente_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (COALESCE((SELECT public.get_my_role())::text, '''') <> ''dipendente'') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '''') <> ''dipendente'')', t);
    -- la responsabile passa solo dalle funzioni qui sotto, che controllano i suoi negozi
    EXECUTE format('DROP POLICY IF EXISTS responsabile_block ON public.%I', t);
    EXECUTE format('CREATE POLICY responsabile_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (COALESCE((SELECT public.get_my_role())::text, '''') <> ''responsabile'') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '''') <> ''responsabile'')', t);
    EXECUTE format('DROP POLICY IF EXISTS solo_con_profilo ON public.%I', t);
    EXECUTE format('CREATE POLICY solo_con_profilo ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.get_my_role()) IS NOT NULL) WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
    -- i permessi di default del progetto danno qualcosa anche ad anon: si toglie (come la 464b)
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- ── La responsabile del negozio: il calendario delle consegne dei suoi negozi ──

-- I negozi della responsabile, come responsabile_negozi(): quelli in cui conferma le presenze.
CREATE OR REPLACE FUNCTION public.responsabile_mio_negozio(p_outlet_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT public.get_my_role())::text, '') = 'responsabile'
     AND EXISTS (SELECT 1 FROM public.attendance_confermatori c
                  WHERE c.user_id = auth.uid() AND c.outlet_id = p_outlet_id
                    AND c.company_id = public.get_my_company_id());
$$;

-- Consegna abituale e calendario dei negozi della responsabile fra due date (al massimo 120 giorni).
CREATE OR REPLACE FUNCTION public.responsabile_servizi(p_dal date, p_al date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile' THEN
    RAISE EXCEPTION 'Solo la responsabile del negozio usa questa funzione' USING ERRCODE = '42501';
  END IF;
  IF p_dal IS NULL OR p_al IS NULL OR p_al < p_dal OR p_al - p_dal > 120 THEN
    RAISE EXCEPTION 'Periodo non valido (al massimo 120 giorni)' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'outlet_id', o.id, 'nome', o.name,
      'ricorrenti', COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', s.tipo, 'giorno', s.giorno, 'dalle', to_char(s.dalle, 'HH24:MI'), 'alle', to_char(s.alle, 'HH24:MI'), 'persone', s.persone) ORDER BY s.tipo, s.giorno)
                              FROM public.outlet_servizi s WHERE s.outlet_id = o.id), '[]'::jsonb),
      'consegne', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'data', k.data, 'dalle', to_char(k.dalle, 'HH24:MI'), 'alle', to_char(k.alle, 'HH24:MI'), 'persone', k.persone, 'annullata', k.annullata, 'nota', k.nota) ORDER BY k.data)
                              FROM public.outlet_consegne k WHERE k.outlet_id = o.id AND k.data BETWEEN p_dal AND p_al), '[]'::jsonb)
    ) ORDER BY o.name)
      FROM public.attendance_confermatori c JOIN public.outlets o ON o.id = c.outlet_id
     WHERE c.user_id = auth.uid() AND c.company_id = public.get_my_company_id()
  ), '[]'::jsonb);
END $$;

-- Aggiunge o cambia la consegna di una data in un negozio della responsabile.
CREATE OR REPLACE FUNCTION public.responsabile_consegna_salva(
  p_outlet_id uuid, p_data date, p_dalle time, p_alle time, p_persone int, p_annullata boolean, p_nota text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_company uuid;
BEGIN
  IF NOT public.responsabile_mio_negozio(p_outlet_id) THEN
    RAISE EXCEPTION 'Non è un tuo negozio' USING ERRCODE = '42501';
  END IF;
  IF p_data IS NULL OR p_data < (now() AT TIME ZONE 'Europe/Rome')::date - 7
     OR p_data > (now() AT TIME ZONE 'Europe/Rome')::date + 365 THEN
    RAISE EXCEPTION 'Data non valida: le consegne passate non si cambiano, e non oltre un anno' USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(p_annullata, false) AND (p_dalle IS NULL OR p_alle IS NULL OR p_alle <= p_dalle) THEN
    RAISE EXCEPTION 'Scrivi l''ora di arrivo e quella di fine scarico' USING ERRCODE = '22023';
  END IF;
  IF p_persone IS NOT NULL AND (p_persone < 1 OR p_persone > 10) THEN
    RAISE EXCEPTION 'Persone fra 1 e 10' USING ERRCODE = '22023';
  END IF;
  SELECT company_id INTO v_company FROM public.outlets WHERE id = p_outlet_id;
  INSERT INTO public.outlet_consegne (company_id, outlet_id, data, dalle, alle, persone, annullata, nota, updated_by)
  VALUES (v_company, p_outlet_id, p_data,
          CASE WHEN COALESCE(p_annullata, false) THEN NULL ELSE p_dalle END,
          CASE WHEN COALESCE(p_annullata, false) THEN NULL ELSE p_alle END,
          CASE WHEN COALESCE(p_annullata, false) THEN NULL ELSE p_persone END,
          COALESCE(p_annullata, false), NULLIF(left(btrim(COALESCE(p_nota, '')), 200), ''), auth.uid())
  ON CONFLICT (outlet_id, data) DO UPDATE SET
    dalle = EXCLUDED.dalle, alle = EXCLUDED.alle, persone = EXCLUDED.persone, annullata = EXCLUDED.annullata,
    nota = EXCLUDED.nota, updated_at = now(), updated_by = auth.uid();
END $$;

-- Toglie la riga del calendario di una data: torna a valere la consegna abituale.
CREATE OR REPLACE FUNCTION public.responsabile_consegna_togli(p_outlet_id uuid, p_data date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.responsabile_mio_negozio(p_outlet_id) THEN
    RAISE EXCEPTION 'Non è un tuo negozio' USING ERRCODE = '42501';
  END IF;
  IF p_data IS NULL OR p_data < (now() AT TIME ZONE 'Europe/Rome')::date - 7
     OR p_data > (now() AT TIME ZONE 'Europe/Rome')::date + 365 THEN
    RAISE EXCEPTION 'Data non valida: le consegne passate non si cambiano, e non oltre un anno' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.outlet_consegne WHERE outlet_id = p_outlet_id AND data = p_data;
END $$;

REVOKE ALL ON FUNCTION public.responsabile_mio_negozio(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.responsabile_servizi(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.responsabile_consegna_salva(uuid, date, time, time, int, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.responsabile_consegna_togli(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responsabile_mio_negozio(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.responsabile_servizi(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.responsabile_consegna_salva(uuid, date, time, time, int, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.responsabile_consegna_togli(uuid, date) TO authenticated, service_role;

COMMIT;

-- VERIFICA:
--   SELECT has_table_privilege('authenticated','public.outlet_servizi','select'),
--          has_table_privilege('service_role','public.outlet_consegne','insert');   -- true, true
--   SELECT tablename, count(*) FROM pg_policies WHERE tablename IN ('outlet_servizi','outlet_consegne') GROUP BY 1;  -- 6 e 6
