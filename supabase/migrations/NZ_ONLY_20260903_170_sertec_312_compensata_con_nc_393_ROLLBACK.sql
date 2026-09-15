-- ROLLBACK di NZ_ONLY_20260903_170_sertec_312_compensata_con_nc_393.sql
-- Ripristina lo stato pre-modifica di fattura 312 e NC 393 SERTEC leggendo da
-- public._bkp_sertec_nc393_20260903. Annulla il legame NC e riporta la proposta
-- di riconciliazione a 'to_confirm'. Nessun dato inventato, nessuna riga cancellata.

BEGIN;

UPDATE public.payables p
SET status              = b.status,
    amount_paid         = b.amount_paid,
    amount_remaining    = b.amount_remaining,
    payment_date        = b.payment_date,
    closed_manually     = b.closed_manually,
    manual_close_reason = b.manual_close_reason,
    bank_transaction_id = b.bank_transaction_id,
    is_provisional_paid = b.is_provisional_paid,
    provisional_paid_at = b.provisional_paid_at,
    payment_bank_account_id = b.payment_bank_account_id,
    updated_at          = now()
FROM public._bkp_sertec_nc393_20260903 b
WHERE p.id = b.id;

UPDATE public.payable_credit_note_links l
SET status = 'cancelled', applied_at = NULL
FROM public._bkp_sertec_nc393_20260903 b
WHERE l.credit_note_payable_id = b.id AND b.gross_amount < 0 AND l.status = 'applied';

UPDATE public.reconciliation_log rl
SET status = 'to_confirm',
    notes  = coalesce(rl.notes,'') || ' | rollback compensazione NC 393'
FROM public._bkp_sertec_nc393_20260903 b
WHERE rl.payable_id = b.id AND b.gross_amount < 0 AND rl.status = 'rejected'
  AND rl.notes LIKE '%NC compensata sulla fattura 312%';

-- Le righe di audit in payable_actions (riapertura / chiusura_manuale) restano:
-- sono storia, non stato. Se serve pulirle, farlo con conferma esplicita.

COMMIT;
