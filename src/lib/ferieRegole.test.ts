import { describe, it, expect } from 'vitest';
import {
  REGOLE_FERIE_SPENTE, bloccaFerieEvento, ammesseNellEvento, chiApprovaInParole, eccezioniAttive, erroriRegoleFerie, esitoRichiesta,
  eventoConFerie, regoleFerieDaRiga, regoleFerieDiPartenza, rigaDaRegoleFerie, type EventoFerie,
} from './ferieRegole';

const vecchio: EventoFerie = { nome: 'Saldi', data_dal: '2026-12-21', data_al: '2026-12-22', blocca_ferie: true };
const periodo: EventoFerie = { nome: 'Black Friday', data_dal: '2026-11-27', data_al: '2026-11-29', blocca_ferie: false, tipo: 'periodo', ferie: false, permessi: true };

describe('regole delle ferie per negozio (scheda 9, 12/11/2026)', () => {
  it('riga assente o colonne vuote = come prima: approva una fra referente e HR, si chiede sempre, niente eccezioni', () => {
    expect(regoleFerieDaRiga(null)).toEqual(REGOLE_FERIE_SPENTE);
    expect(regoleFerieDaRiga({ outlet_id: 'x', ferie_weekend: null })).toEqual(REGOLE_FERIE_SPENTE);
    expect(eccezioniAttive(REGOLE_FERIE_SPENTE)).toBe(false);
  });

  it('la proposta di partenza: nei negozi con i giorni caldi weekend e festivi spenti, eccezioni accese', () => {
    const caldo = regoleFerieDiPartenza(true);
    expect(caldo.quando.weekend).toEqual({ ferie: false, permessi: false });
    expect(caldo.quando.festivi).toEqual({ ferie: false, permessi: false });
    expect(caldo.quando.feriali).toEqual({ ferie: true, permessi: true });
    expect(eccezioniAttive(caldo)).toBe(true);
    expect(erroriRegoleFerie(caldo)).toEqual([]);
    expect(regoleFerieDiPartenza(false)).toEqual(REGOLE_FERIE_SPENTE);
  });

  it('andata e ritorno con le colonne; nessuna colonna di doppia approvazione', () => {
    const x = regoleFerieDiPartenza(true);
    x.approva.permessi = { referente: true, hr: false };
    const riga = rigaDaRegoleFerie(x);
    expect(riga.permessi_hr).toBe(false);
    expect(riga.ferie_weekend).toBe(false);
    expect(regoleFerieDaRiga(riga).approva.permessi).toEqual({ referente: true, hr: false });
    expect(Object.keys(riga)).toHaveLength(12);
    expect(Object.keys(riga).some((k) => k.includes('entrambe'))).toBe(false);
  });

  it('non si salva una scheda in cui nessuno approva, e avvisa se spegne giorni senza eccezioni', () => {
    const x = regoleFerieDiPartenza(true);
    x.approva.ferie = { referente: false, hr: false };
    x.approva.eccezioni = { referente: false, hr: false };
    expect(erroriRegoleFerie(x)).toHaveLength(2);
  });

  it('chi approva, in parole', () => {
    expect(chiApprovaInParole({ referente: true, hr: true })).toBe('referente oppure HR');
    expect(chiApprovaInParole({ referente: false, hr: true })).toBe('HR');
  });
});

describe('esitoRichiesta: come ferie_blocco_giorno nel database', () => {
  const regole = regoleFerieDiPartenza(true);

  it('negozio senza scheda: sabato e festivi passano; l\'evento di prima blocca tutte e due con il messaggio di sempre', () => {
    expect(esitoRichiesta('2026-11-21', 'ferie', [], null)).toEqual({ ammessa: true });
    expect(esitoRichiesta('2026-12-08', 'permessi', [], null)).toEqual({ ammessa: true });
    expect(esitoRichiesta('2026-12-21', 'permessi', [vecchio], null)).toEqual({ ammessa: false, motivo: 'Il 21/12/2026 c\'è Saldi: niente ferie né permessi.', eccezione: false });
  });

  it('periodo nuovo: ferie no e permesso sì, anche senza la scheda del negozio', () => {
    expect(esitoRichiesta('2026-11-27', 'ferie', [periodo], null)).toMatchObject({ ammessa: false, motivo: 'Il 27/11/2026 c\'è Black Friday: niente ferie.' });
    expect(esitoRichiesta('2026-11-27', 'permessi', [periodo], null)).toEqual({ ammessa: true });
  });

  it('con la scheda: sabato, domenica e festivi solo come eccezione; il feriale passa', () => {
    expect(esitoRichiesta('2026-11-21', 'ferie', [], regole)).toMatchObject({ ammessa: false, eccezione: true });
    expect(esitoRichiesta('2026-11-22', 'permessi', [], regole)).toMatchObject({ ammessa: false, eccezione: true });
    expect(esitoRichiesta('2026-12-08', 'ferie', [], regole)).toMatchObject({ ammessa: false });
    expect(esitoRichiesta('2026-04-06', 'ferie', [], regole)).toMatchObject({ ammessa: false }); // lunedì dell'Angelo 2026
    expect(esitoRichiesta('2026-11-18', 'ferie', [], regole)).toEqual({ ammessa: true });
  });

  it('la voce scritta sull\'evento comanda sulle regole del giorno: permesso ammesso di sabato dentro il periodo', () => {
    expect(esitoRichiesta('2026-11-28', 'permessi', [periodo], regole)).toEqual({ ammessa: true });
    expect(esitoRichiesta('2026-11-28', 'ferie', [periodo], regole)).toMatchObject({ ammessa: false, eccezione: true });
  });

  it('un giorno speciale singolo segue la riga dei festivi; senza scheda blocca come ha sempre fatto', () => {
    const giorno: EventoFerie = { nome: 'Apertura serale', data_dal: '2026-12-10', data_al: '2026-12-10', tipo: 'giorno', blocca_ferie: true };
    const mista: typeof regole = { ...regole, quando: { ...regole.quando, festivi: { ferie: false, permessi: true } } };
    expect(esitoRichiesta('2026-12-10', 'ferie', [giorno], mista)).toMatchObject({ ammessa: false, motivo: 'Il 10/12/2026 c\'è Apertura serale: nei giorni speciali il negozio lavora al completo, niente ferie.' });
    expect(esitoRichiesta('2026-12-10', 'permessi', [giorno], mista)).toEqual({ ammessa: true });
    expect(esitoRichiesta('2026-12-10', 'permessi', [giorno], null)).toEqual({ ammessa: false, motivo: 'Il 10/12/2026 c\'è Apertura serale: niente ferie né permessi.', eccezione: false });
    expect(esitoRichiesta('2026-12-10', 'ferie', [{ ...giorno, blocca_ferie: false }], null)).toEqual({ ammessa: true });
    // con voci sue decide lui
    expect(esitoRichiesta('2026-12-10', 'ferie', [{ ...giorno, ferie: true, permessi: false }], mista)).toEqual({ ammessa: true });
    expect(ammesseNellEvento(giorno, mista)).toEqual({ ferie: false, permessi: true });
    expect(ammesseNellEvento(giorno, null)).toEqual({ ferie: false, permessi: false });
  });
});

describe('eventi: ferie e permessi separati', () => {
  it('le due voci dell\'evento: quella scritta, altrimenti blocca_ferie', () => {
    expect(ammesseNellEvento(vecchio)).toEqual({ ferie: false, permessi: false });
    expect(ammesseNellEvento(periodo)).toEqual({ ferie: false, permessi: true });
    expect(ammesseNellEvento({ nome: 'x', data_dal: '2026-01-01', data_al: '2026-01-01' })).toEqual({ ferie: true, permessi: true });
  });

  it('salvando le due voci, blocca_ferie resta vero solo se sono spente tutte e due; le altre regole restano', () => {
    expect(eventoConFerie({ fasce: [1], tutti: true }, { ferie: false, permessi: true })).toEqual({ regole: { fasce: [1], tutti: true, ferie: false, permessi: true }, blocca_ferie: false });
    expect(eventoConFerie(null, { ferie: false, permessi: false }).blocca_ferie).toBe(true);
    // l'evento allineato dalla 407 e poi risalvato perde il valore di prima
    expect(eventoConFerie({ prima_407: { ferie: true }, tutti: true }, { ferie: true, permessi: false }).regole).toEqual({ tutti: true, ferie: true, permessi: false });
  });

  it('blocca_ferie: con la 407 solo se spente tutte e due, senza basta una (come prima)', () => {
    expect(bloccaFerieEvento({ ferie: true, permessi: false }, true)).toBe(false);
    expect(bloccaFerieEvento({ ferie: true, permessi: false }, false)).toBe(true);
    expect(bloccaFerieEvento({ ferie: false, permessi: false }, true)).toBe(true);
    expect(bloccaFerieEvento({ ferie: true, permessi: true }, false)).toBe(false);
  });
});
