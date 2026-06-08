import { describe, it, expect } from 'vitest'
import {
  buildOutletRevenue, outletRevenueMetrics, aggregateCostsByMacro, orderedCostCategories, sedeQuota,
  type ConfrontoRow, type CoaMeta,
} from './outletRevenue'

// Dati reali Barberino 2026 (NZ), conto ricavo 510xxx (is_revenue).
// Preventivo (rev_monthly) su 12 mesi; consuntivo granitico (cons_monthly) gen–mag.
const REVENUE_CODE = '510107'
const prev: Record<number, number> = {
  1: 59450.84, 2: 34595.29, 3: 21616.18, 4: 40652.45, 5: 30000,
  6: 30000, 7: 40000, 8: 30000, 9: 30000, 10: 35000, 11: 45000, 12: 40000,
}
const cons: Record<number, number> = {
  1: 59450.84, 2: 34595.29, 3: 21616.18, 4: 40652.45, 5: 37857.57,
}

function rows(): ConfrontoRow[] {
  const out: ConfrontoRow[] = []
  for (const [m, amt] of Object.entries(prev)) {
    out.push({ cost_center: 'barberino', account_code: REVENUE_CODE, month: Number(m), entry_type: 'rev_monthly', amount: amt, stato: 'preventivo' })
  }
  for (const [m, amt] of Object.entries(cons)) {
    out.push({ cost_center: 'barberino', account_code: REVENUE_CODE, month: Number(m), entry_type: 'cons_monthly', amount: amt, stato: 'granitico' })
  }
  // Rumore: conto NON ricavo e cost_center NON outlet — devono essere ignorati.
  out.push({ cost_center: 'barberino', account_code: 'COST_99', month: 1, entry_type: 'cons_monthly', amount: 99999, stato: 'granitico' })
  out.push({ cost_center: 'sede_magazzino', account_code: REVENUE_CODE, month: 1, entry_type: 'cons_monthly', amount: 12345, stato: 'granitico' })
  return out
}

describe('outletRevenue — riconciliazione Confronto Outlet ↔ Budget & Controllo', () => {
  const revenueCodes = new Set([REVENUE_CODE])
  const outletCC = new Set(['barberino']) // role='outlet'
  const map = buildOutletRevenue(rows(), revenueCodes, outletCC)

  it('isola solo conti ricavo e cost_center outlet', () => {
    expect(Object.keys(map)).toEqual(['barberino'])
    expect(map.barberino.cons[1]).toBeCloseTo(59450.84, 2)
  })

  it('ricavo canonico (granitico-else-preventivo) = valore B&C al centesimo', () => {
    const m = outletRevenueMetrics(map.barberino, null)
    expect(m.preventivo).toBeCloseTo(436314.76, 2)      // Σ rev_monthly (12 mesi)
    expect(m.consuntivoEff).toBeCloseTo(444172.33, 2)    // cons(1-5) + prev(6-12)
    expect(m.consuntivoMesiPresi).toBeCloseTo(194172.33, 2) // Σ cons(1-5)
    expect(m.mesiPresi).toBe(5)
    expect(m.provenance).toBe('misto')
  })

  it('scostamento = Σ(cons−prev) sui SOLI mesi presi (segno contabile)', () => {
    const m = outletRevenueMetrics(map.barberino, null)
    expect(m.scostamento).toBeCloseTo(7857.57, 2)        // 194172.33 − 186314.76
    expect(m.scostamento).toBeGreaterThan(0)             // in linea/sopra, NON −60%
    expect(m.scostamentoPct).toBeCloseTo(4.217, 1)       // 7857.57 / 186314.76
  })

  it('media mensile = consuntivo ÷ mesi presi (mai /12)', () => {
    const m = outletRevenueMetrics(map.barberino, null)
    expect(m.mediaMensile).toBeCloseTo(194172.33 / 5, 2)
  })

  it('provenienza granitico quando tutti i mesi con dato sono consuntivati', () => {
    const soloCons = buildOutletRevenue(
      [1, 2, 3].map(mo => ({ cost_center: 'barberino', account_code: REVENUE_CODE, month: mo, entry_type: 'cons_monthly', amount: 100, stato: 'granitico' } as ConfrontoRow)),
      revenueCodes, outletCC,
    )
    expect(outletRevenueMetrics(soloCons.barberino, [1, 2, 3]).provenance).toBe('granitico')
  })
})

describe('classificazione costi benchmark — Valdichiana 2026 (NZ)', () => {
  // Piano dei conti: un conto per macro_group con il suo ce_section/sort_order.
  const coa: Record<string, CoaMeta> = {
    '510107': { macroGroup: 'ricavi', ceSection: 'A.1', sortOrder: 100, isRevenue: true },
    C_PROD: { macroGroup: 'costi_produzione', ceSection: 'B.6', sortOrder: 311, isRevenue: false },
    C_SERV: { macroGroup: 'servizi', ceSection: 'B.7', sortOrder: 411, isRevenue: false },
    C_GOD: { macroGroup: 'godimento_beni_terzi', ceSection: 'B.8', sortOrder: 511, isRevenue: false },
    C_PERS: { macroGroup: 'personale', ceSection: 'B.9', sortOrder: 611, isRevenue: false },
    C_RIM: { macroGroup: 'variazione_rimanenze', ceSection: 'B.11', sortOrder: 911, isRevenue: false },
    C_ONERI: { macroGroup: 'oneri_diversi', ceSection: 'B.14', sortOrder: 1011, isRevenue: false },
    C_FIN: { macroGroup: 'finanziarie', ceSection: 'C.17', sortOrder: 1211, isRevenue: false },
  }
  const macroMeta = Object.fromEntries(
    Object.values(coa).filter(m => !m.isRevenue).map(m => [m.macroGroup, { ceSection: m.ceSection, sortOrder: m.sortOrder }]),
  )
  // budget_entries (preventivo) Valdichiana — anche righe ricavo e a 0 come rumore.
  const rows = [
    { account_code: '510107', budget_amount: 821584.58 }, // ricavo → escluso dai costi
    { account_code: 'C_PROD', budget_amount: 413430.90 },
    { account_code: 'C_SERV', budget_amount: 75896.34 },
    { account_code: 'C_GOD', budget_amount: 124307.96 },
    { account_code: 'C_PERS', budget_amount: 170422.27 },
    { account_code: 'C_RIM', budget_amount: 0 },
    { account_code: 'C_ONERI', budget_amount: 5084.67 },
    { account_code: 'C_FIN', budget_amount: 3928.43 },
  ]
  const costiByMacro = aggregateCostsByMacro(rows, 'budget_amount', coa)
  const RICAVI = 821584.58

  it('personale e affitto veri (non gonfiati)', () => {
    expect(costiByMacro['personale']).toBeCloseTo(170422.27, 2)
    expect(costiByMacro['godimento_beni_terzi']).toBeCloseTo(124307.96, 2)
    expect(costiByMacro['costi_produzione']).toBeCloseTo(413430.90, 2)
  })

  it('totale costi = somma delle categorie, una volta sola (≈ 793.071)', () => {
    const tot = Object.values(costiByMacro).reduce((s, v) => s + v, 0)
    expect(tot).toBeCloseTo(793070.57, 2)
  })

  it('margine = ricavi − costi (senza quota sede né override) ≈ +28.514', () => {
    const tot = Object.values(costiByMacro).reduce((s, v) => s + v, 0)
    expect(RICAVI - tot).toBeCloseTo(28514.01, 2)
  })

  it('categorie ordinate per sort_order (bilancio), non per importo; 0 visibili', () => {
    const cats = orderedCostCategories(costiByMacro, macroMeta)
    expect(cats.map(c => c.ceSection)).toEqual(['B.6', 'B.7', 'B.8', 'B.9', 'B.11', 'B.14', 'C.17'])
    expect(cats.find(c => c.ceSection === 'B.11')?.value).toBe(0) // categoria a 0 presente
  })
})

describe('quota sede pro-quota netta — NZ 2026 (Preventivo)', () => {
  const NETTO_SEDE = 197400 - 49040.40 // costi_sede − ricavi_sede (role='hq')
  // Fatturato preventivo (Σ rev_monthly) per outlet — dati reali NZ.
  const fatt: Record<string, number> = {
    valdichiana: 821584.58, valmontone: 743917.08, franciacorta: 574284.60,
    barberino: 436314.76, torino: 415123.61, palmanova: 390229.24, brugnato: 333420.75,
  }
  const fatturatoTot = Object.values(fatt).reduce((s, v) => s + v, 0)
  const marginePreSede: Record<string, number> = { valdichiana: 28514.01 }

  it('netto_sede e aliquota implicita', () => {
    expect(NETTO_SEDE).toBeCloseTo(148359.60, 2)
    expect((NETTO_SEDE / fatturatoTot) * 100).toBeCloseTo(3.99, 2)
  })

  it('quota Valdichiana e margine dopo sede', () => {
    const quota = sedeQuota(NETTO_SEDE, fatt.valdichiana, fatturatoTot)
    expect(quota).toBeCloseTo(32811.33, 0)
    expect(marginePreSede.valdichiana - quota).toBeCloseTo(-4297, 0)
  })

  it('Σ delle quote dei 7 outlet = netto_sede (niente perso)', () => {
    const sommaQuote = Object.values(fatt).reduce((s, f) => s + sedeQuota(NETTO_SEDE, f, fatturatoTot), 0)
    expect(sommaQuote).toBeCloseTo(NETTO_SEDE, 2)
  })

  it('guardia divisione per zero: 0 outlet → quota 0', () => {
    expect(sedeQuota(NETTO_SEDE, 0, 0)).toBe(0)
    expect(Number.isFinite(sedeQuota(NETTO_SEDE, 100, 0))).toBe(true)
  })
})
