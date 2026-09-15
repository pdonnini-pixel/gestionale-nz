import { describe, it, expect } from 'vitest'
import {
  creditNoteResidual, isCreditNote, isPayableClosed, payableOpenAmount, buildDisposizioniMap,
} from './payableOpenAmount'

describe('creditNoteResidual', () => {
  it('NC aperta e mai usata: residuo = lordo', () => {
    expect(creditNoteResidual({ status: 'nota_credito', gross_amount: -3172, amount_paid: 0 })).toBe(3172)
  })
  it('NC usata in parte (amount_paid in negativo): residuo = lordo − quota', () => {
    expect(creditNoteResidual({ status: 'nota_credito', gross_amount: -3000, amount_paid: -500 })).toBe(2500)
  })
  it('NC consumata del tutto: residuo 0', () => {
    expect(creditNoteResidual({ status: 'nota_credito', gross_amount: -3000, amount_paid: -3000 })).toBe(0)
  })
  it('NC chiusa a mano (anche con amount_paid 0, dato storico): residuo 0', () => {
    expect(creditNoteResidual({ status: 'nota_credito', gross_amount: -1000, amount_paid: 0, closed_manually: true })).toBe(0)
    expect(creditNoteResidual({ status: 'nota_credito', gross_amount: -1000, amount_paid: 0, payment_date: '2026-07-10' })).toBe(0)
  })
  it('riga che non e\' una NC: 0', () => {
    expect(creditNoteResidual({ status: 'da_pagare', gross_amount: 500, amount_paid: 0 })).toBe(0)
    expect(isCreditNote({ status: 'da_pagare', gross_amount: 500 })).toBe(false)
  })
})

describe('payableOpenAmount con note di credito parziali', () => {
  it('NC usata in parte resta aperta e scala solo il residuo', () => {
    const nc = { status: 'nota_credito', gross_amount: -3000, amount_paid: -500, amount_remaining: -2500 }
    expect(isPayableClosed(nc)).toBe(false)
    expect(payableOpenAmount(nc)).toBe(-2500)
  })
  it('fattura compensata in parte resta parziale per il residuo', () => {
    const inv = { status: 'parziale', gross_amount: 3000, amount_paid: 500, amount_remaining: 2500, closed_manually: true }
    expect(isPayableClosed(inv)).toBe(false)
    expect(payableOpenAmount(inv)).toBe(2500)
  })
  it('fattura e NC compensate del tutto: entrambe a zero', () => {
    expect(payableOpenAmount({ status: 'pagato', gross_amount: 3172, amount_paid: 3172, amount_remaining: 0, closed_manually: true })).toBe(0)
    expect(payableOpenAmount({ status: 'nota_credito', gross_amount: -3172, amount_paid: -3172, amount_remaining: 0, closed_manually: true, payment_date: '2026-07-10' })).toBe(0)
  })
  it('i link cancelled non concorrono al disposto', () => {
    const map = buildDisposizioniMap(
      [{ payable_id: 'a', amount: 100 }],
      [{ payable_id: 'a', amount: 50, status: 'cancelled' }, { payable_id: 'a', amount: 20, status: 'applied' }],
    )
    expect(map.get('a')).toEqual({ disposto: 100, ncSettled: 20 })
  })
})
