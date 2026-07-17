# 🔍 Super Audit Multi-Agente — Gestionale NZ v2.0

**Data:** 17 luglio 2026
**Branch:** `claude/multiagent-audit-uvgp49`
**Ambito:** UX, logica di business, usability, accessibilità, sicurezza, integrità dati, performance, isolamento multi-tenant, allineamento guide.

---

## Metodologia

L'audit è stato eseguito con un workflow multi-agente:

- **16 auditor paralleli**, uno per area: analisi economica (Dashboard/Confronto/CE/Budget), tesoreria e cassa, ciclo passivo/scadenzario, fatturazione e fornitori, import e documenti, analytics retail, amministrazione e accessi, ticket/AI/aiuto, navigazione e layout, hooks e data-fetching, Edge Functions, isolamento tenant, accessibilità, allineamento guide, integrità dati/form, performance.
- **16 verificatori avversariali**: ogni finding è stato ricontrollato da un secondo agente scettico che ha riaperto i file citati e confermato o refutato il problema leggendo il codice reale.
- Totale: **32 agenti, 933 letture/ricerche sul codice**.

**Risultato grezzo:** 192 finding → **189 confermati**, 2 incerti, 1 refutato.
**Dopo deduplica** (stesso problema segnalato da più auditor — di per sé un segnale di gravità): **161 finding unici**.

| Severità | Quanti |
|---|---|
| 🔴 Critica | 14 |
| 🟠 Alta | 56 |
| 🟡 Media | 78 |
| 🔵 Bassa | 13 |

| Categoria | Quanti (su 189 grezzi) |
|---|---|
| Logica (bug, calcoli errati, race condition) | 67 |
| Integrità dati | 49 |
| Usability | 26 |
| Sicurezza | 20 |
| Performance | 10 |
| UX | 9 |
| Accessibilità | 8 |

> **Nota importante sul codice morto:** diversi finding riguardano pagine NON instradate (`Banche.tsx`, `Scadenzario.tsx` v1, `CashFlow.tsx`, `Importazioni.tsx`, `Contratti.tsx` legacy — circa 7.700 righe). I bug lì dentro non sono raggiungibili dagli utenti oggi, ma il codice è fuorviante e pericoloso se qualcuno lo ri-instrada. Sono marcati nel testo dove rilevante.

---

## Sintesi esecutiva — i 7 temi che emergono

1. **Sicurezza Edge Functions (il più urgente).** Il webhook `sdi-receive` è pubblico e senza alcuna autenticazione: chiunque conosca l'URL può iniettare o alterare fatture elettroniche, e la function scrive con service role. In più: controllo ruolo con fallback su `user_metadata` (modificabile dal client) in 10 function A-Cube, `company_id` preso dal body senza verifica contro il JWT, nessuna idempotenza su `acube-payment-send` (doppia invocazione = doppio pagamento SEPA reale).

2. **Parità tenant violata in punti fiscali.** Ragione sociale, P.IVA e sede di New Zago sono hardcoded nel Convertitore XML e in `acube-sdi-send-invoice`: su Made e Zago si generano/inviano **documenti fiscali intestati all'azienda sbagliata**. Stesso tema: URL Supabase NZ come fallback in `AICategorization`/`Ticket`, `returnUrl` dei pagamenti PSD2 fisso su `gestionale-nz.netlify.app`, colori outlet e saluto "Patrizio" hardcoded.

3. **Flusso pagamenti fragile (ScadenzarioSmart).** Le fatture vengono marcate "pagato" PRIMA che il pagamento PSD2 sia autorizzato e senza rollback; una nota di credito può essere compensata su più fatture; dopo un acconto la fattura non può mai entrare in una seconda distinta per il saldo; aggiornamenti `amount_paid` con read-modify-write senza lock (lost update con più operatrici).

4. **Salvataggi non atomici (regola NO DATA LOSS a rischio).** Pattern DELETE-poi-INSERT lato client senza transazione in ContoEconomico (bilanci), BudgetControl (budget_confronto), rateizzazione, regole di allocazione: un errore a metà lascia il DB mutilato. Più hard DELETE dal frontend su tabelle vive (outlet, ticket, scadenze fiscali, utenti, piano dei conti).

5. **Errori sistematicamente silenziati.** In decine di punti gli errori Supabase non vengono controllati (`const { data } = await ...` senza `error`), con catch vuoti o toast di successo anche su fallimento: l'utente vede zeri o stati vuoti indistinguibili da dati reali. Correlato: il cap PostgREST di 1000 righe viene superato con `.range(0,9999)` in più pagine → troncamenti silenziosi dei dati.

6. **Incoerenze UX trasversali.** Il selettore periodo globale è mostrato anche su pagine che lo ignorano (Dashboard etichetta "Q2" su dati annuali); 7+ varianti locali di KpiCard invece del componente condiviso; feedback misto tra toast custom e `window.confirm` nativi; 5 route orfane raggiungibili solo da URL; navigazione mobile con tab che puntano alla pagina sbagliata.

7. **Accessibilità quasi assente sui pattern chiave.** Nessuna modale dell'app ha `role="dialog"`, focus trap o gestione Escape; ordinamento tabelle e righe cliccabili solo col mouse; toast non annunciati agli screen reader; stati comunicati solo dal colore.

---

## Piano d'attacco consigliato (ordine di priorità)

| # | Intervento | Finding coperti |
|---|---|---|
| 1 | **Mettere in sicurezza le Edge Functions**: shared secret/firma sul webhook `sdi-receive`, ruoli SOLO da `app_metadata`/`user_profiles`, `company_id` sempre dal JWT, chiave di idempotenza su `acube-payment-send` | C12–C14 + 4 alti |
| 2 | **Eliminare i dati cedente hardcoded** (Convertitore XML, `acube-sdi-send-invoice`): leggere da `companies` del tenant attivo; spostare il ProgressivoInvio da localStorage a sequenza DB | C3–C4 + 5 alti |
| 3 | **Correggere il ciclo di stato pagamenti** in ScadenzarioSmart: stato "in_autorizzazione" prima del PSD2, "pagato" solo a esito confermato, vincolo sull'uso singolo delle note di credito, sblocco del saldo dopo acconto | C9–C11 + 3 alti |
| 4 | **Rendere atomici i salvataggi** critici via RPC Postgres transazionali (bilancio, budget, rateizzazione, allocazioni) | C1, C7 + 4 alti |
| 5 | **Fix del bug timezone** (`toISOString` per date locali) in Prima Nota, ScadenzarioSmart e ScadenzeFiscali | C6 + 2 medi |
| 6 | **Introdurre un helper fetch condiviso** che controlla `error`, pagina oltre le 1000 righe e mostra stato errore reale in UI | ~25 finding |
| 7 | **Cancellare il codice morto** (~7.700 righe di pagine non instradate + ~30 cartelle `dist_*` committate) | ~10 finding |
| 8 | **Componente `Modal` condiviso accessibile** (dialog, focus trap, Escape) + coerenza toast/conferme | ~12 finding |
| 9 | **Riallineare guide e CI** (`pageGuides.ts`: route orfane documentate, toggle promessi ma inesistenti, pagina Revisione senza guida) | ~8 finding |

Ogni intervento frontend vale automaticamente per i 3 tenant via Netlify; i punti 1–2 richiedono deploy delle Edge Functions su **NZ + Made + Zago** e il punto 4 migration SQL sui 3 tenant.

---

# Elenco completo dei finding (verificati e deduplicati)

Ordinati per severità, poi per file. Dove indicato, il finding è stato segnalato indipendentemente da più auditor.


## 🔴 CRITICA — 14 finding

### C1. Salvataggio bilancio con DELETE-poi-INSERT non atomico: rischio perdita dati reali

**Dove:** `src/pages/ContoEconomico.tsx:1571` · **Categoria:** Integrità dati

commitBilancio (righe 1567-1597) cancella intere sezioni di balance_sheet_data con DELETE in loop e poi inserisce i nuovi record in batch da 100. Se un insert fallisce a metà (rete, RLS, vincolo), le sezioni già cancellate restano vuote: i dati del bilancio importato (tabella viva, 535 righe in produzione) sono persi senza backup. Lo stesso pattern è in commitImportedData (righe 1432-1444) e in handleSaveManualChanges (righe 1532-1547, delete+insert per singolo record senza transazione). Il modale di conferma mostra il prima/dopo ma non protegge dal fallimento a metà operazione — in violazione della regola granitica NO DATA LOSS del progetto.

**Proposta:** Sostituire il pattern delete+insert lato client con una RPC Postgres che esegua DELETE e INSERT nella stessa transazione (o un upsert su chiave company_id/year/period_type/section/account_code). In alternativa minima: eseguire prima tutti gli INSERT con un flag/version temporaneo e cancellare le righe vecchie solo a insert riusciti.

### C2. Allegati del modal Nuovo contratto: viene caricato un oggetto {name,size} invece del File — contenuto PDF perso

**Dove:** `src/pages/Contratti.tsx:280` · **Categoria:** Integrità dati

Nel modal ModalNuovoContratto l'input file salva in stato solo `{ name: f.name, size: f.size }` (riga 280: `setAttachments(prev => [...prev, ...files.map(f => ({ name: f.name, size: f.size }))])`), scartando l'oggetto File reale. Poi `uploadAttachments` (righe 107-109) passa questo plain object a `supabase.storage.from('contract-documents').upload(filePath, file)`: il body non è un Blob/File valido, quindi il contenuto del PDF non viene mai caricato correttamente. In più (riga 112-117) il record in `contract_documents` viene inserito comunque, con `file_path: storageErr ? null : filePath`, creando un documento fantasma non apribile. L'utente crede di aver allegato il contratto ma il file è perso. Il PdfUploader inline (riga 326+) invece usa i File veri e funziona: il bug è solo nel percorso del modal.

**Proposta:** In ModalNuovoContratto conservare gli oggetti File reali nello stato (`setAttachments(prev => [...prev, ...files])`) come già fa PdfUploader. In uploadAttachments, se `storageErr` è valorizzato NON inserire il record in contract_documents (o inserirlo con stato di errore visibile) e mostrare un messaggio all'utente invece di proseguire in silenzio.

### C3. Dati cedente NEW ZAGO hardcoded nel convertitore XML: viola la parità tenant

**Dove:** `src/pages/ConvertitoreFattureXML.tsx:24` · **Categoria:** Integrità dati · *segnalato indipendentemente da 4 auditor*

La pagina /fatturazione/converti-xml (registrata in App.tsx:136 per TUTTI i tenant, senza alcun gating) genera XML FatturaPA con cedente completamente hardcoded: CEDENTE_PIVA='07362100484' (riga 24), IdTrasmittente e IdFiscaleIVA fissi (righe 206, 213), Denominazione 'NEW ZAGO S.R.L.' e sede 'VIA IX FEBBRAIO 7, FIRENZE' (righe 214-217). Se un'operatrice di Made Retail o Zago usa la pagina (Sabrina/Veronica alternano i 3 tenant, come nota lo stesso tenants.ts:22), produce fatture elettroniche fiscalmente attribuite a New Zago. È una violazione diretta della regola #5 di CLAUDE.md ('MAI valori hardcoded specifici di un tenant: company_id, P.IVA'). Anche la guida in pageGuides.ts:1768 documenta il dato fisso invece di segnalare il problema.

**Proposta:** Leggere i dati cedente dalla tabella companies del tenant attivo (ragione sociale, P.IVA, indirizzo, regime fiscale) all'apertura della pagina, con blocco esplicito della generazione se mancano. In alternativa minima: gate della route sul tenant 'newzago' via getCurrentTenant(). Aggiornare la voce in src/data/pageGuides.ts nello stesso commit.

### C4. Cedente hardcoded 'NEW ZAGO S.R.L.' + P.IVA nel convertitore fatture XML condiviso dai 3 tenant

**Dove:** `src/pages/ConvertitoreFattureXML.tsx:206` · **Categoria:** Integrità dati

La funzione buildXml genera fatture elettroniche FPR12 con IdTrasmittente e CedentePrestatore fissi nel codice: P.IVA 07362100484, denominazione 'NEW ZAGO S.R.L.', sede 'VIA IX FEBBRAIO 7, FIRENZE' (righe 206, 213-217). La pagina è routata per tutti i tenant (/fatturazione/converti-xml in App.tsx:136) e il frontend è identico su NZ, Made e Zago: un utente di Made Retail o Zago può generare XML fiscali (destinati all'import in Agenzia delle Entrate) intestati a New Zago. Viola la regola non negoziabile 'MAI valori hardcoded specifici di un tenant (company_id, P.IVA...)' e produce documenti fiscali legalmente errati.

**Proposta:** Leggere denominazione, P.IVA, indirizzo e regime fiscale del cedente dalla tabella companies del tenant attivo (già disponibile via useCompany) e bloccare la generazione con un messaggio chiaro se i dati anagrafici mancano. In alternativa minima: nascondere la pagina sui tenant diversi da NZ finché i dati non sono parametrizzati. Aggiornare anche la guida in pageGuides.ts (righe 1768 e 1830) che oggi descrive il cedente fisso.

### C5. Eliminazione outlet: hard DELETE a cascata su tabella critica senza soft-delete

**Dove:** `src/pages/Outlet.tsx:2123` · **Categoria:** Integrità dati

confirmDelete() esegue DELETE fisico su outlets (tabella marcata CRITICA in CLAUDE.md), cancella le righe outlet_attachments (riga 2128) e azzera employees.outlet_id (riga 2131). I file su Storage degli allegati NON vengono rimossi (orfani), e i dati storici collegati (daily_revenue, budget per cost_center, documenti in contract_documents/documents) restano orfani puntando a un outlet inesistente. Il modal chiede una sola conferma generica. Questo viola la regola granitica NO DATA LOSS del progetto: il codice ha già un meccanismo di chiusura (closing_date/is_active in getOutletStatus, riga 49) che sarebbe il pattern corretto.

**Proposta:** Sostituire il DELETE con soft-close: UPDATE outlets SET is_active=false, closing_date=now(). Riservare il DELETE fisico solo a outlet appena creati per errore (es. senza ricavi/documenti collegati, verificato con una count preliminare), e in quel caso rimuovere anche i file da Storage prima di cancellare le righe outlet_attachments. Nel modal indicare esplicitamente cosa verrà perso.

### C6. Prima Nota esclude l'ultimo giorno del mese (bug timezone su dateEnd)

**Dove:** `src/pages/PrimaNota.tsx:87` · **Categoria:** Integrità dati

Il confine del periodo è calcolato con `new Date(year, month, 0).toISOString().slice(0, 10)`. `new Date(year, month, 0)` crea la mezzanotte LOCALE dell'ultimo giorno del mese; `toISOString()` converte in UTC, e in Italia (UTC+1/+2) torna indietro di 1-2 ore, cioè al giorno precedente. Esempio: Luglio 2026 → 31/07 00:00 CEST → '2026-07-30T22:00:00Z' → dateEnd = '2026-07-30'. Il filtro `.lte('transaction_date', dateEnd)` esclude quindi TUTTI i movimenti dell'ultimo giorno di ogni mese, sia dalla tabella/KPI sia dagli export CSV/XLSX consegnati alla commercialista, in silenzio e su tutti e 3 i tenant.

**Proposta:** Costruire la data senza passare da UTC: `const lastDay = new Date(year, month, 0).getDate(); const dateEnd = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}``, oppure usare `Date.UTC`. Aggiungere un test sul confine di mese.

### C7. Rateizzazione non atomica con errori Supabase ignorati: la fattura originale viene annullata anche se le rate non vengono create

**Dove:** `src/pages/Scadenzario.tsx:920` · **Categoria:** Integrità dati

In handleRateizza (righe 920-953) la fattura originale viene subito marcata status='annullato', poi le N rate vengono inserite una per una in un ciclo for. Nessuna delle chiamate `await supabase.from('payables').insert(...)` controlla `error`: supabase-js v2 NON lancia eccezioni ma restituisce `{ error }`, quindi il try/catch alle righe 949-952 non intercetta mai un insert fallito (RLS, rete, vincolo). Scenario concreto: l'update ad 'annullato' riesce, gli insert delle rate falliscono → la scadenza sparisce dallo scadenzario (annullata) senza alcuna rata creata, il debito verso il fornitore diventa invisibile e l'utente vede la modale chiudersi come se fosse andato tutto bene. Su un sistema LIVE con la regola granitica NO DATA LOSS è il rischio peggiore possibile.

**Proposta:** Invertire l'ordine (prima creare TUTTE le rate, controllando `error` su ogni insert — meglio un unico insert batch con l'array di righe — e solo se riuscito marcare l'originale 'annullato'); in alternativa spostare tutta l'operazione in una RPC Postgres transazionale. Controllare sempre `const { error } = await ...` e mostrare toast di errore senza chiudere la modale.

### C8. Import XML SDI e CRUD fornitori inseriscono righe senza company_id e senza controllo errori (multi-tenant a rischio, import duplicabile)

**Dove:** `src/pages/Scadenzario.tsx:1023` · **Categoria:** Integrità dati

handleConfirmXmlImport (righe 999-1043) inserisce suppliers (riga 1012) e payables (riga 1023) SENZA company_id, in contrasto con la regola 'ogni query filtra per company_id' e con l'equivalente ScadenzarioSmart.handleCreateInvoice che invece lo valorizza (riga 1546). Stesso problema in handleSaveSupplier (riga 961): insert del fornitore senza company_id. Se le policy RLS richiedono il tenant, gli insert falliscono ma nessun `error` viene controllato: la modale si chiude e l'utente crede che l'import sia riuscito (le fatture semplicemente non compaiono); se il DB ha un default permissivo si creano righe orfane/di tenant sbagliato. Inoltre non esiste alcun controllo duplicati: reimportare lo stesso XML crea payables doppi (stesso numero fattura, stesso fornitore), gonfiando il totale da pagare.

**Proposta:** Valorizzare sempre company_id dal profilo (come fa ScadenzarioSmart), controllare `error` di ogni insert con toast esplicito e rollback/annullamento dell'import, e prima dell'insert verificare l'esistenza di un payable con stessa (company_id, supplier P.IVA, invoice_number, due_date) segnalando i duplicati nella modale di anteprima.

### C9. La stessa nota di credito può essere compensata su più fatture: la seconda fattura resta sotto-pagata per sempre

**Dove:** `src/pages/ScadenzarioSmart.tsx:437` · **Categoria:** Integrità dati

openCreditNotesFor (riga 437-448) restituisce TUTTE le NC aperte del fornitore (filtra solo closed_manually) e i pulsanti 'Scala note di credito' (righe 3786-3800) non escludono le NC già selezionate nel piano di un'altra fattura in distinta, né quelle con link 'pending' in payable_credit_note_links da una distinta precedente confermata. Se la stessa NC viene scalata su due fatture (nella stessa distinta o in due distinte successive), entrambi i bonifici escono al netto della NC. Lato server (supabase/migrations/20260713_090_credit_note_links_reconcile.sql, righe 95-118) la prima riconciliazione chiude la NC per intero; alla seconda il link viene marcato 'cancelled' — ma il bonifico della seconda fattura era già stato ridotto: la fattura resta 'parziale' con un residuo pari alla NC che nessuno pagherà mai. Inoltre apply_credit_note_links chiude sempre la NC per l'importo PIENO anche quando il frontend l'ha usata solo parzialmente (net clampato a 0 in recomputePlan, riga 462).

**Proposta:** Nel frontend: (1) in openCreditNotesFor escludere le NC già presenti negli ncIds di un altro paymentPlan selezionato; (2) alla fetch, caricare i link 'pending' da payable_credit_note_links ed escludere/contrassegnare le NC già impegnate in una distinta confermata; (3) mostrare un badge 'NC già impegnata su fattura X'. Lato DB valutare un vincolo/verifica in apply_credit_note_links che rifiuti il consumo di una NC con altro link pending, invece di cancellarlo silenziosamente.

### C10. Dopo un pagamento in ACCONTO la fattura non può mai entrare in una seconda distinta per il saldo

**Dove:** `src/pages/ScadenzarioSmart.tsx:1862` · **Categoria:** Logica

L'indice unico payable_actions_disposizione_unique (supabase/migrations/20260611_066_payable_actions_disposizione_unique.sql) ammette UNA sola riga 'disposizione' per payable, per sempre, e nessuna migration la elimina alla riconciliazione (verificato: nessun DELETE su payable_actions per action_type='disposizione'). Flusso rotto: pago un ACCONTO via distinta → il movimento viene riconciliato → confirm_reconciliation (migration 064, riga 62) mette status='parziale' → la fattura ha ancora disposizione_date + status non pagato, quindi isInDistinta=true (riga 2286): sparisce dalla lista attiva, toggleSelect avvisa 'non verrà aggiunta di nuovo' (riga 397-399) e confirmDistinta la salta nel dedup (righe 1852-1863). Il residuo non è più disponibile per una nuova distinta: l'unico workaround è 'Rimuovi dalla distinta', che però CANCELLA la riga di disposizione dell'acconto già eseguito, perdendo la traccia storica. La guida (pageGuides.ts, FAQ ACCONTO/SALDO) descrive un flusso a due passi che il sistema non permette di completare.

**Proposta:** Considerare 'chiusa' la disposizione quando il suo movimento è stato riconciliato: es. aggiungere una colonna/flag (o confrontare amount con amount_paid) e ridefinire isInDistinta e il dedup su disposizioni 'aperte'; rendere parziale l'indice unico (WHERE non riconciliata) così una fattura 'parziale' può ricevere una nuova disposizione per il saldo senza cancellare quella dell'acconto.

### C11. confirmPaymentsViaAcube marca le fatture come pagate PRIMA di chiamare l'Edge Function A-Cube, senza rollback in caso di errore

**Dove:** `src/pages/ScadenzarioSmart.tsx:2097` · **Categoria:** Logica · *segnalato indipendentemente da 3 auditor*

Nel flusso 'Paga via A-Cube' (confirmPaymentsAcube), lo step 3 (righe 2097-2116) esegue `supabase.from('payables').update({ amount_paid, status: 'pagato'/'parziale', ... })` e l'insert su payable_actions PRIMA di chiamare l'Edge Function `acube-payment-send` (riga 2119) e prima che l'utente firmi l'autorizzazione PSD2 sulla banca. Se la Edge Function fallisce (`fnErr` → `continue` a riga 2122) o l'utente non firma mai l'URL aperto, le fatture restano marcate come pagate con amount_paid aggiornato, senza alcun rollback. Inoltre gli update/insert dello step 3 non controllano `error` (supabase-js non lancia eccezioni: restituisce { error }), quindi anche un fallimento parziale passa inosservato. Nota anche riga 2102: `(Number(it.payable.gross_amount) ?? 0)` — `??` non protegge da NaN (Number(undefined) è NaN, non null), quindi amount_remaining può diventare NaN. Il flusso 'disposizione' (riga 743-762) segue invece la logica corretta: la fattura resta aperta finché non riconciliata.

**Proposta:** Spostare l'update dello stato payable DOPO la risposta positiva della Edge Function, oppure usare uno stato intermedio ('in_distinta'/'disposto') fino alla riconciliazione del movimento bancario, come già fa il flusso disposizione. Controllare `error` su ogni update/insert dello step 3, accumulando i fallimenti in `errors[]` e non chiudendo la selezione se qualcosa è fallito. Sostituire `Number(x) ?? 0` con `Number(x) || 0`.

### C12. Privilege escalation: controllo ruolo con fallback su user_metadata (modificabile dal client) in 10 edge function A-Cube

**Dove:** `supabase/functions/acube-payment-send/index.ts:52` · **Categoria:** Sicurezza

Tutte le edge function A-Cube leggono il ruolo con `app_metadata?.role ?? user_metadata?.role` (acube-payment-send:52, acube-login:70, acube-sdi-send-invoice:83, acube-ob-tx-sync:103, e altre 6). user_metadata è scrivibile DAL CLIENT da qualunque utente autenticato via `supabase.auth.updateUser({ data: { role: 'super_advisor' } })`: un utente il cui app_metadata.role non è valorizzato (es. account nuovi o viewer creati senza ruolo) può auto-assegnarsi super_advisor/cfo e invocare l'invio di pagamenti SEPA reali, l'invio fatture a SDI e i sync Open Banking. Il frontend (src/hooks/useRole.tsx:25-26) usa correttamente SOLO app_metadata: il fallback lato server è un'incoerenza pericolosa.

**Proposta:** Rimuovere il fallback `?? userData.user.user_metadata?.role` da tutte le 10 edge function e fidarsi esclusivamente di app_metadata (server-controlled), come già fa useRole.tsx e come indica il commento stesso del hook. Ridployare le function su NZ + Made + Zago.

### C13. acube-payment-send: nessuna idempotenza né lock — doppia invocazione = doppio pagamento SEPA

**Dove:** `supabase/functions/acube-payment-send/index.ts:92` · **Categoria:** Logica

La selezione degli item da pagare è check-then-act non atomica: SELECT con .in("status", ["pending","draft"]).is("acube_payment_uuid", null) (righe 92-97), poi per ogni item POST /payments/send/sepa (riga 133) e solo DOPO l'update a status='processing' (riga 154-160). Due invocazioni concorrenti (doppio click su "Invia distinta", retry di rete, o utente+cron) leggono entrambe gli stessi item e inviano DUE pagamenti reali per ciascuna fattura. Inoltre batch.status viene letto (riga 68) ma mai validato: una distinta già 'processing' o 'completed' può essere rilanciata. Nessun timeout sulle fetch verso A-Cube.

**Proposta:** Fare il claim atomico prima dell'invio: UPDATE payment_batch_items SET status='processing' WHERE batch_id=... AND status IN ('pending','draft') AND acube_payment_uuid IS NULL RETURNING * (via RPC), e inviare solo le righe effettivamente claimate. Validare batch.status ('draft'/'ready') prima di procedere e marcare subito il batch 'processing'. Aggiungere AbortSignal.timeout alle fetch.

### C14. Webhook SDI pubblici senza alcuna autenticazione: chiunque può iniettare fatture o alterarne lo stato

**Dove:** `supabase/functions/sdi-receive/index.ts:186` · **Categoria:** Sicurezza · *segnalato indipendentemente da 4 auditor*

La funzione è deployata con verify_jwt=false (supabase/config.toml) e il handler non verifica NESSUNA credenziale: niente shared secret, firma, mTLS o allowlist IP. Chiunque conosca l'URL pubblico https://<project>.supabase.co/functions/v1/sdi-receive può fare POST di un XML arbitrario che viene parsato e UPSERTATO in electronic_invoices usando la SERVICE_ROLE_KEY (riga 221-222, bypass RLS). Peggio: l'sdi_id usato come chiave di upsert è derivabile dall'attaccante (filename nel Content-Disposition, tag IdentificativoSdI, o fallback P.IVA+numero+data, righe 161-182), quindi è possibile anche SOVRASCRIVERE fatture esistenti (ramo update righe 269-277) alterando importi, fornitore e scadenze su un sistema finanziario live — un vettore diretto di frode sui pagamenti via Scadenzario. Stesso pattern in sdi-notifications/index.ts (verify_jwt=false + service role, riga 136).

**Proposta:** Aggiungere un'autenticazione al webhook: un token segreto (Vault) verificato in un header/query param dalla funzione, o la verifica del certificato/firma del canale SDI; in alternativa rifiutare le richieste che non provengono dagli IP AdE. Loggare e rispondere 401 alle richieste non autenticate. Applicare la stessa protezione a sdi-notifications e replicare il deploy sui 3 tenant (NZ, Made, Zago).


## 🟠 ALTA — 56 finding

### A1. 5 route orfane: pagine raggiungibili solo digitando l'URL ma documentate nella guida utente

**Dove:** `src/App.tsx:119` · **Categoria:** UX

Le route `/stock` (App.tsx:119), `/analytics-pos` (120), `/open-to-buy` (122), `/margini-categoria` (126) e `/store-manager` (127) sono registrate e lazy-loaded, ma una grep su tutto src/ mostra che NESSUN componente le linka: non sono nella sidebar (Sidebar.tsx buildSections), non nel breadcrumb map, non in BottomNav, non in GlobalSearch né in alcun navigate(). Sono però tutte documentate in src/data/pageGuides.ts (righe 328, 959, 1010, 1136, 1305): la guida — e l'assistente AI help-chat che la usa come contesto — descrive all'utente pagine che non può raggiungere da nessun menu, violando la regola 'guide sempre allineate'.

**Proposta:** Decidere il destino di ogni pagina: se sono funzioni attive, aggiungerle alla sidebar (es. sezione 'AI & Analytics' per Analytics POS/Stock/OTB) e al breadcrumb map; se sono work-in-progress, rimuovere le route e le relative voci da pageGuides.ts finché non sono pronte, così la guida e l'AI non promettono funzioni irraggiungibili.

### A2. URL Supabase del tenant NZ hardcoded come fallback nelle chiamate Edge Function

**Dove:** `src/components/AICategorization.tsx:64` · **Categoria:** Sicurezza · *segnalato indipendentemente da 4 auditor*

Tre punti bypassano la risoluzione tenant centralizzata di src/lib/tenants.ts: (1) AICategorization.tsx riga 64 usa import.meta.env.VITE_SUPABASE_URL || 'https://xfvfxsvqpnpvibgeqpqp.supabase.co' — fallback al progetto NZ in un bundle di produzione, in contraddizione con il commento di tenants.ts (righe 43-51) che garantisce che i riferimenti NZ siano solo dev; su un site Made/Zago configurato con le sole variabili suffissate (_MADE/_ZAGO, come previsto da readEnv riga 34-40) le chiamate edge andrebbero al progetto NZ. (2) Ticket.tsx riga 1114 usa VITE_SUPABASE_URL direttamente: se assente, la fetch va a 'undefined/functions/v1/...'. (3) acube-payment-send/index.ts riga 130 hardcoda returnUrl='https://gestionale-nz.netlify.app/...': l'utente Made/Zago dopo l'autorizzazione bancaria PSD2 viene rimandato al sito del tenant NZ.

**Proposta:** Nel frontend usare sempre getCurrentTenant().supabaseUrl (o supabase.functions.invoke) al posto di VITE_SUPABASE_URL, eliminando il fallback hardcoded. Nella edge function derivare il returnUrl dall'header Origin della request (validandolo contro i 3 domini noti) o da un campo di configurazione, e rideployare su NZ + Made + Zago.

### A3. XSS nelle finestre di stampa: HTML costruito con dati XML/DB non escapati

**Dove:** `src/components/InvoiceViewer.tsx:394` · **Categoria:** Sicurezza

handlePrint (righe 355-474) costruisce l'HTML di stampa con template literal e lo scrive via printWindow.document.write interpolando SENZA escaping valori provenienti dall'XML del fornitore: l.descrizione, fornitore.denominazione, documento.numero, documento.causale, p.iban ecc. (es. riga 367 `<td>${l.descrizione || ''}</td>`). Una fattura passiva ricevuta via SDI/A-Cube con una descrizione contenente markup (es. `<img src=x onerror=...>`) esegue script nella finestra aperta con window.open('', '_blank'), che è same-origin con l'app (about:blank eredita l'origin) e ha accesso a window.opener. Stesso pattern in SchedaContabileFornitore.handlePrintScheda (righe 622-729) con supplier name, invoice_number e descrizioni. Nota: ConvertitoreFattureXML ha una funzione xmlEsc, il viewer no.

**Proposta:** Escapare ogni valore interpolato nell'HTML di stampa con una funzione htmlEsc (come la xmlEsc già presente nel convertitore), oppure costruire il documento di stampa via DOM API (createElement/textContent) o stampare il contenuto React già renderizzato (window.print su area dedicata con CSS @media print) invece di document.write con stringhe.

### A4. Salvataggio regola di allocazione non transazionale: rischio regola persa o senza dettagli

**Dove:** `src/components/SupplierAllocationEditor.tsx:229` · **Categoria:** Integrità dati

handleSave (righe 223-311) esegue 3 scritture separate dal client: (1) UPDATE che disattiva la regola esistente, (2) INSERT della nuova regola, (3) INSERT dei dettagli. Non c'è transazione: se l'insert della regola fallisce dopo il passo 1 (rete, RLS, vincolo), il fornitore resta SENZA alcuna regola attiva (la vecchia è già disattivata); se fallisce l'insert dei dettagli dopo il passo 2, resta una regola attiva senza righe di dettaglio, che a valle alloca zero. Su un gestionale in produzione con ripartizione costi tra outlet questo corrompe silenziosamente le allocazioni.

**Proposta:** Spostare l'operazione in una RPC Postgres (funzione SQL con le tre scritture in un'unica transazione, SECURITY DEFINER con guardia company_id) chiamata dal client, oppure invertire l'ordine (inserire nuova regola+dettagli, e solo a successo disattivare la vecchia) con cleanup in caso di errore parziale.

### A5. Il backdrop dei toast blocca tutti i click dell'app per 10 secondi

**Dove:** `src/components/Toast.tsx:96` · **Categoria:** Usability

ToastContainer (Toast.tsx:94-100) renderizza un backdrop `fixed inset-0 z-[99] cursor-pointer` finché c'è almeno un toast visibile, con durata default di 10 secondi (Toast.tsx:40 `duration = 10000`). Risultato: dopo OGNI operazione che mostra un toast (salvataggi, conferme — usati in ScadenzarioSmart, TesoreriaManuale, Fatturazione, Ticket...), il primo click dell'utente ovunque nella pagina viene intercettato dal backdrop e serve solo a chiudere il toast: pulsanti, link e input non rispondono e l'utente deve cliccare due volte. Su flussi ripetitivi (registrare pagamenti in serie nello Scadenzario) è una frizione costante. Nota collaterale: l'id del toast è `Date.now()` (Toast.tsx:41), quindi due toast nello stesso millisecondo collidono (key React duplicata, dismiss che rimuove entrambi).

**Proposta:** Rimuovere il backdrop full-screen: i toast top-center con pointer-events-auto e la X sono sufficienti; se si vuole il 'click fuori chiude', usare un listener document-level su mousedown che non blocchi l'evento (non un div che lo consuma). Ridurre la durata default a 4-5s per i success. Per gli id usare un contatore incrementale (`useRef`) invece di Date.now().

### A6. Tre modelli di ruolo incoerenti tra pagine (JWT vs user_profiles.role, insiemi di ruoli diversi)

**Dove:** `src/hooks/useRole.tsx:25` · **Categoria:** Logica

Coesistono tre fonti/insiemi di ruoli: (1) useRole legge session.user.app_metadata.role dal JWT (usato da Onboarding, con ALLOWED_ROLES=['super_advisor','budget_approver'], Onboarding.tsx:128); (2) Impostazioni e Outlet leggono profile.role dalla tabella user_profiles; (3) Impostazioni definisce ROLE_PERMISSIONS/ROLE_OPTIONS con ruoli (ceo, cfo, coo, contabile, operatrice) che non includono 'budget_approver', mentre la sezione Utenti gestisce una tabella app_users separata da user_profiles. Se JWT e user_profiles divergono (es. ruolo cambiato in DB ma non in app_metadata), lo stesso utente supera il gate di una pagina e viene bloccato in un'altra. Un ruolo assegnato da Impostazioni→Utenti (app_users.ruolo) non ha alcun effetto sui permessi reali.

**Proposta:** Unificare la fonte di verità dei ruoli (idealmente il JWT via useRole, come fa il backend has_jwt_role) e derivare tutti i gate UI da un unico modulo di permessi condiviso (es. src/lib/permissions.ts con la mappa ruolo→capacità). Chiarire o eliminare la duplicazione app_users vs user_profiles.

### A7. applyReconciliation/undoReconciliation corrompono i pagamenti parziali (amount_paid forzato a totale o azzerato)

**Dove:** `src/lib/reconciliationEngine.ts:113` · **Categoria:** Integrità dati · *segnalato indipendentemente da 3 auditor*

applyReconciliation legge bt.amount ma non lo usa mai: alle righe 113-118 imposta incondizionatamente amount_paid = gross_amount e amount_remaining = 0. Un movimento bancario da 100 EUR abbinato manualmente a una fattura da 500 EUR la chiude come interamente pagata, azzerando il residuo reale (perdita di informazione contabile). Inoltre la funzione non lancia mai eccezioni (ritorna {success:false}), ma Banche.tsx righe 1433 e 1547 fanno solo `await applyReconciliation(...)` dentro try/catch senza leggere il risultato: se l'update fallisce la UI sposta comunque il movimento tra i riconciliati e aggiorna le statistiche. Infine questo percorso client-side bypassa la RPC reconcile_movement (migration 090) usata da TesoreriaManuale/ScadenzarioSmart, che gestisce note di credito pending e passa da amount_paid come richiesto dal trigger update_payable_status: due motori divergenti sulla stessa operazione.

**Proposta:** Unificare Banche.tsx e ImportHub.tsx sulla RPC server-side reconcile_movement; in ogni caso calcolare amount_paid incrementale = min(|bt.amount|, residuo) e stato 'parziale' se resta un residuo. In Banche.tsx controllare res.success e in caso di errore mostrare toast senza mutare lo stato locale.

### A8. Form A-Cube: numero fattura casuale, nessuna validazione fiscale, toggle production senza conferma

**Dove:** `src/pages/AcubeFatturaForm.tsx:23` · **Categoria:** Logica · *segnalato indipendentemente da 2 auditor*

Tre problemi su un form che può emettere fatture REALI a SDI: (1) il numero fattura è generato con `Math.floor(Math.random() * 1000)` (righe 23 e 76) — nessuna progressione, alto rischio collisione (con ~37 fatture la probabilità di duplicato supera il 50%, paradosso del compleanno) e la numerazione progressiva è un requisito fiscale; (2) il campo 'P.IVA / Codice Fiscale' (riga 118) ha solo `required`, senza controllo lunghezza/checksum: una P.IVA errata parte verso SDI e viene scartata dopo; (3) il toggle sandbox/production (righe 98-104) cambia ambiente con un solo click e il submit non chiede conferma in production, dove come avvisa lo stesso banner 'Non si può annullare, solo emettere nota di credito'. Quantità e prezzo accettano anche valori negativi o zero (righe 189-197).

**Proposta:** Derivare il numero proposto dall'ultimo progressivo reale (query su active_invoices dell'anno) invece che da Math.random; validare fiscal_id (11 cifre P.IVA con checksum o 16 caratteri CF) prima del submit; richiedere una conferma esplicita (dialog con riepilogo importo e cliente) quando stage === 'production'; vincolare quantity > 0 e min sugli input numerici.

### A9. Tab Conservazione: la query fatture seleziona colonne inesistenti e fallisce in silenzio — le fatture non compaiono mai

**Dove:** `src/pages/ArchivioDocumenti.tsx:116` · **Categoria:** Logica

In `loadRetention` il select su `electronic_invoices` include `direction` e `total_amount`, che il commento stesso nel codice (righe 109-112) dichiara essere colonne inesistenti (BUG-001 e BUG-002 documentati). La query Supabase restituisce errore, `data` è null e il catch fa solo `console.warn`: il risultato è che la tab Conservazione Sostitutiva mostra sempre 0 fatture (solo i `documents`), senza alcun messaggio d'errore all'utente. Inoltre tutta la UI a valle (righe 1318-1333) usa `doc.direction` e `doc.total_amount` per etichette e importi che non potranno mai esistere.

**Proposta:** Correggere il select usando le colonne reali dello schema (es. `gross_amount` al posto di `total_amount`, e determinare attiva/passiva da un campo esistente o rimuovere la distinzione). Sostituire il `console.warn` con un toast/stato di errore visibile, così un futuro errore di query non torna a nascondere silenziosamente i documenti fiscali in conservazione.

### A10. Rifiuto abbinamento in Banche scrive su tabella droppata e colonna inesistente: non viene mai salvato

**Dove:** `src/pages/Banche.tsx:1477` · **Categoria:** Logica

handleReject fa .from('reconciliation_log').delete().eq('cash_movement_id', movementId) (riga 1477) ma reconciliation_log è stata ricreata in migration 20260515_032 con la colonna bank_transaction_id — cash_movement_id non esiste più. Subito dopo (riga 1484) fa upsert su reconciliation_rejected_pairs, tabella DROPPATA in migration 20260515_031 e mai ricreata (sopravvive solo nei tipi generati stale). Entrambe le chiamate restituiscono un errore che il codice ignora (nessun controllo su error, supabase-js non lancia). Risultato: l'operatore vede il messaggio 'questa coppia non verrà più proposta in futuro', la UI rimuove il suggerimento, ma al reload il match rifiutato riappare identico — frustrazione ciclica e rischio che venga confermato per sfinimento.

**Proposta:** Correggere il filtro in bank_transaction_id; sostituire l'upsert sulla tabella inesistente marcando la riga di reconciliation_log come status='rejected' (già previsto dal CHECK della 032) e facendo sì che try_match_bank_transaction/rerun_reconciliation escludano le coppie rejected. Controllare sempre error delle chiamate supabase e mostrare un toast in caso di fallimento. Rigenerare i tipi DB per eliminare le tabelle fantasma.

### A11. Salvataggio celle budget con DELETE+INSERT non atomico su budget_confronto: rischio perdita dei dati granitici

**Dove:** `src/pages/BudgetControl.tsx:3181` · **Categoria:** Integrità dati

saveCell (Inserimento Rapido Corrispettivi) prima esegue DELETE della riga esistente su budget_confronto e poi INSERT del nuovo valore (righe 3181-3193). Le due operazioni non sono transazionali: se l'INSERT fallisce (rete, RLS, vincolo) dopo che la DELETE è riuscita, il consuntivo 'granitico' precedente è perso definitivamente dal DB. Inoltre l'errore della DELETE non viene mai controllato. Lo stesso pattern delete-then-insert è ripetuto alle righe 1168 e 1852. Su una tabella viva di produzione questo contraddice la regola granitica NO DATA LOSS.

**Proposta:** Aggiungere un vincolo UNIQUE (company_id, cost_center, account_code, year, month, entry_type) su budget_confronto e usare upsert con onConflict; per il caso 'valore 0 = rimuovi' usare una singola RPC transazionale. Controllare sempre l'error della DELETE e mostrare lo stato 'error' già previsto dall'input.

### A12. Cashflow: fatture con status 'parziale' escluse da tutte le proiezioni

**Dove:** `src/pages/CashflowProspettico.tsx:420` · **Categoria:** Logica

La query dello scadenzario usata per le uscite previste filtra `.in('status', ['da_pagare', 'in_scadenza', 'scaduto'])` e omette 'parziale' (status esistente nell'enum payable_status, vedi la view v_payables_operative e statusBadge in TesoreriaManuale). Una fattura pagata in acconto ha residuo `gross_amount - amount_paid > 0` ma sparisce completamente dalle uscite previste della vista mensile (blocco 3.2b, riga 617), giornaliera e settimanale (rawPayables) e dal drill-down: il fabbisogno di cassa risulta sottostimato proprio per le fatture grosse pagate a rate/acconti.

**Proposta:** Aggiungere 'parziale' alla lista degli status aperti: `.in('status', ['da_pagare', 'in_scadenza', 'scaduto', 'parziale'])`. Il calcolo del residuo (`gross_amount - amount_paid`) già gestisce correttamente l'acconto.

### A13. Cashflow: blocco uscite SDI legge colonne inesistenti su v_payables_operative e non filtra per anno

**Dove:** `src/pages/CashflowProspettico.tsx:609` · **Categoria:** Logica

Il blocco 3.2 (righe 603-614) calcola `outstandingAmount = (Number(p.amount_total) || 0) - (Number(p.amount_paid) || 0)` su righe di v_payables_operative, ma la view (migration 20260417_000_baseline_schema.sql riga 4244) NON ha la colonna `amount_total` (ha gross_amount/amount_remaining): il primo termine è sempre 0, quindi per ogni fattura con acconto (amount_paid>0, es. status 'parziale' non escluso dal filtro) viene SOMMATO UN IMPORTO NEGATIVO a `uscite_sdi`, riducendo le uscite del mese. Inoltre `parseMonth(p.due_date)` non verifica l'anno: fatture aperte di anni diversi finiscono nei mesi dell'anno selezionato. Anche `p.cost_center_code` (riga 608) non esiste nella view, quindi col filtro outlet il blocco è sempre vuoto. Infine le stesse fatture sono già conteggiate dal blocco 3.2b dalla tabella payables: il blocco è ridondante e dannoso.

**Proposta:** Rimuovere il blocco 3.2 (uscite_sdi) lasciando il solo 3.2b su payables (con anno e residuo corretti), oppure correggerlo usando `amount_remaining`/`gross_amount`, aggiungendo il check `getFullYear() === year` e una colonna outlet reale.

### A14. Cashflow: viste giornaliera/settimanale ignorano stipendi, scadenze fiscali e arretrati inclusi nella vista mensile

**Dove:** `src/pages/CashflowProspettico.tsx:940` · **Categoria:** Logica

La vista mensile somma nelle uscite anche `uscite_fiscali` (fiscal_deadlines) e `uscite_stima` (stipendi netti + compensi amministratori, riga 738). Le viste giornaliera (riga 940: `payablesTotal + totalDailyRent + dailyRecurring + dailyLoan`) e settimanale (riga 1120) NON includono né le stime del personale né le scadenze fiscali; inoltre le fatture scadute non pagate (due_date nel passato) non rientrano mai nell'orizzonte 30gg/13 settimane perché indicizzate solo per data scadenza originale. Risultato: cambiando vista da 'Mensile' a 'Giornaliero/Settimanale' il saldo progressivo migliora artificialmente di decine di migliaia di euro al mese (stipendi + F24), dando un falso senso di liquidità proprio nelle viste operative a breve termine.

**Proposta:** Nelle viste daily/weekly aggiungere il pro-rata (o l'evento puntuale al giorno configurato, es. day 27) delle voci `estimateVoices` e delle fiscal_deadlines non pagate, e includere i residui scaduti (due_date < oggi) nel primo giorno/settimana dell'orizzonte.

### A15. Troncamento silenzioso a 1000 righe: .range(0,9999)/.limit(5000+) non superano il cap PostgREST

**Dove:** `src/pages/ConfrontoOutlet.tsx:622` · **Categoria:** Integrità dati

ScadenzarioSmart.tsx (righe 630-646) documenta esplicitamente che «PostgREST limita ogni richiesta a 1000 righe» — cap già incontrato in produzione («il semplice .select('*') troncava i dati e i totali mensili risultavano incompleti») — e supabase/config.toml non contiene alcun override di max_rows. Nonostante ciò, molte pagine credono di aggirare il limite con .range(0,9999) o .limit(N>1000): ConfrontoOutlet.tsx 622 e 683 (budget_entries e budget_confronto), BudgetControl.tsx 740-741, ContoEconomico.tsx 971/1103/1161, Dashboard.tsx 247/364/392, Outlet.tsx 2025 (il commento dice «~1212 righe/anno», GIÀ oltre il cap), PrimaNota.tsx 104 (limit 5000), Fatturazione.tsx 278 (limit 10000) e 1003/1005 (limit 5000, con commento che stima 2555 righe/anno di daily_revenue), TesoreriaManuale.tsx 3684. Se il cap è quello documentato, questi fetch tornano al massimo 1000 righe SENZA errore: KPI, totali del Conto Economico, Prima Nota per la commercialista e confronti outlet risultano silenziosamente sbagliati appena i dati superano la soglia.

**Proposta:** Verificare il valore reale di Max Rows sui 3 progetti Supabase (deve essere identico sui 3 tenant) e standardizzare: riusare ovunque il pattern fetchAllPaged di ScadenzarioSmart (paginazione a blocchi da 1000 con ORDER BY univoco su id) oppure spostare le aggregazioni lato server (viste/RPC che restituiscono già i totali). Aggiungere un guard che logga/avvisa quando un fetch ritorna esattamente il numero di righe del cap.

### A16. ConfrontoOutlet: overlay consuntivo costi calcolato ma mai applicato (variabile 'overlay' inutilizzata)

**Dove:** `src/pages/ConfrontoOutlet.tsx:876` · **Categoria:** Logica

In calcMetrics viene definito `const overlay = field === 'actual_amount' ? hasConsForCodes : hasPrevForCodes` ma la variabile non è mai usata: i costi vengono sempre e solo da aggregateCostsByMacro(outletBudget, field) su budget_entries. I lunghi commenti (righe 834-851: "il calcMetrics somma normalmente budget_entries; poi se l'overlay ha valori... SOSTITUISCE il totale aggregato") descrivono un comportamento che non esiste nel codice. Conseguenze: (1) quando Lilian inserirà i costi consuntivo in budget_confronto (cons_monthly/prev_monthly), la vista Consuntivo continuerà a mostrare i costi da budget_entries.actual_amount ignorandoli; (2) un outlet con SOLI dati overlay (caso "Torino", righe 858-863) supera il guard ma mostra costi a 0 e margine = ricavi. Inoltre consOverlay/prevOverlay sono aggregati senza mese (righe 694-700), quindi anche applicandoli il filtro periodo (selectedMonths) non funzionerebbe.

**Proposta:** Applicare davvero l'override: dopo calcMetrics, per ogni macro_group/codice presente nell'overlay sostituire il totale aggregato (una volta sola, come da commento). Conservare il mese nelle strutture overlay (Record<cc, Record<code, number[12]>>) per rispettare selectedMonths. Aggiungere un test sul caso "outlet solo overlay".

### A17. Contratti: se l'upload storage fallisce, il metadato viene inserito con file_path null senza avvisare — documenti fantasma

**Dove:** `src/pages/Contratti.tsx:349` · **Categoria:** Integrità dati

In `PdfUploader.handleFiles` (righe 344-354, stesso pattern in `uploadAttachments` righe 107-117) l'errore di storage viene assorbito: `file_path: storageErr ? null : filePath` inserisce comunque la riga in `contract_documents` con path nullo. L'utente vede il file in lista (con nome e dimensione) ma senza bottone Anteprima e senza possibilità di recuperarlo — il PDF non esiste da nessuna parte. Nessun messaggio d'errore viene mostrato (il catch esterno fa solo `console.error`, riga 358). Inoltre l'errore dell'insert su `contract_documents` non viene mai controllato: se fallisce (es. RLS), l'upload su storage resta orfano.

**Proposta:** Se `storageErr` è valorizzato: non inserire il record, mostrare un toast/alert con il messaggio d'errore e interrompere o proseguire con gli altri file segnalando il fallimento. Controllare anche l'errore dell'insert su contract_documents e, in caso di fallimento, rimuovere il file appena caricato dal bucket per evitare orfani.

### A18. ProgressivoInvio memorizzato solo in localStorage: duplicati con più operatori o browser

**Dove:** `src/pages/ConvertitoreFattureXML.tsx:277` · **Categoria:** Integrità dati · *segnalato indipendentemente da 3 auditor*

Il progressivo di invio (che finisce in <ProgressivoInvio> e nel nome file IT<PIVA>_<prog>.xml) è seedato ESCLUSIVAMENTE da localStorage (chiave 'nz_fe_last_prog', righe 279-283) e risalvato lì dopo ogni generazione (riga 437). Esiste già un archivio server-side (tabella fattura_xml_export con colonna progressivo, caricata a riga 289-294) ma NON viene usato per calcolare il prossimo progressivo. Se l'operatrice cambia PC/browser, pulisce la cache, o due persone usano la pagina, il contatore riparte da DEFAULT_START (21) o da un valore stantio: si generano file con lo stesso ProgressivoInvio/nome file già usati, che l'AdE rifiuta come duplicati o che sovrascrivono file precedenti negli archivi.

**Proposta:** Calcolare il numero di partenza come MAX(progressivo)+1 dalla tabella fattura_xml_export (già interrogata al mount) e usare localStorage solo come fallback offline, mostrando un avviso se i due valori divergono. In generazione, verificare che i progressivi del batch non esistano già in archivio prima di scrivere.

### A19. Fetch multi-step senza cancellazione: risposte fuori ordine al cambio anno/azienda

**Dove:** `src/pages/Dashboard.tsx:173` · **Categoria:** Logica

Il useEffect di Dashboard (righe 173-570, deps [COMPANY_ID, year, quarter]) esegue oltre 10 await sequenziali e fa setState dopo ognuno, senza flag `cancelled` né AbortController. Cambiando anno rapidamente (o azienda via switchCompany) partono due catene fetchData concorrenti che si intrecciano: gli setState della catena vecchia possono sovrascrivere quelli della nuova (es. ricavi dell'anno A con ranking outlet dell'anno B). Stesso pattern in ContoEconomico.tsx:676-685 (7 loader paralleli senza cleanup, deps [year, quarter, periodType, COMPANY_ID]) e BudgetControl.tsx:725. Il pattern corretto esiste già nel repo — useOutlets.ts:49-83 e TesoreriaManuale.tsx:3677-3707 usano `let cancelled = false` + cleanup — ma non è applicato proprio alle pagine con le catene di fetch più lunghe.

**Proposta:** Applicare il pattern già presente in useOutlets/TesoreriaManuale a Dashboard, ContoEconomico e BudgetControl: `let cancelled = false` nel useEffect, `if (cancelled) return` prima di ogni setState, `return () => { cancelled = true }`. In alternativa accumulare i risultati in un oggetto locale e fare un solo setState finale guardato dal flag.

### A20. Dashboard: ranking outlet dell'anno precedente resta visibile per anni senza dati

**Dove:** `src/pages/Dashboard.tsx:430` · **Categoria:** Logica

Il commento a riga 181-183 documenta il bug 'stessi ricavi su più anni' e il reset esplicito al cambio anno (righe 184-192) — ma il reset copre solo ricavi/utile/costi. `outletsData` non viene mai resettato, e a riga 430 il set è condizionale: `if (rows.some(r => r.ricavi !== 0 || r.budget_anno !== 0)) setOutletsData(...)`. Quindi selezionando un anno per cui budget_confronto/budget_entries non hanno righe, la tabella 'Performance outlet' continua a mostrare i numeri dell'anno prima, con il subtitle del periodo nuovo. È esattamente la stessa classe di bug già fixata per i ricavi, sfuggita al ranking.

**Proposta:** Aggiungere `setOutletsData([])` al blocco di reset (righe 184-192) e rendere il set incondizionato: se tutte le righe sono a zero, mostrare l'empty state già previsto a riga 846 invece dei dati stantii.

### A21. Errori Supabase sistematicamente ingoiati: KPI a 0 indistinguibili da dati reali

**Dove:** `src/pages/Dashboard.tsx:447` · **Categoria:** Logica

supabase-js non lancia eccezioni: restituisce { data, error }. In Dashboard.tsx tutti i blocchi try/catch con catch vuoto (righe 302, 315, 453, 462, 504, 521, 534, 559) sono di fatto codice morto, e le destrutturazioni `const { data: cashData } = await supabase...` ignorano completamente `error`. Esempio concreto: se la query su v_cash_position (righe 441-447) fallisce (RLS, rete, vista mancante su un tenant), `cashData` è null e la card Liquidità mostra '0,00 €' come se fosse un saldo reale, senza alcun avviso. Stesso pattern per debiti finanziari, scadenze, movimenti non categorizzati. In un cruscotto direzionale di produzione un KPI a 0 per errore silenzioso può innescare decisioni sbagliate (es. l'alert 'PFN negativa' a riga 628 scatta se liquidita=0 e debtiFin>0).

**Proposta:** Controllare `error` su ogni query e distinguere lo stato 'dato non disponibile' (mostrare '—' + banner/toast di errore con retry) dallo zero reale. Estrarre un helper condiviso (es. `fetchOrNull(query, label)`) che logga e propaga l'errore a uno state `fetchErrors` mostrato in pagina, eliminando i catch vuoti.

### A22. Il filtro periodo globale (trimestre/mese) è ignorato da Dashboard e BudgetControl ma l'etichetta dice il contrario

**Dove:** `src/pages/Dashboard.tsx:681` · **Categoria:** Logica · *segnalato indipendentemente da 3 auditor*

Il PageHeader della Dashboard mostra `Cruscotto direzionale — ${periodRange.label}` (es. "Q2 2026" quando si seleziona un trimestre), ma tutte le query dei KPI Ricavi/Margine/Utile filtrano solo per year (v_executive_dashboard riga 201, balance_sheet_data riga 218, budget_confronto riga 245): con Q2 selezionato si vedono i ricavi ANNUALI sotto un'etichetta "Q2". Solo il fallback fatture usa range.from/to. BudgetControl fa lo stesso: `useEffect(..., [CID, year, quarter])` (riga 725) rifà il fetch al cambio quarter ma nessuna query lo usa. ConfrontoOutlet invece rispetta il periodo (selectedMonths) e ContoEconomico lo usa solo nella vista Cassa: lo stesso selettore produce numeri non confrontabili tra pagine. Aggravante: usePeriod.tsx scrive il quarter in localStorage ('nz_period_quarter', riga 59) ma non lo rilegge mai, quindi al refresh il quarter torna a 'year' mentre l'anno persiste.

**Proposta:** Decidere e uniformare: o la Dashboard filtra davvero per il range selezionato (budget_confronto ha month: filtrare i mesi del quarter), oppure l'etichetta deve dire esplicitamente "Anno {year}" quando i dati sono annuali. In BudgetControl rimuovere quarter dalle dipendenze (refetch inutile) o applicarlo. In usePeriod ripristinare la lettura di nz_period_quarter come per l'anno.

### A23. «Associa XML»: senza P.IVA nel file l'XML può agganciarsi alla fattura di un altro fornitore

**Dove:** `src/pages/Fatturazione.tsx:337` · **Categoria:** Integrità dati · *segnalato indipendentemente da 2 auditor*

handleBulkXmlUpdate aggiorna electronic_invoices.xml_content con match su invoice_number, e aggiunge il filtro supplier_vat SOLO se la P.IVA è stata estratta dall'XML (riga 343: «if (piva) query = ...»). L'estrazione usa querySelector con tag non namespace-aware (righe 333-335), mentre gli XML FatturaPA reali usano spesso prefissi di namespace (il parser di sdi-receive/index.ts li gestisce esplicitamente con regex, righe 29-33, proprio per questo). Se la P.IVA non viene trovata, l'UPDATE colpisce QUALSIASI fattura con lo stesso numero e xml_content null — e i numeri fattura tipo «1» o «2026/1» collidono facilmente tra fornitori diversi. L'update inoltre non è limitato a una riga (matched += data.length conta più righe aggiornate con lo stesso file). Viola la regola di progetto «aggancio fornitore↔fattura per P.IVA, non per nome» (PAYMENT_PLAN_NOTES).

**Proposta:** Rendere la P.IVA obbligatoria per il match: se non estraibile dall'XML, saltare il file e conteggiarlo tra gli errori con messaggio esplicito. Rendere l'estrazione namespace-aware (getElementsByTagNameNS o la stessa regex di sdi-receive) e aggiungere .limit/controllo che il match sia esattamente 1 riga prima dell'update.

### A24. Nessuna validazione P.IVA/CF/SDI nel form fornitore: si rompe l'aggancio fatture per P.IVA

**Dove:** `src/pages/Fornitori.tsx:607` · **Categoria:** Integrità dati

handleSave (righe 607-672) valida solo la ragione sociale e la banca: partita_iva, codice_fiscale, codice_sdi, IBAN, CAP e PEC sono testo libero senza controllo di formato (P.IVA 11 cifre + checksum, CF 16 caratteri, SDI 7, IBAN IT 27). La P.IVA è LA chiave d'aggancio fornitore↔fatture elettroniche (il pannello Gestione carica le fatture con `.eq('supplier_vat', gestioneVat)`, righe 314-321, e PAYMENT_PLAN_NOTES impone l'aggancio per P.IVA): una P.IVA con un typo o uno spazio fa sparire silenziosamente tutte le fatture del fornitore ('Nessuna fattura elettronica per questo fornitore'). Manca anche il controllo duplicati: si possono creare due fornitori con la stessa P.IVA senza alcun avviso.

**Proposta:** Aggiungere in handleSave validazione formato + checksum della P.IVA (algoritmo Luhn-like ufficiale), regex per CF/SDI/CAP/IBAN, normalizzazione (trim + rimozione spazi + uppercase) e, prima dell'insert, una query di controllo duplicato su partita_iva nel tenant con richiesta di conferma binaria all'utente.

### A25. Nessuna modale dell'app è accessibile: zero role=dialog/aria-modal, niente Escape né focus trap

**Dove:** `src/pages/Fornitori.tsx:1425` · **Categoria:** Accessibilità

Nel codebase ci sono ~45 overlay modali (grep 'fixed inset-0' su 29 file: Fornitori, Scadenzario, Banche, Dipendenti, TesoreriaManuale, InvoiceViewer, OutletWizard, ecc.) e ZERO occorrenze di role="dialog" o aria-modal in tutto src/. Esempio tipico Fornitori.tsx:1425-1431: div con onClick per chiudere, nessuna gestione del tasto Escape, nessun focus trap (il tab scorre la pagina sottostante), focus non spostato all'apertura né ripristinato alla chiusura; il bottone di chiusura è icona-only (<X size={20}/>) senza aria-label né title. Per un utente da tastiera o screen reader le modali (incluse quelle di conferma eliminazione, es. Scadenzario.tsx:1516) sono di fatto inutilizzabili. In tutta l'app ci sono solo 16 aria-label.

**Proposta:** Creare un componente Modal condiviso in components/ui/ con role="dialog", aria-modal="true", aria-labelledby sul titolo, chiusura con Escape, focus trap e restituzione del focus all'elemento che l'ha aperta; aria-label="Chiudi" sul bottone X. Migrare progressivamente le pagine, partendo dalle modali di conferma azioni distruttive.

### A26. Pagina Importazioni: elaborazione simulata — il batch viene marcato 'completed' ma nessun dato viene importato né il file salvato

**Dove:** `src/pages/Importazioni.tsx:307` · **Categoria:** Logica

In `handleUpload` il commento alla riga 307 dice esplicitamente "Simula elaborazione (in produzione qui ci sara il parser vero)": il batch viene creato e subito aggiornato a `status: 'completed', processed_rows: totalRows` (righe 308-316) senza parsare nulla, senza salvare il file su storage e senza inserire alcun movimento/fattura. L'utente vede "File caricato con successo. N righe trovate" e lo storico mostra 'Completato', ma nel DB non entra alcun dato e il file è irrecuperabile. In più: nessuna validazione della dimensione nonostante la label "Max 10MB" (riga 136), e il conteggio righe usa `file.text()` (riga 279) che su un XLSX binario produce un numero privo di senso. La pagina è in produzione e mente sull'esito.

**Proposta:** Se la pagina è un residuo superato da ImportHub, rimuoverla dalle route (e dalla guida in src/data/pageGuides.ts) per evitare che gli utenti la usino. Altrimenti: collegarla al vero `processImport` di importEngine, salvare il file su storage prima di creare il batch, marcare 'completed' solo dopo elaborazione reale, validare dimensione (10MB) ed estensione, e usare un parser Excel per gli XLSX.

### A27. ImportHub: errori di upload su storage ignorati e toast di successo con conteggio totale anche per i file falliti

**Dove:** `src/pages/ImportHub.tsx:406` · **Categoria:** Logica

In `handleFileUpload`, se `supabase.storage.upload` fallisce (righe 406-410) il codice fa solo `console.error` e `continue`, senza alcun feedback all'utente né conteggio dei fallimenti. Alla fine del loop (riga 484) viene comunque mostrato `showToast(`${files.length} file caricati con successo`)` usando il numero TOTALE di file, inclusi quelli il cui upload è fallito. Con un caricamento multiplo di 5 file di cui 3 falliti, l'utente vede "5 file caricati con successo" e non processa mai i 3 mancanti. (L'errore di insert DB invece mostra un toast, riga 463 — comportamento incoerente tra i due tipi di fallimento.)

**Proposta:** Contare i successi in una variabile (`let okCount = 0`) e mostrare un toast differenziato: successo pieno solo se `okCount === files.length`, altrimenti toast di errore/warning "Caricati X di Y file — Z falliti: <nomi>". Aggiungere un toast d'errore anche nel ramo `storageErr` come già avviene per `insertErr`.

### A28. Riconciliazione post-import estratto conto rotta: il 'dry-run' applica i match a insaputa dell'utente e il modale mostra sempre 0 risultati

**Dove:** `src/pages/ImportHub.tsx:697` · **Categoria:** Logica

computeMatchesAfterBankImport chiama runAutoReconciliation con { dryRun: true }, ma il refactor v2 di src/lib/reconciliationEngine.ts (righe 62-82) IGNORA le opzioni (parametro _options) e invoca la RPC rerun_reconciliation, che APPLICA subito i match auto_exact (migration 20260515_032, righe 105-137). In più la funzione ritorna { success, processed, matched } mentre ImportHub si aspetta { reconciled, suggested, unmatched, stats } (righe 701-712): il modale post-import mostra quindi sempre liste vuote e il pulsante di conferma (handleConfirmSafeMatches, righe 728-760) non ha mai nulla da confermare. Risultato: dopo ogni import EC i match vengono applicati senza revisione, e l'operatrice vede un riepilogo che dice che non c'è stato alcun match.

**Proposta:** Allineare ImportHub al motore v2: eliminare il finto dry-run e il modale basato su reconciled/suggested/unmatched, mostrare invece l'esito reale della RPC (processed/matched) con un link alla scheda Riconciliazione di Banche per confermare i suggeriti (auto_fuzzy). In alternativa, aggiungere alla RPC una vera modalità dry-run e ripristinare la revisione prima dell'applicazione.

### A29. Impostazioni → Dati azienda: campi non modificabili, lo stato 'editing' non viene mai attivato (dead code)

**Dove:** `src/pages/Impostazioni.tsx:238` · **Categoria:** Logica

CompanySection renderizza un input quando `editing === field` (riga 238) e ha handleSave/Annulla (righe 313-328), ma `setEditing` viene chiamato SOLO con null (righe 166 e 323): non esiste alcun click handler che imposti editing su un campo. Risultato: ragione sociale, P.IVA, PEC, SDI ecc. sono di fatto in sola lettura senza che la UI lo dichiari — l'utente non ha modo di correggere un dato sbagliato (solo i soci sono editabili). Le validazioni P.IVA/CF/PEC in handleSave (righe 148-156) sono quindi irraggiungibili.

**Proposta:** Aggiungere l'attivazione dell'editing (es. onClick sulla riga o icona matita per campo che fa setEditing(field)), oppure sostituire il pattern per-campo con un unico bottone 'Modifica' che apre il form completo. Aggiornare la guida in src/data/pageGuides.ts di conseguenza.

### A30. La sezione 'Utenti' in Impostazioni scrive su app_users, tabella scollegata dall'autenticazione: eliminare un utente NON revoca l'accesso

**Dove:** `src/pages/Impostazioni.tsx:337` · **Categoria:** Sicurezza

UserSection (righe 337-462) crea/modifica/elimina righe nella tabella app_users, che è usata SOLO da questa pagina (verificato con grep su tutto src/ e supabase/functions): l'accesso reale passa da Supabase Auth + user_profiles (src/hooks/useAuth.tsx riga 66) e i ruoli dal JWT app_metadata (src/hooks/useRole.tsx righe 24-31). Creare un utente qui non gli dà credenziali di accesso; cambiargli il ruolo non cambia i suoi permessi; soprattutto, ELIMINARLO non gli revoca l'accesso — ma l'interfaccia e la guida (src/data/pageGuides.ts riga 2017: 'gestisci le persone che hanno accesso al gestionale... ruoli e accessi') fanno credere il contrario. È un falso senso di sicurezza pericoloso su un gestionale finanziario in produzione.

**Proposta:** Collegare la sezione alla realtà: leggere/gestire user_profiles + inviti via edge function con service role (creazione utente Auth, set app_metadata.role), oppure — nel breve — rinominare la sezione in 'Rubrica utenti (solo anagrafica)' con un avviso esplicito che accessi e ruoli si gestiscono altrove, e correggere la voce corrispondente in pageGuides.ts nello stesso commit.

### A31. Hard DELETE su utenti, voci di costo e centri di costo senza controllo delle dipendenze

**Dove:** `src/pages/Impostazioni.tsx:1162` · **Categoria:** Integrità dati

Tre handleDelete eseguono DELETE fisici con sola conferma a doppio click sull'icona: app_users (riga 448), chart_of_accounts (riga 782), cost_centers (riga 1162). Nessuno verifica le dipendenze: eliminare un centro di costo lascia riferimenti orfani in chart_of_accounts.default_centers, app_users.outlet_access e budget_entries.cost_center; eliminare una voce padre di chart_of_accounts lascia figli orfani (parent_id) e budget_entries/monthly_cost_lines che puntano a un code inesistente. Su tabelle definite ad ALTA criticità in CLAUDE.md (chart_of_accounts 20 righe, cost_centers 8) il pattern preferito dal progetto è is_active=false, non DELETE.

**Proposta:** Preferire disattivazione (is_active=false) al DELETE, come già fatto per i dipendenti in Dipendenti.tsx (handleCessa). Prima di un DELETE reale, contare i riferimenti (budget_entries, voci figlie, utenti con quel outlet_access) e bloccare o avvisare con il numero di record collegati.

### A32. Toggle ambiente SDI TEST→PRODUZIONE con un solo click, senza conferma

**Dove:** `src/pages/Impostazioni.tsx:1337` · **Categoria:** UX

handleToggleEnvironment cambia sdi_config.environment tra TEST e PRODUCTION con un singolo click su uno switch, senza alcun dialogo di conferma. Passare a PRODUCTION fa inviare le fatture al Sistema di Interscambio reale dell'Agenzia delle Entrate: un click accidentale (lo switch è visivamente vicino ad altri controlli) ha conseguenze fiscali reali e difficilmente reversibili. Anche i campi codice_sdi/pec_ricezione salvano su onBlur senza validazione di formato (righe 1495, 1506): un codice SDI di 3 caratteri viene scritto in DB.

**Proposta:** Aggiungere un ConfirmModal esplicito per il passaggio a PRODUZIONE ('Le fatture verranno inviate allo SDI reale. Confermi?'), idealmente con digitazione di conferma. Validare codice_sdi (7 alfanumerici, regex già esistente in Onboarding) e PEC prima dell'update onBlur.

### A33. RBAC fail-open: ruolo di default 'super_advisor' se il profilo non è caricato

**Dove:** `src/pages/Impostazioni.tsx:1590` · **Categoria:** Sicurezza · *segnalato indipendentemente da 2 auditor*

In Impostazioni.tsx:1590 il ruolo di fallback è il più privilegiato: `const userRole = profile?.role || 'super_advisor'` — se il profilo non è ancora caricato (o la fetch fallisce) l'utente vede TUTTE le sezioni (Utenti, SDI, ecc.) sbloccate. Stesso pattern in Sidebar.tsx:212 (`const role = profile?.role || 'ceo'`, con default diverso e incoerente). Inoltre App.tsx non ha alcun guard di ruolo sulle route: la sidebar nasconde le voci ma qualunque ruolo può aprire /impostazioni, /import-hub, /report-sincronizzazioni digitando l'URL (solo TicketAdmin.tsx:87 verifica in pagina `role === 'super_advisor'`). La RLS protegge le scritture, ma la UI di default concede il massimo privilegio invece del minimo.

**Proposta:** Invertire il default in fail-safe: `profile?.role || 'viewer'` (o nessuna sezione finché il profilo non è caricato, mostrando uno skeleton). Uniformare il default tra Sidebar e Impostazioni. Aggiungere un componente `RoleRoute roles={[...]}` in App.tsx che riusi la stessa mappa ruoli della sidebar, con redirect a / per i ruoli non autorizzati.

### A34. Ricavi/costi senza outlet_id esclusi dai KPI ma inclusi nel breakdown

**Dove:** `src/pages/MarginiCategoria.tsx:110` · **Categoria:** Integrità dati

Le righe di daily_revenue/payables con outlet_id NULL vengono aggregate nel bucket fittizio '_company' (riga 110: `const id = r.outlet_id || '_company'`, riga 123 per i costi). Però outletData (riga 172) itera solo sugli outlet attivi per id, quindi il bucket '_company' non compare mai nella tabella né nei totali (totals è un reduce su outletData, riga 206). Al contrario, costBreakdown (riga 229) itera su TUTTI i valori di costsByOutlet, incluso '_company'. Risultato: il KPI 'Costi totali' e la tab 'Struttura Costi' mostrano numeri diversi sulla stessa pagina, e fatture/corrispettivi non assegnati a un outlet spariscono silenziosamente dai totali. Stesso problema per i costi di outlet disattivati (la query outlets filtra is_active=true).

**Proposta:** Aggiungere una riga sintetica 'Non assegnato' in outletData quando revenueByOutlet['_company'] o costsByOutlet['_company'] hanno valori (e analogamente per outlet_id di outlet non attivi), così i totali quadrano con il breakdown. In alternativa, escludere '_company' anche da costBreakdown e mostrare un banner 'X € di costi non assegnati a un punto vendita'.

### A35. Costi totali per outlet calcolati come max(payables, banca): costi persi o incoerenti

**Dove:** `src/pages/MarginiCategoria.tsx:177` · **Categoria:** Logica

Per evitare il doppio conteggio, i costi per outlet sono `Math.max(payCosts, bnkCosts)` (riga 177). L'euristica è errata quando le due fonti sono parzialmente disgiunte: es. 10.000 € di fatture fornitori + 8.000 € di uscite banca senza fattura (stipendi, F24) → costi reali ~18.000 €, mostrati 10.000 €. Inoltre il breakdown per macro-gruppo (costBreakdown, riga 229) usa SOLO payables: quando per un outlet vince bnkCosts, la somma delle categorie non coincide con i 'Costi totali'. Il margine e il marginPct (righe 178-179) ereditano l'errore. Nota anche che il margine confronta gross_revenue con gross_amount (IVA inclusa) dei payables: l'IVA detraibile gonfia i costi.

**Proposta:** Deduplicare in modo esplicito: usare i payables come fonte primaria e sommare solo le uscite banca non riconciliate a una fattura (esiste reconciliation_log nel DB), oppure sommare per categoria escludendo le categorie coperte dall'altra fonte. Rendere coerente costBreakdown con la stessa fonte usata per i totali e valutare l'uso di net_amount per il margine.

### A36. 'spese_non_divise' trattato come outlet: falsi alert critici e medie falsate

**Dove:** `src/pages/MarginiOutlet.tsx:114` · **Categoria:** Logica

MarginiOutlet aggrega budget_entries per cost_center (riga 114) senza escludere i cost_center non-outlet. Per il tenant NZ esistono per regola 84 righe con cost_center='spese_non_divise' (gap bilancio documentato in CLAUDE.md): hanno ricavi=0 e costi>0, quindi marginePercent=0 (riga 130) e finiscono in criticalOutlets (<5%, riga 230), generando il banner rosso 'margini critici' su un finto punto vendita, oltre a comparire in heatmap, grafico e tabella. Lo stesso avviene in Produttivita.tsx (riga 143: entra nella classifica e nelle raccomandazioni) e in ScenarioPlanning.tsx (riga 73: outletCount.add(cost_center) → numOutlet include 'spese_non_divise', quindi avgRicaviOutlet — usato come stima ricavi del nuovo outlet — è sistematicamente sottostimato).

**Proposta:** Filtrare i cost_center rispetto all'anagrafica outlets del tenant (join per nome o mappa id→nome già usata in Produttivita), oppure escludere esplicitamente i cost_center 'virtuali' (spese_non_divise) da alert, medie, conteggio outlet e classifica, mostrandoli semmai come riga separata 'Costi non divisi'.

### A37. Open-to-Buy: il KPI 'Target Sell-Through' non è un sell-through

**Dove:** `src/pages/OpenToBuy.tsx:129` · **Categoria:** Logica

Il KPI è calcolato come `sellThrough = (totalSales / (totalSales + totalMarkdown)) * 100` (riga 129): è il rapporto tra vendite e vendite+markdown (di fatto ~1/(1+markdown%)), non un sell-through, che è pezzi venduti / pezzi disponibili (o valore venduto / valore immesso). Con markdown 12% mostra sempre ~89% qualunque siano scorte e vendite. Inoltre la formula OTB visualizzata nell'info box (riga 239: 'OTB = Vendite Previste + Markdown + Scorta Finale − Scorta Iniziale') non corrisponde al calcolo reale (righe 97-99), che converte vendite e markdown al costo dividendo per (1+ricarico): l'utente non può riconciliare il numero mostrato con la formula dichiarata.

**Proposta:** Rinominare/ricalcolare il KPI: se si vuole un sell-through target, calcolarlo come vendite previste / (scorta iniziale + acquisti OTB) in valori omogenei; altrimenti etichettarlo 'Incidenza markdown'. Allineare l'info box alla formula effettiva specificando che vendite e markdown sono convertiti al costo con il ricarico target.

### A38. Pulsanti Modifica/Elimina outlet visibili a tutti i ruoli (canWrite non applicato al dettaglio)

**Dove:** `src/pages/Outlet.tsx:1697` · **Categoria:** Sicurezza

In Outlet.tsx `canWrite = profile?.role === 'super_advisor'` (riga 1908) protegge solo i bottoni 'Nuovo' e 'Crea da contratto' nella lista. Nel dettaglio (OutletDetail, righe 1696-1703) i bottoni 'Modifica' ed 'Elimina' sono renderizzati incondizionatamente: una operatrice o uno store_manager che apre /outlet/:id vede e può azionare l'eliminazione dell'outlet (con la cascata del finding precedente). Il gating è incoerente all'interno della stessa pagina.

**Proposta:** Passare canWrite a OutletDetail e nascondere (o disabilitare con tooltip) Modifica/Elimina quando falso, come già fatto per i bottoni di creazione. Verificare che le RLS su outlets limitino DELETE/UPDATE agli stessi ruoli lato server.

### A39. Produttività: il trend mensile usa ancora il fallback inventato di 4 dipendenti

**Dove:** `src/pages/Produttivita.tsx:204` · **Categoria:** Logica

Il resto della pagina è stato bonificato per mostrare 'N/D' quando mancano dati dipendenti (commento righe 217-220: 'Prima c'era un fallback a 4 che inventava i numeri'), ma monthlyTrendData usa ancora `const dip = empCountByOutlet[outlet] || 4; // fallback` (riga 204). Il grafico 'Trend Mensile Fatturato/Dipendente' quindi inventa un fatturato/dipendente (ricavi/4) per gli outlet senza dato, in contraddizione con la tabella della stessa pagina che per gli stessi outlet mostra 'N/D'. L'utente vede due numeri incompatibili per la stessa metrica.

**Proposta:** Nel trend, per gli outlet senza dato dipendenti impostare il valore a null (Recharts con connectNulls già presente li salta) o escludere la serie dell'outlet, in coerenza con la scelta N/D del resto della pagina. Rimuovere anche la nota '(stima)' in tabella (riga 529) che ormai accompagna solo valori N/D.

### A40. RevisionePagamenti: 'Salva e applica' applica TUTTE le proposte pendenti dell'azienda e il pannello di revisione del responsabile non è mai renderizzato

**Dove:** `src/pages/RevisionePagamenti.tsx:229` · **Categoria:** Logica

Il commento di testa (righe 2-4) descrive un workflow a due passi: l'operatrice SALVA le proposte, il responsabile (super_advisor/cfo/ceo) le APPLICA o scarta. In realtà saveChanges, dopo l'upsert delle proposte, chiama subito `rpc_apply_all_payment_proposals` (riga 229) che applica TUTTE le proposte in stato 'inviata' — incluse quelle di altre operatrici ancora in attesa di revisione, non solo quelle appena salvate. Inoltre l'intero apparato di revisione (state `proposals`, `isManager`, funzioni applyOne/discardOne/applyAll righe 239-265, `supById`) è definito ma mai usato nel render: è codice morto e il gate di approvazione manageriale di fatto non esiste. discardOne inoltre non chiede conferma e ignora gli errori.

**Proposta:** O applicare solo le proposte appena salvate (RPC con lista di id o filtro reviewed_by/updated_at) e ripristinare il pannello manager con applyOne/discardOne/applyAll nel render, oppure — se il flusso a due passi è stato deliberatamente abbandonato — rimuovere il codice morto e aggiornare il commento e la guida in src/data/pageGuides.ts per riflettere il comportamento reale ('salva = applica subito').

### A41. ModalRateizza: l'ultima rata è calcolata con la quota NON arrotondata, la somma delle rate salvate non torna con il totale fattura

**Dove:** `src/pages/Scadenzario.tsx:381` · **Categoria:** Logica

Alla riga 381 le rate intermedie sono arrotondate (`Math.round(rataAmount * 100) / 100`) ma l'ultima rata è `totalAmount - rataAmount * (numRate - 1)` dove `rataAmount = totalAmount / numRate` NON è arrotondato. Esempio: 100,00 € in 3 rate → rate salvate 33,33 + 33,33 + 33,3333 = 99,9933 € invece di 100,00 €. La riga 'Totale' della tabella mostra fmt(totalAmount)=100,00 mentre la somma reale delle rate persistite in payables è diversa: lo scadenzario e il partitario fornitore non quadrano più di qualche centesimo per ogni rateizzazione.

**Proposta:** Calcolare l'ultima rata come `totalAmount - rataArrotondata * (numRate - 1)` (con rataArrotondata = Math.round(rataAmount*100)/100), come già fatto correttamente in computeInstallments di ScadenzarioSmart.tsx (righe 4613-4634) che accumula le quote arrotondate e assegna il resto all'ultima rata.

### A42. Salda/Sospendi/Rimanda/Riattiva: update payables e insert payable_actions senza controllo errori né validazione importo

**Dove:** `src/pages/Scadenzario.tsx:849` · **Categoria:** Integrità dati

handleSalda (righe 843-871), handleSospendi (873-888), handleRimanda (890-904) e handleRiattiva (906-916) non controllano mai `error` delle chiamate Supabase: se l'UPDATE su payables fallisce (RLS, rete), l'INSERT su payable_actions viene comunque eseguito (o viceversa), producendo audit trail incoerente con lo stato reale; la modale si chiude sempre come successo. In handleSalda inoltre l'importo non è validato: l'input number accetta valori negativi o superiori al residuo — con amount > residuo lo stato diventa 'pagato' e amount_paid supera gross_amount; con amount negativo amount_paid diminuisce. amount_remaining non viene mai ricalcolato nell'update (righe 849-855), affidandosi implicitamente alla vista.

**Proposta:** Controllare `error` di ogni chiamata (update e insert) mostrando toast e NON chiudendo la modale in caso di fallimento; validare 0 < amount <= amount_remaining (con tolleranza 1 cent) prima del submit; idealmente incapsulare update+audit in una RPC transazionale come per le altre azioni contabili.

### A43. ScadenzarioSmart: fetch di cash_movements senza paginazione — oltre 1000 righe la colonna CONTO perde le banche

**Dove:** `src/pages/ScadenzarioSmart.tsx:734` · **Categoria:** Logica · *segnalato indipendentemente da 2 auditor*

Nella stessa fetchData che pagina correttamente payables e v_payables_operative con fetchAllPaged, due query restano non paginate: cash_movements (righe 734-737, select id/bank_account_id per l'intera company, senza order né range) e payable_actions tipo 'disposizione' (righe 751-756). Superate le 1000 righe (cash_movements è già a 513 e cresce a ogni import EC), il server tronca il risultato: la mappa cash_movement→banca diventa parziale e la colonna CONTO mostra una banca mancante o errata per le fatture riconciliate — informazione usata operativamente per decidere i pagamenti. Per payable_actions il troncamento fa sparire i badge «In distinta». Il troncamento su cash_movements è particolarmente insidioso perché senza ORDER BY le 1000 righe restituite sono arbitrarie.

**Proposta:** Riusare fetchAllPaged (già definito nello stesso file) anche per queste due query, con .order('id') per stabilità; in alternativa creare una vista/RPC che restituisca direttamente la coppia payable_id→bank_name già joinata lato server.

### A44. Chiusura manuale delle fatture calcolata su stato client stale: lost update con più operatrici

**Dove:** `src/pages/ScadenzarioSmart.tsx:1141` · **Categoria:** Logica · *segnalato indipendentemente da 2 auditor*

closePayableManually calcola newPaid = prevPaid + amount partendo da payables.find(...) nello stato React locale (righe 1094-1098, 1141-1152), caricato al mount della pagina. Il sistema è usato in parallelo da più operatrici (Sabrina/Veronica sui 3 tenant): se un'altra utente (o la riconciliazione bancaria automatica) ha nel frattempo registrato un pagamento parziale, prevPaid è stale e l'update scrive valori assoluti che cancellano il pagamento altrui (classico lost update: 300 pagati diventano 200). Il trigger update_payable_status ricalcola amount_remaining ma non protegge amount_paid, che è proprio il campo sorgente.

**Proposta:** Rendere l'operazione atomica lato server: RPC close_payable_manually(p_id, p_amount, ...) che fa UPDATE payables SET amount_paid = amount_paid + p_amount ... in una transazione con controllo sul residuo, oppure ricaricare la riga con select immediatamente prima dell'update e usare una clausola .eq('amount_paid', prevPaid) come optimistic lock, ripetendo in caso di conflitto.

### A45. ScadenzeFiscali: DELETE fisico sulle scadenze fiscali (vs soft-delete altrove) e catch morti su markPaid/handleDelete

**Dove:** `src/pages/ScadenzeFiscali.tsx:348` · **Categoria:** Integrità dati

handleDelete (righe 345-353) esegue `supabase.from('fiscal_deadlines').delete()` cancellando fisicamente la riga, mentre ScadenzarioSmart.handleDeleteSchedule (riga 1690) per la STESSA entità fa soft-delete con status='cancelled'. fiscal_deadlines è tabella viva citata nella regola NO DATA LOSS: una scadenza F24 con importo e storico viene distrutta con un solo confirm nativo, in modo irreversibile e incoerente tra le due pagine. Inoltre sia markPaid (righe 331-342) sia handleDelete non controllano `error`: supabase-js non lancia eccezioni, quindi i catch sono morti e in caso di fallimento la lista viene ricaricata senza alcun feedback (l'utente crede di aver pagato/eliminato).

**Proposta:** Sostituire il DELETE con `update({ status: 'cancelled' })` per coerenza con ScadenzarioSmart (che già esclude le cancelled dalla query, riga 836), controllare `error` di update/delete con toast di errore, e usare la modale di conferma custom al posto di confirm() nativo (vietato altrove nel progetto, vedi askConfirm in ScadenzarioSmart riga 336).

### A46. Split imponibile/IVA agganciato per solo invoice_number: dati di un altro fornitore

**Dove:** `src/pages/SchedaContabileFornitore.tsx:171` · **Categoria:** Logica

La mappa einvSplit (righe 167-182) che riempie imponibile/IVA mancanti dei payables A-Cube interroga electronic_invoices con `.eq('company_id', ...).in('invoice_number', chunk)` SENZA filtrare per supplier_vat. Il numero fattura non è univoco tra fornitori diversi — lo ammette il commento a riga 557-559 dello stesso file ('il numero fattura NON è univoco tra fornitori diversi, es. due fornitori con fattura n.4', fix del ticket CT INDUSTRIE/MICHELE FISCO). Se un altro fornitore ha una fattura con lo stesso numero, la scheda mostra imponibile e IVA presi dalla fattura sbagliata, e questi valori finiscono nel partitario e nella stampa della scheda contabile.

**Proposta:** Aggiungere alla query di einvSplit il filtro `.eq('supplier_vat', supplier.partita_iva || supplier.vat_number)` (stessa chiave d'aggancio per P.IVA usata altrove), e in assenza di P.IVA non riempire lo split invece di rischiare dati di un altro fornitore.

### A47. Partitario: una sola rata pagata registra come pagato l'intero importo fattura

**Dove:** `src/pages/SchedaContabileFornitore.tsx:493` · **Categoria:** Logica

Nell'aggregazione del partitario, `if (p.status === 'pagato' && p.payment_date) { agg.isPaid = true; ... }` (righe 400-406) marca l'intera fattura come pagata appena UNA rata risulta pagata. La riga DARE del pagamento usa poi `dare: agg.grossTotal` (riga 493), cioè il totale complessivo della fattura, non la somma delle rate effettivamente pagate. Per una fattura in 3 rate con 1 sola rata saldata, il partitario mostra un pagamento per l'intero importo e il saldo del fornitore risulta chiuso mentre 2 rate sono ancora aperte: il 'Saldo contabile' in KPI e nella stampa è sbagliato.

**Proposta:** Registrare come DARE la somma di amount_paid delle sole rate con status 'pagato' (accumulare `agg.paidAmount += Number(p.amount_paid ?? p.gross_amount)` per le rate pagate) e usare quella al posto di grossTotal; considerare la fattura 'isPaid' solo quando tutte le rate sono pagate, altrimenti emettere una riga di pagamento parziale come già fatto per le chiusure manuali parziali.

### A48. StoreManager: dashboard interamente mock (incassi, staff con nomi reali, prodotti) presentata come dati veri in produzione

**Dove:** `src/pages/StoreManager.tsx:57` · **Categoria:** Integrità dati · *segnalato indipendentemente da 2 auditor*

La pagina espone KPI plausibili ma fissi nel codice (incasso 3.850,50 €, obiettivi, vendite orarie, top prodotti — righe 57-116) e soprattutto nomi e cognomi di persone reali hardcoded nello staff ('Felici Silvia', 'Lorenzini Martina', 'Mucciarelli Ginevra', 'Tavanti Sara', righe 102-107): dati specifici del tenant NZ visibili anche su Made e Zago, in violazione della regola 'mai valori hardcoded specifici di un tenant'. A differenza di AnalyticsPOS (riga 317), StockSellthrough (riga 273) e OpenToBuy (riga 169), qui NON c'è alcun badge 'Dati simulati' in pagina: la guida (pageGuides.ts riga 1311) avverte che i numeri sono di esempio, ma chi apre la pagina senza leggere la guida vede numeri credibili che cambiano outlet nel selettore senza cambiare i valori.

**Proposta:** Aggiungere lo stesso badge 'Dati simulati (demo)' usato nelle altre pagine demo e sostituire i nomi reali con nomi chiaramente fittizi (es. 'Dipendente 1') o generati dagli employees reali del tenant come già fatto per gli outlet (righe 41-45).

### A49. Parsing importi italiani errato quando ci sono solo punti delle migliaia (senza virgola)

**Dove:** `src/pages/TesoreriaManuale.tsx:238` · **Categoria:** Integrità dati

parseCSVNumber gestisce '1.234,56' e '1,234.56', ma un importo italiano intero con separatore migliaia e senza decimali viene azzoppato: '1.234' cade nell'ultimo ramo e parseFloat restituisce 1.234 (un euro e spiccioli invece di milleduecento); '1.234.567' entra nel ramo 'inglese' (riga 238-239, indexOf('.') > lastIndexOf(',')=-1) e diventa 1.234. Formati comuni negli export CSV delle banche italiane. Lo stesso identico difetto è in parseNum di ConvertitoreFattureXML.tsx:100-107, dove il valore finisce direttamente in ImportoTotaleDocumento/ImponibileImporto dell'XML fiscale generato.

**Proposta:** Nei due parser trattare come separatore delle migliaia il punto quando è seguito da esattamente 3 cifre finali o quando ci sono più punti (es. regex /^\d{1,3}(\.\d{3})+$/ → rimuovere i punti). Aggiungere test unitari con i casi '1.234', '1.234.567', '1.234,56', '12.34'.

### A50. Lost update sui commenti ticket: read-modify-write dell'intero array JSON senza controllo di concorrenza

**Dove:** `src/pages/Ticket.tsx:1067` · **Categoria:** Integrità dati

aggiungiCommento costruisce `const nuoviCommenti = [...(ticket.commenti ?? []), commento]` a partire dallo stato React (potenzialmente stantio) e poi fa UPDATE dell'intera colonna `commenti`. Se nel frattempo l'AutoFix orario o l'edge function ticket-resolve-now ha aggiunto un commento AI (o un altro utente ha commentato), quel commento viene sovrascritto e perso definitivamente. Stesso pattern in TicketAdmin.tsx bulkCloseWithoutWork (righe 216-247): legge `commenti`, appende il commento admin e riscrive tutto l'array riga per riga. Con l'AutoFix che gira ogni ora in produzione la finestra di race è reale, e la perdita è silenziosa (nessun errore).

**Proposta:** Non riscrivere l'intero array dal client: creare una RPC Postgres tipo `append_ticket_comment(p_ticket_id, p_commento)` che fa `UPDATE tickets SET commenti = coalesce(commenti,'[]'::jsonb) || p_commento WHERE id = ...` (append atomico lato DB), e usarla sia da Ticket.tsx sia da TicketAdmin.tsx sia dall'edge function. In alternativa, prima dell'UPDATE rileggere i commenti dal DB e aggiornare con un filtro ottimistico su aggiornato_il.

### A51. Cancellazione definitiva (hard DELETE) dei ticket dalla UI, anche bulk, con allegati orfani nello storage

**Dove:** `src/pages/TicketAdmin.tsx:261` · **Categoria:** Integrità dati

bulkDelete esegue `supabase.from('tickets').delete().in('id', ids)` su N ticket selezionati; la stessa cosa fa cancellaTicket in Ticket.tsx (riga 1169) per il singolo ticket. La tabella `tickets` è esplicitamente elencata in CLAUDE.md tra le tabelle vive su cui "MAI fare DELETE bulk" e per cui "preferire UPDATE/flag a DELETE". La conferma è un solo click su un modal e con "Seleziona tutti" si possono cancellare irreversibilmente tutti i ticket filtrati (dati reali post go-live: segnalazioni, commenti AI, storico). Inoltre i file caricati in storage sotto `tickets/<id>/` (upload in Ticket.tsx righe 420-423) non vengono mai rimossi né riassociati: restano orfani nel bucket pubblico 'media'.

**Proposta:** Sostituire il DELETE con soft-delete (colonna `is_deleted boolean default false` + filtro nelle query), mantenendo l'hard delete al massimo per singolo ticket con doppia conferma (es. digitare 'CANCELLA'). Se si mantiene il delete fisico, rimuovere anche i file storage `tickets/<id>/*` nella stessa operazione e limitare la bulk-delete a un numero massimo di ticket per volta.

### A52. acube-ob-tx-sync: movimenti bancari legittimi scartati silenziosamente (hash troncato a 40 char + errori insert ignorati)

**Dove:** `supabase/functions/acube-ob-tx-sync/index.ts:81` · **Categoria:** Integrità dati

canonicalBankHash (righe 81-86) è MD5 di conto|data|importo|descrizione troncata a 40 caratteri: due transazioni reali distinte nello stesso giorno, stesso conto, stesso importo e descrizione simile (caso frequentissimo nel retail: due POS/commissioni identiche) collidono e la seconda viene scartata come duplicato dall'UNIQUE index → movimento bancario mancante e riconciliazione che non quadra, senza alcun segnale. In più il commento a riga 239-241 dice esplicitamente che tutti gli errori di insert diversi da 23505 'vengono ignorati silenziosamente': un errore di vincolo o tipo fa sparire il movimento senza log né contatore nel response.

**Proposta:** Includere nell'hash canonico un discriminante stabile (es. progressivo intra-giorno calcolato sull'ordine A-Cube, o end_to_end_id quando presente) — da fare in parallelo nella funzione PG bank_transaction_canonical_hash (migration dedicata sui 3 tenant). Nel frattempo: loggare con console.error ogni insert fallito non-23505, esporre un contatore 'bank_failed' nel JSON di risposta e mostrarlo nella UI di sync.

### A53. companyId preso dal body e mai verificato contro il JWT nelle functions A-Cube (viola la regola company_id isolation)

**Dove:** `supabase/functions/acube-ob-tx-sync/index.ts:112` · **Categoria:** Sicurezza

CLAUDE.md impone 'company_id isolation — ogni query filtra per company_id dal JWT', ma acube-ob-tx-sync (riga 112), acube-ob-accounts-sync (riga 94), acube-cf-sync-invoices (riga 100) e acube-cf-assign-appointee accettano companyId dal body senza confrontarlo con app_metadata.company_id (che il JWT contiene, come dimostra sdi-sync riga 349). Le functions usano il service role (bypass RLS): un utente 'contabile' autenticato può passare un companyId arbitrario/inesistente e far scrivere bank_accounts e bank_transactions sotto quel company_id — righe orfane invisibili alla UI ma presenti nel DB, o dati agganciati alla company sbagliata. L'isolamento fisico per-progetto attenua il rischio cross-tenant ma non l'integrità interna.

**Proposta:** Uniformare al pattern di sdi-sync: risolvere companyId dalla tabella companies del progetto (limit 1) oppure validare che body.companyId === user.app_metadata.company_id (per i super_advisor cross-company, verificare che il companyId esista in companies). Rifiutare con 403 in caso di mismatch. Applicare a tutte le functions A-Cube sui 3 tenant.

### A54. returnUrl hardcoded 'gestionale-nz.netlify.app' nei pagamenti SEPA: gli utenti Made/Zago vengono rimandati al sito del tenant NZ

**Dove:** `supabase/functions/acube-payment-send/index.ts:130` · **Categoria:** Sicurezza

Il payload inviato ad A-Cube per ogni bonifico contiene `returnUrl: "https://gestionale-nz.netlify.app/scadenzario?from=acube_payment"` fisso. La stessa function viene deployata sui 3 progetti Supabase (Regola #0): dopo l'autorizzazione PSD2 sulla banca, un utente di Made o Zago verrebbe reindirizzato al frontend di New Zago (dove la sua sessione non esiste e i cui dati sono di un'altra azienda). Violazione della regola 'mai URL/valori tenant-specifici hardcoded'.

**Proposta:** Rendere la returnUrl configurabile per tenant: leggerla da una env var della edge function (es. FRONTEND_BASE_URL impostata diversa su ciascun progetto) o da una colonna della tabella companies, con errore esplicito se assente. Ridployare su NZ + Made + Zago con i rispettivi valori.

### A55. acube-sdi-send-invoice: sede del cedente hardcoded 'Via Outlet 1, Milano' su fatture fiscali reali + doppia emissione su retry

**Dove:** `supabase/functions/acube-sdi-send-invoice/index.ts:144` · **Categoria:** Integrità dati

Il blocco sede del cedente_prestatore è completamente hardcoded (righe 144-150: indirizzo 'Via Outlet 1', cap '20100', comune 'Milano', provincia 'MI') per TUTTI i tenant: ogni fattura elettronica emessa via SDI da NZ, Made e Zago riporta un indirizzo legale falso — il commento dice 'usa valori della company se presenti' ma il codice non li legge mai. Inoltre non c'è idempotenza: se il POST a A-Cube riesce ma il polling di dettaglio (riga 204-207, senza check detailResp.ok) o l'insert lancia un'eccezione, il client riceve 500 e al retry la STESSA fattura viene emessa una seconda volta verso SDI; l'insert fallito in acube_sdi_invoices è solo console.warn (riga 234-236), quindi la fattura emessa può non risultare mai nel DB.

**Proposta:** Leggere indirizzo/cap/comune/provincia dalla tabella companies (aggiungendo le colonne se mancanti) e rifiutare l'emissione con 400 se la sede non è configurata. Prima del POST verificare che invoice.number non esista già in acube_sdi_invoices per il tenant (idempotency check); dopo il POST, salvare SEMPRE almeno acube_uuid anche se il polling fallisce, e trattare l'errore di insert come errore vero con retry.

### A56. sdi-receive risponde 200 anche su errore DB: la fattura ricevuta dal SDI viene persa per sempre

**Dove:** `supabase/functions/sdi-receive/index.ts:288` · **Categoria:** Integrità dati · *segnalato indipendentemente da 3 auditor*

Se l'insert/update su electronic_invoices fallisce, la function risponde comunque 200 'OK (with DB warning)' (righe 288-293); idem per qualsiasi eccezione nel catch generale (righe 300-305). Il mittente considera la consegna riuscita e non ritenta mai: l'XML della fattura — dato fiscale reale — è perso definitivamente, visibile solo nei log effimeri delle edge functions. Con la regola granitica NO DATA LOSS del progetto, questo è il punto più fragile del flusso passivo: nessuna persistenza dead-letter del payload prima del parse.

**Proposta:** Prima di qualsiasi parse/insert, salvare l'XML raw in una tabella di staging (es. sdi_inbound_raw: id, received_at, body, processed boolean) o in uno Storage bucket; solo dopo processarlo. In caso di errore DB sullo staging stesso, rispondere 500 così il mittente ritenta. Aggiungere un job/vista per riprocessare le righe processed=false. Replicare su tutti e 3 i tenant.


## 🟡 MEDIA — 78 finding

### M1. AICategorization: KPI e filtri calcolati solo sugli ultimi 500 movimenti e caricamento fallito senza alcun messaggio

**Dove:** `src/components/AICategorization.tsx:174` · **Categoria:** Usability

loadData carica cash_movements con `.limit(500)` (riga 174) e calcola su quel sottoinsieme tutte le statistiche (righe 193-205): le card 'Confermati/Da verificare/Non categorizzati' e i contatori dei tab non rappresentano l'intero dataset ma solo i 500 movimenti più recenti, senza che l'interfaccia lo dica (solo la card 'Totale' ha la micro-nota 'movimenti caricati'). Anche 'Conferma tutti ≥85%' agisce solo sui 500 caricati: l'utente crede di aver confermato tutto ma i movimenti più vecchi restano in sospeso. Inoltre il catch di loadData (righe 206-209) fa solo console.error: in caso di errore la pagina esce dal loading mostrando KPI a zero e tabella vuota, indistinguibile da 'nessun dato'.

**Proposta:** Calcolare i contatori con query di count lato DB (`select('id', { count: 'exact', head: true })` per ciascun filtro) invece che sul sottoinsieme client, oppure esplicitare chiaramente 'ultimi 500 movimenti' su tutte le card. Nel catch impostare uno stato di errore con messaggio e bottone 'Riprova' (pattern già usato in Ticket.tsx col toast).

### M2. "Conferma tutti ≥85%" usa window.confirm, bypassa la pipeline dell'edge function e fallisce in silenzio a metà

**Dove:** `src/components/AICategorization.tsx:337` · **Categoria:** Logica

confirmAllHighConfidence: (1) usa il dialog nativo `confirm(...)`, in violazione del pattern di progetto "Niente alert/confirm nativi" (rispettato ovunque altrove con ConfirmModal); (2) scrive direttamente su cash_movements (`update({ cost_category_id, ai_method: 'auto_confirmed' })`, righe 342-349) invece di passare per l'edge function 'ai-categorize' mode 'confirm' come fanno confirmCategory/correctCategory — quindi le conferme bulk non alimentano le regole apprese dall'AI e non impostano gli stessi campi (es. verified); (3) il loop seriale è dentro un unico try/catch: al primo errore si interrompe lasciando una conferma parziale, con il fallimento riportato solo in console.error, nessun toast per l'utente.

**Proposta:** Sostituire confirm() con il modal custom già usato altrove; instradare anche la conferma bulk attraverso l'edge function (idealmente con un mode 'confirm_batch' che accetta una lista di coppie movimento/categoria) così il learning resta coerente; gestire gli errori per singola riga con conteggio successi/falliti e toast riepilogativo come fa bulkResolveViaAI in TicketAdmin.

### M3. ESC non chiude la ricerca globale nonostante il tasto sia suggerito nella UI

**Dove:** `src/components/GlobalSearch.tsx:65` · **Categoria:** Logica

GlobalSearch registra il listener per Escape solo in modalità non controllata: l'useEffect a GlobalSearch.tsx:64-75 fa `if (openProp !== undefined) return` prima di aggiungere il keydown handler. Ma nell'app reale il componente è SEMPRE controllato (Layout.tsx:363 passa `open={searchOpen}`), e il listener di Layout.tsx:248-253 gestisce solo Cmd/Ctrl+K. Risultato: l'overlay mostra il badge `ESC` (GlobalSearch.tsx:175) ma premere Escape non chiude nulla; l'utente deve cliccare fuori o ripremere Cmd+K. Su Windows/tastiera è il modo standard di chiudere un command palette.

**Proposta:** Gestire Escape anche in modalità controllata: nell'onKeyDown dell'input aggiungere `if (e.key === 'Escape') setOpen(false)`, oppure in Layout.tsx aggiungere `if (e.key === 'Escape') setSearchOpen(false)` nello stesso listener del Cmd+K.

### M4. GlobalSearch: race condition tra ricerche debounced — risultati stantii possono sovrascrivere quelli della query corrente

**Dove:** `src/components/GlobalSearch.tsx:100` · **Categoria:** Logica

doSearch è async e al termine chiama incondizionatamente `setResults(res)` (riga 136) e `setLoading(false)`: non esiste alcun meccanismo di cancellazione o controllo di versione. Se l'utente digita 'ross' e poi 'rossi', la ricerca per 'ross' (5 query in Promise.all, più lenta) può risolversi DOPO quella per 'rossi' e sovrascriverne i risultati: l'utente vede risultati che non corrispondono a ciò che ha digitato. Inoltre `catch` fa solo console.warn (riga 133): in caso di errore l'utente vede "Nessun risultato" senza distinguerlo da un errore reale.

**Proposta:** Tenere un contatore/ref della richiesta corrente (es. `const reqId = ++lastReqId.current`) e applicare `setResults` solo se `reqId === lastReqId.current`; oppure verificare che la query cercata coincida ancora con lo stato `query` prima del set. Mostrare uno stato di errore distinto dal caso 'nessun risultato'.

### M5. GlobalSearch: risultati non navigabili al dettaglio (fatture, movimenti, outlet portano a pagine generiche) e copertura incompleta

**Dove:** `src/components/GlobalSearch.tsx:122` · **Categoria:** Usability

Le mappature dei risultati usano URL generici: tutte le fatture puntano a '/fatturazione' (r.129), tutti i movimenti a '/banche' (r.130), tutti gli outlet a '/outlet' (r.122), tutti i dipendenti a '/dipendenti' (r.131) — solo i fornitori hanno un deep-link con id (r.127). Cliccando la fattura trovata, l'utente atterra sulla lista completa e deve ricercarla di nuovo a mano: la ricerca globale perde gran parte del suo valore. Inoltre ogni categoria è tagliata a 5 risultati senza indicare che ce ne sono altri, e mancano entità cercabili rilevanti: ticket, scadenze fiscali, clienti.

**Proposta:** Passare l'id nell'URL (query param o route param, es. `/fatturazione?focus=<id>`, `/banche?focus=<id>`) e far evidenziare/filtrare l'elemento nella pagina di destinazione (il progetto ha già DEEP_LINKING_NOTES.md come riferimento). Aggiungere un indicatore '+ altri risultati' quando il limit 5 è saturo e valutare l'aggiunta di ticket e scadenze fiscali tra le categorie.

### M6. Nessun modal dell'app ha role='dialog', aria-modal o focus trap

**Dove:** `src/components/GlobalSearch.tsx:160` · **Categoria:** Accessibilità

Una ricerca su tutto src/ trova 0 occorrenze di role="dialog" e aria-modal, a fronte di almeno 15 overlay modali costruiti come semplici div 'fixed inset-0' (GlobalSearch.tsx:160, conferme di pagamento in TesoreriaManuale/ScadenzarioSmart, editor fornitori, ecc.). Senza role/aria-modal lo screen reader non annuncia il dialogo, senza focus trap il tab esce dal modal verso la pagina sottostante, e diversi flussi critici (conferma invio distinta SEPA, eliminazioni) usano solo window.confirm o div non focalizzabili. Anche Sidebar.tsx e Layout.tsx non hanno alcun aria-label.

**Proposta:** Creare un componente Modal condiviso (in src/components/ui) con role="dialog", aria-modal="true", aria-labelledby sul titolo, focus trap, chiusura con Escape e ritorno del focus all'elemento invocante, e migrare progressivamente gli overlay esistenti, partendo da quelli dei flussi di pagamento.

### M7. La pagina Revisione Pagamenti (/fornitori/revisione) non ha una guida dedicata: il pannello ? mostra la guida di Fornitori

**Dove:** `src/components/HelpPanel.tsx:37` · **Categoria:** Usability

La rotta /fornitori/revisione (src/App.tsx riga 130) apre RevisionePagamenti, una pagina operativa a sé (revisione massiva di tipologia/scadenze/banca con salvataggio proposte e applicazione via rpc_apply_all_payment_proposals). In src/data/pageGuides.ts non esiste una voce con path '/fornitori/revisione': il fallback di resolveGuide (HelpPanel.tsx righe 37-43) risale al padre '/fornitori' e mostra la guida della pagina Fornitori — titolo, sezioni e FAQ di un'altra pagina. Anche l'assistente AI (help-chat) riceve quindi come contesto la guida sbagliata. La sezione 'Revisione pagamenti' dentro la guida Fornitori (riga 1477) copre solo in parte il flusso e non menziona il meccanismo delle proposte per i responsabili (MANAGER_ROLES, RevisionePagamenti.tsx righe 21 e 95).

**Proposta:** Aggiungere in pageGuides.ts una voce dedicata con path '/fornitori/revisione' (funzionamento riga per riga, righe gialle, 'Salva e applica', ruolo dei responsabili e annullabilità) e un case esplicito in resolveGuide, come già fatto per /fornitori/scheda-contabile.

### M8. HelpPanel: la conversazione con l'assistente AI viene persa a ogni cambio pagina

**Dove:** `src/components/HelpPanel.tsx:269` · **Categoria:** Usability

L'effetto su location.pathname (righe 269-272) chiude il pannello e resetta la tab a 'guida' a ogni navigazione; poiché AssistantChat tiene i messaggi in useState locale e viene smontato alla chiusura del pannello (render condizionale a riga 290), l'intera conversazione va persa. Il flusso tipico è proprio: l'utente chiede all'AI come fare qualcosa, l'AI risponde 'vai nella pagina X', l'utente ci naviga — e a quel punto la risposta che stava seguendo è sparita e deve riformulare la domanda da zero.

**Proposta:** Sollevare lo stato dei messaggi fuori da AssistantChat (context o store Zustand, coerente con lo stack del progetto) o persisterlo in sessionStorage, mantenendo la cronologia della sessione tra le pagine. In alternativa minimale: mantenere il pannello aperto sulla tab chat quando la navigazione avviene con chat attiva, resettando solo la tab 'guida'.

### M9. Mobile: tab 'Profilo' porta a Impostazioni, pagina /profilo irraggiungibile e ruoli ignorati nella bottom nav

**Dove:** `src/components/Layout.tsx:103` · **Categoria:** UX

Nella BottomNav mobile (Layout.tsx:100-103) la voce etichettata 'Profilo' con icona User punta a `/impostazioni` — pagina che in sidebar è riservata a super_advisor e che per contabile/coo mostra sezioni bloccate. Intanto la vera pagina /profilo esiste (App.tsx:144) ma è raggiungibile SOLO dal ProfileMenu, che è `hidden sm:block` (Layout.tsx:162): da mobile non c'è alcun modo di aprire il proprio profilo né di fare logout dalla top bar (resta solo il pulsante Esci dentro la sidebar hamburger). Inoltre le 4 voci della bottom nav non rispettano i ruoli: un contabile vede il tab 'Outlet' che la sidebar gli nasconde (roles di /outlet: super_advisor, ceo, coo).

**Proposta:** Puntare il tab 'Profilo' a `/profilo` (coerente con label e icona) e da lì linkare Impostazioni per chi ne ha i permessi; filtrare le voci della BottomNav con la stessa mappa ruoli della sidebar; aggiungere il logout nella pagina Profilo così è raggiungibile anche da mobile.

### M10. Selettore anno globale mostrato su pagine che lo ignorano completamente

**Dove:** `src/components/Layout.tsx:236` · **Categoria:** Usability

Il commento in Layout.tsx:231-236 riconosce che il selettore anni 'ingannava l'utente' sullo Scadenzario e lo nasconde SOLO lì (`hidePeriodSelector = path === '/scadenzario'`). Ma solo 13 pagine vive consumano usePeriod (grep: ContoEconomico, Dashboard, Outlet, Fornitori, ConfrontoOutlet, Dipendenti, ScenarioPlanning, TesoreriaManuale, Fatturazione, Produttivita, MarginiOutlet, CashflowProspettico, BudgetControl). Su Ticket, Impostazioni, ArchivioDocumenti, ImportHub, StoricoDistinte, ScadenzeFiscali, ReportSincronizzazioni, Profilo, AICategoriePage il selettore resta visibile ma cambiare anno non ha alcun effetto: la stessa trappola documentata, replicata su ~10 pagine.

**Proposta:** Invertire la logica: invece di una blacklist di un solo path, definire una whitelist dei path che usano usePeriod (o derivarla dal breadcrumb map con un flag `usesPeriod`) e mostrare il PeriodSelector solo lì. In alternativa, disabilitarlo visivamente con tooltip 'questa pagina non è filtrata per anno'.

### M11. Badge e pannello anomalie pagamento senza filtro company_id, difforme dal resto del codice

**Dove:** `src/components/Layout.tsx:290` · **Categoria:** Integrità dati

La query del badge 'Fatturazione' in Layout.tsx:289-293 conta le righe di `payment_import_anomalies` filtrando solo `eq('stato','aperta')`, e PaymentAnomaliesPanel.tsx:49-53 fa lo stesso per l'elenco: nessun filtro `company_id`. Tutto il resto del codice (es. GlobalSearch.tsx:115-119) filtra sempre esplicitamente per `company_id`. La protezione si affida solo alla RLS: per un super_advisor associato a più aziende (useCompany espone `companies` e `switchCompany`) il conteggio e l'elenco possono includere anomalie di un'azienda diversa da quella attiva, mostrando un badge rosso fuorviante e dati misti nel pannello.

**Proposta:** Aggiungere `.eq('company_id', profile.company_id)` a entrambe le query (Layout.tsx e PaymentAnomaliesPanel.tsx), come già fatto in GlobalSearch, e rigenerare i tipi database.ts per eliminare i cast `as unknown` che nascondono la mancanza del filtro.

### M12. NotificationBell: un errore di rete nel polling svuota silenziosamente le notifiche e le azioni ottimistiche non gestiscono i fallimenti

**Dove:** `src/components/NotificationBell.tsx:85` · **Categoria:** Logica

loadNotifications fa `const { data } = await supabase.from('notifications')...` ignorando `error` e poi `setNotifications((data as Notification[]) || [])`: se una delle chiamate del polling ogni 60s fallisce (rete, sessione), `data` è null e l'intero elenco più il badge vengono azzerati senza alcun messaggio — l'utente vede le notifiche "sparire" e poi ricomparire al poll successivo. Analogamente markRead (r.96), markAllRead (r.103) e dismiss (r.108) aggiornano lo stato locale senza verificare l'esito dell'UPDATE: se fallisce, una notifica eliminata ricompare entro 60 secondi, percepita come duplicata.

**Proposta:** In loadNotifications controllare `error` e, in caso di fallimento, mantenere lo stato precedente (early return) invece di azzerare. Nelle azioni markRead/markAllRead/dismiss verificare l'errore e in caso di fallimento fare rollback dello stato locale mostrando un toast. Valutare Supabase Realtime sul canale notifications al posto del polling fisso per ridurre latenza e carico.

### M13. OutletWizard in modifica forza sempre is_active=true: modificare un outlet chiuso lo riattiva

**Dove:** `src/components/OutletWizard.tsx:555` · **Categoria:** Logica

Il payload di handleSave include incondizionatamente `is_active: true` e ricalcola `bp_status` da opening_confirmed, sia in creazione sia in modifica (editId, riga 561-565). Se si apre in modifica un outlet chiuso (is_active=false) anche solo per correggere una nota, il salvataggio lo riattiva silenziosamente: rientra nei conteggi, nei filtri is_active=true di Dipendenti (riga 383) e nelle dashboard. Inoltre closing_date non è gestita dal wizard, quindi non si può nemmeno correggere.

**Proposta:** In modalità modifica, escludere is_active (e bp_status se non cambia opening_confirmed) dal payload di UPDATE, oppure precaricare il valore reale dell'outlet nel form. Aggiungere eventualmente la gestione esplicita di stato/chiusura nel wizard.

### M14. OutletWizard: un click sul backdrop chiude il wizard e perde tutti i dati inseriti

**Dove:** `src/components/OutletWizard.tsx:649` · **Categoria:** Usability

L'overlay del wizard ha `onClick={onClose}`: un click accidentale fuori dal modal (frequente durante la compilazione di 6-7 step con decine di campi contrattuali) chiude tutto senza conferma, e Outlet.tsx in onClose azzera initialData/allegati/file caricati (riga 2308). Anche i file allegati selezionati nello step Allegati vengono persi. Non c'è persistenza dello stato (localStorage o draft) né prompt 'Hai modifiche non salvate'.

**Proposta:** Rimuovere la chiusura al click sul backdrop (o chiedere conferma se il form è 'dirty'), e intercettare anche il bottone X con lo stesso check. Valutare il salvataggio bozza dello stato del form in sessionStorage per sopravvivere a chiusure accidentali.

### M15. Quote Uguali salvate come percentuali statiche arrotondate: non sommano a 100% e non sono dinamiche

**Dove:** `src/components/SupplierAllocationEditor.tsx:286` · **Categoria:** Logica

Per QUOTE_UGUALI il salvataggio materializza `pctEach = parseFloat((100 / selected.length).toFixed(2))` per ogni outlet (righe 284-292): con 3 outlet si scrivono 33.33+33.33+33.33 = 99.99% (0,01% di costo perso a ogni allocazione), con 7 outlet 14.29×7 = 100.03% (sovra-allocazione). Inoltre la specifica in CLAUDE.md definisce QUOTE_UGUALI come 'dinamico: se cambiano gli outlet, cambia la quota', ma salvando percentuali fisse sugli outlet selezionati al momento, l'aggiunta/disattivazione di un outlet non riequilibra nulla. Nota: la validazione SPLIT_PCT richiede tolleranza 0.01 sul 100% (riga 202), quindi gli stessi 33.33×3 sarebbero rifiutati se inseriti a mano — incoerenza interna.

**Proposta:** Per QUOTE_UGUALI non materializzare percentuali: salvare i dettagli con percentage NULL (o un flag) e far calcolare la quota 100/n a runtime dal motore di allocazione sugli outlet attivi selezionati. In alternativa minima: assegnare la differenza di arrotondamento all'ultimo outlet (33.33/33.33/33.34) per garantire somma esattamente 100.

### M16. Righe tabella cliccabili solo col mouse e tooltip solo hover: inaccessibili da tastiera

**Dove:** `src/components/Tooltip.tsx:56` · **Categoria:** Accessibilità

Il Tooltip condiviso aggancia solo onMouseEnter/onMouseLeave (righe 56-63): niente onFocus/onBlur né aria-describedby, quindi i contenuti troncati (causali, ragioni sociali, numeri fattura) sono irraggiungibili da tastiera e invisibili agli screen reader — e il componente sostituisce per design i title nativi in tutta l'app. Analogamente le righe di tabella con azione primaria su onClick del <tr> (Fatturazione.tsx righe 512 e 754, apertura fattura/slide-over) non hanno tabIndex, role='button' né gestione di Enter/Space: chi naviga da tastiera non può aprire il dettaglio se non tramite il piccolo bottone-icona.

**Proposta:** In Tooltip clonare anche onFocus/onBlur (mostrare/nascondere) e impostare aria-describedby sull'elemento figlio quando visibile. Per le righe cliccabili: tabIndex=0, role='button' (o meglio un vero <button>/<a> sulla cella principale), gestione onKeyDown per Enter/Space e focus ring visibile.

### M17. UI kit condiviso quasi tutto inutilizzato: 7+ KpiCard locali duplicate con API divergenti

**Dove:** `src/components/ui/KpiCard.tsx:46` · **Categoria:** UX

src/components/ui/ espone KpiCard, Breadcrumb, LoadingSkeleton, StatusBadge, SortableTh, ma grep mostra che ui/KpiCard, ui/Breadcrumb e ui/LoadingSkeleton non sono importati da NESSUNA pagina. In compenso esistono almeno 7 implementazioni locali di KpiCard con prop incompatibili: Dashboard.tsx:54 (title/subtitle/trend numerico/link/helpTerm), Fatturazione.tsx:90 e Fornitori.tsx:1631 (label/sub), TesoreriaManuale.tsx:406, ArchivioDocumenti.tsx:1153, più le copie nei file morti Banche.tsx:40 e Contratti.tsx:35. Anche EmptyState è duplicato: TesoreriaManuale.tsx:433 ridefinisce una versione locale diversa da components/EmptyState.tsx (che usa indigo-600 mentre il resto dell'app usa blue-600). Ogni card ha spaziature, colori e comportamenti leggermente diversi tra pagine.

**Proposta:** Scegliere una KpiCard canonica (quella di Dashboard è la più completa), spostarla in src/components/ui/ e migrare le pagine una alla volta; eliminare ui/KpiCard, ui/Breadcrumb e ui/LoadingSkeleton se si decide che non servono (ora sono codice morto che confonde). Rimuovere l'EmptyState locale di TesoreriaManuale a favore di components/EmptyState, allineando il colore del bottone a blue-600.

### M18. Ordinamento tabelle impossibile da tastiera e label dei form non associate agli input in tutta l'app

**Dove:** `src/components/ui/SortableTh.tsx:49` · **Categoria:** Accessibilità

SortableTh, componente condiviso usato dalle tabelle di tutta l'app, mette onClick direttamente sul <th> (riga 49-55): nessun <button>, nessun tabIndex, nessun onKeyDown, nessun aria-sort — l'ordinamento è irraggiungibile da tastiera e invisibile agli screen reader (l'unico hint è un title al passaggio del mouse; l'indice di sort multiplo è un testo da 9px, riga 60). Stesso pattern trasversale sui form: nel codebase ci sono 281 <label> ma solo 2 htmlFor — es. Fornitori.tsx righe 1439-1488, dove ogni label è un semplice testo sopra l'input, quindi screen reader annunciano input anonimi e il click sulla label non porta il focus nel campo.

**Proposta:** In SortableTh racchiudere il contenuto in un <button type="button"> con aria-label descrittivo e impostare aria-sort={'ascending'|'descending'} sul th attivo. Per i form, aggiungere id agli input e htmlFor alle label (o avvolgere l'input dentro la label); creare un piccolo componente Field in ui/ per rendere il pattern automatico.

### M19. Fallimento fetch del profilo utente: app bloccata su spinner infinito senza messaggio

**Dove:** `src/hooks/useAuth.tsx:71` · **Categoria:** Usability

In useAuth.fetchProfile (righe 64-76) l'errore è ingoiato: `if (!error && data) { setProfile(...) } ; setLoading(false)`. Se la SELECT su user_profiles fallisce (rete instabile, RLS), l'utente ha una sessione valida ma profile=null per sempre: nessun retry, nessuno stato di errore. A valle, tutte le pagine fanno `const COMPANY_ID = profile?.company_id` e `if (!COMPANY_ID) return` nel useEffect (es. Dashboard.tsx:143, 173-174) lasciando `loading=true` iniziale mai risolto → spinner 'Caricamento cruscotto...' (riga 605) infinito, su tutte le pagine, finché l'utente non ricarica a mano. Analogamente useCompany.tsx:58 (`if (!error && data)`) ignora l'errore di loadCompanies lasciando company=null in silenzio.

**Proposta:** In fetchProfile: su errore salvare uno state `profileError`, esporlo dal context e mostrarlo in Layout con un pulsante 'Riprova' (o retry automatico con backoff 2-3 tentativi). Le pagine dovrebbero distinguere 'profilo in caricamento' da 'profilo fallito' invece di restare in loading indefinito.

### M20. useCompany: errori silenziosi e fallback alla prima azienda disponibile senza avviso

**Dove:** `src/hooks/useCompany.tsx:70` · **Categoria:** Logica

In loadCompanies l'errore è ignorato (`if (!error && data)`, riga 58): se la query fallisce, company resta null e companies vuoto senza alcun feedback, con tutte le pagine downstream in stato indefinito. Peggio, a riga 70 `const current = normalized.find(c => c.id === profile!.company_id) || normalized[0]`: se il company_id del profilo non corrisponde a nessuna azienda visibile (profilo disallineato, RLS parziale), l'app seleziona SILENZIOSAMENTE la prima azienda della lista — l'utente vede e opera sui dati di un'azienda diversa da quella del suo profilo, senza saperlo. Anche switchCompany (righe 82-91) non gestisce l'errore dell'update: in caso di fallimento non succede nulla, nessun toast.

**Proposta:** Esporre `error` dal context e mostrarlo; nel fallback normalized[0] loggare un warning e mostrare un banner ('Il profilo puntava a un\'azienda non accessibile, è stata selezionata X') o aggiornare il profilo per riallinearlo. In switchCompany mostrare un toast d'errore se l'update fallisce.

### M21. usePeriod: il periodo (trimestre/mese) viene salvato in localStorage ma mai ripristinato

**Dove:** `src/hooks/usePeriod.tsx:59` · **Categoria:** Usability

updateQuarter scrive `localStorage.setItem('nz_period_quarter', q)` (riga 59), ma nessun punto del codice legge quella chiave (grep su tutto src/ trova solo la scrittura): lo state parte sempre da `useState('year')` (riga 46). Risultato incoerente per l'utente: l'anno selezionato sopravvive a reload e navigazione (catena URL → localStorage → default, righe 41-44), mentre il trimestre/mese selezionato si perde a ogni refresh e non è nemmeno nell'URL, quindi un link condiviso con ?anno=2025 apre sempre 'Anno intero' anche se si stava guardando Q3. La persistenza scritta è di fatto codice morto.

**Proposta:** Allineare quarter allo stesso meccanismo dell'anno: parametro URL `?periodo=` come fonte di verità con fallback su localStorage ('nz_period_quarter') e default 'year', validando il valore contro i formati ammessi (year/ytd/q1-q4/m01-m12).

### M22. Analytics POS: il toggle 'Annuale/Mensile' non fa nulla, ma la guida lo promette

**Dove:** `src/pages/AnalyticsPOS.tsx:239` · **Categoria:** Usability

viewMode ('annual'|'month') è persistito in URL e cambia solo lo stile dei due bottoni (righe 345-365): nessun grafico, KPI o tabella lo usa — cliccare «Mensile» non cambia nulla nella pagina. La guida utente (src/data/pageGuides.ts, riga 1021) però dichiara che si può «passare tra visualizzazione Annuale e Mensile», violando la regola di progetto guida=codice. In più i dati simulati usano Math.random a ogni mount (righe 89-94): a ogni visita l'utente vede numeri e «Miglior/Peggior Performer» diversi, e i titoli hardcodano «Anno 2026» (righe 313, 377).

**Proposta:** Implementare davvero la vista mensile (selettore mese che filtra chartData/KPI) oppure rimuovere il toggle e correggere la voce in pageGuides.ts nello stesso commit. Rendere deterministica la simulazione (seed fisso per outlet) e derivare l'anno mostrato dalla data corrente o dal PeriodContext.

### M23. Analytics POS: solo 6 gradienti definiti, le barre dal 7° outlet in poi non si vedono

**Dove:** `src/pages/AnalyticsPOS.tsx:527` · **Categoria:** Logica

Il bar chart 'Numero Scontrini' assegna a ogni outlet `grad-scontrini-${idx+1}` (righe 526-532), ma i <linearGradient> definiti sono solo 6 (grad-scontrini-1..6, righe 496-519). Il tenant NZ ha 7 outlet (dato documentato in CLAUDE.md): la settima serie usa fill="url(#grad-scontrini-7)", riferimento inesistente, quindi le barre del 7° outlet risultano nere o invisibili in produzione. Il pie chart ha lo stesso pattern con 5 gradienti su 5 fasce (lì combacia solo perché le fasce sono fisse).

**Proposta:** Generare i gradienti dinamicamente dal COLOR_POOL (un <linearGradient> per outlet, con id derivato dall'indice modulo pool) oppure usare direttamente `fill={outlet.color}` come già fatto nel line chart, eliminando la dipendenza da id hardcoded.

### M24. Download EC fallback: con filename vuoto scarica il primo file arbitrario del bucket

**Dove:** `src/pages/ArchivioDocumenti.tsx:521` · **Categoria:** Logica

In `downloadEcFile`, quando `file_path` manca, il fallback cerca nel bucket con `(f.name || '').toLowerCase().includes(target.replace(/\.(xls|xlsx|csv)$/i, ''))` (riga 521). Se `ec.filename` è null/vuoto (caso reale: il commento alle righe 370-380 spiega che bank_statements e bank_imports non si matchano sempre), `target` diventa stringa vuota e `.includes('')` è true per QUALSIASI file: viene scaricato il primo file del bucket, che può appartenere a un altro conto o periodo. L'utente riceve un estratto conto sbagliato convinto che sia quello richiesto.

**Proposta:** Guardia esplicita: se `ec.filename` è vuoto (o il termine di ricerca dopo il replace è più corto di qualche carattere), mostrare subito "File originale non trovato" invece di eseguire la ricerca. In più, limitare il match ai file dello stesso `bank_account_id` quando disponibile.

### M25. 6 file pagina morti con nomi ingannevoli rispetto alle route reali

**Dove:** `src/pages/Banche.tsx:1` · **Categoria:** Logica · *segnalato indipendentemente da 2 auditor*

src/pages/Banche.tsx (2.660 righe), Scadenzario.tsx (1.535), Contratti.tsx (750) e Importazioni.tsx non sono raggiungibili da nessuna rotta di App.tsx (la rotta /banche carica TesoreriaManuale, /scadenzario carica ScadenzarioSmart) e non sono importate da altre pagine (verificato con grep; solo PrimaNota è riusata come tab). Contengono però logica di scrittura ormai divergente dal flusso vivo (es. Banche.tsx usa applyReconciliation client-side che chiude le fatture per intero, window.confirm alle righe 1463/2392, ecc.): se qualcuno le ricollega per errore o le usa come riferimento durante una modifica, reintroduce bug già corretti. Tengono inoltre in vita import fuorvianti (reconciliationEngine appare 'usato' più di quanto sia).

**Proposta:** Eliminare le quattro pagine morte (o spostarle in una cartella legacy/ esclusa da tsconfig) in una PR dedicata di sola rimozione con [skip-guide-check], così il codice sorgente riflette solo i flussi realmente in produzione.

### M26. Query senza filtro company_id in Banche.tsx (pagina peraltro non instradata)

**Dove:** `src/pages/Banche.tsx:2309` · **Categoria:** Sicurezza

In `loadData` le query `supabase.from('bank_transactions').select('*')...` (riga 2309) e `supabase.from('payable_actions').select('*')...` (riga 2310) non filtrano per company_id; anche `handleSaveAccount` (riga 2370) e `handleDeleteAccount` (riga 2394) fanno update per solo id senza scope tenant. Viola la regola di progetto 'ogni query filtra per company_id dal JWT': oggi salva solo la RLS, ma il file è una seconda implementazione completa della pagina Banche NON instradata (App.tsx riga 14 mappa /banche su TesoreriaManuale), quindi è dead code di 2.660 righe che qualcuno potrebbe ricollegare o copiare con la falla inclusa. Contiene anche un import CSV (riga 1194) che inserisce bank_transactions senza company_id.

**Proposta:** Eliminare src/pages/Banche.tsx (e src/pages/CashFlow.tsx, anch'esso non instradato) oppure, se va conservato, aggiungere `.eq('company_id', COMPANY_ID)` a tutte le query/update/insert prima di qualunque riuso.

### M27. CashFlow.tsx: crash garantito su mount (weeklyData[0] su array vuoto) in pagina dead-code

**Dove:** `src/pages/CashFlow.tsx:321` · **Categoria:** Logica

Il useMemo `kpis` legge `weeklyData[0].saldo_iniziale` senza guardia: durante il primo render `loading=true` fa restituire `[]` a weeklyData (riga 254), quindi `weeklyData[0]` è undefined e il componente lancia TypeError a ogni mount, prima ancora del ramo `if (loading)`. Il file non è instradato (App.tsx riga 23 mappa /cash-flow su CashflowProspettico), quindi oggi nessuno lo vede, ma resta nel repo come pagina 'gemella' con altri difetti latenti: i costi fissi sono sempre 0 (righe 124-130 inizializzano `costsByGroup[macro_group]=0` senza mai sommare importi) e la 'linea rossa 50k' è un `<line>` SVG raw con coordinate pixel che non renderizza il valore dati (riga 572, ReferenceLine importato ma non usato).

**Proposta:** Eliminare src/pages/CashFlow.tsx dal repo (è superseded da CashflowProspettico). Se invece va recuperato: guardia `if (weeklyData.length === 0) return {...default}` nel useMemo, somma reale dei costi fissi e `<ReferenceLine y={50000}/>`.

### M28. Cashflow settimanale: doppio conteggio dei giorni già trascorsi della settimana corrente

**Dove:** `src/pages/CashflowProspettico.tsx:1077` · **Categoria:** Logica

La vista settimanale parte dal lunedì della settimana corrente (`getWeekStart(today)`, riga 1077) ma il saldo cumulato parte da `initialBalance` (riga 1082), che è la cassa reale di OGGI (v_cash_position). Entrate (daily_revenue) e uscite (payables) dei giorni già trascorsi da lunedì a ieri vengono quindi risommate a un saldo che le include già: fino a 6 giorni di flussi contati due volte nella prima settimana, con saldo progressivo distorto per tutte le 13 settimane. La vista giornaliera non ha il problema perché parte da oggi (riga 917).

**Proposta:** Far partire l'accumulo del saldo da oggi: iterare i giorni della prima settimana solo da `today` in poi (o mostrare la prima settimana come parziale 'da oggi'), mantenendo l'etichetta della settimana intera.

### M29. Vista Scostamento: 'p.p.' di merci e servizi calcolati come delta€/delta€ (numero senza senso)

**Dove:** `src/pages/ConfrontoOutlet.tsx:220` · **Categoria:** Logica

In modalità variance i sub delle KpiBadge "Δ Acquisto merci" e "Δ Costo per servizi" calcolano `(ricavi ? merci / ricavi * 100 : 0)` dove sia merci sia ricavi sono DELTA (consuntivo − preventivo), etichettando il risultato "p.p." (righe 219-220 e 235). Dividere il delta merci per il delta ricavi non è una variazione in punti percentuali: con delta ricavi piccolo (es. +100 €) e delta merci +50 € appare "+50.0 p.p.". Per personale e affitto invece il calcolo è corretto (differenza tra incidenze, righe 963-969). Incoerenza interna alla stessa card.

**Proposta:** Calcolare anche per merci e servizi il delta di incidenza come per personale/affitto: (merci_actual/ricavi_actual − merci_budget/ricavi_budget) × 100, riusando i valori actual/budget già disponibili in calcMetrics.

### M30. ConfrontoOutlet: due 'quote sede' diverse, una con cost_center hardcoded — l'export non coincide con la UI

**Dove:** `src/pages/ConfrontoOutlet.tsx:739` · **Categoria:** Logica · *segnalato indipendentemente da 2 auditor*

Coesistono due logiche di quota sede: (1) quotaSedePerOutlet (righe 736-746), split in parti uguali basato su cost_center hardcoded 'sede' | 'sede_magazzino' | 'all'; (2) nettoSede/sedeQuota (righe 750-762 e 1048-1059), pro-quota sul fatturato basato su cost_centers.role='hq' (il metodo corretto, «no hardcoded»). Le card mostrano quotaSedePro (pro-quota), ma sia exportExcel (riga 1119: m.quotaSede) sia ExportMenu (riga 1217: quota_sede: m.quotaSede) esportano il valore della logica legacy: l'Excel consegnato a Lilian/Patrizio riporta una «Quota sede» diversa da quella visualizzata a schermo. Inoltre i nomi hardcoded 'sede'/'sede_magazzino' non valgono per Made/Zago se i loro cost_center hq hanno codici diversi → quota legacy = 0 o sbagliata su quei tenant, violando la parità multi-tenant.

**Proposta:** Unificare sul calcolo pro-quota via role='hq': esportare quotaSedePro/margineFinale al posto di quotaSede e rimuovere quotaSedePerOutlet (o derivarla dagli stessi hqCodes). Aggiornare intestazioni export per chiarire il criterio di ripartizione.

### M31. Trend Conto Economico: dipendenze useEffect incomplete, dati stantii o vuoti

**Dove:** `src/pages/ContoEconomico.tsx:688` · **Categoria:** Logica

`useEffect(() => { if (showTrend) loadTrendData() }, [showTrend, periodType])` non include `availableYears` (né COMPANY_ID) tra le dipendenze, ma loadTrendData (riga 835-845) legge `availableYears` dalla closure: se l'utente attiva il trend prima che loadAvailableYears abbia risposto (sono fetch parallele lanciate dallo stesso mount, righe 676-685), il trend viene calcolato con il solo anno corrente e NON si ricalcola quando gli anni reali arrivano. Il toggle resta attivo con un grafico vuoto/incompleto finché non si spegne e riaccende a mano.

**Proposta:** Aggiungere `availableYears` (e COMPANY_ID) alle dipendenze dell'effetto, oppure far restituire gli anni da loadAvailableYears e passarli come parametro a loadTrendData, così il trend si ricalcola appena la lista anni è disponibile.

### M32. Vista Cassa: breakdown per categoria basato su cost_category_id che è sempre NULL

**Dove:** `src/pages/ContoEconomico.tsx:916` · **Categoria:** Logica

loadCashData conta come "categorizzati" i movimenti con `row.cost_category_id` (righe 877, 916-922) e mostra il pie per categoria solo se ≥10% lo sono (riga 946). Ma la Dashboard documenta esplicitamente che nella vista cash_movements "le colonne cost_category_id/ai_category_id sono SEMPRE NULL (non sono dati reali)" e che il campo reale è `category` (Dashboard.tsx righe 523-526, dove infatti si usa `.is('category', null)`). Risultato: in Conto Economico → Cassa il dettaglio per categoria non comparirà mai e il banner "Categorizza i movimenti bancari" resta visibile anche quando l'utente ha categorizzato tutto, contraddicendo l'alert della Dashboard che invece si azzera.

**Proposta:** Allineare loadCashData al campo reale: aggregare su `category` (stringa) come fa la Dashboard, oppure correggere la vista cash_movements a monte perché popoli cost_category_id; in ogni caso le due pagine devono usare lo stesso criterio di 'categorizzato'.

### M33. ContoEconomico: classificazione ricavi per prefisso '5' e assegnazione (non somma) dei mesi in budget_confronto

**Dove:** `src/pages/ContoEconomico.tsx:1186` · **Categoria:** Logica

loadBudgetSummary classifica i ricavi con `ac.startsWith('5')` (righe 1113, 1127, 1185) mentre ConfrontoOutlet/Dashboard-ranking usano chart_of_accounts.is_revenue (regola dichiarata in outletRevenue.ts: "SEMPRE via is_revenue, MAI prefissi"): un conto ricavo che non inizia per 5 (o un costo che inizia per 5) produce totali diversi tra ContoEconomico e le altre pagine. Inoltre le matrici mensili usano ASSEGNAZIONE `ensure(revM, key)[m-1] = amt` invece di accumulo `+=` (righe 1186-1190): con più righe budget_confronto per stessa (cost_center, conto, mese, entry_type) vince l'ultima e le altre vengono perse, mentre buildOutletRevenue somma (outletRevenue.ts riga 54). Infine `ricaviConsSum += c > 0 ? c : p` (riga 1203) tratta un consuntivo reale pari a 0 o negativo come assente e ripiega sul preventivo, gonfiando il consuntivo.

**Proposta:** Riusare buildOutletRevenue/outletRevenueMetrics (modulo condiviso) anche in loadBudgetSummary, passando i revenueCodes da chart_of_accounts.is_revenue; in ogni caso accumulare con += e usare il criterio `c != null` (presenza del dato) invece di `c > 0` come fa il modulo condiviso.

### M34. Eliminazione documenti contratto senza conferma: un click accidentale cancella il PDF in modo permanente

**Dove:** `src/pages/Contratti.tsx:365` · **Categoria:** Integrità dati

`PdfUploader.handleRemove` (righe 365-371) rimuove il file dal bucket `contract-documents` E cancella il record da `contract_documents` immediatamente al click sull'icona X, senza alcuna finestra di conferma e senza gestione errori. Il bottone di rimozione (riga 400) è adiacente a quello di anteprima: un click sbagliato distrugge irreversibilmente il contratto firmato archiviato. È in contrasto con la regola granitica NO DATA LOSS del progetto; per confronto, ImportHub chiede `window.confirm` prima di ogni delete (riga 501).

**Proposta:** Aggiungere `if (!window.confirm('Eliminare definitivamente questo documento?')) return` prima della rimozione (come già fa ImportHub.handleRemoveFile) e mostrare un feedback in caso di errore. Valutare in prospettiva un soft-delete (flag is_deleted) per i documenti contrattuali, coerente con la regola no-data-loss.

### M35. Query senza filtro company_id: contracts, import_batches, sync_runs e outlets si affidano solo alla RLS

**Dove:** `src/pages/Contratti.tsx:508` · **Categoria:** Sicurezza

Diverse query in quest'area non filtrano per company_id, in violazione della regola di progetto "company_id isolation — ogni query filtra per company_id dal JWT": Contratti.tsx riga 508 (`supabase.from('contracts').select('*')` senza `.eq('company_id', ...)`) e riga 509 (outlets); Importazioni.tsx riga 54 (outlets) e righe 262-266 (`import_batches`); ReportSincronizzazioni.tsx righe 211-218 (`sync_runs`) e 241-243 (`bank_accounts`). Per confronto, ImportHub e ArchivioDocumenti filtrano sempre per COMPANY_ID. Se una policy RLS venisse allentata o un utente avesse accesso a più company, queste pagine mostrerebbero/aggregherebbero dati di tenant diversi (i KPI di Contratti sommerebbero canoni di più aziende).

**Proposta:** Aggiungere `.eq('company_id', profile.company_id)` a tutte le query elencate (contracts, outlets, import_batches, sync_runs, bank_accounts), mantenendo la RLS come seconda linea di difesa e non come unica. È un pattern già usato correttamente in ImportHub.loadBankAccounts/loadOutlets.

### M36. Convertitore XML: aliquota IVA fissa 22% anche quando i numeri implicano un'altra aliquota

**Dove:** `src/pages/ConvertitoreFattureXML.tsx:232` · **Categoria:** Logica

buildXml scrive sempre `<AliquotaIVA>22.00</AliquotaIVA>` sia nel DettaglioLinee sia nei DatiRiepilogo (righe 232-233), usando però Imponibile e Imposta reali presi dall'export. Per una fattura con IVA al 10% o 4% (o esente) l'XML dichiara un'aliquota incoerente con Imposta/Imponibile: il controllo 'quadra' (riga 423) verifica solo imponibile+imposta=totale, non che imposta ≈ imponibile×22%. Il file può quindi essere scartato o segnalato in AdE, e la nota a piè di pagina (riga 722) lo documenta come limite ma la UI non avvisa sulle righe specifiche in cui l'aliquota implicita non è 22%.

**Proposta:** Calcolare l'aliquota implicita (imposta/imponibile×100), arrotondarla alle aliquote italiane valide (22, 10, 5, 4, 0) e scriverla nell'XML; se non corrisponde a nessuna aliquota nota (o imponibile=0 con imposta>0), evidenziare la riga nel riepilogo con warning dedicato invece di generare comunque un XML con 22% fisso.

### M37. Archivio del convertitore scarica fino a 2000 XML completi solo per mostrare l'elenco

**Dove:** `src/pages/ConvertitoreFattureXML.tsx:291` · **Categoria:** Performance

loadArchive seleziona anche xml_content per 2000 righe (righe 289-294) a ogni apertura della pagina e a ogni refresh dell'archivio, solo per renderizzare una lista di nomi file e importi: con XML di ~2KB l'app trasferisce e tiene in memoria diversi MB inutili, che crescono a ogni generazione mensile. Il problema era già stato riconosciuto e risolto correttamente in Fatturazione.tsx (righe 240-252 e 269-272: vista v_electronic_invoices_list senza xml_content + fetch on-demand per singolo id), ma qui il pattern pesante è rimasto.

**Proposta:** Escludere xml_content dalla select dell'elenco e scaricarlo on-demand: per il singolo download una select('xml_content').eq('id', ...) e per lo zip di batch una select filtrata per batch_id al momento del click, replicando il pattern già adottato in Fatturazione.tsx.

### M38. Query inutili e senza limite: daily_revenue e staffCosts mai renderizzati, balance_sheet_data mai letta

**Dove:** `src/pages/Dashboard.tsx:538` · **Categoria:** Performance

La Dashboard scarica TUTTA daily_revenue (`select('outlet_id, gross_revenue, date, outlets(name)')` ordinata desc, senza .limit, righe 538-542) per popolare `dailyRevenue`, che non è mai usato nel render (solo dichiarazione a riga 164 e setter a 554). Anche `staffCosts` (riga 154/228) è settato e mai letto. In ConfrontoOutlet `balanceData` viene caricata con `select('*')` su balance_sheet_data per l'anno (righe 625-629) ma è usata solo come dipendenza di useMemo, mai nei calcoli. Con la crescita dei dati (regola: "costruisci per 1.000 aziende") sono round-trip ed egress sprecati a ogni cambio periodo.

**Proposta:** Rimuovere le query e gli state morti (dailyRevenue, staffCosts, balanceData) oppure, se daily_revenue serve per una feature futura, limitarla (es. `.limit(numero outlet)` con distinct on outlet lato vista). Ogni query rimasta dovrebbe avere un consumatore reale nel render.

### M39. Dashboard e ConfrontoOutlet: errori di fetch silenziati, mostrati come zeri o come 'nessun dato'

**Dove:** `src/pages/Dashboard.tsx:563` · **Categoria:** Usability

In Dashboard tutti i blocchi hanno `catch (e) {}` vuoti (righe 302, 315, 453, 462, 504, 521, 534, 559) e il catch finale (563-566) fa solo console.error: se Supabase fallisce, la pagina esce dal loading e mostra ricavi 0, liquidità 0,00 €, "Nessuna segnalazione — tutto sotto controllo", indistinguibili da dati reali a zero — pericoloso su un cruscotto direzionale. In ConfrontoOutlet un errore in loadData (righe 721-725) lascia hasData=false e mostra l'empty state "Nessun dato disponibile... Carica i dati dal Budget", che spinge l'utente ad azioni sbagliate quando il problema è di rete/permessi.

**Proposta:** Introdurre uno stato `error` per pagina: su eccezione mostrare un banner "Impossibile caricare i dati — riprova" con bottone retry, distinto dall'empty state; loggare l'errore ma non presentare mai zeri come dati validi.

### M40. Fatture passive: scarica sempre TUTTE le fatture di tutti gli anni e filtra client-side

**Dove:** `src/pages/Fatturazione.tsx:274` · **Categoria:** Performance

loadInvoices fa select('*') su v_electronic_invoices_list senza filtro anno né colonne specifiche (righe 274-279) e il filtro anno avviene solo client-side (righe 369-372). Con il pull A-Cube ogni 6 ore su 3 tenant il volume cresce indefinitamente: ogni apertura della tab riscarica l'intero storico solo per mostrare l'anno corrente. Il conteggio badge della stessa pagina usa già correttamente il count exact head:true filtrato per anno (righe 1280-1285): due strategie diverse per lo stesso dato, con la più pesante usata per la lista.

**Proposta:** Applicare il filtro anno lato server (gte/lte su invoice_date, come già fa loadInvoiceCounts) e selezionare solo le colonne mostrate; ricaricare al cambio di yearFilter. Per «Tutti gli anni» usare paginazione.

### M41. Errori di caricamento dati silenziosi: l'utente vede lo stato vuoto invece dell'errore

**Dove:** `src/pages/Fatturazione.tsx:282` · **Categoria:** Usability

In FatturePassive il catch di loadInvoices fa solo console.error (righe 281-284): se la query fallisce (rete, RLS, timeout) la tabella mostra «Nessuna fattura trovata» (riga 510) e i KPI valgono 0 — indistinguibile da un archivio realmente vuoto, su una pagina fiscale dove «0 fatture» è un'informazione che l'utente può prendere per vera. Stesso pattern in FattureAttive (riga 607), Corrispettivi (riga 1016), ConfrontoOutlet.tsx (righe 721-722, «Nessun dato disponibile») e ScadenzarioSmart.tsx (riga 854). PrimaNota.tsx invece gestisce correttamente lo stato error (righe 142-148, 288-292) e può fare da modello.

**Proposta:** Aggiungere uno stato error alle pagine elencate e mostrare un banner «Errore caricamento: … » con bottone Riprova (pattern già presente in PrimaNota), distinto dall'empty state. In alternativa usare il toast globale già disponibile (useToast) nel catch.

### M42. P.IVA fornitore senza validazione né controllo duplicati, nonostante l'aggancio fattura↔fornitore avvenga per P.IVA (e Zod dichiarato nelle regole è assente)

**Dove:** `src/pages/Fornitori.tsx:623` · **Categoria:** Integrità dati

handleSave salva partita_iva/vat_number con un semplice trim (righe 623-624) senza alcuna validazione di formato (11 cifre) né checksum, e senza verificare l'esistenza di un altro fornitore con la stessa P.IVA. Le regole di progetto (PAYMENT_PLAN_NOTES) stabiliscono che l'aggancio fornitore↔fattura elettronica avviene PER P.IVA: una P.IVA con un typo lascia le fatture del fornitore non agganciate, e due fornitori con la stessa P.IVA rendono ambiguo il bridge A-Cube. Più in generale, CLAUDE.md richiede 'Zod schema su ogni input utente', ma zod non è nemmeno tra le dipendenze del progetto (0 occorrenze in package.json e in src/): tutta la validazione form è manuale e disomogenea.

**Proposta:** Alla submit: normalizzare la P.IVA (solo cifre), validare lunghezza 11 e checksum (algoritmo Luhn-like italiano), e fare una SELECT per P.IVA sul tenant per avvisare in caso di duplicato ('esiste già FORNITORE X con questa P.IVA — vuoi aprirlo?'). Valutare l'introduzione di zod con schemi condivisi per i form principali (fornitori, scadenze, costi ricorrenti), come già previsto dalle regole di progetto.

### M43. ImportHub: nessun rilevamento duplicati al caricamento — lo stesso estratto conto può essere caricato e processato due volte senza avviso

**Dove:** `src/pages/ImportHub.tsx:395` · **Categoria:** Integrità dati

`handleFileUpload` (righe 395-482) genera sempre un path univoco con timestamp (`${ts}_${safeName}`, riga 399) e non confronta mai `file.name` con i file già presenti in `uploadedFiles` o `import_documents`: ricaricare per errore lo stesso EC o lo stesso XML fatture non produce alcun warning. Combinato con l'insert non idempotente di `cash_movements` (importEngine.ts riga 413), processare il doppione raddoppia i movimenti bancari. Il KPI "Duplicati Trovati" della tab Panoramica (righe 857-864) rileva i duplicati solo a posteriori, come statistica, quando ormai il danno è fatto.

**Proposta:** In `validateFile` o all'inizio di `handleFileUpload`, confrontare nome file (ed eventualmente dimensione) con i record esistenti della stessa fonte e chiedere conferma esplicita: "Un file con lo stesso nome è già stato caricato il <data>. Vuoi caricarlo comunque?". Per una protezione robusta, salvare un hash del contenuto in `import_documents` e bloccare i contenuti identici.

### M44. "Processa tutti": il risultato di ogni file sovrascrive il precedente — gli errori dei primi file spariscono

**Dove:** `src/pages/ImportHub.tsx:684` · **Categoria:** Usability

`handleProcessAll` (righe 674-687) esegue `handleProcessFile(f)` in sequenza, e ogni chiamata fa `setProcessResult(...)` (riga 636) sovrascrivendo il pannello risultato del file precedente. Con 5 file di cui il secondo fallisce, alla fine resta visibile solo l'esito dell'ultimo: gli errori intermedi sono visibili solo per pochi istanti durante l'elaborazione e nessun riepilogo aggregato viene mostrato. Anche il toast per-file (riga 639) viene rimpiazzato ogni 3 secondi. Un errore parziale in un batch passa quindi inosservato.

**Proposta:** In handleProcessAll accumulare gli esiti per file (nome, imported, errori) in un array e al termine mostrare un pannello riepilogo aggregato: "Elaborati X file: Y ok, Z con errori" con il dettaglio espandibile per i file falliti, invece di affidarsi al processResult dell'ultimo file.

### M45. Feedback incoerente: toast custom bottom-right in Impostazioni e window.confirm nativo in 9 file

**Dove:** `src/pages/Impostazioni.tsx:25` · **Categoria:** Usability

Impostazioni.tsx:25-35 implementa un proprio ToastBar (posizione bottom-right, verde/rosso pieno, durata 3s, senza pulsante di chiusura) invece di usare il ToastProvider globale (top-center, glassmorphism, 10s, dismissibile) già montato in App.tsx:157. L'utente riceve feedback in due posti e stili diversi a seconda della pagina. Analogamente le conferme distruttive sono miste: ScadenzarioSmart.tsx:4107 ha un modale di conferma custom ('sostituisce confirm() nativo'), ma Fornitori.tsx:675 (`window.confirm('Disattivare questo fornitore?')`), ConvertitoreFattureXML, ImportHub, RevisionePagamenti, CashflowProspettico, ScadenzeFiscali, AICategorization e OutletValutazione usano ancora il confirm() nativo del browser, che su mobile è particolarmente povero.

**Proposta:** Sostituire ToastBar di Impostazioni con `useToast()` (il provider è già disponibile). Estrarre il modale di conferma di ScadenzarioSmart in un componente condiviso `ConfirmDialog` (o hook `useConfirm`) e migrare i 9 usi di window.confirm, dando priorità alle azioni distruttive su dati vivi (disattivazione fornitore, eliminazioni in ImportHub).

### M46. Colori dei centri di costo hardcoded sui nomi outlet di NZ (viola la parità tenant)

**Dove:** `src/pages/Impostazioni.tsx:77` · **Categoria:** UX

getCentroColor mappa colori su codici hardcoded specifici del tenant NZ ('valdichiana', 'barberino', 'palmanova', 'franciacorta', 'brugnato', 'valmontone', 'torino', 'sede_magazzino'): su Made e Zago tutti i centri cadono nel fallback bg-slate-500 (badge indistinguibili), violando la regola di progetto 'mai valori hardcoded specifici di un tenant'. È incoerente con il resto della stessa pagina, dove CentriDiCostoSection salva già cost_centers.color in DB (riga 1119) e lo usa per il pallino (riga 1256) — la colonna esiste ma getCentroColor la ignora. Analogamente il box info SDI hardcoda l'intermediario 'EPPI S.R.L.' (riga 1576) per tutti i tenant.

**Proposta:** Far leggere il colore da cost_centers.color (già caricato in costCenters) con fallback neutro, eliminando la mappa hardcoded; getCentroLabel accetta già costCenters, basta estendere la firma. Spostare il nome dell'intermediario SDI in sdi_config per tenant invece che nel JSX.

### M47. DELETE fisico dal frontend su chart_of_accounts e fiscal_deadlines invece di soft-delete

**Dove:** `src/pages/Impostazioni.tsx:786` · **Categoria:** Integrità dati

handleDelete in Impostazioni cancella fisicamente una voce di chart_of_accounts (tabella classificata 'ALTA criticità' in CLAUDE.md, 20 righe di piano dei conti) senza verificare se esistono budget_entries o monthly_cost_lines che referenziano quell'account_code: le righe collegate restano orfane e i totali di bilancio (i 'numeri di controllo' 2025) possono smettere di quadrare. Analogamente ScadenzeFiscali.tsx:348 fa DELETE fisico su fiscal_deadlines (tabella nell'elenco NO-DELETE-bulk) con un solo window.confirm. La regola di progetto chiede di preferire UPDATE/flag (is_active=false) alla DELETE.

**Proposta:** Passare a soft-delete: is_active=false su chart_of_accounts (il form ha già il pattern altrove, es. suppliers usa is_deleted/is_active in Fornitori.tsx:677) e status='cancelled' o is_active=false su fiscal_deadlines. Prima della disattivazione di un conto, contare i riferimenti in budget_entries e avvisare ('usato in N righe budget').

### M48. Payables inclusi nei costi senza filtrare per status

**Dove:** `src/pages/MarginiCategoria.tsx:79` · **Categoria:** Integrità dati

La query dei payables seleziona anche il campo `status` (riga 79) ma non lo usa mai: né la query né costsByOutlet (riga 120) filtrano per stato. Fatture annullate, note di credito gestite via stato o bozze vengono quindi conteggiate nei costi, nel margine e nella struttura costi. Il tipo PayableRow dichiara status ma il valore è dead data.

**Proposta:** Filtrare gli stati non validi direttamente nella query (es. `.neq('status', 'cancelled')` o whitelist degli stati che rappresentano un costo effettivo, coerente con le regole di PAYMENT_PLAN_NOTES.md sul ciclo passivo) oppure escluderli in costsByOutlet. Se il filtro non serve, rimuovere status dalla select.

### M49. Varianza budget: costi del periodo confrontati con budget annuale intero

**Dove:** `src/pages/MarginiCategoria.tsx:154` · **Categoria:** Logica

budgetByOutlet somma `budget_annual || budget_monthly * 12` (riga 154), cioè sempre 12 mesi, mentre totalCosts copre solo il periodo selezionato (YTD reale: le fatture future non esistono). budgetVar = (costi_periodo − budget_annuo)/budget_annuo (riga 181) risulta quindi sistematicamente e fortemente negativo per gran parte dell'anno (a luglio ~-42% anche con costi perfettamente in linea), rendendo la colonna Budget e il KPI inutilizzabili. Incoerenza interna: il fallback dai campi outlets (riga 163) usa invece i mesi trascorsi (`new Date().getMonth() + 1`), quindi i due rami producono basi non confrontabili.

**Proposta:** Pro-ratare anche il budget da template sui mesi del periodo selezionato (stessa logica del fallback: mesi trascorsi per YTD, 12 per ultimi 12m), così budgetVar confronta grandezze omogenee. Esplicitare in UI che la varianza è sul budget pro-rata.

### M50. Fetch budget_entries con cap fisso a 10.000 righe: troncamento silenzioso

**Dove:** `src/pages/MarginiOutlet.tsx:81` · **Categoria:** Integrità dati

MarginiOutlet (riga 81), Produttivita (riga 55) e ScenarioPlanning (riga 46) caricano budget_entries con `.range(0, 9999)`: oltre 10.000 righe per anno i dati vengono troncati senza alcun errore o avviso, producendo totali/margini sbagliati (il sistema è pensato per scalare: 'costruisci come se dovessi gestire 1.000 aziende con 10.000 outlet'). Inoltre loadYears (MarginiOutlet riga 59) scarica fino a 10.000 righe intere solo per estrarre gli anni distinti: spreco di banda e stesso rischio di anni mancanti nel dropdown.

**Proposta:** Verificare `count: 'exact'` nella risposta e paginare (o avvisare l'utente) quando data.length === 10000. Per gli anni distinti usare una RPC/vista con SELECT DISTINCT year invece di scaricare tutte le righe. In alternativa aggregare lato DB (RPC che restituisce già ricavi/costi per cost_center e mese).

### M51. MarginiOutlet: <tr> annidato dentro <tr> nella tabella drill-down

**Dove:** `src/pages/MarginiOutlet.tsx:459` · **Categoria:** Accessibilità

Nella tabella 'Dettaglio Margini' ogni riga è resa come `<tr key={o.nome} className="contents">` che contiene a sua volta due `<tr>` (righe 459-518): un <tr> figlio diretto di un altro <tr> è HTML invalido. React emette warning validateDOMNesting, il browser può ri-parentare i nodi in modo imprevedibile e gli screen reader perdono la semantica di riga/colonna (il primo td usa anche `flex` che rompe l'allineamento della cella, riga 464). La chiave del wrapper è o.nome, quindi con la stessa struttura il drill-down può comportarsi in modo incoerente tra browser.

**Proposta:** Sostituire il wrapper con un React.Fragment (`<Fragment key={o.nome}>`) contenente le due <tr> sorelle, pattern standard per righe espandibili. Spostare il layout flex su un <div> interno al <td> invece che sul td stesso.

### M52. Onboarding: telefono azienda raccolto e validato ma mai salvato (escluso dal payload RPC)

**Dove:** `src/pages/Onboarding.tsx:237` · **Categoria:** Logica

Lo step 1 raccoglie company.phone con validazione vPhone (riga 161 e 495-496, campo bloccante per isStep1Valid), ma payloadCompany (righe 237-244) include solo name, vat_number, fiscal_code, legal_address, pec, sdi_code: il telefono non viene mai passato alla RPC onboard_tenant e viene perso silenziosamente. L'utente lo compila (e viene bloccato se non valido) per niente.

**Proposta:** Aggiungere `phone: company.phone.trim() || null` a payloadCompany e alla RPC onboard_tenant (colonna companies.phone), oppure rimuovere il campo e la sua validazione dallo step 1 se il dato non serve.

### M53. Prima Nota: limite 5000 righe silenzioso tronca l'export annuale

**Dove:** `src/pages/PrimaNota.tsx:104` · **Categoria:** Integrità dati

La query dei movimenti ha `.limit(5000)` senza alcun controllo o avviso quando il risultato satura il limite. Con il filtro 'Tutto l'anno' su più conti A-Cube è realistico superare 5.000 movimenti/anno: i KPI (Dare/Avere/Saldo netto) e i file CSV/XLSX per la commercialista verrebbero troncati silenziosamente ai primi 5.000 in ordine di data, senza che l'utente possa accorgersene.

**Proposta:** Confrontare `data.length === 5000` e mostrare un banner 'risultato troncato, restringi il periodo' disabilitando gli export, oppure paginare la fetch con `.range()` in loop fino a esaurimento righe prima di esportare.

### M54. Filtri e selettori anno incoerenti e non persistenti tra le pagine analytics

**Dove:** `src/pages/Produttivita.tsx:426` · **Categoria:** Usability

Ogni pagina gestisce periodo/filtri a modo suo e nulla si conserva navigando: Produttivita (riga 426) e ScenarioPlanning (riga 254) hanno gli anni hardcoded [2024..2027] (nel 2028 il dropdown sarà stale), mentre MarginiOutlet li deriva correttamente dal DB (riga 57). MarginiCategoria dichiara `year`/`setYear` (riga 41) ma non offre alcun controllo per cambiarlo e il period 'custom' del tipo (riga 40) non ha UI, quindi si può guardare solo l'anno corrente; il suo CSV manuale handleExport (righe 273-283) è dead code con filename incoerente ('margini_outlet_...') rispetto all'ExportMenu ('margini_categoria'). StockSellthrough dichiara selectedOutlet/selectedCategory (righe 104-105) mai usati: nessun filtro reale. Solo AnalyticsPOS persiste la vista in URL (?view=), ma non l'outlet selezionato.

**Proposta:** Uniformare tutte le pagine sul PeriodContext globale (usePeriod) e derivare gli anni disponibili dal DB come fa MarginiOutlet; persistere i filtri locali in URL search params (pattern già presente in AnalyticsPOS) così sopravvivono alla navigazione. Rimuovere il dead code (handleExport, stati filtro inutilizzati) o implementare i filtri mancanti. Aggiornare src/data/pageGuides.ts per le pagine toccate, come da regola di progetto.

### M55. Circa 7.700 righe di pagine morte non instradate con logica divergente e pericolosa

**Dove:** `src/pages/Scadenzario.tsx:1012` · **Categoria:** Integrità dati

App.tsx instrada /scadenzario su ScadenzarioSmart e /banche su TesoreriaManuale, ma nel repo restano 5 pagine mai importate da nessun file: Scadenzario.tsx (1.535 righe), Banche.tsx (2.660), CashFlow.tsx, PrimaNota.tsx, Importazioni.tsx. Non sono copie innocue: Scadenzario.tsx:1012-1016 e :961 inseriscono suppliers SENZA company_id, :1023-1032 inserisce payables senza company_id, :781 fa `from('v_payables_operative').select('*')` non paginato (cap PostgREST 1000 righe — bug documentato e fixato in ScadenzarioSmart.tsx:630-633 ma ancora presente qui), Banche.tsx:2309-2310 interroga bank_transactions/payable_actions senza filtro company. Rischi concreti: un fix applicato alla pagina sbagliata (i nomi sono quasi identici), o un futuro re-route che riattiva insert privi di company_id. Inoltre gonfia la superficie da tenere allineata con pageGuides.ts.

**Proposta:** Eliminare i 5 file morti in una PR dedicata (sono in git history, nessuna perdita), oppure spostarli in una cartella `legacy/` esclusa dal build con un commento in testa. Verificare con `grep -r "pages/<Nome>'"` che nessun import residuo esista prima della rimozione.

### M56. Tab Riconciliazione: la spunta 'Riconciliato' non verifica alcun movimento bancario

**Dove:** `src/pages/Scadenzario.tsx:1437` · **Categoria:** Logica

Nella tab Riconciliazione `isReconciled = !!a.bank_account_id && !!a.amount` (riga 1437): un pagamento risulta 'riconciliato' (icona verde CheckCircle2) semplicemente perché al salvataggio erano stati indicati banca e importo, senza alcun confronto con bank_transactions/cash_movements. Il testo introduttivo promette 'Confronta i pagamenti registrati nello scadenzario con le operazioni bancarie. I pagamenti senza corrispondenza sono evidenziati' (righe 1410-1413), ma il matching non esiste: un bonifico mai uscito dalla banca appare comunque verde. Nota: `a.amount` è anche falsy per importo 0.

**Proposta:** O implementare il matching reale (join su cash_movement_id del payable, come già fa ScadenzarioSmart per il KPI reconciledCount alla riga 1368), oppure rinominare la colonna/icona in 'Banca+importo indicati' e correggere il testo descrittivo e la voce corrispondente in src/data/pageGuides.ts per non promettere una riconciliazione che non avviene.

### M57. Modali senza semantica dialog, focus trap né gestione Escape: accessibilità da tastiera/screen reader quasi assente

**Dove:** `src/pages/ScadenzarioSmart.tsx:200` · **Categoria:** Accessibilità

In tutto il frontend ci sono solo 21 attributi aria- (grep su src/**/*.tsx) e NESSUN role="dialog"/aria-modal: le decine di modali (es. il Modal generico di ScadenzarioSmart riga 200, i modali di TesoreriaManuale, Fornitori, Dipendenti) sono semplici div fixed inset-0 senza focus trap, senza ritorno del focus all'elemento di origine e senza chiusura con Escape (nessun handler onKeyDown per Escape nel codebase). Molti pulsanti icon-only si affidano solo a title (non letto in modo affidabile dagli screen reader). Il dropdown outlet di StoreManager (riga 189) si apre solo con hover CSS (hidden group-hover:block) ed è inutilizzabile da tastiera.

**Proposta:** Creare un componente Modal condiviso in src/components/ui con role="dialog", aria-modal, aria-labelledby, focus trap, chiusura con Escape e restituzione del focus, e migrare progressivamente i modali esistenti; aggiungere aria-label ai pulsanti icon-only e sostituire i menu hover-only con pattern click + gestione tastiera.

### M58. Lo Scadenzario ricarica TUTTI i payables (paginati a blocchi da 1000, select *) dopo ogni singola azione

**Dove:** `src/pages/ScadenzarioSmart.tsx:625` · **Categoria:** Performance

fetchData (righe 625-700) scarica l'intera v_payables_operative con select('*') in pagine sequenziali da 1000 righe, più una seconda scansione completa di payables per i campi extra, più suppliers/categorie/ricorrenze. Viene richiamata integralmente dopo OGNI micro-azione: conferma distinta (riga 1934), rimozione dalla distinta (riga 1978), rinvio scadenza, cambio categoria, chiusura a mano. Con la crescita fisiologica dei dati in produzione (ogni rata è una riga, 3 tenant) ogni click comporterà N round-trip sequenziali e il re-render dell'intera lista, degradando una pagina già da 4.950 righe.

**Proposta:** Dopo le azioni puntuali aggiornare solo le righe toccate nello stato locale (o rifetchare i soli id modificati) invece di richiamare fetchData completa; limitare la select della vista alle colonne effettivamente usate e valutare un filtro anno/periodo lato server come default.

### M59. Filtri PostgREST .or() costruiti con nomi fornitore non escapati: si rompono con virgole e parentesi

**Dove:** `src/pages/ScadenzarioSmart.tsx:1036` · **Categoria:** Logica

handleSetCategory interpola valori grezzi nella stringa del filtro .or(): riga 1036 `.or(`name.eq.${supplierName},ragione_sociale.eq.${supplierName}`)` e riga 1011 con la P.IVA. La sintassi or di PostgREST usa virgole e parentesi come separatori: una ragione sociale reale come "ROSSI, BIANCHI & C. S.N.C." o "ACME (ITALIA) SRL" produce un filtro malformato → la query fallisce o matcha il fornitore sbagliato, e la propagazione della categoria salta o colpisce record errati. Il fallback per nome contraddice anche la regola di PAYMENT_PLAN_NOTES.md (aggancio fornitore sempre per P.IVA).

**Proposta:** Quotare i valori secondo la sintassi PostgREST (name.eq."..." con escaping di virgolette) oppure evitare .or() facendo due query .eq() separate; meglio ancora spostare la propagazione in una RPC server-side parametrizzata. Limitare il match per nome ai soli payables privi sia di supplier_id che di P.IVA, loggando il caso.

### M60. Data 'oggi' calcolata in UTC: pagamenti e chiusure registrati al giorno precedente tra mezzanotte e le 2 di notte

**Dove:** `src/pages/ScadenzarioSmart.tsx:1201` · **Categoria:** Logica

Il pattern `new Date().toISOString().split('T')[0]` è usato in 52 punti (21 file) per ottenere la data odierna, ma toISOString restituisce la data UTC: in Italia (UTC+1/+2), tra le 00:00 e le 01:59 locali produce il giorno precedente. Esempi: cambio stato a 'pagato' (ScadenzarioSmart.tsx:1201) e default della modale di chiusura (riga 1188) registrano payment_date sbagliata di un giorno; ScadenzeFiscali.tsx:335 imposta paid_date allo stesso modo. Per date contabili (pagamenti, sospensioni, competenza mese) un giorno di scarto può spostare l'operazione sul mese precedente.

**Proposta:** Creare un helper condiviso `todayISO()` basato sulla data locale (es. `new Intl.DateTimeFormat('sv-SE').format(new Date())` o costruzione manuale con getFullYear/getMonth/getDate) e sostituirlo in tutti i punti in cui la stringa rappresenta una data di calendario italiana e non un timestamp.

### M61. Dropdown stato: 'Annullato' applicabile con un click, senza conferma e senza traccia in partitario

**Dove:** `src/pages/ScadenzarioSmart.tsx:1206` · **Categoria:** Usability

handleSetStatus (righe 1199-1214) per tutti gli stati diversi da 'pagato' fa un update secco di payables.status senza inserire alcuna riga in payable_actions e senza conferma. Il dropdown inline sullo StatusPill include 'annullato' (riga 3579): un click accidentale annulla la fattura, che sparisce immediatamente dalla lista attiva (filteredPayables la esclude di default, riga 1305) senza audit trail — in contrasto con il resto della pagina dove ogni transizione contabile è tracciata (chiusura manuale, disposizione, rimando) e l'eliminazione passa da una modale di conferma dedicata (righe 4288-4319). Trovare e ripristinare la fattura richiede di sapere che esiste il filtro esplicito 'Annullato'.

**Proposta:** Per la transizione ad 'annullato' dal dropdown riusare la modale deleteConfirm già esistente (o una conferma askConfirm) e registrare sempre una riga payable_actions (action_type='annullamento', old_status/new_status) come fanno le altre azioni; in generale far scrivere l'audit per ogni cambio stato manuale.

### M62. ScadenzarioSmart: 4950 righe monolitiche, tabella senza virtualizzazione né debounce sulla ricerca

**Dove:** `src/pages/ScadenzarioSmart.tsx:1290` · **Categoria:** Performance

Il componente pagina è un monolite (~4950 righe, file da 282KB) con decine di useState nello stesso scope: ogni keystroke nella ricerca (setSearchTerm) ricalcola filteredPayables (riga 1290) e ri-rende l'intero albero, inclusa la tabella che mappa tutte le scadenze raggruppate (righe 3389, 3868, 3937) senza virtualizzazione, paginazione UI o React.memo sulle righe. Con oltre 1000 payables (soglia già superata, come attesta il commento a riga 630) ogni interazione ridisegna migliaia di nodi DOM con celle ricche (badge, dropdown, tooltip).

**Proposta:** Debounce di 200-300ms sulla ricerca, estrazione della riga tabella in un componente memoizzato con props primitive, e virtualizzazione (es. windowing manuale o paginazione client a 100-200 righe) per la vista «Tutte». A medio termine spezzare il file per tab (sezioni URL ?section=) in componenti separati.

### M63. URL di autorizzazione PSD2 aperti con window.open in loop dopo await: i popup blocker li bloccano e non sono recuperabili

**Dove:** `src/pages/ScadenzarioSmart.tsx:2136` · **Categoria:** Usability

Dopo la creazione delle distinte, tutte le URL di autorizzazione bancaria vengono aperte con `allAuthorizeUrls.forEach(u => window.open(u.url, '_blank'))` (riga 2136): essendo chiamate asincrone non legate a un gesto utente diretto, i browser le bloccano come popup (a maggior ragione N tab in un colpo). TesoreriaManuale.tsx:2341 fa perfino `setTimeout(() => window.open(...), i*500)`, sempre bloccato. L'utente vede solo un toast, non ha una lista cliccabile per recuperare le URL, e senza autorizzazione i bonifici non partono — mentre i payables risultano già pagati (vedi finding sul flusso A-Cube). Le acube_authorize_url sono salvate su payment_batch_items ma la UI non offre un punto per riaprirle.

**Proposta:** Sostituire l'apertura automatica con un modal/pannello che elenca le URL di autorizzazione come link cliccabili (un click utente per tab non viene bloccato), con stato per-item (autorizzato/in attesa) letto da payment_batch_items.acube_authorize_url, così le URL restano recuperabili anche dopo un refresh.

### M64. ScadenzeFiscali: daysUntil non normalizza a mezzanotte — le scadenze di oggi risultano 'scadute' dal pomeriggio

**Dove:** `src/pages/ScadenzeFiscali.tsx:21` · **Categoria:** Logica

daysUntil (righe 19-22) calcola `Math.round((new Date(d) - new Date())/86400000)` senza azzerare le ore: new Date('YYYY-MM-DD') è mezzanotte UTC mentre new Date() è l'istante corrente. Con fuso italiano (CEST), per una scadenza dovuta OGGI il diff diventa < -0,5 giorni già dal primo pomeriggio → round dà -1, la riga mostra '1gg fa', si colora di rosso e viene conteggiata nel KPI 'scadute' (riga 267) pur essendo ancora pagabile in giornata (gli F24 si pagano entro fine giornata). ScadenzarioSmart.calculatePayableStatus fa la cosa giusta azzerando le ore di entrambe le date (righe 46-50); qui no.

**Proposta:** Normalizzare entrambe le date a mezzanotte locale prima del confronto (today.setHours(0,0,0,0) e parsing della due_date come data locale), replicando la logica di calculatePayableStatus in ScadenzarioSmart.tsx.

### M65. Errori Supabase sistematicamente ignorati: try/catch che non possono scattare e scritture silenziosamente fallite

**Dove:** `src/pages/ScadenzeFiscali.tsx:333` · **Categoria:** Usability

supabase-js non lancia eccezioni: restituisce { error }. In molti punti l'error non viene mai letto, quindi il try/catch circostante è inefficace e il fallimento è invisibile all'utente. Esempi concreti: markPaid (ScadenzeFiscali.tsx:333-337) — se l'UPDATE fallisce (RLS, rete) il catch non scatta, loadData ricarica e la scadenza resta non pagata senza alcun messaggio; ScadenzarioSmart.tsx:1121 e 1167 — l'insert su payable_actions (audit trail contabile del partitario) non è controllato, quindi la chiusura può risultare senza registrazione; BudgetControl.tsx:1348/1367/1387 — le DELETE di 'svuota' mostrano il toast di successo anche se la cancellazione è fallita.

**Proposta:** Introdurre un helper (es. `unwrap(await query)` che lancia se error è valorizzato) e applicarlo a tutte le scritture; in alternativa controllare `if (error)` dopo ogni update/insert/delete e mostrare un toast di errore, come già fatto correttamente in closePayableManually per l'update principale.

### M66. Scenario Planning: pulsante 'Salva' verso tabella che può non esistere e break-even fuorviante

**Dove:** `src/pages/ScenarioPlanning.tsx:192` · **Categoria:** Usability

handleSaveScenario inserisce in `scenario_simulations` bypassando i tipi generati (cast a unknown, riga 192) e gestisce a runtime il caso 'tabella inesistente' (42P01, riga 199) con un warning all'utente: in produzione il salvataggio è quindi una feature che può fallire sempre, scoperta solo cliccando. Se profile.company_id è undefined l'insert parte senza company_id (riga 176), violando l'isolamento multi-tenant o venendo respinto da RLS con errore criptico. Inoltre il 'Mesi al Break-Even' (riga 135) tratta i costi operativi ANNUI del nuovo outlet come investimento una-tantum da recuperare con l'utile mensile: concettualmente mischia opex e capex e il numero mostrato non è un break-even reale.

**Proposta:** Creare la migration additiva `supabase/migrations/xxx_scenario_simulations.sql` (con RLS su company_id) da applicare sui 3 tenant e rigenerare i tipi, eliminando il cast e il fallback 42P01; bloccare il salvataggio se manca company_id. Per il break-even, separare l'investimento iniziale (input dedicato) dai costi operativi annui, o rietichettare il KPI come 'mesi per coprire i costi del primo anno'.

### M67. Scheda contabile: fallback di aggancio payables e fatture per NOME fornitore invece che per P.IVA

**Dove:** `src/pages/SchedaContabileFornitore.tsx:149` · **Categoria:** Logica

fetchData aggancia i payables orfani con `.eq('supplier_name', supplierName).is('supplier_id', null)` (righe 147-156) e handleViewInvoice, in assenza di P.IVA, cerca l'XML con `.eq('supplier_name', ...)` (righe 583-585). Le regole di progetto (CLAUDE.md/PAYMENT_PLAN_NOTES) impongono l'aggancio fornitore↔fattura per P.IVA, non per nome: il match per nome è fragile (ragioni sociali abbreviate, 'S.R.L.' vs 'SRL', rinominazioni) e può sia includere righe di un omonimo sia perdere righe del fornitore corrente, falsando fatture, KPI e saldo del partitario stampato.

**Proposta:** Usare come fallback il match per P.IVA (`.eq('supplier_vat', supplier.partita_iva)`) sui payables orfani, ricorrendo al nome solo come ultima istanza con normalizzazione (trim, uppercase, rimozione punteggiatura/forme societarie) e segnalando in UI con un badge 'aggancio per nome — verificare' le righe recuperate in questo modo.

### M68. Panoramica Banche: 'Vedi tutto' delle scadenze non fa nulla (tab 'pagamenti' inesistente)

**Dove:** `src/pages/TesoreriaManuale.tsx:730` · **Categoria:** Usability

Il pulsante 'Vedi tutto →' della card 'Scadenze prossimi 30 giorni' chiama `onNavigate('pagamenti')`, ma `handleNavigate` (riga 3711) valida contro VALID_TESORERIA_TABS = ['panoramica','conti','movimenti','riconciliazione','prima_nota','finanziamenti'] e ignora silenziosamente i valori sconosciuti: il click non produce alcun effetto né feedback. I tab 'pagamenti' e 'distinte' (componenti TabPagamenti riga 2003 e TabDistinte riga 2319, ~550 righe) non sono più renderizzati da nessuna parte: sono dead code con logica delicata dentro (handleExecute marca payables 'pagato' senza aggiornare amount_paid).

**Proposta:** Puntare il link a una destinazione reale (es. `/scadenzario`) o rimuoverlo; eliminare TabPagamenti/TabDistinte se il flusso distinte è ormai gestito altrove (StoricoDistinte), per evitare che la logica difettosa venga riattivata.

### M69. Panoramica Banche: residuo scadenze mostra l'importo lordo per fatture parzialmente pagate

**Dove:** `src/pages/TesoreriaManuale.tsx:740` · **Categoria:** Logica

Nella lista 'Scadenze prossimi 30 giorni' il residuo è calcolato come `Number(p.gross_amount || p.amount_remaining || 0)`: `gross_amount` è quasi sempre valorizzato, quindi `amount_remaining` non viene mai usato. Una fattura da 10.000 EUR con 8.000 già pagati (status 'parziale', incluso nel filtro alla riga 575) viene mostrata con residuo 10.000 EUR, gonfiando il fabbisogno percepito. Altrove nello stesso file il calcolo corretto esiste (riga 2162: `amount_remaining != null ? ... : gross - paid`).

**Proposta:** Uniformare al pattern già usato nel file: `const remaining = p.amount_remaining != null ? Number(p.amount_remaining) : (Number(p.gross_amount||0) - Number(p.amount_paid||0))`.

### M70. Riconciliazione: findMatches O(movimenti × fatture) eseguito a ogni render della lista

**Dove:** `src/pages/TesoreriaManuale.tsx:3364` · **Categoria:** Performance

Dentro `unreconciledMovements.map(...)` viene chiamato `findMatches(m)` per OGNI movimento non riconciliato a OGNI render (anche mentre si digita nella search o si spunta un checkbox): ogni chiamata scorre tutte le `unpaidPayables` con confronti stringa (toLowerCase, includes, split). Con centinaia di movimenti da riconciliare e centinaia di fatture aperte (dataset reale: 10.000 transazioni caricate, riga 3684) sono facilmente 100k+ iterazioni con allocazioni per keystroke, rendendo la tab Riconciliazione percettibilmente lenta.

**Proposta:** Precalcolare il best score in un useMemo unico (`Map<movementId, bestScore>` costruita una volta su [unreconciledMovements, unpaidPayables]) e leggerlo nel render, oppure calcolare i quick-match solo per la pagina visibile.

### M71. TesoreriaManuale: fino a 10.000 bank_transactions con select('*') caricate a ogni mount e refresh

**Dove:** `src/pages/TesoreriaManuale.tsx:3684` · **Categoria:** Performance

Il loader principale (righe 3682-3689) scarica in blocco `bank_transactions` con `select('*').limit(10000)` più tutte le payables con join suppliers, i batch e gli item, PRIMA di renderizzare qualunque tab (spinner full-page a riga 3721 finché tutto non è arrivato). Ogni mutazione chiama `refresh()` (refreshKey++) che ributta giù l'intero dataset. Con la crescita dei movimenti da Open Banking (sync ogni 6h su più conti) il payload cresce linearmente: megabyte di JSON e parsing a ogni apertura della pagina /banche, anche per chi apre solo la tab 'panoramica'. Il repo ha già pattern migliori (Banche legacy paginava cash_movements a blocchi di 50 con load-more; Fornitori pagina a 1000).

**Proposta:** Selezionare solo le colonne usate (niente select('*')), caricare le transazioni lazy per tab con paginazione server-side (range + load more, come loadCashMovements della vecchia pagina), e dopo una mutazione aggiornare solo la risorsa toccata invece di rifare tutte e 6 le query con refreshKey.

### M72. Modali e righe cliccabili senza supporto tastiera né semantica dialog (focus trap, Escape, role)

**Dove:** `src/pages/Ticket.tsx:141` · **Categoria:** Accessibilità

ConfirmModal (righe 141-166), CreateTicketModal (riga 459) e i modali di TicketAdmin (import riga 563, chiusura riga 642, conferma riga 687) sono semplici div fissi senza role="dialog", aria-modal, focus trap né chiusura con Escape (solo il Lightbox gestisce Escape, righe 174-178). Il focus resta sulla pagina sottostante e un utente da tastiera può tabulare fuori dal modal o non riuscire a chiuderlo. Inoltre le righe della tabella ticket sono <tr onClick> (Ticket.tsx riga 830) e le notifiche sono <div onClick> (NotificationBell.tsx riga 195-198): non focusabili né attivabili da tastiera, senza role="button"/tabIndex.

**Proposta:** Estrarre un componente Modal condiviso con role="dialog", aria-modal="true", gestione Escape, focus iniziale e focus trap (o usare un primitive tipo Radix Dialog, coerente col pattern shadcn/ui citato in CLAUDE.md), e riusarlo in tutti i modali di Ticket/TicketAdmin. Per righe e card cliccabili aggiungere tabIndex=0, role="button"/link e gestione di Enter/Spazio, o inserire un vero <button>/<a> come elemento principale della riga.

### M73. Allegati ticket (screenshot del gestionale) caricati su bucket pubblico e serviti con URL pubblici senza autenticazione

**Dove:** `src/pages/Ticket.tsx:428` · **Categoria:** Sicurezza

CreateTicketModal carica gli allegati con `supabase.storage.from('media').upload(path, f)` e poi usa `getPublicUrl(path)` (righe 421-429): l'URL salvato in `allegati[].url` è pubblico e accessibile a chiunque lo conosca, senza login. Gli screenshot di segnalazioni di un gestionale finanziario contengono facilmente dati sensibili (saldi bancari, fatture, P.IVA fornitori, nomi dipendenti). L'unica protezione è la non-indovinabilità dell'UUID nel path, ma gli URL finiscono in JSON nel DB, nei log e potenzialmente inoltrati.

**Proposta:** Usare un bucket privato dedicato (es. 'ticket-attachments') con RLS sulle policy storage, salvare in `allegati[].url` solo il path e generare signed URL a scadenza (createSignedUrl) al momento della visualizzazione nel dettaglio ticket. Replicare bucket e policy sui 3 tenant.

### M74. "Risolvi con AI" bulk: loop seriale potenzialmente di minuti senza progresso visibile e senza il cooldown anti-duplicati della vista dettaglio

**Dove:** `src/pages/TicketAdmin.tsx:166` · **Categoria:** Usability

bulkResolveViaAI invoca ticket-resolve-now in serie su ogni ticket selezionato; ogni chiamata (Claude API + apertura PR) può durare decine di secondi, quindi con 10 ticket selezionati l'admin resta per molti minuti con un semplice spinner sul bottone e nessuna indicazione di avanzamento (il commento a riga 165 promette "feedback progressivo" che non esiste: il toast arriva solo alla fine). Se l'admin ricarica la pagina o clicca altrove non sa cosa è stato processato. Inoltre, a differenza della vista dettaglio (Ticket.tsx righe 1088-1101 con cooldown 60s sull'ultimo commento AI), qui non c'è alcun controllo lato client: un secondo click ravvicinato o una selezione che include ticket appena processati ri-invoca subito la funzione. I dettagli degli errori finiscono solo in console.warn (riga 200).

**Proposta:** Mostrare un progresso reale (es. stato 'Elaboro ticket 3 di 10' con titolo del ticket corrente, aggiornato nel loop) e disabilitare la navigazione accidentale. Applicare lo stesso cooldown della vista dettaglio saltando (con conteggio 'saltati') i ticket con commento AI < 60s. Rendere visibili gli errori per ticket nel toast o in un pannello, non solo in console.

### M75. Nessun timeout sulle chiamate esterne e dedup N+1 (una query per transazione) in tutte le functions di sync

**Dove:** `supabase/functions/acube-ob-tx-sync/index.ts:184` · **Categoria:** Performance

Nessuna delle 15 edge functions imposta un timeout (AbortSignal) sulle fetch verso A-Cube, Anthropic, GitHub o AdE: una risposta che si blocca tiene appesa la function fino al wall-clock limit di Supabase, e in acube-cf-sync-invoices lascia il pull record in stato 'running' per sempre. In più i loop di sync fanno una query DB per ogni record: acube-ob-tx-sync esegue un SELECT su acube_transactions per ogni transazione (riga 184) dopo aver paginato fino a 50 pagine x 100 item — fino a ~5.000 SELECT + 10.000 insert sequenziali in una singola invocazione; stesso pattern in acube-cf-sync-invoices (righe 196-201). Il rischio concreto è il timeout a metà sync con importazioni parziali.

**Proposta:** Aggiungere AbortSignal.timeout(15_000) a tutte le fetch esterne con gestione errore esplicita. Per il dedup: raccogliere gli hash della pagina e fare una sola query .in('dedup_hash', hashes) per pagina, poi insert batch (array) delle sole righe nuove; in alternativa upsert con ignoreDuplicates su indice UNIQUE. Ridurre drasticamente i roundtrip mantiene il sync entro i limiti anche con volumi di produzione.

### M76. help-chat: proxy Anthropic senza rate limit e CORS '*' su tutte le edge functions

**Dove:** `supabase/functions/help-chat/index.ts:98` · **Categoria:** Sicurezza

help-chat richiede solo un JWT autenticato qualsiasi (righe 98-106) e poi inoltra a pagamento verso api.anthropic.com (riga 134) senza alcun limite di frequenza o cap giornaliero: un utente (o un token rubato) può invocarla in loop e generare costi API illimitati; i limiti MAX_TURNS/MAX_CHARS riguardano il singolo payload, non la frequenza. Inoltre tutte le 15 functions dichiarano Access-Control-Allow-Origin: '*' (es. riga 27-31), permettendo a qualsiasi sito web di far partire richieste col JWT dell'utente da browser. ticket-resolve-now ha un cooldown ma solo per-ticket e basato su lettura non atomica dei commenti (righe 366-374).

**Proposta:** Aggiungere un rate limit per utente (tabella help_chat_usage con contatore per user_id/giorno, verificata prima della chiamata Anthropic; 429 oltre soglia). Restringere Access-Control-Allow-Origin ai 3 domini Netlify noti (echo dell'Origin se in allowlist), riusando lo stesso helper CORS in tutte le functions.

### M77. sdi-sync: corrispettivi con matricola RT sconosciuta attribuiti silenziosamente al primo outlet

**Dove:** `supabase/functions/sdi-sync/index.ts:300` · **Categoria:** Logica

findOutletByDeviceSerial fa fallback a outlets?.[0]?.id sia quando la matricola è null (riga 300) sia quando non matcha nessuna chiave (riga 306). Gli outlet sono caricati senza ORDER BY (righe 481-484), quindi 'il primo' è arbitrario e può cambiare tra esecuzioni. Risultato: i corrispettivi di registratori telematici non mappati finiscono su un outlet a caso con submission_status='ACCEPTED', falsando ricavi per outlet, confronti e margini — senza alcun errore visibile (il ramo 'outlet non trovato' a riga 489-492 è di fatto irraggiungibile perché il fallback restituisce sempre qualcosa se esiste almeno un outlet).

**Proposta:** Eliminare il fallback: se la matricola non è mappata, saltare il record aggiungendo un errore esplicito in allErrors (già mostrati nel response) e/o accumularlo in una tabella corrispettivi_unmatched. Implementare la tabella rt_devices (matricola → outlet_id) già prevista dal commento a riga 280, configurabile da Impostazioni.

### M78. CI guide-alignment non copre le pagine reali di Banche/Prima Nota/Revisione e manca la guida di /fornitori/revisione

**Dove:** `tools/check-guide-alignment.mjs:28` · **Categoria:** Usability

La mappa SOURCE_TO_GUIDES referenzia 'src/pages/Banche.tsx' e 'src/pages/Scadenzario.tsx', ma le route reali usano altri file: /banche è TesoreriaManuale.tsx (App.tsx:14, che include anche la tab Prima Nota via PrimaNota.tsx) e /scadenzario è ScadenzarioSmart.tsx (coperto). TesoreriaManuale.tsx, PrimaNota.tsx e RevisionePagamenti.tsx NON sono nella mappa: qualsiasi modifica a queste pagine passa la CI senza obbligo di aggiornare la guida, svuotando la regola non negoziabile 'guide sempre allineate'. Inoltre PAGE_GUIDES non contiene alcuna voce per '/fornitori/revisione' (RevisionePagamenti), quindi il pannello ? e l'assistente help-chat non hanno contesto per quella pagina.

**Proposta:** Aggiungere a SOURCE_TO_GUIDES: 'src/pages/TesoreriaManuale.tsx' e 'src/pages/PrimaNota.tsx' → ['banche'], 'src/pages/RevisionePagamenti.tsx' → ['fornitori-revisione']; creare la voce guida '/fornitori/revisione' in src/data/pageGuides.ts leggendo il codice reale della pagina; rimuovere dalla mappa i file morti (vedi finding dedicato).


## 🔵 BASSA — 13 finding

### B1. Circa 30 cartelle dist_* con 412 file di build committate nel repo pubblico

**Dove:** `dist_ux2/assets/index-DeB4wkjf.js:1` · **Categoria:** Performance

git ls-files conta 412 file sotto dist-test, dist4, dist5, dist_accounting, dist_bilancio_fix1-4, dist_ux, dist_recon... (~6 MB l'una): vecchi bundle di produzione committati nel repo pubblico. Oltre al peso su clone/CI, quei bundle storici contengono l'anon key JWT del tenant NZ hardcoded (verificato in dist_ux2/assets/index-DeB4wkjf.js e dist5/assets/index-NodErONA.js) — non è un segreto in senso stretto (l'anon key è pubblica e protetta da RLS), ma contraddice lo spirito del fix in src/lib/tenants.ts ('l'anon key NZ non finisce più in NESSUN bundle') e mantiene in giro versioni obsolete dell'app che possono confondere.

**Proposta:** Rimuovere tutte le cartelle dist_* dal versionamento (git rm -r --cached) e aggiungere dist*/ al .gitignore, che oggi copre solo dist, dist-deploy e dist-new.

### B2. Cashflow: KPI non ricalcolati (stale) quando la vista attiva non ha dati

**Dove:** `src/pages/CashflowProspettico.tsx:1167` · **Categoria:** Usability

L'effetto che ricalcola i KPI da `activeData` esce subito con `if (!activeData || activeData.length === 0) return`: passando a una vista senza righe (es. 'giornaliero' con raw data vuoti per l'anno/outlet selezionato), le card 'Entrate/Uscite Stimate' e 'Saldo Finale Stimato' restano ferme ai valori della vista precedente, mostrando numeri che non corrispondono alla tabella vuota sottostante. Inoltre `totIn += row.tot_entrate || row.entrate || 0` usa || su valori numerici, fragile con 0/null misti.

**Proposta:** Quando `activeData` è vuoto azzerare esplicitamente i KPI (`setTotalInflows(0)` ecc. o mostrare '—'), e usare `Number(row.tot_entrate ?? row.entrate ?? 0)` per la somma.

### B3. Convenzione colori 'vs Budget' incoerente tra Dashboard e Confronto Outlet

**Dove:** `src/pages/ConfrontoOutlet.tsx:489` · **Categoria:** UX

La Dashboard codifica esplicitamente la convenzione di progetto per gli scostamenti: ">=100% → nero; sotto target → rosso; NIENTE verde" (Dashboard.tsx righe 586-588) e le card OutletCard la rispettano ("niente verde", righe 160-196). Ma nella stessa pagina ConfrontoOutlet la TabellaBenchmark colora di verde sia il best-in-class sia i delta positivi in variance (righe 489-500), e in ContoEconomico il "Confronto con Budget e Controllo" usa verde/rosso (righe 2476-2477). L'utente vede lo stesso concetto (scostamento vs budget) con semantiche colore opposte a seconda della pagina/sezione.

**Proposta:** Definire una utility condivisa (es. in ChartTheme o formatters) per il colore degli scostamenti e applicarla ovunque: o si adotta la convenzione contabile nero/rosso dappertutto, o si ammette il verde dappertutto — non un mix per pagina.

### B4. Empty state di Confronto Outlet naviga con window.location.href perdendo lo stato SPA

**Dove:** `src/pages/ConfrontoOutlet.tsx:1164` · **Categoria:** UX

Il bottone "Vai al Budget" dell'empty state usa `window.location.href = '/budget'` (riga 1164) invece del `navigate` di react-router già importato e usato altrove nella stessa pagina (righe 1356-1357): full reload dell'app, ri-bootstrap di auth/company e perdita dei query param (incluso ?anno=, che sopravvive solo grazie al fallback localStorage). Incoerente con il resto della navigazione.

**Proposta:** Sostituire con `navigate('/budget')` (o meglio `navigate({ pathname: '/budget', search: ... })` preservando ?anno=), come già fatto per onNavigate/onOpenBudget nelle card.

### B5. Dashboard: fetch senza cancellazione — risposte fuori ordine al cambio anno possono sovrascrivere i dati

**Dove:** `src/pages/Dashboard.tsx:569` · **Categoria:** Logica

useEffect lancia fetchData (una decina di query await sequenziali) senza AbortController né flag di annullamento e senza cleanup (righe 173-570). Cambiando rapidamente anno o trimestre partono due fetch concorrenti: il reset esplicito degli state (righe 184-192) mitiga il sintomo iniziale, ma le risposte del fetch vecchio possono arrivare DOPO quelle del nuovo e sovrascrivere ricavi/outletsData con i dati dell'anno precedente. Stesso pattern in ConfrontoOutlet.loadData.

**Proposta:** Nel useEffect usare un flag di cancellazione (`let cancelled = false; return () => { cancelled = true }`) e verificarlo prima di ogni setState, oppure memorizzare un requestId e ignorare le risposte non correnti.

### B6. Anteprima PDF in ImportHub: se la signed URL fallisce, spinner infinito senza messaggio d'errore

**Dove:** `src/pages/ImportHub.tsx:316` · **Categoria:** Usability

In `openPreview` (righe 304-320) l'errore di `createSignedUrl` viene solo loggato in console (`console.error('Preview error:', err)`); `previewUrl` resta null e il modal (righe 1736-1742) mostra per sempre lo spinner di caricamento, senza messaggio né possibilità di capire cosa è andato storto. Stesso problema se `data.signedUrl` è assente. Inoltre il bucket viene dedotto da `doc.source_type || selectedSource` con fallback 'general-documents' (riga 309): dalla tab Cronologia `source_type` non è valorizzato (la colonna è `source`), quindi la preview può cercare il file nel bucket sbagliato e fallire sistematicamente.

**Proposta:** Aggiungere uno stato di errore nel modal ("Impossibile caricare l'anteprima" con bottone riprova/scarica) quando createSignedUrl fallisce o non restituisce URL. Correggere la deduzione del bucket usando anche `doc.source` (colonna reale di import_documents) oltre a `source_type`, così l'anteprima dalla Cronologia usa il bucket giusto.

### B7. confirm()/alert() nativi ancora usati in pagine live, in contrasto con la regola interna dei dialoghi custom

**Dove:** `src/pages/ImportHub.tsx:501` · **Categoria:** Usability

Il progetto ha una regola esplicita ('Conferma custom — vietati confirm/alert/prompt nativi', ScadenzarioSmart.tsx riga 334 e 4107) ma diverse pagine routate usano ancora i dialoghi nativi del browser: ImportHub.tsx:501 (window.confirm per eliminare un file), Fornitori.tsx:675 (disattivazione fornitore), RevisionePagamenti.tsx:257 (applicazione di tutte le proposte — azione massiva su dati di produzione), ConvertitoreFattureXML.tsx:336. I dialoghi nativi sono bloccabili dal browser, non tematizzati, non tradotti in modo coerente e interrompono il flusso in modo diverso dal resto dell'app.

**Proposta:** Estrarre il pattern askConfirm/ConfirmDialog già presente in ScadenzarioSmart in un hook condiviso (es. useConfirm in src/components) e sostituire le occorrenze native nelle quattro pagine indicate.

### B8. xlsx (~1MB) importato staticamente: caricato all'apertura pagina anche senza export

**Dove:** `src/pages/PrimaNota.tsx:8` · **Categoria:** Performance

import * as XLSX from 'xlsx' è statico in PrimaNota.tsx (riga 8), TesoreriaManuale.tsx (riga 140), Dipendenti.tsx, TicketAdmin.tsx, ConvertitoreFattureXML.tsx e ExportBilancioDialog.tsx (che importa staticamente anche jspdf/jspdf-autotable, righe 23-25). Le pagine sono lazy, ma xlsx finisce nel chunk condiviso caricato all'APERTURA della pagina, non al click su «Excel»: chi apre Banche/Prima Nota solo per consultare paga comunque il download+parse della libreria. vite.config.ts separa in manualChunks solo recharts e pdfjs, non xlsx/jspdf.

**Proposta:** Passare a dynamic import dentro le funzioni di export: const XLSX = await import('xlsx') in exportXlsx (idem per jspdf in ExportBilancioDialog). Facoltativo: aggiungere 'vendor-xlsx' ai manualChunks per condividere il chunk tra le pagine.

### B9. Prima Nota: un solo payable mostrato per movimento bancario (le altre fatture pagate spariscono)

**Dove:** `src/pages/PrimaNota.tsx:130` · **Categoria:** Logica

Il join client-side movimenti↔payables usa una Map con chiave bank_transaction_id (righe 117-135): se un unico bonifico salda più fatture dello stesso fornitore (caso comune con le distinte dello Scadenzario), payMap.set sovrascrive e in Causale/P.IVA resta solo l'ultima fattura restituita — l'export per la commercialista perde il riferimento alle altre. Non c'è nemmeno un ordine deterministico sulla query dei payables, quindi la fattura mostrata può cambiare tra caricamenti.

**Proposta:** Accumulare un array per bank_transaction_id e concatenare i numeri fattura nella Causale (es. «Fatt. 12, 13, 14») oppure mostrare «N fatture» con tooltip di dettaglio; ordinare la query per invoice_number per risultati deterministici.

### B10. Filtro 'scadute' dichiarato ma mai implementato e totale filtrato calcolato ma mai mostrato (su campo sbagliato)

**Dove:** `src/pages/Scadenzario.tsx:804` · **Categoria:** Logica

VALID_SCADENZARIO_FILTERS include 'scadute' (righe 12-13) e l'URL ?filter=scadute è quindi accettato, ma il useMemo `filtered` (righe 804-823) gestisce solo attive/pagate/sospese: con 'scadute' nessun ramo matcha e la lista mostra TUTTE le scadenze come 'tutte', con la UI dei filterTabs che non evidenzia nulla (il tab 'scadute' non esiste tra i filterTabs, righe 1045-1050). Un link condiviso con quel filtro mostra silenziosamente dati diversi da quelli attesi. Inoltre `filteredTotal` (righe 825-829) è commentato 'sempre visibile' ma non è mai renderizzato, e somma `gross_amount` mentre la tabella mostra `amount_remaining`: se venisse mai collegato alla UI, il totale non tornerebbe con le righe.

**Proposta:** Aggiungere il ramo `if (filter === 'scadute') list = list.filter(p => p.status === 'scaduto')` e il relativo tab nei filterTabs (o rimuovere 'scadute' dai VALID_SCADENZARIO_FILTERS); rimuovere filteredTotal o mostrarlo davvero sommando amount_remaining per coerenza con la colonna Importo.

### B11. Pagine morte Scadenzario.tsx e Banche.tsx nel repo: doppio flusso pagamenti non manutenuto e fuorviante

**Dove:** `src/pages/Scadenzario.tsx:843` · **Categoria:** Logica

src/pages/Scadenzario.tsx e src/pages/Banche.tsx non sono importati da nessun file (la route /scadenzario carica ScadenzarioSmart, /banche carica TesoreriaManuale — App.tsx:13-14), ma restano nel repo con un flusso pagamenti completo e parallelo: handleSalda (riga 843-871) aggiorna payables e inserisce payable_actions senza alcun controllo degli errori e senza le protezioni presenti nella versione viva. Rischio concreto: un fix o una nuova feature applicati per errore al file morto (i nomi sono quasi identici) non hanno alcun effetto in produzione, e il checker CI delle guide li referenzia ancora come sorgenti valide.

**Proposta:** Eliminare i due file morti in una PR dedicata (sono codice, non dati: nessun rischio data-loss) oppure, se si vogliono conservare come riferimento, spostarli fuori da src/ (es. attic/) e aggiornare tools/check-guide-alignment.mjs di conseguenza.

### B12. RLS di reconciliation_log senza isolamento company: lettura e update dell'audit log aperti a qualsiasi utente autenticato

**Dove:** `supabase/migrations/20260515_032_reconciliation_engine_v2.sql:27` · **Categoria:** Sicurezza

Le policy della tabella audit (righe 27-30) sono USING (true) / WITH CHECK (true) per il ruolo authenticated su SELECT, INSERT e UPDATE, senza alcun filtro su company_id — in contrasto con la regola di progetto 'company_id isolation: ogni query filtra per company_id dal JWT'. Nell'architettura attuale (un progetto per tenant, una sola company) l'esposizione cross-azienda è nulla, ma qualsiasi utente autenticato, anche con ruolo minimo, può riscrivere o falsificare le righe dell'audit trail di riconciliazione (UPDATE con CHECK true), che perde quindi valore probatorio; e il pattern si romperebbe al primo progetto multi-company.

**Proposta:** Allineare le policy allo standard del progetto: USING (company_id = get_my_company_id()) su SELECT/UPDATE e WITH CHECK equivalente su INSERT; valutare di rimuovere del tutto l'UPDATE per authenticated (l'audit dovrebbe essere append-only, con le correzioni fatte via nuove righe o via RPC dedicata). Applicare la migration sui 3 tenant.

### B13. Migration NZ_ONLY con UUID banche e dati fornitori dentro supabase/migrations/ condivisa: rischio applicazione a Made/Zago e aggancio per nome anziché P.IVA

**Dove:** `supabase/migrations/20260715_098_NZ_ONLY_supplier_payment_block1.sql:26` · **Categoria:** Integrità dati

Cinque migration (098, 099, 100, 101, 102) contengono UUID di bank_accounts NZ hardcoded (es. MPS e351d628-a150-4769-b965-9514deab48a3, riga 26) e UPDATE massivi su suppliers agganciati 'per RAGIONE SOCIALE ESATTA' (riga 8) — mentre PAYMENT_PLAN_NOTES.md impone l'aggancio per P.IVA, non per nome. Vivono nella stessa directory delle migration di schema che la Regola #0 impone di applicare identiche ai 3 tenant: l'unica protezione è un commento in testa al file. Se applicate per errore a Made/Zago, gli UPDATE per nome potrebbero colpire fornitori omonimi con UUID banca inesistenti (FK error nel migliore dei casi, dati corrotti nel peggiore).

**Proposta:** Spostare i data-fix tenant-specifici fuori da supabase/migrations/ (es. supabase/data_fixes/NZ/, come già fatto per i file DATA_FIX_*) e aggiungere in testa allo script una guardia SQL che verifica il tenant e abortisce se non corrisponde (es. `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM companies WHERE partita_iva='...NZ...') THEN RAISE EXCEPTION 'Solo tenant NZ'; END IF; END $$;`). Per i futuri data-fix fornitori, agganciare per partita_iva.


## Finding incerti (da ricontrollare a mano)

- **"Riprocessa" un estratto conto bancario duplica tutti i movimenti, mentre il confirm promette la sostituzione** — `src/pages/ImportHub.tsx:1329` (critica): Il bottone Riprocessa (righe 1326-1343) è mostrato per tutti i source processabili, incluso 'bank', con il messaggio "I dati esistenti per lo stesso anno verranno sostituiti". Ma in `importEngine.ts` la sostituzione (snapshot + delete per anno) esiste solo per il bilancio (righe 577-607) e per il payroll (righe 886-891): `processBankStatement` fa un semplice `batchInsert('cash_movements', records, ...)` (importEngine.ts riga 413) senza alcuna deduplica né cancellazione del batch precedente. Riprocessare un EC — o premere Processa due volte — inserisce tutti i movimenti una seconda volta in `cash_movements`, falsando saldi, riconciliazione e i match automatici post-import su un sistema in produzione su 3 tenant.

- **acube-cf-sync-invoices: dedup check-then-insert non atomico — doppioni possibili tra cron e sync manuale** — `supabase/functions/acube-cf-sync-invoices/index.ts:196` (media): Per ogni fattura scaricata dal Cassetto Fiscale il codice fa prima un SELECT su acube_sdi_invoices per acube_uuid (righe 196-201) e poi un INSERT separato (riga 237). La function è invocabile sia dal cron (service role) sia manualmente dal super_advisor (righe 85-97): due esecuzioni sovrapposte superano entrambe il check e inseriscono la stessa fattura due volte, che i trigger bridge (migration 029, citata a riga 185-186) propagano in electronic_invoices e payables — con rischio di scadenze doppie nello scadenzario. Il codice non usa upsert né si affida a un vincolo UNIQUE gestito (un eventuale 23505 finirebbe contato come 'failed' e marcherebbe il pull 'partial').
