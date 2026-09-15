-- ════════════════════════════════════════════════════════════════════
-- 133 — Carta di pagamento (MP08) = ADDEBITO AUTOMATICO differito
-- Applicare ai 3 tenant (NZ/Made/Zago). Additiva, non distruttiva.
--
-- CONTESTO (richiesta Patrizio, 2026-08-06)
-- Le fatture pagate con "carta di pagamento" (FatturaPA ModalitaPagamento
-- MP08 — es. carte BCC) NON sono un pagamento immediato: vengono addebitate
-- in AUTOMATICO tra il 20 e il 30 del mese successivo all'emissione. Quindi:
--  - NON devono comparire come scadenza "scaduta" nello scadenzario (creano
--    confusione: non c'è nulla da fare a mano, è automatico);
--  - devono restare come USCITA PREVISTA nel saldo/cashflow (NON vanno tolte)
--    fino a quando il movimento bancario reale non le chiude;
--  - la data di addebito usata è il 20 del mese successivo (decisione Patrizio:
--    la più prudente della finestra 20–30).
--
-- SUPERA la migration 083 (che segnava MP08 come "già pagato" e le toglieva
-- dal saldo): quel comportamento è ora sostituito da "addebito automatico".
--
-- Cosa fa questo file:
--  (1) payables.is_auto_debit — flag per gli addebiti automatici (carta);
--  (2) fn_mp08_autopay — rileva MP08 anche quando il bridge A-Cube non ha
--      popolato payment_method_code (fatture senza DataScadenzaPagamento):
--      guarda la ModalitaPagamento nell'XML della fattura elettronica
--      collegata. Non segna più 'pagato': imposta is_auto_debit + due_date
--      (20 del mese successivo) e lascia la riga APERTA;
--  (3) update_payable_status — le righe is_auto_debit non diventano MAI
--      'scaduto' (restano 'da_pagare'/'in_scadenza');
--  (4) drop trg_mp08_register_payment — niente più azione 'payment' fittizia
--      alla creazione (non sono più pagate all'emissione);
--  (5) v_payables_operative — espone is_auto_debit al frontend.
-- ════════════════════════════════════════════════════════════════════

-- (1) Flag addebito automatico ───────────────────────────────────────
ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS is_auto_debit boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payables.is_auto_debit IS
  'true = addebito automatico differito (es. carta MP08): non è mai "scaduto", resta nel saldo come uscita prevista, si chiude con la riconciliazione bancaria.';

-- (2) Rilevamento MP08 + trattamento addebito automatico ─────────────
CREATE OR REPLACE FUNCTION public.fn_mp08_autopay()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_mp08 boolean := (NEW.payment_method_code = 'MP08');
BEGIN
  -- Rileva "carta di pagamento" MP08 anche quando il bridge A-Cube non ha
  -- popolato payment_method_code: succede per le fatture con ModalitaPagamento
  -- ma SENZA DataScadenzaPagamento (il parser rate scarta le righe senza data
  -- e il metodo va perso). In quel caso si legge la ModalitaPagamento
  -- direttamente dall'XML della fattura elettronica collegata. Solo per rata
  -- unica, per non marcare a caso le fatture multi-rata.
  IF NOT v_is_mp08
     AND NEW.electronic_invoice_id IS NOT NULL
     AND COALESCE(NEW.installment_total, 1) <= 1 THEN
    SELECT (e.xml_content ~ '<ModalitaPagamento>MP08</ModalitaPagamento>')
      INTO v_is_mp08
    FROM public.electronic_invoices e
    WHERE e.id = NEW.electronic_invoice_id;
    v_is_mp08 := COALESCE(v_is_mp08, false);
  END IF;

  -- Addebito automatico carta (MP08): NON è un pagamento immediato ma un
  -- addebito differito. La fattura resta APERTA (pesa sul saldo), non diventa
  -- mai 'scaduto' (vedi update_payable_status) e si chiude da sola con la
  -- riconciliazione del movimento bancario reale.
  IF v_is_mp08
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.amount_paid, 0) = 0
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    NEW.payment_method_code := 'MP08';
    NEW.is_auto_debit       := true;
    NEW.payment_method      := 'carta_credito'::payment_method;
    -- data di addebito = 20 del mese successivo all'emissione
    NEW.due_date := (date_trunc('month', NEW.invoice_date) + interval '1 month' + interval '19 days')::date;
  END IF;
  RETURN NEW;
END;
$function$;

-- (3) Stato: gli addebiti automatici non sono mai 'scaduto' ──────────
CREATE OR REPLACE FUNCTION public.update_payable_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_due_date := NEW.due_date;
  END IF;

  NEW.amount_remaining := NEW.gross_amount - COALESCE(NEW.amount_paid, 0);

  IF NEW.status = 'nota_credito' THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.status IN ('sospeso', 'annullato', 'bloccato') THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.status = 'rimandato' AND NEW.postponed_to IS NOT NULL THEN
    NEW.due_date := NEW.postponed_to;
    NEW.status := 'da_pagare';
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.amount_remaining <= 0 THEN
    NEW.status := 'pagato';
  ELSIF COALESCE(NEW.amount_paid, 0) > 0 AND NEW.amount_remaining > 0 THEN
    NEW.status := 'parziale';
  ELSIF COALESCE(NEW.is_auto_debit, false) THEN
    -- Addebito automatico carta: mai 'scaduto'. Diventa 'in_scadenza' solo a
    -- ridosso della data di addebito, altrimenti resta 'da_pagare'.
    IF NEW.due_date <= CURRENT_DATE + 7 THEN
      NEW.status := 'in_scadenza';
    ELSE
      NEW.status := 'da_pagare';
    END IF;
  ELSIF NEW.due_date < CURRENT_DATE THEN
    NEW.status := 'scaduto';
  ELSIF NEW.due_date <= CURRENT_DATE + 7 THEN
    NEW.status := 'in_scadenza';
  ELSE
    NEW.status := 'da_pagare';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

-- (4) Niente più "pagato automatico" alla creazione di una MP08 ──────
--     (la 083 registrava un'azione 'payment' fittizia: ora non serve più,
--      la carta si chiude con la riconciliazione bancaria reale).
DROP TRIGGER IF EXISTS trg_mp08_register_payment ON public.payables;

-- (5) Espone is_auto_debit al frontend ──────────────────────────────
CREATE OR REPLACE VIEW public.v_payables_operative AS
 SELECT p.id,
    p.company_id,
    p.outlet_id,
    p.supplier_id,
    o.name AS outlet_name,
    o.code AS outlet_code,
    COALESCE(s.name, p.supplier_name) AS supplier_name,
    COALESCE(s.ragione_sociale, s.name, p.supplier_name) AS supplier_ragione_sociale,
    COALESCE(s.category, 'altro'::text) AS supplier_category,
    COALESCE(p.iban, s.iban) AS supplier_iban,
    COALESCE(s.partita_iva, s.vat_number, p.supplier_vat) AS supplier_vat,
    p.invoice_number,
    p.invoice_date,
    p.original_due_date,
    p.due_date,
    p.postponed_to,
    p.postpone_count,
    p.gross_amount,
    p.amount_paid,
    p.amount_remaining,
    p.payment_method,
    p.status,
    p.priority,
    p.suspend_reason,
    p.suspend_date,
    cc.name AS cost_category_name,
    cc.macro_group,
        CASE
            WHEN p.status = 'sospeso'::payable_status THEN NULL::integer
            WHEN p.status = 'pagato'::payable_status THEN NULL::integer
            ELSE p.due_date - CURRENT_DATE
        END AS days_to_due,
        CASE
            WHEN p.status = 'pagato'::payable_status THEN 'paid'::text
            WHEN p.status = 'annullato'::payable_status THEN 'cancelled'::text
            WHEN p.status = 'sospeso'::payable_status THEN 'suspended'::text
            WHEN p.due_date < CURRENT_DATE THEN 'overdue'::text
            WHEN p.due_date <= (CURRENT_DATE + 7) THEN 'urgent'::text
            WHEN p.due_date <= (CURRENT_DATE + 30) THEN 'upcoming'::text
            ELSE 'ok'::text
        END AS urgency,
    last_action.action_type AS last_action_type,
    last_action.note AS last_action_note,
    last_action.performed_at AS last_action_date,
    last_action.performer_name AS last_action_by,
    p.notes,
    p.is_auto_debit
   FROM payables p
     LEFT JOIN outlets o ON o.id = p.outlet_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN cost_categories cc ON cc.id = p.cost_category_id
     LEFT JOIN LATERAL ( SELECT pa.action_type,
            pa.note,
            pa.performed_at,
            (up.first_name || ' '::text) || up.last_name AS performer_name
           FROM payable_actions pa
             LEFT JOIN user_profiles up ON up.id = pa.performed_by
          WHERE pa.payable_id = p.id
          ORDER BY pa.performed_at DESC
         LIMIT 1) last_action ON true
  WHERE NOT COALESCE(p.is_placeholder, false)
  ORDER BY (
        CASE p.status
            WHEN 'scaduto'::payable_status THEN 0
            WHEN 'in_scadenza'::payable_status THEN 1
            WHEN 'parziale'::payable_status THEN 2
            WHEN 'da_pagare'::payable_status THEN 3
            WHEN 'sospeso'::payable_status THEN 4
            WHEN 'rimandato'::payable_status THEN 5
            WHEN 'pagato'::payable_status THEN 6
            WHEN 'annullato'::payable_status THEN 7
            ELSE NULL::integer
        END), p.due_date;
