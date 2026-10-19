import { describe, it, expect } from 'vitest';
import { stimaOrariEFabbisogno, oraRoma, type ChiusuraGiorno } from './stimaNegozio';
import { giorniDellaSettimana } from './turni';

// Quattro settimane di chiusure come quelle vere di settembre: tutti i
// giorni alle 20 circa, sabato e domenica alle 21, il weekend incassa quattro volte.
function chiusure(opz: { lunediChiuso?: boolean } = {}): ChiusuraGiorno[] {
  const out: ChiusuraGiorno[] = [];
  for (const lun of ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']) {
    giorniDellaSettimana(lun).forEach((data, i) => {
      const weekend = i >= 5;
      out.push({
        data,
        giornoChiuso: !!opz.lunediChiuso && i === 0,
        oraConferma: weekend ? '21:02' : i === 2 ? '18:14' : '20:03',
        incasso: weekend ? 4000 : 1000,
      });
    });
  }
  return out;
}

describe('stimaOrariEFabbisogno', () => {
  it('chiusura dalla mediana delle conferme, apertura standard', () => {
    const s = stimaOrariEFabbisogno(chiusure(), 200, 7);
    expect(s.orari[0]).toEqual({ giorno: 1, chiuso: false, apre: '10:00', chiude: '20:00' });
    expect(s.orari[5].chiude).toBe('21:00');
    // il mercoledi' la cassa si chiude prima (18:14): la stima lo riporta, poi si corregge a mano
    expect(s.orari[2].chiude).toBe('18:00');
    expect(s.giorniLetti).toBe(28);
  });

  it('giorno chiuso se la maggioranza delle chiusure lo segna', () => {
    const s = stimaOrariEFabbisogno(chiusure({ lunediChiuso: true }), 200, 7);
    expect(s.orari[0].chiuso).toBe(true);
    expect(s.fasce.some((f) => f.giorno === 1)).toBe(false);
  });

  it('il weekend vuole più persone, mai più di quelle in servizio, almeno una', () => {
    const s = stimaOrariEFabbisogno(chiusure(), 200, 7);
    const lun = s.fasce.find((f) => f.giorno === 1)!;
    const sab = s.fasce.find((f) => f.giorno === 6)!;
    expect(sab.persone).toBeGreaterThan(lun.persone);
    // aperto 10 ore: con 7 persone al massimo 3 tutto il giorno (3 aprono, 3 chiudono)
    expect(s.fasce.every((f) => f.persone >= 1 && f.persone <= 3)).toBe(true);
    const tetto = stimaOrariEFabbisogno(chiusure(), 1000, 4);
    // il mercoledi' chiude alle 18 (8 ore): li' un turno copre tutta la giornata, il tetto e' 4
    expect(tetto.fasce.filter((f) => f.giorno !== 3).every((f) => f.persone <= 2)).toBe(true);
    expect(tetto.fasce.find((f) => f.giorno === 3)!.persone).toBeLessThanOrEqual(4);
  });

  it('senza dati: orario standard e due persone, e lo dice', () => {
    const s = stimaOrariEFabbisogno([], 0, 0);
    expect(s.orari.every((o) => o.apre === '10:00' && o.chiude === '20:00')).toBe(true);
    expect(s.fasce.every((f) => f.persone === 2)).toBe(true);
    expect(s.spiegazione.join(' ')).toMatch(/Nessuna chiusura di cassa/);
  });

  it('oraRoma converte da UTC', () => {
    expect(oraRoma('2026-09-15T18:03:00Z')).toBe('20:03');
  });
});
