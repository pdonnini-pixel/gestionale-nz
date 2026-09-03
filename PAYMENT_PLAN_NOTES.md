# Piano di pagamento fornitore + segnalazioni anomalie — Note di implementazione

> ## 🔁 RATE SCAMBIATE — DWS 26VAL-0987 e motore v4 (2026-09-03) — FATTO
>
> **Segnalazione di Patrizio** dalla tab Movimenti: «c'è il movimento ma me lo hai lasciato
> aperto tra le scadenze ma lo dai per riconciliato». Due SDD DWS da 11.927,43 (13/07 e
> 10/08) risultavano riconciliati, eppure in scadenzario restava una rata DWS scaduta.
>
> **Non mancava un aggancio: erano agganciati alle rate sbagliate.** La fattura 26VAL-0987
> (35.785,87) ha tre rate SDD: 11.927,43 al 13/07, 11.927,43 al 10/08, 11.931,01 al 10/09.
> L'SDD del 13/07 era sulla rata 2, l'SDD del 10/08 sulla rata 3 (da 11.931,01, importo
> diverso). Effetto: rata 1 «scaduta» da luglio, rata 3 chiusa come pagata prima di scadere,
> e il pagato risultava 23.858,44 invece di 23.854,86.
>
> **Due cause, una per aggancio.** Il 23/07 la rata 1 era ancora placeholder, quindi
> esclusa dal motore: l'SDD del 13/07 è finito sull'unica rata visibile con quell'importo.
> Il 10/08 la rata 1 era di nuovo visibile, ma `try_match_bank_transaction` tappava il
> punteggio a 100 **prima** della classifica: rata 1 (importo esatto + fornitore + numero
> fattura = 120) e rata 3 (119,85) diventavano entrambe 100 e vinceva la prima riga letta
> dal disco. La v3 ha aggiunto la guardia sui pari merito, ma tra rate della stessa fattura
> proporre a una persona è rumore: il motore ha tutto per scegliere.
>
> **Dati** (migration `NZ_ONLY_20260903_170`, solo UPDATE, backup in
> `_bkp_dws_rate_20260903`, `_bkp_dws_bt_20260903`, `_bkp_dws_rlog_20260903`): SDD 13/07 →
> rata 1, SDD 10/08 → rata 2, rata 3 riaperta «in scadenza» al 10/09 per 11.931,01. I due
> vecchi agganci restano in `reconciliation_log` come respinti con nota; i nuovi sono
> `manual`. Made e Zago: zero casi con lo stesso pattern (query di controllo nel file).
>
> **Motore v4** (migration `20260903_170`, NZ+Made+Zago): la classifica usa il punteggio
> non tappato, il tetto a 100 resta solo sulla confidence scritta nel log. A pari punteggio
> tra rate della **stessa** fattura (stesso numero + stesso fornitore) vince la scadenza più
> vicina alla data del movimento, poi la rata con il numero più basso, senza contare come
> pari merito. Tra fatture **diverse** il pari merito resta una proposta, come in v3.
> Test a secco su NZ (transazione annullata): SDD 13/07 con tre rate aperte → rata 1;
> SDD 10/08 con rate 2 e 3 aperte → rata 2; SDD 10/08 con rate 1 e 3 aperte → rata 1.

> ## 🧩 RATE ACCAVALLATE, NON DOPPIONI (2026-09-03) — diagnosi corretta
>
> Avevo scritto che c'erano «31 gruppi di doppioni per ~43.822 € di eccesso». **Era
> sbagliato.** La domanda di Patrizio («ma sono doppioni o sono rate? se le fatture le
> carica A-Cube com'è possibile?») ha rimesso a fuoco la cosa.
>
> **Non sono doppioni.** Per ogni fattura la somma delle rate coincide **al centesimo**
> con la fattura reale in `electronic_invoices`: GRUPPO FB 2704 → 3 rate = 32.929,02 =
> fattura; MIAN 424 → 3 rate = 10.609,12 = fattura. Nessun debito gonfiato, nessun
> importo in eccesso, niente da cancellare. Il mio conteggio moltiplicava l'importo per
> le righe «in più», ma quelle righe sono rate legittime.
>
> **Il difetto vero sta nelle DATE**: 39 piani su 105 hanno rate che si accavallano sulla
> stessa scadenza invece di distribuirsi. MIAN 424 ha tutte e tre le rate al 31/07 invece
> di 31/07, 31/08, 30/09. GRUPPO FB 2704 ha rata 1 e rata 3 entrambe al 31/08.
>
> **Non è colpa di A-Cube**: A-Cube porta le fatture, le rate le genera il gestionale.
> La funzione attuale `fn_supplier_installment_schedule` è **corretta** (per `fine_mese`
> calcola `months = prima_gg/30 + (i-1)`, quindi date sempre distinte). I piani sballati
> sono retaggio di generazioni precedenti: 34 piani su 105 hanno righe create in giorni
> diversi, segno che il piano è stato rigenerato o completato più volte con logiche
> differenti.
>
> **Da fare** (non ancora fatto): ricalcolare le sole DATE delle rate ancora aperte con
> `fn_supplier_installment_schedule`, senza toccare importi né rate già pagate o
> riconciliate. Prima serve la conferma di Patrizio, perché spostare una scadenza sposta
> il cashflow previsionale. Anomalia isolata da guardare a parte: MIAN 394 ha 2 righe per
> 4.506,68 su una fattura da 6.760,02, quindi lì manca davvero una rata.
>
> ## 🏷️ ANAGRAFICHE DOPPIE E METODI RI.BA (2026-09-03) — FATTO
>
> Migration `NZ_ONLY_20260903_166`, applicata su NZ (dati NZ-specifici).
>
> **Anagrafiche doppie.** HUMATICS e PROFASHION erano presenti due volte, una scheda con
> P.IVA e una senza. Quella di PROFASHION senza P.IVA non aveva fatture ma teneva il
> **saldo di apertura 2026 da -20.132,44 €**: la scheda vera partiva da zero e il debito
> risultava sottostimato di quella cifra. Il saldo è passato alla scheda giusta, le schede
> doppie sono **disattivate e non cancellate** (restano consultabili). Backup in
> `_bkp_merge_anagrafiche_20260903`.
>
> **Metodi di pagamento.** REALCART 555/556/557 → `riba_90`, TOP CASH 3619/A → `riba_30`,
> come indica la lista di Sabrina. Finché restavano a bonifico ordinario quelle scadenze
> stavano fuori da tutta la logica RI.BA (chiusura provvisoria, distinta, compensazione
> NC). Backup in `_bkp_riba_method_20260903`.
>
> **SHINE: tre rate, confermato da Patrizio.** L'accordo con SHINE è a tre rate, quindi il
> gestionale è nel giusto e la lista di Sabrina va letta come **importo intero della
> fattura**, non come rata. Vale per 882/26, 972/26, 1066/26, 1085/26 e 916/26.
>
> ## 📊 ENTRATE MAI RICONCILIATE (2026-09-03) — strumento pronto, esecuzione da autorizzare
>
> Il motore lavora **solo sulle uscite**: ogni `try_match_*` filtra `amount < 0`. Sul 2026:
> uscite riconciliate al 56,7% (706 su 1.246), **entrate allo 0,0% (0 su 4.261)**. Gli
> incassi POS, i versamenti e gli accrediti non vengono agganciati a niente. È un capitolo
> intero mai aperto, non un bug del v3.
>
> **Estendere il motore non serve.** Un incasso POS non ha un documento da agganciare:
> `daily_revenue`, `invoices` e `pos_imports` sono **vuote**, non esiste un ciclo attivo
> caricato. Cercare una controparte che non c'è è lavoro sprecato. Quello che serve è
> separare l'incasso che si spiega da solo da quello che una persona deve guardare.
>
> **Strumento** (migration `20260903_167`, NZ+Made+Zago): `close_incoming_movements(dry_run)`,
> stesso schema di `close_non_supplier_movements` per le uscite. Chiude per natura
> `incassi_pos` (POS, PagoBancomat, circuiti, Numia), `versamenti` (contante, cassa
> continua, ATM) e `finanziarie` (interessi, storni). Lascia fuori apposta bonifici in
> entrata, erogazioni di finanziamento, giroconti e fideiussioni: sono gli unici che
> possono avere una controparte.
>
> **Effetto su NZ** (dry run del 03/09): 7.766 entrate chiuse per 5.888.599,65 €, e
> **restano 90 movimenti** da guardare a mano — 83 bonifici per 1.211.644,52 €, un
> finanziamento da 64.100,00 €, 5 fideiussioni, un giroconto.
>
> ⚠️ **Non ancora eseguita.** Di default la funzione è in dry run e **non è agganciata al
> cron**: tocca 7.766 righe di tabella viva, quindi l'esecuzione
> (`select public.close_incoming_movements(false);`) va fatta solo con l'ok esplicito di
> Patrizio. Le righe chiuse restano riconoscibili dalla nota, quindi l'operazione è
> reversibile (vedi il file `_ROLLBACK`).

> ## 💰 ACCONTI — la disposizione si chiude, il partitario li registra (2026-09-03)
>
> **Segnalazione di Patrizio**: «non è corretto tenere aperta la distinta di WOLF GROUP,
> quell'importo in distinta è un acconto su fattura e quindi se pagato deve essere chiuso
> e registrato nel partitario». Aveva ragione su entrambi i fronti, ed erano due bug
> distinti che si sommavano.
>
> **1. La riga di distinta restava aperta per sempre.** `StoricoDistinte` considerava
> eseguita una riga solo se `payables.status = 'pagato'`. Ma una disposizione di ACCONTO
> è conclusa quando esce l'importo **disposto**, non quando la fattura è saldata: WOLF
> GROUP 218 (79.683,24) aveva 39.445,90 disposti il 6/8 e usciti il 7/8, quindi quella
> riga era finita mentre la fattura resta giustamente aperta per il residuo. La distinta
> del 06/08 sarebbe rimasta aperta all'infinito per colpa di una riga già chiusa.
> Ora una riga è eseguita se `amount_paid >= importo disposto`, con badge azzurro
> **«Acconto»** distinto dal verde «Pagato» (che resta la fattura saldata).
>
> **2. Gli acconti non entravano in partitario.** `SchedaContabileFornitore` generava la
> riga DARE solo per `status = 'pagato' && payment_date`. Un acconto su fattura ancora
> aperta spariva: i soldi erano usciti dal conto ma il debito verso il fornitore restava
> gonfiato di quella cifra. Sui dati vivi NZ, **51.865 € di debito sovrastimato**:
>
> | fornitore | saldo mostrato | saldo corretto | differenza |
> |---|---:|---:|---:|
> | WOLF GROUP | 133.356,60 | 93.693,86 | 39.662,74 |
> | MINGARDO SRLS | 31.787,00 | 20.193,00 | 11.594,00 |
> | GABRIEL IOSUB | 14.640,00 | 14.031,75 | 608,25 |
>
> Ora la riga DARE nasce da `amount_paid > 0`, senza pretendere né lo stato «pagato» né
> la data di pagamento (MINGARDO ha 11.594,00 versati e `payment_date` nullo: restavano
> comunque invisibili). Dicitura **«Acconto»** quando la fattura non è saldata,
> «Pagamento» quando lo è. `isPaid` resta il flag di fattura SALDATA: un acconto non
> chiude niente.
>
> **Nessun dato toccato**: entrambi i fix sono lato lettura, coerenti con il pattern del
> progetto (la logica di visualizzazione sta nel frontend, il DB resta intatto).

> ## 🔗 RICONCILIAZIONE v3 — la gerarchia di chiavi (2026-09-03) — FATTA
>
> **Da dove nasce.** Estratti conto luglio/agosto 2026 alla mano, la distinta di pagamento
> del 06/08 risultava aperta con 8 voci per 157.211,26 €. Erano state pagate tutte davvero:
> i movimenti c'erano in banca e nel gestionale, ma **nessuno era agganciato**. Al 31/07
> altre 99 scadenze chiuse a mano per 180.085,58 €, zero movimenti collegati. Il gestionale
> sapeva cosa doveva pagare, la banca sapeva cosa aveva pagato, e le due cose non si
> toccavano mai.
>
> **Le cinque cause, verificate una per una sui dati vivi:**
> 1. **Finestra date** `due_date + 30 giorni` in `try_match_amount_bank_transaction`.
>    DWS 26VAL-0526 scadeva il 13/04 ed è stata pagata il 07/08: fuori finestra, mai
>    proposta, benché la causale esponesse `IMPORTO BONIFICI: 35.785,87` esatto al centesimo.
> 2. **Numero fattura non normalizzato.** `invoice_number_keys('2046/01')` dava solo
>    `204601`, mai `2046`; la causale diceva `GGZ SF-2046`. Stessa cosa su `8/1660`
>    (TANESINI), `88-2026` (NIGRO), `882/26` (SHINE).
> 3. **Spese bancarie.** Sui flussi CBI la banca addebita fattura + commissioni
>    (35.785,87 + 1,75 = 35.787,62): il confronto a importo esatto falliva.
> 4. **La distinta era ignorata.** Quando una scadenza sta in una distinta sappiamo banca
>    e data della disposizione, cioè l'informazione più forte che abbiamo.
> 5. **Rischio opposto: solo importo poteva chiudere da solo.** Importo esatto (50) + data
>    esatta (20) + banca attesa (10) = 80 = soglia di `auto_exact`, senza che fornitore o
>    numero fattura fossero mai confermati. È lo scramble di SPM Investigazioni, più sotto.
>
> **La gerarchia** (migration `20260903_164_reconcile_engine_v3.sql`, NZ+Made+Zago):
> - **Livello 0 — distinta** (`try_match_distinta_bank_transaction`): la scadenza è stata
>   disposta su quella banca in quei giorni (finestra −3/+20). Applica **solo** se il
>   candidato è unico, altrimenti propone.
> - **Livello 1 — numero fattura**: `invoice_number_keys` v3 include i segmenti numerici
>   separati ed esclude gli anni isolati (1990-2035, così `2046` resta chiave valida).
>   Soglia di lunghezza: ≥5 cifre valgono da sole, 3-4 servono fornitore o distinta a
>   confermare, ≤2 mai da sole.
> - **Livello 2 — importo con tolleranza ASIMMETRICA**: il movimento può essere maggiore
>   della fattura per spese bancarie (fino a 5 € o 0,2%), **mai minore**. Più la quota
>   `IMPORTO BONIFICI` letta dalla causale CBI (`bank_movement_net`).
> - **Livello 3 — gruppo** (invariato): un movimento, N fatture, somma esatta al centesimo.
>
> **Le due guardie che contano più di tutto il resto:**
> - **GATE DI IDENTITÀ**: niente `auto_exact` senza almeno una conferma di CHI è il
>   beneficiario (fornitore in causale, numero fattura, o distinta). Su solo
>   importo/data/banca si propone e decide una persona.
> - **PARI MERITO**: se due scadenze arrivano allo stesso punteggio massimo, il motore non
>   sceglie. Sceglierne una è tirare a indovinare su un dato contabile.
>
> **Verifica** (in transazione annullata, sui dati vivi NZ):
> - 40 abbinamenti storici uno-a-uno riaperti e ripassati dal motore v3, ognuno isolato in
>   un savepoint: **32 riagganciati alla stessa identica fattura, 0 a una fattura diversa**,
>   8 fermati come proposta (fra questi, casi con `ties=2/3` a punteggio 100, cioè fatture
>   indistinguibili: esattamente lo scenario che produceva lo scramble).
> - I 5 casi del 06/08 (999 SRL, DWS ×2, GGZ, Publiacqua), rimessi allo stato di partenza,
>   vengono ora agganciati **tutti e cinque in automatico e alla fattura giusta**.
> - 60 movimenti di agosto non riconciliati: 0 auto, 17 proposte, 43 nessun match. Nessun
>   falso positivo introdotto.
>
> **Cron**: `rerun_distinta_reconciliation()` entra come primo passo di
> `run_daily_reconciliation()` (05:45), prima dei granitici.
>
> ⚠️ **Collo di bottiglia che resta**: al 03/09 ci sono **127 proposte `to_confirm` ancora
> valide** che nessuno ha mai confermato. Il motore propone bene, ma le proposte vanno
> guardate: si confermano dalla Tesoreria. Un motore più prudente senza qualcuno che
> conferma produce solo una coda più lunga.
>
> ## 🧾 SCADENZE FISCALI — aggancio al movimento bancario (2026-09-03)
>
> Le scadenze fiscali (F24, IVA, IRES/IRAP, TARI) vivevano su `fiscal_deadlines` **senza
> alcun riferimento al movimento bancario**: si potevano chiudere, ma l'addebito restava
> orfano in prima nota per sempre. Non sono spiccioli: IVA di luglio 39.063,80 € e
> IRES/IRAP rata 2/5 da 9.165,00 €, entrambe addebitate il 20/08 e mai collegate.
>
> **DB** (migration `20260903_165_fiscal_deadline_bank_link.sql`, NZ+Made+Zago): colonna
> additiva `fiscal_deadlines.bank_transaction_id` + `reconcile_fiscal_deadline(bt, fd)` e
> `undo_reconcile_fiscal_deadline(fd)`, entrambe con isolamento tenant esplicito.
>
> **Frontend** (`src/pages/ScadenzeFiscali.tsx`): premendo "Pagato" il sistema cerca le
> uscite non riconciliate di importo **esatto** nella finestra −30/+60 giorni dalla
> scadenza e chiede quale sia. Se non trova nulla chiude comunque, avvisando che resta da
> riconciliare. Etichetta "in banca" sulle scadenze agganciate. Guida `/scadenze-fiscali`
> aggiornata.

> ## 💶 SALDO PREVISIONALE — impegno RESIDUO, avviso e non blocco (2026-09-03)
>
> **Regola (Patrizio)**: i soldi di una distinta già emessa (quelle che si vedono in
> **Storico Distinte**) sono davvero impegnati e vanno tolti dalla disponibilità. Il
> previsionale però **non deve impedire** di usare il 100% del saldo reale: si vede,
> si conferma, si procede.
>
> **Calcolo** (`src/lib/committedBalance.ts`): l'impegno da sottrarre è il **residuo**,
> non il disposto pieno:
> `residuo = max(0, disposto + NC compensate − amount_paid)`
> (stessa formula di `disposizione_amount_pending` nello Scadenzario). Contare il disposto
> pieno su una fattura **pagata in parte** era un doppio conteggio: la quota già pagata è
> uscita davvero e sta già nel saldo reale. Caso reale NZ del 2026-09-03: WOLF GROUP
> fatt. 218, disposta 39.445,90 € e già pagata il 7/8 (39.683,24 € + 237,34 € di NC),
> continuava a pesare per intero → BCC Valdarno mostrava previsionale −6.621,47 € invece
> del saldo reale 32.824,43 €. Stessa correzione sugli F24 (`fiscal_deadlines.amount_paid`).
>
> **UI Scadenzario**: nessun blocco duro sui saldi. Sforo del previsionale → riga arancione
> con quanto si sta intaccando e quanto resta di reale, più conferma esplicita. Sforo del
> saldo reale → avviso rosso e conferma più netta. Unico blocco rimasto sul pulsante
> "Crea distinta": fattura selezionata senza banca. Vale anche per il flusso A-Cube.


> ## 🧾 RICEVUTA BANCARIA (RiBa) — chiusura PROVVISORIA alla scadenza (2026-08-06) — FASE 1
>
> **Regola (Patrizio)**: un fornitore che paga con **ricevuta bancaria** (`riba_*`) viene
> addebitato dalla banca **alla scadenza di ogni rata**, a prescindere dalla divisione
> 30/60/90. Quindi ALLA DATA DI SCADENZA la scadenza si dà per **pagata e chiusa in via
> PROVVISORIA**. Resta provvisoria finché non arriva **(a)** l'upload/conferma di una
> **distinta** della ricevuta bancaria, oppure **(b)** un **movimento bancario** riconciliato.
> Se non arriva né l'una né l'altra, resta pagata di default.
>
> **Modello** (migration `20260806_143_riba_provisional_close.sql`, applicata NZ+Made+Zago):
> - Nuovo flag `payables.is_provisional_paid` (+ `provisional_paid_at`). La chiusura provvisoria
>   imposta `amount_paid = gross`, `payment_date = due_date`, **nessun** `bank_transaction_id`
>   (come una chiusura a mano: prima nota intatta). Il trigger `update_payable_status` porta
>   quindi `status = 'pagato'`. Il flag si azzera **da solo** quando si aggancia un movimento
>   (nel trigger: `bank_transaction_id NOT NULL` → `is_provisional_paid = false`) → PAGATO definitivo.
> - `fn_riba_provisional_close(company, include_backlog)`: chiude le RiBa aperte con `gross > 0`
>   (le **NC sono escluse**), non placeholder/closed_manually, senza movimento, `status` aperto,
>   `due_date <= today`. **Guardia forward-only**: in automatico solo `due_date >= 2026-08-06`
>   (data attivazione) → lo **storico** già scaduto NON viene toccato in automatico.
> - `rerun_riba_provisional_close()` agganciata al cron notturno `run_daily_reconciliation`
>   (05:45), **per ultima** (la riconciliazione reale ha la precedenza).
> - `rpc_riba_provisional_close_backlog()` (ruoli contabile/super_advisor): chiude in blocco lo
>   **storico** già scaduto → pulsante "Chiudi storico RiBa" in Scadenzario. `rpc_riba_provisional_undo(id)`
>   riapre una singola provvisoria (reversibile). Al 2026-08-06 su NZ: 0 forward, 12 backlog.
>
> **Frontend**: stato sintetico `pagato_provvisorio` (badge verde acqua "Pagato (provvisorio)"),
> escluso dalla lista attiva (come `addebito_automatico`), pill "RiBa provvisorie", filtro stato
> dedicato, riga partitario "Pagamento RiBa (provvisorio)" in `SchedaContabileFornitore`.
> Parità #0: **meccanismo** identico sui 3 tenant; i fornitori RiBa restano dato NZ-specifico.
>
> ## 🧾 RiBa — FASE 3: note di credito abbinate A MANO (2026-08-06) — FATTA
>
> Regola (Patrizio): le NC dei fornitori RiBa NON si compensano in automatico; vanno
> messe a disposizione dell'operatrice per **abbinarle a un pagamento/scadenza**, tracciate
> nel partitario.
>
> **DB** (migration `20260806_147_riba_credit_note_manual_link.sql`, NZ+Made+Zago):
> - `rpc_link_riba_credit_note(nc, target)`: riusa `payable_credit_note_links` (payable=target,
>   credit_note=NC, `applied`), **chiude la NC a mano** (registrata in AVERE nel partitario) con
>   riferimento alla scadenza; rifiuta se NC e scadenza sono di fornitori diversi.
> - `rpc_unlink_riba_credit_note(nc)`: riapre la NC e annulla il link (reversibile).
> - Testato su NZ in rollback: link (chiude NC + link applied) / unlink (riapre) / reject cross-fornitore.
>
> **Frontend**: `src/components/RibaCreditNotesModal.tsx` (coda NC RiBa aperte + scelta scadenza
> destinazione + Abbina), pulsante "NC RiBa da abbinare" in `ScadenzarioSmart` (ruoli scrittura).
> Guida `/scadenzario` aggiornata. Le NC RiBa restano ESCLUSE da ogni compensazione automatica.

> ## 🧾 RiBa — FASE 2: upload distinta con riscontro AL CENTESIMO (2026-08-06) — FATTA
>
> **Regola (Patrizio)**: caricando la distinta della banca il sistema deve **verificare
> contenuto e importi** e chiudere **solo ciò che riscontra al centesimo**, mai a fiducia.
>
> **DB** (migration `20260806_145_riba_distinta_upload.sql`, applicata NZ+Made+Zago):
> - bucket storage privato `riba-distinte` (policy autenticati) + tabelle `riba_distinte`
>   (testata) e `riba_distinta_lines` (righe: raw_supplier/raw_invoice/raw_amount/raw_due_date,
>   matched_payable_id, match_status ∈ unmatched|matched|ambiguous|confirmed). RLS company-scoped.
> - `rpc_automatch_riba_distinta(distinta)`: aggancia ogni riga a una RiBa (aperta o provvisoria,
>   senza movimento) con `round(gross*100)=round(amount*100)` — importo **esatto**. Disambigua per
>   numero fattura, poi nome fornitore. 1 candidato → matched; >1 → ambiguous; 0 → unmatched.
> - `rpc_confirm_riba_distinta_line(line, payable)`: **gate al centesimo** (`IMPORTO_NON_QUADRA` se
>   diverso), verifica che sia RiBa, poi rende la scadenza **pagata definitiva** (amount_paid=gross,
>   `is_provisional_paid=false`, payable_action `conferma_distinta_riba`). Ruoli contabile/super_advisor.
> - `rpc_confirm_riba_distinta(distinta)`: conferma in blocco le righe `matched`, salta (skipped) quelle
>   che non quadrano più. Testato end-to-end su NZ in rollback (gate + matched→pagato).
>
> **Edge** `extract-distinta` (deploy NZ+Made+Zago): PDF→testo (pdfjs lato client) → AI (Vault, come
> `extract-scadenza`) → righe. **Solo estrazione**: il riscontro/chiusura al centesimo è lato DB.
>
> **Frontend**: `src/lib/ribaDistintaExtract.ts` (PDF via edge; **CSV/XLSX deterministico** lato client),
> `src/components/RibaDistintaModal.tsx` (upload → riscontro → conferma), pulsante "Carica distinta RiBa"
> in `ScadenzarioSmart` (ruoli scrittura). Guida `/scadenzario` aggiornata.
>
> ## 🧾 RiBa — FASE 2.2: effetti AL NETTO di note di credito (2026-08-07)
>
> Dai PDF reali (distinta MPS): molti effetti sono al **netto di NC** — "ACC FATT 3480 MENO
> NC 3438 3439" → 4.053,45 − 1.134,60 − 1.220,00 = 1.698,85; "FATT 3657 MENO NC 3797" →
> 3.205,34 − 2.914,90 = 290,44 (verificato al centesimo sui dati veri).
>
> **DB** (migration `20260807_148_riba_distinta_net_of_credit_notes.sql`, NZ+Made+Zago):
> `rpc_confirm_riba_distinta_line(line, ids[])` accetta un MIX di scadenze dello stesso
> fornitore: le **fatture** (gross>0) chiuse come pagate, le **NC** (gross<0) chiuse a mano
> (AVERE) e collegate alla fattura del gruppo (`payable_credit_note_links=applied`). Il **gate**
> resta al centesimo su `sum(gross)` (le NC pesano negative = netto). Vincoli: stesso fornitore,
> almeno una fattura. Testato su NZ in rollback (MIAN 883 − NC 56 = 2.933,49; gate rifiuta la
> sola fattura). Frontend: il compose mostra anche le NC del fornitore (rosso, sottraggono).
>
> ⚠️ **DATO — duplicati payables**: emerso che alcuni fornitori (es. GRUPPO FB) hanno **payables
> DUPLICATI per fattura** con `payment_method` incoerente (riba_60 vs bonifico_ordinario vs null)
> e importi a **1 centesimo** di distanza (3657: 3205,34 riba vs 3205,35 bonifico; NC 3797:
> −2914,90 vs −2914,91), in stati diversi (la copia RiBa spesso già chiusa, le copie bonifico
> aperte). È un problema di IMPORT preesistente che rende confusa la composizione distinta e va
> **bonificato a parte** (dedup, NO DATA LOSS: conferma binaria + backup). Da decidere con Patrizio.

> **FASE 3** — coda NC manuale (vedi sotto): fatta.

> ## 🧾 RiBa — FASE 2.1: match per FORNITORE + effetti CUMULATIVI (2026-08-06)
>
> Sui dati reali (distinta MPS "Ritiro Effetti Pagati", esempi di Patrizio) il match
> automatico a importo singolo NON basta:
> - la chiave affidabile e' la **P.IVA/CF del creditore** ("cod.fiscale/P.iva creditore:"),
>   non il numero fattura (in distinta e' sporco: "FT 73", "Rif- 5.7 8.962", "DOC.N…", e
>   **non corrisponde** ai numeri dei payables);
> - molti effetti sono **cumulativi** (un importo = somma di N fatture del fornitore; es.
>   TANESINI 5.447,91 = subset di 42 RiBa aperte);
> - a volte la P.IVA in distinta e' un **codice fiscale** (persona fisica) che non combacia
>   con `partita_iva`/`vat_number` (es. NIGRO: distinta `NGRPRZ…`, anagrafica P.IVA `02063730978`)
>   → serve fallback sul **nome**.
>
> **Soluzione** (migration `20260806_146_riba_distinta_group_match.sql`, NZ+Made+Zago):
> - `riba_distinta_lines` + `raw_vat`, `matched_supplier_id`, `matched_payable_ids uuid[]`.
> - **automatico conservativo**: pre-aggancia SOLO il caso a importo singolo univoco (per fornitore).
> - **composizione manuale**: `rpc_confirm_riba_distinta_line(line, payable_ids[])` chiude N scadenze
>   ma **solo se la SOMMA quadra al centesimo** (`IMPORTO_NON_QUADRA` altrimenti). Testato su NZ
>   (TANESINI, subset da 3) in rollback: chiusura gruppo OK + gate che rifiuta la somma parziale.
> - Edge `extract-distinta` v2: estrae anche `vat`, prompt tarato sul layout MPS.
> - Frontend: risoluzione fornitore per P.IVA/nome lato client; il modale mostra per ogni effetto
>   le RiBa aperte del fornitore con **selezione multipla** e somma live/gate al centesimo.

> ## ⚠️ AUTO-MATCH A IMPORTO — scramble su fornitore a importo unico (2026-08-06)
>
> **Sintomo** (segnalato da Patrizio, New Zago): fatture di un fornitore che
> risultano `pagato` ma **agganciate al bonifico sbagliato**; una fattura chiusa
> senza avere un pagamento reale. Caso originario: **SPM Investigazioni srl** —
> FPR 436/26 di ATENA idem (bonifico "SALDO FATTURA 350" finito sulla 436).
>
> **Causa radice**: quando un fornitore emette **fatture tutte dello stesso
> importo** (SPM: tutte da €110), il matcher **a importo/data** (`try_match_bank_transaction`
> / `try_match_amount_bank_transaction`, ordine 2-4 del motore) può agganciare un
> bonifico a una qualsiasi delle fatture con quell'importo, **non necessariamente
> quella citata in causale**. Su una serie mensile ripetuta questo produce uno
> **scramble a catena**: ogni pagamento scala di una posizione e chiude la fattura
> sbagliata; l'ultima fattura della serie viene marcata `pagato` pur non avendo
> alcun bonifico reale.
>
> **La causale è la fonte di verità**: `SALDO FATTURA <n>` / `SF-<n>` indica la
> fattura effettivamente pagata. Il match a solo importo/data è debole e va
> **sempre** verificato contro il numero fattura in causale prima di fidarsi.
> ⚠️ Attenzione al **reset di numerazione a inizio anno**: le fatture 2026 di SPM
> ripartono da numeri bassi (13, 45, 63, 81…) mentre nei bonifici 2025 comparivano
> numeri alti (166, 265, 303, 321, 341…). Un bonifico 2025 "SF-321" **non** è la
> fattura 2026 n° 31: è una fattura 2025 non presente tra le payables correnti.
>
> **Bonifico cumulativo**: "SF-45-63" (−€220) paga **due** fatture (45 + 63). Il
> group-matcher `try_match_group_bank_transaction` **non scatta** se la causale non
> contiene la keyword `saldo|fattura|fatt|nota|parcella` e i numeri sono a 2 cifre
> (caso "SF-45-63"): va agganciato a mano alle due fatture (stesso `bank_transaction_id`).
>
> **Bonifica** (solo NZ, reversibile, tutto UPDATE — nessun DELETE): per ogni
> bonifico rimettere l'aggancio sulla fattura citata in causale; rigettare i log
> `reconciliation_log` errati (`status='rejected'`) e inserirne di corretti
> (`status='applied'`); liberare (`is_reconciled=false`) i bonifici che citano
> fatture di anni chiusi non più in payables; **riaprire** (amount_paid=0,
> bank_transaction_id=NULL) le fatture rimaste senza pagamento reale. Backup delle
> righe toccate PRIMA: `public.spm_reconcile_backup_20260806_{payables,banktx,logs}`.
> Esito SPM 2026: 13←"FATT 13", 45+63←"SF-45-63", 81←"FATT 81"; riaperte 31/103/125
> (nessun bonifico reale le nomina); liberati i bonifici 2025 (303/321/341).
>
> **Ambito**: dato specifico dei fornitori di un tenant → **NON** si replica su
> Made/Zago (come il resto dei dati-fornitore). La parità #0 vale per codice/migration.

> ## ⚠️ DEDUP 106 vs RATE UGUALI — falso positivo che nasconde le rate (2026-08-06)
>
> **Regola**: il dedup doppioni (migration `106`) clusterizza per
> `(company_id, supplier_name, invoice_number, round(gross_amount))` **senza**
> `installment_number`. Un piano a **rate uguali** (es. 2 rate da €2.627,27 su
> fattura da €5.254,54) ha tutte le rate con lo **stesso importo** → stesso
> cluster → il dedup ne tiene una e marca le altre `is_placeholder=true`,
> facendole sparire da scadenzario (`v_payables_operative`) e riconciliazione.
> **Le rate NON sono doppioni**: si distinguono per `installment_number`.
>
> **Sintomo utente** (segnalato da Patrizio): fattura con acconto pagato che
> appare "pagata per pieno", il **saldo** (rata successiva) è invisibile.
> Caso originario: **999 SRL, fattura 32** (rata 2/2 nascosta) — fix in
> `NZ_ONLY_20260806_141`.
>
> **Regole**:
> - Chi scrive un dedup che marca `is_placeholder` DEVE partizionare anche per
>   `installment_number` (o escludere le righe con `installment_number IS NOT NULL`).
> - Ambito **NZ_ONLY**: i piani a rate sono dato solo di New Zago (Made/Zago: 0).
> - Bonifica dati storici: ripristino `is_placeholder=false` delle rate genuine
>   (una sola riga per `(fornitore, fattura, importo_arrotondato, installment_number)`,
>   escluse le `annullato` e i cluster con una riga NON-rata visibile — es. SP
>   CONTABILE 322/E, doppione `annullato` che resta nascosto). Backup:
>   `public.payables_installment_placeholder_backup_20260806`.

> ## 🧾 REVERSE CHARGE — i documenti TD16/17/18/19 NON generano scadenze (2026-07-31)
>
> **Regola**: i documenti di **integrazione / autofattura reverse charge** — `TD16`
> (interno), `TD17` (estero), `TD18` (intra-UE), `TD19` (art.17 c.2) — sono documenti
> IVA **auto-emessi dal cessionario** (numerati col sezionale interno, es. `34/A`) e
> **NON sono debiti** verso il fornitore. Il debito reale sta sulla fattura originale
> del fornitore (`TD01`/`TD24`…). ⚠️ I **`TD24`** (fattura differita) sono invece
> fatture **vere**: non vanno mai confusi coi reverse charge.
>
> **Bug storico** (segnalato da Sabrina, New Zago, luglio 2026): il bridge A-Cube
> `sync_acube_sdi_passive_to_payable` creava un `payable` anche da questi documenti →
> "fatture fantasma" che sporcavano lo scadenzario e gonfiavano il totale pagato.
>
> **Fix** (migration `20260731_131`, applicata NZ+Made+Zago): dopo aver archiviato la
> `electronic_invoice`, il bridge **esce senza creare payable** se `document_type ∈
> {TD16,TD17,TD18,TD19}`. Bonifica dati storici **solo NZ** (`NZ_ONLY_20260731_132`):
> soft-hide **reversibile** via `is_placeholder=true` (la view `v_payables_operative`
> filtra i placeholder) di **52** payable fantasma (10 aperti + 42 pagati, −€23.944,45
> dal pagato gonfiato). **Esclusi** i 2 già agganciati a un movimento bancario reale
> (MILANI `26/A`, GABRIEL IOSUB `10/A`): vanno **ri-agganciati alla fattura vera** a
> mano prima di nasconderli, per non orfanare il movimento. Made/Zago non avevano
> payable di questa classe (verificato). Backup dei 54 payable salvato prima.
>
> **Fix robusto (migration `20260806_133`, NZ+Made+Zago)**: affidarsi al solo
> `is_placeholder` si è rivelato fragile — un job/bonifica che ripristina
> `is_placeholder=false` (es. il restore rate della `NZ_ONLY_141`) fa **riemergere**
> le autofatture (caso reale: Scopa Magica `34/A`, `42/A` + altre 15 ricomparse il
> 2026-08-06). La vista `v_payables_operative` ora **esclude STRUTTURALMENTE** ogni
> payable la cui `electronic_invoice` è `TD16/17/18/19` (`NOT EXISTS … tipo_documento IN …`):
> così le autofatture non compaiono MAI nello scadenzario, qualunque valore abbia
> `is_placeholder`. I 2 casi bancari (MILANI `26/A`, IOSUB `10/A`) sono stati risolti:
> sono le integrazioni IVA delle fatture vere 921 (1.000) e 9 (10.500); riconciliazioni
> errate annullate con `undo_reconcile_movement`, autofatture nascoste, movimenti liberati.

> ## 🧾 CICLO DISTINTA / "IN SOSPESO" (2026-07-13) — leggere prima di toccare distinta/riconciliazione
>
> Flusso a 3 stati: **Predisposizione** (Crea distinta = solo anteprima, nessuna scrittura) →
> **Conferma** (fatture IN SOSPESO, tolte dallo scadenzario attivo, banca prevista impostata,
> **niente chiuso**) → **Pagamento** (riconciliazione del movimento bancario → la fattura si chiude,
> con le NC collegate). Regole ferme:
> - Alla Conferma **non si chiude nulla** (né fatture né note di credito). La compensazione NC è solo
>   un'intenzione registrata in `payable_credit_note_links` (stato `pending`).
> - Le fatture in distinta restano `da_pagare`/`scaduto` (NON stato `sospeso`): così il motore di
>   riconciliazione le aggancia comunque. "In sospeso" è un **filtro UI** (`selectedStatus='in_distinta'`),
>   non un cambio di stato DB.
> - **Prima nota = solo `bank_transactions`** (movimenti reali). La chiusura a mano non crea movimenti
>   e non tocca il saldo → nessun doppio conteggio in prima nota/cashflow.
> - Frontend: `src/pages/ScadenzarioSmart.tsx` (distinta, bozza localStorage, ACCONTO/SALDO, scala NC,
>   "In sospeso"), riuso del tab **Riconciliazione** in `TesoreriaManuale.tsx` per l'abbinamento manuale.

> ## 🔒 REGOLA GRANITICA — RICONCILIAZIONE A OGNI MOVIMENTO (2026-07-24) — NON NEGOZIABILE
>
> Regola di Patrizio: **si può chiudere una fattura a mano, ma OGNI volta che arriva un
> movimento (storico o nuovo) il sistema DEVE verificare la corrispondenza tra fatture
> APERTE *e* CHIUSE, e NON deve mancare l'abbinamento per colpa delle commissioni bancarie.**
> L'utente non deve accorgersene a mano: se un pagamento reale esiste, il sistema lo aggancia
> (se univoco) o lo propone in cima alla coda "da riconciliare".
>
> Cosa lo garantisce (motore di riconciliazione, tutto reversibile con `undo_reconcile_movement`):
> - **Candidati = aperte + chiuse a mano** non ancora agganciate a un movimento (mai solo le aperte).
>   Fatture chiuse a mano: **solo aggancio** del movimento, restano `pagato`, nessuna doppia scrittura.
> - **Commissioni scorporate**: i flussi CBI aziendali arrivano col LORDO (es. 2.751,75 = 2.750,00 +
>   1,75). Il matcher legge dalla causale `IMPORTO BONIFICI` (netto) e `IMPORTO COMMISSIONI`, e confronta
>   il **netto** — così ±1,75 non fa più saltare l'abbinamento. Cercare l'importo esatto al centesimo è
>   sbagliato: c'è quasi sempre una commissione.
> - **Ordine dei tentativi** (a ogni movimento, via trigger + cron notturno 05:45):
>   1. granitico (`try_match_group_bank_transaction`): fornitore + numero fattura in causale, somma esatta.
>      Include i **pagamenti cumulativi** (un movimento = somma di N fatture, es. "SALDO FATTURA 11-12"),
>      **anche con numeri fattura corti** (2-3 cifre) purché la causale abbia contesto fattura e la somma
>      del gruppo coincida esatta (migration 111);
>   2. a punteggio (`try_match_bank_transaction`): fornitore in causale, importo/data/numero;
>   3. biettivo per data (`rerun_bijective_reconciliation`): ricorrenti 1-a-1;
>   - **Conferma fornitore (regola stretta, migration 113)**: il fornitore in causale è confermato SOLO
>     dalla **P.IVA** o da una parola **≥4 lettere NON generica** (stoplist: PROPCO, GRUPPO, GROUP, HOLDING,
>     SRL, SPA, SOCIETA, SERVIZI, ITALIA…), via helper `supplier_confirmed_in_text`. Evita le collisioni tra
>     nomi simili (es. "Palmanova **Propco**" ↔ "Valdichiana **Propco**"). I fornitori con nome solo generico
>     o a sigla (es. "Gruppo FB", "S.I.A.E.") si abbinano per P.IVA / numero+importo esatto, o a mano.
>   4. **a importo, causale ANONIMA** (`try_match_amount_bank_transaction`, migration 110): flussi CBI
>      senza nome/numero. Auto SOLO se il candidato è **UNICO** (e chiuso-a-mano → aggancio, oppure netto
>      dal dato strutturato `IMPORTO BONIFICI`); altrimenti **propone** (`to_confirm`), niente chiusure al buio.
> - **Caso reale che ha originato la regola** (New Zago, 13/07/2026): bonifici a SP Contabile (322/E,
>   2.750) e Studio Poli (SP_54, 3.057,74) arrivati come `DISPOSIZIONE - FILIALE DISPONENTE 2430 …
>   IMPORTO BONIFICI: 2.750,00 IMPORTO COMMISSIONI: 1,75` — nessun nome, nessun numero, importo lordo:
>   i tre matcher precedenti non potevano scattare. La migration 110 chiude esattamente questo buco.
> - Migration: `supabase/migrations/20260724_110_reconcile_anonymous_flux_and_commission.sql`
>   (+ `_ROLLBACK`). ⚠️ REGOLA #0: applicare a mano su **NZ + Made + Zago**; dopo l'apply, per lo storico:
>   `SELECT public.rerun_amount_reconciliation();`
> - **Passo 2 — migration `supabase/migrations/20260713_090_credit_note_links_reconcile.sql`**: tabella
>   `payable_credit_note_links` + `reconcile_movement` (consuma le NC collegate, aggancia a fatture chiuse
>   a mano) + `undo_reconcile_movement` (riapre le NC) + `try_match_bank_transaction` (esclude dall'auto
>   le fatture con NC pending). **✅ APPLICATA e VERIFICATA su NZ + Made + Zago (2026-07-14)** — testata
>   end-to-end con transazioni di rollback (compensazione, undo, aggancio a fattura chiusa a mano,
>   esclusione auto-match). **NB fondamentale**: la compensazione NC deve passare per `amount_paid`
>   (non per `amount_remaining`): il trigger `update_payable_status` ricalcola sempre
>   `amount_remaining = gross - amount_paid` e sovrascriverebbe qualsiasi set diretto di `amount_remaining`.
>   Guida utente: `GUIDA_DISTINTA_Sabrina.md` + in-app (HelpPanel voce `/scadenzario`).

> ## 📌 REGOLA — LEGGERE SEMPRE PRIMA DI TOCCARE IL CICLO PASSIVO
>
> Questo file va **letto per intero prima di qualsiasi lavoro sulla sezione Ciclo Passivo**
> (Fornitori, Fatturazione, Scadenzario) e prima di modificare fornitori, payables,
> `electronic_invoices`, il bridge A-Cube o le scadenze. Contiene le regole di piano
> pagamento, l'aggancio fornitore↔fattura **per P.IVA**, e i casi noti (es. Estenergy→Hera).
> Se una richiesta contraddice queste regole, **fermarsi e spiegare** invece di eseguire.

## Regola aggancio fornitore ↔ fattura (A-Cube / manuale)
- Il fornitore si crea/associa **per PARTITA IVA** (`sender_vat`), NON per nome. Il bridge
  `sync_acube_sdi_passive_to_payable` cerca `partita_iva = sender_vat OR vat_number = sender_vat`;
  se esiste lo riusa (nessun duplicato), altrimenti lo crea con il nome della prima fattura vista.
- Conseguenza: un fornitore che ha **cambiato ragione sociale** resta in anagrafica col nome
  vecchio ma con la stessa P.IVA (le nuove fatture si agganciano comunque). Cercare per nome
  può far sembrare un fornitore "assente" quando invece c'è: **verificare sempre per P.IVA**.
- Un fornitore creato **a mano senza P.IVA** genererà un DUPLICATO alla prima fattura A-Cube
  (che porta la P.IVA e non trova match per nome). Inserire sempre la P.IVA reale.

## Resoconto popolamento piani pagamento — 2026-07-09 (solo NZ)
Origine: file `SCADENZE_NEW_ZAGO_2026_x_code.xlsx` (6 fogli Giu→Nov, 508 righe), aggregato
per fornitore su **tutti i mesi** (non solo Giugno) per dedurre metodo/base/rate/banca.
- **92 fornitori** aggiornati con `payment_method`/`default_payment_method`, `payment_base`
  (DF/FM), `prima_scadenza_gg`, `numero_rate`, `payment_bank_account_id` (solo per metodi
  che richiedono banca). Solo UPDATE di campi vuoti, nessuna cancellazione.
- **HERA COMM S.p.A.** (P.IVA `03819031208`): era in anagrafica come **"Estenergy S.p.A."**
  (Estenergy confluita in Hera Comm, stessa P.IVA). Rinominato → HERA COMM e piano
  **RID / data fattura / 20gg / MPS**. 51 payables storici restano agganciati per P.IVA.
- **HUMATICS S.r.l. - Società Unipersonale** = nuova denominazione di **SYS-DAT Verona
  S.r.l.** (stessa società, P.IVA `03268520230`, già in anagrafica con 8 fatture + 9
  scadenze storiche). Il record SYS-DAT è stato **rinominato → HUMATICS** (P.IVA e storico
  invariati); piano **RI.BA / fine mese / 30gg / MPS**. Le fatture "Humatics" da A-Cube si
  agganciano per P.IVA. Il record "Humatics" creato a mano il 09/07 (senza P.IVA) era un
  duplicato → **soft-delete** (`is_deleted=true`).
- Banche NZ: MPS `e351d628-a150-4769-b965-9514deab48a3`, BCC `e3e82fb2-2661-4525-a25e-8960fc1123dc`,
  Intesa `549a983d-3fe1-4f9a-aed8-d5d5ed14f123`. `CASSA *` = contanti (nessuna banca).
- **Nota parità-tenant**: questo è **DATO specifico dei fornitori di New Zago** → NON si
  replica su Made/Zago (hanno fornitori/P.IVA diversi). La parità #0 vale per codice/migration,
  non per questi valori-dato.

---

Stato: **migration DB pronta** (`supabase/migrations/20260709_087_supplier_payment_plan_and_anomalies.sql`),
edge/import e frontend **da fare** (step successivi). Nessun dato toccato.

## Regole concordate (Patrizio)
- Si applica **solo alle fatture con data emissione ≥ 31/07/2026** e **solo se il fornitore ha il piano impostato**. Il **pregresso non si tocca** (nessun ricalcolo retroattivo).
- L'anomalia è a livello **fornitore** (la fattura ne fa capo). Sistemato il fornitore → si risolve per tutte le sue fatture.
- Badge rosso numerato su **Fatturazione** = n° fornitori con anomalia **aperta** (stato condiviso azienda). Sparisce **solo** quando `stato='risolta'`, per tutte le operatrici.
- **Banca di pagamento** sul fornitore, obbligatoria a seconda del metodo (serve per lo storno nelle simulazioni cashflow):
  - obbligatoria: `riba_*`, `rid`, `sdd_core`, `sdd_b2b`, `carta_credito`, `carta_debito`
  - facoltativa: `bonifico_*` (si sceglie al pagamento), `contanti`, `compensazione`, `mav`, `rav`, `bollettino_postale`, `f24`

## Algoritmo scadenze (già in `fn_supplier_installment_schedule`)
Importo per rata = **totale ÷ n° rate** (parti uguali, l'ultima assorbe l'arrotondamento).
Per ogni rata `i` (1..N):
- **DATA FATTURA (DF)** → a giorni: `due = emissione + (prima_gg + 30·(i−1))`
- **FINE MESE (FM)** → a mesi solari: `due = ultimo giorno del mese (emissione + N mesi)`, con `N = prima_gg/30 + (i−1)`

Esempi verificati:
| Config | Emiss. | Scadenze |
|---|---|---|
| FM 30/60/90 · 1200 | 30/06/26 | 31/07 · 31/08 · 30/09 (400) |
| DF 30/60/90 · 1200 | 30/06/26 | 30/07 · 29/08 · 28/09 (400) |
| FM 30gg · 900 | 31/01/26 | **28/02/26** |
| FM 30gg · 900 | 31/01/28 (bisestile) | **29/02/28** |
| FM 30gg | 17/07/26 | 31/08/26 |

## Config fornitore (colonne aggiunte a `suppliers`)
- `payment_method` (già esistente, enum `payment_method`)
- `payment_base` = `data_fattura` | `fine_mese`
- `prima_scadenza_gg` (30/60/90…)
- `numero_rate` (1,2,3…)
- `payment_bank_account_id` → FK `bank_accounts(id)`

## Segnalazioni: tabella `payment_import_anomalies`
Stato condiviso azienda (`aperta`/`risolta`), una sola aperta per `(company, fornitore, tipo)`.
Tipi + "come risolvere" (`come_risolvere`):
| anomaly_type | quando | come risolvere |
|---|---|---|
| `metodo_mancante` | fornitore senza metodo | Fornitori › [nome] → imposta metodo |
| `banca_mancante` | metodo che richiede banca (RI.BA/carta/RID) ma manca | assegna la banca di pagamento |
| `piano_incompleto` | RI.BA senza base/giorni/n° rate | completa il piano |
| `importo_non_quadra` | somma rate ≠ lordo / lordo assente | verifica importo fattura |
| `fornitore_non_riconosciuto` | fattura da fornitore non in anagrafica | crea/associa il fornitore |

Helper `fn_supplier_config_anomaly(supplier_id)` ritorna i primi tre tipi (o NULL). Gli altri due (`importo_non_quadra`, `fornitore_non_riconosciuto`) li rileva il flusso di import.

## STATO IMPLEMENTAZIONE

✅ **FATTO in questo branch:**
- Migration `087` — schema (4 campi fornitore, tabella anomalie, funzioni pure di calcolo/anomalia). **Applicata e verificata su NZ + Made + Zago.**
- Migration `088` — motore anomalie: `rpc_refresh_payment_anomalies()` (apre/risolve le anomalie di config per i fornitori con fatture ≥ 31/07) e `rpc_resolve_payment_anomaly()`. **Da applicare a mano su NZ + Made + Zago** (query in coda al file).
- Frontend:
  - `Fornitori.tsx` — form fornitore con i 4 campi (base DF/FM, 1ª scadenza gg, n° rate, banca) + avviso banca-obbligatoria per metodo. Deep-link `?edit=<id>`.
  - `Sidebar.tsx` + `Layout.tsx` — **badge rosso numerato** su Fatturazione = anomalie aperte (aggiornamento live all'evento `fatt-anomalia-risolta`).
  - `components/PaymentAnomaliesPanel.tsx` + `Fatturazione.tsx` — pannello segnalazioni con descrizione + "come risolvere" + "Vai al fornitore" + "Risolto".
- `npm run build` OK; nuovi file type-clean.

✅ **FATTO — Generazione rate all'import (migration 089, applicata su NZ+Made+Zago):**
Scoperta: il bridge A-Cube (`sync_acube_sdi_passive_to_payable`) **genera già** le
scadenze dallo scadenzario dell'XML (DatiPagamento) quando presente. La 089
aggiunge, **solo nel ramo fallback** (XML senza scadenzario), la generazione dal
**piano fornitore** via `fn_supplier_installment_schedule()`:
- guardia `emissione >= 31/07/2026` (oggi 0 fatture → zero effetto sul pregresso)
- **opt-in per fornitore**: agisce solo se `payment_base` e `numero_rate` sono
  impostati; senza piano il comportamento resta identico a oggi (rata unica)
- assegna metodo e `payment_bank_account_id` del fornitore; `acube_uuid` solo sulla
  rata 1; `on conflict do nothing` anti-duplicato
- il ramo XML-con-scadenzario (n>=2) **non è toccato**.

Validazione: funzione ridistribuita senza errori su tutti e 3 i tenant; vincoli di
unicità payables compatibili (installment_number distinto). La verifica end-to-end
avverrà sulla prima fattura reale ≥ 31/07 da fornitore configurato.

Nota: le anomalie di configurazione (metodo/banca/piano mancanti) vengono comunque
rilevate e mostrate dal badge/pannello Fatturazione (087/088).
Aggancio al flusso che crea i payables dall'import SDI A-Cube (bridge `trg_sync_acube_sdi_passive` / edge `acube-cf-sync-invoices`). Logica:
1. Solo se `electronic_invoices.invoice_date >= '2026-07-31'`.
2. Risali al fornitore. Se non riconosciuto → anomalia `fornitore_non_riconosciuto`.
3. `fn_supplier_config_anomaly(supplier_id)`: se != NULL → apri quella anomalia (upsert su indice unico), **non** generare rate.
4. Altrimenti: `fn_supplier_installment_schedule(...)` → crea N righe `payables` con `installment_number/installment_total/due_date`, e `payment_bank_account_id` dalla banca del fornitore (per riba/carta).
5. Se la somma rate ≠ gross (post arrotondamento) o gross assente → anomalia `importo_non_quadra`.
6. Alla risoluzione (operatrice sistema + "Rigenera scadenze"): se `fn_supplier_config_anomaly` ora è NULL e le rate quadrano → set `stato='risolta'`.

Nota: NON modificare il bridge 029 direttamente (come da 053); usare flusso additivo/separato e attivo solo per emissione ≥ 31/07.

### B) Frontend
- **Form fornitore**: 4 campi (base DF/FM, prima scadenza gg, n° rate, banca) con validazione banca-obbligatoria per metodo.
- **Badge rosso** su voce sidebar *Fatturazione* = `count(payment_import_anomalies where stato='aperta')`.
- **Pannello anomalie** in Fatturazione: lista con `descrizione` + `come_risolvere`, link al fornitore, bottoni **Rigenera scadenze** / **Segna risolto**.

## Applicazione (Regola #0 — parità tenant)
La migration 087 va applicata **a mano su NZ + Made + Zago** dal dashboard Supabase. È additiva, idempotente, non distruttiva.

---

## Nota di sessione 03/09/2026 (sera) — le distinte RI.BA MPS al 31/08 chiudono il cerchio

Sabrina ha mandato i PDF «Distinta Di Ritiro Effetti Pagati» presi dal portale
MPS. Sono il documento che mancava per tutta la giornata: 7 distinte create il
31/08/2026 sul c/c 000000621460, 36 disposizioni, 120.568,97 €. Il dettaglio
parsato sta in `docs/riba_effetti_31082026.csv`, l'intervento in
`supabase/migrations/NZ_ONLY_20260903_168_distinte_riba_31082026.sql`.

**Il buco non era un buco.** Le 36 disposizioni hanno due scadenze: 32 effetti
per 113.812,33 € al 31/08 e 4 effetti per 6.756,64 € al 10/09. In banca il 31/08
ci sono 4 addebiti «EFFETTI RITIRATI» per 113.825,13 €. La differenza di 12,80 €
sono le spese di incasso: **0,40 € per effetto**, 32 effetti. Fine della
discrepanza che nessuna combinazione dei dati a sistema spiegava.

**La banca raggruppa a blocchi da 10, non per distinta.** I 4 addebiti valgono
10 + 10 + 10 + 2 effetti e mescolano distinte diverse. Per sapere quale effetto
sta in quale addebito si cerca la partizione esatta dei 32 importi nei 4 totali
al netto delle spese: la soluzione è unica e ha senso anche a occhio (il blocco
da 6.896,19 € raccoglie tutte le BRT e le REALCART).

**Come si aggancia un effetto alla rata giusta.** Ogni causale MPS nomina la
fattura: «SALDO FATT 2548», «ACC FATT 4039 MENO NC 4084 E 4107», «SALDO FT 443 A
792-NC 56 A 120». Per ogni documento citato si prende **la rata aperta più
vecchia** di quella fattura. È questo il criterio che scioglie l'ambiguità delle
rate accavallate sulla stessa data, cioè il motivo per cui GRUPPO F.B e MIAN
erano rimasti fuori dalle chiusure del pomeriggio. Con questo criterio i conti
tornano al centesimo: GRUPPO F.B 40.026,70 € su 14 effetti, MIAN 31.806,21 €
contro 31.806,23 € dichiarati (2 centesimi di arrotondamento nelle rate).

**Regola operativa che ne esce.** Una causale RI.BA che dice «MENO NC» va letta
come compensazione: fattura più note di credito citate, e il netto deve dare
l'importo dell'effetto. Se non torna, l'aggancio è sbagliato: non forzarlo.

**Chiusura provvisoria, poi definitiva.** Le 43 righe chiuse in giornata come
provvisorie (BRT, REALCART, TANESINI, TOP CASH, EGO, GLS, SHINE, NOIR) sono
passate a definitive con `bank_transaction_id` del movimento che le ha pagate.
Il flag `is_provisional_paid` serve esattamente a questo: reggere finché non
arriva il documento, poi sparire.

**Presentata non vuol dire pagata.** 6 righe sono state RIAPERTE perché il loro
effetto scade il 10/09 e il denaro non è ancora uscito: ARCO V1/0053135,
GLADIOTEX 442, AXET 006199, HUMATICS 26102275 / 26102341 / 26102421, per
6.756,64 €. Tre erano state chiuse per eccesso di zelo nel pomeriggio, una
(AXET) in una sessione precedente. Da tenere a mente: un effetto in distinta
resta debito fino alla sua scadenza, e la `due_date` va allineata a quella.

**Le distinte ora sono a sistema.** `riba_distinte` (7 righe) e
`riba_distinta_lines` (36 disposizioni con l'array dei payables collegati) non
erano mai state usate. Adesso contengono il documento vero: ogni totale coincide
al centesimo con quello dichiarato dalla banca.

Dopo l'intervento: debito GRUPPO F.B da 103.945,88 a 63.919,18 €, MIAN da
141.322,99 a 109.516,78 €. Backup completo in `public._bkp_riba_effetti_31082026`
(85 righe), rollback a fianco della migration.

### Aggiornamento 03/09/2026 — SHINE, le fatture di giugno slittano a settembre

Sabrina conferma: le dieci fatture SHINE di giugno (1103, 1107, 1142, 1187,
1194, 1200, 1238, 1256, 1257, 1286) non erano nelle distinte del 31/08 perché
la RI.BA non è stata presentata. Slittano a settembre, 14.893,35 €.

Spostata la sola prima rata da 31/08 a 30/09, tracciando con `original_due_date`,
`postponed_to` e `postpone_count`. Le rate successive restano dove sono:
l'informazione riguarda la presentazione saltata, non il piano di pagamento.

**Da qui nascono le rate accavallate.** Al 30/09 SHINE si ritrova con due rate
per ognuna di quelle dieci fatture, 23 righe per 29.583,57 €. È lo stesso
meccanismo dei 39 piani con rate sulla stessa data: non un errore di
`fn_supplier_installment_schedule`, ma una presentazione mancata che sposta una
rata sopra la successiva. Quando si vede quel pattern, prima di toccare le date
conviene chiedere se una presentazione è saltata.

Dettagli in `supabase/migrations/NZ_ONLY_20260903_169_shine_giugno_slitta_settembre.sql`.

## Ritenuta d'acconto (03/09/2026, migration 170)

Le fatture dei professionisti (studi associati, geometri, consulenti) portano
`DatiRitenuta` nell'XML: al fornitore va il totale documento meno la ritenuta,
la ritenuta la versa l'azienda con l'F24. Prima la scadenza nasceva al lordo e
il motore di riconciliazione non trovava mai il bonifico (Signorini 191:
scadenza 8.098,75, bonifico 6.822,15, differenza 1.276,60 = ritenuta 20%).

**Convenzione unica, valida ovunque:**
- `payables.gross_amount` = DOVUTO AL FORNITORE, già al netto della ritenuta
  (è l'importo che esce dalla banca).
- `payables.withholding_amount` = quota di ritenuta della rata.
- totale documento della rata = `gross_amount + withholding_amount`.
- `electronic_invoices.gross_amount` resta il totale documento;
  `electronic_invoices.withholding_amount` = ritenuta letta dall'XML.

Così motore di riconciliazione, distinte, chiusure, residui e cashflow, che
ragionano su `gross_amount` / `amount_remaining`, restano invariati. Cambia
solo la creazione delle scadenze: `fn_invoice_to_payable`,
`sync_acube_sdi_passive_to_payable` (con `fn_invoice_withholding` XML +
fallback payload JSON) e l'import XML frontend (`transformInvoiceToRecords`).
Le rate dell'XML sono accettate se la loro somma è il netto (standard SDI) o
il lordo (riproporzionate); la ritenuta si ripartisce pro-quota.

Backfill NZ: 8 fatture (Rubini, Impresa Valdarno, Marchetti, Signorini,
Boschetti, Valia, Rocciola, Scandella), backup in
`payables_bak_ritenuta_20260903`. Made e Zago: nessuna fattura con ritenuta.
