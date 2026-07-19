# Audit multi-agente Gestionale NZ — Stato lavori e handoff

> **Scopo di questo file:** memoria del lavoro di audit svolto e di ciò che resta,
> così che una nuova sessione (o Patrizio) possa ritrovare il senso nel repo senza
> ripartire da zero. Aggiornato al **2026-07-19**.
>
> **Fonte dei difetti:** `AUDIT_MULTIAGENTE_2026-07-17.md` (161 finding, con codice
> `A#`/`M#` e riferimenti `file:riga`). Questo file dice *cosa è stato fatto* e *cosa
> resta*; quello dice *cosa c'era da fare*.

---

## 0. Contesto operativo (leggere prima di continuare)

- App **in produzione** su 3 tenant. **Ogni fix va replicato su NZ + Made + Zago.**
  - NZ = `xfvfxsvqpnpvibgeqpqp` · Made = `wdgoebzvosspjqttitra` · Zago = `jxlwvzjreukscnswkbjx`
- Frontend: deploy automatico Netlify da `main` (i 3 tenant deployano dalla stessa branch).
- **Flusso:** ogni modifica su branch → PR verso `main` → merge (lo fa Claude Code) → deploy.
- **DB/migration/edge function:** in questa sessione gli strumenti **MCP Supabase**
  (`apply_migration`, `deploy_edge_function`, `execute_sql`) **funzionano** nonostante
  gli avvisi in CLAUDE.md; sono stati usati per applicare migration/deploy/verifiche sui
  3 tenant. Le migration restano comunque versionate in `supabase/migrations/`.

### Gotcha imparate (per non ripetere gli errori)
- **CI `guide-alignment`** (`tools/check-guide-alignment.mjs`): se una pagina "mappata"
  cambia, **DEVE** cambiare anche `src/data/pageGuides.ts` nello stesso diff, altrimenti
  la CI blocca la PR. ⚠️ Il bypass `[skip-guide-check]` **NON funziona nella CI delle
  PR** (il check valuta il commit di *merge* auto-generato, non i tuoi commit): serve
  una modifica reale a `pageGuides.ts`.
- **`npm run build` (vite) NON esegue tsc.** `ScadenzarioSmart.tsx` ha ~4 errori TS
  pre-esistenti (non correlati) che **non** bloccano il build. Per il typecheck usare
  `npx tsc --noEmit` filtrando via `ScadenzarioSmart.tsx`.
- **cost_center "virtuali" reali su NZ** = `all`, `rettifica_bilancio`, `sede_magazzino`
  (NON `spese_non_divise` come diceva la doc). Non hardcodare mai: distinguere gli outlet
  reali via anagrafica (vedi `src/lib/outletCostCenters.ts`).
- **Dopo un merge squash**, il branch diverge (SHA diverso). Riallineare con
  `git fetch origin main && git checkout -B <branch> origin/main`. Se un'altra PR è
  entrata su main toccando gli stessi file, fare **rebase** e risolvere i conflitti.
- I commit di merge mostrati "Unverified" sono creati da GitHub (`noreply@github.com`):
  è un falso positivo dell'hook, non vanno riscritti.

---

## 1. Cosa è stato fatto (per priorità, con PR)

La prioritizzazione post-audit era: **P1 sicurezza/accessi → P2 numeri sbagliati/
troncamenti → P3 errori silenziosi → P4 cancellazioni distruttive → P5 coerenza/
accessibilità**. Tutte chiuse e in produzione.

### Fix critici iniziali — PR #304
- Ruoli letti **solo** da `app_metadata` (mai `user_metadata`) → stop privilege escalation.
- Idempotenza invio pagamenti SEPA (`acube-payment-send`): claim idempotente per non
  inviare due volte lo stesso bonifico.
- Nota: **A-Cube PSD2/open banking è "in sospeso"** (non in uso adesso).

### Priorità 1 — Sicurezza / accessi — PR #310, #311, #312, #314
- **RBAC fail-safe** (`Impostazioni.tsx`, `Sidebar.tsx`): ruolo di default → `viewer`/
  nessuna sezione, non più `super_advisor` (prima: fail-open).
- **Toggle ambiente SDI TEST→PROD rimosso** dalla UI (rischio invio reale con un click).
- **Isolamento tenant** nei sync + avviso utenti.
- **Recupero password** (`src/pages/ResetPassword.tsx` NEW, `useAuth.resetPassword`,
  `Login.tsx`) + **occhio mostra/nascondi password**.
- **Utenti↔login reale**: la sezione Impostazioni→Utenti ora gestisce i LOGIN veri
  (`user_profiles` + Auth), non più la tabella morta `app_users`. Nuova edge function
  **`supabase/functions/admin-manage-user/`** (list/invite/set_role/set_active/delete,
  solo `super_advisor`, scoping per azienda) — **deployata sui 3 tenant**.
- **Allegati ticket** (`Ticket.tsx`): bucket `media` reso **privato** + **URL firmati**
  (createSignedUrl). Migration **`20260718_108_media_bucket_private.sql`** — **applicata
  sui 3 tenant** (bucket privato + policy lettura solo `authenticated`, verificato).
- Azione manuale di Patrizio già fatta: **config email Auth** su ogni tenant (per invito/
  recupero password).

### Priorità 2 — Numeri sbagliati / troncamenti silenziosi — PR #315
Tema: KPI/export sbagliati per cap PostgREST (1000 righe) o per cost_center virtuali.
- **Nuove utility condivise:**
  - `src/lib/fetchAllPaged.ts` — paginazione a blocchi di 1000 (`.range(0,9999)` e
    `.limit(N)` **non** aggirano il cap: troncano in silenzio).
  - `src/lib/outletCostCenters.ts` — distingue outlet reali dai cost_center virtuali
    (tenant-safe, fail-safe se anagrafica non caricata).
- **CashflowProspettico**: viste giornaliera/settimanale ora includono scadenze fiscali
  e stipendi (come la mensile); incluse fatture pagate in parte; settimana corrente parte
  da oggi (no doppio conteggio).
- **MarginiOutlet / Produttività / ScenarioPlanning**: esclusi i cost_center virtuali
  (niente falsi "outlet in perdita"); rimosso il fallback inventato "4 dipendenti";
  `budget_entries` paginato. In ScenarioPlanning i totali aziendali restano completi,
  ma numOutlet e media ricavi contano solo outlet reali.
- **MarginiCategoria**: escluse fatture `annullato` dai costi (note di credito restano,
  già negative); varianza budget pro-ratata sul periodo.
- **PrimaNota / Fatturazione**: fetch paginati (prima `.limit(5000)`/`.limit(10000)`
  troncavano export commercialista e KPI).
- **SchedaContabileFornitore**: split imponibile/IVA agganciato anche per **P.IVA**
  (il n° fattura non è univoco tra fornitori); pagamento **parziale** di una rata non
  chiude più l'intera fattura (partitario/saldo corretti).

### Priorità 3 — Errori "ingoiati" (nessun avviso) — PR #316
- **`useAuth`/`useCompany`**: retry con backoff sul caricamento profilo/aziende +
  stato `profileError`; `ProtectedRoute` mostra schermata "Riprova/Esci" invece dello
  **spinner infinito** (prima: profilo null per sempre → app bloccata).
- **Dashboard**: banner "dati incompleti" + non azzera la liquidità su errore (prima
  `catch` vuoti → "0" spacciato per dato reale).
- **Fatturazione** (passive/attive/corrispettivi): stato errore + "Riprova" distinto
  dall'archivio vuoto; fatture attive paginate.
- **ScadenzeFiscali**: `markPaid`/`handleDelete` controllano l'errore e danno toast.
- **ImportHub**: conteggio reale successi/fallimenti nell'upload multiplo.

### Priorità 4 — Cancellazioni distruttive (NO DATA LOSS) — PR #317
- **Piano dei conti / centri di costo** (`Impostazioni.tsx`): prima di un DELETE si
  contano i riferimenti (budget_entries, voci figlie, default_centers, outlet_access);
  se esistono, l'eliminazione è **bloccata** (niente orfani). DELETE solo se scollegato.
- **Scadenze fiscali**: "elimina" → **soft-delete** `status='cancelled'` (resta nello
  storico "Tutti" come "Annullato"), coerente con ScadenzarioSmart.
- **Ticket** (singolo e in blocco): rimossi gli allegati dallo storage prima di
  cancellare la riga (niente file orfani).
- **Documenti outlet**: verificato che già rimuove il file dallo storage — ok.
- Nota: `app_users` DELETE già rimosso in P1; toggle SDI/RBAC già in P1.

### Priorità 5 — Coerenza d'uso e accessibilità — PR #318
- **Toast** (`components/Toast.tsx`): rimosso il backdrop a tutto schermo che bloccava
  il primo click per ~10s; durate per tipo (success 4.5s / errori 8s); id incrementale
  (no collisione `Date.now()`); `role=status`+`aria-live`.
- **StoreManager**: badge "Dati simulati (demo)" + rimossi nomi reali dipendenti
  hardcoded (erano dati NZ visibili su Made/Zago) → "Dipendente 1..4".
- **Selettore periodo** (`Layout.tsx`): nascosto sulle pagine che lo ignorano
  (Ticket, Impostazioni, Archivio, Import Hub, Storico Distinte, Scadenze Fiscali,
  Report Sincronizzazioni, Profilo, AI Categorie) — prima ingannava.
- **Componente modale accessibile NEW** `src/components/ui/Modal.tsx`
  (`Modal` + `ConfirmModal`): `role="dialog"`, `aria-modal`, Escape, focus trap, focus
  restituito, aria-label sulla X. Modalità **`bare`** (conserva l'aspetto del pannello),
  `containerClassName`/`panelClassName`/`closeOnBackdrop`.

### Migrazione modali (batchabile della P5) — PR #319
- ~30 finestre migrate a `ui/Modal` (modalità bare, aspetto invariato) in 21 file:
  componenti (InvoiceViewer, OutletWizard, CostiRicorrenti, FinanziamentiTab,
  ContractUploader, ExportBilancioDialog, OpenBankingAcube, OutletValutazione) e pagine
  (Outlet, TesoreriaManuale, Ticket, TicketAdmin, BudgetControl, ImportHub,
  ScadenzeFiscali, Dipendenti, Fornitori, ContoEconomico, CashflowProspettico,
  AccountDetail, ArchivioDocumenti, ScadenzarioSmart).
- **Pattern elegante**: dove esiste un `Modal` locale (Dipendenti, ScadenzarioSmart) è
  stato riscritto per **delegare** a `ui/Modal` → tutte le sue finestre accessibili in
  un colpo.
- **Form protetti** con `closeOnBackdrop={false}`; **drawer/slide-over esclusi** di
  proposito (non sono dialog centrati).
- Eseguita con agenti in parallelo + revisione/fix manuale (null-safety TS,
  `closeOnBackdrop`, un file rimasto rotto).

### Audit MOBILE (sessione separata) — PR #320 (+ commit mobile-1…7)
Fatto da un'altra sessione mentre giravano le modali. Copre usabilità smartphone:
viewport `dvh`, safe-area iOS, no zoom input, tabelle scrollabili, target touch,
dialog semantici, pulizia dead code. **Da tenere presente**: ha già toccato molti file
UI; la migrazione modali (#319) è stata rebasata sopra e i due lavori sono stati fusi
(le finestre usano `ui/Modal` **e** conservano `dvh`/`overscroll-contain`).

---

## 2. Artefatti chiave creati (dove guardare)

| File | Cosa |
|---|---|
| `src/lib/fetchAllPaged.ts` | Paginazione anti-cap 1000 righe PostgREST |
| `src/lib/outletCostCenters.ts` | Outlet reali vs cost_center virtuali (tenant-safe) |
| `src/components/ui/Modal.tsx` | `Modal` + `ConfirmModal` accessibili (bare mode) |
| `src/lib/dateLocal.ts` | Utility date locali (todayYMD, lastDayOfMonthYMD, …) |
| `src/pages/ResetPassword.tsx` | Pagina reset password |
| `supabase/functions/admin-manage-user/` | Gestione login/utenti (deployata 3 tenant) |
| `supabase/migrations/20260717_106_*` | Company settings sede strutturata |
| `supabase/migrations/20260718_107_*` | RPC atomiche save bilancio/budget |
| `supabase/migrations/20260718_108_*` | Bucket `media` privato (applicata 3 tenant) |

---

## 3. Cosa resta da fare (deferred)

Ordine indicativo di valore/urgenza. Riferimenti ai finding in
`AUDIT_MULTIAGENTE_2026-07-17.md`.

### 3.1 Modali — completare la migrazione (bassa complessità)
- Restano gli **overlay non-modali** volutamente esclusi: drawer/slide-over
  (es. Fatturazione dettaglio fattura attiva), `GlobalSearch`, drawer mobile `Sidebar`.
  Se si vuole uniformare anche i drawer, `ui/Modal` bare + `containerClassName` può
  reggerli, ma vanno valutati caso per caso (non sono dialog centrati).
- Verificare a campione sul sito live i `closeOnBackdrop` dei form (nessun form deve
  chiudersi cliccando fuori e perdere l'input).

### 3.2 Cancellazioni/dead code (NO DATA LOSS)
- **M55 — 5 pagine morte non instradate** (`Scadenzario.tsx`, `Banche.tsx`,
  `CashFlow.tsx`, `Importazioni.tsx`, e `Contratti.tsx`): ~7.700 righe con logica
  divergente e pericolosa (insert senza company_id, fetch non paginati). ⚠️
  **`PrimaNota.tsx` NON è morta** (riusata come tab in TesoreriaManuale). Rimuoverle in
  una PR dedicata dopo aver verificato con grep che nessun import residuo esista.

### 3.3 Numeri/logica non ancora affrontati (P2 estesa)
- **A34/A35 — MarginiCategoria**: costo per outlet come `max(payables, banca)` è
  euristica errata quando le fonti sono disgiunte; bucket `_company` incoerente tra KPI
  e "Struttura Costi". Serve dedup reale (usare `reconciliation_log`). **Rimandato**
  perché rischioso sui dati di Lilian.
- **A41 — Scadenzario/ModalRateizza**: ultima rata calcolata con quota non arrotondata
  (somma rate ≠ totale). Fix già presente in `ScadenzarioSmart.computeInstallments`.
- **A43/A44 — ScadenzarioSmart**: fetch `cash_movements`/`payable_actions` non paginati
  (colonna CONTO parziale oltre 1000 righe); chiusura manuale fatture su stato client
  stale → **lost update** con più operatrici (serve RPC atomica).
- **A37 — OpenToBuy**: il KPI "sell-through" non è un sell-through (formula errata).
- **A39 — Produttività**: (fatto il trend) verificare la nota "(stima)" residua in tabella.

### 3.4 Errori silenziati residui (P3 estesa)
- Molte altre query con `catch` vuoti / `console.warn` (AICategorization limit 500,
  GlobalSearch race, ecc.). Estrarre un helper `fetchOrNull(query,label)` che propaga
  gli errori a uno stato mostrato in pagina (proposto in A19/A20).

### 3.5 Accessibilità/UX (P5 estesa)
- **Migrare le ~45 modali storiche restanti** al componente (in corso: fatte ~30).
- **Tabelle/righe cliccabili**: ordinamento e apertura riga solo col mouse; aggiungere
  `role="button"`, `tabIndex`, gestione Enter/Space, `aria-describedby` sui Tooltip.
- **M18 — KpiCard duplicato**: ~7 implementazioni locali invece del componente condiviso
  `components/ui/KpiCard` → unificare.
- **A40 — RevisionePagamenti**: il pannello di revisione manageriale è codice morto e
  "Salva e applica" applica TUTTE le proposte pendenti dell'azienda. Da chiarire il
  flusso (due passi vs "salva=applica") e allineare codice+guida.
- **Selettori anno/filtri** non persistenti e non uniformi tra pagine analytics (M54).

### 3.6 Manuale / esterno
- **Nessuna azione manuale in sospeso** al 2026-07-19 (migration 108 applicata,
  edge function deployata, email config fatta).
- Se si riattiva **A-Cube PSD2/open banking** o **SDI invio reale**: servono
  credenziali/accreditamento (vedi protocolli STOP & ASK in CLAUDE.md).

---

## 4. Come riprendere in una nuova sessione

1. Leggere `CLAUDE.md` (regole granitiche: NO DATA LOSS, parità 3 tenant, guide allineate).
2. Leggere `AUDIT_MULTIAGENTE_2026-07-17.md` per il dettaglio dei finding (`A#`/`M#`).
3. Leggere questo file per lo stato.
4. Scegliere un blocco dalla sezione 3, lavorare su branch, PR, CI verde, merge.
5. Ricordare: **ogni fix su 3 tenant**, **aggiornare `pageGuides.ts`** se cambia una
   pagina mappata, **niente valori hardcoded per tenant**.
