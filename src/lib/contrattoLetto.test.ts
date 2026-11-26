import { describe, it, expect } from 'vitest';
import { normalizzaLettura, confrontaContratto, nominativoTorna, livelloScheda, qualificaScheda, valoriDaScrivere, notaContratto, valoriOre, dataEffettiva, type SchedaContratto } from './contrattoLetto';

const OGGI = '2026-11-26';

// La lettera di assunzione firmata di una dipendente (caso del 26/11/2026), dati inventati.
const LETTERA = {
  eRapporto: true, tipoDocumento: 'assunzione', dataDocumento: '2026-11-23', decorrenza: '2026-11-27',
  nominativo: 'ROSSI MARIA', codiceFiscale: 'RSSMRA98L63F656N', contrattoTipo: 'determinato',
  dataInizio: '2026-11-27', dataFine: '2027-02-26', oreSettimanali: 30, fullTime: false,
  livello: '4', qualifica: 'impiegato', mansione: 'COMMESSA DI NEGOZIO', firmato: true,
};

const SCHEDA: SchedaContratto = {
  nome: 'MARIA', cognome: 'ROSSI',
  codice_fiscale: 'RSSMRA98L63F656N', contratto_tipo: 'determinato', data_assunzione: '2026-11-27', hire_date: '2026-11-27',
  scadenza_td: '2027-02-26', ore_settimanali: 30, part_time_pct: 75, livello: '4 Livello', qualifica: 'Impiegato', role_description: 'Commessa di negozio',
};

describe('normalizzaLettura', () => {
  it('pulisce date, codice fiscale, livello e qualifica', () => {
    const l = normalizzaLettura({ ...LETTERA, codiceFiscale: 'rssmra 98l63 f656n', dataFine: '2027-02-30', livello: 'IV', qualifica: 'IMPIEGATA' });
    expect(l.codiceFiscale).toBe('RSSMRA98L63F656N');
    expect(l.dataFine).toBeNull();
    expect(l.livello).toBe('4 Livello');
    expect(l.qualifica).toBe('Impiegato');
    expect(l.contrattoTipo).toBe('determinato');
  });
  it('full time senza ore = 40; ore fuori misura = null; tipo sconosciuto = altro', () => {
    expect(normalizzaLettura({ eRapporto: true, fullTime: true }).oreSettimanali).toBe(40);
    expect(normalizzaLettura({ eRapporto: true, oreSettimanali: 300 }).oreSettimanali).toBeNull();
    expect(normalizzaLettura({ eRapporto: true, tipoDocumento: 'boh' }).tipoDocumento).toBe('altro');
    expect(normalizzaLettura(null).eRapporto).toBe(false);
  });
  it('intermittente = a chiamata, apprendistato segnato a parte', () => {
    expect(normalizzaLettura({ contrattoTipo: 'Intermittente' }).contrattoTipo).toBe('a_chiamata');
    const a = normalizzaLettura({ contrattoTipo: 'apprendistato professionalizzante' });
    expect(a.contrattoTipo).toBeNull();
    expect(a.apprendistato).toBe(true);
  });
});

describe('livelloScheda e qualificaScheda', () => {
  it.each([['4', '4 Livello'], ['4°', '4 Livello'], ['IV livello', '4 Livello'], ['quarto', '4 Livello'], ['Quadro', 'Quadro'], ['', null]])('%s → %s', (a, b) => {
    expect(livelloScheda(a)).toBe(b);
  });
  it('qualifica al maschile come nella scheda', () => {
    expect(qualificaScheda('operaia')).toBe('Operaio');
    expect(qualificaScheda('commessa')).toBeNull();
  });
});

describe('confrontaContratto', () => {
  it('scheda già uguale: allineata, niente da scrivere', () => {
    const e = confrontaContratto(SCHEDA, normalizzaLettura(LETTERA), OGGI);
    expect(e.stato).toBe('allineata');
  });

  it('campi vuoti si riempiono da soli, valori diversi chiedono conferma', () => {
    const e = confrontaContratto({ ...SCHEDA, codice_fiscale: null, role_description: null, scadenza_td: '2027-01-31', ore_settimanali: 24, part_time_pct: 60 }, normalizzaLettura(LETTERA), OGGI);
    expect(e.stato).toBe('da_scrivere');
    if (e.stato !== 'da_scrivere') return;
    expect(e.riempimenti.map((c) => c.campo)).toEqual(['role_description']);
    expect(e.sostituzioni.map((c) => c.campo).sort()).toEqual(['codice_fiscale', 'ore_settimanali', 'scadenza_td']);
    expect(valoriDaScrivere(e.sostituzioni.filter((c) => c.campo !== 'codice_fiscale'))).toEqual({ scadenza_td: '2027-02-26', ore_settimanali: 30, part_time_pct: 75 });
    expect(e.riempimenti.find((c) => c.campo === 'role_description')?.dopo).toBe('Commessa di negozio');
  });

  it('codice fiscale diverso: non tocca niente', () => {
    const e = confrontaContratto({ ...SCHEDA, codice_fiscale: 'BNCLRA90A41H501X', ore_settimanali: 20 }, normalizzaLettura(LETTERA), OGGI);
    expect(e.stato).toBe('altra_persona');
  });

  it('documento più vecchio di un altro archiviato: storico', () => {
    const e = confrontaContratto({ ...SCHEDA, scadenza_td: '2027-05-31' }, normalizzaLettura({ ...LETTERA, dataDocumento: '2026-01-10', decorrenza: '2026-01-15' }), OGGI, ['2026-11-27']);
    expect(e.stato).toBe('storico');
  });

  it('stessa data di un altro documento (lettera non firmata e firmata): vale', () => {
    const e = confrontaContratto({ ...SCHEDA, scadenza_td: '2027-01-31' }, normalizzaLettura(LETTERA), OGGI, ['2026-11-27']);
    expect(e.stato).toBe('da_scrivere');
  });

  it('proroga: cambia solo la scadenza, non l\'assunzione', () => {
    const e = confrontaContratto(SCHEDA, normalizzaLettura({ eRapporto: true, tipoDocumento: 'proroga', dataDocumento: '2027-02-20', decorrenza: '2027-02-27', contrattoTipo: 'determinato', dataInizio: '2027-02-27', dataFine: '2027-08-26' }), OGGI);
    expect(e.stato).toBe('da_scrivere');
    if (e.stato !== 'da_scrivere') return;
    expect(e.sostituzioni.map((c) => c.campo)).toEqual(['scadenza_td']);
  });

  it('trasformazione in indeterminato toglie la scadenza', () => {
    const e = confrontaContratto(SCHEDA, normalizzaLettura({ eRapporto: true, tipoDocumento: 'trasformazione', dataDocumento: '2026-11-20', decorrenza: '2026-11-25', contrattoTipo: 'indeterminato' }), OGGI);
    if (e.stato !== 'da_scrivere') throw new Error(e.stato);
    expect(e.sostituzioni.map((c) => c.campo)).toEqual(['contratto_tipo', 'scadenza_td']);
    expect(valoriDaScrivere(e.sostituzioni)).toEqual({ contratto_tipo: 'indeterminato', scadenza_td: null });
  });

  it('modifica d\'orario che vale da una data futura: rinviata, la scheda non cambia oggi', () => {
    const e = confrontaContratto(SCHEDA, normalizzaLettura({ eRapporto: true, tipoDocumento: 'modifica_orario', dataDocumento: '2026-11-20', decorrenza: '2026-12-01', oreSettimanali: 36 }), OGGI);
    expect(e.stato).toBe('allineata');
    if (e.stato !== 'allineata') return;
    expect(e.rinviati.map((c) => c.campo)).toEqual(['ore_settimanali']);
    expect(e.testo).toContain('01/12/2026');
  });

  it('amministratore: il tipo di contratto non si tocca', () => {
    const e = confrontaContratto({ ...SCHEDA, contratto_tipo: 'amministratore' }, normalizzaLettura(LETTERA), OGGI);
    expect(e.stato).toBe('allineata');
  });

  it('cessazione: propone la data di fine, non le ore', () => {
    const e = confrontaContratto(SCHEDA, normalizzaLettura({ eRapporto: true, tipoDocumento: 'cessazione', dataDocumento: '2026-11-20', dataCessazione: '2026-12-15', oreSettimanali: 30 }), OGGI);
    if (e.stato !== 'da_scrivere') throw new Error(e.stato);
    expect(valoriDaScrivere(e.sostituzioni)).toEqual({ data_cessazione: '2026-12-15', termination_date: '2026-12-15' });
  });

  it('documento che non è del rapporto', () => {
    expect(confrontaContratto(SCHEDA, normalizzaLettura({ eRapporto: false }), OGGI).stato).toBe('non_rapporto');
  });
});

describe('identità della persona (revisore sicurezza)', () => {
  it('scheda senza codice fiscale e documento di un\'altra persona: non tocca niente', () => {
    const e = confrontaContratto({ ...SCHEDA, codice_fiscale: null, role_description: null }, normalizzaLettura({ ...LETTERA, nominativo: 'BIANCHI LAURA', codiceFiscale: 'BNCLRA90A41H501X' }), OGGI);
    expect(e.stato).toBe('altra_persona');
  });
  it('codice fiscale vuoto in scheda: si propone ma va confermato', () => {
    const e = confrontaContratto({ ...SCHEDA, codice_fiscale: null }, normalizzaLettura(LETTERA), OGGI);
    if (e.stato !== 'da_scrivere') throw new Error(e.stato);
    expect(e.riempimenti).toEqual([]);
    expect(e.sostituzioni.map((c) => c.campo)).toEqual(['codice_fiscale']);
  });
  it('cessazione su scheda senza data: va confermata', () => {
    const e = confrontaContratto(SCHEDA, normalizzaLettura({ eRapporto: true, tipoDocumento: 'cessazione', nominativo: 'Rossi Maria', dataCessazione: '2026-12-15' }), OGGI);
    if (e.stato !== 'da_scrivere') throw new Error(e.stato);
    expect(e.riempimenti).toEqual([]);
    expect(e.sostituzioni.map((c) => c.campo)).toEqual(['data_cessazione']);
  });
  it('senza codice fiscale né nominativo: niente si scrive da solo', () => {
    const e = confrontaContratto({ ...SCHEDA, role_description: null }, normalizzaLettura({ ...LETTERA, codiceFiscale: null, nominativo: null }), OGGI);
    if (e.stato !== 'da_scrivere') throw new Error(e.stato);
    expect(e.riempimenti).toEqual([]);
    expect(e.sostituzioni.map((c) => c.campo)).toEqual(['role_description']);
  });
  it('nominativo: cognome obbligatorio, nome almeno in parte, accenti e ordine non contano', () => {
    expect(nominativoTorna('Maria Rossi', 'ROSSI', 'MARIA')).toBe(true);
    expect(nominativoTorna('ROSSI MARIA', 'Rossi', 'Maria Chiara')).toBe(true);
    expect(nominativoTorna('DE LUCA ANNA', 'De Luca', 'Anna')).toBe(true);
    expect(nominativoTorna('ROSSI GIULIA', 'ROSSI', 'MARIA')).toBe(false);
    expect(nominativoTorna(null, 'ROSSI', 'MARIA')).toBeNull();
  });
});

describe('supporto', () => {
  it('ore: full time scrive part time null', () => {
    expect(valoriOre(40)).toEqual({ ore_settimanali: 40, part_time_pct: null });
    expect(valoriOre(34)).toEqual({ ore_settimanali: 34, part_time_pct: 85 });
  });
  it('data effettiva: la più recente fra documento e decorrenza', () => {
    expect(dataEffettiva({ dataDocumento: '2026-11-23', decorrenza: '2026-11-27' })).toBe('2026-11-27');
    expect(dataEffettiva({ dataDocumento: null, decorrenza: null }, '2026-11-01')).toBe('2026-11-01');
  });
  it('nota datata con il nome del file', () => {
    const l = normalizzaLettura(LETTERA);
    const e = confrontaContratto({ ...SCHEDA, scadenza_td: '2027-01-31' }, l, OGGI);
    if (e.stato !== 'da_scrivere') throw new Error(e.stato);
    expect(notaContratto(OGGI, 'Contratto.pdf', l, e.sostituzioni)).toBe('[26/11/2026] Allineata al documento «Contratto.pdf» (lettera di assunzione del 23/11/2026, letto dal gestionale): scadenza 31/01/2027 -> 26/02/2027.');
  });
});
