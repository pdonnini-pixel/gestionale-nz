-- =====================================================================
-- NZ_ONLY 198 — L'Amex passato sul POS Nexi e' accreditato da MPS
-- ---------------------------------------------------------------------
-- Dal collaudo sulle chiusure reali (1-6 settembre): la voce "Amexco" della
-- chiusura del POS Nexi/MPS arriva in banca DENTRO l'accredito MPS del
-- giorno (es. Palmanova 01/09: POS 824,05 + Amex 177,55 = 1.001,60,
-- accredito MPS 992,51). Le righe "American Express" sul conto BCC sono solo
-- gli Amex del terminale Numia/BCC.
-- Il canale "POS MPS Amex" resta come colonna per la cassiera ma diventa
-- tipo pos con il codice del POS MPS: il riscontro somma i due canali e li
-- confronta con l'accredito MPS. UPDATE di 7 righe, nessuna cancellazione.
-- Solo NZ (Made e Zago non hanno canali).
-- =====================================================================
WITH mps AS (
  SELECT outlet_id, terminal_code FROM public.outlet_payment_channels WHERE label = 'POS MPS' AND kind = 'pos' AND is_active
)
UPDATE public.outlet_payment_channels ch
   SET kind = 'pos', terminal_code = mps.terminal_code, bank_tolerance_pct = 1.5, updated_at = now()
  FROM mps
 WHERE ch.outlet_id = mps.outlet_id AND ch.label = 'POS MPS Amex' AND ch.is_active;
-- Verifica: SELECT label, kind, terminal_code FROM outlet_payment_channels WHERE label = 'POS MPS Amex';
