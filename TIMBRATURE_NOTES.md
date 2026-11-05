# timbrature e presenze (migration 348, 05/11/2026)

Decisioni di Patrizio del 05/11/2026, pilota **Roma Soratte** (RSO). Due diligence completa in `docs/DUE_DILIGENCE_PRESENZE_DIPENDENTI.md`.

## come funziona
- **Timbratrice**: il cellulare aziendale del negozio (Android, resta in negozio, Wi-Fi) apre `/timbra` con l'account di cassa (`operatore_cassa`). Legge il QR del dipendente con la fotocamera (BarcodeDetector di Chrome) e mostra un solo pulsante grande con l'azione giusta (`azioni()` in `src/lib/timbrature.ts`).
- **App del dipendente**: `/app` sul telefono personale. QR `NZT1.<employee_id>.<passo>.<firma>`, passo di 30 secondi, firma HMAC-SHA256 con il segreto personale (primi 16 caratteri). Stessa formula in `timbrature_firma()` (SQL) e `firma()` (TS): se cambia una, cambia l'altra, il test in `timbrature.test.ts` confronta con Node.
- **Accesso**: ogni dipendente nuovo riceve un codice di 8 caratteri (trigger `trg_employees_accesso_app`), valido 30 giorni. La Edge Function `app-dipendente-attiva` crea l'utente (ruolo `dipendente`, email interna `<employee_id>@dipendenti.local`, nessuna mail), lega `employees.user_id`, consuma il codice (segreto nuovo) e restituisce un `token_hash` per `verifyOtp`.
- **Offline**: coda in IndexedDB (`src/lib/timbratureCoda.ts`), invio con `timbrature_registra()` riga per riga (una riga rovinata non blocca le altre), service worker `public/presenze-sw.js` registrato **solo** con scope `/timbra` e `/app`: il resto del gestionale non è toccato.
- **Turni ufficiali** (`timbrature_turni_ufficiali`): piano «scelto» del mese; senza piano scelto, turni senza piano pubblicati o messi a mano. Al 05/11/2026 nessun turno è «pubblicato».

## regole
- **Margine d'uscita**: 30 minuti di default (`attendance_settings.margine_uscita_minuti`). Uscita entro il margine: non è straordinario, nessun avviso. Ancora dentro a fine turno + margine: avviso sul telefono (vedi sotto).
- **Chi non ha timbrato niente non riceve l'avviso** (può essere in ferie). Se ha un altro turno che comincia entro un'ora, niente avviso.
- **Le timbrature non si cancellano**: si annullano con motivo (`timbrature_annulla`). Le uscite segnate dal dipendente restano `da_confermare` finché l'HR non conferma.
- Verifica: `ok`, `firma_non_valida`, `fuori_tempo` (ora del telefono lontana dal QR o nel futuro), `da_confermare` (arrivata oltre 36 ore dopo, o dichiarata), `manuale`. Le timbrature dubbie si salvano comunque.
- Niente GPS, niente biometria (Garante privacy): il luogo è certo perché il cellulare è del negozio.

## avvisi sul telefono (migration 367, 05/11/2026, WhatsApp tolto)
- Patrizio: niente WhatsApp, notifiche push dell'app New Zago degli store (Android e iOS, account EPPI). Istruzioni dell'app in `APP_NATIVA_NOTES.md`.
- Due avvisi, configurabili per negozio in Dipendenti → Presenze (`attendance_settings`): **ritardo** (entrata mancante dopo `ritardo_minuti`, 15 di partenza, dall'inizio del turno; non se la persona ha ferie o permessi quel giorno) e **uscita non timbrata** (dopo `margine_uscita_minuti`, 30). Destinatari: dipendente, **responsabile del negozio** (`outlets.referente_employee_id`), ufficio (notifica nel gestionale).
- Calcolo: `timbrature_avvisi_da_mandare()`; invio: Edge Function `timbrature-notifiche` (Firebase Cloud Messaging HTTP v1, account di servizio nel Vault come `fcm_service_account`); cron `timbrature-avvisi-tick` ogni 5 minuti. Un avviso per turno, tipo e destinatario (`attendance_alerts`), registrato anche se non riesce.
- Telefoni: `employee_push_tokens`, scritti dall'app con `app_registra_push_token`. Un token rifiutato da Firebase si spegne da solo.
- Le colonne e la funzione WhatsApp della 348 restano (nessun dato si cancella) ma non le usa nessuno; la Edge Function `timbrature-avvisi` non e' piu' chiamata.

## app del dipendente: turni, ferie, ore (migration 350, 05/11/2026)
- Schede in basso: Oggi (QR), Turni (settimana e prossima), Ferie (saldo, richiesta, stato), Ore (mese, per settimana). Componenti in `src/components/app/`, conti in `src/lib/appDipendente.ts` (con test). Ogni scheda tiene in memoria l'ultimo scaricamento e si vede anche senza rete; inviare una richiesta richiede la rete.
- RPC solo per sé: `app_dipendente_ferie`, `app_dipendente_chiedi_ferie`, `app_dipendente_ritira_ferie`, `app_dipendente_periodo` (persona da `auth.uid()`, le tabelle restano chiuse al ruolo `dipendente`).
- La richiesta nasce `inviata` con `compilata_da_nome = 'App del dipendente (nome)'` (origine resta `gestionale`: il CHECK non ha `app`), e la decidono i referenti come le altre. Ore di giornata e mezza giornata le calcola il server. Permesso: ex festività finché bastano, poi ROL.
- Migration 351 (dalle revisioni): una data già chiesta (in attesa o approvata) non si richiede oltre la giornata; al massimo 10 richieste in attesa; lucchetto per persona; permesso diviso fra ex festività e ROL quando nessuna delle due basta da sola; eventi «niente ferie» validi anche per chi non ha un negozio in anagrafica.
- **Avviso al referente**: lo crea il database con la richiesta (notifica nel gestionale, come `leave_decidi`). L'app **non** chiama la mail `leave-notify`: quella funzione controlla solo l'azienda di chi chiama e restituisce gli indirizzi dei referenti, quindi non va esposta al ruolo `dipendente`. Debito: irrobustirla (proprietà della richiesta, una mail per richiesta, niente `recipients` nella risposta) prima di riaccendere la mail dalle richieste dell'app.
- Chi non ha ancora un saldo (Roma Soratte al 05/11/2026: 5 persone su 5, assunte da poco) può chiedere lo stesso: decide il referente, come dal gestionale.
- **Accesso individuale** (Patrizio, 05/11/2026): supera la decisione del 19/10 «un accesso per negozio» di PIANO_FERIE_NOTES.md.

## aperto
- PIN sul cellulare del negozio per chi non ha lo smartphone (non ancora fatto).
- Ferie e permessi dall'app del dipendente (le tabelle `leave_*` esistono già).
- Tracciato mensile per lo studio paghe (formato da chiedere allo studio).
- Sede: ha un cellulare aziendale ma nessun account di cassa; serve un account per la timbratrice della sede.
