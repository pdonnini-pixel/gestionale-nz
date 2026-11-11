import { describe, it, expect, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { mediaFraNegozi } from './organicoDati';

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
