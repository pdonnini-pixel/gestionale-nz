# STRICT_COMPLETION_NOTES — Completamento TS strict (25 pagine residue)

> Branch: `feature-ts-strict-completion`
> Vedi `PROMPT_TS_STRICT_COMPLETION.md` per scope.

## Mappa errori per file (Fase 0)

Conteggio errori `tsc --noEmit` rimuovendo temporaneamente `@ts-nocheck` da
ogni file (uno alla volta). Ordine crescente — sarà l'ordine di lavoro in Fase 3
(le interfacce di Fase 1 ridurranno questi conteggi).

| Errori | File |
|--------|------|
| 7 | StockSellthrough.tsx |
| 9 | OpenToBuy.tsx |
| 16 | SchedaContabileFornitore.tsx |
| 18 | AllocazioneFornitori.tsx |
| 19 | AnalyticsPOS.tsx |
| 24 | Dipendenti.tsx |
| 32 | Impostazioni.tsx |
| 34 | Produttivita.tsx |
| 37 | CashFlow.tsx |
| 40 | MarginiOutlet.tsx |
| 41 | ArchivioDocumenti.tsx |
| 45 | Scadenzario.tsx |
| 53 | Dashboard.tsx |
| 53 | Fornitori.tsx |
| 56 | ConfrontoOutlet.tsx |
| 57 | Fatturazione.tsx |
| 62 | MarginiCategoria.tsx |
| 83 | CashflowProspettico.tsx |
| 103 | ImportHub.tsx |
| 150 | ContoEconomico.tsx |
| 161 | ScadenzarioSmart.tsx |
| 196 | Outlet.tsx |
| 215 | Banche.tsx |
| 232 | BudgetControl.tsx |
| 240 | TesoreriaManuale.tsx |

**Totale**: 2027 errori da risolvere.

## Diario di lavoro

### Fase 3 — Cleanup pagine residue (completata)

Ordine di lavoro (per errori crescenti dopo Fase 1+2). Ogni commit
è atomico e contiene solo modifiche di tipo (zero modifiche logica).

| # | Pagina | Commit |
|---|--------|--------|
| 1 | StockSellthrough.tsx | `4fa10ca` |
| 2 | OpenToBuy.tsx | `4fa10ca` |
| 3 | SchedaContabileFornitore.tsx | `dffcc9f` |
| 4 | AllocazioneFornitori.tsx | `6f14999` |
| 5 | AnalyticsPOS.tsx | `44e8a52` |
| 6 | Dipendenti.tsx | `34d62fd` |
| 7 | Impostazioni.tsx | `f314d64` |
| 8 | Produttivita.tsx | `9518aff` |
| 9 | CashFlow.tsx | `55c5c66` |
| 10 | MarginiOutlet.tsx | `f622e2e` |
| 11 | ArchivioDocumenti.tsx | `c93d79c` |
| 12 | Scadenzario.tsx | `d39185e` |
| 13 | Dashboard.tsx | `79a6dfb` |
| 14 | Fornitori.tsx | `50efcf9` |
| 15 | ConfrontoOutlet.tsx | `6916e65` |
| 16 | Fatturazione.tsx | `714c486` |
| 17 | MarginiCategoria.tsx | `e41b7f1` |
| 18 | CashflowProspettico.tsx | `b9e6985` |
| 19 | ImportHub.tsx | `ec1e636` |
| 20 | ContoEconomico.tsx | `fc49d0f` |
| 21 | ScadenzarioSmart.tsx | `3ed5f08` |
| 22 | Outlet.tsx | `499a17f` |
| 23 | Banche.tsx | `bc3c11e` |
| 24 | BudgetControl.tsx | `9b9d6a2` |
| 25 | TesoreriaManuale.tsx | `666b198` |

Pattern ricorrenti:
- Number(x) al posto di parseFloat su string|null|number unioni
- `as never` cast su Supabase update/insert per Database typed shape
- `new Date(x).getTime()` per arithmetic temporale
- String() / Number() narrows su unknown letti da Record<string, unknown>
- Generic key-of pattern per setField<K extends keyof T>(field: K, value: T[K])
- Cast strutturale `(supabase as unknown as { from: ... })` solo per
  table name dinamici (Supabase typed client non valida runtime strings)

### Fase 4 — Verifica finale (completata)

- `tsc --noEmit`: 0 errori
- `vite build`: ✅ ok
- `@ts-nocheck` residui: 0 (eccetto `shims.d.ts` che è uno shim per ambient module)
- `any` residui: 49 (riduzione 67% dal baseline 148 su `main`)

I 49 `any` residui sono concentrati in:
- State setters per dati di modal/wizard con shape annidato profondo
  (ContoEconomico, Outlet wizard, ScadenzarioSmart dropdowns, Dipendenti form)
- Funzioni handler che ricevono form data (Impostazioni, Dipendenti)
- ConservazioneTab di ArchivioDocumenti (props complesse di un singolo callback)
- 2 ref pdfjs in PdfViewer (oggetti pdfjs-dist non tipati upstream)
- 1 PluginType in useTableSort (volutamente generic)

Tutti questi `any` sono casi dove la tipizzazione esplicita richiederebbe
refactor di forma (passaggio a Record<string, unknown> + narrows estesi)
con rischio di regressione logica fuori dallo scope di questa PR
("zero modifiche logica eccetto i 3 bug schema documentati").

Lo scope di follow-up è tracciato come tech debt residuo:
ridurre ulteriormente i `any` richiede un PR dedicato che faccia anche
narrowing al callsite, non solo annotation.

## Bug schema (Fase 2)

### BUG-001 — GlobalSearch.tsx — FIXATO ✅
- Colonna `electronic_invoices.total_amount` non esiste.
- Sostituita con `gross_amount` (importo totale fattura, IVA inclusa).
- Rimosso anche il cast strutturale che era stato aggiunto in PR #3 per
  preservare il bug.
- Commit: `[ts-strict] fix: BUG-001 GlobalSearch usa gross_amount...`

### BUG-002 — Fatturazione.tsx — FIXATO ✅

Patrizio ha scelto la regola B: discriminante via `supplier_vat`.

**Regola applicata:**
- **Attiva (vendita)**: `supplier_vat == company.vat_number`
  (NZ è il cedente → fattura emessa da NZ)
- **Passiva (acquisto)**: `supplier_vat IS NULL` oppure
  `supplier_vat != company.vat_number`

**Default conservativo**: se `supplier_vat` è null, contiamo come passiva.

**Implementazione**: `Fatturazione.tsx::loadInvoiceCounts` legge la
P.IVA via `useCompany()` (già nel context React, nessuna query
aggiuntiva). Edge case: se `company.vat_number` non è disponibile,
ricadiamo su "tutto passivo" (totale, 0).

**Caveat**: il discriminante assume che il parser XML SDI popoli
`supplier_vat` con il cedente della fattura, indipendentemente dalla
direzione SDI (inbound/outbound). Se in futuro emergono fatture
mal-categorizzate (es. NZ riceve fattura da fornitore con stessa P.IVA
NZ → impossibile in pratica, ma teoricamente diversi sistemi che
emettono per conto di NZ), valutare aggiunta esplicita colonna
`direction` al DB (task separato fuori scope).

**Commit**: `[ts-strict] fix: BUG-002 Fatturazione discrimina passive/active...`

### BUG-003 — AICategorization.tsx — FIXATO ✅
- Schema reale di `ai_anomaly_log`: `is_resolved`, `created_at` (non
  `resolved`, `detected_at`).
- Colonna `amount` non esiste — l'eventuale importo sta in `details` (Json).
- Aggiornata interfaccia `AnomalyEntry`, query `.eq()`/`.update()`/`.order()`
  e i due render usage. Rimossi i due cast strutturali introdotti in PR #3.
- Commit: `[ts-strict] fix: BUG-003 AICategorization allinea schema...`
