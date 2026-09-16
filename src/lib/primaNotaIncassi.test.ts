import { describe, it, expect } from 'vitest'
import {
  terminalCodeOf, circuitOf, refDateOf, isDeposit, normCode, incassoKindOf, depositKeywordMatches, isIncassoKind,
  attribuisciIncasso, buildIncassoRow, summarizeByOutlet, causalePulita, SENZA_OUTLET,
  type IncassiLookups, type PnChannel, type PnIncassoMovement,
} from './primaNotaIncassi'

// Causali reali di agosto 2026 (tenant NZ), le stesse su cui sono tarate le funzioni SQL 188/192.
const MPS = 'ACCREDITO POS - COD.SIA:6181087-00002 CBI:0909 INSEGNA: VICOLO ID: 1403489716 DATA RIF.: 01.08.26 CIRCUITO: BANCOMAT CODICE CONVENZIONE: 100'
const AMEX = 'Accredito per incassi 03.08.2026 VICOLO c/o FRANCIACORTA 618108700006 American Express'
const NUMIA = 'Incassi Internazionali Numia SpA 8063565 01.08.26 618108700010 BRUGNATO 5 TERRE OUTLET'
const PAGOB = 'Incassi PagoBancomat 29.08.26 - 618108700010 BRUGNATO 5 TERRE OUTLET'
const VERS_GDO = 'VERS. GDO DATA PR: 03-08-26 DATA DT: 01-08-26 VICOLO NEW ZAGO SRL CC PALMANOVA PALMANOVA COD.:XXX V 760,00D 760,00DI 0,0'
const VERS_ATM = 'VERSAMENTO DA ATM 01030-2121-12.08.2026-12.26.00N. CARTA 13629106- FRANCIACORTA 01-09 AGOSTO'
const VERS_ISP = 'VERS.SPORT.AUT. Effettuato presso ABI 01025 - ATM 9750 il 01.08.2026 alle ore 16:21 carta n. 6375530005632781'
const VERS_CC = 'Versamento contante - cassa contin 11/08/2026'
const BONIFICO_IN = 'FILIALE DISPONENTE 00560 BON. SEPA 0881100009981297480546305463IT DEL 06.08.26 ORD: BECATTINI ALESSIA BIC: ICRAITRRMJ0 INF:RI: Acquisti'
const GIRO = 'GIROCONTO DA CONTO 123 VERSAMENTO INTERNO'

const ch = (p: Partial<PnChannel> & { id: string; outlet_id: string; kind: string }): PnChannel =>
  ({ label: p.kind, terminal_code: null, bank_account_id: null, is_active: true, ...p })

const CHANNELS: PnChannel[] = [
  ch({ id: 'vdc-mps', outlet_id: 'VDC', kind: 'pos', label: 'POS MPS', terminal_code: '00002', bank_account_id: 'mps' }),
  ch({ id: 'vdc-mps-amex', outlet_id: 'VDC', kind: 'pos', label: 'POS MPS Amex', terminal_code: '00002', bank_account_id: 'bcc' }),
  ch({ id: 'vdc-cash', outlet_id: 'VDC', kind: 'contanti', label: 'Contanti', terminal_code: 'FOIANO' }),
  ch({ id: 'frc-bcc', outlet_id: 'FRC', kind: 'pos', label: 'POS BCC', terminal_code: '6181087-00006', bank_account_id: 'bcc' }),
  ch({ id: 'frc-bcc-amex', outlet_id: 'FRC', kind: 'pos_amex', label: 'POS BCC Amex', terminal_code: '00006', bank_account_id: 'bcc' }),
  ch({ id: 'frc-cash', outlet_id: 'FRC', kind: 'contanti', label: 'Contanti', terminal_code: 'FRANCIACORTA|ATM 01030-2121' }),
  ch({ id: 'brg-bcc', outlet_id: 'BRG', kind: 'pos', label: 'POS BCC', terminal_code: '10', bank_account_id: 'bcc' }),
  ch({ id: 'brg-old', outlet_id: 'BRG', kind: 'pos', label: 'POS vecchio', terminal_code: '00002', is_active: false }),
  ch({ id: 'plm-cash', outlet_id: 'PLM', kind: 'contanti', label: 'Contanti', terminal_code: 'PALMANOVA' }),
  ch({ id: 'trn-cash', outlet_id: 'TRN', kind: 'contanti', label: 'Contanti', terminal_code: 'ATM 9750' }),
  ch({ id: 'brb-cash', outlet_id: 'BRB', kind: 'contanti', label: 'Contanti', terminal_code: 'cassa contin' }),
  ch({ id: 'brb-bon', outlet_id: 'BRB', kind: 'bonifico', label: 'Bonifico' }),
]

const LK: IncassiLookups = {
  channels: CHANNELS,
  outlets: new Map([
    ['VDC', { code: 'VDC', name: 'Valdichiana' }], ['FRC', { code: 'FRC', name: 'Franciacorta' }], ['BRG', { code: 'BRG', name: 'Brugnato' }],
    ['PLM', { code: 'PLM', name: 'Palmanova' }], ['TRN', { code: 'TRN', name: 'Torino' }], ['BRB', { code: 'BRB', name: 'Barberino' }],
  ]),
  closingMatches: new Map(),
  bankAccounts: new Map([['mps', { bank_name: 'MPS', iban: 'IT00MPS' }], ['bcc', { bank_name: 'BCC', iban: 'IT00BCC' }]]),
}

const mov = (description: string, amount = 100, extra: Partial<PnIncassoMovement> = {}): PnIncassoMovement =>
  ({ id: 'tx-' + description.slice(0, 12), transaction_date: '2026-08-05', amount, description, category: null, bank_account_id: 'mps', ...extra })

describe('parser causale (copia delle funzioni SQL)', () => {
  it('legge il codice terminale MPS, Amex e BCC/Numia/PagoBancomat', () => {
    expect(terminalCodeOf(MPS)).toBe('00002')
    expect(terminalCodeOf(AMEX)).toBe('00006')
    expect(terminalCodeOf(NUMIA)).toBe('00010')
    expect(terminalCodeOf(PAGOB)).toBe('00010')
    expect(terminalCodeOf(VERS_GDO)).toBeNull()
    expect(terminalCodeOf(BONIFICO_IN)).toBeNull()
    expect(terminalCodeOf(null)).toBeNull()
  })
  it('riconosce il circuito', () => {
    expect(circuitOf(MPS)).toBe('pos')
    expect(circuitOf(AMEX)).toBe('amex')
    expect(circuitOf(NUMIA)).toBe('pos')
    expect(circuitOf(PAGOB)).toBe('pos')
    expect(circuitOf(VERS_ATM)).toBeNull()
  })
  it('legge il giorno di vendita di riferimento', () => {
    expect(refDateOf(MPS)).toBe('2026-08-01')
    expect(refDateOf(AMEX)).toBe('2026-08-03')
    expect(refDateOf(NUMIA)).toBe('2026-08-01')
    expect(refDateOf(PAGOB)).toBe('2026-08-29')
    expect(refDateOf(VERS_GDO)).toBeNull()
  })
  it('riconosce i versamenti di contante e non i bonifici o giroconti', () => {
    expect(isDeposit(VERS_GDO)).toBe(true)
    expect(isDeposit(VERS_ATM)).toBe(true)
    expect(isDeposit(VERS_ISP)).toBe(true)
    expect(isDeposit(VERS_CC)).toBe(true)
    expect(isDeposit(BONIFICO_IN)).toBe(false)
    expect(isDeposit(GIRO)).toBe(false)
    expect(isDeposit(MPS)).toBe(false)
  })
  it('normalizza il codice del canale come cash_bank_norm_code', () => {
    expect(normCode('6181087-00002')).toBe('00002')
    expect(normCode('00002')).toBe('00002')
    expect(normCode('2')).toBe('00002')
    expect(normCode('10')).toBe('00010')
    expect(normCode('PALMANOVA')).toBeNull()
    expect(normCode(null)).toBeNull()
  })
  it('classifica la natura dell entrata', () => {
    expect(incassoKindOf(mov(MPS))).toBe('pos')
    expect(incassoKindOf(mov(AMEX))).toBe('amex')
    expect(incassoKindOf(mov(NUMIA))).toBe('pos')
    expect(incassoKindOf(mov(VERS_GDO))).toBe('versamento')
    expect(incassoKindOf(mov(VERS_CC))).toBe('versamento')
    expect(incassoKindOf(mov(BONIFICO_IN))).toBe('bonifico')
    expect(incassoKindOf(mov('ACCREDITO RIMBORSO ASSICURAZIONE'))).toBe('altro')
  })
  it('parole chiave del canale Contanti, anche più di una separate da |', () => {
    expect(depositKeywordMatches('FRANCIACORTA|ATM 01030-2121', VERS_ATM)).toBe(true)
    expect(depositKeywordMatches('ATM 01030-2121', 'VERSAMENTO DA ATM 01030-2121-03.08.2026')).toBe(true)
    expect(depositKeywordMatches('PALMANOVA', VERS_GDO)).toBe(true)
    expect(depositKeywordMatches('PALMANOVA', VERS_ATM)).toBe(false)
    expect(depositKeywordMatches('', VERS_ATM)).toBe(false)
    expect(depositKeywordMatches(null, VERS_ATM)).toBe(false)
  })
  it('ripulisce il prefisso tecnico della causale', () => {
    expect(causalePulita('Causale: ACCR Descrizione: ' + PAGOB)).toBe(PAGOB)
    expect(causalePulita(MPS)).toBe(MPS)
  })
})

describe('attribuisciIncasso', () => {
  it('POS MPS: codice terminale → outlet, a parità di codice vince il canale dello stesso conto', () => {
    const a = attribuisciIncasso(mov(MPS, 500, { bank_account_id: 'mps' }), LK)
    expect(a.kind).toBe('pos')
    expect(a.outlet_id).toBe('VDC')
    expect(a.channel?.id).toBe('vdc-mps')
    expect(a.attribuzione).toBe('terminale')
    expect(a.ref_date).toBe('2026-08-01')
  })
  it('Amex: cerca un canale pos_amex con quel codice', () => {
    const a = attribuisciIncasso(mov(AMEX, 120, { bank_account_id: 'bcc' }), LK)
    expect(a.kind).toBe('amex')
    expect(a.outlet_id).toBe('FRC')
    expect(a.channel?.id).toBe('frc-bcc-amex')
  })
  it('BCC/Numia: il codice scritto nel canale come "10" vale "00010"', () => {
    const a = attribuisciIncasso(mov(NUMIA, 300, { bank_account_id: 'bcc' }), LK)
    expect(a.outlet_id).toBe('BRG')
    expect(a.channel?.id).toBe('brg-bcc')
  })
  it('ignora i canali disattivati', () => {
    const lk = { ...LK, channels: CHANNELS.filter(c => c.outlet_id === 'BRG') }
    const a = attribuisciIncasso(mov(MPS), lk)
    expect(a.outlet_id).toBeNull()
    expect(a.attribuzione).toBe('da_attribuire')
    expect(a.terminal_code).toBe('00002')
  })
  it('versamenti: parola chiave del canale Contanti', () => {
    expect(attribuisciIncasso(mov(VERS_GDO), LK).outlet_id).toBe('PLM')
    expect(attribuisciIncasso(mov(VERS_ATM), LK).outlet_id).toBe('FRC')
    expect(attribuisciIncasso(mov(VERS_ISP), LK).outlet_id).toBe('TRN')
    expect(attribuisciIncasso(mov(VERS_CC), LK).outlet_id).toBe('BRB')
    expect(attribuisciIncasso(mov(VERS_CC), LK).attribuzione).toBe('parola_chiave')
    const foiano = 'VERS. GDO DATA PR: 03-08-26 DATA DT: 03-08-26 VICOLO NEW ZAGO CC FOIANO DELLA CHIANA COD.:XXX'
    expect(attribuisciIncasso(mov(foiano), LK).outlet_id).toBe('VDC')
  })
  it('versamento senza parola chiave nota → da attribuire', () => {
    const a = attribuisciIncasso(mov('VERSAMENTO DA ATM 01030-9999-03.08.2026 N. CARTA 1'), LK)
    expect(a.kind).toBe('versamento')
    expect(a.attribuzione).toBe('da_attribuire')
  })
  it('bonifico in entrata: bonifico cliente, senza outlet finché nessuno lo assegna', () => {
    const a = attribuisciIncasso(mov(BONIFICO_IN, 58), LK)
    expect(a.kind).toBe('bonifico')
    expect(a.outlet_id).toBeNull()
  })
  it('bonifico in entrata riscontrato dalla riga «Bonifico» della chiusura (06/08/2026, Barberino 140 = 82 + 58)', () => {
    const lk: IncassiLookups = { ...LK, closingMatches: new Map([['tx-bon', { outlet_id: 'BRB', closing_date: '2026-08-06', match_type: 'bonifico' }]]) }
    const a = attribuisciIncasso({ ...mov(BONIFICO_IN, 58), id: 'tx-bon' }, lk)
    expect(a.kind).toBe('bonifico')
    expect(a.outlet_id).toBe('BRB')
    expect(a.channel?.id).toBe('brb-bon')
    expect(a.attribuzione).toBe('chiusura')
    expect(a.ref_date).toBe('2026-08-06')
  })
  it('un abbinamento con la chiusura di cassa vince su tutto', () => {
    const lk: IncassiLookups = { ...LK, closingMatches: new Map([['tx-1', { outlet_id: 'TRN', closing_date: '2026-09-02', match_type: 'pos' }]]) }
    const a = attribuisciIncasso({ ...mov(MPS), id: 'tx-1' }, lk)
    expect(a.outlet_id).toBe('TRN')
    expect(a.attribuzione).toBe('chiusura')
    expect(a.ref_date).toBe('2026-09-02')
  })
})

describe('assegnazione a mano dalla nota', () => {
  const BON = 'FILIALE DISPONENTE 00560 BON. IST. 0845700003206403480546305463IT DEL 06.08.26 ORD: SCANU SABRINA BIC: ICRAITRRCP0 INF:RI: Acquisto merce vicolo Scanu Sabrina'
  it('un bonifico in entrata è un «bonifico cliente»; con la nota "Outlet: BRB" va a Barberino', () => {
    const m = mov(BON, 82, { note: 'Outlet: BRB · corrispettivi Barberino agosto 2026, bonifico cliente (Scanu Sabrina)' })
    const a = attribuisciIncasso(m, LK)
    expect(a.kind).toBe('bonifico')
    expect(a.outlet_id).toBe('BRB')
    expect(a.attribuzione).toBe('nota')
    expect(attribuisciIncasso(mov(BON, 82), LK).outlet_id).toBeNull()
    expect(attribuisciIncasso(mov(BON, 82, { note: 'Outlet: XXX' }), LK).outlet_id).toBeNull()
  })
  it('la nota vince anche sul codice terminale', () => {
    expect(attribuisciIncasso(mov(MPS, 100, { note: 'Outlet: TRN · spostato a mano' }), LK).outlet_id).toBe('TRN')
  })
})

describe('riga export e riepilogo', () => {
  const fmt = (d: string | null) => (d ? d.split('-').reverse().join('/') : '')
  it('buildIncassoRow', () => {
    const m = mov(MPS, 1234.567, { bank_account_id: 'mps', category: 'incassi_pos' })
    const r = buildIncassoRow(m, attribuisciIncasso(m, LK), LK, fmt)
    expect(r).toEqual({
      'Data operazione': '05/08/2026', 'Data riferimento': '01/08/2026', 'Conto Banca': 'MPS',
      Outlet: 'VDC · Valdichiana', Canale: 'POS MPS', Tipo: 'POS', Terminale: '00002', Importo: 1234.57,
      Causale: MPS,
    })
    // Niente IBAN, attribuzione né categoria nel foglio: stanno in pagina
    expect(Object.keys(r)).not.toContain('IBAN')
    expect(Object.keys(r)).not.toContain('Attribuzione')
    expect(Object.keys(r)).not.toContain('Categoria')
  })
  it('summarizeByOutlet: colonne per natura, «Da attribuire» in fondo', () => {
    const ms = [mov(MPS, 100), mov(AMEX, 50, { bank_account_id: 'bcc' }), mov(VERS_GDO, 760), mov(BONIFICO_IN, 58), mov('VERSAMENTO DA ATM 01030-9999', 10)]
    const items = ms.map(m => ({ m, a: attribuisciIncasso(m, LK) }))
    const s = summarizeByOutlet(items, LK)
    expect(s.map(x => x.label)).toEqual(['FRC · Franciacorta', 'PLM · Palmanova', 'VDC · Valdichiana', 'Da attribuire'])
    expect(s[0]).toMatchObject({ n: 1, amex: 50, totale: 50 })
    expect(s[1]).toMatchObject({ n: 1, versamenti: 760, totale: 760 })
    expect(s[2]).toMatchObject({ n: 1, pos: 100, totale: 100 })
    expect(s[3]).toMatchObject({ outlet_id: null, n: 2, altro: 58, versamenti: 10, totale: 68 })
    expect(SENZA_OUTLET).toBeTruthy()
  })
})

describe('isIncassoKind: cosa entra in Incassi per outlet', () => {
  it('giroconti e rimborsi (Mian: restituzione, BRT: liquidazione transattiva) restano fuori; il resto entra', () => {
    expect(isIncassoKind('rimborso')).toBe(false)
    expect(isIncassoKind('giroconto')).toBe(false)
    expect(isIncassoKind('pos')).toBe(true)
    expect(isIncassoKind('incasso_cliente')).toBe(true)
    expect(isIncassoKind('da_chiarire')).toBe(true)
  })
})
