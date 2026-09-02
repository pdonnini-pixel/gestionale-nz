# Note — Advisor di sicurezza Supabase

Stato degli avvisi del Security Advisor sui 3 tenant e cosa è stato fatto.
Aggiornare questo file ogni volta che si interviene sugli advisor.

Tenant: **NZ** `xfvfxsvqpnpvibgeqpqp` · **Made** `wdgoebzvosspjqttitra` · **Zago** `jxlwvzjreukscnswkbjx`

---

## 2026-09-02 — Chiusura della segnalazione Supabase del 31/08

Supabase aveva mandato una mail di alert su due problemi «critici»: tabella
accessibile pubblicamente e dati sensibili accessibili via API. Verificando gli
advisor sono emersi tre problemi reali, chiusi con le migration 152, 153 e 154.

### 1. Tabelle di backup senza RLS — advisor `0013_rls_disabled_in_public` (ERROR)

Alcune tabelle di backup nate da `CREATE TABLE ... AS SELECT` durante gli
interventi sul ciclo passivo non avevano row level security. Stando nello schema
`public`, PostgREST le esponeva su `/rest/v1/<tabella>`: bastava la anon key,
che è pubblica e sta nel bundle JS. Contenevano copie di payables,
bank_transactions e log di riconciliazione, quindi IBAN, P.IVA e importi.

Interessate: 10 su NZ, 1 su Made, 1 su Zago (elenco nella migration 152).

**Fix** — migration `20260902_152_rls_enable_backup_tables.sql`: `ENABLE ROW
LEVEL SECURITY` senza policy. Una tabella con RLS attivo e zero policy è chiusa
per tutti i ruoli non-bypass; `postgres` e `service_role` hanno `BYPASSRLS`
(verificato), quindi Edge Function e manutenzione continuano a leggere i backup.
Nessuna riga toccata.

### 2. Vista SECURITY DEFINER — advisor `0010_security_definer_view` (ERROR)

`v_payables_operative` era tornata a girare come SECURITY DEFINER, ignorando la
RLS delle tabelle sottostanti. La vista espone `supplier_iban`, `supplier_vat` e
tutti gli importi: un utente autenticato di un'azienda avrebbe visto i dati di
tutte. È la seconda metà della segnalazione «dati sensibili».

**Causa, per la terza volta**: `CREATE OR REPLACE VIEW` rigenera i reloptions ai
default e cancella `security_invoker`. Storia: 069 lo mette → 106 lo perde →
113 lo rimette → 143/144 lo perdono → 153 lo rimette.

**Fix** — migration `20260902_153_views_security_invoker_sweep.sql`: sweep
idempotente su tutte le viste `public.v_*`.

**Presidio** — `tools/check-view-security-invoker.mjs`, job CI
`view-security-invoker`: blocca la PR se una migration nuova crea una vista
`public.v_*` senza `WITH (security_invoker = on)`. Guarda solo le migration
toccate dalla PR (quelle vecchie sono immutabili e già sanate dalla 153).

### 3. RPC eseguibili senza login — advisor `0028_anon_security_definer_...` (WARN)

Le 10 RPC del flusso RiBa create ad agosto 2026 erano `SECURITY DEFINER` con il
`GRANT EXECUTE` di default a `PUBLIC`, che include `anon`. Con la sola anon key
chiunque poteva chiamarle su `/rest/v1/rpc/<nome>` senza autenticarsi. Non sono
di sola lettura: `rpc_confirm_riba_distinta`, `rpc_riba_provisional_undo`,
`rpc_link_riba_credit_note` e `rerun_riba_provisional_close` scrivono su
`payables`. Stesso buco chiuso dalla 116 per le RPC di proposte e anomalie: le
funzioni nuove non erano coperte.

**Fix** — migration `20260902_154_lockdown_anon_definer_functions.sql`: revoke da
`PUBLIC` e `anon`, grant ad `authenticated` e `service_role`. Sweep dinamico, così
copre anche le RPC che verranno. Nessuna regressione: le chiamate partono tutte
da pagine dietro `ProtectedRoute`, quindi con sessione loggata.

### Verifica fatta sul DB vivo (non «dovrebbe funzionare»)

Prima di applicare, dry-run in transazione con `ROLLBACK` impersonando un utente
`authenticated` reale su ogni tenant. Dopo, riletti gli stessi numeri:

| | NZ | Made | Zago |
|---|---|---|---|
| Righe `v_payables_operative` prima → dopo | 1.418 → 1.418 | 4 → 4 | 0 → 0 |
| Scadenze non pagate (NZ) | 437 | — | — |
| Residuo da pagare (NZ) | 985.285,78 € | — | — |
| Righe `payables` | 1.480 | 4 | 0 |
| Backup letti da `anon` | 0 | 0 | 0 |
| Backup letti da `service_role` | 11 | 0 | 0 |
| RPC RiBa eseguibili da `anon` | no | no | no |
| RPC RiBa eseguibili da `authenticated` | sì | sì | sì |

Advisor dopo il fix, sui 3 tenant: **0 ERROR, 0 warning `anon_security_definer`**.

---

## Cosa resta aperto (non è un buco, ma va saputo)

**`rls_enabled_no_policy` (INFO — 66 NZ, 7 Made, 7 Zago)**
È lo stato *desiderato* per le tabelle di backup: RLS attivo e nessuna policy
significa chiuse a chiunque non abbia BYPASSRLS. L'advisor lo segnala perché
spesso è una dimenticanza, qui è la scelta. Nessuna azione.

**`authenticated_security_definer_function_executable` (WARN — 51 per tenant)**
Sono le RPC dell'app, legittimamente chiamate da utenti loggati; alcune servono
dentro le policy RLS (`get_my_company_id`). Revocarle romperebbe il gestionale:
per un'app Supabase questo warning è atteso. Già motivato nella migration 116.
La protezione vera è che ognuna filtri per `company_id`.

**`extension_in_public` (WARN — `pg_trgm` e `http`, più `pg_net` su Made e Zago)**
Spostarle in uno schema dedicato impone di aggiornare il `search_path` di tutte
le funzioni che le usano (ricerca fuzzy fornitori, chiamate HTTP delle Edge
Function). Non è un'esposizione di dati: rimandato a un intervento dedicato, da
fare con calma e verifica sui 3 tenant.
