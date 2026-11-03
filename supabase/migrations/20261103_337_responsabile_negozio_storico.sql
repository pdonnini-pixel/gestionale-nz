-- 337 — Responsabile del negozio con storico (Patrizio, 03/11/2026)
--
-- «Quando assumo una persona in Organico devo poterla mettere come
-- responsabile, e posso cambiare il responsabile di volta in volta: chi va
-- via, chi arriva, chi cambia fra i dipendenti in corso. E tutte le sezioni
-- collegate si devono aggiornare.»
--
-- Il responsabile di oggi resta in outlets.referente_employee_id (319): e'
-- l'unico punto che leggono Organico, Turni, Utenti e il modulo ferie, quindi
-- cambiandolo si aggiorna tutto insieme. Questa migration aggiunge:
--   1. outlet_referenti_storico: chi e' stato responsabile di quale negozio e
--      da quando. Si scrive solo dalle RPC; niente si cancella.
--   2. organico_imposta_referente_dal(negozio, persona, dal): cambia il
--      responsabile chiudendo il periodo precedente. Persona vuota = negozio
--      senza responsabile da quella data.
--   3. organico_imposta_referente(negozio, persona) (319) resta e passa dalla
--      nuova, con la data di oggi (ora di Roma).
--   4. Lo storico parte dai responsabili gia' segnati (dal 20/10/2026, giorno
--      in cui sono stati inseriti).
-- Solo aggiunte: nessuna riga esistente cambia.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outlet_referenti_storico (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  outlet_id       uuid NOT NULL REFERENCES public.outlets(id),
  employee_id     uuid REFERENCES public.employees(id),
  dal             date NOT NULL,
  al              date,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outlet_referenti_storico_periodo CHECK (al IS NULL OR al >= dal)
);

COMMENT ON TABLE public.outlet_referenti_storico IS
  'Storico dei responsabili di negozio (Patrizio, 03/11/2026). Il responsabile di oggi e'' outlets.referente_employee_id. Si scrive solo con organico_imposta_referente_dal.';

CREATE INDEX IF NOT EXISTS outlet_referenti_storico_outlet_idx
  ON public.outlet_referenti_storico (outlet_id, dal);
CREATE INDEX IF NOT EXISTS outlet_referenti_storico_company_idx
  ON public.outlet_referenti_storico (company_id);
-- Un solo periodo aperto per negozio.
CREATE UNIQUE INDEX IF NOT EXISTS outlet_referenti_storico_aperto_uq
  ON public.outlet_referenti_storico (outlet_id) WHERE al IS NULL;

ALTER TABLE public.outlet_referenti_storico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outlet_referenti_storico_select ON public.outlet_referenti_storico;
CREATE POLICY outlet_referenti_storico_select ON public.outlet_referenti_storico
  FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
-- Nessuna policy di scrittura: si scrive solo dalle RPC SECURITY DEFINER.
-- Stessi recinti delle altre tabelle dell'organico (315): l'account di cassa
-- e il dipendente non leggono lo storico.
DROP POLICY IF EXISTS cash_operator_block ON public.outlet_referenti_storico;
CREATE POLICY cash_operator_block ON public.outlet_referenti_storico AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
DROP POLICY IF EXISTS dipendente_block ON public.outlet_referenti_storico;
CREATE POLICY dipendente_block ON public.outlet_referenti_storico AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');

REVOKE ALL ON public.outlet_referenti_storico FROM anon;
GRANT SELECT ON public.outlet_referenti_storico TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_referenti_storico TO service_role;

-- Niente si cancella (come i cambiamenti dell'organico).
CREATE OR REPLACE FUNCTION public.outlet_referenti_storico_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Lo storico dei responsabili non si cancella: si cambia il responsabile.';
END;
$$;

DROP TRIGGER IF EXISTS trg_outlet_referenti_storico_no_delete ON public.outlet_referenti_storico;
CREATE TRIGGER trg_outlet_referenti_storico_no_delete
  BEFORE DELETE ON public.outlet_referenti_storico
  FOR EACH ROW EXECUTE FUNCTION public.outlet_referenti_storico_no_delete();

CREATE OR REPLACE FUNCTION public.organico_imposta_referente_dal(p_outlet_id uuid, p_employee_id uuid, p_dal date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := (SELECT public.get_my_company_id());
  v_oggi date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_dal date := COALESCE(p_dal, (now() AT TIME ZONE 'Europe/Rome')::date);
  v_aperto public.outlet_referenti_storico%ROWTYPE;
BEGIN
  IF NOT public.organico_puo_scrivere() THEN
    RAISE EXCEPTION 'Il responsabile lo imposta chi tiene l''organico.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM outlets WHERE id = p_outlet_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Negozio non trovato.';
  END IF;
  IF p_employee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Persona non trovata.';
  END IF;
  -- Il responsabile di oggi e' quello che leggono tutte le sezioni: un cambio
  -- in una data futura le metterebbe in disaccordo con lo storico.
  IF v_dal > v_oggi THEN
    RAISE EXCEPTION 'Il responsabile si cambia dal giorno in cui comincia, non prima.';
  END IF;

  SELECT * INTO v_aperto FROM outlet_referenti_storico
   WHERE outlet_id = p_outlet_id AND al IS NULL
   FOR UPDATE;

  IF FOUND AND v_aperto.employee_id IS NOT DISTINCT FROM p_employee_id THEN
    NULL; -- stesso responsabile: lo storico non cambia
  ELSIF FOUND AND v_dal < v_aperto.dal THEN
    -- Un cambio non puo' cominciare prima del responsabile di oggi: cancellerebbe
    -- il suo periodo dallo storico.
    RAISE EXCEPTION 'Il responsabile attuale lo è dal %: il nuovo può partire da quel giorno o dopo.', to_char(v_aperto.dal, 'DD/MM/YYYY');
  ELSIF FOUND AND v_dal = v_aperto.dal THEN
    -- Cambio nello stesso giorno dell'ultimo: era una correzione.
    UPDATE outlet_referenti_storico
       SET employee_id = p_employee_id
     WHERE id = v_aperto.id;
  ELSE
    IF FOUND THEN
      UPDATE outlet_referenti_storico SET al = v_dal - 1 WHERE id = v_aperto.id;
    END IF;
    INSERT INTO outlet_referenti_storico (company_id, outlet_id, employee_id, dal)
    VALUES (v_company, p_outlet_id, p_employee_id, v_dal);
  END IF;

  UPDATE outlets SET referente_employee_id = p_employee_id, updated_at = now()
   WHERE id = p_outlet_id AND company_id = v_company;
END;
$$;

REVOKE ALL ON FUNCTION public.organico_imposta_referente_dal(uuid, uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.organico_imposta_referente_dal(uuid, uuid, date) TO authenticated, service_role;

-- La funzione della 319 resta (la usa Turni) e passa dallo storico.
CREATE OR REPLACE FUNCTION public.organico_imposta_referente(p_outlet_id uuid, p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.organico_imposta_referente_dal(p_outlet_id, p_employee_id, (now() AT TIME ZONE 'Europe/Rome')::date);
END;
$$;

REVOKE ALL ON FUNCTION public.organico_imposta_referente(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.organico_imposta_referente(uuid, uuid) TO authenticated, service_role;

-- Punto di partenza: i responsabili gia' segnati (inseriti il 20/10/2026).
INSERT INTO public.outlet_referenti_storico (company_id, outlet_id, employee_id, dal, created_by)
SELECT o.company_id, o.id, o.referente_employee_id, DATE '2026-10-20', NULL
  FROM public.outlets o
 WHERE o.referente_employee_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.outlet_referenti_storico s WHERE s.outlet_id = o.id);

COMMIT;
