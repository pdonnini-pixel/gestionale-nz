import { describe, it, expect } from 'vitest'
import { causaleRimborso, controllaRimborso, emailRimborso, ibanValido, normalizzaIban, totaleRimborso, type RigaRimborso } from './distintaRimborso'

// IBAN di esempio pubblici (documentazione ISO / Banca d'Italia), non di persone vere.
const IBAN_OK = 'IT60 X054 2811 1010 0000 0123 456'

const righe: RigaRimborso[] = [
  { fornitore: 'Ristorante Uno Srl', fattura: 'A1', importo: 15.5, bankId: 'b1' },
  { fornitore: 'Hotel Due Spa', fattura: 'B2', importo: 42, bankId: 'b1' },
  { fornitore: 'Bar Tre', fattura: 'C3', importo: 18.99, bankId: 'b1' },
]

describe('ibanValido', () => {
  it('accetta un IBAN italiano corretto, con o senza spazi', () => {
    expect(ibanValido(IBAN_OK)).toBe(true)
    expect(ibanValido(normalizzaIban(IBAN_OK).toLowerCase())).toBe(true)
  })
  it('rifiuta cifre di controllo sbagliate, lunghezze sbagliate e testo vuoto', () => {
    expect(ibanValido('IT61X0542811101000000123456')).toBe(false)
    expect(ibanValido('IT60X05428111010000001234')).toBe(false)
    expect(ibanValido('')).toBe(false)
  })
  it('accetta un IBAN estero corretto', () => {
    expect(ibanValido('DE89 3704 0044 0532 0130 00')).toBe(true)
  })
})

describe('controllaRimborso', () => {
  const dati = { nome: 'Mario Rossi', iban: IBAN_OK }
  it('passa quando è tutto a posto', () => {
    expect(controllaRimborso(dati, righe)).toBeNull()
  })
  it('chiede nome e IBAN', () => {
    expect(controllaRimborso({ nome: '', iban: IBAN_OK }, righe)).toMatch(/nome e cognome/)
    expect(controllaRimborso({ nome: 'Mario Rossi', iban: 'IT00' }, righe)).toMatch(/IBAN/)
  })
  it('vuole una sola banca, scelta per tutte le fatture', () => {
    expect(controllaRimborso(dati, [...righe, { fornitore: 'X', fattura: '9', importo: 1, bankId: 'b2' }])).toMatch(/stessa banca/)
    expect(controllaRimborso(dati, [{ ...righe[0], bankId: '' }])).toMatch(/Scegli la banca/)
  })
  it('non ammette scadenze fiscali né note di credito', () => {
    expect(controllaRimborso(dati, [{ ...righe[0], fiscale: true }])).toMatch(/fiscali/)
    expect(controllaRimborso(dati, [{ ...righe[0], conNoteCredito: true }])).toMatch(/note di credito/)
  })
})

describe('testo della disposizione', () => {
  it('il totale è la somma al centesimo', () => {
    expect(totaleRimborso(righe)).toBe(76.49)
  })
  it('la causale sta nei 140 caratteri', () => {
    expect(causaleRimborso(righe)).toBe('Rimborso fatture anticipate: Ristorante Uno A1, Hotel Due B2, Bar Tre C3')
    const tante = Array.from({ length: 40 }, (_, i) => ({ fornitore: 'Fornitore Lungo Srl', fattura: `FATT-${i}`, importo: 1, bankId: 'b1' }))
    expect(causaleRimborso(tante).length).toBeLessThanOrEqual(140)
  })
  it('la mail porta beneficiario, IBAN, importo unico ed elenco delle fatture', () => {
    const { subject, body } = emailRimborso({
      dataStr: '10/11/2026', dati: { nome: 'Mario Rossi', iban: IBAN_OK },
      banca: { nome: 'Banca Prova', iban: '' }, righe, fmt: n => n.toFixed(2).replace('.', ','),
    })
    expect(subject).toBe('Rimborso a Mario Rossi - 10/11/2026')
    expect(body).toContain('Beneficiario: Mario Rossi')
    expect(body).toContain('IBAN beneficiario: IT60X0542811101000000123456')
    expect(body).toContain('Importo del bonifico: 76,49 €')
    expect(body).toContain('2. Hotel Due Spa, fattura B2: 42,00 €')
  })
})
