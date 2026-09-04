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
job e non dentro la funzione (migration 176: il `SET LOCAL` interno non funziona,
Postgres arma il timer a inizio statement). Il giro completo dura circa 7 minuti
su NZ.

Resta da fare, quando servirà: i 105 ms per movimento crescono con l'arretrato.
La cura è pre-calcolare le chiavi del numero fattura in una colonna indicizzata,
invece di valutare `invoice_cited_in_text` su ogni candidato.
