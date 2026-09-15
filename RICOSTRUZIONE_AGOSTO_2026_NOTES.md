# Ricostruzione degli incassi giornalieri — agosto 2026 (NZ)

> Sessione del 15/09/2026. Migration `NZ_ONLY_20260915_223_ricostruzione_incassi_agosto_2026.sql`.
> Stesso impianto usato per settembre, ma senza le foto delle chiusure: agosto e' stato
> ricostruito dagli **specchietti incassi dei negozi** e riscontrato con l'**estratto conto**.

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
