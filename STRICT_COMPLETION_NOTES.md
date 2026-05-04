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

(da popolare dopo i fix)
