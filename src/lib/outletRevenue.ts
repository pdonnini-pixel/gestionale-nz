/**
 * Ricavi per outlet — fonte unica condivisa tra "Confronto Outlet" e
 * "Budget & Controllo" (T2). NESSUNA query parallela: entrambe le pagine
 * devono produrre lo stesso ricavo per outlet, al centesimo.
 *
 * Regole (fonti di verità — vedi memoria di progetto):
 *  - Quali outlet:  cost_centers.role === 'outlet'  (mai liste hardcoded).
 *  - Ricavi:        budget_confronto, conti is_revenue (join chart_of_accounts).
 *                   entry_type 'rev_monthly' = preventivo (Lilian),
 *                   entry_type 'cons_monthly' = consuntivo GRANITICO.
 *  - Classificazione: SEMPRE via chart_of_accounts.is_revenue, MAI macro_group
 *                   (nel 2026 è 'CE' ovunque).
 *  - Lettura per mese as-is dal DB: nessuna divisione per 12.
 *  - Consuntivo effettivo = regola "granitico-else-preventivo" per mese:
 *                   per ogni mese usa cons_monthly se presente, altrimenti
 *                   rev_monthly. È il ricavo canonico per outlet di B&C.
 */

// Etichetta condivisa (T1): i ricavi outlet provengono da budget_confronto
// (inserimento di Lilian), non dal bilancio importato.
export const RICAVI_SOURCE_LABEL = 'Ricavi (inserimento Lilian)'

export type ConfrontoRow = {
  cost_center?: string | null
  account_code?: string | null
  month?: number | null
  entry_type?: string | null // 'rev_monthly' | 'cons_monthly'
  amount?: number | null
  stato?: string | null // 'preventivo' | 'granitico'
}

export type OutletMonthly = { prev: Record<number, number>; cons: Record<number, number> }
/** chiave = cost_center (codice outlet) */
export type OutletConfrontoMap = Record<string, OutletMonthly>

/**
 * Costruisce, per ogni cost_center, i ricavi mensili preventivo/consuntivo,
 * considerando SOLO i conti ricavo e SOLO i cost_center forniti (role='outlet').
 */
export function buildOutletRevenue(
  rows: ConfrontoRow[],
  revenueCodes: Set<string>,
  outletCostCenters: Set<string>,
): OutletConfrontoMap {
  const out: OutletConfrontoMap = {}
  for (const r of rows) {
    const cc = r.cost_center || ''
    if (!outletCostCenters.has(cc)) continue
    if (!r.account_code || !revenueCodes.has(r.account_code)) continue
    const m = r.month ?? 0
    if (m < 1 || m > 12) continue
    const amt = Number(r.amount) || 0
    if (!out[cc]) out[cc] = { prev: {}, cons: {} }
    if (r.entry_type === 'rev_monthly') out[cc].prev[m] = (out[cc].prev[m] || 0) + amt
    else if (r.entry_type === 'cons_monthly') out[cc].cons[m] = (out[cc].cons[m] || 0) + amt
  }
  return out
}

export type Provenance = 'granitico' | 'misto' | 'preventivo'

export type OutletRevenueMetrics = {
  preventivo: number // Σ rev_monthly sui mesi selezionati
  consuntivoEff: number // Σ granitico-else-preventivo (cons[m] ?? prev[m]) — ricavo canonico B&C
  scostamento: number // Σ(cons − prev) sui SOLI mesi con consuntivo (R1)
  scostamentoPct: number // scostamento / Σ prev(mesi con consuntivo) * 100
  mesiPresi: number // n. mesi selezionati con consuntivo
  consuntivoMesiPresi: number // Σ cons sui mesi presi
  mediaMensile: number // consuntivoMesiPresi / mesiPresi (I4) — mai /12
  provenance: Provenance // I1: granitico se tutti i mesi presi sono cons; misto se restano preventivi; preventivo se 0 cons
}

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/** Metriche ricavo per un singolo outlet. months=null → tutti i 12 mesi. */
export function outletRevenueMetrics(m: OutletMonthly | undefined, months: number[] | null): OutletRevenueMetrics {
  const sel = months ?? ALL_MONTHS
  const prev = m?.prev ?? {}
  const cons = m?.cons ?? {}
  let preventivo = 0
  let consuntivoEff = 0
  let scostamento = 0
  let prevMesiPresi = 0
  let consMesiPresi = 0
  let mesiPresi = 0
  let mesiConDato = 0
  for (const month of sel) {
    const p = prev[month]
    const c = cons[month]
    const hasP = p != null
    const hasC = c != null
    if (hasP) preventivo += p
    if (hasC || hasP) {
      consuntivoEff += hasC ? (c as number) : (p as number)
      mesiConDato++
    }
    if (hasC) {
      mesiPresi++
      consMesiPresi += c as number
      prevMesiPresi += hasP ? (p as number) : 0
      scostamento += (c as number) - (hasP ? (p as number) : 0)
    }
  }
  const scostamentoPct = prevMesiPresi !== 0 ? (scostamento / prevMesiPresi) * 100 : 0
  const mediaMensile = mesiPresi > 0 ? consMesiPresi / mesiPresi : 0
  const provenance: Provenance =
    mesiPresi === 0 ? 'preventivo' : mesiPresi === mesiConDato ? 'granitico' : 'misto'
  return { preventivo, consuntivoEff, scostamento, scostamentoPct, mesiPresi, consuntivoMesiPresi: consMesiPresi, mediaMensile, provenance }
}
