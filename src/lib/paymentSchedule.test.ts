import { describe, it, expect } from 'vitest'
import {
  SCHEDULE_MODE_GROUPS, SCHEDULE_MODE_LABELS, SCHEDULE_MODES_FINE_MESE,
  scheduleLabel, parseScheduleLabel, installmentDays, findScheduleMode,
  planStatus, derivePlan, computeInstallments, scheduleModeText,
} from './paymentSchedule'
import {
  PAYMENT_METHOD_OPTIONS, PAYMENT_METHOD_LABELS, ribaMethodForDays, methodForPlan,
} from './paymentMethods'

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

describe('stato del piano fornitore', () => {
  it('distingue piano ok, assente e incompleto', () => {
    expect(planStatus({ payment_base: 'fine_mese', prima_scadenza_gg: 30, numero_rate: 1 })).toBe('ok')
    expect(planStatus({ payment_base: 'fine_mese', prima_scadenza_gg: 0, numero_rate: 1 })).toBe('ok')
    expect(planStatus({ payment_base: null, prima_scadenza_gg: null, numero_rate: null })).toBe('assente')
    expect(planStatus({ payment_base: 'data_fattura', prima_scadenza_gg: null, numero_rate: 1 })).toBe('incompleto')
    expect(planStatus({ payment_base: 'fine_mese', prima_scadenza_gg: 30, numero_rate: null })).toBe('incompleto')
    expect(planStatus(undefined)).toBe('assente')
  })

  it('senza piano ripiega su 30 gg fine mese, rata unica', () => {
    const p = derivePlan({})
    expect(p).toMatchObject({ base: 'fine_mese', gg: 30, nRate: 1, hasPlan: false })
  })
})

describe('calcolo delle scadenze', () => {
  it('fine mese: 30/60 su fattura del 15/09/2026 -> 31/10 e 30/11', () => {
    const plan = derivePlan({ payment_base: 'fine_mese', prima_scadenza_gg: 30, numero_rate: 2 })
    expect(computeInstallments('2026-09-15', plan, 1000)).toEqual([
      { dueDate: '2026-10-31', amount: 500 },
      { dueDate: '2026-11-30', amount: 500 },
    ])
  })

  it('fine mese con 0 gg: ultimo giorno del mese della fattura', () => {
    const plan = derivePlan({ payment_base: 'fine_mese', prima_scadenza_gg: 0, numero_rate: 1 })
    expect(computeInstallments('2026-09-15', plan, 100)[0].dueDate).toBe('2026-09-30')
  })

  it('data fattura: 30/60 su fattura del 15/09/2026 -> 15/10 e 14/11', () => {
    const plan = derivePlan({ payment_base: 'data_fattura', prima_scadenza_gg: 30, numero_rate: 2 })
    expect(computeInstallments('2026-09-15', plan, 1000).map(r => r.dueDate)).toEqual(['2026-10-15', '2026-11-14'])
  })

  it('l ultima rata quadra il totale anche con importi non divisibili', () => {
    const plan = derivePlan({ payment_base: 'fine_mese', prima_scadenza_gg: 30, numero_rate: 3 })
    const rate = computeInstallments('2026-09-15', plan, 100)
    expect(rate.map(r => r.amount)).toEqual([33.33, 33.33, 33.34])
    expect(rate.reduce((t, r) => t + r.amount, 0)).toBeCloseTo(100, 2)
  })
})

describe('testi delle tendine', () => {
  it('mantiene la notazione compatta usata in azienda', () => {
    const modo = (label: string) => SCHEDULE_MODE_GROUPS.flatMap(g => g.items).find(m => m.label === label)!
    expect(scheduleModeText(modo('30/60 gg DFFM'))).toBe('30/60 gg DFFM')
    expect(scheduleModeText(modo('30/60/90/120 gg DFFM'))).toBe('30/60/90/120 gg DFFM')
    expect(scheduleModeText(modo('90/120 gg DFFM'))).toBe('90/120 gg DFFM')
    expect(scheduleModeText(modo('90 gg D.F.'))).toBe('90 gg D.F.')
    expect(scheduleModeText(modo('A Vista'))).toBe('A Vista')
    expect(scheduleModeText(modo('Fine mese'))).toBe('Fine mese (0 gg DFFM)')
  })

  it('il testo mostrato non cambia mai il valore salvato', () => {
    SCHEDULE_MODE_GROUPS.flatMap(g => g.items).forEach(m => {
      if (m.dataFissa) return
      expect(parseScheduleLabel(m.label)).toMatchObject({ base: m.base, prima: m.prima, rate: m.rate })
    })
  })
})

describe('metodo Ri.Ba. allineato al piano', () => {
  it('ricava il termine dai giorni della prima scadenza', () => {
    expect(ribaMethodForDays(30)).toBe('riba_30')
    expect(ribaMethodForDays(0)).toBe('riba_30')
    expect(ribaMethodForDays(41)).toBe('riba_60')
    expect(ribaMethodForDays(90)).toBe('riba_90')
    expect(ribaMethodForDays(120)).toBe('riba_120')
    expect(ribaMethodForDays(null)).toBe('riba_30')
  })

  it('allinea solo le Ri.Ba., gli altri metodi restano come sono', () => {
    expect(methodForPlan('riba_30', 90)).toBe('riba_90')
    expect(methodForPlan('bonifico_ordinario', 90)).toBe('bonifico_ordinario')
    expect(methodForPlan('rid', 0)).toBe('rid')
  })

  it('la tendina del metodo non chiede più i giorni', () => {
    const riba = PAYMENT_METHOD_OPTIONS.find(g => g.group === 'RIBA')!
    expect(riba.items.map(i => i.label)).toEqual(['Ri.Ba.'])
    // le etichette complete restano leggibili per i dati già a sistema
    expect(PAYMENT_METHOD_LABELS.riba_90).toBe('Ri.Ba. 90gg')
  })
})
