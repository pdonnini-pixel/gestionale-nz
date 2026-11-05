import { describe, expect, it } from 'vitest'
import {
  PAROLE_INTERNE, STATO_RICHIESTA, aggiungiGiorni, eventoSenzaFerie, giornoBreve, giorniConTurni, giorniTra,
  lunediDi, minutiTurno, oreDaMinuti, oreDelPeriodo, saldiApp, ultimoDelMese,
} from './appDipendente'
import { dataRoma, oraRomaInMs } from './timbrature'

describe('date', () => {
  it('lunedi della settimana, anche a cavallo del mese', () => {
    expect(lunediDi('2026-11-05')).toBe('2026-11-02')
    expect(lunediDi('2026-11-02')).toBe('2026-11-02')
    expect(lunediDi('2026-11-01')).toBe('2026-10-26')
  })
  it('giorni, fine mese, aggiunte', () => {
    expect(giorniTra('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(ultimoDelMese('2026-02-10')).toBe('2026-02-28')
    expect(aggiungiGiorni('2026-03-28', 2)).toBe('2026-03-30')
    expect(giornoBreve('2026-11-05')).toBe('gio 5 nov')
  })
})

describe('ore', () => {
  it('in ore con i decimali, come il modulo', () => {
    expect(oreDaMinuti(450)).toBe('7,50 ore')
    expect(oreDaMinuti(60)).toBe('1 ora')
    expect(oreDaMinuti(0)).toBe('nessuna')
  })
  it('turno meno la pausa', () => {
    expect(minutiTurno('09:00', '18:00', 60)).toBe(480)
    expect(minutiTurno('09:00:00', '13:00:00', null)).toBe(240)
  })
})

describe('scheda Turni', () => {
  it('turno spezzato e ferie nello stesso periodo', () => {
    const g = giorniConTurni('2026-11-09', '2026-11-10',
      [{ data: '2026-11-09', inizio: '16:00', fine: '20:00', pausa_minuti: 0 }, { data: '2026-11-09', inizio: '09:00', fine: '13:00', pausa_minuti: 0 }],
      [{ data: '2026-11-10', tipo: 'giornata', ore: 8, stato: 'richiesto', voce: 'ferie' }])
    expect(g[0].turni.map((t) => t.inizio)).toEqual(['09:00', '16:00'])
    expect(g[0].minutiInTurno).toBe(480)
    expect(g[1].ferie).toHaveLength(1)
  })
})

describe('scheda Ore', () => {
  const iso = (d: string, h: string) => new Date(oraRomaInMs(d, h)).toISOString()
  it('somma per settimana e segna oltre il margine', () => {
    const s = oreDelPeriodo('2026-11-02', '2026-11-08',
      [
        { tipo: 'entrata', ora: iso('2026-11-02', '09:00') },
        { tipo: 'uscita', ora: iso('2026-11-02', '13:00') },
        { tipo: 'entrata', ora: iso('2026-11-03', '09:00') },
        { tipo: 'uscita', ora: iso('2026-11-03', '13:45') },
      ],
      [{ data: '2026-11-02', inizio: '09:00', fine: '13:00', pausa_minuti: 0 }, { data: '2026-11-03', inizio: '09:00', fine: '13:00', pausa_minuti: 0 }],
      [], (x) => dataRoma(Date.parse(x)), Date.parse('2026-11-09T12:00:00Z'), 30)
    expect(s).toHaveLength(1)
    expect(s[0].intera).toBe(true)
    expect(s[0].minutiLavorati).toBe(240 + 285)
    expect(s[0].giorni[1].straordinario).toBe(true)
    expect(s[0].giorni[0].straordinario).toBe(false)
  })
})

describe('scheda Ferie', () => {
  it('due righe: Ferie e Permessi (ex festivita + ROL)', () => {
    const r = saldiApp([
      { voce: 'F01', residuo_disponibile: 40, da_fruire_disponibile: 100, ore_in_attesa: 8, saldo_alla_data: '2026-09-30', ore_giornata_dedotte: 8 },
      { voce: 'F02', residuo_disponibile: 10, da_fruire_disponibile: 20, ore_in_attesa: 2, saldo_alla_data: '2026-09-30', ore_giornata_dedotte: null },
      { voce: 'F03', residuo_disponibile: 5, da_fruire_disponibile: 6, ore_in_attesa: 0, saldo_alla_data: '2026-09-30', ore_giornata_dedotte: null },
    ])
    expect(r.ferie).toEqual({ oggi: 40, conMaturazione: 100, inAttesa: 8 })
    expect(r.permessi).toEqual({ oggi: 15, conMaturazione: 26, inAttesa: 2 })
    expect(r.aggiornatoAl).toBe('2026-09-30')
    expect(saldiApp([]).ferie).toBeNull()
  })
  it('giorni senza ferie del negozio', () => {
    const p = [{ nome: 'Black Friday', dal: '2026-11-25', al: '2026-11-29' }]
    expect(eventoSenzaFerie('2026-11-27', p)).toBe('Black Friday')
    expect(eventoSenzaFerie('2026-12-01', p)).toBeNull()
  })
  it('le parole che legge il dipendente non sono interne', () => {
    for (const s of Object.values(STATO_RICHIESTA)) expect(s.testo).not.toMatch(PAROLE_INTERNE)
  })
})
