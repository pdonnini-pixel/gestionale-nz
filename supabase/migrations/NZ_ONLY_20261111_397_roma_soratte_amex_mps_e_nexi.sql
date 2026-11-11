-- =====================================================================
-- NZ_ONLY 397 — Roma Soratte: secondo codice Amex (MPS) e contratto Nexi
-- ---------------------------------------------------------------------
-- Dalle risposte di Sabrina (amministrazione New Zago) dell'11/11/2026:
--
-- 1. «Ne esiste anche un secondo Amex MPS come per Torino»: codice
--    7373035252, comunicato dalla banca. Regime «lordo» come tutti gli
--    Amex; terminale 00016 (il POS MPS di Roma). Riscontro sui dati:
--    Amex del 07/11 dichiarato 162,07, accreditato da MPS 162,07.
--
-- 2. Punto vendita Nexi LN0006099923, letto dal portale Nexi. Il numero
--    di contratto (PC...) e il mandato SDD non ci sono ancora: il primo
--    estratto conto non e' disponibile. Regime «netto», misurato sugli
--    accrediti MPS del terminale 00016: 05/11 dichiarato 548,26 e
--    accreditato 544,56; 06/11 1.221,21 e 1.212,31; 09/11 1.783,50 e
--    1.771,39 (circa 0,7% trattenuto alla fonte).
--
-- Il codice Amex 6830043717 (388) resta senza terminale: Sabrina non ha
-- scritto a quale POS appartiene.
--
-- NO DATA LOSS: due INSERT di configurazione. Solo NZ.
-- =====================================================================

BEGIN;

INSERT INTO public.acquirer_contracts
  (company_id, outlet_id, acquirer, merchant_code, settlement_mode, terminal_code, label, note)
SELECT o.company_id, o.id, v.acquirer, v.merchant_code, v.settlement_mode, mps.terminal_code, v.label, v.note
  FROM public.outlets o
  JOIN public.outlet_payment_channels mps
    ON mps.outlet_id = o.id AND mps.label = 'POS MPS' AND mps.is_active
 CROSS JOIN (VALUES
   ('amex', '7373035252',   'lordo', 'Vicolo Roma Soratte (MPS)',
    '11/11/2026: secondo codice Amex, quello del POS MPS, dalla mail di Sabrina. Mandato SDD da completare al primo estratto Amex.'),
   ('nexi', 'LN0006099923', 'netto', 'Nexi RSO',
    '11/11/2026: punto vendita letto da Sabrina sul portale Nexi. Payment Contract (PC...) e mandato SDD da completare al primo estratto conto. Regime netto misurato sugli accrediti del 05-09/11.')
 ) AS v(acquirer, merchant_code, settlement_mode, label, note)
 WHERE o.code = 'RSO'
ON CONFLICT (company_id, acquirer, merchant_code) DO NOTHING;

COMMIT;

-- Verifica:
-- SELECT a.acquirer, a.merchant_code, a.terminal_code, a.settlement_mode, a.is_active
--   FROM acquirer_contracts a JOIN outlets o ON o.id = a.outlet_id WHERE o.code = 'RSO';
