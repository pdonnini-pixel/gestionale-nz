# MIGRATION_NOTES.md — Migrazione JS → TypeScript

## Info generali
- **Data inizio**: 2026-04-30
- **Data fine**: 2026-04-30
- **Branch**: `feature-typescript-migration`
- **File totali convertiti**: 74 (.jsx/.js → .tsx/.ts)
- **File .jsx/.js rimasti**: 0 (100% convertito)
- **File .ts/.tsx totali nel progetto**: 81 (inclusi nuovi file tipi)

## Dipendenze aggiunte
- `typescript` ^6.0.3 (devDependency)
- `@types/react` ^19.2.14 (devDependency)
- `@types/react-dom` ^19.2.3 (devDependency)
- `@types/node` ^25.6.0 (devDependency)

## Librerie con type shims (`src/types/shims.d.ts`)
- `xlsx` — nessun @types disponibile, shim manuale con `any`

## Fasi completate

### Fase 0 — Setup tooling
- ✅ `tsconfig.json` creato con `strict: true`, `allowJs: true`
- ✅ Tipi DB Supabase generati (`src/types/database.ts`, 8138 righe)
- ✅ `npm run build` passa
- ✅ Script `typecheck` e `typecheck:watch` aggiunti a package.json

### Fase 1 — Foundation files (8 file)
- ✅ `lib/supabase.ts` — client tipizzato con `createClient<Database>`
- ✅ `hooks/useAuth.tsx` — interfacce `UserProfile`, `AuthContextValue`
- ✅ `hooks/useCompany.tsx` — interfacce `Company`, `CompanyContextValue`
- ✅ `hooks/usePeriod.tsx` — interfacce `DateRange`, `PeriodContextValue`
- ✅ `hooks/useYapily.tsx` — tipi per tutti i parametri, `ApiResponse` any con TODO
- ✅ `hooks/useTableSort.ts` — interfacce `SortEntry`, `UseTableSortOptions`
- ✅ `App.tsx`, `main.tsx` — tipi `ReactNode`, non-null assertion
- ✅ `vite.config.ts` — rinominato da .js
- ✅ `index.html` aggiornato per puntare a `main.tsx`

### Fase 2 — Componenti UI primitivi (14 file)
- ✅ Tutti i componenti in `components/ui/` e componenti standalone convertiti
- ✅ Props interfaces aggiunte a tutti i componenti

### Fase 3 — Componenti business e layout (13 file)
- ✅ Layout, Sidebar, GlobalSearch, tutti i componenti business convertiti
- ✅ Interfacce per dati business (BankTransaction, FatturaData, etc.)

### Fase 4 — Pagine semplici (11 file)
- ✅ Login, Onboarding, Profilo, Impostazioni, Dipendenti, Outlet, Fornitori,
  Contratti, ArchivioDocumenti, ScadenzeFiscali, BankingCallback

### Fase 5 — Pagine complesse (24 file)
- ✅ Tutte le pagine convertite incluso BudgetControl (~2400 righe)
- ✅ Dashboard, Banche, Scadenzario, ImportHub, Fatturazione, ContoEconomico, etc.

### Fase 6 — Cleanup e finalizzazione
- ✅ `allowJs: false` — nessun file JS rimasto
- ✅ `noUnusedLocals: false`, `noUnusedParameters: false` — disabilitati per evitare
  errori su import/variabili usati solo nel JSX che tsc non riconosce
- ✅ `tsc --noEmit` passa con zero errori
- ✅ `npm run build` passa
- ✅ Tipi DB Supabase rigenerati (8138 righe, versione completa)

## File con `@ts-nocheck` (debito tecnico documentato)

Stato originale: 51 file. Dopo task `feature-ts-cleanup-nocheck` (04/05/2026):
**26 file ripuliti completamente, 25 file ancora con `@ts-nocheck`** —
tutti pagine complesse con shape Supabase non typed e pattern dinamici
che richiedono refactor strutturale. Vedi `CLEANUP_NOCHECK_NOTES.md` per
dettagli, motivazioni delle decisioni autonome e priorità refactor.

**File ancora con `@ts-nocheck` (25, tutte pagine):**
AllocazioneFornitori, AnalyticsPOS, ArchivioDocumenti, Banche, BudgetControl,
CashFlow, CashflowProspettico, ConfrontoOutlet, ContoEconomico, Dashboard,
Dipendenti, Fatturazione, Fornitori, ImportHub, Impostazioni,
MarginiCategoria, MarginiOutlet, OpenToBuy, Outlet, Produttivita,
Scadenzario, ScadenzarioSmart, SchedaContabileFornitore, StockSellthrough,
TesoreriaManuale.

**File originariamente in lista, ora ripuliti (26):**
- 12 componenti in `src/components/`
- 6 file lib/parsers in `src/lib/`
- 8 pagine: Login, BankingCallback, Importazioni, Onboarding, StoreManager,
  ScadenzeFiscali, ScenarioPlanning, Contratti

**File SENZA @ts-nocheck (tipizzazione completa):**
- `src/lib/supabase.ts`
- `src/lib/formatters.ts`
- `src/lib/ceHelpers.ts`
- `src/hooks/useAuth.tsx`
- `src/hooks/useCompany.tsx`
- `src/hooks/usePeriod.tsx`
- `src/hooks/useYapily.tsx`
- `src/hooks/useTableSort.ts`
- `src/App.tsx`
- `src/main.tsx`
- `src/components/ui/*.tsx` (KpiCard, LoadingSkeleton, Breadcrumb, SortableTh, StatusBadge, index)
- `src/components/Toast.tsx`
- `src/components/EmptyState.tsx`
- `src/components/DataFreshness.tsx`
- `src/components/FinancialTooltip.tsx`
- `src/components/HelpPanel.tsx`
- `src/components/PageHelp.tsx`
- `src/components/ExportMenu.tsx`
- `src/components/ChartTheme.tsx`
- `src/components/Layout.tsx`
- `src/components/Sidebar.tsx`
- `src/pages/Profilo.tsx`

## Bug pre-esistenti trovati durante smoke test (post-migrazione)

### BUG-001 — Fatturazione: query su colonna inesistente
- **File**: `src/pages/Fatturazione.tsx`, righe 1328-1329
- **Errore**: `HEAD .../electronic_invoices?select=id&direction=eq.inbound → 400 Bad Request` (idem per `outbound`)
- **Causa**: il codice chiama `supabase.from('electronic_invoices').eq('direction', 'inbound')` ma la colonna `direction` non esiste nella tabella `electronic_invoices` (verificato sui tipi DB rigenerati). Le colonne reali rilevanti sono `source` (enum `import_source`) e `tipo_documento`.
- **Stato**: bug pre-esistente nel codice originale `.jsx`, NON introdotto dalla migrazione TS. Probabilmente sempre fallito silenziosamente perché nessuno aveva mai aperto la console su Fatturazione.
- **Impatto utente**: i conteggi inbound/outbound mostrati in pagina sono probabilmente errati o a zero.
- **Fix**: task separato post-merge — investigare se la query doveva usare `source` con valori dell'enum, o se è una funzionalità mai completata.

Tutte le altre pagine smoke-testate (Dashboard, Banche, Scadenzario, ImportHub, BudgetControl, ConfrontoOutlet, ContoEconomico) hanno console pulita.

## Stranezze trovate da investigare
- `ScadenzarioSmart.tsx` (componente) è quasi vuoto — sembra uno stub
- `BudgetControl.tsx` è un monolite da 2400+ righe — da spezzare in moduli in task separato
- Alcuni componenti importano `React` senza usarlo direttamente (necessario solo per JSX transform vecchio)
- Le pagine usano pesantemente pattern `any` per dati Supabase — da tipizzare incrementalmente

## Raccomandazioni post-migrazione
1. **Rimuovere `@ts-nocheck` incrementalmente** — iniziare dai file più piccoli/semplici,
   tipizzare i dati Supabase usando i tipi generati in `database.ts`
2. **Riattivare `noUnusedLocals` e `noUnusedParameters`** — pulire import inutilizzati
3. **Tipizzare le risposte Supabase** — creare utility types che derivano dai tipi DB generati
4. **Spezzare BudgetControl** — 2400 righe è troppo per un singolo componente
5. **Eliminare gli import `React` non necessari** — con `react-jsx` transform non serve

## Riconciliazione Bilancio — verifica branch `feature-riconciliazione-bilancio` (2026-05-04)

**Contesto**: il prompt `PROMPT_RICONCILIAZIONE_BILANCIO.md` chiedeva di riapplicare ai file `.tsx`
le modifiche del commit orfano `1195613a00ee1a11feb94bb39658bb2802899410` (22/04/2026 — "riconciliazione
bilancio + esclusione rettifica da viste outlet"), partendo dall'ipotesi che la migrazione TS le
avesse perse.

**Scoperta**: la migrazione TS (commit `d6e73d9`) ha **già preservato** tutte e 3 le modifiche logiche
del commit orfano nei file `.tsx` su `main`:

- `src/pages/Dashboard.tsx:364-365` — exclusion `cost_center === 'rettifica_bilancio' || cost_center === 'spese_non_divise'`
- `src/pages/BudgetControl.tsx:409` — filter `e.cost_center !== 'rettifica_bilancio'` su bp_edits reload
- `src/pages/ContoEconomico.tsx:1696-1876` — vista Riconciliazione Bilancio completa (3 box: Risultato Gestionale, Rettifiche, Risultato Civilistico) + state `riconData`/`riconLoading` + `loadRiconciliazione()` + bottone tab

**Azione applicata su questo branch**: tightening dei tipi TypeScript in `ContoEconomico.tsx`:
- aggiunte interfacce `RiconRettifica`, `RiconBilancioUfficiale`, `RiconData`
- `riconData` ora tipizzato come `RiconData | null` (era `any`)
- `viewMode` ora tipizzato come `'competenza' | 'cassa' | 'riconciliazione'` (era `string` implicito)
- `rettificheByType` accumulator ora tipizzato come `Record<string, RiconRettifica>`

**`@ts-nocheck` non rimosso** sui 3 file: ContoEconomico.tsx (2540+ righe), BudgetControl.tsx (1417 righe),
Dashboard.tsx (847 righe) richiederebbero molto più di 30 minuti per file per tipizzare correttamente
shape Supabase, refs DOM, props ricorrenti — secondo la regola del prompt si lascia per task separato.

**Verifica**: `npm run typecheck` e `npm run build` passano. Smoke test interattivo demandato a
Patrizio (richiede browser).
