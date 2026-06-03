import { describe, it, expect } from 'vitest'
import { computeConfrontoDiff, type ConfrontoRow, type ExistingConfrontoRow } from './budgetConfrontoDiff'

// ─── TEST DECISIVO (ticket 9bf52ecc) ──────────────────────────────────────
// Prova che il bug "Salva Confronto cancella dati manuali" non può ripetersi:
//   • Salvare SENZA modifiche → 0 righe toccate nel DB (né upsert né delete).
//   • Modificare 1 cella → tocca SOLO quella riga.
//   • Azzerare una cella → la rimozione è isolata a quella sola chiave.

const CID = '00000000-0000-0000-0000-000000000001'

function row(over: Partial<ConfrontoRow>): ConfrontoRow {
  return {
    company_id: CID,
    cost_center: 'VALDICHIANA',
    account_code: '510107',
    year: 2026,
    month: 1,
    entry_type: 'rev_monthly',
    amount: 1000,
    ...over,
  }
}

function existing(over: Partial<ExistingConfrontoRow>): ExistingConfrontoRow {
  return {
    id: 'id-1',
    entry_type: 'rev_monthly',
    account_code: '510107',
    month: 1,
    amount: 1000,
    ...over,
  }
}

describe('computeConfrontoDiff', () => {
  it('NESSUNA modifica → 0 upsert, 0 delete (il bug 9bf52ecc non può ripetersi)', () => {
    const desired: ConfrontoRow[] = [
      row({ account_code: '510107', month: 1, amount: 1000 }),
      row({ account_code: '510107', month: 2, amount: 2000 }),
      row({ account_code: 'C01', month: 0, entry_type: 'consuntivo', amount: 5000 }),
    ]
    const db: ExistingConfrontoRow[] = [
      existing({ id: 'a', account_code: '510107', month: 1, amount: 1000 }),
      existing({ id: 'b', account_code: '510107', month: 2, amount: 2000 }),
      existing({ id: 'c', account_code: 'C01', month: 0, entry_type: 'consuntivo', amount: 5000 }),
    ]
    const diff = computeConfrontoDiff(desired, db)
    expect(diff.toUpsert).toHaveLength(0)
    expect(diff.toDeleteIds).toHaveLength(0)
  })

  it('1 cella modificata → tocca SOLO quella riga, nessuna cancellazione', () => {
    const desired: ConfrontoRow[] = [
      row({ account_code: '510107', month: 1, amount: 1234 }), // <-- cambiata
      row({ account_code: '510107', month: 2, amount: 2000 }),
    ]
    const db: ExistingConfrontoRow[] = [
      existing({ id: 'a', account_code: '510107', month: 1, amount: 1000 }),
      existing({ id: 'b', account_code: '510107', month: 2, amount: 2000 }),
    ]
    const diff = computeConfrontoDiff(desired, db)
    expect(diff.toUpsert).toHaveLength(1)
    expect(diff.toUpsert[0].amount).toBe(1234)
    expect(diff.toUpsert[0].month).toBe(1)
    expect(diff.toDeleteIds).toHaveLength(0)
  })

  it('stato PARZIALE non cancella in blocco: le celle mancanti finiscono in toDelete (isolate), non spariscono in silenzio', () => {
    // Lo stato React ha solo i mensili; il consuntivo annuale manuale di Lilian
    // esiste a DB ma NON nello stato desiderato.
    const desired: ConfrontoRow[] = [
      row({ account_code: '510107', month: 1, amount: 1000 }),
    ]
    const db: ExistingConfrontoRow[] = [
      existing({ id: 'a', account_code: '510107', month: 1, amount: 1000 }),
      existing({ id: 'manuale', account_code: 'C01', month: 0, entry_type: 'consuntivo', amount: 5000 }),
    ]
    const diff = computeConfrontoDiff(desired, db)
    // La cella manuale NON è in upsert e la sua rimozione è esplicita e isolata
    // (il chiamante mostra una modale di conferma prima di eseguirla).
    expect(diff.toUpsert).toHaveLength(0)
    expect(diff.toDeleteIds).toEqual(['manuale'])
    expect(diff.countBefore).toBe(2)
    expect(diff.countAfter).toBe(1)
    expect(diff.totalBefore).toBe(6000)
    expect(diff.totalAfter).toBe(1000)
  })

  it('riga nuova (non presente a DB) → upsert, 0 delete', () => {
    const desired: ConfrontoRow[] = [
      row({ account_code: '510107', month: 1, amount: 1000 }),
      row({ account_code: '510107', month: 3, amount: 3000 }), // nuova
    ]
    const db: ExistingConfrontoRow[] = [
      existing({ id: 'a', account_code: '510107', month: 1, amount: 1000 }),
    ]
    const diff = computeConfrontoDiff(desired, db)
    expect(diff.toUpsert).toHaveLength(1)
    expect(diff.toUpsert[0].month).toBe(3)
    expect(diff.toDeleteIds).toHaveLength(0)
  })

  it('rettifica: cambia solo rettifica_pct → riga considerata modificata', () => {
    const desired: ConfrontoRow[] = [
      row({ account_code: 'C01', month: 0, entry_type: 'rettifica', amount: 100, rettifica_amount: 100, rettifica_pct: 12 }),
    ]
    const db: ExistingConfrontoRow[] = [
      existing({ id: 'a', account_code: 'C01', month: 0, entry_type: 'rettifica', amount: 100, rettifica_amount: 100, rettifica_pct: 10 }),
    ]
    const diff = computeConfrontoDiff(desired, db)
    expect(diff.toUpsert).toHaveLength(1)
  })

  it('differenze sotto epsilon (float noise) NON contano come modifica', () => {
    const desired: ConfrontoRow[] = [row({ amount: 1000.0001 })]
    const db: ExistingConfrontoRow[] = [existing({ id: 'a', amount: 1000 })]
    const diff = computeConfrontoDiff(desired, db)
    expect(diff.toUpsert).toHaveLength(0)
  })
})
