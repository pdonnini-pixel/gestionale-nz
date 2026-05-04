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

(da popolare durante il cleanup)

## Bug schema (Fase 2)

### BUG-001 — GlobalSearch.tsx — FIXATO ✅
- Colonna `electronic_invoices.total_amount` non esiste.
- Sostituita con `gross_amount` (importo totale fattura, IVA inclusa).
- Rimosso anche il cast strutturale che era stato aggiunto in PR #3 per
  preservare il bug.
- Commit: `[ts-strict] fix: BUG-001 GlobalSearch usa gross_amount...`

### BUG-002 — Fatturazione.tsx — IN ATTESA DECISIONE PATRIZIO ⏸️

`Fatturazione.tsx` righe 1327-1328 fa:
```ts
supabase.from('electronic_invoices').select('id', { count: 'exact', head: true }).eq('direction', 'inbound')
supabase.from('electronic_invoices').select('id', { count: 'exact', head: true }).eq('direction', 'outbound')
```

Verificato: la colonna `direction` non esiste su `electronic_invoices`. La
query produce `400 Bad Request` a runtime. Possibili discriminanti reali nello
schema:
- `source` (enum `import_source`): valori `csv_banca | csv_ade | csv_pos |
  api_pos | api_ade | manuale | csv_fatture | xml_sdi | pdf_bilancio |
  csv_cedolini | api_yapily`. Nessun valore parla di inbound/outbound.
- `tipo_documento` (string FatturaPA): TD01=fattura, TD04=nota credito,
  ecc. Distingue tipi documento, NON direzione.
- Discriminante semantico: confronto `supplier_vat` con la P.IVA della
  company → costoso e fragile.

**Stop concordato**: chiesto a Patrizio quale sia l'intento originale e come
distinguere passive/active.

### BUG-003 — AICategorization.tsx — FIXATO ✅
- Schema reale di `ai_anomaly_log`: `is_resolved`, `created_at` (non
  `resolved`, `detected_at`).
- Colonna `amount` non esiste — l'eventuale importo sta in `details` (Json).
- Aggiornata interfaccia `AnomalyEntry`, query `.eq()`/`.update()`/`.order()`
  e i due render usage. Rimossi i due cast strutturali introdotti in PR #3.
- Commit: `[ts-strict] fix: BUG-003 AICategorization allinea schema...`
