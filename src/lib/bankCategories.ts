/**
 * Vocabolario categorie contabili dei movimenti bancari.
 *
 * Gli slug (income, fees, wages, …) sono quelli prodotti dall'arricchimento
 * automatico A-Cube e salvati in `bank_transactions.category` (TEXT, no FK).
 * A-Cube è la sorgente del vocabolario: qui mappiamo gli slug a etichette
 * italiane leggibili per l'utente (non tecnico). Unica fonte condivisa: usare
 * questa costante ovunque serva mostrare/assegnare la categoria, per non
 * divergere.
 */

// Slug → etichetta italiana. L'ordine definisce anche l'ordine nel menu.
export const BANK_CATEGORY_LABELS: Record<string, string> = {
  income: 'Ricavi / Incassi',
  financials: 'Movimenti finanziari',
  fees: 'Commissioni',
  loans: 'Finanziamenti',
  wages: 'Stipendi',
  utilities: 'Utenze',
  taxes: 'Imposte',
  meals: 'Pasti / Ristorazione',
  contractors: 'Collaboratori / Servizi',
  transport: 'Trasporti',
  real_estate: 'Immobili / Affitti',
  storage: 'Magazzino / Stoccaggio',
  returns: 'Rimborsi / Resi',
}

// Opzioni selezionabili nel menu di assegnazione (slug + etichetta).
export const BANK_CATEGORY_OPTIONS: Array<{ value: string; label: string }> =
  Object.entries(BANK_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))

/**
 * Etichetta italiana per uno slug. Per slug non in mappa (es. valori A-Cube
 * legacy come "taxi" o "uncategorized") ritorna una versione leggibile dello
 * slug invece del valore tecnico grezzo. category vuota/null → null.
 */
export function bankCategoryLabel(slug: string | null | undefined): string | null {
  if (!slug) return null
  if (BANK_CATEGORY_LABELS[slug]) return BANK_CATEGORY_LABELS[slug]
  // Fallback leggibile: "real_estate" → "Real estate"
  const humanized = slug.replace(/_/g, ' ')
  return humanized.charAt(0).toUpperCase() + humanized.slice(1)
}
