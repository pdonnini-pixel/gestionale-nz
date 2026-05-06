# Deep Linking — Note di Implementazione

Branch: `feature-deep-linking`. Pattern: `useSearchParams` da React Router con tipi espliciti, validazione e fallback al default attuale.

## Wave 1 — Pagine semplici (1 stato)

| Pagina | URL param | Valori | Default |
|---|---|---|---|
| `CashflowProspettico.tsx` | `?view=` | `giornaliero`/`settimanale`/`mensile` | `mensile` |
| `Fatturazione.tsx` | `?tab=` | `passive`/`active`/`corrispettivi` | `passive` |
| `Dipendenti.tsx` | `?view=` | `consuntivo`/`organico` | `consuntivo` |
| `ConfrontoOutlet.tsx` | `?view=` | `budget`/`actual`/`variance` | `budget` |
| `AnalyticsPOS.tsx` | `?view=` | `annual`/`month` | `annual` |

Note: in `Fatturazione.tsx` il prompt indicava 2 tab (`passive`/`attive`); il file ha 3 tab (con `corrispettivi`). Persistito tutto e tre con valori ID nativi del codice.

## Wave 2 — Pagine con tab da identificare

| Pagina | URL param | Valori | Default |
|---|---|---|---|
| `TesoreriaManuale.tsx` | `?tab=` | `panoramica`/`conti`/`movimenti`/`riconciliazione` | `panoramica` |
| `SchedaContabileFornitore.tsx` | `?year=` | `latest`/`all`/`<YYYY>` | `latest` |
| `Fornitori.tsx` | `?tab=` | `anagrafica`/`analytics` | `anagrafica` |
| `ImportHub.tsx` | `?tab=` | `sources`/`overview`/`history` | `sources` |
| `Banche.tsx` | `?tab=` | `conti`/`movimenti`/`riconciliazione` | `conti` |
| `ArchivioDocumenti.tsx` | `?tab=` | `archivio`/`conservazione` | `archivio` |
| `ScadenzarioSmart.tsx` | `?section=` | `situazione`/`scadenze`/`ricorrenti`/`regole` | `scadenze` |

Note Wave 2:
- `TesoreriaManuale` e `Banche` già leggevano `?tab=…` all'avvio (deep link da altre pagine): ora i click utente persistono pure.
- `Banche` ha sub-tab interni (filtri movimenti, view chart `tipo`/`conto`) NON persistiti — Stop 2 (evita URL saturi).
- `ScadenzarioSmart` ha view annidate (`viewMode` timeline/fornitore/mese/charts, `scadViewMode` lista/calendario, `sibillTab`) NON persistite — Stop 2.
- `Fatturazione` aveva 3 tab (non 2 come da prompt iniziale): persistiti tutti.
- `SchedaContabileFornitore`: il "tab" è in realtà un selettore anno; persistito via `?year=` (number/`latest`/`all`).

## Wave 3 — Pagine multi-stato

| Pagina | URL params | Default |
|---|---|---|
| `Scadenzario.tsx` | `?tab=` (`scadenze`/`incassi`/`fornitori`/`riconciliazione`) + `?filter=` (`attive`/`tutte`/`pagate`/`sospese`/`scadute`) | `tab=scadenze`, `filter=attive` |
| `ContoEconomico.tsx` | `?periodo=` (`annuale`/`trimestrale`/`mensile`/`provvisorio`) + `?view=` (`competenza`/`cassa`/`riconciliazione`) | `periodo=annuale`, `view=competenza` |
| `BudgetControl.tsx` | `?tab=` (`bp`/`confronto`) + `?confView=` (`annuale`/`mensile`) | `tab=bp`, `confView=annuale` |

Note Wave 3:
- `Scadenzario` già leggeva `?tab=` e `?filter=` all'avvio (deep link da Scheda Contabile / Fornitori): ora i due valori sono derivati direttamente da searchParams (refresh mantiene tutto).
- `BudgetControl`: risolve esattamente il fastidio di esempio del prompt — refresh sul tab "Preventivo vs Consuntivo" non torna più a "Business Plan".
- `ContoEconomico`: il `periodType` è alimentato da uno `<select>`, quindi nell'onChange c'è un cast a `ContoPeriod` — sicuro perché le option sono generate dall'array tipato `periodi: ContoPeriod[]`.

## Stato finale

Tutte le 13 pagine del prompt aggiornate (più `CashflowProspettico` già committato in apertura branch). Nessuna pagina ha richiesto eccezioni: il pattern useSearchParams si è applicato uniformemente.


## Decisioni autonome

- Per `Fatturazione`, gli ID dei tab sono in inglese (`passive`/`active`/`corrispettivi`). Mantenuti nell'URL come sono, niente traduzione: gli URL restano stabili e leggibili.
- `replace: false` (default) su tutte le pagine: ogni cambio tab è una nuova entry in browser history, così il tasto "back" del browser fa "torna al tab precedente" come ci si aspetta.

## Eccezioni / pagine non pulite

(Annotare qui se una pagina richiede pattern diverso o viene esclusa.)
