import { describe, it, expect } from 'vitest';
import { avvisiPerChiRiceve, avvisiPerIlGiorno, dopoLaMossa, mossePossibili } from './spostaTurni';

const t = (id: string, employee_id: string, data: string, inizio: string, fine: string) => ({ id, employee_id, data, inizio, fine });

describe('spostare i turni dal calendario', () => {
  it('le mosse dipendono da cosa c\'e\' sulla casella di arrivo', () => {
    expect(mossePossibili(false, false)).toEqual(['sposta', 'affianca']);
    expect(mossePossibili(true, false)).toEqual(['scambia', 'sostituisci']);
    expect(mossePossibili(false, true)).toEqual(['sposta']);
    expect(mossePossibili(true, true)).toEqual([]);
  });

  it('dopo la mossa: sposta, affianca, scambia, sostituisci', () => {
    const lista = [t('a', 'claudia', '2026-11-05', '10:00', '14:00'), t('b', 'susanna', '2026-11-05', '14:00', '20:00')];
    expect(dopoLaMossa(lista, 'sposta', lista[0], 'elisa', '2026-11-05').map((x) => x.employee_id)).toEqual(['elisa', 'susanna']);
    expect(dopoLaMossa(lista, 'affianca', lista[0], 'elisa', '2026-11-05')).toHaveLength(3);
    const sc = dopoLaMossa(lista, 'scambia', lista[0], 'susanna', '2026-11-05');
    expect(sc.find((x) => x.id === 'a')!.employee_id).toBe('susanna');
    expect(sc.find((x) => x.id === 'b')!.employee_id).toBe('claudia');
    const so = dopoLaMossa(lista, 'sostituisci', lista[0], 'susanna', '2026-11-05');
    expect(so).toEqual([{ ...lista[0], employee_id: 'susanna' }]);
  });

  it('avvisa se il giorno resta con una persona sola o scoperto', () => {
    const lista = [t('a', 'claudia', '2026-11-05', '10:00', '14:00'), t('b', 'claudia', '2026-11-06', '10:00', '20:00')];
    expect(avvisiPerIlGiorno(lista, '2026-11-05', 600, 1200, 'Giovedì 5/11')).toEqual([
      'Giovedì 5/11 resta con una persona sola.', 'Giovedì 5/11 resta scoperto 14-20.',
    ]);
    expect(avvisiPerIlGiorno([], '2026-11-05', 600, 1200, 'Giovedì 5/11')).toEqual(['Giovedì 5/11 resta senza nessuno.']);
  });

  it('avvisa per chi riceve il turno: ferie, accordi, giorni', () => {
    const base = { nome: 'Susanna Rossi', inFerie: false, inTrasferta: false, puoLavorare: true, fascia: null, inizio: '10:00', fine: '14:00', giorniSettimana: 3, giorniMax: 6, inServizio: true };
    expect(avvisiPerChiRiceve(base)).toEqual([]);
    expect(avvisiPerChiRiceve({ ...base, inFerie: true, giorniSettimana: 6 })).toEqual([
      'Susanna quel giorno è in ferie o permesso.', 'Susanna quella settimana avrebbe 7 giorni di lavoro (massimo 6).',
    ]);
    expect(avvisiPerChiRiceve({ ...base, fascia: { dalle: 840, alle: 1200 } })).toEqual(['Per gli accordi della scheda Susanna quel giorno lavora solo dalle 14 alle 20.']);
  });
});

describe('scritture della mossa', () => {
  it('scambia aggiorna i due turni, sostituisci toglie quello di arrivo, affianca inserisce', async () => {
    const { scrittureMossa } = await import('./spostaTurni');
    const lista = [
      { id: 'a', employee_id: 'claudia', data: '2026-11-05', inizio: '10:00', fine: '14:00', pausa_minuti: 0, stato: 'bozza' },
      { id: 'b', employee_id: 'susanna', data: '2026-11-05', inizio: '14:00', fine: '20:00', pausa_minuti: 30, stato: 'pubblicato' },
    ];
    const sc = scrittureMossa({ turni: lista }, 'scambia', lista[0], 'susanna', '2026-11-05', undefined);
    expect(sc.aggiorna.map((x) => [x.id, x.valori.employee_id])).toEqual([['a', 'susanna'], ['b', 'claudia']]);
    const so = scrittureMossa({ turni: lista }, 'sostituisci', lista[0], 'susanna', '2026-11-05', undefined);
    expect(so.togli).toEqual({ id: 'b', pubblicato: true });
    const af = scrittureMossa({ turni: lista }, 'affianca', lista[0], 'elisa', '2026-11-05', { inizio: '11:00', fine: '15:00', pausa_minuti: 0 });
    expect(af.inserisci).toMatchObject({ employee_id: 'elisa', inizio: '11:00', origine: 'manuale' });
  });
});
