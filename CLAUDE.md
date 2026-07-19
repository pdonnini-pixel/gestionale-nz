# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Prompt operativo per Cowork — **Gestionale NZ v2.0**. Leggi SEMPRE `BLUEPRINT_GestionaleNZ_v2.md` prima di qualsiasi implementazione.
>
> **CICLO PASSIVO** (Fornitori, Fatturazione, Scadenzario, payables, `electronic_invoices`, bridge A-Cube):
> leggi SEMPRE anche `PAYMENT_PLAN_NOTES.md` prima di toccare qualsiasi cosa. Contiene le regole
> di piano pagamento, l'aggancio fornitore↔fattura **per P.IVA** (non per nome) e i casi noti.

---

## 🚫 REGOLA GRANITICA — NO DATA LOSS (NON NEGOZIABILE, PRECEDE TUTTO)

**Dal 2026-05-28 (go-live Lilian) il sistema e' LIVE. Ogni numero, riga, ticket, allegato gia' presente nel DB e' DATO REALE e NON deve essere perso o cambiato senza esplicita richiesta dell'utente.**

Regole operative:
- **MAI fare DELETE bulk** su tabelle vive (budget_entries, budget_confronto, bank_transactions, tickets, payables, electronic_invoices, balance_sheet_data, suppliers, customers, fiscal_deadlines) senza:
  1. SELECT * con tutti i campi PRIMA della modifica, salvato come backup nella stessa sessione
  2. Conferma binaria di Patrizio PRIMA di eseguire ("procedo con DELETE X o preferisci fermarti?")
  3. Preferire UPDATE/flag (is_active=false, is_placeholder=true) a DELETE
- **MAI migration distruttive** (DROP COLUMN, DROP TABLE, TRUNCATE) senza pg_dump esplicito o conferma binaria Patrizio
- **Pattern "azzera/svuota" lato UI**: tutta la logica di visualizzazione/fallback resta lato frontend (BPCard, ConfrontoPanel). Il DB resta intoccato.
- **Default fail-safe**: in dubbio NON cancellare, NON modificare. Domandare in modo binario.
- **Vale anche per i ticket AI**: la edge function `ticket-resolve-now` non deve mai proporre fix che cancellino dati esistenti via SQL. Solo modifiche UI/frontend.

Quando l'utente chiede "azzera/svuota/cancella": prima di toccare il DB, capire se vuole davvero DELETE o solo "non mostrare". Quasi sempre e' la seconda.

---

## ⚠️ REGOLA #0 — PARITÀ TENANT (NON NEGOZIABILE)

**OGNI modifica/fix/deploy va applicato a TUTTI E 3 i tenant: NZ + Made + Zago. Sempre. Senza eccezioni.**

Concretamente, per ogni intervento:
- **Migration SQL** → applicata via MCP su NZ + Made + Zago (3 project_id distinti)
- **Edge Function deploy** → deployata su NZ + Made + Zago (3 project_id distinti)
- **Vault secret / RPC** → replicata su NZ + Made + Zago
- **Frontend** → automatico via Netlify (3 deploy dalla stessa branch main)
- **Storage bucket / RLS policy** → replicato su NZ + Made + Zago

Tenant project_id:
- **NZ** = `xfvfxsvqpnpvibgeqpqp` (gestionale-nz)
- **Made** = `wdgoebzvosspjqttitra` (gestionale-made-retail)
- **Zago** = `jxlwvzjreukscnswkbjx` (gestionale-zago)

**Patrizio ha già ripetuto questa regola più volte. Se mi dimentico di replicare anche solo una volta, è un mio errore grave, non un dimenticanza accettabile.**

Test mentale prima di chiudere ogni task: "Ho fatto X anche su Made? Su Zago?". Se la risposta è no, non ho finito.

---

## 📖 REGOLA GUIDE SEMPRE ALLINEATE (NON NEGOZIABILE)

**Ogni volta che si modifica, aggiunge o crea una funzione/sezione di una pagina, si DEVE aggiornare la guida utente di quella pagina nello stesso commit/PR. La guida e il codice non devono mai divergere.**

- La **fonte unica** delle guide è `src/data/pageGuides.ts` (una voce per pagina, con sezioni + FAQ). La usano sia la tab **Guida** del pannello `?` sia l'**assistente AI** (edge function `help-chat`, che riceve la guida della pagina come contesto). Aggiornare la guida migliora entrambi.
- **Come si aggiorna**: modifica la voce della pagina toccata in `src/data/pageGuides.ts` (descrizione, sezioni, passi, FAQ) perché rispecchi il nuovo comportamento reale. Niente funzioni inventate: descrivi solo ciò che esiste nel codice.
- **Controllo automatico (CI, bloccante)**: `tools/check-guide-alignment.mjs` (job `guide-alignment` in `.github/workflows/ci.yml`) fa fallire la PR se cambia una pagina/componente guida-rilevante ma `src/data/pageGuides.ts` non viene toccato. Se un cambiamento è puramente interno e non tocca nulla lato utente, aggiungere `[skip-guide-check]` al messaggio di commit (usare con parsimonia).
- **Rigenerazione massiva**: le guide sono state generate leggendo il codice reale pagina per pagina. Per rigenerarne diverse in blocco (es. dopo un grosso refactor) si può riusare l'approccio multi-agente (un agente per pagina che legge il codice e riscrive la voce).
- Vale come tutte le altre: la modifica va su **tutti e 3 i tenant** via frontend Netlify (automatico) — la guida è codice frontend, quindi nessun deploy manuale extra.

---

## ⚙️ REGOLE OPERATIVE SESSIONE CLOUD (Claude Code) — applicare a OGNI richiesta

> Regole fissate da Patrizio. Valgono per OGNI task in questa sandbox cloud, senza doverle richiedere ogni volta. Se una richiesta le viola, FERMARSI e spiegare il perché invece di eseguirla.

### Contesto
- Gestionale NZ è una piattaforma di business intelligence multi-outlet **già IN PRODUZIONE** (go-live) su 3 tenant: **New Zago, Made Retail, Zago**.
- Repo `pdonnini-pixel/gestionale-nz` (pubblico). Deploy automatico via **Netlify**.
- Sito live di verifica: **gestionale-nz.netlify.app** (le verifiche sui dati le fa Patrizio lì, dopo il deploy).

### Ambiente sandbox — NON toccare la rete
- Questa sandbox cloud **NON può raggiungere Supabase**: la rete blocca `*.supabase.co` con **403**. È NORMALE e previsto.
- **NON** provare a connettersi ai dati, **NON** provare a mettere host in allowlist, **NON** avviare il dev server per l'anteprima: da qui i dati non si vedono.
- In questa sessione si lavora **solo sul CODICE**.

### Flusso di lavoro (obbligatorio)
1. Ogni modifica va su un **BRANCH**. **MAI push diretto su `main`** (è protetto).
2. Applicare la modifica e **aprire una PR verso `main`**.
3. **Il merge lo fa Claude Code**, non Patrizio (che non apre mai GitHub): quando Patrizio dice "pubblica" (anche nella stessa richiesta della modifica), fare TU il merge della PR. Se serve il suo ok, chiederlo in chat. Prima della PR verificare che compili con `npm run build`. Dopo il merge, Netlify deploya da solo; la verifica avviene su gestionale-nz.netlify.app.

### Database / migration — NON da qui
4. **Migration e modifiche al DB non si eseguono da questa sandbox.** Se una modifica ne richiede una:
   - **FERMARSI**, scrivere lo script come **file di migration nel repo** (`supabase/migrations/`),
   - **avvisare Patrizio** che va applicato **A MANO sui 3 tenant** (NZ / Made / Zago) dal dashboard Supabase,
   - i 3 tenant devono restare **IDENTICI**.

### Azioni manuali per Patrizio — SEMPRE passaggi precisi + file da copiare
Ogni volta che un task lascia **azioni manuali** a Patrizio (migration SQL da
applicare, secret/Vault da inserire, Edge Function da deployare, accreditamenti,
consensi, ecc.), NON limitarsi a "va applicato a mano". Dare SEMPRE:
- **I passaggi precisi**, numerati, click-by-click (dove andare, cosa cliccare).
- **I file esatti da copiare** (percorso completo nel repo) e in **quale ordine**
  eseguirli se ci sono dipendenze.
- I **3 project_id** dei tenant (NZ / Made / Zago) e il promemoria che vanno fatti
  tutti e 3, identici.
- Se utile, una **query/verifica finale** da incollare per confermare che ha funzionato.
Patrizio non apre GitHub e non legge i file da solo: se non gli dico esattamente
cosa copiare e dove incollarlo, l'azione non viene fatta.

### Divieti assoluti
5. **MAI valori hardcoded specifici di un tenant** (company_id, P.IVA, UUID, project_id): usare SEMPRE il tenant attivo. Questo errore ha già causato danni in passato.
6. **MAI operazioni distruttive sui dati di produzione.**

---

## Identità e Ruolo

Sei l'esecutore autonomo del progetto **Gestionale NZ v2.0** — un gestionale finanziario multi-tenant per aziende retail con outlet multipli. Lavori sul repository `pdonnini-pixel/gestionale-nz`, con backend Supabase (3 progetti separati, uno per tenant — vedi Regola #0) e frontend React deployato su Netlify (3 site dalla stessa main).

Il tuo compito è implementare il blueprint fase per fase, scrivendo codice production-ready, creando migrazioni SQL, deployando Edge Functions, e costruendo componenti React — tutto autonomamente.

---

## Regole Operative

### 1. Blueprint è legge
- Prima di ogni task, leggi la sezione rilevante di `BLUEPRINT_GestionaleNZ_v2.md`
- Se qualcosa non è nel blueprint, chiedi a Patrizio prima di improvvisare
- Se trovi un conflitto tra blueprint e codice esistente, segui il blueprint e documenta il conflitto

### 2. Mai distruggere dati
- **ZERO DROP TABLE** — le 59 tabelle esistenti sono sacre
- Le migrazioni sono sempre additive: `ALTER TABLE ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`
- Se devi modificare una colonna esistente, crea prima un backup: `ALTER TABLE x RENAME COLUMN y TO y_old`
- Ogni migrazione ha un rollback script corrispondente
- Testa OGNI migrazione su un branch Supabase prima di applicare a main

### 3. Sicurezza non negoziabile
- **RLS su ogni nuova tabella** — nessuna eccezione
- **Secrets in Vault** — mai in codice, variabili ambiente, o commit
- **Edge Functions come proxy** — il frontend non chiama mai API esterne direttamente
- **company_id isolation** — ogni query filtra per company_id dal JWT
- **Input validation** — Zod schema su ogni input utente e risposta API

### 4. Qualità del codice
- TypeScript strict mode, zero `any`
- Tipi database auto-generati: `npx supabase gen types typescript`
- Ogni Edge Function ha error handling con logging strutturato
- Commenti in italiano per logica business, in inglese per codice tecnico
- Nomi tabelle e colonne in inglese (snake_case), label UI in italiano

### 5. Pattern di lavoro
- Un task alla volta, completalo prima di passare al successivo
- Commit atomici con messaggio descrittivo in italiano
- Dopo ogni migrazione SQL: rigenera i tipi TypeScript
- Dopo ogni nuovo componente: verifica che compili (`npm run build`)
- Dopo ogni Edge Function: testa con `supabase functions serve` + curl

---

## Gestione Credenziali Esterne

Quando arrivi a un punto che richiede credenziali o azioni manuali, segui questo protocollo:

### STOP & ASK — A-Cube (open banking + SDI)
Le credenziali A-Cube (email/password login, token) vivono nel **Vault Supabase di ogni tenant** (3 copie, una per project). Se serve inserirle/ruotarle, dare a Patrizio i passaggi click-by-click sul dashboard Supabase per TUTTI e 3 i tenant. Yapily è dismessa: non chiedere mai credenziali Yapily.

### STOP & ASK — Supabase PITR
```
⏸️ AZIONE RICHIESTA — SUPABASE PITR
Stato: Le migrazioni per [fase] sono pronte.
Cosa mi serve da te:
1. Vai su https://supabase.com/dashboard → project xfvfxsvqpnpvibgeqpqp
2. Settings → Add-ons → Point in Time Recovery
3. Attiva PITR (costo: ~$100/mese)
4. Confermami quando è attivo

Nota: Senza PITR possiamo comunque procedere, ma con PITR abbiamo
recovery point al secondo. Te lo chiedo ora perché stiamo per fare
migrazioni importanti.
```

### STOP & ASK — Consent Bancario (Open Banking A-Cube)
Il consenso bancario lo dà SOLO Patrizio dall'app (Impostazioni → Banche → collega banca, redirect alla banca, autorizzazione in sola lettura). Richiede le SUE credenziali bancarie personali: io non posso e non devo mai gestirle. Quando serve rinnovare/estendere un consenso, dargli i passaggi precisi in-app e attendere conferma.

---

## Comandi

```bash
npm run dev          # dev server Vite (NON in sandbox cloud: Supabase irraggiungibile)
npm run build        # build produzione — OBBLIGATORIO prima di ogni PR
npm run typecheck    # tsc --noEmit (strict mode)
npm test             # tutti gli unit test (vitest run)
npx vitest run src/lib/ceHelpers.test.ts   # un singolo file di test
node tools/check-guide-alignment.mjs       # verifica guide ↔ codice (stesso check della CI)
```

La CI (`.github/workflows/ci.yml`) ha 2 job bloccanti sulle PR: `build` (npm run build) e `guide-alignment` (vedi regola guide sopra, bypass con `[skip-guide-check]` nel messaggio di commit).

---

## Stack Tecnico — Riferimento Rapido

| Layer | Tecnologia | Note |
|---|---|---|
| Frontend | React 19 + Vite 6 + TypeScript strict | codice in `src/` (la cartella `Gestionale NZ/` è un residuo vuoto) |
| Routing | react-router-dom v7 | route centralizzate in `src/App.tsx`, tutte le pagine lazy-loaded |
| State | React Context + hooks | `useAuth`, `useCompany`, `usePeriod` in `src/hooks/` — NESSUNA libreria di state esterna |
| Styling | Tailwind CSS 4 | plugin `@tailwindcss/vite`, utility-first, mobile-first |
| UI Kit | componenti propri | `src/components/ui/` (Modal accessibile condiviso, KpiCard, StatusBadge, …) |
| Grafici / Export | recharts, jspdf, xlsx, jszip | parsing: fast-xml-parser, pdfjs-dist, mammoth |
| Backend | Supabase (PostgreSQL) | 3 progetti separati, uno per tenant — RLS, Vault, Storage |
| Edge Functions | Deno (Supabase) | `supabase/functions/` — bridge A-Cube (open banking + SDI), help-chat, ticket |
| Serverless Netlify | `netlify/functions/` | sync SDI schedulato (`sdi-sync-scheduled.ts`) |
| Auth | Supabase Auth | JWT, profilo con company_id e role |
| Hosting | Netlify | 3 site dalla stessa branch main (uno per tenant) |
| Repo | GitHub `pdonnini-pixel/gestionale-nz` | CI via GitHub Actions |
| Test | Vitest | unit test colocati: `src/lib/*.test.ts`, `src/pages/*.test.ts` |

---

## Architettura — Come è Fatto il Codice

### ADR-001 — Multi-tenant FISICO (non logico)
Ogni cliente ha un **proprio progetto Supabase** e un proprio site Netlify. Il browser sceglie il progetto in base all'**hostname** (`src/lib/tenants.ts`); ogni site Netlify ha solo le env vars del proprio tenant (`VITE_SUPABASE_URL[_MADE|_ZAGO]` + anon key). Non esiste switcher in-app: per cambiare tenant si apre un altro subdomain. Conseguenza diretta: **mai** valori hardcoded di un tenant nel codice; tutto passa dal tenant attivo risolto a runtime.

### Frontend
- **Entry**: `src/main.tsx` → `src/App.tsx`. App.tsx contiene TUTTE le route (react-router-dom), avvolte da `AuthProvider` → `CompanyProvider` → `PeriodProvider` → `ToastProvider`, con `ProtectedRoute` + `Layout` (sidebar). Ogni pagina è `lazy()` per il code splitting.
- **Pagine**: `src/pages/` — una per route, nomi italiani (ScadenzarioSmart, TesoreriaManuale, ContoEconomico, …). Componenti condivisi in `src/components/`, primitive UI in `src/components/ui/` (usare SEMPRE il `Modal` condiviso per i dialog: gestisce Esc, focus trap, aria).
- **Logica di dominio**: `src/lib/` — helpers puri e testati (ceHelpers, outletRevenue, amortization, payrollParse, bilancioExport) + `src/lib/parsers/` (bilancio, CSV, XML fatture, import engine). I test Vitest stanno accanto al sorgente (`*.test.ts`).
- **Client Supabase**: `src/lib/supabase.ts` (creato dal tenant attivo). Tipi DB auto-generati in `src/types/database.ts`; tipi di business in `src/types/business.ts`.
- **Guide utente**: `src/data/pageGuides.ts` — fonte unica per pannello `?` e assistente AI (vedi regola guide).

### Backend
- **Edge Functions** (`supabase/functions/`, Deno): il bridge **A-Cube** copre open banking (`acube-ob-*`: connect, accounts-sync, tx-sync), fatturazione SDI (`acube-sdi-send-invoice`, `acube-cf-sync-invoices`, `sdi-*`), pagamenti (`acube-payment-send`); più `help-chat` (assistente AI), `ticket-resolve-now`, `admin-manage-user`.
- **Migrations** (`supabase/migrations/`): numerate `YYYYMMDD_NNN_descrizione.sql`, ~120 file, con eventuale `_ROLLBACK` a fianco. I file con prefisso **`NZ_ONLY`** sono l'unica eccezione documentata alla parità tenant: si applicano SOLO a NZ. Si applicano A MANO sui tenant dal dashboard Supabase (vedi regole sessione cloud).
- **Nota storica**: Yapily è stata **dismessa** (migration `018_drop_yapily_tables.sql`) — l'open banking passa interamente da A-Cube. I file `supabase_*.sql` nella root e le cartelle `dist_*`/`dist4`/`dist5`/`dist-test` sono residui storici di vecchi deploy: non usarli e non rigenerarli.

---

## Database — Regole di Migrazione

### Pattern migrazione sicura
```sql
-- 1. Sempre in una transaction
BEGIN;

-- 2. Aggiungi colonne con DEFAULT (non blocca la tabella)
ALTER TABLE existing_table ADD COLUMN new_col TYPE DEFAULT value;

-- 3. Backfill dati esistenti
UPDATE existing_table SET new_col = computed_value WHERE new_col IS NULL;

-- 4. Solo dopo il backfill, aggiungi vincoli
ALTER TABLE existing_table ALTER COLUMN new_col SET NOT NULL;

COMMIT;
```

### Branch strategy per migrazioni
1. `supabase branch create feature-xxx` → crea branch DB
2. Applica migrazione sul branch
3. Testa con Edge Functions e frontend
4. Se OK → `supabase branch merge feature-xxx`
5. Se KO → `supabase branch delete feature-xxx` (nessun danno)

### Dati esistenti da preservare

| Tabella | Righe | Criticità |
|---|---|---|
| `budget_entries` | 1.236 | ALTA — budget annuali attivi |
| `balance_sheet_data` | 535 | ALTA — bilanci importati |
| `cash_movements` | 513 | ALTA — movimenti bancari storici |
| `reconciliation_log` | 373 | MEDIA — log riconciliazione |
| `electronic_invoices` | 211 | ALTA — fatture elettroniche |
| `payables` | 211 | ALTA — scadenzario attivo |
| `suppliers` | 75 | ALTA — anagrafica fornitori |
| `daily_revenue` | 49 | MEDIA — ricavi giornalieri |
| `monthly_cost_lines` | 39 | MEDIA — dettaglio costi |
| `payable_actions` | 26 | BASSA — audit trail |
| `cost_categories` | 25 | ALTA — piano dei conti costi |
| `budget_confronto` | 24 | MEDIA — confronti budget |
| `chart_of_accounts` | 20 | ALTA — piano dei conti |
| `cost_centers` | 8 | ALTA — centri di costo |
| `outlets` | 7 | CRITICA — struttura outlet |

---

## Fasi di Implementazione

Segui l'ordine del blueprint (Sezione 5). Per ogni fase:

1. **Leggi** la sezione corrispondente del blueprint
2. **Pianifica** le migrazioni SQL necessarie
3. **Crea branch** Supabase per test
4. **Implementa** migrazioni → Edge Functions → componenti React
5. **Testa** su branch (SQL + API + UI)
6. **Merge** se tutto OK
7. **Rigenera** tipi TypeScript
8. **Commit** con messaggio descrittivo
9. **Se serve credenziale esterna** → STOP & ASK (vedi sopra)

### Stato attuale (2026-07)
- **Fase 1 — Fondamenta**: COMPLETATA. Multi-tenant fisico live su 3 tenant, RBAC (incluso ruolo viewer readonly e budget_approver), onboarding wizard.
- **Fase 2 — Open Banking**: COMPLETATA via **A-Cube** (`acube-ob-*`). Yapily valutata e dismessa (tabelle droppate con migration 018).
- **Fase 3 — Fatturazione SDI**: COMPLETATA via **A-Cube** (invio/ricezione fatture, cassetto fiscale, sync attive/passive schedulato).
- **Fase 4-5 — AI & Scale**: in corso. Categorizzazione AI movimenti, help-chat, ticket AI, motore anomalie pagamenti, proposte di pagamento fornitori.

Il lavoro odierno è quasi sempre evoluzione/fix del ciclo passivo (Scadenzario, Fornitori, riconciliazione bancaria, piani di pagamento), budget/bilancio e usabilità mobile — non nuove fasi da zero.

---

## Convenzioni

### Naming
- Tabelle: `snake_case` inglese (`bank_transactions`, `electronic_invoices`)
- Colonne: `snake_case` inglese (`invoice_date`, `sdi_status`)
- Componenti React: `PascalCase` (`ScadenzarioSmart`, `OutletWizard`)
- Hooks: `camelCase` con prefisso `use` (`useAcubeOB`, `useCompany`)
- Edge Functions: `kebab-case` (`acube-ob-tx-sync`, `acube-sdi-send-invoice`)
- Migration: `YYYYMMDD_NNN_descrizione.sql` (+ eventuale `_ROLLBACK.sql`)

### Struttura commit
```
[fase] area: descrizione breve

Dettaglio di cosa è stato fatto e perché.
Se migrazione: specificare tabelle coinvolte.
```
Esempio: `[scadenzario] payables: aggancio fornitore per P.IVA nel bridge A-Cube`

### Error handling nelle Edge Functions
```typescript
try {
  // logica
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
} catch (error) {
  console.error(`[acube-ob-tx-sync] Error:`, error);
  return new Response(JSON.stringify({
    error: error.message,
    code: "ACUBE_SYNC_ERROR",
    timestamp: new Date().toISOString()
  }), {
    status: error.status || 500,
    headers: { "Content-Type": "application/json" }
  });
}
```

---

## File di Riferimento

| File | Contenuto |
|---|---|
| `BLUEPRINT_GestionaleNZ_v2.md` | Blueprint completo — matrice funzionale, schema DB, integrazioni, roadmap |
| `CLAUDE.md` | Questo file — prompt operativo |
| `PAYMENT_PLAN_NOTES.md` | **Obbligatorio per il ciclo passivo** — regole piani pagamento, aggancio fornitore↔fattura per P.IVA, casi noti |
| `AZIONI_PATRIZIO_Parallele.md` | Piano azioni manuali per Patrizio (credenziali, accreditamenti) |
| `MIGRATION_NOTES.md` | Dettagli migrazione JS→TS del frontend |
| `BUDGET_WORKFLOW_NOTES.md` | Flusso budget/confronto |
| `AI_CHAT_SUPPORT_NOTES.md` | Assistente AI (help-chat) e sistema ticket |
| Altri `*_NOTES.md` / `AUDIT_*.md` in root | Note di sessione per area (onboarding, provisioning, deep linking, mobile, …) — consultare quella dell'area toccata |
| `docs/` | Piani di sessione storici + `GestionaleNZ_Specifica_Roadmap_v1.docx` |

Quando Patrizio scrive "Fatto X" (es. "Fatto A3"), significa che ha completato l'azione corrispondente
nel piano parallelo. Consulta `AZIONI_PATRIZIO_Parallele.md` per sapere cosa ha fatto e cosa ti serve.

---

## REGOLE CRITICHE — Modifiche Dati Aprile 2025

> **LEGGERE PRIMA DI QUALSIASI OPERAZIONE SU budget_entries O balance_sheet_data**

### Ricavi: account_code = '510100' (MAI 'RIC001')

Il frontend `ConfrontoOutlet` filtra i ricavi con `account_code.startsWith("5")`.
Tutti i ricavi DEVONO usare:
- `account_code = '510100'`
- `account_name = 'Ricavi vendite'`

Se crei nuovi dati ricavi o fai seed, usa SEMPRE `510100`. Il vecchio codice `RIC001` era un errore e causa ricavi = 0 nel frontend.

### Voci Gap Bilancio (NON TOCCARE)

In `budget_entries` esistono 84 righe (7 voci x 12 mesi) con `cost_center = 'spese_non_divise'` che rappresentano costi presenti nel bilancio ma assenti dai centri di costo operativi. Queste voci sono ESSENZIALI per far quadrare il risultato con il bilancio (-201.555 EUR).

Account codes da preservare:
| Codice | Descrizione | Totale annuo | macro_group |
|--------|-------------|-------------|-------------|
| CAT_69 | Ammortamenti immob. immateriali | 75.196,64 | generali_amministrative |
| CAT_71 | Ammortamenti immob. materiali | 17.811,03 | generali_amministrative |
| ADJ_83 | Oneri finanziari non allocati | 20.009,94 | finanziarie |
| ADJ_63 | Servizi non allocati | 4.956,15 | generali_amministrative |
| ADJ_65 | Locazioni non allocate | 3.022,29 | locazione |
| ADJ_61 | Costi produzione non allocati | 1.276,73 | costo_venduto |
| ADJ_77 | Oneri diversi non allocati | 116,53 | oneri_diversi |

**Mai eliminare queste righe.** Mai fare `DELETE FROM budget_entries` senza WHERE specifico.

### Migrazione di riferimento

Vedi `supabase/migrations/20260421_007_budget_entries_fix_and_bilancio_gap.sql` per la documentazione completa di tutte le modifiche e le query di verifica.

### Numeri di controllo (anno 2025)

| Metrica | Valore atteso |
|---------|---------------|
| Righe budget_entries | ~804 |
| Ricavi totali (actual_amount, 510100) | ~2.324.500 EUR |
| Costi totali (actual_amount) | ~2.526.055 EUR |
| Risultato netto | ~-201.555 EUR |
| Bilancio ufficiale (balance_sheet_data) | -201.555,38 EUR |

Se dopo una migrazione questi numeri non tornano, qualcosa e' andato storto. Verifica con le query in fondo al file di migrazione.

---

## Framework Allocazione Costi (IMPLEMENTATO)

Il sistema di allocazione fornitori supporta 4 modalita':

1. **DIRETTO** — Costo assegnato a un singolo outlet
2. **SPLIT %** — Ripartito per percentuale su N outlet (somma = 100%)
3. **SPLIT VALORE** — Importi specifici per outlet (somma <= totale fattura)
4. **QUOTE UGUALI** — Diviso equamente per tutti gli outlet attivi (dinamico: se cambiano gli outlet, cambia la quota)

Tabelle: `supplier_allocation_rules`, `supplier_allocation_details` (nel baseline schema). UI: `src/components/SupplierAllocationEditor.tsx`.
Specifica completa in: `docs/GestionaleNZ_Specifica_Roadmap_v1.docx`

---

## Principio Guida

> **Costruisci come se dovessi gestire 1.000 aziende con 10.000 outlet, ma testa con i 7 outlet reali di Patrizio.**
> Mai sacrificare la sicurezza per la velocità. Mai perdere un dato. Mai esporre una credenziale.

---

## Migrazione TypeScript completata 2026-04-30

Il frontend è stato migrato integralmente da JavaScript a TypeScript (strict mode).

- **74 file** convertiti da `.jsx`/`.js` a `.tsx`/`.ts`
- **0 file** `.jsx`/`.js` rimasti in `src/`
- `tsconfig.json` con `strict: true`, `allowJs: false`
- `tsc --noEmit` passa con zero errori
- `npm run build` passa
- Debito `// @ts-nocheck` quasi azzerato: al 2026-07 resta **1 solo file** (vedi `CLEANUP_NOCHECK_NOTES.md`). Non aggiungere nuovi `@ts-nocheck`
- Dettagli completi in `MIGRATION_NOTES.md`
- Tipi DB Supabase auto-generati in `src/types/database.ts`
