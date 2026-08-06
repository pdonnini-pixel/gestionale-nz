-- ════════════════════════════════════════════════════════════════════
-- DATA FIX — reclassifica i payable MP08 APERTI come addebito automatico.
-- Da eseguire sui 3 tenant (NZ/Made/Zago) DOPO la migration 133.
-- Solo backup + UPDATE, nessuna cancellazione. Idempotente.
--
-- Bersaglio: payable reali, aperti (da_pagare/in_scadenza/scaduto),
-- non pagati, rata unica, con carta MP08 (payment_method_code o XML della
-- fattura elettronica). Il pregresso già 'pagato' NON viene toccato
-- (decisione Patrizio 2026-08-06).
--
-- Effetto: payment_method_code='MP08', is_auto_debit=true,
-- payment_method='carta_credito', due_date = 20 del mese successivo
-- all'emissione. L'UPDATE fa ricalcolare lo stato (update_payable_status):
-- gli addebiti automatici non risultano mai 'scaduto'.
-- All'esecuzione: NZ 7 righe (ALTOMUGELLO/MCA/VAIMO/GRUPPO NEGOZI),
-- Made 0, Zago 0.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.payables_bkp_mp08_autodebit_20260806 AS
  SELECT * FROM public.payables WHERE false;

INSERT INTO public.payables_bkp_mp08_autodebit_20260806
SELECT p.* FROM public.payables p
LEFT JOIN public.electronic_invoices e ON e.id = p.electronic_invoice_id
WHERE COALESCE(p.is_forecast,false)=false
  AND COALESCE(p.amount_paid,0)=0
  AND p.status IN ('da_pagare','in_scadenza','scaduto')
  AND (p.payment_method_code='MP08' OR e.xml_content ~ '<ModalitaPagamento>MP08</ModalitaPagamento>')
  AND COALESCE(p.installment_total,1) <= 1
  AND p.id NOT IN (SELECT id FROM public.payables_bkp_mp08_autodebit_20260806);

UPDATE public.payables p
SET payment_method_code = 'MP08',
    is_auto_debit       = true,
    payment_method      = 'carta_credito'::payment_method,
    due_date            = (date_trunc('month', p.invoice_date) + interval '1 month' + interval '19 days')::date
WHERE p.id IN (
  SELECT p2.id FROM public.payables p2
  LEFT JOIN public.electronic_invoices e ON e.id = p2.electronic_invoice_id
  WHERE COALESCE(p2.is_forecast,false)=false
    AND COALESCE(p2.amount_paid,0)=0
    AND p2.status IN ('da_pagare','in_scadenza','scaduto')
    AND (p2.payment_method_code='MP08' OR e.xml_content ~ '<ModalitaPagamento>MP08</ModalitaPagamento>')
    AND COALESCE(p2.installment_total,1) <= 1
);
