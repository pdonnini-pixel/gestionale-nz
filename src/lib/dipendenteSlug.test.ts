import { describe, it, expect } from 'vitest'
import { slugDipendente, segmentoDipendente, trovaDipendente, risolviDipendente, sezioneDa, percorsoDipendente } from './dipendenteSlug'

const ID1 = '11111111-1111-1111-1111-111111111111'
const ID2 = '22222222-2222-2222-2222-222222222222'
const ID3 = '33333333-3333-3333-3333-333333333333'
const tutti = [
  { id: ID1, nome: 'Giulia', cognome: 'Rinaldi' },
  { id: ID2, nome: 'Anna', cognome: 'Bianchi' },
  { id: ID3, nome: 'Anna', cognome: 'Bianchi' },
]

describe('indirizzo della scheda dipendente', () => {
  it('nome e cognome diventano uno slug senza accenti', () => {
    expect(slugDipendente({ id: 'x', nome: 'Niccolò', cognome: "D'Angelo" })).toBe('niccolo-d-angelo')
    expect(slugDipendente({ id: 'x', first_name: 'Sara', last_name: 'Galli' })).toBe('sara-galli')
  })

  it('omonimi e nomi vuoti tengono l\'id', () => {
    expect(segmentoDipendente(tutti[0], tutti)).toBe('giulia-rinaldi')
    expect(segmentoDipendente(tutti[1], tutti)).toBe(ID2)
    expect(segmentoDipendente({ id: ID1, nome: '', cognome: '' }, [])).toBe(ID1)
    // un nome uguale a una sezione non si confonde con la sezione
    expect(segmentoDipendente({ id: ID1, nome: 'Turni', cognome: '' }, [])).toBe(ID1)
  })

  it('si trova per id, per slug e per cognome-nome; l\'omonimo solo per id', () => {
    expect(trovaDipendente(ID1, tutti)?.id).toBe(ID1)
    expect(trovaDipendente('giulia-rinaldi', tutti)?.id).toBe(ID1)
    expect(trovaDipendente('rinaldi-giulia', tutti)?.id).toBe(ID1)
    expect(trovaDipendente('anna-bianchi', tutti)).toBeNull()
    expect(trovaDipendente(ID3, tutti)?.id).toBe(ID3)
    expect(trovaDipendente(undefined, tutti)).toBeNull()
  })

  it('la sezione sta nell\'indirizzo, la prima senza suffisso', () => {
    expect(sezioneDa('turni')).toBe('turni')
    expect(sezioneDa(undefined)).toBe('contratto')
    expect(sezioneDa('boh')).toBe('contratto')
    expect(percorsoDipendente('giulia-rinaldi')).toBe('/dipendenti/giulia-rinaldi')
    expect(percorsoDipendente('giulia-rinaldi', 'netti')).toBe('/dipendenti/giulia-rinaldi/netti')
  })
})

describe('risoluzione della persona dall\'indirizzo (revisore, 16/11/2026)', () => {
  it('dopo aver corretto il cognome lo slug vecchio porta ancora alla stessa persona', () => {
    const dopo = [{ id: ID1, nome: 'Giulia', cognome: 'Rinaldini' }, ...tutti.slice(1)]
    expect(trovaDipendente('giulia-rinaldi', dopo)).toBeNull()
    const r = risolviDipendente('giulia-rinaldi', dopo, ID1)
    expect(r.persona?.id).toBe(ID1)
    expect(segmentoDipendente(r.persona!, dopo)).toBe('giulia-rinaldini')
  })

  it('senza una persona aperta prima lo slug sconosciuto non trova nessuno', () => {
    expect(risolviDipendente('nessuno-nessuno', tutti, null)).toEqual({ persona: null, omonimi: [] })
    expect(risolviDipendente('nessuno-nessuno', tutti, 'id-che-non-esiste').persona).toBeNull()
  })

  it('uno slug condiviso da due persone restituisce l\'elenco degli omonimi', () => {
    const r = risolviDipendente('anna-bianchi', tutti, null)
    expect(r.persona).toBeNull()
    expect(r.omonimi.map((p) => p.id).sort()).toEqual([ID2, ID3])
  })

  it('l\'id esatto vince sempre', () => {
    expect(risolviDipendente(ID3, tutti, ID1).persona?.id).toBe(ID3)
  })
})
