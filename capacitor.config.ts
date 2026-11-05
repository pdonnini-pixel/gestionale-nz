// App New Zago (Android e iOS): impacchetta la stessa app del dipendente del
// gestionale (/app), con le notifiche push tramite Firebase (migration 367,
// Edge Function timbrature-notifiche). Pubblicata con gli account Apple e
// Google di EPPI Srl. Istruzioni di build e pubblicazione: APP_NATIVA_NOTES.md.
//
// Il tenant e' New Zago: dentro l'app l'indirizzo e' «localhost» e
// src/lib/tenants.ts lo tratta come NZ. Si compila con le chiavi pubbliche
// di NZ (VITE_SUPABASE_URL_NEWZAGO / VITE_SUPABASE_ANON_KEY_NEWZAGO).
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'it.eppi.newzago',
  appName: 'New Zago',
  webDir: 'dist',
  android: { allowMixedContent: false },
  server: { androidScheme: 'https' },
  plugins: {
    FirebaseMessaging: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
}

export default config
