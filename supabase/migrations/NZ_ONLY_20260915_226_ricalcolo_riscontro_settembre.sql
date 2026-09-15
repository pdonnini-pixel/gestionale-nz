-- =====================================================================
-- NZ_ONLY 226 — Ricalcolo del riscontro cassa/banca di settembre 2026
-- ---------------------------------------------------------------------
-- La 224 e la 225 correggono la logica, ma i match gia' scritti restano
-- quelli vecchi: 235 abbinamenti POS/Amex di settembre nati dalla regola
-- sbagliata, fra cui 54 righe finite sul canale «POS MPS Amex» per
-- 31.326,03 euro (dichiarato di quel canale: 5.300,20).
--
-- Qui si cancellano quei match e si rifa' il riscontro con la funzione
-- nuova. Autorizzato da Patrizio il 15/09/2026 («si procedi con il
-- ricalcolo di settembre»).
--
-- PRIMA di toccare qualsiasi cosa: quattro tabelle di backup con lo stato
-- esatto di partenza (match, righe di chiusura, chiusure, movimenti), piu'
-- i CSV in docs/backup/20260915_*. Il rollback a fianco rimette tutto.
--
-- Fuori portata: i match di tipo 'versamento' (contanti) e tutto cio' che
-- e' precedente al 01/09. Nessun importo di cassa o di banca viene toccato.
-- Solo NZ: Made e Zago non hanno chiusure di cassa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Backup dello stato di partenza
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._bkp_riscontro_sett_matches_20260915 AS
  SELECT m.*
    FROM public.closing_bank_matches m
    JOIN public.outlet_daily_closings c ON c.id = m.closing_id
   WHERE c.closing_date >= DATE '2026-09-01' AND m.match_type IN ('pos', 'amex');

CREATE TABLE IF NOT EXISTS public._bkp_riscontro_sett_lines_20260915 AS
  SELECT l.id, l.closing_id, l.channel_id, l.amount, l.bank_amount, l.bank_status, l.bank_matched_at
    FROM public.outlet_daily_closing_lines l
    JOIN public.outlet_daily_closings c ON c.id = l.closing_id
   WHERE c.closing_date >= DATE '2026-07-01';

CREATE TABLE IF NOT EXISTS public._bkp_riscontro_sett_closings_20260915 AS
  SELECT id, status, bank_verified_at
    FROM public.outlet_daily_closings
   WHERE closing_date >= DATE '2026-09-01';

CREATE TABLE IF NOT EXISTS public._bkp_riscontro_sett_bt_20260915 AS
  SELECT bt.id, bt.is_reconciled, bt.reconciled_at, bt.category, bt.note
    FROM public.bank_transactions bt
   WHERE bt.id IN (SELECT bank_transaction_id FROM public._bkp_riscontro_sett_matches_20260915);

-- Tabelle di servizio: nessuno le legge dall'app.
ALTER TABLE public._bkp_riscontro_sett_matches_20260915  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_riscontro_sett_lines_20260915    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_riscontro_sett_closings_20260915 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_riscontro_sett_bt_20260915       ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 2. Via i match sbagliati, e i movimenti tornano liberi
-- ---------------------------------------------------------------------
WITH del AS (
  DELETE FROM public.closing_bank_matches m
   USING public.outlet_daily_closings c
   WHERE c.id = m.closing_id
     AND c.closing_date >= DATE '2026-09-01'
     AND m.match_type IN ('pos', 'amex')
  RETURNING m.bank_transaction_id AS bt_id
)
UPDATE public.bank_transactions bt
   SET is_reconciled = false, reconciled_at = NULL
 WHERE bt.id IN (SELECT bt_id FROM del);

-- ---------------------------------------------------------------------
-- 3. Le righe di chiusura tornano in attesa di riscontro
-- ---------------------------------------------------------------------
UPDATE public.outlet_daily_closing_lines l
   SET bank_amount = NULL, bank_status = 'in_attesa', bank_matched_at = NULL
  FROM public.outlet_daily_closings c, public.outlet_payment_channels ch
 WHERE c.id = l.closing_id AND ch.id = l.channel_id
   AND c.closing_date >= DATE '2026-09-01'
   AND ch.kind IN ('pos', 'pos_amex');

-- Le chiusure erano state promosse a «verificata» dalla funzione stessa
-- (bank_verified_at valorizzato) sulla base di quei numeri: tornano
-- «confermata» e sara' il nuovo riscontro a ripromuovere quelle che tornano.
UPDATE public.outlet_daily_closings
   SET status = 'confermata', bank_verified_at = NULL
 WHERE closing_date >= DATE '2026-09-01'
   AND status = 'verificata'
   AND bank_verified_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Si rifa' il riscontro con la logica della 224
-- ---------------------------------------------------------------------
SELECT public.match_cash_closings_with_bank(NULL, 20, 0.01);

-- Verifica:
--   SELECT ch.label, count(*), round(sum(l.amount),2) AS dichiarato,
--          round(sum(l.bank_amount),2) AS accreditato
--     FROM outlet_daily_closing_lines l
--     JOIN outlet_daily_closings c ON c.id = l.closing_id
--     JOIN outlet_payment_channels ch ON ch.id = l.channel_id
--    WHERE c.closing_date >= DATE '2026-09-01' AND ch.kind IN ('pos','pos_amex')
--    GROUP BY 1 ORDER BY 1;
