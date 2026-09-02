import { describe, it, expect } from 'vitest'
import {
  SCHEDULE_MODE_GROUPS, SCHEDULE_MODE_LABELS, SCHEDULE_MODES_FINE_MESE,
  scheduleLabel, parseScheduleLabel, installmentDays, findScheduleMode,
} from './paymentSchedule'

describe('paymentSchedule', () => {
  it('espone tutte le dilazioni multiple fino a 120 gg (fine mese)', () => {
    expect(SCHEDULE_MODES_FINE_MESE.map(m => m.label)).toEqual([
      '30 gg DFFM', '30/60 gg DFFM', '30/60/90 gg DFFM', '30/60/90/120 gg DFFM',
      '60 gg DFFM', '60/90 gg DFFM', '60/90/120 gg DFFM',
      '90 gg DFFM', '90/120 gg DFFM',
      '120 gg DFFM',
    ])
  })

  it('include A Vista, Fine mese e Data fissa mese', () => {
    expect(SCHEDULE_MODE_LABELS).toContain('A Vista')
    expect(SCHEDULE_MODE_LABELS).toContain('Fine mese')
    expect(SCHEDULE_MODE_LABELS).toContain('Data fissa mese')
  })

  it('non ha etichette duplicate', () => {
    expect(new Set(SCHEDULE_MODE_LABELS).size).toBe(SCHEDULE_MODE_LABELS.length)
  })

  it('costruisce l etichetta dal piano', () => {
    expect(scheduleLabel('fine_mese', 90, 2)).toBe('90/120 gg DFFM')
    expect(scheduleLabel('data_fattura', 30, 4)).toBe('30/60/90/120 gg D.F.')
    expect(scheduleLabel('fine_mese', 0, 1)).toBe('Fine mese')
    expect(scheduleLabel('data_fattura', 0, 1)).toBe('A Vista')
    expect(scheduleLabel('fine_mese', null, 1)).toBe('da definire')
  })

  it('fa il round-trip etichetta -> piano -> etichetta su tutte le modalita', () => {
    SCHEDULE_MODE_GROUPS.flatMap(g => g.items).forEach(mode => {
      const p = parseScheduleLabel(mode.label)
      if (mode.dataFissa) { expect(p.dataFissa).toBe(true); return }
      expect(p.base).toBe(mode.base)
      expect(p.prima).toBe(mode.prima)
      expect(p.rate).toBe(mode.rate)
      expect(scheduleLabel(p.base, p.prima, p.rate)).toBe(mode.label)
    })
  })

  it('accetta combinazioni non standard', () => {
    expect(parseScheduleLabel('45/75 gg DFFM')).toEqual({ base: 'fine_mese', prima: 45, rate: 2, dataFissa: false })
    expect(installmentDays(45, 3)).toEqual([45, 75, 105])
  })

  it('riconosce una modalita standard dal piano salvato', () => {
    expect(findScheduleMode('fine_mese', 60, 3)?.label).toBe('60/90/120 gg DFFM')
    expect(findScheduleMode('fine_mese', 45, 2)).toBeUndefined()
  })
})
