import { describe, it, expect } from 'vitest';
import {
  chiave, eVuotoOSegnaposto, inChiaro, reaPulito, valoriDaVisura, confrontaScheda,
  confrontaSedi, stessoIndirizzo, type VisuraLetta, type OutletSede,
} from './visura';

// Dati inventati: una società di prova con due unità locali.
const visura = (over: Partial<VisuraLetta> = {}): VisuraLetta => ({
  dataEstrazione: '2026-04-22',
  ragioneSociale: 'ALFA PROVA S.R.L.',
  partitaIva: '01234567890',
  codiceFiscale: '01234567890',
  formaGiuridica: "societa' a responsabilita' limitata",
  rea: 'FI - 111222',
  sedeLegale: { indirizzo: 'VIA IX FEBBRAIO 7', cap: '50129', comune: 'FIRENZE', provincia: 'FI' },
  pec: 'alfaprova@legalmail.it',
  capitaleSottoscritto: 10000,
  capitaleVersato: 10000,
  dataCostituzione: '2024-04-17',
  ateco: { codice: '47.71.10', descrizione: 'commercio al dettaglio di articoli di abbigliamento per adulti' },
  amministratore: { nome: 'ROSSI MARIO', carica: 'amministratore unico', codiceFiscale: 'RSSMRA70A01D612X' },
  soci: [
    { nome: 'BETA S.R.L.', codiceFiscale: '09876543210', quotaPct: 55 },
    { nome: 'GAMMA S.A.S.', codiceFiscale: '01122334455', quotaPct: 45 },
  ],
  unitaLocali: [
    { numero: 'FI/1', tipo: 'Negozio', insegna: 'PROVA', indirizzo: 'VIA MEUCCI 31', cap: '50031', comune: 'BARBERINO DI MUGELLO', provincia: 'FI', rea: null, dataApertura: '2025-03-26' },
    { numero: 'FI/3', tipo: 'Magazzino', insegna: null, indirizzo: 'VIA PIAN DI ROMA 120/B', cap: '50066', comune: 'REGGELLO', provincia: 'FI', rea: null, dataApertura: '2026-02-05' },
    { numero: 'FI/2', tipo: 'Ufficio', insegna: null, indirizzo: 'VIA BORRATINO 50', cap: '50063', comune: 'FIGLINE E INCISA VALDARNO', provincia: 'FI', rea: null, dataApertura: null },
    { numero: 'AR/1', tipo: 'Negozio', insegna: null, indirizzo: 'VIA ENZO FERRARI 5', cap: '52045', comune: 'FOIANO DELLA CHIANA', provincia: 'AR', rea: 'AR - 220128', dataApertura: '2024-06-13' },
  ],
  ...over,
});

const azienda = { partitaIva: '01234567890', nome: 'Alfa Prova' };

describe('formati', () => {
  it('scrive i nomi in chiaro tenendo i numeri romani', () => {
    expect(inChiaro('VIA IX FEBBRAIO 7')).toBe('Via IX Febbraio 7');
    expect(inChiaro('BARBERINO DI MUGELLO')).toBe('Barberino di Mugello');
    expect(inChiaro('VIA DELLA PACE SNC')).toBe('Via della Pace snc');
    expect(inChiaro('VIA PIAN DI ROMA 120/B')).toBe('Via Pian di Roma 120/B');
  });
  it('riconosce segnaposto e vuoti', () => {
    expect(eVuotoOSegnaposto('07XXXXXXXXX')).toBe(true);
    expect(eVuotoOSegnaposto('FI-XXXXXX')).toBe(true);
    expect(eVuotoOSegnaposto('')).toBe(true);
    expect(eVuotoOSegnaposto(null)).toBe(true);
    expect(eVuotoOSegnaposto('FI-698232')).toBe(false);
  });
  it('pulisce il REA', () => {
    expect(reaPulito('FI - 698232')).toBe('FI-698232');
    expect(reaPulito('ar-220128')).toBe('AR-220128');
  });
  it('confronta senza maiuscole, accenti e apostrofi', () => {
    expect(chiave("Società a responsabilità limitata")).toBe(chiave("SOCIETA' A RESPONSABILITA' LIMITATA"));
  });
});

describe('valoriDaVisura', () => {
  it('porta i dati nel formato della scheda', () => {
    const v = valoriDaVisura(visura());
    expect(v.forma_giuridica).toBe('Società a responsabilità limitata');
    expect(v.rea).toBe('FI-111222');
    expect(v.sede_legale).toBe('Via IX Febbraio 7, 50129 Firenze (FI)');
    expect(v.capitale_sociale).toBe('€ 10.000,00 i.v.');
    expect(v.data_costituzione).toBe('17/04/2024');
    expect(v.ateco).toBe('47.71.10 – Commercio al dettaglio di articoli di abbigliamento per adulti');
    expect(v.amministratore).toBe('ROSSI MARIO (Amministratore Unico)');
    expect(v.soci).toEqual([
      { nome: 'BETA S.R.L.', quota: '55%', ruolo: 'Socio di maggioranza', codice_fiscale: '09876543210' },
      { nome: 'GAMMA S.A.S.', quota: '45%', ruolo: 'Socio', codice_fiscale: '01122334455' },
    ]);
  });
});

describe('confrontaScheda', () => {
  it('blocca la visura di un\'altra società (il caso New Zago / Zago)', () => {
    const e = confrontaScheda({}, visura({ partitaIva: '06719450485', ragioneSociale: 'ZAGO S.R.L.' }), azienda);
    expect(e.blocco).toMatch(/ZAGO S\.R\.L\..*06719450485.*Alfa Prova.*01234567890/);
    expect(e.automatici).toEqual({});
    expect(e.daConfermare).toEqual([]);
  });

  it('blocca una visura senza P.IVA leggibile', () => {
    expect(confrontaScheda({}, visura({ partitaIva: null }), azienda).blocco).toMatch(/partita IVA/);
  });

  it('riempie da solo i campi vuoti e i segnaposto', () => {
    const e = confrontaScheda({ codice_fiscale: '01XXXXXXXXX', rea: 'FI-XXXXXX', pec: null, partita_iva: '01234567890' }, visura(), azienda);
    expect(e.blocco).toBeNull();
    expect(e.automatici.codice_fiscale).toBe('01234567890');
    expect(e.automatici.rea).toBe('FI-111222');
    expect(e.automatici.pec).toBe('alfaprova@legalmail.it');
    expect(e.automatici.partita_iva).toBeUndefined();
    expect(e.daConfermare).toEqual([]);
  });

  it('chiede conferma per un valore scritto a mano e diverso', () => {
    const e = confrontaScheda({ amministratore: 'Bianchi Luca (Amministratore Unico)', pec: 'alfa@pec.it' }, visura(), azienda);
    expect(e.daConfermare.map((d) => d.campo).sort()).toEqual(['amministratore', 'pec']);
    expect(e.automatici.amministratore).toBeUndefined();
  });

  it('aggiorna da solo un campo scritto da una visura precedente', () => {
    const e = confrontaScheda(
      { pec: 'vecchia@legalmail.it', campi_da_visura: { pec: '2025-01-10' }, visura_estratta_il: '2025-01-10' },
      visura(), azienda,
    );
    expect(e.automatici.pec).toBe('alfaprova@legalmail.it');
    expect(e.daConfermare).toEqual([]);
  });

  it('una visura più vecchia non sovrascrive da sola', () => {
    const e = confrontaScheda(
      { pec: 'nuova@legalmail.it', campi_da_visura: { pec: '2026-10-01' }, visura_estratta_il: '2026-10-01' },
      visura(), azienda,
    );
    expect(e.daConfermare.map((d) => d.campo)).toContain('pec');
  });

  it('non conta le differenze di sola forma', () => {
    const e = confrontaScheda({ forma_giuridica: 'Società a responsabilità limitata', sede_comune: 'Firenze' }, visura(), azienda);
    expect(e.automatici.forma_giuridica).toBeUndefined();
    expect(e.automatici.sede_comune).toBeUndefined();
    expect(e.daConfermare).toEqual([]);
  });

  it('soci: chiede conferma se il nome di un socio è diverso', () => {
    const e = confrontaScheda({
      soci: [{ nome: 'BETA S.R.L.', quota: '55%', ruolo: 'Socio' }, { nome: 'GAMMA S.R.L.', quota: '45%', ruolo: 'Socio' }],
    }, visura(), azienda);
    expect(e.daConfermare.map((d) => d.campo)).toContain('soci');
  });
});

describe('confrontaSedi', () => {
  const outlet = (o: Partial<OutletSede>): OutletSede => ({
    id: o.code || 'x', code: null, name: null, city: null, address: null, cap: null,
    province: null, rea: null, opening_date: null, is_active: true, ...o,
  });

  it('riempie i campi vuoti e non cambia per un refuso nell\'indirizzo', () => {
    const outlets = [
      outlet({ id: 'b', code: 'BRB', name: 'BARBERINO', city: 'Barberino di Mugello', opening_date: '2025-03-26' }),
      outlet({ id: 's', code: 'SED', name: 'SEDE', city: 'Reggello', address: 'Località Pian di Rona 120/B', cap: '50066', province: 'FI' }),
      outlet({ id: 'v', code: 'VDC', name: 'VALDICHIANA', city: 'Foiano della Chiana', opening_date: '2024-01-01' }),
      outlet({ id: 't', code: 'TRN', name: 'TORINO', city: 'Settimo Torinese', opening_date: '2026-03-24' }),
      outlet({ id: 'r', code: 'RSO', name: 'ROMA', city: "Sant'Oreste", opening_date: '2026-11-05' }),
    ];
    const e = confrontaSedi(outlets, visura().unitaLocali, '2026-04-22');
    const brb = e.automatici.find((a) => a.outletId === 'b');
    expect(brb?.patch).toEqual({ address: 'Via Meucci 31', cap: '50031', province: 'FI' });
    // Reggello: «Rona» contro «Roma» è un refuso, resta quello scritto;
    // si aggiunge solo la data di apertura, che mancava.
    expect(e.automatici.find((a) => a.outletId === 's')?.patch).toEqual({ opening_date: '2026-02-05' });
    expect(e.daConfermare.filter((d) => d.outletId === 's')).toEqual([]);
    // Valdichiana: la data di apertura diversa si conferma, il REA si scrive.
    expect(e.automatici.find((a) => a.outletId === 'v')?.patch.rea).toBe('AR-220128');
    expect(e.daConfermare).toEqual([{ outletId: 'v', negozio: 'VALDICHIANA', campo: 'opening_date', attuale: '2024-01-01', nuovo: '2024-06-13' }]);
    // Figline non ha un negozio; Torino non è in visura; Roma è aperto dopo.
    expect(e.nonNelGestionale.map((u) => u.comune)).toEqual(['FIGLINE E INCISA VALDARNO']);
    expect(e.nonInVisura.map((o) => o.code)).toEqual(['TRN']);
  });

  it('riconosce lo stesso indirizzo scritto in modi diversi', () => {
    expect(stessoIndirizzo('Via della Pace snc, c/o Valmontone Outlet', 'VIA DELLA PACE SNC')).toBe(true);
    expect(stessoIndirizzo('Strada Provinciale 126', 'STRADA PROVINCIALE 126 0')).toBe(true);
    expect(stessoIndirizzo('Via Meucci 31', 'Via Roma 2')).toBe(false);
  });
});
