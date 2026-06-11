-- 20260611_063_add_notes_to_v_payables_operative
-- Espone payables.notes nella vista operativa dello Scadenzario.
-- La pagina /scadenzario (ScadenzarioSmart) legge v_payables_operative: la vista
-- non passava notes, quindi la descrizione non era visibile né ricercabile.
-- Additivo e non distruttivo: p.notes appeso IN CODA alla select per preservare
-- l'ordine colonne (requisito di CREATE OR REPLACE VIEW). Nessun dato toccato.
-- Applicato ai 3 tenant (NZ + Made + Zago).
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
    p.notes
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
