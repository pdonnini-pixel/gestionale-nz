-- 20260806_133_v_payables_operative_exclude_reverse_charge.sql
--
-- FIX STRUTTURALE — le autofatture/integrazioni reverse charge (TD16/17/18/19)
-- NON devono MAI comparire nello scadenzario: sono documenti IVA auto-emessi dal
-- cessionario, non debiti verso il fornitore (il debito reale sta sulla fattura
-- originale TD01/TD24).
--
-- Il bridge fix 131 impedisce di CREARE nuovi payable da questi documenti, e la
-- bonifica 132 li aveva nascosti con is_placeholder=true. MA la sync passiva
-- giornaliera (acube_cf_sync_inbound / trigger) puo' rimettere is_placeholder=false
-- su payable gia' esistenti, facendoli riemergere (caso Scopa Magica 34/A, 42/A e
-- altre 15 autofatture ricomparse). Affidarsi al solo flag e' fragile.
--
-- Qui rendo l'esclusione STRUTTURALE nella vista che alimenta lo Scadenzario
-- (src/pages/ScadenzarioSmart.tsx legge da v_payables_operative): oltre a
-- escludere i placeholder, la vista scarta ogni payable la cui fattura elettronica
-- e' un TD16/17/18/19. Cosi' non riappaiono mai piu', qualunque cosa faccia la sync.
--
-- REGOLA #0 (parita' tenant): applicare su NZ + Made + Zago.

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
  WHERE NOT COALESCE(p.is_placeholder, false)
    AND NOT EXISTS (
          SELECT 1 FROM public.electronic_invoices ei
          WHERE ei.id = p.electronic_invoice_id
            AND upper(COALESCE(ei.tipo_documento, '')) IN ('TD16','TD17','TD18','TD19')
        )
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
