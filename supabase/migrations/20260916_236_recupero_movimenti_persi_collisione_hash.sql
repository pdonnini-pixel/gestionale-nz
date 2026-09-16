-- 2026-09-16 — Recupero dei movimenti scaricati da A-Cube e mai arrivati in bank_transactions
-- per collisione dell'hash di deduplica.
--
-- IL DIFETTO
-- L'hash che protegge bank_transactions dai doppioni e' costruito su
--   (conto, data, importo, PRIMI 40 CARATTERI della descrizione).
-- Quaranta caratteri non bastano a distinguere due movimenti veri: negli accrediti POS di MPS
-- la descrizione comincia con "Causale: INCASSO TRAMITE P.O.S. - Descriz..." e il codice del
-- terminale compare solo oltre il sessantesimo carattere. Due negozi che incassano la stessa
-- cifra lo stesso giorno producono percio' la stessa chiave, e il secondo movimento urta
-- l'indice UNIQUE e viene scartato come se fosse un doppione.
--
-- Il cron RPC ha smesso di sbagliare con la migration 098 (23/07/2026), che ha aggiunto il
-- numero d'occorrenza (bank_tx_canonical_hash_occ). L'edge function acube-ob-tx-sync no: viene
-- corretta nello stesso commit di questa migration.
--
-- COSA RECUPERA
-- Solo i movimenti che stanno in acube_transactions (cioe' che A-Cube aveva davvero scaricato)
-- e che in bank_transactions non sono mai arrivati. Gruppo per gruppo si inserisce esattamente
-- il numero di righe che mancano, scegliendo quelle il cui acube_transaction_id non e' gia'
-- presente. Nessun replay cieco: le righe gia' importate non vengono toccate.
--
-- Su NZ sono cinque addebiti SEPA da 4,50 euro del 07/05/2026 (22,50 in tutto). Il sesto della
-- serie era passato. L'accredito POS da 79,33 del 04/05, perso allo stesso modo, era gia' stato
-- reinserito dall'estratto conto con la migration NZ_ONLY 235.
-- Sugli altri tenant recupera quello che trova, e se non trova niente non fa niente.
--
-- NESSUN VALORE HARDCODED: conti e aziende si ricavano dai dati.

BEGIN;

-- Il legame fra l'account A-Cube e il conto in anagrafica. Serve anche il legame storico:
-- quando un consenso viene rinnovato A-Cube assegna un uuid nuovo al conto, e i movimenti
-- vecchi in staging restano con quello vecchio. Lo si ritrova dentro raw_data dei movimenti
-- gia' importati.
CREATE TEMP TABLE _mappa_conti ON COMMIT DROP AS
WITH candidati AS (
  SELECT ba.acube_account_uuid AS uuid, ba.id AS bank_account_id, ba.company_id, 2 AS priorita
  FROM public.bank_accounts ba
  WHERE ba.acube_account_uuid IS NOT NULL
  UNION ALL
  SELECT (bt.raw_data->'account'->>'uuid')::uuid, bt.bank_account_id, bt.company_id, 1
  FROM public.bank_transactions bt
  WHERE bt.raw_data ? 'account'
    AND bt.raw_data->'account'->>'uuid' ~ '^[0-9a-fA-F-]{36}$'
)
SELECT DISTINCT ON (uuid) uuid, bank_account_id, company_id
FROM candidati
ORDER BY uuid, priorita DESC, bank_account_id;

-- Quante righe mancano, gruppo per gruppo.
CREATE TEMP TABLE _mancanti ON COMMIT DROP AS
WITH acu AS (
  SELECT m.bank_account_id, m.company_id, at.made_on::date AS d, at.amount,
         LEFT(COALESCE(at.description, ''), 40) AS d40, count(*) AS n_acube
  FROM public.acube_transactions at
  JOIN _mappa_conti m ON m.uuid = at.acube_account_uuid
  GROUP BY 1, 2, 3, 4, 5
),
bt AS (
  SELECT bank_account_id, transaction_date AS d, amount,
         LEFT(COALESCE(description, ''), 40) AS d40, count(*) AS n_bank
  FROM public.bank_transactions
  GROUP BY 1, 2, 3, 4
)
SELECT acu.bank_account_id, acu.company_id, acu.d, acu.amount, acu.d40,
       acu.n_acube, COALESCE(bt.n_bank, 0) AS n_bank,
       acu.n_acube - COALESCE(bt.n_bank, 0) AS deficit
FROM acu
LEFT JOIN bt ON bt.bank_account_id = acu.bank_account_id AND bt.d = acu.d
            AND bt.amount = acu.amount AND bt.d40 = acu.d40
WHERE acu.n_acube > COALESCE(bt.n_bank, 0);

-- Le singole righe da reinserire: quelle il cui acube_transaction_id non risulta gia'
-- importato, prese in ordine e solo fino a coprire il deficit del gruppo.
CREATE TEMP TABLE _da_inserire ON COMMIT DROP AS
SELECT * FROM (
  SELECT at.*, mc.bank_account_id, mc.company_id, mm.n_bank,
         row_number() OVER (
           PARTITION BY mc.bank_account_id, at.made_on::date, at.amount,
                        LEFT(COALESCE(at.description, ''), 40)
           ORDER BY at.acube_transaction_id) AS rn,
         mm.deficit
  FROM public.acube_transactions at
  JOIN _mappa_conti mc ON mc.uuid = at.acube_account_uuid
  JOIN _mancanti mm ON mm.bank_account_id = mc.bank_account_id
                   AND mm.d = at.made_on::date
                   AND mm.amount = at.amount
                   AND mm.d40 = LEFT(COALESCE(at.description, ''), 40)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.bank_transactions bt
     WHERE bt.bank_account_id = mc.bank_account_id
       AND bt.acube_transaction_id = at.acube_transaction_id)
) t
WHERE t.rn <= t.deficit;

INSERT INTO public.bank_transactions
  (company_id, bank_account_id, transaction_date, booking_date, value_date,
   amount, currency, description, status, source, acube_transaction_id, raw_data,
   is_reconciled, acube_dedup_hash, note)
SELECT d.company_id, d.bank_account_id, d.made_on::date, d.made_on::date,
       COALESCE(d.posting_date, d.made_on::date),
       d.amount, COALESCE(d.currency_code, 'EUR'), d.description, 'booked', 'acube_ob',
       d.acube_transaction_id, d.extra, false,
       public.bank_tx_canonical_hash_occ(
         d.bank_account_id, d.made_on::date, d.amount, d.description,
         (d.n_bank + d.rn)::int),
       'recuperato il 16/09/2026 da acube_transactions: il movimento era stato scaricato ma scartato dall''indice di deduplica, che tronca la descrizione a 40 caratteri e lo aveva scambiato per un doppione'
FROM _da_inserire d
ON CONFLICT (acube_dedup_hash) WHERE acube_dedup_hash IS NOT NULL DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFICA — da rieseguire dopo: deve tornare zero righe
--
--   WITH acu AS (
--     SELECT made_on::date d, amount, LEFT(COALESCE(description,''),40) d40, count(*) n
--       FROM public.acube_transactions GROUP BY 1,2,3),
--   bt AS (
--     SELECT transaction_date d, amount, LEFT(COALESCE(description,''),40) d40, count(*) n
--       FROM public.bank_transactions GROUP BY 1,2,3)
--   SELECT acu.d, acu.amount, acu.n AS in_acube, COALESCE(bt.n,0) AS in_banca
--     FROM acu LEFT JOIN bt USING (d, amount, d40)
--    WHERE acu.n > COALESCE(bt.n,0);
-- ---------------------------------------------------------------------------
