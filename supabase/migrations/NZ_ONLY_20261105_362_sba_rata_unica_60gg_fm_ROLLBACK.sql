-- =============================================================================
-- ROLLBACK di NZ_ONLY_20261105_362_sba_rata_unica_60gg_fm (solo NZ)
-- Riporta le 16 scadenze S.B.A. e la scheda fornitore allo stato del backup.
-- Solo UPDATE dai backup, nessun DELETE. Le righe di payable_actions restano
-- (sono storia): se ne aggiunge una che registra il ripristino.
-- Da eseguire solo se una scadenza non e' stata nel frattempo pagata o agganciata:
-- la guardia ferma tutto in quel caso.
-- =============================================================================

BEGIN;

DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.payables p
  JOIN public._bkp_sba_rata_unica_20261105 b ON b.id = p.id
  WHERE COALESCE(p.amount_paid, 0) <> 0
     OR p.bank_transaction_id IS NOT NULL
     OR p.cash_movement_id IS NOT NULL;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'Rollback S.B.A.: % scadenze hanno pagamenti o agganci, ripristino fermato', v_bad;
  END IF;
END $$;

UPDATE public.payables p
   SET gross_amount = b.gross_amount,
       net_amount = b.net_amount,
       vat_amount = b.vat_amount,
       due_date = b.due_date,
       original_due_date = b.original_due_date,
       installment_total = b.installment_total,
       status = b.status,
       previous_status = b.previous_status,
       notes = b.notes
  FROM public._bkp_sba_rata_unica_20261105 b
 WHERE p.id = b.id;

INSERT INTO public.payable_actions (payable_id, action_type, amount, note, performed_at)
SELECT b.id, 'ricalcolo_piano', b.gross_amount,
       'S.B.A. ' || b.invoice_number || ': ripristino delle 2 rate (rollback 362)', now()
  FROM public._bkp_sba_rata_unica_20261105 b;

UPDATE public.suppliers s
   SET numero_rate = b.numero_rate,
       prima_scadenza_gg = b.prima_scadenza_gg,
       payment_base = b.payment_base,
       payment_terms = b.payment_terms,
       default_payment_terms = b.default_payment_terms
  FROM public._bkp_sba_fornitore_20261105 b
 WHERE s.id = b.id;

COMMIT;
