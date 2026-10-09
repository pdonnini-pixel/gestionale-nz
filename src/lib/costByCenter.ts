/**
 * Anno del piano dei conti ripartito per centro di costo (outlet): consuntivo
 * nei mesi in cui c'è, preventivo nei mesi che restano fino a fine anno.
 *
 * Fonti (le stesse di Budget & Controllo, Confronto Outlet e Conto Economico):
 * - PREVENTIVO COSTI: `budget_entries.budget_amount` per mese, escluse le righe
 *   segnaposto (`is_placeholder`, copie dell'anno precedente) e la rettifica bilancio;
 * - PREVENTIVO RICAVI: `budget_confronto` `rev_monthly` (il preventivo di Lilian)
 *   se l'anno ha righe lì; altrimenti, come per gli anni storici, `budget_entries`;
 * - CONSUNTIVO (ricavi e costi): `budget_confronto` `cons_monthly`, il dato
 *   granitico inserito in «Preventivo vs Consuntivo». Per ogni mese vale il
 *   consuntivo se c'è, altrimenti il preventivo (regola granitico-else-preventivo
 *   di `outletRevenue.ts`).
 * Il centro `'all'` è «Sede / Costi generali» (costi non allocati a un outlet).
 */

/** Importo dell'anno e parte di esso che viene dal consuntivo. */
export interface CenterAmount { total: number; actual: number }
export type AmountsByCenter = Record<string, CenterAmount>

export interface BudgetEntryLite {
  account_code: string | null
  cost_center: string | null
  budget_amount: number | string | null
  month: number | null
  is_placeholder?: boolean | null
}

export interface BudgetConfrontoLite {
  account_code: string | null
  cost_center: string | null
  amount: number | string | null
  entry_type: string | null
  month: number | null
}

export interface AccountLite { id: string; code: string; parent_id: string | null }

export const SEDE_CENTER = 'all'
const EXCLUDED_CENTERS = new Set(['rettifica_bilancio'])

export interface ProiezioneResult {
  byCode: Record<string, AmountsByCenter>
  /** Righe segnaposto di budget_entries lasciate fuori (0 = nessuna). */
  placeholdersExcluded: number
  /** true se il preventivo ricavi viene da budget_confronto. */
  revenueFromConfronto: boolean
  /** Ultimo mese (1-12) con un consuntivo di ricavi / di costi; 0 = nessuno. */
  lastActualMonthRevenue: number
  lastActualMonthCosts: number
}

type Monthly = Record<string, Record<string, Record<number, number>>> // code → cc → mese → importo

function put(m: Monthly, code: string, cc: string, month: number, amount: number) {
  const byCc = (m[code] ||= {})
  const byMonth = (byCc[cc] ||= {})
  byMonth[month] = (byMonth[month] || 0) + amount
}

/** Consuntivo dove c'è, preventivo negli altri mesi, per conto e centro di costo. */
export function buildProiezione(
  entries: BudgetEntryLite[],
  confronto: BudgetConfrontoLite[],
  isRevenue: (code: string) => boolean,
): ProiezioneResult {
  const prev: Monthly = {}
  const cons: Monthly = {}
  const revenueFromConfronto = confronto.some(r => r.entry_type === 'rev_monthly')
  let placeholdersExcluded = 0
  let lastActualMonthRevenue = 0
  let lastActualMonthCosts = 0

  for (const e of entries) {
    const code = e.account_code
    const m = Number(e.month || 0)
    if (!code || m < 1 || m > 12) continue
    const cc = e.cost_center || SEDE_CENTER
    if (EXCLUDED_CENTERS.has(cc)) continue
    if (e.is_placeholder === true) { placeholdersExcluded++; continue }
    if (revenueFromConfronto && isRevenue(code)) continue
    put(prev, code, cc, m, Number(e.budget_amount) || 0)
  }
  for (const r of confronto) {
    const code = r.account_code
    const m = Number(r.month || 0)
    if (!code || m < 1 || m > 12) continue
    const cc = r.cost_center || SEDE_CENTER
    if (EXCLUDED_CENTERS.has(cc)) continue
    const amount = Number(r.amount) || 0
    if (r.entry_type === 'rev_monthly') {
      if (isRevenue(code)) put(prev, code, cc, m, amount)
    } else if (r.entry_type === 'cons_monthly') {
      put(cons, code, cc, m, amount)
      if (isRevenue(code)) lastActualMonthRevenue = Math.max(lastActualMonthRevenue, m)
      else lastActualMonthCosts = Math.max(lastActualMonthCosts, m)
    }
  }

  const byCode: Record<string, AmountsByCenter> = {}
  const codes = new Set([...Object.keys(prev), ...Object.keys(cons)])
  for (const code of codes) {
    const centers = new Set([...Object.keys(prev[code] || {}), ...Object.keys(cons[code] || {})])
    for (const cc of centers) {
      const p = prev[code]?.[cc] || {}
      const c = cons[code]?.[cc] || {}
      let total = 0, actual = 0
      for (let m = 1; m <= 12; m++) {
        if (c[m] != null) { total += c[m]; actual += c[m] }
        else if (p[m] != null) total += p[m]
      }
      if (total === 0 && actual === 0) continue
      ;(byCode[code] ||= {})[cc] = { total, actual }
    }
  }
  return { byCode, placeholdersExcluded, revenueFromConfronto, lastActualMonthRevenue, lastActualMonthCosts }
}

/**
 * Importi per voce: quelli propri più quelli di tutti i sottoconti (via
 * `parent_id`). Il preventivo si inserisce sul livello 3, quindi i livelli 1 e 2
 * mostrano la somma dei figli.
 */
export function rollupByAccount(
  accounts: AccountLite[],
  byCode: Record<string, AmountsByCenter>,
): Record<string, AmountsByCenter> {
  const children: Record<string, AccountLite[]> = {}
  for (const a of accounts) {
    if (a.parent_id) (children[a.parent_id] ||= []).push(a)
  }
  const memo: Record<string, AmountsByCenter> = {}
  const visiting = new Set<string>()
  const visit = (a: AccountLite): AmountsByCenter => {
    if (memo[a.id]) return memo[a.id]
    const acc: AmountsByCenter = {}
    if (visiting.has(a.id)) return acc // gerarchia circolare: non contare due volte
    visiting.add(a.id)
    const merge = (src: AmountsByCenter | undefined) => {
      if (!src) return
      for (const [cc, v] of Object.entries(src)) {
        const cur = (acc[cc] ||= { total: 0, actual: 0 })
        cur.total += v.total
        cur.actual += v.actual
      }
    }
    merge(byCode[a.code])
    for (const ch of children[a.id] || []) merge(visit(ch))
    visiting.delete(a.id)
    memo[a.id] = acc
    return acc
  }
  for (const a of accounts) visit(a)
  return memo
}

/** Totale di una voce su tutti i centri o su un centro solo. */
export function totalFor(amounts: AmountsByCenter | undefined, center: string | null): CenterAmount {
  if (!amounts) return { total: 0, actual: 0 }
  if (center) return amounts[center] ? { ...amounts[center] } : { total: 0, actual: 0 }
  let total = 0, actual = 0
  for (const v of Object.values(amounts)) { total += v.total; actual += v.actual }
  return { total, actual }
}
