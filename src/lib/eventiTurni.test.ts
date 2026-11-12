import { describe, it, expect } from 'vitest';
import {
  annoPrima, controlloModaPeriodo, eventiInConflitto, eventoDaRiga, fasceDelGiorno, ingressiPerGiorno, leggiRegoleEvento,
  regoleDiPartenza, richiesteAmmesse, riposiMinDellaSettimana,
} from './eventiTurni';
import { REGOLE_DEFAULT, giorniDellaSettimana, regoleDaRiga, type EventoNegozio } from './turni';

const evento = (x: Partial<EventoNegozio>): EventoNegozio => ({
  nome: 'Evento', data_dal: '2026-11-27', data_al: '2026-11-29', outlet_ids: null, persone_extra: 0, blocca_ferie: true, straordinari: true, ...x,
});

describe('regole di un periodo speciale', () => {
  it('dal database si tiene solo quello che ha la forma giusta, e i riposi non scendono sotto uno', () => {
    expect(leggiRegoleEvento(null)).toBeNull();
    expect(leggiRegoleEvento('testo')).toBeNull();
    expect(leggiRegoleEvento({
      apre: '10:00:00', chiude: '25:00', moda: false, tutti: 'si', riposi_min: 0,
      fasce: [{ dalle: '10:00', alle: '11:00', persone: 2 }, { dalle: '12:00', alle: '11:00', persone: 3 }, { dalle: 'x', alle: '13:00', persone: 1 }],
    })).toEqual({ apre: '10:00', moda: false, riposi_min: 1, fasce: [{ dalle: '10:00', alle: '11:00', persone: 2 }] });
  });

  it('una riga di outlet_events: senza tipo resta un evento di prima', () => {
    const prima = eventoDaRiga({ nome: 'Black Friday', data_dal: '2026-11-27', data_al: '2026-11-29', outlet_ids: [], persone_extra: 1, blocca_ferie: true, straordinari: true });
    expect(prima.tipo).toBeUndefined();
    expect(prima.outlet_ids).toBeNull();
    const periodo = eventoDaRiga({ nome: 'Saldi', data_dal: '2027-01-02', data_al: '2027-01-06', outlet_ids: ['n1'], tipo: 'periodo', regole: { riposi_min: 1, guida: false }, regole_origine: 'manuale' });
    expect(periodo).toMatchObject({ tipo: 'periodo', regole: { riposi_min: 1, guida: false }, regole_origine: 'manuale', outlet_ids: ['n1'] });
    // un giorno singolo non ha regole proprie: vale come un sabato
    expect(eventoDaRiga({ nome: 'Immacolata', data_dal: '2026-12-08', data_al: '2026-12-08', tipo: 'giorno', regole: { tutti: false } }).regole).toBeNull();
  });

  it('regole di partenza: come un sabato o una domenica, copiate da un altro evento, a mano', () => {
    const negozio = regoleDaRiga({ turno_max_ore: 10, pausa_oltre_ore: 6, pausa_minuti: 10, giorni_lavoro_max: 6, giorni_pieni: true, caldi_guida_apre_chiude: true });
    expect(regoleDiPartenza('sabato', negozio)).toEqual({ moda: true, tutti: true, straordinari: true, guida: true, ferie: false, permessi: false, riposi_min: 1 });
    expect(regoleDiPartenza('manuale', REGOLE_DEFAULT).guida).toBe(true);
    const altro = { regole: { chiude: '21:00', fasce: [{ dalle: '10:00', alle: '21:00', persone: 3 }], riposi_min: 2 } };
    const copia = regoleDiPartenza('evento', negozio, altro);
    expect(copia).toEqual({ chiude: '21:00', fasce: [{ dalle: '10:00', alle: '21:00', persone: 3 }], riposi_min: 2 });
    // una copia vera: cambiarla non tocca l'evento di partenza
    copia.fasce![0].persone = 9;
    expect(altro.regole.fasce[0].persone).toBe(3);
  });

  it('le fasce di un giorno della settimana, in ordine', () => {
    const fasce = [{ giorno: 6, dalle: '11:00:00', alle: '19:00:00', persone: 4 }, { giorno: 6, dalle: '10:00', alle: '11:00', persone: 1 }, { giorno: 7, dalle: '10:00', alle: '20:00', persone: 2 }];
    expect(fasceDelGiorno(fasce, 6)).toEqual([{ dalle: '10:00', alle: '11:00', persone: 1 }, { dalle: '11:00', alle: '19:00', persone: 4 }]);
  });
});

describe('due eventi sullo stesso giorno e negozio', () => {
  const bf = evento({ id: 'bf', nome: 'Black Friday', outlet_ids: ['roma'] });
  it('si accorge della sovrapposizione, anche di un giorno solo', () => {
    expect(eventiInConflitto([bf], evento({ nome: 'Apertura serale', data_dal: '2026-11-29', data_al: '2026-11-29', outlet_ids: ['roma'] }))).toEqual([bf]);
    expect(eventiInConflitto([bf], evento({ nome: 'Dopo', data_dal: '2026-11-30', data_al: '2026-12-02', outlet_ids: ['roma'] }))).toEqual([]);
  });
  it('negozi diversi non si pestano; un evento per tutti i negozi tocca tutti', () => {
    expect(eventiInConflitto([bf], evento({ outlet_ids: ['torino'] }))).toEqual([]);
    expect(eventiInConflitto([bf], evento({ outlet_ids: null }))).toEqual([bf]);
    expect(eventiInConflitto([evento({ id: 'tutti', outlet_ids: null })], evento({ outlet_ids: ['torino'] })).length).toBe(1);
  });
  it('modificando un evento non si scontra con se stesso', () => {
    expect(eventiInConflitto([bf], { ...bf, data_al: '2026-11-30' })).toEqual([]);
  });
});

describe('riposi e richieste nei periodi', () => {
  const date = giorniDellaSettimana('2026-11-23');
  const conDue = regoleDaRiga({ turno_max_ore: 10, pausa_oltre_ore: 6, pausa_minuti: 10, giorni_lavoro_max: 6, riposi_min_settimana: 2 });
  it('i riposi della settimana: quelli del negozio, o meno se il periodo ne chiede meno, mai sotto uno', () => {
    expect(riposiMinDellaSettimana(conDue, [], date)).toBe(2);
    expect(riposiMinDellaSettimana(conDue, [evento({ tipo: 'periodo', regole: { riposi_min: 1 } })], date)).toBe(1);
    expect(riposiMinDellaSettimana(conDue, [evento({ tipo: 'periodo', regole: { riposi_min: 0 } })], date)).toBe(1);
    // un periodo che ne chiede di piu' non alza quelli del negozio
    expect(riposiMinDellaSettimana(conDue, [evento({ tipo: 'periodo', regole: { riposi_min: 3 } })], date)).toBe(2);
    expect(riposiMinDellaSettimana(REGOLE_DEFAULT, [], date)).toBeUndefined();
    // il periodo di un altro negozio non conta
    expect(riposiMinDellaSettimana(conDue, [evento({ tipo: 'periodo', regole: { riposi_min: 1 }, outlet_ids: ['torino'] })], date, 'roma')).toBe(2);
  });
  it('ferie e permessi: decide il periodo, e senza regole decide «blocca ferie»', () => {
    const eventi = [evento({ tipo: 'periodo', regole: { ferie: false, permessi: true } })];
    expect(richiesteAmmesse(eventi, '2026-11-28', 'ferie')).toBe(false);
    expect(richiesteAmmesse(eventi, '2026-11-28', 'permessi')).toBe(true);
    expect(richiesteAmmesse(eventi, '2026-11-26', 'ferie')).toBe(true);
    expect(richiesteAmmesse([evento({ blocca_ferie: true })], '2026-11-28', 'permessi')).toBe(false);
    expect(richiesteAmmesse([evento({ blocca_ferie: false })], '2026-11-28', 'ferie')).toBe(true);
  });
});

describe('controllo MODA di un periodo', () => {
  // 2025: giorni normali 600 ingressi nei feriali e 900 nel fine settimana; il Black Friday vero cade dal 28 al 30
  const ingressi = new Map<string, number>();
  for (let d = new Date(Date.UTC(2025, 9, 1)); d < new Date(Date.UTC(2026, 0, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    ingressi.set(iso, [0, 6].includes(d.getUTCDay()) ? 900 : 600);
  }
  for (const [d, n] of [['2025-11-28', 1500], ['2025-11-29', 1800], ['2025-11-30', 1700]] as const) ingressi.set(d, n);

  it('la stessa data dell\'anno prima', () => {
    expect(annoPrima('2026-11-27')).toBe('2025-11-27');
    expect(annoPrima('2028-02-29')).toBe('2027-02-28');
  });

  it('trova il picco dentro i tre giorni di margine e lo confronta con gli stessi giorni delle settimane vicine', () => {
    const c = controlloModaPeriodo(ingressi, '2026-11-27', '2026-11-29');
    expect(c.periodo).toMatchObject({ dal: '2025-11-27', al: '2025-11-29', giorniConDati: 3 });
    // il picco del 2025 e' un giorno dopo: venerdi' 28, sabato 29, domenica 30
    expect(c.picco).toMatchObject({ dal: '2025-11-28', al: '2025-11-30', mediaGiorno: 1667 });
    expect(c.spostaDiGiorni).toBe(1);
    expect(c.proposta).toEqual({ dal: '2026-11-28', al: '2026-11-30' });
    // venerdi', sabato e domenica delle sei settimane vicine: (600 + 900 + 900) / 3 = 800
    expect(c.riferimento).toEqual({ mediaGiorno: 800, giorni: 18 });
    expect(c.scostamentoPct).toBeCloseTo(108.3, 1);
    expect(c.esito).toBe('sopra');
    expect(c.barre.map((b) => b.etichetta)).toEqual(['3 sett. prima', '2 sett. prima', 'sett. prima', 'periodo', 'sett. dopo', '2 sett. dopo', '3 sett. dopo']);
    expect(c.barre[3]).toMatchObject({ periodo: true, mediaGiorno: 1667 });
  });

  it('un periodo come gli altri resta «nella media», e non propone di spostare le date se coincide', () => {
    const c = controlloModaPeriodo(ingressi, '2026-10-20', '2026-10-22');
    expect(c.esito).toBe('nella_media');
    expect(c.scostamentoPct).toBe(0);
    // un fine settimana contro altri fine settimana: non risulta «sopra» solo perche' e' un fine settimana
    const we = controlloModaPeriodo(ingressi, '2026-10-17', '2026-10-18');
    expect(we.picco.mediaGiorno).toBe(we.riferimento.mediaGiorno);
    expect(we.esito).toBe('nella_media');
  });

  it('senza dati dell\'anno prima lo dice, senza inventare un esito', () => {
    const c = controlloModaPeriodo(new Map(), '2026-11-27', '2026-11-29');
    expect(c).toMatchObject({ esito: 'senza_dati', scostamentoPct: null, proposta: null, spostaDiGiorni: 0 });
  });

  it('gli ingressi del giorno sono la somma delle ore', () => {
    expect(ingressiPerGiorno([{ data: '2025-11-28', ingressi: 10 }, { data: '2025-11-28', ingressi: 15 }, { data: '2025-11-29', ingressi: 7 }]))
      .toEqual(new Map([['2025-11-28', 25], ['2025-11-29', 7]]));
  });
});
