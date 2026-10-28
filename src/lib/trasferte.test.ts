import { describe, it, expect } from 'vitest';
import { copertureVerso, orePerData, riepilogaTrasferte, type Trasferta } from './trasferte';

const t = (x: Partial<Trasferta>): Trasferta => ({
  id: 'x', employeeId: 'a', outletId: 'brb', data: '2026-11-04', inizio: '10:00', fine: '19:00', pausaMinuti: 60,
  destinazioneOutletId: null, luogo: 'Sede', copreDestinazione: false, motivo: null, creataDa: null, ...x,
});

describe('trasferte', () => {
  const lista = [
    t({ id: '1' }),
    t({ id: '2', data: '2026-11-05', destinazioneOutletId: 'val', luogo: null, copreDestinazione: true }),
    t({ id: '3', employeeId: 'b', data: '2026-11-05', inizio: '14:00', fine: '18:00', pausaMinuti: 0 }),
  ];
  const nome = (id: string) => (id === 'val' ? 'Valmontone' : id);
  it('ore di lavoro per data, pausa esclusa', () => {
    expect(orePerData(lista, 'a')).toEqual(new Map([['2026-11-04', 8], ['2026-11-05', 8]]));
  });
  it('coprono un negozio solo se segnate cosi\'', () => {
    expect(copertureVerso(lista, 'val')).toEqual([{ employeeId: 'a', data: '2026-11-05', inizio: '10:00', fine: '19:00', pausaMinuti: 60 }]);
    expect(copertureVerso(lista, 'brb')).toEqual([]);
  });
  it('riepilogo per persona e per destinazione', () => {
    const r = riepilogaTrasferte(lista, nome);
    expect(r.ore).toBe(20);
    expect(r.giornate).toBe(3);
    expect(r.persone.find((p) => p.employeeId === 'a')).toEqual({ employeeId: 'a', giornate: 2, ore: 16, destinazioni: ['Sede', 'Valmontone'] });
    expect(r.destinazioni[0]).toEqual({ dove: 'Sede', giornate: 2, ore: 12 });
  });
});
