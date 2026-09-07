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

## 4b. stato di avanzamento

**Fase 1 realizzata (2026-09-04)**, decisioni di Patrizio: un account per outlet, foto obbligatorie.

- Migration `20260904_172` (ruolo `operatore_cassa` + policy restrittive sulle tabelle sensibili) e `20260904_173` (4 tabelle, RLS, trigger di quadratura, funzioni di conferma/riapertura, proiezione in `daily_revenue`, bucket privato `cash-closings`), applicate e verificate su NZ, Made e Zago.
- Pagine `/chiusura-cassa` (cassiera, mobile) e `/incassi-giornalieri` (amministrazione: riepilogo mese × outlet, foglio per outlet come l'Excel, dettaglio con foto, riapertura, editor dei canali di incasso).
- Impostazioni → Utenti: ruolo «Operatore cassa (negozio)» con scelta dell'outlet; Edge Function `admin-manage-user` aggiornata sui 3 tenant (scrive `user_outlet_access`). Rimossi i ruoli fantasma `store_manager` e `operatrice`.
- Guide utente delle due pagine, test pixel, unit test dei calcoli (`src/lib/cashClosings.test.ts`).
- Canali dei 7 outlet NZ creati (Contanti, POS MPS, POS MPS Amex, POS BCC, POS BCC Amex, Pay by link, Fatture, Bonifico) con conto di accredito; codici terminale da inserire in fase 3.
- **Revisione dopo il primo collaudo di Patrizio (stesso giorno, migration 174-175)**: una foto per riga (totale, ogni canale, ogni spesa, versamento) invece del contenitore unico, così la lettura automatica sa a cosa riferirsi; più righe di spesa cassa; voce «rimborso a cliente» con nota obbligatoria e senza foto; **obbligatoria solo la foto dello scontrino di chiusura**, le altre facoltative con l'avviso che senza foto potrà essere chiesto un chiarimento.
- Da fare per partire su NZ: creare i 7 account cassa (servono le email dei negozi), scrivere il fondo cassa iniziale alla prima chiusura di ogni negozio.

**Fase 1b realizzata (2026-09-04)**: lettura automatica delle foto.

- Edge Function `closing-photo-extract` (Claude vision, un prompt per tipo di foto: scontrino di chiusura RT, chiusura POS, scontrino spesa, ricevuta versamento), deployata su NZ, Made e Zago. Legge la foto dal bucket privato con la service key, chiede a Claude un JSON con i campi del documento (per lo scontrino di chiusura: totale, contanti, elettronico, numero documenti, resi, annulli, gran totale, numero azzeramenti, righe IVA, esito trasmissione) e salva tutto in `outlet_daily_closing_attachments.extracted` con lo stato `letta` / `da_rivedere` / `fallita`. Non scrive mai nella chiusura: la quadratura resta quella del DB.
- Autorizzazione: JWT di un utente che vede l'allegato (controllo con la RLS), oppure service key, oppure il segreto condiviso `x-autofix-cron` già usato dal cron dei ticket (per riletture lanciate dal DB, utili alla mail serale della fase 2).
- Pagina cassiera: dopo ogni scatto parte la lettura in sottofondo; i campi vuoti della riga vengono precompilati (totale e contanti dallo scontrino di chiusura, totale POS, importo e descrizione della spesa, importo e banca del versamento); sotto la foto il chip «dalla foto: importo» verde se coincide, arancione con «usa» se diverso, «(da controllare)» se la lettura è incerta, «riprova» se fallita. La cassiera resta l'unica fonte: i numeri letti sono proposte.
- Pagina amministrativa: nel dettaglio della giornata ogni foto mostra l'importo letto con la differenza rispetto a quanto scritto, i dati secondari (contanti/elettronico, documenti, gran totale, azzeramenti, trasmissione, terminale, data e ora) e il pulsante «Rileggi»; nel foglio mensile la colonna Foto segna «≠» quando una lettura non coincide con il totale o il versamento.

**Fase 2 realizzata (2026-09-04)**: report incassi serale.

- Migration `20260904_176`: `daily_report_settings` (ora locale nel fuso dell'azienda, destinatari, ora del sollecito, invio anche senza chiusure, URL dell'app salvata dalla UI), `daily_report_log` (un invio per giorno grazie a un indice parziale), funzione `daily_cash_report_tick()` chiamata da pg_cron ogni 15 minuti: converte `now()` in Europe/Rome e, nella finestra di 30 minuti dall'ora impostata, chiama la Edge Function via pg_net con il segreto `x-autofix-cron`; all'ora del sollecito crea notifiche in-app agli operatori cassa dei negozi senza chiusura confermata. Cron `daily-cash-report-tick` attivo sui 3 tenant.
- Edge Function `daily-cash-report-send` sui 3 tenant: una riga per punto vendita (totale, contanti, POS, altri canali, spese e rimborsi, versamento, fondo cassa, differenza), negozi mancanti in rosso, elenco «da controllare» (bozze, quadrature, foto dello scontrino mancante, importi letti dalla foto diversi da quelli scritti, note della cassiera), totale azienda, progressivo del mese, link a Incassi giornalieri. Invio con Resend; esito in `daily_report_log`.
- Impostazioni → «Report incassi serale» (super advisor e contabile) con «Invia una prova a me» e tabella degli ultimi invii.
- NZ configurato: ore 21:30, destinatari Patrizio, Lilian e Denise. Mail di prova inviata e ricevuta con esito `sent`.
- **Confronto con l'obiettivo (2026-09-07)**: il report legge il budget ricavi mensile per outlet dell'Inserimento rapido (`budget_confronto`, `entry_type = rev_monthly`, importi netti IVA), lo porta al lordo con l'aliquota `daily_report_settings.budget_vat_rate` (migration 194, default 22 %, campo in Impostazioni → Report incassi serale) e lo divide per i giorni del mese. Nella tabella del giorno: colonne «Obiettivo giorno» e «+/- obiettivo» per negozio e totale (verde/rosso); in testa e nell'oggetto lo scostamento del giorno. Nuova tabella «Mese vs obiettivo»: budget mese, obiettivo a oggi (obiettivo giorno × giorno del mese), incassato a oggi (chiusure non in bozza), +/-, % raggiunta, proiezione fine mese (media dei giorni trascorsi × giorni del mese). Negozi senza budget nel mese: trattino e nota. Edge Function v2 sui 3 tenant.

**Fase 3 realizzata (2026-09-05)**: verifica con la banca.

- Migration `20260905_188`: esito banca sulle righe POS/Amex (`bank_status`, `bank_amount`) e sul versamento della chiusura; tabella `closing_bank_matches`; parser delle causali (codice terminale dalle ultime 5 cifre del COD.SIA o del codice Amex, giorno di vendita da «DATA RIF.» o «incassi gg.mm.aaaa», riconoscimento versamenti); `match_cash_closings_with_bank()` che somma gli accrediti per (terminale, giorno) e li confronta con la riga della chiusura confermata, cerca il versamento (importo esatto, 0-6 giorni, parola chiave del canale Contanti o conto) e porta la chiusura a «verificata»; cron `cash-bank-matching-daily` alle 06:05 UTC sui 3 tenant (run_daily_reconciliation non toccata: il suo corpo differisce fra i tenant). RPC `run_cash_bank_matching`, `list_bank_terminal_codes`, `cash_bank_monthly_summary`.
- Incassi giornalieri: segni ✓ ≠ ✗ ? nelle celle POS e versamento, esito e movimenti abbinati nel dettaglio, scheda «Banca» con i controlli del mese (canali, contanti per outlet, terminali non mappati, accrediti senza chiusura) e «Verifica con la banca ora»; scheda «Canali di incasso» con la tabella dei codici terminale visti in banca e il campo con suggerimenti. Nel canale Contanti il codice terminale è la parola chiave del versamento (PALMANOVA, FOIANO, 2121, 2751|3246…).
- Dato reale NZ: 7 codici MPS (00002, 00004, 00007, 00008, 00009, 00011, 00013) e 5 Amex (00001 Vicolo, 00006 Franciacorta, 00010 Brugnato, 00012 Valmontone, 00014 Torino); versamenti con nome negozio in causale per Palmanova, Foiano (Valdichiana), Franciacorta (ATM 2121), Brugnato (ATM 2751/3246), Banco Fiorentino «cassa contin» (Barberino), ATM 1745 e Intesa ATM 9750 da attribuire.

**Fase 3, completamento (2026-09-07)**: mappatura dei terminali e causali BCC.

- Migration `20260907_192` sui 3 tenant: i parser riconoscono anche gli accrediti POS della BCC Valdarno (acquirer Numia e PagoBancomat, causale «Incassi PagoBancomat gg.mm.aa - 6181087000NN NOME» / «Incassi Internazionali Numia SpA nnnnnnn gg.mm.aa 6181087000NN NOME»), prima esclusi dal riscontro; il matcher confronta l'accreditato con la somma delle righe che condividono codice e tipo (i due canali Amex di un outlet arrivano in banca come un solo accredito con il codice del terminale BCC).
- `NZ_ONLY_20260907_193`: codici e parole chiave scritti nei 35 canali NZ. Ogni outlet ha due POS fisici (Nexi/MPS e Numia/BCC) e i 14 terminali seguono l'ordine di apertura sotto lo stesso codice SIA 6181087:

| outlet | POS MPS | POS BCC e Amex | versamento (parola chiave) |
|---|---|---|---|
| Valdichiana | 00002 | 00001 | FOIANO (cassa continua MPS) |
| Barberino | 00004 | 00003 | cassa contin (Banco Fiorentino) |
| Palmanova | 00007 | 00005 | PALMANOVA (cassa continua MPS) |
| Franciacorta | 00008 | 00006 | FRANCIACORTA, ATM MPS 2121 |
| Brugnato | 00009 | 00010 | BRUGNATO (ATM MPS, nota in causale) |
| Valmontone | 00011 | 00012 | ATM MPS 1745 |
| Torino | 00013 | 00014 | ATM Intesa 9750 |

  Fonti: nome dell'outlet nelle causali BCC (00005, 00006, 00010, 00012, 00014), prima transazione di ogni terminale MPS coincidente con la data di apertura, primo versamento dell'ATM 1745 (21/10/2025, Valmontone) e dell'ATM Intesa 9750 (31/03/2026, Torino).
- I collegamenti POS ↔ registratore telematico del portale dell'Agenzia delle Entrate (matricole 99IEB…, terminal id Nexi/Numia a 8 cifre) non compaiono nelle causali bancarie e non servono al riscontro; la sola matricola attribuibile con certezza è 99IEB130491 (collegamenti dal 03/2026 → Torino).

**Collaudo sugli scontrini reali (2026-09-07)**: 42 foto di chiusura dei 7 outlet NZ per i giorni 1-6 settembre.

- Copertura completa: 7 outlet × 6 giorni, nessuna giornata mancante. Ogni foto contiene lo scontrino di chiusura RT (totale vendite, contanti, elettronico, matricola, sigillo, numero azzeramenti) e la chiusura del POS Nexi/MPS con il dettaglio per circuito (Bancomat, Nexi, Amexco); dal 4 settembre compaiono anche le chiusure del POS Numia/BCC (Bancomat, «New Cartabccpos», Amex), prima sempre a zero.
- Quadratura: in 40 chiusure su 42 elettronico RT = somma delle chiusure POS al centesimo. Le due eccezioni: Torino 01/09 (RT 430,80 contro POS 392,45: la banca accredita l'importo pieno, quindi un pagamento di 38,35 è passato dopo la stampa della chiusura POS) e Barberino 04/09 (POS 985,55 contro RT 911,51: il POS ha incassato 74,04 in più di quanto il registratore ha battuto come elettronico; la banca conferma il POS).
- Matricole RT → outlet, ora certe dalle foto: 99IEB080351 Valdichiana, 99IEB076561 Barberino, 99IEB096085 Palmanova (Aiello del Friuli), 99IEB095535 Franciacorta (stampa il «rapporto finanziario» invece della chiusura giornaliera), 99IEB040615 Brugnato, 99IEB122366 Valmontone, 99IEB130491 Torino (Settimo Torinese). Terminal id Nexi: 53968142, 86028817 (+86028816), 86044207, 86045913, 86115651, 86208645, 83019010; Numia: 84570932, 84570955, 84570958, 84570960, 84570977, 84570982, 84570990.
- **Accrediti MPS al netto delle commissioni**: per 6 outlet la banca accredita fra lo 0,4 % e l'1,1 % in meno della chiusura POS (es. Palmanova 03/09: POS 1.557,76, banca 1.542,49), senza una riga di commissione separata; solo Valdichiana (00002) riceve il lordo. Con la tolleranza attuale di 0,01 € il riscontro segnerebbe «differenza» quasi ogni giorno: serve una tolleranza percentuale per canale (o l'aliquota di commissione) prima di considerare affidabile il segno ≠.
- Accrediti Amex: la data in causale è quella dell'accredito (T+1), non quella della vendita: l'Amex di Franciacorta del 01/09 (58,00) è «Accredito per incassi 02.09.2026». Il parser va spostato di un giorno per gli Amex.
- Sincronizzazione BCC in ritardo: al 07/09 l'ultimo movimento BCC è del 03/09 e nessun accredito Numia/PagoBancomat riferito ai giorni 1-6 è ancora arrivato (Numia accredita a T+2/T+3). Su MPS mancano ancora quattro accrediti del venerdì 04/09 e sabato 05/09 (Brugnato Nexi 619,78 e Bancomat 285,47, Franciacorta Bancomat 282,80, Torino Nexi 555,60): probabile accredito nei giorni successivi.
- Numeri (totale vendite RT lordo IVA): 1-6 settembre 64.505,57 €; per giorno 7.454 / 7.369 / 9.013 / 6.558 / 14.773 / 19.339; per outlet Valdichiana 13.488, Valmontone 9.863, Barberino 9.352, Palmanova 8.479, Franciacorta 8.371, Torino 8.362, Brugnato 6.591.
- Cosa le foto non danno: fondo cassa, spese di cassa, versamenti (nessuna ricevuta di versamento fra le 42 foto), rimborsi. Restano dati che solo la cassiera può inserire.

**Fase 3, correzioni dal collaudo (2026-09-07)**: migration `20260907_195` sui 3 tenant.

- `outlet_payment_channels.bank_tolerance_pct`: scarto percentuale ammesso fra dichiarato e accreditato (1,5 % sui canali POS esistenti e nei canali standard, 0 sugli Amex che accreditano il lordo); campo «Tolleranza banca %» in Canali di incasso. Il matcher usa `greatest(0,01 €, dichiarato × tolleranza)`.
- Accrediti Amex: la data in causale è quella dell'accredito e un accredito copre più giornate. Il matcher cerca, fra le chiusure confermate con Amex dichiarato sul codice (fino a 10 giorni prima, giornata più recente entro 4 giorni dall'accredito), la sequenza consecutiva la cui somma coincide con l'accreditato e registra un abbinamento per giornata con la sua quota (`closing_bank_matches` ora UNIQUE su `(bank_transaction_id, closing_id)`). Le righe Amex passano a «mancante» dopo 10 giorni invece di 5.

**Fase 4 realizzata (2026-09-07)**: ricavi mensili ed export.

- Inserimento rapido (Budget e Controllo): pulsante «Proponi da chiusure cassa» sotto la riga Consuntivo. Somma le chiusure confermate del mese per `outlets.cost_center_key`, scorpora l'IVA con `daily_report_settings.budget_vat_rate` e mostra giornate chiuse/giorni del mese (⚠ se parziale), lordo, netto proposto, consuntivo attuale; «Usa» e «Usa tutti» scrivono con la stessa `save_budget_confronto_cell` (stato granitico). Nessuna scrittura automatica. Helper puro `proposeConsuntivo` in `src/lib/cashClosings.ts` con test.
- Incassi giornalieri: pulsante «Esporta Excel» nel riepilogo: foglio «Riepilogo» giorni × punti vendita con totali e un foglio per punto vendita nella forma del vecchio Excel (totale, una colonna per canale, spese, rimborsi, versamenti, fondo cassa, differenza, stato, chi ha chiuso, note). Builder puro `src/lib/cashClosingsExport.ts` con test; xlsx caricato a richiesta.
- Migration `20260907_196` sui 3 tenant: la proiezione in `daily_revenue` scorpora l'IVA con la stessa aliquota del report e della proposta (`daily_report_settings.budget_vat_rate`, poi il vecchio `companies.settings.cash_closing_vat_rate`, poi 22 %). Un solo parametro per tutto lo specchietto.

**Caricamento delle 42 giornate e collaudo del riscontro (2026-09-07)**: le chiusure 1-6 settembre dei 7 outlet NZ sono state inserite dalle foto (stato confermata, «caricamento da foto», fondo cassa/spese/versamenti a zero, senza foto nel bucket; Torino 01/09 e Barberino 04/09 con i numeri del registratore e la nota dell'anomalia). Totale 64.505,57 € lordi, 52.873,42 € netti in `daily_revenue`. Il riscontro con la banca sui dati veri ha rivelato altre due cose:

- **L'Amex passato sul POS Nexi è accreditato da MPS** insieme a Bancomat e Nexi (Palmanova 01/09: POS 824,05 + Amex 177,55 = 1.001,60, accredito MPS 992,51). Le righe «American Express» sul conto BCC sono solo gli Amex del terminale Numia/BCC. `NZ_ONLY_20260907_198`: il canale «POS MPS Amex» diventa tipo `pos` con il codice del POS MPS (resta una colonna per la cassiera); il matcher somma i due canali.
- **Accredito parziale**: Bancomat e Nexi di una giornata arrivano in due righe con valuta diversa; con una sola arrivata il riscontro segnava ≠. Migration `20260907_197` (3 tenant): se l'accreditato è inferiore al dichiarato e la giornata ha meno di 5 giorni, la riga resta «in attesa» con l'importo parziale.

Esito dopo i correttivi: 29 giornate su 42 «verificate con la banca», 13 «confermate» in attesa degli accrediti BCC (che al 07/09 non sono ancora arrivati) o della seconda riga MPS; una sola «differenza» vera, Barberino 04/09 (POS 985,55 contro registratore 911,51). L'accredito MPS del 01/09 di Torino (426,66 netti) conferma i 430,80 del registratore.

**Chiusura come la fa la cassiera (2026-09-07, richiesta di Patrizio)**: una sola foto per giornata (scontrino di chiusura del registratore con accanto le chiusure dei POS, come negli esempi raccolti a mano), quindi in Chiusura cassa sono spariti i pulsanti foto sulle righe POS (le foto «canale» già caricate restano visibili); ordine dei canali: Contanti, poi tutti i POS uno dietro l'altro, poi Pay by link, Fatture, Bonifico (`NZ_ONLY_20260907_199`, solo sort_order). Le 42 giornate caricate hanno ricevuto la loro foto (la pagina del PDF) tramite la nuova Edge Function `cash-closing-photo-import` (service key o segreto `x-autofix-cron`; bucket + riga allegato + lettura automatica; sui 3 tenant), e la lettura automatica è stata eseguita su tutte: 42 letture, di cui 2 «da rivedere» per matricola incerta; il segreto usato per il caricamento è stato ruotato subito dopo.

Le quattro fasi del piano sono realizzate. Restano il collaudo con i negozi (account cassa, fondo cassa iniziale, prime foto dall'app) e la verifica degli accrediti BCC quando arriveranno in banca.


## 5. decisioni che servono da Patrizio

1. Account cassa: uno per outlet condiviso (consigliato) oppure uno per persona?
2. Totale corrispettivi: è la somma dei mezzi di pagamento, fatture comprese, oppure il dato del registratore telematico con le fatture a parte?
3. Aliquota per lo scorporo IVA nel consuntivo mensile: 22 % per tutto?
4. ~~Mappa dei 7 terminali MPS sui 7 outlet~~ — risolta il 2026-09-07 dai dati bancari (vedi 4b).
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
