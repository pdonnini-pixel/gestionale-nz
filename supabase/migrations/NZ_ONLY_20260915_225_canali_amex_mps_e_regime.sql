-- =====================================================================
-- NZ_ONLY 225 — I canali Amex su MPS tornano canali Amex
-- ---------------------------------------------------------------------
-- Annulla la NZ_ONLY 198, che li aveva degradati a tipo pos partendo da una
-- lettura sbagliata degli accrediti (vedi 224 e COMMISSIONI_INCASSO_NOTES.md).
-- Il codice terminale resta quello del POS MPS: e' corretto, perche' l'Amex
-- arriva proprio su quel terminale, ed e' il riscontro a distinguere la riga
-- Amex dalle altre confrontandola con il dichiarato di cassa.
--
-- Il regime di accredito arriva dai contratti censiti in acquirer_contracts:
-- nessun valore scritto a mano. Su NZ questo mette 'lordo' al POS MPS di
-- Valdichiana (Payment Contract PC0001000583: al lordo) e lascia 'netto' agli
-- altri sei, che al netto ci sono per contratto.
--
-- I canali BCC/Numia restano come sono: senza l'estratto conto Numia non ho
-- la prova del loro regime, e non si cambia cio' che non si e' verificato.
--
-- Solo UPDATE, nessuna cancellazione.
-- =====================================================================

UPDATE public.outlet_payment_channels
   SET kind = 'pos_amex', settlement_mode = 'lordo', bank_tolerance_pct = 0, updated_at = now()
 WHERE label = 'POS MPS Amex' AND is_active AND kind <> 'pos_amex';

UPDATE public.outlet_payment_channels ch
   SET settlement_mode = c.settlement_mode, updated_at = now()
  FROM public.acquirer_contracts c
 WHERE c.company_id = ch.company_id
   AND c.acquirer = 'nexi'
   AND c.outlet_id = ch.outlet_id
   AND c.is_active
   AND ch.kind = 'pos'
   AND public.cash_bank_norm_code(c.terminal_code) = public.cash_bank_norm_code(ch.terminal_code)
   AND ch.settlement_mode IS DISTINCT FROM c.settlement_mode;

-- Verifica: SELECT label, kind, terminal_code, settlement_mode, bank_tolerance_pct
--             FROM outlet_payment_channels WHERE is_active ORDER BY label, terminal_code;
