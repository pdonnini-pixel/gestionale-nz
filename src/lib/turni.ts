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
  /** da quante ore lavorate scatta la pausa (6 ore esatte comprese) */
  pausaOltreOre: number;
  pausaMinuti: number;
  /** da quante ore lavorate la pausa diventa lunga (8 ore esatte comprese) */
  pausaLungaOltreOre: number;
  pausaLungaMinuti: number;
  giorniLavoroMax: number;
}

export const REGOLE_DEFAULT: RegoleTurni = {
  turnoMinOre: 4,
  turnoMaxOre: 10,
  pausaOltreOre: 6,
  pausaMinuti: 30,
  pausaLungaOltreOre: 8,
  pausaLungaMinuti: 60,
  giorniLavoroMax: 6,
};

/**
 * Pausa (minuti) per un turno di `lavoroMinuti` lavorati, in aggiunta alle ore
 * lavorate e mai pagata: 30 minuti da 6 ore, un'ora da 8 (Patrizio, 21/10/2026:
 * 7 ore di presenza = 6 lavorate e mezz'ora di pausa; 9 di presenza = 8 e un'ora).
 */
export function pausaMinimaPerPresenza(presenzaMinuti: number, regole: RegoleTurni = REGOLE_DEFAULT): number {
  // La pausa piu' corta che rispetta la regola per le ore che restano di lavoro.
  for (const p of [0, regole.pausaMinuti, regole.pausaLungaMinuti].sort((a, b) => a - b)) {
    if (pausaPer(presenzaMinuti - p, regole) <= p) return p;
  }
  return regole.pausaLungaMinuti;
}

/** Pausa (minuti) per un turno di `lavoroMinuti` lavorati: 30 da 6 ore, 60 da 8 (vedi `pausaMinimaPerPresenza`). */
export function pausaPer(lavoroMinuti: number, regole: RegoleTurni = REGOLE_DEFAULT): number {
  if (lavoroMinuti >= regole.pausaLungaOltreOre * 60) return regole.pausaLungaMinuti;
  if (lavoroMinuti >= regole.pausaOltreOre * 60) return regole.pausaMinuti;
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
} | null | undefined): RegoleTurni {
  if (!r) return REGOLE_DEFAULT;
  return {
    turnoMinOre: Number(r.turno_min_ore ?? REGOLE_DEFAULT.turnoMinOre), turnoMaxOre: Number(r.turno_max_ore),
    pausaOltreOre: Number(r.pausa_oltre_ore), pausaMinuti: Number(r.pausa_minuti),
    pausaLungaOltreOre: Number(r.pausa_lunga_oltre_ore ?? REGOLE_DEFAULT.pausaLungaOltreOre),
    pausaLungaMinuti: Number(r.pausa_lunga_minuti ?? REGOLE_DEFAULT.pausaLungaMinuti),
    giorniLavoroMax: Number(r.giorni_lavoro_max),
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
    return { data, giorno: g, chiuso: false, apre, chiude, fabbisogno, nota: sp?.nota ?? null, speciale: !!sp, evento, straordinari };
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

/** Quante persone hanno il turno in ogni mezz'ora, pause comprese. */
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

export interface PausaCollocata {
  employeeId: string;
  data: string;
  dalle: string;
  alle: string;
}

/** Almeno due ore di lavoro prima della pausa e almeno due dopo (Lilian, 19/10/2026: sul turno da 6 la pausa finisce entro 4 ore e mezza dall'inizio). */
export const PAUSA_DOPO_MINUTI = 120;

/**
 * Dove cade la pausa di ogni turno del giorno. Chi e' in pausa non e' in
 * negozio (Patrizio, 19/10/2026: «persone» sono le presenti, esclusa chi e'
 * in pausa), quindi le pause si sfalsano: ognuna va nella mezz'ora in cui
 * togliere una persona fa meno danno rispetto al fabbisogno. Funzione
 * deterministica: gli stessi turni danno sempre le stesse pause, e la
 * pagina le puo' ricalcolare senza salvarle.
 */
export function collocaPause(giorno: GiornoPiano, turni: Turno[]): PausaCollocata[] {
  if (giorno.chiuso) return [];
  const delGiorno = turni
    .filter((t) => t.data === giorno.data && (t.pausaMinuti || 0) > 0)
    .sort((a, b) => a.inizio.localeCompare(b.inizio) || a.employeeId.localeCompare(b.employeeId));
  const cop = coperturaLorda(giorno, turni);
  const out: PausaCollocata[] = [];
  for (const t of delGiorno) {
    const durata = Math.ceil(t.pausaMinuti / SLOT_MINUTI) * SLOT_MINUTI;
    const da = minuti(t.inizio);
    const a = minuti(t.fine);
    let primo = da + PAUSA_DOPO_MINUTI;
    let ultimo = a - PAUSA_DOPO_MINUTI - durata;
    if (ultimo < primo) { primo = da; ultimo = a - durata; }
    let scelta: { inizio: number; margine: number; somma: number } | null = null;
    for (let s = primo; s <= ultimo; s += SLOT_MINUTI) {
      let margine = Infinity;
      let somma = 0;
      for (let m = s; m < s + durata; m += SLOT_MINUTI) {
        const i = (m - giorno.apre) / SLOT_MINUTI;
        if (i < 0 || i >= cop.length) continue;
        const resto = cop[i] - 1 - giorno.fabbisogno[i];
        margine = Math.min(margine, resto);
        somma += resto;
      }
      if (!scelta || margine > scelta.margine || (margine === scelta.margine && somma > scelta.somma)) {
        scelta = { inizio: s, margine, somma };
      }
    }
    if (!scelta) continue;
    for (let m = scelta.inizio; m < scelta.inizio + durata; m += SLOT_MINUTI) {
      const i = (m - giorno.apre) / SLOT_MINUTI;
      if (i >= 0 && i < cop.length) cop[i] -= 1;
    }
    out.push({ employeeId: t.employeeId, data: t.data, dalle: hhmm(scelta.inizio), alle: hhmm(scelta.inizio + durata) });
  }
  return out;
}

/** Quante persone sono davvero in negozio in ogni mezz'ora: chi e' in pausa non conta. */
export function copertura(giorno: GiornoPiano, turni: Turno[]): number[] {
  const cop = coperturaLorda(giorno, turni);
  for (const p of collocaPause(giorno, turni)) {
    for (let m = minuti(p.dalle); m < minuti(p.alle); m += SLOT_MINUTI) {
      const i = (m - giorno.apre) / SLOT_MINUTI;
      if (i >= 0 && i < cop.length) cop[i] -= 1;
    }
  }
  return cop;
}

/** Le mezz'ore in cui mancano persone, unite in fasce. */
export function scopertureDelGiorno(giorno: GiornoPiano, turni: Turno[]): Scopertura[] {
  if (giorno.chiuso) return [];
  const cop = copertura(giorno, turni);
  const out: Scopertura[] = [];
  let i = 0;
  while (i < cop.length) {
    const manca = giorno.fabbisogno[i] - cop[i];
    if (manca <= 0) { i++; continue; }
    let j = i;
    while (j + 1 < cop.length && giorno.fabbisogno[j + 1] - cop[j + 1] === manca) j++;
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

/** Ore-persona che mancano, pause comprese. */
export function oreScoperte(giorni: GiornoPiano[], turni: Turno[]): number {
  return giorni.reduce((s, g) => s + copertura(g, turni)
    .reduce((a, c, i) => a + Math.max(0, g.fabbisogno[i] - c), 0) * (SLOT_MINUTI / 60), 0);
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
  const piena = migliorStrategia(args);
  // Senza fabbisogno non si sa cosa serve: si resta sulle ore di contratto.
  if (oreDaCoprire(args.giorni) <= 0) return piena;
  const regole = args.regole ?? REGOLE_DEFAULT;
  const fissi = args.fissi ?? [];
  const saldo = new Map(args.persone.map((p) => [p.id, p.saldoOre ?? 0]));
  // Sfrondare libera ore di contratto che il ritocco usa per chiudere i
  // buchi rimasti; poi si sfronda di nuovo quello che il ritocco ha lasciato in piu'.
  const sfrondati = sfrondaOreInPiu(args.giorni, piena.turni, fissi, regole, saldo);
  let ritoccati = ritoccaScoperture(args.giorni, sfrondati, fissi, args.persone, regole);
  // Nei giorni di evento, se mancano ancora persone, si va oltre il
  // contratto: sono straordinari (Patrizio, 20/10/2026), e si dicono.
  const giorniStraordinari = new Set(args.giorni.filter((g) => g.straordinari && !g.chiuso).map((g) => g.data));
  if (giorniStraordinari.size) ritoccati = ritoccaScoperture(args.giorni, ritoccati, fissi, args.persone, regole, giorniStraordinari);
  const turni = sfrondaOreInPiu(args.giorni, ritoccati, fissi, regole, saldo);
  const tutti = [...fissi, ...turni];
  const ore: EsitoProposta['ore'] = {};
  for (const p of args.persone) {
    const pianificate = tutti.filter((t) => t.employeeId === p.id).reduce((a, t) => a + oreLavorate(t), 0);
    ore[p.id] = { contratto: p.ore, pianificate, straordinario: Math.max(0, pianificate - p.ore) };
  }
  return { turni, scoperture: args.giorni.flatMap((g) => scopertureDelGiorno(g, tutti)), ore };
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
        const i0 = minuti(t.inizio);
        const lavoro = oreLavorate(t) * 60;
        const varianti = [
          conPausa(t, i0 - SLOT_MINUTI, lavoro + SLOT_MINUTI), // prima
          conPausa(t, i0, lavoro + SLOT_MINUTI), // dopo
          conPausa(t, i0 - SLOT_MINUTI, lavoro), // tutto prima
          conPausa(t, i0 + SLOT_MINUTI, lavoro), // tutto dopo
        ];
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
      let meglio: { t: Turno[]; ore: number } | null = null;
      for (const m of mosse) {
        const o = scop(m);
        if (o < base - 1e-9 && (!meglio || o < meglio.ore - 1e-9)) meglio = { t: m, ore: o };
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
  let meglio: { e: EsitoProposta; ore: number } | null = null;
  for (const ordine of ['pieni', 'buco'] as const) {
    for (const turni of ['pesati', 'uguali'] as const) {
      const e = proponiConStrategia(args, ordine, turni);
      const ore = oreScoperte(args.giorni, tutti(e));
      if (!meglio || ore < meglio.ore - 1e-9) meglio = { e, ore };
    }
  }
  return meglio!.e;
}

function proponiConStrategia(args: ArgsProposta, ordine: 'pieni' | 'buco', turni: 'pesati' | 'uguali'): EsitoProposta {
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

  // Copertura netta (chi e' in pausa non conta), ricalcolata sul giorno
  // ogni volta che si aggiunge un turno: le pause si risistemano insieme.
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

  const durata = (p: PersonaTurni, g: GiornoPiano): { lavoro: number; pausa: number } => {
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

  // chi puo' lavorare quel giorno e, con i suoi accordi, anche in quella mezz'ora
  const scegli = (g: GiornoPiano, i: number) => persone
    .filter((p) => puoLavorare(p, g) && (() => { const l = limitiPersona(p, g); const t = g.apre + i * SLOT_MINUTI; return t >= l.apre && t < l.chiude; })())
    .sort((a, b) => ((restanti.get(b.id)! / b.ore) - (restanti.get(a.id)! / a.ore))
      || (restanti.get(b.id)! - restanti.get(a.id)!)
      || a.id.localeCompare(b.id))[0];

  // 1. I buchi, dal piu' grande
  const bloccati = new Set<string>();
  for (let giro = 0; giro < 1000; giro++) {
    let best: { g: GiornoPiano; i: number; manca: number } | null = null;
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
        if (!best || pg > pb || (pg === pb && manca > best.manca)) best = { g, i, manca };
      }
    }
    if (!best) break;
    const p = scegli(best.g, best.i);
    if (!p) { bloccati.add(`${best.g.data}|${best.i}`); continue; }
    const c = cop.get(best.g.data)!;
    let r0 = best.i;
    while (r0 > 0 && best.g.fabbisogno[r0 - 1] - c[r0 - 1] > 0) r0--;
    // Il turno ha la lunghezza giusta per le ore di contratto della persona
    // (accorciarlo sul buco lascerebbe ore pagate e non usate, perche' i
    // giorni di lavoro finiscono prima delle ore) e parte dall'inizio del buco;
    // se il buco e' a fine giornata, finisce alla chiusura.
    const { lavoro, pausa } = durata(p, best.g);
    if (lavoro < regole.turnoMinOre * 60 - 1e-9) { bloccati.add(`${best.g.data}|${best.i}`); continue; }
    assegna(p, best.g, best.g.apre + r0 * SLOT_MINUTI, lavoro, pausa);
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
