# testi per gli store: app New Zago

Bozza dell'11/11/2026 per Play Console (Google) e App Store Connect (Apple).
App: «New Zago», `it.eppi.newzago`, sviluppatore EPPI S.r.l. I punti segnati
**[da completare]** dipendono da documenti che non abbiamo ancora (informativa
privacy di Lilian, indirizzo di assistenza).

## distribuzione consigliata
È un'app solo per chi lavora nei negozi New Zago: senza codice di attivazione non fa niente.
- **Apple**: chiedere la distribuzione **non in elenco** (Unlisted App). L'app non si trova nelle ricerche e si installa dal link. Si chiede con il modulo di Apple dopo la prima approvazione.
- **Google**: pubblicare in **test chiuso** con l'elenco «New Zago Tester» (indirizzi dei dipendenti), oppure in produzione con la scheda pubblica ma senza pubblicità. Il test chiuso evita di dover presentare l'app al pubblico.

## nome e frasi brevi
| Campo | Limite | Testo |
|---|---|---|
| Nome (Apple e Google) | 30 | New Zago |
| Sottotitolo (Apple) | 30 | Presenze, turni e ferie |
| Descrizione breve (Google) | 80 | L'app di chi lavora nei negozi New Zago: presenze, turni, ferie e ore. |
| Testo promozionale (Apple) | 170 | Timbri l'entrata con il QR, vedi i turni della settimana e chiedi ferie e permessi dal telefono. Per i dipendenti dei negozi New Zago. |
| Parole chiave (Apple) | 100 | presenze,timbratura,turni,ferie,permessi,ore,negozio,dipendenti,cartellino,QR |
| Categoria | | Business (Apple); Business (Google) |
| Età | | 4+ (Apple); «Tutti» (Google), nessun contenuto sensibile |

## descrizione completa (Apple e Google)
New Zago è l'app di chi lavora nei negozi New Zago. Si attiva con il codice di 8 caratteri che dà chi segue il personale e da quel momento vale solo su quel telefono.

Oggi
- Il QR personale per timbrare entrata, pausa e uscita sul telefono del negozio. Il QR cambia ogni 30 secondi e funziona anche senza rete.
- La giornata di oggi: turno, timbrature e pausa.
- Se un'entrata o un'uscita non risulta, l'app lo dice e permette di segnare l'ora, che poi conferma il responsabile.
- Ritardi, uscite prima del turno e straordinari: scrivi il motivo e vedi la decisione del responsabile.

Turni
- I turni della settimana e di quelle dopo.

Ferie e permessi
- I saldi di ferie e permessi, in ore.
- Le richieste, anche di mezza giornata, e la loro risposta.

Le mie ore
- Le ore lavorate del mese a confronto con quelle previste dai turni.

Avvisi
- Una notifica quando l'entrata è in ritardo o l'uscita non è stata timbrata, anche ad app chiusa.

L'app non usa la posizione e non contiene pubblicità. Serve un codice di attivazione: chi non lavora in New Zago non può usarla.

## note per la revisione (Apple: App Review Information; Google: Accesso alle app)
Testo da incollare:

> L'app è riservata ai dipendenti dei negozi New Zago (EPPI S.r.l.) e si attiva con un codice di 8 caratteri rilasciato dall'ufficio del personale. Per la revisione è attivo un dipendente di prova: inserire il codice qui sotto nella schermata iniziale. Il codice resta valido fino al 10/01/2027 e può essere usato più volte, anche su più telefoni. La timbratura vera avviene inquadrando il QR dell'app con il telefono del negozio, che non fa parte di questa app: nella revisione si possono vedere tutte le schede (Oggi, Turni, Ferie, Ore) con dati di prova.

Codice per i revisori: c'è (migration 396), 8 caratteri, valido fino al 10/01/2027 e riusabile su più telefoni insieme. **Non si scrive in questo file** (il repository è pubblico): si copia dalla chat o lo si rigenera. Apple non vuole né nome utente né password: basta il codice, nel campo «Note».

## privacy
- Informativa privacy (URL obbligatorio in tutti e due gli store): **[da completare]**, la prepara Lilian. Va pubblicata a un indirizzo web stabile (per esempio una pagina del sito EPPI o New Zago).
- Assistenza tecnica dell'app: **info@eppiflorence.it** (EPPI, che pubblica l'app; Patrizio, 11/11/2026). Google chiede una mail: questa. Apple chiede un **indirizzo web** di assistenza: **https://gestionale-nz.netlify.app/assistenza/** (file `public/assistenza/index.html`, con contatto e domande frequenti). L'informativa privacy di Lilian andrà sulla stessa pagina.

### Google: Sicurezza dei dati
| Domanda | Risposta |
|---|---|
| L'app raccoglie o condivide dati? | Sì, raccoglie; non condivide con terzi |
| Dati crittografati in transito | Sì |
| Si possono chiedere la cancellazione | Sì, all'ufficio del personale (o all'indirizzo dell'informativa) |
| Informazioni personali | Nome; ID utente (identificativo del dipendente) |
| Altri dati | Orari di lavoro: timbrature, turni, ferie e permessi (dati richiesti dal rapporto di lavoro) |
| ID dispositivo o altri ID | Sì: il codice per le notifiche del telefono |
| Posizione, contatti, foto, file | No |
| Scopo | Funzionalità dell'app; gestione dell'account. Nessuna pubblicità, nessuna analisi di marketing |
| Raccolta facoltativa? | No, serve per usare l'app |

### Apple: Privacy dell'app
- Dati collegati all'utente: **Informazioni di contatto → Nome**; **Identificativi → ID utente**, **ID dispositivo** (codice delle notifiche); **Altri dati** (presenze e turni).
- Uso: «Funzionalità dell'app». Nessun tracciamento, nessuna pubblicità.
- Domanda «Tracciamento»: No.

## schermate
- **Apple**: iPhone 6,9" (1320 × 2868) obbligatorie, da 3 a 10. iPad non serve se l'app è solo per iPhone.
- **Google**: almeno 2 schermate del telefono (lato corto almeno 320 px), più l'immagine in evidenza 1024 × 500.
- Quali: 1. Oggi con il QR; 2. Oggi con la giornata e la pausa; 3. Turni; 4. Ferie e permessi; 5. Le mie ore. Sempre con il dipendente di prova, mai dati veri.
