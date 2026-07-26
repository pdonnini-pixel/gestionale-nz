# Regole di Riconciliazione — Ciclo Passivo (Gestionale NZ)

> Documento unico delle regole con cui il sistema abbina i **movimenti bancari in uscita**
> alle **fatture fornitore**. Per ogni regola: **cosa dice**, **dove è applicata** (funzione /
> migration / file), e **se è automatica** (sempre) o **manuale** (richiede conferma / non ancora
> coperta). Aggiornato al 2026-07-25. ⚠️ Ogni regola vale su **NZ + Made + Zago**.

## Legenda stato
- ✅ **AUTO SEMPRE** — applicata dal motore a ogni movimento (trigger all'inserimento + cron notturno 05:45).
- 🟡 **PROPONE** — il sistema la propone, la conferma è manuale (un click), non chiude al buio.
- 🔧 **MANUALE** — si fa solo dal pannello Riconciliazione / a mano.
- ⛔ **GAP** — regola giusta ma **non ancora coperta ovunque** (indicato dove manca).

---

## Come gira il motore (ordine dei tentativi)
A ogni movimento in uscita non riconciliato, in quest'ordine:
1. **Granitico di gruppo** — `try_match_group_bank_transaction` (migr. 102/111/113)
2. **A punteggio** — `try_match_bank_transaction` (migr. 100/113)
3. **Biettivo per data** — `rerun_bijective_reconciliation` (migr. 104/113)
4. **A importo (flussi anonimi)** — `try_match_amount_bank_transaction` (migr. 110/112)
5. **Chiusura non-fornitore** — `close_non_supplier_movements` (migr. 108/112)

Innesco: **trigger** `trg_auto_reconcile_bank_transaction` a ogni INSERT su `bank_transactions`
(stati `posted` E `booked` — A-Cube arriva `booked`, migr. 103) + **cron** giornaliero
`run_daily_reconciliation` alle 05:45 (migr. 105, aggiornato 112). Tutto reversibile con
`undo_reconcile_movement`.

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
- **Dove:** detector frontend `toVerifyGroups` — ramo bonifico anonimo (TesoreriaManuale, PR #367).
- **Stato:** 🟡 PROPONE (combinazioni ≥2, un unico fornitore). Il caso a fattura singola → R4 (auto).

### R7 — Pagamenti CUMULATIVI (1 movimento = N fatture)
Un bonifico che salda più fatture **dello stesso fornitore**:
- **Granitico** (auto): fornitore **e** numeri fattura citati in causale **e** somma esatta → migr. 102.
  Include i **numeri corti** (2-3 cifre, es. "SALDO FATTURA 11-12") se la causale ha contesto fattura → migr. 111.
- **Anonimo** (propone): nessun nome/numero → un unico fornitore la cui combinazione somma al netto → R6.
Aggancio **atomico** (tutto-o-niente): se la somma non torna, non abbina nulla.
- **Dove:** `try_match_group_bank_transaction` (auto), `reconcile_movement_group` (esecuzione, migr. 101/114/115).
- **Stato:** ✅ AUTO (granitico) / 🟡 PROPONE (anonimo).

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
- **Stato:** ✅ AUTO SEMPRE (sui fornitori marcati `is_utility`). Reversibile a mano (`is_reconciled=false`).

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
`119` utenze: match a confine di parola (`supplier_confirmed_in_text_strict`) — fix over-match "COMM".
Frontend: `src/pages/TesoreriaManuale.tsx` (detector, ricerca manuale, `movementNet`, `isRealTransfer`);
`src/pages/Fornitori.tsx` (toggle "È un'utenza").
