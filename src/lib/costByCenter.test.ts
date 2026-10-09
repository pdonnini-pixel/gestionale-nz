import { describe, it, expect } from 'vitest'
import { buildPreventivo, rollupByAccount, totalFor } from './costByCenter'

const isRevenue = (code: string) => code.startsWith('51')

describe('costByCenter', () => {
  const entries = [
    { account_code: '630301', cost_center: 'barberino', budget_amount: 100 },
    { account_code: '630301', cost_center: 'barberino', budget_amount: '50' },
    { account_code: '630301', cost_center: 'valdichiana', budget_amount: 200 },
    { account_code: '630302', cost_center: null, budget_amount: 30 },
    { account_code: '630302', cost_center: 'rettifica_bilancio', budget_amount: -999 },
    { account_code: '630302', cost_center: 'all', budget_amount: 777, is_placeholder: true },
    { account_code: '510107', cost_center: 'barberino', budget_amount: 5000 },
    { account_code: null, cost_center: 'barberino', budget_amount: 5 },
  ]

  it('costi da budget_entries senza segnaposto né rettifica bilancio', () => {
    const r = buildPreventivo(entries, [], isRevenue)
    expect(r.byCode['630301']).toEqual({ barberino: 150, valdichiana: 200 })
    expect(r.byCode['630302']).toEqual({ all: 30 })
    expect(r.placeholdersExcluded).toBe(1)
    // senza budget_confronto i ricavi restano quelli di budget_entries
    expect(r.byCode['510107']).toEqual({ barberino: 5000 })
    expect(r.revenueFromConfronto).toBe(false)
  })

  it('con budget_confronto i ricavi vengono dal preventivo mensile (rev_monthly)', () => {
    const confronto = [
      { account_code: '510107', cost_center: 'barberino', amount: 40, entry_type: 'rev_monthly', month: 1 },
      { account_code: '510107', cost_center: 'barberino', amount: 60, entry_type: 'rev_monthly', month: 2 },
      { account_code: '510107', cost_center: 'barberino', amount: 999, entry_type: 'cons_monthly', month: 1 },
      { account_code: '510107', cost_center: 'barberino', amount: 999, entry_type: 'rev_monthly', month: 0 },
    ]
    const r = buildPreventivo(entries, confronto, isRevenue)
    expect(r.byCode['510107']).toEqual({ barberino: 100 })
    expect(r.byCode['630301']).toEqual({ barberino: 150, valdichiana: 200 })
    expect(r.revenueFromConfronto).toBe(true)
  })

  it('i conti padre sommano i sottoconti', () => {
    const accounts = [
      { id: 'l1', code: '63', parent_id: null },
      { id: 'l2', code: '6303', parent_id: 'l1' },
      { id: 'a', code: '630301', parent_id: 'l2' },
      { id: 'b', code: '630302', parent_id: 'l2' },
    ]
    const r = rollupByAccount(accounts, buildPreventivo(entries, [], isRevenue).byCode)
    expect(totalFor(r.l1, null)).toBe(380)
    expect(totalFor(r.l2, 'barberino')).toBe(150)
    expect(totalFor(r.b, 'barberino')).toBe(0)
  })

  it('una gerarchia circolare non va in loop', () => {
    const accounts = [
      { id: 'x', code: 'X', parent_id: 'y' },
      { id: 'y', code: 'Y', parent_id: 'x' },
    ]
    const r = rollupByAccount(accounts, { X: { all: 1 } })
    expect(totalFor(r.x, null)).toBeGreaterThanOrEqual(1)
  })
})
