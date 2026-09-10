-- 20260910_205 — Il metodo di pagamento del fornitore si allinea a quello scritto in fattura
--
-- PERCHE' (Patrizio, 10/09/2026, dopo la 204): «allinealo a quello scritto nelle fatture».
-- La 204 fa nascere configurati i fornitori NUOVI. Restavano i 256 gia' a sistema, creati
-- dal vecchio bridge con `payment_method = 'bonifico_ordinario'` scritto d'ufficio per
-- tutti, anche per chi in fattura dichiara tutt'altro (carta, contanti, SDD, Ri.Ba.).
--
-- CRITERIO (prudente per costruzione):
--   1. si guarda il codice MP prevalente delle fatture del fornitore negli ultimi 18 mesi;
--      serve almeno il 60% delle fatture d'accordo, altrimenti non si tocca niente;
--   2. si allinea SOLO chi ha ancora il default d'ufficio 'bonifico_ordinario'. Un metodo
--      diverso e' stato scelto da qualcuno e resta com'e': e' il caso Amazon della 201,
--      che dichiara MP05 ma per anagrafica va a carta, e sarebbe stato rovinato da un
--      allineamento cieco;
--   3. il confronto e' per FAMIGLIA, perche' passa da fn_sdi_mp_to_payment_method(mp, attuale):
--      un fornitore gia' riba_60 non torna riba_30, un bonifico istantaneo non torna ordinario.
--      Il termine (30/60/90) e' una scelta dell'azienda, la famiglia e' un fatto della fattura.
--   4. dove i pagamenti gia' riconciliati dicono su quale conto e' passato quel fornitore,
--      si valorizza anche la banca di addebito (serve per Ri.Ba., RID, SDD e carte).
--
-- ESITO NZ: 25 fornitori allineati (11 carta, 6 contanti, 5 SDD core, 1 SDD B2B, 1 assegno,
-- 1 Ri.Ba.), banca dedotta per 7. Nessun altro campo toccato (verificato contro il backup).
-- Made e Zago: nessun fornitore in condizione, la migration gira e non cambia nulla.
-- Restano 11 fornitori che ora chiedono la banca di addebito (carte e Ri.Ba.): compaiono
-- in Fatturazione come «banca mancante», e la banca la sceglie Patrizio.
--
-- Backup integrale in suppliers_backup_metodo_20260910. Rollback in _ROLLBACK.sql

CREATE TABLE IF NOT EXISTS public.suppliers_backup_metodo_20260910 AS
  SELECT * FROM public.suppliers;
ALTER TABLE public.suppliers_backup_metodo_20260910 ENABLE ROW LEVEL SECURITY;

WITH mp AS (
  SELECT s.id, s.default_payment_method::text AS attuale, ei.payment_method AS mp_code, count(*) AS n
    FROM public.suppliers s
    JOIN public.electronic_invoices ei
      ON ei.company_id = s.company_id AND ei.supplier_vat = coalesce(s.partita_iva, s.vat_number)
   WHERE coalesce(s.is_deleted, false) = false
     AND ei.payment_method IS NOT NULL
     AND ei.invoice_date >= current_date - interval '18 months'
   GROUP BY 1, 2, 3
), tot AS (
  SELECT id, sum(n) AS tot_fatt FROM mp GROUP BY 1
), best AS (
  SELECT mp.*, tot.tot_fatt, row_number() OVER (PARTITION BY mp.id ORDER BY mp.n DESC) AS rk
    FROM mp JOIN tot ON tot.id = mp.id
), cand AS (
  SELECT b.id,
         public.fn_sdi_mp_to_payment_method(b.mp_code, b.attuale) AS nuovo,
         (SELECT bt.bank_account_id
            FROM public.payables p2
            JOIN public.bank_transactions bt ON bt.id = p2.bank_transaction_id
           WHERE p2.supplier_id = b.id AND bt.bank_account_id IS NOT NULL
           ORDER BY p2.payment_date DESC NULLS LAST
           LIMIT 1) AS banca
    FROM best b
   WHERE b.rk = 1
     AND b.n::numeric / b.tot_fatt >= 0.6
     AND b.attuale = 'bonifico_ordinario'
     AND public.fn_sdi_mp_to_payment_method(b.mp_code, b.attuale)::text <> b.attuale
)
UPDATE public.suppliers s SET
  default_payment_method = c.nuovo,
  payment_method         = c.nuovo::text,
  payment_bank_account_id = coalesce(s.payment_bank_account_id,
                              CASE WHEN c.nuovo::text IN ('carta_credito','carta_debito','rid','sdd_core','sdd_b2b')
                                     OR c.nuovo::text LIKE 'riba%' THEN c.banca END),
  profile_from_invoice_fields = (
    SELECT array_agg(DISTINCT f)
      FROM unnest(coalesce(s.profile_from_invoice_fields, ARRAY[]::text[]) || ARRAY['metodo_pagamento']) f),
  profile_from_invoice_at = now(),
  updated_at = now()
FROM cand c
WHERE s.id = c.id;

-- VERIFICA (deve tornare 0): campi diversi dal metodo/banca modificati dal giro
-- SELECT count(*) FROM public.suppliers s
--   JOIN public.suppliers_backup_metodo_20260910 b ON b.id = s.id
--  WHERE b.payment_base IS DISTINCT FROM s.payment_base
--     OR b.prima_scadenza_gg IS DISTINCT FROM s.prima_scadenza_gg
--     OR b.numero_rate IS DISTINCT FROM s.numero_rate
--     OR b.iban IS DISTINCT FROM s.iban
--     OR b.default_cost_category_id IS DISTINCT FROM s.default_cost_category_id;
