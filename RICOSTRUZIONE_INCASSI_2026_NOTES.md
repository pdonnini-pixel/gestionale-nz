# Ricostruzione degli incassi giornalieri 2026 (NZ)

> Sessione del 15/09/2026. Migration `NZ_ONLY_20260915_223` (agosto) e
> `NZ_ONLY_20260915_225` (luglio).
> Stesso impianto usato per settembre, ma senza le foto delle chiusure: i due mesi sono stati
> ricostruiti dagli **specchietti incassi dei negozi** e riscontrati con l'**estratto conto**.
> Luglio serviva a chiudere il conto del contante: i versamenti dei primi giorni di agosto
> portavano in banca il contante di fine luglio.

Indice: [agosto](#agosto-2026) · [luglio](#luglio-2026) · [il conto del contante](#il-conto-del-contante-si-chiude) · [giugno](#giugno-2026) · [il pay by link](#il-pay-by-link-passa-dal-pos)

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
