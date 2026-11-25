import { describe, expect, it } from 'vitest'
import {
  foglioStudio, giorniDelMese, inizioCaricamento, nomeFileStudio, oreMinuti, presenzeDelMese, rigaAssenzaLunga, turniUfficiali,
  type DatiStudio, type PersonaStudio, type TurnoStudio,
} from './presenzeStudio'

// Novembre 2026: 1 = domenica (Ognissanti), 2 = lunedì.
const MESE = '2026-11'
const persona = (x: Partial<PersonaStudio> = {}): PersonaStudio => ({
  id: 'p1', matricola: '0000003', cognome: 'ROSSI', nome: 'ANNA', assunzione: '2024-06-10', cessazione: null,
  oreSettimanali: 40, contratto: 'indeterminato', outletId: 'o1', ...x,
})
const turno = (data: string, inizio: string, fine: string, x: Partial<TurnoStudio> = {}): TurnoStudio =>
  ({ employee_id: 'p1', data, inizio, fine, pausa_minuti: 0, ore_straordinario: null, ...x })
const dati = (x: Partial<DatiStudio> = {}): DatiStudio => ({
  mese: MESE, persone: [persona()], turni: [], assenze: [], assenzeLunghe: [], eventi: [], patroni: new Map(), ...x,
})
const riga = (d: DatiStudio, codice: Parameters<ReturnType<typeof presenzeDelMese>['persone'][number]['righe']['get']>[0], i = 0) =>
  presenzeDelMese(d).persone[i].righe.get(codice)!
const g = (giorno: number) => giorno - 1

describe('calendario', () => {
  it('giorni del mese e lunedì da cui caricare', () => {
    expect(giorniDelMese(MESE)).toHaveLength(30)
    expect(inizioCaricamento(MESE)).toBe('2026-10-26')
    expect(inizioCaricamento('2026-06')).toBe('2026-06-01')
  })
  it('ore,minuti come lo studio: la mezz\'ora è 0,30', () => {
    expect(oreMinuti(7.5)).toBe(7.3)
    expect(oreMinuti(8)).toBe(8)
    expect(oreMinuti(0.25)).toBe(0.15)
  })
  it('nome del file come quello dello studio', () => {
    expect(nomeFileStudio('071041', MESE)).toBe('RILXLS_071041_11-2026.xls')
  })
})

describe('regole dello studio', () => {
  it('feriale lavorato nelle ordinarie, riposo vuoto, pausa tolta', () => {
    const d = dati({ turni: [turno('2026-11-04', '10:00', '18:30', { pausa_minuti: 30 })] })
    const ord = riga(d, 'ORD')
    expect(ord[g(4)]).toBe(8)
    expect(ord[g(5)]).toBeNull()
  })

  it('domenica lavorata: stesse ore in LDM e nelle ordinarie', () => {
    const d = dati({ turni: [turno('2026-11-08', '10:00', '18:00')] })
    expect(riga(d, 'ORD')[g(8)]).toBe(8)
    expect(riga(d, 'LDM')[g(8)]).toBe(8)
  })

  it('festivo: F nelle ordinarie; se lavorava, le ore in LFS e LDM vuota anche di domenica', () => {
    const d = dati({ turni: [turno('2026-11-01', '10:00', '18:00')] })
    expect(riga(d, 'ORD')[g(1)]).toBe('F')
    expect(riga(d, 'LFS')[g(1)]).toBe(8)
    expect(riga(d, 'LDM')[g(1)]).toBeNull()
  })

  it('festivo di riposo: solo F', () => {
    const d = dati()
    expect(riga(d, 'ORD')[g(1)]).toBe('F')
    expect(riga(d, 'LFS')[g(1)]).toBeNull()
  })

  it('patrono del negozio: festivo come gli altri', () => {
    const d = dati({ patroni: new Map([['o1', '11-11']]), turni: [turno('2026-11-11', '10:00', '18:00')] })
    expect(riga(d, 'ORD')[g(11)]).toBe('F')
    expect(riga(d, 'LFS')[g(11)]).toBe(8)
  })

  it('ferie a giornata: ore nella causale, ordinarie vuote, 0 nei riposi dentro il periodo', () => {
    const assenze = ['2026-11-13', '2026-11-16'].map((data) => ({ employee_id: 'p1', data, voce: 'F01', tipo: 'giornata', ore: 6.67 }))
    const d = dati({ assenze, turni: [turno('2026-11-12', '10:00', '18:00'), turno('2026-11-17', '10:00', '18:00')] })
    const fe = riga(d, 'FE')
    expect(fe[g(13)]).toBe(6.67)
    expect(fe[g(14)]).toBe(0)
    expect(fe[g(15)]).toBe(0)
    expect(fe[g(16)]).toBe(6.67)
    expect(fe[g(12)]).toBeNull()
    expect(riga(d, 'ORD')[g(13)]).toBeNull()
  })

  it('permesso a ore: in PF o RL, tolto dalle ordinarie', () => {
    const assenze = [{ employee_id: 'p1', data: '2026-11-04', voce: 'F03', tipo: 'ore', ore: 0.25 }]
    const d = dati({ assenze, turni: [turno('2026-11-04', '10:00', '18:00')] })
    expect(riga(d, 'RL')[g(4)]).toBe(0.25)
    expect(riga(d, 'ORD')[g(4)]).toBe(7.75)
  })

  it('maternità: ore teoriche dal lunedì al venerdì, 0 nel weekend, F e 0 nel festivo', () => {
    const d = dati({ assenzeLunghe: [{ employee_id: 'p1', motivo: 'maternità', dal: '2026-09-02', al: null }] })
    const mt = riga(d, 'MT')
    expect(mt[g(1)]).toBe(0)
    expect(riga(d, 'ORD')[g(1)]).toBe('F')
    expect(mt[g(2)]).toBe(8)
    expect(mt[g(7)]).toBe(0)
  })

  it('assunta il 3/11: AH con le ore teoriche prima dell\'assunzione', () => {
    const d = dati({ persone: [persona({ assunzione: '2026-11-03', oreSettimanali: 25 })] })
    const ah = riga(d, 'AH')
    expect(ah[g(1)]).toBe(0)
    expect(ah[g(2)]).toBe(5)
    expect(ah[g(3)]).toBeNull()
    expect(riga(d, 'ORD')[g(1)]).toBe('F')
  })

  it('cessata il 9/11: AH dal giorno dopo', () => {
    const d = dati({ persone: [persona({ assunzione: '2026-11-03', cessazione: '2026-11-09', oreSettimanali: 35 })] })
    const ah = riga(d, 'AH')
    expect(ah[g(9)]).toBeNull()
    expect(ah[g(10)]).toBe(7)
    expect(ah[g(14)]).toBe(0)
  })

  it('a chiamata: 1 in LC nei giorni non lavorati, ore nelle ordinarie quando lavora, nessuna F', () => {
    const d = dati({ persone: [persona({ contratto: 'a_chiamata' })], turni: [turno('2026-11-05', '10:00', '14:00')] })
    expect(riga(d, 'LC')[g(4)]).toBe(1)
    expect(riga(d, 'LC')[g(5)]).toBeNull()
    expect(riga(d, 'ORD')[g(5)]).toBe(4)
    expect(riga(d, 'ORD')[g(1)]).toBeNull()
    expect(riga(d, 'LC')[g(1)]).toBe(1)
  })

  it('a chiamata cessata: AH = 1 dopo la cessazione', () => {
    const d = dati({ persone: [persona({ contratto: 'a_chiamata', assunzione: '2026-10-28', cessazione: '2026-11-01' })] })
    expect(riga(d, 'LC')[g(1)]).toBe(1)
    expect(riga(d, 'AH')[g(2)]).toBe(1)
  })

  it('full time: lo straordinario è sempre ST', () => {
    const d = dati({ turni: [turno('2026-11-04', '10:00', '19:00', { ore_straordinario: 1 })] })
    expect(riga(d, 'ORD')[g(4)]).toBe(8)
    expect(riga(d, 'ST')[g(4)]).toBe(1)
    expect(riga(d, 'LS')[g(4)]).toBeNull()
  })

  it('part time: LS fino alle 40 ore della settimana, oltre ST', () => {
    // 30 ore: lun-ven 7 ore = 35, venerdì 8 ore di straordinario confermato -> 5 LS, 3 ST
    const turni = ['02', '03', '04', '05', '06'].map((x) => turno(`2026-11-${x}`, '10:00', '17:00'))
    const eventi = [{ employee_id: 'p1', data: '2026-11-06', tipo: 'straordinario', esito: 'straordinario', minuti: 480 }]
    const d = dati({ persone: [persona({ oreSettimanali: 30 })], turni, eventi })
    expect(riga(d, 'LS')[g(6)]).toBe(5)
    expect(riga(d, 'ST')[g(6)]).toBe(3)
  })

  it('le 40 ore contano anche i giorni di fine ottobre della prima settimana', () => {
    const turni = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map((x) => turno(x, '10:00', '18:00'))
    turni.push(turno('2026-10-31', '10:00', '18:00', { ore_straordinario: 2 }))
    const d = dati({ persone: [persona({ oreSettimanali: 30 })], turni })
    // nessun giorno di novembre: niente straordinario nel file
    expect(riga(d, 'ST').every((v) => v === null)).toBe(true)
  })

  it('uscita senza permesso tolta dalle ordinarie; malattia anche in MA', () => {
    const eventi = [
      { employee_id: 'p1', data: '2026-11-04', tipo: 'uscita_anticipata', esito: 'ore_non_lavorate', minuti: 60 },
      { employee_id: 'p1', data: '2026-11-05', tipo: 'uscita_anticipata', esito: 'malattia', minuti: 120 },
      { employee_id: 'p1', data: '2026-11-06', tipo: 'straordinario', esito: 'respinto', minuti: 30 },
    ]
    const d = dati({ eventi, turni: ['04', '05', '06'].map((x) => turno(`2026-11-${x}`, '10:00', '18:00')) })
    expect(riga(d, 'ORD')[g(4)]).toBe(7)
    expect(riga(d, 'ORD')[g(5)]).toBe(6)
    expect(riga(d, 'MA')[g(5)]).toBe(2)
    expect(riga(d, 'ST')[g(6)]).toBeNull()
  })

  it('aspettativa: nessuna riga nel modello, va segnalata', () => {
    const d = dati({ assenzeLunghe: [{ employee_id: 'p1', motivo: 'aspettativa', dal: '2026-07-13', al: '2026-12-15' }] })
    const e = presenzeDelMese(d)
    expect(e.avvisi.join(' ')).toContain('aspettativa')
    expect(rigaAssenzaLunga('Malattia lunga')).toBe('MA')
  })
})

describe('foglio', () => {
  it('testata e blocco come il modello: AH dopo le ordinarie, LDM solo se c\'è, riga vuota fra le persone', () => {
    const d = dati({
      persone: [persona({ assunzione: '2026-11-03', oreSettimanali: 25 }), persona({ id: 'p2', matricola: '0000068', cognome: 'BIANCHI' })],
      turni: [turno('2026-11-08', '10:00', '17:30')],
    })
    const f = foglioStudio(presenzeDelMese(d), MESE, { codice: '071041', ragioneSociale: 'NEW ZAGO SRL' })
    expect(f[0].slice(0, 3)).toEqual(['Azienda', '071041', 'NEW ZAGO SRL'])
    expect(f[0][6]).toBe('Novembre 2026')
    expect(f[1].slice(3, 7)).toEqual(['Assunzione', 'Cessazione', 'Ore/Minuti', 1])
    expect(f[2][6]).toBe('Do')
    expect(f[3].slice(0, 6)).toEqual(['Dipendente', '0000003', 'ROSSI ANNA', '03/11/2026', '', 'Ore ordinarie'])
    expect(f[4][5]).toBe('Assenza assunti/dimessi (AH)')
    expect(f[5][5]).toBe('Lavoro domenicale (LDM)')
    expect(f[5][6 + 7]).toBe(7.3)
    expect(f[6][5]).toBe('Ferie (FE)')
    const fine1 = f.findIndex((r, i) => i > 3 && r[5] === 'Straordinario diurno (ST)')
    expect(f[fine1 + 1].every((v) => v === null)).toBe(true)
    expect(f[fine1 + 2][1]).toBe('0000068')
    expect(f[f.length - 1][5]).toBe('Straordinario diurno (ST)')
    // il secondo non lavora la domenica: 13 righe come 0000068 nel modello, senza LDM
    expect(f.length - (fine1 + 2)).toBe(13)
  })
})

describe('turni ufficiali', () => {
  it('piano scelto: solo i pubblicati del piano; senza piano: pubblicati o a mano', () => {
    const t = [
      { employee_id: 'a', outlet_id: 'o1', data: '2026-11-04', stato: 'pubblicato', origine: 'piano', plan_id: 'P' },
      { employee_id: 'b', outlet_id: 'o1', data: '2026-11-04', stato: 'bozza', origine: 'piano', plan_id: 'P' },
      { employee_id: 'c', outlet_id: 'o1', data: '2026-11-04', stato: 'pubblicato', origine: 'manuale', plan_id: null },
      { employee_id: 'd', outlet_id: 'o2', data: '2026-11-04', stato: 'bozza', origine: 'manuale', plan_id: null },
      { employee_id: 'e', outlet_id: 'o2', data: '2026-11-04', stato: 'bozza', origine: 'proposta', plan_id: null },
      { employee_id: 'f', outlet_id: 'o2', data: '2026-11-04', stato: 'annullato', origine: 'manuale', plan_id: null },
    ]
    const v = turniUfficiali(t, [{ id: 'P', outlet_id: 'o1', mese: '2026-11-01' }]).map((x) => x.employee_id)
    expect(v).toEqual(['a', 'd'])
  })
})
