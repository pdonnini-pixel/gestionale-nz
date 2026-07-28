import { describe, it, expect } from 'vitest'
import { extractBeneficiary, trimBenefTail, sigWords, namesOverlap, movementNet, isRealTransfer } from './reconcileMatch'

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
