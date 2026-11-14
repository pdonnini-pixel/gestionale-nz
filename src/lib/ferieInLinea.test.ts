import { describe, expect, it } from 'vitest';
import {
  messaggioDopoModifica,
  maturatoDelMese, mesiDaMaturare, quadroPersona, tagliaInGiorni, scegliGiorni, misuraPiano, settimanePeggiorate, rifinisciProposte, maturaIlMese,
  proposteInParole, type GiornoFerieEsistente, type MisuraPiano, type PropostaFerie, type RateoPersona,
} from './ferieInLinea';
import { rateiPiuRecenti } from './ferieInLineaDb';
import type { GiornoPiano, Turno } from './turni';

const rateo = (voce: 'F01' | 'F02' | 'F03', rateoAnnuo: number, residuo: number | null, saldoAllaData = '2026-10-31'): RateoPersona => ({ employeeId: 'a', voce, rateoAnnuo, residuo, saldoAllaData });
const g = (data: string, ore: number, stato: GiornoFerieEsistente['stato'], voce: 'F01' | 'F02' | 'F03' = 'F01'): GiornoFerieEsistente => ({ employeeId: 'a', data, voce, ore, stato });

describe('ferie in linea con il mese: quanto matura', () => {
  it('il maturato del mese è il rateo annuo del tabulato diviso dodici', () => {
    expect(maturatoDelMese(173)).toBeCloseTo(14.4167, 3);
    expect(maturatoDelMese(32)).toBeCloseTo(2.6667, 3);
    expect(maturatoDelMese(null)).toBe(0);
  });
  it('i mesi che maturano fra il saldo e la fine del mese del piano', () => {
    expect(mesiDaMaturare('2026-10-31', '2026-11')).toBe(1);
    expect(mesiDaMaturare('2026-10-31', '2026-12')).toBe(2);
    expect(mesiDaMaturare('2026-10-31', '2027-01')).toBe(3);
    expect(mesiDaMaturare('2026-11-30', '2026-11')).toBe(0);
    expect(mesiDaMaturare(null, '2026-11')).toBe(0);
  });
  it('matura il mese chi è in servizio almeno 15 giorni', () => {
    expect(maturaIlMese(15)).toBe(true);
    expect(maturaIlMese(14)).toBe(false);
  });
});

describe('ferie in linea con il mese: il quadro di una persona', () => {
  it('senza richieste propone tutto quello che matura nel mese', () => {
    const [f01, f02] = quadroPersona({ ratei: [rateo('F01', 173, 0), rateo('F02', 32, 0)], giorni: [], mese: '2026-11', maturaIlMese: true });
    expect(f01.daProporre).toBeCloseTo(14.42, 2);
    expect(f02.daProporre).toBeCloseTo(2.67, 2);
    expect(f01.residuoFineMese).toBeCloseTo(14.42, 2);
  });
  it('le richieste approvate e in attesa del mese (app o gestionale) si tolgono dalla proposta', () => {
    const [f01] = quadroPersona({ ratei: [rateo('F01', 173, 40)], giorni: [g('2026-11-10', 6.67, 'approvato'), g('2026-11-20', 4, 'in_attesa')], mese: '2026-11', maturaIlMese: true });
    expect(f01.approvate).toBe(6.67);
    expect(f01.inAttesa).toBe(4);
    expect(f01.daProporre).toBeCloseTo(14.42 - 10.67, 2);
    // residuo: 40 del tabulato + 14,42 che maturano - 10,67 già chieste
    expect(f01.residuoFineMese).toBeCloseTo(43.75, 2);
  });
  it('chi ha già chiesto più del maturato non riceve proposte', () => {
    const [f01] = quadroPersona({ ratei: [rateo('F01', 129.75, 50)], giorni: [g('2026-11-18', 5, 'in_attesa'), g('2026-11-19', 5, 'in_attesa'), g('2026-11-20', 5, 'in_attesa')], mese: '2026-11', maturaIlMese: true });
    expect(f01.daProporre).toBe(0);
  });
  it('un giorno goduto prima della data del saldo è già nel residuo: non si toglie due volte', () => {
    const [f01] = quadroPersona({ ratei: [rateo('F01', 173, 40)], giorni: [g('2026-10-20', 6.67, 'approvato')], mese: '2026-11', maturaIlMese: true });
    expect(f01.residuoFineMese).toBeCloseTo(54.42, 2);
  });
  it('non si propone quello che la persona non ha: residuo negativo dopo un anticipo', () => {
    const [f01] = quadroPersona({ ratei: [rateo('F01', 129.75, -24.31)], giorni: [], mese: '2026-11', maturaIlMese: true });
    expect(f01.daProporre).toBe(0);
    const [poco] = quadroPersona({ ratei: [rateo('F01', 129.75, -5)], giorni: [], mese: '2026-11', maturaIlMese: true });
    expect(poco.daProporre).toBeCloseTo(5.81, 2);
  });
  it('le proposte già fatte contano: non si ripropone, e il residuo si vede con e senza', () => {
    const [f01] = quadroPersona({ ratei: [rateo('F01', 173, 0)], giorni: [g('2026-11-17', 6.67, 'proposta'), g('2026-11-24', 6.67, 'proposta')], mese: '2026-11', maturaIlMese: true });
    expect(f01.proposte).toBeCloseTo(13.34, 2);
    expect(f01.daProporre).toBeCloseTo(1.08, 2);
    expect(f01.residuoSenzaProposte).toBeCloseTo(14.42, 2);
    expect(f01.residuoFineMese).toBeCloseTo(1.08, 2);
  });
  it('a dicembre il residuo conta anche il mese di novembre, e le richieste di novembre', () => {
    const [f01] = quadroPersona({ ratei: [rateo('F01', 173, 10)], giorni: [g('2026-11-17', 6.67, 'approvato')], mese: '2026-12', maturaIlMese: true });
    expect(f01.approvate).toBe(0); // di dicembre
    expect(f01.residuoFineMese).toBeCloseTo(10 + 14.4167 * 2 - 6.67, 2);
    expect(f01.daProporre).toBeCloseTo(14.42, 2);
  });
  it('chi non matura il mese (entrata a fine mese) non riceve proposte', () => {
    const [f01] = quadroPersona({ ratei: [rateo('F01', 173, 20)], giorni: [], mese: '2026-11', maturaIlMese: false });
    expect(f01.matura).toBe(0);
    expect(f01.daProporre).toBe(0);
  });
});

describe('ferie in linea con il mese: giornate e permessi', () => {
  it('le ferie a giornate intere, l\'avanzo e i permessi a mezz\'ore', () => {
    const t = tagliaInGiorni({ F01: 14.42, F02: 2.67 }, 6.67);
    expect(t.giornate).toBe(2);
    expect(t.permessi).toEqual([{ voce: 'F01', ore: 1 }, { voce: 'F02', ore: 2.5 }]);
    expect(t.resti.map((r) => r.voce)).toEqual(['F01', 'F02']);
    expect(t.resti.reduce((a, r) => a + r.ore, 0)).toBeCloseTo(0.25, 2);
  });
  it('un permesso che in tutto non arriva a un\'ora non si propone', () => {
    const t = tagliaInGiorni({ F01: 5.81, F02: 0 }, 5);
    expect(t.giornate).toBe(1);
    expect(t.permessi).toEqual([]);
    expect(t.resti).toEqual([{ voce: 'F01', ore: 0.81 }]);
  });
  it('quello che non arriva a mezz\'ora non si propone', () => {
    const t = tagliaInGiorni({ F01: 5.3, F02: 0.3 }, 5);
    expect(t.giornate).toBe(1);
    expect(t.permessi).toEqual([]);
    expect(t.resti).toEqual([{ voce: 'F01', ore: 0.3 }, { voce: 'F02', ore: 0.3 }]);
  });
  it('in parole', () => {
    const p: PropostaFerie[] = [{ employeeId: 'a', data: '2026-11-17', voce: 'F01', tipo: 'giornata', ore: 5 }, { employeeId: 'a', data: '2026-11-24', voce: 'F02', tipo: 'ore', ore: 2.5 }];
    expect(proposteInParole(p, (n) => String(n).replace('.', ','))).toBe('una giornata di ferie (5 h) e 2,5 h di permesso');
  });
});

describe('ferie in linea con il mese: la scelta dei giorni', () => {
  const feriali = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'];
  const ingressi = (d: string) => ({ '2026-11-17': 50, '2026-11-24': 60, '2026-11-18': 70 }[d] ?? 100);
  it('le giornate vanno nei giorni più tranquilli, una per settimana', () => {
    const r = scegliGiorni({
      persone: [{ id: 'a', oreGiornata: 6.67, daProporre: { F01: 14.42, F02: 2.67 } }],
      giorniPerGiornata: () => feriali, giorniPerPermesso: () => feriali, ingressi, postiLiberi: () => 2,
    });
    expect(r.proposte.filter((p) => p.tipo === 'giornata').map((p) => p.data)).toEqual(['2026-11-17', '2026-11-24']);
    // il permesso in un giorno diverso dalle giornate, il più tranquillo fra quelli che restano
    const permesso = r.proposte.filter((p) => p.tipo === 'ore');
    expect(permesso.map((p) => p.voce)).toEqual(['F01', 'F02']);
    expect(new Set(permesso.map((p) => p.data)).size).toBe(1);
    expect(['2026-11-17', '2026-11-24']).not.toContain(permesso[0].data);
  });
  it('due persone non vanno in ferie lo stesso giorno, se c\'è un altro giorno', () => {
    const r = scegliGiorni({
      persone: [{ id: 'a', oreGiornata: 5, daProporre: { F01: 5 } }, { id: 'b', oreGiornata: 5, daProporre: { F01: 5 } }],
      giorniPerGiornata: () => feriali, giorniPerPermesso: () => feriali, ingressi, postiLiberi: () => 2,
    });
    const date = r.proposte.map((p) => p.data);
    expect(new Set(date).size).toBe(2);
    expect(date).toContain('2026-11-17');
  });
  it('dove il negozio non regge un\'assenza in più non si propone, e si dice perché', () => {
    const r = scegliGiorni({
      persone: [{ id: 'a', oreGiornata: 5, daProporre: { F01: 10 } }],
      giorniPerGiornata: () => feriali, giorniPerPermesso: () => feriali, ingressi, postiLiberi: (d) => (d === '2026-11-19' ? 1 : 0),
    });
    expect(r.proposte.map((p) => p.data)).toEqual(['2026-11-19']);
    expect(r.resti).toEqual([{ employeeId: 'a', voce: 'F01', ore: 5, motivo: 'sotto_il_minimo' }]);
  });
  it('senza giorni ammessi (solo giorni caldi o eventi) resta tutto da mettere', () => {
    const r = scegliGiorni({
      persone: [{ id: 'a', oreGiornata: 5, daProporre: { F01: 5, F02: 2 } }],
      giorniPerGiornata: () => [], giorniPerPermesso: () => [], ingressi, postiLiberi: () => 2,
    });
    expect(r.proposte).toEqual([]);
    expect(r.resti.map((x) => x.motivo)).toEqual(['nessun_giorno', 'nessun_giorno']);
  });
});

describe('ferie in linea con il mese: le proposte che il negozio non regge si tolgono', () => {
  const giorno = (data: string, minimo: number[]): GiornoPiano => ({ data, giorno: 0, chiuso: false, apre: 600, chiude: 600 + minimo.length * 30, fabbisogno: minimo, minimo, nota: null, speciale: false });
  const turno = (employeeId: string, data: string, inizio: string, fine: string): Turno => ({ employeeId, data, inizio, fine, pausaMinuti: 0 });
  it('la misura conta le ore sotto le persone minime, i giorni con una persona sola e le ore vuote', () => {
    const giorni = [giorno('2026-11-17', [1, 2, 2, 1]), giorno('2026-11-18', [1, 1, 1, 1])];
    const m = misuraPiano(giorni, [turno('a', '2026-11-17', '10:00', '12:00'), turno('a', '2026-11-18', '10:00', '11:00')], '2026-11');
    expect(m.sottoMinimo.get('2026-11-16')).toBe(2); // un'ora il 17 (due mezz'ore con una persona su due) e un'ora vuota il 18
    expect(m.vuote.get('2026-11-16')).toBe(1);
    expect(m.unaSola.get('2026-11-16')).toBe(2);
  });
  const misura = (sotto: Record<string, number>): MisuraPiano => ({ sottoMinimo: new Map(Object.entries(sotto)), unaSola: new Map(), vuote: new Map(), senzaRiposo: new Map() });
  it('una settimana è peggiorata se scende sotto il minimo più di un quarto d\'ora', () => {
    expect(settimanePeggiorate(misura({ a: 2 }), misura({ a: 2.2 }))).toEqual([]);
    expect(settimanePeggiorate(misura({ a: 2 }), misura({ a: 2.5, b: 1 }))).toEqual(['a', 'b']);
  });
  it('toglie la proposta della settimana che peggiora e tiene le altre', () => {
    const proposte: PropostaFerie[] = [
      { employeeId: 'a', data: '2026-11-17', voce: 'F01', tipo: 'giornata', ore: 5 },
      { employeeId: 'b', data: '2026-11-24', voce: 'F01', tipo: 'giornata', ore: 5 },
    ];
    // il negozio non regge l'assenza di «a» il 17: quella settimana va sotto il minimo
    const r = rifinisciProposte({ proposte, misura: (lista) => misura(lista.some((p) => p.data === '2026-11-17') ? { '2026-11-16': 3 } : {}) });
    expect(r.proposte.map((p) => p.employeeId)).toEqual(['b']);
    expect(r.tolte.map((p) => p.employeeId)).toEqual(['a']);
  });
  it('un permesso di due voci nello stesso giorno si toglie intero', () => {
    const proposte: PropostaFerie[] = [
      { employeeId: 'a', data: '2026-11-17', voce: 'F01', tipo: 'ore', ore: 1 },
      { employeeId: 'a', data: '2026-11-17', voce: 'F02', tipo: 'ore', ore: 2.5 },
    ];
    const r = rifinisciProposte({ proposte, misura: (lista) => misura(lista.length ? { '2026-11-16': 1 } : {}) });
    expect(r.proposte).toEqual([]);
    expect(r.tolte).toHaveLength(2);
  });
  it('se niente peggiora le proposte restano tutte', () => {
    const proposte: PropostaFerie[] = [{ employeeId: 'a', data: '2026-11-17', voce: 'F01', tipo: 'giornata', ore: 5 }];
    expect(rifinisciProposte({ proposte, misura: () => misura({}) }).proposte).toEqual(proposte);
  });
});

describe('ferie in linea con il mese: i ratei del tabulato', () => {
  const riga = (anno: number, mese: number, rateoAnnuo: number, cessazione: string | null = null, assunzione = '2026-01-01') =>
    ({ employeeId: 'a', voce: 'F01' as const, rateoAnnuo, residuo: 1, anno, mese, assunzione, cessazione });
  it('vale il tabulato più recente', () => {
    const [r] = rateiPiuRecenti([riga(2026, 8, 100), riga(2026, 10, 173)]);
    expect(r.rateoAnnuo).toBe(173);
    expect(r.saldoAllaData).toBe('2026-10-31');
  });
  it('nello stesso tabulato, fra due contratti vale quello ancora aperto', () => {
    const [r] = rateiPiuRecenti([riga(2026, 10, 34.6, '2026-10-15'), riga(2026, 10, 168, null, '2026-10-16')]);
    expect(r.rateoAnnuo).toBe(168);
  });
});

describe('ferie in linea con il mese: cosa si dice dopo aver tolto o spostato una proposta', () => {
  it('turni rifatti: lo dice', () => {
    expect(messaggioDopoModifica('tolta', 'fatto')).toMatch(/turni della settimana sono ricalcolati/);
    expect(messaggioDopoModifica('spostata', 'fatto')).toMatch(/settimane toccate sono ricalcolati/);
  });
  it('mese chiuso: la proposta è cambiata ma non dice che i turni sono ricalcolati', () => {
    const m = messaggioDopoModifica('tolta', 'non_fatto');
    expect(m).toMatch(/Proposta tolta/);
    expect(m).not.toMatch(/sono ricalcolati/);
    expect(m).toMatch(/restano quelli di prima/);
  });
  it('errore a metà: dice sempre che la proposta è cambiata e di premere «Ricalcola il mese»', () => {
    const m = messaggioDopoModifica('spostata', 'errore', 'permesso negato');
    expect(m).toMatch(/Proposta spostata, ma i turni non sono stati rifatti \(permesso negato\)/);
    expect(m).toMatch(/premi «Ricalcola il mese»/);
    expect(messaggioDopoModifica('tolta', 'errore')).toBe('Proposta tolta, ma i turni non sono stati rifatti: premi «Ricalcola il mese».');
  });
});
