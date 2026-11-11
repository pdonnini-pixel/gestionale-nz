// Turni dei negozi: dalla settimana tipo e dal fabbisogno alla proposta.
//
// Ingredienti, tutti dal database:
//  - orari della settimana tipo del negozio (outlet_opening_hours) e giorni
//    chiusi o con orari diversi (outlet_special_days);
//  - eventi e periodi di punta (outlet_events: Black Friday, feste, saldi):
//    piu' persone, niente ferie, straordinari se mancano persone;
//  - fabbisogno: quante persone servono in ogni fascia (outlet_staffing_needs,
//    lo decide Patrizio);
//  - persone disponibili: l'organico di oggi (organico.ts) meno chi e' in
//    ferie approvate quel giorno;
//  - turni che il ricalcolo non tocca: quelli messi a mano e quelli gia'
//    pubblicati.
//
// La proposta e' una regola semplice e leggibile, non un ottimizzatore:
// riempie prima i buchi piu' grandi, dando il turno a chi ha piu' ore di
// contratto ancora libere. Quello che non riesce a coprire lo dice
// (scoperture), invece di inventare persone.
//
// Funzioni pure, nessuna query. Test in turni.test.ts.

export const SLOT_MINUTI = 30;

export interface RegoleTurni {
  /** turno minimo nella giornata: 4 ore (Patrizio, 20/10/2026). I pezzi da un'ora consumavano un giorno di lavoro e lasciavano ore di contratto non usate. */
  turnoMinOre: number;
  turnoMaxOre: number;
  /** oltre quante ore lavorate scatta la pausa: fino a 6 ore comprese nessuna pausa (Patrizio, 11/11/2026) */
  pausaOltreOre: number;
  pausaMinuti: number;
  /** da quante ore lavorate la pausa diventa lunga (8 ore esatte comprese) */
  pausaLungaOltreOre: number;
  pausaLungaMinuti: number;
  giorniLavoroMax: number;
  /**
   * Soglia di ingressi MODA per addetto all'ora (Patrizio, 29/10/2026): in
   * ogni ora servono ingressi / soglia persone. Due valori, feriali e sabato,
   * domenica e festivi; 25 provvisorio, misurato su settembre-ottobre 2026.
   */
  sogliaFeriali: number;
  sogliaWeekend: number;
  /**
   * Due persone in negozio (Patrizio, 30/10/2026): salvo la prima ora di
   * apertura e l'ultima di chiusura servono almeno due persone, anche dove il
   * traffico ne chiede una. Se le ore non bastano vince la seconda persona.
   */
  duePersone: boolean;
}

export const REGOLE_DEFAULT: RegoleTurni = {
  turnoMinOre: 4,
  turnoMaxOre: 10,
  pausaOltreOre: 6,
  pausaMinuti: 30,
  pausaLungaOltreOre: 8,
  pausaLungaMinuti: 60,
  giorniLavoroMax: 6,
  sogliaFeriali: 25,
  sogliaWeekend: 25,
  duePersone: true,
};

/**
 * Pausa (minuti) per un turno di `lavoroMinuti` lavorati, in aggiunta alle ore
 * lavorate e mai pagata: nessuna fino a 6 ore, 30 minuti oltre 6, un'ora da 8 (Patrizio, 21/10 e 11/11/2026:
 * 7 ore di presenza = 6 lavorate e mezz'ora di pausa; 9 di presenza = 8 e un'ora).
 */
export function pausaMinimaPerPresenza(presenzaMinuti: number, regole: RegoleTurni = REGOLE_DEFAULT): number {
  // La pausa piu' corta che rispetta la regola per le ore che restano di lavoro.
  for (const p of [0, regole.pausaMinuti, regole.pausaLungaMinuti].sort((a, b) => a - b)) {
    if (pausaPer(presenzaMinuti - p, regole) <= p) return p;
  }
  return regole.pausaLungaMinuti;
}

/**
 * L'orario scritto a mano diventato coerente con la regola della pausa (Patrizio,
 * 11/11/2026): la pausa dipende dalle ore di LAVORO (nessuna fino a 6 ore comprese,
 * 30' oltre 6, un'ora da 8) e la presenza e' lavoro piu' pausa: 6 ore = 6 di
 * presenza, 7 e mezza = 8, 8 = 9, 9 = 10. Una presenza che non torna (6 e mezza,
 * 8 e mezza) non si riduce di lavoro: il turno si allunga di mezz'ora, alla fine se
 * il negozio e' ancora aperto, altrimenti anticipando l'inizio. Se non c'e' posto
 * resta com'e', con la pausa minima per quella presenza.
 */
export function presenzaGiusta(inizioMin: number, fineMin: number, regole: RegoleTurni = REGOLE_DEFAULT, apre = 0, chiude = 24 * 60): { inizio: number; fine: number; pausa: number; lavoro: number; allungato: boolean } {
  const presenza = fineMin - inizioMin;
  if (presenza <= 0) return { inizio: inizioMin, fine: fineMin, pausa: 0, lavoro: 0, allungato: false };
  // Una presenza e' giusta se una delle pause possibili, tolta, lascia un lavoro che
  // vuole proprio quella pausa. Se no si prova mezz'ora in piu' alla volta: 10-16:30
  // (6 ore e mezza) diventa 10-17 (6 e mezza + 30'), 10-18:30 diventa 10-19 (8 + 1 ora).
  const pause = [...new Set([0, regole.pausaMinuti, regole.pausaLungaMinuti])].sort((a, b) => a - b);
  for (let giusta = presenza; giusta <= presenza + 120; giusta += 30) {
    const pausa = pause.find((p) => pausaPer(giusta - p, regole) === p);
    if (pausa == null) continue;
    const lavoro = giusta - pausa;
    if (giusta === presenza) return { inizio: inizioMin, fine: fineMin, pausa, lavoro, allungato: false };
    if (inizioMin + giusta <= chiude) return { inizio: inizioMin, fine: inizioMin + giusta, pausa, lavoro, allungato: true };
    if (fineMin - giusta >= apre) return { inizio: fineMin - giusta, fine: fineMin, pausa, lavoro, allungato: true };
    break;
  }
  const minima = pausaMinimaPerPresenza(presenza, regole);
  return { inizio: inizioMin, fine: fineMin, pausa: minima, lavoro: presenza - minima, allungato: false };
}

/** Pausa (minuti) per un turno di `lavoroMinuti` lavorati: 0 fino a 6 ore, 30 oltre 6, 60 da 8 (vedi `pausaMinimaPerPresenza`). */
export function pausaPer(lavoroMinuti: number, regole: RegoleTurni = REGOLE_DEFAULT): number {
  // Fino a 6 ore di lavoro comprese nessuna pausa, oltre 6 mezz'ora, da 8 un'ora
  // (Patrizio, 11/11/2026: 10-16 = 6 ore senza pausa, 10-18 = 7 e mezza + 30',
  // 10-19 = 8 + un'ora). Prima la mezz'ora scattava gia' a 6 ore esatte.
  if (lavoroMinuti >= regole.pausaLungaOltreOre * 60) return regole.pausaLungaMinuti;
  if (lavoroMinuti > regole.pausaOltreOre * 60) return regole.pausaMinuti;
  return 0;
}

/**
 * Minuti lavorati massimi di un turno in quel giorno: il turno massimo, ma con
 * la sua pausa dentro l'orario di apertura (Patrizio, 28/10/2026: turno
 * massimo 10 ore; in un negozio aperto 10 ore se ne lavorano 9 con un'ora di
 * pausa, in uno aperto 11 ore se ne lavorano 10).
 */
export function lavoroMassimoGiorno(g: { apre: number; chiude: number }, regole: RegoleTurni = REGOLE_DEFAULT): number {
  const giornata = g.chiude - g.apre;
  let lavoro = Math.min(regole.turnoMaxOre * 60, giornata);
  while (lavoro > 0 && lavoro + pausaPer(lavoro, regole) > giornata) lavoro -= SLOT_MINUTI;
  return Math.max(0, lavoro);
}

/** Regole da una riga di outlet_shift_rules (o i default se il negozio non ne ha). */
export function regoleDaRiga(r: {
  turno_min_ore?: number | string | null; turno_max_ore: number | string; pausa_oltre_ore: number | string; pausa_minuti: number | string;
  pausa_lunga_oltre_ore?: number | string | null; pausa_lunga_minuti?: number | string | null; giorni_lavoro_max: number | string;
  soglia_ingressi_feriali?: number | string | null; soglia_ingressi_weekend?: number | string | null;
  due_persone?: boolean | null;
} | null | undefined): RegoleTurni {
  if (!r) return REGOLE_DEFAULT;
  return {
    turnoMinOre: Number(r.turno_min_ore ?? REGOLE_DEFAULT.turnoMinOre), turnoMaxOre: Number(r.turno_max_ore),
    pausaOltreOre: Number(r.pausa_oltre_ore), pausaMinuti: Number(r.pausa_minuti),
    pausaLungaOltreOre: Number(r.pausa_lunga_oltre_ore ?? REGOLE_DEFAULT.pausaLungaOltreOre),
    pausaLungaMinuti: Number(r.pausa_lunga_minuti ?? REGOLE_DEFAULT.pausaLungaMinuti),
    giorniLavoroMax: Number(r.giorni_lavoro_max),
    sogliaFeriali: Number(r.soglia_ingressi_feriali ?? REGOLE_DEFAULT.sogliaFeriali),
    sogliaWeekend: Number(r.soglia_ingressi_weekend ?? REGOLE_DEFAULT.sogliaWeekend),
    duePersone: r.due_persone ?? REGOLE_DEFAULT.duePersone,
  };
}

export interface OrarioGiornoTipo {
  /** 1 = lunedi' ... 7 = domenica */
  giorno: number;
  chiuso: boolean;
  apre: string | null;
  chiude: string | null;
}

export interface FasciaFabbisogno {
  giorno: number;
  dalle: string;
  alle: string;
  persone: number;
  /** 'manuale' = salvata da chi decide il fabbisogno; 'stima' = proposta dai dati, non ancora confermata */
  origine?: string;
}

export interface GiornoSpeciale {
  data: string;
  chiuso: boolean;
  apre: string | null;
  chiude: string | null;
  persone_extra: number;
  nota?: string | null;
}

/**
 * Evento o periodo di punta (outlet_events, Patrizio 20/10/2026): Black
 * Friday, feste natalizie, saldi. Uno o piu' giorni, uno o piu' negozi
 * (outlet_ids null = tutti). Serve piu' personale, niente ferie ne' permessi,
 * e se mancano persone si chiedono straordinari.
 */
export interface EventoNegozio {
  id?: string;
  nome: string;
  data_dal: string;
  data_al: string;
  outlet_ids: string[] | null;
  persone_extra: number;
  blocca_ferie: boolean;
  straordinari: boolean;
  nota?: string | null;
}

/** Gli eventi che riguardano un negozio. */
export function eventiDelNegozio<E extends Pick<EventoNegozio, 'outlet_ids'>>(eventi: E[], outletId: string | null | undefined): E[] {
  return eventi.filter((e) => !e.outlet_ids || e.outlet_ids.length === 0 || (!!outletId && e.outlet_ids.includes(outletId)));
}

/** Gli eventi in corso in una data. */
export function eventiDelGiorno<E extends Pick<EventoNegozio, 'data_dal' | 'data_al'>>(eventi: E[], data: string): E[] {
  return eventi.filter((e) => e.data_dal <= data && data <= e.data_al);
}

export interface GiornoPiano {
  data: string;
  giorno: number;
  chiuso: boolean;
  /** minuti dalla mezzanotte */
  apre: number;
  chiude: number;
  /** persone che servono in ogni mezz'ora, da «apre» a «chiude» */
  fabbisogno: number[];
  nota: string | null;
  speciale: boolean;
  /** nome dell'evento in corso (Black Friday, saldi...), se c'e' */
  evento?: string | null;
  /** in questo giorno, se mancano persone, si chiedono straordinari */
  straordinari?: boolean;
  /** persone che MODA chiederebbe in ogni mezz'ora, senza il tetto delle persone disponibili quel giorno: la differenza con chi c'e' e' personale che manca */
  esigenza?: number[];
  /**
   * Le persone che MODA chiede in ogni mezz'ora senza arrotondare (3,53 e non
   * 4), con il tetto delle persone e le persone in piu'. Serve a misurare le
   * ore sotto MODA (Patrizio, 29/10/2026); la proposta dei turni usa il
   * fabbisogno intero.
   */
  esatto?: number[];
  /**
   * Il minimo di persone in ogni mezz'ora (Patrizio, 30/10/2026): le fasce di
   * «Orari e fabbisogno» confermate (una persona la mattina e la sera, due nel
   * resto, come le decide lui), oppure la regola delle due persone salvo la prima
   * e l'ultima ora. MODA aggiunge persone sopra.
   */
  minimo?: number[];
}

/**
 * Quanto manca in una mezz'ora: il minimo delle regole e quello che MODA chiede
 * sopra. Da quando la pausa non ha piu' un orario (Patrizio, 11/11/2026) chi ha
 * il turno conta sempre come presente, quindi lorda e netta coincidono; le due
 * misure restano separate per chi chiama la funzione.
 */
export function mancanza(serve: number, minimo: number | undefined, lorda: number, netta: number): number {
  if (minimo == null) return Math.max(0, serve - netta);
  const sottoMinimo = Math.max(0, Math.min(serve, minimo) - lorda);
  const sopra = serve > minimo + 1e-9 ? Math.max(0, serve - netta) : 0;
  return Math.max(sottoMinimo, sopra);
}

export interface PersonaTurni {
  id: string;
  /** ore settimanali di contratto */
  ore: number;
  /** giorni (ISO) in cui non puo' lavorare: ferie approvate, assenza, fuori contratto */
  nonDisponibile: Set<string>;
  /** ore di ferie e permessi gia' maturate e non godute: chi ne ha di piu' lavora meno ore quando avanzano */
  saldoOre?: number;
  /** accordi con la persona: per data, la fascia in cui puo' lavorare (assente = tutto l'orario) */
  fasce?: Map<string, Fascia>;
}

/** Fascia oraria (minuti dalla mezzanotte) in cui una persona puo' lavorare, dagli accordi della scheda. */
export interface Fascia { dalle: number; alle: number }

/** Apertura e chiusura del giorno per quella persona: l'orario del negozio dentro la sua fascia. */
export function limitiPersona(p: { fasce?: Map<string, Fascia> } | undefined, g: { data: string; apre: number; chiude: number }): { apre: number; chiude: number } {
  const f = p?.fasce?.get(g.data);
  return f ? { apre: Math.max(g.apre, f.dalle), chiude: Math.min(g.chiude, f.alle) } : { apre: g.apre, chiude: g.chiude };
}

/**
 * Riporta ogni turno dentro la fascia della persona (accordi della scheda,
 * Patrizio 28/10/2026): si accorcia quello che esce, e se non resta il turno
 * minimo si toglie. E' la rete di sicurezza in fondo ai calcoli.
 */
export function rispettaFasce(turni: Turno[], persone: { id: string; fasce?: Map<string, Fascia> }[], regole: RegoleTurni = REGOLE_DEFAULT): Turno[] {
  const per = new Map(persone.map((p) => [p.id, p]));
  const out: Turno[] = [];
  for (const t of turni) {
    const f = per.get(t.employeeId)?.fasce?.get(t.data);
    const i = minuti(t.inizio); const e = minuti(t.fine);
    if (!f || (i >= f.dalle && e <= f.alle)) { out.push(t); continue; }
    const a = Math.max(i, f.dalle); const b = Math.min(e, f.alle);
    let lavoro = Math.min(b - a, oreLavorate(t) * 60);
    while (lavoro > 0 && lavoro + pausaPer(lavoro, regole) > b - a) lavoro -= SLOT_MINUTI;
    if (lavoro < regole.turnoMinOre * 60 - 1e-9) continue;
    const pausa = pausaPer(lavoro, regole);
    out.push({ ...t, inizio: hhmm(a), fine: hhmm(a + lavoro + pausa), pausaMinuti: pausa });
  }
  return out;
}

export interface Turno {
  employeeId: string;
  data: string;
  inizio: string;
  fine: string;
  pausaMinuti: number;
}

export interface Scopertura {
  data: string;
  dalle: string;
  alle: string;
  mancano: number;
}

export interface EsitoProposta {
  turni: Turno[];
  scoperture: Scopertura[];
  /** ore di contratto e ore pianificate (fissi + proposti) per persona; straordinario = ore oltre il contratto, solo nei giorni di evento */
  ore: Record<string, { contratto: number; pianificate: number; straordinario?: number }>;
}

// ── Date e orari ─────────────────────────────────────────────────────────

export function minuti(hhmm: string | null | undefined): number {
  if (!hhmm) return 0;
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 1 = lunedi' ... 7 = domenica */
export function giornoIso(data: string): number {
  const d = new Date(`${data}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function lunediDi(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (giornoIso(data) - 1));
  return d.toISOString().slice(0, 10);
}

export function giorniDellaSettimana(lunedi: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${lunedi}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export function oreLavorate(t: Pick<Turno, 'inizio' | 'fine' | 'pausaMinuti'>): number {
  return Math.max(0, minuti(t.fine) - minuti(t.inizio) - (t.pausaMinuti || 0)) / 60;
}

export const NOMI_GIORNO = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const NOMI_GIORNO_BREVI = ['', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/**
 * Gli orari della settimana tipo in una riga, giorni uguali raggruppati
 * («Lun-Ven 10-20 · Sab-Dom 10-21»). Per chi fa i turni e non li ricorda
 * (Patrizio, 21/10/2026).
 */
export function riassuntoOrari(orari: OrarioGiornoTipo[]): string {
  const ora = (t: string | null) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    return m && m !== '00' ? `${Number(h)}:${m}` : String(Number(h));
  };
  const testo = (g: number) => {
    const o = orari.find((x) => x.giorno === g);
    return !o || o.chiuso || !o.apre || !o.chiude ? 'chiuso' : `${ora(o.apre)}-${ora(o.chiude)}`;
  };
  const gruppi: { da: number; a: number; t: string }[] = [];
  for (let g = 1; g <= 7; g++) {
    const t = testo(g);
    const ultimo = gruppi.at(-1);
    if (ultimo && ultimo.t === t) ultimo.a = g; else gruppi.push({ da: g, a: g, t });
  }
  if (gruppi.length === 1) return `Tutti i giorni ${gruppi[0].t}`;
  return gruppi.map((x) => `${NOMI_GIORNO_BREVI[x.da]}${x.a > x.da ? `-${NOMI_GIORNO_BREVI[x.a]}` : ''} ${x.t}`).join(' · ');
}

// ── I giorni della settimana con orari e fabbisogno ─────────────────────

/**
 * Per ogni data: se il negozio e' aperto, da che ora a che ora, e quante
 * persone servono in ogni mezz'ora. Il giorno speciale vince sulla
 * settimana tipo; le sue persone in piu' si aggiungono a tutta l'apertura.
 * Gli eventi (gia' filtrati per il negozio) aggiungono le loro persone in
 * piu' a tutta l'apertura; se piu' eventi si sovrappongono vale il maggiore.
 * Un evento non apre un giorno chiuso.
 */
export function costruisciGiorni(
  date: string[],
  orari: OrarioGiornoTipo[],
  fasce: FasciaFabbisogno[],
  speciali: GiornoSpeciale[],
  eventi: EventoNegozio[] = [],
  /** data di apertura del negozio: prima e' chiuso, nessuno da mettere in turno */
  apertura: string | null = null,
): GiornoPiano[] {
  return date.map((data) => {
    if (apertura && data < apertura) {
      return { data, giorno: giornoIso(data), chiuso: true, apre: 0, chiude: 0, fabbisogno: [], nota: `Il negozio apre il ${apertura.split('-').reverse().join('/')}`, speciale: false, evento: null, straordinari: false };
    }
    const ev = eventiDelGiorno(eventi, data);
    const evento = ev.length ? ev.map((e) => e.nome).join(', ') : null;
    const straordinari = ev.some((e) => e.straordinari);
    const extraEvento = ev.reduce((m, e) => Math.max(m, e.persone_extra || 0), 0);
    const g = giornoIso(data);
    const tipo = orari.find((o) => o.giorno === g);
    const sp = speciali.find((s) => s.data === data);
    const chiuso = sp ? sp.chiuso : (!tipo || tipo.chiuso || !tipo.apre || !tipo.chiude);
    const apre = minuti((sp && !sp.chiuso && sp.apre) || tipo?.apre || null);
    const chiude = minuti((sp && !sp.chiuso && sp.chiude) || tipo?.chiude || null);
    if (chiuso || chiude <= apre) {
      return { data, giorno: g, chiuso: true, apre: 0, chiude: 0, fabbisogno: [], nota: sp?.nota ?? null, speciale: !!sp, evento, straordinari: false };
    }
    const n = Math.floor((chiude - apre) / SLOT_MINUTI);
    const fasceGiorno = fasce.filter((f) => f.giorno === g);
    const extra = (sp?.persone_extra ?? 0) + extraEvento;
    const fabbisogno = Array.from({ length: n }, (_, i) => {
      const t = apre + i * SLOT_MINUTI;
      const base = fasceGiorno
        .filter((f) => minuti(f.dalle) <= t && t < minuti(f.alle))
        .reduce((m, f) => Math.max(m, f.persone), 0);
      return Math.max(0, base + extra);
    });
    // Le fasce confermate fanno il minimo di persone del giorno; quelle stimate no.
    const confermate = fasceGiorno.filter((f) => f.origine === 'manuale');
    const minimo = confermate.length ? Array.from({ length: n }, (_, i) => {
      const t = apre + i * SLOT_MINUTI;
      return Math.max(1, confermate.filter((f) => minuti(f.dalle) <= t && t < minuti(f.alle)).reduce((m, f) => Math.max(m, f.persone), 0));
    }) : undefined;
    return { data, giorno: g, chiuso: false, apre, chiude, fabbisogno, nota: sp?.nota ?? null, speciale: !!sp, evento, straordinari, ...(minimo ? { minimo } : {}) };
  });
}

/**
 * Le persone in piu' di ogni giorno: quelle del giorno speciale piu' quelle
 * dell'evento, come in costruisciGiorni. Il fabbisogno dal traffico MODA le
 * somma sopra quello che chiedono gli ingressi.
 */
export function personeInPiu(date: string[], speciali: Pick<GiornoSpeciale, 'data' | 'persone_extra'>[], eventi: EventoNegozio[] = []): Map<string, number> {
  return new Map(date.map((d) => [d,
    (speciali.find((s) => s.data === d)?.persone_extra ?? 0)
    + eventiDelGiorno(eventi, d).reduce((m, e) => Math.max(m, e.persone_extra || 0), 0)]));
}

/** Ore-persona che servono nella settimana (somma del fabbisogno). */
export function oreDaCoprire(giorni: GiornoPiano[]): number {
  return giorni.reduce((s, g) => s + g.fabbisogno.reduce((a, b) => a + b, 0) * (SLOT_MINUTI / 60), 0);
}

// ── Copertura ───────────────────────────────────────────────────────────

/** Quante persone hanno il turno in ogni mezz'ora (la pausa non toglie nessuno). */
export function coperturaLorda(giorno: GiornoPiano, turni: Turno[]): number[] {
  const cop = giorno.fabbisogno.map(() => 0);
  for (const t of turni) {
    if (t.data !== giorno.data) continue;
    const da = minuti(t.inizio);
    const a = minuti(t.fine);
    for (let i = 0; i < cop.length; i++) {
      const s = giorno.apre + i * SLOT_MINUTI;
      if (s >= da && s < a) cop[i] += 1;
    }
  }
  return cop;
}

/**
 * Quante persone sono in negozio in ogni mezz'ora. La pausa non ha un orario
 * (Patrizio, 11/11/2026): le ragazze la fanno quando il negozio e' vuoto e lo
 * permette, a loro discrezione, quindi non si prevede in nessuna fascia e non
 * toglie nessuno dalla copertura. Conta solo nelle ore: con 8 ore lavorate fra
 * entrata e uscita passano 9 ore (pausaPer). Sostituisce la pausa pranzo 13-15,
 * le due ore dopo l'inizio e la pausa coperta da un collega (20/10-02/11/2026).
 */
export function copertura(giorno: GiornoPiano, turni: Turno[]): number[] {
  return coperturaLorda(giorno, turni);
}

/** Le mezz'ore in cui mancano persone, unite in fasce. */
export function scopertureDelGiorno(giorno: GiornoPiano, turni: Turno[]): Scopertura[] {
  if (giorno.chiuso) return [];
  const netta = copertura(giorno, turni);
  const lorda = coperturaLorda(giorno, turni);
  const m = (k: number) => mancanza(giorno.fabbisogno[k], giorno.minimo?.[k], lorda[k], netta[k]);
  const out: Scopertura[] = [];
  let i = 0;
  while (i < netta.length) {
    const manca = m(i);
    if (manca <= 0) { i++; continue; }
    let j = i;
    while (j + 1 < netta.length && m(j + 1) === manca) j++;
    out.push({
      data: giorno.data,
      dalle: hhmm(giorno.apre + i * SLOT_MINUTI),
      alle: hhmm(giorno.apre + (j + 1) * SLOT_MINUTI),
      mancano: manca,
    });
    i = j + 1;
  }
  return out;
}

// ── La proposta ─────────────────────────────────────────────────────────

const arrotondaMezzOra = (ore: number) => Math.floor(ore * 2 + 1e-9) / 2;

type ArgsProposta = {
  giorni: GiornoPiano[];
  persone: PersonaTurni[];
  regole?: RegoleTurni;
  /** turni che restano come sono: messi a mano o gia' pubblicati */
  fissi?: Turno[];
};

/** Ore-persona che mancano. */
export function oreScoperte(giorni: GiornoPiano[], turni: Turno[]): number {
  return giorni.reduce((s, g) => {
    const lorda = coperturaLorda(g, turni);
    return s + copertura(g, turni)
      .reduce((a, c, i) => a + mancanza(g.fabbisogno[i], g.minimo?.[i], lorda[i], c), 0) * (SLOT_MINUTI / 60);
  }, 0);
}

/**
 * Ore sotto MODA: in ogni mezz'ora le persone che il traffico chiede senza
 * arrotondare meno chi ha il turno in negozio. Mezza persona
 * che manca per mezz'ora vale un quarto d'ora. Senza il fabbisogno esatto
 * (negozio senza traffico) vale quello intero, come oreScoperte.
 */
export function oreSottoModa(giorni: GiornoPiano[], turni: Turno[]): number {
  return giorni.reduce((s, g) => {
    if (g.chiuso) return s;
    const serve = g.esatto ?? g.fabbisogno;
    const lorda = coperturaLorda(g, turni);
    return s + copertura(g, turni).reduce((a, c, i) => a + mancanza(serve[i] ?? 0, g.minimo?.[i], lorda[i], c), 0) * (SLOT_MINUTI / 60);
  }, 0);
}

/**
 * La proposta prova quattro strategie e tiene quella che lascia meno ore
 * scoperte: riempire prima i giorni piu' pieni oppure il buco piu' grande, e
 * turni lunghi nei giorni pieni oppure tutti uguali. Misurato il 20/10/2026
 * sui 7 negozi con il fabbisogno di Lilian: nessuna vince ovunque, la
 * migliore delle quattro si'. E' un ripiego finche' non c'e' l'ottimizzatore.
 */
export function proponiSettimana(args: ArgsProposta): EsitoProposta {
  // Si pianificano solo le ore che servono (Patrizio, 20/10/2026): prima la
  // copertura migliore possibile con tutte le ore, poi si tolgono le mezz'ore
  // in cui ci sono piu' persone del fabbisogno. Le ore di contratto che
  // avanzano non diventano turni in piu': diventano ferie e permessi, e si
  // tolgono prima a chi ne ha maturati di piu'.
  // Senza fabbisogno non si sa cosa serve: si resta sulle ore di contratto.
  if (oreDaCoprire(args.giorni) <= 0) return migliorStrategia(args);
  const regole = args.regole ?? REGOLE_DEFAULT;
  const fissi = args.fissi ?? [];
  const saldo = new Map(args.persone.map((p) => [p.id, p.saldoOre ?? 0]));
  const giorniStraordinari = new Set(args.giorni.filter((g) => g.straordinari && !g.chiuso).map((g) => g.data));
  const rifinisci = (grezzi: Turno[]): Turno[] => {
    // Sfrondare libera ore di contratto che il ritocco usa per chiudere i
    // buchi rimasti; poi si sfronda di nuovo quello che il ritocco ha lasciato in piu'.
    const sfrondati = sfrondaOreInPiu(args.giorni, grezzi, fissi, regole, saldo);
    let ritoccati = ritoccaScoperture(args.giorni, sfrondati, fissi, args.persone, regole);
    // Chi ha gia' tutti i giorni di lavoro non puo' entrare nel giorno scoperto: gli
    // si sposta li' il turno di un altro giorno (Roma Soratte, 11/11/2026).
    ritoccati = spostaUnGiorno(args.giorni, ritoccati, fissi, args.persone, regole);
    // Nei giorni di evento, se mancano ancora persone, si va oltre il
    // contratto: sono straordinari (Patrizio, 20/10/2026), e si dicono.
    if (giorniStraordinari.size) ritoccati = ritoccaScoperture(args.giorni, ritoccati, fissi, args.persone, regole, giorniStraordinari);
    return sfrondaOreInPiu(args.giorni, ritoccati, fissi, regole, saldo);
  };
  // Ogni strategia va fino in fondo (sfrondo, ritocco, spostamenti) e si tiene la
  // settimana finita migliore: prima meno mezz'ore senza nessuno (comanda l'orario),
  // poi meno ore scoperte, poi la mancanza meglio distribuita. Fino all'11/11/2026 si
  // sceglieva la strategia sulla proposta grezza e si rifiniva solo quella: a Roma
  // Soratte vinceva quella dei turni da 4 ore, che nei feriali mette in turno tutte
  // e quattro le persone, finisce i giorni di lavoro di ognuna il giovedi' e lascia
  // il venerdi' vuoto dalle 17 con ore di contratto ancora libere.
  let meglio: { turni: Turno[]; vuote: number; ore: number; q: number } | null = null;
  for (const [ordine, lunghezza] of STRATEGIE) {
    const turni = rifinisci(proponiConStrategia(args, ordine, lunghezza).turni);
    const tutti = [...fissi, ...turni];
    const m = { turni, vuote: mezzOreVuote(args.giorni, tutti), ore: oreScoperte(args.giorni, tutti), q: mancanzaQuadrata(args.giorni, tutti) };
    if (!meglio || m.vuote < meglio.vuote
      || (m.vuote === meglio.vuote && (m.ore < meglio.ore - 1e-9 || (Math.abs(m.ore - meglio.ore) <= 1e-9 && m.q < meglio.q - 1e-9)))) meglio = m;
  }
  const turni = meglio!.turni;
  const tutti = [...fissi, ...turni];
  const ore: EsitoProposta['ore'] = {};
  for (const p of args.persone) {
    const pianificate = tutti.filter((t) => t.employeeId === p.id).reduce((a, t) => a + oreLavorate(t), 0);
    ore[p.id] = { contratto: p.ore, pianificate, straordinario: Math.max(0, pianificate - p.ore) };
  }
  return { turni, scoperture: args.giorni.flatMap((g) => scopertureDelGiorno(g, tutti)), ore };
}

/** Mezz'ore di apertura in cui non c'e' nessuno: non devono esistere (comanda l'orario, Patrizio 21/10/2026). */
export function mezzOreVuote(giorni: GiornoPiano[], turni: Turno[]): number {
  return giorni.reduce((a, g) => a + (g.chiuso ? 0 : coperturaLorda(g, turni).filter((c) => c < 1).length), 0);
}

type Ordine = 'pieni' | 'buco';
type Lunghezza = 'pesati' | 'uguali' | 'lunghi';
// «lunghi» in fondo: a parita' restano le strategie di prima.
const STRATEGIE: [Ordine, Lunghezza][] = [['pieni', 'pesati'], ['pieni', 'uguali'], ['buco', 'pesati'], ['buco', 'uguali'], ['pieni', 'lunghi'], ['buco', 'lunghi']];

/**
 * Sposta un turno da un giorno all'altro (Roma Soratte, 11/11/2026). Il ritocco
 * lavora un giorno alla volta: se nel giorno scoperto chi non lavora ha gia' tutti
 * i suoi giorni di lavoro (sei turni corti in sei giorni), non puo' aggiungere
 * nessuno e il buco resta, anche con ore di contratto libere. Qui a una persona
 * che quel giorno non lavora si toglie il turno di un altro giorno e le si da' un
 * turno nel giorno scoperto; poi il ritocco risistema i due giorni con le ore di
 * tutti. Si tiene lo spostamento che lascia meno mezz'ore vuote e, a parita', meno
 * ore scoperte nella settimana; mai se le peggiora. I turni fissi non si toccano.
 */
export function spostaUnGiorno(
  giorni: GiornoPiano[], proposti: Turno[], fissi: Turno[], persone: PersonaTurni[], regole: RegoleTurni,
): Turno[] {
  let turni = [...proposti];
  const aperti = giorni.filter((g) => !g.chiuso);
  const misura = (t: Turno[]) => { const tutti = [...fissi, ...t]; return { vuote: mezzOreVuote(aperti, tutti), ore: oreScoperte(aperti, tutti) }; };
  const meglioDi = (a: { vuote: number; ore: number }, b: { vuote: number; ore: number }) => a.vuote < b.vuote || (a.vuote === b.vuote && a.ore < b.ore - 1e-9);
  const minimo = regole.turnoMinOre * 60;
  for (let giro = 0; giro < 20; giro++) {
    const base = misura(turni);
    if (base.ore <= 1e-9) break;
    let meglio: { t: Turno[]; m: { vuote: number; ore: number } } | null = null;
    for (const g of aperti) {
      if (oreScoperte([g], [...fissi, ...turni]) <= 1e-9) continue;
      for (const p of persone) {
        if (p.ore <= 0 || p.nonDisponibile.has(g.data) || [...fissi, ...turni].some((t) => t.employeeId === p.id && t.data === g.data)) continue;
        const l = limitiPersona(p, g);
        if (lavoroMassimoGiorno(l, regole) < minimo) continue;
        const giorniSuoi = new Set([...fissi, ...turni].filter((t) => t.employeeId === p.id).map((t) => t.data)).size;
        // chi ha ancora un giorno libero lo aggiunge gia' il ritocco: qui solo chi li ha finiti
        if (giorniSuoi < regole.giorniLavoroMax) continue;
        for (const via of turni.filter((t) => t.employeeId === p.id && t.data !== g.data)) {
          const g2 = aperti.find((x) => x.data === via.data);
          if (!g2) continue;
          const senza = turni.filter((t) => t !== via);
          const cop = coperturaLorda(g, [...fissi, ...senza]);
          // il turno minimo dove nel giorno scoperto manca di piu'; il ritocco poi lo allunga
          let inizio: { s: number; v: number } | null = null;
          for (let s = l.apre; s + minimo + pausaPer(minimo, regole) <= l.chiude; s += SLOT_MINUTI) {
            let v = 0;
            for (let k = 0; k < cop.length; k++) {
              const m = g.apre + k * SLOT_MINUTI;
              if (m >= s && m < s + minimo) v += Math.max(0, g.fabbisogno[k] - cop[k]) ** 2 + (cop[k] < 1 ? 100 : 0);
            }
            if (!inizio || v > inizio.v) inizio = { s, v };
          }
          if (!inizio || inizio.v <= 0) continue;
          const nuovo: Turno = { employeeId: p.id, data: g.data, inizio: hhmm(inizio.s), fine: hhmm(inizio.s + minimo + pausaPer(minimo, regole)), pausaMinuti: pausaPer(minimo, regole) };
          const prova = ritoccaScoperture([g, g2], [...senza, nuovo], fissi, persone, regole);
          const m = misura(prova);
          if (meglioDi(m, base) && (!meglio || meglioDi(m, meglio.m))) meglio = { t: prova, m };
        }
      }
    }
    if (!meglio) break;
    turni = meglio.t;
  }
  return turni;
}

/**
 * Ritocco dopo la proposta: allunga, sposta o aggiunge turni di mezz'ora in
 * mezz'ora finche' le ore scoperte del giorno calano. Mai oltre le ore di
 * contratto, il turno massimo, un turno al giorno e i giorni consentiti; i
 * turni fissi non si toccano. Serve perche' la proposta e' greedy: il
 * 20/10/2026, con la pausa da 8 ore scesa a 30 minuti, a Franciacorta
 * lasciava 3 ore scoperte nei feriali pur avendo 18 ore in piu'.
 */
export function ritoccaScoperture(
  giorni: GiornoPiano[], proposti: Turno[], fissi: Turno[], persone: PersonaTurni[], regole: RegoleTurni,
  /** giorni (eventi) in cui si puo' andare oltre le ore di contratto: straordinari */
  oltreContratto?: Set<string>,
  /** se c'e', si toccano solo i turni di queste persone (la riserva a chiamata) */
  soloPersone?: Set<string>,
): Turno[] {
  let turni = [...proposti];
  const contratto = new Map(persone.map((p) => [p.id, p.ore]));
  const oreDi = (id: string, t: Turno[]) => [...fissi, ...t].filter((x) => x.employeeId === id).reduce((a, x) => a + oreLavorate(x), 0);
  const giorniDi = (id: string, t: Turno[]) => new Set([...fissi, ...t].filter((x) => x.employeeId === id).map((x) => x.data));
  const conPausa = (t: Turno, inizio: number, lavoro: number): Turno => {
    const pausa = pausaPer(lavoro, regole);
    return { ...t, inizio: hhmm(inizio), fine: hhmm(inizio + lavoro + pausa), pausaMinuti: pausa };
  };
  const perId = new Map(persone.map((p) => [p.id, p]));
  const valido = (g: GiornoPiano, t: Turno, prova: Turno[]) => {
    const lavoro = oreLavorate(t) * 60;
    const l = limitiPersona(perId.get(t.employeeId), g);
    return minuti(t.inizio) >= l.apre && minuti(t.fine) <= l.chiude
      && lavoro >= regole.turnoMinOre * 60 - 1e-9 && lavoro <= regole.turnoMaxOre * 60
      && (!!oltreContratto?.has(t.data) || oreDi(t.employeeId, prova) <= (contratto.get(t.employeeId) ?? 0) + 1e-9);
  };
  for (const g of giorni) {
    if (g.chiuso || (oltreContratto && !oltreContratto.has(g.data))) continue;
    const scop = (t: Turno[]) => oreScoperte([g], [...fissi, ...t]);
    for (let giro = 0; giro < 200; giro++) {
      const base = scop(turni);
      if (base <= 1e-9) break;
      const mosse: Turno[][] = [];
      turni.forEach((t, idx) => {
        if (t.data !== g.data || (soloPersone && !soloPersone.has(t.employeeId))) return;
        const lavoro = oreLavorate(t) * 60;
        // Ogni posizione e ogni lunghezza fino alle ore libere della persona, non solo
        // mezz'ora alla volta: allungare di mezz'ora spesso non cambia niente (la persona
        // e' gia' coperta da un collega) e il ritocco si fermava con ore di contratto
        // ferme e una persona sola in negozio (Brugnato, novembre 2026: Rossini 11-15
        // ogni giorno con 6 ore da assegnare e Ruggeri sola dalle 17 alle 19).
        const libere = Math.floor(((contratto.get(t.employeeId) ?? 0) - oreDi(t.employeeId, turni)) * 2) / 2 * 60;
        const fino = oltreContratto?.has(t.data) ? lavoro + SLOT_MINUTI : lavoro + Math.max(0, libere);
        const l = limitiPersona(perId.get(t.employeeId), g);
        const varianti: Turno[] = [];
        for (let lav = lavoro; lav <= Math.min(fino, regole.turnoMaxOre * 60); lav += SLOT_MINUTI) {
          const durata = lav + pausaPer(lav, regole);
          for (let s0 = l.apre; s0 + durata <= l.chiude; s0 += SLOT_MINUTI) varianti.push(conPausa(t, s0, lav));
        }
        for (const v of varianti) {
          const prova = turni.map((x, i) => (i === idx ? v : x));
          if (valido(g, v, prova)) mosse.push(prova);
        }
      });
      for (const p of persone) {
        if (p.nonDisponibile.has(g.data)) continue;
        const gg = giorniDi(p.id, turni);
        if (gg.has(g.data) || gg.size >= regole.giorniLavoroMax) continue;
        const minimo = regole.turnoMinOre * 60;
        const l = limitiPersona(p, g);
        for (let s = l.apre; s + minimo <= l.chiude; s += SLOT_MINUTI) {
          const v = conPausa({ employeeId: p.id, data: g.data, inizio: '', fine: '', pausaMinuti: 0 }, s, minimo);
          const prova = [...turni, v];
          if (valido(g, v, prova)) mosse.push(prova);
        }
      }
      // Nei giorni di evento con gli straordinari le ore in piu' vanno a chi ne ha fatte
      // meno (Patrizio, 30/10 e 02/11/2026): fra le mosse che riducono le ore scoperte vince
      // quella che lascia gli straordinari piu' bilanciati (somma dei quadrati delle ore
      // oltre il contratto), e solo a parita' quella che copre di piu'. Prima vinceva la
      // mossa che copriva di piu', cioe' un turno intero a chi aveva un giorno libero
      // (Barberino, Black Friday 2026: Pampaloni 35,5 ore su 20, le colleghe +1/+3).
      const oltre = (m: Turno[]) => (oltreContratto ? persone.reduce((a, p) => a + Math.max(0, oreDi(p.id, m) - p.ore) ** 2, 0) : 0);
      let meglio: { t: Turno[]; ore: number; oltre: number } | null = null;
      for (const m of mosse) {
        const o = scop(m);
        if (o >= base - 1e-9) continue;
        const q = oltre(m);
        const vince = !meglio
          || (oltreContratto
            ? q < meglio.oltre - 1e-9 || (Math.abs(q - meglio.oltre) <= 1e-9 && o < meglio.ore - 1e-9)
            : o < meglio.ore - 1e-9);
        if (vince) meglio = { t: m, ore: o, oltre: q };
      }
      if (!meglio) break;
      turni = meglio.t;
    }
  }
  return turni;
}

/**
 * Accorcia i turni proposti (mai quelli fissi) di mezz'ora alla volta, dall'inizio
 * o dalla fine, e toglie quelli che non servono, finche' la copertura del giorno
 * non peggiora. Prima chi ha piu' ferie e permessi maturati (criterio di
 * Patrizio del 19/10/2026), cosi' sono le sue ore a diventare ferie.
 */
export function sfrondaOreInPiu(
  giorni: GiornoPiano[], proposti: Turno[], fissi: Turno[], regole: RegoleTurni, saldo: Map<string, number>,
): Turno[] {
  let turni = [...proposti];
  const scopDelGiorno = (g: GiornoPiano, t: Turno[]) => oreScoperte([g], [...fissi, ...t]);
  for (const g of giorni) {
    if (g.chiuso) continue;
    let cambiato = true;
    for (let giro = 0; cambiato && giro < 200; giro++) {
      cambiato = false;
      const base = scopDelGiorno(g, turni);
      const delGiorno = turni
        .map((t, idx) => ({ t, idx }))
        .filter((x) => x.t.data === g.data)
        .sort((a, b) => (saldo.get(b.t.employeeId) ?? 0) - (saldo.get(a.t.employeeId) ?? 0) || oreLavorate(b.t) - oreLavorate(a.t));
      for (const { t, idx } of delGiorno) {
        const lavoro = oreLavorate(t) * 60;
        const candidati: (Turno | null)[] = [];
        if (lavoro - SLOT_MINUTI < regole.turnoMinOre * 60 - 1e-9) candidati.push(null);
        else {
          const l2 = lavoro - SLOT_MINUTI;
          const p2 = pausaPer(l2, regole);
          candidati.push({ ...t, inizio: hhmm(minuti(t.fine) - l2 - p2), pausaMinuti: p2 });
          candidati.push({ ...t, fine: hhmm(minuti(t.inizio) + l2 + p2), pausaMinuti: p2 });
        }
        for (const c of candidati) {
          const prova = c ? turni.map((x, i) => (i === idx ? c : x)) : turni.filter((_, i) => i !== idx);
          if (scopDelGiorno(g, prova) <= base + 1e-9) { turni = prova; cambiato = true; break; }
        }
        if (cambiato) break;
      }
    }
  }
  return turni.sort((a, b) => a.data.localeCompare(b.data) || a.inizio.localeCompare(b.inizio));
}

function migliorStrategia(args: ArgsProposta): EsitoProposta {
  const tutti = (e: EsitoProposta) => [...(args.fissi ?? []), ...e.turni];
  // A parita' di ore scoperte vince la strategia che distribuisce meglio quello che
  // manca (somma dei quadrati): una persona sola tutta la domenica pesa piu' di
  // mezza persona in meno su piu' giorni (Patrizio, 11/11/2026, Roma Soratte).
  let meglio: { e: EsitoProposta; ore: number; q: number } | null = null;
  for (const ordine of ['pieni', 'buco'] as const) {
    for (const turni of ['pesati', 'uguali'] as const) {
      const e = proponiConStrategia(args, ordine, turni);
      const ore = oreScoperte(args.giorni, tutti(e));
      const q = mancanzaQuadrata(args.giorni, tutti(e));
      if (!meglio || ore < meglio.ore - 1e-9 || (Math.abs(ore - meglio.ore) <= 1e-9 && q < meglio.q - 1e-9)) meglio = { e, ore, q };
    }
  }
  return meglio!.e;
}

/** Persone mancanti al quadrato, mezz'ora per mezz'ora: piu' e' bassa, piu' la mancanza e' distribuita. */
export function mancanzaQuadrata(giorni: GiornoPiano[], turni: Turno[]): number {
  return giorni.reduce((s, g) => {
    if (g.chiuso) return s;
    const c = copertura(g, turni);
    return s + g.fabbisogno.reduce((a, f, i) => a + Math.max(0, f - c[i]) ** 2, 0);
  }, 0);
}

function proponiConStrategia(args: ArgsProposta, ordine: Ordine, turni: Lunghezza): EsitoProposta {
  const regole = args.regole ?? REGOLE_DEFAULT;
  const giorni = args.giorni;
  const fissi = args.fissi ?? [];
  const persone = args.persone.filter((p) => p.ore > 0);
  const proposti: Turno[] = [];

  const lavora = new Map<string, Set<string>>();
  const restanti = new Map<string, number>();
  for (const p of persone) {
    const fissiP = fissi.filter((t) => t.employeeId === p.id);
    lavora.set(p.id, new Set(fissiP.map((t) => t.data)));
    restanti.set(p.id, p.ore - fissiP.reduce((s, t) => s + oreLavorate(t), 0));
  }

  // Copertura del giorno, ricalcolata ogni volta che si aggiunge un turno.
  const cop = new Map<string, number[]>();
  const ricalcola = (g: GiornoPiano) => cop.set(g.data, copertura(g, [...fissi, ...proposti]));
  for (const g of giorni) ricalcola(g);

  const puoLavorare = (p: PersonaTurni, g: GiornoPiano) =>
    !g.chiuso
    && !p.nonDisponibile.has(g.data)
    && !lavora.get(p.id)!.has(g.data)
    && lavora.get(p.id)!.size < regole.giorniLavoroMax
    && (restanti.get(p.id) ?? 0) >= regole.turnoMinOre - 1e-9
    && lavoroMassimoGiorno(limitiPersona(p, g), regole) >= regole.turnoMinOre * 60;

  const durata = (p: PersonaTurni, g: GiornoPiano, buco?: number): { lavoro: number; pausa: number } => {
    // Turni «lunghi» (Roma Soratte, 11/11/2026): il turno e' lungo quanto il buco in
    // cui cade (le mezz'ore di fila in cui manca qualcuno), fino al turno massimo e
    // alle ore che restano alla persona. Meno turni piu' lunghi usano meno giorni di
    // lavoro: con quattro turni da 4 ore in ogni feriale le persone finiscono i sei
    // giorni prima della fine della settimana e l'ultimo giorno resta scoperto.
    if (turni === 'lunghi' && buco != null) {
      const c = cop.get(g.data)!;
      let a = buco; let b = buco;
      while (a > 0 && g.fabbisogno[a - 1] - c[a - 1] > 0) a--;
      while (b + 1 < c.length && g.fabbisogno[b + 1] - c[b + 1] > 0) b++;
      const l = limitiPersona(p, g);
      const spazio = Math.min((b - a + 1) * SLOT_MINUTI, l.chiude - l.apre);
      const minimo = regole.turnoMinOre * 60;
      let lavoro = Math.min(regole.turnoMaxOre * 60, arrotondaMezzOra(restanti.get(p.id) ?? 0) * 60);
      while (lavoro > minimo && lavoro + pausaPer(lavoro, regole) > spazio) lavoro -= SLOT_MINUTI;
      while (lavoro > 0 && lavoro + pausaPer(lavoro, regole) > l.chiude - l.apre) lavoro -= SLOT_MINUTI;
      return { lavoro, pausa: pausaPer(lavoro, regole) };
    }
    // Le ore che restano si dividono sui giorni che la persona puo' ancora
    // lavorare in proporzione a quanto serve in ciascuno: turni lunghi nei
    // giorni pieni (sabato, domenica), corti in quelli tranquilli. Dividerle
    // in parti uguali lasciava ore in piu' nei feriali e buchi nel weekend
    // (Franciacorta, 20/10/2026: 28 ore in piu' dal lunedi' al venerdi',
    // 10 e mezza scoperte nel fine settimana con le stesse persone).
    const peso = (x: GiornoPiano) => Math.max(1, x.fabbisogno.reduce((a, b) => a + b, 0));
    const slot = Math.max(1, regole.giorniLavoroMax - lavora.get(p.id)!.size);
    const liberi = giorni.filter((x) => x.data !== g.data && puoLavorare(p, x)).sort((a, b) => peso(b) - peso(a));
    const insieme = [g, ...liberi.slice(0, slot - 1)];
    const rest = restanti.get(p.id) ?? 0;
    let ore = turni === 'pesati'
      ? rest * peso(g) / insieme.reduce((a, x) => a + peso(x), 0)
      : rest / Math.max(1, Math.min(liberi.length + 1, slot));
    ore = Math.min(Math.max(ore, regole.turnoMinOre), regole.turnoMaxOre, rest);
    ore = arrotondaMezzOra(ore);
    let lavoro = ore * 60;
    const l = limitiPersona(p, g);
    const giornata = l.chiude - l.apre;
    // Se il turno con la sua pausa non sta nella giornata si accorcia di
    // mezz'ora alla volta (la pausa scende di fascia quando serve).
    while (lavoro > 0 && lavoro + pausaPer(lavoro, regole) > giornata) lavoro -= SLOT_MINUTI;
    return { lavoro, pausa: pausaPer(lavoro, regole) };
  };

  const assegna = (p: PersonaTurni, g: GiornoPiano, inizioMin: number, lavoro: number, pausa: number) => {
    const span = lavoro + pausa;
    const l = limitiPersona(p, g);
    let inizio = Math.max(l.apre, inizioMin);
    if (inizio + span > l.chiude) inizio = l.chiude - span;
    inizio = g.apre + Math.round((inizio - g.apre) / SLOT_MINUTI) * SLOT_MINUTI;
    if (inizio + span > l.chiude) inizio -= SLOT_MINUTI;
    if (inizio < l.apre) inizio += SLOT_MINUTI;
    const t: Turno = { employeeId: p.id, data: g.data, inizio: hhmm(inizio), fine: hhmm(inizio + span), pausaMinuti: pausa };
    proposti.push(t);
    lavora.get(p.id)!.add(g.data);
    restanti.set(p.id, (restanti.get(p.id) ?? 0) - lavoro / 60);
    ricalcola(g);
  };

  // Dove parte il turno che copre la mezz'ora i (Patrizio, 11/11/2026, Roma Soratte):
  // prima partiva dall'inizio del buco, e quando le ore non bastano il buco comincia
  // sempre all'apertura, quindi tutti i turni partivano alle 10 (10-15, 10-15, 10-15)
  // e il pomeriggio restava a una persona. Ora fra gli inizi che coprono la mezz'ora
  // vince quello che copre piu' persone mancanti, contando di piu' dove ne mancano di
  // piu' (la seconda persona del pomeriggio prima della quarta del mattino); a parita'
  // il piu' presto.
  const inizioNelBuco = (p: PersonaTurni, g: GiornoPiano, i: number, span: number): number => {
    const c = cop.get(g.data)!;
    const l = limitiPersona(p, g);
    const t = g.apre + i * SLOT_MINUTI;
    let meglio: { s: number; v: number } | null = null;
    for (let s = Math.max(l.apre, t - span + SLOT_MINUTI); s <= t && s + span <= l.chiude; s += SLOT_MINUTI) {
      let v = 0;
      for (let k = 0; k < c.length; k++) {
        const m = g.apre + k * SLOT_MINUTI;
        const manca = g.fabbisogno[k] - c[k];
        if (m >= s && m < s + span && manca > 0) v += manca * manca;
      }
      if (!meglio || v > meglio.v) meglio = { s, v };
    }
    if (meglio) return meglio.s;
    // il turno non sta intorno alla mezz'ora (fascia della persona): come prima, dall'inizio del buco
    let r0 = i;
    while (r0 > 0 && g.fabbisogno[r0 - 1] - c[r0 - 1] > 0) r0--;
    return g.apre + r0 * SLOT_MINUTI;
  };

  // chi puo' lavorare quel giorno e, con i suoi accordi, anche in quella mezz'ora
  const scegli = (g: GiornoPiano, i: number) => persone
    .filter((p) => puoLavorare(p, g) && (() => { const l = limitiPersona(p, g); const t = g.apre + i * SLOT_MINUTI; return t >= l.apre && t < l.chiude; })())
    .sort((a, b) => ((restanti.get(b.id)! / b.ore) - (restanti.get(a.id)! / a.ore))
      || (restanti.get(b.id)! - restanti.get(a.id)!)
      || a.id.localeCompare(b.id))[0];

  // 1. I buchi, dal piu' grande
  const bloccati = new Set<string>();
  for (let giro = 0; giro < 1000; giro++) {
    let best: { g: GiornoPiano; i: number; manca: number; c: number } | null = null;
    for (const g of giorni) {
      if (g.chiuso) continue;
      const c = cop.get(g.data)!;
      for (let i = 0; i < c.length; i++) {
        const manca = g.fabbisogno[i] - c[i];
        if (manca <= 0 || bloccati.has(`${g.data}|${i}`)) continue;
        // Ordine «pieni»: prima i giorni piu' pieni, poi il buco piu' grande.
        // Ordine «buco»: il buco piu' grande della settimana.
        const pg = ordine === 'pieni' ? g.fabbisogno.reduce((a, b) => a + b, 0) : 0;
        const pb = !best ? -1 : ordine === 'pieni' ? best.g.fabbisogno.reduce((a, b) => a + b, 0) : 0;
        // a parita' di persone mancanti, prima dove ce ne sono di meno (11/11/2026):
        // la prima persona della domenica prima della seconda del martedi'
        if (!best || pg > pb || (pg === pb && (manca > best.manca || (manca === best.manca && c[i] < best.c)))) best = { g, i, manca, c: c[i] };
      }
    }
    if (!best) break;
    const p = scegli(best.g, best.i);
    if (!p) { bloccati.add(`${best.g.data}|${best.i}`); continue; }
    // Il turno ha la lunghezza giusta per le ore di contratto della persona
    // (accorciarlo sul buco lascerebbe ore pagate e non usate, perche' i
    // giorni di lavoro finiscono prima delle ore) e copre la mezz'ora del buco.
    const { lavoro, pausa } = durata(p, best.g, best.i);
    if (lavoro < regole.turnoMinOre * 60 - 1e-9) { bloccati.add(`${best.g.data}|${best.i}`); continue; }
    assegna(p, best.g, inizioNelBuco(p, best.g, best.i, lavoro + pausa), lavoro, pausa);
  }

  // 2. Le ore di contratto rimaste: nei giorni e nelle fasce dove serve di piu'
  for (let giro = 0; giro < 200; giro++) {
    const p = persone
      .filter((x) => giorni.some((g) => puoLavorare(x, g)))
      .sort((a, b) => (restanti.get(b.id)! - restanti.get(a.id)!) || a.id.localeCompare(b.id))[0];
    if (!p) break;
    const candidati = giorni.filter((g) => puoLavorare(p, g));
    let scelta: { g: GiornoPiano; inizio: number; lavoro: number; pausa: number; peso: number } | null = null;
    for (const g of candidati) {
      const { lavoro, pausa } = durata(p, g);
      if (lavoro < regole.turnoMinOre * 60 - 1e-9) continue;
      const span = lavoro + pausa;
      const c = cop.get(g.data)!;
      const l = limitiPersona(p, g);
      for (let s = l.apre; s + span <= l.chiude; s += SLOT_MINUTI) {
        let peso = 0;
        for (let i = 0; i < c.length; i++) {
          const t = g.apre + i * SLOT_MINUTI;
          if (t >= s && t < s + span) peso += g.fabbisogno[i] - c[i] / 2;
        }
        if (!scelta || peso > scelta.peso) scelta = { g, inizio: s, lavoro, pausa, peso };
      }
    }
    if (!scelta) { restanti.set(p.id, 0); continue; }
    assegna(p, scelta.g, scelta.inizio, scelta.lavoro, scelta.pausa);
  }

  const tutti = [...fissi, ...proposti];
  const ore: EsitoProposta['ore'] = {};
  for (const p of args.persone) {
    ore[p.id] = {
      contratto: p.ore,
      pianificate: tutti.filter((t) => t.employeeId === p.id).reduce((s, t) => s + oreLavorate(t), 0),
    };
  }

  return {
    turni: rispettaFasce(proposti, persone, regole).sort((a, b) => a.data.localeCompare(b.data) || a.inizio.localeCompare(b.inizio)),
    scoperture: giorni.flatMap((g) => scopertureDelGiorno(g, tutti)),
    ore,
  };
}
