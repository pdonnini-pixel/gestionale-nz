// Indirizzo leggibile della scheda di una persona (Patrizio, 16/11/2026: «una scheda
// sola, una pagina intera»): /dipendenti/giulia-rinaldi invece di un id. La sezione
// aperta sta nell'indirizzo (/dipendenti/giulia-rinaldi/turni), cosi' ricaricando si
// resta li'. Due persone con lo stesso nome tengono l'id; il vecchio link con l'id
// continua ad aprire la stessa scheda.

import { slugOutlet } from './outletSlug'

export type PersonaMinima = {
  id: string
  nome?: string | null
  cognome?: string | null
  first_name?: string | null
  last_name?: string | null
}

/** Le sezioni della scheda, nell'ordine in cui compaiono. La prima non ha suffisso. */
export const SEZIONI_SCHEDA = [
  { k: 'contratto', label: 'Contratto' },
  { k: 'turni', label: 'Turni e disponibilità' },
  { k: 'ferie', label: 'Ferie e permessi' },
  { k: 'documenti', label: 'Documenti' },
  { k: 'netti', label: 'Netti' },
] as const
export type SezioneScheda = (typeof SEZIONI_SCHEDA)[number]['k']

/** «Giulia Rinaldi» → «giulia-rinaldi» (nome poi cognome; accenti tolti). */
export function slugDipendente(p: PersonaMinima): string {
  const nome = p.nome || p.first_name || ''
  const cognome = p.cognome || p.last_name || ''
  return slugOutlet(`${nome} ${cognome}`)
}

/** Il segmento dell'indirizzo per questa persona: lo slug, o l'id se vuoto o condiviso. */
export function segmentoDipendente(p: PersonaMinima, tutti: PersonaMinima[]): string {
  const slug = slugDipendente(p)
  if (!slug || /^[0-9a-f-]{36}$/.test(slug) || SEZIONI_SCHEDA.some((s) => s.k === slug)) return p.id
  const doppio = tutti.some((o) => o.id !== p.id && slugDipendente(o) === slug)
  return doppio ? p.id : slug
}

/** Risolve il segmento: id esatto, poi slug, poi «cognome-nome» scritto al contrario. */
export function trovaDipendente<T extends PersonaMinima>(segmento: string | undefined, tutti: T[]): T | null {
  if (!segmento) return null
  let key = segmento
  try { key = decodeURIComponent(segmento) } catch { /* gia' in chiaro */ }
  const lower = key.toLowerCase()
  const perId = tutti.find((p) => p.id === key)
  if (perId) return perId
  const perSlug = tutti.filter((p) => slugDipendente(p) === lower)
  if (perSlug.length === 1) return perSlug[0]
  const rovescio = tutti.filter((p) => slugOutlet(`${p.cognome || p.last_name || ''} ${p.nome || p.first_name || ''}`) === lower)
  return rovescio.length === 1 ? rovescio[0] : null
}

/**
 * Come `trovaDipendente`, ma dice anche perche' non trova nessuno:
 *  - `omonimi`: lo slug corrisponde a piu' persone (vecchio link salvato prima che arrivasse
 *    un'omonima): la pagina le elenca e ognuna porta al suo indirizzo con l'id;
 *  - `ultimoId`: l'id della persona aperta un attimo fa. Dopo aver corretto nome o cognome lo
 *    slug dell'indirizzo non trova piu' nessuno, ma la persona e' la stessa: si tiene lei, e la
 *    pagina riscrive l'indirizzo con lo slug nuovo (revisore codice, 16/11/2026).
 */
export function risolviDipendente<T extends PersonaMinima>(segmento: string | undefined, tutti: T[], ultimoId?: string | null): { persona: T | null; omonimi: T[] } {
  const trovata = trovaDipendente(segmento, tutti)
  if (trovata) return { persona: trovata, omonimi: [] }
  let key = segmento ?? ''
  try { key = decodeURIComponent(key) } catch { /* gia' in chiaro */ }
  const lower = key.toLowerCase()
  const omonimi = lower ? tutti.filter((p) => slugDipendente(p) === lower) : []
  if (omonimi.length > 1) return { persona: null, omonimi }
  const ultima = ultimoId ? tutti.find((p) => p.id === ultimoId) ?? null : null
  return { persona: ultima, omonimi: [] }
}

/** La sezione dall'indirizzo; un suffisso sconosciuto o assente vale «contratto». */
export function sezioneDa(seg: string | undefined): SezioneScheda {
  return (SEZIONI_SCHEDA.find((s) => s.k === seg)?.k ?? 'contratto') as SezioneScheda
}

/** Il percorso della scheda: /dipendenti/<persona> per la prima sezione, /<sezione> per le altre. */
export function percorsoDipendente(segmento: string, sezione: SezioneScheda = 'contratto'): string {
  return sezione === 'contratto' ? `/dipendenti/${segmento}` : `/dipendenti/${segmento}/${sezione}`
}
