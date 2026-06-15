import { describe, it, expect } from 'vitest'
import {
  computeAmortization,
  isValidAmortizationParams,
  normalizeFrequency,
  type AmortizationParams,
} from './amortization'

describe('normalizeFrequency', () => {
  it('riconosce inglese e italiano', () => {
    expect(normalizeFrequency('monthly')).toBe('monthly')
    expect(normalizeFrequency('Mensile')).toBe('monthly')
    expect(normalizeFrequency('trimestrale')).toBe('quarterly')
    expect(normalizeFrequency('SEMESTRALE')).toBe('semiannual')
    expect(normalizeFrequency('annuale')).toBe('annual')
  })
  it('null su input non riconosciuto/vuoto', () => {
    expect(normalizeFrequency(null)).toBeNull()
    expect(normalizeFrequency('')).toBeNull()
    expect(normalizeFrequency('settimanale')).toBeNull()
  })
})

describe('isValidAmortizationParams', () => {
  const base: AmortizationParams = {
    principal: 10000, annualRatePct: 5, numberOfInstallments: 12,
    frequency: 'monthly', firstPaymentDate: '2026-01-31',
  }
  it('accetta parametri completi', () => {
    expect(isValidAmortizationParams(base)).toBe(true)
  })
  it('rifiuta capitale <= 0 o NaN', () => {
    expect(isValidAmortizationParams({ ...base, principal: 0 })).toBe(false)
    expect(isValidAmortizationParams({ ...base, principal: NaN })).toBe(false)
  })
  it('rifiuta numero rate non intero o <= 0', () => {
    expect(isValidAmortizationParams({ ...base, numberOfInstallments: 0 })).toBe(false)
    expect(isValidAmortizationParams({ ...base, numberOfInstallments: 12.5 })).toBe(false)
  })
  it('rifiuta data malformata', () => {
    expect(isValidAmortizationParams({ ...base, firstPaymentDate: '31/01/2026' })).toBe(false)
  })
})

describe('computeAmortization', () => {
  it('piano vuoto su parametri invalidi (niente numeri inventati)', () => {
    const plan = computeAmortization(null)
    expect(plan.rows).toEqual([])
    expect(plan.installment).toBe(0)
  })

  it('tasso zero: rata = C/n, interessi nulli, residuo finale = 0', () => {
    const plan = computeAmortization({
      principal: 1200, annualRatePct: 0, numberOfInstallments: 12,
      frequency: 'monthly', firstPaymentDate: '2026-01-01',
    })
    expect(plan.rows).toHaveLength(12)
    expect(plan.installment).toBe(100)
    expect(plan.totalInterest).toBe(0)
    expect(plan.rows[11].remaining).toBe(0)
    expect(plan.rows[0].principal).toBe(100)
  })

  it('francese standard: residuo finale esattamente 0 e somma capitali = principal', () => {
    const plan = computeAmortization({
      principal: 10000, annualRatePct: 6, numberOfInstallments: 12,
      frequency: 'monthly', firstPaymentDate: '2026-01-31',
    })
    expect(plan.rows).toHaveLength(12)
    // rata francese teorica ~860.66
    expect(plan.installment).toBeCloseTo(860.66, 1)
    expect(plan.rows[11].remaining).toBe(0)
    const sumPrincipal = plan.rows.reduce((s, r) => s + r.principal, 0)
    expect(Math.round(sumPrincipal * 100) / 100).toBe(10000)
    // capitale cresce nel tempo, interessi calano (francese)
    expect(plan.rows[11].principal).toBeGreaterThan(plan.rows[0].principal)
    expect(plan.rows[11].interest).toBeLessThan(plan.rows[0].interest)
  })

  it('totalPaid = somma rate e coerente con capitale + interessi', () => {
    const plan = computeAmortization({
      principal: 50000, annualRatePct: 4.5, numberOfInstallments: 24,
      frequency: 'quarterly', firstPaymentDate: '2026-03-31',
    })
    const sumRate = plan.rows.reduce((s, r) => s + r.installment, 0)
    expect(Math.round(sumRate * 100) / 100).toBe(plan.totalPaid)
    expect(Math.round((50000 + plan.totalInterest) * 100) / 100).toBe(plan.totalPaid)
  })

  it('date scadenza progrediscono secondo la periodicità (trimestrale)', () => {
    const plan = computeAmortization({
      principal: 8000, annualRatePct: 3, numberOfInstallments: 4,
      frequency: 'quarterly', firstPaymentDate: '2026-01-31',
    })
    expect(plan.rows.map(r => r.date)).toEqual([
      '2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31',
    ])
  })

  it('determinismo: stessi parametri -> stesso piano', () => {
    const p: AmortizationParams = {
      principal: 33333, annualRatePct: 5.25, numberOfInstallments: 36,
      frequency: 'monthly', firstPaymentDate: '2026-02-28',
    }
    expect(computeAmortization(p)).toEqual(computeAmortization(p))
  })
})
