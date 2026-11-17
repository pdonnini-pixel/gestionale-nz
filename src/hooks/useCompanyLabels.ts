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
 *   - se contiene spazio → cambia solo la prima parola (Punto vendita → Punti vendita)
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
  /**
   * Forme con articolo e preposizione, minuscole, pronte per le frasi.
   * NZ ("Outlet"): l'outlet, dell'outlet, gli outlet, degli outlet.
   * Zago ("Negozio"): il negozio, del negozio, i negozi, dei negozi.
   */
  art: ArticoliPdv
}

export interface ArticoliPdv {
  /** l'outlet / il negozio */
  il: string
  /** dell'outlet / del negozio */
  del: string
  /** nell'outlet / nel negozio */
  nel: string
  /** all'outlet / al negozio */
  al: string
  /** dall'outlet / dal negozio */
  dal: string
  /** un outlet / un negozio */
  un: string
  /** gli outlet / i negozi */
  i: string
  /** degli outlet / dei negozi */
  dei: string
  /** negli outlet / nei negozi */
  nei: string
  /** agli outlet / ai negozi */
  ai: string
  /** dagli outlet / dai negozi */
  dai: string
}

/**
 * Articoli italiani maschili per l'etichetta del punto vendita (Outlet, Negozio,
 * Punto vendita, Store). Vocale → l'/gli; s+consonante, z, gn, ps, x, y → lo/gli;
 * altrimenti il/i.
 */
export function articoliPdv(singularLower: string, pluralLower: string): ArticoliPdv {
  const w = singularLower.trim()
  const vocale = /^[aeiouàèéìòù]/.test(w)
  const lo = !vocale && /^(s[^aeiou]|z|gn|ps|x|y)/.test(w)
  if (vocale) {
    return {
      il: `l'${w}`, del: `dell'${w}`, nel: `nell'${w}`, al: `all'${w}`, dal: `dall'${w}`, un: `un ${w}`,
      i: `gli ${pluralLower}`, dei: `degli ${pluralLower}`, nei: `negli ${pluralLower}`, ai: `agli ${pluralLower}`, dai: `dagli ${pluralLower}`,
    }
  }
  if (lo) {
    return {
      il: `lo ${w}`, del: `dello ${w}`, nel: `nello ${w}`, al: `allo ${w}`, dal: `dallo ${w}`, un: `uno ${w}`,
      i: `gli ${pluralLower}`, dei: `degli ${pluralLower}`, nei: `negli ${pluralLower}`, ai: `agli ${pluralLower}`, dai: `dagli ${pluralLower}`,
    }
  }
  return {
    il: `il ${w}`, del: `del ${w}`, nel: `nel ${w}`, al: `al ${w}`, dal: `dal ${w}`, un: `un ${w}`,
    i: `i ${pluralLower}`, dei: `dei ${pluralLower}`, nei: `nei ${pluralLower}`, ai: `ai ${pluralLower}`, dai: `dai ${pluralLower}`,
  }
}

/** Etichette calcolate da un singolare (anche fuori da React: librerie, export). */
export function labelsDa(singolare: string | null | undefined): CompanyLabels {
  const singular = singolare?.trim() || 'Outlet'
  const plural = pluralize(singular)
  return {
    pointOfSale: singular,
    pointOfSalePlural: plural,
    pointOfSaleLower: singular.toLowerCase(),
    pointOfSalePluralLower: plural.toLowerCase(),
    art: articoliPdv(singular.toLowerCase(), plural.toLowerCase()),
  }
}

function pluralize(singular: string): string {
  const trimmed = singular.trim()
  if (!trimmed) return trimmed

  // In italiano il nome che va al plurale è il primo: Punto vendita → Punti vendita.
  const parts = trimmed.split(/\s+/)
  const last = parts[0]
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
  parts[0] = pluralLast
  return parts.join(' ')
}

function isUpper(ch: string): boolean {
  return ch === ch.toUpperCase() && ch !== ch.toLowerCase()
}

export function useCompanyLabels(): CompanyLabels {
  const { company } = useCompany()
  return useMemo(() => labelsDa(company?.point_of_sale_label), [company?.point_of_sale_label])
}
