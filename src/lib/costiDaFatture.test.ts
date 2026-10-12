import { describe, it, expect } from 'vitest'
import { aggregaCostiDaFatture, colonnaGruppo, type RigaCostiDaFatture } from './costiDaFatture'

const r = (outlet_id: string | null, cc: string | null, mese: number, gruppo: string, importo: number): RigaCostiDaFatture =>
  ({ outlet_id, outlet: cc ? cc.toUpperCase() : null, cost_center_key: cc, mese, gruppo, importo })

describe('colonnaGruppo', () => {
  it('mappa i gruppi della vista sulle colonne del riquadro', () => {
    expect(colonnaGruppo('costo_venduto')).toBe('merce')
    expect(colonnaGruppo('locazione')).toBe('affitti')
    expect(colonnaGruppo('generali_amministrative')).toBe('struttura')
    expect(colonnaGruppo('allestimenti')).toBe('allestimenti')
    expect(colonnaGruppo('personale')).toBe('personale')
    expect(colonnaGruppo('amministratori')).toBe('amministratori')
    expect(colonnaGruppo('senza_fornitore')).toBe('senzaCategoria')
    expect(colonnaGruppo('oneri_diversi')).toBe('altro')
    expect(colonnaGruppo('finanziarie')).toBe('altro')
  })
})

describe('aggregaCostiDaFatture', () => {
  const righe = [
    r('t', 'torino', 3, 'locazione', 10000),
    r('t', 'torino', 3, 'allestimenti', 5000),
    r('t', 'torino', 4, 'costo_venduto', 2000),
    r('v', 'valdichiana', 3, 'costo_venduto', 8000),
    r('v', 'valdichiana', 3, 'locazione', -500), // nota di credito
    r('s', 'sede_magazzino', 3, 'generali_amministrative', 50000),
    r(null, null, 3, 'senza_fornitore', 300),
  ]

  it('somma per outlet, tiene gli allestimenti fuori dai costi correnti', () => {
    const out = aggregaCostiDaFatture(righe, null, new Set(['sede_magazzino']))
    const torino = out.outlet.find(o => o.key === 't')!
    expect(torino.affitti).toBe(10000)
    expect(torino.merce).toBe(2000)
    expect(torino.allestimenti).toBe(5000)
    expect(torino.correnti).toBe(12000)
    expect(out.outlet.find(o => o.key === 'v')!.correnti).toBe(7500)
  })

  it('mette la sede in fondo e separa il non assegnato', () => {
    const out = aggregaCostiDaFatture(righe, null, new Set(['sede_magazzino']))
    expect(out.outlet.map(o => o.key)).toEqual(['t', 'v', 's'])
    expect(out.outlet[2].isSede).toBe(true)
    expect(out.nonAssegnato?.senzaCategoria).toBe(300)
    expect(out.totale.correnti).toBe(12000 + 7500 + 50000 + 300)
    expect(out.totale.allestimenti).toBe(5000)
  })

  it('filtra sui mesi scelti', () => {
    const out = aggregaCostiDaFatture(righe, [4], new Set())
    expect(out.outlet).toHaveLength(1)
    expect(out.outlet[0].merce).toBe(2000)
    expect(out.nonAssegnato).toBeNull()
  })

  it('somma il personale nel totale, tiene fuori gli amministratori', () => {
    const conPersonale = [
      ...righe,
      r('t', 'torino', 3, 'personale', 9000),
      r('s', 'sede_magazzino', 3, 'personale', 12000),
      r('s', 'sede_magazzino', 4, 'personale', 12500),
      r('s', 'sede_magazzino', 3, 'amministratori', 18000),
    ]
    const out = aggregaCostiDaFatture(conPersonale, null, new Set(['sede_magazzino']))
    const torino = out.outlet.find(o => o.key === 't')!
    expect(torino.personale).toBe(9000)
    expect(torino.correnti).toBe(21000)
    const sede = out.outlet.find(o => o.key === 's')!
    expect(sede.personale).toBe(24500)
    expect(sede.amministratori).toBe(18000)
    expect(sede.correnti).toBe(50000 + 24500)
    expect(out.totale.amministratori).toBe(18000)
    expect(out.ultimoMesePersonale).toBe(4)
    expect(aggregaCostiDaFatture(conPersonale, [3], new Set()).ultimoMesePersonale).toBe(3)
    expect(aggregaCostiDaFatture(righe, null, new Set()).ultimoMesePersonale).toBeNull()
  })
})
