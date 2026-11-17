import { describe, it, expect, vi } from 'vitest'

// Coordinate vere della pagina 3 del bilancio di verifica Zago 2025 (importi
// inventati dove non servono): codice e importo dello stesso conto stanno a un
// punto di distanza in verticale e prima cadevano in due righe diverse.
const items = [
  { str: 'CONTO ECONOMICO', x: 250, y: 700 },
  { str: '510101', x: 291.5, y: 546.2 }, { str: 'Ricavi delle vendite', x: 349, y: 546.0 }, { str: '6.068,37', x: 528.5, y: 546.4 },
  { str: '610131', x: 18.5, y: 534.15 }, { str: 'Prodotti finiti Italia', x: 75.5, y: 533.95 }, { str: '718.380,38', x: 250, y: 534.2 },
  { str: '51010101', x: 291.5, y: 533.15 }, { str: 'Ricavi delle vendite Italia', x: 349, y: 533.7 }, { str: '6.068,37', x: 528.5, y: 534.2 },
  { str: '610139', x: 18.5, y: 521.85 }, { str: 'Acquisti vari', x: 75.5, y: 521.65 }, { str: '450,18', x: 264, y: 521.9 },
  { str: '510107', x: 291.5, y: 520.85 }, { str: 'Corrispettivi Forte dei Marmi', x: 349, y: 521.4 }, { str: '638.548,68', x: 520.5, y: 521.9 },
  { str: '610143', x: 18.5, y: 509.55 }, { str: 'Trasporti su acquisti', x: 75.5, y: 509.35 }, { str: '607,39', x: 264, y: 509.6 },
  { str: '510108', x: 291.5, y: 508.55 }, { str: 'Corrispettivi Firenze', x: 349, y: 509.1 }, { str: '804.957,07', x: 520.5, y: 509.6 },
]

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: 'x' },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: items.map(i => ({ str: i.str, transform: [1, 0, 0, 1, i.x, i.y] })) }),
      }),
    }),
  }),
}))

import { parseBilancio } from './bilancioParser'

describe('righe del bilancio di verifica', () => {
  it('codice e importo a un punto di distanza restano nella stessa riga', async () => {
    const p = await parseBilancio(new Uint8Array([1]))
    const ricavi = Object.fromEntries(p.contoEconomico.ricavi.map(r => [r.code, [r.description, r.amount]]))
    const costi = Object.fromEntries(p.contoEconomico.costi.map(r => [r.code, [r.description, r.amount]]))
    expect(ricavi['51010101']).toEqual(['Ricavi delle vendite Italia', 6068.37])
    expect(ricavi['510107']).toEqual(['Corrispettivi Forte dei Marmi', 638548.68])
    expect(ricavi['510108']).toEqual(['Corrispettivi Firenze', 804957.07])
    expect(costi['610143']).toEqual(['Trasporti su acquisti', 607.39])
    // nessuna riga senza codice o con il codice letto come importo
    expect(p.contoEconomico.ricavi.every(r => r.code !== '' && r.amount !== Number(r.code))).toBe(true)
    expect(p.contoEconomico.costi.every(r => r.code !== '' && r.amount !== Number(r.code))).toBe(true)
  })
})
