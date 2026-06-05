import { describe, it, expect } from 'vitest'
import { buildOutletRevenue, outletRevenueMetrics, type ConfrontoRow } from './outletRevenue'

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
