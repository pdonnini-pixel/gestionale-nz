import { describe, it, expect } from 'vitest';
import { righeSaldi, righeGiorni, righeRiepilogo, intestazioneGiorni, INTESTAZIONE_RIEPILOGO, valeIlRiepilogo, notaOrario, notaSaldi, nomeFoglio, nomeFileModulo, type ModuloFerie } from './ferieExport';
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
  // Chi riceve il foglio non sa cosa sia una «voce» né un «tipo»: le
  // intestazioni sono domande, e la prima riga è un esempio compilato.
  it('il foglio da compilare fa domande, non nomi di campo', () => {
    const i = intestazioneGiorni(modulo());
    expect(i).toEqual(['Dal giorno', 'Al giorno', 'Ferie o permesso?', 'Tutto il giorno, mezza giornata o quante ore?', 'Note']);
    expect(i.join(' ')).not.toMatch(/voce|tipo/i);
  });

  it('la prima riga è un esempio già compilato, poi righe bianche', () => {
    const r = righeGiorni(modulo());
    expect(r[0][0]).toMatch(/^es\. /);
    expect(r[0][2]).toBe('Ferie');
    expect(r[0][3]).toBe('Tutto il giorno');
    expect(r).toHaveLength(13);          // l'esempio più le dodici da riempire
    expect(r[1]).toEqual(['', '', '', '', '']);
  });

  it('quante righe bianche lo decide chi stampa', () => {
    expect(righeGiorni(modulo({ righeVuote: 20 }))).toHaveLength(21);
  });

  it('la ricevuta ha le sue intestazioni, un giorno per riga', () => {
    const m = modulo({ giorni: [giorno('2026-10-05')] });
    expect(intestazioneGiorni(m)).toEqual(['Giorno', 'Ferie o permesso', 'Quanto', 'Ore', 'Note']);
  });

  it('con i giorni scelti li mette in ordine di data', () => {
    const r = righeGiorni(modulo({ giorni: [giorno('2026-10-06'), giorno('2026-10-05')] }));
    expect(r[0][0]).toContain('05/10/2026');
    expect(r[1][0]).toContain('06/10/2026');
  });

  it('dice quanto in italiano parlato, e le ore restano in colonna', () => {
    const r = righeGiorni(modulo({ giorni: [giorno('2026-10-05')] }));
    expect(r[0][1]).toBe('Ferie');
    expect(r[0][2]).toBe('Tutto il giorno');
    expect(r[0][3]).toBe('6,00 h');
  });

  it('le ore stanno nella loro colonna, non scritte due volte', () => {
    const r = righeGiorni(modulo({ giorni: [giorno('2026-10-05', { tipo: 'ore', ore: 2, voce: 'F03' })] }));
    expect(r[0][1]).toBe('ROL');
    expect(r[0][2]).toBe('Alcune ore');
    expect(r[0][3]).toBe('2,00 h');
  });
});

describe('riepilogo per periodi', () => {
  it('nemmeno qui compaiono «voce» e «tipo»', () => {
    expect(INTESTAZIONE_RIEPILOGO.join(' ')).not.toMatch(/voce|tipo/i);
  });

  it('si stampa solo quando accorcia davvero', () => {
    const tre = ['2026-10-05', '2026-10-06', '2026-10-07'].map((d) => giorno(d));
    expect(valeIlRiepilogo(modulo({ giorni: tre }))).toBe(true);      // tre giorni, una riga
    const sparsi = ['2026-10-05', '2026-10-08', '2026-10-12'].map((d) => giorno(d));
    expect(valeIlRiepilogo(modulo({ giorni: sparsi }))).toBe(false);  // tre righe uguali a prima
    expect(valeIlRiepilogo(modulo({ giorni: [giorno('2026-10-05')] }))).toBe(false);
  });
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

describe('il modulo lo legge il dipendente', () => {
  // Quello che sta dietro al numero (il tabulato delle paghe, i valori
  // dedotti, il gestionale stesso) è roba nostra e resta a video, nella
  // pagina dell'amministrazione. Sul foglio che va alla persona ci sono le
  // sue ore e la data a cui sono aggiornate, punto.
  const VIETATE = /paghe|tabulato|gestionale|dedott|da confermare|anagrafica|ripiego/i;

  const tuttoIlTesto = (m: ModuloFerie) => [
    notaOrario(m.dipendente),
    notaSaldi(m),
    ...intestazioneGiorni(m),
    ...righeSaldi(m).flat(),
    ...righeGiorni(m).flat(),
    ...righeRiepilogo(m).flat(),
  ].join(' | ');

  it('nessuna parola interna nel modulo da compilare', () => {
    expect(tuttoIlTesto(modulo())).not.toMatch(VIETATE);
  });

  it('nessuna parola interna nel riepilogo di una richiesta', () => {
    const m = modulo({ giorni: [giorno('2026-10-05'), giorno('2026-10-06')], stato: 'Inviata, in attesa di risposta' });
    expect(tuttoIlTesto(m)).not.toMatch(VIETATE);
  });

  it('nemmeno quando l\'orario è di ripiego', () => {
    const m = modulo({ dipendente: { ...modulo().dipendente, oreSettimanali: null, oreGiornata: 8, fonteOrario: 'ripiego' } });
    expect(tuttoIlTesto(m)).not.toMatch(VIETATE);
    expect(notaOrario(m.dipendente)).toBe('Orario settimanale da indicare');
  });

  it('l\'orario si legge come lo legge la persona: settimana e giornata', () => {
    expect(notaOrario(modulo().dipendente)).toBe('30 ore a settimana · una giornata vale 6,00 h');
  });

  it('i saldi portano la data a cui sono aggiornati', () => {
    expect(notaSaldi(modulo())).toBe('Ore disponibili aggiornate al 31/08/2026, al netto delle richieste già presentate.');
  });

  it('senza saldo non si inventa una data', () => {
    expect(notaSaldi(modulo({ saldi: [] }))).toMatch(/non indicate/);
  });
});
