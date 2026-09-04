# specchietto incassi giornaliero per outlet: analisi di fattibilità

> Documento di analisi (nessuna modifica al codice). Data: 2026-09-03.
> Base: file `SPECCHIETTI_INCASSI_2026.xlsx` fornito da Patrizio, codice del repo, DB vivo dei 3 tenant letto via connettore Supabase.

---

## 1. cosa chiede il modello Excel

Il foglio è un mese per scheda, una riga per giorno, con queste colonne:

| colonna Excel | significato | natura |
|---|---|---|
| DATA | giorno di chiusura | chiave |
| TOTALE CORRISPETTIVI | battuto in cassa nel giorno | totale lordo IVA |
| CONTANTI | incasso in contanti | mezzo di pagamento |
| POS MPS | incasso carte su terminale MPS | mezzo di pagamento |
| POS MPS AMEX | American Express via MPS | mezzo di pagamento |
| POS BCC | incasso carte su terminale BCC | mezzo di pagamento |
| POS BCC AMEX | American Express via BCC | mezzo di pagamento |
| PAY BY LINK | pagamento a distanza via link | mezzo di pagamento |
| FATTURE | vendite con fattura | mezzo di pagamento o documento |
| BONIFICO | incasso via bonifico | mezzo di pagamento |
| SPESE CASSA + DESCRIZIONE | piccole uscite pagate con i contanti del negozio | movimento di cassa |
| VERSAMENTI + CAUSALE | contanti portati in banca | movimento di cassa |
| FONDO CASSA | contante rimasto in negozio a fine giornata | saldo |
| riga 38 | somma mensile di ogni colonna | totale |

Due regole implicite che il foglio non impone ma che l'applicazione può far rispettare:

- **quadratura del giorno**: totale corrispettivi = contanti + POS (tutti) + pay by link + fatture + bonifico
- **quadratura del contante**: fondo cassa di stasera = fondo cassa di ieri + contanti di oggi − spese cassa − versamenti

Sono queste due formule a trasformare uno specchietto compilato a mano in un dato verificabile.

---

## 2. cosa esiste già nel gestionale (stato reale al 3 settembre)

### 2.1 ricavi

- `daily_revenue` esiste dal baseline con colonne `gross_revenue`, `net_revenue`, `cash_amount`, `card_amount`, `other_amount`, vincolo unico (company, outlet, giorno) e RLS per outlet. È **vuota su tutti e 3 i tenant**. Nessun form la scrive: l'unico scrittore è l'import CSV, che oggi è rotto (inserisce una colonna `vat_amount` inesistente e un valore enum `corrispettivi_import` non valido, `src/lib/parsers/importEngine.ts:686-687`).
- Chi la legge: tab «Corrispettivi» della pagina Outlet, Dashboard (ultimo giorno per outlet), Margini per categoria, Cashflow prospettico (usa il dato giornaliero se c'è, altrimenti il budget prorata), Fatturazione tab «Corrispettivi». Se la tabella si popola, queste pagine si accendono da sole.
- **I ricavi mensili veri** stanno in `budget_confronto`, `entry_type = 'cons_monthly'`, con un conto per outlet (510107 Valdichiana, 510108 Barberino, 510110 Franciacorta, 510112 Palmanova, 510114 Brugnato, 510122 Valmontone, 510124 Torino). Li inserisce Lilian a mano nella matrice «Inserimento rapido» di Budget e Controllo, tramite la RPC `save_budget_confronto_cell`. Il mapping outlet → conto è già dinamico (`chart_of_accounts.outlet_link`). Su NZ il consuntivo 2026 è granitico fino a luglio.
- La regola «ricavi = 510100» in CLAUDE.md descrive il seed 2025, non il dato vivo 2026. La pipeline `refresh_budget_consuntivo` (che aggrega `daily_revenue` in `budget_entries.actual_amount` sul 510100) non alimenta nessuna pagina che l'utente guarda.

### 2.2 utenti e accessi per outlet

- Ruoli nell'enum DB: `super_advisor, cfo, coo, ceo, contabile, budget_approver, viewer`. **Non esiste un ruolo cassiera.** Il menu di Impostazioni offre `store_manager` e `operatrice`, ma non sono nell'enum: l'invito crea l'utente auth e poi fallisce sul profilo (bug vivo, `admin-manage-user/index.ts:30`).
- Esiste già `user_outlet_access` (utente, outlet, `can_write`) con le funzioni `has_outlet_access()` e `has_outlet_write()`. La policy di lettura su `outlets` la usa: un utente non super_advisor senza righe **vede zero outlet**. Il frontend però non gestisce questa tabella (i campi in Impostazioni sono morti).
- Le rotte non hanno controllo di ruolo: `ProtectedRoute` verifica solo la sessione. La difesa reale è la RLS. Per una cassiera serve una rotta dedicata e un reindirizzo forzato.
- Login solo email + password. Nessun PIN, nessun magic link.
- Layout mobile esistente (drawer, bottom nav a 4 tab non filtrata per ruolo, `h-dvh`).

### 2.3 banche e riconciliazione

- `bank_transactions` è la fonte unica (A-Cube ogni 6 ore + nightly `run_daily_reconciliation` alle 05:45 UTC). Nessuna colonna outlet sui movimenti; l'outlet è deducibile solo dal conto.
- La riconciliazione esistente lavora **solo sulle uscite** (fornitori, F24). Sulle entrate c'è un solo meccanismo, `close_incoming_movements`, in dry run e non schedulato, che classifica per natura (`incassi_pos`, `versamenti`, `finanziarie`) senza abbinare a nulla. Le note di progetto dichiarano il ciclo attivo come gap aperto.
- **Dato chiave letto dal DB NZ**: gli accrediti POS in banca contengono già l'identificativo del terminale.

| canale | conto | come si riconosce in causale | osservato ago-set 2026 |
|---|---|---|---|
| POS MPS | MPS (IBAN …621460) | `ACCREDITO POS - COD.SIA:6181087-000NN` | 7 codici terminale: 00002, 00004, 00007, 00008, 00009, 00011, 00013 (uno per outlet) |
| Amex | BCC Valdarno (IBAN …017334) | `Accredito per incassi GG.MM.AAAA <nome outlet> 6181087000NN American Express` | codici 00001 (Vicolo), 00006 (Franciacorta), 00010 (Brugnato), 00012 (Valmontone), 00014 (Settimo/Torino) |
| versamento contante | MPS | `VERS. CONTANTE SELF SERV. - VERSAMENTO DA ATM 01030-1745-…` e `…01030-2121-…` | due sportelli ATM distinti |
| versamento contante | Banco Fiorentino (IBAN …221949) | `Versamento contante - cassa contin <data>` | un outlet |

- Ritmo di accredito MPS: da 2 a 7 accrediti per terminale al giorno (uno per circuito), valuta D+1; il lunedì cumula venerdì, sabato e domenica. Questo definisce la finestra di matching.
- Ordine di grandezza: su NZ da giugno gli accrediti POS sono 1.741 movimenti per 1,22 M€, i versamenti 112 per 249 k€. Il confronto mese per mese tra (POS + versamenti) e consuntivo ricavi dà un rapporto fra 1,16 e 1,36, coerente con corrispettivi lordi IVA (×1,22) più lo sfasamento di accredito. Il consuntivo mensile è quindi **netto IVA**, lo specchietto è **lordo**.

### 2.4 mail e schedulazioni

- Invio mail già in produzione via **Resend** nella Edge Function `send-distinta-email` (chiave `RESEND_API_KEY` come secret di funzione sui 3 tenant, non nel Vault; accetta il token service_role, quindi è invocabile da un cron). Solo testo semplice, nessun template.
- Schedulazioni: `pg_cron` per tenant (7 job attivi) con `net.http_post` verso le Edge Function e segreto condiviso nel Vault (`autofix_cron_secret` è il modello). La funzione Netlify schedulata è dismessa. Nessuna colonna fuso orario o orario nelle impostazioni aziendali: i cron sono in UTC.
- Destinatari mail oggi in `companies.settings.email_scadenzario`; la scrittura sovrascrive l'intero JSON (`ScadenzarioSmart.tsx:4809`), da correggere prima di aggiungere una seconda chiave.
- Tabella `notifications` (campanella in-app) usabile per gli avvisi «outlet X non ha chiuso».

---

## 3. progetto proposto

### 3.1 modello dati (additivo, nessun DROP)

**`outlet_payment_channels`** (canali di incasso configurati per outlet, sostituiscono le colonne fisse dell'Excel)

| campo | note |
|---|---|
| company_id, outlet_id | tenant attivo, mai hardcoded |
| label | «POS MPS», «POS BCC Amex», «Pay by link»… come appare alla cassiera |
| kind | `contanti`, `pos`, `pos_amex`, `paybylink`, `fattura`, `bonifico`, `altro` |
| bank_account_id | conto su cui accredita (nullable per contanti) |
| terminal_code | es. `6181087-00002` o `618108700006`, chiave per il matching bancario |
| settlement_days | giorni lavorativi di accredito (MPS: 1) |
| sort_order, is_active | ordine colonne e dismissione senza cancellare |

Perché non colonne fisse: Made e Zago hanno banche e POS diversi; un canale in più (Satispay, un secondo terminale) non deve richiedere una migration. Per NZ si caricano i 9 canali dell'Excel per ciascuno dei 7 outlet di vendita; «Sede / Magazzino» non ha canali e quindi non ha chiusura.

**`outlet_daily_closings`** (una riga per outlet e giorno)

| campo | note |
|---|---|
| company_id, outlet_id, closing_date | unique |
| status | `bozza` → `confermata` → `verificata` (verificata = quadrata con la banca) |
| total_receipts | totale corrispettivi battuto (lordo IVA) |
| cash_expenses, cash_expenses_note | spese cassa + descrizione |
| cash_deposit, cash_deposit_note | versamento + causale |
| cash_float_declared | fondo cassa contato dalla cassiera |
| cash_float_expected | calcolato: fondo di ieri + contanti − spese − versamento |
| cash_difference | dichiarato − atteso (ammanco o eccedenza) |
| receipts_difference | totale − somma dei canali |
| closed_by_name, created_by, confirmed_at, confirmed_by, reopened_* | tracciabilità |
| notes | libero |

**`outlet_daily_closing_lines`** (closing_id, channel_id, amount): un importo per canale. Le colonne dell'Excel diventano righe.

**`closing_bank_matches`** (closing_line_id oppure closing_id per i versamenti, bank_transaction_id, amount, match_type, matched_at): l'abbinamento con la banca senza toccare la struttura di `bank_transactions`.

**`outlet_daily_closing_attachments`** (foto degli scontrini di chiusura, vedi §3.8): closing_id, company_id, outlet_id, kind (`rt_chiusura`, `rt_rapporto_finanziario`, `rt_trasmissione`, `pos_chiusura`, `altro`), storage_path, uploaded_by, extraction_status (`in_attesa`, `letta`, `da_rivedere`, `fallita`), extracted jsonb, extraction_model, extracted_at. Bucket Storage privato `cash-closings` con policy come il bucket `media` (owner scoped + accesso outlet).

**`daily_report_settings`** (per company: enabled, send_time locale, timezone `Europe/Rome`, recipients text[], remind_missing_at) e **`daily_report_log`** (data, esito, destinatari, errori).

**Proiezione in `daily_revenue`**: alla conferma di una chiusura, una funzione SQL fa upsert in `daily_revenue` (`gross_revenue` = totale, `cash_amount` = contanti, `card_amount` = somma POS, `other_amount` = resto, `net_revenue` = lordo / (1 + aliquota), `source = 'manuale'`). Così le 5 pagine che già leggono `daily_revenue` si popolano senza toccarle, e il trigger esistente marca il consuntivo come da aggiornare.

RLS: pattern di casa (`get_my_company_id()` + ruolo), con in più `has_outlet_access(outlet_id)` sulle chiusure e `can_write` per la scrittura del ruolo cassa. Nessuna policy DELETE (NO DATA LOSS): una chiusura sbagliata si riapre e si corregge, non si cancella.

### 3.2 utente cassiera

- Nuovo valore enum `operatore_cassa` (una sola migration `ALTER TYPE … ADD VALUE`, fuori transazione, sui 3 tenant). Nello stesso intervento si tolgono dal menu i due ruoli fantasma `store_manager` e `operatrice`.
- **Un account per outlet** (es. `cassa.valdichiana@…`), condiviso dal personale del negozio, con un campo «chi ha chiuso» nel form. È la scelta più semplice da gestire per Lilian e per il negozio; un account a persona resta possibile con la stessa struttura (più righe in `user_outlet_access`).
- Creazione dall'attuale sezione Utenti di Impostazioni: ruolo `operatore_cassa` + scelta outlet, che scrive in `user_outlet_access` con `can_write = true`. Oggi quel campo esiste nel form ma non salva nulla: va collegato.
- Cosa vede questo ruolo: **solo** la pagina «Chiusura cassa» del proprio outlet. Il login la apre direttamente; la sidebar e la bottom nav mostrano solo quella voce e il profilo; qualunque altra rotta reindirizza lì. La RLS garantisce che, anche via URL, non veda dati di altri outlet o dell'azienda (le policy company-wide di sola lettura vanno riviste per escludere il nuovo ruolo dalle tabelle sensibili: fornitori, banche, budget, personale).
- Password reset già gestito dal flusso esistente.

### 3.3 la schermata della cassiera (mobile first, un solo compito)

1. In alto: nome outlet, data (default oggi, si può scegliere ieri; giorni più vecchi solo se non confermati).
2. Primo passo: **«Fotografa le chiusure»**. La fotocamera dello smartphone si apre direttamente (`<input type="file" accept="image/*" capture="environment" multiple>`), la cassiera scatta gli scontrini di fine giornata (chiusura del registratore, chiusura POS, esito trasmissione) e le foto si caricano subito. In pochi secondi i campi si precompilano con i valori letti dalle foto (vedi §3.8); lei li controlla e integra ciò che la carta non contiene.
3. Campi grandi, tastiera numerica (`inputmode="decimal"`), virgola accettata, nell'ordine dell'Excel: totale corrispettivi, poi un campo per ogni canale attivo dell'outlet, spese cassa con descrizione, versamento con causale, fondo cassa contato. Accanto a ogni campo letto dalla foto compare l'etichetta «dalla foto» con il valore; se lei scrive un numero diverso la differenza resta visibile.
4. Mentre scrive: riga «somma mezzi di pagamento» e «differenza» in tempo reale, verde se zero, rossa altrimenti; «fondo cassa atteso» calcolato dal giorno prima, e la differenza rispetto a quello contato.
5. Due pulsanti: «Salva bozza» e «Conferma chiusura». La conferma con differenza diversa da zero chiede una nota obbligatoria (non blocca: la cassa reale può non quadrare, ma va spiegato).
6. Dopo la conferma il giorno diventa in sola lettura con il pulsante «Chiedi riapertura» (notifica in-app a Lilian, che riapre da amministrazione).
7. Sotto: calendario del mese con i giorni fatti in verde e i mancanti in rosso, tocca e apri. È l'equivalente dello sguardo sul foglio Excel e spinge a non saltare giorni.
8. Giorni di chiusura del negozio: pulsante «Negozio chiuso» che registra una chiusura a zero, così il mese non ha buchi ambigui.

Lato amministrazione (super_advisor, contabile, cfo, ceo): pagina «Incassi giornalieri» con la griglia mese × outlet identica al foglio Excel (colonne = canali, riga 38 = totali), filtro outlet e mese, esportazione xlsx nello stesso formato per il commercialista, stato di ogni giorno (bozza, confermata, verificata con la banca, mancante) e le differenze di cassa evidenziate.

### 3.4 dai giorni ai ricavi mensili

- In «Inserimento rapido» di Budget e Controllo, accanto alla riga Consuntivo, un pulsante «Proponi da chiusure cassa» che per ogni outlet mostra: somma dei totali confermati del mese, giorni coperti su giorni del mese, importo netto IVA proposto. Lilian accetta cella per cella (o tutte) e la scrittura passa dalla RPC esistente `save_budget_confronto_cell` con `stato = 'granitico'`. Nessuna scrittura automatica: il consuntivo resta suo, la chiusura cassa lo alimenta.
- Scorporo IVA: parametro per company (default 22 %) in `daily_report_settings` o nelle impostazioni aziendali. I numeri letti dal DB confermano che il consuntivo attuale è netto.
- Da chiarire con Patrizio se la colonna FATTURE fa parte del totale corrispettivi (fiscalmente le vendite con fattura non sono corrispettivi) o se è un canale a sé. Il modello regge entrambi i casi: basta un flag `counts_in_total` sul canale.

### 3.5 utilità per ogni sezione

| sezione | cosa ottiene |
|---|---|
| Dashboard | incassi di ieri per outlet, mese in corso vs preventivo `rev_monthly`, outlet che non hanno chiuso |
| Outlet (tab Corrispettivi) | serie giornaliera vera, ticket medio se si aggiunge il numero scontrini (campo opzionale) |
| Budget e Controllo | proposta consuntivo mensile con copertura giorni |
| Conto Economico, Confronto Outlet | consuntivi granitici più tempestivi e meno errori di trascrizione |
| Cashflow prospettico | già usa `daily_revenue` per gli incassi: passa dal prorata al reale |
| Banche | riconciliazione delle entrate (oggi 0 %), contante non ancora versato per outlet |
| Prima nota | versamenti attesi vs versati |
| Produttività / Personale | incasso per ora lavorata e per addetto (fase successiva) |

### 3.6 mail serale

- Configurazione per tenant in `daily_report_settings`: orario locale (es. 21:30), destinatari (lista), eventuale orario di sollecito (es. 20:30 agli outlet che non hanno ancora confermato).
- Motore: un job `pg_cron` ogni 15 minuti (`*/15 * * * *`) chiama la funzione SQL `daily_cash_report_tick()`, che converte `now()` in `Europe/Rome`, verifica se è l'orario configurato e se il report di oggi non è già in `daily_report_log`, e in tal caso fa `net.http_post` verso la nuova Edge Function `daily-cash-report-send` con segreto condiviso nel Vault (stesso schema di `ticket_autofix_run`). La verifica in ora locale risolve il problema dell'ora legale che oggi fa slittare gli altri cron.
- Contenuto della mail (HTML semplice, generato dalla Edge Function): una riga per outlet con totale, contanti, POS, altri canali, spese, versamento, fondo cassa e differenza; outlet mancanti in evidenza; totale giornata azienda; progressivo mese vs preventivo; link alla pagina amministrativa. Nessun allegato in prima fase; l'xlsx mensile si scarica dall'app.
- Invio via Resend riusando `RESEND_API_KEY`; consigliato spostare la chiave nel Vault come tutti gli altri segreti. Esito loggato in `daily_report_log` e, in caso di errore, notifica in-app critica.
- Sollecito opzionale: stessa `tick()`, all'orario di sollecito crea una notifica in-app per gli account cassa senza chiusura del giorno.

### 3.7 verifica con banche e movimenti

Tre livelli, dal più semplice al più fine.

1. **Classificazione**: attivare in produzione (dopo conferma binaria di Patrizio, non è distruttiva ma tocca 7.766 righe) la già pronta `close_incoming_movements`, così ogni entrata è `incassi_pos`, `versamenti` o `finanziarie`.
2. **Abbinamento POS**: per ogni canale con `terminal_code`, sommare gli accrediti in banca per (terminale, data accredito) e confrontarli con l'importo del canale nelle chiusure del giorno precedente, o dei tre giorni precedenti se l'accredito è di lunedì. Tolleranza configurabile (le commissioni MPS sembrano addebitate a parte, da verificare su un mese). Esito sulla riga di chiusura: «accreditato», «in attesa», «differenza di X €». Scrittura in `closing_bank_matches`, `bank_transactions.is_reconciled = true`, categoria `incassi_pos`. Gira dentro `run_daily_reconciliation()` già esistente (nightly + dopo ogni sync A-Cube).
3. **Abbinamento contanti**: il versamento dichiarato nella chiusura si cerca sul conto dell'outlet entro 0-3 giorni con importo esatto; per gli ATM MPS la causale porta l'identificativo dello sportello (1745, 2121), da mappare sull'outlet come i terminali. Il «contante in negozio» = fondo cassa + contanti non ancora versati, visibile per outlet e per azienda.

Controlli mensili in pagina Banche: per terminale, somma chiusure vs somma accrediti; per outlet, contanti incassati vs versati + variazione fondo cassa; elenco differenze. È la verifica che oggi Lilian non può fare e che porta la riconciliazione entrate da 0 % a quasi tutto.

Prerequisito da Patrizio: la mappa dei 7 codici terminale MPS sui 7 outlet (l'Amex si ricava dai nomi in causale). In alternativa l'app può proporla da sola dopo una settimana di chiusure, per correlazione degli importi, e chiedere conferma.

### 3.8 foto delle chiusure: dalla carta termica ai numeri

A fine giornata il registratore telematico e il terminale POS stampano quattro documenti. La foto di esempio (Owlystic, 2 settembre 2026) li mostra tutti e quattro; ognuno porta dati diversi e tutti sono utili.

| documento stampato | cosa contiene | cosa ne ricava il gestionale |
|---|---|---|
| **Rapporto finanziario** (documento gestionale del registratore) | reparti con aliquota e importi, sconti (numero e valore), pagamenti per tipo (contanti, elettronico), riepilogo IVA (imponibile, imposta, corrispettivo), numero documenti commerciali, aperture cassetto, totale giorno vendite, omaggi, data e ora, numero documento, matricola del registratore | totale corrispettivi, contanti, quota carte, numero scontrini, sconti |
| **Chiusura giornaliera** (azzeramento) | totale giorno vendite, resi, annullamenti, gran totale progressivo, riepilogo IVA, pagato contanti, numero azzeramenti, documenti da inviare, fatture del giorno, stato memoria fiscale, sigillo fiscale | il totale «di legge» del giorno, i progressivi per i controlli di continuità, il numero fatture |
| **Trasmissione telematica corrispettivi** | stringa con matricola, data e ora, numero chiusura e `ESITO-OK` | prova che i corrispettivi sono stati inviati all'Agenzia delle Entrate |
| **Chiusura POS** (per terminale) | identificativo terminale (TML), data e ora, numero transazioni, totale POS, totale host | importo carte per terminale, aggancio al canale e poi all'accredito in banca |

**Come funziona.**

1. La cassiera scatta le foto dal telefono. Il browser le riduce a lato massimo 1.600 px in JPEG prima del caricamento (300-400 KB a foto), abbastanza per la lettura e leggere per la rete del negozio. Salvataggio nel bucket privato `cash-closings`, percorso `company/outlet/data/uuid.jpg`, con RLS per outlet come il bucket `media`.
2. Il caricamento inserisce la riga in `outlet_daily_closing_attachments` con stato `in_attesa`; un trigger o il frontend invoca la Edge Function **`closing-photo-extract`** con l'id dell'allegato.
3. La funzione legge l'immagine dallo Storage con il ruolo di servizio, la manda a Claude come blocco immagine base64 con uno schema JSON vincolato (`output_config.format`) e valida la risposta con Zod prima di scriverla, come vuole la regola «input validation su ogni risposta API». Chiave Anthropic già nel Vault (`get_anthropic_api_key`, la stessa di help-chat); il frontend non chiama mai l'API esterna direttamente. Modello consigliato `claude-opus-5` per l'affidabilità sulla carta termica fotografata di traverso; `claude-haiku-4-5`, già usato da help-chat, è l'alternativa economica da valutare su un mese di foto reali. Costo indicativo: pochi centesimi a foto.
4. Lo schema estratto: tipo di documento, matricola, data e ora, numero documento, totale giorno vendite, imponibile e imposta per aliquota, pagamenti per tipo, numero documenti commerciali, sconti, resi, annullamenti, gran totale progressivo, numero azzeramenti, fatture del giorno, esito trasmissione, terminale POS con transazioni e totale. Ogni campo può essere nullo se illeggibile; la funzione segna `da_rivedere` quando manca il totale o la data non coincide con la chiusura.
5. Il risultato torna nel form: i campi vuoti si precompilano, quelli già scritti mostrano il confronto. Alla conferma si salvano sia i valori dichiarati sia quelli letti, così ogni scostamento resta tracciato.

**I controlli che le foto rendono possibili.**

- totale dichiarato = totale giorno vendite del registratore (è questo il «pienamente corrispondente a ciò che viene battuto alla cassa»)
- contanti dichiarati = pagato contanti del registratore; carte dichiarate = somma delle chiusure POS per terminale
- gran totale progressivo di oggi − gran totale di ieri = totale giorno vendite: scopre giorni mancanti, chiusure doppie o foto del giorno sbagliato; il numero azzeramenti deve crescere di uno al giorno
- esito trasmissione presente e `OK`: il giorno è «trasmesso ad AdE»; se manca per più di un giorno scatta un avviso in-app e nella mail serale
- numero fatture del giorno sul registratore contro la colonna FATTURE dello specchietto
- il terminale della chiusura POS (TML) si aggiunge al canale accanto al codice SIA della banca: stessa riga di configurazione, due identificativi

**Cosa la foto non dà.** Spese cassa, versamento, causale e fondo cassa contato restano a mano: non stanno su nessuno scontrino. Restano quattro campi, non quindici.

**Conservazione.** Le foto sono documenti di controllo, non si cancellano (regola NO DATA LOSS). Stima di spazio su NZ: 4 foto × 350 KB × 7 outlet × 365 giorni, circa 3,5 GB l'anno, nei limiti dello Storage Supabase. La pagina amministrativa mostra le foto accanto ai numeri del giorno, così Lilian verifica senza chiedere nulla al negozio.

---

## 4. piano di lavoro

| fase | contenuto | migration | frontend | edge | dimensione |
|---|---|---|---|---|---|
| 0. bonifiche | ruoli fantasma nel menu, scrittura `companies.settings` che sovrascrive, policy write di `daily_revenue` senza controllo outlet | 1 | piccolo | no | mezza giornata |
| 1. chiusura cassa | 5 tabelle + RLS + enum ruolo + bucket `cash-closings` + proiezione in `daily_revenue`; pagina cassiera con scatto e caricamento foto (senza lettura automatica); pagina amministrativa mese × outlet con foto; gestione utenti cassa; guida; test pixel | 2 | pagina nuova ×2 + Impostazioni + Sidebar/Layout | no | 3 giorni |
| 1b. lettura foto | Edge Function `closing-photo-extract` (Claude vision + schema JSON + Zod), precompilazione e confronto nel form, controlli di continuità e trasmissione AdE, stato `da_rivedere` | 1 | medio | 1 | 1-2 giorni |
| 2. mail serale | `daily_report_settings`, `tick()`, cron, Edge Function invio, sezione in Impostazioni | 1 | piccolo | 1 | 1 giorno |
| 3. banche | canali con terminal_code, matching POS e versamenti dentro la nightly, stato «verificata», controlli mensili in Banche | 1 | tab in Banche + stato nelle chiusure | no | 2 giorni |
| 4. ricavi mensili ed export | proposta consuntivo in Inserimento rapido, xlsx nel formato del modello, scorporo IVA parametrico | 0 | medio | no | 1 giorno |

Ogni fase è una PR su branch, migration applicata NZ → Made → Zago con verifica, guida aggiornata nello stesso commit, `npm run build` e CI pixel verdi.

Per Made e Zago le tabelle nascono vuote: i canali si configurano quando quei tenant avranno POS collegati. La funzione non deve rompersi con zero canali (outlet senza canali = nessuna chiusura richiesta).

---

## 5. decisioni che servono da Patrizio

1. Account cassa: uno per outlet condiviso (consigliato) oppure uno per persona?
2. Totale corrispettivi: è la somma dei mezzi di pagamento, fatture comprese, oppure il dato del registratore telematico con le fatture a parte?
3. Aliquota per lo scorporo IVA nel consuntivo mensile: 22 % per tutto?
4. Mappa dei 7 terminali MPS (`6181087-00002 … 00013`) sui 7 outlet, oppure lasciare che l'app la proponga dopo una settimana.
5. Orario della mail serale e destinatari, per ciascun tenant.
6. Fino a quando una chiusura confermata può essere corretta dal negozio: mai (solo Lilian riapre), oppure entro il giorno dopo?
7. Fondo cassa iniziale per ogni outlet alla partenza (serve per il primo calcolo dell'atteso).
8. Attivazione di `close_incoming_movements` in produzione: sì o no?
9. Foto obbligatorie per confermare la chiusura (almeno chiusura del registratore e chiusura POS) oppure facoltative?
10. Il totale del registratore telematico è la verità a cui lo specchietto deve corrispondere, e uno scostamento blocca la conferma o chiede solo una nota?

---

## 6. rischi e punti di attenzione

- **Parità tenant**: enum, tabelle, cron ed Edge Function vanno su NZ, Made e Zago anche se oggi solo NZ ha i POS. Cron ed enum non stanno nella transazione della migration.
- **Nessun valore hardcoded**: i canali, i codici terminale, le aliquote e i destinatari stanno tutti in tabelle per company.
- **NO DATA LOSS**: niente DELETE sulle chiusure; la correzione è riapertura + nuova conferma con storico. Il consuntivo mensile di Lilian non viene mai sovrascritto in automatico.
- **RLS del nuovo ruolo**: le policy di sola lettura «tutta l'azienda» sono molte; il ruolo cassa va escluso esplicitamente da fornitori, banche, budget, personale e fatture, altrimenti chi indovina un URL vede dati sensibili.
- **Fuso orario**: unico punto del sistema che ragiona in ora locale; va documentato nella guida e nel codice del cron.
- **Tipi TypeScript**: `src/types/database.ts` è già indietro su `budget_entries`; dopo le migration va rigenerato.
- **Pagine che leggono `daily_revenue` senza paginazione** (Dashboard, Margini per categoria): con 7 outlet × 365 giorni superano le 1.000 righe entro pochi mesi; vanno portate su `fetchAllPaged` come già fatto in Fatturazione.
