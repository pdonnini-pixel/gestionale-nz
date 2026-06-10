import { describe, it, expect } from 'vitest'
import { parseInfinityNetti, matchOutletName, parseItNum, type ParserOutlet } from './payrollParse'

const OUTLETS: ParserOutlet[] = [
  { name: 'VALDICHIANA', cost_center_key: 'valdichiana' },
  { name: 'BARBERINO', cost_center_key: 'barberino' },
  { name: 'SEDE / MAGAZZINO', cost_center_key: 'sede_magazzino' },
]

describe('parseItNum', () => {
  it('numeri italiani', () => {
    expect(parseItNum('2.399,00')).toBe(2399)
    expect(parseItNum('607,76')).toBe(607.76)
    expect(parseItNum('1.234,56')).toBe(1234.56)
    expect(parseItNum('')).toBeNull()
  })
})

describe('matchOutletName', () => {
  it('mappa la filiale all_outlet a runtime', () => {
    expect(matchOutletName('VALDICHIANA VILLAGE', OUTLETS)).toBe('VALDICHIANA')
    expect(matchOutletName('BARBERINO', OUTLETS)).toBe('BARBERINO')
  })
})

describe('parseInfinityNetti — fixture Valdichiana', () => {
  // Testo già ricostruito per geometria (come prodotto da extractPdfLines).
  const lines = [
    'Progressivo ripartizione n.2: Filiale: 0000000001 - VALDICHIANA VILLAGE ;',
    'Cod. dip. Cognome e nome Importo',
    '0000003 FELICI SILVIA 2.399,00',
    '0000004 LORENZINI MARTINA 1.356,00',
    '0000006 MUCCIARELLI GINEVRA 1.329,00',
    '0000007 TAVANTI SARA 1.301,00',
    '0000040 CORSANO CHIARA 2.339,26',
    '0000066 MEUCCI LUDOVICA 607,76',
    'TToottaallee ddii rriippaarrttiizziioonnee 9.332,02 Nr dipendenti 6',
  ]
  const { rows, fileTotal } = parseInfinityNetti(lines, OUTLETS)

  it('legge 6 righe dipendente', () => {
    expect(rows.length).toBe(6)
  })
  it('estrae matricola, nome e netto corretti', () => {
    expect(rows[0]).toMatchObject({ matricola: '0000003', cognome: 'FELICI', nome: 'SILVIA', netto: 2399 })
    expect(rows[4]).toMatchObject({ matricola: '0000040', netto: 2339.26 })
    expect(rows[5]).toMatchObject({ matricola: '0000066', nome: 'LUDOVICA', netto: 607.76 })
  })
  it('mappa tutte le righe a VALDICHIANA', () => {
    expect(rows.every((r) => r.outlet === 'VALDICHIANA')).toBe(true)
  })
  it('ignora la riga Totale coi caratteri raddoppiati', () => {
    expect(rows.some((r) => /totale/i.test(r.cognome))).toBe(false)
  })
  it('totale di controllo = somma dei netti letti', () => {
    expect(fileTotal).toBeCloseTo(9332.02, 2)
  })
  it('legge l_importo anche con IBAN dopo', () => {
    const r = parseInfinityNetti(
      ['Filiale: 0000000004 - FRANCIACORTA ;', '0000051 PIANTONI ROSITA 1.417,00 IT53O0503453420000000014530'],
      [{ name: 'FRANCIACORTA', cost_center_key: 'franciacorta' }],
    )
    expect(r.rows[0].netto).toBe(1417)
  })
})
