import { describe, it, expect } from 'vitest'
import { buildProiezione, rollupByAccount, totalFor } from './costByCenter'

const isRevenue = (code: string) => code.startsWith('51')
const be = (account_code: string | null, cost_center: string | null, month: number, budget_amount: number | string, is_placeholder = false) =>
  ({ account_code, cost_center, month, budget_amount, is_placeholder })
const cf = (account_code: string, cost_center: string, entry_type: string, month: number, amount: number) =>
  ({ account_code, cost_center, entry_type, month, amount })

describe('costByCenter', () => {
  const entries = [
    be('630301', 'barberino', 1, 100),
    be('630301', 'barberino', 2, '50'),
    be('630301', 'valdichiana', 1, 200),
    be('630302', null, 1, 30),
    be('630302', 'rettifica_bilancio', 1, -999),
    be('630302', 'all', 1, 777, true),
    be('510107', 'barberino', 1, 5000),
    be(null, 'barberino', 1, 5),
  ]

  it('senza budget_confronto: solo preventivo, senza segnaposto né rettifica bilancio', () => {
    const r = buildProiezione(entries, [], isRevenue)
    expect(r.byCode['630301']).toEqual({ barberino: { total: 150, actual: 0 }, valdichiana: { total: 200, actual: 0 } })
    expect(r.byCode['630302']).toEqual({ all: { total: 30, actual: 0 } })
    expect(r.byCode['510107']).toEqual({ barberino: { total: 5000, actual: 0 } })
    expect(r.placeholdersExcluded).toBe(1)
    expect(r.revenueFromConfronto).toBe(false)
  })

  it('ricavi: consuntivo nei mesi in cui c\'è, preventivo negli altri', () => {
    const confronto = [
      cf('510107', 'barberino', 'rev_monthly', 1, 40),
      cf('510107', 'barberino', 'rev_monthly', 2, 60),
      cf('510107', 'barberino', 'rev_monthly', 3, 70),
      cf('510107', 'barberino', 'cons_monthly', 1, 45),
      cf('510107', 'barberino', 'cons_monthly', 2, 0), // consuntivo zero è un dato vero
      cf('510107', 'barberino', 'rev_monthly', 0, 999),
    ]
    const r = buildProiezione(entries, confronto, isRevenue)
    expect(r.byCode['510107']).toEqual({ barberino: { total: 45 + 0 + 70, actual: 45 } })
    expect(r.lastActualMonthRevenue).toBe(2)
    expect(r.lastActualMonthCosts).toBe(0)
    expect(r.revenueFromConfronto).toBe(true)
  })

  it('costi: il consuntivo del mese sostituisce il preventivo di quel mese', () => {
    const r = buildProiezione(entries, [cf('630301', 'barberino', 'cons_monthly', 1, 120)], isRevenue)
    expect(r.byCode['630301'].barberino).toEqual({ total: 120 + 50, actual: 120 })
    expect(r.lastActualMonthCosts).toBe(1)
  })

  it('i conti padre sommano i sottoconti', () => {
    const accounts = [
      { id: 'l1', code: '63', parent_id: null },
      { id: 'l2', code: '6303', parent_id: 'l1' },
      { id: 'a', code: '630301', parent_id: 'l2' },
      { id: 'b', code: '630302', parent_id: 'l2' },
    ]
    const r = rollupByAccount(accounts, buildProiezione(entries, [], isRevenue).byCode)
    expect(totalFor(r.l1, null).total).toBe(380)
    expect(totalFor(r.l2, 'barberino').total).toBe(150)
    expect(totalFor(r.b, 'barberino').total).toBe(0)
  })

  it('una gerarchia circolare non va in loop', () => {
    const accounts = [
      { id: 'x', code: 'X', parent_id: 'y' },
      { id: 'y', code: 'Y', parent_id: 'x' },
    ]
    const r = rollupByAccount(accounts, { X: { all: { total: 1, actual: 0 } } })
    expect(totalFor(r.x, null).total).toBeGreaterThanOrEqual(1)
  })
})
