# AUDIT_OUTLET_NOTES — Sostituzione sistematica stringhe UI "outlet" → labels dinamiche

> Working notes per `feature-audit-outlet-residui`.
> Riferimenti: `PROMPT_AUDIT_OUTLET_RESIDUI.md`.

---

## F0 — Audit grep

`grep -rn -i 'outlet' src/ --include='*.tsx' --include='*.ts'` → **2322** occorrenze totali in **47** file.

Pattern filtrato per stringhe UI (`>...<`, `placeholder=`, `title=`, `aria-label=`) → ~60 occorrenze categoria A da fixare.

### Categorizzazione

- **A — Stringa UI**: ~60 in ~25 file (da fixare con `labels`)
- **B — Nome tecnico**: variabili JS, `from('outlets')`, `outlet_id`, `outlet.code`, `setSelectedOutlet`, `OutletWizard` → lasciare
- **C — Commento JSDoc/inline**: `formatters.ts`, `useCompanyLabels.ts` → lasciare
- **D — Route/URL**: `/outlet`, `/confronto-outlet`, `<PageHelp page="outlet">` → lasciare
- **E — Import/Export**: `import Outlet from`, `OutletWizard`, ecc. → lasciare
- **`src/types/database.ts`**: 32 occorrenze `referencedRelation: "outlets"` → DB identifier, lasciare

### File con stringhe UI da fixare (lista)

```
src/components/ContractUploader.tsx        1
src/components/CostiRicorrenti.tsx         2
src/components/GlobalSearch.tsx            1
src/components/OutletValutazione.tsx       1
src/pages/AllocazioneFornitori.tsx         6
src/pages/AnalyticsPOS.tsx                 1
src/pages/Banche.tsx                       1
src/pages/BudgetControl.tsx                3
src/pages/CashflowProspettico.tsx          1
src/pages/ConfrontoOutlet.tsx              7
src/pages/ContoEconomico.tsx               4
src/pages/Dipendenti.tsx                   3
src/pages/Fatturazione.tsx                 2
src/pages/Fornitori.tsx                    1
src/pages/ImportHub.tsx                    2
src/pages/Importazioni.tsx                 2
src/pages/Impostazioni.tsx                 1
src/pages/MarginiCategoria.tsx             2
src/pages/MarginiOutlet.tsx                4
src/pages/Onboarding.tsx                   1
src/pages/OpenToBuy.tsx                    5
src/pages/Outlet.tsx                       3
src/pages/Produttivita.tsx                 4
src/pages/ScenarioPlanning.tsx             5
src/pages/Scadenzario.tsx                  1
src/pages/StockSellthrough.tsx             2
```

### NON toccare (categorie B/C/D/E)

- `src/types/database.ts` (auto-generato)
- `src/lib/formatters.ts` (JSDoc commenti)
- `src/hooks/useCompanyLabels.ts` (commenti + fallback hardcoded)
- `src/components/OutletWizard.tsx:117` `<option value="outlet">` (valore SQL `outlet_type`)
- Tutti i nomi variabili: `outletLabel`, `outlet.code`, `outlet_code`, `outlet_id`, `formatOutletName`, `shortOutletName`, `currentOutlet`, `row.outlet`, ecc.

---

## Stato fasi

| Fase | Stato |
|---|---|
| F0 — Setup + audit | ✅ |
| F1 — Fix batch 1 (components/onboarding) | ✅ |
| F1 — Fix batch 2 (pagine outlet) | ✅ |
| F1 — Fix batch 3 (pagine finanziarie) | ✅ |
| F1 — Fix batch 4 (pagine HR/operative) | ✅ |
| F3 — typecheck/build/reset/PR | ✅ |

---

## Riepilogo sostituzioni

| File | n. sostituzioni | Note |
|---|---|---|
| `components/ContractUploader.tsx` | 1 | `useCompanyLabels` aggiunto |
| `components/CostiRicorrenti.tsx` | 2 | hook già presente |
| `components/GlobalSearch.tsx` | 1 | hook aggiunto |
| `components/OutletValutazione.tsx` | 1 | hook aggiunto, placeholder con label |
| `pages/AllocazioneFornitori.tsx` | 6 | hook aggiunto a 5 sub-components (DirettoForm/SplitPctForm/SplitValoreForm/QuoteUgualiForm/RuleSummary) |
| `pages/AnalyticsPOS.tsx` | 1 | hook già presente |
| `pages/Banche.tsx` | 1 | hook già presente |
| `pages/BudgetControl.tsx` | 4 | hook aggiunto (subtitle, KPI Store, intro, label sopra select) |
| `pages/CashflowProspettico.tsx` | 1 | hook aggiunto |
| `pages/ConfrontoOutlet.tsx` | 6 | hook già presente |
| `pages/ContoEconomico.tsx` | 3 | hook aggiunto |
| `pages/Dipendenti.tsx` | 3 | hook già presente |
| `pages/Fatturazione.tsx` | 2 | hook già presente |
| `pages/Fornitori.tsx` | 1 | hook aggiunto |
| `pages/ImportHub.tsx` | 2 | hook aggiunto |
| `pages/Importazioni.tsx` | 2 | hook aggiunto a `UploadArea` |
| `pages/Impostazioni.tsx` | 1 | hook aggiunto a `UserSection` |
| `pages/MarginiCategoria.tsx` | 2 | hook già presente |
| `pages/MarginiOutlet.tsx` | 3 | hook già presente |
| `pages/OpenToBuy.tsx` | 5 | hook già presente |
| `pages/Outlet.tsx` | 3 | hook già presente |
| `pages/Produttivita.tsx` | 5 | hook già presente |
| `pages/Scadenzario.tsx` | 1 | hook già presente |
| `pages/ScenarioPlanning.tsx` | 7 | hook aggiunto |
| `pages/StockSellthrough.tsx` | 2 | hook già presente |
| **Totale** | **~63 sostituzioni in 25 file** | |

### Casi NON toccati (intenzionalmente)

- `src/types/database.ts` (32 occorrenze `referencedRelation: "outlets"`) — auto-generato dal DB schema
- `src/lib/formatters.ts` — commenti JSDoc
- `src/hooks/useCompanyLabels.ts` — commenti + fallback hardcoded
- `src/components/OutletWizard.tsx:117` — `<option value="outlet">Outlet</option>` valore SQL `outlet_type`
- `src/pages/Onboarding.tsx:636` — placeholder "Es. Outlet" è ESEMPIO nello step wizard dove l'utente IMPOSTA `pointOfSaleLabel`
- Tutti i riferimenti a variabili JS (`{c.outlet_code}`, `{row.outlet}`, `{currentOutlet?.label}`, `{outletLabel}`, `formatOutletName(name)`, `shortOutletName(name)`, `outletMargins.length`, `baseline.numOutlet`, `baseline.avgRicaviOutlet`, `costiNuovoOutlet`, `riconData.costiOutlet`)
- Route/URL: `/outlet`, `/confronto-outlet`, `<PageHelp page="outlet">`
- Import: `OutletWizard`, `OutletValutazione`, `useOutlets`

---

## Decisioni autonome chiave

1. **Pluralizzazione semantica**: titoli/intestazioni che si riferiscono a TUTTI gli outlet del tenant usano `labels.pointOfSalePlural` (es. "Margini per Outlet" → "Margini per Outlet" su NZ, ma "Margini per Negozio" su Made — singolare ITALIANO è più naturale per il titolo della pagina). Riferimenti tipo "Tutti gli outlet" usano `labels.pointOfSalePluralLower` (es. "Tutti gli outlet" / "Tutti gli negozi"). Articolo italiano "gli" mantenuto per ogni caso (grammaticalmente perfetto per "outlet/negozi"; lievemente innaturale per "boutique" — accettabile).

2. **Sub-component hook**: per file con stringhe UI dentro componenti helper interni (Importazioni.UploadArea, Impostazioni.UserSection, AllocazioneFornitori 5 sub-form, Outlet.StaffTab), `useCompanyLabels` è chiamato direttamente nel sub-component invece di passare `labels` come prop. Soluzione più pulita, zero prop-drilling.

3. **`Onboarding.tsx:636` placeholder "Es. Outlet" intenzionalmente NON toccato**: è la schermata che IMPOSTA `pointOfSaleLabel`. Sostituire con la label dinamica creerebbe un placeholder vuoto al primo render (quando company non c'è ancora). "Outlet" è un esempio coerente con il chip "Outlet" sopra l'input.

4. **`OpenToBuy.tsx:268` "Media dei 7 outlet"**: cambiato in `Media dei {LEGACY_OUTLETS.length} {labels.pointOfSalePluralLower}` — il numero `7` era hardcoded mentre `LEGACY_OUTLETS.length` è la lunghezza reale dell'array mock data.

5. **`AllocazioneFornitori.tsx` 5 sub-components**: hook aggiunto a ognuno separatamente. Pro: zero prop-drilling, isolato per ogni sub-component. Con: 5 chiamate `useCompany` invece di 1 — trascurabile (Context React è memoizzato).

---

## Verifiche

| Check | Risultato |
|---|---|
| `npm run typecheck` | ✅ zero errori |
| `npx vite build` | ✅ pulito (2.99s) |
| `check-version-drift` | ✅ Made + Zago entrambi a 14/14 migrazioni |
| **NZ invariato** | ✅ `budget_entries=816, outlets=7, companies=1, label="Outlet"` |
| Made + Zago resettati vergini | ✅ |
| Residui categoria A | ✅ zero (solo placeholder Onboarding intenzionale) |

---

## Limitazioni residue note

- **Pluralizzazione grammaticale**: "agli outlet" / "agli negozi" / "agli boutique" — l'articolo `gli` è corretto per "outlet" (vocale + s+consonante eccezione) ma non sempre per altre label. Soluzione strutturale (helper `pointOfSaleArticle('a'|'di'|'in')`) → task separato se l'imprecisione disturba.
- **`formatOutletName()` / `shortOutletName()`** in `lib/formatters.ts` — funzioni di formatazione che operano su dati DB. Nome funzione tecnico, non visibile UI.
- **`PageHelp page="outlet"`**: identificatore di pagina di help statico, non label visibile.
