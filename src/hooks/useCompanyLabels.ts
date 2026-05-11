import { useMemo } from 'react'
import { useCompany } from './useCompany'

/**
 * Restituisce le label terminologiche del tenant attivo.
 *
 * Il singolare è quello scelto al wizard onboarding (`companies.point_of_sale_label`).
 * Il plurale italiano coincide quasi sempre con il singolare ("Outlet", "Negozi",
 * "Boutique", "Punti vendita") — applichiamo una regola minimale:
 *   - se finisce per "o" (singular m.) → plurale "i" (Negozio → Negozi)
 *   - se finisce per "e" (singular m./f. invariato breve) → "e" come "valigette" — restiamo invariati per "Boutique"
 *   - se contiene spazio → cambia solo l'ultima parola (Punto vendita → Punti vendita)
 *   - in caso di dubbio, lascia identico al singolare
 *
 * Il fallback se non c'è ancora company caricata è "Outlet"/"Outlet" (storia
 * NZ) per non rompere nessuna pagina già renderizzata pre-loading.
 *
 * Esempi:
 *   "Outlet"        → singular "Outlet",        plural "Outlet"
 *   "Negozio"       → singular "Negozio",       plural "Negozi"
 *   "Boutique"      → singular "Boutique",      plural "Boutique"
 *   "Store"         → singular "Store",         plural "Store"
 *   "Punto vendita" → singular "Punto vendita", plural "Punti vendita"
 */
export interface CompanyLabels {
  pointOfSale: string
  pointOfSalePlural: string
  /** Lowercase singolare per usi inline ("crea un nuovo {label}") */
  pointOfSaleLower: string
  /** Lowercase plurale */
  pointOfSalePluralLower: string
}

function pluralize(singular: string): string {
  const trimmed = singular.trim()
  if (!trimmed) return trimmed

  const parts = trimmed.split(/\s+/)
  const last = parts[parts.length - 1]
  const lower = last.toLowerCase()

  // Italiano: -o → -i (Punto → Punti, Negozio → Negozi)
  // Non applichiamo se la parola è troppo corta o sembra inglese
  let pluralLast: string
  if (lower.endsWith('io') && lower.length > 2) {
    // -io → -i (Negozio → Negozi, Ufficio → Uffici, Esempio → Esempi).
    // Rimuoviamo "io" e aggiungiamo "i" (NON "ii"). Caso speciale:
    // senza questo branch, "Negozio" diventerebbe "Negozii" (bug).
    pluralLast = last.slice(0, -2) + (isUpper(last.slice(-1)) ? 'I' : 'i')
  } else if (lower.endsWith('o') && lower.length > 2) {
    // -o → -i (Punto → Punti, Letto → Letti)
    pluralLast = last.slice(0, -1) + (isUpper(last.slice(-1)) ? 'I' : 'i')
  } else if (lower.endsWith('a') && lower.length > 2) {
    // -a → -e (Boutique è eccezione invariabile, ma "Boutique" finisce in "e" non "a")
    pluralLast = last.slice(0, -1) + (isUpper(last.slice(-1)) ? 'E' : 'e')
  } else {
    // -e (Boutique, Outlet/Store inglese, ecc.) → invariato
    pluralLast = last
  }
  parts[parts.length - 1] = pluralLast
  return parts.join(' ')
}

function isUpper(ch: string): boolean {
  return ch === ch.toUpperCase() && ch !== ch.toLowerCase()
}

export function useCompanyLabels(): CompanyLabels {
  const { company } = useCompany()
  return useMemo(() => {
    const singular = company?.point_of_sale_label?.trim() || 'Outlet'
    const plural = pluralize(singular)
    return {
      pointOfSale: singular,
      pointOfSalePlural: plural,
      pointOfSaleLower: singular.toLowerCase(),
      pointOfSalePluralLower: plural.toLowerCase(),
    }
  }, [company?.point_of_sale_label])
}
