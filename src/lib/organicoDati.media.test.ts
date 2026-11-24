import { describe, it, expect, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { mediaFraNegozi, storicoProprioBasta, MESI_STORICO_PROPRIO } from './organicoDati';

describe('media del traffico fra negozi (Patrizio, 11/11/2026)', () => {
  it('fa la media dei negozi aperti quel giorno, non la somma', () => {
    const righe = [
      { data: '2026-11-03', ora: 11, ingressi: 10, outlet_id: 'a' },
      { data: '2026-11-03', ora: 11, ingressi: 20, outlet_id: 'b' },
      { data: '2026-11-03', ora: 11, ingressi: 30, outlet_id: 'c' },
      { data: '2026-11-03', ora: 12, ingressi: 6, outlet_id: 'a' },
    ];
    const m = mediaFraNegozi(righe);
    expect(m.find((x) => x.ora === 11)!.ingressi).toBe(20);
    expect(m.find((x) => x.ora === 12)!.ingressi).toBe(2);
  });
});

describe('storico proprio prima di lasciare il negozio di riferimento (Patrizio, 24/11/2026)', () => {
  const dal = (inizio: string, fine: string) => [{ data: inizio }, { data: fine }];
  it('servono 6 mesi di traffico proprio', () => {
    expect(MESI_STORICO_PROPRIO).toBe(6);
    // Roma Soratte: aperta il 5/11/2026, con il report di dicembre ha un mese
    expect(storicoProprioBasta(dal('2026-11-05', '2026-11-30'))).toBe(false);
    expect(storicoProprioBasta(dal('2026-11-05', '2027-05-04'))).toBe(false);
    expect(storicoProprioBasta(dal('2026-11-05', '2027-05-05'))).toBe(true);
  });
  it('senza traffico non basta', () => {
    expect(storicoProprioBasta([])).toBe(false);
  });
});
