/**
 * Ciclo di vita di un punto vendita, ricavato dalle date di anagrafica.
 *
 * Un outlet può trovarsi in tre stati:
 * - `programmato`: la data di apertura è nel futuro. Costi già in corso
 *   (caparra, canone, allestimento), nessun ricavo. Le pagine analitiche
 *   NON devono trattarlo come un outlet che vende male: rapporti su ricavi
 *   nulli, medie di catena e classifiche lo escludono e lo mostrano con
 *   l'etichetta «In apertura».
 * - `attivo`: aperto al pubblico.
 * - `chiuso`: data di chiusura nel passato (o `is_active = false` senza date).
 *
 * Fonte unica per badge, filtri e medie: sostituisce le copie locali di
 * `getOutletStatus` sparse nelle pagine.
 */
export type OutletLifecycle = 'programmato' | 'attivo' | 'chiuso'

export interface OutletLifecycleFields {
  opening_date?: string | null
  closing_date?: string | null
  is_active?: boolean | null
}

const startOfDay = (d: Date): Date => {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

const parseDate = (v: string | null | undefined): Date | null => {
  if (!v) return null
  const d = new Date(String(v).length === 10 ? `${v}T00:00:00` : String(v))
  return Number.isNaN(d.getTime()) ? null : startOfDay(d)
}

/** Stato alla data `today` (default: oggi). */
export function getOutletLifecycle(o: OutletLifecycleFields | null | undefined, today: Date = new Date()): OutletLifecycle {
  if (!o) return 'attivo'
  const ref = startOfDay(today)
  const opening = parseDate(o.opening_date)
  const closing = parseDate(o.closing_date)
  if (closing && closing < ref) return 'chiuso'
  if (opening && opening > ref) return 'programmato'
  if (!opening) return o.is_active === false ? 'chiuso' : 'attivo'
  return 'attivo'
}

/** Vero se l'outlet è aperto al pubblico nel giorno indicato. */
export function isOutletOpenOn(o: OutletLifecycleFields | null | undefined, date: Date): boolean {
  return getOutletLifecycle(o, date) === 'attivo'
}

/** Vero se l'outlet è aperto almeno un giorno nell'intervallo (mesi 1-12 inclusi). */
export function isOutletOpenInPeriod(
  o: OutletLifecycleFields | null | undefined,
  year: number,
  monthFrom = 1,
  monthTo = 12,
): boolean {
  if (!o) return true
  const periodStart = new Date(year, monthFrom - 1, 1)
  const periodEnd = new Date(year, monthTo, 0) // ultimo giorno di monthTo
  const opening = parseDate(o.opening_date)
  const closing = parseDate(o.closing_date)
  if (opening && opening > periodEnd) return false
  if (closing && closing < periodStart) return false
  if (!opening && o.is_active === false) return false
  return true
}

/** Mesi (1-12) dell'anno in cui l'outlet è aperto almeno un giorno. */
export function monthsOpenInYear(o: OutletLifecycleFields | null | undefined, year: number): number[] {
  const out: number[] = []
  for (let m = 1; m <= 12; m++) if (isOutletOpenInPeriod(o, year, m, m)) out.push(m)
  return out
}

/** Giorni mancanti all'apertura (null se non programmato o senza data). */
export function daysToOpening(o: OutletLifecycleFields | null | undefined, today: Date = new Date()): number | null {
  if (!o || getOutletLifecycle(o, today) !== 'programmato') return null
  const opening = parseDate(o.opening_date)
  if (!opening) return null
  return Math.round((opening.getTime() - startOfDay(today).getTime()) / 86_400_000)
}

export const OUTLET_LIFECYCLE_LABEL: Record<OutletLifecycle, string> = {
  programmato: 'In apertura',
  attivo: 'Attivo',
  chiuso: 'Chiuso',
}

/** Classi Tailwind del badge, condivise da tutte le pagine. */
export const OUTLET_LIFECYCLE_STYLE: Record<OutletLifecycle, string> = {
  programmato: 'bg-blue-50 text-blue-700 border border-blue-200',
  attivo: 'bg-emerald-50 text-emerald-700',
  chiuso: 'bg-slate-100 text-slate-500',
}

/** Etichetta breve con la data, es. «In apertura dal 05/11/2026». */
export function outletLifecycleCaption(o: OutletLifecycleFields | null | undefined, today: Date = new Date()): string {
  const s = getOutletLifecycle(o, today)
  if (s === 'programmato' && o?.opening_date) {
    const d = parseDate(o.opening_date)
    if (d) return `In apertura dal ${d.toLocaleDateString('it-IT')}`
  }
  if (s === 'chiuso' && o?.closing_date) {
    const d = parseDate(o.closing_date)
    if (d) return `Chiuso dal ${d.toLocaleDateString('it-IT')}`
  }
  return OUTLET_LIFECYCLE_LABEL[s]
}

/**
 * Rapporto sicuro: `null` quando il denominatore non è positivo o il risultato
 * non è finito. Le pagine mostrano `null` come «—» / «n/d», mai come 0%.
 */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null
  const r = numerator / denominator
  return Number.isFinite(r) ? r : null
}

export function safePct(numerator: number, denominator: number): number | null {
  const r = safeRatio(numerator, denominator)
  return r === null ? null : r * 100
}
