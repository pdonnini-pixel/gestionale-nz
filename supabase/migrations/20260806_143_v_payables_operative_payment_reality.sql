-- 20260806_143_v_payables_operative_payment_reality.sql
--
-- SCADENZARIO — rendere visibile la REALTÀ del pagamento, non la banca "prevista".
--
-- Richiesta Patrizio: nello scadenzario, per una scadenza chiusa, si deve vedere
-- COME/QUANDO/DA DOVE è stata pagata davvero:
--   • riconciliata da un MOVIMENTO bancario  → banca reale del movimento + data
--     (finora la colonna "Conto" mostrava la banca su cui si *prevedeva* di pagare,
--      cioè payment_bank_account_id, non quella dove il denaro si è mosso davvero);
--   • CHIUSA A MANO da un operatore            → chi ha chiuso e quando (niente banca
--     inventata: la chiusura manuale non movimenta un conto tracciato);
--   • pagata via DISTINTA / RI.BA              → l'origine distinta resta leggibile.
--
-- Come: la vista che alimenta lo Scadenzario (src/pages/ScadenzarioSmart.tsx legge
-- da v_payables_operative) ora ESPONE i campi della realtà del movimento, unendo il
-- movimento bancario collegato (payables.bank_transaction_id → bank_transactions).
-- Il motore di riconciliazione (reconcile_movement / *_group) scrive SEMPRE il
-- legame reale su payables.bank_transaction_id + payment_date = data del movimento;
-- la banca reale è bank_transactions.bank_account_id (payment_bank_account_id resta
-- NULL sulle righe riconciliate ed è nullato dalla chiusura a mano).
--
-- Novità di questa vista (tutte ADDITIVE — nessuna colonna esistente rimossa/rinominata):
--   • payment_date, payment_bank_account_id, bank_transaction_id, cash_movement_id,
--     closed_manually, manual_close_reason          (campi grezzi già su payables)
--   • payment_real_bank_id / payment_real_bank_name  (banca reale del movimento)
--   • payment_movement_date / _amount / _description (dettaglio del movimento reale)
--   • payment_planned_bank_name                      (banca *prevista* — solo etichetta)
--   • payment_source: 'movimento' | 'manuale' | 'storico' | NULL  (come è stata chiusa)
--
-- Inoltre FIX di last_action_by: performed_by è NULL su TUTTE le righe di
-- payable_actions (l'operatore reale è nel testo libero operator_name), quindi
-- last_action_by usciva sempre NULL. Ora è COALESCE(nome utente, operator_name).
--
-- NB (scope): NON tocco il filtro righe della vista (resta solo is_placeholder,
-- identico allo stato live) per non cambiare quali scadenze compaiono. La perdita
-- dell'esclusione reverse-charge TD16-19 (regressione della migration mp08) è un
-- problema separato, segnalato a parte.
--
-- REGOLA #0 (parità tenant): applicare su NZ + Made + Zago.
-- Additiva, idempotente, non distruttiva (CREATE OR REPLACE VIEW).

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
    -- FIX: performed_by è sempre NULL → cado su operator_name (testo libero) così
    -- "chi ha chiuso" torna visibile (es. chiusure a mano di Lilian/Sabrina).
    COALESCE(last_action.performer_name, last_action.operator_name) AS last_action_by,
    p.notes,
    p.is_auto_debit,
    -- ── REALTÀ DEL PAGAMENTO (campi grezzi) ─────────────────────────────
    p.payment_date,
    p.payment_bank_account_id,
    p.bank_transaction_id,
    p.cash_movement_id,
    p.closed_manually,
    p.manual_close_reason,
    -- ── BANCA REALE del movimento riconciliato ──────────────────────────
    bt.bank_account_id AS payment_real_bank_id,
    rba.bank_name AS payment_real_bank_name,
    bt.transaction_date AS payment_movement_date,
    bt.amount AS payment_movement_amount,
    COALESCE(NULLIF(btrim(bt.description), ''), bt.counterpart_name) AS payment_movement_description,
    -- ── BANCA PREVISTA (solo etichetta, NON è la realtà del movimento) ───
    pba.bank_name AS payment_planned_bank_name,
    -- ── COME è stata chiusa la scadenza ─────────────────────────────────
    --   movimento : agganciata a un movimento bancario reale (verità più forte,
    --               vince anche se in origine era stata chiusa a mano)
    --   manuale   : chiusa a mano da un operatore, nessun movimento tracciato
    --   storico   : risulta pagata (payment_date valorizzata) ma senza traccia
    --               di movimento né flag di chiusura manuale (import/pregresso)
        CASE
            WHEN p.bank_transaction_id IS NOT NULL THEN 'movimento'::text
            WHEN COALESCE(p.closed_manually, false) THEN 'manuale'::text
            WHEN p.status IN ('pagato'::payable_status, 'parziale'::payable_status)
                 AND p.payment_date IS NOT NULL THEN 'storico'::text
            ELSE NULL::text
        END AS payment_source
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
