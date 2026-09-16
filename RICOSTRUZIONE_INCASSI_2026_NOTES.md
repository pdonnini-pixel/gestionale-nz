# Ricostruzione degli incassi giornalieri 2026 (NZ)

> Sessione del 15/09/2026. Migration da `NZ_ONLY_20260915_223` a `232`.
> Ricostruiti a ritroso otto mesi, da agosto fino a gennaio, con lo stesso impianto usato per
> settembre ma senza le foto delle chiusure: si parte dagli **specchietti incassi dei negozi**
> su Drive e si riscontra tutto con l'**estratto conto**.
> Si e' cominciato da agosto, poi luglio per chiudere il conto del contante, e da li' e' venuto
> naturale scendere fino a gennaio: ogni mese che si aggiunge ripara qualcosa del mese dopo.

Indice: [agosto](#agosto-2026) · [luglio](#luglio-2026) · [il conto del contante](#il-conto-del-contante-si-chiude) · [giugno](#giugno-2026) · [maggio](#maggio-2026) · [aprile](#aprile-2026) · [marzo](#marzo-2026) · [gennaio](#gennaio-2026) · [febbraio](#febbraio-2026) · [il quadro finale](#il-quadro-finale-da-gennaio-a-settembre) · [il pay by link](#il-pay-by-link-passa-dal-pos)

---

## agosto 2026

## Perche'

`daily_revenue` aveva tutti i mesi da agosto 2025 a luglio 2026 e poi settembre 2026.
Agosto era l'unico buco: la pagina Incassi giornalieri mostrava 31 giorni «mancante» per
tutti e 7 i punti vendita e l'obiettivo del mese risultava raggiunto allo 0 %.

## Le fonti, in ordine

1. **Specchietto incassi del negozio** (Drive, cartella `<OUTLET>/AGOSTO`): una riga per
   giorno con corrispettivi, contanti, POS per terminale, pay by link, fatture, bonifici,
   spese di cassa e versamenti.
2. **Estratto conto** (`bank_transactions`): accrediti POS con `DATA RIF.` e codice
   terminale, versamenti contante con sportello e causale.
3. Solo quando le prime due tacciono resta una segnalazione.

I totali riga per riga di ogni foglio coincidono con la riga TOTALE del foglio stesso:
la trascrizione e' verificata, non a occhio.

## Cosa e' stato caricato

| | |
|---|---|
| Giornate | 217 (7 punti vendita x 31 giorni) |
| Corrispettivi | 444.099,25 € |
| Fatture | 323,10 € |
| Contanti incassati | 84.699,70 € |
| Spese di cassa | 620,16 € |
| Versamenti | 73.000,50 € |
| Chiusure verificate dalla banca | 211 su 217 |

Per punto vendita: Valdichiana 94.095,36 · Franciacorta 64.156,85 · Valmontone 60.520,66 ·
Brugnato 60.141,08 · Palmanova 56.705,30 · Barberino 55.787,59 · Torino 52.692,41.

## Il riscontro con i versamenti

**Tutti e 30 i versamenti finiscono in banca.** 28 li ha agganciati da solo
`match_cash_closings_with_bank`, 2 a mano perche' la banca li ha spezzati in due operazioni
dello stesso giorno:

- BRUGNATO 17/08 · 4.250,00 = 2.120,00 (03-09 agosto) + 2.130,00 (10-16 agosto), accreditati il 18/08;
- VALMONTONE 03/08 · 2.400,00 = 1.365,00 + 1.035,00, accreditati il 03/08.

> **Miglioria da fare al motore**: oggi cerca un solo movimento di pari importo entro 6
> giorni. Quando il negozio scrive un versamento unico e lo sportello ne registra due,
> il riscontro fallisce anche se i soldi ci sono tutti. Sommare i versamenti dello stesso
> giorno e dello stesso sportello prima del confronto risolverebbe entrambi i casi.

Due versamenti erano **in banca ma non sullo specchietto**, e sono stati aggiunti leggendo
l'estratto conto (senza di loro la cassa dei due negozi non tornava per lo stesso importo):

- PALMANOVA 11/08 · 3.045,00 (VERS. GDO CC PALMANOVA);
- TORINO 25/08 · 2.180,00 (ATM 9750, Intesa).

Restano fuori, giustamente, tre versamenti di agosto che sono **contante di luglio**:
Franciacorta 1.120,00 e Brugnato 1.135,00 (entrambi «27-31 luglio», accreditati il 03/08) e
Palmanova 760,00 (versato l'01/08). Rientreranno se si ricostruira' anche luglio.

### Cassa: contanti meno spese meno versamenti

| Punto vendita | Contanti | Spese | Versamenti | Delta agosto | Riscontro |
|---|---:|---:|---:|---:|---|
| BARBERINO | 11.408,10 | 65,64 | 10.775,00 | 567,46 | versato 1.980,00 l'01/09 |
| BRUGNATO | 10.903,60 | 232,53 | 10.365,00 | 306,07 | versato 305,00 il 02/09 |
| FRANCIACORTA | 12.242,55 | 39,77 | 8.545,00 | 3.657,78 | versato 3.660,00 l'01/09 (scarto 2,22) |
| PALMANOVA | 12.252,00 | 118,80 | 9.575,00 | 2.558,20 | versato 2.560,65 l'01/09 (scarto 2,45) |
| TORINO | 7.924,75 | 76,97 | 6.710,00 | 1.137,78 | versato 1.680,00 l'01/09 (542,22 in piu') |
| VALDICHIANA | 17.898,80 | 86,45 | 16.540,50 | 1.271,85 | versato 2.498,45 il 04/09 |
| VALMONTONE | 12.069,90 | 0,00 | 10.490,00 | 1.579,90 | versato 2.945,00 l'01/09 (1.365,10 in piu') |

Il delta non e' il fondo cassa: e' la variazione del mese. I versamenti dei primi giorni di
agosto portavano in banca contante di fine luglio, quindi il saldo vero si chiudera' solo
ricostruendo anche luglio. Barberino, Brugnato, Franciacorta e Palmanova tornano; Torino e
Valmontone versano a inizio settembre piu' di quanto risulti incassato ad agosto, coerente
con il contante di luglio rimasto in cassa.

## Le 8 giornate che non quadrano (corrispettivi contro mezzi di pagamento)

| Punto vendita | Giorno | Differenza | Cosa si vede |
|---|---|---:|---|
| BARBERINO | 18/08 | −14,00 | il POS dichiarato coincide con la banca: il buco e' sul totale o sul contante |
| BRUGNATO | 07/08 | −50,00 | riga «RESO» nello specchietto |
| TORINO | 07/08 | −55,90 | |
| TORINO | 10/08 | −52,50 | l'Amex del POS MPS sembra gia' dentro la riga POS MPS |
| TORINO | 15/08 | +205,10 | |
| TORINO | 19/08 | −65,90 | stesso caso del 10/08 |
| VALDICHIANA | 02/08 | +60,00 | |
| VALDICHIANA | 17/08 | +26,45 | pari alla spesa DX SRL: contante segnato al netto della spesa |

Sono differenze del foglio, non della ricostruzione: vanno chiarite con i negozi.
Le giornate con una fattura (Valdichiana 12/08, Valmontone 22/08, Torino 22/08) quadrano:
nel gestionale vale `corrispettivi + fatture = somma dei mezzi di pagamento`, che e'
esattamente la convenzione usata nei fogli.

## Le 8 righe POS con differenza in banca

- **TORINO 13/08** (+50,63) e **VALMONTONE 12/08** (+191,68): la banca accredita piu' del
  dichiarato di un importo pari al «pay by link» del giorno (56,40 e 202,90) al netto delle
  commissioni. Quel pay by link e' passato dal POS MPS, non da un canale a se'.
- **TORINO 10/08 e 19/08**: l'Amex del POS MPS risulta contato due volte nello specchietto.
- **VALMONTONE 10/08 (−0,82) e 29/08 (−0,63)**: solo commissioni, su importi minimi
  (49,95 e 37,90) superano la tolleranza dell'1,5 % del canale.

Per queste 6 giornate lo stato resta «confermata» invece di «verificata».

## Scelte di merito

- **Franciacorta**: la riga datata 1/9 nello specchietto e' il **31/08**. Lo dimostra la
  banca (accredito POS MPS del 31/08 pari a 962,06 netto contro 970,58 dichiarati, mentre
  l'accredito dell'01/09 di 1.302,96 sta gia' sulla chiusura del 01/09).
- **Versamenti a cavallo**: quelli gia' registrati sulle chiusure di settembre non sono
  stati duplicati (Franciacorta 3.660,00 e Palmanova 2.560,65 dell'01/09). Sulla giornata
  del 31/08 restano a zero con la nota che spiega dove sono finiti.
- **Valmontone** ha due versioni dello specchietto sullo stesso mese: e' stata usata
  «Specchietto incassi 1.xlsx», l'unica con i versamenti e con il dettaglio Amex. L'altra
  differisce di 3,00 € sul contante del 20/08.
- Le chiusure sono state confermate d'ufficio, senza foto: la prova e' lo specchietto piu'
  l'estratto conto, e resta scritta in `closed_by_name = 'ricostruzione da specchietto'`.

## Effetti a valle

La conferma proietta le 217 giornate in `daily_revenue` (lordo, contanti, carte, altro,
netto IVA al 22 %), quindi si accendono da sole Outlet, Dashboard, Cashflow, Margini e la
tab Corrispettivi di Fatturazione. Gli accrediti POS e i versamenti di agosto risultano ora
riconciliati in `bank_transactions` con la nota della chiusura di riferimento.

---

## luglio 2026

Luglio aveva un riscontro che agosto non aveva: `daily_revenue` conteneva gia' i corrispettivi
del mese, importati dal **registro corrispettivi** il 09/09/2026. Gli specchietti dei negozi
coincidono con quel registro su **tutti e 217 i giorni, al centesimo**. E' la conferma piu'
forte che il metodo regge: due fonti indipendenti, stesso numero.

| | |
|---|---:|
| Giornate | 217 |
| Corrispettivi | 567.701,98 € |
| Fatture | 1.533,30 € |
| Contanti incassati | 93.242,90 € |
| Spese di cassa | 1.116,89 € |
| Versamenti | 87.671,60 € |
| Chiusure verificate dalla banca | 211 su 217 |

Per punto vendita: Valdichiana 111.946,63 · Valmontone 90.914,58 · Torino 87.782,99 ·
Franciacorta 77.045,83 · Barberino 72.125,23 · Palmanova 68.405,34 · Brugnato 59.481,38.

### Versamenti

**31 dichiarati, 31 trovati in banca.** Ventinove coincidono al centesimo, due restano in
«differenza» perche' la banca ha accreditato piu' di quanto scritto sullo specchietto:

- FRANCIACORTA 08/07: dichiarati 2.455,00, in banca 3.060,00 (2.455,00 + 605,00, stesso
  sportello a tre minuti di distanza);
- FRANCIACORTA 22/07: dichiarati 2.995,00, in banca 3.035,00.

Il dato del negozio non e' stato corretto d'ufficio: il movimento e' agganciato e la
differenza resta visibile. Altri tre versamenti erano spezzati in due operazioni e sono stati
agganciati a mano (Torino 10/07 = 1.470 + 100, Torino 21/07 = 2.880 + 100, e il caso
Franciacorta gia' citato): stessa miglioria al motore segnalata per agosto.

### Le 3 giornate che non quadrano

| Punto vendita | Giorno | Differenza | Cosa si vede |
|---|---|---:|---|
| BRUGNATO | 28/07 | −4,90 | annullo scontrino di 372,80 del 25/07 annotato nel foglio |
| PALMANOVA | 28/07 | −106,00 | |
| PALMANOVA | 29/07 | +106,00 | una vendita in contanti segnata il giorno dopo |

### Le 6 righe POS con differenza

Tre sono lo stesso caso visto ad agosto: il **pay by link passa dal POS MPS**, quindi la banca
accredita quell'importo insieme al POS e il confronto non torna (Valdichiana 07/07 +48,00 e
15/07 +60,10, Torino 27/07 +41,80 al lordo delle commissioni). Le altre tre sono commissioni
su importi minimi (Valmontone 26/07 su 20,70 e 27/07 su 101,50).

> **Seconda miglioria da fare**: il canale «Pay by link» non ha codice terminale, ma i suoi
> incassi arrivano sull'accredito del POS MPS. Cinque conferme in due mesi. Assegnandogli il
> terminale MPS il riscontro tornerebbe da solo.

### Scelte di merito

- **Brugnato** non ha la colonna CONTANTI nel foglio di luglio: il contante e' stato ricavato
  per differenza (corrispettivi + fatture − altri canali).
- **Franciacorta**: due righe datate 9/6 e 27/6 stanno in sequenza fra l'8/7 e il 10/7 e fra
  il 26/7 e il 28/7. Sono il 9 e il 27 luglio.
- **Versamenti a cavallo di mese**: quelli di fine luglio accreditati a inizio agosto e gia'
  registrati sulle chiusure di agosto non sono stati duplicati (Barberino 1.420,00 del 03/08,
  Valdichiana 1.140,15 del 03/08, Torino 600,00 del 01/08, Valmontone 1.365,00 dentro i
  2.400,00 del 03/08). Brugnato 1.135,00 era ancora orfano ed e' stato registrato sul 31/07.

---

## il conto del contante si chiude

Due mesi interi permettono la verifica vera: quanto contante e' entrato, quanto e' uscito, e
quanto doveva restare in cassa il 31 agosto. Il residuo si legge nel primo versamento di
settembre, che porta in banca proprio quel contante.

| Punto vendita | Contanti lug+ago | Spese | Versato lug+ago | Residuo atteso al 31/08 | Primo versamento di settembre | Scarto |
|---|---:|---:|---:|---:|---|---:|
| BARBERINO | 24.508,70 | 131,81 | 22.409,00 | 1.967,89 | 1.980,00 (01/09) | 12,11 |
| BRUGNATO | 20.835,40 | 247,98 | 20.330,00 | 257,42 | 305,00 (02/09) | 47,58 |
| FRANCIACORTA | 25.738,55 | 39,77 | 22.045,00 | 3.653,78 | 3.660,00 (01/09) | 6,22 |
| PALMANOVA | 23.831,20 | 128,60 | 21.140,00 | 2.562,60 | 2.560,65 (01/09) | −1,95 |
| TORINO | 20.381,15 | 563,22 | 18.080,00 | 1.737,93 | 1.680,00 (01/09) | −57,93 |
| VALDICHIANA | 36.815,45 | 465,35 | 33.938,10 | 2.412,00 | 2.498,45 (04/09) | 86,45 |
| VALMONTONE | 25.832,15 | 160,32 | 22.730,00 | 2.941,83 | 2.945,00 (01/09) | 3,17 |
| **Totale** | **177.942,60** | **1.737,05** | **160.672,10** | **15.533,45** | **15.629,10** | **95,65** |

Su 177.942,60 € di contante incassato in due mesi e 160.672,10 € versati, il residuo calcolato
e il contante effettivamente portato in banca a inizio settembre differiscono di **95,65 €**
in tutto. Gli scarti per negozio stanno sotto i 90 €, e sono spiegati: il versamento di
settembre include anche i contanti dei primi giorni del mese (Valdichiana versa il 04/09,
Brugnato il 02/09) e il fondo cassa non e' mai esattamente zero.

Nessun versamento resta orfano: i movimenti di versamento in banca da luglio a inizio
settembre sono tutti agganciati a una giornata, e ogni versamento dichiarato dai negozi ha il
suo accredito.

---

## il pay by link passa dal POS

Migration `NZ_ONLY_20260915_226`. Dalla ricostruzione di luglio e agosto: l'incasso «pay by
link» non ha un accredito suo, arriva in banca dentro l'accredito del POS del giorno. Sette
casi, tutti verificati sull'estratto conto, e il canale e' stato configurato di conseguenza
(kind `pos` con il codice terminale, come si era gia' fatto per «POS MPS Amex» con la 198).

| Giorno | Dichiarato POS | Pay by link | Accredito | Nota |
|---|---:|---:|---:|---|
| VALDICHIANA 07/07 | 2.174,20 | 48,00 | 2.222,20 | esatto |
| VALDICHIANA 15/07 | 1.999,20 | 60,10 | 2.059,30 | esatto |
| TORINO 25/07 | 2.639,90 | 53,00 | 2.675,18 | 0,66 % commissioni |
| TORINO 27/07 | 1.383,70 | 41,80 | 1.415,12 | 0,73 % |
| TORINO 13/08 | 736,05 | 56,40 | 786,68 | 0,73 % |
| VALMONTONE 12/08 | 1.306,22 | 202,90 | 1.497,90 | 0,74 % |
| FRANCIACORTA 28/08 | — | 64,64 | 64,64 | sul terminale **BCC**, non MPS |

Franciacorta e' l'eccezione. Barberino, Brugnato e Palmanova non hanno mai avuto pay by link
nei mesi ricostruiti: prendono il POS MPS come standard, e se un domani passasse dal BCC il
riscontro lo direbbe subito con una differenza.

Effetto misurato: righe POS in differenza da 6 a 2 a luglio, da 8 a 6 ad agosto. Le rimaste
sono commissioni oltre la tolleranza dell'1,5 % su importi minimi, piu' due giornate di Torino
dove l'Amex risulta contato due volte nello specchietto. In `daily_revenue` il pay by link
passa da «altro» a «carte», che e' quello che e'.

---

## giugno 2026

Migration `NZ_ONLY_20260915_227`. 210 giornate, e anche qui i corrispettivi coincidono con il
registro gia' presente su tutti e 210 i giorni.

| | |
|---|---:|
| Corrispettivi | 389.279,32 € |
| Fatture | 916,10 € |
| Contanti | 66.369,90 € |
| Spese di cassa | 566,68 € |
| Versamenti | 77.652,15 € |
| Chiusure verificate dalla banca | 194 su 210 |

**38 versamenti dichiarati, 38 trovati in banca, nessuna differenza.** Zero giornate non
quadrate, perche' a giugno nessun foglio ha la colonna CONTANTI e il contante e' stato
ricavato per differenza: i totali per canale coincidono comunque con la riga TOTALE di ogni
foglio, quindi la differenza e' un calcolo, non una stima.

### Cosa e' emerso

- **Sei versamenti di inizio giugno** sono in banca ma assenti dagli specchietti: sono il
  contante di fine maggio, portato in banca il 01/06 e il 03/06 (Barberino 1.580,
  Valdichiana 1.901,25, Palmanova 1.610, Franciacorta 1.835, Valmontone 3.275, Brugnato 550).
  Registrati sulla giornata in cui il denaro esce dalla cassa.
- **Torino 17/06**: quattro versamenti allo stesso ATM in cinque minuti (470 + 1.590 + 2.300 +
  1.090). Il negozio ne dichiara tre, su tre giornate diverse secondo il periodo coperto; il
  quarto, 1.090,00, non e' dichiarato da nessuna parte.
- **Il 605,00 dell'08/07 era di giugno.** Quando mancava giugno l'avevo agganciato alla
  chiusura dell'08/07 di Franciacorta, che risultava «differenza» (2.455 dichiarati contro
  3.060 accreditati). Ora si sa che e' il contante 29-30 giugno versato il 01/07 e accreditato
  il 08/07: e' stato staccato, rimesso al 30/06, e l'08/07 torna accreditato esatto.
  Ricostruire a ritroso corregge il mese successivo.

> **Terza miglioria per il motore**: il riscontro cerca il versamento solo in avanti, da
> `closing_date` a `+6 giorni`. Quando il negozio versa tutto in un giorno e poi lo attribuisce
> a giornate diverse (Torino 17/06), il movimento e' anteriore alla chiusura e non viene mai
> trovato. Una finestra simmetrica di un paio di giorni all'indietro lo risolverebbe.

---

## maggio 2026

Migration `NZ_ONLY_20260915_228`. 217 giornate, e ancora una volta i corrispettivi coincidono
con il registro gia' presente su tutti e 217 i giorni, al centesimo.

| | |
|---|---:|
| Corrispettivi | 418.533,52 € |
| Fatture | 2.362,35 € |
| Contanti | 69.001,53 € |
| Spese di cassa | 781,48 € |
| Versamenti | 56.330,15 € |
| Chiusure verificate dalla banca | 212 su 217 |

**28 versamenti dichiarati, 28 trovati in banca, nessuna differenza.** Come a giugno nessun
foglio di maggio ha la colonna CONTANTI, quindi il contante e' ricavato per differenza; i
totali per canale coincidono con la riga TOTALE di ogni foglio, perciò è un calcolo e non una
stima.

### Cosa e' emerso

- **Franciacorta 14/05**: il versamento di 2.645,00 e' in banca il **13/05**, cioe' il giorno
  prima della giornata su cui il negozio lo dichiara (causale «FRANCIACORTA MAGGIO 06-11»).
  Stesso caso del 2.300,00 di Torino del 17/06: il motore cerca solo in avanti e non lo trova
  mai. Agganciato a mano. Due mesi su quattro hanno questo caso, quindi la finestra simmetrica
  all'indietro non e' un'eccezione, e' la regola che manca.
- **I versamenti di fine maggio non stanno a maggio.** Sono gia' registrati sulle chiusure del
  01-03/06 create dalla 227, perche' il denaro esce dalla cassa a giugno: Barberino 1.580,
  Valdichiana 1.901,25, Palmanova 1.610, Franciacorta 1.835, Brugnato 550, Valmontone 3.275,
  Torino 1.090. Registrarli due volte avrebbe gonfiato i versamenti di 11.841,25 €.
- **Brugnato 26/05** e' l'unica giornata che non quadra: i soli canali elettronici valgono
  357,90 contro 301,90 di corrispettivi. Il contante risulterebbe negativo di 56,00, quindi
  e' a zero e la differenza resta dichiarata.
- **Franciacorta, Amex su BCC del 01/05 (42,00) e del 03/05 (238,00)**: restano «mancante»
  perche' l'accredito del 04/05 vale 312,90 e copre anche giornate di fine aprile, che ancora
  non esistono. Si chiuderanno da sole rilanciando il riscontro dopo aprile. E' il caso inverso
  del 605,00 di luglio: li' il mese mancante falsava un abbinamento, qui ne impedisce uno.
- Tre righe POS restano «differenza» per sola commissione oltre l'1,5 % su importi piccoli
  (Barberino 14/05 −1,71 %, Barberino 19/05 −1,63 %, Palmanova 11/05 −1,68 %): sono accrediti
  veri, non ammanchi.

---

## aprile 2026

Migration `NZ_ONLY_20260915_229`. 203 giornate: 7 negozi per 29 giorni, perche' il 5 aprile
(Pasqua) e' chiuso e non esiste nemmeno nel registro corrispettivi. Anche qui i corrispettivi
coincidono con `daily_revenue` su tutte e 203 le giornate.

| | |
|---|---:|
| Corrispettivi | 372.705,73 € |
| Fatture | 833,89 € |
| Contanti | 65.198,24 € |
| Spese di cassa | 448,11 € |
| Versamenti | 62.899,95 € |
| Chiusure verificate dalla banca | 198 su 203 |

**30 versamenti dichiarati, 28 trovati in banca.** I due che mancano non sono un limite del
riscontro: sono un buco vero, ed e' la cosa piu' importante emersa in tutta la ricostruzione.

### 4.870,25 € dichiarati e mai arrivati

Il 28 aprile Palmanova dichiara un versamento di **1.995,00 €** e Valdichiana uno di
**2.875,25 €**. In banca non esiste nessun accredito di quegli importi, in nessuna data. Non
e' una questione di finestra temporale o di causale.

Il controllo va fatto su **MPS**, non su BCC: tutti i versamenti in cassa continua arrivano li',
su BCC ci sono solo gli accrediti POS. Sull'estratto conto MPS quella finestra non ha buchi, ogni
giorno lavorativo dal 20 aprile all'8 maggio ha movimenti. Elencando tutte le entrate fra il 27
aprile e il 6 maggio tolti gli accrediti POS, cioe' tutto il contante che entra, non c'e' nessun
1.995,00 e nessun 2.875,25, e nessuna combinazione che li contenga. Le due cassette continue di
Palmanova e Foiano fanno un salto netto: ultimo movimento il 24 aprile, poi il 4 maggio. I
quattro accrediti successivi (930,00, 417,65, 1.745,00, 2.616,20) sono tutti piu' piccoli, quindi
non possono nemmeno averli assorbiti.

Il limite del controllo: si guarda il flusso importato in `bank_transactions`, non la carta. Se un
singolo movimento non fosse mai stato importato non si vedrebbe. Contro questa ipotesi giocano la
continuita' giorno per giorno dell'estratto conto e il fatto che su 58 versamenti dichiarati fra
aprile e maggio ne sono stati ritrovati 56: mancano esattamente quei due, tutti e due in cassa
continua, tutti e due dichiarati lo stesso giorno.

Le due chiusure restano a «mancante». Per chiudere la questione: guardare l'home banking MPS dal
28 al 30 aprile cercando una voce «VERS. CONTANTI C. CONTINUA», e chiedere ai due negozi la nota
cassa di quella settimana con lo scontrino della cassetta.

Quel limite e' stato poi misurato: vedi «il riscontro sugli estratti conto in archivio» in fondo.
Su marzo, luglio e agosto il flusso importato coincide con l'estratto conto ufficiale riga per
riga sul lato entrate, versamenti compresi. L'estratto di aprile pero' in archivio non c'e'.

### Cosa e' emerso, oltre a quello

- **La colonna FATTURE e' un promemoria, non un mezzo di pagamento.** L'importo della fattura
  viaggia dentro un canale: il 10/04 Barberino la incassa con l'Amex, il 12/04 Valdichiana con
  il POS MPS. Il trigger la tratta gia' cosi' (`channels_total` esclude il tipo `fattura`), e
  la regola resta corrispettivi + fatture = canali.
- **Quattro versamenti di inizio aprile** sono in banca ma non negli specchietti: contante di
  fine marzo (Palmanova 1.690,00 il 01/04, Valmontone 55,00 il 01/04, Torino 80,00 il 02/04,
  Franciacorta 85,00 il 08/04, versato allo stesso ATM un minuto prima dei 1.210,00
  dichiarati). Il versamento Barberino di 845,00 accreditato il 01/04 la cassa continua lo
  data 31/03: e' di marzo e si agganciera' ricostruendo marzo.
- **Brugnato 15/04 e 21/04**: la banca data i versamenti il giorno prima di quello dichiarato.
  Terzo e quarto caso dopo Torino 17/06 e Franciacorta 14/05. Quattro casi su cinque mesi non
  sono un'eccezione: la finestra all'indietro serve davvero.
- **Valdichiana 18/04**: 79,90 di Amex finiscono nella colonna MPS, ma l'accredito del 20/04
  vale 247,30 = 167,40 (17/04) + 79,90 e arriva sul terminale BCC, come tutto il resto della
  giornata. Spostati sul canale giusto, e le due righe si chiudono da sole.
- **Ricostruire a ritroso ripara il mese dopo, di nuovo.** Le due righe Amex di Franciacorta
  del 01/05 e 03/05 erano rimaste «mancante» perche' l'accredito del 04/05 copriva anche
  giornate di aprile che non esistevano. Caricato aprile, il riscontro le chiude: maggio passa
  da 212 a **214** chiusure verificate senza toccare un dato.
- Tre giornate non quadrano sullo specchietto e restano dichiarate: Barberino 12/04 (−43,35,
  due scontrini pagati con carta, annullati e rimborsati in contanti), Torino 13/04 (−142,50),
  Valmontone 10/04 (+254,30, colonna CONTANTI vuota).
- **Palmanova 30/04** merita un'occhiata: 1.391,92 dichiarati sul POS contro 1.302,29
  accreditati, −6,4 %. Le altre due righe in differenza (Barberino 14/04 −1,80 %, Valmontone
  11/04 −1,65 %) sono commissione su importi piccoli; questa no.

---

## marzo 2026

Migration `NZ_ONLY_20260915_230`. 191 chiusure, non 7x31: Torino apre il **26 marzo** (6 giornate),
Brugnato non ha il 19/03 e Barberino non ha il 31/03 nel registro corrispettivi. Sulle 190
giornate che il registro conosce i corrispettivi coincidono al centesimo.

| | |
|---|---:|
| Corrispettivi | 215.851,71 € |
| Fatture | 488,65 € |
| Contanti | 40.178,08 € |
| Spese di cassa | 1.061,55 € |
| Versamenti | 37.094,40 € |
| Chiusure verificate dalla banca | 185 su 191 |

**25 versamenti dichiarati, 25 trovati in banca, nessuna differenza, nessun aggancio a mano.**
Il mese piu' pulito di tutti: il motore ha fatto tutto da solo. Le 6 chiusure che restano hanno
una riga POS in «differenza» per sola commissione fra l'1,6 % e l'1,7 % su importi piccoli.

### Cosa e' emerso

- **Barberino 31/03** non ha corrispettivi ma ha un versamento di 845,00. La chiusura si crea
  lo stesso, marcata come giornata chiusa, cosi' il denaro che esce dalla cassa ha dove stare;
  resta pero' fuori dalla proiezione, perche' nel registro quel giorno non esiste. Era il
  versamento che ad aprile avevo lasciato indietro: la cassa continua lo data 31/03, ed e' li'
  che si e' agganciato.
- **Lo specchietto di Brugnato ha le intestazioni sfalsate di una colonna**: quella etichettata
  VERSAMENTI contiene i contanti, quella etichettata CONTANTI i versamenti. Verificato sui
  totali di riga e sulla riga TOTALE del foglio. Se avessi letto le intestazioni invece dei
  numeri avrei registrato 4.387,08 € di versamenti inesistenti.
- **Nei giorni con una spesa, il foglio di Brugnato scrive i contanti gia' al netto della
  spesa.** Succede il 02, il 14 e il 18 marzo, e le tre giornate restano dichiarate come non
  quadrate. Il 07/03 invece il divario e' 85,00 contro 5,00 di spesa, e non si spiega.
- Altre giornate non quadrate: Barberino 27/03 (−46,55, stesso motivo di Brugnato),
  Franciacorta 12/03 (+57,12, annullato uno scontrino del 07/02), Valmontone 18/03 (−86,55,
  un incasso del 21/02 fiscalizzato solo il 18/03), Palmanova 14/03 (−0,02) e 21/03 (−0,10).
- **Cinque versamenti di fine marzo escono dalla cassa ad aprile** e stanno gia' sulle chiusure
  di aprile: Valdichiana 1.724,80 e Palmanova 1.690,00 il 01/04, Valmontone 55,00 il 01/04,
  Torino 80,00 il 02/04, Franciacorta 85,00 il 08/04. Qui restano a zero, con la nota che dice
  dove sono andati. Quando ad aprile li avevo chiamati «assenti dagli specchietti» era vero
  solo a meta': assenti dallo specchietto di aprile, non da quello di marzo.

---

## gennaio 2026

Migration `NZ_ONLY_20260915_231`. 179 chiusure su **6** punti vendita: Torino non esiste ancora,
apre il 26 marzo. Il 1 gennaio e' chiuso ovunque, Barberino anche il 6.

| | |
|---|---:|
| Corrispettivi | 501.525,44 € |
| Fatture | 1.001,10 € |
| Contanti | 91.352,52 € |
| Spese di cassa | 875,33 € |
| Versamenti registrati a gennaio | 86.420,10 € |
| Chiusure verificate dalla banca | 173 su 179 |

**21 versamenti dichiarati e riscontrabili a gennaio, 21 trovati in banca, nessuna differenza.**

### Il registro batte lo specchietto, e per la prima volta serve dirlo

In sette mesi di ricostruzione i corrispettivi degli specchietti hanno sempre coinciso con
`daily_revenue` al centesimo. A gennaio no: **quattro giornate di Valdichiana** divergono, e in
modo istruttivo. Il 24 e il 26 gennaio si scambiano 78,12 €; il 30 e il 31 si scambiano 48,50 €.
Il negozio attribuisce l'importo a una giornata, il registro a quella accanto. Il totale del mese
coincide al centesimo.

Vale il registro. Non per gerarchia, ma per una ragione meccanica: la proiezione scrive
`total_receipts` dentro `gross_revenue`, quindi usare il numero dello specchietto avrebbe
**riscritto il dato fiscale**. Le quattro chiusure prendono il valore del registro e portano in
nota da dove viene.

### Cosa e' emerso

- **Franciacorta 13/01 e 20/01**: un solo versamento dichiarato, due operazioni allo stesso ATM a
  due minuti di distanza (5.100 + 830 e 3.000 + 900). Stesso caso di Brugnato ad agosto.
- **Palmanova 31/01**: i 1.290,00 non sono mai arrivati da soli. Vanno in banca insieme agli
  805,00 del 01-02 febbraio e la cassa continua li accredita il 6 febbraio come **un unico
  importo di 2.095,00**. La giornata resta a zero, con la nota che dice dove sono andati.
- Altri quattro versamenti di fine gennaio escono dalla cassa a febbraio e restano a zero qui:
  Barberino 1.280,00, Valdichiana 1.876,75, Brugnato 1.030,00, Valmontone 2.435,00.
- Sette giornate non quadrano sullo specchietto. La sola davvero rilevante e' **Palmanova 10/01,
  −435,46 €**; le altre sono storni di scontrino e arrotondamenti.
- Le 6 chiusure non verificate hanno una riga POS in differenza o mancante, quasi tutte accrediti
  Amex del 31 gennaio che arrivano a febbraio.

---

## febbraio 2026

Migration `NZ_ONLY_20260915_232` per cinque negozi e `NZ_ONLY_20260916_233` per Franciacorta.
167 chiusure sui sei punti vendita attivi (Torino apre a marzo). I corrispettivi coincidono con
`daily_revenue` su tutte e 167 le giornate.

| | |
|---|---:|
| Corrispettivi | 306.664,01 € |
| Fatture | 276,72 € |
| Contanti | 60.641,69 € |
| Spese di cassa | 552,09 € |
| Versamenti | 59.132,15 € |
| Chiusure verificate dalla banca | 163 su 167 |

**26 versamenti dichiarati, 26 trovati in banca, nessuna differenza.**

### Franciacorta e' arrivato dopo, e ha portato due casi nuovi

Lo specchietto di Franciacorta di febbraio era l'unico file dell'intero recupero salvato in
**.xls**, il vecchio formato binario di Excel, che il connettore Drive non legge. Patrizio lo ha
risalvato come Foglio Google e le 28 giornate sono entrate con la `233`.

Quel foglio ha molte celle vuote e le colonne si leggono per posizione, quindi prima di caricarlo
sono stati confrontati **tutti e dieci i totali di colonna** con la riga «Totali» del foglio.
Coincidono tutti. È il controllo che serviva, perche' bastava sbagliare di una casella per
scambiare i contanti con i versamenti.

- **24/02, 1.575,00**: in banca c'e', ma versato allo sportello **ATM 01030-4715** invece del
  solito 2121 di Franciacorta. Il motore riconosce il negozio dalla causale e quello sportello
  non lo conosce.
- **25/02, 2.145,00**: in banca il **18 febbraio**, sette giorni prima della giornata su cui il
  negozio lo dichiara. Quinto caso di versamento anteriore alla chiusura dichiarata.
- Il **versamento di chiusura febbraio, 1.895,00 €**, esce dalla cassa il 04/03 e resta sulla
  chiusura del 04/03, dove la `232` lo aveva gia' messo leggendolo dall'estratto conto prima
  ancora di avere il foglio.
- Due giornate non quadrano per arrotondamento: 14/02 (−0,17) e 28/02 (−0,54).

### Cosa e' emerso

- **I versamenti attraversano i mesi in tutte e due le direzioni.** Quattro di fine gennaio
  escono dalla cassa a febbraio (Valdichiana 1.876,75 il 01/02, Brugnato 1.030,00 e Valmontone
  2.435,00 il 02/02, Barberino 1.280,00 il 03/02); cinque di fine febbraio escono a marzo
  (Brugnato 295,00 e Valmontone 2.415,00 il 02/03, Palmanova 1.190,00 il 03/03, Valdichiana
  1.837,30 e Franciacorta 1.895,00 il 04/03).
- **Palmanova 03/02 porta 2.095,00 e non 805,00**: il versamento del 01-02/02 e quello del
  27-31/01 finiscono nella stessa cassa continua e arrivano come un unico accredito il 06/02.
- **Brugnato non ha il 10 febbraio**: corrispettivi zero, la giornata non esiste nel registro e
  nessuna chiusura viene creata.
- Quattro giornate non quadrano e restano dichiarate: Valmontone 21/02 (+86,55, un POS non
  contabilizzato che lo studio ha trasmesso il 16/03), Valdichiana 05/02 (+34,50, annullato uno
  scontrino del 26/01), Palmanova 27/02 (−37,32, uno scontrino battuto due volte), Barberino
  10/02 (−0,35).

---

## il quadro finale: da gennaio a settembre

| mese | chiusure | verificate | non quadrate | corrispettivi | versamenti |
|---|---:|---:|---:|---:|---:|
| gennaio | 179 | 174 | 7 | 501.525,44 € | 86.420,10 € |
| febbraio | 167 | 163 | 6 | 306.664,01 € | 59.132,15 € |
| marzo | 191 | 185 | 9 | 215.851,71 € | 44.726,70 € |
| aprile | 203 | 198 | 3 | 372.705,73 € | 62.899,95 € |
| maggio | 217 | 214 | 1 | 418.533,52 € | 61.852,80 € |
| giugno | 210 | 194 | 0 | 389.279,32 € | 77.652,15 € |
| luglio | 217 | 214 | 3 | 567.701,98 € | 87.671,60 € |
| agosto | 217 | 213 | 8 | 444.099,25 € | 73.000,50 € |
| settembre (al 14) | 98 | 96 | 1 | 156.247,60 € | 31.170,50 € |

**1.699 chiusure, 1.651 verificate dalla banca.** Nove mesi interi, nessuna giornata mancante:
in tutto il 2026 non resta una sola riga del registro corrispettivi senza la ripartizione fra
contanti, carte e altro.

### Le tre cose da guardare

1. ~~**4.870,25 € dichiarati e mai arrivati in banca**~~ **RISOLTO**: i due versamenti sono
   sull'estratto conto MPS di aprile, accreditati il 04/05 con valuta 29/04. Il denaro c'e', a
   perderlo era l'importazione. Vedi «i 4.870,25 € ci sono: era l'importazione a perderli».
2. ~~**Palmanova 30/04**: 1.391,92 contro 1.302,29, −6,4 %~~ **RISOLTO**: mancava un accredito POS
   da 79,33 €, perso alla stessa cucitura fra import. Ora 1.381,62 contro 1.391,92, −0,74 %.
3. ~~**Palmanova 10/01**: −435,46 €~~ **RISOLTO**: la banca ha accreditato 3.883,30 di circuiti
   internazionali **e** 435,46 di PagoBancomat sullo stesso terminale; lo specchietto ha scritto
   solo il primo. Il denaro c'e', manca una riga nel foglio del negozio.

### Le tre migliorie per il motore di riscontro

Sono le stesse di luglio e agosto, ma ora con i numeri di nove mesi dietro.

1. **Sommare piu' accrediti dello stesso giorno allo stesso sportello.** Ricorre da sola sei
   volte: Franciacorta 13/01 e 20/01 e 08/04, Brugnato ad agosto, Torino 17/06, Valmontone 04/05.
2. **Finestra all'indietro per i versamenti.** Il motore cerca solo in avanti, da `closing_date` a
   +6 giorni. Quando il negozio versa e poi attribuisce la giornata dopo, il movimento e'
   anteriore e non viene mai trovato: Torino 17/06, Franciacorta 14/05 e 25/02, Brugnato 15/04 e
   21/04. Cinque casi su nove mesi non sono un'eccezione, e quello del 25/02 e' di sette giorni:
   una finestra di due non basterebbe.
3. **Dare al pay by link il terminale del POS** (fatto, migration `226`).

Ne e' emersa una quarta. Il motore riconosce il negozio del versamento dalla causale, e quindi
dallo sportello abituale: Franciacorta e' «ATM 01030-2121». Il 24/02 il negozio ha versato
all'ATM 4715 e il movimento e' diventato invisibile. Un versamento a un solo negozio compatibile
per importo, data e conto andrebbe proposto lo stesso, magari da confermare a mano.

## il riscontro sugli estratti conto in archivio

Fin qui ogni verifica e' stata fatta sul flusso importato in `bank_transactions`, cioe' su quello
che A-Cube scarica dalla banca. Restava la domanda vera: quel flusso e' completo? Per rispondere
servono gli estratti conto ufficiali, e in `bank-statements` ce ne sono tre di conto corrente.

Cosa c'e' in archivio, per i conti correnti: **MPS marzo** (02/03-03/04), **MPS luglio**
(01/07-31/07) e **MPS agosto** (03/08-03/09), piu' le versioni BCC Figline, Mugello e Intesa dello
stesso luglio e dello stesso agosto. Per le carte c'e' molto di piu': la prepagata TASCA da
febbraio a luglio, le carte di credito BCC-Numia e MPS da gennaio a giugno. **Di conto corrente
aprile non c'e'.** Nessuno dei file era mai stato letto: tutte le righe di `bank_statements`
hanno `transaction_count = 0`.

### Come si leggono senza far passare la password di qui

Patrizio ha creato un utente Auth di sola lettura e ha messo email e password nel Vault. Il login
si fa dentro Postgres con l'estensione `http`: la query pesca le credenziali da
`vault.decrypted_secrets`, chiama `/auth/v1/token`, e con il token crea una signed URL valida
un'ora per il singolo file. Nella sessione passa solo quella URL. Nessuna chiave di servizio,
nessuna password scritta da nessuna parte. I `.xls` MPS sono in formato legacy: LibreOffice non
li apre, `xlrd` si'.

### Marzo, luglio, agosto: i tre confronti

| Mese | Entrate estratto | Entrate DB | Versamenti estratto | Versamenti DB |
|---|---|---|---|---|
| marzo | 425 / 281.302,37 € | 425 / 281.302,37 € | 27 / 39.891,50 € | 27 / 39.891,50 € |
| luglio | 496 / 467.956,13 € | 496 / 467.956,13 € | 27 / 75.394,70 € | 27 / 75.394,70 € |
| agosto | 546 / 387.827,66 € | 546 / 390.335,81 € | 28 / 65.440,50 € | 29 / 68.001,15 € |

Marzo e luglio coincidono al centesimo senza aggiustamenti. Agosto sembra non tornare, e invece
torna: le due differenze sono l'una il versamento in cassa continua di **2.560,65 €** che il DB
data al 2 settembre e che la banca contabilizza dopo la chiusura del file, l'altra un accredito
Amex di **52,50 €** che l'estratto mette il 3 agosto e il DB il 2, cioe' fuori finestra dalla
parte opposta. Fatti i due conti, 390.335,81 - 2.560,65 + 52,50 = **387.827,66 €**, l'importo
dell'estratto esatto.

### La regola delle date, che vale per tutti e tre i mesi

Il flusso e il documento datano lo stesso movimento in modo diverso, e sempre nello stesso verso:
**il flusso segna il giorno in cui la cosa succede, la banca il giorno in cui la contabilizza.**

- Gli accrediti POS del fine settimana: nel DB restano di sabato e domenica, sull'estratto
  compaiono tutti il lunedi'. Ad agosto sono 17 movimenti su sette weekend, e si ricompongono
  esatti giorno per giorno.
- I versamenti in cassa continua: il DB li data al giorno del versamento, la banca due giorni
  dopo. Ad agosto succede cinque volte, e ogni volta l'importo e' identico.
- Le competenze trimestrali: il flusso le data al 30/06 e al 31/03, la banca le addebita nei
  giorni successivi.
- Il canone del conto: primo del mese nel DB, meta' mese sull'estratto.

Una volta capita questa, di tutte le differenze apparenti non ne resta nessuna.

### L'unico buco vero: 118,00 € il 6 e 7 luglio

Il primo passaggio su luglio aveva contato **14 movimenti in uscita mancanti per 408,20 €**. Era
un conto sbagliato: dieci di quei quattordici ci sono, datati 30/06 invece che 06-07/07 per la
regola qui sopra. Se ne accorge solo chi allarga la finestra di ricerca oltre il mese.

Quelli che mancano davvero sono **quattro, per 118,00 €**, e hanno una cosa in comune: la causale
`(34) DISPOSIZIONI DI GIRO CONTO (STESSA BANCA)`, e i due conti d'appoggio 91000,04 e 94000,53.
Sono i bolli e gli oneri addebitati su quei due conti e girati sul principale: due da 29,40, uno
da 36,60, uno da 22,60. Gli stessi addebiti degli altri cinque conti, che arrivano con causale 18
o 19, il flusso li prende tutti. E non e' una regola generale sulla causale 34: il giroconto da
58.650,00 del 31 marzo, stessa causale, nel DB c'e'. Al 31/03 il flusso porta perfino l'imposta
di bollo e le competenze del conto 94000,53, quelle che a giugno perde.

### Cosa cambia per i 4.870,25 € di aprile

L'estratto conto di aprile in `bank-statements` non c'e'. E' pero' su Drive, nella cartella dei
documenti bancari, e da li' la risposta arriva in dieci minuti.

## i 4.870,25 € ci sono: era l'importazione a perderli

L'estratto conto MPS di aprile non era in archivio, ma era su Drive. Letto quello, la storia
cambia del tutto.

**I due versamenti esistono, e la banca li ha accreditati.** Sono sull'estratto, tutti e due
contabilizzati il **4 maggio** con valuta 29 aprile:

| Negozio | Importo | Data versamento | Valuta | Contabile |
|---|---|---|---|---|
| Palmanova (CC PALMANOVA) | 1.995,00 € | 28-04-26 | 29/04 | 04/05 |
| Valdichiana (CC FOIANO DELLA CHIANA) | 2.875,25 € | 29-04-26 | 29/04 | 04/05 |

Nel database non esiste nessuna riga con quegli importi, in nessuna data, su nessun conto. Il
denaro e' arrivato in banca. A perderlo e' stata l'importazione.

### Il confronto completo: 473 movimenti, due mancano, e sono quei due

L'estratto copre dal 01/04 al 04/05 e porta 473 entrate per 467.384,05 €. Confrontando importo
per importo con `bank_transactions` su una finestra piu' larga (20/03-12/05, cosi' che gli
slittamenti di data non producano falsi allarmi), gli importi che nel database hanno meno righe
dell'estratto sono **due soli**: 1.995,00 e 2.875,25. Tutto il resto, POS, Amex, bonifici, gli
altri 24 versamenti, c'e'.

### Perche' li ha persi: una cucitura fra due import

I due movimenti hanno una caratteristica che nessun altro dell'estratto ha: **valuta in un mese,
contabile nel mese dopo**, e a cinque giorni di distanza. Gli altri sedici movimenti retrodatati
di aprile lo sono di due giorni e restano dentro lo stesso mese; ci sono tutti.

Le date di import lo confermano. Maggio e' stato caricato per primo, il **21/05**; aprile e'
arrivato dopo, in backfill, il **15/06**. Il `sync_runs` delle banche parte dal 26/05, quindi
quei caricamenti non hanno nemmeno lasciato un log. Due finestre, una cucitura in mezzo: la
corsa di maggio ha chiesto i movimenti dal primo maggio in poi e per valuta questi due sono del
29 aprile, la corsa di aprile ha chiesto fino al 30 aprile e per data contabile questi due sono
del 4 maggio. Nessuna delle due li ha visti.

### La stessa cucitura, sull'altro conto, ha duplicato

Su BCC Valdarno il problema si presenta rovesciato. I movimenti con valuta e data contabile in
giorni diversi sono entrati **due volte**, una per ciascuna data: 22 righe in piu' per
**3.487,64 €**, tutte fra il 19 marzo e il 30 aprile, tutte in uscita (ricariche TASCA, POS
carta aziendale, bolli, bollettini). Sulle entrate zero duplicati, quindi POS e versamenti, cioe'
tutto cio' che serve alle chiusure di cassa, restano puliti.

Per riconoscerle: stesso conto, stesso importo, stessa descrizione, stessa valuta, due date
contabili diverse a pochi giorni. Attenzione a un caso: le due ricariche TASCA da 200,00 del
16-17 aprile sono **vere tutte e due** (l'estratto le riporta entrambe), e nel database sono
diventate quattro. Li' le righe di troppo sono due, non tre.

### Cosa va fatto

1. **Inserire i due versamenti mancanti** in `bank_transactions` (MPS, 04/05/2026, valuta
   29/04), poi rilanciare `match_cash_closings_with_bank`: le due chiusure del 28/04 di Palmanova
   e Valdichiana passano da «mancante» a verificate, e il buco di cassa piu' grosso di tutta la
   ricostruzione si chiude da se'.
2. **Togliere le 22 righe duplicate** su BCC (operazione di cancellazione su dati vivi: serve il
   via libera esplicito, con il SELECT di backup salvato prima).
3. **Sistemare l'importazione**, che e' la causa vera: una corsa di sincronizzazione deve
   delimitare la finestra con **un solo criterio di data** e deve sovrapporsi di qualche giorno
   con la corsa precedente, cosi' che un movimento a cavallo di due mesi non possa sfuggire a
   entrambe ne' entrare in tutte e due.

### La lezione, che vale oltre questo caso

Per quattro mesi il sistema ha mostrato un ammanco di cassa di 4.870,25 € e ha lasciato due
chiusure a «mancante». Il flusso bancario, controllato su marzo, luglio e agosto, tornava al
centesimo, e quella verifica aveva reso l'ipotesi «l'import ha perso qualcosa» sempre meno
credibile. Era invece quella giusta. **Tre mesi esatti non dimostrano che il quarto lo sia**: la
cucitura fra due import e' un evento raro per costruzione, quindi va cercata dove sta, cioe' ai
confini, e non si trova campionando i mesi pieni.

## il controllo esteso: tutti gli estratti conto di Drive, gennaio-agosto

Su Drive, in `ARCHIVIO EC NEW ZAGO`, c'e' una cartella per mese da gennaio a settembre con gli
estratti conto di tutti e quattro i conti correnti (MPS, BCC Figline, BCC Mugello, Intesa), in
`.xls`/`.xlsx` oltre che in PDF. Settembre non ha ancora i conti correnti, il mese non e' chiuso.

### MPS, otto mesi su otto

| Mese | Finestra estratto | Entrate estratto | Entrate DB | Righe mancanti |
|---|---|---|---|---|
| gennaio | 02/01-04/02 | 439 / 442.395,62 € | 439 / 442.395,62 € | 0 |
| febbraio | 02/02-04/03 | 418 / 322.635,19 € | 418 / 322.635,19 € | 0 |
| marzo | 02/03-03/04 | 425 / 281.302,37 € | 425 / 281.302,37 € | 0 |
| aprile | 01/04-04/05 | 473 / 467.384,05 € | 471 | **2** (i versamenti) |
| maggio | 04/05-04/06 | 511 / 446.130,62 € | 510 | **1** (il POS Palmanova) |
| giugno | 01/06-03/07 | 517 / 452.400,50 € | 517 | 0 |
| luglio | 01/07-31/07 | 496 / 467.956,13 € | 496 / 467.956,13 € | 0 |
| agosto | 03/08-03/09 | 546 / 387.827,66 € | 546 | 0 |

Gennaio, febbraio, marzo e luglio coincidono al centesimo senza alcun aggiustamento. Giugno e
agosto coincidono dopo aver tolto gli effetti di bordo (movimenti che il DB data prima o dopo la
finestra del file), e il confronto importo per importo su una finestra allargata non trova
nemmeno una riga mancante. Aprile e maggio sono i tre movimenti gia' recuperati con le migration
`234` e `235`, **tutti e tre sulla stessa cucitura fra l'import di aprile e quello di maggio**.

Sui versamenti il conto e' esatto: **82 versamenti su 82** fra marzo, luglio e agosto, e a maggio
e giugno 53 su 53 con ogni importo appaiato uno a uno.

### BCC Figline

Confronto diretto su quattro mesi, entrate e uscite:

| Mese | Entrate estratto | Entrate DB | Uscite estratto | Uscite DB |
|---|---|---|---|---|
| gennaio | 103 / 98.507,41 € | 103 / 98.507,41 € | 94 / -103.635,27 € | 94 / -103.635,27 € |
| febbraio | 107 / 71.216,99 € | 107 / 71.216,99 € | 92 / -47.188,53 € | 92 / -47.188,53 € |
| marzo | 75 / 35.289,95 € | 75 / 35.289,95 € | 81 / -105.142,53 € | 84 / -105.332,73 € |
| agosto | 119 / 54.892,26 € | 119 / 54.892,26 € | 71 / -94.709,54 € | 71 / -94.709,54 € |

Le entrate tornano al centesimo tutte e quattro le volte. L'unico scarto e' su tre uscite di
marzo per 190,20 €, movimenti che il DB data a marzo e la banca contabilizza ad aprile.

### Il conto BCC che sembra interrotto, e non lo e'

In `bank_accounts` c'e' un conto BCC Valdarno (IBAN `...016980`) il cui flusso si ferma il
**30 aprile 2026**. Non e' un buco: le sue righe portano il riferimento `0002/007/221949`, cioe'
il conto **Banco Fiorentino Mugello** (`IT77Y...221949`), che nel database parte dal **6 maggio**.
E' lo stesso conto, riagganciato sotto un'altra anagrafica. L'estratto BCC Mugello di maggio lo
conferma: il primo movimento del mese e' del 6 maggio, fra il 1 e il 5 non c'e' niente da
prendere. Il passaggio non ha perso nulla.

### Il controllo che copre tutto il resto

Gli estratti di BCC Mugello e Intesa mese per mese non sono stati letti tutti. Al loro posto vale
un controllo che copre **tutti i conti e tutti e nove i mesi insieme**: ogni riga di ogni chiusura
di cassa viene appaiata a un movimento bancario, quindi un movimento che manca in banca si vede
come riga a «mancante». Su **tutto il 2026** le righe a «mancante» sono **due**, tutte e due di
Palmanova a gennaio, e nessuna delle due e' un movimento perso:

- **10/01, Amex 164,52 €.** A gennaio l'Amex di Palmanova veniva accreditato su **BCC**, non su
  MPS: l'estratto BCC ha un accredito Amex di 314,62 € il 15/01 «per incassi 12.01.2026» sul
  terminale `...00005`. Lo specchietto lo ha scritto sulla riga «POS MPS Amex» e il motore lo
  cerca sul conto sbagliato. I soldi ci sono, e sono di piu' di quelli dichiarati.
- **15/01, POS BCC 631,09 €.** In banca non c'e' nessun accredito BCC con riferimento 15.01 su
  quel terminale. Su **MPS**, terminale `...00007`, per lo stesso giorno ci sono 273,97 + 352,96 =
  **626,93 €**, cioe' 631,09 meno lo 0,66 % di commissione. Quel giorno l'incasso e' passato dal
  terminale MPS e lo specchietto lo ha attribuito al BCC.

### E l'ultima delle tre anomalie cade anche lei

Palmanova 10/01, la giornata non quadrata piu' grossa del recupero, **-435,46 €**. L'estratto BCC
per il riferimento 10.01.26 sul terminale `...00005` porta due accrediti: 3.883,30 € di circuiti
internazionali e **435,46 €** di PagoBancomat. Lo specchietto ha scritto solo il primo. Non manca
un movimento in banca: manca una riga nello specchietto del negozio, ed e' esattamente lo
squilibrio della giornata.

### Dove siamo

Delle tre cose da guardare non ne resta nessuna: i 4.870,25 € erano un difetto di importazione,
il -6,4 % di Palmanova del 30/04 era il POS da 79,33 € perso alla stessa cucitura, il -435,46 €
del 10/01 e' una riga dimenticata nello specchietto con il denaro regolarmente in banca.

Quello che non e' stato riscontrato riga per riga resta: BCC Figline di maggio, giugno e luglio,
BCC Mugello da gennaio ad aprile e da giugno ad agosto, Intesa da marzo ad agosto. Su quei conti
e quei mesi vale il controllo sulle chiusure, che non segnala niente; un confronto diretto con la
carta resta piu' forte e si puo' fare quando serve, i file sono tutti su Drive.
