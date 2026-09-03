-- =============================================================================
-- NZ_ONLY — WOLF GROUP: le scadenze aperte seguono il piano della scheda fornitore
-- Applicato su NZ il 03/09/2026. WOLF GROUP esiste solo su NZ (0 righe su Made e
-- Zago, verificato): niente da replicare, la parita' tenant resta rispettata.
-- =============================================================================
--
-- IL PROBLEMA. La scheda WOLF GROUP dice bonifico ordinario, 60/90 gg DFFM su 2
-- rate (payment_base='fine_mese', prima_scadenza_gg=60, numero_rate=2). Nessuna
-- delle tre fatture aperte seguiva quel piano: erano tutte a rata unica alla data
-- della fattura, quindi due risultavano scadute e la terza, gia' pagata in parte,
-- restava appesa al 30/06.
--
--   fattura  data      importo     scadenza prima   stato prima
--   218      31/05     79.683,24   30/06            parziale (39.683,24 versati)
--   285      30/06     19.941,75   30/06            scaduto
--   357      29/07     34.056,67   29/07            scaduto
--
-- PERCHE'. Il bridge A-Cube genera le rate dal piano fornitore solo per le fatture
-- emesse dal 31/07/2026 (guardia forward-only della migration 089): tutte e tre
-- sono precedenti, quindi sono nate a rata unica alla data fattura.
--
-- COSA SI SCRIVE (date e importi calcolati da fn_supplier_installment_schedule,
-- la stessa funzione che usa il bridge: nessun valore inventato a mano).
--
--   218 -> resta UNA riga. L'acconto e' gia' uscito dal conto ed e' agganciato a
--          un movimento bancario: importi e riconciliazione NON si toccano. Si
--          sposta solo la scadenza dal 30/06 al 31/08/2026, che e' la rata del
--          piano che copre il residuo di 40.000,00, e si marca rata 2/2 (la
--          rata 1 e' quella assorbita dall'acconto del 06/08).
--   285 -> 2 rate: 9.970,88 al 31/08 (riga esistente) + 9.970,87 al 30/09 (nuova).
--   357 -> 2 rate: 17.028,34 al 30/09 (riga esistente) + 17.028,33 al 31/10 (nuova).
--
-- Nessun importo di fattura cambia: la somma delle rate coincide al centesimo con
-- il lordo. Nessuna riga viene cancellata. Le note di credito (30, 68, 92) non
-- vengono toccate. Backup completo delle righe prima della modifica in
-- public._bkp_wolf_piano_20260903 -> rollback nel file _ROLLBACK.
-- =============================================================================

BEGIN;

-- 0) Backup delle righe toccate (tutte le colonne, prima di qualsiasi modifica)
CREATE TABLE IF NOT EXISTS public._bkp_wolf_piano_20260903 AS
SELECT p.*
FROM public.payables p
JOIN public.suppliers s ON s.id = p.supplier_id
WHERE s.partita_iva = '06847270482'
  AND p.invoice_number IN ('218', '285', '357');

-- 1) Fattura 218 (parziale): solo la data, dal 30/06 al 31/08 del piano 60/90 DFFM.
--    Importi, amount_paid, bank_transaction_id e NC compensate restano intatti.
WITH saldo AS (
  -- ultima rata del piano = quella che copre il residuo ancora aperto
  SELECT p.id, sched.due_date
  FROM public.payables p
  JOIN public.suppliers s ON s.id = p.supplier_id
  CROSS JOIN LATERAL public.fn_supplier_installment_schedule(
    p.invoice_date, s.payment_base, s.prima_scadenza_gg, s.numero_rate, p.gross_amount
  ) sched
  WHERE s.partita_iva = '06847270482'
    AND p.invoice_number = '218'
    AND p.status = 'parziale'
    AND sched.rata = s.numero_rate
)
UPDATE public.payables p
SET due_date          = saldo.due_date,
    original_due_date = saldo.due_date,
    installment_number = 2,
    installment_total  = 2,
    notes = COALESCE(p.notes || ' | ', '')
            || 'Scadenza allineata al piano fornitore 60/90 gg DFFM (03/09/2026): '
            || 'rata 1 assorbita dall''acconto del 06/08, questa riga e'' il saldo al 31/08. '
            || 'Importo pieno della fattura, residuo 40.000,00.'
FROM saldo
WHERE saldo.id = p.id;

-- 2) Fatture 285 e 357 (aperte, zero pagato, nessun movimento agganciato):
--    la riga esistente diventa la rata 1 del piano...
WITH rata1 AS (
  SELECT p.id, sched.due_date, sched.importo, s.numero_rate
  FROM public.payables p
  JOIN public.suppliers s ON s.id = p.supplier_id
  CROSS JOIN LATERAL public.fn_supplier_installment_schedule(
    p.invoice_date, s.payment_base, s.prima_scadenza_gg, s.numero_rate, p.gross_amount
  ) sched
  WHERE s.partita_iva = '06847270482'
    AND p.invoice_number IN ('285', '357')
    AND COALESCE(p.amount_paid, 0) = 0
    AND p.bank_transaction_id IS NULL
    AND p.gross_amount > 0
    AND sched.rata = 1
)
UPDATE public.payables p
SET due_date          = rata1.due_date,
    original_due_date = rata1.due_date,
    gross_amount      = rata1.importo,
    installment_number = 1,
    installment_total  = rata1.numero_rate,
    notes = COALESCE(p.notes || ' | ', '')
            || 'Rata 1 del piano fornitore 60/90 gg DFFM (allineata il 03/09/2026).'
FROM rata1
WHERE rata1.id = p.id;

-- 3) ...e le rate successive nascono come righe nuove. Niente acube_uuid (e' unico
--    e resta sulla rata 1), niente movimento bancario: sono scadenze da pagare.
INSERT INTO public.payables (
  id, company_id, supplier_id, outlet_id, invoice_number, invoice_date, due_date,
  gross_amount, status, payment_method, payment_method_code, payment_bank_account_id,
  cost_category_id, electronic_invoice_id, supplier_name, supplier_vat,
  installment_number, installment_total, notes, created_at
)
SELECT gen_random_uuid(), p.company_id, p.supplier_id, p.outlet_id, p.invoice_number,
       p.invoice_date, sched.due_date, sched.importo, 'da_pagare'::payable_status,
       p.payment_method, p.payment_method_code, p.payment_bank_account_id,
       p.cost_category_id, p.electronic_invoice_id, p.supplier_name, p.supplier_vat,
       sched.rata, s.numero_rate,
       'Rata ' || sched.rata || ' del piano fornitore 60/90 gg DFFM (generata il 03/09/2026).',
       now()
FROM public.payables p
JOIN public.suppliers s ON s.id = p.supplier_id
CROSS JOIN LATERAL public.fn_supplier_installment_schedule(
  p.invoice_date, s.payment_base, s.prima_scadenza_gg, s.numero_rate,
  (SELECT b.gross_amount FROM public._bkp_wolf_piano_20260903 b WHERE b.id = p.id)
) sched
WHERE s.partita_iva = '06847270482'
  AND p.invoice_number IN ('285', '357')
  AND p.installment_number = 1
  AND sched.rata > 1
ON CONFLICT DO NOTHING;

COMMIT;

-- =============================================================================
-- VERIFICA (attesa: 218 una riga parziale al 31/08; 285 -> 31/08 + 30/09;
--           357 -> 30/09 + 31/10; somma rate = lordo fattura al centesimo)
-- =============================================================================
-- SELECT p.invoice_number, p.installment_number, p.installment_total, p.due_date,
--        p.gross_amount, p.amount_paid, p.amount_remaining, p.status
-- FROM public.payables p JOIN public.suppliers s ON s.id = p.supplier_id
-- WHERE s.partita_iva = '06847270482'
-- ORDER BY p.invoice_date, p.invoice_number, p.installment_number;
