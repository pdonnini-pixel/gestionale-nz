import { describe, it, expect } from 'vitest';
import { righeSaldi, righeGiorni, righeRiepilogo, nomeFoglio, nomeFileModulo, type ModuloFerie } from './ferieExport';
import type { DisponibilitaVoce, GiornoRichiesto } from './ferieRichiesta';

const saldo = (voce: DisponibilitaVoce['voce'], over: Partial<DisponibilitaVoce> = {}): DisponibilitaVoce => ({
  voce,
  residuo: 48,
  da_fruire: 72,
  ore_in_attesa: 0,
  ore_approvate: 0,
  ore_in_bozza: 0,
  residuo_disponibile: 48,
  da_fruire_disponibile: 72,
  saldo_alla_data: '2026-08-31',
  ore_giornata_dedotte: 6,
  ore_settimanali_dedotte: 30,
  ...over,
});

const modulo = (over: Partial<ModuloFerie> = {}): ModuloFerie => ({
  azienda: 'New Zago',
  dipendente: {
    nominativo: 'Rossi Maria',
    matricola: '0000012',
    outlet: 'Reggello',
    oreSettimanali: 30,
    oreGiornata: 6,
    fonteOrario: 'paghe',
  },
  saldi: [saldo('F01'), saldo('F02', { residuo: 8, da_fruire: 8, residuo_disponibile: 8, da_fruire_disponibile: 8 })],
  giorni: [],
  periodoTabulato: 'Agosto 2026',
  ...over,
});

const giorno = (data: string, over: Partial<GiornoRichiesto> = {}): GiornoRichiesto => ({
  data, voce: 'F01', tipo: 'giornata', ore: 6, ...over,
});

describe('tabella dei saldi', () => {
  it('ha sempre le tre voci, anche quelle senza saldo', () => {
    const r = righeSaldi(modulo());
    expect(r.map((x) => x[0])).toEqual(['Ferie', 'Permessi ex festività', 'Permessi ROL']);
    expect(r[2][1]).toBe('—');            // ROL: nessun saldo, niente numeri inventati
  });

  it('converte in giornate con l\'orario della persona', () => {
    expect(righeSaldi(modulo())[0][2]).toBe('8');   // 48 ore / 6 = 8 giornate
  });

  it('mostra nell\'ultima colonna quanto chiede questa richiesta', () => {
    const r = righeSaldi(modulo({ giorni: [giorno('2026-10-05'), giorno('2026-10-06')] }));
    expect(r[0][5]).toBe('12,00 h');
  });
});

describe('tabella dei giorni', () => {
  it('senza giorni esce il modulo da compilare, con righe bianche', () => {
    const r = righeGiorni(modulo());
    expect(r).toHaveLength(12);
    expect(r[0]).toEqual(['', '', '', '', '']);
  });

  it('quante righe bianche lo decide chi stampa', () => {
    expect(righeGiorni(modulo({ righeVuote: 20 }))).toHaveLength(20);
  });

  it('con i giorni scelti li mette in ordine di data', () => {
    const r = righeGiorni(modulo({ giorni: [giorno('2026-10-06'), giorno('2026-10-05')] }));
    expect(r[0][0]).toContain('05/10/2026');
    expect(r[1][0]).toContain('06/10/2026');
  });

  it('scrive il tipo e la voce per esteso', () => {
    const r = righeGiorni(modulo({ giorni: [giorno('2026-10-05', { tipo: 'ore', ore: 2, voce: 'F03' })] }));
    expect(r[0][1]).toBe('Permesso a ore');
    expect(r[0][2]).toBe('ROL');
    expect(r[0][3]).toBe('2,00 h');
  });
});

describe('riepilogo per periodi', () => {
  it('unisce i giorni consecutivi in una riga sola', () => {
    const r = righeRiepilogo(modulo({
      giorni: [giorno('2026-10-05'), giorno('2026-10-06'), giorno('2026-10-07')],
    }));
    expect(r).toHaveLength(1);
    expect(r[0][0]).toBe('dal 05/10/2026 al 07/10/2026');
    expect(r[0][3]).toBe('3');
  });

  it('un giorno solo resta un giorno solo', () => {
    expect(righeRiepilogo(modulo({ giorni: [giorno('2026-10-05')] }))[0][0]).toBe('05/10/2026');
  });
});

describe('nomi dei file e dei fogli', () => {
  it('il file porta il nome della persona', () => {
    expect(nomeFileModulo(modulo(), 'pdf')).toMatch(/^Richiesta_ferie_Rossi_Maria_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('più persone insieme fanno un file solo', () => {
    expect(nomeFileModulo([modulo(), modulo()], 'xlsx')).toMatch(/^Richieste_ferie_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('il foglio Excel sta nei 31 caratteri e toglie i simboli vietati', () => {
    const n = nomeFoglio('De Angelis / Maria Antonietta [socia]', new Set());
    expect(n.length).toBeLessThanOrEqual(31);
    expect(n).not.toMatch(/[\\/?*[\]:]/);
  });

  it('due omonimi non si sovrascrivono', () => {
    const usati = new Set<string>();
    const a = nomeFoglio('Rossi Maria', usati);
    const b = nomeFoglio('Rossi Maria', usati);
    expect(a).not.toBe(b);
  });
});
