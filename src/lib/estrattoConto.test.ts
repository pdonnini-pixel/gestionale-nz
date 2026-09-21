// Test del lettore di estratti conto. Le causali sono quelle vere dei movimenti
// NZ di giugno e luglio 2026 (il bonifico CBI da 56.031,89 del 13/07 e' il caso
// che ha fatto nascere questo modulo: in banca dati arriva senza beneficiario).
import { describe, it, expect } from 'vitest'
import {
  parseAmountCell, parseDateCell, parseEcAoa, parseEcLines, matchEcRows,
  aggiornamentiDa, riepilogoEc, type EcMovement,
} from './estrattoConto'

const CAUSALE_ACUBE = 'Causale: DISPOSIZIONE - Descrizione: FILIALE DISPONENTE 2430 ID FLUSSO CBI: 135688081 NUM. TOT. PAGAMENTI: 1 IMPORTO BONIFICI: 56.031,89 IMPORTO COMMISSIONI: 1,75 ORD.ORIG:'
const CAUSALE_ESTESA = 'DISPOSIZIONE DI BONIFICO A FAVORE GGZ SRL SALDO FATTURE 2709 2801 IMPORTO BONIFICI: 56.031,89'

const mov = (over: Partial<EcMovement> & { id: string; transaction_date: string; amount: number }): EcMovement => ({
  description: null, counterpart: null, ...over,
})

describe('importi e date come li scrivono le banche', () => {
  it('importo italiano, con e senza separatore di migliaia', () => {
    expect(parseAmountCell('56.031,89')).toBe(56031.89)
    expect(parseAmountCell('-1.263,72')).toBe(-1263.72)
    expect(parseAmountCell('24,00')).toBe(24)
    expect(parseAmountCell('1.234.567,10')).toBe(1234567.1)
  })
  it('importo con punto decimale e numero vero di SheetJS', () => {
    expect(parseAmountCell('56031.89')).toBe(56031.89)
    expect(parseAmountCell(-40001.75)).toBe(-40001.75)
    expect(parseAmountCell('1,234.56')).toBe(1234.56)
  })
  it('quello che non e\' un importo resta niente', () => {
    expect(parseAmountCell('')).toBeNull()
    expect(parseAmountCell(null)).toBeNull()
    expect(parseAmountCell('SALDO CONTABILE')).toBeNull()
  })
  it('date: cella Date, seriale Excel, testo italiano, ISO', () => {
    expect(parseDateCell(new Date(Date.UTC(2026, 6, 13)))).toBe('2026-07-13')
    expect(parseDateCell('13/07/2026')).toBe('2026-07-13')
    expect(parseDateCell('13-07-26')).toBe('2026-07-13')
    expect(parseDateCell('2026-07-13')).toBe('2026-07-13')
    expect(parseDateCell(46216)).toBe('2026-07-13')
  })
  it('un importo non viene scambiato per una data seriale', () => {
    expect(parseDateCell(56031.89)).toBeNull()
    expect(parseDateCell(56031)).toBeNull()
    expect(parseDateCell(1750)).toBeNull()
    expect(parseDateCell(1263.72)).toBeNull()
  })
})

describe('foglio Excel della banca', () => {
  it('salta la testata, riconosce le intestazioni e legge le righe', () => {
    const aoa: unknown[][] = [
      ['Banca Monte dei Paschi di Siena'],
      ['Conto corrente', 'IT04V0103038020000000621460'],
      [],
      ['Data contabile', 'Data valuta', 'Descrizione operazione', 'Importo'],
      ['13/07/2026', '13/07/2026', CAUSALE_ESTESA, '-56.031,89'],
      ['22/06/2026', '22/06/2026', 'BONIFICO A FAVORE FRANKIE RETAIL HOLDCO SRL', '-32.521,00'],
      ['SALDO FINALE', '', '', ''],
    ]
    const p = parseEcAoa(aoa)
    expect(p.warnings).toEqual([])
    expect(p.rows).toHaveLength(2)
    expect(p.rows[0]).toMatchObject({ date: '2026-07-13', amount: -56031.89 })
    expect(p.rows[0].description).toContain('GGZ SRL')
  })

  it('colonne Dare e Avere separate: il dare e\' un\'uscita, l\'avere un\'entrata', () => {
    const aoa: unknown[][] = [
      ['Data', 'Valuta', 'Causale', 'Dare', 'Avere'],
      ['01/06/2026', '01/06/2026', 'DISPOSIZIONE DI BONIFICO A FAVORE WESTI SRL', '10.001,75', ''],
      ['02/06/2026', '02/06/2026', 'ACCREDITO POS INSEGNA VICOLO', '', '1.250,40'],
    ]
    const p = parseEcAoa(aoa)
    expect(p.rows).toHaveLength(2)
    expect(p.rows[0].amount).toBe(-10001.75)
    expect(p.rows[1].amount).toBe(1250.4)
  })

  it('causale spezzata su piu\' colonne: si rimette insieme', () => {
    const aoa: unknown[][] = [
      ['Data operazione', 'Descrizione', 'Importo'],
      ['13/07/2026', 'DISPOSIZIONE DI BONIFICO', -56031.89, 'A FAVORE GGZ SRL'],
    ]
    const p = parseEcAoa(aoa)
    // Le colonne in piu' vanno davanti: su MPS il beneficiario sta nella
    // colonna «Causale», che precede la «Descrizione operazioni».
    expect(p.rows[0].description).toBe('A FAVORE GGZ SRL DISPOSIZIONE DI BONIFICO')
  })

  it('senza intestazione riconoscibile lo dice, invece di inventare righe', () => {
    const p = parseEcAoa([['Estratto conto'], ['periodo', 'luglio']])
    expect(p.rows).toEqual([])
    expect(p.columns).toBeNull()
    expect(p.warnings[0]).toContain('intestazione')
  })
})

describe('estratto conto in PDF', () => {
  it('legge «data · causale · importo», con una o due date', () => {
    const p = parseEcLines([
      'ESTRATTO CONTO AL 31/07/2026',
      '13/07/2026 13/07/2026 DISPOSIZIONE DI BONIFICO A FAVORE GGZ SRL 56.031,89',
      '22/06/2026 BONIFICO A FAVORE FRANKIE RETAIL HOLDCO SRL 32.521,00',
      'SALDO FINALE 139.399,20',
    ])
    // «SALDO FINALE» non ha data: non e' un movimento e non viene letto.
    expect(p.rows).toHaveLength(2)
    expect(p.rows[0].date).toBe('2026-07-13')
    expect(p.rows[1].description).toContain('FRANKIE')
  })
})

describe('abbinamento con i movimenti che abbiamo', () => {
  const movimenti = [
    mov({ id: 'm1', transaction_date: '2026-07-13', amount: -56033.64, description: CAUSALE_ACUBE }),
    mov({ id: 'm2', transaction_date: '2026-06-22', amount: -32522.75, description: 'Causale: DISPOSIZIONE - IMPORTO BONIFICI: 32.521,00 IMPORTO COMMISSIONI: 1,75 ORD.ORIG:' }),
  ]

  it('l\'importo del bonifico non e\' quello del movimento: 1,75 di commissioni non li paga il fornitore', () => {
    // La riga dell'estratto conto porta il totale addebitato, commissioni comprese.
    const m = matchEcRows([{ date: '2026-07-13', value_date: null, amount: -56033.64, description: CAUSALE_ESTESA }], movimenti)
    expect(m[0].esito).toBe('nuovo')
    expect(m[0].movement?.id).toBe('m1')
    expect(m[0].beneficiario).toContain('GGZ')
  })

  it('il PDF perde il segno: una riga positiva vale anche come uscita', () => {
    const m = matchEcRows([{ date: '2026-07-13', value_date: null, amount: 56033.64, description: CAUSALE_ESTESA }], movimenti)
    expect(m[0].movement?.id).toBe('m1')
  })

  it('data vicina ma non identica: entro tre giorni va bene', () => {
    const m = matchEcRows([{ date: '2026-07-15', value_date: null, amount: -56033.64, description: CAUSALE_ESTESA }], movimenti)
    expect(m[0].movement?.id).toBe('m1')
    const lontano = matchEcRows([{ date: '2026-07-30', value_date: null, amount: -56033.64, description: CAUSALE_ESTESA }], movimenti)
    expect(lontano[0].esito).toBe('senza_movimento')
  })

  it('due movimenti uguali nello stesso giorno: ambiguo, non si scrive niente', () => {
    const doppi = [
      mov({ id: 'a', transaction_date: '2026-06-01', amount: -10001.75, description: 'DISPOSIZIONE' }),
      mov({ id: 'b', transaction_date: '2026-06-01', amount: -10001.75, description: 'DISPOSIZIONE' }),
    ]
    const m = matchEcRows([{ date: '2026-06-01', value_date: null, amount: -10001.75, description: 'BONIFICO A FAVORE MINGARDO SRLS' }], doppi)
    expect(m[0].esito).toBe('ambiguo')
    expect(m[0].candidati).toBe(2)
    expect(aggiornamentiDa(m)).toEqual([])
  })

  it('una riga che non aggiunge niente resta «gia presente»', () => {
    const m = matchEcRows([{ date: '2026-07-13', value_date: null, amount: -56033.64, description: 'IMPORTO BONIFICI 56.031,89' }], movimenti)
    expect(m[0].esito).toBe('gia_presente')
    expect(aggiornamentiDa(m)).toEqual([])
  })

  it('un movimento gia\' abbinato non viene riusato da una seconda riga', () => {
    const m = matchEcRows([
      { date: '2026-07-13', value_date: null, amount: -56033.64, description: CAUSALE_ESTESA },
      { date: '2026-07-13', value_date: null, amount: -56033.64, description: 'ALTRA CAUSALE A FAVORE WOLF GROUP SRL' },
    ], movimenti)
    expect(m[0].movement?.id).toBe('m1')
    expect(m[1].esito).toBe('senza_movimento')
  })

  it('la controparte gia\' scritta non si sovrascrive, la causale estesa si aggiunge sempre', () => {
    const conControparte = [mov({ id: 'm3', transaction_date: '2026-07-13', amount: -56033.64, description: CAUSALE_ACUBE, counterpart: 'DECISO A MANO SPA' })]
    const m = matchEcRows([{ date: '2026-07-13', value_date: null, amount: -56033.64, description: CAUSALE_ESTESA }], conControparte)
    const upd = aggiornamentiDa(m)
    expect(upd).toHaveLength(1)
    expect(upd[0].counterpart).toBeNull()
    expect(upd[0].statement_description).toBe(CAUSALE_ESTESA)
  })

  it('il riepilogo conta quello che si vede in pagina', () => {
    const m = matchEcRows([
      { date: '2026-07-13', value_date: null, amount: -56033.64, description: CAUSALE_ESTESA },
      { date: '2026-07-13', value_date: null, amount: -999.99, description: 'RIGA CHE NON ABBIAMO' },
    ], movimenti)
    expect(riepilogoEc(m)).toMatchObject({ righe: 2, nuovi: 1, senza_movimento: 1, con_beneficiario: 1 })
  })
})

// Righe vere dell'estratto conto MPS di giugno 2026 (colonne Data, Valuta,
// Dare, Avere, vuota, Causale, Descrizione operazioni), lette dal file della
// banca: sono i tre bonifici da 10.001,75 partiti il 1 giugno, che per importo
// e data sono indistinguibili e si separano solo con l'ID del flusso CBI.
describe('estratto conto MPS, tracciato vero', () => {
  const INTESTAZIONE = ['Data', 'Valuta', 'Dare', 'Avere', '', 'Causale', 'Descrizione operazioni']
  const riga = (giorno: string, importo: number, causale: string, flusso: string, bonifici: string): unknown[] => ([
    new Date(`${giorno}T00:00:00.000Z`), new Date(`${giorno}T00:00:00.000Z`), importo, '', '',
    causale,
    `DISPOSIZIONE FILIALE DISPONENTE 2430 ID FLUSSO CBI: ${flusso} NUM. TOT. PAGAMENTI: 1 IMPORTO BONIFICI: ${bonifici} IMPORTO COMMISSIONI: 1,75 ORD.ORIG: Rif Banca: 0260001012300012`,
  ])
  const AOA: unknown[][] = [
    INTESTAZIONE,
    riga('2026-06-01', -10001.75, '(26) VOSTRA DISPOSIZIONE A FAVORE DI GRUPPO FB CF_22', '134342051', '10.000,00'),
    riga('2026-06-01', -10001.75, '(26) VOSTRA DISPOSIZIONE A FAVORE DI DISTRIBUZIONE 93 SF_11-NC35-69-132', '134342443', '10.000,00'),
    riga('2026-06-01', -10001.75, '(26) VOSTRA DISPOSIZIONE A FAVORE DI A MIAN SF_1769-1760-CF_1757', '134334515', '10.000,00'),
    riga('2026-06-22', -32522.75, '(26) VOSTRA DISPOSIZIONE A FAVORE DI A FRANKIE RETAIL HOLDCO saldo fattura B01826001265-\r\nB01826001266+spese', '135012707', '32.521,00'),
  ]

  it('legge importo negativo, causale col beneficiario e flusso CBI', () => {
    const p = parseEcAoa(AOA)
    expect(p.rows).toHaveLength(4)
    expect(p.rows[0].amount).toBe(-10001.75)
    expect(p.rows[0].description).toContain('GRUPPO FB')
    expect(p.rows[0].flusso_cbi).toBe('134342051')
    expect(p.rows[3].amount).toBe(-32522.75)
    expect(p.rows[3].description).toContain('FRANKIE RETAIL HOLDCO')
  })

  it('tre bonifici uguali lo stesso giorno: il flusso CBI li separa, uno per uno', () => {
    const movimenti = [
      mov({ id: 'fb', transaction_date: '2026-06-01', amount: -10001.75, description: 'Causale: DISPOSIZIONE - Descrizione: FILIALE DISPONENTE 2430 ID FLUSSO CBI: 134342051 NUM. TOT. PAGAMENTI: 1 IMPORTO BONIFICI: 10.000,00 IMPORTO COMMISSIONI: 1,75 ORD.ORIG:' }),
      mov({ id: 'd93', transaction_date: '2026-06-01', amount: -10001.75, description: 'Causale: DISPOSIZIONE - Descrizione: FILIALE DISPONENTE 2430 ID FLUSSO CBI: 134342443 NUM. TOT. PAGAMENTI: 1 IMPORTO BONIFICI: 10.000,00 IMPORTO COMMISSIONI: 1,75 ORD.ORIG:' }),
      mov({ id: 'mian', transaction_date: '2026-06-01', amount: -10001.75, description: 'Causale: DISPOSIZIONE - Descrizione: FILIALE DISPONENTE 2430 ID FLUSSO CBI: 134334515 NUM. TOT. PAGAMENTI: 1 IMPORTO BONIFICI: 10.000,00 IMPORTO COMMISSIONI: 1,75 ORD.ORIG:' }),
    ]
    const m = matchEcRows(parseEcAoa(AOA).rows, movimenti)
    expect(m[0].movement?.id).toBe('fb')
    expect(m[1].movement?.id).toBe('d93')
    expect(m[2].movement?.id).toBe('mian')
    expect(m.slice(0, 3).every((x) => x.esito === 'nuovo')).toBe(true)
    // La quarta riga non ha un movimento in elenco: nessun aggancio inventato.
    expect(m[3].esito).toBe('senza_movimento')
  })

  it('senza flusso CBI si torna a importo e data, e l\'ambiguita\' resta ambiguita\'', () => {
    const senzaFlusso = [
      mov({ id: 'x', transaction_date: '2026-06-01', amount: -10001.75, description: 'DISPOSIZIONE' }),
      mov({ id: 'y', transaction_date: '2026-06-01', amount: -10001.75, description: 'DISPOSIZIONE' }),
    ]
    const m = matchEcRows(parseEcAoa(AOA).rows.slice(0, 1), senzaFlusso)
    expect(m[0].esito).toBe('ambiguo')
  })
})
