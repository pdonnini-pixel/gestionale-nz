/**
 * Formatter helpers — uniformazione presentazione dati al rendering.
 *
 * Pattern: ogni funzione gestisce input null/undefined/empty con fallback
 * sicuro ('—' per stringhe), mai eccezioni a runtime.
 */

/**
 * formatOutletName — normalizza il nome di un outlet per il rendering UI.
 *
 * Regole:
 *  - input vuoto/null/undefined → '—'
 *  - codice outlet (3-4 lettere maiuscole, es. "BRB", "VLM") → preservato
 *    invariato (è un identificativo, non un nome user-friendly)
 *  - tutto il resto → Title Case ("BRUNICO" → "Brunico", "valmontone outlet"
 *    → "Valmontone Outlet")
 *
 * Motivazione (fix 8.3): nel DB i nomi outlet sono salvati in modo
 * disomogeneo (alcuni in maiuscolo, altri in title case). Senza un helper
 * centralizzato, l'UI mostra "BRUNICO" in una pagina e "Brunico" in un'altra,
 * creando l'impressione che siano outlet diversi.
 */
export function formatOutletName(name) {
  if (name == null) return '—'
  if (typeof name !== 'string') return '—'
  const trimmed = name.trim()
  if (!trimmed) return '—'

  // Codici outlet (3-4 lettere tutte maiuscole) → preserva invariato
  if (/^[A-Z]{3,4}$/.test(trimmed)) return trimmed

  // Title Case su parole separate da spazio
  return trimmed
    .toLowerCase()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

/**
 * shortOutletName — versione compatta per header card / chart label.
 * Restituisce la prima parola normalizzata (es. "Brunico Outlet" → "Brunico").
 */
export function shortOutletName(name) {
  const formatted = formatOutletName(name)
  if (formatted === '—') return '—'
  return formatted.split(' ')[0]
}
