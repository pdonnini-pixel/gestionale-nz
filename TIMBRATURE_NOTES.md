# timbrature e presenze (migration 348, 05/11/2026)

Decisioni di Patrizio del 05/11/2026, pilota **Roma Soratte** (RSO). Due diligence completa in `docs/DUE_DILIGENCE_PRESENZE_DIPENDENTI.md`.

## come funziona
- **Timbratrice**: il cellulare aziendale del negozio (Android, resta in negozio, Wi-Fi) apre `/timbra` con l'account di cassa (`operatore_cassa`). Legge il QR del dipendente con la fotocamera (BarcodeDetector di Chrome) e mostra un solo pulsante grande con l'azione giusta (`azioni()` in `src/lib/timbrature.ts`).
- **App del dipendente**: `/app` sul telefono personale. QR `NZT1.<employee_id>.<passo>.<firma>`, passo di 30 secondi, firma HMAC-SHA256 con il segreto personale (primi 16 caratteri). Stessa formula in `timbrature_firma()` (SQL) e `firma()` (TS): se cambia una, cambia l'altra, il test in `timbrature.test.ts` confronta con Node.
- **Accesso**: ogni dipendente nuovo riceve un codice di 8 caratteri (trigger `trg_employees_accesso_app`), valido 30 giorni. La Edge Function `app-dipendente-attiva` crea l'utente (ruolo `dipendente`, email interna `<employee_id>@dipendenti.local`, nessuna mail), lega `employees.user_id`, consuma il codice (segreto nuovo) e restituisce un `token_hash` per `verifyOtp`.
- **Offline**: coda in IndexedDB (`src/lib/timbratureCoda.ts`), invio con `timbrature_registra()` riga per riga (una riga rovinata non blocca le altre), service worker `public/presenze-sw.js` registrato **solo** con scope `/timbra` e `/app`: il resto del gestionale non è toccato.
- **Turni ufficiali** (`timbrature_turni_ufficiali`): piano «scelto» del mese; senza piano scelto, turni senza piano pubblicati o messi a mano. Al 05/11/2026 nessun turno è «pubblicato».

## regole
- **Margine d'uscita**: 15 minuti di default dalla migration 372 (era 30; `attendance_settings.margine_uscita_minuti`, eccezione per persona in `attendance_regole_dipendente`). Uscita entro il margine: non è straordinario, nessun avviso. Ancora dentro a fine turno + margine: avviso sul telefono (vedi sotto).
- **Chi non ha timbrato niente non riceve l'avviso** (può essere in ferie). Se ha un altro turno che comincia entro un'ora, niente avviso.
- **Le timbrature non si cancellano**: si annullano con motivo (`timbrature_annulla`). Le uscite segnate dal dipendente restano `da_confermare` finché l'HR non conferma.
- Verifica: `ok`, `firma_non_valida`, `fuori_tempo` (ora del telefono lontana dal QR o nel futuro), `da_confermare` (arrivata oltre 36 ore dopo, o dichiarata), `manuale`. Le timbrature dubbie si salvano comunque.
- Niente GPS, niente biometria (Garante privacy): il luogo è certo perché il cellulare è del negozio.

## avvisi sul telefono (migration 367, 05/11/2026, WhatsApp tolto)
- Patrizio: niente WhatsApp, notifiche push dell'app New Zago degli store (Android e iOS, account EPPI). Istruzioni dell'app in `APP_NATIVA_NOTES.md`.
- Due avvisi, configurabili per negozio in Dipendenti → Presenze (`attendance_settings`): **ritardo** (entrata mancante dopo `ritardo_minuti`, 15 di partenza, dall'inizio del turno; non se la persona ha ferie o permessi quel giorno) e **uscita non timbrata** (dopo `margine_uscita_minuti`, 15 dalla migration 372). Destinatari: dipendente, **responsabile del negozio** (`outlets.referente_employee_id`), ufficio (notifica nel gestionale).
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

## ritardi, uscite anticipate, straordinari (migration 372, 09/11/2026)
Decisioni di Patrizio del 09/11/2026.
- **Regole**: tolleranza d'entrata 10 minuti (`attendance_settings.tolleranza_entrata_minuti`), margine d'uscita 15. Tutte e due per negozio, con eccezione per persona (`attendance_regole_dipendente`, vuoto = vale il negozio). Lettura unica: `timbrature_regole(employee, outlet)`.
- **Registro**: `attendance_eventi`, una riga per timbratura e tipo (`UNIQUE (punch_id, tipo)`), scritta da `timbrature_evento_da_timbratura()` chiamata da `timbrature_registra` dopo ogni timbratura `ok` o `da_confermare` (un errore lì non blocca la timbratura: `RAISE WARNING`).
  - **ritardo**: solo la prima entrata del giorno, oltre la tolleranza; `minuti_proposti` = blocchi di 15 per eccesso (12' -> 15' di permesso).
  - **uscita_anticipata**: uscita prima dell'ultima fine del turno, se dopo non c'è un altro pezzo di turno. Causali: `personale` (permesso), `malattia` (si prende atto e basta: niente testo su permesso o certificato), `accordo` (d'accordo con il responsabile).
  - **straordinario**: uscita oltre il margine; `minuti_proposti` = solo i minuti oltre il margine (turno 19:00, uscita 19:45, margine 15: 30'). Causali: `assenza_collega`, `cliente`, `riassortimento`, `allestimento`.
- **Telefono del negozio** (`/timbra`): pulsanti per stato (fuori: Entra; dentro: Vado in pausa / Esco; in pausa: Rientro dalla pausa / Esco). All'uscita anticipata o oltre il margine chiede la causale prima di salvare (`valutaUscita` in `timbrature.ts`, stessa regola del server); la causale viaggia nella coda offline (`RigaCoda.causale`). All'entrata mostra il ritardo (`valutaEntrata`). Il motivo scritto **non** si chiede sul telefono condiviso.
- **App** (scheda Oggi, `src/components/app/AppEventi.tsx`): eventi di oggi e ieri da `app_dipendente_oggi().eventi`, motivo scritto e causale cambiabile con `app_dipendente_motivo_evento()` finché `stato = 'da_confermare'`.
- **Contano solo dopo la conferma**: permessi e straordinari restano `da_confermare` finché qualcuno decide (migration 373, sotto).
- **Tracciato per lo studio paghe**: formato da chiedere al consulente.

## conferma dei casi (migration 373, 09/11/2026, parte 4 PR A)
Decisioni di Patrizio del 09/11/2026: uscita «d'accordo» decisa caso per caso; il responsabile decide anche le ferie (PR B).
- **Chi conferma**: `timbrature_gestore()` (amministratori e HR) sempre; gli altri utenti del gestionale solo nei negozi spuntati in `attendance_confermatori` (referente: un negozio, area manager: più negozi). Escluse le persone con ruolo `dipendente`, `operatore_cassa`, `viewer` (`presenze_puo_confermare`). **Nessuno decide sui propri casi** (`presenze_non_su_di_me`, salvo `super_advisor`).
- **Decisione**: `presenze_decidi_evento(evento, conferma, minuti, scala_permesso, nota)`. Ritardo e uscita `personale` creano un permesso **approvato** in `leave_requests` (`presenze_crea_permesso`: F02 finché basta, poi F03; senza saldo F02; ore arrotondate a 2 decimali) e lo legano all'evento (`leave_request_id`). `malattia` -> esito `malattia`, niente permesso. `accordo` -> `scala_permesso` obbligatorio: sì = permesso, no = esito `ore_non_lavorate`. Straordinario -> esito `straordinario` con `minuti_confermati`. Non confermare richiede la nota (la persona la legge nell'app). Chi conferma può scegliere il motivo al posto della persona (`presenze_causale_evento`); la scelta fatta al negozio resta in `causale_negozio`.
- **Riapertura**: `presenze_riapri_evento` solo amministratori, con motivo; il permesso creato passa a `ritirata` (giorni `respinto`). I casi chiusi da soli non si riaprono.
- **Chiusure automatiche**: un'entrata dopo un'uscita prima del turno chiude quell'uscita (esito `superata`: vale l'ultima uscita); `timbrature_annulla` chiude il caso della timbratura (esito `timbratura_annullata`). Questi due esiti non compaiono nell'elenco né nell'app. Un caso già confermato non si chiude da solo: si riapre a mano.
- **Notifiche**: ogni caso nuovo (non del demo) manda una notifica nel gestionale a chi è spuntato per quel negozio.
- **Elenco**: `presenze_eventi_elenco(dal, al, solo_da_confermare)` per i negozi che posso confermare, compreso il dipendente demo marcato `prova` (serve a provare il giro). Riepilogo del mese calcolato nel browser (`riepilogoMese` in `src/lib/presenzeConferme.ts`, con test) ed esportato in Excel.
- **Eccezioni per persona**: `presenze_regola_dipendente` (campo vuoto = come il negozio). Tolleranza e margine del negozio nella scheda «Giornata», con «usa per tutti i negozi».
- **Interfaccia**: Dipendenti → Presenze, sotto-schede Giornata / Da confermare / Riepilogo del mese / Chi conferma e regole (`src/components/PresenzeConferme.tsx`, parametro `presenze=` nell'URL).
- **Dalle revisioni** (migration 374 e 375): chi non è amministratore conferma al massimo i minuti proposti (ritardo: blocchi di 15; uscita e straordinario: i minuti timbrati), gli amministratori fino a 24 ore; le tabelle `attendance_eventi`, `attendance_regole_dipendente`, `attendance_confermatori` sono in sola lettura per `authenticated` e chiuse ad `anon` (si scrive solo dalle funzioni).
- **Richieste del dipendente di prova** (migration 376, Patrizio 09/11/2026): `ferie_richieste_prova()` le restituisce a chi decide le ferie o segue il personale; Ferie e permessi → Richieste le mostra in un riquadro a parte con l'etichetta «prova». Il demo resta nascosto in tutte le tabelle (368).

## profilo responsabile (migration 377-378, 09/11/2026, parte 4 PR B)
- Ruolo `responsabile` (377, enum). «Chi conferma» lo modificano solo amministratori e super advisor (Patrizio, 09/11/2026).
- **Recinto** (378): `responsabile_block` RESTRITTIVA su tutte le tabelle public con RLS fuori dalla lista bianca (`companies`, `outlets`, `help_chat_*`, `user_profiles` solo il proprio, `notifications` solo le proprie) e su `storage.objects`. **Le tabelle nuove non la ricevono da sole: aggiungerla accanto a `cash_operator_block` e `dipendente_block`.**
- **Pagina** `/responsabile` (`src/pages/Responsabile.tsx`): «Da confermare» (stesso componente del gestionale, funzioni 373-374 che filtrano per negozio) e «Ferie e permessi» (`responsabile_ferie_elenco`, decisione con `leave_decidi`, che accetta il responsabile tramite `ferie_responsabile_puo`: richiesta in attesa, di un suo negozio, non sua). Negozio della richiesta: `outlet_code` della richiesta, altrimenti il negozio in anagrafica (`ferie_negozio_richiesta`).
- **Chi è davvero** (378): l'account del gestionale di un responsabile è diverso dall'utente della sua app (`employees.user_id`). L'amministratore lo collega alla scheda in «Chi conferma» («È anche il dipendente», tabella `responsabile_dipendente`); `presenze_sono_io()` usa i due collegamenti e vale per conferme, ferie ed elenchi. Senza collegamento un responsabile che è anche dipendente potrebbe decidere sui propri casi: la casella vuota è evidenziata in giallo.
- **Funzioni di banca e fatture** (379): `responsabile_non_qui()` in testa a `richiedi_profilo_gestionale()` (38 funzioni) e a 16 funzioni del ciclo passivo che non la usavano. Solo per il responsabile: per dipendente e cassa la stessa lacuna è preesistente e va trattata a parte.
- Provato il 09/11/2026 su NZ in una transazione annullata, trasformando per un attimo un utente in sola lettura in responsabile di Roma Soratte: vede 0 movimenti, fatture, dipendenti e negozi, 1 profilo (il suo), 2 casi e 2 richieste di Roma Soratte; approva e respinge le richieste; le funzioni della finanza rispondono «Non disponibile con il profilo responsabile»; collegato alla scheda del Demo non vede né decide le proprie richieste e non conferma i propri casi.
- Frontend: il responsabile vede solo `/responsabile` e `/profilo` (`RESPONSABILE_PATHS` in `App.tsx`), niente ricerca né periodo; l'account si crea in Impostazioni → Utenti (`admin-manage-user` accetta il ruolo).

## aperto
- **Manuale per i negozi**: bozza in `docs/MANUALE_NEGOZI_PRESENZE.md` (telefono del negozio: icona sulla schermata Home e Blocco app di Android). Completare i capitoli elencati lì prima di consegnarlo ai negozi.
- PIN sul cellulare del negozio per chi non ha lo smartphone (non ancora fatto).
- Ferie e permessi dall'app del dipendente (le tabelle `leave_*` esistono già).
- Tracciato mensile per lo studio paghe (formato da chiedere allo studio).
- Sede: ha un cellulare aziendale ma nessun account di cassa; serve un account per la timbratrice della sede.
