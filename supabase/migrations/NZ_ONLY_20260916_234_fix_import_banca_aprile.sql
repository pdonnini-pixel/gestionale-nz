-- NZ_ONLY — 2026-09-16 — Correzione dei due difetti di importazione bancaria di aprile 2026.
--
-- CONTESTO
-- L'estratto conto MPS di aprile 2026 (01/04-04/05, 473 entrate per 467.384,05 euro) e' stato
-- confrontato importo per importo con bank_transactions. Mancano due movimenti soli, e sono
-- i due versamenti in cassa continua che da maggio risultavano "dichiarati e mai arrivati":
--
--   Palmanova     1.995,00  versato il 28-04-26, DATA PR 29-04-26, contabile 04/05
--   Valdichiana   2.875,25  versato il 29-04-26, DATA PR 29-04-26, contabile 04/05
--
-- Causa: una cucitura fra due import. Maggio e' stato caricato il 21/05, aprile in backfill il
-- 15/06. Questi due movimenti hanno valuta in aprile e data contabile in maggio, quindi la corsa
-- di maggio li ha esclusi per valuta e quella di aprile per data contabile. Nessuna li ha visti.
--
-- Lo stesso difetto, sull'altro conto, ha prodotto l'effetto opposto: su BCC Valdarno i movimenti
-- con valuta e data contabile in giorni diversi sono entrati DUE volte, una per ciascuna data.
-- Sono 22 righe, tutte in uscita, per 3.487,64 euro, fra il 19/03 e il 30/04. Sulle entrate zero
-- duplicati, quindi POS e versamenti (cioe' tutto cio' che alimenta le chiusure di cassa) sono
-- sempre stati puliti.
--
-- COSA FA QUESTA MIGRATION
--   1. copia le 22 righe duplicate in una tabella di backup, prima di toccarle
--   2. travasa categoria e nota sul gemello che resta, dove il gemello ne e' privo
--   3. cancella le 22 righe in piu' (si tiene sempre quella con la data contabile vera,
--      cioe' la transaction_date piu' alta del gruppo)
--   4. inserisce i due versamenti mancanti, con la stessa forma che ha il flusso A-Cube
--
-- NESSUN VALORE HARDCODED: conto e azienda si ricavano dai dati vivi.
-- Il riscontro (match_cash_closings_with_bank) va rilanciato dopo, separatamente.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Backup delle righe duplicate
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_transactions_bkp_20260916_dupes
  (LIKE public.bank_transactions INCLUDING DEFAULTS);

WITH g AS (
  SELECT bank_account_id, amount, description, value_date,
         max(transaction_date) AS keep_date
  FROM public.bank_transactions
  WHERE transaction_date >= '2026-01-01'
  GROUP BY 1,2,3,4
  HAVING count(*) > 1 AND count(DISTINCT transaction_date) > 1
)
INSERT INTO public.bank_transactions_bkp_20260916_dupes
SELECT t.*
FROM public.bank_transactions t
JOIN g ON g.bank_account_id = t.bank_account_id
      AND g.amount = t.amount
      AND g.description = t.description
      AND g.value_date IS NOT DISTINCT FROM t.value_date
WHERE t.transaction_date >= '2026-01-01'
  AND t.transaction_date < g.keep_date;

-- ---------------------------------------------------------------------------
-- 2. Categoria e nota non si perdono: passano al gemello che resta
-- ---------------------------------------------------------------------------
WITH g AS (
  SELECT bank_account_id, amount, description, value_date,
         max(transaction_date) AS keep_date
  FROM public.bank_transactions
  WHERE transaction_date >= '2026-01-01'
  GROUP BY 1,2,3,4
  HAVING count(*) > 1 AND count(DISTINCT transaction_date) > 1
),
fonte AS (
  SELECT DISTINCT ON (t.bank_account_id, t.amount, t.description, t.value_date)
         t.bank_account_id, t.amount, t.description, t.value_date, g.keep_date,
         t.category, t.note
  FROM public.bank_transactions t
  JOIN g ON g.bank_account_id = t.bank_account_id
        AND g.amount = t.amount
        AND g.description = t.description
        AND g.value_date IS NOT DISTINCT FROM t.value_date
  WHERE t.transaction_date >= '2026-01-01'
    AND t.transaction_date < g.keep_date
    AND (t.category IS NOT NULL OR t.note IS NOT NULL)
  ORDER BY t.bank_account_id, t.amount, t.description, t.value_date, t.transaction_date
)
UPDATE public.bank_transactions k
   SET category = COALESCE(k.category, f.category),
       note     = COALESCE(k.note, f.note)
  FROM fonte f
 WHERE k.bank_account_id = f.bank_account_id
   AND k.amount = f.amount
   AND k.description = f.description
   AND k.value_date IS NOT DISTINCT FROM f.value_date
   AND k.transaction_date = f.keep_date
   AND (k.category IS NULL OR k.note IS NULL);

-- ---------------------------------------------------------------------------
-- 3. Via le 22 righe in piu' (il backup del punto 1 e' gia' fatto)
-- ---------------------------------------------------------------------------
DELETE FROM public.bank_transactions t
 USING (
   SELECT bank_account_id, amount, description, value_date,
          max(transaction_date) AS keep_date
   FROM public.bank_transactions
   WHERE transaction_date >= '2026-01-01'
   GROUP BY 1,2,3,4
   HAVING count(*) > 1 AND count(DISTINCT transaction_date) > 1
 ) g
 WHERE t.bank_account_id = g.bank_account_id
   AND t.amount = g.amount
   AND t.description = g.description
   AND t.value_date IS NOT DISTINCT FROM g.value_date
   AND t.transaction_date >= '2026-01-01'
   AND t.transaction_date < g.keep_date;

-- ---------------------------------------------------------------------------
-- 4. I due versamenti che l'import non ha mai visto
--    transaction_date = DATA PR, com'e' per tutti gli altri VERS. GDO del flusso
-- ---------------------------------------------------------------------------
WITH conto AS (
  SELECT ba.id AS bank_account_id, ba.company_id
  FROM public.bank_accounts ba
  WHERE lower(coalesce(ba.bank_name, '')) LIKE '%mps%'
     OR lower(coalesce(ba.bank_name, '')) LIKE '%monte dei paschi%'
  ORDER BY ba.created_at
  LIMIT 1
),
nuovi(amount, descr) AS (
  VALUES
    (1995.00::numeric,
     'Causale: VERS. CONTANTI C. CONTINU - Descrizione: VERS. GDO DATA PR: 29-04-26 DATA DT: 28-04-26 VICOLO NEW ZAGO SRL CC PALMANOVA PALMANOVA COD.:XXX V 1.995,00D 1.995,00DI 0,0'),
    (2875.25::numeric,
     'Causale: VERS. CONTANTI C. CONTINU - Descrizione: VERS. GDO DATA PR: 29-04-26 DATA DT: 29-04-26 VICOLO NEW ZAGO CC FOIANO DELLA CHIANA FOIANO DELLA CHIANA COD.:XXX V 2.875,25D 2.875,25DI 0,0')
)
INSERT INTO public.bank_transactions
  (company_id, bank_account_id, transaction_date, value_date, amount, currency,
   status, source, category, is_reconciled, description, note)
SELECT c.company_id, c.bank_account_id,
       DATE '2026-04-29', DATE '2026-04-29',
       n.amount, 'EUR', 'posted', 'estratto_conto', 'versamenti', false, n.descr,
       'inserito il 16/09/2026 dall''estratto conto MPS di aprile 2026 (contabile 04/05, valuta 29/04): il movimento era sfuggito a entrambe le corse di importazione, quella di aprile e quella di maggio'
FROM conto c, nuovi n
WHERE NOT EXISTS (
  SELECT 1 FROM public.bank_transactions x
   WHERE x.bank_account_id = c.bank_account_id
     AND x.amount = n.amount
     AND x.transaction_date BETWEEN DATE '2026-04-20' AND DATE '2026-05-10'
);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFICHE
--
-- a) i due versamenti ci sono e sono uno per parte
--    SELECT transaction_date, amount, left(description, 60) FROM public.bank_transactions
--     WHERE amount IN (1995.00, 2875.25) ORDER BY 1;
--    atteso: 2 righe, entrambe 2026-04-29
--
-- b) niente piu' duplicati da cucitura
--    SELECT count(*) FROM (
--      SELECT 1 FROM public.bank_transactions WHERE transaction_date >= '2026-01-01'
--       GROUP BY bank_account_id, amount, description, value_date
--      HAVING count(*) > 1 AND count(DISTINCT transaction_date) > 1) t;
--    atteso: 0
--
-- c) il backup contiene quello che e' stato tolto
--    SELECT count(*), round(sum(amount)::numeric, 2)
--      FROM public.bank_transactions_bkp_20260916_dupes;
--    atteso: 22 righe, -3487.64
--
-- d) dopo aver rilanciato il riscontro, le due chiusure del 28/04
--    SELECT o.name, c.closing_date, c.deposit_bank_status
--      FROM public.outlet_daily_closings c JOIN public.outlets o ON o.id = c.outlet_id
--     WHERE c.closing_date = '2026-04-28' AND c.cash_deposit IN (1995.00, 2875.25);
--    atteso: deposit_bank_status = 'trovato' (non piu' 'mancante')
-- ---------------------------------------------------------------------------
