import { describe, it, expect } from 'vitest';
import { fasciaIl, orePossibiliSettimana, puoLavorareIl, testoAccordo, type Accordo } from './accordiOrario';

const accordo = (x: Partial<Accordo>): Accordo => ({ giorni: [1, 2, 3, 4, 5, 6, 7], fasce: {}, validoDal: null, validoAl: null, nota: null, ...x });
const aperto10 = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((g) => [g, { apre: 600, chiude: 1200 }]));

describe('accordi con il dipendente', () => {
  it('riassunto breve per la pagina', () => {
    expect(testoAccordo(accordo({ giorni: [6, 7] }))).toBe('solo sab e dom');
    expect(testoAccordo(accordo({ giorni: [1, 3, 4, 5, 6, 7], fasce: { 4: [{ dalle: '14:00', alle: '20:00' }] } }))).toBe('mar mai · gio 14-20');
    expect(testoAccordo(accordo({}))).toBe('sempre disponibile');
  });

  it('giorni e fasce valgono solo nelle date di validita\'', () => {
    const m = new Map([['a', accordo({ giorni: [1, 3, 4, 5, 6, 7], fasce: { 4: [{ dalle: '14:00', alle: '20:00' }] }, validoDal: '2026-11-01', validoAl: '2026-11-30' })]]);
    expect(puoLavorareIl(m, 'a', '2026-11-03')).toBe(false); // martedi'
    expect(puoLavorareIl(m, 'a', '2026-12-01')).toBe(true); // accordo scaduto
    expect(puoLavorareIl(m, 'b', '2026-11-03')).toBe(true); // senza accordo: sempre
    expect(fasciaIl(m, 'a', '2026-11-05')).toEqual({ dalle: 840, alle: 1200 }); // giovedi'
    expect(fasciaIl(m, 'a', '2026-11-06')).toBeNull();
  });

  it('ore possibili a settimana contro il contratto', () => {
    // senza vincoli, negozio aperto 10 ore: 6 giorni da 9 ore lavorate
    expect(orePossibiliSettimana(null, aperto10)).toBe(54);
    // solo dalle 16 alle 20 tutti i giorni: 4 ore al giorno, 6 giorni = 24
    const sera = accordo({ fasce: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((g) => [g, [{ dalle: '16:00', alle: '20:00' }]])) });
    expect(orePossibiliSettimana(sera, aperto10)).toBe(24);
    // una fascia di 3 ore non basta per il turno minimo di 4
    const corta = accordo({ giorni: [1], fasce: { 1: [{ dalle: '17:00', alle: '20:00' }] } });
    expect(orePossibiliSettimana(corta, aperto10)).toBe(0);
  });
});
