import { describe, it, expect } from 'vitest'
import { annoFinePeriodo } from './bilancioParser'

describe('anno del periodo del bilancio', () => {
  it('legge l\'anno di fine, non quello di inizio («DAL» contiene «AL»)', () => {
    expect(annoFinePeriodo('PERIODO DAL 01/01/2025 AL 31/12/2025')).toBe(2025)
    expect(annoFinePeriodo('PERIODO DAL 01/01/2026 AL 30/09/2026')).toBe(2026)
    expect(annoFinePeriodo('PERIODO DAL 01/07/2025 AL 30/06/2026')).toBe(2026)
  })
  it('senza periodo non blocca niente', () => {
    expect(annoFinePeriodo('')).toBeNull()
    expect(annoFinePeriodo(undefined)).toBeNull()
  })
})

import { toSupabaseRecords, type BilancioParsed } from './bilancioParser'

const riga = (code: string, amount: number) => ({ code, description: code, amount, level: code.length <= 2 ? 0 : 1, isMacro: code.length <= 2, isItalic: false })

describe('totali del conto economico dal bilancio di verifica', () => {
  // Numeri del bilancio di verifica Zago 2025, uguali al CEE depositato.
  const parsed: BilancioParsed = {
    meta: { pages: 5, company: 'X', period: 'PERIODO DAL 01/01/2025 AL 31/12/2025', date: '' },
    patrimoniale: { attivita: [], passivita: [], totals: {} },
    contoEconomico: {
      costi: [riga('61', 731440.71), riga('63', 158101.52), riga('65', 270309.66), riga('67', 355972.2), riga('6701', 261668.91),
        riga('69', 5879.82), riga('71', 9498.05), riga('73', -27622), riga('77', 10823.57), riga('83', 1560.01), riga('93', 4801)],
      ricavi: [riga('51', 1500479.31), riga('59', 5515.07)],
      totals: { costi: 1520764.54, ricavi: 1520764.54, risultato: -14770.16 },
    },
  }
  const rec = toSupabaseRecords(parsed, 'c', 2025)
  const val = (k: string) => rec.find(r => r.section === 'conto_economico' && r.account_code === k)?.amount
  it('valore della produzione dai ricavi 5x, non dal totale a pareggio', () => {
    expect(val('ricavi_vendite')).toBe(1505994.38)
  })
  it('totale costi della produzione dalle voci B', () => {
    expect(val('totale_costi_produzione')).toBe(1514403.53)
  })
  it('differenza A-B e imposte come nel CEE', () => {
    expect(val('differenza_ab')).toBe(-8409.15)
    expect(val('imposte')).toBe(4801)
    expect(val('utile_netto')).toBe(-14770.16)
  })
})
