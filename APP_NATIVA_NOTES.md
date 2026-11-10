# app New Zago per Android e iOS (05/11/2026)

Decisione di Patrizio del 05/11/2026: un'app vera negli store, con il marchio New Zago, per avere le notifiche push anche ad app chiusa (ritardo in entrata, uscita non timbrata). Si pubblica con gli account sviluppatore di **EPPI Srl** che esistono già per l'app Gooler.

## com'è fatta
- **Capacitor 7** (`capacitor.config.ts`): impacchetta lo stesso codice React del gestionale e si apre su `/app` (`src/main.tsx`). Un solo codice per sito e app.
- **appId**: `it.eppi.newzago`, nome «New Zago».
- **Azienda**: New Zago. Dentro l'app l'indirizzo è «localhost» e `src/lib/tenants.ts` lo tratta come NZ. Si compila con `VITE_SUPABASE_URL_NEWZAGO` e `VITE_SUPABASE_ANON_KEY_NEWZAGO` (chiave pubblica, non segreta).
- **Notifiche**: `@capacitor-firebase/messaging` (`src/lib/pushNativo.ts`), che dà il codice Firebase sia su Android sia su iPhone. Il modulo standard di Capacitor su iPhone darebbe il codice Apple, che il server non usa. Il telefono si registra con `app_registra_push_token`; il server manda con la Edge Function `timbrature-notifiche` (migration 367).
- Progetti nativi in `android/` e `ios/` (generati con `npx cap add`). I file web copiati dentro sono esclusi da git e si rigenerano con `npx cap sync`.
- Nel browser l'app resta quella di prima (`/app`): le notifiche esistono solo nell'app degli store.

## cosa serve da Patrizio (account EPPI)
1. **Firebase** (console.firebase.google.com, con l'account Google di EPPI): un progetto «New Zago presenze».
   - App **Android** con nome pacchetto `it.eppi.newzago` → scaricare `google-services.json` e metterlo in `android/app/`.
   - App **iOS** con bundle ID `it.eppi.newzago` → scaricare `GoogleService-Info.plist` e aggiungerlo in Xcode alla cartella `App/App` (spuntando il target App).
   - Impostazioni progetto → Cloud Messaging → caricare la **chiave APNs** (.p8) creata nell'account Apple di EPPI (Certificates, IDs & Profiles → Keys → Apple Push Notifications service).
   - Impostazioni progetto → Account di servizio → «Genera nuova chiave privata»: è un file JSON segreto. **Non va in chat né in git**: si incolla nel Vault di Supabase NZ (dashboard del progetto `xfvfxsvqpnpvibgeqpqp` → Project Settings → Vault → New secret) con nome `fcm_service_account`. Zago non ha l'app: lì non serve.
2. **Apple** (account EPPI): in Xcode, target App → Signing & Capabilities → team EPPI, poi aggiungere **Push Notifications** e **Background Modes → Remote notifications** (la seconda è già nell'Info.plist). In App Store Connect: nuova app «New Zago», bundle `it.eppi.newzago`. Per un'app dei soli dipendenti si può chiedere la **distribuzione non in elenco** (unlisted): non compare nelle ricerche, si installa dal link. Da verificare le condizioni attuali al momento della richiesta.
3. **Google Play** (account EPPI): nuova app «New Zago», prima nel canale di test interno, poi in produzione.
4. **Per la revisione di Apple e Google**: un dipendente di prova attivato (codice da Presenze → App del dipendente), da indicare come account demo.
5. **Marchio**: Apple può chiedere che un'app con il marchio di un cliente sia pubblicata dal cliente stesso. Di solito basta una lettera di New Zago che autorizza EPPI. Da verificare in revisione.

## come si costruisce (sul Mac di Patrizio, lo stesso di Gooler)
File locali, mai su GitHub (il repository è pubblico, sono in `.gitignore`):
- `android/app/google-services.json` e `ios/App/App/GoogleService-Info.plist`, scaricati da Firebase (progetto `new-zago-presenze`);
- `.env.app.local` con `VITE_SUPABASE_URL_NEWZAGO=https://xfvfxsvqpnpvibgeqpqp.supabase.co` e `VITE_SUPABASE_ANON_KEY_NEWZAGO=` la chiave pubblica (anon) di NZ, copiata da Supabase → Project Settings → API Keys.

Poi, dalla cartella del repository: `bash tools/app/prepara-app.sh` (controlla programmi e file, `npm ci`, build in modalità `app`, `npx cap sync`).
- Android: Android Studio → apri `android/` → Build → Generate Signed App Bundle (chiave di caricamento EPPI per New Zago) → carica l'.aab in Play Console.
- iOS: Xcode → apri `ios/App/App.xcworkspace` → target App → team EPPI (BZ3NL6C9MT) → Product → Archive → Distribute App → App Store Connect.
- Ogni nuova versione: alzare `versionCode`/`versionName` in `android/app/build.gradle` e la versione in Xcode.

Fatti il 06/11/2026: progetto Firebase `new-zago-presenze` con app Android e iOS; chiave APNs «Notifiche New Zago» (HXRZQD2BPL, team BZ3NL6C9MT, sviluppo e produzione) caricata in Firebase; App ID `it.eppi.newzago` con Push Notifications; `fcm_service_account` nel Vault NZ (una copia caricata per errore nel Vault Zago, non usata); app «New Zago» creata in Play Console.

## stato al 05/11/2026
- Codice, progetti nativi, migration 367 e Edge Function: pronti (NZ e Zago).
- Mancano: progetto Firebase e i suoi file, chiave APNs, chiave di servizio nel Vault, schede negli store, prima build. Finché manca la chiave di servizio, gli avvisi si registrano come «non riuscito» e l'ufficio (se acceso) li vede comunque nel gestionale.

## marchio (05/11/2026)
Logo creato per l'app su richiesta di Patrizio, nello stile dei negozi (scritta sottile e geometrica, bianco e nero, accento magenta `#ff0066`). È un disegno originale: il marchio Vicolo non è di New Zago e non va usato.
- Scritta: `public/brand/newzago-logo.svg`, nel codice `src/components/app/LogoNewZago.tsx` (solo sul sito NZ e nell'app degli store; Zago e Made vedono il loro nome in testo).
- Icona: `public/brand/newzago-icona.svg` (NZ bianco su nero, riga magenta). Le PNG di Android (`android/app/src/main/res/mipmap-*`, sfondo adattivo nero) e di iPhone (`AppIcon-512@2x.png`, senza trasparenza) e le schermate d'avvio sono generate da questi due file.

## stato al 09/11/2026
- **iPhone**: build 1.0 (2) su TestFlight, si apre (iOS 27 richiede il ciclo di vita a scene: `SceneDelegate.swift`, PR #779). Xcode 27.2 vuole iOS minimo 15 (PR #778). Prossima build: 3 (sfondo bianco dietro la barra di stato, PR #781).
- **Android**: versione 3 (1.0) pubblicata nel **test interno** di Google Play (elenco tester «New Zago Tester»). Google Play chiede minSdk 24 e target 36 (PR #781, #782). Chiave di caricamento `newzago-upload.jks` in iCloud → «New Zago App», password nell'archivio EPPI.
- Sul Mac: il Terminale aveva «Usa Opzione come tasto Meta» acceso (la @ non usciva: sudo e portachiavi rifiutavano la password); risolto togliendolo. Il portachiavi «login» è stato sbloccato per codesign con `security set-key-partition-list`.
- **Da fare**: Dipendente Demo per la prova e per la revisione degli store (migration 368 e NZ_ONLY 369 pronte nella storia del branch, non applicate); schede degli store (descrizioni, screenshot, privacy); informativa privacy per i dipendenti (Lilian); accendere gli avvisi per Roma Soratte.

## versione 1.1 (10/11/2026)
- **Android** `versionCode 5`, `versionName 1.1`; **iPhone** build 4, versione 1.1 (prima: Android 4, iPhone 3).
- Dentro: riquadro giallo «Non risulta la tua entrata di oggi» con «Sono entrato alle» (migration 382), caso «Entrata segnata» nella scheda Oggi, «Sto male» al posto di «Sto male (malattia)» e testo del permesso salvo certificato (386), straordinario «conta tutto» (386), tolleranza unica di 10 minuti nelle ore (386).
- Il server è già aggiornato: le versioni vecchie dell'app funzionano, cambiano solo le parole e il riquadro giallo, che manca.
- Se App Store Connect o Play Console rifiutano il numero perché già usato da una build fatta sul Mac e non registrata qui, alzarlo di uno e scriverlo qui.

## versione 1.2 (10/11/2026)
- **Android** `versionCode 6`, `versionName 1.2`; **iPhone** build 5, versione 1.2.
- Dentro: schermata «Questo telefono non è più attivo» quando l'app è stata attivata su un altro telefono (migration 387); la rete si controlla chiamando il server, non con `navigator.onLine` (sul Mac diceva «Senza rete» con la rete).

## versione 1.3 (10/11/2026)
- **Android** `versionCode 7`, `versionName 1.3`; **iPhone** build 6, versione 1.3.
- Dentro: alla registrazione delle notifiche l'app manda l'impronta del suo segreto (`p_impronta`, migration 388). Il server accende le notifiche solo sul telefono attivo, anche quando lo stesso telefono si riattiva con un codice nuovo e l'app si riapre dopo più di 15 minuti (con la 1.2 in quel caso restavano spente).
