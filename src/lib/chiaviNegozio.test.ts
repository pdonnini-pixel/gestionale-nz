import { describe, it, expect } from 'vitest';
import { chiaviDelNegozio, type Abilitazione } from './regoleNuoveDb';
import { contaChiavi } from './pianoMensile';
import type { ContoChiavi } from './ottimizzaTurni';
import type { GiornoPiano, Turno } from './turni';

// Chi puo' aprire e chi puo' chiudere (Patrizio, 16/11/2026): un'abilitazione, non un obbligo.
const ab = (apre: boolean | null, chiude: boolean | null): Abilitazione => ({ apre, chiude });

describe('chiaviDelNegozio: quando la regola e\' accesa in un negozio', () => {
  it('spenta dove le colonne mancano (Made) o senza persone', () => {
    expect(chiaviDelNegozio(['a', 'b'], null)).toBeUndefined();
    expect(chiaviDelNegozio([], new Map())).toBeUndefined();
  });

  it('spenta finche\' una persona e\' ancora «da indicare»', () => {
    const m = new Map([['a', ab(true, true)], ['b', ab(true, true)], ['c', ab(null, false)]]);
    expect(chiaviDelNegozio(['a', 'b', 'c'], m)).toBeUndefined();
  });

  it('accesa con almeno due abilitate per parte; la nuova non e\' abilitata', () => {
    const m = new Map([['a', ab(true, true)], ['b', ab(true, false)], ['c', ab(false, true)], ['d', ab(false, false)]]);
    const ch = chiaviDelNegozio(['a', 'b', 'c', 'd', 'nuova-1'], m)!;
    expect([...ch.apre].sort()).toEqual(['a', 'b']);
    expect([...ch.chiude].sort()).toEqual(['a', 'c']);
  });

  it('spenta se una persona non si vede (accesso limitato ai negozi)', () => {
    const m = new Map([['a', ab(true, true)], ['b', ab(true, true)]]);
    expect(chiaviDelNegozio(['a', 'b', 'x'], m)).toBeUndefined();
  });

  it('spenta con una sola abilitata: non puo\' aprire o chiudere tutti i giorni', () => {
    const m = new Map([['a', ab(true, true)], ['b', ab(false, false)]]);
    expect(chiaviDelNegozio(['a', 'b'], m)).toBeUndefined();
  });

  it('responsabile e vice sono sempre abilitate, anche se le loro spunte sono vuote', () => {
    const m = new Map([['r', ab(null, null)], ['v', ab(false, false)], ['c', ab(false, false)]]);
    const ch = chiaviDelNegozio(['r', 'v', 'c'], m, ['r', 'v'])!;
    expect([...ch.apre].sort()).toEqual(['r', 'v']);
    expect([...ch.chiude].sort()).toEqual(['r', 'v']);
  });
});

describe('contaChiavi: aperture, chiusure e giorni del mese', () => {
  it('conta chi copre la prima e l\'ultima mezz\'ora e i giorni lavorati, solo per le abilitate', () => {
    const g = { data: '2026-11-16', chiuso: false, apre: 600, chiude: 1200 } as GiornoPiano;
    const t = (employeeId: string, inizio: string, fine: string): Turno => ({ employeeId, data: g.data, inizio, fine, pausaMinuti: 0 });
    const conti = new Map<string, ContoChiavi>();
    contaChiavi(conti, [g], [t('a', '10:00', '15:00'), t('b', '14:00', '20:00'), t('d', '10:00', '20:00')], { apre: new Set(['a', 'b']), chiude: new Set(['a', 'b']) });
    expect(conti.get('a')).toEqual({ apre: 1, chiude: 0, giorni: 1 });
    expect(conti.get('b')).toEqual({ apre: 0, chiude: 1, giorni: 1 });
    expect(conti.has('d')).toBe(false);
  });
});
