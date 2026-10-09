/**
 * Preventivo del piano dei conti ripartito per centro di costo (outlet).
 *
 * Stesse regole del Conto Economico (loadBudgetSummary in ContoEconomico.tsx):
 * - COSTI: `budget_entries.budget_amount`, escluse le righe segnaposto
 *   (`is_placeholder`, copie dell'anno precedente) e la rettifica bilancio;
 * - RICAVI: se l'anno ha righe in `budget_confronto` (il preventivo di Lilian),
 *   vengono da lì (`entry_type = 'rev_monthly'`); altrimenti, come per gli anni
 *   storici, da `budget_entries` con le stesse esclusioni dei costi.
 * Il centro `'all'` è «Sede / Costi generali» (costi non allocati a un outlet).
 */

export type AmountsByCenter = Record<string, number>

export interface BudgetEntryLite {
  account_code: string | null
  cost_center: string | null
  budget_amount: number | string | null
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

export interface PreventivoResult {
  byCode: Record<string, AmountsByCenter>
  /** Righe segnaposto di budget_entries lasciate fuori (0 = nessuna). */
  placeholdersExcluded: number
  /** true se i ricavi vengono da budget_confronto. */
  revenueFromConfronto: boolean
}

function add(out: Record<string, AmountsByCenter>, code: string, cc: string, amount: number) {
  const byCc = (out[code] ||= {})
  byCc[cc] = (byCc[cc] || 0) + amount
}

/** Somma il preventivo per conto e centro di costo. */
export function buildPreventivo(
  entries: BudgetEntryLite[],
  confronto: BudgetConfrontoLite[],
  isRevenue: (code: string) => boolean,
): PreventivoResult {
  const out: Record<string, AmountsByCenter> = {}
  const revenueFromConfronto = confronto.length > 0
  let placeholdersExcluded = 0
  for (const e of entries) {
    const code = e.account_code
    if (!code) continue
    const cc = e.cost_center || SEDE_CENTER
    if (EXCLUDED_CENTERS.has(cc)) continue
    if (e.is_placeholder === true) { placeholdersExcluded++; continue }
    if (revenueFromConfronto && isRevenue(code)) continue
    add(out, code, cc, Number(e.budget_amount) || 0)
  }
  if (revenueFromConfronto) {
    for (const r of confronto) {
      const code = r.account_code
      const m = Number(r.month || 0)
      if (!code || r.entry_type !== 'rev_monthly' || m < 1 || m > 12) continue
      if (!isRevenue(code)) continue
      add(out, code, r.cost_center || SEDE_CENTER, Number(r.amount) || 0)
    }
  }
  return { byCode: out, placeholdersExcluded, revenueFromConfronto }
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
      for (const [cc, v] of Object.entries(src)) acc[cc] = (acc[cc] || 0) + v
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
export function totalFor(amounts: AmountsByCenter | undefined, center: string | null): number {
  if (!amounts) return 0
  if (center) return amounts[center] || 0
  let t = 0
  for (const v of Object.values(amounts)) t += v
  return t
}
