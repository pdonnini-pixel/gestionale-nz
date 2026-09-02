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

**`extension_in_public` (WARN)** — vedi sotto, intervento del 2026-09-02:
`pg_trgm` è stata spostata, `http` e `pg_net` non sono spostabili.


---

## 2026-09-02 (secondo intervento) — extension fuori da `public`

Migration `20260902_156_pg_trgm_out_of_public.sql`. Delle tre extension
segnalate ne è stata spostata una: le altre due, semplicemente, PostgreSQL non
le sposta.

### Il punto delicato: il search_path

Spostare un'extension cambia la risoluzione dei nomi. Il `search_path` di
default del database è `"$user", public, extensions` sui 3 tenant, quindi le
query normali continuano a risolvere. Il problema erano le funzioni con un
`search_path` PROPRIO, fissato a `public`: sei di esse usano `http_*` o
`similarity` e sono il bridge A-Cube più la riconciliazione bancaria
(`try_match_bank_transaction`, `acube_cf_sync_inbound_production`,
`acube_sdi_sync_inbound_production`, `acube_sdi_sync_outbound_production`,
`acube_ob_sync_all_production`, `check_pixel_and_alert`). Spostare pg_trgm
senza toccarle avrebbe fermato import fatture e riconciliazione.

La migration quindi, PRIMA di spostare, aggiunge `extensions` in **coda** al
`search_path` di ogni funzione public che ne dichiara uno: in coda, così
`public` mantiene la precedenza e nessun nome viene mascherato. Restano fuori
le tre funzioni con `search_path=""` (hardening deliberato, e nessuna usa
pg_trgm o http): `update_tickets_aggiornato_il`, `suppliers_autoslug`,
`_suppliers_slugify`.

### Verifica

Dry-run in transazione con `ROLLBACK` su NZ e Made prima di applicare. Dopo,
sui 3 tenant: `pg_trgm` risulta in `extensions`, l'operatore `%` e
`similarity()` funzionano, `idx_suppliers_name_trgm` è vivo, le 6 funzioni
critiche hanno `extensions` nel search_path, e i conteggi di `suppliers` e
`payables` sono invariati.

La prova sul campo: `try_match_bank_transaction` chiamata su movimenti reali di
NZ (in transazione, poi rollback) restituisce `match_type: auto_fuzzy` con
score 58,06 su una rata di mutuo. Il matching a trigram funziona.

### Perché `http` e `pg_net` sono ancora in public

Non è una dimenticanza. PostgreSQL le rifiuta:

```
ERROR: 0A000: extension "http" does not support SET SCHEMA
ERROR: 0A000: extension "pg_net" does not support SET SCHEMA
```

Sono dichiarate non rilocabili dal proprio control file. L'unica strada è
`DROP EXTENSION` + `CREATE EXTENSION ... SCHEMA extensions`, che ricade sotto
la REGOLA GRANITICA NO DATA LOSS e vuole conferma esplicita di Patrizio.

Accertamenti già fatti, se un domani si decide di procedere:

- `DROP EXTENSION http` **senza** `CASCADE` riesce in transazione: nessun
  oggetto persistente dipende da essa, quindi un drop-e-ricrea atomico non
  perderebbe dati. La finestra in cui `http_*` non esiste dura millisecondi;
  il rischio è che un job `pg_cron` parta proprio in quell'istante
  (`check_pixel_and_alert` gira ogni 30 minuti, i sync A-Cube a orari fissi)
  e fallisca quel giro, ritentando al successivo.
- Per **pg_net** il guadagno sarebbe nullo: i suoi oggetti
  (`http_request_queue`, `_http_response`, entrambi a 0 righe) vivono già
  nello schema `net`, non in `public`. In `public` c'è solo la registrazione
  dell'extension. In più pg_net ha un background worker, che un drop-e-ricrea
  lascia in stato incerto finché non riparte. Sconsigliato: rischio reale a
  fronte di zero beneficio di sicurezza.
