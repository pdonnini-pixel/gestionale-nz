# commissioni di incasso elettronico (Amex, Nexi) — regole e stato

Note della sessione 15/09/2026. Fonti: 8 estratti conto Amex (gennaio-agosto 2026),
32 estratti conto Nexi (gennaio-luglio 2026, 7 punti vendita), database vivo NZ.
Dati estratti in `docs/commissioni_incasso_2026.csv`.

Vale per tutti e 3 i tenant come impianto; i numeri qui sono di New Zago.

---

## 1. la regola, in breve

Il costo dell'incasso elettronico arriva in due forme diverse, e **la forma dipende dal
contratto del singolo punto vendita, non dal circuito e non dalla banca**.

| forma | chi | cosa si vede in banca |
|---|---|---|
| **al lordo** | Amex (tutti i punti vendita), Nexi solo Valdichiana, terminali BCC/Numia | accredito = transato; la commissione arriva a parte come SDD a inizio mese successivo |
| **al netto** | Nexi per gli altri sei punti vendita | accredito = transato meno commissione; in banca del costo non resta traccia |

Chi accredita al lordo rende il costo visibile. Chi accredita al netto lo nasconde dentro
un ricavo più basso: il gestionale registra un incasso già decurtato e il conto economico
non vede mai la voce di costo.

---

## 2. Amex

Estratto conto mensile «Estratto Conto Commissioni», un documento per azienda che contiene
tutti i punti vendita. Lordo accreditato T+1, commissioni addebitate a inizio mese
successivo con **un SDD per punto vendita**.

- Il **codice AX** del punto vendita è dentro il numero di mandato SDD:
  `7043090000007377153036` → `7377153036`. Aggancio deterministico, nessuna ambiguità.
- L'imposta di bollo (2,00 dal mese di aprile) viaggia dentro l'SDD di un solo punto vendita.
- Aliquota: **0,90% fino a febbraio 2026, 1,50% da marzo**. Aumento mai intercettato.
- 11 codici AX nel periodo per 7 outlet: la lista non è statica (uno si spegne a gennaio,
  Settimo Torinese si accende a fine marzo). Va trattata come anagrafica con validità.

Verifiche fatte sui dati vivi (gennaio-agosto 2026):

| verifica | esito |
|---|---|
| addebiti in banca del mese M+1 = totale estratto del mese M | 8 mesi su 8, al centesimo |
| righe Amex passate da MPS ritrovate in banca (per terminale, importo, finestra 5 gg) | 271 su 271 |
| accrediti Amex su conto BCC, totale gennaio-agosto | quadrano; lo scarto di 274,53 è la coda di dicembre 2025 |

Totali 2026 (gen-ago): transato 52.969,77, commissioni 725,90, bolli 10,00.

### mappa codice AX → outlet → terminale

| codice AX | outlet | terminale |
|---|---|---|
| 7373035260 | VDC Valdichiana | 00001 BCC + 00002 MPS |
| 7377153036 | BRB Barberino | 00004 MPS |
| 7377511100 | FRC Franciacorta | 00006 BCC |
| 7378034250 | PLM Palmanova | 00007 MPS |
| 7379455439 | PLM Palmanova (cessato, solo gennaio) | 00005 BCC |
| 7379416167 | BRG Brugnato | 00010 BCC |
| 7379605249 | BRG Brugnato | 00009 MPS |
| 7543377782 | VLM Valmontone | 00012 BCC |
| 7543394233 | VLM Valmontone | 00011 MPS |
| 9341423540 | TRN Torino | 00013 MPS |
| 9341489277 | TRN Torino | 00014 BCC |

---

## 3. Nexi

Estratto conto mensile **per punto vendita**, non per azienda. Il regime è scritto a pagina 2:
«Payment Contract PC0001000583 : **al lordo**» oppure «: **al netto**».

| outlet | punto vendita | Payment Contract | regime | mandato SDD |
|---|---|---|---|---|
| VDC Valdichiana | LN0004777495 | PC0001000583 | **al lordo** | CL2XV900518975… |
| PLM Palmanova | LN0005475974 | PC0001392693 | al netto | CL2XV900827881… |
| BRB Barberino | LN0005458723 | PC0001379716 | al netto | CL2XV900815659… |
| FRC Franciacorta | LN0005489545 | PC0001396411 | al netto | CL2XV900831630… |
| BRG Brugnato | LN0005533489 | PC0001450042 | al netto | CL2XV900870388… |
| VLM Valmontone | LN0005674696 | PC0001488287 | al netto | CL2XV900910890… |
| TRN Torino | LN0005755045 | PC0001563440 | al netto | CL2XV900984755… |

Valdichiana è al lordo perché ha il contratto più vecchio (numero PC molto più basso).
Gli altri sono stati aperti dopo, con il regime standard attuale.

- In causale bancaria il **codice CBI separa i circuiti**: `CBI:0941` internazionali e APM,
  `CBI:0909` BANCOMAT. Non serve nessun documento per distinguerli.
- Chi è al netto paga in banca solo **4,50 al mese** (2,50 acquiring + 2,00 bollo).
- Aliquote reali: **BANCOMAT 0,588% identico ovunque**, internazionali da 0,795% a 0,902%
  (la differenza dipende dal mix di carte, cioè da interchange e oneri di circuito).
- Attenzione al parser: il riquadro di pagina 2 e la somma delle righe giornaliere
  differiscono di qualche centesimo. **Fa fede il riquadro**, che coincide con l'addebito.
- La nomenclatura cambia nel tempo: «CIRCUITI INTERNAZ.» fino ad aprile, poi «INTERNAZ. E APM».

Verifica fatta sui dati vivi: presi due giorni per outlet di luglio e cercati in banca sia
il lordo sia il netto, **14 controlli su 14** danno il lordo solo per Valdichiana e il netto
per gli altri sei.

---

## 4. costo reale per outlet e mese (euro)

Aggiornato al **16/09/2026**, quando Sabrina ha mandato i 22 estratti Nexi che mancavano
(gennaio, febbraio, marzo e agosto) piu' l'Amex di dicembre 2025. Erano documenti nativi,
non scansioni: letti riga per riga. Il 2026 da gennaio ad agosto e' **completo**, Nexi e
Amex insieme, nessun mese stimato.

Commissioni per outlet (Nexi + Amex, euro):

| outlet | gen | feb | mar | apr | mag | giu | lug | ago | totale | transato | aliquota |
|---|---|---|---|---|---|---|---|---|---|---|---|
| VDC | 709 | 437 | 302 | 368 | 495 | 420 | 625 | 494 | **3.848** | 506.324 | 0,760% |
| FRC | 551 | 330 | 256 | 331 | 400 | 359 | 425 | 393 | **3.046** | 393.326 | 0,774% |
| VLM | 385 | 190 | 117 | 289 | 407 | 277 | 493 | 262 | **2.419** | 313.688 | 0,771% |
| PLM | 309 | 210 | 157 | 252 | 285 | 310 | 485 | 386 | **2.394** | 281.171 | 0,851% |
| BRB | 369 | 229 | 137 | 264 | 281 | 286 | 406 | 330 | **2.303** | 295.000 | 0,781% |
| TRN | - | - | 85 | 315 | 381 | 403 | 463 | 311 | **1.959** | 249.084 | 0,786% |
| BRG | 163 | 84 | 72 | 121 | 131 | 130 | 245 | 296 | **1.243** | 160.093 | 0,776% |
| **totale** | 2.486 | 1.479 | 1.126 | 1.939 | 2.380 | 2.186 | 3.143 | 2.473 | **17.212** | 2.198.685 | **0,783%** |

Piu' 248,50 di voci fisse (acquiring 2,50 al mese per contratto, bollo 2,00). Di questi
17.212 euro, **12.750 sono trattenuti alla fonte** e non passano mai dal conto corrente:
li vede solo chi confronta il dichiarato di cassa con l'accreditato.

Palmanova e' il punto vendita piu' caro (0,851%), Valdichiana il piu' economico (0,760%):
undici centesimi di punto su un milione di transato fanno mille euro l'anno.

### il riscontro con la banca, mese per mese
Confronto fra quanto i documenti dicono che verra' addebitato (commissioni al lordo piu'
le voci fisse) e quanto la banca ha davvero addebitato il mese dopo:

| addebito in banca | atteso dai documenti | trovato | scarto |
|---|---|---|---|
| marzo | 506,94 | 506,94 | **0,00** |
| giugno, luglio, settembre | | | +2,00 (un bollo) |
| maggio | 470,48 | 449,98 | -20,50 |
| febbraio | 778,32 | 923,50 | +145,18 |
| aprile | 380,72 | 630,82 | +250,10 |
| agosto | 778,97 | 960,31 | +181,34 |
| gennaio | 60,25 | 738,31 | +678,06 |

I tre scarti grossi hanno un nome. Febbraio, aprile e agosto portano gli addebiti da
**25,62 euro per terminale** (5 il 13/02, 5 piu' 122,00 il 21/04, 7 il 12/08): e' il canone
dei POS, trimestrale, che non sta nell'estratto conto commissioni perche' e' un servizio a
parte. Gennaio e' l'estratto Nexi di **dicembre 2025**, l'unico documento che ancora manca.

### documenti che mancano ancora
- **Nexi dicembre 2025**, sette punti vendita: spiegherebbe i 678,06 addebitati a gennaio.
- **Amex settembre 2026**, che esce a fine mese: serve per chiudere le tre giornate di
  riscontro rimaste aperte (BRG 10/09, FRC 12/09, FRC 13/09).

---

## 5. difetti trovati nei dati vivi (da sistemare)

1. ~~**Categorie incoerenti sugli addebiti Nexi.**~~ **Risolto** dalla NZ_ONLY 223. Prima:
   `commissioni_incasso` 82 righe (-796,15), nessuna categoria 36 righe (-3.263,02),
   **`utenze` 36 righe (-1.589,92)**, `fees` 2 righe (-361,65) — le commissioni Nexi di
   Valdichiana erano finite sotto «utenze». Ora una riga sola: 156 movimenti su
   `commissioni_incasso` per -6.010,74. Backup delle categorie precedenti in
   `docs/backup/20260915_bank_transactions_categoria_commissioni_PRIMA.csv`.
2. **Nessuna attribuzione all'outlet.** `bank_transactions` non ha outlet: il codice AX e
   il Payment Contract nel mandato lo consentirebbero in modo deterministico.
3. **Nessun costo in conto economico.** La categoria `COMM_CARTE` («Commissioni carte e
   varie», gruppo generali e amministrative) esiste già in `cost_categories` e oggi non
   riceve niente da questi movimenti.
4. **Addebito ricorrente da 25,62 non spiegato**, comparso su tutti i contratti Nexi il
   13/02, il 21/04 e il 12/08 (179,34 complessivi ad agosto). Non è in nessun estratto.
5. ~~**Migration 195 e NZ_ONLY 198 partono da una premessa sbagliata.**~~ **Corretto** dalla
   224 e dalla NZ_ONLY 225: vedi la sezione 7 qui sotto.

---

## 6. come va rappresentato

- **Regime lordo/netto in anagrafica**, su `outlet_payment_channels`, insieme al Payment
  Contract e al codice punto vendita `LN…` (Nexi) e al codice AX (Amex).
- **Tolleranza zero** dove l'accredito è lordo; dove è netto la differenza fra dichiarato e
  accreditato non è uno scarto ammesso, è la commissione, e va scritta come costo.
- **Costo separato su `COMM_CARTE`**, attribuito all'outlet, con il ricavo lasciato al lordo.
- **Documenti archiviati su Storage** con `archiviaFile` (bucket `general-documents`,
  registro `import_documents`, modulo Banche, anno e mese), come per gli altri import.

---

## 7. il riscontro cassa/banca rimesso a posto (224 e NZ_ONLY 225)

### cosa sbagliavano la 195 e la 198
La 195 tratta il regime di accredito come un'eccezione («al netto tranne un terminale»)
e compensa con una tolleranza dell'1,5 % su tutti i canali POS. Ma il regime non è un
caso: è scritto nel contratto del punto vendita. Dove l'accredito è al lordo (Valdichiana,
Payment Contract `PC0001000583`) lo scarto ammesso deve essere zero, e una tolleranza
dell'1,5 % su 77 mila euro di transato lascia passare 1.100 euro di differenza senza
dire niente.

La NZ_ONLY 198 degradava i sette canali «POS MPS Amex» a `kind='pos'` con lo stesso
codice terminale del POS, perché dava per scontato che l'Amex arrivasse dentro
l'accredito del giorno. È falso: l'Amex è sempre una riga separata, al lordo, il giorno
dopo la vendita. Verificato su **271 righe su 271** negli estratti Amex di gennaio-agosto.
La conseguenza era un numero falso a video: a settembre la riga Amex di Palmanova
mostrava «accreditato 25.648,94» a fronte di **5.300,20 dichiarati**, perché le due righe
della chiusura finivano nello stesso gruppo e il riscontro scriveva su entrambe il totale
del terminale.

### cosa fanno le nuove migration
- **224** (tutti e tre i tenant): colonna `outlet_payment_channels.settlement_mode`
  (`lordo`/`netto`) e riscrittura di `match_cash_closings_with_bank`. Il riscontro cerca,
  fra i movimenti del terminale, quello che vale **esattamente** quanto la chiusura
  dichiara sul canale Amex di quel giorno, lo abbina al canale Amex e lascia gli altri al
  POS. La tolleranza diventa zero dove il regime è `lordo`.
- **NZ_ONLY 225**: i sette canali «POS MPS Amex» tornano `kind='pos_amex'`, regime
  `lordo`, tolleranza 0; il regime dei canali POS arriva da `acquirer_contracts`, non
  scritto a mano.

### prova, misurata in transazione su NZ (settembre 2026)
| riga | prima | dopo |
|---|---|---|
| POS MPS Amex | dichiarato 5.300,20, accreditato 25.648,94 | 15 righe, dichiarato 1.896,84 = accreditato 1.896,84, scarto 0,00 |
| POS MPS | scarto assorbito dalla tolleranza | 90 righe, scarto -639,85 (-0,63 %: sono le commissioni vere) |

Altre 3 righe Amex risultano in attesa: sono le giornate **BRG 10/09, FRC 12/09, FRC 13/09**,
dove l'accredito esatto non si trova. Si chiariscono con l'estratto Amex di settembre.

### il ricalcolo di settembre (NZ_ONLY 226)
Autorizzato da Patrizio il 15/09. I 235 match POS/Amex di settembre nati dalla regola
vecchia sono stati cancellati e riscritti dalla funzione nuova. Backup prima di toccare
qualsiasi cosa: quattro tabelle `_bkp_riscontro_sett_*_20260915` nel DB e tre CSV in
`docs/backup/20260915_*`.

Esito, misurato dopo il ricalcolo:

| riga | prima | dopo |
|---|---|---|
| POS MPS Amex | dichiarato 5.300,20, accreditato 48.736,28 | accreditato 1.896,84, scarto -3.403,36 |
| POS MPS (Valdichiana, lordo) | 19.808,70 dichiarati, 20.183,98 accreditati | 19.808,70 = 19.808,70, scarto 0,00, tolleranza zero |
| POS MPS (gli altri sei, netto) | 85.232,72 / 88.003,53 | 85.232,72 / 87.928,98 |
| POS BCC e BCC Amex | invariati | invariati, scarto 0,00 |

Delle 18 giornate con Amex dichiarato, **15 tornano al centesimo**. Le tre che restano
sono quelle note: BRG 10/09 (650,54), FRC 12/09 (1.805,71), FRC 13/09 (947,11), in totale
3.403,36. Sono anche la ragione dello scarto positivo che resta sulla riga POS MPS: finche'
quell'accredito Amex non si riconosce, resta nel mucchio del terminale. Si chiude con
l'estratto Amex di settembre.

Nessun movimento perso: 235 match riscritti per gli stessi 126.942,34 euro, zero accrediti
POS o Amex di settembre rimasti senza abbinamento. Le chiusure verificate passano da 96 a
93: le tre che non tornano sono tornate «confermata», che e' la verita'.

### cosa resta aperto
I canali «Pay by link» sono stati modificati il 15/09 alle 14:55 da un utente, messi
`kind='pos'` con i codici terminale dei POS MPS. Non li ho toccati. Dichiarano zero su tutte
le 98 righe di settembre, quindi oggi non spostano numeri, ma competono con il POS sullo
stesso terminale: se un giorno portassero un importo, il riscontro potrebbe attribuirlo
alla riga sbagliata.


---

## 8. riferimenti

- Dati estratti, riga per riga: `docs/commissioni_incasso.csv` (export da `acquirer_fees`)
- Prima nota e export: `AUDIT_PRIMA_NOTA_COMMERCIALISTA_2026-09-14.md`
- Riscontro cassa/banca: `supabase/migrations/20260907_195_*`, `NZ_ONLY_20260907_198_*`,
  corretti da `20260915_224_*` e `NZ_ONLY_20260915_225_*`
- Archiviazione file: `src/lib/archivioFile.ts`, tabella `import_documents`
