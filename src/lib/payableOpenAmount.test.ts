import { describe, it, expect } from 'vitest'
import {
  isPayableClosed,
  payableOpenAmount,
  disposizionePending,
  buildDisposizioniMap,
} from './payableOpenAmount'

describe('isPayableClosed', () => {
  it('stati terminali chiusi', () => {
    expect(isPayableClosed({ status: 'pagato', amount_remaining: 0 })).toBe(true)
    expect(isPayableClosed({ status: 'annullato' })).toBe(true)
    expect(isPayableClosed({ status: 'bloccato' })).toBe(true)
  })

  it('fattura aperta (scaduto / da_pagare / parziale) NON chiusa', () => {
    expect(isPayableClosed({ status: 'scaduto', gross_amount: 100, amount_remaining: 100 })).toBe(false)
    expect(isPayableClosed({ status: 'da_pagare', gross_amount: 100, amount_remaining: 100 })).toBe(false)
  })

  it('caso GGZ: nota di credito chiusa a mano e registrata → chiusa', () => {
    // NC 1454/01 del 30/01/2026: −174,48 € con closed_manually + payment_date.
    expect(isPayableClosed({
      status: 'nota_credito', gross_amount: -174.48, amount_remaining: -174.48,
      closed_manually: true, payment_date: '2026-07-13',
    })).toBe(true)
  })

  it('nota di credito chiusa a mano SENZA payment_date → chiusa (caso Tanesini)', () => {
    expect(isPayableClosed({
      status: 'nota_credito', gross_amount: -93.94, amount_remaining: -46.97, closed_manually: true,
    })).toBe(true)
  })

  it('nota di credito aperta resta aperta', () => {
    expect(isPayableClosed({ status: 'nota_credito', gross_amount: -1268.8, amount_remaining: -1268.8 })).toBe(false)
  })

  it('fattura positiva con payment_date (acconto, status parziale) NON chiusa', () => {
    // WOLF 218: acconto pagato il 07/08, residuo 40.000 ancora dovuto.
    expect(isPayableClosed({
      status: 'parziale', gross_amount: 79683.24, amount_paid: 39683.24, amount_remaining: 40000,
      payment_date: '2026-08-07',
    })).toBe(false)
  })

  it('fattura positiva con closed_manually ma status scaduto resta aperta (come nello Scadenzario)', () => {
    // MILANI 26/A: la regola "chiusa a mano" vale solo per le NC.
    expect(isPayableClosed({
      status: 'scaduto', gross_amount: 1220, amount_remaining: 1220, closed_manually: true,
    })).toBe(false)
  })
})

describe('payableOpenAmount', () => {
  it('residuo pieno quando non ci sono disposizioni', () => {
    expect(payableOpenAmount({ status: 'scaduto', gross_amount: 36564.38, amount_remaining: 36564.38 })).toBe(36564.38)
  })

  it('NC aperta resta negativa (scala il dovuto)', () => {
    expect(payableOpenAmount({ status: 'nota_credito', gross_amount: -3792.49, amount_remaining: -3792.49 })).toBe(-3792.49)
  })

  it('NC chiusa a mano → 0', () => {
    expect(payableOpenAmount({
      status: 'nota_credito', gross_amount: -174.48, amount_remaining: -174.48,
      closed_manually: true, payment_date: '2026-07-13',
    })).toBe(0)
  })

  it('senza amount_remaining ricade su gross_amount', () => {
    expect(payableOpenAmount({ status: 'da_pagare', gross_amount: 500 })).toBe(500)
  })

  it('quota in distinta in sospeso viene sottratta', () => {
    const p = { status: 'da_pagare', gross_amount: 1000, amount_paid: 0, amount_remaining: 1000 }
    // Interamente disposta: nulla piu' da pagare a mano.
    expect(disposizionePending(p, { disposto: 1000, ncSettled: 0 })).toBe(1000)
    expect(payableOpenAmount(p, { disposto: 1000, ncSettled: 0 })).toBe(0)
    // Acconto disposto di 400 → restano 600 da disporre.
    expect(payableOpenAmount(p, { disposto: 400, ncSettled: 0 })).toBe(600)
  })

  it('disposto netto + NC compensata = lordo; dopo il pagamento la quota in sospeso torna a 0', () => {
    // Fattura 1000, NC 200 compensata, bonifico 800: dispostoLordo = 1000.
    const prima = { status: 'da_pagare', gross_amount: 1000, amount_paid: 0, amount_remaining: 1000 }
    expect(payableOpenAmount(prima, { disposto: 800, ncSettled: 200 })).toBe(0)
    // Acconto chiuso: amount_paid = 1000, residuo 0 → pending 0, aperto 0.
    const dopo = { status: 'pagato', gross_amount: 1000, amount_paid: 1000, amount_remaining: 0 }
    expect(disposizionePending(dopo, { disposto: 800, ncSettled: 200 })).toBe(0)
    expect(payableOpenAmount(dopo, { disposto: 800, ncSettled: 200 })).toBe(0)
  })
})

describe('buildDisposizioniMap', () => {
  it('somma più disposizioni della stessa fattura e le NC pending/applied', () => {
    const map = buildDisposizioniMap(
      [
        { payable_id: 'A', amount: 400 },
        { payable_id: 'A', amount: 300 },
        { payable_id: null, amount: 999 },
      ],
      [
        { payable_id: 'A', amount: -50, status: 'pending' },
        { payable_id: 'A', amount: -25, status: 'applied' },
        { payable_id: 'A', amount: -10, status: 'cancelled' },
        { payable_id: 'B', amount: -70, status: 'pending' }, // B senza disposizione: ignorata
      ],
    )
    expect(map.get('A')).toEqual({ disposto: 700, ncSettled: 75 })
    expect(map.has('B')).toBe(false)
  })
})

describe('caso reale GGZ SRL (NZ, 09/2026): Fornitori deve leggere come lo Scadenzario', () => {
  it('totale da pagare = 280.684,85 €', () => {
    const scadute = [36564.38, 81487.58, 36155.92, 896.70, 26208.28, 956.48, 17473.57, 44449.72, 13726.46, 18877.06, 24140.87, 2098.40]
    const daPagare = [2776.33, 40143.37, 5067.64]
    const ncAperte = [-1268.80, -3792.49, -3464.07, -18013.70, -1894.66, -30703.01, -1448.38, -111.26, -1528.42, -519.23, -2125.24, -4056.74, -1141.68, -112.24, -115.29, -42.70]
    const rows = [
      ...scadute.map(a => ({ status: 'scaduto', gross_amount: a, amount_remaining: a })),
      ...daPagare.map(a => ({ status: 'da_pagare', gross_amount: a, amount_remaining: a })),
      ...ncAperte.map(a => ({ status: 'nota_credito', gross_amount: a, amount_remaining: a })),
      // 3 pagate + la NC chiusa a mano che causava la differenza di 174,48 €
      { status: 'pagato', gross_amount: 31815.89, amount_remaining: 0, closed_manually: true, payment_date: '2026-07-10' },
      { status: 'pagato', gross_amount: 24390.48, amount_remaining: 0, closed_manually: true, payment_date: '2026-07-10' },
      { status: 'pagato', gross_amount: 30957.26, amount_remaining: 0, payment_date: '2026-08-07' },
      { status: 'nota_credito', gross_amount: -174.48, amount_remaining: -174.48, closed_manually: true, payment_date: '2026-07-13' },
    ]
    const totale = rows.reduce((s, p) => s + payableOpenAmount(p), 0)
    expect(+totale.toFixed(2)).toBe(280684.85)
    const scaduto = rows.filter(p => p.status === 'scaduto').reduce((s, p) => s + payableOpenAmount(p), 0)
    expect(+scaduto.toFixed(2)).toBe(303035.42)
    expect(rows.filter(p => !isPayableClosed(p)).length).toBe(31)
  })
})
