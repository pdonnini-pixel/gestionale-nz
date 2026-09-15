import { describe, it, expect } from 'vitest'
import {
  getOutletLifecycle,
  isOutletOpenInPeriod,
  monthsOpenInYear,
  daysToOpening,
  outletLifecycleCaption,
  safePct,
  safeRatio,
} from './outletLifecycle'

const today = new Date(2026, 8, 14) // 14/09/2026

describe('getOutletLifecycle', () => {
  it('outlet con apertura futura è programmato', () => {
    expect(getOutletLifecycle({ opening_date: '2026-11-05' }, today)).toBe('programmato')
  })
  it('outlet aperto senza chiusura è attivo', () => {
    expect(getOutletLifecycle({ opening_date: '2026-03-24' }, today)).toBe('attivo')
  })
  it('apre oggi: è attivo (la data di apertura è inclusa)', () => {
    expect(getOutletLifecycle({ opening_date: '2026-09-14' }, today)).toBe('attivo')
  })
  it('chiusura nel passato vince sull\'apertura', () => {
    expect(getOutletLifecycle({ opening_date: '2020-01-01', closing_date: '2026-01-31' }, today)).toBe('chiuso')
  })
  it('senza date usa is_active', () => {
    expect(getOutletLifecycle({ is_active: false }, today)).toBe('chiuso')
    expect(getOutletLifecycle({ is_active: true }, today)).toBe('attivo')
    expect(getOutletLifecycle({}, today)).toBe('attivo')
  })
  it('null/undefined è attivo (compatibilità con le pagine che passano tutto)', () => {
    expect(getOutletLifecycle(null, today)).toBe('attivo')
  })
})

describe('isOutletOpenInPeriod / monthsOpenInYear', () => {
  const roma = { opening_date: '2026-11-05' }
  it('outlet che apre a novembre non è aperto nel primo semestre', () => {
    expect(isOutletOpenInPeriod(roma, 2026, 1, 6)).toBe(false)
  })
  it('è aperto nel mese di apertura anche se apre a metà mese', () => {
    expect(isOutletOpenInPeriod(roma, 2026, 11, 11)).toBe(true)
  })
  it('è aperto per tutto l\'anno successivo', () => {
    expect(isOutletOpenInPeriod(roma, 2027)).toBe(true)
  })
  it('mesi aperti nel 2026 sono novembre e dicembre', () => {
    expect(monthsOpenInYear(roma, 2026)).toEqual([11, 12])
  })
  it('outlet chiuso a gennaio non conta da febbraio', () => {
    const o = { opening_date: '2020-01-01', closing_date: '2026-01-15' }
    expect(monthsOpenInYear(o, 2026)).toEqual([1])
  })
  it('senza date è sempre aperto, tranne se disattivato', () => {
    expect(isOutletOpenInPeriod({}, 2026)).toBe(true)
    expect(isOutletOpenInPeriod({ is_active: false }, 2026)).toBe(false)
  })
})

describe('daysToOpening / caption', () => {
  it('conta i giorni all\'apertura', () => {
    expect(daysToOpening({ opening_date: '2026-11-05' }, today)).toBe(52)
  })
  it('è null per un outlet già aperto', () => {
    expect(daysToOpening({ opening_date: '2026-03-24' }, today)).toBeNull()
  })
  it('didascalia con la data', () => {
    expect(outletLifecycleCaption({ opening_date: '2026-11-05' }, today)).toBe('In apertura dal 05/11/2026')
    expect(outletLifecycleCaption({ opening_date: '2026-03-24' }, today)).toBe('Attivo')
  })
})

describe('safeRatio / safePct', () => {
  it('denominatore zero o negativo dà null, mai 0 o Infinity', () => {
    expect(safeRatio(1200, 0)).toBeNull()
    expect(safePct(1200, 0)).toBeNull()
    expect(safeRatio(5, -1)).toBeNull()
  })
  it('rapporto normale', () => {
    expect(safePct(30, 120)).toBe(25)
  })
})
