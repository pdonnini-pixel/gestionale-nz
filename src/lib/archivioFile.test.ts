import { describe, it, expect } from 'vitest';
import { periodoDalNomeFile } from './archivioFile';

describe('periodoDalNomeFile', () => {
  it('legge la data compatta con anno davanti', () => {
    expect(periodoDalNomeFile('estratto_20260918.pdf')).toEqual({ year: 2026, month: 9 });
  });

  it('legge mese e anno attaccati, come li scrive Paghe Infinity', () => {
    expect(periodoDalNomeFile('Dal 062026 Cedolino aggiuntivo 1 al 062026 Mensilità normale Filiale.pdf'))
      .toEqual({ year: 2026, month: 6 });
  });

  it('legge il mese scritto a parole', () => {
    expect(periodoDalNomeFile('PRIMA NOTA NEW ZAGO LUGLIO 2026.xlsx')).toEqual({ year: 2026, month: 7 });
    expect(periodoDalNomeFile('ratei_agosto_2026.pdf')).toEqual({ year: 2026, month: 8 });
  });

  it('legge anno-mese separati, nei due ordini', () => {
    expect(periodoDalNomeFile('Elenco netti di 07-2026 Mensilità normale.pdf')).toEqual({ year: 2026, month: 7 });
    expect(periodoDalNomeFile('report 2026-03.csv')).toEqual({ year: 2026, month: 3 });
  });

  it('con il solo anno torna l anno e nessun mese', () => {
    expect(periodoDalNomeFile('Bilancio 2025.pdf')).toEqual({ year: 2025, month: null });
  });

  // Meglio nessun periodo che un periodo sbagliato: un documento datato male
  // finisce sotto il mese di un altro e sporca i conti di chi lo cerca.
  it('non inventa un periodo quando nel nome non c e', () => {
    expect(periodoDalNomeFile('BASE_DI_CALCOLO_NEW ZAGO.pdf')).toBeNull();
    expect(periodoDalNomeFile('Fer_Perm_Importo.pdf')).toBeNull();
    expect(periodoDalNomeFile('NEW ZAGO SRL_Situazione ratei di ferie e permessi - Quantità.pdf')).toBeNull();
    expect(periodoDalNomeFile('contratto_affitto.pdf')).toBeNull();
    expect(periodoDalNomeFile('')).toBeNull();
  });

  it('non scambia per data un numero qualsiasi', () => {
    expect(periodoDalNomeFile('fattura 1234567.pdf')).toBeNull();
    expect(periodoDalNomeFile('doc 1899.pdf')).toBeNull();
  });
});
