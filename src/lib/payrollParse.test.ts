import { describe, it, expect } from 'vitest'
import { parseInfinityNetti, parseInfinityNettiPages, matchOutletName, parseItNum, type ParserOutlet } from './payrollParse'

const OUTLETS: ParserOutlet[] = [
  { name: 'VALDICHIANA', cost_center_key: 'valdichiana' },
  { name: 'BARBERINO', cost_center_key: 'barberino' },
  { name: 'PALMANOVA', cost_center_key: 'palmanova' },
  { name: 'SEDE / MAGAZZINO', cost_center_key: 'sede_magazzino', mall_name: 'Matassino' },
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

describe('parseInfinityNettiPages — abbinamento per colonna (ordine di stream)', () => {
  const p1 = 'Elenco netti Progressivo ripartizione n.2: Filiale: 0000000001 - VALDICHIANA VILLAGE ; Cod. dip. Cognome e nome Importo '
    + '0000003 0000004 0000006 0000007 0000040 0000066 '
    + 'FELICI SILVIA LORENZINI MARTINA MUCCIARELLI GINEVRA TAVANTI SARA CORSANO CHIARA MEUCCI LUDOVICA '
    + '2.399,00 1.356,00 1.329,00 1.301,00 2.339,26 607,76 '
    + 'Totale di ripartizione 9.332,02 Nr dipendenti 6'
  const p3 = 'Filiale: 0000000003 - PALMANOVA OUTLET UDINE ; Cod. dip. Cognome e nome Importo '
    + '0000020 0000041 0000049 0000072 0000019 '
    + 'ASTUTI MARINA MIR SHAFIEI SHADI BUSE SARA DROZINA ALICE ROSSI ANNA '
    + '1.254,00 1.618,00 1.304,00 352,25 872,00 '
    + 'Totale di ripartizione 5.400,25 Nr dipendenti 5'
  const p5 = "Filiale: 0000000005 - MATASSINO ; Cod. dip. Cognome e nome Importo "
    + '0000001 0000030 0000035 0000063 0000064 0000073 0000080 '
    + "GALLO MASSIMO SCANU SABRINA SCANU DENISE D'ALESSANDRO NICOLA CENI LORENZO ROSSETI VERONICA RIGHI ANNA "
    + '12.466,00 892,00 919,00 1.210,00 1.518,83 1.450,00 124,00 '
    + 'Totale di ripartizione 18.579,83 Nr dipendenti 7'

  it('p1 Valdichiana: 6 righe, netti e nomi corretti, nessun warn', () => {
    const { rows } = parseInfinityNettiPages([p1], OUTLETS)
    expect(rows.length).toBe(6)
    expect(rows.every((r) => r.outlet === 'VALDICHIANA')).toBe(true)
    expect(rows[0]).toMatchObject({ matricola: '0000003', cognome: 'FELICI', nome: 'SILVIA', netto: 2399 })
    expect(rows[4]).toMatchObject({ matricola: '0000040', netto: 2339.26 })
    expect(rows[5]).toMatchObject({ matricola: '0000066', netto: 607.76 })
    expect(rows.some((r) => r.warn)).toBe(false)
    expect(rows.reduce((s, r) => s + (r.netto || 0), 0)).toBeCloseTo(9332.02, 2)
  })

  it('p3 Palmanova: 5 righe, somma 5.400,25; nomi provvisori (3 parole → non appaiabili)', () => {
    const { rows } = parseInfinityNettiPages([p3], OUTLETS)
    expect(rows.length).toBe(5)
    expect(rows.every((r) => r.outlet === 'PALMANOVA')).toBe(true)
    expect(rows.map((r) => r.netto)).toEqual([1254, 1618, 1304, 352.25, 872])
    expect(rows.every((r) => r.cognome === '')).toBe(true) // provvisori → matricola in fase di creazione
    expect(rows.reduce((s, r) => s + (r.netto || 0), 0)).toBeCloseTo(5400.25, 2)
  })

  it('p5 Matassino → outlet SEDE / MAGAZZINO via mall_name; GALLO 12.466 e CENI 1.518,83', () => {
    const { rows } = parseInfinityNettiPages([p5], OUTLETS)
    expect(rows.length).toBe(7)
    expect(rows.every((r) => r.outlet === 'SEDE / MAGAZZINO')).toBe(true)
    expect(rows[0]).toMatchObject({ matricola: '0000001', cognome: 'GALLO', netto: 12466 })
    expect(rows[4]).toMatchObject({ matricola: '0000064', netto: 1518.83 })
    expect(rows.reduce((s, r) => s + (r.netto || 0), 0)).toBeCloseTo(18579.83, 2)
  })

  it('documento completo: somma di p1+p3+p5', () => {
    const { rows, fileTotal } = parseInfinityNettiPages([p1, p3, p5], OUTLETS)
    expect(rows.length).toBe(18)
    expect(fileTotal).toBeCloseTo(9332.02 + 5400.25 + 18579.83, 2)
  })

  it('filiale che non quadra → righe marcate warn', () => {
    const bad = 'Filiale: 0000000001 - VALDICHIANA VILLAGE ; 0000003 0000004 ROSSI MARIO VERDI ANNA 1.000,00 2.000,00 Totale di ripartizione 9.999,99 Nr dipendenti 2'
    const { rows } = parseInfinityNettiPages([bad], OUTLETS)
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.warn)).toBe(true)
  })
})
