// Spostare e togliere una proposta e rifare i turni passano dalle funzioni del database (411,
// Patrizio 16/11/2026: «anche la HR può spostare»); dove la funzione manca resta la scrittura
// diretta, e un rifiuto del database non diventa mai una scrittura fatta di nascosto.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const finto = vi.hoisted(() => ({
  rpc: [] as { nome: string; args: unknown }[],
  risposte: new Map<string, { data?: unknown; error: { code?: string; message: string } | null }>(),
  dirette: [] as string[],
}));

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (nome: string, args: unknown) => { finto.rpc.push({ nome, args }); return Promise.resolve(finto.risposte.get(nome) ?? { data: null, error: null }); },
    from: (tabella: string) => {
      const fine = (cosa: string) => { const q = { eq: () => q, then: (ok: (r: { error: null }) => unknown) => { finto.dirette.push(`${cosa} ${tabella}`); return Promise.resolve(ok({ error: null })); } }; return q; };
      return { delete: () => fine('delete'), update: () => fine('update') };
    },
  },
}));

import { puoDecidereFerie, riscriviTurniProposti, spostaProposta, togliProposta } from './ferieInLineaDb';

const MANCA = { code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' };

beforeEach(() => { finto.rpc = []; finto.risposte = new Map(); finto.dirette = []; });

describe('proposte del piano: sposta e togli', () => {
  it('passano dalla funzione del database, senza scritture dirette', async () => {
    await spostaProposta('r1', '2026-12-10');
    await togliProposta('r1');
    expect(finto.rpc).toEqual([
      { nome: 'ferie_proposta_sposta', args: { p_request_id: 'r1', p_data: '2026-12-10' } },
      { nome: 'ferie_proposta_togli', args: { p_request_id: 'r1' } },
    ]);
    expect(finto.dirette).toEqual([]);
  });

  it('dove la funzione manca resta la scrittura diretta di prima', async () => {
    finto.risposte.set('ferie_proposta_sposta', { error: MANCA });
    finto.risposte.set('ferie_proposta_togli', { error: MANCA });
    await spostaProposta('r1', '2026-12-10');
    await togliProposta('r1');
    expect(finto.dirette).toEqual(['update leave_request_days', 'delete leave_requests']);
  });

  it('un rifiuto del database si mostra e non si aggira', async () => {
    finto.risposte.set('ferie_proposta_sposta', { error: { code: '22023', message: 'Il 12/12/2026 è un sabato, una domenica o un festivo: lì ferie e permessi non si propongono.' } });
    finto.risposte.set('ferie_proposta_togli', { error: { code: '42501', message: 'Non puoi decidere una tua richiesta: la decide chi sta sopra di te.' } });
    await expect(spostaProposta('r1', '2026-12-12')).rejects.toMatchObject({ message: expect.stringContaining('sabato') });
    await expect(togliProposta('r1')).rejects.toMatchObject({ message: expect.stringContaining('tua richiesta') });
    expect(finto.dirette).toEqual([]);
  });
});

describe('turni proposti riscritti dopo una modifica alle ferie', () => {
  const args = { planId: 'p1', date: ['2026-12-09'], turni: [{ employee_id: 'e1', data: '2026-12-09', inizio: '10:00', fine: '18:00', pausa_minuti: 30, ore_straordinario: 0 }], riepilogo: { turni: 1 } };

  it('scritti dalla funzione: fatto', async () => {
    expect(await riscriviTurniProposti(args)).toEqual({ esito: 'fatto' });
    expect(finto.rpc[0]).toEqual({ nome: 'turni_proposti_riscrivi', args: { p_plan_id: 'p1', p_date: args.date, p_turni: args.turni, p_riepilogo: args.riepilogo } });
  });

  it('funzione che manca: lo dice, decide chi chiama', async () => {
    finto.risposte.set('turni_proposti_riscrivi', { error: MANCA });
    expect(await riscriviTurniProposti(args)).toEqual({ esito: 'manca' });
  });

  it('elenco rifiutato: torna il motivo; un permesso negato resta un errore', async () => {
    finto.risposte.set('turni_proposti_riscrivi', { error: { code: '22023', message: 'Il mese è chiuso: i turni non si ricalcolano.' } });
    expect(await riscriviTurniProposti(args)).toEqual({ esito: 'rifiutata', motivo: 'Il mese è chiuso: i turni non si ricalcolano.' });
    finto.risposte.set('turni_proposti_riscrivi', { error: { code: '42501', message: 'I turni proposti li rifà chi gestisce i turni o chi può decidere le ferie.' } });
    await expect(riscriviTurniProposti(args)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('chi può decidere le ferie', () => {
  it('vero solo se il database dice vero; un errore vale no', async () => {
    finto.risposte.set('posso_decidere_ferie', { data: true, error: null });
    expect(await puoDecidereFerie()).toBe(true);
    finto.risposte.set('posso_decidere_ferie', { data: null, error: { message: 'no' } });
    expect(await puoDecidereFerie()).toBe(false);
  });
});
