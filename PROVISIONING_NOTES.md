# PROVISIONING_NOTES — Multi-tenant Made Retail + Zago

> Working notes per `feature-provisioning-multitenant`. Aggiornato a fine di ogni fase.
> Riferimenti: `CLAUDE.md` (root) §ADR-001, `PROMPT_PROVISIONING_MULTITENANT.md`.

---

## Stato fasi

| Fase | Stato | Note |
|------|-------|------|
| 0 — Setup + planning | ✅ in chiusura | Branch creato, inventario fatto |
| 1 — Tooling provisioning | ⏳ da avviare | 8 script TypeScript |
| 2 — Hostname routing + tenant header | ⏳ | tenants.ts + Layout badge |
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

## Fase 1 — Tooling (in corso)

(da popolare al termine)

---

## Fase 2 — Hostname routing

(da popolare)

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
