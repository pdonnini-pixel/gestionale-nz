import { describe, it, expect } from 'vitest'
import { parseInfinityNetti, parseInfinityNettiPages, parseInfinityNettiItems, matchOutletName, parseItNum, parseProspettoPaghe, contrAziendaOutlet, type ParserOutlet } from './payrollParse'

const OUTLETS: ParserOutlet[] = [
  { name: 'VALDICHIANA', cost_center_key: 'valdichiana' },
  { name: 'BARBERINO', cost_center_key: 'barberino' },
  { name: 'PALMANOVA', cost_center_key: 'palmanova' },
  { name: 'VALMONTONE', cost_center_key: 'valmontone' },
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

  it('p8 Valmontone con DOPPIO totale (ripartizione + aziendale): nessun warn', () => {
    const p8 = 'Filiale: 0000000008 - VALMONTONE ; Cod. dip. Cognome e nome Importo '
      + '0000056 0000057 0000058 0000059 0000060 0000062 '
      + 'CACCIOTTI DANIELA GERMANI MARIA MELE FRANCESCA NUNZIANTE SILVIA PARIS AURORA TALONE FRANCESCA '
      + '1.625,00 1.150,00 983,00 1.143,00 841,00 1.171,00 '
      + 'Totale di ripartizione 6.913,00 Nr dipendenti 6 '
      + 'TToottaallee aazziieennddaallee 60.926,46 Nr dipendenti 41'
    const { rows } = parseInfinityNettiPages([p8], OUTLETS)
    expect(rows.length).toBe(6)
    expect(rows.every((r) => r.outlet === 'VALMONTONE')).toBe(true)
    expect(rows.some((r) => r.warn)).toBe(false)              // 6.913,00, NON 60.926,46
    expect(rows.reduce((s, r) => s + (r.netto || 0), 0)).toBeCloseTo(6913.00, 2)
  })

  it('filiale che non quadra → righe marcate warn', () => {
    const bad = 'Filiale: 0000000001 - VALDICHIANA VILLAGE ; 0000003 0000004 ROSSI MARIO VERDI ANNA 1.000,00 2.000,00 Totale di ripartizione 9.999,99 Nr dipendenti 2'
    const { rows } = parseInfinityNettiPages([bad], OUTLETS)
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.warn)).toBe(true)
  })
})

describe('parseInfinityNettiItems — righe per asse X (PDF ruotato)', () => {
  type PI = { str: string; x: number; y: number }
  // una persona = matricola(y23) + nome(y55) + netto(y206) sulla STESSA x
  const person = (x: number, mat: string, name: string, netto: string): PI[] => ([
    { str: mat, x, y: 23 }, { str: name, x, y: 55 }, { str: netto, x, y: 206 },
  ])
  const page1: PI[] = [
    { str: 'Filiale: 0000000001 - VALDICHIANA VILLAGE ;', x: 300, y: 400 },
    { str: 'Cod. dip.', x: 320, y: 23 }, { str: 'Cognome e nome', x: 320, y: 55 }, { str: 'Importo', x: 320, y: 206 },
    ...person(280, '0000003', 'FELICI SILVIA', '2.399,00'),
    ...person(250, '0000004', 'GERMANI MARIA LETIZIA', '1.356,00'),
    ...person(220, '0000006', "D'ALESSANDRO NICOLA", '1.329,00'),
    ...person(190, '0000007', 'MIR SHAFIEI SHADI', '1.301,00'),
    ...person(160, '0000040', 'CORSANO CHIARA', '2.339,26'),
    ...person(130, '0000066', 'MEUCCI LUDOVICA', '607,76'),
    { str: 'Totale di ripartizione', x: 50, y: 55 }, { str: '9.332,02', x: 50, y: 206 }, { str: 'Nr dipendenti 6', x: 50, y: 250 },
  ]

  it('estrae righe complete con NOME (anche multi-parola), mai la matricola come nome', () => {
    const { rows, fileTotal } = parseInfinityNettiItems([page1], OUTLETS)
    expect(rows.length).toBe(6)
    expect(rows.every((r) => r.outlet === 'VALDICHIANA')).toBe(true)
    expect(rows[0]).toMatchObject({ matricola: '0000003', cognome: 'FELICI', nome: 'SILVIA', netto: 2399 })
    expect(rows[1]).toMatchObject({ matricola: '0000004', cognome: 'GERMANI', nome: 'MARIA LETIZIA', netto: 1356 })
    expect(rows[2]).toMatchObject({ matricola: '0000006', cognome: "D'ALESSANDRO", nome: 'NICOLA' })
    expect(rows[3]).toMatchObject({ matricola: '0000007', cognome: 'MIR', nome: 'SHAFIEI SHADI' })
    expect(rows.some((r) => r.warn)).toBe(false)
    expect(fileTotal).toBeCloseTo(9332.02, 2)
    // nessuna riga ha la matricola come nome
    expect(rows.every((r) => r.cognome !== r.matricola)).toBe(true)
  })

  it('riga con netto+IBAN CONCATENATI nello stesso item (coord. reali PIANTONI)', () => {
    // pdfjs reale: l'importo e l'IBAN escono in UN solo item "1.417,00 IT53…"
    const page: PI[] = [
      { str: 'Filiale: 0000000004 - FRANCIACORTA VILLAGE ;', x: 300, y: 400 },
      { str: '0000051', x: 205.9, y: 23.1 },
      { str: 'PIANTONI ROSITA FRANCESC', x: 205.9, y: 55.1 },
      { str: '1.417,00 IT53O0503453420000000014530', x: 205.9, y: 205.9 },
      { str: '05034 53420 BANCO BPM S.P.A. ROMANO DI LOMBARDIA', x: 205.9, y: 479.6 },
      { str: 'Totale di ripartizione', x: 50, y: 55 }, { str: '1.417,00', x: 50, y: 206 }, { str: 'Nr dipendenti 1', x: 50, y: 250 },
    ]
    const { rows } = parseInfinityNettiItems([page], [{ name: 'FRANCIACORTA', cost_center_key: 'franciacorta' }])
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ matricola: '0000051', cognome: 'PIANTONI', nome: 'ROSITA FRANCESC', netto: 1417 })
    expect(rows[0].nome).not.toMatch(/IT53|BANCO|BPM|0503/)
    expect(rows.some((r) => r.warn)).toBe(false)
  })

  it('riga con IBAN/banca: il nome NON contiene IBAN né banca (token con Y > netto esclusi)', () => {
    const page: PI[] = [
      { str: 'Filiale: 0000000004 - FRANCIACORTA ;', x: 300, y: 400 },
      { str: '0000051', x: 200, y: 23 },
      { str: 'PIANTONI ROSITA FRANCESC', x: 200, y: 55 },
      { str: '1.417,00', x: 200, y: 206 },
      { str: 'IT53O0503453420000000014530', x: 200, y: 235 },
      { str: 'BANCO BPM S.P.A. ROMANO DI LOMBARDIA', x: 200, y: 480 },
      { str: 'Totale di ripartizione', x: 50, y: 55 }, { str: '1.417,00', x: 50, y: 206 }, { str: 'Nr dipendenti 1', x: 50, y: 250 },
    ]
    const { rows } = parseInfinityNettiItems([page], [{ name: 'FRANCIACORTA', cost_center_key: 'franciacorta' }])
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ matricola: '0000051', cognome: 'PIANTONI', nome: 'ROSITA FRANCESC', netto: 1417 })
    expect(rows[0].nome).not.toMatch(/IT53|BANCO|BPM|LOMBARDIA/)
    expect(rows.some((r) => r.warn)).toBe(false)
  })

  it('doppio totale (ripartizione + aziendale) → nessun warn, usa la ripartizione', () => {
    const page: PI[] = [
      { str: 'Filiale: 0000000008 - VALMONTONE ;', x: 300, y: 400 },
      ...person(280, '0000056', 'CACCIOTTI DANIELA', '1.625,00'),
      ...person(250, '0000057', 'GERMANI MARIA', '1.150,00'),
      { str: 'Totale di ripartizione', x: 50, y: 55 }, { str: '2.775,00', x: 50, y: 206 }, { str: 'Nr dipendenti 2', x: 50, y: 250 },
      { str: 'TToottaallee aazziieennddaallee', x: 40, y: 55 }, { str: '60.926,46', x: 40, y: 206 },
    ]
    const { rows } = parseInfinityNettiItems([page], OUTLETS)
    expect(rows.length).toBe(2)
    expect(rows.some((r) => r.warn)).toBe(false)
  })
})

describe('parseProspettoPaghe — Prospetto riepilogativo elaborazione paghe', () => {
  // Righe già ricostruite per geometria (come da extractPdfLines, TOL=2): l'imponibile
  // INAIL risulta già fuso sulla riga della PAT. Fixture derivate dai PDF reali gen-mar 2026 NZ.
  const PROS_OUTLETS: ParserOutlet[] = [
    { name: 'VALDICHIANA', cost_center_key: 'valdichiana', mall_name: 'Valdichiana Village' },
    { name: 'PALMANOVA', cost_center_key: 'palmanova', mall_name: 'Palmanova Outlet Village' },
    { name: 'VALMONTONE', cost_center_key: 'valmontone', mall_name: 'Valmontone Outlet' },
    { name: 'TORINO', cost_center_key: 'torino', city: 'Settimo Torinese' },
    { name: 'SEDE / MAGAZZINO', cost_center_key: 'sede_magazzino', mall_name: 'Matassino' },
  ]

  const valdichianaJan = [
    'Prospetto riepilogativo elaborazione paghe',
    'Periodo di elaborazione: Dal Gennaio 2026 Norm. - Al Gennaio 2026 Norm.',
    'Ripartizione: Filiale: 0000000001 VALDICHIANA VILLAGE',
    'NUMERO DIPENDENTI 6',
    '1 Retribuzioni Lorde 10.277,67',
    'Totale retribuzioni 10.622,51',
    'TAXBENEFIT NEW (trimestrale)',
    '0T0958 T.F.R. trasf. TAXBENEFIT NEW 101,63 101,63 101,63 101,63',
    'Totale id 1 1 101,63 101,63',
    'I.N.P.S.',
    'Totale id 1 1 3.198,28 -1.002,88 4.201,16',
    'EBINTER Ente Bilaterale Naz. Terziario',
    'Totale id 1 ok 9,02 -4,51 13,53',
    'Fondo EST',
    'Totale id 1 1 13,00 -2,00 15,00',
    'SEZIONE I.N.A.I.L.',
    '1 VALDICHIANA OUTLET 10.279,00',
    'SEZIONE FISCALE Imponibile Imp.Dipendente',
    '1 IRPEF Ordinaria -1.422,16',
  ]

  const matassinoJan = [
    'Ripartizione: Filiale: 0000000005 MATASSINO - FIGLINE E INCISA VALDARNO',
    'NUMERO DIPENDENTI 6',
    '1 Retribuzioni Lorde 5.873,44',
    '2 Compensi Collaboratori/Ammin. 15.600,99',
    'Totale retribuzioni 22.751,86',
    '0T0139 T.F.R. trasf. AZIMUT PREVIDENZA 101,32 101,32 101,32 101,32',
    'Totale id 1 Posizione 001 101,32 101,32',
    'I.N.P.S.',
    'Totale id 1 1 1.404,19 -499,10 1.903,29',
    'I.N.P.S. - Gestione separata',
    'Totale id 1 Posizione 001 2.496,16 -1.248,08 3.744,24',
    'EBINTER Ente Bilaterale Naz. Terziario',
    'Totale id 1 ok 5,09 -2,55 7,64',
    'Fondo EST',
    'Totale id 1 1 52,00 -8,00 60,00',
    'SEZIONE I.N.A.I.L.',
    '6 MATASSINO-AMMINISTRAZIONE 6.825,00 -4,25',
    'SEZIONE FISCALE',
  ]

  it('legge i componenti e mappa la filiale all_outlet (gennaio Valdichiana)', () => {
    const { isProspetto, rows, months } = parseProspettoPaghe(valdichianaJan, PROS_OUTLETS)
    expect(isProspetto).toBe(true)
    expect(months).toEqual([{ year: 2026, month: 1 }])
    const v = rows.find((r) => r.outlet === 'VALDICHIANA')!
    expect(v.totaleRetribuzioni).toBeCloseTo(10622.51, 2)
    expect(v.retribuzioniLorde).toBeCloseTo(10277.67, 2)
    expect(contrAziendaOutlet(v)).toBeCloseTo(3220.30, 2) // INPS+EBINTER+EST
    expect(v.tfrFondo).toBeCloseTo(101.63, 2)             // T.F.R. trasf. → aggiunto
    expect(v.compensiAmm).toBe(0)
    expect(v.contrGestioneSeparata).toBe(0)
    expect(v.inailPat).toEqual([{ code: '1', label: 'VALDICHIANA OUTLET', imponibile: 10279 }])
  })

  it('amministratori fuori dal costo outlet (gennaio Matassino → SEDE / MAGAZZINO)', () => {
    const { rows } = parseProspettoPaghe(matassinoJan, PROS_OUTLETS)
    const m = rows.find((r) => r.outlet === 'SEDE / MAGAZZINO')!
    expect(m.totaleRetribuzioni).toBeCloseTo(22751.86, 2)
    expect(m.compensiAmm).toBeCloseTo(15600.99, 2)
    // costo outlet base = Totale − Compensi amministratori
    expect(m.totaleRetribuzioni! - m.compensiAmm).toBeCloseTo(7150.87, 2)
    // solo contributi ordinari sull'outlet
    expect(contrAziendaOutlet(m)).toBeCloseTo(1461.28, 2)
    // gestione separata = voce amministratori, NON nell'outlet
    expect(m.contrGestioneSeparata).toBeCloseTo(2496.16, 2)
    expect(m.tfrFondo).toBeCloseTo(101.32, 2)
  })

  it('Quota T.F.R. dell\'anno è già nel Totale → non si aggiunge tfrFondo', () => {
    const lines = [
      'Ripartizione: Filiale: 0000000003 PALMANOVA OUTLET UDINE',
      '1 Retribuzioni Lorde 8.196,64',
      "ZP8134 Quota T.F.R. dell'anno 43,36",
      'Totale retribuzioni 8.271,31',
      'I.N.P.S.', 'Totale id 1 1 2.564,30 -800,74 3.365,04',
      'Fondo EST', 'Totale id 1 1 13,00 -2,00 15,00',
    ]
    const { rows } = parseProspettoPaghe(lines, PROS_OUTLETS)
    expect(rows[0].tfrFondo).toBe(0)
    expect(rows[0].totaleRetribuzioni).toBeCloseTo(8271.31, 2)
  })

  it('header Agg.1 + Progressivo ripartizione + PAT con parentesi/typo', () => {
    const lines = [
      'Periodo di elaborazione: Dal Marzo 2026 Agg.1 - Al Marzo 2026 Norm.',
      'Progressivo ripartizione n.2: Filiale: 0000000003 PALMANOVA OUTLET UDINE',
      'Totale retribuzioni 6.233,05',
      'SEZIONE I.N.A.I.L.',
      '3 PALMANOVA OUTLED (UDINE) 8.207,00',
      'SEZIONE FISCALE',
    ]
    const { rows, months } = parseProspettoPaghe(lines, PROS_OUTLETS)
    expect(months).toEqual([{ year: 2026, month: 3 }])
    expect(rows[0].outlet).toBe('PALMANOVA')
    expect(rows[0].inailPat).toEqual([{ code: '3', label: 'PALMANOVA OUTLED (UDINE)', imponibile: 8207 }])
  })

  it('outlet senza Fondo EST (Valmontone): contrAzienda = INPS + EBINTER', () => {
    const lines = [
      'Ripartizione: Filiale: 0000000008 VALMONTONE OUTLET',
      'Totale retribuzioni 9.197,87',
      'I.N.P.S.', 'Totale id 1 1 2.899,73 -897,52 3.797,25',
      'EBINTER Ente Bilaterale Naz. Terziario', 'Totale id 1 ok 7,78 -3,91 11,69',
      'SEZIONE I.N.A.I.L.', '8 VALMONTONE OUTLET 9.199,00',
    ]
    const { rows } = parseProspettoPaghe(lines, PROS_OUTLETS)
    expect(rows[0].contrEst).toBe(0)
    expect(contrAziendaOutlet(rows[0])).toBeCloseTo(2907.51, 2)
  })

  it('filiale non mappata → warn e outlet vuoto (no crash)', () => {
    const lines = [
      'Ripartizione: Filiale: 0000000099 NEGOZIO FANTASMA',
      'Totale retribuzioni 1.000,00',
    ]
    const { rows } = parseProspettoPaghe(lines, PROS_OUTLETS)
    expect(rows[0].outlet).toBe('')
    expect(rows[0].warn).toBeTruthy()
  })
})
