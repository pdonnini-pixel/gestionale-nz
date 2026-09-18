import { describe, it, expect } from 'vitest'
import { rentCoveredCostCenters, outletsWithOwnRent } from './cashflowRent'

const LOC = 'cat-locazione-outlet'
const COND = 'cat-spese-condominiali'
const rentCategories = new Set([LOC])

describe('rentCoveredCostCenters', () => {
  it('riconosce il centro di costo con una ricorrenza di canone', () => {
    const covered = rentCoveredCostCenters(
      [{ cost_center: 'roma_soratte', cost_category_id: LOC, is_active: true, amount: 6533.33 }],
      rentCategories,
    )
    expect(covered.has('roma_soratte')).toBe(true)
  })

  it('non considera coperte le spese condominiali e di marketing', () => {
    const covered = rentCoveredCostCenters(
      [{ cost_center: 'roma_soratte', cost_category_id: COND, is_active: true, amount: 1715 }],
      rentCategories,
    )
    expect(covered.size).toBe(0)
  })

  it('ignora le ricorrenze disattivate, quelle a zero e quelle senza categoria', () => {
    const covered = rentCoveredCostCenters(
      [
        { cost_center: 'torino', cost_category_id: LOC, is_active: false, amount: 5666.67 },
        { cost_center: 'barberino', cost_category_id: LOC, is_active: true, amount: 0 },
        { cost_center: 'palmanova', cost_category_id: null, is_active: true, amount: 3554.22 },
      ],
      rentCategories,
    )
    expect(covered.size).toBe(0)
  })

  it('senza categorie di canone non copre niente', () => {
    const covered = rentCoveredCostCenters(
      [{ cost_center: 'roma_soratte', cost_category_id: LOC, is_active: true, amount: 6533.33 }],
      new Set<string>(),
    )
    expect(covered.size).toBe(0)
  })
})

describe('outletsWithOwnRent', () => {
  const outlets = [
    { code: 'RSO', cost_center_key: 'roma_soratte', rent_monthly: 6533.33 },
    { code: 'VDC', cost_center_key: 'valdichiana', rent_monthly: 10405.83 },
    { code: 'SED', cost_center_key: 'sede_magazzino', rent_monthly: 2500 },
  ]

  it('toglie solo gli outlet il cui canone arriva già dalle ricorrenze', () => {
    const rimasti = outletsWithOwnRent(outlets, new Set(['roma_soratte', 'sede_magazzino']))
    expect(rimasti.map(o => o.code)).toEqual(['VDC'])
  })

  it('senza ricorrenze di canone la lista resta intera', () => {
    expect(outletsWithOwnRent(outlets, new Set<string>())).toHaveLength(3)
  })

  it('un outlet senza centro di costo non viene mai escluso', () => {
    const senzaChiave = [{ code: 'XXX', cost_center_key: null, rent_monthly: 1000 }]
    expect(outletsWithOwnRent(senzaChiave, new Set(['roma_soratte']))).toHaveLength(1)
  })
})
