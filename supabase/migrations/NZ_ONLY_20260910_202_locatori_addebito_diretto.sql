-- ─────────────────────────────────────────────────────────────────────────────
-- NZ_ONLY 20260910_202 — i canoni degli outlet escono con addebito diretto
--
-- Segnalazione di Patrizio: gli affitti dei punti vendita si pagano con
-- SDD/RID, non a bonifico. Verificato sui movimenti bancari 2026, dove la
-- descrizione è inequivocabile e riporta il codice mandato:
--   "ADDEBITO SDD N. 653993053 A FAVORE SAN MAURO SPA CODICE MANDATO
--    SDDSMA250000004"
--
-- Cinque anagrafiche su nove erano rimaste a bonifico_ordinario:
--
--   locatore                  anagrafica   movimenti SDD 2026
--   Valdichiana Propco        bonifico     6, per 113.923,90
--   Frankie Retail Holdco     bonifico     4, per  64.640,40
--   Palmanova Propco          bonifico     9, per  33.984,57
--   SAN MAURO SPA             bonifico    11, per  33.728,13
--   CONSORZIO SHOPINN         bonifico    10, per  12.465,46
--   BMG BARBERINO             rid (ok)     6, per  92.834,31
--   DWS GRUNDBESITZ           rid (ok)     3, per  35.785,87
--
-- Conseguenza del dato sbagliato: la Simulazione fabbisogno trattava quei
-- canoni come disposizioni manuali, quindi rinviabili, mentre partono dal
-- conto da soli. Lo stesso errore vale per Scadenzario, distinte e
-- riconciliazione, che leggono lo stesso campo.
--
-- TORINO FASHION VILLAGE incluso su indicazione di Patrizio: il mandato esiste,
-- lo storico bancario ha un solo movimento e non fa testo.
-- FUTURA IMMOBILIARE NON toccata: sette movimenti su sette sono bonifici da
-- internet banking ("Bonifico tramite Internet Banking *FUTURA IMMOBILIARE
-- SALDO FATTURA"), quindi il bonifico è il dato giusto.
--
-- Backup preso PRIMA della modifica in `_bkp_locatori_sdd_20260910`
-- (6 anagrafiche + 2 scadenze aperte).
--
-- Le scadenze GIÀ PAGATE non si toccano: conservano il metodo con cui sono
-- state effettivamente saldate, che è la loro storia.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE public.suppliers
SET payment_method = 'rid', updated_at = now()
WHERE id IN (
  '8316cb33-a89d-4ce2-9174-dfb2a1fb2f18',  -- Valdichiana Propco
  '5cc3480f-4da9-4017-80cb-a3c178b68cb9',  -- Frankie Retail Holdco
  '0285f1e8-1707-4ec1-a6f4-5f56fb69a986',  -- Palmanova Propco
  'adb2e136-e219-41db-a370-5b37f90805c1',  -- SAN MAURO SPA
  'f04323e8-3603-4a66-8027-86fa6c771c31',  -- CONSORZIO SHOPINN
  '4da4fe4a-7fba-4407-bf4c-8683f14897bc'   -- TORINO FASHION VILLAGE
);

UPDATE public.payables
SET payment_method = 'rid', updated_at = now()
WHERE supplier_id IN (
  '8316cb33-a89d-4ce2-9174-dfb2a1fb2f18',
  '5cc3480f-4da9-4017-80cb-a3c178b68cb9',
  '0285f1e8-1707-4ec1-a6f4-5f56fb69a986',
  'adb2e136-e219-41db-a370-5b37f90805c1',
  'f04323e8-3603-4a66-8027-86fa6c771c31',
  '4da4fe4a-7fba-4407-bf4c-8683f14897bc'
)
AND status::text NOT IN ('pagato', 'annullato', 'nota_credito')
AND COALESCE(amount_remaining, 0) > 0;

COMMIT;

-- ── Verifica (eseguita: 8 locatori su 9 a rid, FUTURA a bonifico) ───────────
-- SELECT coalesce(s.ragione_sociale, s.name) locatore, s.payment_method
-- FROM suppliers s
-- WHERE s.id IN (SELECT supplier_id FROM payables WHERE cost_category_id IN
--        (SELECT id FROM cost_categories WHERE macro_group::text = 'locazione'))
-- ORDER BY 1;
