// Scontrini POS letti dalla foto della chiusura di cassa: a quale riga vanno,
// e cosa fare quando un POS la sera prima non ha chiuso.
//
// La cassiera fa una foto sola (scontrino del registratore + scontrini POS) e
// il lettore automatico (edge function closing-photo-extract) restituisce un
// elenco `pos_closures`, uno per scontrino POS. Qui si decide la riga.
//
// Nato da Barberino, 4-5 novembre 2026. Il 04/11 manca la linea internet: il
// POS di riserva (TML 86028816) chiude 288,00 €, il POS principale (86028817)
// stampa solo i «totali locali», 145,56 €. La pagina metteva 145,56 su POS MPS
// e 288,00 sulla prima riga libera (POS BCC): sbagliato, sono tutti e due MPS.
// Il 05/11 lo scontrino del POS principale comprende anche i 145,56 del giorno
// prima (972,96 invece di 827,40): la cassiera l'ha tolto a mano.
//
// Regole fissate da Patrizio il 06/11/2026:
//   - ogni negozio ha più POS, anche di riserva: uno scontrino di un terminale
//     non registrato ma della stessa banca va sulla riga di quella banca, e
//     più scontrini della stessa riga si sommano;
//   - un TML letto con una cifra diversa (o una in meno) vale come lo stesso.

import type { ChannelKind } from './cashClosings'

/** Esito dello scontrino POS: chiusura riuscita o solo totali locali (POS non chiuso). */
export type PosReceiptStatus = 'chiusura' | 'non_chiusa'

export interface PosReceipt {
  terminal_id: string | null
  acquirer: string | null
  circuit: string | null
  merchant: string | null
  amount: number
  status: PosReceiptStatus | null
}

export interface PosChannelLite {
  id: string
  label: string
  kind: ChannelKind
  terminal_code: string | null
  pos_terminal_id: string | null
}

/** Come lo scontrino è finito sulla riga: per la spiegazione sotto il campo. */
export type PosMatchReason = 'terminale' | 'terminale_simile' | 'banca' | 'riga_libera'

export interface PosAssigned { receipt: PosReceipt; reason: PosMatchReason }

export interface PosChannelAssignment { total: number; receipts: PosAssigned[] }

const r2 = (n: number) => Math.round(n * 100) / 100
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const norm = (v: unknown) => String(v ?? '').toLowerCase()
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Legge `pos_closures` dai dati estratti, scartando le voci senza importo. */
export function posReceiptsFrom(extracted: unknown): PosReceipt[] {
  if (!extracted || typeof extracted !== 'object') return []
  const raw = (extracted as Record<string, unknown>).pos_closures
  if (!Array.isArray(raw)) return []
  const out: PosReceipt[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const pc = item as Record<string, unknown>
    const amount = typeof pc.amount === 'number' && Number.isFinite(pc.amount) ? r2(pc.amount) : null
    if (amount == null) continue
    const st = pc.status === 'chiusura' || pc.status === 'non_chiusa' ? pc.status : null
    out.push({ terminal_id: str(pc.terminal_id), acquirer: str(pc.acquirer), circuit: str(pc.circuit), merchant: str(pc.merchant), amount, status: st })
  }
  return out
}

/**
 * Due TML sono lo stesso terminale letto con una cifra sbagliata o mancante?
 * (distanza di modifica al più 1, con almeno 6 cifre: sotto, il rischio di
 * confondere due terminali diversi è troppo alto).
 */
export function sameTerminalId(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false
    return true
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true
  return false
}

/** «Pay by link» non è un POS fisico: nessuno scontrino ci va, e l'RT non lo conta come POS. */
export function isPayByLink(c: { kind: ChannelKind; label: string }): boolean {
  return c.kind === 'paybylink' || /link/i.test(c.label)
}

const SYN: Record<string, string[]> = { mps: ['mps', 'nexi', 'monte'], nexi: ['mps', 'nexi'], monte: ['mps', 'nexi', 'monte'], bcc: ['bcc', 'iccrea', 'numia'], iccrea: ['bcc'], numia: ['bcc'] }

/**
 * Mette ogni scontrino POS sulla sua riga e somma gli scontrini della stessa riga.
 *   1. TML uguale a quello registrato sulla riga (o al codice terminale);
 *   2. TML che differisce di una cifra: è lo stesso, letto male;
 *   3. TML sconosciuto ma banca riconosciuta: POS di riserva, va sulla riga di
 *      quella banca (anche se ha già uno scontrino: si sommano);
 *   4. nessun indizio: la prima riga POS ancora vuota, come prima.
 * Gli scontrini Amex vanno sulle righe Amex, gli altri sulle altre.
 */
export function assignPosReceipts(receipts: PosReceipt[], channels: PosChannelLite[]): Record<string, PosChannelAssignment> {
  const pos = channels.filter((c) => c.kind === 'pos' || c.kind === 'pos_amex')
  const out: Record<string, PosChannelAssignment> = {}
  const add = (ch: PosChannelLite, receipt: PosReceipt, reason: PosMatchReason) => {
    const a = out[ch.id] ?? { total: 0, receipts: [] }
    a.receipts.push({ receipt, reason })
    a.total = r2(a.total + receipt.amount)
    out[ch.id] = a
  }
  const chTid = (c: PosChannelLite) => digits(c.pos_terminal_id) || digits(c.terminal_code)
  const anonymous: Array<{ rc: PosReceipt; isAmex: boolean }> = []
  // Prima passata: scontrini riconoscibili (terminale o banca). Gli anonimi
  // aspettano, così non occupano la riga di un terminale che arriva dopo.
  for (const rc of receipts) {
    const tid = digits(rc.terminal_id)
    const acq = `${norm(rc.acquirer)} ${norm(rc.circuit)} ${norm(rc.merchant)}`
    const isAmex = /amex|american/.test(acq)
    const sameSide = (c: PosChannelLite) => isAmex === (c.kind === 'pos_amex' || /amex/.test(norm(c.label)))

    const exact = tid ? pos.filter((c) => chTid(c) === tid) : []
    const pickExact = exact.find(sameSide)
    if (pickExact) { add(pickExact, rc, 'terminale'); continue }

    const near = tid ? pos.filter((c) => sameTerminalId(chTid(c), tid)) : []
    const pickNear = near.find(sameSide)
    if (pickNear) { add(pickNear, rc, 'terminale_simile'); continue }

    const words = new Set(Object.keys(SYN).filter((k) => acq.includes(k)).flatMap((k) => SYN[k]))
    const byBank = pos.filter((c) => sameSide(c) && !isPayByLink(c) && [...words].some((w) => norm(c.label).includes(w)))
    if (byBank.length > 0) { add(byBank[0], rc, 'banca'); continue }

    anonymous.push({ rc, isAmex })
  }
  // Seconda passata: gli anonimi sulle righe POS rimaste vuote, in ordine.
  for (const { rc, isAmex } of anonymous) {
    const free = pos.find((c) => !isPayByLink(c) && !out[c.id] && isAmex === (c.kind === 'pos_amex' || /amex/.test(norm(c.label))))
    if (free) add(free, rc, 'riga_libera')
  }
  return out
}

/** Somma degli scontrini «non chiusa» (totali locali) letti dalle foto. */
export function openPosTotal(receipts: PosReceipt[]): number {
  return r2(receipts.filter((r) => r.status === 'non_chiusa').reduce((s, r) => s + r.amount, 0))
}

export interface CarryOverInput {
  isClosedDay: boolean
  /** Pagamento elettronico stampato dal registratore (RT) oggi. */
  rtElectronic: number | null
  /** Somma delle righe POS scritte nella chiusura (kind pos e pos_amex). */
  posTyped: number
  /** Somma degli scontrini «non chiusa» della chiusura precedente (0 se nessuno o ignoto). */
  previousOpen: number
}

export interface CarryOver {
  /** Quanto le righe POS superano il pagato elettronico dell'RT. */
  excess: number
  /** true se l'eccedenza è esattamente il POS rimasto aperto il giorno prima. */
  fromPreviousDay: boolean
}

/**
 * Le righe POS superano il pagato elettronico del registratore? È la firma di
 * un POS non chiuso la sera prima: il suo scontrino di oggi comprende anche le
 * vendite di ieri, che il registratore ha già contato ieri.
 *
 * Con il POS aperto di ieri letto dalla foto, l'eccedenza deve coincidere al
 * centesimo: allora il caso è certo. Senza quell'informazione si segnala lo
 * stesso, ma come ipotesi: la cassiera conferma o corregge.
 */
export function posCarryOver(i: CarryOverInput): CarryOver | null {
  if (i.isClosedDay || i.rtElectronic == null) return null
  const excess = r2(i.posTyped - i.rtElectronic)
  if (excess < 0.01) return null
  const fromPreviousDay = i.previousOpen > 0 && Math.abs(excess - i.previousOpen) < 0.01
  return { excess, fromPreviousDay }
}

/** Nota da aggiungere alla chiusura quando si toglie la parte del giorno prima. */
export function carryOverNote(excess: number, previousDate: string | null): string {
  const euro = excess.toFixed(2).replace('.', ',')
  const day = previousDate ? ` del ${previousDate.split('-').reverse().join('/')}` : ' di un giorno precedente'
  return `Scontrino POS comprende ${euro} € di vendite${day} (POS non chiuso quel giorno): tolti dalla riga POS, sono già nei corrispettivi di quel giorno.`
}

/**
 * Da quale riga togliere l'eccedenza: quella dove è finito lo scontrino di oggi
 * dello stesso terminale rimasto aperto ieri; altrimenti la riga POS più alta
 * fra quelle che superano l'eccedenza.
 */
export function carryOverChannel(
  today: Record<string, PosChannelAssignment>,
  previousOpenTids: string[],
  typed: Record<string, number>,
  excess: number,
): string | null {
  const open = previousOpenTids.map(digits).filter(Boolean)
  for (const [chId, a] of Object.entries(today)) {
    if (a.receipts.some((x) => open.some((t) => sameTerminalId(digits(x.receipt.terminal_id), t))) && (typed[chId] ?? 0) >= excess) return chId
  }
  const best = Object.entries(typed).filter(([, v]) => v >= excess).sort((a, b) => b[1] - a[1])[0]
  return best ? best[0] : null
}
