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

## come si costruisce
```bash
VITE_SUPABASE_URL_NEWZAGO=https://xfvfxsvqpnpvibgeqpqp.supabase.co VITE_SUPABASE_ANON_KEY_NEWZAGO=<chiave pubblica NZ> npm run build
npx cap sync
```
- Android: aprire `android/` con Android Studio → Build → Generate Signed Bundle (chiave di caricamento EPPI).
- iOS: su un Mac, aprire `ios/App/App.xcworkspace` (o `App.xcodeproj`) con Xcode → Product → Archive → caricare su App Store Connect.
- Ogni modifica all'app del dipendente richiede una nuova versione negli store (il sito invece si aggiorna da solo). Si può usare la stessa procedura con cui EPPI pubblica Gooler.

## stato al 05/11/2026
- Codice, progetti nativi, migration 367 e Edge Function: pronti (NZ e Zago).
- Mancano: progetto Firebase e i suoi file, chiave APNs, chiave di servizio nel Vault, schede negli store, prima build. Finché manca la chiave di servizio, gli avvisi si registrano come «non riuscito» e l'ufficio (se acceso) li vede comunque nel gestionale.

## marchio (05/11/2026)
Logo creato per l'app su richiesta di Patrizio, nello stile dei negozi (scritta sottile e geometrica, bianco e nero, accento magenta `#ff0066`). È un disegno originale: il marchio Vicolo non è di New Zago e non va usato.
- Scritta: `public/brand/newzago-logo.svg`, nel codice `src/components/app/LogoNewZago.tsx` (solo sul sito NZ e nell'app degli store; Zago e Made vedono il loro nome in testo).
- Icona: `public/brand/newzago-icona.svg` (NZ bianco su nero, riga magenta). Le PNG di Android (`android/app/src/main/res/mipmap-*`, sfondo adattivo nero) e di iPhone (`AppIcon-512@2x.png`, senza trasparenza) e le schermate d'avvio sono generate da questi due file.
