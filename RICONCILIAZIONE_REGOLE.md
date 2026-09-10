# Regole di Riconciliazione — Ciclo Passivo (Gestionale NZ)

> Documento unico delle regole con cui il sistema abbina i **movimenti bancari in uscita**
> alle **fatture fornitore**. Per ogni regola: **cosa dice**, **dove è applicata** (funzione /
> migration / file), e **se è automatica** (sempre) o **manuale** (richiede conferma / non ancora
> coperta). Aggiornato al 2026-09-04. ⚠️ Ogni regola vale su **NZ + Made + Zago**.

## Legenda stato
- ✅ **AUTO SEMPRE** — applicata dal motore a ogni movimento (trigger all'inserimento + cron notturno 05:45).
- 🟡 **PROPONE** — il sistema la propone, la conferma è manuale (un click), non chiude al buio.
- 🔧 **MANUALE** — si fa solo dal pannello Riconciliazione / a mano.
- ⛔ **GAP** — regola giusta ma **non ancora coperta ovunque** (indicato dove manca).

---

## Come gira il motore (ordine dei tentativi)
A ogni movimento in uscita non riconciliato, in quest'ordine:
1. **Granitico di gruppo a NOME** — `try_match_group_bank_transaction` (migr. 102/111/113)
2. **Granitico di gruppo a NUMERI** — `try_match_group_numbers_bank_transaction` (migr. 120, SDD cumulativi)
3. **A punteggio** — `try_match_bank_transaction` (migr. 100/113)
4. **Biettivo per data** — `rerun_bijective_reconciliation` (migr. 104/113)
5. **A importo (flussi anonimi)** — `try_match_amount_bank_transaction` (migr. 110/112)
6. **Chiusura non-fornitore** — `close_non_supplier_movements` (migr. 108/112)
7. **Chiusura utenze** — `close_utility_movements` (migr. 118/119/120, solo fornitori `is_utility`)

Innesco (3 vie, tutte attive):
- **trigger** `trg_auto_reconcile_bank_transaction` a ogni INSERT su `bank_transactions`
  (stati `posted` E `booked` — A-Cube arriva `booked`, migr. 103; include il matcher a numeri, migr. 121);
- **dopo ogni import A-Cube**: la edge function `acube-ob-tx-sync` lancia `run_daily_reconciliation`
  a fine import se ci sono movimenti nuovi (così non si aspetta la notte);
- **cron** giornaliero `run_daily_reconciliation` alle 05:45 (migr. 105, aggiornato 112/118).

Tutto reversibile con `undo_reconcile_movement`.

---

## Le regole

### R1 — Chiusura a mano ammessa, ma ogni movimento verifica SEMPRE aperte E chiuse
Si può chiudere una fattura a mano, ma quando arriva un movimento il sistema deve verificarlo
sempre anche contro le fatture **chiuse a mano** (e pagate) senza movimento agganciato: il
bonifico che le ha pagate resta orfano e va collegato.
- **Dove:** tutti i matcher includono `status='pagato' AND closed_manually` nel pool candidati (migr. 100/102/104).
- **Stato:** ✅ AUTO SEMPRE. Aggancio a fattura chiusa a mano = **solo collegamento**, nessuna doppia scrittura.

### R2 — Una fattura senza aggancio bancario è SEMPRE abbinabile
Qualsiasi fattura con `bank_transaction_id` nullo è abbinabile, a prescindere dallo stato. Se è
già pagata (chiusa a mano **o** segnata pagata all'import/go-live) → **solo aggancio**.
- **Dove:** RPC di aggancio `reconcile_movement` / `reconcile_movement_group` (migr. 114) **E** i tre matcher automatici — granitico, a punteggio, biettivo (migr. **116**); pool frontend `closedManualPayables` allargato a tutte le `pagato` senza aggancio (TesoreriaManuale).
- **Stato:** ✅ AUTO SEMPRE (dopo migr. 116) + 🟡 (ricerca manuale le mostra). Le fatture già pagate con movimento restano intoccabili (`stale`).
- **Nota costi ricorrenti:** se c'è **una sola fattura** per **N addebiti mensili** dello stesso importo (es. canone San Mauro 3.714,57 ×5 mesi), solo **un** movimento si aggancia a quella fattura (quello che la cita in causale); gli altri mesi restano da riconciliare finché non esiste la fattura del mese.

### R3 — Scorporo delle COMMISSIONI: si confronta il NETTO
I flussi CBI aziendali arrivano col **lordo** (netto + commissione). Si legge dalla causale
`IMPORTO BONIFICI` (netto) e `IMPORTO COMMISSIONI` e si confronta il **netto**. Cercare l'importo
esatto al centesimo è sbagliato: c'è quasi sempre una commissione.
- **Dove:** backend `try_match_amount_bank_transaction` (migr. 112, richiede `IMPORTO BONIFICI`); frontend `movementNet()` (TesoreriaManuale). Tolleranza dei matcher (0,02 / 1-2%) assorbe comunque la commissione.
- **Stato:** ✅ (backend) + 🟡 (detector frontend).

### R4 — Match a importo: AUTO solo se UNICO ed ESATTO, altrimenti PROPONE
Sui bonifici anonimi (causale senza nome né numero) si aggancia in automatico **solo** se esiste
un'**unica** fattura col netto **esatto** (≤ 0,02). Altrimenti si **propone**, non si chiude al buio.
Vietato il match per sola percentuale (aveva causato falsi positivi).
- **Dove:** `try_match_amount_bank_transaction` (migr. 112).
- **Stato:** ✅ AUTO (singolo unico) / 🟡 PROPONE (più candidati).

### R5 — Conferma fornitore STRETTA (stop collisioni)
Il fornitore in causale è confermato **solo** dalla **P.IVA** oppure da una parola **≥4 lettere non
generica**. Parole generiche escluse: PROPCO, GROUP, GRUPPO, HOLDING, SRL, SPA, SAS, SOCIETA,
SERVIZI, ITALIA… Evita di scambiare "Palmanova **Propco**" con "Valdichiana **Propco**".
- **Dove:** `supplier_confirmed_in_text()` (migr. 113), usata da granitico, a punteggio e biettivo.
- **Stato:** ✅ AUTO SEMPRE. I fornitori a nome tutto generico / sigla (Gruppo FB, S.I.A.E.) si abbinano per P.IVA o per numero+importo, o a mano.

### R6 — 1 BONIFICO = 1 FORNITORE (mai un mix)
Un bonifico è sempre verso **un solo** fornitore. Mai combinare fatture di fornitori diversi per
far quadrare un importo. Se la causale è anonima, si cerca l'**unico** fornitore le cui fatture
(una o combinazione) sommano al netto; se ne combacia più d'uno → niente proposta.
Il fornitore si riconosce dalla **P.IVA**, mai dal nome: due aziende diverse possono
condividere una parola (AMAZON PAYMENTS **EUROPE** e CNH INDUSTRIAL CAPITAL **EUROPE**), e lo
stesso fornitore può avere due nomi in anagrafica (ZUCCHETTI SPA e ZUCCHETTI SPA AD AZIONISTA
UNICO, stessa P.IVA). Vale anche quando la causale nomina il beneficiario: il nome serve a
restringere il campo, la P.IVA a decidere.
- **Dove:** `supplierKeyOf` + `toVerifyGroups` (frontend) e il controllo `mixed_suppliers` dentro
  `reconcile_movement_group` (migr. 193): la difesa sta su tutti e due i lati.
- **Stato:** 🟡 PROPONE (combinazioni ≥2, un unico fornitore). Il caso a fattura singola → R4 (auto).
- **Caso reale 09/09/2026:** proposto un bonifico ad AMAZON PAYMENTS EUROPE (415,85) con dentro la
  fattura LNB71972 di CNH INDUSTRIAL CAPITAL EUROPE. Bastava «EUROPE» in comune. La combinazione
  giusta esisteva ed era esatta: 52,72 + 262,24 + 20,89 + 80,00 = 415,85.

### R7 — Pagamenti CUMULATIVI (1 movimento = N fatture)
Un bonifico che salda più fatture **dello stesso fornitore**:
- **Granitico a NOME** (auto): fornitore **e** numeri fattura citati in causale **e** somma esatta → migr. 102.
  Include i **numeri corti** (2-3 cifre, es. "SALDO FATTURA 11-12") se la causale ha contesto fattura → migr. 111.
- **Granitico a NUMERI** (auto, migr. 120): per gli **SDD cumulativi** dove la causale NON scrive il nome
  (il campo `supplier_name` della fattura porta il testo grezzo dell'SDD, il legame è via `supplier_id`).
  Le fatture i cui **numeri (≥6 cifre, token isolato)** sono citati in causale si raggruppano per fornitore;
  aggancia solo se **un unico fornitore** somma esatto al movimento (R6). Il numero lungo identifica il
  fornitore da solo: non serve il nome. **Caso reale HERA COMM:** addebito 1.601,60 = 8 fatture
  (412607309402…309409). Sono le 51 fatture HERA che il matcher a nome non vedeva.
- **Anonimo** (propone): nessun nome/numero → un unico fornitore la cui combinazione somma al netto → R6.
Aggancio **atomico** (tutto-o-niente): se la somma non torna, non abbina nulla.

**La somma torna al CENTESIMO, non «quasi».** Le commissioni MPS non stanno dentro il bonifico:
la banca le addebita con una riga separata («Commissioni su bonifico tramite co…», 0,70 / 0,75 €;
1,75 € sui flussi CBI, dove però la causale le dichiara e si scorporano con R3). Verificato sui
movimenti in cui la causale nomina la fattura: lo scarto è **0,00** ogni volta. Quindi uno scarto di
pochi centesimi non è un arrotondamento né una spesa bancaria, è un **gruppo sbagliato**. Tolleranza
0,05 € da migr. 193 (prima: 2% dell'importo lato server, 0,3% lato frontend).

**Causale senza beneficiario:** il fornitore verrebbe dedotto dal solo importo, quindi il movimento
deve almeno avere la **forma di un pagamento** (`hasPaymentStructure`: «IMPORTO BONIFICI», «NUM. TOT.
PAGAMENTI», «A FAVORE», «BONIFICO»). **Caso reale 09/09/2026:** l'addebito «DISPOSIZIONE — FONDO DI
GARANZIA MCC» di 260,00 € (commissione MCC su un finanziamento, non un pagamento a fornitore) si era
portato dietro sei fatturine DX SRL che facevano 260,00 tondi.

**Ambiguità:** se più combinazioni diverse fanno la stessa cifra non si propone niente, a meno che i
numeri di fattura citati in causale («SALDO FATTURA 60828-65166», «SSF-IT662TPABEY-IT65OHAABE», che
la banca può **troncare**: confronto per prefisso, e per la sola parte numerica quando la fattura ha
un prefisso di serie, «FPR 238/26» ↔ «SALDO FATTURA 238-240») indichino una sola combinazione. La ricerca è
esaustiva sulle fatture di quel fornitore: il vecchio taglio «solo le 12 più grandi» nascondeva le
combinazioni con fatture piccole, ed è così che al bonifico Amazon del 14/07 sfuggiva la risposta esatta.
- **Dove:** `try_match_group_bank_transaction` (a nome), `try_match_group_numbers_bank_transaction` (a numeri, migr. 120), `reconcile_movement_group` (esecuzione, migr. 101/114/115).
- **Stato:** ✅ AUTO (granitico, a nome e a numeri) / 🟡 PROPONE (anonimo).

### R8 — AL NETTO di NOTA DI CREDITO
Se una distinta contiene una **nota di credito**, il bonifico paga il **netto** = somma fatture −
note di credito. Il motore sottrae le NC `pending` collegate a ciascuna fattura prima di confrontare,
e in esecuzione **consuma** quelle NC (link → `applied`).
- **Esempio:** distinta Torino 1323 (20.740) + 1120 (6.636,80) + 1222 (5.807,20) − NC 1380 (4.771,73) = **28.412,27**.
- **Dove:** `reconcile_movement_group` — NC **collegate** (migr. 115) **e** NC **vaganti** passate nel gruppo (migr. 117); detector frontend che carica le NC e le sottrae dalla base (TesoreriaManuale); `reconcile_movement` singola via `apply_credit_note_links`.
- **Stato:** ✅ AUTO (propone) — il detector propone le distinte al netto della NC, sia collegata (Torino) sia vagante (Valdichiana: 27.159,16 + 9.382,26 − 457,50 = 36.083,92). Un click e chiude.

### R9 — Movimenti NON-fornitore: chiusi, MA non i bonifici veri
F24/imposte, stipendi/emolumenti, carte/POS/prelievi, giroconti, commissioni-spese bancarie,
CBILL/PagoPA vengono **chiusi** (tolti da "da riconciliare") come non-fornitore. **MA** un bonifico
reale (causale con `IMPORTO BONIFICI` / DISPOSIZIONE / A FAVORE) **non** va chiuso solo perché contiene
la parola "commissioni".
- **Dove:** `close_non_supplier_movements` (migr. 108, corretta in 112 con l'esclusione `IMPORTO BONIFICI`); frontend `isRealTransfer()` + `NON_SUPPLIER_RE` (TesoreriaManuale, PR #367).
- **Stato:** ✅ AUTO SEMPRE.

### R10 — Numeri fattura: token isolato, e attenzione ai formati diversi
Il numero fattura si cerca come **token isolato** in causale. Attenzione: lo stesso documento può
avere numeri in **formati diversi** tra canali (SDI `B0202600536` vs SDD `20260000536`): non combaciano,
quindi **non ci si affida solo al numero** — servono anche fornitore e importo.
- **Dove:** regex token in granitico (102/111) e a punteggio (100).
- **Stato:** ✅ (con i limiti sopra). I numeri "attaccati" all'ID bonifico (es. `…B020260053ID.BON`) non sono leggibili → si ricade su importo/fornitore.

### R11 — Reversibilità e nessuna doppia scrittura
Ogni aggancio è annullabile (`undo_reconcile_movement`, riapre anche le NC). Le fatture chiuse a
mano si **agganciano** al movimento senza riscrivere l'importo (restano pagate). Prima nota = solo
movimenti bancari reali: la chiusura a mano non crea movimenti.
- **Stato:** ✅ SEMPRE.

### R12 — Parità tenant
Ogni migration e regola va applicata su **NZ + Made + Zago** (3 project distinti), identici.
- **Stato:** ✅ obbligatoria (REGOLA #0).

### R13 — UTENZE (addebiti permanenti RID/SDD): chiusura senza fattura
Le utenze con addebito permanente (HERA, Enel, Enegan, Acea…) di norma **non** si registrano come
fattura passiva: la bolletta viene addebitata in automatico. Il fornitore va marcato **`is_utility`**
(spunta in Fornitori). I suoi addebiti in uscita che **non** hanno una fattura agganciata né una
proposta pendente si **chiudono da soli** come "utenza" (`is_reconciled=true`, categoria `utenze`),
senza restare per sempre tra i "da riconciliare". **Precedenza alla fattura:** se una bolletta È
caricata come fattura, i matcher la agganciano PRIMA (la funzione utenze salta i movimenti con
`reconciliation_log` applied/to_confirm). Il beneficiario è confermato con la stessa regola stretta di R5
(`supplier_confirmed_in_text`: P.IVA o parola distintiva ≥4 char).
- **Dove:** `close_utility_movements` (migr. 118), agganciata come ultimo passo di
  `run_daily_reconciliation`; flag `suppliers.is_utility` + toggle in `src/pages/Fornitori.tsx`.
- **Match a CONFINE DI PAROLA (migr. 119):** poiché la chiusura utenze non ha il vincolo
  di importo/numero, il nome si confronta come **token isolato** (`supplier_confirmed_in_text_strict`,
  regex `\y…\y`), non come sottostringa. Senza questo, "HERA **COMM**" matchava "**COMM**ISSIONI"
  e chiudeva quasi tutti i movimenti (caso reale: 720/1096). Le sigle `comm`/`comp`/`cons` sono
  in stoplist.
- **⚠️ Solo utenze SENZA fattura.** Un fornitore con fatture nel gestionale NON va marcato `is_utility`
  (le sue fatture si agganciano via R7). Caso reale: **HERA COMM ha 51 fatture** (collegate per `supplier_id`,
  non per nome) pagate con SDD cumulativi → NON è una utenza-senza-fattura, va riconciliata con R7 a numeri.
  Salvaguardia (migr. 120): `close_utility_movements` **non chiude** un movimento che cita in causale numeri
  di fattura reali (≥6 cifre) non ancora agganciati — la fattura ha sempre la precedenza.
- **Stato:** ✅ AUTO SEMPRE (sui fornitori marcati `is_utility`, e solo dove non c'è fattura). Reversibile (`is_reconciled=false`).

---

## Cosa è AUTOMATICO oggi vs cosa NO (sintesi onesta)

| Regola | Auto sempre | Propone | Gap / manuale |
|---|:--:|:--:|---|
| R1 chiuse a mano sempre verificate | ✅ | | |
| R2 fattura senza aggancio abbinabile | ✅ | | |
| R3 scorporo commissioni | ✅ | | |
| R4 importo unico esatto | ✅ | 🟡 (più candidati) | |
| R5 conferma fornitore stretta | ✅ | | |
| R6 1 bonifico = 1 fornitore | | 🟡 | |
| R7 cumulativi granitici | ✅ | 🟡 (anonimi) | |
| R8 netto di nota di credito | | 🟡 (propone, NC collegate e vaganti) | |
| R9 non-fornitore (no bonifici veri) | ✅ | | |
| R10 numeri fattura | ✅ | | limite formati diversi / numeri attaccati |
| R13 utenze senza fattura | ✅ (fornitori `is_utility`) | | serve marcare il fornitore |

### Gap — stato aggiornato (2026-07-25)
1. **R8 detector frontend** — ✅ **CHIUSO** (migr. 117 + TesoreriaManuale): il detector carica le NC,
   sottrae quelle **collegate** dalla base e include quelle **vaganti** (payable a importo negativo)
   come voci del gruppo. Le distinte con nota di credito vengono ora **proposte da sole**.
2. **Cross-link su importi duplicati** — 🟡 **MITIGATO** (migr. 117): il biettivo non aggancia più un
   movimento a una fattura emessa **dopo** (guardia "non si paga prima di esistere", 15 gg). Resta
   un margine di ambiguità quando lo stesso fornitore ha più fatture identiche nello stesso periodo:
   il sistema aggancia alla data più vicina (di norma corretto), altrimenti si corregge a mano.
3. **Distinte non persistite** — ℹ️ **NON necessario per la riconciliazione:** con R8 chiuso, le distinte
   con NC si riconciliano già dalle fatture + NC. Salvare le distinte in `payment_batches` resta solo
   un miglioramento di comodità (aggancio diretto movimento↔distinta), non un buco di riconciliazione.

---

## Riferimenti (migration)
`100` include chiuse a mano · `101` gruppo · `102` granitico · `103` booked · `104` biettivo ·
`105` cron · `108` chiusura non-fornitore · `110` importo anonimo · `111` numeri corti ·
`112` correttiva (importo stretto + fix chiusura) · `113` conferma fornitore stretta ·
`114` fattura senza aggancio abbinabile nelle RPC · `115` netto di nota di credito ·
`116` fattura senza aggancio abbinabile anche nei matcher automatici (R2 completa) ·
`117` note di credito vaganti nel gruppo + guardia anti "pagato prima" (biettivo) ·
`118` utenze (addebiti permanenti RID/SDD): flag `is_utility` + `close_utility_movements` ·
`119` utenze: match a confine di parola (`supplier_confirmed_in_text_strict`) — fix over-match "COMM" ·
`120` SDD cumulativi agganciati per NUMERI di fattura in causale (`try_match_group_numbers_bank_transaction`,
caso HERA COMM) + salvaguardia utenze (fattura ha la precedenza) ·
`121` trigger INSERT include il matcher a numeri.
Edge: `acube-ob-tx-sync` lancia `run_daily_reconciliation` a fine import (riconciliazione subito, non solo alle 05:45).
Frontend: `src/pages/TesoreriaManuale.tsx` (detector, ricerca manuale, `movementNet`, `isRealTransfer`);
`src/pages/Fornitori.tsx` (toggle "È un'utenza").

### R14 — Un movimento NON può pagare una fattura emessa DOPO di lui
La data del movimento non può precedere la `invoice_date` della scadenza: nemmeno di un giorno.
Il limite verso il futuro resta largo (i pagamenti in ritardo sono la norma), quello verso il
passato è secco. Pagare prima della **scadenza** resta ovviamente ammesso: la guardia guarda la
data fattura, mai la `due_date`.
- **Caso reale (04/09/2026):** EPPI S.R.L. fattura 32 del 03/08/2026, scad. 30/09, 3.050 €,
  risultava pagata da un movimento MPS del **03/06/2026**. Il cron del 04/08 aveva ripreso quel
  bonifico rimasto orfano, letto `IMPORTO BONIFICI: 3.050,00` dalla causale CBI anonima e trovato
  una sola fattura aperta con quell'importo: la 32, emessa il giorno prima. EPPI fattura 3.050 €
  ogni mese, quindi l'importo da solo non distingue niente. La finestra della migration 164
  ammetteva fino a **120 giorni di anticipo** sulla data fattura, e 61 ci stavano dentro.
  Bonifica dei 33 agganci già prodotti: `NZ_ONLY_20260904_180` (solo NZ).
- **Dove:** `try_match_amount_bank_transaction`, `try_match_bank_transaction`,
  `rerun_bijective_reconciliation` (migr. **179**). La regola era già nella 117, ma solo sul
  biettivo e con 15 giorni di tolleranza: ora è uniforme e senza tolleranza.
- **Non si applica** ai granitici a nome (102/111) e a numeri (120): lì la causale cita il numero
  della fattura, che è prova diretta che la fattura esisteva già.
- Quando `invoice_date` è NULL la guardia non scatta (non sappiamo quando è nata la fattura).
- **Stato:** ✅ AUTO SEMPRE.

---

### R15 — CONTANTI e CARTE: chiusura provvisoria alla scadenza
Contanti, carta di credito e carta di debito non lasciano in banca un movimento riconducibile alla
singola fattura: i contanti non passano dal conto, la carta di credito produce **un unico addebito
mensile cumulativo**, la carta di debito un pagamento POS che nomina l'esercente e non il fornitore
fatturato. Senza una regola quelle scadenze restano aperte per sempre anche a pagamento avvenuto
(al 09/09/2026 su NZ: 30 scadenze per 1.678 €).
- **Regola:** si chiudono in via **provvisoria** (`is_provisional_paid`), come le RiBa
  (R13/migr. 146). Etichetta «Pagato (provvisorio)», reversibile con `reopen_payable`.
- **Quando, e con che data** (migr. 197): le due cose coincidono, perché la data della chiusura è
  quella in cui il denaro esce davvero.
  - **CARTE** → alla **data di addebito**, il 20 del mese successivo alla spesa (R16). Fino ad
    allora la scadenza è comunque fuori dalla lista dei pagamenti: è `is_auto_debit`, quindi lo
    Scadenzario la toglie dalle Aperte e la mostra nel riquadro «In attesa carta».
  - **CONTANTI** → **subito**, con `payment_date` = data della **fattura**: in contanti si paga
    alla consegna, quindi la scadenza calcolata dal piano del fornitore (es. 30 gg fine mese) è una
    data che non corrisponde a nulla. Aspettarla lasciava la riga fra le Aperte per settimane,
    confondendo chi prepara i bonifici e gonfiando il totale da saldare con soldi già usciti.
- **Dove:** `fn_cash_card_provisional_close` (migr. 194), richiamata ogni notte da
  `run_daily_reconciliation` e, per lo storico, da `rpc_cash_card_provisional_close_backlog`.
- **Il movimento può arrivare dopo**, e da **due** sorgenti: A-Cube *oppure* un **estratto conto
  caricato a mano** (per le carte spesso è l'unica). Quando arriva, l'aggancio rende definitiva la
  chiusura: il trigger `update_payable_status` azzera `is_provisional_paid` da solo. Per questo il
  ramo anonimo di `try_match_amount_bank_transaction` accetta anche le provvisorie (migr. 195),
  con finestra -30 / +60 giorni dalla data di pagamento: più larga in avanti perché l'addebito
  della carta arriva anche un mese e mezzo dopo la spesa.
- **Stato:** ✅ AUTO alla scadenza (provvisorio) / ✅ AUTO l'aggancio quando il movimento compare.

---

### R16 — Spese a CARTA riconosciute anche senza modalità in fattura
Il riconoscimento «questa spesa si paga con carta» (`fn_payable_auto_debit`, migr. 134/135) ha tre
criteri: **MP08** nella fattura, **categoria** marcata a carta, **fornitore** configurato a carta.
Dal 10/09/2026 funzionano tutti e tre davvero.
- **Il difetto (migr. 196):** `v_is_mp08 boolean := (NEW.payment_method_code = 'MP08')`. Con
  `payment_method_code` NULL — cioè quando la fattura non porta il blocco DatiPagamento, il caso
  della maggioranza: **745 scadenze su NZ** — quel confronto vale **NULL**, non false. Da lì ogni
  `IF NOT v_is_mp08` e `IF NOT v_should` è NULL e quindi falso: i criteri (2) e (3) non venivano
  **mai** valutati. Funzionava solo l'MP08 esplicito.
- **Il sintomo:** spese da bar, ristoranti e distributori (categoria «Viaggi e trasferte»,
  «mezzi e carburante») mostrate come «Bonifico ordinario» con scadenza a 30 giorni fine mese.
  Caso reale: LA COMPAGNIA DEL PROSCIUTTO, fatture 282/19 e 405/19.
- **Il fix:** `COALESCE(NEW.payment_method_code = 'MP08', false)`. Una riga.
- **Lezione:** in plpgsql un confronto con NULL non è falso, è NULL, e `IF NOT NULL` non entra.
  Ogni flag booleano che nasce da un confronto su colonna nullable va avvolto in COALESCE,
  altrimenti la logica successiva si spegne senza errori e senza log.
- **La scadenza giusta di una spesa a carta** non è «a vista» né il piano del fornitore: è il
  **20 del mese successivo** alla fattura, quando la carta addebita il conto. Da lì in poi vale
  R15 (chiusura provvisoria alla scadenza).

---

### R17 — Il CODICE della fattura vince sul default del fornitore (per ora solo MP01)
Il codice SDI della modalità di pagamento (`payables.payment_method_code`) veniva letto e salvato
ma **non tradotto** nel metodo della scadenza, che restava quello del piano fornitore.
- **Caso reale 10/09/2026:** HOTEL INN 1972/26, 77,00 €, fattura con «Contanti» nei dati di
  pagamento e `payment_method_code = 'MP01'`, ma metodo `bonifico_ordinario`: restava fra le Aperte
  come se ci fosse un bonifico da disporre, e la regola dei contanti (R15) non la vedeva.
- **Regola (migr. 198):** `MP01 → contanti`, e vince su categoria e anagrafica, perché è il
  documento a dire com'è stata pagata quella fornitura. Le date non si toccano: ci pensa R15.
- **Gli altri codici NON si traducono in automatico**, di proposito: `MP12` non dice la variante
  RiBa (30/60/90/120), che dipende dal piano del fornitore, e `MP19`/`MP16` hanno più varianti SDD.
- **Da guardare a mano** (fotografia NZ al 10/09/2026): **10 scadenze aperte con MP12 trattate come
  bonifico**, 18.530,12 €. Sette hanno il fornitore configurato a RiBa (REALCART riba_90, faliero
  grafica riba_60, TANESINI riba_60) e tre no (MARF ×2, PROFASHION). Il rischio non è cosmetico:
  se una RiBa finisce in una distinta bonifici si paga due volte, perché la banca incassa comunque
  la ricevuta.

---

### R18 — Il pagamento si legge DENTRO la fattura, non solo nella colonna
Estensione di R17 dopo tre casi ancora aperti trovati da Patrizio il 10/09/2026.
- **Linea Ufficio di MASI, FT 001902 (126,05 €):** l'XML dichiara `MP01` ma
  `payables.payment_method_code` era VUOTA. La regola R17 guardava solo la colonna, quindi non
  vedeva niente. **Lezione: la colonna è una copia, la fattura è la fonte.**
- **MAGLIONE, D988 (24,47 €):** nessuna modalità dichiarata, ma la causale dice «Fattura in
  riferimento scontrino n. 21 del 23/06/2026». Una fattura emessa a fronte di uno **scontrino** è
  già stata pagata alla cassa: niente da disporre.
- **Only The Food, XR-141 (15,90 €):** `MP08` nell'XML, mai letto.
- **La causa comune:** il trigger cercava la modalità solo col pattern dell'XML puro
  (`<ModalitaPagamento>MP08</ModalitaPagamento>`), mentre le fatture del bridge A-Cube sono salvate
  in **JSON** (`"modalita_pagamento": "MP08"`). Quel ramo non trovava mai nulla.
- **Regola (migr. 199):** si legge la modalità in **tutti e due i formati**, si riconosce lo
  scontrino / la ricevuta fiscale **nella causale**, e il codice trovato viene riportato in
  `payment_method_code`.
- **Perimetro stretto sullo scontrino:** cercare quelle parole in tutto l'XML dà falsi positivi
  grossolani (le fatture REALCART scrivono «Corrispettivo non comprensivo del contributo
  ambientale Conai» nelle righe). Solo la causale.
- **Trappola tecnica (199b):** in Postgres il conteggio di ripetizione di un regex POSIX arriva a
  **255**. Un `{0,400}` passa il `CREATE FUNCTION` e fallisce a runtime al primo INSERT/UPDATE,
  rendendo la tabella di fatto di sola scrittura bloccata. Tenere i contatori sotto 255.
- **Il ripasso va fatto su TUTTE le righe aperte**, non sul sottoinsieme che si sospetta: la
  prima volta avevo ritoccato solo le 4 righe col codice vuoto e mi erano sfuggite 11 fatture
  Amazon con categoria a carta e codice MP05.

### R19 — Gli affitti degli outlet sono ad addebito diretto, non a bonifico
Segnalato da Patrizio il 10/09/2026 guardando la Simulazione fabbisogno, che classificava i canoni
fra le uscite rinviabili.

- **Il fatto:** i canoni dei punti vendita escono con SDD. I movimenti bancari 2026 non lasciano
  spazio: «ADDEBITO SDD N. 653993053 A FAVORE SAN MAURO SPA CODICE MANDATO SDDSMA250000004».
  C'è il numero di mandato, quindi è addebito diretto autorizzato.
- **Il dato era sbagliato in anagrafica** per cinque locatori su nove: Valdichiana Propco (6
  addebiti per 113.923,90), Frankie Retail Holdco (4 per 64.640,40), Palmanova Propco (9 per
  33.984,57), SAN MAURO (11 per 33.728,13), CONSORZIO SHOPINN (10 per 12.465,46). Solo BMG
  BARBERINO e DWS GRUNDBESITZ erano già a `rid`.
- **Perché conta:** `suppliers.payment_method` alimenta lo Scadenzario, le distinte, la
  riconciliazione e la Simulazione fabbisogno. Con «bonifico» quei canoni risultano da disporre a
  mano e rinviabili, mentre partono dal conto da soli: la simulazione sottostima l'obbligatorio e
  una distinta bonifici potrebbe farli uscire due volte.
- **Eccezione confermata:** FUTURA IMMOBILIARE resta a bonifico, sette movimenti su sette sono
  bonifici da internet banking. TORINO FASHION VILLAGE è stato allineato a `rid` su indicazione di
  Patrizio (mandato attivo, un solo movimento in banca che non fa testo).
- **Fix:** migration `NZ_ONLY_20260910_202`, anagrafica più scadenze ancora aperte; le righe già
  pagate conservano il metodo con cui sono state saldate. Backup in `_bkp_locatori_sdd_20260910`.
- **Lezione generale:** il metodo di pagamento in anagrafica è una dichiarazione, i movimenti
  bancari sono un fatto. Quando i due divergono vince la banca, e prima di costruire una regola
  sopra `payment_method` conviene contare quanti addebiti diretti e quanti bonifici ci sono
  davvero per quel fornitore.

### R20 — La categoria si legge anche DENTRO la fattura, e da lì scende il pagamento
Chiesto da Patrizio il 10/09/2026: «visto che si legge gasolio e l'importo è chiaramente basso non
si può creare una regola che crea la categoria e quindi gestisce anche il concetto del pagamento?».

- **Il fatto:** una fattura BELLUCO di gasolio, 116,96 €, restava «Non categorizzata» e quindi
  bonifico aperto in scadenzario. Il campo per le parole chiave (`cost_categories.matching_keywords`)
  esisteva da sempre, ma non lo leggeva nessuno: `fn_auto_categorize_payable` guardava solo la
  categoria predefinita del fornitore. Sui dati veri quella strada non copre il caso: delle 69
  scadenze aperte senza categoria, **zero** si risolvevano dallo storico, perché appartengono a 37
  fornitori occasionali mai categorizzati prima. L'unica informazione disponibile è cosa c'è
  scritto nella fattura.
- **Regola (migr. 200):** quando fornitore e anagrafica non dicono niente, la categoria si cerca
  nelle **descrizioni di riga** della fattura, nei due formati (JSON del bridge A-Cube e XML puro).
  Solo le righe: cercare le parole in tutto il documento pescherebbe nomi, indirizzi e causali.
  Da lì la catena prosegue da sola, perché `fn_payable_auto_debit` gira nella stessa transazione:
  categoria a carta (`auto_debit_card`) → metodo carta, scadenza al 20 del mese successivo, e la
  scadenza non resta fra i bonifici da disporre.
- **Criterio: vince chi RICORRE di più, non la parola più lunga.** La prima versione sceglieva per
  lunghezza e sbagliava 5 fatture su 25: REALCART e faliero finivano in «Spedizioni» per una riga
  di porto, AXET e UnipolTech in «Locazione» per la parola «canone», Publiacqua in «Interessi
  passivi». A parità di occorrenze decide la parola più specifica; se resta un pareggio non si
  sceglie e la fattura resta da categorizzare a mano.
- **Prudenza sulle fatture articolate:** una parola sola dentro un documento lungo (più di 120
  caratteri di righe) non decide. È quasi sempre una voce accessoria (spese di spedizione,
  interessi, bolli) e non il tema della fornitura.
- **Parole scritte come RADICI:** `puliz` prende pulizia, pulizie e pulizio; `manutenzion`,
  `riparazion`, `cancelleri`, `carburant`, `pedagg`, `ristorant`. Fuori i termini generici come
  «canone» e «spedizione», che pescavano righe accessorie.
- **Esito sul vivo (NZ, 10/09/2026):** 9 scadenze aperte categorizzate, tutte verificate a mano —
  memo e IP SERVICES (gasolio), UnipolTech (pedaggi), AXET e LA FAVORITA (pulizie), TEDi ×2
  (cancelleria), MARCO (manutenzione), Hills (soggiorno).
- **Recupero dello storico:** `rpc_categorize_from_lines_backlog(p_only_open)`, riservata a
  contabile e super_advisor.

### R21 — Un addebito diretto DICHIARATO non diventa «carta» per via della categoria
Emerso subito dopo la R20, sulla stessa fattura UnipolTech.

- **Il fatto:** il telepedaggio UnipolTech (91,85 €) è finito in «mezzi e carburante», categoria
  marcata `auto_debit_card`. Il trigger l'ha portata a carta di credito e ne ha spostato la
  scadenza dall'11/09 al 20/10. Ma quella fattura dichiara **MP19**, cioè RID: l'addebito arriva
  sul conto alla sua data, non sull'estratto carta del mese dopo.
- **Regola (migr. 201):** la strada «categoria» e la strada «anagrafica fornitore» non scavalcano
  più un canale automatico già dichiarato — `MP17`, `MP19`, `MP20`, oppure una colonna
  `payment_method` già su `rid`, `sdd_core`, `sdd_b2b` o una RiBa.
- **Cosa NON cambia:** `MP08` porta a carta come prima; le fatture **senza** codice restano il
  terreno della categoria (è il caso BELLUCO); i fornitori come Amazon, che dichiarano MP05 e
  vanno a carta per anagrafica, restano a carta.
- **Lezione:** fra le tre fonti l'ordine di forza è **codice dichiarato in fattura → anagrafica
  fornitore → categoria di costo**. La categoria è l'indizio più debole: serve dove le altre due
  tacciono, non per correggerle.

### R22 — Metà dei movimenti «da abbinare» non ha nessuna fattura dietro
Segnalato da Patrizio il 10/09/2026 incollando l'elenco dei movimenti non riconciliati:
«perché non le abbina queste?». La risposta, per due terzi di quell'elenco, è che non c'era
niente da abbinare.

- **La fotografia (NZ, 10/09/2026, 316 uscite non riconciliate dal 1° gennaio):**

  | Natura | Movimenti | Totale |
  |---|---|---|
  | Mutui e finanziamenti | 9 | 70.733 |
  | Spese e canoni bancari, fideiussioni | 24 | 6.085 |
  | Prelievi, giroconti, passaggi contanti, assegni | 10 | 162.768 |
  | Commissioni POS Nexi, tax free Global Blue, estratto carte | 81 | 7.670 |
  | Commissioni d'incasso SEPA | 61 | 182 |
  | **Non abbinabili per natura** | **185** | **247.438** |
  | Distinte bonifici CBI | 59 | 363.807 |
  | Bonifici singoli | 45 | 170.735 |
  | Addebiti diretti a locatori e utenze | 11 | 113.293 |
  | MAV e bollettini | 15 | 1.426 |
  | Effetti RiBa | 1 | 6.758 |
  | **Da lavorare davvero** | **131** | **656.019** |

- **Perché il filtro che c'era non scattava:** guardava `bank_transactions.category` con le sigle
  A-Cube in inglese (`fees`, `loans`, `wages`, `taxes`, `financials`, `income`). Sui dati veri le
  categorie sono in italiano o assenti: `utenze` 142, `spese_banca` 320, `(nessuna)` 477, contro
  `fees` 17 e `loans` 1. E il secondo filtro, sul testo, era ancorato all'inizio della causale
  (`^Comm\.`), mentre le causali di questa banca cominciano tutte con «Causale: …».
- **Regola:** il riconoscimento va fatto sulla CAUSALE, che la banca scrive sempre, non sulla
  categoria, che è un'etichetta inaffidabile. Pattern in `BANK_OWN_MOVEMENT_RE`
  (`src/lib/reconcileMatch.ts`), coperti da test con le causali vere.
- **La categoria non si può usare nemmeno al contrario:** `spese_banca` contiene le DISPOSIZIONI
  con flusso CBI, che sono i bonifici ai fornitori. Escluderla in blocco avrebbe nascosto
  363.807 € di pagamenti veri.
- **Pattern volutamente stretti**, per non mangiarsi pagamenti veri: «CANONE» da solo NO (un
  canone di locazione è un pagamento a un fornitore), solo `CANONE RAPPORTO` / `CANONE SET DI
  BASE` / `CANONE HOME BANKING`. Gli ASSEGNI restano dentro: un assegno paga spesso una fattura.
  Lo «Storno scritture» resta dentro, va guardato caso per caso.
- **Attenzione alle proposte registrate nel log:** 73 movimenti avevano già una riga
  `reconciliation_log` di tipo `auto_fuzzy` con `applied_amount` nullo. Non sono abbinamenti
  fatti, sono accostamenti per solo importo, e sono quasi tutti sbagliati: una rata di mutuo da
  1.177,41 proposta contro una fattura GRUPPO FB da 1.207,80; un SDD Global Blue da 259,90
  contro una WOLF GROUP da 9.970,88. Una riga nel log NON vuol dire movimento riconciliato:
  guardare sempre `applied_amount` e `is_reconciled`.
- **Esito:** l'elenco da lavorare passa da 250 a 140 movimenti, da 899.318 € a 679.060 €.

### R23 — «Senza aggancio bancario è abbinabile» vale anche nel motore, non solo nella UI
Chiesto da Patrizio il 10/09/2026: «sì verifica le CBI».

- **Il fatto:** delle 59 distinte CBI non riconciliate su NZ, **20 avevano UNA sola fattura di
  importo netto esattamente uguale**, e nessuna di quelle fatture aveva un movimento collegato.
  Coppie evidenti — L UNDICESIMO 25,00 bonificata il giorno dopo l'emissione, C.E.B. PLAST
  1.773,95, CT INDUSTRIE 5.577,84, 999 SRL 5.732,17, LAURIA IMPIANTI 1.952,00 — mai proposte.
- **Perché:** la R2 («qualsiasi fattura senza aggancio bancario è abbinabile») era applicata dalla
  UI ma non da `try_match_amount_bank_transaction`, che fra le fatture già pagate accettava solo
  quelle marcate `closed_manually` o `is_provisional_paid`. Le fatture risultate pagate all'import
  o chiuse da altri flussi non hanno nessuno dei due flag: per il motore non esistevano.
- **Regola (migr. 203):** una fattura in stato `pagato` e **senza** `bank_transaction_id` è
  candidata comunque sia stata chiusa. Restano tutte le tutele: importo netto esatto (±0,02),
  candidato UNICO (altrimenti proposta, non aggancio), movimento mai precedente alla fattura,
  finestra da −30 a +180 giorni sulla scadenza.
- **Tutela nuova:** fuori le fatture pagate in CONTANTI o con CARTA. Quei pagamenti non lasciano
  un bonifico in banca, quindi un movimento che ne ripete l'importo è una coincidenza.
- **`payment_date` NON si usa come filtro.** Sui dati veri è quasi sempre la data di scadenza,
  non quella del bonifico: metterla avrebbe tagliato 24 coppie buone su 35.
- **Su una fattura già pagata l'aggancio è solo un collegamento:** importi, stato e data di
  pagamento non si toccano. Verificato sulle 20: `status` resta `pagato`, `payment_date` e
  `amount_paid` invariati, cambia solo `bank_transaction_id`. La chiusura piena resta ai casi in
  cui la fattura è ancora aperta.
- **Esito sul vivo:** 20 movimenti agganciati per 27.034 €, le uscite non riconciliate passano da
  316 a 296. Backup in `_bkp_match_cbi_20260910` (35 righe candidate con lo stato precedente).

#### Cosa resta delle 59 distinte CBI, e perché

| Esito | Distinte | Totale |
|---|---|---|
| Agganciate in automatico (fattura unica di pari netto) | 20 | 27.035 |
| Proposte da confermare (più candidati di pari importo) | 6 | — |
| Senza candidato singolo: serve la combinazione di più fatture | 33 | 336.773 |

Fra quelle senza candidato, **7 hanno un importo tondo a migliaia** (10.000, 40.000: 94.000 € in
tutto). Sono **acconti**, non pagamenti di una fattura: nessun importo esatto li chiuderà mai,
vanno abbinati a mano come pagamento parziale. Le altre 26 hanno i centesimi, quindi o sono
gruppi di più fatture (li lavora il motore dei pagamenti raggruppati) o la fattura corrispondente
non è ancora a sistema.

### R24 — Anche l'addebito diretto è un pagamento automatico
Segnalato da Patrizio il 10/09/2026 aprendo la fattura Lignano Banda Larga n. 1915: «perché vedo
questo SEPA?!». Aveva già chiesto la stessa cosa in mattinata («e anche gli sdd?»): contanti e
carte erano stati sistemati, gli addebiti diretti no. Errore mio, non una dimenticanza accettabile.

- **Il fatto:** la fattura dichiara SEPA Direct Debit B2B con scadenza 15/09. Quei 244,00 €
  partono dal conto da soli, per mandato firmato. Eppure la scadenza stava fra le Aperte come un
  bonifico da disporre. Su NZ erano 5 scadenze per 1.545,67 €, nessuna marcata come automatica.
- **Regola (migr. 205):** un addebito diretto si marca `is_auto_debit`, come la carta, e quindi
  esce dalla lista dei bonifici da disporre e dal totale da pagare. **La scadenza NON si tocca:**
  un SDD esce alla sua data, non il 20 del mese successivo come la carta. Alla scadenza si chiude
  in via provvisoria (`fn_cash_card_provisional_close`), con la stessa reversibilità di carte e
  RiBa: quando il movimento arriva davvero, l'aggancio rende la chiusura definitiva.
- **La lista dei codici SDI, verificata.** La migration 201 diceva «MP17, MP19, MP20 (RIBA)»:
  sbagliato. MP20 è SEPA Direct Debit CORE, la RiBa è MP12, e mancavano MP09, MP10, MP11 e MP21 —
  proprio il codice della fattura Lignano. Elenco corretto degli addebiti diretti:

  | Codice | Cosa è |
  |---|---|
  | MP09 | RID |
  | MP10 | RID utenze |
  | MP11 | RID veloce |
  | MP16 | domiciliazione bancaria |
  | MP17 | domiciliazione postale |
  | MP19 | SEPA Direct Debit |
  | MP20 | SEPA Direct Debit CORE |
  | MP21 | SEPA Direct Debit B2B |

  **MP12 (RiBa) resta fuori:** ha il suo meccanismo dalla migration 146. MP13 è il MAV, che è un
  pagamento da disporre.
- **Il codice si legge anche dentro la fattura** (R18), nei due formati, non solo nella colonna:
  su NZ ci sono 114 fatture con MP19, 40 con MP16, 3 con MP21 e 2 con MP20 la cui colonna dice
  ancora «bonifico ordinario». Quando il documento dichiara un addebito diretto e la colonna è
  rimasta sul bonifico d'ufficio, la colonna viene allineata (rid, sdd_core o sdd_b2b).
- **Cosa NON viene chiuso d'ufficio:** un addebito diretto la cui data è già passata ma il cui
  movimento non è ancora arrivato resta fra gli «Addebiti automatici», non fra i bonifici. È il
  caso di TORINO FASHION VILLAGE, 983,24 € scaduti il 31/08: in banca non c'è nessun addebito di
  quell'importo, quindi si aspetta.
- **In UI** il chip indaco non si chiama più «In attesa carta» ma «Addebiti automatici», perché
  ora tiene insieme carte e SDD/RID.
