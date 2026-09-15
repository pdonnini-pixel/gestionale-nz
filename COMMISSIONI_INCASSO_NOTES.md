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

D = letto dal documento, B = ricavato dall'addebito SDD in banca, `-` = documento non disponibile.

| outlet | gen | feb | mar | apr | mag | giu | lug | totale |
|---|---|---|---|---|---|---|---|---|
| VDC | 696 B | 432 B | 295 B | 353 D | 487 D | 405 D | 597 D | 3.264 |
| PLM | 305 D | - | - | 246 D | 276 D | 301 D | 474 D | 1.602 |
| TRN | - | - | - | 299 D | 365 D | 389 D | 431 D | 1.483 |
| VLM | - | 169 D | - | 268 D | 378 D | 255 D | 462 D | 1.531 |
| FRC | - | 319 D | - | 323 D | 366 D | 335 D | 407 D | 1.750 |
| BRB | - | - | - | 252 D | 271 D | 271 D | 392 D | 1.186 |
| BRG | - | 79 D | - | 113 D | 123 D | 122 D | 230 D | 668 |
| **totale** | 1.001 | 999 | 295 | 1.853 | 2.265 | 2.079 | 2.992 | **11.484** |

Aliquota media per outlet sui mesi documentati: VDC 0,764%, PLM 0,837%, TRN 0,772%,
VLM 0,746%, FRC 0,762%, BRB 0,773%, BRG 0,752%.

Nei mesi pieni (aprile-luglio) il costo Nexi viaggia intorno a **2.000-3.000 euro al mese**,
di cui solo la quota di Valdichiana passa dal conto corrente. Aggiungendo Amex
(circa 115 euro al mese) e i terminali BCC/Numia (ancora da quantificare), il costo annuo
dell'incasso elettronico è nell'ordine dei **30.000 euro**, oggi quasi tutto invisibile.

### documenti mancanti
Marzo per tutti e 7, gennaio per 6, febbraio per 3: i PDF su Drive esistono ma sono
**scansioni senza testo** (2,3-2,7 MB), non leggibili senza OCR. Per Valdichiana il dato è
stato recuperato dall'addebito SDD; per gli altri quei mesi restano scoperti finché non
arrivano i documenti nativi o non si applica un OCR.

---

## 5. difetti trovati nei dati vivi (da sistemare)

1. **Categorie incoerenti sugli addebiti Nexi.** Sui movimenti 2026 di Nexi e Amex:
   `commissioni_incasso` 82 righe (-796,15), nessuna categoria 36 righe (-3.263,02),
   **`utenze` 36 righe (-1.589,92)**, `fees` 2 righe (-361,65). Le commissioni Nexi di
   Valdichiana sono finite sotto «utenze». Serve una categoria sola e corretta.
2. **Nessuna attribuzione all'outlet.** `bank_transactions` non ha outlet: il codice AX e
   il Payment Contract nel mandato lo consentirebbero in modo deterministico.
3. **Nessun costo in conto economico.** La categoria `COMM_CARTE` («Commissioni carte e
   varie», gruppo generali e amministrative) esiste già in `cost_categories` e oggi non
   riceve niente da questi movimenti.
4. **Addebito ricorrente da 25,62 non spiegato**, comparso su tutti i contratti Nexi il
   13/02, il 21/04 e il 12/08 (179,34 complessivi ad agosto). Non è in nessun estratto.
5. **Migration 195 e NZ_ONLY 198 partono da una premessa sbagliata.** La 195 dice che gli
   accrediti MPS arrivano al netto «tranne un terminale»: quel terminale è Valdichiana, ed è
   l'unico al lordo per contratto. La 198 dice che l'Amex del POS MPS arriva dentro
   l'accredito del giorno: è falso, l'Amex è sempre una riga separata al lordo (271 casi su
   271). La tolleranza dell'1,5% a pioggia nasconde l'errore invece di risolverlo.

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

## 7. riferimenti

- Dati estratti: `docs/commissioni_incasso_2026.csv`
- Prima nota e export: `AUDIT_PRIMA_NOTA_COMMERCIALISTA_2026-09-14.md`
- Riscontro cassa/banca: `supabase/migrations/20260907_195_*`, `NZ_ONLY_20260907_198_*`
- Archiviazione file: `src/lib/archivioFile.ts`, tabella `import_documents`
