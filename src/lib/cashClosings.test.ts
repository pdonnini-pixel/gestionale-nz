import { describe, it, expect } from 'vitest'
import { parseAmount, formatAmount, computeQuadrature, monthDays, addDaysIso, attachmentPath, kindForTarget, extractedAmount, extractedSummary, bankStatusMark } from './cashClosings'

describe('kindForTarget', () => {
  it('associa a ogni riga il documento atteso', () => {
    expect(kindForTarget('totale')).toBe('rt_chiusura')
    expect(kindForTarget('canale', 'pos')).toBe('pos_chiusura')
    expect(kindForTarget('canale', 'pos_amex')).toBe('pos_chiusura')
    expect(kindForTarget('canale', 'bonifico')).toBe('altro')
    expect(kindForTarget('spesa')).toBe('scontrino_spesa')
    expect(kindForTarget('versamento')).toBe('ricevuta_versamento')
  })
})

describe('parseAmount', () => {
  it('legge gli importi scritti all\'italiana', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56)
    expect(parseAmount('1234,5')).toBe(1234.5)
    expect(parseAmount('228')).toBe(228)
    expect(parseAmount(' 3.248,50 € ')).toBe(3248.5)
  })
  it('accetta anche il punto decimale', () => {
    expect(parseAmount('12.5')).toBe(12.5)
    expect(parseAmount('1234.56')).toBe(1234.56)
    expect(parseAmount('1.234')).toBe(1234)
    expect(parseAmount('1.234.567')).toBe(1234567)
  })
  it('vuoto o non numerico → null', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount(null)).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })
})

describe('formatAmount', () => {
  it('formatta con due decimali it-IT', () => {
    expect(formatAmount(1234.5)).toBe('1.234,50')
    expect(formatAmount(1234567.891)).toBe('1.234.567,89')
    expect(formatAmount(-12.4)).toBe('-12,40')
    expect(formatAmount(0)).toBe('0,00')
    expect(formatAmount(null)).toBe('')
  })
})

describe('computeQuadrature', () => {
  const lines = [
    { kind: 'contanti' as const, counts_in_total: true, amount: 612 },
    { kind: 'pos' as const, counts_in_total: true, amount: 2103.2 },
    { kind: 'pos_amex' as const, counts_in_total: true, amount: 180 },
    { kind: 'paybylink' as const, counts_in_total: true, amount: 353.3 },
  ]
  it('quadra totale e fondo cassa (esempio dell\'analisi)', () => {
    const q = computeQuadrature({
      totalReceipts: 3248.5, lines, cashExpenses: 12.4, cashDeposit: 600,
      prevFloat: 250, cashFloatDeclared: 249.6,
    })
    expect(q.channelsTotal).toBe(3248.5)
    expect(q.receiptsDifference).toBe(0)
    expect(q.cashLine).toBe(612)
    expect(q.cashFloatExpected).toBe(249.6)
    expect(q.cashDifference).toBe(0)
  })
  it('segnala la differenza e ignora i canali fuori totale', () => {
    const q = computeQuadrature({
      totalReceipts: 3000,
      lines: [...lines, { kind: 'fattura', counts_in_total: false, amount: 999 }],
      cashExpenses: 0, cashDeposit: 0, prevFloat: 100, cashFloatDeclared: 700,
    })
    expect(q.channelsTotal).toBe(3248.5)
    expect(q.receiptsDifference).toBe(-248.5)
    expect(q.cashFloatExpected).toBe(712)
    expect(q.cashDifference).toBe(-12)
  })
  it('i rimborsi a cliente riducono il fondo atteso come le spese', () => {
    const q = computeQuadrature({
      totalReceipts: 3248.5, lines, cashExpenses: 12.4, customerRefunds: 50, cashDeposit: 600,
      prevFloat: 250, cashFloatDeclared: 199.6,
    })
    expect(q.cashFloatExpected).toBe(199.6)
    expect(q.cashDifference).toBe(0)
  })
  it('senza fondo di ieri non calcola l\'atteso', () => {
    const q = computeQuadrature({ totalReceipts: 10, lines: [], cashExpenses: 0, cashDeposit: 0, prevFloat: null, cashFloatDeclared: 5 })
    expect(q.cashFloatExpected).toBeNull()
    expect(q.cashDifference).toBeNull()
    expect(q.receiptsDifference).toBe(10)
  })
})

describe('date helpers', () => {
  it('monthDays copre febbraio bisestile e mesi da 31', () => {
    expect(monthDays(2028, 2)).toHaveLength(29)
    expect(monthDays(2026, 8)).toHaveLength(31)
    expect(monthDays(2026, 9)[0]).toBe('2026-09-01')
  })
  it('addDaysIso attraversa il mese', () => {
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDaysIso('2026-09-01', -1)).toBe('2026-08-31')
  })
  it('attachmentPath ha azienda e outlet nei primi due segmenti', () => {
    expect(attachmentPath('c', 'o', '2026-09-03', 'f')).toBe('c/o/2026-09-03/f.jpg')
  })
})

describe('lettura foto (fase 1b)', () => {
  it('extractedAmount legge solo numeri finiti', () => {
    expect(extractedAmount({ amount: 1234.567 })).toBe(1234.57)
    expect(extractedAmount({ amount: '12' })).toBeNull()
    expect(extractedAmount(null)).toBeNull()
    expect(extractedAmount({})).toBeNull()
  })
  it('extractedSummary riassume i campi dello scontrino di chiusura', () => {
    const s = extractedSummary('totale', {
      total_sales: 3248.5, cash: 612, electronic: 2636.5, documents_count: 38, closure_number: 1201,
      date: '2026-09-03', time: '20:05', transmission_ok: true, uncertain: false, amount: 3248.5,
    })
    expect(s).toContain('totale 3.248,50 €')
    expect(s).toContain('contanti 612,00 €')
    expect(s).toContain('38 documenti')
    expect(s).toContain('1201 azzeramenti')
    expect(s).toContain('trasmissione ok')
    expect(s).toContain('3 settembre 2026 20:05')
    expect(s).not.toContain('lettura incerta')
  })
  it('extractedSummary segnala documento sbagliato e incertezza', () => {
    const s = extractedSummary('spesa', { document_ok: false, uncertain: true, total: 5, merchant: 'Bar Roma', notes: 'foto tagliata' })
    expect(s[0]).toBe('documento diverso da quello atteso')
    expect(s).toContain('Bar Roma')
    expect(s).toContain('lettura incerta')
    expect(s).toContain('foto tagliata')
  })
})

describe('bankStatusMark', () => {
  it('assegna un simbolo per ogni esito banca', () => {
    expect(bankStatusMark('accreditato').mark).toBe('✓')
    expect(bankStatusMark('differenza').mark).toBe('≠')
    expect(bankStatusMark('mancante').mark).toBe('✗')
    expect(bankStatusMark('non_verificabile').mark).toBe('?')
    expect(bankStatusMark('in_attesa').mark).toBe('')
    expect(bankStatusMark(null).mark).toBe('')
  })
})
