import { describe, it, expect } from 'vitest'
import { parseImportoIt } from './ceHelpers'

describe('parseImportoIt — importi in formato italiano', () => {
  it('virgola decimale', () => {
    expect(parseImportoIt('250,50')).toBe(250.5)
  })
  it('punti migliaia + virgola decimale', () => {
    expect(parseImportoIt('1.250,50')).toBe(1250.5)
  })
  it('tollera il punto come decimale', () => {
    expect(parseImportoIt('250.50')).toBe(250.5)
  })
  it('intero senza separatori', () => {
    expect(parseImportoIt('1000')).toBe(1000)
  })
  it('stringa vuota → 0', () => {
    expect(parseImportoIt('')).toBe(0)
  })
  it('non numerica → 0 (mai NaN)', () => {
    expect(parseImportoIt('abc')).toBe(0)
    expect(Number.isNaN(parseImportoIt('abc'))).toBe(false)
  })

  // Casi aggiuntivi di robustezza
  it('singolo punto a 3 cifre = migliaia', () => {
    expect(parseImportoIt('1.250')).toBe(1250)
  })
  it('più punti = tutti migliaia', () => {
    expect(parseImportoIt('1.250.000')).toBe(1250000)
  })
  it('migliaia con decimale a 2 cifre via punto/virgola', () => {
    expect(parseImportoIt('1.250.000,75')).toBe(1250000.75)
  })
  it('valuta con simbolo e spazi', () => {
    expect(parseImportoIt(' € 99,99 ')).toBe(99.99)
  })
  it('negativo', () => {
    expect(parseImportoIt('-250,50')).toBe(-250.5)
  })
  it('null/undefined → 0', () => {
    expect(parseImportoIt(null)).toBe(0)
    expect(parseImportoIt(undefined)).toBe(0)
  })
  it('solo separatore → 0', () => {
    expect(parseImportoIt(',')).toBe(0)
    expect(parseImportoIt('.')).toBe(0)
  })
})
