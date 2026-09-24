import { describe, it, expect } from 'vitest';
import { righeSaldi, INTESTAZIONE_SALDI, righeGiorni, righeRiepilogo, intestazioneGiorni, INTESTAZIONE_RIEPILOGO, valeIlRiepilogo, notaOrario, notaSaldi, nomeFoglio, nomeFileModulo, type ModuloFerie } from './ferieExport';
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

// Una commessa ragiona a giornata, mezza giornata o poche ore di permesso.
// Le ore con la virgola, le tre voci delle paghe e il totale maturabile sono
// contabilita' nostra: qui dentro non ci devono stare.
describe('tabella dei saldi', () => {
  it('ha due righe sole: ferie e permessi', () => {
    expect(righeSaldi(modulo()).map((x) => x[0])).toEqual(['Ferie', 'Permessi']);
  });

  // Finche' non sappiamo quanti giorni a settimana lavora una persona, le
  // giornate non si dicono: la «giornata» delle paghe e' l'orario settimanale
  // diviso cinque, e su un part time corto non e' nessun giorno di negozio.
  it('senza i giorni lavorati parla solo di ore', () => {
    expect(righeSaldi(modulo())[0][1]).toBe('48,00 ore');
  });

  it('il caso vero di Falchi: ore, non cinque giornate inesistenti', () => {
    // 8 ore a settimana. Le paghe le spalmano su cinque giorni e ne esce una
    // «giornata» da 1 ora e 36 minuti: 5,4 di quelle. Ma se in negozio ci va
    // un giorno solo, quelle 8,65 ore sono UN giorno, non cinque.
    const m = modulo({
      dipendente: { ...modulo().dipendente, oreSettimanali: 8, oreGiornata: 1.6 },
      saldi: [saldo('F01', { residuo: 8.65, residuo_disponibile: 8.65 })],
    });
    expect(righeSaldi(m)[0][1]).toBe('8,65 ore');
    expect(righeSaldi(m)[0][1]).not.toMatch(/giornat/);
  });

  it('con i giorni lavorati le giornate tornano vere', () => {
    // Stessa persona, ma sappiamo che lavora un giorno a settimana: la sua
    // giornata vale 8 ore, e 8,65 h sono una giornata, non cinque.
    const m = modulo({
      dipendente: { ...modulo().dipendente, oreSettimanali: 8, oreGiornata: 1.6, giorniSettimana: 1 },
      saldi: [saldo('F01', { residuo: 8.65, residuo_disponibile: 8.65 })],
    });
    expect(righeSaldi(m)[0][1]).toBe('1 giornata');
  });

  it('somma le due borse di permessi e le dice in ore', () => {
    const m = modulo({
      saldi: [
        saldo('F01'),
        saldo('F02', { residuo: 1.6, residuo_disponibile: 1.6 }),
        saldo('F03', { residuo: 2.5, residuo_disponibile: 2.5 }),
      ],
    });
    expect(righeSaldi(m)[1][1]).toBe('4,10 ore');
  });

  it('senza saldo non inventa numeri', () => {
    const m = modulo({ saldi: [saldo('F01')] });
    expect(righeSaldi(m)[1][1]).toBe('—');
  });

  it('dice anche quanto toglie questa richiesta, nella stessa unità', () => {
    const r = righeSaldi(modulo({ giorni: [giorno('2026-10-05'), giorno('2026-10-06')] }));
    expect(r[0][2]).toBe('12,00 ore');
  });

  it('non promette giornate che nella settimana di quella persona non esistono', () => {
    const m = modulo({
      dipendente: { ...modulo().dipendente, oreSettimanali: 8, oreGiornata: 1.6 },
      saldi: [saldo('F02', { residuo: 1.6, residuo_disponibile: 1.6 })],
    });
    expect(righeSaldi(m)[1][1]).toBe('1,60 ore');
    expect(righeSaldi(m).flat().join(' ')).not.toMatch(/giornata intera/);
  });

  it('nelle intestazioni non ci sono ore, scadenze né totali', () => {
    expect(INTESTAZIONE_SALDI.join(' ')).not.toMatch(/ore|fine anno|maturab|scad/i);
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
    // Non «ROL»: per chi compila e' un permesso, e quale borsa si scala lo
    // decide l'ufficio.
    expect(r[0][1]).toBe('Permesso');
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

  it('l\'orario dice la settimana del contratto, non quanto vale una giornata', () => {
    // «una giornata vale 1,60 h» e' il conto che serve al gestionale per
    // scalare il saldo. A chi compila confonde e non serve: lei chiede
    // giornate, non ore.
    expect(notaOrario(modulo().dipendente)).toBe('30 ore a settimana');
    expect(notaOrario(modulo().dipendente)).not.toMatch(/giornata vale/);
  });

  it('i saldi portano la data a cui sono aggiornati', () => {
    expect(notaSaldi(modulo())).toBe('Aggiornate al 31/08/2026, al netto delle richieste che hai già presentato.');
  });

  it('senza saldo non si inventa una data', () => {
    expect(notaSaldi(modulo({ saldi: [] }))).toMatch(/non disponibile/);
  });
});
