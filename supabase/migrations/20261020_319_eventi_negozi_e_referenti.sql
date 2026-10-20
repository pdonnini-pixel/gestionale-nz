-- 319 — Eventi dei negozi e referente di negozio (Patrizio, 20/10/2026)
--
-- 1. outlet_events: Black Friday, feste natalizie, saldi e simili. Un evento
--    dura uno o piu' giorni, vale per uno, alcuni o tutti i negozi
--    (outlet_ids NULL = tutti), e si puo' inserire in corso d'anno (lo fa
--    Veronica, profilo contabile). Nei suoi giorni:
--      - serve piu' personale: persone_extra si aggiunge al fabbisogno.
--        E' fabbisogno, quindi la cambia solo super_advisor (trigger);
--      - niente ferie ne' permessi (blocca_ferie);
--      - se mancano persone si chiedono straordinari (straordinari).
--    I giorni di chiusura e gli orari diversi restano per negozio in
--    outlet_special_days.
-- 2. outlets.referente_employee_id: la referente di ogni negozio. Si
--    imposta con organico_imposta_referente (chi tiene l'organico), perche'
--    la scheda del negozio la scrive solo la direzione.
--
-- Solo CREATE / ADD COLUMN. Policy come le altre tabelle dell'organico
-- (315): legge l'azienda, scrive chi tiene l'organico, mai cassa e dipendenti.
-- REGOLA #0: NZ + Made + Zago. Rollback: _ROLLBACK.sql a fianco.

CREATE TABLE IF NOT EXISTS public.outlet_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id),
  nome           text NOT NULL CHECK (length(trim(nome)) > 0),
  data_dal       date NOT NULL,
  data_al        date NOT NULL,
  -- NULL = tutti i negozi dell'azienda
  outlet_ids     uuid[],
  persone_extra  smallint NOT NULL DEFAULT 0 CHECK (persone_extra BETWEEN 0 AND 30),
  blocca_ferie   boolean NOT NULL DEFAULT true,
  straordinari   boolean NOT NULL DEFAULT true,
  nota           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid DEFAULT auth.uid(),
  CHECK (data_al >= data_dal)
);

CREATE INDEX IF NOT EXISTS outlet_events_company_date_idx ON public.outlet_events (company_id, data_dal, data_al);

COMMENT ON TABLE public.outlet_events IS
  'Eventi e periodi di punta (Black Friday, feste natalizie, saldi): uno o piu'' giorni, uno o piu'' negozi (outlet_ids NULL = tutti). Piu'' personale (persone_extra, solo super_advisor), niente ferie ne'' permessi (blocca_ferie), straordinari se mancano persone.';

CREATE OR REPLACE FUNCTION public.outlet_events_fabbisogno()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.persone_extra, 0) <> COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.persone_extra END, 0)
     AND NOT public.organico_puo_decidere_fabbisogno() THEN
    RAISE EXCEPTION 'Le persone in piu'' di un evento sono fabbisogno: le decide solo la direzione (profilo Super Advisor).';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_outlet_events_fabbisogno
  BEFORE INSERT OR UPDATE ON public.outlet_events
  FOR EACH ROW EXECUTE FUNCTION public.outlet_events_fabbisogno();

ALTER TABLE public.outlet_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY outlet_events_select ON public.outlet_events FOR SELECT
  USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY outlet_events_write ON public.outlet_events FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()));
CREATE POLICY cash_operator_block ON public.outlet_events AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.outlet_events AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');

-- ── Referente di negozio ─────────────────────────────────────────────
ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS referente_employee_id uuid REFERENCES public.employees(id);

COMMENT ON COLUMN public.outlets.referente_employee_id IS
  'La referente del negozio (Patrizio, 20/10/2026). Si imposta con organico_imposta_referente.';

CREATE OR REPLACE FUNCTION public.organico_imposta_referente(p_outlet_id uuid, p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := (SELECT public.get_my_company_id());
BEGIN
  IF NOT public.organico_puo_scrivere() THEN
    RAISE EXCEPTION 'La referente la imposta chi tiene l''organico.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM outlets WHERE id = p_outlet_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Negozio non trovato.';
  END IF;
  IF p_employee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Persona non trovata.';
  END IF;
  UPDATE outlets SET referente_employee_id = p_employee_id, updated_at = now()
   WHERE id = p_outlet_id AND company_id = v_company;
END;
$$;

REVOKE ALL ON FUNCTION public.organico_imposta_referente(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.organico_imposta_referente(uuid, uuid) TO authenticated;
