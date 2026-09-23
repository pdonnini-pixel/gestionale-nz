# Pubblicazioni e versioni — note di dominio

Da leggere prima di toccare `vite.config.ts`, il workflow `pixel-check.yml`, il caricamento delle
pagine in `src/App.tsx` o qualunque cosa riguardi cosa vede chi sta lavorando mentre pubblichiamo.

## Il problema, in una riga

Il gestionale non è un file solo. È una pagina principale più una ventina di pezzi separati, uno per
schermata, scaricati solo quando servono. A ogni pubblicazione quei pezzi cambiano nome, e chi ha il
gestionale già aperto tiene in mano l'elenco vecchio.

Finché resta sulla schermata dov'è, non succede niente. Appena ne apre una che non aveva ancora
visitato, il browser chiede un file che sul server non esiste più. Netlify, per la regola SPA
(`/* → /index.html`), risponde con l'HTML della home, e il browser rifiuta l'HTML al posto del
codice: `Failed to load module script: ... MIME type of "text/html"`. Per la persona è una schermata
che non si apre, senza spiegazione.

## Come lo abbiamo scoperto (23/09/2026)

Non da una segnalazione: dal log del pixel check di quel giorno, verde ma con 13 errori in console,
tutti quel messaggio. Il test era partito mentre Netlify stava ancora sostituendo i file. Il test
passava perché controlla le eccezioni JavaScript e le risposte 5xx, non gli errori in console.

Due difetti distinti, quindi, e due rimedi distinti.

## 1. Chi lavora ora lo viene a sapere

- `src/lib/nuovaVersione.ts`: riconosce **solo** l'errore da versione nuova, a pezzi di messaggio,
  perché i testi cambiano da browser a browser. Un errore vero del codice non deve mai finire qui:
  dire «ricarica» a chi ha trovato un bug è una bugia che lo nasconde. Il test elenca i messaggi veri
  da riconoscere e quelli da lasciar passare.
- `src/components/AvvisoNuovaVersione.tsx`: la striscia in basso. Non interroga il server e non parte
  da sola: aspetta il primo segnale vero (`vite:preloadError`, oppure un `error` o una promessa
  rifiutata). Si può chiudere, perché restare dov'è non fa perdere niente.
- `src/components/ConfinePagina.tsx`: il paracadute. **Prima non c'era nessun error boundary**: un
  errore dentro una pagina caricata al volo smontava tutto e lasciava lo schermo bianco. Ora la
  schermata che non si apre dice perché, e cambiando pagina l'errore si azzera.

## 2. Il pixel check aspetta il commit, non un 200

Il passaggio «attendi che il site risponda 200» durava meno di un secondo: anche la versione
precedente risponde 200. Quindi la verifica poteva girare sul sito **vecchio** e dare verde su codice
che non era quello appena pubblicato.

Ora il build scrive il commit dentro `index.html` (`<meta name="app-commit">`, plugin `markerVersione`
in `vite.config.ts`, da `COMMIT_REF` che passa Netlify) e il workflow aspetta **quel** commit, fino a
dieci minuti, poi fallisce dicendo cosa ha visto. In più `concurrency` annulla la verifica in corso se
arriva un push nuovo: aspetterebbe un commit che il sito non servirà mai più.

Fuori da Netlify il marker vale `dev`: in locale non serve a niente e non dà fastidio.

## Note sparse

- `npm test` alla radice gira solo su `src`. Senza il limite raccoglieva anche
  `tests/e2e/pixel-check.spec.ts`, che è un test Playwright e ha le sue dipendenze in `tests/e2e`:
  falliva sempre, per un motivo che non c'entrava niente con il codice.
- Il rimedio qui è l'avviso, non il tentativo di tenere in piedi la versione vecchia. I pezzi vecchi
  su Netlify restano raggiungibili ancora per un po' dopo la pubblicazione, ma non è una garanzia su
  cui costruire.
