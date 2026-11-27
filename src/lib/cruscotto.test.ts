import { describe, it, expect } from 'vitest'
import { affittoCompetenza, primoMesePieno, costruisciCruscotto, parita, stimaChiusura, contoNegozio, avvisi, type DatiCruscottoRaw } from './cruscotto'

const mesi = (vals: Record<number, number>) => { const a = Array(12).fill(0); for (const k in vals) a[Number(k) - 1] = vals[k]; return a }

function dati(): DatiCruscottoRaw {
  const ricavi = []
  for (let m = 1; m <= 12; m++) ricavi.push({ o: 'A', y: 2025, m, netto: 100, lordo: 122, ultimo: `2025-${String(m).padStart(2, '0')}-28` })
  for (let m = 1; m <= 10; m++) ricavi.push({ o: 'A', y: 2026, m, netto: 110, lordo: 134.2, ultimo: `2026-${String(m).padStart(2, '0')}-28` })
  ricavi.push({ o: 'A', y: 2026, m: 11, netto: 50, lordo: 61, ultimo: '2026-11-15' })
  for (let m = 4; m <= 11; m++) ricavi.push({ o: 'B', y: 2026, m, netto: 100, lordo: 122, ultimo: m === 11 ? '2026-11-15' : `2026-${String(m).padStart(2, '0')}-28` })
  return {
    anno: 2026, oggi: '2026-11-16',
    negozi: [
      { id: 'A', code: 'A', name: 'Alfa', cc: 'alfa', tipo: 'outlet', attivo: true, apertura: '2020-01-01', chiusura: null },
      { id: 'B', code: 'B', name: 'Beta', cc: 'beta', tipo: 'outlet', attivo: true, apertura: '2026-04-01', chiusura: null },
      { id: 'S', code: 'S', name: 'Sede', cc: 'sede', tipo: 'sede', attivo: true, apertura: null, chiusura: null },
    ],
    ricavi,
    budget: [{ cc: 'alfa', m: 11, v: 120 }, { cc: 'alfa', m: 12, v: 130 }, { cc: 'beta', m: 11, v: 80 }, { cc: 'beta', m: 12, v: 90 }],
    moda: [{ o: 'A', y: 2026, m: 1, ingressi: 1000, scontrini: 100, vendite: 1000, costo: 400, listino: 2000 }],
    personale: [
      { o: 'A', f: 'A', m: 1, costo: 30, amm: 0, dip: 3 }, { o: 'B', f: 'B', m: 1, costo: 10, amm: 0, dip: 1 },
      { o: 'S', f: 'S', m: 1, costo: 20, amm: 21, dip: 2 },
    ],
    costi: [
      { cc: 'alfa', o: 'A', m: 1, g: 'locazione', v: 300 }, { cc: 'alfa', o: 'A', m: 1, g: 'utenze', v: 5 },
      { cc: 'alfa', o: 'A', m: 1, g: 'costo_venduto', v: 999 }, { cc: null, o: null, m: 1, g: 'locazione', v: 50 },
    ],
    liquidita: { saldo: 100, conti: 1, aggiornato: null },
    scaduto: { oltre30: 300, ultimi30: 100, entro30: 100, da31a60: 0, oltre60: 0, fatture_scadute: 5, primo_fornitore: { nome: 'Fornitore X', importo: 350, fatture: 4, dal: '2026-06-30' } },
  }
}

describe('affittoCompetenza', () => {
  it('spalma sui tre mesi chi paga a trimestre anticipato', () => {
    expect(affittoCompetenza(mesi({ 1: 300, 4: 300, 7: 300, 10: 300 }))).toEqual(Array(12).fill(100))
  })
  it('lascia com\'è chi paga ogni mese', () => {
    const m = mesi({ 1: 100, 2: 100, 3: 100 })
    expect(affittoCompetenza(m)).toEqual(m)
  })
})

describe('primoMesePieno', () => {
  it('mese dopo se apre a metà mese, 1 se prima dell\'anno, null se dopo', () => {
    expect(primoMesePieno('2025-03-26', 2025)).toBe(4)
    expect(primoMesePieno('2025-04-01', 2025)).toBe(4)
    expect(primoMesePieno('2024-06-13', 2025)).toBe(1)
    expect(primoMesePieno('2026-03-24', 2025)).toBeNull()
  })
})

describe('costruisciCruscotto', () => {
  const c = costruisciCruscotto(dati())
  it('riconosce mese parziale e sede', () => {
    expect(c.meseUltimo).toBe(11); expect(c.giornoUltimo).toBe(15); expect(c.meseParziale).toBe(true)
    expect(c.negozi.map(n => n.code)).toEqual(['A', 'B'])
    expect(c.sede?.affitto[0]).toBe(50)
  })
  it('divide l\'amministratore sui ricavi del periodo del conto', () => {
    const a = c.negozi.find(n => n.code === 'A')!, b = c.negozi.find(n => n.code === 'B')!
    expect(a.ammQuota + b.ammQuota).toBeCloseTo(21)
    expect(a.ammQuota).toBeCloseTo(21) // a gennaio solo Alfa ha ricavi
  })
  it('parità solo sui mesi pieni in tutti e due gli anni', () => {
    const a = c.negozi.find(n => n.code === 'A')!
    expect(parita(a, 10)?.pct).toBeCloseTo(10)
    expect(parita(c.negozi.find(n => n.code === 'B')!, 10)).toBeNull()
  })
  it('stima: proiezione del mese in corso e dicembre a budget', () => {
    const a = c.negozi.find(n => n.code === 'A')!
    expect(stimaChiusura(a, c)).toBeCloseTo(1100 + 50 / 15 * 30 + 130)
  })
  it('conto a scalare: merce da MODA, affitto e spese, costo_venduto escluso', () => {
    const k = contoNegozio(c.negozi.find(n => n.code === 'A')!, c)
    expect(k.ricavi).toBe(110); expect(k.merce).toBeCloseTo(44); expect(k.spese).toBe(5)
    expect(k.lascia).toBeCloseTo(110 - 44 - (30 + 21) - k.affitto - 5)
  })
  it('avvisi: fornitore che pesa più di metà dello scaduto per primo', () => {
    const av = avvisi(c)
    expect(av[0].livello).toBe('critico')
    expect(av[0].titolo).toContain('Fornitore X')
    expect(av.some(x => x.titolo.includes('MODA'))).toBe(true)
  })
})
