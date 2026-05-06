# ONBOARDING_FIX_NOTES — Fix bootstrap onboarding multi-tenant

> Working notes per il branch `fix-onboarding-bootstrap`. Aggiornato a fine di ogni fase.
> Riferimenti: `CLAUDE.md` (root), `PROVISIONING_NOTES.md`, `PROMPT_FIX_ONBOARDING_BOOTSTRAP.md`.

---

## Stato fasi

| Fase | Stato | Note |
|---|---|---|
| F0 — Setup branch + audit tabelle | 🚧 in corso | branch ok, audit fatto |
| F1 — Schema drift colonne | ⏳ | solo `outlets.cap/email/phone` da aggiungere a NZ |
| F2 — RLS bootstrap policy | (assorbita in F3) | RPC SECURITY DEFINER bypassa il problema |
| F3 — RPC `onboard_tenant` + refactor wizard | ⏳ | sostituisce N INSERT con 1 chiamata atomica |
| F4 — Fix `create-user.ts` (anche `user_profiles`) | ⏳ | con ON CONFLICT DO UPDATE |
| F5 — Reset Made/Zago + smoke E2E | ⏸️ STOP & ASK | conferma da Patrizio |
| F6 — Cleanup tenant + docs + PR | ⏳ | |

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

(le sezioni F1-F6 verranno popolate man mano)
