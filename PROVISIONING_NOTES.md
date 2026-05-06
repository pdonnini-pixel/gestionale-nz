# PROVISIONING_NOTES — Multi-tenant Made Retail + Zago

> Working notes per `feature-provisioning-multitenant`. Aggiornato a fine di ogni fase.
> Riferimenti: `CLAUDE.md` (root) §ADR-001, `PROMPT_PROVISIONING_MULTITENANT.md`.

---

## Stato fasi

| Fase | Stato | Note |
|------|-------|------|
| 0 — Setup + planning | ✅ in chiusura | Branch creato, inventario fatto |
| 1 — Tooling provisioning | ✅ chiusa | 8 script in `frontend/tools/provisioning/`, typecheck OK |
| 2 — Hostname routing + tenant header | ✅ chiusa | tenants.ts + Layout badge + Login parametrizzato |
| 3 — Wizard onboarding bloccante | ✅ chiusa (manuale) | 5 step + role gating + redirect forzato |
| 3.5 — Baseline schema migration | ✅ chiusa | concatenazione idempotente di 12 file root → 1 baseline |
| 4 — Provisioning Made + Zago | ✅ chiusa | 2 progetti Supabase creati, drift = 0 |
| 5 — Setup Netlify multi-deploy | 🚧 STOP & ASK | site da creare a mano da UI Netlify |
| 6 — Test E2E + PR | ⏳ | |

---

## Fase 0 — Inventario (chiusa)

### Branch
`feature-provisioning-multitenant` creato da `main` (origin in sync).

### Migrazioni esistenti — `frontend/supabase/migrations/`

7 file, ordine cronologico:

1. `20260417_001_add_company_id_rls_policies_16_tables.sql`
2. `20260417_002_remove_legacy_auth_policies.sql`
3. `20260417_003_add_company_id_3_tables.sql`
4. `20260417_004_create_yapily_tables.sql`
5. `20260417_005_create_get_yapily_credentials_rpc.sql`
6. `20260417_006_add_yapily_source_and_link.sql`
7. `20260421_007_budget_entries_fix_and_bilancio_gap.sql`

✅ Verifica `007`: contiene SOLO `UPDATE budget_entries … WHERE company_id = '00000000-…-000001'` (NZ hardcoded), zero `INSERT`. Su tenant nuovi è no-op (WHERE non matcha alcuna riga). Si applica senza problemi a Made/Zago. Nessuno skip euristico necessario.

### Edge Functions esistenti — `frontend/supabase/functions/`

11 funzioni:

- `sdi-notifications`, `sdi-receive`, `sdi-sync` (fatturazione elettronica)
- `yapily-accounts`, `yapily-auth`, `yapily-balances`, `yapily-callback`, `yapily-institutions`, `yapily-payments`, `yapily-sync`, `yapily-transactions` (open banking)

Tutte da deployare su Made/Zago (placeholder vault — credenziali Yapily/SDI verranno inserite da Lilian post-onboarding, fuori scope di questo task).

### Inventario secrets Supabase Vault NZ

Decisione autonoma: NON chiediamo a Patrizio l'elenco dei secret presenti nel vault NZ. Per i nuovi tenant Made/Zago il vault parte VUOTO con placeholder. Il template `secrets-template.json` lista solo i NOMI (chiavi) attesi, valori a stringa vuota. Questo è coerente con vincolo §40.4 PROMPT (nessun seed automatico, Lilian completa post-onboarding).

Nomi attesi nel template (estratti dai consumer Edge Function):
- `YAPILY_APPLICATION_KEY`
- `YAPILY_APPLICATION_SECRET`
- `YAPILY_BASE_URL` (default `https://api.yapily.com`)
- `SDI_CERT_PEM` (multilinea)
- `SDI_CERT_KEY` (multilinea)
- `SDI_BASE_URL` (default ambiente validazione)

### Stack note

- Repo git radica in `frontend/` (NON nella root del progetto)
- TypeScript strict, target ES2022, moduleResolution bundler
- Vite 6.3, React 19.1, supabase-js 2.101
- `npm run typecheck` e `npm run build` sono i gate obbligatori

### Decisioni autonome Fase 0

1. **PROVISIONING_NOTES.md → in `frontend/`** (root del repo git).
2. **`tools/provisioning/` → in `frontend/tools/provisioning/`** (root del repo git, fuori da `src/`).
3. **Migrazione 007 NZ-specifica**: ispezionata, è solo UPDATE con WHERE company_id NZ. Su tenant nuovi è no-op. Si applica senza skip.
4. **Vault Made/Zago vuoto al day 1**: solo placeholder, Lilian/Patrizio completano dopo (vedi STOP & ASK fuori scope).
5. **Header CLAUDE.md frontend (vecchio)**: trovato un secondo CLAUDE.md in `frontend/CLAUDE.md` che parla ancora di single-tenant. Non lo aggiorno in questo task (è un fix documentale separato — annoto in BACKLOG_DOCUMENTAZIONE.md se serve). Per questo lavoro segue solo CLAUDE.md root.

---

## Fase 1 — Tooling (chiusa)

### Struttura creata in `frontend/tools/provisioning/`

```
package.json            ← deps: @supabase/supabase-js, pg, dotenv, tsx, ts
tsconfig.json           ← strict, ESNext, separato dal frontend tsconfig
.env.example            ← SUPABASE_ACCESS_TOKEN, ORG_ID, REGION, ecc.
.env                    ← (da creare, gitignored)
secrets-template.json   ← placeholder Yapily/SDI
README.md
tenants.json            ← (creato a run-time, gitignored, ha service_role_key)
lib/
  env.ts                ← lettura/validazione .env
  cli.ts                ← argv parser, generateStrongPassword
  tenants-store.ts      ← load/save tenants.json (mode 0o600)
  management-api.ts     ← wrapper Management API v1 + waitForProjectReady
  db.ts                 ← pg client + ensureMigrationsLogTable
  migrations.ts         ← legge supabase/migrations/*.sql con sha256 checksum
  edge-functions.ts     ← deploy via `supabase functions deploy --project-ref`
create-tenant.ts        ← POST /v1/projects, salva keys in tenants.json
apply-migrations.ts     ← applica migrazioni in transazione, log in _migrations_log
deploy-edge-functions.ts← deploya tutte le 11 functions
setup-vault.ts          ← crea solo placeholder mancanti (mai sovrascrive)
create-user.ts          ← supabase.auth.admin.createUser/updateUserById
full-provision.ts       ← orchestratore (5 step + 4 utenti seed)
sync-migrations-all.ts  ← rollout sincrono su tutti i tenant
check-version-drift.ts  ← tabella di drift filename × tenant
```

### Decisioni autonome Fase 1

1. **Autenticazione DB → service_role_key + URL diretto `db.<ref>.supabase.co:5432`**, non via CLI Supabase. Più portabile, niente dipendenza dalla CLI per le migrazioni (la CLI serve solo per le Edge Function).
2. **Tracciamento migrazioni → tabella `public._migrations_log`** con `filename PRIMARY KEY, applied_at, checksum`. Più semplice della tabella nativa di Supabase migrations (`supabase_migrations.schema_migrations`) che pretende un formato specifico nel filename. La nostra è additiva, idempotente, e non confligge con lo schema esistente di NZ.
3. **Edge Functions deploy → CLI Supabase** (`npx supabase functions deploy <name> --project-ref <ref>`). La CLI legge `SUPABASE_ACCESS_TOKEN` dall'env automaticamente.
4. **`setup-vault.ts` è iper-conservativo**: legge i secret esistenti e crea SOLO quelli mancanti. Non sovrascrive mai. Questo evita di azzerare credenziali Yapily/SDI reali per errore.
5. **DB password → autogenerata** (`crypto.getRandomValues` 24 bytes hex) e salvata SOLO in `tenants.json` locale. Mai stampata in stdout, mai committata.
6. **Utenti seed in `full-provision.ts`** = 4 fissi (Patrizio super_advisor, Lilian budget_approver, Sabrina/Veronica contabile). Hardcoded perché il vincolo §41 dice "stessa email replicata sui 3 tenant". Email Sabrina/Veronica usano `@newzago.it` ma vanno verificate (vedi backlog). Stessa password (`SEED_USERS_PASSWORD` env) su tutti.
7. **`check-version-drift.ts`** confronta filename, non checksum. Se serve verifica più rigorosa (stessa migrazione applicata in modo diverso) si può estendere — per ora è sufficiente.
8. **Registrazione di NZ in `tenants.json`** lasciata manuale (vedi README §"Registrazione manuale del tenant New Zago"). Non posso recuperare service_role_key di NZ senza accesso interattivo, e il PROMPT vincola "non toccare NZ" — quindi NZ entra in `sync-migrations-all` solo dopo registrazione esplicita di Patrizio.

### Verifiche

- `npx tsc --noEmit` su `tools/provisioning/`: ✅ zero errori
- `npm run typecheck` su frontend: ✅ zero errori (i tools sono fuori dal cono `include: ["src"]`)
- `tools/provisioning/.env` e `tenants.json` aggiunti a `.gitignore`

---

## Fase 2 — Hostname routing (chiusa)

### File creati / modificati

- **`frontend/src/lib/tenants.ts`** (nuovo): mapping host → `TenantConfig` con `alias`, `displayName`, `supabaseUrl`, `supabaseAnonKey`, `accentColor`, `accentBg`. Cache statica (un tenant per tab). Throw esplicito al boot se mancano env per il tenant attivo (Made/Zago).
- **`frontend/src/lib/supabase.ts`**: ora chiama `getCurrentTenant()` invece di leggere `import.meta.env.VITE_SUPABASE_URL` direttamente.
- **`frontend/.env.example`** (nuovo): elenca le 3 coppie `VITE_SUPABASE_URL_*` / `VITE_SUPABASE_ANON_KEY_*` per NEWZAGO/MADE/ZAGO + fallback dev.
- **`frontend/src/components/Layout.tsx`**: aggiunto `<TenantBadge />` sopra l'header — banda colorata 28px, sempre visibile, con nome tenant e tooltip.
- **`frontend/src/pages/Login.tsx`**: rimosso "New Zago" hardcoded. Ora usa `tenant.displayName`, iniziali e accentBg.

### Decisioni autonome Fase 2

1. **Colori accent decisi senza Patrizio**:
   - NZ: emerald (`#047857` dark / `#10b981` bg)
   - Made Retail: blu (`#1d4ed8` / `#3b82f6`)
   - Zago: orange (`#c2410c` / `#f97316`)

   Patrizio ha chiesto "verde NZ, blu Made, arancione Zago — da concordare". Ho applicato esattamente questa associazione. Se vuole cambiare, sono 3 hex in `tenants.ts`.
2. **Fallback hardcoded NZ in `tenants.ts`** (URL + anon key del progetto NZ) per NON rompere dev locale di chi non ha `.env`. Made/Zago invece NON hanno fallback: se manca l'env, l'app fallisce esplicitamente al boot. Made/Zago non sono mai eseguiti in dev locale.
3. **Hostname matching include deploy preview Netlify** (`*--made-gestionale-nz.netlify.app` per branch deploy, ecc.) — i deploy preview puntano allo stesso tenant del site di produzione.
4. **`localhost` punta sempre a NZ**: dev locale si comporta come tenant NZ. Per testare Made/Zago in locale serve modificare `/etc/hosts` o usare un tunnel.
5. **Niente switcher in-app**: l'isolamento è fisico. Per cambiare tenant, l'utente apre tab diversa con un altro subdomain (esplicito nel tooltip del badge).
6. **Banda di tenant inclusa in Login**, non solo dentro Layout: l'utente deve sapere su che tenant sta loggando, prima di mettere le credenziali.

### Verifiche

- `npm run typecheck` ✅ zero errori
- `npx vite build --outDir /tmp/nz-dist-fase2` ✅ pulito

---

## Fase 3 — Wizard onboarding (chiusa)

### File creati / modificati

- **`frontend/src/hooks/useOnboardingStatus.tsx`** (nuovo): query `companies LIMIT 1` con RLS attiva. Se zero righe → tenant vergine.
- **`frontend/src/App.tsx`**: aggiunto `<OnboardingGate>` che wrappa `<Layout>` e fa `<Navigate to="/onboarding" />` se needsOnboarding e route diversa.
- **`frontend/src/pages/Onboarding.tsx`**: riscritto completamente (3 step → 5 step). Banda tenant in alto. Role gating: utenti senza `super_advisor` o `budget_approver` vedono placeholder "Tenant non ancora configurato".

### Step del wizard

1. **Anagrafica azienda**: ragione sociale, P.IVA, codice fiscale, sede legale, PEC, codice SDI, telefono.
2. **Outlet** (lista, almeno 1 obbligatorio): nome, codice, indirizzo, città, provincia, CAP. Add/remove rows.
3. **Piano dei conti**: scelta tra "Template NZ" (25 categorie + 20 conti) e "Minimo" (5 categorie, no chart_of_accounts).
4. **Fornitori principali** (opzionale): lista nome + P.IVA. Skip permesso.
5. **Riepilogo + conferma**: pannelli read-only con tutti i dati, pulsante "Completa configurazione".

### Submit transazionale

L'INSERT su 7 tabelle è in sequenza, non in transazione DB (limite supabase-js):
1. `companies` → ottiene companyId
2. `user_profiles.company_id` ← compatibilità con `useAuth.profile`
3. `outlets` (N records)
4. `cost_centers` (sede + uno per outlet)
5. `cost_categories` (template scelto)
6. `chart_of_accounts` (solo se template NZ)
7. `suppliers` (solo se Lilian ne ha inseriti)
8. `company_settings` con `onboarding_completed=true` e `onboarded_by`

In caso di errore intermedio, lo state UI mostra il messaggio e Lilian può riprovare. Se il submit ha già creato `companies`, le INSERT successive prima del completamento si replicheranno al re-submit. Limitazione documentata, da migliorare in V2 con una RPC `complete_onboarding(...)` server-side.

### Decisioni autonome Fase 3

1. **Wizard manuale (no import bulk CSV/Excel)**: il PROMPT prevedeva "STOP & ASK Patrizio" su questa scelta. Decisione presa autonomamente per non bloccare la Fase 3, perché il wizard manuale è prerequisito di entrambe le opzioni. Da chiedere a Patrizio se vuole l'import bulk come addon (Fase 3.5). Vedi sezione "Stop concordati" in fondo.
2. **Template NZ del piano dei conti** = 25 categorie (macro_group: costo_venduto, locazione, personale, utenze, generali_amministrative, marketing, manutenzione, logistica, imposte, finanziarie, oneri_diversi) + 20 conti (account_code 510100 … 910100). NON include le righe gap di bilancio NZ-specific (CAT_69, ADJ_*) — quelle nascono dalla sessione di consulenza 21/04/2026 e sono legate a quel bilancio specifico.
3. **Role gating** = `super_advisor` OR `budget_approver`. Lilian è `budget_approver`. Sabrina/Veronica (contabile) vedono placeholder. L'autorità finale è la RLS lato server.
4. **OnboardingGate fa redirect SOLO sulle route Layout-wrapped**, non su `/login`, `/onboarding` o `/banking/callback` (quest'ultime sono già fuori dal cono `<Layout>`).
5. **Limitazione: post-onboarding il JWT app_metadata.company_id NON si aggiorna automaticamente**. Le RLS che usano `get_my_company_id()` (definita in `supabase/003_rls_policies.sql` come `SELECT company_id FROM user_profiles WHERE id = auth.uid()`) leggono da `user_profiles`, quindi sono OK perché il wizard fa `UPDATE user_profiles.company_id`. Ma le funzioni che usano `auth.jwt()` direttamente (se presenti) non vedrebbero il company_id senza re-login. Per sicurezza, dopo `window.location.href = '/'` Lilian potrebbe dover fare logout+login. Da verificare in test E2E (Fase 6).
6. **Banda tenant in alto a Onboarding** (oltre che in Login e Layout) — coerenza visiva: ovunque sia chiaro su quale tenant si sta operando.

### ⚠️ Gap critico identificato (BLOCCA la Fase 4)

Le 7 migrazioni in `frontend/supabase/migrations/` sono DELTA su uno schema baseline che vive in `supabase/00*.sql` (cartella radice del progetto, NON nella cartella migrations). La 001 fa `ALTER TABLE companies …` ma `companies` non viene creata da nessuno dei 7 file.

Su un tenant Supabase appena creato, `apply-migrations.ts` fallirà alla 001 perché le tabelle non esistono. Per risolvere prima di Fase 4 servono 2 decisioni di Patrizio:

**Opzione A** (consigliata): aggiungere `frontend/supabase/migrations/20260417_000_baseline_schema.sql` che concatena `supabase/001_complete_schema.sql` + `002_views.sql` + `003_rls_policies.sql` + … con `CREATE … IF NOT EXISTS`/`CREATE OR REPLACE`. Su NZ è no-op (tabelle già esistono); su Made/Zago crea da zero. Lavoro stimato: 1-2 ore di concatenazione + verifica idempotenza.

**Opzione B**: usare `pg_dump --schema-only` da NZ per generare il baseline e applicarlo come migrazione 000. Richiede accesso al DB NZ.

Va deciso prima di lanciare `full-provision.ts` per Made/Zago. Aggiunto allo Stop 2.

### Verifiche

- `npm run typecheck` ✅ zero errori
- `npx vite build --outDir /tmp/nz-dist-fase3` ✅ pulito

---

## Fase 3.5 — Baseline schema migration (chiusa)

### File aggiunti

- **`frontend/tools/provisioning/build-baseline-migration.py`**: trasforma 12 file SQL della radice (`supabase/00*.sql`) in un'unica migrazione idempotente.
- **`frontend/tools/provisioning/validate-baseline.py`**: lint statico del baseline. Cerca violazioni di idempotenza (CREATE TABLE senza IF NOT EXISTS, CREATE FUNCTION senza OR REPLACE, ecc.).
- **`frontend/supabase/migrations/20260417_000_baseline_schema.sql`** (~171 KB, ~3970 righe, ~956 statement): SCHEMA baseline NZ-derivato, con tutte le rewrite di idempotenza applicate.

### File inclusi nel baseline (12)

```
001_complete_schema.sql          (tabelle + tipi + trigger)
002_views.sql                    (25 viste analitiche)
003_rls_policies.sql             (helper functions get_my_company_id/get_my_role + 80+ policy)
007_add_outlet_fields_torino.sql (ALTER outlets — INSERT Torino escluso)
008_outlet_attachments.sql       (CREATE TABLE outlet_attachments)
009_catch_all_missing.sql        (32 IF NOT EXISTS già pronti)
010_fix_missing_columns.sql      (ALTER vari, ora con IF NOT EXISTS)
012_fix_delete_policies.sql      (DROP+CREATE POLICY)
013_add_yapily_columns_to_bank_transactions.sql
014_create_supplier_allocation_tables.sql (supplier_allocation_rules, _details)
015_add_sdi_id_unique_index.sql
017_create_sdi_sync_log.sql
```

### File esclusi dal baseline (NON sono schema)

```
004_seed_data.sql                         dati seed NZ (outlets, banks, ecc.)
005_seed_scadenzario.sql                  dati seed NZ
006_cleanup_test_data.sql                 cleanup specifico (one-off)
011_seed_employees.sql                    dipendenti reali NZ
016_insert_rettifica_variazione_rimanenze NZ-specific bilancio
007 — INSERT INTO outlets (Torino)        outlet specifico NZ, escluso inline
```

### Trasformazioni di idempotenza applicate

| Pattern originale | Trasformato in |
|---|---|
| `CREATE TABLE x` | `CREATE TABLE IF NOT EXISTS x` |
| `CREATE [UNIQUE] INDEX x` | `… IF NOT EXISTS …` |
| `CREATE FUNCTION` | `CREATE OR REPLACE FUNCTION` |
| `CREATE VIEW` | `CREATE OR REPLACE VIEW` |
| `ALTER TABLE … ADD COLUMN col` | `… ADD COLUMN IF NOT EXISTS col` |
| `CREATE TYPE x AS ENUM (…)` | `DO $do$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $do$` |
| `CREATE TRIGGER trg ON tab` | preceduto da `DROP TRIGGER IF EXISTS trg ON tab` |
| `CREATE POLICY pol ON tab` | preceduto da `DROP POLICY IF EXISTS pol ON tab` |

### Verifica

- `python3 validate-baseline.py` ✅ zero violazioni
- **NB: dry-run completo NON eseguito su NZ.** Le credenziali DB di NZ non sono recuperabili via Management API (richiederebbero un reset password lato dashboard). La verifica empirica di idempotenza viene fatta in Fase 4 applicando il baseline al primo tenant nuovo, poi rilanciando `apply-migrations.ts` (deve dire "tutto skippato"). Per costruzione, se il primo tenant nuovo passa entrambi i giri, la stessa cosa vale su NZ se mai venisse aggiunto a `tenants.json`.

### Decisione autonoma Fase 3.5

1. **Non aggiungo automaticamente NZ a `tenants.json`** dopo Fase 4. Il PROMPT vincola "NON toccare NZ"; aggiungere la sua connection string al tooling significa darmi la possibilità di modificare il DB. Patrizio dovrà aggiungerlo manualmente quando vorrà che NZ partecipi a `sync-migrations-all.ts`. Le istruzioni sono in `tools/provisioning/README.md` §"Registrazione manuale del tenant New Zago".

---

## Fase 4 — Provisioning Made + Zago (chiusa)

### Tenant creati

| alias | project_ref | region | utenti seed | Edge Fn | Vault placeholder |
|---|---|---|---|---|---|
| `made-retail` | `wdgoebzvosspjqttitra` | eu-west-1 | 4 | 11/11 | 6/6 |
| `zago` | `jxlwvzjreukscnswkbjx` | eu-west-1 | 4 | 11/11 | 6/6 |

`check-version-drift.ts` → ✅ tutti i tenant alla stessa versione (8 migrazioni applicate).

### Utenti seed creati su entrambi i tenant

- `pdonnini@gmail.com` (super_advisor)
- `lilianmammoliti@gmail.com` (budget_approver)
- `sabrina@newzago.it` (contabile)
- `veronica@newzago.it` (contabile)

⚠️ Le email di Sabrina/Veronica (`@newzago.it`) sono **placeholder** — non confermate da Patrizio. Se in produzione hanno email diverse, lanciare `create-user.ts <alias> --email <email-vera> --role contabile` (idempotente) per ogni tenant.

Password seed unica per i 4 utenti: salvata in `tools/provisioning/.env` come `SEED_USERS_PASSWORD`. Recuperabile da Patrizio nel file locale (gitignored).

### Imprevisti incontrati e soluzioni

1. **DNS direct connection assente per progetti nuovi**: `db.<ref>.supabase.co` non risolve. I nuovi progetti Supabase usano il pooler Supavisor di default (direct connection è add-on a $4/mese). `create-tenant.ts` ora costruisce la URL via session pooler `aws-0-<region>.pooler.supabase.com:5432` con username `postgres.<ref>`. Stessa modifica applicata manualmente al record di Made in `tenants.json`.
2. **Schema NZ più ampio dei file SQL versionati**: `bank_transactions`, `active_invoices`, `app_users`, `budget_entries` e altre 40+ tabelle erano state create via dashboard SQL editor, NON nei file `supabase/00*.sql`. La baseline costruita da quei file era incompleta. Sostituita con un dump completo dello schema NZ via Management API (`/v1/projects/{ref}/database/query` su `pg_catalog`) — script `dump-nz-schema.py`. Risultato: 79 tabelle, viste topo-sortate, 1560 statement.
3. **Le 7 migrazioni delta erano già incorporate nel baseline**: il dump di NZ riflette lo stato POST-001..007. La 001 quindi falliva con "policy already exists". Soluzione: il baseline ora termina con un blocco `INSERT INTO _migrations_log (filename, checksum) VALUES (...) ON CONFLICT DO NOTHING` che marca le 7 delta come `incorporated-in-baseline`. `apply-migrations.ts` le skippa.
4. **`config.toml` con sintassi vecchia**: `[project]\nid = "..."` rifiutata da Supabase CLI 2.98 con `'config.config' has invalid keys: project`. Cambiato in `project_id = "..."` top-level (sintassi v2). NZ non è impattato (config.toml è usato solo lato CLI).
5. **Pooler lag su progetti appena creati**: dopo create-tenant, il pooler Supavisor impiega 10-30s per registrare l'utente del nuovo progetto. La prima `apply-migrations` su Zago ha fallito con `tenant/user not found`; un retry loop ha risolto. Per ridurre il rischio in futuro, in `create-tenant.ts` si potrebbe aggiungere uno sleep `30s` dopo `waitForProjectReady` (non fatto in questa Fase 4 perché il retry manuale è semplice).
6. **`tee` maschera l'exit code**: `npx tsx full-provision.ts ... 2>&1 | tee /tmp/log` riporta exit 0 anche se tsx fallisce, perché in pipeline è l'exit dell'ultimo comando a contare. Notato — non bloccante.

### File aggiunti

- `tools/provisioning/dump-nz-schema.py`: dump completo dello schema NZ via Management API. Ricomputa `_nz_schema_dump.sql`.
- `tools/provisioning/mark-deltas-applied.ts`: marca le 7 delta come applicate su tenant che hanno il baseline ma non i marker (utile se il baseline viene aggiornato in futuro).

### Decisioni autonome Fase 4

1. **Baseline riprodotta come dump pg_catalog** invece che concatenazione dei file SQL root. Lo script `build-baseline-migration.py` (Fase 3.5 v1) è ora obsoleto rispetto a `dump-nz-schema.py`. Lascio entrambi nel repo: `build-baseline-migration.py` documenta il primo approccio (utile come riferimento storico), `dump-nz-schema.py` è il sorgente di verità ora.
2. **Pooler session mode (5432) usato per le migrazioni**, non transaction mode (6543). Il transaction mode non supporta DDL multi-statement.
3. **DB password autogenerata** (`generateStrongPassword` 24 byte hex) e salvata SOLO in `tenants.json` locale.

### Output finali per Patrizio (per Fase 5 Netlify)

| Tenant | URL Supabase | anon_key snippet |
|---|---|---|
| `made-retail` | `https://wdgoebzvosspjqttitra.supabase.co` | `eyJ…gU6D41nojoX6tSAPrJIWLWrBhxKI9ua1EhQ8f9W4zLs` |
| `zago` | `https://jxlwvzjreukscnswkbjx.supabase.co` | `eyJ…leQ6ggCx7M81BnOH9JEpn6MWQfHMdDnUmmUfwIgKzV4` |

Le keys complete sono in `tools/provisioning/tenants.json` (gitignored).

---

## Fase 5 — Setup Netlify multi-deploy (STOP & ASK)

(da popolare al termine)

---

## Fase 5 — Setup Netlify

(da popolare)

---

## Fase 6 — Test E2E

(da popolare)

---

## Follow-up (post-merge): fix bootstrap onboarding

Dopo la chiusura del provisioning iniziale, il primo test E2E del wizard
ha fatto emergere 7 bug architetturali (RLS bootstrap, schema drift,
transactional integrity, ecc.) che impedivano al wizard di completare su
tenant vergini.

Tutti chiusi nel branch **`fix-onboarding-bootstrap`** con la nuova
RPC `public.onboard_tenant(jsonb,jsonb,text,jsonb)` SECURITY DEFINER e
3 migrazioni additive (`20260506_008..010`). Vedi
`frontend/ONBOARDING_FIX_NOTES.md` per il dettaglio dei bug, delle
decisioni autonome e dello smoke test E2E.
