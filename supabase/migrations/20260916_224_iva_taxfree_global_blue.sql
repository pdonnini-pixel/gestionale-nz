-- =====================================================================
-- 224 — Liquidazione IVA: IVA recuperata sul tax free (note Global Blue)
-- =====================================================================
-- Il registro del commercialista ha una voce che il gestionale non vede:
-- le note di variazione del tax free. Quando un turista extra UE ottiene il
-- rimborso, l'IVA di quella vendita viene stornata e l'azienda la recupera.
-- Lo studio le registra in un registro a parte («fatture cartacee»)
-- dall'estratto conto Global Blue, non passano dallo SDI. Su NZ: luglio
-- 2026 258,65, agosto 2026 588,78. Senza questa voce la stima automatica di
-- agosto stava 588,78 sopra l'F24.
--
-- COSA INTRODUCE:
--   * vat_settlements.iva_taxfree (numeric, default 0): IVA a credito delle
--     note di variazione tax free del mese confermato. Per i mesi non
--     confermati il motore usa la media dei mesi confermati.
-- Additiva. REGOLA #0: NZ -> Made -> Zago.
-- =====================================================================
BEGIN;

ALTER TABLE public.vat_settlements
  ADD COLUMN IF NOT EXISTS iva_taxfree numeric(14,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.vat_settlements.iva_taxfree IS 'IVA a credito delle note di variazione tax free (Global Blue) registrate nel mese: si legge dall''estratto conto Global Blue, non arriva via SDI. Riduce la liquidazione.';

COMMIT;

-- VERIFICA: select column_name, column_default from information_schema.columns where table_name='vat_settlements' and column_name='iva_taxfree';
