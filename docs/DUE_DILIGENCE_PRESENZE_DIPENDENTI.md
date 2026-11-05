# due diligence: app dei dipendenti per presenze, pause, ferie e permessi

Data: 5 novembre 2026 (ora di Roma). Tenant di riferimento: New Zago.
Richiesta: sostituire People Smart (Zucchetti) con una web app semplice, che funzioni anche senza internet e che dica dove si trova chi timbra.

> Il repository è pubblico: in questo documento non ci sono nomi di dipendenti, codici fiscali né le schermate originali. Le schermate restano fuori dal repo.

---

## 1. in breve

- **Il problema vero non è l'app, è la chiusura del mese.** Il foglio dello studio paghe allegato alle schermate lo dice chiaro: ore da far quadrare, straordinari e permessi non segnalati, presenze di Roma e Valmontone mancanti, chiamate (lavoro intermittente) registrate solo in parte, una visita medica da confermare. People Smart raccoglie timbrature, ma nessuno le confronta con il turno previsto e nessuno chiude il mese al posto delle persone.
- **Il gestionale ha già metà del lavoro.** Turni pubblicati (`shifts`), regole delle pause, straordinario per settimana, richieste e saldi ferie (`leave_*`), organico di oggi. Manca solo la parte «cosa è successo davvero»: la timbratura.
- **Raccomandazione: costruirla dentro il gestionale**, con un tablet economico in ogni negozio che fa da timbratrice e funziona offline, e una web app sul telefono del dipendente per vedere il turno, timbrare e chiedere ferie e permessi. Niente GPS come prova principale, niente biometria.
- **Costi:** 9 tablet (8 negozi più la sede), circa 1.500-2.500 € una tantum; infrastruttura già pagata (Supabase e Netlify); sviluppo interno. Un SaaS costerebbe 5.400-14.400 € in 3 anni più l'integrazione con i turni, che resta comunque da fare.

---

## 2. cosa fa oggi People Smart (dalle 8 schermate) e dove si inceppa

| Schermata | Cosa fa | Dove si inceppa |
|---|---|---|
| Home | Saluto, orario del giorno (09:00/13:00), riquadro timbrature con «+», riquadro giustificativi con «+», tre scorciatoie, un altro «+» arancione in basso, contatore anomalie | Tre pulsanti «+» per cose diverse nella stessa pagina. L'azione che si fa due volte al giorno (timbrare) pesa quanto quella che si fa due volte al mese |
| Timbratura | Prima chiede «Scegli il verso»: Entrata o Uscita. Poi apre la lettura NFC del telefono | **La pausa non esiste come scelta.** O si timbra uscita ed entrata, o non si timbra: infatti le pause non venivano timbrate fino al 18/10 (`ORGANICO_TURNI_NOTES.md`). Il verso lo deve indovinare la persona, mentre il sistema lo sa già (se sei dentro, esci) |
| Badge QR | Tesserino con nome, codice fiscale, azienda e un QR fisso «fai scansionare il tuo QR» | QR **statico**: basta una foto per farlo usare da un altro. Codice fiscale in chiaro sullo schermo, visibile a chiunque guardi il telefono |
| Inserimento giustificativo | Motivazione a tendina, allegato, Orario o Giornata intera, inizio e fine (proposti: ora attuale e un'ora dopo), note | Chi chiede non vede quante ore di ferie o permesso ha ancora. Le date proposte sono a caso rispetto al turno. Il pulsante di invio è un cerchio in fondo, parzialmente fuori schermo |
| Richieste personali | Elenco approvati e rifiutati | Solo storico, nessun saldo, nessuna data della decisione |
| Presenze e assenze | Settimana, chi è presente e chi è assente nel giorno scelto | È la vista utile al negozio, ma mostra solo i nomi: non dice chi è in pausa, chi è in ritardo rispetto al turno, chi manca |
| Menu | 10 voci (Agenda, Attività, Bacheca, Calendario, Spese e rimborsi, Orari/Turni, Richieste personali, Riepilogo, Rubrica, Richieste collaboratori) | Due voci grigie e inutilizzabili. Troppe porte per tre bisogni: timbrare, vedere il turno, chiedere un giorno |
| Foglio dello studio | Elenco straordinari per persona, presenze mancanti, chiamate non registrate | Il controllo lo fa una persona a mano, a fine mese, su carta |

**Lezione per il disegno:** il dipendente ha tre bisogni (timbrare, sapere quando lavora, chiedere ferie e permessi) e l'ufficio ne ha uno (un mese chiuso e giusto da mandare allo studio). Tutto il resto è rumore.

---

## 3. cosa c'è già nel gestionale (verificato su codice e database NZ)

**Persone e negozi** (database NZ, 05/11/2026): 45 persone attive. Barberino 4, Brugnato 5, Franciacorta 6, Palmanova 4, Roma Soratte 5, Sede/Magazzino 7, Torino 4, Valdichiana 5, Valmontone 5.

**Pronto e riusabile**
- **Turni**: `shifts` (inizio, fine, pausa_minuti, straordinario, ore_straordinario, stato bozza/pubblicato/annullato), piano del mese e della settimana, regole del negozio (`outlet_shift_rules`), orari (`outlet_opening_hours`). È il «previsto» contro cui confrontare il «timbrato».
- **Regole di calcolo** già scritte in `src/lib/turni.ts`: pausa non pagata (30' da 6 ore, un'ora da 8), pausa pranzo fra 13 e 15, straordinario contato per settimana, turno minimo 4 ore. Le stesse regole servono per leggere le timbrature.
- **Ferie e permessi**: `leave_requests` (stati inviata, approvata, respinta, ritirata…), `leave_request_days` in ore con voci F01 ferie, F02 ex festività, F03 ROL, saldi dal tabulato dello studio (`v_leave_balances`), referenti che approvano (`leave_approvers`). Nel database NZ ci sono già 15 richieste. Componenti `RichiesteFerie.tsx` e `ApprovazioniFerie.tsx`.
- **Organico di oggi** (`OrganicoOggi.tsx`), trasferte (`employee_trasferte`), accordi d'orario (`employee_availability`).
- **Ruolo `dipendente`** già nell'enum dei ruoli (migration 249), oggi bloccato su tutto da una policy restrittiva: pronto per essere aperto solo sulle righe della persona.

**Manca**
- Nessuna tabella di timbrature o presenze. Nessun import dei dati People Smart.
- Nessun collegamento fra dipendente e utente: `employees` non ha `user_id`; gli utenti con accesso sono 15 e nessuno è un dipendente di negozio.
- I negozi hanno indirizzo ma **nessuna coordinata**.
- Nessuna parte offline: niente service worker, manifest, IndexedDB.
- Oggi turni e ore lavorate non si confrontano mai (i cedolini non portano le ore).

**Decisione già presa da tenere presente:** per le ferie Patrizio aveva scelto **un accesso condiviso per negozio**, in cui chi propone sceglie il proprio nome (`PIANO_FERIE_NOTES.md`). Con le timbrature personali questa scelta va rivista (vedi decisioni al punto 9).

---

## 4. vincoli di legge

1. **Statuto dei lavoratori, art. 4, comma 2.** Gli strumenti di registrazione di accessi e presenze non richiedono accordo sindacale né autorizzazione dell'Ispettorato. Condizione: il sistema deve fare **solo** questo. Un tracciamento continuo della posizione lo farebbe uscire dal comma 2. Per usare i dati anche a fini disciplinari serve un'informativa adeguata (comma 3).
2. **Posizione dal telefono personale.** Il Garante (provv. 350/2016) ha ammesso la timbratura via app solo con posizione letta **al momento della timbratura**, coordinate cancellate dopo il confronto con la sede (resta «in sede sì/no», data e ora), nessun altro dato del telefono, informativa completa, alternativa al telefono personale. Nel 2025 (provv. 135) ha sanzionato con 50.000 € una geolocalizzazione «a campione»; un tribunale nel 2026 risulterebbe aver annullato quella sanzione (da verificare). Per noi: meglio non basare la prova sul GPS.
3. **Biometria: no.** Impronte e riconoscimento del volto per le presenze vengono sanzionati con costanza: nessuna norma li consente e il consenso del dipendente non basta.
4. **Libro unico del lavoro.** Presenze giorno per giorno (ore ordinarie, straordinarie, assenze, ferie, permessi), compilazione entro il 16 del mese dopo, conservazione 5 anni. Le timbrature non si cancellano: si correggono lasciando traccia.
5. **Da fare comunque, con qualunque strumento:** informativa ai dipendenti (art. 13 GDPR), voce nel registro dei trattamenti, una valutazione d'impatto (DPIA) se si usa la posizione. Lilian può seguire la parte legale.

Fonti principali: Garante, provv. 350/2016 (garanteprivacy.it, doc. 5497522); provv. 135/2025; INPS circ. 124/2009 sul LUL; Assolombarda su art. 4 L. 300/1970.

---

## 5. come verificare che la persona è davvero in negozio

| Metodo | Offline | iPhone | Android | Si può aggirare? | Privacy | Giudizio |
|---|---|---|---|---|---|---|
| GPS del telefono | Sì | Sì | Sì | Sì (posizione falsa) | Peso alto | Negli outlet village l'errore è di decine di metri e i negozi sono attaccati: non distingue il nostro dal vicino. Al massimo segnale di riserva |
| QR fisso stampato in negozio | Sì | Sì | Sì | Sì, basta una foto | Bassa | Debole |
| NFC (come oggi) | Sì | Solo con app nativa | Sì | Tag copiabile | Bassa | La web app su iPhone non legge l'NFC: scartato |
| Wi-Fi del negozio | No | Il browser non lo legge | No | | | Scartato |
| Beacon Bluetooth | | Il browser non lo supporta | | | | Scartato |
| **Tablet del negozio con codice che cambia** | **Sì** | **Sì** | **Sì** | Molto difficile | **Bassa** | **Consigliato** |

**Come funziona il tablet.** Un tablet Android economico fisso alla cassa o nel retro, legato a un solo negozio, sempre acceso in modalità chiosco. Il dipendente apre la web app sul suo telefono, che mostra un **QR che cambia ogni 30 secondi** (calcolato sul telefono anche senza rete, da un segreto personale). Il tablet lo legge con la fotocamera, riconosce la persona, mostra nome e turno di oggi e **un solo pulsante grande con l'azione giusta**: «Entra», poi «Inizio pausa», «Fine pausa», «Esci». Chi non ha lo smartphone usa un PIN personale sul tablet.

Perché il tablet risolve tutto insieme:
- **Il luogo è certo**: il tablet appartiene a quel negozio, nessun GPS, nessun dato di posizione da trattare.
- **Offline vero**: la timbratura resta salvata sul tablet (memoria del browser, firmata e numerata) e parte da sola quando torna la rete. Su Android il browser non ha i limiti di iPhone (che cancella i dati delle web app dopo 7 giorni di non uso e non sincronizza in sottofondo).
- **L'ora è affidabile**: la mette il tablet, che è nostro, non il telefono che il dipendente può spostare. A ogni contatto col server il tablet registra lo scarto d'orologio; scarti strani si segnalano.
- **Niente foto del badge**: il codice scade dopo 30 secondi.
- **Stesso gesto di oggi** (mostrare un QR), quindi niente da imparare, ma con la pausa finalmente prevista.

---

## 6. come deve essere l'app (semplice, intuibile, veloce)

**Sul tablet del negozio (timbratrice)**
- Schermo fisso: ora grande, nome del negozio, «Avvicina il telefono».
- Dopo la lettura: nome, turno di oggi, **un pulsante solo**, già quello giusto. Un secondo pulsante piccolo per i casi rari («Ho sbagliato», «Vado in trasferta»).
- In basso, sempre visibile: chi è dentro adesso, chi è in pausa, chi doveva arrivare e non c'è. È la vista «Presenze e assenze» di People Smart, ma confrontata con il turno.

**Sul telefono del dipendente (3 pagine, niente menu a tendina)**
1. **Oggi**: il mio turno, le mie timbrature di oggi, il QR per timbrare. Se manca un'uscita di ieri, una riga sola: «Ieri non risulta l'uscita: alle 19:00 come da turno?» con «Sì» e «No, alle…».
2. **I miei turni**: la settimana e la prossima, presi dal piano pubblicato.
3. **Ferie e permessi**: saldo in ore sempre visibile in alto («Ti restano 42 ore di ferie»), poi «Chiedi un giorno», «Chiedi delle ore», «Malattia o visita». Le date propongono il turno di quel giorno, non l'ora attuale. Lo stato della richiesta e chi l'ha decisa.

**Regole dal gestionale, senza chiedere niente in più** (regola «niente liste da compilare a mano»)
- Pausa minima, pausa pranzo, straordinario per settimana: si calcolano dalle timbrature con le regole che esistono già.
- Il sistema chiede solo ciò che non può sapere: un'uscita dimenticata, un ritardo senza giustificativo, uno straordinario non previsto dal turno.

**Nel gestionale (per HR e ufficio)**
- Presenze del giorno e del mese, negozio per negozio: previsto, timbrato, differenza.
- **Chiusura del mese per lo studio paghe**: una pagina che dice «settembre chiuso» o «mancano 3 cose: …», poi il file da mandare. È la risposta diretta al foglio dello studio.

---

## 7. funzionamento senza internet, nel dettaglio

- Il tablet tiene in memoria il turno della settimana e le persone del negozio (aggiornati ogni volta che c'è rete).
- Ogni timbratura viene salvata localmente con numero progressivo, ora del tablet, firma del tablet e codice del dipendente, poi messa in coda.
- La coda parte appena torna la rete e il server conferma riga per riga: niente doppioni anche se lo stesso invio arriva due volte.
- Il tablet mostra sempre lo stato: «Tutto inviato» oppure «3 timbrature in attesa, partono appena torna la rete». Vale la regola fissa del gestionale: chi fa un'operazione deve sapere che è finita.
- Il telefono del dipendente genera il QR anche offline; vede turni e saldo dell'ultima volta che era collegato, con la data dell'aggiornamento scritta.

---

## 8. confronto con le alternative in commercio

| Prodotto | Offline | Tablet chiosco / QR | Ferie | Prezzo indicativo (per persona al mese) |
|---|---|---|---|---|
| Jibble | Sì, anche gratis | Sì | Sì | Gratis; a pagamento circa 3-11 $ |
| Sesame HR | Da verificare | QR dinamico su tablet | Sì | Circa 3,75-5 € (da verificare) |
| Factorial | Da verificare | QR | Sì | Da circa 5-6 €, di fatto a preventivo |
| Deputy | Sì (chiosco) | Sì | Sì | 5-9 $ |
| Shiftbase | Da verificare | Sì | Sì | Per 50 persone circa 200-290 € al mese |
| Planday | Da verificare | Sì | Sì | 3-4,5 $ |
| Inaz, TeamSystem, Zucchetti | | | | Solo preventivo |

I prezzi vengono da aggregatori e vanno confermati.

**Limite comune:** nessuno conosce il piano turni del gestionale (fabbisogno da traffico MODA, due persone, pause, turno minimo). Con un SaaS i turni andrebbero mandati di là e le timbrature riportate di qua: due sistemi, due interfacce per i negozi, un'integrazione da mantenere. Se servisse un ponte immediato, Jibble gratuito copre timbratura offline e ferie con spesa zero, ma riprodurrebbe il problema di oggi: dati fuori dal gestionale.

**Stima su 3 anni, circa 50 persone**
- SaaS: 5.400-14.400 € di canoni, più tablet, più integrazione: **circa 10.000-20.000 €**.
- Dentro il gestionale: tablet 1.500-2.500 €, eventuale licenza chiosco per Android (pochi euro a tablet, da verificare), informativa e DPIA 1.000-2.000 € (servono anche col SaaS), sviluppo interno. Il costo vivo resta **sotto i 5.000 €**, il resto è tempo.
- Da recuperare: costo attuale di People Smart e data di scadenza del contratto Zucchetti (non li ho nei dati).

---

## 9. decisioni che servono a Patrizio

1. **Accesso individuale per ogni dipendente?** Per timbrare serve (la timbratura è personale). Cambia la scelta fatta per le ferie (accesso condiviso per negozio). Proposta: accesso individuale, primo ingresso con un codice dato dall'HR, poi il telefono resta collegato. Niente password da ricordare.
2. **Telefono personale o solo tablet?** Proposta: tutti e due. Il telefono è comodo ma non obbligatorio: chi non vuole usarlo timbra col PIN sul tablet (è anche quanto chiede il Garante).
3. **Acquisto di 9 tablet** (8 negozi più sede) e dove fissarli.
4. **Chi corregge** un'uscita dimenticata: il dipendente propone, il referente del negozio conferma (come per le ferie)?
5. **Lo studio paghe**: chiedere in che formato vuole le presenze (oggi le riceve dal file che prepara chi segue il personale). Se usa Zucchetti Paghe Infinity, probabilmente ha un tracciato d'importazione.
6. **Negozio pilota**: proposta Barberino (vicino a Firenze, 4 persone), con People Smart acceso in parallelo per 3-4 settimane, così si confrontano i numeri prima di spegnere qualcosa.

---

## 10. piano di lavoro proposto

| Fase | Cosa | Durata indicativa |
|---|---|---|
| 0 | Decisioni del punto 9, informativa e registro dei trattamenti (Lilian), formato dello studio | 1 settimana |
| 1 | Timbratrice su tablet: tabella delle timbrature (solo aggiunte, mai cancellazioni, correzioni con traccia), registrazione dei tablet, coda offline, QR che cambia, PIN. Vista presenze di oggi nel gestionale. Pilota a Barberino | 2-3 settimane |
| 2 | App del dipendente: oggi, turni, ferie e permessi (riusa le tabelle `leave_*` e i saldi dal tabulato). Accessi individuali col ruolo `dipendente` limitato alle proprie righe | 2 settimane |
| 3 | Confronto turno e timbrato, anomalie solo quando servono, chiusura del mese e file per lo studio | 2 settimane |
| 4 | Estensione agli altri negozi, un negozio a settimana, poi dismissione di People Smart | 1-2 mesi |

Note tecniche per lo sviluppo:
- Migration solo su NZ e Zago (regola del 03/11/2026); il frontend deve funzionare anche su Made dove le tabelle nuove non ci sono.
- Ogni tabella nuova con RLS, GRANT espliciti e policy con `(SELECT get_my_company_id())`.
- Le timbrature sono dato vivo dal primo giorno: si annullano con motivo, non si cancellano.
- Guida utente in `src/data/pageGuides.ts` per le pagine nuove.
- Da provare sul campo prima del via: lettura del QR con la fotocamera del tablet sotto le luci del negozio, durata della batteria, tempi di una timbratura (obiettivo: meno di 3 secondi).
