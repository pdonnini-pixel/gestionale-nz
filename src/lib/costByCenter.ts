/**
 * Importi del piano dei conti ripartiti per centro di costo (outlet).
 *
 * Fonte: `budget_entries` dell'anno (preventivo `budget_amount`, consuntivo
 * `actual_amount`), le stesse righe che si compilano in Budget & Controllo.
 * Le righe di rettifica bilancio (`cost_center = 'rettifica_bilancio'`) sono
 * escluse, come nella vista per outlet di Budget & Controllo.
 * Il centro `'all'` è «Sede / Costi generali» (costi non allocati a un outlet).
 */

export interface CenterAmount { budget: number; actual: number }
export type AmountsByCenter = Record<string, CenterAmount>

export interface BudgetEntryLite {
  account_code: string | null
  cost_center: string | null
  budget_amount: number | string | null
  actual_amount: number | string | null
}

export interface AccountLite { id: string; code: string; parent_id: string | null }

export const SEDE_CENTER = 'all'
const EXCLUDED_CENTERS = new Set(['rettifica_bilancio'])

/** Somma le righe per conto e per centro di costo. */
export function aggregateByCode(entries: BudgetEntryLite[]): Record<string, AmountsByCenter> {
  const out: Record<string, AmountsByCenter> = {}
  for (const e of entries) {
    const code = e.account_code
    if (!code) continue
    const cc = e.cost_center || SEDE_CENTER
    if (EXCLUDED_CENTERS.has(cc)) continue
    const byCc = (out[code] ||= {})
    const cur = (byCc[cc] ||= { budget: 0, actual: 0 })
    cur.budget += Number(e.budget_amount) || 0
    cur.actual += Number(e.actual_amount) || 0
  }
  return out
}

function addInto(target: AmountsByCenter, src: AmountsByCenter | undefined) {
  if (!src) return
  for (const [cc, v] of Object.entries(src)) {
    const cur = (target[cc] ||= { budget: 0, actual: 0 })
    cur.budget += v.budget
    cur.actual += v.actual
  }
}

/**
 * Importi per voce: quelli propri più quelli di tutti i sottoconti (via
 * `parent_id`). Il budget si inserisce sul livello 3, quindi i livelli 1 e 2
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
    addInto(acc, byCode[a.code])
    for (const ch of children[a.id] || []) addInto(acc, visit(ch))
    visiting.delete(a.id)
    memo[a.id] = acc
    return acc
  }
  for (const a of accounts) visit(a)
  return memo
}

/** Totale di una voce su tutti i centri o su un centro solo. */
export function totalFor(amounts: AmountsByCenter | undefined, center: string | null): CenterAmount {
  if (!amounts) return { budget: 0, actual: 0 }
  if (center) return amounts[center] ? { ...amounts[center] } : { budget: 0, actual: 0 }
  let budget = 0, actual = 0
  for (const v of Object.values(amounts)) { budget += v.budget; actual += v.actual }
  return { budget, actual }
}
