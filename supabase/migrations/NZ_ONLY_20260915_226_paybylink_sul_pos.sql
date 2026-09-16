-- =====================================================================
-- NZ_ONLY 226 — Il pay by link passa dal POS, e ora lo dichiara
-- ---------------------------------------------------------------------
-- Dalla ricostruzione di luglio e agosto: l'incasso «pay by link» non ha
-- un accredito suo, arriva in banca DENTRO l'accredito del POS del giorno.
-- Sette casi, tutti verificati sull'estratto conto:
--
--   VALDICHIANA 07/07  dich. POS 2.174,20 + pbl 48,00   = accredito 2.222,20 (esatto)
--   VALDICHIANA 15/07  dich. POS 1.999,20 + pbl 60,10   = accredito 2.059,30 (esatto)
--   TORINO      25/07  dich. POS 2.639,90 + pbl 53,00   -> accredito 2.675,18 (0,66% commissioni)
--   TORINO      27/07  dich. POS 1.383,70 + pbl 41,80   -> accredito 1.415,12 (0,73%)
--   TORINO      13/08  dich. POS   736,05 + pbl 56,40   -> accredito   786,68 (0,73%)
--   VALMONTONE  12/08  dich. POS 1.306,22 + pbl 202,90  -> accredito 1.497,90 (0,74%)
--   FRANCIACORTA 28/08 pbl 64,64 -> accredito 64,64 sul terminale BCC 00006 (esatto)
--
-- Franciacorta e' l'eccezione: il suo pay by link passa dal terminale BCC,
-- non dal MPS. Barberino, Brugnato e Palmanova non hanno avuto pay by link
-- nei tre mesi ricostruiti: prendono il POS MPS come standard, e se un
-- domani passasse dal BCC il riscontro lo direbbe subito con una differenza.
--
-- Il canale resta una colonna a se' per la cassiera (label «Pay by link»),
-- ma diventa kind = pos con il codice terminale: il riscontro somma i
-- canali dello stesso terminale e li confronta con l'accredito.
-- Stesso trattamento della migration 198 per «POS MPS Amex».
--
-- EFFETTO MISURATO dopo l'applicazione e il rilancio del riscontro:
--   luglio  righe POS in differenza da 6 a 2
--   agosto  righe POS in differenza da 8 a 6
-- Le differenze rimaste sono commissioni oltre la tolleranza dell'1,5% su
-- importi minimi, piu' due giornate di Torino dove l'Amex risulta contato
-- due volte nello specchietto.
--
-- Effetto collaterale voluto: in daily_revenue il pay by link passa da
-- «altro» a «carte», che e' quello che e'. I corrispettivi non cambiano.
--
-- NO DATA LOSS: UPDATE di 7 righe di configurazione, nessuna cancellazione.
-- Applicata su NZ il 15/09/2026. Solo NZ (Made e Zago non hanno canali).
-- =====================================================================

BEGIN;

WITH sorgente AS (
  SELECT pbl.id AS pbl_id, pbl.outlet_id,
         CASE WHEN o.name = 'FRANCIACORTA' THEN 'POS BCC' ELSE 'POS MPS' END AS origine
    FROM public.outlet_payment_channels pbl
    JOIN public.outlets o ON o.id = pbl.outlet_id
   WHERE pbl.kind = 'paybylink' AND pbl.is_active
), t AS (
  SELECT s.pbl_id, ch.terminal_code, ch.bank_account_id
    FROM sorgente s
    JOIN public.outlet_payment_channels ch
      ON ch.outlet_id = s.outlet_id AND ch.label = s.origine AND ch.is_active
   WHERE ch.terminal_code IS NOT NULL
)
UPDATE public.outlet_payment_channels c
   SET kind = 'pos', terminal_code = t.terminal_code,
       bank_account_id = COALESCE(c.bank_account_id, t.bank_account_id),
       bank_tolerance_pct = 1.5, updated_at = now()
  FROM t WHERE c.id = t.pbl_id;

COMMIT;

-- Dopo l'applicazione: rilanciare il riscontro e riproiettare i mesi ricostruiti
-- SELECT public.match_cash_closings_with_bank((SELECT id FROM companies LIMIT 1), 80, 0.01);
-- SELECT count(*) FROM (SELECT public.project_cash_closing_to_daily_revenue(c.id)
--   FROM outlet_daily_closings c WHERE c.closing_date >= '2026-07-01') t;

-- Verifica: SELECT o.name, ch.label, ch.kind, ch.terminal_code, ch.bank_tolerance_pct
--             FROM outlet_payment_channels ch JOIN outlets o ON o.id = ch.outlet_id
--            WHERE ch.label = 'Pay by link' ORDER BY o.name;
