-- ============================================================================
-- 310 — Le ultime 18 funzioni: i tre tenant ora hanno lo stesso codice
-- ============================================================================
-- Dopo la 308 e la 309 restavano 18 funzioni con testo diverso fra NZ da una parte
-- e Made + Zago dall'altra: logica identica, scrittura no (indentazione, righe
-- vuote, un commento in più, lo spazio dopo una virgola). Tutte e 18 appaiate nello
-- stesso modo — Made e Zago con lo stesso testo fra loro — tranne
-- `_acube_marking_to_sdi_status`, l'unica funzione dello schema con tre versioni
-- diverse, una per tenant.
--
-- Non cambiano comportamento, ma ogni audit futuro le avrebbe segnalate: con i tre
-- tenant identici al carattere, l'impronta complessiva diventa un confronto secco.
--
-- COME SONO STATE ALLINEATE
-- 17 copiando su Made e Zago il testo che `pg_get_functiondef` restituisce su NZ,
-- a gruppi (il connettore non regge un payload unico). La diciottesima,
-- `delete_cash_closing`, con la patch sulla definizione viva della 309: il suo
-- `CREATE OR REPLACE` manda in timeout il connettore, e la patch in fondo a questo
-- file aggira il problema perché nel payload non finisce il corpo della funzione.
--
-- PERCHÉ ALCUNI PAYLOAD VENGONO RIFIUTATI: IPOTESI CORRETTA
-- Nella 309 avevo scritto che il sospetto erano i nomi dei circuiti delle carte nel
-- regex di `close_incoming_movements`. **Sbagliato**: `close_non_supplier_movements`
-- contiene gli stessi nomi (MASTERCARD, VISA) ed è passata al primo colpo.
-- L'elemento comune alle due sole funzioni rifiutate è un altro: entrambe hanno
-- `DELETE FROM` nel corpo — due in `close_incoming_movements`, cinque in
-- `delete_cash_closing` — e sono le uniche fra le 27 toccate oggi. Resta un'ipotesi,
-- coerente con tutti i dati raccolti: un controllo del connettore sui comandi
-- distruttivi nel testo inviato. Quando capita, la via è la patch sulla definizione
-- viva con un'ancora che non contenga quei comandi.
--
-- ESITO VERIFICATO sui tre tenant:
--   · funzioni:  257, impronta f3072c8ae1b57fc73384e2efb23101f8  → identica
--   · viste:     impronta f46975acbb1e566fef82850f0f6f8163       → identica
--   · trigger:   impronta 283400422cd8b3de5e2d97141a6c2b9e       → identica
--   · indici:    impronta da001a1f2df84f4481d17ea83b577f39       → identica
--   · permessi sulle funzioni: d56779b1dc3c1ff5b52f9887ca5946fc  → identica
--   · colonne:   già identiche su tutte e 148 le tabelle (audit del 20/10)
--
-- Le 18, con l'impronta del testo di NZ che è ora quella dei tre tenant:
--   _acube_marking_to_sdi_status        72f24ffa162333693bb196ad8cdcb166
--   _acube_xml_imponibile_iva           386b8e0fe8c5714ccda888b96341c177
--   budget_entries_unflag_placeholder   fecd72b980cc84eddb21a1b5ed84b41c
--   check_pixel_and_alert               9a6dbb2698ec97ca7ceabdf338488f57
--   close_non_supplier_movements        34d6f62fa76aa78ba4129d6058e03c90
--   delete_cash_closing                 9a46e5c6bd203e7c34ff8c37b0fa6472  ← via patch
--   fn_parse_invoice_payments           20de1136a2b11886540d0d783d5cdb3d
--   fn_payable_is_riba                  fab671948ebec79c266c167a9af571ba
--   get_acube_credentials               d486a3a4d816ed4df16cc02a1272b9be
--   get_or_associate_tenant_company     472c37d6e9076ec9a691cc8fd4b9b9a2
--   get_outlet_day_targets              06be8641935536cffc83d3bc4ec35251
--   mark_ticket_seen                    9f2b46c8d035eb4e5a9a39f34b7e9050
--   rerun_group_reconciliation          ecfd3dc8706fbac4b8813f8e8aedc4a6
--   supplier_confirmed_in_text          4d435a3b6e8844b38ab690b96fa8f520
--   suppliers_autoslug                  8e6b43fbe299d9b958625c6380c5dc94
--   trg_acube_cf_config_updated_at      992a4a82924e616c9d6554bd1af73dab
--   trg_set_bank_tx_dedup_hash          305ae677821e5d327c9462b667c33201
--   try_match_amount_bank_transaction   14fe48f6d74284c2599fb1ae044b7066
--
-- Il testo delle 17 non è ripetuto qui: è quello che le migration originali del
-- repo già definiscono, e su NZ è vivo da mesi. Quello che serve per rifare o
-- verificare il lavoro è l'elenco sopra con gli md5, più la query in fondo.
--
-- Nessun dato toccato: solo definizioni di funzione. I permessi sono rimasti quelli
-- di prima (`CREATE OR REPLACE` su una funzione esistente non li azzera), e i
-- trigger che usano queste funzioni sono ancora attaccati.
-- ============================================================================

-- delete_cash_closing: il commento che su NZ spiega perché i file del bucket li
-- rimuove il frontend. Unica differenza fra i tenant (147 caratteri), e unica di
-- queste 18 che ha richiesto la patch. L'ancora non contiene comandi distruttivi.
DO $patch$
DECLARE
  v_s text;
  v_atteso text := '9a46e5c6bd203e7c34ff8c37b0fa6472';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_s
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'delete_cash_closing';
  IF v_s IS NULL THEN RAISE EXCEPTION 'delete_cash_closing non trovata'; END IF;
  IF md5(v_s) = v_atteso THEN RAISE NOTICE 'gia'' allineata'; RETURN; END IF;

  v_s := replace(v_s,
    E'v_photos := cardinality(v_paths);\n\n',
    E'v_photos := cardinality(v_paths);\n\n  -- I file nel bucket li rimuove il frontend via Storage API PRIMA di\n  -- chiamare questa funzione (storage.objects non e'' cancellabile da SQL).\n');

  IF md5(v_s) <> v_atteso THEN
    RAISE EXCEPTION 'la patch non produce il testo di NZ (ottenuto %): non applico niente', md5(v_s);
  END IF;

  EXECUTE v_s;
  RAISE NOTICE 'delete_cash_closing allineata';
END
$patch$;

-- ============================================================================
-- Verifica della parità: sui tre tenant questa query deve dare lo stesso valore
-- ============================================================================
--   SELECT count(*) AS n,
--          md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid)
--              || ')=' || md5(pg_get_functiondef(p.oid)), E'\n'
--              ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) AS impronta
--     FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
--    WHERE ns.nspname = 'public' AND p.prokind = 'f';
--   -- atteso: 257 e f3072c8ae1b57fc73384e2efb23101f8
--
-- Da ora quella riga è il controllo di parità: un solo confronto, nessuna
-- normalizzazione, nessun falso allarme da indentazione.
-- ============================================================================
