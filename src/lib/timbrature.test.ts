import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  azioni, codiceQr, entrataMancante, impronta, oreEntrataDichiarabili, firma, leggiCodice, oraRomaInMs, passoDa, riepilogoGiorno, secondiAlCambio, statoDa,
} from './timbrature'

const SEGRETO = '00112233445566778899aabbccddeeff00112233'
const EMP = '3f2b8c1e-1d2a-4c5b-9e8f-0a1b2c3d4e5f'

describe('QR del dipendente', () => {
  it('firma come HMAC-SHA256 troncato a 16 caratteri (stessa formula della migration 348)', async () => {
    const atteso = createHmac('sha256', Buffer.from(SEGRETO, 'hex')).update(`${EMP}.123456`).digest('hex').slice(0, 16)
    expect(await firma(SEGRETO, EMP, 123456)).toBe(atteso)
  })

  it('il codice cambia ogni 30 secondi e si rilegge', async () => {
    const t0 = Date.UTC(2026, 10, 5, 9, 0, 0)
    const a = await codiceQr(SEGRETO, EMP, t0)
    const b = await codiceQr(SEGRETO, EMP, t0 + 29_000)
    const c = await codiceQr(SEGRETO, EMP, t0 + 30_000)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(leggiCodice(a)).toEqual({ employeeId: EMP, passo: passoDa(t0) })
    expect(secondiAlCambio(t0 + 10_000)).toBe(20)
  })

  it('scarta i codici che non sono nostri', () => {
    expect(leggiCodice('https://example.com')).toBeNull()
    expect(leggiCodice(`NZT1.${EMP}.12.zzzz`)).toBeNull()
    expect(leggiCodice(`XYZ.${EMP}.12.0011223344556677`)).toBeNull()
  })
})

describe('ora di Roma', () => {
  it('converte con ora solare e ora legale', () => {
    expect(new Date(oraRomaInMs('2026-11-05', '09:00')).toISOString()).toBe('2026-11-05T08:00:00.000Z')
    expect(new Date(oraRomaInMs('2026-07-05', '09:00')).toISOString()).toBe('2026-07-05T07:00:00.000Z')
  })
})

describe('azioni proposte', () => {
  const turno = { data: '2026-11-05', inizio: '09:00', fine: '18:00', pausa_minuti: 60 }
  const ore = (hhmm: string) => oraRomaInMs('2026-11-05', hhmm)
  const iso = (hhmm: string) => new Date(ore(hhmm)).toISOString()

  it('fuori: si entra', () => {
    expect(azioni([], turno, ore('08:55')).principale).toBe('entrata')
    expect(statoDa('uscita')).toBe('fuori')
  })
  it('dentro a meta giornata con pausa da fare: pausa, poi uscita', () => {
    const r = azioni([{ tipo: 'entrata', ora: iso('09:00') }], turno, ore('13:10'))
    expect(r).toEqual({ principale: 'inizio_pausa', altre: ['uscita'] })
  })
  it('in pausa: si rientra', () => {
    const r = azioni([{ tipo: 'entrata', ora: iso('09:00') }, { tipo: 'inizio_pausa', ora: iso('13:00') }], turno, ore('13:50'))
    expect(r.principale).toBe('fine_pausa')
  })
  it('vicino alla fine o pausa fatta: si esce', () => {
    const fatte = [
      { tipo: 'entrata' as const, ora: iso('09:00') },
      { tipo: 'inizio_pausa' as const, ora: iso('13:00') },
      { tipo: 'fine_pausa' as const, ora: iso('14:00') },
    ]
    expect(azioni(fatte, turno, ore('17:58'))).toEqual({ principale: 'uscita', altre: [] })
    expect(azioni([{ tipo: 'entrata', ora: iso('09:00') }], turno, ore('17:30')).principale).toBe('uscita')
  })
})

describe('riepilogo della giornata', () => {
  const turno = { data: '2026-11-05', inizio: '09:00', fine: '18:00', pausa_minuti: 60 }
  const ore = (hhmm: string) => oraRomaInMs('2026-11-05', hhmm)
  const iso = (hhmm: string) => new Date(ore(hhmm)).toISOString()
  const giornata = (uscita: string) => [
    { tipo: 'entrata' as const, ora: iso('09:05') },
    { tipo: 'inizio_pausa' as const, ora: iso('13:00') },
    { tipo: 'fine_pausa' as const, ora: iso('14:00') },
    { tipo: 'uscita' as const, ora: iso(uscita) },
  ]

  it('conta lavoro, pausa e ritardo', () => {
    const r = riepilogoGiorno(giornata('18:00'), turno, ore('20:00'))
    expect(r.esito).toBe('uscito')
    expect(r.minutiLavorati).toBe(8 * 60 - 5)
    expect(r.minutiPausa).toBe(60)
    expect(r.minutiRitardo).toBe(5)
    expect(r.straordinario).toBe(false)
  })

  it('uscita entro la tolleranza di 10 minuti: non e straordinario', () => {
    const r = riepilogoGiorno(giornata('18:08'), turno, ore('20:00'))
    expect(r.minutiOltreTurno).toBe(8)
    expect(r.straordinario).toBe(false)
  })

  it('uscita oltre il margine: straordinario da guardare', () => {
    const r = riepilogoGiorno(giornata('18:45'), turno, ore('20:00'))
    expect(r.minutiOltreTurno).toBe(45)
    expect(r.straordinario).toBe(true)
  })

  it('ancora dentro a fine turno + 10: uscita non timbrata', () => {
    const dentro = [{ tipo: 'entrata' as const, ora: iso('09:00') }]
    expect(riepilogoGiorno(dentro, turno, ore('18:09')).esito).toBe('in_negozio')
    expect(riepilogoGiorno(dentro, turno, ore('18:10')).esito).toBe('uscita_mancante')
  })

  it('margine diverso dal negozio', () => {
    const r = riepilogoGiorno(giornata('18:20'), turno, ore('20:00'), 30)
    expect(r.straordinario).toBe(false)
  })
})

import { oraRomaInMs as _ms, valutaEntrata, valutaUscita } from './timbrature'

describe('ritardi, uscite anticipate e straordinari', () => {
  const turno = { data: '2026-11-09', inizio: '10:00', fine: '19:00' }
  it('ritardo: entro la tolleranza si vede, oltre diventa permesso a blocchi di 15', () => {
    expect(valutaEntrata(turno, _ms('2026-11-09', '10:06'), 10)).toEqual({ minuti: 6, oltre: false, permesso: 0 })
    expect(valutaEntrata(turno, _ms('2026-11-09', '10:12'), 10)).toEqual({ minuti: 12, oltre: true, permesso: 15 })
    expect(valutaEntrata(turno, _ms('2026-11-09', '10:31'), 10)).toEqual({ minuti: 31, oltre: true, permesso: 45 })
    expect(valutaEntrata(turno, _ms('2026-11-09', '09:50'), 10).oltre).toBe(false)
  })
  it('uscita anticipata, normale o straordinario (si paga tutto, dalla fine del turno)', () => {
    expect(valutaUscita(turno, _ms('2026-11-09', '15:45'), 15, false)).toEqual({ tipo: 'anticipata', minuti: 195, proposti: 195 })
    expect(valutaUscita(turno, _ms('2026-11-09', '15:45'), 15, true).tipo).toBe('normale')
    expect(valutaUscita(turno, _ms('2026-11-09', '19:10'), 15, false).tipo).toBe('normale')
    expect(valutaUscita(turno, _ms('2026-11-09', '19:45'), 15, false)).toEqual({ tipo: 'straordinario', minuti: 45, proposti: 45 })
  })
})

describe('entrata dimenticata (migration 382)', () => {
  const turno = { data: '2026-11-05', inizio: '10:00:00', fine: '19:00:00' }
  it('manca solo oltre la tolleranza e senza timbrature', () => {
    expect(entrataMancante(turno, [], oraRomaInMs('2026-11-05', '10:09'), 10)).toBe(false)
    expect(entrataMancante(turno, [], oraRomaInMs('2026-11-05', '10:11'), 10)).toBe(true)
    expect(entrataMancante(turno, [{ tipo: 'uscita', ora: new Date(oraRomaInMs('2026-11-05', '10:05')).toISOString() }], oraRomaInMs('2026-11-05', '19:06'), 10)).toBe(false)
    expect(entrataMancante(null, [], oraRomaInMs('2026-11-05', '19:06'), 10)).toBe(false)
  })
  it("ore dichiarabili: dall'inizio del turno meno un'ora ad adesso, ogni 5 minuti", () => {
    const ore = oreEntrataDichiarabili(turno, oraRomaInMs('2026-11-05', '10:32'))
    expect(ore[0]).toBe('09:00')
    expect(ore).toContain('10:00')
    expect(ore.at(-1)).toBe('10:30')
  })
})

describe('impronta del segreto (migration 387)', () => {
  it('uguale allo SHA-256 del testo, primi 16 caratteri', async () => {
    const seg = '9f3c1a7e5b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a'
    const { createHash } = await import('node:crypto')
    expect(await impronta(seg)).toBe(createHash('sha256').update(seg, 'utf8').digest('hex').slice(0, 16))
  })
})
