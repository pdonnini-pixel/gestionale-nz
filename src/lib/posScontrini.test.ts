import { describe, it, expect } from 'vitest'
import { assignPosReceipts, sameTerminalId, posReceiptsFrom, openPosTotal, posCarryOver, carryOverChannel, carryOverNote, type PosChannelLite } from './posScontrini'

// Righe di Barberino come sono in anagrafica (06/11/2026)
const BARBERINO: PosChannelLite[] = [
  { id: 'mps', label: 'POS MPS', kind: 'pos', terminal_code: '00004', pos_terminal_id: '86028817' },
  { id: 'mpsAmex', label: 'POS MPS Amex', kind: 'pos_amex', terminal_code: '00004', pos_terminal_id: '86028817' },
  { id: 'bcc', label: 'POS BCC', kind: 'pos', terminal_code: '00003', pos_terminal_id: '84570955' },
  { id: 'bccAmex', label: 'POS BCC Amex', kind: 'pos_amex', terminal_code: '00003', pos_terminal_id: '84570955' },
  { id: 'pbl', label: 'Pay by link', kind: 'pos', terminal_code: '00004', pos_terminal_id: null },
]
const rc = (terminal_id: string | null, acquirer: string | null, amount: number, extra: Partial<{ circuit: string; status: 'chiusura' | 'non_chiusa' }> = {}) =>
  ({ terminal_id, acquirer, circuit: extra.circuit ?? null, merchant: null, amount, status: extra.status ?? null })

describe('sameTerminalId', () => {
  it('accetta una cifra diversa o mancante', () => {
    expect(sameTerminalId('86028817', '86028817')).toBe(true)
    expect(sameTerminalId('86028817', '80028817')).toBe(true)
    expect(sameTerminalId('84570990', '8450990')).toBe(true)
    expect(sameTerminalId('86028817', '86028816')).toBe(true)
  })
  it('rifiuta due cifre diverse e i codici corti', () => {
    expect(sameTerminalId('86028817', '84570955')).toBe(false)
    expect(sameTerminalId('86028817', '86028866')).toBe(false)
    expect(sameTerminalId('00004', '00003')).toBe(false)
  })
})

describe('assignPosReceipts', () => {
  it('Barberino 04/11: POS principale non chiuso e POS di riserva vanno tutti e due su MPS', () => {
    const out = assignPosReceipts([
      rc('86028817', 'Nexi', 145.56, { status: 'non_chiusa' }),
      rc('86028816', 'Nexi', 288),
    ], BARBERINO)
    expect(out.mps.total).toBe(433.56)
    expect(out.mps.receipts.map((r) => r.reason)).toEqual(['terminale', 'terminale_simile'])
    expect(out.bcc).toBeUndefined()
  })
  it('un POS di riserva con TML lontano va sulla riga della sua banca', () => {
    const out = assignPosReceipts([rc('86028817', 'Nexi', 100), rc('11112222', 'Nexi', 50)], BARBERINO)
    expect(out.mps.total).toBe(150)
    expect(out.mps.receipts[1].reason).toBe('banca')
  })
  it('Amex sulla riga Amex del terminale', () => {
    const out = assignPosReceipts([rc('84570955', 'BCC', 167.4, { circuit: 'Amex' }), rc('84570955', 'BCC', 20)], BARBERINO)
    expect(out.bccAmex.total).toBe(167.4)
    expect(out.bcc.total).toBe(20)
  })
  it('uno scontrino anonimo elencato per primo non ruba la riga di un terminale riconosciuto', () => {
    const out = assignPosReceipts([rc(null, null, 10), rc('86028817', 'Nexi', 100)], BARBERINO)
    expect(out.mps.total).toBe(100)
    expect(out.bcc.total).toBe(10)
  })
  it('match per banca anche senza TML in anagrafica, mai su Pay by link', () => {
    const noTml: PosChannelLite[] = BARBERINO.map((c) => ({ ...c, terminal_code: null, pos_terminal_id: null }))
    const out = assignPosReceipts([rc('99999999', 'BCC', 50)], noTml)
    expect(out.bcc.total).toBe(50)
    expect(out.pbl).toBeUndefined()
  })
  it('senza indizi usa la prima riga libera', () => {
    const out = assignPosReceipts([rc(null, null, 10)], BARBERINO)
    expect(out.mps.receipts[0].reason).toBe('riga_libera')
  })
})

describe('posReceiptsFrom / openPosTotal', () => {
  it('legge gli scontrini e somma quelli non chiusi', () => {
    const list = posReceiptsFrom({ pos_closures: [
      { terminal_id: '86028817', acquirer: 'Nexi', amount: 145.56, status: 'non_chiusa' },
      { terminal_id: '86028816', acquirer: 'Nexi', amount: 288, status: 'chiusura' },
      { terminal_id: 'x', amount: null },
    ] })
    expect(list).toHaveLength(2)
    expect(openPosTotal(list)).toBe(145.56)
  })
  it('foto senza scontrini POS', () => {
    expect(posReceiptsFrom(null)).toEqual([])
    expect(posReceiptsFrom({ pos_closures: 'no' })).toEqual([])
  })
})

describe('posCarryOver', () => {
  it('Barberino 05/11: eccedenza pari al POS aperto di ieri', () => {
    expect(posCarryOver({ isClosedDay: false, rtElectronic: 827.4, posTyped: 972.96, previousOpen: 145.56 }))
      .toEqual({ excess: 145.56, fromPreviousDay: true })
  })
  it('eccedenza senza informazioni su ieri: ipotesi', () => {
    expect(posCarryOver({ isClosedDay: false, rtElectronic: 827.4, posTyped: 972.96, previousOpen: 0 }))
      .toEqual({ excess: 145.56, fromPreviousDay: false })
  })
  it('nessuna eccedenza, giorno chiuso o RT non letto', () => {
    expect(posCarryOver({ isClosedDay: false, rtElectronic: 827.4, posTyped: 827.4, previousOpen: 145.56 })).toBeNull()
    expect(posCarryOver({ isClosedDay: false, rtElectronic: 900, posTyped: 827.4, previousOpen: 0 })).toBeNull()
    expect(posCarryOver({ isClosedDay: true, rtElectronic: 1, posTyped: 5, previousOpen: 0 })).toBeNull()
    expect(posCarryOver({ isClosedDay: false, rtElectronic: null, posTyped: 5, previousOpen: 0 })).toBeNull()
  })
})

describe('carryOverChannel / carryOverNote', () => {
  it('toglie dalla riga del terminale rimasto aperto', () => {
    const today = assignPosReceipts([rc('86028817', 'Nexi', 972.96), rc('84570955', 'BCC', 1000)], BARBERINO)
    expect(carryOverChannel(today, ['86028817'], { mps: 972.96, bcc: 1000 }, 145.56)).toBe('mps')
    expect(carryOverChannel(today, [], { mps: 972.96, bcc: 1000 }, 145.56)).toBe('bcc')
    expect(carryOverChannel({}, [], { mps: 10 }, 145.56)).toBeNull()
  })
  it('nota leggibile', () => {
    expect(carryOverNote(145.56, '2026-11-04')).toContain('145,56 € di vendite del 04/11/2026')
  })
})
