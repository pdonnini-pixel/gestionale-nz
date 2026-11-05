-- =============================================================================
-- NZ_ONLY — S.B.A. srl: rata unica a 60 giorni fine mese
-- Applicata su NZ il 05/11/2026 via MCP. Dati NZ-specifici: non si replica.
-- Solo UPDATE, nessun DELETE. Backup in public._bkp_sba_rata_unica_20261105
-- (scadenze) e public._bkp_sba_fornitore_20261105 (scheda fornitore).
-- =============================================================================
--
-- COSA E' SUCCESSO. Le fatture S.B.A. (P.IVA 03507621211) non portano il blocco
-- DatiPagamento, quindi il bridge A-Cube usava il piano della scheda fornitore:
-- 2 rate, la prima a 60 giorni fine mese e la seconda 30 giorni dopo.
-- Patrizio (05/11/2026): «il pagamento e' a 60 giorni fine mese in un'unica
-- scadenza». Confermato in chat dopo aver visto la tabella delle nuove date.
--
-- COSA CAMBIA.
--   * Scheda S.B.A.: numero_rate 1, prima_scadenza_gg 60, fine mese.
--     Le fatture nuove nascono gia' in una rata.
--   * Fatture 890, 965, 983, 1056, 1067, 1092, 1095, 1111 (tutte senza acconti,
--     senza movimenti, distinte o proposte collegate): la rata 1 prende l'intero
--     importo e scade a 60 giorni fine mese; la rata 2 viene ANNULLATA (resta nel
--     DB, la vista operativa la esclude).
--
-- NON TOCCATA: la 872FV2026. La prima meta' (10.591,55) e' gia' passata nella
-- distinta RiBa del 31/10 (effetto da 10.568,98 con la nota di credito 95):
-- resta aperta la seconda meta' al 30/11.
--
-- Rollback: ripristinare le colonne dalle due tabelle di backup.
-- =============================================================================

BEGIN;

CREATE TABLE public._bkp_sba_rata_unica_20261105 AS
SELECT p.* FROM public.payables p
WHERE p.supplier_id = 'd1e4ac7b-507e-45d0-85f9-23391ab5e414'
  AND p.invoice_number IN ('890FV2026','965FV2026','983FV2026','1056FV2026',
                           '1067FV2026','1092FV2026','1095FV2026','1111FV2026');
ALTER TABLE public._bkp_sba_rata_unica_20261105 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public._bkp_sba_fornitore_20261105 AS
SELECT s.* FROM public.suppliers s WHERE s.id = 'd1e4ac7b-507e-45d0-85f9-23391ab5e414';
ALTER TABLE public._bkp_sba_fornitore_20261105 ENABLE ROW LEVEL SECURITY;
-- I backup restano invisibili all'API (applicato a parte come 362b).
REVOKE ALL ON public._bkp_sba_rata_unica_20261105 FROM anon, authenticated;
REVOKE ALL ON public._bkp_sba_fornitore_20261105 FROM anon, authenticated;

DO $$
DECLARE
  v_rows int;
  v_bad  int;
  r record;
  v_due date;
BEGIN
  -- Guardia: 16 righe, tutte 2 rate, nessun pagamento, nessun aggancio.
  SELECT count(*),
         count(*) FILTER (WHERE COALESCE(amount_paid,0) <> 0
                             OR status NOT IN ('da_pagare','in_scadenza','scaduto')
                             OR bank_transaction_id IS NOT NULL
                             OR cash_movement_id IS NOT NULL
                             OR installment_total <> 2)
    INTO v_rows, v_bad
  FROM public._bkp_sba_rata_unica_20261105;
  IF v_rows <> 16 OR v_bad <> 0 THEN
    RAISE EXCEPTION 'S.B.A.: attese 16 righe pulite, trovate % (di cui % non pulite)', v_rows, v_bad;
  END IF;

  FOR r IN
    SELECT b1.id AS id1, b2.id AS id2, b1.invoice_number, b1.invoice_date, b1.due_date AS old_due,
           b1.company_id,
           b1.gross_amount + b2.gross_amount AS gross,
           b1.net_amount + b2.net_amount AS net,
           b1.vat_amount + b2.vat_amount AS vat
    FROM public._bkp_sba_rata_unica_20261105 b1
    JOIN public._bkp_sba_rata_unica_20261105 b2
      ON b2.electronic_invoice_id = b1.electronic_invoice_id AND b2.installment_number = 2
    WHERE b1.installment_number = 1
  LOOP
    v_due := (date_trunc('month', r.invoice_date + 60) + interval '1 month - 1 day')::date;

    UPDATE public.payables
       SET gross_amount = r.gross, net_amount = r.net, vat_amount = r.vat,
           due_date = v_due, original_due_date = v_due,
           installment_total = 1,
           notes = COALESCE(notes || ' | ', '') || '05/11/2026: rata unica a 60 gg fine mese (Patrizio)'
     WHERE id = r.id1;

    UPDATE public.payables
       SET previous_status = status, status = 'annullato',
           notes = COALESCE(notes || ' | ', '') || '05/11/2026: annullata, la fattura si paga in una rata a 60 gg fine mese (Patrizio)'
     WHERE id = r.id2;

    INSERT INTO public.payable_actions (payable_id, action_type, old_due_date, new_due_date, amount, note, performed_at)
    VALUES (r.id1, 'ricalcolo_piano', r.old_due, v_due, r.gross,
            'S.B.A. ' || r.invoice_number || ': da 2 rate a rata unica 60 gg fine mese (Patrizio 05/11/2026)', now()),
           (r.id2, 'ricalcolo_piano', NULL, NULL, 0,
            'S.B.A. ' || r.invoice_number || ': rata 2 annullata, importo spostato sulla rata 1 (Patrizio 05/11/2026)', now());
  END LOOP;

  UPDATE public.suppliers
     SET numero_rate = 1, prima_scadenza_gg = 60, payment_base = 'fine_mese',
         payment_terms = 60, default_payment_terms = 60
   WHERE id = 'd1e4ac7b-507e-45d0-85f9-23391ab5e414';
END $$;

COMMIT;
