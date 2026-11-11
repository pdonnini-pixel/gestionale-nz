import { describe, it, expect } from 'vitest';
import {
  chiApre,
  chiChiude,
  cognomiPerStampa,
  creaPdfOrario,
  dettaglioTurno,
  etichettaPausa,
  formattaOre,
  nomeFileOrario,
  numeroSettimana,
  orarioUnico,
  oreTurno,
  pagineOrario,
  testoApertura,
  testoPiede,
  titoloPeriodo,
  totaliPersona,
  type GiornoStampa,
  type OrarioStampa,
  type PersonaStampa,
  type TurnoStampa,
} from './stampaOrario';

// Dati di prova inventati: nessun nome vero.

function giorno(data: string, extra: Partial<GiornoStampa> = {}): GiornoStampa {
  return { data, nelMese: true, chiuso: false, apre: '10:00', chiude: '20:00', evento: null, ...extra };
}

const SETTIMANA = [
  '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29',
];
/** Settimana del 30 novembre: dal mese di novembre si vede solo il lunedì. */
const A_CAVALLO = [
  '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06',
];

function turno(inizio: string, fine: string, pausaMinuti: number, oreStraordinario?: number): TurnoStampa {
  return { inizio, fine, pausaMinuti, oreStraordinario };
}

function persona(nome: string, turni: Record<string, TurnoStampa[]>, extra: Partial<PersonaStampa> = {}): PersonaStampa {
  return { nome, ruolo: null, oreSettimana: 30, turni, ...extra };
}

function orario(persone: PersonaStampa[], giorni: GiornoStampa[] = SETTIMANA.map((d) => giorno(d))): OrarioStampa {
  return {
    marchio: 'newzago',
    azienda: 'Azienda Prova',
    negozio: 'Negozio Prova',
    giorni,
    persone,
    pubblicatoIl: '2026-11-12',
    oggi: '2026-11-11',
  };
}

function tantePersone(n: number): PersonaStampa[] {
  return Array.from({ length: n }, (_, i) =>
    persona(`Cognome${i + 1} Nome${i + 1}`, {
      '2026-11-23': [turno('10:00', '18:00', 30)],
      '2026-11-27': [turno('12:00', '20:00', 30, i % 2 ? 1.5 : undefined)],
    }, { ruolo: i === 0 ? 'responsabile' : null }),
  );
}

describe('numeroSettimana', () => {
  it('dà la settimana ISO', () => {
    expect(numeroSettimana('2026-11-23')).toBe(48);
    expect(numeroSettimana('2026-11-29')).toBe(48);
    expect(numeroSettimana('2026-11-30')).toBe(49);
  });
  it('gestisce i giorni a cavallo dell\'anno', () => {
    expect(numeroSettimana('2026-01-01')).toBe(1);
    expect(numeroSettimana('2027-01-01')).toBe(53); // venerdì: ancora la 53 del 2026
    expect(numeroSettimana('2024-12-30')).toBe(1); // lunedì: già la 1 del 2025
  });
});

describe('titoloPeriodo', () => {
  it('settimana intera nello stesso mese', () => {
    expect(titoloPeriodo(SETTIMANA.map((d) => giorno(d)))).toBe('23 – 29 novembre 2026');
  });
  it('a cavallo di due mesi mostra solo i giorni del mese', () => {
    const fineNovembre = A_CAVALLO.map((d, i) => giorno(d, { nelMese: i === 0 }));
    expect(titoloPeriodo(fineNovembre)).toBe('30 novembre 2026');
    const inizioDicembre = A_CAVALLO.map((d, i) => giorno(d, { nelMese: i > 0 }));
    expect(titoloPeriodo(inizioDicembre)).toBe('1 – 6 dicembre 2026');
  });
  it('se tutta la settimana è da mostrare scrive i due mesi', () => {
    expect(titoloPeriodo(A_CAVALLO.map((d) => giorno(d)))).toBe('30 novembre – 6 dicembre 2026');
  });
});

describe('nomeFileOrario', () => {
  it('usa il negozio e il primo giorno mostrato', () => {
    expect(nomeFileOrario(orario([]))).toBe('orario-negozio-prova-2026-11-23.pdf');
  });
  it('toglie accenti e simboli, e parte dal primo giorno del mese', () => {
    const dati = orario([], A_CAVALLO.map((d, i) => giorno(d, { nelMese: i > 0 })));
    dati.negozio = "  Città dell'Outlet (Nord) ";
    expect(nomeFileOrario(dati)).toBe('orario-citta-dell-outlet-nord-2026-12-01.pdf');
  });
});

describe('ore e pause', () => {
  it('scrive i numeri all\'italiana senza decimali inutili', () => {
    expect(formattaOre(7.5)).toBe('7,5');
    expect(formattaOre(8)).toBe('8');
    expect(formattaOre(0)).toBe('0');
    expect(formattaOre(6.6666)).toBe('6,67');
  });
  it('non conta la pausa nelle ore lavorate', () => {
    expect(oreTurno(turno('10:00', '18:00', 30))).toBe(7.5);
    expect(oreTurno(turno('10:00', '20:00', 60))).toBe(9);
    expect(oreTurno(turno('10:00', '16:00', 0))).toBe(6);
    expect(oreTurno(turno('9:00', '13:00:00', 0))).toBe(4);
  });
  it('descrive il turno con la durata della pausa', () => {
    expect(etichettaPausa(0)).toBe('');
    expect(dettaglioTurno(turno('10:00', '18:00', 30))).toBe("7,5 ore · pausa 30'");
    expect(dettaglioTurno(turno('10:00', '20:00', 60))).toBe('9 ore · pausa 1 h');
    expect(dettaglioTurno(turno('10:00', '16:00', 0))).toBe('6 ore');
    expect(dettaglioTurno(turno('10:00', '11:00', 0))).toBe('1 ora');
  });
});

describe('totaliPersona', () => {
  const giorni = SETTIMANA.map((d) => giorno(d));
  const p = persona('Verdi Lucia', {
    '2026-11-23': [turno('10:00', '18:00', 30)],
    '2026-11-27': [turno('10:00', '20:00', 60, 2.5)],
    '2026-11-28': [turno('10:00', '13:00', 0), turno('16:00', '20:00', 0, 1)],
  });
  it('somma ore lavorate e straordinari', () => {
    expect(totaliPersona(p, giorni)).toEqual({ ore: 23.5, straordinario: 3.5 });
  });
  it('lascia fuori i giorni dell\'altro mese e quelli chiusi', () => {
    const ridotti = giorni.map((g, i) => ({ ...g, nelMese: i !== 0, chiuso: i === 4 }));
    expect(totaliPersona(p, ridotti)).toEqual({ ore: 7, straordinario: 1 });
  });
});

describe('chi apre e chi chiude', () => {
  const persone = [
    persona('Verdi Lucia', { '2026-11-23': [turno('10:00', '18:00', 30)], '2026-11-27': [turno('09:00', '21:00', 60)] }),
    persona('Neri Paola', { '2026-11-23': [turno('12:00', '20:00', 30)], '2026-11-27': [turno('10:00', '21:00', 60)] }),
    persona('Gialli Sara', { '2026-11-23': [turno('10:00', '20:00', 60)] }),
  ];
  const lunedi = giorno('2026-11-23');
  it('guarda l\'inizio e la fine dei turni rispetto all\'orario del giorno', () => {
    expect(chiApre(lunedi, persone)).toEqual(['Verdi', 'Gialli']);
    expect(chiChiude(lunedi, persone)).toEqual(['Neri', 'Gialli']);
  });
  it('usa l\'orario di quel giorno quando è diverso dagli altri', () => {
    const venerdi = giorno('2026-11-27', { apre: '09:00', chiude: '21:00' });
    expect(chiApre(venerdi, persone)).toEqual(['Verdi']);
    expect(chiChiude(venerdi, persone)).toEqual(['Verdi', 'Neri']);
  });
  it('non mette nessuno nei giorni chiusi o fuori dal mese', () => {
    expect(chiApre({ ...lunedi, chiuso: true }, persone)).toEqual([]);
    expect(chiChiude({ ...lunedi, nelMese: false }, persone)).toEqual([]);
  });
  it('scrive il nome intero quando due persone hanno lo stesso cognome', () => {
    expect(cognomiPerStampa([persona('Verdi Lucia', {}), persona('Verdi Anna', {}), persona('Neri Paola', {})]))
      .toEqual(['Verdi Lucia', 'Verdi Anna', 'Neri']);
  });
});

describe('orario del negozio', () => {
  it('orario unico: una frase sola', () => {
    const giorni = SETTIMANA.map((d) => giorno(d));
    expect(orarioUnico(giorni)).toEqual({ apre: '10:00', chiude: '20:00' });
    expect(testoApertura(giorni)).toBe('Negozio aperto dalle 10:00 alle 20:00');
  });
  it('i giorni chiusi e quelli dell\'altro mese non contano', () => {
    const giorni = SETTIMANA.map((d, i) => giorno(d, i === 1 ? { chiuso: true, apre: null, chiude: null } : {}));
    giorni[6] = { ...giorni[6], nelMese: false, apre: '09:00' };
    expect(orarioUnico(giorni)).toEqual({ apre: '10:00', chiude: '20:00' });
  });
  it('orari diversi: elenco compatto, oppure niente se sarebbe troppo lungo', () => {
    const weekend = SETTIMANA.map((d, i) => giorno(d, i >= 4 ? { apre: '09:00', chiude: '21:00' } : {}));
    expect(orarioUnico(weekend)).toBeNull();
    expect(testoApertura(weekend)).toBe('Aperto lun-gio 10:00-20:00 · ven-dom 09:00-21:00');
    const tuttiDiversi = SETTIMANA.map((d, i) => giorno(d, { chiude: `${15 + i}:00` }));
    expect(testoApertura(tuttiDiversi)).toBeNull();
  });
});

describe('testoPiede', () => {
  it('pubblicato o bozza, con l\'articolo giusto', () => {
    expect(testoPiede({ pubblicatoIl: '2026-11-12', oggi: '2026-11-20' })).toBe('Pubblicato il 12/11/2026');
    expect(testoPiede({ pubblicatoIl: '2026-11-11T08:30:00Z', oggi: '2026-11-20' })).toBe("Pubblicato l'11/11/2026");
    expect(testoPiede({ pubblicatoIl: null, oggi: '2026-11-20' })).toBe('Bozza del 20/11/2026');
    expect(testoPiede({ oggi: '2026-12-08' })).toBe("Bozza dell'08/12/2026");
  });
});

describe('creaPdfOrario', () => {
  function controlla(dati: OrarioStampa, pagine: number): void {
    const doc = creaPdfOrario(dati);
    expect(doc.getNumberOfPages()).toBe(pagine);
    expect(pagineOrario(dati)).toBe(pagine);
    const pdf = doc.output();
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.length).toBeGreaterThan(3000);
    // A4 orizzontale
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(297, 1);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(210, 1);
  }

  it('4 persone stanno in una pagina', () => {
    const giorni = SETTIMANA.map((d, i) => giorno(d, { evento: i >= 4 ? 'Evento di prova' : null }));
    controlla(orario(tantePersone(4), giorni), 1);
  });
  it('14 persone vanno su due pagine', () => {
    controlla(orario(tantePersone(14)), 2);
  });
  it('funziona senza logo, senza persone e con la settimana a cavallo del mese', () => {
    const giorni = A_CAVALLO.map((d, i) => giorno(d, { nelMese: i === 0 }));
    const dati = orario([], giorni);
    dati.marchio = 'testo';
    dati.pubblicatoIl = null;
    controlla(dati, 1);
  });
  it('regge giorni chiusi, assenze, due turni nello stesso giorno e nomi lunghi', () => {
    const giorni = SETTIMANA.map((d, i) => giorno(d, i === 1 ? { chiuso: true, apre: null, chiude: null } : {}));
    const persone = [
      persona('Cognomelunghissimo Nomelunghissimo Secondonome', {
        '2026-11-23': [turno('10:00', '13:00', 0), turno('16:00', '20:00', 0, 1)],
      }, { ruolo: 'vice', oreSettimana: null, assenze: { '2026-11-25': 'ferie' } }),
    ];
    controlla(orario(persone, giorni), 1);
  });
});
