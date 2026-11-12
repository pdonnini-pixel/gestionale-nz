import { describe, it, expect } from 'vitest';
import { turniCheValgono, type PianoDelMese } from './turniFuoriMese';

const N = 'negozio';
const t = (data: string, plan_id: string | null, outlet_id = N) => ({ data, plan_id, outlet_id, chi: `${data}/${plan_id ?? 'senza'}` });
const piano = (id: string, stato: string, created_at: string, altro: Partial<PianoDelMese> = {}): PianoDelMese =>
  ({ id, outlet_id: N, mese: '2026-11-01', stato, created_at, simulazione: false, ...altro });

describe('turni dei giorni dell\'altro mese che contano', () => {
  it('con un piano scelto valgono solo i suoi turni: quelli settimanali del mese non si vedono più', () => {
    const righe = [t('2026-11-30', 'A'), t('2026-11-30', null), t('2026-11-30', 'B')];
    const out = turniCheValgono(righe, [piano('A', 'scelto', '2026-11-12T19:17'), piano('B', 'bozza', '2026-11-12T19:30')]);
    expect(out.map((x) => x.chi)).toEqual(['2026-11-30/A']);
  });

  it('senza piano scelto valgono i turni senza piano, non le bozze dei piani', () => {
    const righe = [t('2026-11-30', 'A'), t('2026-11-30', null)];
    expect(turniCheValgono(righe, [piano('A', 'bozza', '2026-11-12T19:17')]).map((x) => x.chi)).toEqual(['2026-11-30/senza']);
  });

  it('senza piano scelto e senza turni settimanali vale il piano vero più recente, anche in bozza (Roma Soratte, 12/11/2026)', () => {
    const righe = [t('2026-11-30', 'A'), t('2026-11-30', 'B')];
    const out = turniCheValgono(righe, [piano('A', 'bozza', '2026-11-12T19:00'), piano('B', 'bozza', '2026-11-12T19:17')]);
    expect(out.map((x) => x.chi)).toEqual(['2026-11-30/B']);
  });

  it('le simulazioni non contano mai', () => {
    const righe = [t('2026-11-30', 'S'), t('2026-11-30', 'A')];
    const out = turniCheValgono(righe, [piano('S', 'bozza', '2026-11-12T20:00', { simulazione: true }), piano('A', 'bozza', '2026-11-12T19:00')]);
    expect(out.map((x) => x.chi)).toEqual(['2026-11-30/A']);
  });

  it('ogni negozio e ogni mese per conto suo', () => {
    const righe = [t('2026-11-30', 'A'), t('2026-11-30', null, 'altro'), t('2026-12-01', null), t('2026-12-01', 'D')];
    const out = turniCheValgono(righe, [piano('A', 'scelto', '2026-11-12T19:17'), piano('D', 'bozza', '2026-11-12T19:18', { mese: '2026-12-01' })]);
    expect(out.map((x) => x.chi)).toEqual(['2026-11-30/A', '2026-11-30/senza', '2026-12-01/senza']);
  });

  it('un turno con un piano che non si conosce (di un altro negozio non letto) non conta', () => {
    expect(turniCheValgono([t('2026-11-30', 'X')], [])).toEqual([]);
  });
});
