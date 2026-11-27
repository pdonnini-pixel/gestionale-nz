import { describe, it, expect } from 'vitest';
import { eLunediFisso, orariDelLunedi, scegliLunedi, chiHaChiuso, coperturaDelLunedi } from './lunediFisso';
import { REGOLE_DEFAULT, hhmm, type GiornoPiano, type PersonaTurni, type Turno } from './turni';
import { derogheSettimana } from './ottimizzaTurni';

// Le regole del 27/11/2026 (Patrizio): turno massimo 8 ore lavorate + 30' nei feriali; il lunedì due
// persone, una 10-18 e una 12-chiusura; chi apre il lunedì non ha chiuso la domenica prima.

const giorno = (data: string, extra: Partial<GiornoPiano> = {}): GiornoPiano => ({
  data, giorno: 1, chiuso: false, apre: 600, chiude: 1200, fabbisogno: new Array(20).fill(1), nota: null, speciale: false, ...extra,
});
const persona = (id: string, ore = 30, extra: Partial<PersonaTurni> = {}): PersonaTurni => ({ id, ore, nonDisponibile: new Set(), ...extra });
const R = { ...REGOLE_DEFAULT, pausaMinuti: 30, pausaLungaMinuti: 30 };

describe('il lunedì fisso', () => {
  it('vale per i lunedì normali, non per festivi, eventi, giorni caldi o speciali del calendario', () => {
    expect(eLunediFisso(giorno('2026-12-07'))).toBe(true);
    expect(eLunediFisso(giorno('2026-12-08'))).toBe(false); // martedì
    expect(eLunediFisso(giorno('2027-03-29'))).toBe(false); // lunedì dell'Angelo
    expect(eLunediFisso(giorno('2026-12-07', { evento: 'Natale' }))).toBe(false);
    expect(eLunediFisso(giorno('2026-12-07', { speciale: true }))).toBe(false);
    expect(eLunediFisso(giorno('2026-12-07', { caldo: true }))).toBe(false);
    expect(eLunediFisso(giorno('2026-12-07', { chiuso: true }))).toBe(false);
    expect(eLunediFisso(giorno('2026-12-07', { chiusura: { dalle: 780, alle: 930 } }))).toBe(false);
  });

  it('negozio 10-20: 10-18 e 12-20; con le pulizie dalle 9 chi apre fa 9-17:30', () => {
    const o = orariDelLunedi(giorno('2026-12-07'), R);
    expect(o.apre.map(hhmm)).toEqual(['10:00', '18:00']);
    expect(o.chiude.map(hhmm)).toEqual(['12:00', '20:00']);
    const p = orariDelLunedi(giorno('2026-12-07', { apre: 540, apreVendita: 600, fabbisogno: new Array(22).fill(1) }), R);
    expect(p.apre.map(hhmm)).toEqual(['09:00', '17:30']);
    expect(p.chiude.map(hhmm)).toEqual(['12:00', '20:00']);
  });

  it('il fabbisogno del lunedì: una persona, due dalle 12 alle 18, una', () => {
    expect(coperturaDelLunedi(giorno('2026-12-07'), R)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1]);
  });

  it('chi ha chiuso la domenica non apre il lunedì', () => {
    const domenica: Turno[] = [
      { employeeId: 'anna', data: '2026-12-06', inizio: '12:00', fine: '20:00', pausaMinuti: 30 },
      { employeeId: 'bea', data: '2026-12-06', inizio: '10:00', fine: '16:00', pausaMinuti: 0 },
    ];
    const chiuso = chiHaChiuso(domenica, '2026-12-06');
    expect([...chiuso]).toEqual(['anna']);
    const t = scegliLunedi({ g: giorno('2026-12-07'), persone: [persona('anna', 40), persona('bea')], regole: R, chiusoDomenica: chiuso })!;
    expect(t.map((x) => [x.employeeId, x.inizio, x.fine])).toEqual([['bea', '10:00', '18:00'], ['anna', '12:00', '20:00']]);
  });

  it('chiavi, responsabile o vice, ore e accordi', () => {
    const g = giorno('2026-12-07');
    // solo carla può aprire: apre carla
    const conChiavi = scegliLunedi({ g, persone: [persona('anna'), persona('carla')], regole: R, chiavi: { apre: new Set(['carla']), chiude: new Set(['anna', 'carla']) } })!;
    expect(conChiavi[0].employeeId).toBe('carla');
    // con responsabile e vice, almeno una delle due lavora; possono anche essere tutte e due
    const guidate = scegliLunedi({ g, persone: [persona('carla', 40), persona('dora', 40), persona('anna', 10), persona('bea', 10)], regole: R, guida: { responsabile: 'anna', vice: 'bea' } })!;
    expect(guidate.some((x) => x.employeeId === 'anna' || x.employeeId === 'bea')).toBe(true);
    // chi non ha più ore nella settimana o non è disponibile non è scelta
    expect(scegliLunedi({ g, persone: [persona('anna', 4), persona('bea')], regole: R })).toBeNull();
    expect(scegliLunedi({ g, persone: [persona('anna', 30, { nonDisponibile: new Set(['2026-12-07']) }), persona('bea')], regole: R })).toBeNull();
  });

  it('evita la coppia del lunedì prima', () => {
    const t = scegliLunedi({ g: giorno('2026-12-07'), persone: [persona('anna'), persona('bea'), persona('carla')], regole: R, lunediPrima: ['anna|bea'] })!;
    expect(t.map((x) => x.employeeId).sort()).not.toEqual(['anna', 'bea']);
  });

  it('le deroghe: lunedì cambiato a mano, turno oltre le 8 ore in un feriale (non la domenica fino a 10)', () => {
    const lun = giorno('2026-12-07');
    const mar = giorno('2026-12-09', { giorno: 3 }); // mercoledì (l'8 è festivo)
    const dom = giorno('2026-12-13', { giorno: 7 });
    const persone = ['anna', 'bea'].map((id) => ({ ...persona(id, 40), nome: id }));
    const t = (employeeId: string, data: string, inizio: string, fine: string, pausaMinuti = 30): Turno => ({ employeeId, data, inizio, fine, pausaMinuti });
    const giusto = derogheSettimana({ giorni: [lun], persone, regole: R, turni: [t('anna', lun.data, '10:00', '18:00'), t('bea', lun.data, '12:00', '20:00')] });
    expect(giusto.map((d) => d.regola)).not.toContain('lunedi_fisso');
    const cambiato = derogheSettimana({ giorni: [lun], persone, regole: R, turni: [t('anna', lun.data, '10:00', '19:00'), t('bea', lun.data, '12:00', '20:00')] });
    expect(cambiato.map((d) => d.regola)).toContain('lunedi_fisso');
    const lungo = derogheSettimana({ giorni: [mar], persone, regole: R, turni: [t('anna', mar.data, '10:00', '19:30'), t('bea', mar.data, '11:00', '20:00')] });
    expect(lungo.filter((d) => d.regola === 'turno_lungo').map((d) => d.employeeId).sort()).toEqual(['anna', 'bea']);
    const domenica = derogheSettimana({ giorni: [dom], persone, regole: R, turni: [t('anna', dom.data, '10:00', '19:30'), t('bea', dom.data, '11:00', '20:00')] });
    expect(domenica.map((d) => d.regola)).not.toContain('turno_lungo');
  });
});
