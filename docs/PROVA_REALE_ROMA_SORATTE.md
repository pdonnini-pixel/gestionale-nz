# prova reale delle presenze a Roma Soratte

Preparata il 09/11/2026. Negozio pilota: Roma Soratte (codice RSO). Orari in ora di Roma.

## com'è il negozio oggi (controllo del 09/11/2026)
- 5 dipendenti attivi, con responsabile del negozio.
- Timbrature accese, margine d'uscita 30 minuti. Avvisi sul telefono ancora spenti.
- Esiste l'account del telefono del negozio (ruolo operatore_cassa) con accesso a Roma.
- Piano turni di novembre scelto: 24 turni nella settimana 9-15/11.
- Nessuna timbratura e nessuna app attivata.

## prima della prova
1. **Informativa privacy per i dipendenti** (Lilian). Va consegnata prima che i dipendenti usino l'app: cosa si registra (ora e negozio di entrata, uscita e pause), chi lo vede, quanto si conserva. L'app non usa posizione né fotocamera del telefono personale.
2. **Turni della settimana di prova**: devono essere nel piano scelto del mese. Sono quelli che l'app mostra e quelli su cui si calcolano ritardi e uscite mancanti.
3. **Migration 370** applicata (il dipendente legge solo i suoi dati).

## lato negozio: il telefono aziendale
1. Sul telefono del negozio (Android, Wi-Fi del negozio) apri Chrome su `gestionale-nz.netlify.app/timbra`.
2. Entra con l'account del telefono del negozio (ruolo operatore_cassa).
3. Scegli **Roma Soratte**. Consenti la fotocamera.
4. Menu di Chrome → **Aggiungi a schermata Home**: da lì si apre a schermo intero.
5. Il telefono resta acceso e in carica, con la pagina aperta. Senza rete continua a funzionare e invia le timbrature appena torna la connessione.

## lato dipendente
1. Nel gestionale: **Dipendenti → Presenze → Roma Soratte → App del dipendente** → «Nuovo codice» per ogni persona della prova. Il codice dura 30 giorni e serve una volta sola.
2. Come si installa l'app:
   - **Android**: l'app New Zago è nel test interno di Google Play. L'email Google del dipendente va aggiunta all'elenco «New Zago Tester» in Play Console; poi riceve il link «Partecipa» e installa da Google Play.
   - **iPhone**: TestFlight ammette senza revisione solo gli utenti dell'account Apple di EPPI. Per i dipendenti serve il test esterno, che passa da una revisione di Apple (di solito uno o due giorni) e chiede un account di prova: il Dipendente Demo. Nel frattempo l'iPhone usa l'app dal browser: Safari su `gestionale-nz.netlify.app/app` → Condividi → **Aggiungi alla schermata Home**. Funziona tutto tranne le notifiche.
3. Il dipendente apre l'app, scrive il codice, tocca **Attiva**, consente le notifiche (solo app degli store).

## la prova, giorno per giorno
- **Giorno 1**: il responsabile e una collega. Entrata, pausa, fine pausa, uscita con il QR sul telefono del negozio. Controllo in **Dipendenti → Presenze**: righe di oggi, orari, nessuna «uscita non timbrata» sbagliata.
- **Giorno 2**: tutti e 5. Un'uscita dimenticata apposta, per vedere l'avviso nel gestionale e la segnalazione «ieri non risulta la tua uscita» nell'app.
- **Giorno 3**: accendere gli **avvisi sul telefono** per Roma (Presenze → Avvisi sul telefono): ritardo dopo 15 minuti al dipendente e al responsabile, uscita mancante dopo il margine. Solo per chi ha l'app degli store.
- **Fine settimana**: una richiesta di permesso dall'app, decisa nel gestionale in **Dipendenti → Ferie e permessi → Approvazioni**.

## cosa controllare alla fine
- Ogni turno ha entrata e uscita, o un avviso giusto.
- Le ore della scheda «Ore» dell'app coincidono con le presenze nel gestionale.
- Nessuna timbratura doppia (doppio tocco, rete che va e viene).
- Tempi: quanto ci mette un dipendente a timbrare, dal QR al «fatto».
