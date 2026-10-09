import { describe, it, expect } from 'vitest'
import { aggregateByCode, rollupByAccount, totalFor } from './costByCenter'

describe('costByCenter', () => {
  const entries = [
    { account_code: '630301', cost_center: 'barberino', budget_amount: 100, actual_amount: 80 },
    { account_code: '630301', cost_center: 'barberino', budget_amount: '50', actual_amount: null },
    { account_code: '630301', cost_center: 'valdichiana', budget_amount: 200, actual_amount: 0 },
    { account_code: '630302', cost_center: null, budget_amount: 30, actual_amount: 0 },
    { account_code: '630302', cost_center: 'rettifica_bilancio', budget_amount: -999, actual_amount: -999 },
    { account_code: null, cost_center: 'barberino', budget_amount: 5, actual_amount: 5 },
  ]

  it('somma per conto e centro, escludendo le rettifiche di bilancio', () => {
    const by = aggregateByCode(entries)
    expect(by['630301'].barberino).toEqual({ budget: 150, actual: 80 })
    expect(by['630301'].valdichiana).toEqual({ budget: 200, actual: 0 })
    expect(by['630302']).toEqual({ all: { budget: 30, actual: 0 } })
  })

  it('i conti padre sommano i sottoconti', () => {
    const accounts = [
      { id: 'l1', code: '63', parent_id: null },
      { id: 'l2', code: '6303', parent_id: 'l1' },
      { id: 'a', code: '630301', parent_id: 'l2' },
      { id: 'b', code: '630302', parent_id: 'l2' },
    ]
    const r = rollupByAccount(accounts, aggregateByCode(entries))
    expect(totalFor(r.l1, null)).toEqual({ budget: 380, actual: 80 })
    expect(totalFor(r.l2, 'barberino')).toEqual({ budget: 150, actual: 80 })
    expect(totalFor(r.b, 'barberino')).toEqual({ budget: 0, actual: 0 })
  })

  it('una gerarchia circolare non va in loop', () => {
    const accounts = [
      { id: 'x', code: 'X', parent_id: 'y' },
      { id: 'y', code: 'Y', parent_id: 'x' },
    ]
    const r = rollupByAccount(accounts, { X: { all: { budget: 1, actual: 0 } } })
    expect(totalFor(r.x, null).budget).toBeGreaterThanOrEqual(1)
  })
})
