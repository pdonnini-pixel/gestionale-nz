import { describe, it, expect } from 'vitest'
import { extractBeneficiary, trimBenefTail, sigWords, namesOverlap, movementNet, isRealTransfer, supplierKeyOf, invoiceTokens, invoiceCitedIn, findExactCombo } from './reconcileMatch'

// Casi reali (New Zago, tab Banche → Riconciliazione). Vedi RICONCILIAZIONE_REGOLE.md R5/R6.
describe('extractBeneficiary', () => {
  it('legge il nome dopo l\'asterisco nei bonifici internet-banking (caso Sforazzini)', () => {
    // Causale reale che prima veniva trattata come ANONIMA → mis-grouping su Frankie.
    const d = 'Bonifico tramite Internet Banking *SFORAZZINI SRL SF-11245-11037 ID.BON:0845700172770303480546302800IT'
    expect(extractBeneficiary(d)).toBe('SFORAZZINI SRL')
  })

  it('legge il nome dopo "A FAVORE" e taglia CODICE MANDATO (caso Frankie/Valdichiana)', () => {
    expect(extractBeneficiary('A FAVORE FRANKIE RETAIL HOLDCO SRL CODICE MANDATO C.I. 123')).toBe('FRANKIE RETAIL HOLDCO SRL')
    expect(extractBeneficiary('A FAVORE VALDICHIANA PROPCO SRL CODICE MANDATO BTWE0001')).toBe('VALDICHIANA PROPCO SRL')
  })

  it('legge "a favore di:" e si ferma a SALDO FATTURA / P.IVA', () => {
    expect(extractBeneficiary('Pagamento a favore di: MIAN SRL SALDO FATTURA 662 397')).toBe('MIAN SRL')
    expect(extractBeneficiary('a favore di: SHINE SRL 01234567890 quota')).toBe('SHINE SRL')
  })

  it('resta ANONIMO sui flussi CBI senza nome (nessun "*NOME" né "a favore")', () => {
    const d = 'DISPOSIZIONE - FILIALE DISPONENTE 2430 IMPORTO BONIFICI: 2.750,00 IMPORTO COMMISSIONI: 1,75'
    expect(extractBeneficiary(d)).toBe('')
  })

  it('non scambia un "*" seguito da cifre per un nome', () => {
    expect(extractBeneficiary('DISPOSIZIONE *2430 IMPORTO BONIFICI: 100,00')).toBe('')
  })

  it('stringa vuota / undefined → \'\'', () => {
    expect(extractBeneficiary('')).toBe('')
    expect(extractBeneficiary(undefined as unknown as string)).toBe('')
  })
})

describe('trimBenefTail', () => {
  it('si ferma al primo token con una cifra (numero fattura)', () => {
    expect(trimBenefTail('SFORAZZINI SRL SF-11245-11037')).toBe('SFORAZZINI SRL')
  })
  it('taglia ID.BON / CRO / TRN', () => {
    expect(trimBenefTail('ACME SPA ID.BON:0001')).toBe('ACME SPA')
    expect(trimBenefTail('ACME SPA CRO 123')).toBe('ACME SPA')
  })
})

// Il cuore della difesa R5/R6: il movimento Sforazzini NON deve poter combaciare col
// fornitore Frankie (nessuna parola significativa in comune), pur avendo lo stesso importo.
describe('namesOverlap (R5/R6 — conferma fornitore per nome)', () => {
  it('Sforazzini NON combacia con Frankie Retail Holdco', () => {
    expect(namesOverlap('SFORAZZINI SRL', 'Frankie Retail Holdco S.r.l.')).toBe(false)
  })
  it('Sforazzini combacia con la propria anagrafica', () => {
    expect(namesOverlap('SFORAZZINI SRL', 'Sforazzini Srl')).toBe(true)
  })
  it('due "PROPCO" diverse NON combaciano solo per la parola generica', () => {
    // "PROPCO" è nella stoplist → serve la parola distintiva.
    expect(namesOverlap('VALDICHIANA PROPCO SRL', 'Palmanova Propco S.r.l.')).toBe(false)
    expect(namesOverlap('VALDICHIANA PROPCO SRL', 'Valdichiana Propco S.r.l.')).toBe(true)
  })
  it('beneficiario tutto-generico non conferma per nome', () => {
    expect(namesOverlap('SRL ITALIA', 'Qualsiasi Fornitore Srl')).toBe(false)
  })
})

describe('sigWords', () => {
  it('scarta parole generiche e token corti', () => {
    expect(sigWords('SFORAZZINI SRL')).toEqual(['SFORAZZINI'])
    // GRUPPO/HOLDING generiche, FB troppo corta (≤3) → nessuna parola distintiva.
    expect(sigWords('Gruppo FB Holding')).toEqual([])
  })
})

describe('movementNet (R3 — scorporo commissioni CBI)', () => {
  it('usa IMPORTO BONIFICI (netto) quando presente', () => {
    const m = { description: 'DISPOSIZIONE IMPORTO BONIFICI: 2.750,00 IMPORTO COMMISSIONI: 1,75', amount: -2751.75 }
    expect(movementNet(m)).toBe(2750)
  })
  it('scorpora IMPORTO COMMISSIONI dal lordo se manca IMPORTO BONIFICI', () => {
    const m = { description: 'BONIFICO ... IMPORTO COMMISSIONI: 1,75', amount: -2751.75 }
    expect(movementNet(m)).toBeCloseTo(2750, 2)
  })
  it('senza dati commissione usa il lordo assoluto', () => {
    expect(movementNet({ description: 'BONIFICO ACME', amount: -1234.56 })).toBeCloseTo(1234.56, 2)
  })
})

describe('isRealTransfer', () => {
  it('riconosce i bonifici/disposizioni reali', () => {
    expect(isRealTransfer('Bonifico tramite Internet Banking *SFORAZZINI SRL')).toBe(true)
    expect(isRealTransfer('DISPOSIZIONE - FILIALE DISPONENTE')).toBe(true)
  })
  it('un F24 non è un trasferimento a fornitore', () => {
    expect(isRealTransfer('DELEGA F24 TRIBUTI')).toBe(false)
  })
})

describe('supplierKeyOf', () => {
  it('tiene insieme le varianti anagrafiche con la stessa P.IVA', () => {
    const a = supplierKeyOf({ supplier_vat: '05006900962', supplier_name: 'ZUCCHETTI SPA' })
    const b = supplierKeyOf({ supplier_vat: '05006900962', supplier_name: 'ZUCCHETTI SPA AD AZIONISTA UNICO' })
    expect(a).toBe(b)
  })
  it('tiene separati fornitori diversi senza P.IVA', () => {
    expect(supplierKeyOf({ supplier_name: 'Amazon Business EU' }))
      .not.toBe(supplierKeyOf({ supplier_name: 'CNH INDUSTRIAL CAPITAL EUROPE' }))
  })
})

describe('sigWords — parole generiche che non identificano un fornitore', () => {
  it('AMAZON PAYMENTS EUROPE e CNH INDUSTRIAL CAPITAL EUROPE non si somigliano', () => {
    expect(namesOverlap('AMAZON PAYMENTS EUROPE', 'CNH INDUSTRIAL CAPITAL EUROPE')).toBe(false)
  })
  it('AMAZON resta la parola distintiva', () => {
    expect(namesOverlap('AMAZON PAYMENTS EUROPE', 'Amazon Business EU S.a.r.l, Sede Secondaria')).toBe(true)
  })
})

describe('invoiceTokens / invoiceCitedIn', () => {
  it('legge i numeri dalla causale MPS "SALDO FATTURA 60828-65166"', () => {
    const t = invoiceTokens('Bonifico tramite corporate banking *ZUCCHETTI SPA SALDO FATTURA 60828-65166ID.BON:0832500021409994483773002800IT')
    expect(t).toContain('60828')
    expect(t).toContain('65166')
    expect(invoiceCitedIn('60828/PI', t)).toBe(true)
    expect(invoiceCitedIn('8086/FD', t)).toBe(false)
  })
  it('riconosce il codice Amazon anche troncato dalla banca', () => {
    const t = invoiceTokens('Bonifico tramite corporate banking *AMAZON PAYMENTS EUROPE SSF-IT662TPABEY-IT65OHAABEID.BON:0832500021650253483773002800IE')
    expect(invoiceCitedIn('IT662TPABEY', t)).toBe(true)
    expect(invoiceCitedIn('IT65OHAABEY', t)).toBe(true)   // in causale arriva come IT65OHAABE
    expect(invoiceCitedIn('IT6IJXABEY', t)).toBe(false)
  })
})

describe('findExactCombo', () => {
  it('trova la combinazione esatta del bonifico Amazon del 14/07 (415,85)', () => {
    // fatture Amazon aperte, comprese quelle piccole che il vecchio taglio "solo le
    // 12 più grandi" scartava: 52,72 + 262,24 + 20,89 + 80,00 = 415,85
    const importi = [262.24, 229.74, 192.15, 162.89, 113.64, 92.32, 88.80, 80.00, 79.52, 76.90, 67.64, 66.78, 52.72, 49.35, 39.87, 20.89]
    const items = importi.map((x) => ({ cents: Math.round(x * 100) }))
    const sol = findExactCombo(items, 41585)
    expect(sol).not.toBeNull()
    expect(sol!.map((i) => importi[i]).sort((a, b) => a - b)).toEqual([20.89, 52.72, 80, 262.24])
  })
  it('rifiuta la combinazione che sbaglia di 41 centesimi', () => {
    // 366,00 (CNH) + 88,80 − 38,54 = 416,26 contro un movimento di 415,85
    const items = [366.0, 88.8, -38.54].map((x) => ({ cents: Math.round(x * 100) }))
    expect(findExactCombo(items, 41585)).toBeNull()
  })
  it('include la nota di credito quando serve a far tornare il netto', () => {
    const importi = [366.0, 88.8, -38.54]
    const sol = findExactCombo(importi.map((x) => ({ cents: Math.round(x * 100) })), 41626)
    expect(sol).toEqual([0, 1, 2])
  })
  it('non propone niente se due combinazioni diverse fanno la stessa cifra', () => {
    const items = [100, 60, 40, 50, 50].map((x) => ({ cents: x * 100 }))
    expect(findExactCombo(items, 10000)).toBeNull()
  })
  it('rompe il pareggio con le fatture citate in causale', () => {
    const items = [
      { cents: 6000, cited: true }, { cents: 4000, cited: true },
      { cents: 5000, cited: false }, { cents: 5000, cited: false },
    ]
    expect(findExactCombo(items, 10000)).toEqual([0, 1])
  })
  it('vuole almeno due voci: la fattura singola non è un gruppo', () => {
    expect(findExactCombo([{ cents: 10000 }, { cents: 300 }], 10000)).toBeNull()
  })
})
