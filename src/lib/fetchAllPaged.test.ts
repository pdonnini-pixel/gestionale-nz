import { describe, it, expect, vi } from 'vitest'
import { fetchAllPaged } from './fetchAllPaged'

const rows = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i }))

describe('fetchAllPaged', () => {
  it('unisce le pagine finche\' la sorgente e\' esaurita', async () => {
    const pagine = [rows(1000), rows(1000, 1000), rows(460, 2000)]
    let chiamata = 0
    const out = await fetchAllPaged<{ id: number }>(() => Promise.resolve({ data: pagine[chiamata++], error: null }))
    expect(out).toHaveLength(2460)
    expect(chiamata).toBe(3)
  })

  it('una pagina che fallisce non torna un risultato a meta\'', async () => {
    // Il 18/09/2026 la Prima Nota di agosto e' uscita con i soli movimenti dal
    // 17: meglio nessun dato di meta' estratto conto creduto intero.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let chiamata = 0
    const query = () => (chiamata++ === 0
      ? Promise.resolve({ data: rows(1000), error: null })
      : Promise.resolve({ data: null, error: { message: 'connessione interrotta' } }))
    await expect(fetchAllPaged(query, 'bank_transactions')).rejects.toThrow(/bank_transactions.*1000 righe.*connessione interrotta/)
  })

  it('la prima pagina vuota non e\' un errore', async () => {
    const out = await fetchAllPaged(() => Promise.resolve({ data: [], error: null }))
    expect(out).toEqual([])
  })
})
