-- ROLLBACK 133 — ripristina il comportamento MP08 = "già pagato" (migration 083)
-- e rimuove il flag is_auto_debit. Best-effort (il flag sui dati viene perso).

-- (5) view senza is_auto_debit
CREATE OR REPLACE VIEW public.v_payables_operative AS
 SELECT p.id, p.company_id, p.outlet_id, p.supplier_id,
    o.name AS outlet_name, o.code AS outlet_code,
    COALESCE(s.name, p.supplier_name) AS supplier_name,
    COALESCE(s.ragione_sociale, s.name, p.supplier_name) AS supplier_ragione_sociale,
    COALESCE(s.category, 'altro'::text) AS supplier_category,
    COALESCE(p.iban, s.iban) AS supplier_iban,
    COALESCE(s.partita_iva, s.vat_number, p.supplier_vat) AS supplier_vat,
    p.invoice_number, p.invoice_date, p.original_due_date, p.due_date,
    p.postponed_to, p.postpone_count, p.gross_amount, p.amount_paid, p.amount_remaining,
    p.payment_method, p.status, p.priority, p.suspend_reason, p.suspend_date,
    cc.name AS cost_category_name, cc.macro_group,
        CASE WHEN p.status = 'sospeso'::payable_status THEN NULL::integer
             WHEN p.status = 'pagato'::payable_status THEN NULL::integer
             ELSE p.due_date - CURRENT_DATE END AS days_to_due,
        CASE WHEN p.status = 'pagato'::payable_status THEN 'paid'::text
             WHEN p.status = 'annullato'::payable_status THEN 'cancelled'::text
             WHEN p.status = 'sospeso'::payable_status THEN 'suspended'::text
             WHEN p.due_date < CURRENT_DATE THEN 'overdue'::text
             WHEN p.due_date <= (CURRENT_DATE + 7) THEN 'urgent'::text
             WHEN p.due_date <= (CURRENT_DATE + 30) THEN 'upcoming'::text
             ELSE 'ok'::text END AS urgency,
    last_action.action_type AS last_action_type, last_action.note AS last_action_note,
    last_action.performed_at AS last_action_date, last_action.performer_name AS last_action_by,
    p.notes
   FROM payables p
     LEFT JOIN outlets o ON o.id = p.outlet_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN cost_categories cc ON cc.id = p.cost_category_id
     LEFT JOIN LATERAL ( SELECT pa.action_type, pa.note, pa.performed_at,
            (up.first_name || ' '::text) || up.last_name AS performer_name
           FROM payable_actions pa LEFT JOIN user_profiles up ON up.id = pa.performed_by
          WHERE pa.payable_id = p.id ORDER BY pa.performed_at DESC LIMIT 1) last_action ON true
  WHERE NOT COALESCE(p.is_placeholder, false)
  ORDER BY (CASE p.status
            WHEN 'scaduto'::payable_status THEN 0 WHEN 'in_scadenza'::payable_status THEN 1
            WHEN 'parziale'::payable_status THEN 2 WHEN 'da_pagare'::payable_status THEN 3
            WHEN 'sospeso'::payable_status THEN 4 WHEN 'rimandato'::payable_status THEN 5
            WHEN 'pagato'::payable_status THEN 6 WHEN 'annullato'::payable_status THEN 7
            ELSE NULL::integer END), p.due_date;

-- (3) update_payable_status senza il ramo is_auto_debit
CREATE OR REPLACE FUNCTION public.update_payable_status()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.original_due_date := NEW.due_date; END IF;
  NEW.amount_remaining := NEW.gross_amount - COALESCE(NEW.amount_paid, 0);
  IF NEW.status = 'nota_credito' THEN NEW.updated_at := NOW(); RETURN NEW; END IF;
  IF NEW.status IN ('sospeso', 'annullato', 'bloccato') THEN NEW.updated_at := NOW(); RETURN NEW; END IF;
  IF NEW.status = 'rimandato' AND NEW.postponed_to IS NOT NULL THEN
    NEW.due_date := NEW.postponed_to; NEW.status := 'da_pagare'; NEW.updated_at := NOW(); RETURN NEW;
  END IF;
  IF NEW.amount_remaining <= 0 THEN NEW.status := 'pagato';
  ELSIF COALESCE(NEW.amount_paid, 0) > 0 AND NEW.amount_remaining > 0 THEN NEW.status := 'parziale';
  ELSIF NEW.due_date < CURRENT_DATE THEN NEW.status := 'scaduto';
  ELSIF NEW.due_date <= CURRENT_DATE + 7 THEN NEW.status := 'in_scadenza';
  ELSE NEW.status := 'da_pagare'; END IF;
  NEW.updated_at := NOW(); RETURN NEW;
END; $function$;

-- (2) fn_mp08_autopay versione 083 (MP08 = già pagato)
CREATE OR REPLACE FUNCTION public.fn_mp08_autopay()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.payment_method_code = 'MP08'
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.amount_paid, 0) = 0
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    NEW.amount_paid    := NEW.gross_amount;
    NEW.payment_date   := COALESCE(NEW.payment_date, NEW.invoice_date);
    NEW.payment_method := 'carta_credito'::payment_method;
  END IF;
  RETURN NEW;
END; $function$;

-- (4) ricrea il trigger AFTER INSERT di registrazione pagamento
DROP TRIGGER IF EXISTS trg_mp08_register_payment ON public.payables;
CREATE TRIGGER trg_mp08_register_payment
  AFTER INSERT ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.fn_mp08_register_payment();

-- (1) rimuove il flag
ALTER TABLE public.payables DROP COLUMN IF EXISTS is_auto_debit;
