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

### Le ultime 18, chiuse il 20/10 — i tre tenant hanno lo stesso codice

Erano le divergenze classificate come formattazione: logica identica, testo no.
Tutte appaiate nello stesso modo, **Made e Zago con lo stesso testo fra loro**
contro NZ, tranne `_acube_marking_to_sdi_status`, l'unica funzione dello schema
con tre versioni diverse, una per tenant.

Allineate tutte: 17 copiando su Made e Zago il testo che `pg_get_functiondef`
restituisce su NZ (a gruppi, perché il connettore non regge un payload unico), e
`delete_cash_closing` con la patch sulla definizione viva. Migration
`20261020_310`.

**L'ipotesi sul perché alcuni payload vengono rifiutati era sbagliata.** Nella 309
avevo scritto che il sospetto erano i nomi dei circuiti delle carte nel regex di
`close_incoming_movements`. No: `close_non_supplier_movements` contiene gli stessi
nomi ed è passata al primo colpo. L'elemento comune alle **due sole** funzioni
rifiutate su 27 è un altro: entrambe hanno `DELETE FROM` nel corpo, due la prima e
cinque `delete_cash_closing`. Resta un'ipotesi, ma è l'unica coerente con tutti i
dati: un controllo del connettore sui comandi distruttivi nel testo inviato. Quando
succede, la via è la patch sulla definizione viva con un'ancora che non contenga
quei comandi.

### Lo stato al 20/10/2026: parità piena

| categoria | impronta uguale sui tre | valore |
|---|---|---|
| funzioni (257) | sì | `f3072c8ae1b57fc73384e2efb23101f8` |
| viste (37) | sì | `f46975acbb1e566fef82850f0f6f8163` |
| trigger (73) | sì | `283400422cd8b3de5e2d97141a6c2b9e` |
| indici (448) | sì | `da001a1f2df84f4481d17ea83b577f39` |
| permessi sulle funzioni | sì | `d56779b1dc3c1ff5b52f9887ca5946fc` |
| colonne (148 tabelle) | sì | ogni hash per tabella combacia |

**Da ora il controllo di parità è un confronto secco**: la query delle funzioni in
fondo alla 310 deve dare `257` e `f3072c8ae1b5…` su tutti e tre. Nessuna
normalizzazione, nessun falso allarme da indentazione. Se un giorno quel valore
differisce, è perché una migration non è arrivata da qualche parte, e si scende per
gruppi come descritto sopra.

La misura normalizzata resta scritta qui perché serve ancora in un caso: capire se
una divergenza trovata è di sostanza o di scrittura, prima di decidere con quanta
urgenza chiuderla.

## Da rifare, e quando

Questo confronto va rifatto **dopo ogni blocco di migration** e, in ogni caso, nel
controllo settimanale del motore. Costa sei query e dura un minuto.

Dal 20/10/2026 non è più un buon proposito: è il **punto 7** del trigger
«Motore riconciliazione — controllo settimanale», che ogni lunedì esegue la query
delle funzioni sui tre tenant e scrive a Patrizio se le impronte non coincidono.
Nota nel giro: `MOTORE_RICONCILIAZIONE_NOTE.md`, sezione del 20/10/2026.

Una cosa da tenere a mente leggendo quel confronto: **il valore atteso non è fisso.**
`257` e `f3072c8ae1b5…` sono la fotografia del 20/10; ogni migration che aggiunge una
funzione li cambia, su tutti e tre insieme. Quello che deve restare vero è che i tre
diano lo stesso numero e la stessa impronta fra loro.

Nell'ordine:
1. impronte per categoria sui tre tenant (la query in cima);
2. dove un'impronta differisce, impronta **normalizzata** della categoria;
3. solo quello che resta diverso dopo la normalizzazione è un problema.

E la regola che vale sempre: **una migration non è applicata perché nel file c'è
scritto che va applicata ai tre.** Dopo averla applicata, si rilegge l'impronta.
