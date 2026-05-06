# tools/provisioning

Tooling di provisioning multi-tenant Supabase per il Gestionale NZ.
Implementa l'ADR-001 (un progetto Supabase per tenant) descritto in `CLAUDE.md`.

## Quando usarlo

- **Nuovo cliente entra**: lanci `full-provision.ts <alias> "<displayName>"`
  → crea progetto, applica migrazioni, deploya Edge Functions, popola
  vault con placeholder, crea utenti seed.
- **Nuova migrazione SQL o nuova Edge Function**: lanci `sync-migrations-all.ts`
  → applica a tutti i tenant in parallelo (riduce drift di versione).
- **Audit periodico**: lanci `check-version-drift.ts` → verifica che
  tutti i tenant siano alla stessa versione della pipeline.

## Setup iniziale (una tantum)

1. `cd frontend/tools/provisioning`
2. `npm install`
3. `cp .env.example .env`
4. Compilare `.env` con i valori reali:
   - `SUPABASE_ACCESS_TOKEN` (Personal Access Token, da
     https://supabase.com/dashboard/account/tokens)
   - `SUPABASE_ORG_ID` (slug numerico/uuid dell'organizzazione)
   - `SEED_USERS_PASSWORD` (password condivisa per gli utenti seed; la
     stessa va replicata sugli altri tenant per consentire login con stesse
     credenziali)
5. (Opzionale) registrare il tenant esistente NZ: vedi sezione "Registrazione
   manuale del tenant New Zago".

> Il file `tenants.json` (creato dagli script) contiene service_role_key e
> connection string DB → è automaticamente in `.gitignore`. **NON committare
> mai.**

## Comandi

| Script | Cosa fa |
|--------|---------|
| `create-tenant.ts <alias> "<name>"` | Crea progetto Supabase, salva metadati. |
| `apply-migrations.ts <alias>` | Applica tutte le migrazioni del repo al tenant. |
| `deploy-edge-functions.ts <alias>` | Deploya tutte le Edge Functions al tenant (richiede CLI Supabase). |
| `setup-vault.ts <alias>` | Crea i secret placeholder dal `secrets-template.json`. |
| `create-user.ts <alias> --email … --role …` | Crea/aggiorna utente con app_metadata role. |
| `full-provision.ts <alias> "<name>"` | Orchestratore: lancia in sequenza i 5 step sopra. |
| `sync-migrations-all.ts` | Applica migrazioni nuove + deploy edge a TUTTI i tenant. |
| `check-version-drift.ts` | Verifica che tutti i tenant siano alla stessa versione. |

## Workflow tipico — nuovo tenant

```bash
cd frontend/tools/provisioning
npm install                                              # solo prima volta
cp .env.example .env                                     # compilare
npx tsx full-provision.ts made-retail "Made Retail Srl"
```

Poi (manualmente):

1. Su Netlify: creare il site `made-gestionale-nz` puntando al repo
2. Su Netlify env vars: aggiungere `VITE_SUPABASE_URL_MADE_RETAIL` e
   `VITE_SUPABASE_ANON_KEY_MADE_RETAIL` (valori in output di full-provision)
3. Aggiornare `frontend/src/lib/tenants.ts` con il subdomain definitivo
4. Lilian apre il subdomain → wizard onboarding → completa anagrafica/outlet
5. (Opzionale) inserire valori reali Yapily/SDI nel vault via dashboard

## Workflow tipico — nuova migrazione SQL

1. Aggiungere nuovo file in `frontend/supabase/migrations/`
2. Testare in locale o su un branch Supabase
3. `cd frontend/tools/provisioning && npx tsx sync-migrations-all.ts`
4. `npx tsx check-version-drift.ts` per conferma

## Registrazione manuale del tenant New Zago (esistente)

Il tenant NZ esiste già su Supabase. Per integrarlo nella pipeline:

1. `npx tsx -e ` con uno script ad-hoc che chiama `upsertTenant` con
   `alias='newzago'`, `projectRef='xfvfxsvqpnpvibgeqpqp'`, ecc.
2. Recuperare manualmente da dashboard:
   - anon_key (`Settings → API`)
   - service_role_key (`Settings → API`)
   - db password (`Settings → Database → Connection string`)
3. Costruire `databaseUrl` come `postgresql://postgres:<pwd>@db.xfvfxsvqpnpvibgeqpqp.supabase.co:5432/postgres`
4. `companyId` = `00000000-0000-0000-0000-000000000001`
5. `netlifySiteHost` = `gestionale-nz.netlify.app`

Una volta registrato in `tenants.json`, NZ partecipa a `sync-migrations-all`
e `check-version-drift` come gli altri tenant. **Verificare prima `apply-migrations.ts newzago`
in modalità dry-run** (idempotente: registrerà solo le migrazioni già applicate
di fatto, non le rilancerà — la prima esecuzione popola `_migrations_log`).

> ⚠️ Se la prima esecuzione di `apply-migrations.ts newzago` su un tenant esistente
> tenta di rilanciare migrazioni già applicate, lo schema potrebbe rifiutarle (es.
> `CREATE TABLE … IF NOT EXISTS` no, `CREATE TABLE …` sì). Per il tenant NZ
> conviene popolare manualmente `_migrations_log` con i 7 filename già applicati
> prima di lanciare `apply-migrations.ts`.

## Sicurezza

- `tenants.json` è gitignored → contiene service_role_key
- `.env` è gitignored → contiene access token Supabase
- Mai loggare valori dei secret (gli script stampano solo nomi)
- I secret reali Yapily/SDI vanno inseriti via dashboard Supabase, non via CLI
