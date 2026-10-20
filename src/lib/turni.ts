// Turni dei negozi: dalla settimana tipo e dal fabbisogno alla proposta.
//
// Ingredienti, tutti dal database:
//  - orari della settimana tipo del negozio (outlet_opening_hours) e giorni
//    speciali (outlet_special_days: festivi, chiusure, saldi);
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
  /** limite tecnico, non una regola del negozio: niente turni sotto l'ora (Patrizio, 19/10/2026: il turno minimo vincola e basta) */
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
  turnoMinOre: 1,
  turnoMaxOre: 8,
  pausaOltreOre: 6,
  pausaMinuti: 30,
  pausaLungaOltreOre: 8,
  pausaLungaMinuti: 60,
  giorniLavoroMax: 6,
};

/** Pausa (minuti) per un turno di `lavoroMinuti` lavorati: regola aziendale 6 ore = 30', 8 ore = un'ora. */
export function pausaPer(lavoroMinuti: number, regole: RegoleTurni = REGOLE_DEFAULT): number {
  if (lavoroMinuti >= regole.pausaLungaOltreOre * 60) return regole.pausaLungaMinuti;
  if (lavoroMinuti >= regole.pausaOltreOre * 60) return regole.pausaMinuti;
  return 0;
}

/** Regole da una riga di outlet_shift_rules (o i default se il negozio non ne ha). */
export function regoleDaRiga(r: {
  turno_min_ore?: number | string | null; turno_max_ore: number | string; pausa_oltre_ore: number | string; pausa_minuti: number | string;
  pausa_lunga_oltre_ore?: number | string | null; pausa_lunga_minuti?: number | string | null; giorni_lavoro_max: number | string;
} | null | undefined): RegoleTurni {
  if (!r) return REGOLE_DEFAULT;
  return {
    turnoMinOre: REGOLE_DEFAULT.turnoMinOre, turnoMaxOre: Number(r.turno_max_ore),
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
}

export interface PersonaTurni {
  id: string;
  /** ore settimanali di contratto */
  ore: number;
  /** giorni (ISO) in cui non puo' lavorare: ferie approvate, assenza, fuori contratto */
  nonDisponibile: Set<string>;
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
  /** ore di contratto e ore pianificate (fissi + proposti) per persona */
  ore: Record<string, { contratto: number; pianificate: number }>;
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

// ── I giorni della settimana con orari e fabbisogno ─────────────────────

/**
 * Per ogni data: se il negozio e' aperto, da che ora a che ora, e quante
 * persone servono in ogni mezz'ora. Il giorno speciale vince sulla
 * settimana tipo; le sue persone in piu' si aggiungono a tutta l'apertura.
 */
export function costruisciGiorni(
  date: string[],
  orari: OrarioGiornoTipo[],
  fasce: FasciaFabbisogno[],
  speciali: GiornoSpeciale[],
): GiornoPiano[] {
  return date.map((data) => {
    const g = giornoIso(data);
    const tipo = orari.find((o) => o.giorno === g);
    const sp = speciali.find((s) => s.data === data);
    const chiuso = sp ? sp.chiuso : (!tipo || tipo.chiuso || !tipo.apre || !tipo.chiude);
    const apre = minuti((sp && !sp.chiuso && sp.apre) || tipo?.apre || null);
    const chiude = minuti((sp && !sp.chiuso && sp.chiude) || tipo?.chiude || null);
    if (chiuso || chiude <= apre) {
      return { data, giorno: g, chiuso: true, apre: 0, chiude: 0, fabbisogno: [], nota: sp?.nota ?? null, speciale: !!sp };
    }
    const n = Math.floor((chiude - apre) / SLOT_MINUTI);
    const fasceGiorno = fasce.filter((f) => f.giorno === g);
    const extra = sp?.persone_extra ?? 0;
    const fabbisogno = Array.from({ length: n }, (_, i) => {
      const t = apre + i * SLOT_MINUTI;
      const base = fasceGiorno
        .filter((f) => minuti(f.dalle) <= t && t < minuti(f.alle))
        .reduce((m, f) => Math.max(m, f.persone), 0);
      return Math.max(0, base + extra);
    });
    return { data, giorno: g, chiuso: false, apre, chiude, fabbisogno, nota: sp?.nota ?? null, speciale: !!sp };
  });
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
    && (g.chiude - g.apre) >= regole.turnoMinOre * 60;

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
    const giornata = g.chiude - g.apre;
    // Se il turno con la sua pausa non sta nella giornata si accorcia di
    // mezz'ora alla volta (la pausa scende di fascia quando serve).
    while (lavoro > 0 && lavoro + pausaPer(lavoro, regole) > giornata) lavoro -= SLOT_MINUTI;
    return { lavoro, pausa: pausaPer(lavoro, regole) };
  };

  const assegna = (p: PersonaTurni, g: GiornoPiano, inizioMin: number, lavoro: number, pausa: number) => {
    const span = lavoro + pausa;
    let inizio = Math.max(g.apre, inizioMin);
    if (inizio + span > g.chiude) inizio = g.chiude - span;
    inizio = g.apre + Math.round((inizio - g.apre) / SLOT_MINUTI) * SLOT_MINUTI;
    if (inizio + span > g.chiude) inizio -= SLOT_MINUTI;
    const t: Turno = { employeeId: p.id, data: g.data, inizio: hhmm(inizio), fine: hhmm(inizio + span), pausaMinuti: pausa };
    proposti.push(t);
    lavora.get(p.id)!.add(g.data);
    restanti.set(p.id, (restanti.get(p.id) ?? 0) - lavoro / 60);
    ricalcola(g);
  };

  const scegli = (g: GiornoPiano) => persone
    .filter((p) => puoLavorare(p, g))
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
    const p = scegli(best.g);
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
      for (let s = g.apre; s + span <= g.chiude; s += SLOT_MINUTI) {
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
    turni: proposti.sort((a, b) => a.data.localeCompare(b.data) || a.inizio.localeCompare(b.inizio)),
    scoperture: giorni.flatMap((g) => scopertureDelGiorno(g, tutti)),
    ore,
  };
}
