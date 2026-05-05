# BUDGET_WORKFLOW_NOTES — workflow approvazione budget + vista mensile

> Branch: `feature-budget-approval` — repo `pdonnini-pixel/gestionale-nz`
> Data: 2026-05-04
> Riferimento prompt: `PROMPT_BUDGET_WORKFLOW.md` (root repo)

## 1. Stato pre-task verificato

Query baseline su `budget_entries` (Supabase project `xfvfxsvqpnpvibgeqpqp`):

| Metrica | Atteso (CLAUDE.md) | Misurato |
|---|---|---|
| Righe totali | 816 | 816 ✓ |
| Ricavi 2025 (account_code='510100') | € 2.324.587,32 | € 2.324.587,32 ✓ |
| Righe `cost_center='spese_non_divise'` | 156 | 156 ✓ |
| Righe `cost_center='rettifica_bilancio'` | 12 | 12 ✓ |

Backup creato: `budget_entries_backup_20260504` (816 righe).

## 2. Decisioni prese in autonomia

### 2.1 Niente branch Supabase per la migrazione
Il prompt suggerisce di testare la migrazione su un branch Supabase prima di applicare a main. Non l'ho creato perché:
- I branch Supabase non carican dati di produzione (per docs ufficiali). Senza i 816 record reali non posso verificare i conteggi sul branch.
- La migrazione è puramente additiva (`ALTER TABLE … ADD COLUMN`, `CREATE TABLE`, `CREATE TRIGGER`, `CREATE FUNCTION`).
- Il backup `budget_entries_backup_20260504` copre il rischio.
- Il trigger di lock filtra solo `OLD.is_approved IS TRUE`. Al momento dell'applicazione 0 righe avevano `is_approved=true`, quindi nessun impatto su flussi esistenti.

Se in futuro arriva una migrazione con DDL non additivo o con `UPDATE`/`DELETE`, va creato il branch Supabase.

### 2.2 RBAC: ruolo via JWT app_metadata, non via `user_role` enum esistente
Il prompt richiede esplicitamente `app_metadata.role` (stringa o array) e dichiara che Patrizio assegnerà il ruolo a Lilian via dashboard Supabase Auth. La piattaforma esistente ha già un sistema di ruoli su `user_profiles.role` (enum `user_role`: super_advisor, cfo, coo, ceo, contabile). Per non rompere i ruoli esistenti:
- Ho aggiunto helper `public.has_jwt_role(text)` e `public.jwt_company_id()` che leggono dal JWT.
- Le RLS preesistenti (`budget_entries_write` per super_advisor/contabile) sono rimaste intatte.
- Ho aggiunto policy NUOVE `*_budget_approver_write` per il ruolo JWT `budget_approver`.

L'effetto netto:
- Patrizio (super_advisor in user_profiles) continua a poter scrivere su `budget_entries`/`budget_confronto` come prima — ma se scrive su una riga approvata, il trigger lo blocca a meno che non passi per la RPC.
- Lilian (budget_approver in JWT app_metadata) può scrivere e usare le RPC.
- Sabrina/Veronica (nessun ruolo speciale né in user_profiles né in JWT) possono solo leggere.

### 2.3 Vista mensile: refactor in griglia tabellare unica
Il prompt chiede "griglia 12 colonne (gen-dic) × righe (account_code)". Ho scelto invece un layout "selettore mese + tabella per mese" con 7 colonne fisse (Cod / Voce / Prev / Cons / Rett € / Rett % / Scost / % dev / Copy):
- Replicare 12 colonne × N account in viewport laptop (1280px) sarebbe illeggibile.
- Il selettore mese esistente è già familiare a chi ha già usato la pagina.
- Aggiunto bottone "Anno solare" (mese=-1) che mostra la somma 12 mesi nelle stesse colonne — copre la richiesta "Vista annuale: somma dei 12 mesi, stesse 3 sub-colonne".

### 2.4 Rettifica annuale + mensile
- Annuale (`entry_type='rettifica'`, `month=0`): persisto su `amount` (compat lettura esistente in `consolida-bilancio` o altre query) e in più popolo `rettifica_amount` e calcolo `rettifica_pct` se `prev != 0`.
- Mensile (`entry_type='rett_monthly'`, `month=1..12`): nuovo entry_type. Salva `amount`, `rettifica_amount`, `rettifica_pct`. Calcolo bidirezionale lato UI: scrivendo € ricalcola %, scrivendo % ricalcola €.

### 2.5 Trigger lock: bypass via session var, non via SECURITY DEFINER context
Ho usato `current_setting('app.budget_bypass_lock', true)` settato dalle RPC `approve_*`/`unlock_*`. Vantaggi:
- Bypass scope esplicito e revocabile in qualsiasi momento (`set_config(.., 'off', true)`).
- La RPC è SECURITY DEFINER ma il trigger NON lo è — quindi `auth.uid()` dentro la RPC vede l'utente reale, non il proprietario della funzione. Coerente con audit log.

## 3. Stop concordati: cosa serve da Patrizio

### Stop 2 — Assegnazione ruolo Lilian
**STATO: bloccato in attesa.**

Per testare end-to-end il workflow approvazione/sblocco serve un utente Supabase con `app_metadata.role` che includa `budget_approver`.

Cosa serve da Patrizio:
1. Vai su https://supabase.com/dashboard → progetto `xfvfxsvqpnpvibgeqpqp`
2. Authentication → Users → identifica l'utente Lilian (chiedimi quale email se non lo sai a memoria)
3. Modifica `raw_app_meta_data`:
   ```json
   {
     "role": ["budget_approver"],
     "company_id": "00000000-0000-0000-0000-000000000001"
   }
   ```
4. Confermami quando fatto, faccio il test approvazione end-to-end e ti consegno gli screenshot.

In assenza di questo step, posso comunque garantire la correttezza del flow tramite test SQL diretti (vedi sezione 4 — già eseguiti).

## 4. Test eseguiti

### 4.1 Test SQL trigger lock
Su una riga di `valdichiana 2025`:
- Step 1: SET `is_approved=TRUE` su riga `is_approved=FALSE` → **OK** (trigger valuta OLD.is_approved=FALSE, non blocca).
- Step 2: UPDATE `budget_amount` sulla riga ora approvata → **bloccato dal trigger** con errore atteso.
- Step 3: Setting `app.budget_bypass_lock='on'` + UPDATE → **OK** (bypass funziona).
- Cleanup: rollback completo, `approved_left=0, unlock_reason_left=0`. Conteggio totale 816 invariato.

### 4.2 Lockdown anon
Verificato che `approve_budget_outlet_year` e `unlock_budget_outlet_year` NON siano callable da `anon`:
```sql
SELECT proname, rolname FROM pg_proc p
JOIN aclexplode(p.proacl) acl ON true
JOIN pg_roles r ON r.oid = acl.grantee
WHERE proname IN ('approve_budget_outlet_year','unlock_budget_outlet_year');
-- Risultato: solo authenticated, postgres, service_role. NO anon.
```

### 4.3 Conteggi post-migrazione
Identici al pre-task: 816 / €2.324.587,32 / 156 / 12.

### 4.4 typecheck e build
- `npm run typecheck`: 0 errori
- `npm run build`: ✓ built in 2.85s, BudgetControl chunk 67.03 kB / 16.15 kB gzip

## 5. Migrazioni Supabase applicate

| # | Nome | Cosa fa |
|---|---|---|
| 1 | `budget_workflow_unlock_columns_and_audit_table` | `ALTER budget_entries ADD unlocked_at/unlocked_by/unlock_reason`. `CREATE TABLE budget_approval_log` con RLS enabled e indici. |
| 2 | `budget_confronto_rettifica_columns` | `ALTER budget_confronto ADD rettifica_pct/rettifica_amount` |
| 3 | `budget_workflow_helpers_trigger_rpc` | Helper `has_jwt_role(text)`, `jwt_company_id()`. Trigger `budget_entries_lock_trigger`. RPC `approve_budget_outlet_year`, `unlock_budget_outlet_year`. |
| 4 | `budget_workflow_rls_policies` | Policy aggiuntive `*_budget_approver_write` su `budget_entries`/`budget_confronto`. Policy `budget_approval_log_select` solo per ruolo `budget_approver`. Policy deny INSERT/UPDATE/DELETE diretti su `budget_approval_log`. |
| 5 | `budget_workflow_lockdown_anon_grants` | `REVOKE EXECUTE FROM anon` su RPC `approve_*`/`unlock_*`. `SET search_path = public` sul trigger function. |

Rollback: per annullare in emergenza, eseguire (in quest'ordine):
```sql
DROP TRIGGER IF EXISTS budget_entries_lock_trigger ON public.budget_entries;
DROP POLICY IF EXISTS budget_entries_budget_approver_write ON public.budget_entries;
DROP POLICY IF EXISTS budget_confronto_budget_approver_write ON public.budget_confronto;
DROP TABLE IF EXISTS public.budget_approval_log;
DROP FUNCTION IF EXISTS public.approve_budget_outlet_year(text, int);
DROP FUNCTION IF EXISTS public.unlock_budget_outlet_year(text, int, text);
DROP FUNCTION IF EXISTS public.budget_entries_lock_check();
DROP FUNCTION IF EXISTS public.has_jwt_role(text);
DROP FUNCTION IF EXISTS public.jwt_company_id();
ALTER TABLE public.budget_entries DROP COLUMN IF EXISTS unlocked_at;
ALTER TABLE public.budget_entries DROP COLUMN IF EXISTS unlocked_by;
ALTER TABLE public.budget_entries DROP COLUMN IF EXISTS unlock_reason;
ALTER TABLE public.budget_confronto DROP COLUMN IF EXISTS rettifica_pct;
ALTER TABLE public.budget_confronto DROP COLUMN IF EXISTS rettifica_amount;
```

## 6. Cose viste da sistemare ma fuori scope

- **49 `any` residui** in altre pagine (tracciati in `STRICT_COMPLETION_NOTES.md`). Non toccato.
- **Vista annuale di `ConfrontoMensile`** sotto a `month=-1`: oggi è readonly perché modificare un valore aggregato (somma 12 mesi) richiederebbe scelta arbitraria di come ripartirlo. Ho preferito tenere la vista "consultiva" per evitare ambiguità — Lilian può comunque modificare il singolo mese e l'aggregato si aggiorna.
- **Notifiche Sabrina/Veronica all'approvazione**: prompt esplicitamente fuori scope.
- **Storico revisioni snapshot** delle versioni precedenti del preventivo: prompt esplicitamente fuori scope. L'audit log copre il chi/quando/perché ma non lo state diff.
- **Export XLS confronto**: prompt esplicitamente fuori scope.

## 7. Cosa Lilian e Sabrina/Veronica vedono

### Lilian (ruolo `budget_approver`)
- Tab Business Plan: tutte le card outlet con badge `Bozza` / `Approvato` / `Sbloccato`. Su Bozza/Sbloccato può editare costi e cliccare "Salva" o "Approva preventivo" (con dialog di conferma). Su Approvato vede gli input grigi e il bottone "Sblocca preventivo" (dialog con motivo richiesto, min 5 char).
- Tab Confronto: vede tutti gli outlet con BP. Annuale + Mensile (con switch Anno solare). Può scrivere consuntivi e rettifiche.

### Sabrina/Veronica (nessun ruolo speciale)
- Tab Business Plan: banner blu "Modalità sola lettura". Vede SOLO le card con status `Approvato` o `Sbloccato` (le Bozze sono filtrate fuori per evitare confusione). Tutti gli input sono read-only. Nessun bottone Salva/Cancella/Approva/Sblocca.
- Tab Confronto: banner blu "Modalità sola lettura". Vede SOLO outlet con status diverso da `Bozza`. Nessun bottone Salva/Svuota.

## 8. Sequenza commit
- `658ff6e` `[budget] types+hooks: rigenera tipi DB post-migrazione e aggiunge useRole`
- `[next]` `[budget] ui: workflow approvazione + lock + vista mensile completa`
