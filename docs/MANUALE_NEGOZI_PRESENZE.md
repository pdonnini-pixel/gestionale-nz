# manuale delle presenze per i negozi

Manuale di funzionamento da dare a ogni negozio (versione del 09/11/2026, su indicazione di Patrizio). Testo per chi lavora in negozio, senza termini tecnici. Il PDF con le schermate si rigenera da questo testo; le schermate usano sempre persone e dati inventati.

## 1. il telefono del negozio

Il telefono aziendale del negozio fa da timbratrice. Non serve installare nessuna app: si usa una pagina del gestionale, sempre la stessa.

**Prima accensione (la fa chi prepara il negozio, una volta sola)**
1. Collegare il telefono al Wi-Fi del negozio.
2. Aprire Chrome e andare all'indirizzo del gestionale seguito da `/timbra` (per New Zago: `gestionale-nz.netlify.app/timbra`).
3. Entrare con l'account di cassa del negozio.
4. Permettere a Chrome di usare la fotocamera, quando lo chiede.
5. Menu di Chrome (i tre puntini in alto a destra) → **Aggiungi a schermata Home**. Da quel momento la timbratrice si apre dall'icona, a tutto schermo, senza la barra degli indirizzi: sembra un'app.
6. Bloccare il telefono sulla timbratrice con il **Blocco app** di Android (il nome può cambiare secondo la marca: «Blocco app», «Fissa app», «Blocco schermo sull'app»):
   - Impostazioni → Sicurezza (o Sicurezza e privacy) → Altre impostazioni → **Blocco app**: attivarlo e chiedere il codice per uscire.
   - Aprire la timbratrice dall'icona, poi il pulsante delle app recenti, toccare l'icona in alto della timbratrice → **Blocca** (o «Fissa»).
   - Il telefono resta sulla timbratrice; per uscire servono il gesto indicato a schermo e il codice del telefono, che tiene solo il responsabile.

**Cosa si vede**: in alto il negozio, l'ora e se le timbrature sono tutte inviate; al centro la fotocamera che aspetta il QR; in basso chi è già in negozio.

**Perché una pagina e non un'app degli store**
- Gli aggiornamenti arrivano da soli, senza installare niente.
- Funziona anche senza rete: se il Wi-Fi cade, le timbrature restano salvate nel telefono e partono da sole quando la rete torna. In alto la pagina dice quante sono ancora in attesa.
- Il limite di una pagina è che qualcuno la può chiudere o usare il telefono per altro: per questo servono i punti 5 e 6.

**Regole per tutti i giorni**
- Il telefono resta in negozio, acceso e in carica, sempre sulla timbratrice.
- Non si esce dalla timbratrice e non si usa il telefono per altro.
- Se la pagina chiede di nuovo l'accesso, lo fa il responsabile con l'account di cassa.

## 2. timbrare

Ognuno timbra con il proprio telefono: apre l'app New Zago (scheda **Oggi**) e avvicina il QR alla fotocamera del telefono del negozio. Il QR cambia ogni 30 secondi, quindi una foto del QR non vale.

Il telefono del negozio riconosce la persona, mostra il suo turno di oggi e propone solo le azioni possibili:
- chi è fuori vede **Entra**;
- chi è in negozio vede **Vado in pausa** ed **Esco**;
- chi è in pausa vede **Rientro dalla pausa** ed **Esco**.

Dopo il tocco compare la conferma («Entrata registrata», con nome e ora) e dopo pochi secondi il telefono torna in attesa del prossimo QR. **Annulla** torna indietro senza timbrare.

La pausa si timbra sempre: «Vado in pausa» quando si esce per la pausa, «Rientro dalla pausa» quando si torna. Chi esce per la pausa con «Esco» e poi rientra con «Entra» non sbaglia: conta l'ultima uscita della giornata.

## 3. ritardi

Ogni negozio ha una **tolleranza all'entrata di 10 minuti** (chi segue il personale può cambiarla per il negozio o per una singola persona).
- Entrata entro la tolleranza: non è un ritardo.
- Entrata oltre la tolleranza: il telefono lo dice prima di «Entra», con i minuti di permesso proposti, **a blocchi di 15 minuti per eccesso** (12 minuti di ritardo diventano 15 di permesso, 22 diventano 30).

Il permesso **non conta finché il responsabile non lo conferma**. Nell'app la persona vede il riquadro «Entrata con … di ritardo, da confermare» e può aggiungere un motivo («Aggiungi un motivo»), che il responsabile legge prima di decidere.

## 4. uscita prima della fine del turno

Chi esce prima della fine del turno tocca **Esco**: il telefono chiede il motivo prima di salvare.
- **Motivo personale (permesso)**: se il responsabile conferma, i minuti si scalano dal saldo dei permessi.
- **Sto male (malattia)**: si registra la malattia.
- **D'accordo con il responsabile**: il responsabile decide caso per caso se scalare il permesso.

Il motivo scritto non si chiede sul telefono del negozio, che è di tutti: chi vuole lo aggiunge dall'app personale, nel riquadro dell'uscita, finché il responsabile non ha deciso. Se poi la persona rientra nella stessa giornata, l'uscita di prima si chiude da sola.

## 5. straordinario

Ogni negozio ha un **margine all'uscita di 15 minuti**.
- Uscita entro il margine dopo la fine del turno: non è straordinario.
- Uscita oltre il margine: il telefono chiede il motivo dello straordinario (concordato per assenza di un collega, cliente da gestire, riassortimento, allestimento). **Conta solo la parte oltre il margine**: con il turno fino alle 19 e l'uscita alle 19:45, sono 30 minuti.

Anche lo straordinario conta solo **dopo la conferma** del responsabile.

## 6. l'app del dipendente

**Attivazione (una volta sola)**: chi segue il personale manda a ogni persona un link con un codice di 8 caratteri. La persona lo apre dal suo telefono (oppure scrive il codice nell'app New Zago) e preme **Attiva**: l'app resta attiva senza password.

L'app ha quattro schede in basso:
- **Oggi**: il QR per timbrare, il turno e le timbrature di oggi, e i riquadri di ritardi, uscite e straordinari da confermare.
- **Turni**: questa settimana e la prossima, con ferie e permessi.
- **Ferie**: le ore di ferie e di permessi ancora da usare, quelle già pianificate, la richiesta di giornate, mezze giornate o ore, e lo stato delle richieste.
- **Ore**: le ore lavorate del mese contro quelle di turno, settimana per settimana e giorno per giorno.

**Uscita dimenticata**: se il turno è finito e l'uscita non risulta, l'app lo dice e chiede l'ora a cui si è usciti; poi la conferma chi segue il personale.

**Notifiche**: con l'app New Zago installata dagli store arrivano gli avvisi (entrata mancante dopo l'inizio del turno, uscita non timbrata dopo la fine del turno).

## 7. il responsabile del negozio

Il responsabile entra nel gestionale con il suo account (profilo «Responsabile») e vede solo la pagina **Presenze e ferie** dei suoi negozi.
- **Da confermare**: ritardi, uscite prima del turno e straordinari, con turno, timbratura, proposta e motivo. **Conferma** chiude il caso (il permesso si scala da solo; la malattia si registra con «Prendo atto»). **Altro** apre la decisione: si possono ridurre i minuti, scegliere il motivo o non confermare con una nota che la persona legge nell'app.
- **Ferie e permessi**: le richieste in attesa, con le ore ancora da usare; **Approva** o **Respingi** con il motivo.
- I propri casi e le proprie ferie li decide un altro responsabile o un amministratore.

## 8. cosa fare se

- **Il telefono del negozio non ha rete**: si timbra come sempre. Le timbrature restano nel telefono e partono da sole quando la rete torna; in alto c'è scritto quante sono in attesa. Non spegnere il telefono e non cancellare i dati di Chrome finché non risultano tutte inviate.
- **Il telefono del negozio è scarico o rotto**: annotare su un foglio nome, entrata, pause e uscita di ciascuno e mandarlo al responsabile, che lo passa a chi segue il personale. L'uscita mancante si può segnare dall'app; per l'entrata mancante, per ora, va avvisato chi segue il personale.
- **Il telefono personale è scarico o la persona non ha lo smartphone**: per ora va avvisato il responsabile, che lo segnala a chi segue il personale.
- **Timbratura sbagliata** (per esempio «Esco» al posto di «Vado in pausa»): avvisare il responsabile. Chi segue il personale la annulla con il motivo; resta nello storico.
- **Telefono personale nuovo**: chiedere a chi segue il personale un codice nuovo; il telefono vecchio smette di funzionare.

## 9. privacy

Il sistema registra solo le timbrature (ora e negozio) e i turni. Niente posizione, niente impronte o riconoscimento del viso: il luogo è certo perché il telefono che timbra è quello del negozio. L'informativa completa la consegna l'azienda.

Riferimenti tecnici: `TIMBRATURE_NOTES.md`, `docs/PROVA_REALE_ROMA_SORATTE.md`.

## da sistemare prima della consegna

- Entrata dimenticata: oggi non si può aggiungere a mano nel gestionale (dall'app si segna solo l'uscita).
- Persone senza smartphone: il codice PIN sul telefono del negozio non è ancora fatto.
- Informativa privacy (a cura di Lilian).
