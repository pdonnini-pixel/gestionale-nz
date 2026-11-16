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

Il modulo dice **ore, con i decimali e la parola per esteso**: «0,55 ore», «11,20 ore». Due righe,
Ferie e Permessi (ex festivita' e ROL sommati: sono due borse che distinguono le paghe, non chi chiede
un'ora). Le ore sono l'unico numero vero, e restano vere per tutti.

**Niente minuti**, ed e' stato un errore averli messi: il tabulato ragiona in ore decimali (0,55000) e
tradurle in «33 minuti» fa sparire il riferimento con il documento che la persona puo' avere in mano.
Con «0,55 ore» si confronta riga per riga. Il caso che l'ha fatto vedere: Rosseti Veronica, 0,55 ore di
ferie residue, che sul modulo si leggevano «33 minuti».

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

### Le due colonne da ignorare non le usiamo, verificato due volte

Francesca: «non indennizzabili» e «da godere nell'anno» sono contatori interni, non si guardano. Nel
codice `non_indennizzabile` e `da_godere_anno` si **leggono e si salvano** (stanno nel documento) ma
non compaiono in nessun calcolo e in nessuna schermata: `grep` sul sorgente, l'unica occorrenza fuori
dai tipi generati e' la riga che li scrive in `leave_accrual_rows`.

La colonna che il gestionale usa e' **«Da fruire»**, che e' la terz'ultima, non una delle due finali.
Riverificato sulla riga di Rosseti del tabulato di agosto: residuo 0,54999 + da maturare 40,36667 =
**40,91666**, cioe' esattamente il «Da fruire» stampato. E' una somma. Il suo «Da god. nell'anno» vale
33,15 e non lo tocca nessuno.

### «Da maturare» guarda la fine del contratto, non dicembre

La colonna «Spett. Maturab» e' vuota su 12 righe di ferie su 42, e non e' un difetto di lettura: e'
vuota per chi ha un determinato che scade entro meta' settembre, quindi non matura piu' un mese intero.
Falchi scade il 05/09: 8,65 ore sono davvero tutto quello che avra'. Per i determinati che scadono il 23
o il 30 settembre la colonna vale un mese. **Resta aperto**: l'etichetta «Totale a fine anno» sulla
pagina dell'amministrazione e' imprecisa per i 25 determinati, perche' per loro il limite e' la scadenza
del contratto e non dicembre.

## Le sovrapposizioni per punto vendita (migration 257, 24/09/2026)

Chi sceglie le ferie e chi le approva devono vedere la stessa cosa, e devono vederla **prima** di
decidere: chi altro di quel negozio è già fuori in quei giorni.

La vista `v_leave_giorni_outlet` unisce `leave_request_days` + `leave_requests` + `employees` +
`outlets` e restituisce una riga per persona-giorno-voce, con `confermato` a dire se la richiesta è
già stata approvata o è ancora in attesa. `security_invoker = on`, come tutte le `v_*`.

Due scelte che vanno lette insieme:

- **Le bozze non ci sono.** La vista filtra `stato IN ('inviata','approvata','approvata_parziale','chiusa')`.
  Una bozza non impegna ore nel saldo, quindi non può comparire come collega già via: sarebbe un
  impedimento che nessuno ha ancora chiesto.
- **Si dice chi è VIA, mai chi è PRESENTE.** Il gestionale conosce ferie e permessi registrati qui
  dentro. Non conosce i turni, né malattie, maternità, infortuni, congedi. Scrivere «restano 2 persone
  in negozio» sarebbe un numero falso scritto con sicurezza. Il componente lo dice a chiare lettere in
  fondo al riquadro, e la FAQ della guida risponde alla domanda quando arriva.

Il punto vendita è quello di `employees.outlet_id`. **Non** `employee_outlet_allocations`, che serve a
ripartire i costi ed è vuota: leggendo da lì, l'interfaccia scriveva «Nessun punto vendita» su tutte e
41 le persone. Chi in anagrafica non ha un outlet non può vedere i colleghi, e il riquadro lo dice
invece di mostrare un elenco vuoto che sembrerebbe un «nessuno è via».

Dove si vede, in `src/components/SovrapposizioniOutlet.tsx`, usato due volte:

1. **In fase di richiesta** (`RichiesteFerie`): sul calendario, un numero arancione sul giorno conta
   i colleghi già via, caricato per tutto il mese visibile in una query sola; sotto i giorni scelti,
   il riquadro con i nomi, la voce e «da decidere» per le richieste ancora in attesa.
2. **In fase di approvazione** (`ApprovazioniFerie`): lo stesso riquadro, in versione compatta, sotto
   i giorni della richiesta aperta.

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

## Fase 4 — pianificazione da parte dei dipendenti (decisa da Patrizio il 19/10/2026, non ancora costruita)

### La finestra

- Ogni anno **dal 1° gennaio al 28 febbraio** i dipendenti pianificano le ferie dell'anno in corso e del
  successivo. In apertura la finestra va **da subito al 28/02/2027** e copre fino al 31/12/2027.
- Dopo il 28 febbraio si può ancora chiedere: richiesta singola, valutata subito, senza la priorità
  della finestra.
- Tutto quello che si sceglie è una **proposta** (stato `inviata`), mai un'accettazione. Le richieste
  della finestra si valutano tutte insieme alla chiusura, negozio per negozio: chi sceglie prima non è
  avvantaggiato. Decidono sempre i referenti (`leave_decidi`).

### Il semaforo sulla copertura

Per ogni giorno scelto il gestionale toglie la persona, i colleghi già via (approvati e in attesa,
segnati a parte) e le assenze lunghe, e verifica con il fabbisogno del giorno e la geometria dei turni
(pause sfalsate, massimo 8 ore) se il negozio si copre: **verde** si copre, **giallo** si copre con
poco margine, **rosso** non si copre. I giorni rossi **si possono chiedere lo stesso**, con l'avviso.
Alla persona il semaforo; nomi dei colleghi e numeri del fabbisogno restano a chi approva.

Questo supera la regola del 24/09 «si dice chi è via, mai chi è presente»: quella valeva finché il
gestionale non conosceva turni e fabbisogno. Il semaforo va costruito solo quando li conosce davvero.

### I conflitti

Criteri, in quest'ordine: **1) chi ha più ore maturate da smaltire, 2) rotazione di agosto e di Natale
rispetto all'anno prima.** L'anzianità **non** è un criterio (Patrizio: «non ha senso»).

### Maturazione e anticipo

- Saldo di partenza dal tabulato; ratei proiettati mese per mese (ferie ore settimanali × 4,325 / 12,
  ex festività × 0,8, ROL × 0,7 dopo 24 mesi), con la regola mensile dello studio (da confermare: mese
  intero oltre 15 giorni lavorati). Ogni tabulato nuovo si confronta con la proiezione.
- Ferie oltre il maturato a quella data (**anticipo**): **sì solo per i tempi indeterminati.** Per i
  determinati la proiezione si ferma alla scadenza del contratto e oltre non si pianifica. Chi è a
  chiamata non pianifica (ferie pagate ogni mese).
- **Obiettivo di fine anno: zero sulle ore che altrimenti verrebbero pagate.** Da confermare con lo
  studio quali e quando: residuo dei determinati a fine contratto, ex festività e ROL non goduti nei
  termini. Le ferie dei tempi indeterminati «non scadono» (studio, 23/09): restano l'obiettivo di legge
  di due settimane nell'anno di maturazione.
- Chi pianifica poco riceve, a finestra chiusa, ferie **proposte dal sistema** nei periodi verdi del
  suo negozio, modificabili.

### L'accesso

**Superato il 05/11/2026**: accesso individuale per ogni dipendente, con l'app (`/app`, vedi TIMBRATURE_NOTES.md). Prima: **un accesso per negozio** (decisione di Patrizio). Il ruolo `dipendente` esiste ed è blindato: va
aperto alle righe delle persone di quel negozio. Con un accesso condiviso chi propone sceglie il proprio
nome: ogni proposta lo registra, e resta una proposta finché un referente non decide.

## Controproposte (migration 320, 20/10/2026)

Richiesta di Patrizio: chi decide le ferie deve poter approvare, rifiutare o proporre altre date.
Chi decide resta quello di `leave_approvers` (anche una persona senza accesso, avvisata per mail).
`leave_controproponi(request, giorni, motivo)` chiude la richiesta respinta con «Proposte altre
date (...): motivo» (passa da `leave_decidi`, quindi avviso in-app e mail come una decisione) e
salva la proposta in `leave_counterproposals`. In «Richieste» la proposta si accetta o rifiuta con
`leave_rispondi_controproposta`: se accettata nasce una richiesta nuova gia' approvata con le date
proposte. Le date proposte non possono cadere in un evento con «niente ferie né permessi».

**Dalla 407 (12/11/2026) la richiesta nata dalla controproposta segue le regole del negozio.** Nasce
`inviata` con i giorni `richiesto`, poi: ogni giorno passa da `ferie_blocco_giorno` (un giorno
vietato vale solo come eccezione, se il negozio le ha accese; altrimenti l'accettazione è rifiutata
con il motivo e la proposta resta aperta); `ferie_controlla_lato` verifica che chi accetta possa
decidere in quel negozio; poi diventa `approvata`, con una sola approvazione come ogni altra
richiesta. Nel registro restano la decisione (evento `decisione`, con chi ha registrato
l'accettazione) e, sulla richiesta di partenza, `controproposta_accettata` o
`controproposta_rifiutata`. Prima della 407 la controproposta accettata saltava i controlli sui
giorni e su chi approva. `leave_controproponi` non cambia: passa già da `leave_decidi`.
Limite noto (revisore, 12/11/2026): `leave_controproponi` non controlla prima i giorni vietati. Se l'ufficio propone date in un giorno dove il negozio ha spento ferie o permessi e non ha acceso le eccezioni, la proposta nasce ma non si può accettare: l'accettazione è rifiutata con il motivo e la proposta resta aperta. Da valutare un avviso già alla proposta.

## Moduli ottobre-dicembre 2026 caricati (20/10/2026)

Dalla cartella Drive di Patrizio (Forte dei Marmi escluso, Torino senza cartella): 23 moduli, presi
solo i giorni dal 1° novembre. 13 richieste «inviate» (origine modulo cartaceo) per 61 giornate,
ore = ore settimanali (paghe, altrimenti anagrafica) / 5. Valmontone (Nunziante, Cacciotti,
Talone) aveva scritto «Ferie» senza quantità: contate come giornate intere. Piantoni, Rachele,
Maggiori avevano anche le ore accanto alla giornata: contate giornate intere. Oltre il «da fruire»
a fine anno: Pampaloni (12 h su 2,4), Suzzi (7 su 2,8), Nunziante e Talone (30 su 28,9). Il modulo
«ASUTI» di Palmanova porta il nome di Shafiei in testa e di Astuti in ottobre, ed e' vuoto.
Da questa data i piani dei turni (mese e settimana) contano anche le richieste in attesa.

## Regole per negozio: chi approva e quando si può chiedere (scheda 9, 12/11/2026)

Decisione di Patrizio del 12/11/2026. Migration `20261112_407` (NZ e Zago), libreria `src/lib/ferieRegole.ts`, scheda 9 «Ferie e permessi» di «Regole e orari» (`src/components/FeriePermessiNegozio.tsx`).

- **La richiesta parte dall'app** e arriva alla referente del negozio e all'HR. Per negozio si sceglie chi approva ferie, permessi ed eccezioni (referente, HR, o una qualsiasi delle due: `outlet_leave_rules`). Riga assente o colonne NULL = come prima della 407.
- **Quando si possono chiedere**: feriali, sabato e domenica, festivi e giorni speciali, più una riga per evento con ferie e permessi separati (`outlet_events.regole.ferie` e `.permessi`; `blocca_ferie` resta vero solo se sono spenti tutti e due). La voce scritta sull'evento vale più delle righe dei giorni. Un evento di prima senza le due voci continua a bloccare tutte e due, con il messaggio di sempre.
- **Eccezione**: dove un giorno è spento la richiesta dall'app è rifiutata con il motivo; se il negozio ha scritto chi approva le eccezioni, l'app offre «Chiedi come eccezione» (il giorno parte con `"eccezione": true`, la richiesta porta `leave_requests.eccezione` e `eccezione_motivo`). La decide solo chi è nella riga «Eccezioni». Il controllo sta in `ferie_blocco_giorno` e in `leave_decidi` (`ferie_controlla_lato`), non nell'interfaccia.
- **Chi è HR**: `leave_hr`, un elenco per azienda (più persone ammesse) che **solo il Super Advisor** può cambiare (policy RLS di INSERT e DELETE; nessun UPDATE). Non è un profilo nuovo: chi è HR tiene il suo. Finché l'elenco è vuoto, dal lato HR approva chi approvava prima. **Essere in elenco basta per decidere le richieste** (Patrizio, 12/11/2026): la 407 aggiunge l'elenco a `posso_decidere_ferie()`, che prima lasciava passare solo Super Advisor, COO, contabile e «Referenti ferie». Vale per i profili che entrano nel gestionale: mai per `dipendente` e `operatore_cassa`, e la `responsabile` resta nel recinto dei suoi negozi (`ferie_responsabile_puo`). L'elenco dà solo questo: `posso_decidere_ferie()` la usano le funzioni delle ferie (`leave_decidi`, `leave_controproponi`, `leave_rispondi_controproposta`, `ferie_richieste_prova`), nessuna policy e nessuna vista. Il rollback rimette la funzione com'era.
- **La referente** è il profilo `responsabile` scelto in «Chi conferma» (`attendance_confermatori`), come prima.
- **Una sola approvazione, sempre** (Patrizio, 12/11/2026: «se un responsabile approva una ferie o un permesso, lo approva solo una persona, punto. Non c'è bisogno di due»): ferie, permessi, eccezioni, dalle timbrature o dal gestionale, chi è autorizzato approva da solo, sotto la sua responsabilità, e ne resta il registro (`leave_request_events`: chi, quando, cosa). Niente doppia approvazione, da nessuna parte. Ogni cambio di stato lo scrive il trigger della 251 (utente e ora), `leave_decidi` aggiunge la riga `decisione` con nome e giorni concessi, la controproposta accettata o rifiutata ha le sue righe, `presenze_crea_permesso` la sua. La prima versione della 407 prevedeva «servono entrambe» (colonne `*_entrambe`, `prima_decisione`, `ferie_doppia_approvazione`): tolta prima di applicarla, non esiste in nessun database.
- **Si decide a scala, mai la propria** (Patrizio, 12/11/2026: «Un dipendente le ferie da solo non se le approva. Il dipendente sta sotto a un responsabile, il responsabile sta sotto all'HR e tutti gli HR stanno sotto ai super admin»). `ferie_motivo_no(request)` dà il motivo del no, `ferie_lato_puo` e `ferie_controlla_lato` la usano (quindi `leave_decidi`, `leave_controproponi`, `leave_rispondi_controproposta` per accettazione e rifiuto, e il campo `posso` della pagina Responsabile). In ordine: (a) nessuno decide la propria richiesta, Super Advisor compreso (la persona si riconosce come in `presenze_sono_io`: `employees.user_id` e `responsabile_dipendente`); (b) la richiesta di chi approva come HR (in `leave_hr`, in `leave_approvers`, oppure contabile, COO, Super Advisor con una scheda dipendente) la decide solo il Super Advisor; (c) la richiesta di una responsabile o vice (`outlets.referente_employee_id`, `vice_referente_employee_id`, o profilo `responsabile`) la decide l'HR o il Super Advisor, mai un'altra responsabile, anche dove il negozio ha scelto «solo la referente»; (d) **chi sta sopra può sempre decidere** (Patrizio, 12/11/2026: «il profilo più basso, qualsiasi profilo sopra può approvare; non è detto debba essere obbligatoriamente la responsabile: se non c'è o non può, per una dipendente può accedere qualsiasi persona sopra»): HR e Super Advisor decidono le richieste di dipendenti e responsabili qualunque sia la scelta «chi approva» del negozio; la scelta del negozio toglie qualcuno in un caso solo, con «solo HR» la referente non decide; lo stesso livello non decide lo stesso livello. La scala vale in ogni negozio, anche senza scheda salvata. La parte comune è `ferie_motivo_scala(employee, company)`; `ferie_controlla_scala(employee)` la applica anche alle **presenze**: la 407 aggiunge la chiamata in `presenze_decidi_evento` (sostituzione di testo con ancora unica, il rollback la toglie), quindi la presenza di una responsabile la conferma l'HR o il Super Advisor e quella di una persona HR solo il Super Advisor. Con un elenco HR non vuoto, contabile e COO fuori elenco non decidono le ferie (com'era). Limite: con un solo Super Advisor che ha anche una scheda dipendente, la sua richiesta non la può decidere nessuno (misura del 12/11/2026 su NZ e Zago: nessuno di chi oggi può approvare ha una scheda dipendente collegata, e nessuna richiesta esistente è stata decisa dalla persona stessa: 0 su 5 a NZ, 0 su 0 a Zago). Per la propria presenza c'era già `presenze_non_su_di_me` (373).
- **Il registro non si ritocca**: `trg_leave_request_events_fermo` (407) blocca insert, update e delete su `leave_request_events` per chi scrive dalla tabella con il proprio profilo (la policy `leave_request_events_write` della 251 lo lasciava fare a Super Advisor, contabile e COO; il gestionale non l'ha mai usata). Scrivono solo il trigger di traccia e le funzioni delle ferie. Passa la cancellazione a cascata quando si cancella una bozza. Tolto anche il TRUNCATE ad `authenticated` e `anon`. Il rifiuto di una controproposta controlla chi può decidere, come l'accettazione.
- **Lunedì**: responsabile e vice mai assenti insieme vale anche con responsabile e vice provvisorie (`guida_negozio_effettiva`: più ore di contratto, poi anzianità), solo nei negozi con giorni caldi o riposi minimi accesi.
- **Cosa non cambia**: i negozi che non hanno salvato la scheda si comportano esattamente come prima; nessuna richiesta esistente cambia stato; le richieste inserite dall'ufficio nel gestionale non passano dalle regole dei giorni.
- Le quattro funzioni vive (`app_dipendente_chiedi_ferie`, `app_dipendente_ferie`, `leave_decidi`, `responsabile_ferie_elenco`) sono modificate per sostituzione di testo sulla definizione viva: il rollback le riporta identiche a prima.

### Revisione del 12/11/2026 (dopo i tre revisori)

- **Eventi salvati prima della 407 con una sola voce spenta** (`blocca_ferie = true`, voci diverse): bloccavano tutte e due. La 407 li porta a tutte e due spente e tiene il valore di prima in `regole.prima_407`; tornano a decidere da soli quando vengono risalvati (la chiave sparisce). Il frontend, dove la 407 non c'è (prima dell'aggiornamento e su Made), scrive `blocca_ferie = !(ferie && permessi)` come prima (`bloccaFerieEvento`).
- **Giorno speciale singolo** senza voci sue: segue la riga «Festivi e giorni speciali» della scheda; nei negozi senza scheda blocca come ha sempre fatto.
- **Richiesta senza giudice**: se per le regole né la referente né l'HR potrebbero decidere (ferie e permessi insieme con lati diversi, eccezioni spente dopo), può decidere una qualsiasi delle due. Una riga con ferie o permessi senza nessun lato non si salva (vincolo sulla tabella).
- **Scritture dirette** (`trg_leave_requests_campi_protetti`): `eccezione`, `eccezione_motivo` e i passaggi di stato che decidono si scrivono solo dalle funzioni delle ferie. Dalla tabella restano i passaggi che il gestionale fa già: nascita in `bozza` o `inviata`, `bozza` ↔ `inviata`, e `ritirata` da qualunque stato (scheda Richieste: **punto aperto**, oggi si ritira direttamente anche una richiesta approvata).
- **Lunedì con la guida provvisoria**: il messaggio non dice «è già assente l'altra» (`ferie_lunedi_provvisoria`).
- **Rollback**: copia prima `outlet_leave_rules`, `leave_hr` e le due colonne in tabelle `_bkp_407_*` senza GRANT; riporta gli eventi allineati alle voci di prima e mette `blocca_ferie = true` agli eventi salvati dopo la 407 con una sola voce spenta (col codice di prima non bloccherebbero più niente).
- **Giorni protetti come le richieste**: `trg_leave_request_days_campi_protetti` (407) ferma le scritture dirette su `leave_request_days`: un giorno nasce solo «richiesto» e solo su una richiesta in bozza o inviata; stato e richiesta di appartenenza non si cambiano; su una richiesta decisa non si toccano ore, voce, data e tipo, e non si cancella. Le funzioni del database passano (stesso criterio su `current_user` del trigger sulle richieste).
- **Negozio e persona fermi fuori dalla bozza** (terzo giro, 12/11/2026): `outlet_code`, `employee_id` e `company_id` non si cambiano dalla tabella su una richiesta che non è in bozza (decidono chi approva). Per cambiarla si ritira e si rifà. La scheda Richieste modifica solo le bozze, quindi non è toccata.
- **Ritiro da qualunque stato**: `ritirata` resta ammesso dalla tabella anche su una richiesta approvata, per chi ha la scrittura diretta (Super Advisor, contabile, COO). Non concede niente, libera solo il saldo: è voluto, e va tenuto presente.
- **Permessi nati dalle presenze** (`presenze_crea_permesso`, migration 373): nascono già approvati con la conferma di chi controlla le presenze, senza passare dalle regole dei giorni della scheda 9: registrano un fatto già avvenuto. Una sola approvazione come tutto il resto (Patrizio, 12/11/2026), con la riga `decisione` nel registro.
- **Da decidere (Patrizio)**: chi può cambiare «Chi approva» nella scheda (oggi chi può scrivere l'organico, `organico_puo_scrivere()`).

## mittente e risposte delle mail sulle ferie (12/11/2026)
Pacchetto privacy: le mail di `leave-notify` partivano da «New Zago <distinte@rispondi.ai>» (dominio del marchio Rispondi.ai). Patrizio: mittente newzago@vicolo.com.
- `leave-notify` (versione 2 su NZ e Zago) legge due secret facoltativi per azienda: `LEAVE_EMAIL_FROM` (mittente, al posto di `DISTINTA_EMAIL_FROM`) e `LEAVE_EMAIL_REPLY_TO` (indirizzo delle risposte). Senza secret resta tutto come prima.
- `LEAVE_EMAIL_FROM` con un indirizzo @vicolo.com funziona solo dopo aver verificato il dominio vicolo.com in Resend (record DNS); altrimenti Resend rifiuta e la mail risulta «failed» (la richiesta di ferie vale lo stesso).
- Impostato da Patrizio il 12/11/2026 su NZ: `LEAVE_EMAIL_FROM` = «New Zago <newzago@rispondi.ai>» (dominio rispondi.ai già verificato in Resend, dati in Irlanda) e `LEAVE_EMAIL_REPLY_TO` = newzago@vicolo.com. Su Zago nessun secret: mittente di prima.

## Ferie e permessi in linea con il mese (14/11/2026, migration 411)

Patrizio, 14/11/2026: «la regola è far stare ferie e permessi in linea con il mese, cioè se devo consumare ferie e permessi li consumo che tanto ogni mese vado a riaccumularli, ma quando arrivo lì poi posso approvarli o cancellarli o spostarli e lui ricalcola tutto, sia i residui che le ore. La regola è che l'HR richiede il piano ma se lo modifica cancellando e spostando il sistema ricalcola tutto il mese se necessario. Inoltre ferie e permessi deve anche guardare nella sezione che arriva dall'app.» Ha rifiutato una soglia da scegliere per negozio: «questo lo rende manuale».

### Cosa fa
Quando l'HR crea il piano del mese «con ferie e permessi» il sistema propone da solo, per ogni persona, ferie e permessi pari a quello che matura in quel mese. Niente da impostare.

- **Il maturato non si calcola, si legge**: è `leave_accrual_rows.rateo_annuo` dell'ultimo tabulato attivo, diviso dodici (`maturatoDelMese`). Misurato sul tabulato di ottobre 2026 (NZ, 101 righe): la colonna «da maturare» è `rateo × mesi che restano / 12` su 75 righe su 81; le altre 6 sono contratti che finiscono prima di dicembre. Il rateo c'è su 101 righe su 101.
- **Chi non ha una riga nel tabulato non riceve proposte** e il riquadro lo dice. Oggi a NZ sono 5 persone attive su 46: le tre assunte il 02/11/2026 a Roma Soratte (entreranno nel tabulato di novembre), una in Sede e una senza negozio. Il gestionale non inventa ratei: i coefficienti 4,325 / 0,8 / 0,7 restano dedotti e nel tabulato il rateo non è sempre ore × 4,325 (c'è 168 accanto a 173 per 40 ore). Usarli per chi è senza tabulato è una decisione di Patrizio, non presa.
- **Matura il mese** chi è in servizio almeno 15 giorni di calendario nel mese (`maturaIlMese`): è la regola dello studio già scritta in «Maturazione e anticipo», ancora da confermare.
- **Cosa c'è già**: dal maturato si tolgono le ore del mese già approvate e quelle chieste e in attesa, da qualunque strada arrivino (app, gestionale, moduli): sono tutte in `leave_requests`. Mai più di quello che la persona avrà a fine mese (`residuo` del tabulato più i mesi che maturano meno le ore dopo la data del saldo): chi è in anticipo non riceve proposte.
- **In giornate e ore** (`tagliaInGiorni`): le ferie a giornate intere (ore settimanali / 6 nei negozi, come `proponiFerie`), l'avanzo e i permessi a ore, a mezz'ore. Un permesso che in tutto non arriva a un'ora non si propone.
- **Dove** (`scegliGiorni`, `giornoPerProposta`): dopo oggi, feriali non festivi con meno ingressi MODA, una giornata per settimana se si può, mai due persone lo stesso giorno se c'è un'alternativa; mai nei giorni caldi, negli eventi, nei giorni speciali; solo dove `esitoRichiesta` (la scheda 9) li ammette; mai una giornata di lunedì a responsabile o vice; solo dove restano le persone minime delle fasce (almeno due); mai in una settimana che è già sotto le persone minime. Il permesso a ore va in un giorno in cui la persona ha un turno di almeno turno minimo più due ore.
- **Verifica sul motore** (`rifinisciProposte`): il mese si calcola senza e con le proposte; finché una settimana è peggio (ore sotto le persone minime, giorni con una persona sola, ore vuote, persone senza riposo) si toglie la proposta più pesante e si rimisura, al massimo sei volte. Quello che non si propone resta scritto con il motivo.

### Le proposte sono proposte
Stanno in `leave_requests` come **bozze** con `origine = 'piano_mese'` e `plan_id` (migration 411), una richiesta per persona e per giorno:
- non scalano il saldo (`v_leave_disponibilita` le conta a parte, `ore_in_bozza`);
- il dipendente non le vede (`app_dipendente_ferie` esclude le bozze); il trigger del lunedì non le guarda;
- nel piano del mese contano come assenza e si vedono con il bordo tratteggiato; nel piano settimanale contano come ferie in attesa (`PianoTurni`), così la proposta dei turni non ci mette nessuno;
- **Approva** = `ferie_proposta_approva(request, giorni)`: la bozza diventa inviata e la decide `leave_decidi`, quindi valgono chi può decidere, la scala (nessuno la propria, la responsabile dall'HR, l'HR dal Super Advisor) e la regola del lunedì. Se `leave_decidi` rifiuta la proposta resta in bozza;
- **Ritocchi dei revisori (14/11/2026)**: `ferie_proposta_approva(request, giorni, motivo)` rifiuta una proposta rimasta senza piano (`plan_id` NULL: «toglila o rifai il piano») e l'approvazione di una parte sola dei giorni senza un motivo vero per quelli scartati (il motivo finisce nel registro; l'interfaccia oggi approva sempre la proposta intera). La 411 toglie il vecchio vincolo su `origine` cercandolo per quello che controlla, non per nome. «Togli piano» toglie prima le proposte e poi i turni: se le proposte non si tolgono il piano resta intero. Dopo «Sposta» e «Togli» il messaggio dice sempre se i turni sono stati rifatti (`messaggioDopoModifica` in `ferieInLinea.ts`). Letto sui database vivi di NZ e Zago il 14/11/2026: il vincolo si chiama `leave_requests_origine_check` in tutti e due; `leave_decidi` contiene `ferie_controlla_lato` (stesso testo sui due); il lunedì di responsabile e vice lo controllano i trigger `trg_leave_request_days_lunedi_ins/_upd`, non `leave_decidi`; `app_dipendente_ferie` esclude le bozze (`q.stato <> 'bozza'`); `v_leave_disponibilita` conta le bozze a parte (`ore_in_bozza`) e non le toglie dal residuo.
- **Sposta** e **togli** passano da `ferie_proposta_sposta(request, data)` e `ferie_proposta_togli(request)` (411; Patrizio, 16/11/2026: «anche la HR può spostare»): valgono per chi può decidere le ferie (`posso_decidere_ferie()`: Super Advisor, contabile, COO, «Referenti ferie» ed elenco HR, anche con un profilo di sola lettura; mai responsabile di negozio, dipendente, operatore di cassa o chi non ha un profilo), con la scala (`ferie_controlla_scala`: nessuno la propria, quella di una persona HR solo il Super Advisor). Toccano solo bozze con `origine = 'piano_mese'`: una richiesta vera non si sposta e non si cancella da lì. Il giorno nuovo lo valida il database: mese del piano, dopo oggi, negozio aperto, mai sabato, domenica, festivo o evento, `ferie_blocco_giorno`, mai una giornata di lunedì a responsabile e vice, nessun'altra assenza, e per una giornata nessun turno a mano o pubblicato; lo spostamento lascia una riga `proposta_spostata` nel registro. Togliere vale anche per una proposta rimasta senza piano. La responsabile di negozio resta fuori (non vede il piano del mese). Dove le funzioni mancano il frontend torna alle scritture dirette (`ferieInLineaDb.ts`);
- **I turni dopo la modifica** li scrive `turni_proposti_riscrivi(plan, date, turni, riepilogo)` (411): il conto resta della pagina (motore dei turni), la funzione toglie i turni di prima e scrive i nuovi in una sola transazione, così non resta mai un mese a metà, e lo può fare anche l'HR che i turni non li scrive. È stretta: la chiama chi gestisce i turni o chi decide le ferie; tocca solo i turni `origine = 'proposta'`, `stato = 'bozza'` di quel piano nelle date indicate (tutte nel mese del piano); mai una simulazione, mai un mese chiuso, mai sopra un turno a mano o pubblicato; ogni turno nuovo è di una persona in servizio in quel negozio quel giorno, sulle mezz'ore, dentro l'orario di apertura, uno per persona e per giorno (i controlli per intero sono al punto «Rilettura di sicurezza» qui sotto); i turni della persona di prova non si toccano. Nasce tutto in bozza: nell'app non arriva niente finché non si pubblica. Se la funzione rifiuta un elenco, chi scrive i turni torna alle scritture dirette; chi non li scrive vede il motivo;
- togliendo il piano le sue bozze spariscono; le proposte già approvate sono richieste vere e restano (con `plan_id` vuoto).
- **Rilettura di sicurezza (16/11/2026), chiusa dentro la 411**:
  - *chi resta fuori*: `responsabile`, `dipendente`, `operatore_cassa` e chi non ha un profilo sono rifiutati da sposta, togli e riscrittura dei turni anche se compaiono fra i «Referenti ferie» (`leave_approvers`, che dalla 252 fa passare `posso_decidere_ferie()` a qualunque profilo); `ferie_proposta_approva` rifiuta dipendente, operatore di cassa e senza profilo, e tiene la responsabile nel suo recinto (`ferie_responsabile_puo` della 378: i negozi di cui conferma le presenze) anche quando è fra i Referenti. Letto il 16/11/2026: `leave_approvers` è vuota su NZ e su Zago, quindi la strada non era ancora percorribile;
  - *chi non gestisce i turni* (HR con un profilo che i turni non li scrive) li fa rifare solo da oggi in poi, mai con un elenco vuoto e mai lasciando senza turni un giorno che ne aveva (il database rifiuta e rimanda a chi gestisce i turni): non può svuotare un mese, nemmeno in parte. I turni che riscrive nascono **senza straordinario** (lo forza il database): lo rimette chi gestisce i turni con «Ricalcola il mese». In un mese chiuso una proposta non si toglie più, come non si sposta. La pagina gli passa solo i giorni da oggi (`ricalcola` in `PianiMensili.tsx`);
  - *il riepilogo del piano* lo scrive solo chi gestisce i turni (che lo scrive già dalla tabella). Per l'HR resta quello di prima con `daRicalcolare: true`: la pagina lo dice sotto il nome del piano e il segnale sparisce al primo «Ricalcola il mese» di chi gestisce i turni. Scelta fatta perché è la più semplice e sicura: i numeri che l'HR legge per scegliere il piano non li decide chi chiama la funzione;
  - *ogni turno nuovo* è controllato dal database: persona in servizio in quel negozio quel giorno (`turni_persona_in_servizio`, la stessa regola di `personaAllaData` in `organico.ts`: **chi cambia l'una cambia l'altra**), nessuna giornata di ferie o permesso già approvata (salvo nel calendario «senza ferie»), presenza non sotto il turno minimo e ore lavorate non sopra il turno massimo del negozio (`outlet_shift_rules`, 4 e 10 se mancano), straordinario mai oltre le ore lavorate, orario di apertura anche nei giorni di evento (vale l'orario del periodo speciale, chiavi `apre` e `chiude` di `outlet_events.regole`, solo se ne ha uno suo), mai sopra un turno pubblicato di qualunque piano vero o a mano di questo piano o senza piano;
  - *registro* `turni_piano_registro` (411): una riga per ogni riscrittura dei turni (chi, piano, dal, al, quanti tolti e scritti, se gestisce i turni) e una per ogni proposta tolta (chi, persona, giorni, voci, ore), perché gli eventi della bozza spariscono a cascata con lei. La scrivono solo le funzioni; dall'API la legge chi gestisce i turni, non la scrive nessuno. Il rollback non la cancella: la rinomina `_bkp_411_turni_piano_registro`. **Cosa non contiene**: i turni scritti o tolti uno per uno (solo i conteggi e l'intervallo di date) e nessuna chiave verso piano, proposta o persona, così la riga resta anche quando quelli spariscono; per sapere quali turni c'erano bisogna guardare `shifts`. Niente stipendi né dati di salute: solo ferie e permessi proposti;
  - *sposta* rifiuta una proposta che copre giorni diversi (più voci nello stesso giorno sono ammesse: ferie e permesso insieme).

### Il ricalcolo
`ricalcola` in `PianiMensili.tsx`: dopo uno spostamento, una cancellazione, o una ferie messa o tolta dalla finestra del turno, si rifanno i turni delle settimane toccate; «Ricalcola il mese» li rifà tutti. Si sostituiscono **solo** i turni `origine = 'proposta'` e `stato = 'bozza'` del piano: quelli messi a mano e quelli pubblicati restano fermi ed entrano nel conto come ore già fatte (per il motore sono come una trasferta della persona più una presenza in negozio). Mai su un mese chiuso. Il riepilogo del piano si riscrive. I residui e le ore del riquadro sono sempre calcolati dal vivo (`quadroPersona`).

### Misura del 14/11/2026 (dati veri di NZ, novembre dal 15 e dicembre 2026)
Stesso mese senza e con le proposte; in entrambi contano le richieste approvate e in attesa. Traffico in media per giorno della settimana.

| Negozio | Mese | Ore proposte (giornate) | Non proposte | Sotto MODA | Straordinario | Ore da assegnare |
|---|---|---|---|---|---|---|
| Barberino | nov | 14,83 (1) | 5,83 | 43,70 → 48,58 | 0 → 1,33 | 6,85 → 0,51 |
| Barberino | dic | 29,16 (4) | 18,33 | 0,96 → 1,38 | 0 = | 49,84 → 25,01 |
| Brugnato | nov | 20 (4) | 15,17 | 46,82 = | 12 → 31,5 | 3 → 0 |
| Brugnato | dic | 15 (3) | 12,5 | 80,73 = | 0,35 → 0 | 0 = |
| Franciacorta | nov | 32,33 (4) | 0 | 6,13 → 6,11 | 0 = | 70,83 → 42,5 |
| Franciacorta | dic | 25,83 (4) | 10,67 | 16,64 → 13,64 | 0 = | 18,83 → 3,5 |
| Palmanova | nov | 31 (4) | 12 | 5,39 = | 0 → 2 | 44,5 → 21,5 |
| Palmanova | dic | 29,5 (4) | 22 | 0 = | 0 = | 55,5 → 25,5 |
| Torino | nov | 58 (8) | 0 | 2,56 → 5,81 | 0 → 0,5 | 93 → 48,5 |
| Torino | dic | 58 (8) | 0 | 2,09 = | 0 = | 84 → 33,17 |
| Valdichiana | nov | 76,16 (10) | 0 | 3,29 → 12,10 | 0 → 2,33 | 82 → 40,67 |
| Valdichiana | dic | 76,16 (10) | 0 | 6,95 → 18,48 | 0 = | 61,17 → 4,51 |
| Valmontone | nov | 20,5 (2) | 10 | 51,97 → 60,42 | 0 = | 9,5 → 3,5 |
| Valmontone | dic | 64 (10) | 0 | 5,79 → 16,25 | 0 = | 45 → 6,99 |
| Roma Soratte | nov | 16,84 (2) | 0 | 4,56 → 4,74 | 107,83 → 121,17 | 0 = |
| Roma Soratte | dic | 16,84 (2) | 0 | 9,64 → 9,55 | 94,17 → 105,84 | 0 = |

In tutti i sedici casi: ore sotto le persone minime non peggiorate, giorni con una persona sola invariati, nessuno 7 su 7. Dove il negozio ha ore di contratto non usate le proposte le assorbono (Torino 93 → 48,5). **Dove non ne ha, le proposte si pagano in straordinario**: Roma Soratte +13,3 ore a novembre e +11,7 a dicembre per le sole 16,84 ore della responsabile (le altre tre non sono ancora nel tabulato); Brugnato +19,5 ore a novembre. Il riquadro lo scrive in giallo. Se va bene così lo decide Patrizio.

### Limiti dichiarati
- Far nascere le proposte (creare il piano) e toglierle tutte con «Togli piano» resta di chi gestisce i turni. Approvare, spostare e togliere una proposta lo fa chiunque possa decidere le ferie, anche un HR in elenco con profilo di sola lettura (16/11/2026).
- Un piano creato prima della 411 non ha proposte: nascono alla creazione del piano. Per averle si toglie e si rifà.
- Il ricalcolo di una settimana rifà il conto di tutto il mese e ne prende solo quella settimana: il riepilogo del piano dopo un ricalcolo parziale descrive il mese ricalcolato, non i turni rimasti fermi nelle altre settimane se erano stati cambiati a mano.
- «Togli piano» cancella anche i turni messi a mano del piano (regola del 21/10/2026, con conferma): non esiste un registro delle cancellazioni dei turni.
