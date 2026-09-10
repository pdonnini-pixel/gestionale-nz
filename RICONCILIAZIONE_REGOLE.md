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
