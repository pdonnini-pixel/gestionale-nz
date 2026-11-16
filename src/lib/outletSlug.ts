// Indirizzo leggibile della scheda di un punto vendita: /outlet/roma-soratte
// invece di /outlet/<uuid>. Lo slug si ricava dal nome; i vecchi link con
// l'id, il nome o il codice continuano a funzionare (vedi trovaOutlet).

type OutletMinimo = { id: string; name?: string | null; code?: string | null }

// Segmenti già usati dalle route sotto /outlet: un punto vendita con questo
// nome tiene l'id nell'indirizzo.
const RISERVATI = new Set(['operativi', 'valutazione'])

/** «ROMA SORATTE» → «roma-soratte»; accenti tolti, tutto il resto diventa trattino. */
export function slugOutlet(name: string | null | undefined): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Segmento da mettere nell'indirizzo per questo punto vendita: lo slug del
 * nome, oppure l'id quando lo slug è vuoto, riservato o condiviso con un
 * altro punto vendita (due negozi con lo stesso nome).
 */
export function segmentoOutlet(outlet: OutletMinimo, tutti: OutletMinimo[]): string {
  const slug = slugOutlet(outlet.name)
  if (!slug || RISERVATI.has(slug)) return outlet.id
  const doppio = tutti.some(o => o.id !== outlet.id && slugOutlet(o.name) === slug)
  return doppio ? outlet.id : slug
}

/** Risolve il segmento dell'indirizzo: id esatto → slug → nome → codice. */
export function trovaOutlet<T extends OutletMinimo>(segmento: string | undefined, tutti: T[]): T | null {
  if (!segmento) return null
  let key = segmento
  try { key = decodeURIComponent(segmento) } catch { /* segmento già in chiaro */ }
  const lower = key.toLowerCase()
  return tutti.find(o => o.id === segmento)
    || tutti.find(o => slugOutlet(o.name) === lower)
    || tutti.find(o => (o.name || '').toLowerCase() === lower)
    || tutti.find(o => (o.code || '').toLowerCase() === lower)
    || null
}

/**
 * Mese di riferimento («2026-11») di una data ISO, letto in ora di Roma:
 * un file caricato il 30/11 alle 23:30 UTC appartiene a dicembre.
 */
export function meseDiRoma(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parti = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' }).formatToParts(d)
  const anno = parti.find(p => p.type === 'year')?.value
  const mese = parti.find(p => p.type === 'month')?.value
  return anno && mese ? `${anno}-${mese}` : ''
}

const MESI_ESTESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

/** «2026-11» → «Novembre 2026». */
export function etichettaMese(chiave: string): string {
  const [anno, mese] = chiave.split('-')
  const nome = MESI_ESTESI[Number(mese) - 1]
  return nome && anno ? `${nome} ${anno}` : 'Senza data'
}

/**
 * Raggruppa per mese di caricamento, dal mese più recente al più vecchio, e
 * dentro ogni mese dal file più recente. Chi non ha data finisce in fondo.
 */
export function raggruppaPerMese<T>(righe: T[], dataDi: (r: T) => string | null | undefined): Array<{ mese: string; righe: T[] }> {
  const gruppi = new Map<string, T[]>()
  for (const r of righe) {
    const mese = meseDiRoma(dataDi(r))
    const lista = gruppi.get(mese)
    if (lista) lista.push(r)
    else gruppi.set(mese, [r])
  }
  return [...gruppi.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : b.localeCompare(a)))
    .map(([mese, lista]) => ({
      mese,
      righe: [...lista].sort((x, y) => String(dataDi(y) || '').localeCompare(String(dataDi(x) || ''))),
    }))
}
