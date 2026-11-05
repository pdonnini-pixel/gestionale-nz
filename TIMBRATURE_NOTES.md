# timbrature e presenze (migration 348, 05/11/2026)

Decisioni di Patrizio del 05/11/2026, pilota **Roma Soratte** (RSO). Due diligence completa in `docs/DUE_DILIGENCE_PRESENZE_DIPENDENTI.md`.

## come funziona
- **Timbratrice**: il cellulare aziendale del negozio (Android, resta in negozio, Wi-Fi) apre `/timbra` con l'account di cassa (`operatore_cassa`). Legge il QR del dipendente con la fotocamera (BarcodeDetector di Chrome) e mostra un solo pulsante grande con l'azione giusta (`azioni()` in `src/lib/timbrature.ts`).
- **App del dipendente**: `/app` sul telefono personale. QR `NZT1.<employee_id>.<passo>.<firma>`, passo di 30 secondi, firma HMAC-SHA256 con il segreto personale (primi 16 caratteri). Stessa formula in `timbrature_firma()` (SQL) e `firma()` (TS): se cambia una, cambia l'altra, il test in `timbrature.test.ts` confronta con Node.
- **Accesso**: ogni dipendente nuovo riceve un codice di 8 caratteri (trigger `trg_employees_accesso_app`), valido 30 giorni. La Edge Function `app-dipendente-attiva` crea l'utente (ruolo `dipendente`, email interna `<employee_id>@dipendenti.local`, nessuna mail), lega `employees.user_id`, consuma il codice (segreto nuovo) e restituisce un `token_hash` per `verifyOtp`.
- **Offline**: coda in IndexedDB (`src/lib/timbratureCoda.ts`), invio con `timbrature_registra()` riga per riga (una riga rovinata non blocca le altre), service worker `public/presenze-sw.js` registrato **solo** con scope `/timbra` e `/app`: il resto del gestionale non è toccato.
- **Turni ufficiali** (`timbrature_turni_ufficiali`): piano «scelto» del mese; senza piano scelto, turni senza piano pubblicati o messi a mano. Al 05/11/2026 nessun turno è «pubblicato».

## regole
- **Margine d'uscita**: 30 minuti di default (`attendance_settings.margine_uscita_minuti`). Uscita entro il margine: non è straordinario, nessun avviso. Ancora dentro a fine turno + margine: avviso WhatsApp, una volta sola per turno (`attendance_notifications`, anche gli invii falliti, così non si manda a raffica).
- **Chi non ha timbrato niente non riceve l'avviso** (può essere in ferie). Se ha un altro turno che comincia entro un'ora, niente avviso.
- **Le timbrature non si cancellano**: si annullano con motivo (`timbrature_annulla`). Le uscite segnate dal dipendente restano `da_confermare` finché l'HR non conferma.
- Verifica: `ok`, `firma_non_valida`, `fuori_tempo` (ora del telefono lontana dal QR o nel futuro), `da_confermare` (arrivata oltre 36 ore dopo, o dichiarata), `manuale`. Le timbrature dubbie si salvano comunque.
- Niente GPS, niente biometria (Garante privacy): il luogo è certo perché il cellulare è del negozio.

## da fare per accendere gli avvisi WhatsApp
1. Modello Twilio approvato da Meta con tre variabili: {{1}} nome, {{2}} negozio, {{3}} ora di fine turno.
2. Il suo Content SID nel Vault come `twilio_whatsapp_timbrature_content_sid` (NZ e Zago).
3. Numeri dei dipendenti in Dipendenti → Presenze → App del dipendente; poi «Avviso WhatsApp» acceso sul negozio.

## aperto
- PIN sul cellulare del negozio per chi non ha lo smartphone (non ancora fatto).
- Ferie e permessi dall'app del dipendente (le tabelle `leave_*` esistono già).
- Tracciato mensile per lo studio paghe (formato da chiedere allo studio).
- Sede: ha un cellulare aziendale ma nessun account di cassa; serve un account per la timbratrice della sede.
