import { describe, it, expect } from 'vitest'
import { buildGuidaRows } from './primaNotaGuida'

describe('buildGuidaRows: il foglio Guida spiega ogni foglio e come si cerca', () => {
  const rows = buildGuidaRows({ periodo: 'Settembre 2026', dataUsata: 'data contabile (banca)', conti: ['BCC Valdarno', 'MPS'], carte: ['Carta credito BCC 5388'], carteDebito: ['Carta di debito MPS n. 99899952'], flussiSenzaBuste: 1 })
  const text = rows.map(r => r.cells.join(' | ')).join('\n')
  it('nomina i fogli del file e la legenda dei colori', () => {
    expect(text).toContain('BCC Valdarno · MPS')
    expect(text).toContain('Carta credito BCC 5388')
    expect(text).toContain('Carta di debito MPS n. 99899952')
    expect(text).toContain('non è un incasso')
    expect(text).toContain('1 disposizione senza buste')
    expect(text).toContain('Righe ambra')
    expect(text).toContain('RiBa')
  })
  it('dice come assegnare la distinta stipendi partendo dall\'addebito in banca', () => {
    expect(text).toContain('Addebito in banca')
    expect(text).toContain('stesso ID flusso')
  })
  it('senza carte e senza flussi orfani lo dice, e le sezioni hanno il tipo giusto', () => {
    const r2 = buildGuidaRows({ periodo: 'x', dataUsata: 'y', conti: [], carte: [], carteDebito: [], flussiSenzaBuste: 0 })
    const t2 = r2.map(r => r.cells.join(' | ')).join('\n')
    expect(t2).toContain('Nessun estratto carta')
    expect(t2).toContain('Nessun pagamento con carta di debito')
    expect(t2).toContain('Nessun conto nel periodo')
    expect(t2).not.toContain('senza buste che le spieghino')
    expect(r2[0].kind).toBe('title')
    expect(r2.filter(r => r.kind === 'section').length).toBeGreaterThanOrEqual(6)
  })
})
