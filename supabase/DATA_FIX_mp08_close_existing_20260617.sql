-- ════════════════════════════════════════════════════════════════════
-- DATA FIX — chiusura MP08 esistenti (tutti i tenant). 2026-06-17.
-- Solo UPDATE/INSERT idempotenti, nessuna cancellazione. Backup prima.
--
-- Per i payable già presenti con payment_method_code='MP08' e stato aperto
-- (scaduto/in_scadenza/da_pagare/parziale): amount_paid=gross_amount → il trigger
-- trg_payable_status calcola status='pagato'; payment_method='carta_credito'.
-- Poi registra in payable_actions ogni MP08 'pagato' privo di azione 'payment'.
--
-- NZ all'esecuzione: 6 fatture MCA SRL aperte (≈ €10,50) chiuse; gli altri 48
-- MP08 erano già pagati e avevano già la riga payable_actions. Made/Zago: 0
-- payable → no-op. Verifica: 0 MP08 aperti, 0 MP08 pagati senza azione.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.payables_bkp_mp08_20260617 AS
  SELECT * FROM public.payables WHERE payment_method_code='MP08';

UPDATE public.payables
SET amount_paid    = gross_amount,
    payment_date   = COALESCE(payment_date, invoice_date),
    payment_method = 'carta_credito'::payment_method,
    updated_at     = now()
WHERE payment_method_code='MP08'
  AND status IN ('scaduto','in_scadenza','da_pagare','parziale')
  AND COALESCE(is_forecast,false)=false;

INSERT INTO public.payable_actions (payable_id, action_type, amount, new_status, payment_method, note, performed_at)
SELECT p.id, 'payment', p.gross_amount, 'pagato'::payable_status, 'carta_credito'::payment_method,
       'Pagato con carta (MP08) - automatico', now()
FROM public.payables p
WHERE p.payment_method_code='MP08' AND p.status='pagato'
  AND NOT EXISTS (SELECT 1 FROM public.payable_actions a WHERE a.payable_id=p.id AND a.action_type='payment');
