# Il gate di identità del motore: com'è caduto e com'è stato rimesso in piedi

Sessione del 04/09/2026, primo giro completo del cron dopo 28 giorni di fermo.

## Cosa è successo

Il giro ha applicato 8 agganci automatici. Controllati uno per uno leggendo la
causale bancaria per intero: **4 giusti, 4 sbagliati**. I quattro sbagliati sono
stati annullati con `undo_reconcile_movement`, 681,90 € di debito ripristinato.

| fornitore agganciato | fattura | cosa dice davvero la causale |
|---|---|---|
| ANTICO CODICE ONLUS | SF_01, 244,00 | «A FAVORE **LIGNANO BANDA LARGA**» |
| RICA GEST | 2540019647, 12,90 | «A FAVORE **AMERICAN EXPRESS**», movimento 12,99 |
| GRUPPO SERVIZI ASSOCIATI | V070012603479, 315,00 | beneficiario «N.D.», pagato 5 mesi prima della scadenza |
| SPM INVESTIGAZIONI | 31, 110,00 | beneficiario «N.D.», scadenza a 11 giorni |

## La diagnosi, e una diagnosi sbagliata da cui imparare

La prima ipotesi era che il colpevole fossero le chiavi corte del numero fattura
(`SF_01` → `{"01","1"}`). **Era sbagliata**, ed è stata smentita misurando: in
tutti e quattro i casi nessuna chiave del numero era presente nella causale. La
lezione vale più del fix: le tre vie che danno identità vanno misurate una per
una sui casi reali, non dedotte leggendo il codice.

Misurate, hanno detto che a cedere era `supplier_confirmed_in_text`, per due
difetti indipendenti.

**Cercava sottostringhe, non parole.** `position(w in p_text)` trova la parola
anche dentro un'altra: «RICA GEST» risultava confermata da «AMERICAN EXPRESS»,
perché «rica» sta dentro «ameRICAn».

**Non escludeva il lessico bancario.** Ogni causale contiene «CODICE MANDATO»,
«IMPORTO BONIFICI», «A FAVORE». Un fornitore che si chiama «ANTICO CODICE ONLUS»
risultava confermato da qualunque addebito SEPA, perché «codice» è una sua parola.

Il terzo e il quarto caso non passavano di lì: venivano da
`try_match_amount_bank_transaction`, il match sui flussi CBI anonimi, che
accettava scadenze fino a 180 giorni avanti senza alcun limite indietro.

## I rimedi

1. `supplier_confirmed_in_text`: confronto per **parola intera** e stoplist
   allargata al lessico delle causali bancarie (migration 174).
2. `try_match_amount_bank_transaction`: il movimento non può precedere la
   scadenza di più di 30 giorni (migration 175).

## I test, rigirati in transazione annullata

**I quattro casi sbagliati.** Tre non vengono più applicati. Il quarto (SPM) si
riaggancia, ed è corretto: causale anonima ma importo netto esatto, candidato
unico e scadenza a undici giorni. È il caso d'uso della funzione, non un errore;
l'etichetta «sbagliato» era una prudenza eccessiva del controllo manuale.

**60 agganci storici** sganciati e ricalcolati:

| esito | numero |
|---|---|
| riagganciati alla stessa fattura | 34 |
| riagganciati a una fattura **diversa** | **0** |
| non riapplicati (ora proposta, non decisione) | 26 |

Lo zero è il numero che conta: nessun aggancio finisce sulla fattura sbagliata.

**Confronto delle due logiche su tutti i 241 agganci storici**: 179 confermati da
entrambe, **1 solo perso**, 0 guadagnati. L'unico perso (UNICOOP FIRENZE) aveva
un'identità spuria anch'esso, la sua causale è «a favore di n.d.» e non nomina
nessuno.

## Il cron

Riattivato solo dopo questi fix, con il `SET statement_timeout` nel comando del
job e non dentro la funzione (migration 185: il `SET LOCAL` interno non funziona,
Postgres arma il timer a inizio statement). Il giro completo dura circa 7 minuti
su NZ.

Resta da fare, quando servirà: i 105 ms per movimento crescono con l'arretrato.
La cura è pre-calcolare le chiavi del numero fattura in una colonna indicizzata,
invece di valutare `invoice_cited_in_text` su ogni candidato.

---

## Due lezioni dal primo giro notturno pulito (05/09/2026)

Il cron ha girato alle 07:45 in 336,9 secondi, il primo giro andato a buon fine
con il comando corretto: quello del 4 settembre era ancora morto a 120 secondi
netti, perché il `SET statement_timeout` nel comando del job l'ho applicato solo
nel pomeriggio di quel giorno. Diciannove agganci applicati, sette proposte
fuzzy lasciate da confermare.

**Lezione 1: sui movimenti anonimi l'importo esatto non basta.** Due agganci
sono stati annullati, entrambi su causale «VOSTRA DISPOSIZIONE A FAVORE DI N.D.»,
quelle che portano in causale `IMPORTO BONIFICI` e `IMPORTO COMMISSIONI` ma non
il beneficiario. L'importo netto coincideva al centesimo, ma il fornitore aveva
più fatture identiche in giro: GRUPPO SERVIZI ha nove fatture da 315,00 €, SPM
Investigazioni ne ha otto da 110,00 €. Con le gemelle, l'attribuzione a una
piuttosto che a un'altra è arbitraria, e un aggancio arbitrario è peggio di
nessun aggancio. La regola da applicare su questi movimenti: importo netto
esatto **e** candidato unico fra le scadenze aperte dello stesso fornitore.

Il contrasto con un aggancio buono è istruttivo. Lo stesso giro ha chiuso un
bonifico F&B Florence da 460,00 € su **due** fatture da 230,00 (147P e 235P): lì
la causale diceva «SALDO FATTURA 147-235», cioè i numeri erano scritti nero su
bianco. Con quella prova il cumulativo si aggancia senza esitazione.

**Lezione 2: `undo_reconcile_movement` non annulla, riapre.** La funzione non
ripristina lo stato precedente della scadenza: la rimette aperta. Sulla SPM
fattura 31, che era stata chiusa a mano da Lilian il 06/08, l'undo l'ha riportata
a `scaduto` cancellando una chiusura legittima che non c'entrava niente con
l'aggancio del motore. Ho dovuto ripristinare a mano stato, `payment_date` e
`closed_manually`, con una `payable_action` di traccia.

**Prima di ogni undo, guardare `payable_actions`**: se la scadenza risulta già
chiusa per altra via (chiusura manuale, allineamento al file di Sabrina,
pagamento go-live), dopo l'undo va rimessa com'era. L'altra annullata, GRUPPO
SERVIZI V070012600909, era invece legittimamente aperta, riaperta il 09/07 «per
allineamento al file Sabrina, chiusa senza prova bancaria»: lì l'undo ha fatto
esattamente la cosa giusta.

---

## Il giro del 06/09: quando annullare a mano non serve a niente

Il cron ha girato in 125,5 secondi, meno della metà di ieri, perché i movimenti
aperti da esaminare sono molti meno. Ha applicato due agganci, ed erano
**esattamente i due che avevo annullato il giorno prima**.

Questa è la lezione più utile della settimana: se un aggancio non convince,
annullarlo a mano non risolve niente, perché la notte dopo il motore lo rifà
identico. O si accetta il criterio, o si cambia il motore.

**Su GRUPPO SERVIZI avevo torto io.** Il motore applica una regola esplicita:
importo netto esatto e candidato unico *nella finestra temporale*. Il fornitore
ha nove fatture da 315,00 €, ma per un movimento del 06/03 solo una cade nella
finestra (-30 / +180 giorni dalla scadenza). Il candidato era davvero unico. I
soldi sono giusti, il fornitore è giusto: cambia solo quale delle fatture
ricorrenti risulti saldata, e nel dubbio non è un motivo per annullare.

**Su SPM avevo ragione, ma il difetto era nel motore.** La fattura 31 era chiusa
a mano da Lilian il 06/08, e il motore le ha attaccato un movimento del 09/03,
cinque mesi prima. Il ramo che accetta le scadenze già chiuse a mano esiste per
una buona ragione (agganciare il movimento senza sovrascrivere una chiusura fatta
da una persona), ma filtrava solo sulla finestra della *scadenza*, non sulla data
in cui la persona ha detto che il pagamento era avvenuto.

Il fix è una condizione sola, nella migration `20260906_192`: se la scadenza è
chiusa a mano e ha una `payment_date`, il movimento deve cadere entro 30 giorni
da quella data. Misurato prima di applicare: su NZ un solo aggancio storico
ricade nel nuovo vincolo, ed è proprio quello di SPM.

**Come si toglie un aggancio da una scadenza chiusa a mano**: non con
`undo_reconcile_movement`, che la riaprirebbe cancellando la chiusura. Si azzera
`bank_transaction_id`, si porta il log a `rejected` e si riapre il movimento,
lasciando `status`, `payment_date` e `closed_manually` intatti.

**Aggiornamento 02/10/2026 (R27 in `RICONCILIAZIONE_REGOLE.md`).** Questo vale quando l'aggancio è
una deduzione del motore, come qui. Se invece è un documento della banca (estratto, distinta) a dire
che quella scadenza è stata pagata in un altro giorno o con un altro importo, il documento comanda e
sovrascrive la chiusura a mano, salvando prima lo stato precedente e scrivendolo in nota.

---

## Il giro dell'08/09: candidato non unico, ma disambiguato dalla distinta

Terzo giro consecutivo pulito. Il cron ha girato alle 07:45 in 123,9 secondi
(125,7 il 7/9, 125,5 il 6/9: tempi ormai stabili), ha applicato 13 agganci e ha
lasciato 4 proposte da confermare.

Undici agganci si leggono da soli, perché la causale nomina il beneficiario o il
numero di fattura: ALFATECNO 119, LA SCOPA MAGICA 506, GRUPPO SERVIZI
V070012603479 e V070012604065, ANTICO CODICE SF_01, Amazon (due), gigliola
franco 66, SPM 125, GWA 723, GHEZZI MARCO CF-92 (pagamento parziale di 2.866 su
4.866, stato `parziale` corretto). Due erano su causale anonima MPS e li ho
verificati uno per uno: REMAS 4513/00 aveva una sola gemella e quella era fuori
finestra, quindi candidato unico.

**Il caso EPPI merita di essere scritto.** Movimento del 07/09 da 3.051,75 €
(netto 3.050,00 + 1,75 di commissione), causale anonima. Il fornitore ha due
fatture aperte da 3.050,00 € entrambe dentro la finestra: la 32 scaduta il 03/08
e la 36 scaduta il 03/09. Applicando alla lettera il criterio che avevo scritto
io stesso il giorno prima (importo esatto **e** candidato unico, altrimenti
annullare) l'aggancio andava tolto.

Sarebbe stato un errore. Il motore non ha tirato a indovinare: ha spezzato la
parità con una prova concreta. La 32 risulta disposta su quella banca in quelle
date, la 36 no. La verifica è riproducibile:

```sql
select p.invoice_number, p.due_date,
       public.payable_in_distinta_for_movement(p.id, bt.bank_account_id, bt.transaction_date)
  from payables p
 cross join (select bank_account_id, transaction_date
               from bank_transactions where id = '<id movimento>') bt
 where p.supplier_name ilike '%EPPI%';
-- 32 -> true, 36 -> false
```

Torna anche il ritmo dei pagamenti: la 20 scadeva il 30/06 ed è stata pagata il
10/07, la 24 scadeva il 09/07 pagata il 07/08, la 32 scadeva il 03/08 pagata il
07/09. Un mese dopo la scadenza, sempre. La 36, scaduta il 03/09, si pagherà a
ottobre.

**Il criterio va corretto così**: su causale anonima pretendere importo netto
esatto e candidato unico, *oppure* candidato unico fra quelli disposti in
distinta su quella banca in quelle date. Il secondo ramo è la funzione
`payable_in_distinta_for_movement`, e nel log si riconosce dalla nota
«auto (distinta): scadenza disposta su questa banca in queste date». Quando c'è
quella nota, l'aggancio ha una prova documentale dietro e non si tocca.

Le 4 proposte lasciate aperte sono corrette come proposte: BRT accostata a un
bonifico che in causale dice SAMA SRL, TANESINI accostata a un pagamento POS in
un hotel di Bentivoglio. Il motore non le ha applicate, e ha fatto bene.

---

## Il controllo del 14/09: un fix che era sparito, e la terza volta che succede

Settimana pulita sul cron: otto giri consecutivi riusciti, dal 7 al 14 settembre,
fra 115 e 134 secondi l'uno. Nessun errore, tempi ormai stabili.

Venticinque agganci applicati dal motore in tutta la settimana. Cinque hanno la
causale parlante e si leggono da soli: Hotel Gross (POS con l'esercente in
chiaro), gli addebiti diretti di CONSORZIO SHOPINN, DWS GRUNDBESITZ e SAN MAURO
(«ADDEBITO SDD … A FAVORE …»), e la caparra Westi, che nomina il beneficiario e
risulta anche disposta in distinta. Gli altri venti sono su causale anonima MPS
e li ho verificati uno per uno: **sedici avevano candidato unico** nella
finestra, quindi il criterio regge senza discussione.

I quattro con gemelle vanno guardati:

| fornitore | fattura | gemelle | esito |
|---|---|---|---|
| LA SCOPA MAGICA | FPR 156/26 | 2 | scelta la scadenza più vicina (6 giorni), regge |
| Colette | 292/2026 | 1 | sono due rate della STESSA fattura, cambia solo quale risulti saldata |
| Giulio Zanazzi | FPR 1/26 | 1 | discutibile: il movimento del 20/04 sta a un giorno dalla 5/26 e a tre mesi dalla 1/26 |
| Spm Investigazioni | 31 | 2 | **sbagliato**, vedi sotto |

Su Zanazzi il motore ha preso la fattura più lontana invece della più vicina.
Non l'ho annullato: entrambe sono chiuse dal go-live con la stessa data fittizia
del 17/06, i soldi e il fornitore sono giusti, e cambia solo quale delle due
risulti saldata. Ma la scelta per vicinanza sarebbe stata migliore, e se il caso
si ripete vale la pena guardare come il motore rompe la parità sulle date.

### SPM 31: il fix della 192 non c'era più

La fattura 31 di Spm Investigazioni è chiusa a mano, con `payment_date` al
06/08/2026. Il 10/09 il motore le ha riattaccato il movimento del **09/03**:
centocinquanta giorni prima.

È **esattamente** il caso per cui il 06/09 era nata la migration 192, che
aggiungeva una condizione sola: se la scadenza è chiusa a mano e ha una
`payment_date`, il movimento deve cadere entro 30 giorni da quella data.

Quella condizione non era più nella funzione. In `try_match_bank_transaction` la
parola `closed_manually` non compariva affatto: una `CREATE OR REPLACE`
successiva aveva riscritto il corpo sostituendo il concetto con un più povero
`(status = 'pagato') AS is_closed_manual`, che guarda lo stato e ignora sia il
flag sia la data. Il nome della variabile diceva ancora «manual», ma non lo
guardava più nessuno.

Lo storico del log è impietoso: **lo stesso aggancio è stato annullato cinque
volte** — 25/07, 04/09, 05/09, 06/09 e ora 14/09. Le prime quattro a mano, senza
che il motore cambiasse; la quinta insieme al fix.

### La lezione, che è la terza volta

È il terzo caso in cui una `CREATE OR REPLACE` su questa funzione cancella il
ramo di qualcun altro. I precedenti: la 209 che aveva mangiato il ramo `v_altro`
della 207, fuso poi nella 210.

Rileggere `pg_get_functiondef` prima di sostituire non è bastato, perché chi
riscrive lo fa in buona fede partendo dal proprio testo. Per questo la **218 non
riscrive la funzione**: legge la definizione viva dal catalogo, verifica che
l'ancora ci sia una volta sola, ci innesta la condizione con `regexp_replace` e
riapplica quel testo. Quello che c'è dentro non lo tocca, qualunque cosa sia.
È idempotente, e se il corpo è cambiato al punto che l'ancora non è più unica
si ferma con un errore invece di indovinare.

**Regola per le prossime volte**: su `try_match_bank_transaction` non si fa più
`CREATE OR REPLACE` con il testo intero. Si patcha la definizione viva, oppure,
quando il vincolo si può esprimere come invariante sui dati, lo si mette in un
trigger sulla tabella — dove nessuna riscrittura di funzione lo può togliere.

### Verifica dopo il fix

Test in transazione annullata: sganciata SPM 31 e rilanciato il motore su quel
movimento, la risposta è `matched: false`. Non ripiega su un'altra gemella, e va
bene così: nessun aggancio è meglio di uno arbitrario.

Controllati anche tutti gli altri rami dopo la patch — movimenti della banca,
note di credito, distinta, netto CBI, pari punteggio: ci sono tutti.

Su NZ una sola scadenza chiusa a mano aveva un movimento oltre i 30 giorni, ed
era questa. Le altre 49 chiuse a mano con movimento agganciato stanno dentro il
vincolo.

### Una cosa imparata di passaggio

`payables.cash_movement_id` è una **colonna generata** da `bank_transaction_id`:
non si aggiorna a mano e si azzera da sé quando si toglie l'aggancio bancario.
Spiega anche perché, contando le scadenze riconciliate, «con cassa» e «con
banca» danno sempre lo stesso numero.

---

## Il controllo del 21/09: il fix ha tenuto, e un'idea sbagliata scartata in tempo

Ottavo giro consecutivo pulito: otto esecuzioni dal 14 al 21 settembre, tutte
riuscite, fra 116 e 130 secondi.

**Il vincolo rimesso dalla 218 regge.** L'aggancio di Spm Investigazioni 31, che
era tornato cinque volte, in sette notti non si è più ripresentato: zero
riagganci, la scadenza è ancora sganciata e stato, data di pagamento e chiusura
manuale sono intatti. Era il vero test della patch, ed è passato.

Settimana tranquilla anche per volume: quattro agganci applicati e una proposta
da confermare. Tre agganci hanno il beneficiario o il numero di fattura scritto
in causale — UnipolTech (SDD con il numero 913280757 in chiaro), Lignano Banda
Larga («A FAVORE LIGNANO BANDA LARGA»), FUTURA IMMOBILIARE («a favore di: FUTURA
IMMOBILIARE S.R.L SALDO FATTURA 45»). Il quarto vale una riga.

### Il Comune pagato via pagoPA

Bonifico di 80,00 € del 16/09, causale «Bonifico da Voi disposto a favore di:
Servizio elettronico di pagamento per i cittadini 1789565». Il beneficiario non
è il fornitore: è pagoPA, cioè l'intermediario. Di per sé non conferma niente.

Il motore l'ha attaccato ai diritti di segreteria del COMUNE DI SANT'ORESTE
usando il ramo della distinta, e ha fatto bene: nella finestra ci sono **undici**
scadenze da 80,00 €, quasi tutte di ALTOMUGELLO, ma **una sola risulta disposta
su quella banca in quelle date**, ed è quella del Comune. Il secondo ramo del
criterio serve esattamente a questo, e qui ha rotto una parità a undici.

### L'idea sbagliata: mettere gli F24 fra i movimenti da ignorare

La proposta lasciata da confermare è FAMILY CENTER 825/2026 su un movimento con
causale «Imposte e Tasse: Delega Unificata», cioè un F24. Un F24 non paga una
fattura fornitore: la tentazione era aggiungere quelle causali a
`fn_bank_own_movement`, insieme a rate di mutuo e canoni, e togliere il rumore
alla radice.

Misurato prima di farlo, e per fortuna. In 90 giorni i movimenti F24 hanno
generato **sette** righe di log su 915 totali. Sei sono proposte `auto_fuzzy`
mai applicate: il gate dell'identità le ferma già da solo. La settima è
`applied`, ma è un aggancio **manuale** del 03/09 ed è semanticamente giusto:
**Tari Valdichiana, fattura 9841 da 700,00 €, pagata con F24 il 07/08**. La TARI
si paga proprio così.

Quindi mettere gli F24 fra i movimenti della banca avrebbe tolto sei proposte
innocue e in cambio avrebbe reso impossibile agganciare la TARI, l'IMU e ogni
altro tributo che nel gestionale esiste come fattura di un fornitore vero —
anche a mano. Il rumore resta, ed è il prezzo giusto.

**La regola che se ne ricava**: prima di allargare la lista dei movimenti da
ignorare, contare quante proposte genera davvero quella causale e guardare se
fra quelle c'è un aggancio legittimo. Una lista di esclusione è facile da
allungare e difficile da accorciare, perché quando toglie un caso buono non lo
segnala: semplicemente quel movimento non si aggancia più, e nessuno se ne
accorge.

---

## Il controllo del 28/09: «abbinamento per data» che sceglieva la data peggiore

Cron pulito per la terza settimana di fila: otto giri dal 21 al 28 settembre,
tutti riusciti, fra 124 e 131 secondi. Diciannove agganci applicati e quattro
proposte.

Il vincolo della 218 continua a reggere: SPM 31 è sganciata da quattordici
notti, zero riagganci, e su tutto NZ **nessuna** scadenza chiusa a mano ha più
un movimento oltre i trenta giorni dalla data di pagamento dichiarata.

Dei diciannove agganci, tredici portano il beneficiario in chiaro (gli SDD di
ENEGAN, Enel, Hera, UnipolTech; il POS di GUTEN con l'esercente nella causale;
il bonifico instant a MILANI, confermato anche dalla distinta). Sei sono su
causale anonima, ma cinque di questi — GGZ e Frankie Retail — sono agganci
fatti con l'estratto conto MPS alla mano, dove la banca scrive per esteso
«VOSTRA DISPOSIZIONE GGZ SF_1375-1419-NC14» e «A FRANKIE RETAIL HOLDCO saldo
fattura B01…»: prova documentale, non deduzione.

Resta EPPI, e lì c'era un difetto vero.

### Il difetto

Movimento del 03/06/2026 da 3.050,00, causale anonima. EPPI ha **quattro**
fatture aperte da 3.050,00 nella finestra. Il motore ha scelto quella scaduta
il 06/02, a **117 giorni** dal movimento, quando ce n'era una a 27. E lo ha
fatto scrivendo nel log «abbinamento per data — stesso fornitore/importo».

Misurato prima di toccare niente: su **66** agganci passati da quel ramo negli
ultimi 120 giorni, 20 avevano gemelle e **3** hanno scelto un candidato non
ottimale per data. Oltre a EPPI: LA FAVORITA 331 (96 giorni invece di 35) e
Colette 292/2026 (21 invece di 0, con una scadenza che cadeva esattamente il
giorno del movimento).

### La causa, che era a due righe di distanza

Il tie-break sulla distanza **esisteva già**, ma chiuso dentro una condizione
che lo restringeva a un caso solo: valeva soltanto se le due righe avevano lo
stesso numero di fattura, cioè se erano rate dello stesso documento. Fra
fatture DIVERSE dello stesso fornitore con lo stesso importo — il caso EPPI —
non si applicava affatto, e vinceva la prima riga incontrata nel ciclo, cioè
un ordine deciso dal piano di esecuzione.

La 219 toglie la condizione sul numero di fattura: il confronto vale per
qualunque coppia di candidati dello stesso fornitore. Il corpo interno non è
stato toccato (prima la distanza minore, poi a pari distanza il numero di rata
più basso).

### Perché non è rischioso

Il ramo agisce **solo a punteggio identico**. Un abbinamento vinto su identità
certa — beneficiario in causale, numero di fattura citato, scadenza in distinta
— ha punteggio più alto e vince nel ramo sopra, dove non si passa nemmeno di
qui. Cambia soltanto quale, fra due righe che il motore giudica indistinguibili,
risulti saldata: importo e fornitore restano gli stessi in ogni caso.

### Il test, e una cosa che ha insegnato

In transazione annullata: sganciata EPPI 8, riaperto il movimento, rilanciato il
motore. Prima sceglieva la 8 a 117 giorni; ora sceglie la 16 a 56, che è la più
vicina **fra quelle ancora libere** (la 20, a 27 giorni, è già agganciata a un
altro movimento e il filtro `bank_transaction_id IS NULL` la esclude
correttamente).

E il tipo di match è sceso ad `auto_fuzzy`, punteggio 51: il motore **propone**
invece di applicare. È il comportamento giusto su una causale anonima senza
identità confermata, ed è un effetto collaterale benvenuto.

### I tre agganci storici non sono stati toccati

EPPI 8, LA FAVORITA 331 e Colette 292/2026 restano come sono. Tutte e tre le
scadenze sono già pagate: importo e fornitore sono corretti, cambia solo quale
gemella risulti saldata. Spostarli a mano significherebbe sostituire
un'arbitrarietà con un'altra, senza una prova che dica quale sia quella giusta.
Vale la lezione del 06/09: o si accetta il criterio, o si cambia il motore. Il
motore è cambiato; il passato, senza prove nuove, si lascia dov'è.

---

## Il controllo del 05/10: la patch regge, e la metrica con cui l'ho misurata era sbagliata

Quarta settimana pulita di fila sul cron: otto giri dal 28/09 al 05/10, tutti
riusciti, fra 125 e 138 secondi.

A prima vista il numero spaventa: **127 agganci applicati** contro i 19 della
settimana scorsa. Guardandoli, 114 sono del **02/10**, `match_type = manual`, e
113 di questi su movimenti RiBa: è il caricamento in blocco delle distinte del
30/09, fatto da fuori. Gli agganci **del motore** sono **13**, in linea con le
settimane precedenti.

Tutti e tredici su causale parlante, col beneficiario scritto dalla banca. Sei
hanno anche la prova della distinta. **Nessuno su causale anonima.**

Il più istruttivo: GRAPHIC REPORT, fattura `FI0000250` scaduta il 30/04/**2025**,
agganciata a un bonifico del 28/09/2026 — a 516 giorni di distanza, ben oltre la
finestra. È corretto: la causale dice «SALDO FATTURA FI0000250», il numero è
scritto in chiaro, e il motore ha scelto proprio quella e non la `FI0000083` che
ha lo stesso identico importo di 341,60. Due gemelle perfette, disambiguate dal
numero in causale. È il ramo dell'identità che funziona come deve.

### La patch della 219 regge. La metrica no.

Rifacendo il conteggio della settimana scorsa sulla settimana nuova, il risultato
diceva «1 aggancio su 2 ha ancora scelto la più lontana». Era un **falso
positivo della misura**.

Il caso: ATENA SERVIZI, due bonifici da 230,00 **lo stesso giorno**, il 02/10,
con cinque fatture candidate dello stesso importo. Il motore ha agganciato il
primo bonifico alla scadenza del 30/09 (due giorni) e il secondo a quella del
31/08 (trentadue giorni). Il secondo sembra «sbagliato» solo perché la più
vicina era già stata presa dal primo. Verificato che fossero due movimenti
distinti: riferimenti `0126100212716228` e `0126100212739580`, due id diversi,
due fatture diverse. Il motore ha pagato due fatture con due bonifici, ed è
esattamente quello che deve fare.

**Il difetto era nella query, non nel codice**: contavo i candidati senza
escludere quelli già agganciati ad altri movimenti. Quando più pagamenti dello
stesso fornitore e importo cadono nello stesso giro, i candidati si consumano, e
dal secondo in poi la distanza minima teorica non è più raggiungibile.

### I numeri veri, corretti

Rifatta la misura contando solo i candidati **liberi**
(`bank_transaction_id IS NULL` oppure già quel movimento), su 130 giorni:

| | come l'avevo misurato il 28/09 | misura corretta |
|---|---|---|
| agganci col ramo «per data» | 66 | 71 |
| con gemelle | 20 | **4** |
| scelte sbagliate | 3 | **2** |
| sbagliate dopo la 219 | — | **0** |

Quindi il problema era **più piccolo** di come l'ho raccontato, e la patch
funziona: da quando è attiva, zero scelte sbagliate. Anche il caso EPPI della
settimana scorsa era meno grave di come l'avevo descritto: non «117 giorni invece
di 27», perché la fattura a 27 giorni era già agganciata altrove, ma 117 invece
di 56. Il difetto c'era, solo più contenuto.

**Regola per le prossime misure**: quando si conta quanto spesso il motore
sceglie male fra candidati equivalenti, i candidati vanno filtrati per
disponibilità. Un candidato già agganciato a un altro movimento non è un'opzione
che il motore ha scartato: è un'opzione che non aveva.

### Le RiBa del 30/09 si sono chiuse

Chiude il filo aperto l'11/09, quando le tredici righe SHINE di giugno sono state
portate dal 31/10 al 30/09 per seguire l'elenco della banca. I fatti hanno dato
ragione a quella scelta: al 05/10 su quella data risultano pagate **21 righe su
21** di TANESINI, **46 su 48** di SHINE, **16 su 18** di MIAN, **20 su 21** di
GRUPPO FB, e tutte quelle di S.R.T., MARF, GLADIOTEX e faliero.

I residui aperti sono quasi solo note di credito da compensare (SHINE −31,51 —
le due fuori elenco già identificate a settembre; MIAN −219,60), più una riga
GRUPPO FB da 866,57.
