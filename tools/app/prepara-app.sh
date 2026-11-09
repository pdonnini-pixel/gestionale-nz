#!/usr/bin/env bash
# Prepara l'app New Zago per Android Studio e Xcode, sul Mac di chi pubblica.
# Uso, dalla cartella del repository:  bash tools/app/prepara-app.sh
# Vedi APP_NATIVA_NOTES.md. Non contiene chiavi: le legge da file locali
# che non vanno mai su GitHub.
set -euo pipefail
cd "$(dirname "$0")/../.."

manca=0
controlla() { if [ ! -f "$1" ]; then echo "MANCA: $1 ($2)"; manca=1; else echo "ok    $1"; fi; }
strumento() { if command -v "$1" >/dev/null 2>&1; then echo "ok    $1 $($1 --version 2>/dev/null | head -1)"; else echo "MANCA: programma $1 ($2)"; manca=1; fi; }

echo "== Programmi"
strumento node "da nodejs.org, versione 20 o 22"
strumento npm "arriva con node"
strumento pod "sudo gem install cocoapods, oppure brew install cocoapods"

echo "== File locali (fuori da git)"
controlla android/app/google-services.json "Firebase, app Android"
controlla ios/App/App/GoogleService-Info.plist "Firebase, app iPhone"
controlla .env.app.local "indirizzo e chiave pubblica di Supabase NZ"
if [ -f .env.app.local ]; then
  grep -q '^VITE_SUPABASE_URL_NEWZAGO=https://xfvfxsvqpnpvibgeqpqp.supabase.co' .env.app.local \
    || { echo "ERRORE: in .env.app.local l'indirizzo deve essere quello di New Zago (xfvfxsvqpnpvibgeqpqp)"; manca=1; }
  grep -q '^VITE_SUPABASE_ANON_KEY_NEWZAGO=..*' .env.app.local \
    || { echo "ERRORE: in .env.app.local manca VITE_SUPABASE_ANON_KEY_NEWZAGO"; manca=1; }
fi
[ "$manca" = 0 ] || { echo; echo "Sistema le righe MANCA o ERRORE e rilancia."; exit 1; }

echo "== Pacchetti"
npm ci
echo "== Build dell'app (modalita' app, New Zago)"
npx vite build --mode app
echo "== Copia nei progetti Android e iPhone"
npx cap sync
echo
echo "FINITO. Ora: Android Studio -> apri la cartella android; Xcode -> apri ios/App/App.xcworkspace"
