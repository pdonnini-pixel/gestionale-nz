-- =====================================================================
-- NZ_ONLY 388 — Roma Soratte: codice Amex e pay by link sul POS
-- ---------------------------------------------------------------------
-- Dalla mail di Sabrina (amministrazione New Zago) del 10/11/2026 con i
-- dati dei POS di Roma Soratte. I due POS fisici (Numia 84571014 sul
-- terminale 00015, Nexi 83376266 sul terminale 00016) erano gia' nei
-- canali di incasso. Mancavano due cose:
--
-- 1. Il convenzionamento Amex (codice esercente 6830043717) fra i
--    contratti di acquiring: senza, il primo estratto Amex con Roma non
--    viene attribuito al negozio in «Commissioni incasso».
--    Regime «lordo» come tutti gli Amex (COMMISSIONI_INCASSO_NOTES.md).
--    terminal_code resta NULL: la mail da' un solo codice per il negozio
--    e non dice quale terminale governa (stesso caso di Valdichiana).
--    sdd_mandate resta NULL: si legge dal primo addebito in banca.
--
-- 2. Il canale «Pay by link» di Roma era rimasto kind = paybylink senza
--    terminale, perche' il negozio e' nato (220) il giorno prima della
--    226, che ha portato il pay by link sul POS MPS negli altri negozi.
--    Stesso trattamento: kind = pos, terminale e conto del «POS MPS».
--    Le 5 chiusure di Roma (05-09/11) hanno pay by link a 0,00: nessun
--    numero cambia.
--
-- NO DATA LOSS: un INSERT e un UPDATE di una riga di configurazione.
-- Solo NZ (Made e Zago non hanno canali ne' contratti di acquiring).
-- =====================================================================

BEGIN;

INSERT INTO public.acquirer_contracts
  (company_id, outlet_id, acquirer, merchant_code, settlement_mode, label, note)
SELECT o.company_id, o.id, 'amex', '6830043717', 'lordo', 'Vicolo Roma Soratte',
       '10/11/2026: codice MID dalla mail di Sabrina con i dati dei POS di Roma. Mandato SDD e terminale da completare al primo estratto Amex.'
  FROM public.outlets o
 WHERE o.code = 'RSO'
ON CONFLICT (company_id, acquirer, merchant_code) DO NOTHING;

UPDATE public.outlet_payment_channels c
   SET kind = 'pos', terminal_code = mps.terminal_code,
       bank_account_id = COALESCE(c.bank_account_id, mps.bank_account_id),
       bank_tolerance_pct = 1.5, updated_at = now()
  FROM public.outlets o, public.outlet_payment_channels mps
 WHERE o.code = 'RSO'
   AND c.outlet_id = o.id AND c.label = 'Pay by link' AND c.kind = 'paybylink' AND c.is_active
   AND mps.outlet_id = o.id AND mps.label = 'POS MPS' AND mps.is_active
   AND mps.terminal_code IS NOT NULL;

COMMIT;

-- Verifica:
-- SELECT o.name, ch.label, ch.kind, ch.terminal_code, ch.bank_tolerance_pct
--   FROM outlet_payment_channels ch JOIN outlets o ON o.id = ch.outlet_id
--  WHERE ch.label = 'Pay by link' ORDER BY o.name;
-- SELECT o.name, a.acquirer, a.merchant_code, a.settlement_mode
--   FROM acquirer_contracts a JOIN outlets o ON o.id = a.outlet_id WHERE o.code = 'RSO';
