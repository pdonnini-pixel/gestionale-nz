# CLEANUP_NOCHECK_NOTES — TS strict cleanup

> Note operative durante la rimozione di `@ts-nocheck` dai 51 file frontend.
> Branch: `feature-ts-cleanup-nocheck` — vedi `PROMPT_TS_CLEANUP_NOCHECK.md` per scope.

## Metodo

- Rimuovo `@ts-nocheck`, lancio `npm run typecheck`, fix degli errori.
- Commit atomico per file (o gruppo molto piccolo).
- Stop reali solo nei 3 casi del prompt: foundation rotta, modifica logica, loop > 10 cicli.
- Su file irrecuperabile in 5 tentativi: riapplico `@ts-nocheck`, annoto qui, prosego.

## File 51 di partenza

Componenti (12): AccountDetail, AICategorization, ContractUploader, CostiRicorrenti, GlobalSearch, InvoiceViewer, NotificationBell, OpenBanking, OutletValutazione, OutletWizard, PdfViewer, ScadenzarioSmart.

Lib (6): contractParser, parsers/bilancioParser, parsers/csvParser, parsers/importEngine, parsers/xmlInvoiceParser, reconciliationEngine.

Pagine (33): AllocazioneFornitori, AnalyticsPOS, ArchivioDocumenti, Banche, BankingCallback, BudgetControl, CashFlow, CashflowProspettico, ConfrontoOutlet, ContoEconomico, Contratti, Dashboard, Dipendenti, Fatturazione, Fornitori, Importazioni, ImportHub, Impostazioni, Login, MarginiCategoria, MarginiOutlet, Onboarding, OpenToBuy, Outlet, Produttivita, Scadenzario, ScadenzarioSmart, ScadenzeFiscali, ScenarioPlanning, SchedaContabileFornitore, StockSellthrough, StoreManager, TesoreriaManuale.

## Diario di lavoro

(da popolare durante il cleanup)
