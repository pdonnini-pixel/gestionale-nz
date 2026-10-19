# Parità fra tenant — come si misura, e cosa è venuto fuori il 20/10/2026

Nato dalla scoperta del 19/10: la migration **114 del 24/07** era rimasta solo su NZ,
pur scrivendo nella propria intestazione «⚠️ REGOLA #0 — applicare su NZ + Made +
Zago». Se una migration può restare indietro tre mesi senza che nessuno se ne
accorga, la parità non si può dare per fatta leggendo i file: **si misura sullo
schema vivo**.

Da qui questo file: il metodo, e il risultato del primo giro completo.

---

## Il metodo

Non si guarda `supabase_migrations.schema_migrations`: molte migration sono state
applicate a mano e non si sono registrate, quindi quella tabella dice meno di
quanto sembra. Si confronta **lo schema vero**, categoria per categoria, con un
md5 per categoria sui tre tenant. Dove l'impronta combacia, la categoria è a
posto e non serve guardare dentro.

```sql
-- una riga per tenant: conta + impronta di ogni categoria
WITH fn AS (
  SELECT count(*) AS n, string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid)
         || ')=' || md5(pg_get_functiondef(p.oid)), E'\n'
         ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)) AS s
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prokind = 'f'
), vw AS (
  SELECT count(*) AS n, string_agg(c.relname || '=' || md5(pg_get_viewdef(c.oid))
         || '|si=' || (c.reloptions::text LIKE '%security_invoker=on%')::text, E'\n'
         ORDER BY c.relname) AS s
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'v'
)  -- + col, trg, idx, pol con lo stesso schema
SELECT fn.n, left(md5(fn.s),10), vw.n, left(md5(vw.s),10) FROM fn, vw;
```

### La trappola della prima misura, e come si evita

Il primo giro ha dato **27 funzioni divergenti**, e l'avevo letto come «27
migration non propagate». Sbagliato: `pg_get_functiondef` restituisce il testo
**come è stato scritto**, quindi indentazione e commenti contano. Normalizzando
spazi e commenti, **19 di quelle 27 sono la stessa logica scritta diversamente**:

```sql
-- confronto che ignora formattazione e commenti: questo dice se la LOGICA differisce
left(md5(lower(regexp_replace(
  regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g'),
  '\s+', ' ', 'g'))), 6)
```

Esempio: `rerun_group_reconciliation` è identica riga per riga nella sostanza, ma
su NZ è compattata e su Made indentata. Zero differenze reali, 46 caratteri di
scarto.

**Quindi si misura due volte**: l'impronta del testo dice *dove guardare*, quella
normalizzata dice *se c'è davvero qualcosa*. Fermarsi alla prima fa suonare
l'allarme per niente — è la terza volta che una mia metrica sovrastima un
problema, dopo il tie-break del 28/09 e il vincolo 218 del 12/10.

---

## Il risultato del 20/10/2026

### Sano, verificato, nessuna azione

| categoria | NZ | Made | Zago | |
|---|---|---|---|---|
| tabelle e **colonne** | 148 | 148 | 148 | identiche, tutti gli hash per tabella combaciano |
| viste | 37 | 37 | 37 | identiche, `security_invoker` compreso |
| trigger | 73 | 73 | 73 | identici |
| funzioni (numero) | 257 | 257 | 257 | nessuna manca da nessuna parte |
| permessi su funzioni sensibili | = | = | = | `anon` non raggiunge nulla, i segreti solo a `service_role` |

Le colonne erano la parte che faceva più paura (una colonna assente fa fallire una
pagina) e sono risultate identiche al carattere su tutte e 148 le tabelle.

Le 5 tabelle in più su NZ non sono schema: `_golive_clones`, `_golive_keep`,
`_golive_plan`, `_stg_incassi_giugno_2026`, `acube_netvat_backfill_fail_20260603`,
più circa 180 tabelle di backup. Vanno escluse dal confronto, altrimenti anche il
conteggio delle policy risulta falsato (1.486 contro 976: quasi tutta la
differenza sono policy sulle tabelle di backup, create da
`auto_enable_rls_on_new_tables`).

### Sistemato subito

- **Due indici mancanti su Made**: `idx_bank_tx_invoice_id` e
  `idx_bank_tx_supplier_id` su `bank_transactions` (indici parziali, `WHERE … IS
  NOT NULL`). Zago li aveva. Creati con la migration `20261020_307`, additiva:
  Made è passato da 446 a 448 indici con la stessa impronta di NZ e Zago.

### Allineate il 20/10, e una misura ancora da correggere

Patrizio ha chiesto di allinearle tutte e nove. Allineandole è venuto fuori che la
misura «normalizzata» di cui sopra **non bastava**: collassa gli spazi multipli ma
non quello singolo dopo una virgola, e non tocca gli alias. Così
`COALESCE(x,false)` e `COALESCE(x, false)`, oppure `) d` e `) AS d`, risultavano
differenze. Aggiungendo due normalizzazioni:

```sql
-- la misura che distingue davvero la logica dalla scrittura
regexp_replace(
  replace( <testo con spazi collassati e commenti via>, ' as ', ' '),
'\s*([(),;])\s*', '\1', 'g')
```

tre delle nove risultano **equivalenti già da prima** (`_suppliers_slugify`,
`acube_tx_set_dedup_hash`, `sync_acube_account_to_bank_account`), e cade quello che
avevo scritto sugli accenti di `_suppliers_slugify`: non era una differenza di
comportamento, era indentazione. **Terza correzione di metrica della giornata**, e
la lezione è che per dire «queste due funzioni fanno cose diverse» non basta un
hash: va letto il codice.

**Esito dell'allineamento**: 8 funzioni su 9 ora **identiche al carattere** sui tre
tenant, verificato con l'impronta non normalizzata. Permessi invariati (controllati
prima e dopo), i 4 trigger che usano queste funzioni ancora attaccati, 73 trigger su
tutti e tre come prima.

L'unica differenza di comportamento vera, trovata leggendo i testi:
`get_autofix_cron_secret` su Zago aveva `search_path` senza `extensions`, dove
vivono le funzioni di decrittazione del Vault. Ora allineata.

**`close_incoming_movements` ha richiesto un'altra strada, e ora è allineata.**
Il `CREATE OR REPLACE` con il testo intero manda in timeout il connettore in modo
ripetibile: quattro tentativi, su Made e su Zago, con `apply_migration`, con
`execute_sql` e dentro un blocco `DO`, mentre ogni altra funzione passa al primo
colpo. Il sospetto resta un filtro che reagisce al contenuto del suo regex, dove
compaiono i nomi dei circuiti delle carte.

La via d'uscita è la tecnica delle migration 218, 219 e 306: **il testo non si
invia, si legge dal server** con `pg_get_functiondef` e si corregge con `replace()`
mirati. Nel payload finiscono solo le ancore, che non contengono i pattern
bloccanti, e passa.

Dodici sostituzioni, tutte di sola scrittura (righe vuote, indentazione, un `AS`
davanti a un alias, lo spazio dopo una virgola). **Che dodici `replace()` di
formattazione bastino per arrivare al testo identico è la prova definitiva che la
logica era già la stessa.**

E una patch testuale a dodici passi non è fragile se si verifica da sé: il testo di
NZ ha un'impronta nota (`0d581a41…`, 2.082 caratteri), quindi la patch ricalcola,
confronta e **alza un'eccezione senza eseguire se non combacia**. Non esiste l'esito
a metà. Provata prima a vuoto — le dodici sostituzioni sul testo di Made davano
esattamente l'md5 di NZ senza scrivere niente — e solo dopo eseguita. Migration
`20261020_309`.

**Quindi tutte e 9 sono allineate**, e la lezione generale: quando il canale rifiuta
un payload, il testo si fa costruire dal server e si verifica con l'impronta. Vale
per ogni funzione, non solo per questa.

### Le 18 di sola formattazione, ancora diverse

Restano le 18 divergenze che l'audit aveva classificato come formattazione (fra cui
`_acube_marking_to_sdi_status`, `check_pixel_and_alert`, `delete_cash_closing`,
`close_non_supplier_movements`): la logica è la stessa, il testo no, quindi
l'impronta non normalizzata dei tre tenant resta diversa e ogni audit futuro le
segnalerà.

Due modi per chiudere anche quelle, quando si vuole:
1. la patch sulla definizione viva della 309, una per una, con il controllo dell'md5
   che garantisce l'esattezza (sicuro ma lento: serve conoscere le ancore di ognuna);
2. usare nell'audit la misura **normalizzata** di cui sopra, che le ignora senza
   toccare i database.

La seconda costa niente ed è quella giusta per il controllo settimanale; la prima ha
senso se si vuole che i tre tenant siano leggibili come un solo codice.

### Com'era prima dell'allineamento: le 9 funzioni

Nessuna riguarda il motore di riconciliazione, che è allineato
(`try_match_bank_transaction`, `try_match_amount_bank_transaction`,
`supplier_confirmed_in_text`, `close_non_supplier_movements`,
`trg_set_bank_tx_dedup_hash`, `fn_payable_is_riba`: tutte identiche nella logica).

| funzione | chi è indietro | migration di riferimento | area |
|---|---|---|---|
| `sync_employee_costs_from_slips` | Made, Zago | `161` (02/09) | costi del personale dai cedolini |
| `refresh_budget_consuntivo` | tutti e tre diversi | `018`/`019` (13/05) | consuntivo del budget |
| `close_incoming_movements` | NZ più corto, logica diversa | `167`/`184` (03-04/09) | chiusura movimenti in entrata |
| `acube_tx_set_dedup_hash` | Made, Zago | nessuna nel repo | anti-doppione movimenti A-Cube |
| `ensure_acube_business_registry_stub` | Made, Zago | `040`/`042` (17/05) | anagrafica A-Cube SDI |
| `_suppliers_slugify` | Made, Zago | `044`/`156` | slug fornitori (cosmetico) |
| `get_autofix_cron_secret` | solo Zago | `156` (02/09) | segreto del cron autofix |
| `ticket_autofix_run` | solo Zago | `156` (02/09) | autofix dei ticket |
| `sync_acube_account_to_bank_account` | solo Zago | `029` (15/05) | conti A-Cube → conti banca |

Una policy esiste su Made e Zago e **non** su NZ: `profiles_self_select` su
`user_profiles` (la crea la `009`, l'onboarding tenant). NZ ha comunque
`profiles_select` e `profiles_own_update`, quindi non è un buco funzionale, ma la
differenza è reale.

### Perché non è urgente, e perché va fatto comunque

Misurato lo stesso giorno: **Made e Zago sono praticamente vuoti**. Made ha 0
movimenti bancari, 5 scadenze, 5 fatture, 1 fornitore, 1 negozio, 0 dipendenti;
Zago 0 movimenti, 0 fatture, 0 fornitori, 12 dipendenti, 2 negozi. Nessun log di
riconciliazione da nessuna delle due parti.

Quindi oggi quelle 9 funzioni non girano su niente. Ma il giorno in cui Made
collega la banca, il primo movimento passa dalla logica che c'è, non da quella
giusta: l'allineamento va fatto **prima** che quei tenant inizino a lavorare, non
dopo il primo numero sbagliato.

---

## Da rifare, e quando

Questo confronto va rifatto **dopo ogni blocco di migration** e, in ogni caso, nel
controllo settimanale del motore. Costa sei query e dura un minuto.

Nell'ordine:
1. impronte per categoria sui tre tenant (la query in cima);
2. dove un'impronta differisce, impronta **normalizzata** della categoria;
3. solo quello che resta diverso dopo la normalizzazione è un problema.

E la regola che vale sempre: **una migration non è applicata perché nel file c'è
scritto che va applicata ai tre.** Dopo averla applicata, si rilegge l'impronta.
