/**
 * Quando pubblichiamo, i file del gestionale cambiano nome. Chi ha la pagina
 * gia' aperta tiene in mano l'elenco vecchio: finche' resta dov'e' non succede
 * niente, ma appena apre una schermata che non aveva ancora visitato il browser
 * chiede un file che sul server non esiste piu'. Netlify, per la regola SPA,
 * risponde con index.html, e il browser rifiuta l'HTML al posto del codice.
 *
 * Il risultato per la persona e' una pagina che non si carica, senza una
 * spiegazione. Si risolve ricaricando, ma nessuno glielo dice: questi sono i
 * segnali che permettono di riconoscere il caso e dirglielo.
 *
 * I messaggi cambiano da browser a browser, e nessuno di questi testi e'
 * garantito: per questo si riconoscono a pezzi, non per uguaglianza.
 */
const SEGNALI = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'failed to load module script',
  'unable to preload css',
  'chunkloaderror',
  'expected a javascript-or-wasm module script',
]

/** Testo leggibile di qualunque cosa arrivi da un catch o da un evento. */
export function testoErrore(errore: unknown): string {
  if (!errore) return ''
  if (typeof errore === 'string') return errore
  if (errore instanceof Error) return `${errore.name} ${errore.message}`
  if (typeof errore === 'object') {
    const o = errore as { message?: unknown; reason?: unknown; error?: unknown }
    if (o.message) return testoErrore(o.message)
    if (o.reason) return testoErrore(o.reason)
    if (o.error) return testoErrore(o.error)
  }
  return String(errore)
}

/**
 * Vero quando l'errore e' quello di una versione nuova pubblicata sotto i piedi,
 * e non un errore del codice della pagina.
 */
export function eErroreDiVersione(errore: unknown): boolean {
  const testo = testoErrore(errore).toLowerCase()
  if (!testo) return false
  return SEGNALI.some((s) => testo.includes(s))
}

export const TITOLO_NUOVA_VERSIONE = 'C’è una versione nuova del gestionale'
export const TESTO_NUOVA_VERSIONE =
  'Ricarica la pagina per continuare. I dati che hai già salvato non si perdono.'
