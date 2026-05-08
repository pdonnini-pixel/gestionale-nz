# ONBOARDING_FIX_NOTES — Fix bootstrap onboarding multi-tenant

> Working notes per il branch `fix-onboarding-bootstrap`. Aggiornato a fine di ogni fase.
> Riferimenti: `CLAUDE.md` (root), `PROVISIONING_NOTES.md`, `PROMPT_FIX_ONBOARDING_BOOTSTRAP.md`.

---

## Stato fasi

| Fase | Stato | Note |
|---|---|---|
| F0 — Setup branch + audit tabelle | ✅ chiusa | branch ok, audit completato |
| F1 — Schema drift colonne | ✅ chiusa | migrazione 008 (outlets.cap/email/phone) |
| F2 — RLS bootstrap policy | ✅ assorbita in F3 | RPC SECURITY DEFINER bypassa il problema |
| F3 — RPC `onboard_tenant` + refactor wizard | ✅ chiusa | migrazione 009 + Onboarding.tsx riscritto |
| F4 — Fix `create-user.ts` + enum `budget_approver` | ✅ chiusa | UPSERT user_profiles + migrazione 010 |
| F5 — Reset Made/Zago + smoke E2E | ✅ chiusa | autorizzato Patrizio, smoke test E2E ok |
| F6 — Cleanup tenant + docs + PR | ✅ chiusa | tenant vergini, docs aggiornate, PR aperta |

---

## F0 — Audit baseline (chiusa)

### Tabelle public per tenant

| Tenant | n. tabelle |
|---|---|
| NZ (`xfvfxsvqpnpvibgeqpqp`) | 82 |
| Made (`wdgoebzvosspjqttitra`) | 80 |
| Zago (`jxlwvzjreukscnswkbjx`) | 80 |

Differenze tabelle:
- **Solo NZ**: `_deploy_temp`, `_yapily_diagnostic`, `budget_entries_backup_20260504` (tutte diagnostic/backup, escluse correttamente dal dump baseline).
- **Solo Made/Zago**: `_migrations_log` (creata dal nostro tooling, non presente su NZ — non bloccante).

→ **Schema tabelle è allineato.** Non c'è drift da correggere a livello di tabelle.

### Drift colonne (tabelle prioritarie)

Confronto `companies, outlets, chart_of_accounts, cost_centers, suppliers, user_profiles, company_settings, employees`:

| | NZ | Made | Diff |
|---|---|---|---|
| Colonne totali | 180 | 183 | +3 su Made |

**Solo Made/Zago, mancanti su NZ**:
- `outlets.cap`
- `outlets.email`
- `outlets.phone`

Origine: fix temp BUG-D (Patrizio le ha aggiunte manualmente a Made/Zago perché il wizard frontend le invia, ma non esistevano su NZ). → **Da aggiungere a NZ via migrazione additiva** (= F1).

**Solo NZ, mancanti su Made/Zago**: nessuno.

### Stato policy RLS sulle tabelle del wizard

Confronto policy NZ vs Made su `companies, outlets, chart_of_accounts, cost_centers, cost_categories, suppliers, user_profiles, company_settings`:

**Solo Made (fix temp)**:
- `companies.companies_onboarding_insert (INSERT)` — `WITH CHECK true` ⚠️ TROPPO PERMISSIVA
- `user_profiles.profiles_self_select (SELECT)` — `USING (id = auth.uid())` (corretto, ma da incorporare nel modo giusto)
- `companies.companies_select` modificata: `USING (id = get_my_company_id() OR has_jwt_role('super_advisor') OR has_jwt_role('budget_approver'))` (parzialmente OK ma cross-tenant logic è inutile poiché RLS è single-DB)

### Bug osservati durante test E2E

| Bug | Tabella | Causa root | Fix definitivo |
|---|---|---|---|
| A | `user_profiles` | SELECT policy filtra per `company_id = get_my_company_id()`, ma utente bootstrap ha company_id NULL nel JWT → invisibile a se stesso | Lasciare `profiles_self_select` come additiva permanente (utile per qualsiasi caso bootstrap, anche post-Fase 4) |
| B | `companies` | nessuna INSERT policy | Stretta: `WITH CHECK (has_jwt_role('super_advisor') OR has_jwt_role('budget_approver'))`. **Tuttavia: la RPC `onboard_tenant` SECURITY DEFINER bypassa questa necessità.** Manteniamo comunque la policy come safety net per casi che non passano dalla RPC |
| C | `companies` | SELECT post-INSERT bloccato perché `id != get_my_company_id()` | RPC restituisce direttamente il record (non serve `returning=representation` REST). Inoltre la policy modificata su Made è già OK |
| D | `outlets` | colonne `cap/email/phone` mancanti su NZ | F1 — ALTER TABLE outlets ADD COLUMN IF NOT EXISTS … |
| E | tutte | 7 INSERT REST separati, non transazionali, no rollback | RPC `onboard_tenant` atomica (transazione PostgreSQL) |
| F | `outlets/cost_centers/cost_categories/chart_of_accounts/suppliers` | Tutte hanno `_write (ALL)` con `(company_id = get_my_company_id() AND get_my_role() = ...)` → utente con company_id NULL non può scrivere | Tutto risolto dalla RPC SECURITY DEFINER (bypassa RLS) |
| G | `create-user.ts` | crea solo `auth.users`, non `user_profiles` | F4 — INSERT con ON CONFLICT DO UPDATE |

### Strategia di soluzione

**Architettura**: una **RPC `onboard_tenant`** in PL/pgSQL con `SECURITY DEFINER` che:
- Verifica permission (caller deve avere role super_advisor o budget_approver)
- Verifica idempotenza (caller non ha già company_id)
- Insert atomica su `companies → outlets[] → cost_centers → cost_categories → chart_of_accounts (opt) → suppliers (opt) → company_settings`
- Update `user_profiles.company_id` del caller
- Return `company_id`
- ROLLBACK auto in caso di errore

Il SECURITY DEFINER bypassa le RLS, eliminando alla radice BUG-A/B/C/E/F.

Frontend chiama `supabase.rpc('onboard_tenant', ...)` invece di N INSERT REST. Dopo successo, `await refreshProfile()` per ricaricare `useAuth.profile.company_id`.

---

## F1 — Schema drift colonne (chiusa)

### Migrazione `20260506_008_align_outlets_contact_columns.sql`

Solo 3 ALTER additive:
```sql
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS cap text;
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS email text;
```
Su Made/Zago no-op (Patrizio le aveva aggiunte come fix temp). Su NZ aggiunte ex novo via Management API. Su tenant futuri vengono applicate dalla migrazione standard.

---

## F2 — RLS bootstrap (assorbita in F3)

L'analisi RLS ha mostrato che TUTTE le tabelle del wizard (companies, outlets, cost_centers, cost_categories, chart_of_accounts, suppliers, company_settings) hanno il pattern `WITH CHECK ((company_id = get_my_company_id()) AND get_my_role() = …)` per le scritture. Per un utente bootstrap con `app_metadata.company_id = NULL`, queste policy NON matchano mai.

Invece di scrivere policy "bootstrap-friendly" per ogni tabella (frammentate, difficili da mantenere), abbiamo scelto la strada opposta: una **RPC SECURITY DEFINER** che bypassa RLS in un'unica transazione, con permission check espliciti dentro la funzione. Risolve A/B/C/E/F insieme.

Le uniche modifiche RLS rimaste in 009:
1. `DROP POLICY IF EXISTS companies_onboarding_insert ON companies` — toglie il fix temp BUG-B (`WITH CHECK true`, troppo permissivo). La RPC bypassa, non serve.
2. `DROP/CREATE profiles_self_select ON user_profiles USING (id = auth.uid())` — additive, additivo a `profiles_select`. Permette ad un utente di leggere il proprio profilo anche con `company_id = NULL`. Allineato su tutti e 3 i tenant.
3. `DROP/CREATE companies_select USING (id = get_my_company_id())` — ripristina la versione originale stretta su Made/Zago (fix temp BUG-C non più necessario con la RPC). Su NZ è no-op.

---

## F3 — RPC `onboard_tenant` + refactor wizard (chiusa)

### Migrazione `20260506_009_onboard_tenant_rpc.sql`

Funzione PL/pgSQL `public.onboard_tenant(p_company jsonb, p_outlets jsonb, p_chart_template text, p_suppliers jsonb) RETURNS uuid`. Caratteristiche:

- **`SECURITY DEFINER`** + `SET search_path = public, pg_temp` (lock anti-injection)
- **`REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`** — solo utenti loggati la chiamano
- **5 check di sicurezza prima di qualunque INSERT**:
  1. `auth.uid() IS NOT NULL` (autenticato)
  2. `user_profiles.role IN ('super_advisor', 'budget_approver')` (autorizzato)
  3. `user_profiles.company_id IS NULL` (caller non già onboardato)
  4. `companies` deve essere VUOTA (tenant vergine)
  5. Validation dei jsonb (company.name e outlets non vuoti)
- **Transazione PostgreSQL implicita**: se uno qualsiasi degli INSERT fallisce, ROLLBACK automatico. Niente più stato parziale.
- **Insert in 7 tabelle** + UPDATE user_profiles.company_id → caller diventa membro della company appena creata.

### Template piano dei conti

Spostato dal frontend (typo: `account_code/account_name/account_type` non esistono in DB) al SQL della RPC, allineato allo schema reale (`code/name/macro_group`). 26 cost_categories + 20 chart_of_accounts per template `'nz'`. 5 cost_categories per `'minimal'`. Tutte le `macro_group` di `cost_categories` rispettano l'enum `cost_macro_group` (6 valori validi).

### Refactor `Onboarding.tsx`

- `handleSubmit()` ora: serializza form → `supabase.rpc('onboard_tenant', payload)` → `await refreshProfile()` → reload pagina.
- **Niente più early return silenzioso**: se `profile` è null, mostra messaggio leggibile.
- 100+ righe di INSERT manuali rimosse (gestite server-side dalla RPC).

### Perché reload + refreshProfile

`useAuth.profile` legge da `user_profiles` via `fetchProfile`. La RPC aggiorna il record. `refreshProfile()` lo ricarica. Il reload finale serve come safety net per ripopolare eventuali store/cache locali. RLS funzionano subito perché `get_my_company_id()` legge da `user_profiles WHERE id = auth.uid()` (non dal JWT) — non serve refresh sessione.

---

## F4 — Fix `create-user.ts` + enum `budget_approver` (chiusa)

### Migrazione `20260506_010_add_budget_approver_role.sql`

Single statement: `ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'budget_approver'`.

Limite Postgres: `ALTER TYPE … ADD VALUE` non può stare in transazione. Il file ha la flag `-- @no-transaction` in cima.

### Modifica `apply-migrations.ts`

Riconosce la flag `-- @no-transaction` e applica la migrazione in autocommit (no `BEGIN/COMMIT` esplicito). Per le migrazioni normali, comportamento invariato.

### Modifica `create-user.ts`

Dopo `auth.admin.createUser/updateUserById`, esegue UPSERT su `public.user_profiles` via `pg` (service role, transazione locale):

```sql
INSERT INTO public.user_profiles (id, role, company_id, first_name, last_name, email, is_active)
VALUES ($1, $2::public.user_role, $3, $4, $5, $6, true)
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, ...
```

Idempotente. Argomenti opzionali `--firstName`/`--lastName` per popolare l'anagrafica seed.

Conseguenza: il prossimo `full-provision.ts` di un cliente nuovo crea anche le righe `user_profiles` automaticamente. BUG-G chiuso.

---

## F5 — Reset Made/Zago + smoke E2E (chiusa)

### Reset (autorizzato)

Patrizio ha confermato esplicitamente "sì procedi". Reset eseguito su Made (`wdgoebzvosspjqttitra`) e Zago (`jxlwvzjreukscnswkbjx`):

```sql
UPDATE public.user_profiles SET company_id = NULL;
DELETE FROM public.company_settings;
DELETE FROM public.suppliers;
DELETE FROM public.chart_of_accounts;
DELETE FROM public.cost_categories;
DELETE FROM public.cost_centers;
DELETE FROM public.outlets;
DELETE FROM public.companies;
```

Stato post-reset: 0 ovunque, 4 utenti seed (`auth.users`) sopravvivono.

### Smoke test E2E (`smoke-test-onboard.ts`)

Eseguito su Made e Zago:

```
✓ tenant vergine
✓ profile pre: role=super_advisor company_id=null
✓ company creata
✓ companies: 1
✓ outlets: 2
✓ cost_centers: 3
✓ cost_categories: 26
✓ chart_of_accounts: 20
✓ suppliers: 2
✓ company_settings: 1
✓ user_profiles.company_id aggiornato
✓ re-onboarding bloccato (idempotency)
```

Entrambi i tenant: ✅ smoke test E2E superato end-to-end.

### Reset finale (consegna a Lilian)

Dopo il smoke test, reset di nuovo Made/Zago a stato vergine. Pronti per il vero onboarding di Lilian.

### NZ INVARIATO

| Tabella | Conteggio |
|---|---|
| `companies` | 1 |
| `outlets` | 7 |
| `budget_entries` | 816 |
| `electronic_invoices` | 202 |
| `bank_transactions` | 1473 |
| `payables` | 208 |
| `suppliers` | 74 |

Modifiche su NZ (additive only, applicate via Management API):
- `ALTER TABLE outlets ADD COLUMN IF NOT EXISTS cap/phone/email`
- `ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'budget_approver'`

NESSUNA DELETE, NESSUN UPDATE su dati. NESSUNA modifica policy esistenti.

---

## F6 — Cleanup + docs + PR (chiusa)

- `npm run typecheck` ✅ zero errori
- `npm run build` ✅ pulito
- `check-version-drift.ts` ✅ Made + Zago alla versione 11/11

PR aperta: vedi link in commento finale.

---

## Decisioni autonome non banali

1. **RPC SECURITY DEFINER come single source of truth** invece di policy bootstrap frammentate. Una funzione, un check di permission, una transazione. Riduce il blast radius RLS a zero per il flusso onboarding.
2. **Template piano dei conti spostato dal frontend al SQL** della RPC. Il frontend mandava nomi colonna sbagliati (`account_code/account_name/account_type`) che non corrispondono allo schema reale (`code/name/macro_group`). Decisione: il template è dati di sistema, non input utente — appartiene alla migrazione.
3. **Migrazione 010 separata da 009** per la flag `-- @no-transaction` (limite ALTER TYPE ADD VALUE). Modifica a `apply-migrations.ts` per supportare il pattern.
4. **NZ NON aggiunto a `tenants.json`** anche stavolta (vincolo "non toccare NZ"). Le 2 migrazioni additive (008, 010) le ho applicate via Management API direttamente. La 009 NON è stata applicata a NZ perché modifica policy esistenti (`companies_select` e `companies_onboarding_insert` — quest'ultima però non esisteva su NZ, quindi sarebbe stata no-op anche). Conseguenza: la RPC `onboard_tenant` esiste solo su Made/Zago. NZ non ne ha bisogno (è già onboardato), ma se mai si volesse usarla anche lì, basta applicare 009 (idempotente).
5. **Smoke test E2E via supabase-js + login JWT reale** invece di test browser. Copre tutto lo stack: auth → RLS profile_self_select → RPC SECURITY DEFINER → permission check → INSERT su 7 tabelle → idempotency check. Gli unici aspetti non coperti sono UI/UX (form rendering, validation lato client) — quelli li valida Patrizio in browser.
6. **Password seed `TestGestionale2026`**: nel `.env` provisioning era ancora la password autogenerata da Cowork al primo provisioning. Patrizio l'ha resettata sui 3 tenant per i test. Aggiornato `.env` per allinearsi.
7. **Validation input nella RPC** (`name` company obbligatorio, almeno 1 outlet con name+code) usa `RAISE EXCEPTION` con SQLSTATE espliciti (`22023` invalid_parameter_value, `42501` insufficient_privilege, `23505` unique_violation). Frontend riceve il messaggio chiaro. Nessun crash silenzioso.

## Limitazioni note (consegnate a Patrizio)

1. **Email seed Sabrina/Veronica** = `@newzago.it` (placeholder). Stessa nota della Fase 4 del provisioning iniziale.
2. **Il role di Lilian (`budget_approver`)** ora è valido sia nell'enum che nei JWT. Coerente.
3. **NZ ha le 2 colonne `outlets.cap/phone/email`** ma sono NULL su tutti i 7 outlet esistenti. Se Patrizio vuole popolarle, può farlo via UI o INSERT one-shot.
4. **La RPC NON crea utenti seed**. Gli utenti seed devono esistere già in `auth.users` + `user_profiles`. Per un cliente nuovo, prima `full-provision.ts` (che ora popola anche `user_profiles`), poi Lilian fa il login e completa il wizard.

