// Quadratura della Prima Nota con l'estratto conto e con la cassa.
//
// Idea di Patrizio (15/09/2026): un estratto conto ha saldo iniziale e saldo
// finale, e tutta la movimentazione sta nella differenza. Se saldo iniziale +
// i movimenti che abbiamo noi = saldo finale della banca, l'export è completo:
// nessun movimento mancante, nessun doppione. Su agosto 2026 NZ i quattro
// conti quadrano al centesimo (BCC 72.133,46 − 39.053,94 = 33.079,52).
//
// Da dove vengono i saldi: ogni movimento scaricato da A-Cube porta in
// raw_data.extra.accountBalanceSnapshot il saldo del conto al momento dello
// scarico (raw_data.fetchedAt). L'ultimo scarico prima dell'inizio del periodo
// dà il saldo iniziale, l'ultimo scarico entro la fine del periodo il saldo
// finale: due numeri della banca, indipendenti dai nostri movimenti.
//
// Casi di orario, gestiti e mostrati, non nascosti:
//   - un movimento datato nel periodo ma scaricato DOPO l'ultimo scarico del
//     periodo non è ancora nel saldo finale della banca: resta nell'export ma
//     esce dalla quadratura («arrivati dopo lo scarico»);
//   - un movimento datato PRIMA del periodo ma scaricato dentro il periodo
//     (es. una competenza retrodatata) è nel saldo finale ma non nel saldo
//     iniziale: si aggiunge («di periodi precedenti, arrivati nel periodo»);
//   - un movimento che la banca ha GIÀ tolto (o aggiunto) nel saldo dello
//     scarico ma ci consegna giorni dopo, tipico dei pagamenti con carta:
//     l'operazione è del 29/10, il saldo del 30/10 la conta già, il movimento
//     arriva il 03/11 con data contabile 03/11. Caso BCC ottobre 2026: quattro
//     pagamenti carta per 129,91. Si riconoscono dai numeri (vedi
//     cercaAnticipati) e si mostrano («già nel saldo della banca, registrati
//     dopo»), così la quadratura non segnala una differenza che non c'è.
//
// Contante: la banca vede solo versamenti e prelievi. Il resto del contante
// (incassato nei negozi, speso in cassa, versato) sta nelle chiusure di cassa,
// dal 01/09/2026. La quadratura cassa è quella delle chiusure (cashClosings.ts):
// fondo + da versare a inizio periodo + contanti incassati − spese − rimborsi
// − versamenti = fondo + da versare a fine periodo.

export type PnTxSnapshot = {
  id: string
  bank_account_id: string | null
  /** Data su cui si ragiona (operazione o contabile, la scelgono i filtri della pagina), YYYY-MM-DD. */
  date: string
  amount: number
  description?: string | null
  /** Data dell'operazione (transaction_date), qualunque sia la data scelta: serve a riconoscere i movimenti che la banca aveva già nel saldo prima di consegnarli. */
  op_date?: string | null
  /** raw_data.fetchedAt (ISO) */
  fetched_at: string | null
  /** raw_data.extra.accountBalanceSnapshot */
  snapshot: number | null
}

/** Rettifica di un saldo allo scarico per portarlo alla data: movimenti da aggiungere e da togliere. */
export type Rettifica = {
  /** Datati entro la data ma arrivati DOPO lo scarico: non sono nel saldo della banca, si aggiungono. */
  piu: PnTxSnapshot[]
  /** Datati DOPO la data ma già nello scarico (es. data contabile nel mese dopo): sono nel saldo della banca, si tolgono. */
  meno: PnTxSnapshot[]
}

export type QuadraturaConto = {
  bank_account_id: string
  /** Saldo letto dalla banca all'ultimo scarico prima del periodo (e quando). */
  saldo_scarico_iniziale: number | null
  scaricato_iniziale: string | null
  rettifica_iniziale: Rettifica
  /** Saldo al giorno prima del periodo = saldo allo scarico + piu − meno. */
  saldo_iniziale: number | null
  /** Saldo letto dalla banca all'ultimo scarico entro la fine del periodo (e quando). */
  saldo_scarico_finale: number | null
  scaricato_finale: string | null
  rettifica_finale: Rettifica
  /** Saldo all'ultimo giorno del periodo = saldo allo scarico + piu − meno. */
  saldo_finale: number | null
  /** Movimenti del periodo, in ordine di data (e id). */
  movimenti: PnTxSnapshot[]
  n_movimenti: number
  entrate: number
  uscite: number
  /** saldo iniziale + tutti i movimenti del periodo. */
  saldo_finale_calcolato: number | null
  differenza: number | null
  stato: 'quadra' | 'non_quadra' | 'senza_saldi'
  /**
   * Movimenti che la banca aveva già contato nel saldo dello scarico (iniziale
   * o finale) ma ha consegnato dopo: spiegano al centesimo la differenza che
   * altrimenti resterebbe, e sono già dentro saldo_iniziale / saldo_finale.
   */
  anticipati_iniziale: PnTxSnapshot[]
  anticipati_finale: PnTxSnapshot[]
  /**
   * Solo se non quadra: lo scarico in cui il saldo della banca si stacca dai
   * movimenti arrivati (e non si riallinea più entro il periodo). Dice in che
   * giorno cercare sull'estratto.
   */
  nasce_allo_scarico: string | null
}

const r2 = (n: number): number => Math.round(n * 100) / 100
const num = (v: unknown): number => Number(v) || 0

/** Legge scarico e saldo dal raw_data A-Cube di un movimento (tollerante: null se mancano). */
export function snapshotFromRaw(raw: unknown): { fetched_at: string | null; snapshot: number | null } {
  if (!raw || typeof raw !== 'object') return { fetched_at: null, snapshot: null }
  const r = raw as { fetchedAt?: unknown; extra?: { accountBalanceSnapshot?: unknown } | null }
  const fetched_at = typeof r.fetchedAt === 'string' ? r.fetchedAt : null
  const s = r.extra && typeof r.extra === 'object' ? r.extra.accountBalanceSnapshot : null
  const snapshot = s == null || s === '' || !Number.isFinite(Number(s)) ? null : Number(s)
  return { fetched_at, snapshot }
}

const latestWithSnapshot = (rows: PnTxSnapshot[]): PnTxSnapshot | null => {
  let best: PnTxSnapshot | null = null
  for (const r of rows) {
    if (r.snapshot == null || !r.fetched_at) continue
    if (!best || r.fetched_at > (best.fetched_at as string)) best = r
  }
  return best
}

const sum = (rows: PnTxSnapshot[]): number => rows.reduce((s, r) => s + r.amount, 0)

/** Giorno dopo (YYYY-MM-DD). */
export const nextDay = (ymd: string): string => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Saldo del conto a fine giornata D, ricavato da uno scarico della banca: il
 * saldo allo scarico contiene tutto ciò che era stato scaricato fino a quel
 * momento, qualunque data avesse. Per portarlo alla data D:
 *   + movimenti datati ≤ D ma arrivati dopo lo scarico (non ancora nel saldo);
 *   − movimenti datati > D ma già nello scarico (nel saldo, ma non di competenza).
 */
function saldoAllaData(rows: PnTxSnapshot[], snap: PnTxSnapshot | null, day: string): { saldo: number | null; rettifica: Rettifica } {
  if (!snap || snap.snapshot == null || !snap.fetched_at) return { saldo: null, rettifica: { piu: [], meno: [] } }
  const f = snap.fetched_at
  const piu = rows.filter(r => r.date <= day && r.fetched_at && r.fetched_at > f)
  const meno = rows.filter(r => r.date > day && (!r.fetched_at || r.fetched_at <= f))
  return { saldo: r2(snap.snapshot + sum(piu) - sum(meno)), rettifica: { piu, meno } }
}

const cents = (n: number): number => Math.round(n * 100)
const GIORNI_ANTICIPO = 10
const MAX_CANDIDATI = 12

/**
 * Movimenti che la banca poteva avere già nel saldo dello scarico `snap` pur
 * consegnandoli dopo: operazione fatta entro il giorno dello scarico, arrivati
 * nei dieci giorni successivi.
 */
function candidatiAnticipati(rows: PnTxSnapshot[], snap: PnTxSnapshot | null): PnTxSnapshot[] {
  if (!snap || !snap.fetched_at) return []
  const f = snap.fetched_at
  const giorno = f.slice(0, 10)
  const limite = new Date(new Date(f).getTime() + GIORNI_ANTICIPO * 86400000).toISOString()
  return rows
    .filter(r => r.fetched_at && r.fetched_at > f && r.fetched_at <= limite && r.op_date && r.op_date <= giorno && cents(r.amount) !== 0)
    .sort((a, b) => (a.fetched_at as string).localeCompare(b.fetched_at as string) || a.id.localeCompare(b.id))
    .slice(0, MAX_CANDIDATI)
}

const bits = (m: number): number => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n }

/**
 * Cerca i movimenti già contati dalla banca nei due saldi che spiegano la
 * differenza al centesimo: somma(anticipati finali) − somma(anticipati
 * iniziali) = differenza. Fra le combinazioni possibili vince la più piccola.
 * Null se nessuna combinazione torna: allora la differenza è vera.
 */
function cercaAnticipati(candIni: PnTxSnapshot[], candFin: PnTxSnapshot[], differenza: number): { ini: PnTxSnapshot[]; fin: PnTxSnapshot[] } | null {
  const target = cents(differenza)
  const somme = (c: PnTxSnapshot[]): number[] => {
    const out = new Array<number>(1 << c.length).fill(0)
    for (let m = 1; m < out.length; m++) { const low = m & -m; out[m] = out[m ^ low] + cents(c[31 - Math.clz32(low)].amount) }
    return out
  }
  const sIni = somme(candIni)
  const sFin = somme(candFin)
  // somma → maschera più piccola, lato iniziale
  const perSomma = new Map<number, number>()
  sIni.forEach((v, m) => { const cur = perSomma.get(v); if (cur == null || bits(m) < bits(cur)) perSomma.set(v, m) })
  let best: { mi: number; mf: number; n: number } | null = null
  sFin.forEach((v, mf) => {
    const mi = perSomma.get(v - target)
    if (mi == null) return
    const n = bits(mi) + bits(mf)
    if (n > 0 && (!best || n < best.n)) best = { mi, mf, n }
  })
  if (!best) return null
  const { mi, mf } = best as { mi: number; mf: number; n: number }
  return { ini: candIni.filter((_, i) => mi & (1 << i)), fin: candFin.filter((_, i) => mf & (1 << i)) }
}

/**
 * Lo scarico in cui nasce una differenza non spiegata: si segue la catena
 * degli scarichi fra il saldo iniziale e quello finale (saldo di uno scarico −
 * saldo del precedente − movimenti arrivati con quello scarico) e si prende
 * l'inizio dell'ultimo tratto in cui lo scarto accumulato non torna a zero.
 */
function scaricoDoveNasce(rows: PnTxSnapshot[], ini: PnTxSnapshot, fin: PnTxSnapshot): string | null {
  const gruppi = new Map<string, { snap: number; tot: number }>()
  for (const r of rows) {
    if (!r.fetched_at || r.snapshot == null || r.fetched_at <= (ini.fetched_at as string) || r.fetched_at > (fin.fetched_at as string)) continue
    const g = gruppi.get(r.fetched_at) ?? { snap: r.snapshot, tot: 0 }
    g.tot += r.amount
    gruppi.set(r.fetched_at, g)
  }
  let prev = ini.snapshot as number
  let cum = 0
  let nasce: string | null = null
  for (const f of Array.from(gruppi.keys()).sort()) {
    const g = gruppi.get(f) as { snap: number; tot: number }
    cum += cents(g.snap) - cents(prev) - cents(g.tot)
    if (cum === 0) nasce = null
    else if (nasce == null) nasce = f
    prev = g.snap
  }
  return nasce
}

/**
 * Quadratura di un conto sul periodo [periodStart, periodEnd] per la data
 * scelta (operazione o contabile), come la vuole lo studio.
 *
 * Il saldo allo scarico è il saldo di quel momento, non del confine del mese:
 * saldo iniziale = saldo dell'ultimo scarico prima del periodo portato al
 * giorno prima; saldo finale = saldo dell'ultimo scarico entro la fine del
 * periodo portato all'ultimo giorno (vedi saldoAllaData). La parte
 * indipendente resta il confronto fra due saldi della banca e i movimenti
 * scaricati fra i due: se quadra, l'export è completo.
 *
 * @param rows tutti i movimenti del conto in una finestra larga (qualche
 *   settimana prima e dopo il periodo), con la data scelta in `date`
 */
export function quadraturaConto(bank_account_id: string, rows: PnTxSnapshot[], periodStart: string, periodEnd: string): QuadraturaConto {
  const startInstant = `${periodStart}T00:00:00Z`
  const endExclusive = `${nextDay(periodEnd)}T00:00:00Z`
  const ini = latestWithSnapshot(rows.filter(r => r.fetched_at && r.fetched_at < startInstant))
  const fin = latestWithSnapshot(rows.filter(r => r.fetched_at && r.fetched_at < endExclusive))

  const inizio = saldoAllaData(rows, ini, prevDay(periodStart))
  const fine = saldoAllaData(rows, fin, periodEnd)

  const movimenti = rows
    .filter(r => r.date >= periodStart && r.date <= periodEnd)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const entrate = r2(movimenti.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0))
  const uscite = r2(movimenti.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0))

  let saldo_iniziale = inizio.saldo
  let saldo_finale = fine.saldo
  let saldo_finale_calcolato = saldo_iniziale == null ? null : r2(saldo_iniziale + sum(movimenti))
  let differenza = saldo_finale == null || saldo_finale_calcolato == null ? null : r2(saldo_finale - saldo_finale_calcolato)
  let anticipati_iniziale: PnTxSnapshot[] = []
  let anticipati_finale: PnTxSnapshot[] = []
  let nasce_allo_scarico: string | null = null
  if (differenza != null && Math.abs(differenza) >= 0.005 && saldo_iniziale != null && saldo_finale != null) {
    // La banca conta già nel saldo movimenti che consegna dopo: se bastano loro
    // a spiegare la differenza al centesimo, i saldi si portano alla data vera.
    const trovati = cercaAnticipati(candidatiAnticipati(rows, ini), candidatiAnticipati(rows, fin), differenza)
    if (trovati) {
      anticipati_iniziale = trovati.ini
      anticipati_finale = trovati.fin
      saldo_iniziale = r2(saldo_iniziale - sum(trovati.ini))
      saldo_finale = r2(saldo_finale - sum(trovati.fin))
      saldo_finale_calcolato = r2(saldo_iniziale + sum(movimenti))
      differenza = r2(saldo_finale - saldo_finale_calcolato)
    } else if (ini && fin) {
      nasce_allo_scarico = scaricoDoveNasce(rows, ini, fin)
    }
  }
  const stato: QuadraturaConto['stato'] = differenza == null ? 'senza_saldi' : Math.abs(differenza) < 0.005 ? 'quadra' : 'non_quadra'

  return {
    bank_account_id,
    saldo_scarico_iniziale: ini?.snapshot ?? null, scaricato_iniziale: ini?.fetched_at ?? null, rettifica_iniziale: inizio.rettifica, saldo_iniziale,
    saldo_scarico_finale: fin?.snapshot ?? null, scaricato_finale: fin?.fetched_at ?? null, rettifica_finale: fine.rettifica, saldo_finale,
    movimenti, n_movimenti: movimenti.length, entrate, uscite, saldo_finale_calcolato, differenza, stato,
    anticipati_iniziale, anticipati_finale, nasce_allo_scarico,
  }
}

/** Giorno prima (YYYY-MM-DD). */
export const prevDay = (ymd: string): string => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Raggruppa per conto e quadra ogni conto. */
export function quadraturaConti(rows: PnTxSnapshot[], periodStart: string, periodEnd: string): QuadraturaConto[] {
  const ids = new Set<string>()
  for (const r of rows) if (r.bank_account_id) ids.add(r.bank_account_id)
  return Array.from(ids).map(id => quadraturaConto(id, rows.filter(r => r.bank_account_id === id), periodStart, periodEnd))
}

/**
 * Saldo progressivo dopo ogni movimento (nell'ordine dato), a partire dal
 * saldo iniziale; null se il saldo iniziale non è noto. A fine giornata è
 * esatto; l'ordine dentro la stessa giornata è quello dell'elenco.
 */
export function saldiProgressivi(movimenti: Array<{ amount: number }>, saldoIniziale: number | null): Array<number | null> {
  if (saldoIniziale == null) return movimenti.map(() => null)
  let s = saldoIniziale
  return movimenti.map(m => { s = r2(s + m.amount); return s })
}

// --- Contante ---------------------------------------------------------------

const RE_PRELIEVO = /PREL\.?\s*CONT|PRELEVAMENTO|PRELIEVO/i

/** Prelievo di contante dal conto (uscita). */
export const isPrelievo = (m: { amount: number; description: string | null | undefined }): boolean => m.amount < 0 && RE_PRELIEVO.test(m.description ?? '')

export type PnClosingLite = {
  outlet_id: string
  closing_date: string
  status: string
  cash_deposit: number | null
  deposit_bank_amount: number | null
  deposit_bank_status: string | null
  cash_expenses: number | null
  customer_refunds: number | null
  cash_float_opening: number | null
  cash_pending_opening: number | null
  cash_float_declared: number | null
  cash_pending_declared: number | null
  /** Somma delle righe «Contanti» della chiusura. */
  contanti: number
}

export type QuadraturaContante = {
  /** Lato banca */
  versamenti_banca: number
  n_versamenti_banca: number
  prelievi_banca: number
  n_prelievi_banca: number
  /** Lato cassa (chiusure), null se nessuna chiusura nel periodo */
  cassa: null | {
    n_chiusure: number
    outlets: number
    dal: string
    al: string
    /** Fondo + da versare della prima chiusura di ogni outlet; null se almeno un outlet parte senza fondo noto. */
    fondo_iniziale: number | null
    contanti_incassati: number
    spese: number
    rimborsi: number
    versamenti_dichiarati: number
    n_versamenti_dichiarati: number
    versamenti_trovati_in_banca: number
    n_versamenti_trovati: number
    fondo_finale: number | null
    fondo_finale_calcolato: number | null
    differenza: number | null
  }
}

export function quadraturaContante(
  bankMovements: Array<{ amount: number; description: string | null | undefined; isVersamento: boolean }>,
  closings: PnClosingLite[],
): QuadraturaContante {
  const vers = bankMovements.filter(m => m.isVersamento && m.amount > 0)
  const prel = bankMovements.filter(isPrelievo)
  const base = {
    versamenti_banca: r2(vers.reduce((s, m) => s + m.amount, 0)),
    n_versamenti_banca: vers.length,
    prelievi_banca: r2(prel.reduce((s, m) => s - m.amount, 0)),
    n_prelievi_banca: prel.length,
  }
  if (closings.length === 0) return { ...base, cassa: null }

  const byOutlet = new Map<string, PnClosingLite[]>()
  for (const c of closings) {
    const list = byOutlet.get(c.outlet_id) ?? []
    list.push(c)
    byOutlet.set(c.outlet_id, list)
  }
  let fondo_iniziale: number | null = 0
  let fondo_finale: number | null = 0
  for (const list of byOutlet.values()) {
    list.sort((a, b) => a.closing_date.localeCompare(b.closing_date))
    const first = list[0]
    const last = list[list.length - 1]
    if (first.cash_float_opening == null || fondo_iniziale == null) fondo_iniziale = null
    else fondo_iniziale += num(first.cash_float_opening) + num(first.cash_pending_opening)
    if (last.cash_float_declared == null || fondo_finale == null) fondo_finale = null
    else fondo_finale += num(last.cash_float_declared) + num(last.cash_pending_declared)
  }
  const contanti_incassati = r2(closings.reduce((s, c) => s + num(c.contanti), 0))
  const spese = r2(closings.reduce((s, c) => s + num(c.cash_expenses), 0))
  const rimborsi = r2(closings.reduce((s, c) => s + num(c.customer_refunds), 0))
  const dep = closings.filter(c => num(c.cash_deposit) > 0)
  const versamenti_dichiarati = r2(dep.reduce((s, c) => s + num(c.cash_deposit), 0))
  const trovati = dep.filter(c => c.deposit_bank_status === 'accreditato')
  const versamenti_trovati_in_banca = r2(trovati.reduce((s, c) => s + num(c.deposit_bank_amount ?? c.cash_deposit), 0))
  const fondo_finale_calcolato = fondo_iniziale == null ? null : r2(fondo_iniziale + contanti_incassati - spese - rimborsi - versamenti_dichiarati)
  const differenza = fondo_finale == null || fondo_finale_calcolato == null ? null : r2(fondo_finale - fondo_finale_calcolato)
  const dates = closings.map(c => c.closing_date).sort()
  return {
    ...base,
    cassa: {
      n_chiusure: closings.length, outlets: byOutlet.size, dal: dates[0], al: dates[dates.length - 1],
      fondo_iniziale: fondo_iniziale == null ? null : r2(fondo_iniziale),
      contanti_incassati, spese, rimborsi,
      versamenti_dichiarati, n_versamenti_dichiarati: dep.length,
      versamenti_trovati_in_banca, n_versamenti_trovati: trovati.length,
      fondo_finale: fondo_finale == null ? null : r2(fondo_finale),
      fondo_finale_calcolato, differenza,
    },
  }
}
