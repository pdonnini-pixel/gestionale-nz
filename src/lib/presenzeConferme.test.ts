import { describe, expect, it } from 'vitest'
import { confermaDiretta, esitoEntrataDichiarata, etichettaTipo, riepilogoMese, type EventoPresenze } from './presenzeConferme'

const base: EventoPresenze = {
  id: 'x', data: '2026-11-09', tipo: 'ritardo', outlet_id: 'o', negozio: 'Roma Soratte', employee_id: 'g', persona: 'Giulia Rossi',
  prova: false, ora: null, turno_inizio: '10:00:00', turno_fine: '19:00:00', minuti: 22, minuti_proposti: 30, minuti_confermati: null,
  tolleranza: 10, margine: 15, causale: null, causale_negozio: null, motivo: null, stato: 'da_confermare', esito: null,
  scala_permesso: null, deciso_il: null, deciso_da: null, nota_decisione: null, leave_request_id: null,
}
const ev = (x: Partial<EventoPresenze>): EventoPresenze => ({ ...base, ...x })

describe('casi delle presenze', () => {
  it("entrata dichiarata: in orario, entro la tolleranza, oltre con il ritardo", () => {
    expect(esitoEntrataDichiarata(0, 10)).toEqual({ ritardo: false, permesso: 0, testo: 'in orario' })
    expect(esitoEntrataDichiarata(8, 10).ritardo).toBe(false)
    expect(esitoEntrataDichiarata(25, 10)).toEqual({ ritardo: true, permesso: 30, testo: "25' dopo: alla conferma nasce il ritardo (30' di permesso)" })
    expect(etichettaTipo({ tipo: 'entrata_dichiarata', causale: null })).toBe('Entrata dichiarata')
  })

  it("riepilogo: l'entrata dichiarata confermata non conta come straordinario", () => {
    const r = riepilogoMese([ev({ tipo: 'entrata_dichiarata', stato: 'confermato', esito: 'entrata_confermata', minuti_proposti: 0, minuti_confermati: 0 })])
    expect(r[0].straordinari).toBe(0)
    expect(r[0].ritardi).toBe(0)
  })

  it('etichetta: la malattia ha la sua', () => {
    expect(etichettaTipo({ tipo: 'uscita_anticipata', causale: 'malattia' })).toBe('Malattia')
    expect(etichettaTipo({ tipo: 'uscita_anticipata', causale: 'accordo' })).toBe('Uscita prima')
  })

  it("conferma con un tocco salvo l'uscita d'accordo o senza motivo", () => {
    expect(confermaDiretta({ tipo: 'ritardo', causale: null })).toBe(true)
    expect(confermaDiretta({ tipo: 'uscita_anticipata', causale: 'personale' })).toBe(true)
    expect(confermaDiretta({ tipo: 'uscita_anticipata', causale: 'accordo' })).toBe(false)
    expect(confermaDiretta({ tipo: 'uscita_anticipata', causale: null })).toBe(false)
  })

  it('riepilogo: contano i confermati, con i minuti corretti da chi conferma', () => {
    const r = riepilogoMese([
      ev({ stato: 'confermato', esito: 'permesso', minuti_confermati: 15 }),
      ev({ id: 'b', stato: 'confermato', esito: 'permesso' }),
      ev({ id: 'c', tipo: 'uscita_anticipata', causale: 'personale', minuti_proposti: 90, stato: 'confermato', esito: 'permesso' }),
      ev({ id: 'd', tipo: 'uscita_anticipata', causale: 'accordo', minuti_proposti: 60, stato: 'confermato', esito: 'ore_non_lavorate' }),
      ev({ id: 'e', tipo: 'uscita_anticipata', causale: 'malattia', minuti_proposti: 290, stato: 'confermato', esito: 'malattia', ora: '2026-11-09T13:10:00Z' }),
      ev({ id: 'f', tipo: 'straordinario', causale: 'cliente', minuti_proposti: 30, stato: 'confermato', esito: 'straordinario' }),
      ev({ id: 'g', tipo: 'straordinario', causale: 'riassortimento', minuti_proposti: 45, stato: 'respinto', esito: 'respinto' }),
      ev({ id: 'h' }),
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ ritardi: 2, permessoRitardi: 45, permessoUscite: 90, oreNonLavorate: 60, straordinari: 30, daConfermare: 1 })
    expect(r[0].perCausale).toEqual({ cliente: 30 })
    expect(r[0].malattie).toEqual([{ data: '2026-11-09', ora: '2026-11-09T13:10:00Z' }])
  })
})
