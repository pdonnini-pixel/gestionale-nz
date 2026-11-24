import { describe, expect, it } from 'vitest';
import { dataDalNome, dataDelGruppo, descrizioneDalNome, riconosciDocumento, tipoDalNome } from './documentiRapporto';

// Nomi veri dello zip dello studio paghe per un'assunzione a Zago (11/2026).
const ZIP = [
  '2026-11-27_Lignoli_lettera-assunzione-TD-PT.pdf',
  '2026-11-27_Lignoli_detassazione-maggiorazioni.pdf',
  '2026-11-27_Lignoli_detassazione-rinnovi.pdf',
  '2026-11-27_Lignoli_dichiarazione-sostitutiva.pdf',
  '2026-11-27_Lignoli_informativa-privacy.pdf',
  '2026-11-27_Lignoli_informativa-TFR.pdf',
  '2026-11-27_Lignoli_modulo-detrazioni.pdf',
  '2026-11-27_Lignoli_modulo-TFR3.pdf',
  '2026-11-27_Lignoli_trattamento-integrativo.pdf',
  'Informativa CCNL Commercio.pdf',
];

describe('documenti del rapporto dal nome del file', () => {
  it('legge la data in tutti e due i formati', () => {
    expect(dataDalNome(ZIP[0])).toBe('2026-11-27');
    expect(dataDalNome('proroga 05.03.2027.pdf')).toBe('2027-03-05');
    expect(dataDalNome('Informativa CCNL Commercio.pdf')).toBeNull();
  });

  it('riconosce i tipi dello zip', () => {
    expect(ZIP.map(tipoDalNome)).toEqual([
      'contratto', 'modulo_fiscale', 'modulo_fiscale', 'modulo_fiscale', 'informativa',
      'informativa', 'modulo_fiscale', 'modulo_fiscale', 'modulo_fiscale', 'informativa',
    ]);
    expect(tipoDalNome('proroga_rossi.pdf')).toBe('proroga');
    expect(tipoDalNome('scansione123.pdf')).toBe('altro');
  });

  it('scrive una descrizione leggibile senza data e cognome', () => {
    expect(descrizioneDalNome(ZIP[7], 'LIGNOLI')).toBe('Modulo TFR3');
    expect(descrizioneDalNome(ZIP[0], 'Lignoli')).toBe('Lettera assunzione TD PT');
    expect(descrizioneDalNome(ZIP[9], 'Lignoli')).toBe('Informativa CCNL Commercio');
  });

  it('un file senza data prende quella degli altri file del caricamento', () => {
    const g = dataDelGruppo(ZIP);
    expect(g).toBe('2026-11-27');
    const r = riconosciDocumento(ZIP[9], { dataGruppo: g, cognome: 'Lignoli' });
    expect(r).toMatchObject({ data: '2026-11-27', dataDa: 'gruppo', tipo: 'informativa' });
  });

  it('il tipo scelto a mano vince sul nome, la data del nome vince su quella scelta', () => {
    const r = riconosciDocumento(ZIP[1], { tipoScelto: 'altro', dataScelta: '2026-01-01' });
    expect(r.tipo).toBe('altro');
    expect(r.data).toBe('2026-11-27');
    expect(riconosciDocumento('x.pdf', { dataScelta: '2026-01-01' })).toMatchObject({ data: '2026-01-01', dataDa: 'scelta' });
  });
});
