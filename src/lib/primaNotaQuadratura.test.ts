import { describe, it, expect } from 'vitest'
import { snapshotFromRaw, quadraturaConto, quadraturaConti, quadraturaContante, isPrelievo, saldiProgressivi, nextDay, prevDay, type PnTxSnapshot, type PnClosingLite } from './primaNotaQuadratura'

const tx = (p: Partial<PnTxSnapshot> & { date: string; amount: number }): PnTxSnapshot =>
  ({ id: p.id ?? `${p.date}-${p.amount}-${Math.random().toString(36).slice(2, 6)}`, bank_account_id: 'bcc', fetched_at: null, snapshot: null, ...p })

describe('snapshotFromRaw', () => {
  it('legge fetchedAt e accountBalanceSnapshot dal raw_data A-Cube', () => {
    expect(snapshotFromRaw({ fetchedAt: '2026-08-31T08:55:56Z', extra: { accountBalanceSnapshot: 33079.52 } })).toEqual({ fetched_at: '2026-08-31T08:55:56Z', snapshot: 33079.52 })
    expect(snapshotFromRaw({ fetchedAt: '2026-08-31T08:55:56Z', extra: { accountBalanceSnapshot: '33079.52' } }).snapshot).toBe(33079.52)
  })
  it('tollera raw_data mancante o incompleto (movimenti prima di marzo 2026)', () => {
    expect(snapshotFromRaw(null)).toEqual({ fetched_at: null, snapshot: null })
    expect(snapshotFromRaw({ fetchedAt: '2026-01-02T00:00:00Z' })).toEqual({ fetched_at: '2026-01-02T00:00:00Z', snapshot: null })
    expect(snapshotFromRaw({ extra: { accountBalanceSnapshot: 'abc' } }).snapshot).toBeNull()
  })
})

describe('quadraturaConto (numeri BCC agosto 2026)', () => {
  const pre = [
    tx({ date: '2026-07-30', amount: 600, fetched_at: '2026-07-30T06:00:00Z', snapshot: 71205.66 }),
    tx({ date: '2026-07-31', amount: 927.8, fetched_at: '2026-07-31T06:00:00Z', snapshot: 72133.46 }),
  ]
  const period = [
    tx({ date: '2026-08-03', amount: 17034, fetched_at: '2026-08-03T06:00:00Z', snapshot: 89167.46 }),
    tx({ date: '2026-08-07', amount: -39445.9, fetched_at: '2026-08-08T06:00:00Z', snapshot: 11375.13 }),
    tx({ date: '2026-08-20', amount: -16642.04, fetched_at: '2026-08-20T06:00:00Z', snapshot: 21201.15 }),
    tx({ date: '2026-08-31', amount: 0, fetched_at: '2026-08-31T08:55:56Z', snapshot: 33079.52 }),
  ]
  const all = [...pre, ...period]
  it('saldo iniziale + movimenti = saldo finale della banca', () => {
    // 72133.46 + 17034 − 39445.9 − 16642.04 = 33079.52
    const q = quadraturaConto('bcc', all, '2026-08-01', '2026-08-31')
    expect(q.saldo_scarico_iniziale).toBe(72133.46)
    expect(q.saldo_iniziale).toBe(72133.46)
    expect(q.scaricato_iniziale).toBe('2026-07-31T06:00:00Z')
    expect(q.saldo_scarico_finale).toBe(33079.52)
    expect(q.saldo_finale).toBe(33079.52)
    expect(q.scaricato_finale).toBe('2026-08-31T08:55:56Z')
    expect(q.n_movimenti).toBe(4)
    expect(q.entrate).toBe(17034)
    expect(q.uscite).toBe(56087.94)
    expect(q.saldo_finale_calcolato).toBe(33079.52)
    expect(q.differenza).toBe(0)
    expect(q.stato).toBe('quadra')
    expect(q.rettifica_iniziale).toEqual({ piu: [], meno: [] })
    expect(q.rettifica_finale).toEqual({ piu: [], meno: [] })
    expect(q.movimenti.map(m => m.date)).toEqual(['2026-08-03', '2026-08-07', '2026-08-20', '2026-08-31'])
  })
  it('un movimento di agosto arrivato dopo lo scarico del 31/08 rettifica il saldo al 31/08 (caso Intesa, −20)', () => {
    const late = tx({ id: 'late', date: '2026-08-31', amount: -100, fetched_at: '2026-09-01T06:00:00Z', snapshot: 32979.52 })
    const q = quadraturaConto('bcc', [...all, late], '2026-08-01', '2026-08-31')
    expect(q.scaricato_finale).toBe('2026-08-31T08:55:56Z')
    expect(q.saldo_scarico_finale).toBe(33079.52)
    expect(q.rettifica_finale.piu.map(r => r.id)).toEqual(['late'])
    expect(q.saldo_finale).toBe(32979.52)
    expect(q.uscite).toBe(56187.94)
    expect(q.saldo_finale_calcolato).toBe(32979.52)
    expect(q.differenza).toBe(0)
    expect(q.stato).toBe('quadra')
  })
  it('un movimento di luglio arrivato in agosto rettifica il saldo al 31/07 (caso Intesa, scarico del 28/07)', () => {
    const old = tx({ id: 'old', date: '2026-07-15', amount: -20, fetched_at: '2026-08-10T06:00:00Z', snapshot: 15441.09 })
    const period2 = period.map(r => (r.date >= '2026-08-10' ? { ...r, snapshot: (r.snapshot as number) - 20 } : r))
    const q = quadraturaConto('bcc', [...pre, old, ...period2], '2026-08-01', '2026-08-31')
    expect(q.rettifica_iniziale.piu.map(r => r.id)).toEqual(['old'])
    expect(q.saldo_scarico_iniziale).toBe(72133.46)
    expect(q.saldo_iniziale).toBe(72113.46)
    expect(q.rettifica_finale.piu).toEqual([])
    expect(q.saldo_finale).toBe(33059.52)
    expect(q.saldo_finale_calcolato).toBe(33059.52)
    expect(q.stato).toBe('quadra')
  })
  it('un movimento di luglio arrivato dopo lo scarico finale rettifica entrambi i saldi', () => {
    const old = tx({ id: 'old', date: '2026-07-15', amount: -20, fetched_at: '2026-09-02T06:00:00Z', snapshot: 33059.52 })
    const q = quadraturaConto('bcc', [...all, old], '2026-08-01', '2026-08-31')
    expect(q.rettifica_iniziale.piu.map(r => r.id)).toEqual(['old'])
    expect(q.rettifica_finale.piu.map(r => r.id)).toEqual(['old'])
    expect(q.saldo_iniziale).toBe(72113.46)
    expect(q.saldo_finale).toBe(33059.52)
    expect(q.differenza).toBe(0)
  })
  it('data contabile nel mese dopo: il movimento è già nello scarico del 30/06 ma non è di luglio', () => {
    // Competenze del 30/06 (operazione) contabilizzate il 02/07: per data contabile stanno in luglio.
    // Lo scarico del 30/06 le contiene già: per il saldo al 30/06 vanno tolte, e la quadratura di luglio le conta come movimenti.
    const rows = [
      tx({ id: 'giu', date: '2026-06-29', amount: 1000, fetched_at: '2026-06-29T06:00:00Z', snapshot: 10000 }),
      tx({ id: 'comp', date: '2026-07-02', amount: -60, fetched_at: '2026-06-30T06:00:00Z', snapshot: 9940 }),
      tx({ id: 'lug', date: '2026-07-10', amount: 500, fetched_at: '2026-07-10T06:00:00Z', snapshot: 10440 }),
      tx({ id: 'fine', date: '2026-07-31', amount: 0, fetched_at: '2026-07-31T06:00:00Z', snapshot: 10440 }),
    ]
    const q = quadraturaConto('bcc', rows, '2026-07-01', '2026-07-31')
    expect(q.saldo_scarico_iniziale).toBe(9940)
    expect(q.rettifica_iniziale.meno.map(r => r.id)).toEqual(['comp'])
    expect(q.saldo_iniziale).toBe(10000)
    expect(q.movimenti.map(r => r.id)).toEqual(['comp', 'lug', 'fine'])
    expect(q.saldo_finale_calcolato).toBe(10440)
    expect(q.saldo_finale).toBe(10440)
    expect(q.differenza).toBe(0)
  })
  it('un movimento mancante fa emergere la differenza', () => {
    const q = quadraturaConto('bcc', all.filter(r => r.amount !== -16642.04), '2026-08-01', '2026-08-31')
    expect(q.saldo_finale_calcolato).toBe(49721.56)
    expect(q.differenza).toBe(-16642.04)
    expect(q.stato).toBe('non_quadra')
  })
  it('senza saldi della banca (movimenti vecchi) resta «senza saldi»', () => {
    const q = quadraturaConto('bcc', all.map(r => ({ ...r, snapshot: null })), '2026-08-01', '2026-08-31')
    expect(q.saldo_iniziale).toBeNull()
    expect(q.saldo_finale).toBeNull()
    expect(q.differenza).toBeNull()
    expect(q.stato).toBe('senza_saldi')
    expect(q.n_movimenti).toBe(4)
  })
  it('lo scarico finale è l ultimo entro la fine del periodo, non quello di oggi', () => {
    const sept = tx({ date: '2026-08-31', amount: 0, fetched_at: '2026-09-14T06:00:00Z', snapshot: 27816.78 })
    const q = quadraturaConto('bcc', [...all, sept], '2026-08-01', '2026-08-31')
    expect(q.saldo_scarico_finale).toBe(33079.52)
    expect(q.rettifica_finale.piu).toHaveLength(1)
  })
  it('quadraturaConti separa i conti', () => {
    const mps = tx({ bank_account_id: 'mps', date: '2026-08-05', amount: 10, fetched_at: '2026-08-05T06:00:00Z', snapshot: 110 })
    const mpsPre = tx({ bank_account_id: 'mps', date: '2026-07-31', amount: 5, fetched_at: '2026-07-31T06:00:00Z', snapshot: 100 })
    const qs = quadraturaConti([...all, mps, mpsPre], '2026-08-01', '2026-08-31')
    expect(qs.map(q => q.bank_account_id).sort()).toEqual(['bcc', 'mps'])
    expect(qs.find(q => q.bank_account_id === 'mps')).toMatchObject({ saldo_iniziale: 100, saldo_finale: 110, differenza: 0, stato: 'quadra' })
  })
  it('saldi progressivi', () => {
    expect(saldiProgressivi([{ amount: 10 }, { amount: -2.5 }], 100)).toEqual([110, 107.5])
    expect(saldiProgressivi([{ amount: 10 }], null)).toEqual([null])
    expect(nextDay('2026-08-31')).toBe('2026-09-01')
    expect(prevDay('2026-08-01')).toBe('2026-07-31')
  })
})

describe('quadraturaContante', () => {
  const bank = [
    { amount: 760, description: 'VERS. GDO ... PALMANOVA', isVersamento: true },
    { amount: 1365, description: 'VERSAMENTO DA ATM 01030-1745', isVersamento: true },
    { amount: -500, description: 'PRELEVAMENTO CONTANTE SPORTELLO', isVersamento: false },
    { amount: -30, description: 'COMMISSIONI', isVersamento: false },
    { amount: 100, description: 'BONIFICO CLIENTE', isVersamento: false },
  ]
  it('riconosce i prelievi', () => {
    expect(isPrelievo({ amount: -500, description: 'PREL. CONT. ATM' })).toBe(true)
    expect(isPrelievo({ amount: 500, description: 'PRELEVAMENTO' })).toBe(false)
    expect(isPrelievo({ amount: -500, description: 'BONIFICO' })).toBe(false)
  })
  it('senza chiusure: solo il lato banca', () => {
    const q = quadraturaContante(bank, [])
    expect(q).toEqual({ versamenti_banca: 2125, n_versamenti_banca: 2, prelievi_banca: 500, n_prelievi_banca: 1, cassa: null })
  })
  const cl = (p: Partial<PnClosingLite> & { outlet_id: string; closing_date: string }): PnClosingLite => ({
    status: 'confermata', cash_deposit: 0, deposit_bank_amount: null, deposit_bank_status: 'in_attesa', cash_expenses: 0, customer_refunds: 0,
    cash_float_opening: 500, cash_pending_opening: 0, cash_float_declared: 500, cash_pending_declared: 0, contanti: 0, ...p,
  })
  it('con le chiusure: fondo iniziale + contanti − spese − rimborsi − versamenti = fondo finale', () => {
    const closings = [
      cl({ outlet_id: 'A', closing_date: '2026-09-01', cash_float_opening: 500, cash_pending_opening: 200, contanti: 1000, cash_float_declared: 500, cash_pending_declared: 1200 }),
      cl({ outlet_id: 'A', closing_date: '2026-09-02', cash_float_opening: 500, cash_pending_opening: 1200, contanti: 300, cash_expenses: 40, customer_refunds: 10, cash_deposit: 1400, deposit_bank_amount: 1400, deposit_bank_status: 'accreditato', cash_float_declared: 500, cash_pending_declared: 50 }),
      cl({ outlet_id: 'B', closing_date: '2026-09-01', cash_float_opening: 300, cash_pending_opening: 0, contanti: 200, cash_float_declared: 300, cash_pending_declared: 200 }),
    ]
    const q = quadraturaContante(bank, closings)
    expect(q.cassa).toMatchObject({
      n_chiusure: 3, outlets: 2, dal: '2026-09-01', al: '2026-09-02',
      fondo_iniziale: 1000, contanti_incassati: 1500, spese: 40, rimborsi: 10,
      versamenti_dichiarati: 1400, n_versamenti_dichiarati: 1, versamenti_trovati_in_banca: 1400, n_versamenti_trovati: 1,
      fondo_finale: 1050, fondo_finale_calcolato: 1050, differenza: 0,
    })
  })
  it('se un outlet parte senza fondo noto, il fondo iniziale e la differenza sono null', () => {
    const closings = [
      cl({ outlet_id: 'A', closing_date: '2026-09-01', cash_float_opening: null, cash_pending_opening: null, contanti: 100, cash_float_declared: 500, cash_pending_declared: 100 }),
    ]
    const q = quadraturaContante(bank, closings)
    expect(q.cassa?.fondo_iniziale).toBeNull()
    expect(q.cassa?.fondo_finale).toBe(600)
    expect(q.cassa?.fondo_finale_calcolato).toBeNull()
    expect(q.cassa?.differenza).toBeNull()
  })
})
