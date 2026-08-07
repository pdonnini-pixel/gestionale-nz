# Piano di pagamento fornitore + segnalazioni anomalie — Note di implementazione

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
> **FASE 3 (da fare)** — coda NC manuale (vedi sopra).

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
