import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { testoAvviso } from './avvisiTurni';
import { riassuntoAvvisi, type AvvisoTurno } from '../../supabase/functions/turni-notifiche/riassunto';

const t = (data: string, inizio: string, fine: string) => ({ data, inizio: `${inizio}:00`, fine: `${fine}:00` });
const av = (id: number, shift_id: string, tipo: AvvisoTurno['tipo'], prima: AvvisoTurno['prima'], dopo: AvvisoTurno['dopo']): AvvisoTurno =>
  ({ id, shift_id, tipo, prima, dopo, data: (dopo ?? prima)!.data });

describe('notifica sul telefono: un messaggio per persona', () => {
  it('un orario cambiato dice com\'era e com\'è', () => {
    expect(riassuntoAvvisi([av(1, 's1', 'cambiato', t('2026-12-26', '10:00', '19:00'), t('2026-12-26', '12:00', '20:00'))]))
      .toEqual({ titolo: 'Il tuo orario è cambiato', corpo: 'sab 26/12 ora 12:00-20:00 (era 10:00-19:00). Guarda l\'app.' });
  });
  it('la settimana pubblicata diventa un solo avviso', () => {
    const settimana = ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-26'].map((d, i) => av(i + 1, `s${i}`, 'pubblicato', null, t(d, '10:00', '18:00')));
    expect(riassuntoAvvisi(settimana)?.corpo).toBe('Sono pubblicati 4 turni, dal lun 21/12 al sab 26/12. Aprili nell\'app.');
  });
  it('pubblicato e poi tolto prima dell\'invio: niente da dire', () => {
    expect(riassuntoAvvisi([av(1, 's1', 'pubblicato', null, t('2026-12-26', '10:00', '19:00')), av(2, 's1', 'tolto', t('2026-12-26', '10:00', '19:00'), null)])).toBeNull();
  });
  it('cambiato due volte e tornato com\'era: niente da dire', () => {
    expect(riassuntoAvvisi([
      av(1, 's1', 'cambiato', t('2026-12-26', '10:00', '19:00'), t('2026-12-26', '12:00', '20:00')),
      av(2, 's1', 'cambiato', t('2026-12-26', '12:00', '20:00'), t('2026-12-26', '10:00', '19:00')),
    ])).toBeNull();
  });
  it('un turno tolto e uno nuovo', () => {
    expect(riassuntoAvvisi([av(1, 's1', 'tolto', t('2026-12-26', '10:00', '19:00'), null), av(2, 's2', 'pubblicato', null, t('2026-12-27', '11:00', '20:00'))]))
      .toEqual({ titolo: 'Il tuo orario è cambiato', corpo: 'sab 26/12 tolto (era 10:00-19:00); dom 27/12 nuovo turno 11:00-20:00. Guarda l\'app.' });
  });
});

describe('righe nella scheda Turni', () => {
  it('scrive nuovo, tolto, cambiato e spostato', () => {
    expect(testoAvviso({ tipo: 'pubblicato', data: '2026-12-27', prima: null, dopo: t('2026-12-27', '11:00', '20:00') })).toBe('dom 27/12: nuovo turno 11:00-20:00');
    expect(testoAvviso({ tipo: 'tolto', data: '2026-12-26', prima: t('2026-12-26', '10:00', '19:00'), dopo: null })).toBe('sab 26/12: turno tolto (era 10:00-19:00)');
    expect(testoAvviso({ tipo: 'cambiato', data: '2026-12-26', prima: t('2026-12-26', '10:00', '19:00'), dopo: t('2026-12-26', '12:00', '20:00') })).toBe('sab 26/12: ora 12:00-20:00 (era 10:00-19:00)');
    expect(testoAvviso({ tipo: 'cambiato', data: '2026-12-27', prima: t('2026-12-26', '10:00', '19:00'), dopo: t('2026-12-27', '10:00', '19:00') })).toBe('sab 26/12 10:00-19:00 spostato a dom 27/12 10:00-19:00');
  });
});

describe('novità da mostrare nell\'app', () => {
  const a = (id: number, shift_id: string, tipo: 'pubblicato' | 'cambiato' | 'tolto', prima: ReturnType<typeof t> | null, dopo: ReturnType<typeof t> | null, letto = false) =>
    ({ id, shift_id, tipo, prima, dopo, data: (dopo ?? prima)!.data, negozio: null, creato_il: '2026-11-25T10:00:00Z', letto });
  it('settimana ritirata e ripubblicata uguale: nessuna riga, ma «Ho visto» le segna lette', async () => {
    const { novitaDaMostrare } = await import('./avvisiTurni');
    const n = novitaDaMostrare([a(1, 's1', 'tolto', t('2026-12-26', '10:00', '19:00'), null), a(2, 's1', 'pubblicato', null, t('2026-12-26', '10:00', '19:00'))]);
    expect(n).toEqual([{ avviso: null, ids: [1, 2] }]);
  });
  it('cambiato due volte: solo l\'orario finale; i letti non contano', async () => {
    const { novitaDaMostrare, testoAvviso } = await import('./avvisiTurni');
    const n = novitaDaMostrare([
      a(1, 's1', 'cambiato', t('2026-12-26', '10:00', '19:00'), t('2026-12-26', '12:00', '20:00')),
      a(2, 's1', 'cambiato', t('2026-12-26', '12:00', '20:00'), t('2026-12-26', '13:00', '20:00')),
      a(3, 's2', 'pubblicato', null, t('2026-12-27', '11:00', '20:00'), true),
    ]);
    expect(n.map((x) => x.avviso && testoAvviso(x.avviso))).toEqual(['sab 26/12: ora 13:00-20:00 (era 10:00-19:00)']);
  });
});

describe('notifica: ritiro e ripubblicazione uguali non dicono niente, cambio di negozio sì', () => {
  it('tolto e ripubblicato uguale', () => {
    expect(riassuntoAvvisi([av(1, 's1', 'tolto', t('2026-12-26', '10:00', '19:00'), null), av(2, 's1', 'pubblicato', null, t('2026-12-26', '10:00', '19:00'))])).toBeNull();
  });
  it('stesso orario in un altro negozio', () => {
    const r = riassuntoAvvisi([{ ...av(1, 's1', 'cambiato', { ...t('2026-12-26', '10:00', '19:00'), outlet_id: 'a' }, { ...t('2026-12-26', '10:00', '19:00'), outlet_id: 'b' }), negozio: 'Valmontone' }]);
    expect(r?.corpo).toBe('sab 26/12 10:00-19:00 in un altro negozio (Valmontone). Guarda l\'app.');
  });
});
