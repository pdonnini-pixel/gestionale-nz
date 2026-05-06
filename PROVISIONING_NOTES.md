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
| 3 — Wizard onboarding bloccante | ⏳ | STOP & ASK liste outlet |
| 4 — Provisioning Made + Zago | ⏳ | STOP & ASK token + costi |
| 5 — Setup Netlify multi-deploy | ⏳ | STOP & ASK creazione site |
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

## Fase 3 — Wizard onboarding

(da popolare)

---

## Fase 4 — Provisioning Made + Zago

(da popolare)

---

## Fase 5 — Setup Netlify

(da popolare)

---

## Fase 6 — Test E2E

(da popolare)
