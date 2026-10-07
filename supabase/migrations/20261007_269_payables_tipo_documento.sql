-- =============================================================================
-- 269 — Tipo documento sulle scadenze (NZ + Made + Zago). Additiva.
-- =============================================================================
--
-- IL CASO (NZ, 07/10/2026). Da Scadenzario → Nuova scadenza → «Compila da PDF»
-- e' stata caricata la proforma 247/2026 di DST ITALIA AMF. La lettura del PDF
-- (edge function extract-scadenza) restituiva gia' documentType = "proforma",
-- ma il form lo scartava e payables non aveva dove tenerlo: in lista la riga
-- compariva come «Fatt. 247/2026». Una proforma non e' una fattura (non ha
-- valore fiscale, la fattura vera arriva dopo via SDI).
--
-- COSA CAMBIA
--   A) payables.document_type (text, NULL = fattura, il caso di sempre):
--      'fattura' | 'proforma' | 'notula' | 'parcella' | 'altro'.
--      Le note di credito restano riconosciute come prima (status/importo).
--   B) v_payables_operative: stessa definizione di prima, con document_type
--      aggiunto IN CODA (CREATE OR REPLACE consente solo colonne in fondo).
--   C) La proforma DST ITALIA 247/2026 (unica riga, NZ) prende
--      document_type = 'proforma': e' il dato che il documento dichiarava.
--      Su Made e Zago l'UPDATE non trova righe e non fa nulla.
-- =============================================================================

BEGIN;

ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS document_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payables_document_type_check') THEN
    ALTER TABLE public.payables
      ADD CONSTRAINT payables_document_type_check
      CHECK (document_type IS NULL OR document_type IN ('fattura','proforma','notula','parcella','altro'));
  END IF;
END $$;

COMMENT ON COLUMN public.payables.document_type IS
  'Tipo del documento da cui nasce la scadenza: fattura (NULL = fattura), proforma, notula, parcella, altro. Valorizzato dal form Nuova scadenza (anche da lettura PDF).';

CREATE OR REPLACE VIEW public.v_payables_operative WITH (security_invoker = on) AS
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
    COALESCE(last_action.performer_name, last_action.operator_name) AS last_action_by,
    p.notes,
    p.is_auto_debit,
    p.payment_date,
    p.payment_bank_account_id,
    p.bank_transaction_id,
    p.cash_movement_id,
    p.closed_manually,
    p.manual_close_reason,
    bt.bank_account_id AS payment_real_bank_id,
    rba.bank_name AS payment_real_bank_name,
    bt.transaction_date AS payment_movement_date,
    bt.amount AS payment_movement_amount,
    COALESCE(NULLIF(btrim(bt.description), ''::text), bt.counterpart_name) AS payment_movement_description,
    pba.bank_name AS payment_planned_bank_name,
        CASE
            WHEN p.bank_transaction_id IS NOT NULL THEN 'movimento'::text
            WHEN COALESCE(p.closed_manually, false) AND ((p.status = ANY (ARRAY['pagato'::payable_status, 'parziale'::payable_status, 'nota_credito'::payable_status])) OR COALESCE(p.amount_paid, 0::numeric) <> 0::numeric) THEN 'manuale'::text
            WHEN (p.status = ANY (ARRAY['pagato'::payable_status, 'parziale'::payable_status])) AND p.payment_date IS NOT NULL THEN 'storico'::text
            ELSE NULL::text
        END AS payment_source,
    p.document_type
   FROM payables p
     LEFT JOIN outlets o ON o.id = p.outlet_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN cost_categories cc ON cc.id = p.cost_category_id
     LEFT JOIN bank_transactions bt ON bt.id = p.bank_transaction_id
     LEFT JOIN bank_accounts rba ON rba.id = bt.bank_account_id
     LEFT JOIN bank_accounts pba ON pba.id = p.payment_bank_account_id
     LEFT JOIN LATERAL ( SELECT pa.action_type,
            pa.note,
            pa.performed_at,
            pa.operator_name,
            (up.first_name || ' '::text) || up.last_name AS performer_name
           FROM payable_actions pa
             LEFT JOIN user_profiles up ON up.id = pa.performed_by
          WHERE pa.payable_id = p.id
          ORDER BY pa.performed_at DESC
         LIMIT 1) last_action ON true
  WHERE NOT COALESCE(p.is_placeholder, false) AND NOT (EXISTS ( SELECT 1
           FROM electronic_invoices ei
          WHERE ei.id = p.electronic_invoice_id AND (upper(COALESCE(ei.tipo_documento, ''::text)) = ANY (ARRAY['TD16'::text, 'TD17'::text, 'TD18'::text, 'TD19'::text]))))
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

-- C) La proforma che ha fatto emergere il caso (solo NZ: altrove 0 righe).
UPDATE public.payables
   SET document_type = 'proforma'
 WHERE id = 'e1b50550-a88a-4388-8c06-2db1ca1814d7'
   AND electronic_invoice_id IS NULL
   AND document_type IS NULL;

COMMIT;

-- VERIFICA
-- SELECT count(*) FILTER (WHERE document_type IS NOT NULL) FROM payables;
-- SELECT document_type FROM v_payables_operative WHERE id = 'e1b50550-a88a-4388-8c06-2db1ca1814d7';
