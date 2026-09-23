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

### Le cessazioni le porta il documento (23/09/2026)

Il tabulato scrive la data di cessazione accanto al nome. Fino al 23/09 il lettore la salvava in
`leave_accrual_rows.data_cessazione` e nessuno la usava: Bularca (cessata il 30/06) e Niccoli
(30/07) risultavano ancora in forza, e lo abbiamo scoperto **chiedendolo allo studio paghe**, cioe'
chiedendo fuori una cosa che era gia' dentro. Ora il salvataggio dell'import allinea l'anagrafica,
e l'anteprima dice prima chi sta per essere segnato cessato. Scrive **solo dove manca**: una data
messa a mano non si tocca.

### Le matricole non si possono allineare, e va bene cosi'

Francesca Signorini (studio paghe), 23/09/2026: le matricole sono **automatiche e cronologiche** in
base alla data di assunzione, e lei non puo' modificarle. Un secondo rapporto di lavoro prende una
matricola nuova: Sestini era 0000087 col contratto a chiamata (03/06–19/06) e 0000092 col
determinato part time dal 22/06. Sono questi i 5 nominativi su 42 che non tornavano per matricola.
Conseguenza: l'aggancio per **nome + matricola o data di assunzione** non e' un ripiego, e' la sola
strada possibile; `employee_matricole` tiene lo storico, cosi' i dati vecchi restano agganciati.
Correzioni applicate con `NZ_ONLY_20260923_253_anagrafica_da_studio_paghe.sql` (solo NZ).

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
2. **Accesso dei dipendenti**: il ruolo esiste ed e' blindato, ma nessuno lo usa ancora. Serve
   decidere come si danno gli accessi (una casella a testa, una per punto vendita, un link
   personale) e collegare l'utente alla sua scheda dipendente.
3. **Fase 4**: il file di ritorno alle paghe con le ferie godute.
4. **Coefficienti**: 4,325 / 0,8 / 0,7 restano dedotti finché lo studio non li conferma.
