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
//     iniziale: si aggiunge («di periodi precedenti, arrivati nel periodo»).
//
// Contante: la banca vede solo versamenti e prelievi. Il resto del contante
// (incassato nei negozi, speso in cassa, versato) sta nelle chiusure di cassa,
// dal 01/09/2026. La quadratura cassa è quella delle chiusure (cashClosings.ts):
// fondo + da versare a inizio periodo + contanti incassati − spese − rimborsi
// − versamenti = fondo + da versare a fine periodo.

export type PnTxSnapshot = {
  id: string
  bank_account_id: string | null
  transaction_date: string
  amount: number
  description?: string | null
  /** raw_data.fetchedAt (ISO) */
  fetched_at: string | null
  /** raw_data.extra.accountBalanceSnapshot */
  snapshot: number | null
}

export type QuadraturaConto = {
  bank_account_id: string
  /** Saldo della banca all'ultimo scarico prima del periodo; null se non disponibile. */
  saldo_iniziale: number | null
  scaricato_iniziale: string | null
  /** Saldo della banca all'ultimo scarico entro la fine del periodo; null se non disponibile. */
  saldo_finale: number | null
  scaricato_finale: string | null
  n_movimenti: number
  entrate: number
  uscite: number
  /** Movimenti del periodo scaricati dopo lo scarico finale: fuori quadratura, dentro l'export. */
  arrivati_dopo: PnTxSnapshot[]
  /** Movimenti datati prima del periodo ma scaricati nel periodo: dentro il saldo finale, fuori dal saldo iniziale. */
  precedenti_nel_periodo: PnTxSnapshot[]
  saldo_finale_calcolato: number | null
  differenza: number | null
  stato: 'quadra' | 'non_quadra' | 'senza_saldi'
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

/**
 * Quadratura di un conto sul periodo.
 * @param periodRows movimenti del conto datati nel periodo
 * @param preRows    movimenti del conto datati prima del periodo (finestra di qualche settimana), per il saldo iniziale
 * @param periodStart primo istante del periodo (ISO): il saldo iniziale è l'ultimo scarico PRIMA di questo istante
 * @param periodEndExclusive primo istante dopo la fine del periodo (ISO), per scegliere lo scarico finale
 */
export function quadraturaConto(bank_account_id: string, periodRows: PnTxSnapshot[], preRows: PnTxSnapshot[], periodStart: string, periodEndExclusive: string): QuadraturaConto {
  const ini = latestWithSnapshot(preRows.filter(r => r.fetched_at && r.fetched_at < periodStart))
  const fin = latestWithSnapshot(periodRows.filter(r => !r.fetched_at || r.fetched_at < periodEndExclusive))
  const fIni = ini?.fetched_at ?? null
  const fFin = fin?.fetched_at ?? null

  const arrivati_dopo = fFin ? periodRows.filter(r => r.fetched_at && r.fetched_at > fFin) : []
  const inQuadratura = fFin ? periodRows.filter(r => !(r.fetched_at && r.fetched_at > fFin)) : periodRows
  const precedenti_nel_periodo = fIni && fFin ? preRows.filter(r => r.fetched_at && r.fetched_at > fIni && r.fetched_at <= fFin) : []

  const entrate = r2(periodRows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0))
  const uscite = r2(periodRows.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0))
  const nettoInQuadratura = inQuadratura.reduce((s, r) => s + r.amount, 0)
  const nettoPrecedenti = precedenti_nel_periodo.reduce((s, r) => s + r.amount, 0)

  const saldo_iniziale = ini?.snapshot ?? null
  const saldo_finale = fin?.snapshot ?? null
  const saldo_finale_calcolato = saldo_iniziale == null ? null : r2(saldo_iniziale + nettoInQuadratura + nettoPrecedenti)
  const differenza = saldo_iniziale == null || saldo_finale == null ? null : r2(saldo_finale - (saldo_finale_calcolato as number))
  const stato: QuadraturaConto['stato'] = differenza == null ? 'senza_saldi' : Math.abs(differenza) < 0.005 ? 'quadra' : 'non_quadra'

  return {
    bank_account_id, saldo_iniziale, scaricato_iniziale: fIni, saldo_finale, scaricato_finale: fFin,
    n_movimenti: periodRows.length, entrate, uscite, arrivati_dopo, precedenti_nel_periodo, saldo_finale_calcolato, differenza, stato,
  }
}

/** Raggruppa per conto e quadra ogni conto. */
export function quadraturaConti(periodRows: PnTxSnapshot[], preRows: PnTxSnapshot[], periodStart: string, periodEndExclusive: string): QuadraturaConto[] {
  const ids = new Set<string>()
  for (const r of periodRows) if (r.bank_account_id) ids.add(r.bank_account_id)
  for (const r of preRows) if (r.bank_account_id) ids.add(r.bank_account_id)
  return Array.from(ids).map(id => quadraturaConto(
    id,
    periodRows.filter(r => r.bank_account_id === id),
    preRows.filter(r => r.bank_account_id === id),
    periodStart,
    periodEndExclusive,
  ))
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
