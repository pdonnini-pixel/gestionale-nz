-- 20260716_104_payment_proposals_contabile_apply.sql
--
-- Consente al ruolo 'contabile' (operatrice, es. Sabrina) di APPLICARE
-- direttamente le proprie modifiche ai fornitori, senza passare da un
-- responsabile. Aggiorna solo la lista ruoli ammessi nelle 3 RPC (CREATE OR
-- REPLACE); backup del valore precedente e RLS restano invariati.
--
-- Additiva/non distruttiva. PARITA' TENANT: NZ + Made + Zago.

BEGIN;

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
     OR v_role NOT IN ('super_advisor','cfo','ceo','contabile') THEN
    RETURN false;
  END IF;

  SELECT * INTO p FROM public.supplier_payment_proposals
   WHERE id = p_id AND company_id = v_company AND status = 'inviata';
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO s FROM public.suppliers
   WHERE id = p.supplier_id AND company_id = v_company;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.supplier_payment_proposals SET
    prev_method          = COALESCE(s.default_payment_method::text, s.payment_method),
    prev_base            = s.payment_base,
    prev_prima_gg        = s.prima_scadenza_gg,
    prev_rate            = s.numero_rate,
    prev_bank_account_id = s.payment_bank_account_id
  WHERE id = p_id;

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
     OR v_role NOT IN ('super_advisor','cfo','ceo','contabile') THEN
    RETURN 0;
  END IF;
  FOR r IN SELECT id FROM public.supplier_payment_proposals
            WHERE company_id = v_company AND status = 'inviata'
  LOOP
    IF public.rpc_apply_payment_proposal(r.id) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_discard_payment_proposal(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company uuid := get_my_company_id(); v_role user_role := get_my_role();
BEGIN
  IF v_company IS NULL OR v_role NOT IN ('super_advisor','cfo','ceo','contabile') THEN RETURN false; END IF;
  UPDATE public.supplier_payment_proposals SET status = 'scartata'
   WHERE id = p_id AND company_id = v_company AND status = 'inviata';
  RETURN FOUND;
END; $$;

COMMIT;
