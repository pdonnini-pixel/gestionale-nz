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

// ─── Classificazione COSTI per macro_group (da chart_of_accounts) ──────────
// La classificazione dei costi NON usa prefissi di account_code né i nomi:
// SEMPRE il join account_code → chart_of_accounts (macro_group, ce_section,
// sort_order). Vale per Confronto Outlet (benchmark/margine) e altrove.

export type CoaMeta = { macroGroup: string; ceSection: string | null; sortOrder: number; isRevenue: boolean }

/** Somma i costi (campo budget_amount/actual_amount) per macro_group, escludendo
 *  i conti ricavo. Le righe a 0 mantengono comunque la chiave del loro macro_group
 *  (così le categorie a 0 restano visibili nell'ordine di bilancio). */
export function aggregateCostsByMacro(
  rows: Array<{ account_code?: string | null; budget_amount?: number | null; actual_amount?: number | null }>,
  field: 'budget_amount' | 'actual_amount',
  coaByCode: Record<string, CoaMeta>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const meta = coaByCode[r.account_code || '']
    if (!meta || meta.isRevenue) continue
    const amt = Number(r[field]) || 0
    out[meta.macroGroup] = (out[meta.macroGroup] || 0) + amt
  }
  return out
}

export type CostCategory = { macroGroup: string; ceSection: string | null; sortOrder: number; label: string; value: number }

// Etichette amichevoli per i macro_group più comuni (solo presentazione, non
// classificazione). Fallback: ce_section + macro_group "umanizzato".
const MACRO_LABELS: Record<string, string> = {
  costi_produzione: 'Costi produzione',
  servizi: 'Servizi',
  godimento_beni_terzi: 'Affitto/godimento',
  personale: 'Personale',
  ammortamenti: 'Ammortamenti',
  variazione_rimanenze: 'Variazione rimanenze',
  oneri_diversi: 'Oneri diversi',
  finanziarie: 'Oneri finanziari',
}
function humanizeMacro(macro: string): string {
  if (MACRO_LABELS[macro]) return MACRO_LABELS[macro]
  const s = macro.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Ordina i costi-per-macro in categorie nell'ordine di bilancio (sort_order del
 *  piano dei conti). Mai per importo, mai per ce_section come stringa. */
export function orderedCostCategories(
  costiByMacro: Record<string, number>,
  macroMeta: Record<string, { ceSection: string | null; sortOrder: number }>,
): CostCategory[] {
  return Object.entries(costiByMacro)
    .map(([macroGroup, value]) => {
      const meta = macroMeta[macroGroup]
      return {
        macroGroup,
        ceSection: meta?.ceSection ?? null,
        sortOrder: meta?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        label: humanizeMacro(macroGroup),
        value,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
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
