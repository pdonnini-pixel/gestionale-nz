import { describe, it, expect } from 'vitest';
import {
  personaAllaData, organicoAllaData, decisioniDaPrendere, giorniTra, oggiRoma, aggiungiGiorni,
  nomePersona, descriviEvento, confrontoEvento, confrontaConCedolini, type SchedaPersona, type EventoOrganico,
} from './organico';

const base: SchedaPersona = {
  id: 'p1', nome: 'SOFIA', cognome: 'TESTA', outlet_id: 'frc', contratto_tipo: 'determinato',
  ore_settimanali: 30, data_assunzione: '2025-12-16', scadenza_td: '2026-12-15',
  data_cessazione: null, is_active: true,
};

let n = 0;
const ev = (e: Partial<EventoOrganico>): EventoOrganico => ({
  id: `e${++n}`, employee_id: 'p1', tipo: 'altro', data_dal: '2026-10-01', stato: 'da_confermare', ...e,
});

describe('personaAllaData', () => {
  it('senza cambiamenti vale la scheda dello studio', () => {
    const p = personaAllaData(base, [], '2026-10-19');
    expect(p.stato).toBe('in_servizio');
    expect(p.ore).toBe(30);
    expect(p.giorniAllaScadenza).toBe(57);
  });

  it('una maternità rende assente dal giorno indicato fino al rientro', () => {
    const e = [ev({ tipo: 'assenza_lunga', motivo: 'maternità', data_dal: '2026-10-02', data_al: '2026-12-01' })];
    expect(personaAllaData(base, e, '2026-10-01').stato).toBe('in_servizio');
    const p = personaAllaData(base, e, '2026-10-19');
    expect(p.stato).toBe('assente');
    expect(p.assenza?.motivo).toBe('maternità');
    expect(personaAllaData(base, e, '2026-12-01').stato).toBe('in_servizio');
  });

  it('un rientro chiude l’assenza anche senza data di rientro prevista', () => {
    const e = [
      ev({ tipo: 'assenza_lunga', data_dal: '2026-09-01' }),
      ev({ tipo: 'rientro', data_dal: '2026-10-10' }),
    ];
    expect(personaAllaData(base, e, '2026-10-05').stato).toBe('assente');
    expect(personaAllaData(base, e, '2026-10-10').stato).toBe('in_servizio');
  });

  it('un cambiamento annullato non conta', () => {
    const e = [ev({ tipo: 'assenza_lunga', data_dal: '2026-10-02', stato: 'annullato' })];
    expect(personaAllaData(base, e, '2026-10-19').stato).toBe('in_servizio');
  });

  it('cessazione: il giorno indicato è l’ultimo di lavoro', () => {
    const e = [ev({ tipo: 'cessazione', data_dal: '2026-10-20' })];
    expect(personaAllaData(base, e, '2026-10-20').stato).toBe('in_servizio');
    const dopo = personaAllaData(base, e, '2026-10-21');
    expect(dopo.stato).toBe('cessato');
    expect(dopo.ultimoGiorno).toBe('2026-10-20');
  });

  it('determinato scaduto senza proroga: da decidere', () => {
    const s = { ...base, scadenza_td: '2026-10-12' };
    const p = personaAllaData(s, [], '2026-10-19');
    expect(p.stato).toBe('scaduto');
    expect(decisioniDaPrendere([p])[0].motivo).toBe('scaduto');
  });

  it('la proroga sposta la scadenza e toglie la decisione', () => {
    const s = { ...base, scadenza_td: '2026-10-12' };
    const p = personaAllaData(s, [ev({ tipo: 'proroga', data_dal: '2026-10-13', data_al: '2027-01-12' })], '2026-10-19');
    expect(p.stato).toBe('in_servizio');
    expect(p.scadenza).toBe('2027-01-12');
    expect(decisioniDaPrendere([p])).toHaveLength(0);
  });

  it('rinnovo con orario diverso: nuova scadenza subito, nuove ore dal primo giorno del rinnovo', () => {
    const s = { ...base, scadenza_td: '2026-12-15' };
    const e = [ev({ tipo: 'proroga', data_dal: '2026-12-16', data_al: '2027-06-15', ore_settimanali: 36 })];
    const prima = personaAllaData(s, e, '2026-12-01');
    expect(prima.scadenza).toBe('2027-06-15');
    expect(prima.ore).toBe(30);
    expect(personaAllaData(s, e, '2026-12-16').ore).toBe(36);
    expect(descriviEvento(e[0])).toBe('Proroga fino al 15/06/2027, 36 ore dal 16/12/2026');
  });

  it('passaggio a indeterminato con meno ore', () => {
    const e = [ev({ tipo: 'trasformazione_indeterminato', data_dal: '2026-11-01', ore_settimanali: 24 })];
    const p = personaAllaData(base, e, '2026-11-01');
    expect(p.contratto).toBe('indeterminato');
    expect(p.ore).toBe(24);
    expect(personaAllaData(base, e, '2026-10-31').ore).toBe(30);
  });

  it('cambio d’orario vale dalla sua data', () => {
    const e = [ev({ tipo: 'cambio_orario', data_dal: '2026-10-01', ore_settimanali: 20 })];
    expect(personaAllaData(base, e, '2026-09-30').ore).toBe(30);
    expect(personaAllaData(base, e, '2026-10-01').ore).toBe(20);
  });

  it('cambio di negozio e passaggio a indeterminato', () => {
    const e = [
      ev({ tipo: 'cambio_negozio', data_dal: '2026-11-01', outlet_id: 'brb' }),
      ev({ tipo: 'trasformazione_indeterminato', data_dal: '2026-11-01' }),
    ];
    const prima = personaAllaData(base, e, '2026-10-31');
    expect(prima.outletId).toBe('frc');
    expect(prima.prossimi).toHaveLength(2);
    const dopo = personaAllaData(base, e, '2026-11-01');
    expect(dopo.outletId).toBe('brb');
    expect(dopo.contratto).toBe('indeterminato');
    expect(dopo.scadenza).toBeNull();
    expect(dopo.giorniAllaScadenza).toBeNull();
  });

  it('una persona nuova non c’è prima della data di assunzione', () => {
    const nuova: SchedaPersona = { ...base, id: 'p2', data_assunzione: '2026-11-05', scadenza_td: '2027-05-04' };
    const e = [ev({ employee_id: 'p2', tipo: 'assunzione', data_dal: '2026-11-05', ore_settimanali: 40, outlet_id: 'rso' })];
    expect(personaAllaData(nuova, e, '2026-11-04').stato).toBe('non_ancora_assunto');
    const p = personaAllaData(nuova, e, '2026-11-05');
    expect(p.stato).toBe('in_servizio');
    expect(p.ore).toBe(40);
    expect(p.outletId).toBe('rso');
  });

  it('scheda non attiva senza data di uscita: non è in forza', () => {
    expect(personaAllaData({ ...base, is_active: false }, [], '2026-10-19').stato).toBe('cessato');
  });

  it('a chiamata: nessun orario fisso', () => {
    expect(personaAllaData({ ...base, contratto_tipo: 'a_chiamata' }, [], '2026-10-19').ore).toBeNull();
  });
});

describe('organicoAllaData', () => {
  it('l’amministratore resta fuori', () => {
    const admin: SchedaPersona = { ...base, id: 'a', contratto_tipo: 'amministratore' };
    expect(organicoAllaData([base, admin], [], '2026-10-19').map((p) => p.scheda.id)).toEqual(['p1']);
  });
});

describe('utilità', () => {
  it('giorniTra, aggiungiGiorni', () => {
    expect(giorniTra('2026-10-19', '2026-10-26')).toBe(7);
    expect(aggiungiGiorni('2026-10-31', 1)).toBe('2026-11-01');
  });
  it('oggiRoma usa il fuso di Roma', () => {
    // 23:30 UTC del 31/10 = 00:30 del 01/11 a Roma (ora solare)
    expect(oggiRoma(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
  });
  it('nome leggibile', () => {
    expect(nomePersona({ nome: "NICCOLO'", cognome: 'DA FONSECA MANNILE' })).toBe("Da Fonseca Mannile Niccolo'");
  });
  it('descrizione di un cambiamento', () => {
    expect(descriviEvento(ev({ tipo: 'assenza_lunga', motivo: 'maternità', data_dal: '2026-10-02', data_al: '2027-03-01' })))
      .toBe('Maternità dal 02/10/2026, rientro previsto 01/03/2027');
  });
});


describe('confronto con lo studio', () => {
  it('cambio d’orario uguale o diverso dalla scheda', () => {
    const e = ev({ tipo: 'cambio_orario', ore_settimanali: 20 });
    expect(confrontoEvento(e, { ...base, ore_settimanali: 20 }, false).esito).toBe('uguale');
    expect(confrontoEvento(e, base, false)).toEqual({ esito: 'diverso', studio: '30 ore' });
  });
  it('proroga con ore: uguale solo se lo studio riporta scadenza e ore', () => {
    const e = ev({ tipo: 'proroga', data_al: '2027-06-15', ore_settimanali: 36 });
    expect(confrontoEvento(e, { ...base, scadenza_td: '2027-06-15', ore_settimanali: 36 }, false).esito).toBe('uguale');
    expect(confrontoEvento(e, { ...base, scadenza_td: '2027-06-15', ore_settimanali: 30 }, false))
      .toEqual({ esito: 'diverso', studio: 'scadenza 15/06/2027, 30 ore' });
  });
  it('maternità: non verificabile dai documenti', () => {
    expect(confrontoEvento(ev({ tipo: 'assenza_lunga' }), base, false).esito).toBe('non_verificabile');
  });
  it('assunzione confermata dal cedolino', () => {
    expect(confrontoEvento(ev({ tipo: 'assunzione' }), base, true).esito).toBe('uguale');
  });
  it('pagata ma fuori organico, in organico senza cedolino', () => {
    const fuori: SchedaPersona = { ...base, id: 'x', is_active: false, data_assunzione: null };
    const dentro: SchedaPersona = { ...base, id: 'y' };
    const assente: SchedaPersona = { ...base, id: 'z' };
    const eventi = [ev({ employee_id: 'z', tipo: 'assenza_lunga', data_dal: '2026-08-01' })];
    const a = confrontaConCedolini([fuori, dentro, assente], eventi, new Set(['x']), 2026, 9);
    expect(a.map((x) => [x.persona.scheda.id, x.tipo])).toEqual([
      ['x', 'pagata_fuori_organico'],
      ['y', 'in_organico_senza_cedolino'],
    ]);
  });
  it('chi entra durante il mese non è un’anomalia', () => {
    const nuova: SchedaPersona = { ...base, id: 'n', data_assunzione: '2026-09-14' };
    expect(confrontaConCedolini([nuova], [], new Set(), 2026, 9)).toEqual([]);
  });
});
