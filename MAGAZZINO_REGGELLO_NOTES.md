# Magazzino di Reggello — contratto, archivio e costo ricorrente

Note della sessione del 18/09/2026. Fonte: fascicolo «registrazionecontrattocapannone»
consegnato da Patrizio (cinque PDF). Migration: `NZ_ONLY_20260918_238_contratto_magazzino_reggello.sql`.

## Di cosa si tratta

New Zago S.r.l. tiene in locazione un capannone a **Reggello (FI), località Pian di Rona 120/B**:
è la sede/magazzino dell'azienda, l'outlet **SED** dell'anagrafica, centro di costo `sede_magazzino`.
La locatrice è **Alfatecno S.r.l.** (P.IVA 03916460482), già presente fra i fornitori con tre fatture
di canone ricevute via SDI (28/02, 23/07, 26/08 del 2026, 3.050 € lordi ciascuna).

L'etichetta del centro di costo dice ancora «Ufficio/Magazzino Figline», ma il magazzino è a
Reggello; a libro paga la filiale si chiama già PIAN DI RONA. L'etichetta non è stata cambiata:
è una scelta di Patrizio, non un dato da riscrivere di iniziativa.

## I numeri del contratto

| Voce | Valore |
|---|---|
| Firma | 05/02/2026, Figline e Incisa Valdarno |
| Registrazione | 09/02/2026, ufficio di Firenze, n. 003665 serie 3T, codice `TZM26T003665000ZH` |
| Durata | 6 anni, 05/02/2026 → 04/02/2032, prorogabili di 6 fino al 04/02/2038 |
| Disdetta | raccomandata a/r almeno 12 mesi prima (ultimo giorno utile: 04/02/2031) |
| Recesso conduttrice | preavviso 6 mesi; nei primi 34 mesi (fino al 05/12/2028) solo per gravi motivi |
| Canone pieno | 38.400 €/anno + IVA, cioè 3.200 €/mese |
| Canone 05/02 → 04/07/2026 | 500 €/mese, 2.500 € pagati in anticipo con assegno alla firma |
| Canone 05/07/2026 → 04/12/2028 | 2.500 €/mese + IVA, anticipati entro il 10 del mese, bonifico |
| Canone dal 05/12/2028 | 3.200 €/mese + IVA |
| Rivalutazione | 75% della variazione ISTAT, ogni anno dal terzo (prima applicazione 05/02/2028) |
| Deposito cauzionale | 9.600 €, versato con assegno |
| Immobile | foglio 110, particella 184, subalterno 504, categoria D/07, rendita 6.040 € |
| Superficie | 805,3 mq utili, altezza 6,50 m, resede esclusivo e area verde retrostante |
| APE | 0000745140, classe G, EP 307,5 kWh/m²anno, valido fino al 23/04/2034 |
| Imposte di registrazione | 175 € registro + 64 € bollo = 239 €, prima annualità, divisi a metà con la locatrice |

Lo sconto sul canone dei primi 34 mesi è il corrispettivo dei lavori dell'art. VI, a nostra cura:
pareti REI verso i subalterni 505/506/507 con SCIA, zona ufficio con due split, messa in sicurezza
di infissi e portelloni, verifica della messa a terra, migliorie all'illuminazione, automazione del
lucernario di evacuazione fumi, rete divisoria nel piazzale. Termine: 4 mesi dalla firma.
**Se i lavori non sono stati completati**, il contratto dà alla locatrice il diritto di chiedere il
canone pieno di 3.200 €/mese anche per i mesi scontati: è il rischio economico più grosso del
fascicolo, ed è finito fra le scadenze contrattuali (05/06/2026) perché resti sotto gli occhi.

A nostro carico anche: utenze volturate entro 30 giorni dalla firma, TARI, passo carrabile,
manutenzione ordinaria (art. 1609 c.c.), riscaldamento e condizionamento, manutenzione dell'area
verde, **polizza RC** da stipulare entro 15 giorni dall'inizio dell'attività e da tenere per tutta
la locazione: senza, il contratto si risolve di diritto (art. XIII).

## Cosa è stato scritto nel gestionale (solo NZ)

1. **Fornitore Alfatecno**: centro di costo `sede_magazzino` (prima era `all`), categoria Affitti,
   piano di pagamento preso dal contratto — data fattura, 0 giorni, 1 rata — al posto del ripiego
   «fine mese 30 giorni» che aveva scritto il profilo automatico. Le tre fatture già ricevute
   scadono il giorno stesso dell'emissione: il contratto e i documenti dicono la stessa cosa.
2. **Scheda outlet SEDE / MAGAZZINO**: indirizzo, CAP, provincia, superficie, catasto, locatrice
   agganciata come fornitore, durata, deposito, canone annuo, più una nota che riassume il contratto.
3. **Contratto** in `contracts` (`TZM26T003665000ZH`) con rivalutazione, disdetta e il testo degli
   articoli che contano, **storico dei canoni** (6.000 → 30.000 → 38.400 annui) e **nove scadenze**
   contrattuali, dalla rivalutazione del 2028 alla proroga del 2038.
4. **Costo ricorrente** di 3.050 € lordi al mese, dal 05/07/2026, centro di costo `sede_magazzino`,
   categoria Locazione outlet: lo vedono Scadenzario (Ricorrenze) e Cashflow Prospettico. Il canone
   netto di 2.500 € sta anche nella scheda outlet (migration 239), senza doppio conteggio: vedi sotto.
5. **Checklist dei sei documenti** del fascicolo sulla scheda outlet, tab Documenti, pronta a
   ricevere i file: contratto, ricevuta di registrazione, planimetria, APE, copia conforme notarile,
   polizza RC. Compaiono anche in Archivio documenti, sezione «Contratti e outlet».
6. **Imposta di registro della seconda annualità** fra le scadenze fiscali: 150 € (metà di 300)
   al 06/03/2027, ricorrenza annuale.

I **file PDF non sono stati caricati**: lo Storage vuole una sessione utente, che la sandbox non ha.
Si caricano dalla scheda outlet in trenta secondi, vedi sotto.

## Il canone è scritto in due posti e conta una volta sola

Il Cashflow Prospettico aveva due fonti per l'affitto, nate in momenti diversi e cieche l'una
all'altra: `uscite_canoni`, presa da `outlets.rent_monthly`, e `uscite_ricorrenti`, presa da
`recurring_costs`. Un canone scritto in tutti e due i posti usciva di cassa due volte.

Dal 18/09/2026 la regola sta nel codice, in `src/lib/cashflowRent.ts`: quando un centro di costo ha
un costo ricorrente attivo di categoria **Locazione outlet** (`LOC_OUTLET`), il cashflow prende
quello e lascia da parte il canone della scheda. La ricorrenza vince perché è la più vicina alla
cassa: porta l'importo lordo che si paga davvero, e nello Scadenzario si azzera da sola quando
arriva la fattura del locatore (copertura per fornitore e mese entro l'8%, `ESTIMATE_MATCH_TOLERANCE_PCT`).
Il campo della scheda resta dov'è e continua a servire alla scheda outlet e ai margini di categoria,
che ragionano di costo netto e non di cassa. Le spese condominiali e di marketing (`COND_MKT`) non
c'entrano: hanno una categoria diversa e vengono sempre sommate.

La deduplica è applicata in tutti e quattro i punti in cui la pagina usa il canone: il totale
mensile, la vista giornaliera, quella settimanale e il dettaglio delle uscite. Sette test in
`src/lib/cashflowRent.test.ts`.

**L'importo della ricorrenza del magazzino è il lordo 3.050 e non il netto 2.500**, perché la
fattura di Alfatecno vale 3.050 €: col netto la stima resterebbe visibile accanto alla fattura come
«possibile corrispondenza». Anche il cashflow ragiona di cassa. Nella scheda outlet, invece, il
canone è il netto 2.500, come per tutti gli altri punti vendita (migration 239).

### Roma Soratte, il caso che ha fatto trovare il difetto

RSO aveva `rent_monthly` 6.533,33 **e** un costo ricorrente di pari importo attivo dal 05/11/2026:
da novembre il Cashflow avrebbe mostrato 13.066,66 € di canone al mese. Nessun dato è stato toccato:
con la regola nuova il canone arriva dalla ricorrenza e vale 6.533,33, mentre gestione (1.715) e
promozione (1.551,67) continuano a sommarsi, per un totale di 9.800 € al mese, esattamente quanto
dice il contratto con Westi.

Fotografia al 18/09/2026, verificata sul DB vivo: LOC_OUTLET ricorrente esiste solo su RSO e SED;
gli altri sette punti vendita hanno solo il canone di scheda e non cambiano di una virgola. Su Made
e Zago non ci sono né canoni di scheda né ricorrenze, quindi per loro non cambia niente.

## Da chiarire col commercialista

La ricevuta dell'Agenzia dichiara un canone di **17.500 €** per la prima annualità (imposta di
registro 175 €, cioè l'1%), mentre la scaletta dell'art. III per il periodo 05/02/2026 → 04/02/2027
vale **20.000 €** (cinque mesi a 500 più sette a 2.500). La differenza vale 25 € di imposta.
Annotata nelle note del contratto; nessuna correzione fatta di iniziativa.

## Cosa deve fare Patrizio (i file)

1. gestionale-nz.netlify.app → **Outlet** → scheda **SEDE / MAGAZZINO** → tab **Documenti**;
2. nel riquadro **Allegati** ci sono sei righe già pronte: accanto a ognuna, «Carica» e scegliere
   il PDF corrispondente (contratto, registrazione, planimetria, APE, copia conforme; la polizza RC
   quando c'è);
3. da quel momento i file si aprono sia da qui sia da **Archivio documenti**, sezione «Contratti e
   outlet», e restano agganciati al magazzino.
