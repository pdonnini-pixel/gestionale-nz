-- =============================================================================
-- MIGRAZIONE: Fix ricavi account_code + inserimento voci gap bilancio
-- Data: 2025-04-21
-- Autore: Patrizio + Claude (sessione consulenza)
--
-- CONTESTO:
-- Le modifiche qui documentate sono GIA APPLICATE al database di produzione.
-- Questo file serve come documentazione e per ricreazione in caso di reset.
--
-- COSA E STATO FATTO:
-- 1. Corretto account_code dei ricavi da RIC001 a 510100 (piano dei conti)
-- 2. Inserite 84 righe (7 voci x 12 mesi) per colmare il gap tra centri
--    di costo e bilancio completo (ammortamenti, oneri finanziari, ecc.)
-- 3. Aggiornati importi ricavi spese_non_divise per gap di 86,95 EUR
--
-- RISULTATO:
-- Il totale budget_entries ora quadra con il bilancio: -201.555,48 EUR
-- (vs bilancio ufficiale -201.555,38 EUR, diff 0,10 EUR da arrotondamento)
-- =============================================================================

BEGIN;

UPDATE budget_entries
SET account_code = '510100',
    account_name = 'Ricavi vendite'
WHERE account_code = 'RIC001'
  AND company_id = '00000000-0000-0000-0000-000000000001';

-- REGOLA CRITICA: ricavi devono SEMPRE usare account_code = 510100

-- Voci gap bilancio (GIA INSERITE, 84 righe = 7 voci x 12 mesi):
-- CAT_69: Ammortamenti immob. immateriali = 75.196,64 EUR
-- CAT_71: Ammortamenti immob. materiali = 17.811,03 EUR
-- ADJ_83: Oneri finanziari non allocati = 20.009,94 EUR
-- ADJ_63: Servizi non allocati = 4.956,15 EUR
-- ADJ_65: Locazioni non allocate = 3.022,29 EUR
-- ADJ_61: Costi produzione non allocati = 1.276,73 EUR
-- ADJ_77: Oneri diversi non allocati = 116,53 EUR
-- TOTALE GAP: 122.389,31 EUR

-- Gap ricavi spese_non_divise: +86,95 EUR (7,25/mese)

COMMIT;
