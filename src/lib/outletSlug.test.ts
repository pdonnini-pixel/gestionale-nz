import { describe, it, expect } from 'vitest'
import { slugOutlet, segmentoOutlet, trovaOutlet, meseDiRoma, etichettaMese, raggruppaPerMese } from './outletSlug'

const OUTLETS = [
  { id: 'aaaa-1', name: 'ROMA SORATTE', code: 'RSO' },
  { id: 'bbbb-2', name: 'Città Sant\'Angelo', code: 'CSA' },
  { id: 'cccc-3', name: 'Operativi', code: 'OPE' },
  { id: 'dddd-4', name: 'Torino', code: 'TRN' },
  { id: 'eeee-5', name: 'TORINO', code: 'TR2' },
]

describe('slugOutlet', () => {
  it('toglie maiuscole, accenti e simboli', () => {
    expect(slugOutlet('ROMA SORATTE')).toBe('roma-soratte')
    expect(slugOutlet('Città Sant\'Angelo')).toBe('citta-sant-angelo')
    expect(slugOutlet('  Valdichiana  ')).toBe('valdichiana')
    expect(slugOutlet(null)).toBe('')
  })
})

describe('segmentoOutlet', () => {
  it('usa lo slug del nome', () => {
    expect(segmentoOutlet(OUTLETS[0], OUTLETS)).toBe('roma-soratte')
  })
  it('torna all\'id se lo slug è riservato o doppio', () => {
    expect(segmentoOutlet(OUTLETS[2], OUTLETS)).toBe('cccc-3')
    expect(segmentoOutlet(OUTLETS[3], OUTLETS)).toBe('dddd-4')
    expect(segmentoOutlet({ id: 'x', name: '' }, OUTLETS)).toBe('x')
  })
})

describe('trovaOutlet', () => {
  it('risolve id, slug, nome e codice', () => {
    expect(trovaOutlet('aaaa-1', OUTLETS)?.id).toBe('aaaa-1')
    expect(trovaOutlet('roma-soratte', OUTLETS)?.id).toBe('aaaa-1')
    expect(trovaOutlet('roma%20soratte', OUTLETS)?.id).toBe('aaaa-1')
    expect(trovaOutlet('rso', OUTLETS)?.id).toBe('aaaa-1')
    expect(trovaOutlet('niente', OUTLETS)).toBeNull()
    expect(trovaOutlet(undefined, OUTLETS)).toBeNull()
  })
  it('non si rompe con un segmento malformato', () => {
    expect(trovaOutlet('%E0%A4%A', OUTLETS)).toBeNull()
  })
})

describe('mesi di caricamento', () => {
  it('legge il mese in ora di Roma', () => {
    expect(meseDiRoma('2026-11-16T08:49:56Z')).toBe('2026-11')
    expect(meseDiRoma('2026-11-30T23:30:00Z')).toBe('2026-12')
    expect(meseDiRoma(null)).toBe('')
    expect(meseDiRoma('boh')).toBe('')
  })
  it('scrive il mese per esteso', () => {
    expect(etichettaMese('2026-11')).toBe('Novembre 2026')
    expect(etichettaMese('')).toBe('Senza data')
  })
  it('mette in alto il mese più recente e in fondo chi non ha data', () => {
    const righe = [
      { n: 'ott-1', d: '2026-10-03T10:00:00Z' },
      { n: 'senza', d: null },
      { n: 'nov-1', d: '2026-11-02T10:00:00Z' },
      { n: 'nov-2', d: '2026-11-16T10:00:00Z' },
    ]
    const g = raggruppaPerMese(righe, r => r.d)
    expect(g.map(x => x.mese)).toEqual(['2026-11', '2026-10', ''])
    expect(g[0].righe.map(r => r.n)).toEqual(['nov-2', 'nov-1'])
  })
})
