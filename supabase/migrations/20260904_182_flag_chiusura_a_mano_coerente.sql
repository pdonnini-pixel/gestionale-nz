-- =============================================================================
-- 182 — Il flag «chiusa a mano» non puo' sopravvivere a una riapertura
--       (NZ + Made + Zago). Additiva: una funzione, un trigger, una vista.
-- =============================================================================
--
-- IL CASO CHE L'HA FATTA EMERGERE (NZ, 04/09/2026). Spm Investigazioni, fattura
-- 31 del 26/02/2026: nello Scadenzario compariva insieme lo stato «Scaduto» e il
-- badge «Chiusa a mano», con la colonna Conto «A mano · Lilian Mammoliti · 06/08».
-- Due fonti diverse per la stessa domanda: lo stato lo ricalcola
-- update_payable_status dall'importo pagato (che era 0), mentre badge e colonna
-- Conto leggono il flag closed_manually, rimasto acceso da una chiusura vecchia.
--
-- COME CI SI ARRIVA. reopen_payable spegne closed_manually e registra l'azione
-- «riapertura», quindi dalla strada buona il problema non nasce. Nasce dagli
-- UPDATE diretti su payables (rimozione da distinta, allineamenti massivi,
-- correzioni a mano) che azzerano amount_paid senza toccare il flag. Da li' in
-- poi la riga resta fra le aperte ma si presenta come pagata.
--
-- COSA CAMBIA
--   A) fn_payable_clear_stale_manual_close + trigger
--      trg_payable_zz_clear_stale_manual_close (BEFORE INSERT OR UPDATE):
--      se una riga resta senza pagato, senza movimento bancario e senza pagato
--      provvisorio, e il suo stato non e' pagato/parziale/nota di credito/
--      annullato, allora closed_manually si spegne e manual_close_reason si
--      azzera. Il flag non puo' piu' sopravvivere a una riapertura, da qualunque
--      strada arrivi l'UPDATE.
--      Il nome del trigger inizia per «trg_payable_zz» apposta: i trigger BEFORE
--      scattano in ordine alfabetico e questo deve vedere lo stato gia'
--      ricalcolato da trg_payable_status.
--      Le note di credito sono escluse: per loro close_payable_manually accende
--      il flag senza toccare amount_paid, ed e' corretto cosi'.
--
--   B) v_payables_operative: payment_source vale 'manuale' solo se la riga e'
--      davvero chiusa (stato pagato/parziale/nota di credito, oppure un importo
--      pagato diverso da zero). Rete di sicurezza per la colonna Conto, nel caso
--      qualcuno scriva ancora sul DB aggirando il trigger.
--      Il resto della vista e' invariato, security_invoker resta on.
--
-- Il caso NZ e' gia' stato sistemato a parte (NZ_ONLY_20260904_182): era l'unica
-- riga in tutto il tenant con flag acceso e pagato a zero.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A) il flag si spegne da solo quando la riga torna aperta
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_payable_clear_stale_manual_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(NEW.closed_manually, false)
     AND COALESCE(NEW.amount_paid, 0) = 0
     AND NEW.bank_transaction_id IS NULL
     AND COALESCE(NEW.is_provisional_paid, false) = false
     AND COALESCE(NEW.gross_amount, 0) >= 0
     AND COALESCE(NEW.status::text, '') NOT IN ('pagato', 'parziale', 'nota_credito', 'annullato')
  THEN
    NEW.closed_manually := false;
    NEW.manual_close_reason := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_payable_clear_stale_manual_close() IS
  'Spegne closed_manually e manual_close_reason quando una scadenza resta senza pagato, senza movimento bancario e senza pagato provvisorio: il badge «chiusa a mano» non deve sopravvivere a una riapertura fatta con un UPDATE diretto. Note di credito e righe annullate escluse.';

DROP TRIGGER IF EXISTS trg_payable_zz_clear_stale_manual_close ON public.payables;
CREATE TRIGGER trg_payable_zz_clear_stale_manual_close
  BEFORE INSERT OR UPDATE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.fn_payable_clear_stale_manual_close();

-- ─────────────────────────────────────────────────────────────────────────────
-- B) la colonna Conto dice «a mano» solo su una riga davvero chiusa
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_payables_operative
WITH (security_invoker = on) AS
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
            WHEN COALESCE(p.closed_manually, false)
                 AND (p.status = ANY (ARRAY['pagato'::payable_status, 'parziale'::payable_status, 'nota_credito'::payable_status])
                      OR COALESCE(p.amount_paid, 0) <> 0) THEN 'manuale'::text
            WHEN (p.status = ANY (ARRAY['pagato'::payable_status, 'parziale'::payable_status])) AND p.payment_date IS NOT NULL THEN 'storico'::text
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

COMMIT;

-- =============================================================================
-- VERIFICA (su ogni tenant)
-- 1) nessuna riga aperta col flag di chiusura acceso
-- select count(*) from payables
--  where coalesce(closed_manually,false) and coalesce(amount_paid,0) = 0
--    and bank_transaction_id is null and status::text not in ('pagato','parziale','nota_credito','annullato');
-- atteso: 0
--
-- 2) la vista e' ancora security_invoker
-- select reloptions from pg_class where oid = 'public.v_payables_operative'::regclass;
-- atteso: {security_invoker=on}
-- =============================================================================
