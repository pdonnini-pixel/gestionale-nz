import { describe, it, expect } from 'vitest'
import { moduloDa, moduloInRiga, contrattoLabel } from './anagraficaDipendente'

describe('anagrafica della persona: modulo e riga', () => {
  it('il modulo si riempie dai dati di oggi, anche dalle colonne inglesi', () => {
    const m = moduloDa({ first_name: 'Giulia', last_name: 'Rinaldi', contratto_tipo: 'determinato', part_time_pct: 75, data_cessazione: '9999-12-31' })
    expect(m.nome).toBe('Giulia')
    expect(m.cognome).toBe('Rinaldi')
    expect(m.part_time_pct).toBe('75')
    expect(m.data_cessazione).toBe('')
    expect(moduloDa(null).contratto).toBe('indeterminato')
  })

  it('la riga allinea le colonne, i vuoti diventano NULL e il tempo determinato vale solo per lui', () => {
    const r = moduloInRiga({ ...moduloDa(null), nome: 'Sara', cognome: 'Galli', qualifica: 'Impiegato', contratto: 'indeterminato', proroghe: '2', scadenza_td: '2027-01-31' })
    expect(r.first_name).toBe('Sara')
    expect(r.role_description).toBe('Impiegato')
    expect(r.contratto_tipo).toBe('indeterminato')
    expect('contratto' in r).toBe(false)
    expect(r.proroghe).toBeNull()
    expect(r.scadenza_td).toBeNull()
    expect(r.hire_date).toBeNull()
    const td = moduloInRiga({ ...moduloDa(null), contratto: 'determinato', proroghe: '2', part_time_pct: '' })
    expect(td.proroghe).toBe(2)
    expect(td.part_time_pct).toBeNull()
    expect(contrattoLabel('a_chiamata')).toBe('A chiamata')
  })
})
