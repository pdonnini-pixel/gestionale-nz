-- =============================================================================
-- NZ_ONLY — Anagrafiche fornitore doppie + metodi di pagamento da Sabrina
-- Applicato su NZ il 03/09/2026. Dati NZ-specifici: non si replica su Made/Zago.
-- =============================================================================
--
-- 1) ANAGRAFICHE DOPPIE. Due fornitori erano presenti due volte, una scheda con
--    P.IVA e una senza:
--      - HUMATICS S.r.l. — la scheda senza P.IVA era gia' inattiva e senza righe.
--      - PROFASHION S.R.L. — la scheda senza P.IVA non aveva fatture, ma teneva
--        il SALDO DI APERTURA 2026 di -20.132,44 € (ripresa dalla scheda 2025).
--        Risultato: la scheda vera, quella con P.IVA e le fatture, partiva da zero
--        e il debito verso PROFASHION risultava sottostimato di 20.132,44 €.
--
--    Il saldo di apertura passa alla scheda giusta; le schede doppie vengono
--    DISATTIVATE, non cancellate (regola NO DATA LOSS): restano consultabili.
--    Backup: public._bkp_merge_anagrafiche_20260903.
--
-- 2) METODI DI PAGAMENTO. Nella lista RI.BA di Sabrina del 03/09 quattro fatture
--    risultano incassate a ricevuta bancaria mentre in anagrafica erano a bonifico
--    ordinario. Su indicazione di Patrizio si segue quanto indica Sabrina:
--      - REALCART 555/2026, 556/2026, 557/2026 -> riba_90  (90 gg fine mese)
--      - TOP CASH SERVICE 3619/A               -> riba_30  (30 gg data fattura)
--    Finche' restavano a bonifico, quelle scadenze stavano fuori da tutta la
--    logica RI.BA: chiusura provvisoria, distinta, compensazione note di credito.
--    Backup: public._bkp_riba_method_20260903.
-- =============================================================================

BEGIN;

-- --- 1. Saldo di apertura sulla scheda giusta -------------------------------
UPDATE public.supplier_opening_balances
SET supplier_id = '9cda9b62-5e27-4187-afb2-4581ffc55103',  -- PROFASHION con P.IVA 02544660976
    note = COALESCE(note, '') || ' — spostato dalla scheda doppia senza P.IVA il 03/09/2026',
    updated_at = now()
WHERE supplier_id = 'fdc456a2-5a54-47dd-ab4e-6402ba6ed918'; -- PROFASHION senza P.IVA

-- --- 2. Schede doppie disattivate (NON cancellate) --------------------------
UPDATE public.suppliers
SET is_active = false, updated_at = now()
WHERE id IN (
  'fdc456a2-5a54-47dd-ab4e-6402ba6ed918',  -- PROFASHION S.R.L. senza P.IVA
  '5a00ed43-99fc-4eda-aee9-c45fa50e27c9'   -- Humatics S.r.l. senza P.IVA
);

-- --- 3. Metodi di pagamento come indicato da Sabrina ------------------------
UPDATE public.payables p
SET payment_method = 'riba_90'::payment_method, updated_at = now()
FROM public.suppliers s
WHERE s.id = p.supplier_id
  AND s.partita_iva = '01715000343'                        -- REALCART
  AND p.invoice_number IN ('555/2026', '556/2026', '557/2026');

UPDATE public.payables p
SET payment_method = 'riba_30'::payment_method, updated_at = now()
FROM public.suppliers s
WHERE s.id = p.supplier_id
  AND s.partita_iva = '04289740484'                        -- TOP CASH SERVICE
  AND p.invoice_number = '3619/A';

COMMIT;

-- --- Verifica ---------------------------------------------------------------
-- SELECT
--  (SELECT count(*) FROM public.supplier_opening_balances
--    WHERE supplier_id='9cda9b62-5e27-4187-afb2-4581ffc55103') saldo_su_scheda_giusta,   -- atteso 1
--  (SELECT count(*) FROM public.suppliers
--    WHERE id IN ('fdc456a2-5a54-47dd-ab4e-6402ba6ed918','5a00ed43-99fc-4eda-aee9-c45fa50e27c9')
--      AND is_active) doppie_ancora_attive,                                              -- atteso 0
--  (SELECT count(*) FROM public.payables p JOIN public.suppliers s ON s.id=p.supplier_id
--    WHERE (s.partita_iva='01715000343' AND p.invoice_number IN ('555/2026','556/2026','557/2026')
--           AND p.payment_method::text='riba_90')
--       OR (s.partita_iva='04289740484' AND p.invoice_number='3619/A'
--           AND p.payment_method::text='riba_30')) metodi_riba_ok;                       -- atteso 4
