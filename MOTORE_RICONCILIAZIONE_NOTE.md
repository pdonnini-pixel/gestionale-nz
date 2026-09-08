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
