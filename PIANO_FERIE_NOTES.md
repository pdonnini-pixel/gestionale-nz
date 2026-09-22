# Piano ferie — note di dominio

Da leggere prima di toccare ferie, permessi, `leave_*` o la scheda «Ferie e permessi» di Dipendenti.

## Il principio

**Il gestionale non calcola la maturazione delle ferie.** La legge dal tabulato «Situazione ratei di
ferie e permessi» che lo studio paghe (Signorini, Paghe Infinity) pubblica ogni mese insieme ai
cedolini. Quel documento è l'unica fonte che sa davvero quante ore ha in tasca ciascuno, e la prova
che lo legge bene è la quadratura con i «Totali ditta» stampati in fondo.

## L'unità di misura è l'ora

Una giornata vale l'orario settimanale diviso cinque. Sui 42 nominativi del tabulato di agosto 2026,
sette lavorano davvero 40 ore: contare a giornate darebbe numeri sbagliati a trentacinque persone.
L'orario si ricava dal rateo annuo di ferie, che è **ore settimanali × 4,325** (40 h → 173,00;
30 h → 129,75; 8 h → 34,60, verificato su tutti e 12 i valori distinti del documento).

Il coefficiente sta in due posti soli, e devono restare allineati:
`RATEO_FERIE_PER_ORA_SETTIMANALE` in `src/lib/rateiParse.ts` e la funzione SQL
`public.leave_ore_settimanali_da_rateo`. È **dedotto**, non confermato dallo studio: l'interfaccia lo
dichiara, e una conferma diversa si cambia lì.

## Le tre voci

| Codice | Voce | Nota |
|---|---|---|
| `F01` | Ferie | |
| `F02` | Permessi ex festività | rateo = ore settimanali × 4,325 × 0,8 |
| `F03` | Permessi ROL | solo dopo 24 mesi, coefficiente 0,7 |

## Fase 1 — i saldi (migration 248, 250)

- `leave_accrual_imports` / `leave_accrual_rows`: un tabulato letto, una riga per persona e voce.
- Reimportare lo stesso mese **non cancella niente**: il vecchio import resta con `attivo = false`.
- `employees.ore_settimanali_paghe` è una colonna **nuova**: `ore_settimanali` (40 per tutti, valore
  di riempimento inserito a mano) non si sovrascrive mai.
- L'abbinamento riga ↔ persona usa nome + matricola **o** data di assunzione: la matricola da sola
  differisce su 5 nominativi su 42 fra gestionale e paghe. Il metodo usato resta scritto in
  `match_metodo`, così un abbinamento dedotto si distingue da uno confermato a mano.
- `persone` e `righe_lette` sono due conteggi **diversi**: mostrarne uno al posto dell'altro è stato
  un bug vero (la 250 lo ha corretto).

## Fase 2 — le richieste (migration 251)

- `leave_requests` (la richiesta), `leave_request_days` (un giorno: data, voce, giornata/mezza/ore,
  e le **ore effettive** sempre valorizzate), `leave_request_events` (la traccia).
- Gli eventi li scrive un **trigger**, non il frontend: la storia non dipende da chi chiama.
- Una richiesta uscita dalla bozza **non si cancella**: si ritira. Lo impedisce un trigger, non solo
  l'interfaccia.
- Stati previsti fin da subito, anche quelli che la fase 2 non usa: `bozza`, `inviata`, `approvata`,
  `approvata_parziale`, `respinta`, `ritirata`, `chiusa`. Così l'approvazione non tocca lo schema.
- `origine` dice da dove arriva il dato (modulo cartaceo, mail, compilata insieme alla persona),
  perché finché i dipendenti non hanno un accesso la compila l'amministrazione per conto loro.

### Il doppio conteggio, e come si evita

Il tabulato porta una data di saldo (fine mese elaborato) e il goduto **fino a quel giorno è già
dentro**. Nella vista `v_leave_disponibilita` scalano quindi solo i giorni che cadono **dopo** quella
data; un giorno anteriore non si sottrae due volte. Verificato sul database vivo di NZ con una
transazione annullata: residuo 54,27 h → 36,27 h dopo 18 h chieste, e invariato aggiungendo un giorno
precedente al 31/08.

Scalano le richieste `inviata` (giorni `richiesto`) e quelle approvate (giorni `approvato`). Le
**bozze non tolgono niente**: si vedono, e basta.

## Cosa vede il dipendente, e cosa no

Il modulo esportato (`src/lib/ferieExport.ts`) **lo legge la persona**. Quindi porta le sue ore, a che
data sono aggiornate, e nient'altro: niente «tabulato delle paghe», niente «gestionale», niente valori
dichiarati dedotti o da confermare. Da dove arriva il numero e come lo teniamo è roba interna e resta
a video, nella pagina che usa l'amministrazione, dove invece serve.

Il test `ferieExport.test.ts` fa fallire la build se una parola interna rientra in un modulo. Vale per
tutto quello che uscirà verso i dipendenti, mail della fase 3 comprese.

### Una giornata non è l'orario settimanale

`oreGiornata()` riceve **ore a settimana** e divide per cinque. Chi fa 28 ore ha una giornata da 5,60.
Il bug della prima stesura scriveva «una giornata vale 28,00 h»: ogni giorno di ferie ne avrebbe
mangiati cinque. A video la giornata si prende da `v_leave_disponibilita.ore_giornata_dedotte` quando
c'è, così il conto è uno solo e lo fa il database.

## Accessi

Il ruolo `dipendente` esiste dalla migration 249 ed è blindato: una policy RESTRICTIVE `dipendente_block`
su ogni tabella RLS fuori da una whitelist minima. Nessun utente con quel ruolo esiste ancora, e le
tabelle `leave_request*` portano lo stesso blocco: sarà la fase 3 ad aprire a ciascuno **le sue** righe,
quando esisterà il collegamento fra utente e scheda dipendente.

## Cosa manca

1. **Tabulati di Made e Zago**: il lettore è verificato solo sul documento New Zago. Fino ad allora la
   parità tenant vale per lo schema, non per la lettura.
2. **Fase 3**: approvazione (anche parziale) con motivazione, notifica al referente, accesso dei
   dipendenti.
3. **Fase 4**: il file di ritorno alle paghe con le ferie godute.
4. **Coefficienti**: 4,325 / 0,8 / 0,7 restano dedotti finché lo studio non li conferma.
