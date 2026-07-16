-- 20260716_103_supplier_payment_proposals.sql
--
-- FEATURE: revisione pagamenti fornitori con proposte.
-- Un'operatrice (es. Sabrina, ruolo 'contabile') rivede i fornitori e SALVA
-- le proposte di modifica (metodo/base/giorni/rate/banca). Un responsabile
-- (super_advisor / cfo / ceo) le VEDE e le APPLICA (o le scarta). All'apply si
-- salva il valore precedente nella proposta stessa (rollback sempre possibile).
--
-- Additiva/non distruttiva. PARITA' TENANT (Regola #0): NZ + Made + Zago.
-- La tabella e' vuota all'inizio; le proposte sono DATI per-tenant.

BEGIN;

CREATE TABLE IF NOT EXISTS public.supplier_payment_proposals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL,
  supplier_id              uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  supplier_name            text,
  -- valori PROPOSTI (stato desiderato completo della riga)
  proposed_method          text,          -- valore enum payment_method (già mappato dal frontend)
  proposed_base            text CHECK (proposed_base IS NULL OR proposed_base IN ('data_fattura','fine_mese')),
  proposed_prima_gg        integer,
  proposed_rate            integer,
  proposed_bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  proposed_scad_label      text,          -- etichetta leggibile mostrata (es. "60/90/120 gg DFFM")
  note                     text,          -- note libere / casi "Data fissa mese (giorno N)"
  -- backup del valore PRIMA dell'apply (per rollback)
  prev_method              text,
  prev_base                text,
  prev_prima_gg            integer,
  prev_rate                integer,
  prev_bank_account_id     uuid,
  status                   text NOT NULL DEFAULT 'inviata'
                             CHECK (status IN ('inviata','applicata','scartata')),
  reviewed_by              uuid,
  applied_by               uuid,
  applied_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.supplier_payment_proposals IS
  'Proposte di modifica al piano pagamento fornitore fatte in revisione; il responsabile le applica (con backup) o le scarta.';

-- Una sola proposta per (azienda, fornitore): il salvataggio fa upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_proposal_supplier
  ON public.supplier_payment_proposals (company_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_payment_proposal_open
  ON public.supplier_payment_proposals (company_id) WHERE status = 'inviata';

CREATE OR REPLACE FUNCTION public.fn_payment_proposal_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_payment_proposal_touch ON public.supplier_payment_proposals;
CREATE TRIGGER trg_payment_proposal_touch
  BEFORE UPDATE ON public.supplier_payment_proposals
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_proposal_touch();

-- RLS: lettura a tutta la company; scrittura (salvataggio proposte) ai ruoli operativi.
ALTER TABLE public.supplier_payment_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pp_select ON public.supplier_payment_proposals;
CREATE POLICY pp_select ON public.supplier_payment_proposals
  AS PERMISSIVE FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS pp_write ON public.supplier_payment_proposals;
CREATE POLICY pp_write ON public.supplier_payment_proposals
  AS PERMISSIVE FOR ALL
  USING (company_id = get_my_company_id()
         AND get_my_role() = ANY (ARRAY['super_advisor'::user_role,'contabile'::user_role,'cfo'::user_role]))
  WITH CHECK (company_id = get_my_company_id()
         AND get_my_role() = ANY (ARRAY['super_advisor'::user_role,'contabile'::user_role,'cfo'::user_role]));

-- =====================================================================
-- RPC: applica una proposta (backup + update fornitore). Solo responsabili.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.rpc_apply_payment_proposal(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid := get_my_company_id();
  v_role    user_role := get_my_role();
  p         public.supplier_payment_proposals%ROWTYPE;
  s         public.suppliers%ROWTYPE;
BEGIN
  IF v_company IS NULL OR v_role IS NULL
     OR v_role NOT IN ('super_advisor','cfo','ceo') THEN
    RETURN false;
  END IF;

  SELECT * INTO p FROM public.supplier_payment_proposals
   WHERE id = p_id AND company_id = v_company AND status = 'inviata';
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO s FROM public.suppliers
   WHERE id = p.supplier_id AND company_id = v_company;
  IF NOT FOUND THEN RETURN false; END IF;

  -- backup valori attuali nella proposta
  UPDATE public.supplier_payment_proposals SET
    prev_method          = COALESCE(s.default_payment_method::text, s.payment_method),
    prev_base            = s.payment_base,
    prev_prima_gg        = s.prima_scadenza_gg,
    prev_rate            = s.numero_rate,
    prev_bank_account_id = s.payment_bank_account_id
  WHERE id = p_id;

  -- applica al fornitore. base/prima/rate solo se la base proposta e' definita
  -- (i casi "Data fissa mese" hanno proposed_base NULL e restano invariati qui).
  UPDATE public.suppliers t SET
    payment_method          = COALESCE(p.proposed_method, t.payment_method),
    default_payment_method  = COALESCE(p.proposed_method::payment_method, t.default_payment_method),
    payment_base            = CASE WHEN p.proposed_base IS NOT NULL THEN p.proposed_base       ELSE t.payment_base END,
    prima_scadenza_gg       = CASE WHEN p.proposed_base IS NOT NULL THEN p.proposed_prima_gg   ELSE t.prima_scadenza_gg END,
    numero_rate             = CASE WHEN p.proposed_base IS NOT NULL THEN p.proposed_rate       ELSE t.numero_rate END,
    payment_bank_account_id = p.proposed_bank_account_id,
    updated_at              = now()
  WHERE t.id = p.supplier_id;

  UPDATE public.supplier_payment_proposals
     SET status = 'applicata', applied_by = auth.uid(), applied_at = now()
   WHERE id = p_id;

  RETURN true;
END; $$;

-- RPC: applica TUTTE le proposte inviate della company. Ritorna il n. applicate.
CREATE OR REPLACE FUNCTION public.rpc_apply_all_payment_proposals()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid := get_my_company_id();
  v_role    user_role := get_my_role();
  r         record;
  v_n       integer := 0;
BEGIN
  IF v_company IS NULL OR v_role IS NULL
     OR v_role NOT IN ('super_advisor','cfo','ceo') THEN
    RETURN 0;
  END IF;
  FOR r IN SELECT id FROM public.supplier_payment_proposals
            WHERE company_id = v_company AND status = 'inviata'
  LOOP
    IF public.rpc_apply_payment_proposal(r.id) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END; $$;

-- RPC: scarta una proposta.
CREATE OR REPLACE FUNCTION public.rpc_discard_payment_proposal(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company uuid := get_my_company_id(); v_role user_role := get_my_role();
BEGIN
  IF v_company IS NULL OR v_role NOT IN ('super_advisor','cfo','ceo') THEN RETURN false; END IF;
  UPDATE public.supplier_payment_proposals SET status = 'scartata'
   WHERE id = p_id AND company_id = v_company AND status = 'inviata';
  RETURN FOUND;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_apply_payment_proposal(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_apply_all_payment_proposals()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_discard_payment_proposal(uuid)    TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFICA
-- =====================================================================
-- SELECT count(*) FROM public.supplier_payment_proposals;                 -- 0 all'inizio
-- SELECT status, count(*) FROM public.supplier_payment_proposals GROUP BY 1;
