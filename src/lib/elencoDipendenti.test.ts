import { describe, it, expect } from 'vitest';
import { parseElenco, confrontaElenco, badgeScadenza, outletDaFiliale, dataDalNomeFile, type DipendenteConfronto } from './elencoDipendenti';

const HEADER = ['Mtr', 'Cognome', 'Nome', 'Codice fiscale', 'Data\nassunzione', 'Qualifica', 'Livello', 'Natura rapporto', '%\npart time', 'Filiale', 'Scadenza\nTD', 'Durata\nin mesi', 'Proroghe', 'Proroghe\ndisponibili', 'Mesi disponibili\nsenza causale', 'Mesi disponibili\ncon causale', 'Stato'];

const matrix = [
  HEADER,
  [1, 'GALLO', 'MASSIMO', 'GLLMSM72S12D612X', null, null, null, null, null, 'LOC PIAN DI RONA - REGGELLO'],
  [6, 'ROSSI', 'ANNA', 'RSSNNA00A41D612X', new Date(2024, 6, 4), 'Impiegato', '4 Livello', 'Tempo indeterminato', 0.875, 'VALDICHIANA VILLAGE'],
  [43, 'BIANCHI', 'SARA', 'BNCSRA78E47E463C', new Date(2025, 6, 8), 'Impiegato', '4 Livello', 'Tempo determinato', 0.75, 'BRUGNATO', new Date(2027, 0, 31), 18.83, 3, 1, 0, 5.17, 'Prorogabile/Riassumibile'],
  [105, 'VERDI', 'LUCA', 'VRDLCU05T16D612I', new Date(2026, 9, 1), 'Operaio', '4 Livello', 'Tempo determinato', 0.6, 'LOC PIAN DI RONA - REGGELLO', new Date(2026, 11, 31), 3, 0, 4, 9, 21, 'Prorogabile/Riassumibile'],
  [102, 'NUOVA', 'GIORGIA', 'NVOGRG00B44B157A', new Date(2026, 8, 14), 'Impiegato', '4 Livello', 'Tempo determinato', 0.5, 'FRANCIACORTA VILLAGE', new Date(2026, 11, 13), 3, 0, 4, 9, 21, 'Prorogabile/Riassumibile'],
];

const dip = (p: Partial<DipendenteConfronto>): DipendenteConfronto => ({
  id: p.id || 'x', matricola: null, cognome: null, nome: null, codice_fiscale: null, data_assunzione: null, qualifica: null, livello: null,
  contratto_tipo: null, part_time_pct: null, filiale: null, scadenza_td: null, durata_mesi: null, proroghe: null, proroghe_disponibili: null,
  mesi_disp_senza_causale: null, mesi_disp_con_causale: null, stato_td: null, is_active: true, ...p,
});

describe('parseElenco', () => {
  it('legge intestazioni con a capo, matricola a 7 cifre, part time e date', () => {
    const { righe, errore } = parseElenco(matrix);
    expect(errore).toBeNull();
    expect(righe).toHaveLength(5);
    const rossi = righe.find((r) => r.cognome === 'ROSSI')!;
    expect(rossi.matricola).toBe('0000006');
    expect(rossi.partTimePct).toBe(87.5);
    expect(rossi.tipo).toBe('indeterminato');
    expect(rossi.scadenza).toBeNull();
    const bianchi = righe.find((r) => r.cognome === 'BIANCHI')!;
    expect(bianchi.scadenza).toBe('2027-01-31');
    expect(bianchi.durataMesi).toBe(18.83);
  });
  it('full time = null', () => {
    const { righe } = parseElenco([HEADER, [3, 'A', 'B', 'AAAAAA00A00A000A', new Date(2024, 5, 10), 'Impiegato', '2 Livello', 'Tempo indeterminato', 1, 'X']]);
    expect(righe[0].partTimePct).toBeNull();
  });
  it('file sbagliato: errore leggibile', () => {
    expect(parseElenco([['a', 'b']]).errore).toMatch(/intestazione/);
  });
});

describe('confrontaElenco', () => {
  const { righe } = parseElenco(matrix);
  const db = [
    dip({ id: 'g', matricola: '0000001', codice_fiscale: 'GLLMSM72S12D612X', contratto_tipo: 'amministratore' }),
    dip({ id: 'r', matricola: '0000006', codice_fiscale: 'RSSNNA00A41D612X', data_assunzione: '2024-07-04', qualifica: 'Impiegato', livello: '4 Livello', contratto_tipo: 'indeterminato', part_time_pct: null, filiale: 'VALDICHIANA VILLAGE' }),
    dip({ id: 'b', matricola: '0000043', codice_fiscale: null, data_assunzione: '2025-07-08', qualifica: 'Impiegato', livello: '4 Livello', contratto_tipo: 'determinato', part_time_pct: '75', filiale: 'BRUGNATO', scadenza_td: '2027-01-31', durata_mesi: '18.8', proroghe: 2, proroghe_disponibili: 2, mesi_disp_senza_causale: '0', mesi_disp_con_causale: '5.2', stato_td: 'Prorogabile/Riassumibile' }),
    dip({ id: 'v', matricola: '0000090', codice_fiscale: 'VRDLCU05T16D612I', data_assunzione: '2026-06-15', contratto_tipo: 'a_chiamata' }),
    dip({ id: 'm', matricola: '0000058', codice_fiscale: 'MLEFNC99B44C858X', contratto_tipo: 'determinato', scadenza_td: '2026-09-05' }),
  ];
  const esito = confrontaElenco(righe, db);
  it('aggiorna il part time e i contatori, aggancia per matricola chi non ha codice fiscale', () => {
    const rossi = esito.aggiornati.find((a) => a.dip.id === 'r')!;
    expect(rossi.differenze.map((d) => d.campo)).toEqual(['part_time_pct']);
    const bianchi = esito.aggiornati.find((a) => a.dip.id === 'b')!;
    expect(bianchi.differenze.map((d) => d.campo)).toEqual(['codice_fiscale', 'durata_mesi', 'proroghe', 'proroghe_disponibili', 'mesi_disp_con_causale']);
  });
  it('matricola nuova con assunzione successiva = nuovo rapporto', () => {
    expect(esito.nuoviRapporti.map((n) => n.dip.id)).toEqual(['v']);
  });
  it('nuovi, mancanti e amministratore', () => {
    expect(esito.nuovi.map((n) => n.cognome)).toEqual(['NUOVA']);
    expect(esito.mancanti.map((m) => m.id)).toEqual(['m']);
    expect(esito.invariati).toBe(1); // l'amministratore, senza dati da allineare
  });
});

describe('badgeScadenza', () => {
  const sett = ['2026-09-01', '2026-09-30'] as const;
  it('scaduto se la scadenza è già passata', () => {
    expect(badgeScadenza('2026-09-05', 'determinato', ...sett, '2026-10-01')).toEqual({ testo: 'scaduto il 05/09/2026', tono: 'rosso' });
  });
  it('in scadenza nel mese se non ancora passata', () => {
    expect(badgeScadenza('2026-09-23', 'determinato', ...sett, '2026-09-10')).toEqual({ testo: 'scade il 23/09/2026', tono: 'ambra' });
  });
  it('niente badge per scadenze oltre il mese o per gli indeterminati', () => {
    expect(badgeScadenza('2027-01-31', 'determinato', ...sett, '2026-10-01')).toBeNull();
    expect(badgeScadenza('2026-09-05', 'indeterminato', ...sett, '2026-10-01')).toBeNull();
  });
});

describe('outletDaFiliale e data dal nome', () => {
  const outlets = [{ id: '1', name: 'FRANCIACORTA' }, { id: '2', name: 'SEDE / MAGAZZINO', payroll_filiali: ['PIAN DI RONA'] }];
  it('riconosce la sede dalle filiali paghe e gli outlet dal nome', () => {
    expect(outletDaFiliale('LOC PIAN DI RONA - REGGELLO', outlets)?.id).toBe('2');
    expect(outletDaFiliale('FRANCIACORTA VILLAGE', outlets)?.id).toBe('1');
    expect(outletDaFiliale('MILANO', outlets)).toBeNull();
  });
  it('data del file', () => {
    expect(dataDalNomeFile('Elenco_dipendenti_01_10_2026.xlsx')).toBe('2026-10-01');
  });
});
