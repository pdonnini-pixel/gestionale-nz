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

Il **principio** invece è confermato (Francesca Signorini, 23/09/2026): la maturazione «non cambia da
livello a livello, ma dall'orario svolto dalla persona». Con un avvertimento che vale più della
conferma: molti contratti **cambiano percentuale di part time in corso d'anno**, e allora il rateo
annuo è una media e l'orario che se ne ricava non è quello di oggi. Quindi l'orario dedotto resta un
ripiego: quando c'è quello vero in anagrafica, vince quello.

## Le tre voci

| Codice | Voce | Nota |
|---|---|---|
| `F01` | Ferie | |
| `F02` | Permessi ex festività | rateo = ore settimanali × 4,325 × 0,8 |
| `F03` | Permessi ROL | solo dopo 24 mesi (**confermato dallo studio**, 23/09/2026), coefficiente 0,7 |

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

### Il contratto a chiamata non ha ferie da godere (23/09/2026)

Francesca Signorini, studio paghe: nel contratto a chiamata il programma **non puo' stimare la
maturazione**, quindi fa maturare il rateo **per intero**, come un tempo pieno. E ferie e permessi
sono **indennizzati mensilmente**: il conteggio si azzera ogni mese, non restano ore da godere, resta
fuori solo il TFR.

Due conseguenze nel codice, tutte e due gia' applicate:

1. **L'orario non si ricava dal rateo.** Su Focardi il rateo era 168,00 e ne usciva un orario di
   38,84 ore a settimana, da cui una giornata di ferie da 7,77 ore: numeri formalmente corretti e
   completamente finti. `eAChiamata()` in `rateiParse.ts` e' il controllo, l'import salta la
   deduzione, e `NZ_ONLY_20260923_254` ha ripulito il valore gia' scritto.
2. **Niente saldi da chiedere.** Nella scheda Richieste, per chi e' a chiamata, al posto dei tre
   riquadri compare la spiegazione e il calendario non si apre: offrire ore che non esistono sarebbe
   peggio che non mostrare niente.

Oggi riguarda una persona sola su 54 in forza, ma e' il genere di caso che fa sbagliare un conto
senza che nessuno se ne accorga.

### Le cessazioni le porta il documento (23/09/2026)

Il tabulato scrive la data di cessazione accanto al nome. Fino al 23/09 il lettore la salvava in
`leave_accrual_rows.data_cessazione` e nessuno la usava: Bularca (cessata il 30/06) e Niccoli
(30/07) risultavano ancora in forza, e lo abbiamo scoperto **chiedendolo allo studio paghe**, cioe'
chiedendo fuori una cosa che era gia' dentro. Ora il salvataggio dell'import allinea l'anagrafica,
e l'anteprima dice prima chi sta per essere segnato cessato. Scrive **solo dove manca**: una data
messa a mano non si tocca.

### Le matricole si allineano, ma al contrario (23/09/2026)

Francesca Signorini (studio paghe), 23/09/2026: le matricole sono **automatiche e cronologiche** in
base alla data di assunzione, e lei non puo' modificarle. Un secondo rapporto di lavoro prende una
matricola nuova: Sestini era 0000087 col contratto a chiamata (03/06–19/06) e 0000092 col
determinato part time dal 22/06. Sono questi i 5 nominativi su 42 che non tornavano per matricola.
Conseguenza: l'aggancio per **nome + matricola o data di assunzione** non e' un ripiego, e' la sola
strada possibile; `employee_matricole` tiene lo storico, cosi' i dati vecchi restano agganciati.
Correzioni applicate con `NZ_ONLY_20260923_253_anagrafica_da_studio_paghe.sql` (solo NZ).

**Poi la domanda e' tornata indietro**, nella terza mail dello stesso giorno: «sui prospetti dei ratei
non ho modo di far scendere il codice fiscale. Tu non puoi allineare le tue matricole alle mie?».
Si', e infatti e' l'unica direzione possibile: lei non puo' cambiare le sue, noi si'. Quindi il
caricamento del tabulato **riscrive la matricola in anagrafica con quella del documento** quando sono
diverse, l'anteprima dice prima quali cambiano, e la vecchia resta in `employee_matricole` marcata
non corrente, cosi' cedolini e importazioni gia' agganciati non perdono il filo. E' la regola di
sempre: se il dato sta nel documento, si legge e si scrive.

L'aggancio per nome + data di assunzione **resta**, e serve al primo giro: finche' le matricole non
sono allineate, e per chi ha avuto due rapporti, e' ancora l'unica strada.

### Due colonne del tabulato non vanno guardate, e le ferie non scadono (23/09/2026)

Francesca Signorini, studio paghe: «per le due colonne *non indennizzabili* e *da godere nell'anno* ti
chiedo di non guardarle. Sono contatori interni del programma. **Le ferie non scadono.**»

Nel codice: `nonIndennizzabile` e `daGodereAnno` si **leggono e si conservano** (stanno nel documento,
buttarli sarebbe perdere un dato) ma non entrano in nessun calcolo e non si mostrano da nessuna parte.
Il commento in `rateiParse.ts` lo dice, cosi' nessuno ricomincia a usarli.

La colonna **«Da fruire» non e' una di quelle due**, ed e' quella che il gestionale usa. Misurata sulle
85 righe vive di NZ: `da_fruire = residuo + da_maturare` su **85 righe su 85**, scarto medio 0,000. E'
una somma, non una scadenza. Per questo l'etichetta e' passata da «Entro fine anno» a **«Totale a fine
anno»**: la prima faceva credere a un termine ultimo che non esiste. Un test lo tiene fermo: nessun
avviso puo' contenere «entro fine anno», «scadono» o «scadenza».

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

## Fase 3 — chi decide, e come (migration 252)

- `leave_approvers`: l'elenco dei referenti. **Non e' un ruolo**, ed e' la ragione per cui esiste:
  sui dati veri di NZ i tre referenti nominati sono Sabrina (contabile), Denise (**viewer**, sola
  lettura) e Massimo (**nessun account**). Legare l'approvazione al ruolo lasciava fuori due su tre.
  Con `user_id` si decide in app; con la sola `email` si riceve soltanto l'avviso. `outlet_code`
  vuoto vuol dire tutti i punti vendita.
- `leave_settings`: destinatari fissi degli avvisi, per azienda. Nessun indirizzo nel codice, come
  per il report di cassa.
- `posso_decidere_ferie()`: vero per super_advisor / coo / contabile **oppure** per chi e' fra i
  referenti attivi, qualunque sia il suo ruolo.
- `leave_decidi(request_id, giorni_approvati[], motivazione)`: la decisione, anche parziale. I giorni
  passati sono concessi, tutti gli altri respinti; l'elenco vuoto respinge tutto. Aggiorna i giorni,
  la richiesta e la traccia **insieme**, e controlla i permessi in un posto solo.
  Il motivo e' **obbligatorio** appena si toglie un giorno: un rifiuto senza motivo fa ricominciare
  il giro da capo.
- Avviso in-app su `notifications` (come la riapertura cassa) piu' la mail via `leave-notify`.
  La mail e' il secondo canale: se non e' configurata, la decisione vale lo stesso.

Verificato sul vivo di NZ in transazione annullata: due giorni su tre concessi danno
`approvata_parziale`, il saldo cala di 12 h (solo i concessi), il rifiuto senza motivo viene
bloccato e una cassiera che prova a decidere riceve «Non autorizzato». Zero righe scritte.

### leave-notify (edge function)

Manda ai referenti la mail quando una richiesta viene registrata e quando viene decisa.
Destinatari: i referenti attivi con email (filtrati per punto vendita quando ne hanno uno) piu'
`leave_settings.recipients`. Nessuno configurato → `mail: "skipped"` e nessuno perde niente.
Segreti: `RESEND_API_KEY`, `DISTINTA_EMAIL_FROM`, gli stessi di `send-distinta-email`.
Il testo della mail segue la regola qui sotto: lo legge anche chi non lavora nel gestionale.

## Come si parla a chi chiede le ferie (23/09/2026)

**Il dipendente non ragiona in ore con la virgola.** Ragiona a giornata, mezza giornata, o due ore di
permesso. Ma le giornate, oggi, **non si possono dire**, e questa e' la parte che abbiamo capito solo
alla fine.

### Perche' «5 giornate» era falso

Le paghe spalmano l'orario settimanale su cinque giorni per fare i conti. Per Falchi, 8 ore a
settimana, ne esce una «giornata» contabile da **1 ora e 36 minuti**, e le sue 8,65 ore maturate fanno
5,4 di quelle giornate.

Se pero' Falchi in negozio ci va **un giorno solo e fa 8 ore di fila**, quella giornata da 1 ora e 36
non esiste: il suo giorno libero le costa 8 ore, e di giorni ne ha **uno**, non cinque. Scriverle «hai
5 giornate di ferie» e' una bugia, e la stessa bugia valeva per la frase «1 ora e 36 minuti, cioe' una
giornata intera» aggiunta e tolta lo stesso pomeriggio.

Vale per chiunque **non** lavori cinque giorni a settimana, e a Valmontone e Brugnato sono parecchi.

### Quindi: ore parlate, e il posto dove mettere il dato che manca

Il modulo dice **ore e minuti in lettere**: «8 ore e 39 minuti», non «8,65 h». Due righe, Ferie e
Permessi (ex festivita' e ROL sommati: sono due borse che distinguono le paghe, non chi chiede
un'ora). Le ore sono l'unico numero vero, e restano vere per tutti.

`DipendenteModulo.giorniSettimana` esiste gia' ed e' **vuoto per tutti**: e' il posto dove entrera' il
numero di giorni lavorati a settimana. Quando ci sara', le giornate tornano da sole
(`giornateInParole`, che resta con i suoi test) e saranno giornate vere. Il dato **non sta ne' sul
tabulato delle paghe ne' in anagrafica**: lo sa chi fa i turni, cioe' Veronica col file presenze di
People Smart. E' una colonna sola, un numero per persona.

### La giornata contabile: da dove viene il diviso cinque

Non e' una convenzione nostra ed e' dentro il documento. Il CCNL da' **26 giorni lavorativi** di ferie
su base sei giorni (4,33 settimane) e **4 giornate** di ex festivita'. Il rateo annuo di ex festivita'
del tabulato e' **0,8 x orario settimanale**, che e' esattamente **4 x (orario / 5)**: verificato su
tutte e 39 le persone con orario reale, da 8 a 40 ore, il rapporto fa 0,8000 e le giornate 4,000,
senza una eccezione. Serve per scalare i saldi, e per quello va benissimo. Non serve per dire a una
persona quanti giorni puo' stare a casa.

### «Da maturare» guarda la fine del contratto, non dicembre

La colonna «Spett. Maturab» e' vuota su 12 righe di ferie su 42, e non e' un difetto di lettura: e'
vuota per chi ha un determinato che scade entro meta' settembre, quindi non matura piu' un mese intero.
Falchi scade il 05/09: 8,65 ore sono davvero tutto quello che avra'. Per i determinati che scadono il 23
o il 30 settembre la colonna vale un mese. **Resta aperto**: l'etichetta «Totale a fine anno» sulla
pagina dell'amministrazione e' imprecisa per i 25 determinati, perche' per loro il limite e' la scadenza
del contratto e non dicembre.

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
su ogni tabella RLS fuori da una whitelist minima. Nessun utente con quel ruolo esiste ancora, e tutte
le tabelle `leave_*` portano lo stesso blocco: si aprirà a ciascuno **le sue** righe quando esisterà il
collegamento fra utente e scheda dipendente, e quella decisione (come si danno gli accessi a cinquantasei
persone) è ancora di Patrizio.

## Cosa manca

1. **Tabulati di Made e Zago**: il lettore è verificato solo sul documento New Zago. Fino ad allora la
   parità tenant vale per lo schema, non per la lettura.
2. **L'elenco dipendenti completo dello studio**: quello in mano è aggiornato al **03/09/2026** e
   nel frattempo ci sono cessazioni, proroghe, trasformazioni e assunzioni. Francesca sta preparando un
   prospetto nuovo, ma deve unire a mano più stampe: non esiste una stampa sola con tutti i dati.
   Finché non arriva, l'anagrafica va allineata dai documenti che arrivano uno per uno (lettere,
   tabulato dei ratei), che è comunque la strada buona.
3. **Accesso dei dipendenti**: il ruolo esiste ed e' blindato, ma nessuno lo usa ancora. Serve
   decidere come si danno gli accessi (una casella a testa, una per punto vendita, un link
   personale) e collegare l'utente alla sua scheda dipendente.
4. ~~**Fase 4**: il file di ritorno alle paghe con le ferie godute.~~ **Non serve** (Francesca
   Signorini, 23/09/2026): le assenze le riceve gia' ogni mese dal file presenze di **People Smart**
   che prepara Veronica e che lei importa nel suo programma. «Non ho bisogno del piano ferie a parte.»
   Il piano ferie resta quindi uno strumento **interno**, per decidere e per far quadrare i turni: a
   valle non deve produrre niente per lo studio.
5. **Coefficienti**: 4,325 / 0,8 / 0,7 restano dedotti finché lo studio non li conferma. Confermata
   invece la **regola** dei ROL: si maturano solo dopo 24 mesi.
