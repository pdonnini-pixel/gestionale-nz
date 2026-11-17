import { describe, it, expect } from 'vitest'
import { adattaTermini } from './terminiPdv'
import { labelsDa } from '../hooks/useCompanyLabels'

const nz = labelsDa('Outlet')
const zago = labelsDa('Negozio')

describe('adattaTermini', () => {
  it('su NZ non cambia niente', () => {
    const s = "Ricavi dell'outlet e degli outlet. Confronto Outlet"
    expect(adattaTermini(s, nz)).toBe(s)
  })
  it('su Zago usa negozio con articoli giusti', () => {
    expect(adattaTermini("Ricavi dell'outlet", zago)).toBe('Ricavi del negozio')
    expect(adattaTermini("L'outlet ha", zago)).toBe('Il negozio ha')
    expect(adattaTermini('tutti gli outlet attivi', zago)).toBe('tutti i negozi attivi')
    expect(adattaTermini('sugli outlet e dagli outlet', zago)).toBe('sui negozi e dai negozi')
    expect(adattaTermini("nell'outlet, all'outlet, sull'outlet", zago)).toBe('nel negozio, al negozio, sul negozio')
    expect(adattaTermini("quell'outlet", zago)).toBe('quel negozio')
    expect(adattaTermini('quanti outlet hanno', zago)).toBe('quanti negozi hanno')
    expect(adattaTermini('Costi per outlet', zago)).toBe('Costi per negozio')
    expect(adattaTermini('Confronto Outlet e Margini Outlet', zago)).toBe('Confronto Negozi e Margini Negozi')
    expect(adattaTermini('Nuovo outlet', zago)).toBe('Nuovo negozio')
    expect(adattaTermini('numero di outlet attivi', zago)).toBe('numero di negozi attivi')
    expect(adattaTermini('Contratti e outlet', zago)).toBe('Contratti e negozi')
  })
  it('con «Punto vendita» (Zago) articoli e plurale giusti', () => {
    const pv = labelsDa('Punto vendita')
    expect(pv.pointOfSalePlural).toBe('Punti vendita')
    expect(pv.art.il).toBe('il punto vendita')
    expect(pv.art.dei).toBe('dei punti vendita')
    expect(adattaTermini("Ricavi dell'outlet e tutti gli outlet", pv)).toBe('Ricavi del punto vendita e tutti i punti vendita')
    expect(adattaTermini('Confronto Outlet', pv)).toBe('Confronto Punti vendita')
  })
  it('lascia i valori letterali', () => {
    expect(adattaTermini('nota "Outlet: CODICE · motivo"', zago)).toBe('nota "Outlet: CODICE · motivo"')
    expect(adattaTermini('tipo (Outlet, Retail, Corner)', zago)).toBe('tipo (Outlet, Retail, Corner)')
  })
})
