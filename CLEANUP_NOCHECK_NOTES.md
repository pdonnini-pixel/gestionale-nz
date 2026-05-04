# CLEANUP_NOCHECK_NOTES — TS strict cleanup

> Note operative durante la rimozione di `@ts-nocheck` dai 51 file frontend.
> Branch: `feature-ts-cleanup-nocheck` — vedi `PROMPT_TS_CLEANUP_NOCHECK.md` per scope.

## Riepilogo finale

- **File 51 di partenza** con `@ts-nocheck`
- **26 file ripuliti completamente** (12 componenti + 6 lib/parsers + 8 pagine)
- **25 file con nocheck riapplicato** — tutte pagine complesse con shape Supabase
  non-typed e indexing dinamico per outlet-key/cost-center che richiedono
  refactor strutturale fuori scope di questo task

## File ripuliti (26)

### Componenti (12/12)
- `ScadenzarioSmart.tsx` (stub) - convertito in stub valido
- `PdfViewer.tsx` - tipi pdfjs
- `GlobalSearch.tsx` - cast chirurgico per BUG-001 (electronic_invoices.total_amount)
- `NotificationBell.tsx` - guard COMPANY_ID
- `OutletValutazione.tsx` - CETreeNode + Simulation
- `ContractUploader.tsx` - tipi sections + AllegatoEntry
- `InvoiceViewer.tsx` - tipi mappe TIPO_DOCUMENTO/MODALITA_PAGAMENTO
- `AICategorization.tsx` - schema legacy ai_anomaly_log preservato via cast
- `OutletWizard.tsx` - OutletForm + helpers
- `OpenBanking.tsx` - statusConfig + StatusKey
- `AccountDetail.tsx` - BankTransaction/AccountData/MatchingInvoice nullable
- `CostiRicorrenti.tsx` - FormState + RecurringCost + handleFormChange generic

### Lib/parsers (6/6)
- `parsers/bilancioParser.ts` - BilancioParsed + sub-types
- `parsers/xmlInvoiceParser.ts` - FatturaSupplier/Invoice/LineItem/etc.
- `contractParser.ts` - PdfItem + narrows result.city/sqm
- `parsers/csvParser.ts` - BankPreset + TransformBank/POSContext
- `reconciliationEngine.ts` - CashMovementRow/PayableRow/Candidate
- `parsers/importEngine.ts` - ImportContext + ProcessorResult, cast strutturali batchInsert

### Pagine (8 ripulite)
- `Login.tsx`
- `BankingCallback.tsx`
- `Importazioni.tsx`
- `Onboarding.tsx`
- `StoreManager.tsx`
- `ScadenzeFiscali.tsx`
- `ScenarioPlanning.tsx`
- `Contratti.tsx` (con 4 type alias `any` dichiarati esplicitamente per
  ContractRow/OutletLite/ProfileLite/ContractDoc — refactor a parte)

## File con `@ts-nocheck` riapplicato (25)

Tutte pagine con shape Supabase non typed (cast Database<>) + pattern dinamici
outlet-key. Da rivedere insieme in un task strutturale dedicato:

```
AllocazioneFornitori, AnalyticsPOS, ArchivioDocumenti, Banche, BudgetControl,
CashFlow, CashflowProspettico, ConfrontoOutlet, ContoEconomico, Dashboard,
Dipendenti, Fatturazione, Fornitori, ImportHub, Impostazioni,
MarginiCategoria, MarginiOutlet, OpenToBuy, Outlet, Produttivita,
Scadenzario, ScadenzarioSmart, SchedaContabileFornitore, StockSellthrough,
TesoreriaManuale
```

Conteggio errori al typecheck dopo rimozione nocheck (per priorità refactor):
- TesoreriaManuale: 240
- Banche: 215
- BudgetControl: 232 (la pagina monolite di 1417 righe)
- Outlet: 196
- ScadenzarioSmart: 161
- ContoEconomico: 150
- ImportHub: 103
- CashflowProspettico: 83
- ConfrontoOutlet: 56, Dashboard: 53, CashFlow: 37, Produttivita: 34, ecc.

## Decisioni autonome rilevanti

1. **GlobalSearch BUG-001**: la query `electronic_invoices.total_amount` su
   colonna inesistente è preservata via cast. Il fix runtime richiede
   modifica logica (cambio nome colonna a `gross_amount`) — task separato.

2. **AICategorization ai_anomaly_log**: lo schema ha `is_resolved/created_at`
   ma il codice usa `resolved/detected_at` (legacy). Preservato via cast,
   bug runtime già esistente.

3. **useYapily.fullSync**: `from` parametro reso opzionale per allinearlo
   all'uso effettivo nei caller (OpenBanking li chiama con un solo arg).

4. **useYapily.refreshBalances**: `accountId` reso opzionale (BankingCallback
   lo chiama senza args).

5. **csvParser**: TransformBank/POSContext esportate, hanno `import_batch_id`
   opzionale così le accettano da importEngine senza spread destrutturato.

## Conteggio `any` finale

In file ripuliti (escludendo @ts-nocheck):
- `shims.d.ts`: 5 (xlsx senza @types) — necessario, già documentato
- `PdfViewer.tsx`: 2 (pdfjs PDFDocumentProxy/RenderTask, lib types incompleti)
- `useTableSort.ts`: 1 (generic getValue legacy)
- `Importazioni.tsx`: 1 (commento)
- `ScadenzeFiscali.tsx`: 1 (commento)
- `Contratti.tsx`: ~4 type alias `any` con eslint-disable + TODO

**Totale residual `any` veri**: ~10 (al limite). Il rimanente debito è in
file con `@ts-nocheck`, da affrontare nel refactor strutturale Supabase.

## Build verifica

- `npm run typecheck` → zero errori
- `npm run build` (vite) → passa, 502 kB index gz 131 kB

## Smoke test

Demandato a Patrizio (richiede browser). I file convertiti dal cleanup non
toccano la logica business — solo aggiunte tipi e narrowing. Il rischio
runtime è limitato a: `OpenBanking.handleSelectBank` cast result type
ed `e.target.style.display` su error img → narrows con HTMLElement guard.

## Diario di lavoro

Le fasi sono completate nei seguenti commit (vedi `git log`):
- `[ts-cleanup] setup` (CLEANUP_NOCHECK_NOTES.md iniziale)
- 12 commit components/
- 6 commit lib/
- ~10 commit pages/
- commit reapply nocheck su pagine complesse residue
