// Piano mensile dei turni (Patrizio, 20/10/2026; disegno in ORGANICO_TURNI_NOTES.md).
//
//  1. Ogni giorno ha un tipo: lun-gio, venerdi', sabato, domenica, festivo,
//     Black Friday, weekend del Black Friday, feriali di Natale, vigilie.
//     Il tipo viene dal calendario, non dalla data: anno per anno i giorni
//     speciali si spostano e si riconoscono da soli.
//  2. Il traffico atteso (ingressi per ora) viene dalla storia MODA del
//     negozio: stesso tipo di giorno, stesso mese se c'e', altrimenti tutta
//     la storia di quel tipo. Il Black Friday di Valmontone vale quanto il suo
//     Black Friday 2025 (quasi due domeniche), non quanto un sabato qualsiasi.
//  3. Il fabbisogno non ha obiettivi: le ore disponibili della settimana si
//     distribuiscono fra giorni e mezz'ore come il traffico, con almeno una
//     persona sempre in negozio. «Il massimo con le persone che ci sono».
//  4. Prima del piano si fissano i sabati e le domeniche liberi del mese, a
//     rotazione: prima a chi ne ha avuti meno (storico dei piani scelti).
//  5. Poi le settimane, con la proposta di turni.ts; le persone a chiamata
//     sono la riserva per i buchi che restano.
//
// Funzioni pure, nessuna query. Test in pianoMensile.test.ts.

import { festivitaItaliane } from './ferieRichiesta';
import {
  SLOT_MINUTI, REGOLE_DEFAULT, giornoIso, lunediDi, giorniDellaSettimana, pausaPer, proponiSettimana,
  ritoccaScoperture, oreLavorate, oreScoperte, scopertureDelGiorno, coperturaLorda, minuti, hhmm,
  type GiornoPiano, type PersonaTurni, type RegoleTurni, type Turno, type Scopertura,
} from './turni';

// ── Tipo di giorno ───────────────────────────────────────────────────────

export type TipoGiorno =
  | 'feriale' | 'venerdi' | 'sabato' | 'domenica'
  | 'festivo' | 'black_friday' | 'bf_weekend' | 'natale_feriale' | 'vigilia';

export const ETICHETTE_TIPO_GIORNO: Record<TipoGiorno, string> = {
  feriale: 'lun-gio', venerdi: 'venerdì', sabato: 'sabato', domenica: 'domenica',
  festivo: 'festivo', black_friday: 'Black Friday', bf_weekend: 'weekend del Black Friday',
  natale_feriale: 'settimane di Natale', vigilia: 'vigilia',
};

/** L'ultimo venerdi' di novembre. */
export function blackFriday(anno: number): string {
  const d = new Date(Date.UTC(anno, 10, 30));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const cacheFestivi = new Map<number, Record<string, string>>();
function festivi(anno: number): Record<string, string> {
  if (!cacheFestivi.has(anno)) cacheFestivi.set(anno, festivitaItaliane(anno));
  return cacheFestivi.get(anno)!;
}

/** Il tipo del giorno dal calendario, con il nome della festa quando c'e'. */
export function tipoDelGiorno(data: string): { tipo: TipoGiorno; nome: string | null } {
  const anno = Number(data.slice(0, 4));
  const md = data.slice(5);
  const g = giornoIso(data);
  const festa = festivi(anno)[data] ?? null;
  const bf = blackFriday(anno);
  if (data === bf) return { tipo: 'black_friday', nome: 'Black Friday' };
  const giorniDopoBf = (Date.parse(data) - Date.parse(bf)) / 86400000;
  if (giorniDopoBf === 1 || giorniDopoBf === 2) return { tipo: 'bf_weekend', nome: 'weekend del Black Friday' };
  if (festa && g !== 7) return { tipo: 'festivo', nome: festa };
  if (md === '12-24' || md === '12-31') return { tipo: 'vigilia', nome: md === '12-24' ? 'Vigilia di Natale' : 'San Silvestro' };
  if (g <= 5 && md >= '12-22' && md <= '12-30') return { tipo: 'natale_feriale', nome: 'settimane di Natale' };
  if (g === 7) return { tipo: 'domenica', nome: festa };
  if (g === 6) return { tipo: 'sabato', nome: null };
  if (g === 5) return { tipo: 'venerdi', nome: null };
  return { tipo: 'feriale', nome: null };
}

/** Quando un tipo non ha storia, si usa il piu' vicino. */
function ripiegoTipo(tipo: TipoGiorno, data: string): TipoGiorno | null {
  switch (tipo) {
    case 'black_friday': return 'sabato';
    case 'bf_weekend': return giornoIso(data) === 7 ? 'domenica' : 'sabato';
    case 'festivo': return 'domenica';
    case 'natale_feriale': return giornoIso(data) === 5 ? 'venerdi' : 'feriale';
    case 'vigilia': return 'feriale';
    case 'venerdi': return 'feriale';
    default: return null;
  }
}

// ── Traffico atteso ──────────────────────────────────────────────────────

export interface RigaTraffico { data: string; ora: number; ingressi: number }

export interface StoricoTraffico {
  /** per tipo e mese (1-12): media degli ingressi per ora, e quanti giorni */
  perTipoMese: Map<string, { giorni: number; ore: number[] }>;
  perTipo: Map<TipoGiorno, { giorni: number; ore: number[] }>;
  giorni: number;
}

export function storicoTraffico(righe: RigaTraffico[], esclusi: Set<string> = new Set()): StoricoTraffico {
  const perGiorno = new Map<string, number[]>();
  for (const r of righe) {
    if (esclusi.has(r.data) || r.ora < 0 || r.ora > 23) continue;
    if (!perGiorno.has(r.data)) perGiorno.set(r.data, new Array(24).fill(0));
    perGiorno.get(r.data)![r.ora] += Math.max(0, r.ingressi);
  }
  const accum = (m: Map<string, { giorni: number; ore: number[] }>, k: string, ore: number[]) => {
    if (!m.has(k)) m.set(k, { giorni: 0, ore: new Array(24).fill(0) });
    const x = m.get(k)!; x.giorni += 1; ore.forEach((v, i) => { x.ore[i] += v; });
  };
  const perTipoMese = new Map<string, { giorni: number; ore: number[] }>();
  const perTipo = new Map<string, { giorni: number; ore: number[] }>();
  for (const [data, ore] of perGiorno) {
    // un giorno senza ingressi e' un negozio chiuso, non un giorno vuoto
    if (ore.reduce((a, b) => a + b, 0) <= 0) continue;
    const { tipo } = tipoDelGiorno(data);
    accum(perTipoMese, `${tipo}|${Number(data.slice(5, 7))}`, ore);
    accum(perTipo, tipo, ore);
  }
  const media = (m: Map<string, { giorni: number; ore: number[] }>) => {
    for (const x of m.values()) x.ore = x.ore.map((v) => v / x.giorni);
  };
  media(perTipoMese); media(perTipo);
  return { perTipoMese, perTipo: perTipo as Map<TipoGiorno, { giorni: number; ore: number[] }>, giorni: perGiorno.size };
}

/**
 * Ingressi attesi per ora in quella data: stesso tipo e stesso mese se ci sono
 * almeno due giorni (uno per i tipi che capitano una volta l'anno), poi stesso
 * tipo in tutta la storia, poi il tipo piu' vicino. Null se il negozio non ha storia.
 */
export function trafficoAtteso(st: StoricoTraffico, data: string): { ore: number[]; fonte: string } | null {
  if (!st.giorni) return null;
  const mese = Number(data.slice(5, 7));
  let tipo: TipoGiorno | null = tipoDelGiorno(data).tipo;
  while (tipo) {
    const unaVolta = tipo === 'black_friday' || tipo === 'bf_weekend' || tipo === 'festivo' || tipo === 'vigilia';
    const m = st.perTipoMese.get(`${tipo}|${mese}`);
    if (m && m.giorni >= (unaVolta ? 1 : 2)) return { ore: m.ore, fonte: `${ETICHETTE_TIPO_GIORNO[tipo]} di ${NOMI_MESE[mese]}` };
    const t = st.perTipo.get(tipo);
    if (t && t.giorni >= 1) return { ore: t.ore, fonte: `${ETICHETTE_TIPO_GIORNO[tipo]}, tutta la storia` };
    tipo = ripiegoTipo(tipo, data);
  }
  return null;
}

export const NOMI_MESE = ['', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

// ── Fabbisogno dal traffico ──────────────────────────────────────────────

/**
 * Le ore disponibili della settimana distribuite come il traffico: in ogni
 * mezz'ora round(k × ingressi attesi), almeno una persona, mai piu' delle
 * persone disponibili quel giorno; k e' il piu' grande che sta nelle ore.
 * Le persone in piu' degli eventi si sommano dopo. Senza traffico per un
 * giorno resta il fabbisogno che c'era.
 */
export function fabbisognoDaTraffico(
  giorni: GiornoPiano[],
  atteso: Map<string, number[]>,
  oreDisponibili: number,
  maxPersone: Map<string, number>,
  extra: Map<string, number> = new Map(),
): GiornoPiano[] {
  const conTraffico = giorni.filter((g) => !g.chiuso && atteso.has(g.data));
  const peso = (g: GiornoPiano, i: number) => {
    const t = g.apre + i * SLOT_MINUTI;
    return (atteso.get(g.data)![Math.floor(t / 60)] ?? 0) / (60 / SLOT_MINUTI);
  };
  const costruisci = (k: number) => giorni.map((g) => {
    if (g.chiuso || !atteso.has(g.data)) return g;
    const max = Math.max(1, maxPersone.get(g.data) ?? 1);
    const fabbisogno = g.fabbisogno.map((_, i) => Math.min(max, Math.max(1, Math.round(k * peso(g, i)))) + (extra.get(g.data) ?? 0));
    return { ...g, fabbisogno };
  });
  if (!conTraffico.length) return giorni;
  const ore = (gg: GiornoPiano[]) => gg.reduce((s, g) => s + (atteso.has(g.data) ? g.fabbisogno.reduce((a, b) => a + b, 0) * SLOT_MINUTI / 60 : 0), 0);
  let lo = 0, hi = 1;
  while (ore(costruisci(hi)) < oreDisponibili && hi < 1e4) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ore(costruisci(mid)) <= oreDisponibili) lo = mid; else hi = mid;
  }
  // Quello che MODA chiederebbe senza il tetto delle persone di quel giorno
  // (Patrizio, 21/10/2026): serve a dire dove manca personale.
  return costruisci(lo).map((g) => (g.chiuso || !atteso.has(g.data) ? g : {
    ...g,
    esigenza: g.fabbisogno.map((_, i) => Math.max(1, Math.round(lo * peso(g, i))) + (extra.get(g.data) ?? 0)),
  }));
}

// ── Sabati e domeniche liberi ────────────────────────────────────────────

export type RegolaWeekend = 'nessuno' | 'solo_sabati' | 'solo_domeniche' | 'sabato_o_domenica';

export const ETICHETTE_REGOLA: Record<RegolaWeekend, string> = {
  nessuno: 'nessun sabato né domenica liberi',
  solo_sabati: 'un sabato libero a rotazione',
  solo_domeniche: 'una domenica libera a rotazione',
  sabato_o_domenica: 'un sabato o una domenica liberi a rotazione',
};

/** Quante persone servono almeno in quel giorno: il picco, chi apre e chi chiude, le ore. */
export function personeMinime(g: GiornoPiano, regole: RegoleTurni = REGOLE_DEFAULT): number {
  if (g.chiuso || !g.fabbisogno.length) return 0;
  const picco = Math.max(...g.fabbisogno);
  const oreServono = g.fabbisogno.reduce((a, b) => a + b, 0) * SLOT_MINUTI / 60;
  const turnoPieno = regole.turnoMaxOre * 60 + pausaPer(regole.turnoMaxOre * 60, regole);
  const aprireEChiudere = (g.chiude - g.apre) > turnoPieno ? g.fabbisogno[0] + g.fabbisogno[g.fabbisogno.length - 1] : 1;
  return Math.max(picco, aprireEChiudere, Math.ceil(oreServono / regole.turnoMaxOre));
}

export interface PersonaWeekend { id: string; disponibile: (data: string) => boolean }

/**
 * Assegna i sabati e le domeniche liberi del mese: un giorno a testa, quando
 * possibile (Patrizio, 20/10/2026). I giorni liberi si spargono sui weekend
 * validi (persone / giorni validi per giorno, per eccesso), mai scendendo
 * sotto le persone che servono quel giorno, e vanno prima a chi ne ha avuti
 * meno nei mesi scelti prima (storico): l'equita' si misura nel tempo, non
 * nel singolo mese. Nei giorni «senza liberi» (eventi) nessuno.
 */
export function assegnaWeekendLiberi(args: {
  giorni: GiornoPiano[];
  persone: PersonaWeekend[];
  regola: RegolaWeekend;
  storico: Map<string, number>;
  senzaLiberi?: Set<string>;
  regole?: RegoleTurni;
}): Map<string, string[]> {
  const { giorni, persone, regola, storico } = args;
  const regole = args.regole ?? REGOLE_DEFAULT;
  const out = new Map<string, string[]>();
  if (regola === 'nessuno') return out;
  const validi = giorni.filter((g) => {
    const d = giornoIso(g.data);
    if (g.chiuso || args.senzaLiberi?.has(g.data)) return false;
    return (d === 6 && regola !== 'solo_domeniche') || (d === 7 && regola !== 'solo_sabati');
  }).sort((a, b) => a.data.localeCompare(b.data));
  if (!validi.length) return out;
  const perGiorno = Math.ceil(persone.length / validi.length);
  const giaAvuto = new Set<string>();
  for (const g of validi) {
    const disponibili = persone.filter((p) => p.disponibile(g.data));
    const posti = Math.min(perGiorno, disponibili.length - personeMinime(g, regole));
    if (posti <= 0) continue;
    const scelti = disponibili
      .filter((p) => !giaAvuto.has(p.id))
      .sort((a, b) => ((storico.get(a.id) ?? 0) - (storico.get(b.id) ?? 0)) || a.id.localeCompare(b.id))
      .slice(0, posti)
      .map((p) => p.id);
    scelti.forEach((id) => giaAvuto.add(id));
    if (scelti.length) out.set(g.data, scelti);
  }
  return out;
}

// ── Mai il negozio vuoto (Patrizio, 21/10/2026) ───────────────────────────

/**
 * Ripara i buchi di copertura: ogni mezz'ora di apertura deve avere almeno una
 * persona. Per ogni buco, nell'ordine: (1) si allunga un turno che lo tocca, se
 * la persona ha ancora ore; (2) un turno nuovo a chi quel giorno non lavora e ha
 * ore e giorni; (3) si prendono ore dove ci sono gia' due o piu' persone,
 * accorciando turni o togliendo un turno di un altro giorno della settimana che
 * non lascia vuoto nessuno, e con quelle si copre il buco; (4) chi e' a chiamata.
 * Se non basta, il buco resta e la pagina lo segnala come personale mancante.
 */
export function copriOrarioMinimo(
  base: GiornoPiano[], turni: Turno[], titolari: PersonaTurni[], riserva: PersonaTurni[], regole: RegoleTurni = REGOLE_DEFAULT,
): Turno[] {
  let out = [...turni];
  const giorni = base.filter((g) => !g.chiuso);
  const cop = (g: GiornoPiano, lista = out) => coperturaLorda(g, lista);
  const ore = (id: string, lista = out) => lista.filter((t) => t.employeeId === id).reduce((a, t) => a + oreLavorate(t), 0);
  const giorniDi = (id: string, lista = out) => new Set(lista.filter((t) => t.employeeId === id).map((t) => t.data));
  const conPausa = (t: Turno, inizio: number, lavoro: number): Turno => {
    const pausa = pausaPer(lavoro, regole);
    return { ...t, inizio: hhmm(inizio), fine: hhmm(inizio + lavoro + pausa), pausaMinuti: pausa };
  };
  const nessunBuco = (lista: Turno[], date: string[]) => giorni.filter((g) => date.includes(g.data)).every((g) => cop(g, lista).every((c) => c >= 1));
  const primoBuco = () => {
    for (const g of giorni) {
      const c = cop(g);
      const i = c.findIndex((x) => x === 0);
      if (i >= 0) { let j = i; while (j < c.length && c[j] === 0) j++; return { g, a: g.apre + i * SLOT_MINUTI, b: g.apre + j * SLOT_MINUTI }; }
    }
    return null;
  };
  // Turno che copre [a, b) (o il pezzo che si puo') con `lavoro` minuti, dentro l'orario.
  const turnoPer = (id: string, g: GiornoPiano, a: number, b: number, lavoro: number): Turno => {
    const durata = lavoro + pausaPer(lavoro, regole);
    const inizio = Math.max(g.apre, Math.min(a, g.chiude - durata, b - durata < a ? a : b - durata));
    return conPausa({ employeeId: id, data: g.data, inizio: '', fine: '', pausaMinuti: 0 }, Math.max(g.apre, Math.min(inizio, g.chiude - durata)), lavoro);
  };
  const lavoroPer = (a: number, b: number, disponibili: number) => {
    const serve = Math.max(regole.turnoMinOre * 60, b - a);
    return Math.min(regole.turnoMaxOre * 60, serve, Math.floor(disponibili * 2) / 2 * 60);
  };

  // Il passo (1) su un giorno qualsiasi: restituisce la lista migliorata o null.
  function migliora(lista: Turno[], g: GiornoPiano): Turno[] | null {
    const vuote = (l: Turno[]) => cop(g, l).filter((x) => x === 0).length;
    const prima = vuote(lista);
    if (!prima) return null;
    let meglio: { lista: Turno[]; v: number } | null = null;
    for (const t of lista.filter((x) => x.data === g.data)) {
      const p = titolari.find((x) => x.id === t.employeeId) ?? riserva.find((x) => x.id === t.employeeId);
      if (!p) continue;
      const oraLav = oreLavorate(t) * 60;
      const maxLav = Math.min(regole.turnoMaxOre * 60, oraLav + Math.floor((p.ore - ore(p.id, lista)) * 2) / 2 * 60);
      for (let lav = oraLav; lav <= maxLav; lav += SLOT_MINUTI) {
        const durata = lav + pausaPer(lav, regole);
        for (let s0 = g.apre; s0 + durata <= g.chiude; s0 += SLOT_MINUTI) {
          const v = conPausa(t, s0, lav);
          const l2 = lista.map((x) => (x === t ? v : x));
          const n = vuote(l2);
          if (n < prima && (!meglio || n < meglio.v)) meglio = { lista: l2, v: n };
        }
      }
    }
    return meglio ? (meglio as { lista: Turno[] }).lista : null;
  }
  // Rimette a posto un giorno spostando chi ci lavora, finche' non resta vuoto nulla.
  function sistemaGiorno(lista: Turno[], g: GiornoPiano): Turno[] | null {
    let l = lista;
    for (let k = 0; k < 20; k++) {
      if (cop(g, l).every((x) => x >= 1)) return l;
      const m = migliora(l, g);
      if (!m) return null;
      l = m;
    }
    return cop(g, l).every((x) => x >= 1) ? l : null;
  }

  // Ore liberate a una persona accorciando di mezz'ora alla volta i suoi turni della
  // settimana dove c'e' anche qualcun altro, senza lasciare vuoto nessuno e senza
  // scendere sotto il turno minimo, finche' le ore libere arrivano a `serve` minuti.
  function liberaOre(lista: Turno[], p: PersonaTurni, serve: number, escludi: string[], settimana: string[]): Turno[] {
    let prova = lista;
    for (let k = 0; k < 40; k++) {
      if ((p.ore - ore(p.id, prova)) * 60 >= serve - 1e-9) break;
      let preso = false;
      for (const t of prova.filter((x) => x.employeeId === p.id && !escludi.includes(x.data) && settimana.includes(x.data))) {
        if (!giorni.some((x) => x.data === t.data)) continue;
        const lav = oreLavorate(t) * 60 - SLOT_MINUTI;
        if (lav < regole.turnoMinOre * 60) continue;
        for (const v of [conPausa(t, minuti(t.inizio) + SLOT_MINUTI, lav), conPausa(t, minuti(t.inizio), lav)]) {
          const l2 = prova.map((x) => (x === t ? v : x));
          if (nessunBuco(l2, [t.data])) { prova = l2; preso = true; break; }
        }
        if (preso) break;
      }
      if (!preso) break;
    }
    return prova;
  }

  for (let giro = 0; giro < 300; giro++) {
    const buco = primoBuco();
    if (!buco) break;
    const { g, a, b } = buco;
    const settimana = giorniDellaSettimana(lunediDi(g.data));
    let fatto = false;

    // (1) chi lavora gia' quel giorno: si prova ogni posizione e durata del suo
    // turno (entro le sue ore e il turno massimo) e si tiene quella che lascia
    // meno mezz'ore vuote nel giorno, senza svuotarne altre.
    const migliorato = migliora(out, g);
    if (migliorato) { out = migliorato; continue; }

    // (2) un turno nuovo a chi quel giorno non lavora e ha ore e giorni
    const liberi = (gruppo: PersonaTurni[]) => gruppo.filter((p) => !p.nonDisponibile.has(g.data) && !giorniDi(p.id).has(g.data)
      && giorniDi(p.id, out.filter((t) => settimana.includes(t.data))).size < regole.giorniLavoroMax);
    for (const p of liberi(titolari).sort((x, y) => (y.ore - ore(y.id)) - (x.ore - ore(x.id)))) {
      const lavoro = lavoroPer(a, b, p.ore - ore(p.id));
      if (lavoro < regole.turnoMinOre * 60) continue;
      out = [...out, turnoPer(p.id, g, a, b, lavoro)];
      fatto = true; break;
    }
    if (fatto) continue;

    // (3) prendere ore dove ci sono gia' due o piu' persone
    for (const p of titolari.filter((x) => !x.nonDisponibile.has(g.data))) {
      const haGiorno = giorniDi(p.id).has(g.data);
      const suoGiornoQui = out.find((t) => t.employeeId === p.id && t.data === g.data);
      if (suoGiornoQui && !(minuti(suoGiornoQui.fine) === a || minuti(suoGiornoQui.inizio) === b)) continue;
      // turni di p in altri giorni della settimana, dal meno utile
      const altri = out.filter((t) => t.employeeId === p.id && t.data !== g.data && settimana.includes(t.data));
      let prova = out;
      // (3a) togliere un intero turno che non lascia vuoto nessuno (libera ore e un giorno)
      if (!haGiorno) {
        const togli = altri.find((t) => nessunBuco(prova.filter((x) => x !== t), [t.data]));
        if (togli) {
          const senza = prova.filter((x) => x !== togli);
          const lavoro = lavoroPer(a, b, p.ore - ore(p.id, senza));
          if (lavoro >= regole.turnoMinOre * 60) { out = [...senza, turnoPer(p.id, g, a, b, lavoro)]; fatto = true; break; }
        }
      }
      // (3b) accorciare turni dove ci sono altri, mezz'ora alla volta, poi allungare o creare
      prova = liberaOre(prova, p, haGiorno ? SLOT_MINUTI : regole.turnoMinOre * 60, [g.data], settimana);
      const libere = p.ore - ore(p.id, prova);
      if (suoGiornoQui) {
        const t = prova.find((x) => x.employeeId === p.id && x.data === g.data)!;
        const lavoroOra = oreLavorate(t) * 60;
        const aggiunta = Math.min(b - a, Math.floor(libere * 2) / 2 * 60, regole.turnoMaxOre * 60 - lavoroOra);
        if (aggiunta >= SLOT_MINUTI) {
          const nuovo = minuti(t.fine) === a ? conPausa(t, minuti(t.inizio), lavoroOra + aggiunta) : conPausa(t, b - aggiunta - lavoroOra, lavoroOra + aggiunta);
          if (minuti(nuovo.inizio) >= g.apre && minuti(nuovo.fine) <= g.chiude) { out = prova.map((x) => (x === t ? nuovo : x)); fatto = true; break; }
        }
      } else if (giorniDi(p.id, prova.filter((t) => settimana.includes(t.data))).size < regole.giorniLavoroMax) {
        const lavoro = lavoroPer(a, b, libere);
        if (lavoro >= regole.turnoMinOre * 60) { out = [...prova, turnoPer(p.id, g, a, b, lavoro)]; fatto = true; break; }
      }
    }
    if (fatto) continue;

    // (3c) spostare il turno di un'altra giornata: si toglie, si risistema quella
    // giornata con chi ci lavora, e la persona copre il buco qui.
    for (const p of titolari.filter((x) => !x.nonDisponibile.has(g.data) && !giorniDi(x.id).has(g.data))) {
      for (const t of out.filter((x) => x.employeeId === p.id && x.data !== g.data && settimana.includes(x.data))) {
        const g2 = giorni.find((x) => x.data === t.data);
        if (!g2) continue;
        const senza = out.filter((x) => x !== t);
        let sistemata = sistemaGiorno(senza, g2);
        // Se chi lavora in quella giornata non ha ore per allungarsi, le si prendono
        // dai suoi turni degli altri giorni dove c'e' gia' qualcun altro.
        const vuoteG2 = cop(g2, senza).filter((x) => x === 0).length * SLOT_MINUTI;
        for (const q of titolari.filter((x) => x.id !== p.id && senza.some((y) => y.employeeId === x.id && y.data === g2.data))) {
          if (sistemata) break;
          sistemata = sistemaGiorno(liberaOre(senza, q, vuoteG2, [g2.data, g.data], settimana), g2);
        }
        if (!sistemata) continue;
        const lavoro = lavoroPer(a, b, p.ore - ore(p.id, sistemata));
        if (lavoro < regole.turnoMinOre * 60) continue;
        out = [...sistemata, turnoPer(p.id, g, a, b, lavoro)];
        fatto = true; break;
      }
      if (fatto) break;
    }
    if (fatto) continue;

    // (4) chi e' a chiamata
    for (const p of liberi(riserva)) {
      const lavoro = lavoroPer(a, b, p.ore - ore(p.id));
      if (lavoro < regole.turnoMinOre * 60) continue;
      out = [...out, turnoPer(p.id, g, a, b, lavoro)];
      fatto = true; break;
    }
    if (fatto) continue;

    // Niente da fare: il buco resta e si segnala. Lo si segna coperto in una copia
    // solo per passare al successivo.
    break;
  }
  return out;
}

// ── Le ore di contratto che avanzano (Patrizio, 20/10/2026) ──────────────

/**
 * Prima si usano tutte le ore: a chi ha ancora ore di contratto nella settimana
 * si allungano i turni di mezz'ora alla volta dove il traffico MODA e' piu' alto
 * e ci sono meno colleghi, entro il turno massimo e gli orari del negozio; se non
 * basta, un turno nuovo (almeno il turno minimo) in un giorno in cui non lavora,
 * senza superare i giorni di lavoro. Quello che resta diventa una proposta di
 * ferie (`proponiFerie`), mai ore pagate senza lavoro.
 */
export function usaOreResidue(
  giorni: GiornoPiano[], turni: Turno[], persone: PersonaTurni[], atteso: Map<string, number[]>, regole: RegoleTurni = REGOLE_DEFAULT,
): Turno[] {
  let out = [...turni];
  const giorno = new Map(giorni.filter((g) => !g.chiuso).map((g) => [g.data, g]));
  // Peso di una mezz'ora: ingressi attesi diviso le persone gia' in negozio.
  const peso = (g: GiornoPiano, inizioMin: number, fineMin: number, lista: Turno[]) => {
    const cop = coperturaLorda(g, lista);
    let w = 0;
    for (let t = inizioMin; t < fineMin; t += SLOT_MINUTI) {
      const i = Math.floor((t - g.apre) / SLOT_MINUTI);
      const ingressi = (atteso.get(g.data)?.[Math.floor(t / 60)] ?? 1) + 0.01;
      w += ingressi / (1 + (cop[i] ?? 0));
    }
    return w;
  };
  const conPausa = (t: Turno, inizio: number, lavoro: number): Turno => {
    const pausa = pausaPer(lavoro, regole);
    return { ...t, inizio: hhmm(inizio), fine: hhmm(inizio + lavoro + pausa), pausaMinuti: pausa };
  };
  for (const p of persone) {
    let residuo = p.ore - out.filter((t) => t.employeeId === p.id).reduce((a, t) => a + oreLavorate(t), 0);
    for (let giro = 0; residuo >= 0.5 - 1e-9 && giro < 400; giro++) {
      let meglio: { lista: Turno[]; w: number } | null = null;
      // 1. allungare un turno che c'e' gia'
      out.forEach((t, idx) => {
        if (t.employeeId !== p.id) return;
        const g = giorno.get(t.data);
        if (!g) return;
        const i0 = minuti(t.inizio);
        const lavoro = oreLavorate(t) * 60 + SLOT_MINUTI;
        if (lavoro > regole.turnoMaxOre * 60) return;
        for (const v of [conPausa(t, i0 - SLOT_MINUTI, lavoro), conPausa(t, i0, lavoro)]) {
          if (minuti(v.inizio) < g.apre || minuti(v.fine) > g.chiude) continue;
          const lista = out.map((x, k) => (k === idx ? v : x));
          const nuovo = minuti(v.inizio) < i0 ? [minuti(v.inizio), i0] : [minuti(t.fine), minuti(v.fine)];
          const w = peso(g, nuovo[0], nuovo[1], out);
          if (!meglio || w > meglio.w) meglio = { lista, w };
        }
      });
      if (meglio) { out = (meglio as { lista: Turno[] }).lista; residuo -= 0.5; continue; }
      // 2. un turno nuovo in un giorno in cui non lavora
      const suoi = new Set(out.filter((t) => t.employeeId === p.id).map((t) => t.data));
      const lavoro = Math.min(regole.turnoMaxOre, Math.floor(residuo * 2) / 2) * 60;
      if (suoi.size >= regole.giorniLavoroMax || lavoro < regole.turnoMinOre * 60 - 1e-9) break;
      let nuovo: { t: Turno; w: number } | null = null;
      for (const g of giorno.values()) {
        if (suoi.has(g.data) || p.nonDisponibile.has(g.data)) continue;
        const durata = lavoro + pausaPer(lavoro, regole);
        for (let s0 = g.apre; s0 + durata <= g.chiude; s0 += SLOT_MINUTI) {
          const t = conPausa({ employeeId: p.id, data: g.data, inizio: '', fine: '', pausaMinuti: 0 }, s0, lavoro);
          const w = peso(g, s0, s0 + durata, out) / (durata / SLOT_MINUTI);
          if (!nuovo || w > nuovo.w) nuovo = { t, w };
        }
      }
      if (!nuovo) break;
      out = [...out, (nuovo as { t: Turno }).t];
      residuo -= lavoro / 60;
    }
  }
  return out;
}

export interface FinestraSuggerita {
  data: string; inizio: string; fine: string; pausaMinuti: number; ore: number;
  /** ingressi attesi per persona gia' presente, in media sulla finestra */
  ingressiPerPersona: number;
}

/**
 * Dove mettere le ore che avanzano a una persona (Patrizio, 21/10/2026): le
 * finestre del mese con piu' ingressi MODA per persona gia' in negozio, una
 * per giorno, nei giorni in cui puo' lavorare e non ha gia' un turno. Il
 * Black Friday e gli altri giorni di punta vincono da soli, perche' hanno piu'
 * traffico. La durata e' quella delle ore che restano, entro turno minimo e
 * massimo. Quando la responsabile HR ne sceglie una decide se sono ore di
 * contratto del mese o straordinario.
 */
export function suggerisciFinestre(args: {
  giorni: GiornoPiano[]; atteso: Map<string, number[]>; turni: Turno[];
  possibile: (data: string) => boolean; ore: number; regole?: RegoleTurni; quante?: number;
}): FinestraSuggerita[] {
  const regole = args.regole ?? REGOLE_DEFAULT;
  const lavoro = Math.min(regole.turnoMaxOre, Math.max(regole.turnoMinOre, Math.round(args.ore * 2) / 2)) * 60;
  const pausa = pausaPer(lavoro, regole);
  const durata = lavoro + pausa;
  const out: FinestraSuggerita[] = [];
  for (const g of args.giorni) {
    if (g.chiuso || !args.possibile(g.data) || g.chiude - g.apre < durata) continue;
    const cop = coperturaLorda(g, args.turni);
    let meglio: FinestraSuggerita | null = null;
    for (let s0 = g.apre; s0 + durata <= g.chiude; s0 += SLOT_MINUTI) {
      let w = 0; let n = 0;
      for (let t = s0; t < s0 + durata; t += SLOT_MINUTI) {
        const i = Math.floor((t - g.apre) / SLOT_MINUTI);
        w += (args.atteso.get(g.data)?.[Math.floor(t / 60)] ?? 0) / (1 + (cop[i] ?? 0));
        n++;
      }
      const media = n ? w / n : 0;
      if (!meglio || media > meglio.ingressiPerPersona) {
        meglio = { data: g.data, inizio: hhmm(s0), fine: hhmm(s0 + durata), pausaMinuti: pausa, ore: lavoro / 60, ingressiPerPersona: media };
      }
    }
    if (meglio) out.push(meglio);
  }
  return out.sort((a, b) => b.ingressiPerPersona - a.ingressiPerPersona).slice(0, args.quante ?? 3);
}

export interface FeriaProposta { data: string; voce: 'F01' | 'F02'; tipo: 'giornata' | 'ore'; ore: number }

/**
 * Le ore che restano dopo `usaOreResidue` diventano una proposta di ferie da
 * concordare con la dipendente: giornate intere (ore settimanali / 6, la regola
 * a giornata) di ferie
 * nei feriali in cui non lavora, distribuite sulle settimane, e il resto come
 * permesso a ore. Si propone soltanto: la decide la responsabile HR.
 */
export function proponiFerie(args: {
  ore: number; oreSettimana: number; date: string[]; possibile: (data: string) => boolean;
}): FeriaProposta[] {
  const giornata = Math.round(oreGiornata(args.oreSettimana) * 100) / 100;
  if (args.ore < 1 || giornata <= 0) return [];
  // feriali (lun-ven) in cui la persona non lavora, a giro sulle settimane
  const liberi = args.date.filter((d) => giornoIso(d) <= 5 && args.possibile(d));
  const perSett = new Map<string, string[]>();
  for (const d of liberi) { const k = lunediDi(d); perSett.set(k, [...(perSett.get(k) ?? []), d]); }
  const ordine: string[] = [];
  const code = [...perSett.values()];
  for (let i = 0; code.some((c) => c.length > i); i++) for (const c of code) if (c[i]) ordine.push(c[i]);
  const out: FeriaProposta[] = [];
  let resto = Math.round(args.ore * 2) / 2;
  for (const d of ordine) {
    if (resto < 0.5) break;
    if (resto >= giornata - 1e-9) { out.push({ data: d, voce: 'F01', tipo: 'giornata', ore: giornata }); resto -= giornata; }
    else { out.push({ data: d, voce: 'F02', tipo: 'ore', ore: Math.round(resto * 2) / 2 }); resto = 0; }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

// ── Il piano del mese ────────────────────────────────────────────────────

export interface PersonaPiano {
  id: string;
  /** ore settimanali di contratto; null = a chiamata (riserva) */
  oreSettimana: number | null;
  /** giorni in cui non c'e': assente, fuori contratto, altro negozio, ferie a giornata */
  nonDisponibile: Set<string>;
  /** ore di ferie e permessi approvati per data (si tolgono dalle ore da lavorare) */
  oreFerie: Map<string, number>;
  /** giorni del mese con il contratto in questo negozio (assente = nessuno); vuoto = tutti */
  inServizio?: Set<string>;
  saldoOre?: number;
}

// ── Ore di contratto a giornata (Patrizio, 21/10/2026) ────────────────────
// Ogni contratto vale a ore per giornata lavorativa: ore settimanali diviso i
// giorni di lavoro della settimana (6). Una giornata di ferie consuma le stesse
// ore, una mezza giornata la meta', un permesso a ore le sue ore.

/** Ore di una giornata di lavoro: 40 ore su 6 giorni = 6,67. */
export function oreGiornata(oreSettimana: number, regole: RegoleTurni = REGOLE_DEFAULT): number {
  return oreSettimana / regole.giorniLavoroMax;
}

/** Ore che una richiesta di ferie o permesso toglie in quel giorno. */
export function oreFerieGiorno(tipo: string, oreScritte: number, oreSettimana: number | null, regole: RegoleTurni = REGOLE_DEFAULT): number {
  if (tipo === 'ore' || !oreSettimana) return oreScritte;
  const g = oreGiornata(oreSettimana, regole);
  return tipo === 'giornata' ? g : g / 2;
}

/**
 * Giorni lavorativi del contratto in una settimana (lunedi'-domenica), contando
 * solo le date `valide` (nel mese, negozio aperto, contratto in corso). Il
 * riposo settimanale si toglie solo dalle settimane intere: una settimana tutta
 * dentro il mese e tutta con il contratto. Novembre 2026: 30 giorni, 4
 * settimane intere, 26 giorni lavorativi.
 */
export function giorniLavorativiSettimana(date: string[], valide: (d: string) => boolean, intera: boolean): number {
  const n = date.filter(valide).length;
  return Math.max(0, n - (intera && n > 0 ? 1 : 0));
}

export interface EsitoPianoMese {
  turni: Turno[];
  weekendLiberi: Map<string, string[]>;
  scoperture: Scopertura[];
  oreScoperte: number;
  giorni: GiornoPiano[];
  /** per persona: ore del mese da contratto (proporzionate), pianificate, straordinario, liberi nel weekend */
  persone: Record<string, {
    contratto: number; pianificate: number; straordinario: number; weekendLiberi: number; riserva: boolean;
    /** ore di ferie e permessi del mese (gia' tolte da `contratto`) */
    ferie?: number;
    /** contratto del mese prima delle ferie: giorni lavorativi del mese x ore settimanali / 6 */
    contrattoMese?: number;
    /** ore messe nelle settimane a cavallo del mese oltre la quota di questo mese, per non lasciare il negozio vuoto: valgono per il mese dopo, non sono straordinario */
    anticipo?: number;
    /** settimane in cui ha gia' il massimo di giorni di lavoro: le ore che restano non si possono usare */
    settimanePiene?: number;
  }>;
  /** ore fatte dalle persone a chiamata */
  oreRiserva: number;
}

/**
 * Il mese settimana per settimana. `giorni` copre le settimane intere (lunedi'-
 * domenica) che toccano il mese, gia' con orari, chiusure ed eventi; si
 * pianificano solo le date del mese, e le ore settimanali di contratto si
 * proporzionano ai giorni del mese aperti in quella settimana.
 */
export function pianificaMese(args: {
  mese: string; // 'YYYY-MM'
  giorni: GiornoPiano[];
  persone: PersonaPiano[];
  regola: RegolaWeekend;
  storicoWeekend: Map<string, number>;
  atteso: Map<string, number[]>;
  extra?: Map<string, number>;
  senzaLiberi?: Set<string>;
  regole?: RegoleTurni;
  /**
   * Simulazione: il fabbisogno resta quello di «Orari e fabbisogno» (le ore
   * che servono), invece di seguire le ore che ci sono. Serve per vedere se
   * delle ore di contratto ipotetiche bastano.
   */
  fabbisognoFisso?: boolean;
  /** ore di straordinario ammesse a settimana per persona, solo dove manca copertura */
  straordinariSettimana?: number;
  /** disponibilita' del singolo: ore di straordinario a settimana per persona (0 = non ne fa); prevale sul valore comune */
  straordinariPersona?: Map<string, number>;
}): EsitoPianoMese {
  const regole = args.regole ?? REGOLE_DEFAULT;
  const nelMese = (d: string) => d.slice(0, 7) === args.mese;
  const contrattuali = args.persone.filter((p) => (p.oreSettimana ?? 0) > 0);
  const riserva = args.persone.filter((p) => p.oreSettimana == null);
  const settimane = [...new Set(args.giorni.filter((g) => nelMese(g.data)).map((g) => lunediDi(g.data)))].sort();

  // Contratto della settimana per i soli giorni del mese: giorni lavorativi
  // (date del mese, negozio aperto, contratto in corso, meno il riposo delle
  // settimane intere) per le ore di una giornata. Senza ferie.
  const contrattoSett = (p: PersonaPiano, lun: string) => {
    const date = giorniDellaSettimana(lun);
    const aperto = (d: string) => args.giorni.some((g) => g.data === d && !g.chiuso);
    const conContratto = (d: string) => !p.inServizio || p.inServizio.has(d);
    const intera = date.every((d) => nelMese(d) && conContratto(d));
    const giorni = giorniLavorativiSettimana(date, (d) => nelMese(d) && aperto(d) && conContratto(d), intera);
    return giorni * oreGiornata(p.oreSettimana ?? 0, regole);
  };
  const ferieSett = (p: PersonaPiano, lun: string) => args.giorni
    .filter((g) => giorniDellaSettimana(lun).includes(g.data) && nelMese(g.data) && !g.chiuso)
    .reduce((a, g) => a + (p.oreFerie.get(g.data) ?? 0), 0);
  // Le ferie si tolgono dal mese intero (Patrizio, 21/10/2026): se in una
  // settimana superano il contratto di quei giorni (es. ferie il 30/11, unico
  // giorno del mese in quella settimana), l'eccedenza si toglie dalle altre
  // settimane in proporzione, invece di andare persa.
  const quote = new Map<string, Map<string, number>>();
  const orePersona = (p: PersonaPiano, lun: string) => {
    let q = quote.get(p.id);
    if (!q) {
      const lunedi = [...new Set(args.giorni.filter((g) => nelMese(g.data)).map((g) => lunediDi(g.data)))];
      const grezze = lunedi.map((l) => contrattoSett(p, l) - ferieSett(p, l));
      const deficit = grezze.filter((x) => x < 0).reduce((a, x) => a - x, 0);
      const positive = grezze.filter((x) => x > 0).reduce((a, x) => a + x, 0);
      q = new Map(lunedi.map((l, i) => [l, grezze[i] <= 0 ? 0 : Math.max(0, grezze[i] - (positive ? deficit * grezze[i] / positive : 0))]));
      quote.set(p.id, q);
    }
    return q.get(lun) ?? 0;
  };

  // 1. Sabati e domeniche liberi del mese, prima del fabbisogno: se il
  // fabbisogno usasse tutte le ore il weekend si riempirebbe fino all'ultima
  // persona e non resterebbe mai un libero. Il minimo di un giorno e' chi
  // apre e chi chiude (una persona in ogni mezz'ora).
  const weekendLiberi = assegnaWeekendLiberi({
    giorni: args.giorni.filter((g) => nelMese(g.data)).map((g) => ({ ...g, fabbisogno: g.fabbisogno.map(() => 1) })),
    persone: contrattuali.map((p) => ({ id: p.id, disponibile: (d: string) => !p.nonDisponibile.has(d) && !(p.oreFerie.get(d)) })),
    regola: args.regola,
    storico: args.storicoWeekend,
    senzaLiberi: args.senzaLiberi,
    regole,
  });
  const libero = (id: string, d: string) => (weekendLiberi.get(d) ?? []).includes(id);

  // 2. Fabbisogno di ogni settimana dal traffico e dalle ore che ci sono,
  // con le persone davvero disponibili giorno per giorno.
  const giorniMese: GiornoPiano[] = [];
  for (const lun of settimane) {
    const date = giorniDellaSettimana(lun).filter(nelMese);
    const gg = args.giorni.filter((g) => date.includes(g.data));
    const ore = contrattuali.reduce((a, p) => a + orePersona(p, lun), 0);
    if (args.fabbisognoFisso) { giorniMese.push(...gg); continue; }
    const maxP = new Map(gg.map((g) => [g.data, contrattuali.filter((p) => !p.nonDisponibile.has(g.data) && !libero(p.id, g.data)).length]));
    giorniMese.push(...fabbisognoDaTraffico(gg, args.atteso, ore, maxP, args.extra));
  }

  // 3. Le settimane.
  const turni: Turno[] = [];
  for (const lun of settimane) {
    const date = giorniDellaSettimana(lun).filter(nelMese);
    const gg = giorniMese.filter((g) => date.includes(g.data));
    const candidati: PersonaTurni[] = contrattuali.map((p) => ({
      id: p.id,
      ore: orePersona(p, lun),
      nonDisponibile: new Set([...p.nonDisponibile, ...date.filter((d) => libero(p.id, d))]),
      saldoOre: p.saldoOre ?? 0,
    }));
    let esito = proponiSettimana({ giorni: gg, persone: candidati, regole }).turni;
    // Le ore di contratto che avanzano si usano dove c'e' piu' gente (traffico MODA).
    esito = usaOreResidue(gg, esito, candidati, args.atteso, regole);
    const base = gg.map((g) => ({ ...g, fabbisogno: g.fabbisogno.map(() => 1) }));
    // La riserva a chiamata copre i buchi che restano, fino a 8 ore al giorno.
    const disponibiliRiserva = riserva.filter((p) => date.some((d) => !p.nonDisponibile.has(d)));
    if (disponibiliRiserva.length && oreScoperte(gg, esito) > 0) {
      const perRitocco: PersonaTurni[] = disponibiliRiserva.map((p) => ({ id: p.id, ore: regole.turnoMaxOre * regole.giorniLavoroMax, nonDisponibile: p.nonDisponibile }));
      esito = ritoccaScoperture(gg, esito, [], perRitocco, regole, undefined, new Set(disponibiliRiserva.map((p) => p.id)));
    }
    // Regola fissa (Patrizio, 21/10/2026): comanda l'orario del negozio, mai
    // una mezz'ora di apertura senza nessuno. MODA decide dove servono la seconda
    // e la terza persona, ma non a costo di lasciare il negozio vuoto.
    // Settimana a cavallo di due mesi: le ore proporzionate ai pochi giorni di
    // questo mese possono non bastare a coprire l'orario; per la sola copertura
    // minima si arriva fino a un turno pieno al giorno, dentro il contratto della settimana.
    const perCopertura: PersonaTurni[] = date.length >= 7 ? candidati : candidati.map((c) => {
      const p = contrattuali.find((x) => x.id === c.id);
      return { ...c, ore: Math.max(c.ore, Math.min(p?.oreSettimana ?? 0, regole.turnoMaxOre * date.length)) };
    });
    const riservaCopertura = disponibiliRiserva.map((p) => ({ id: p.id, ore: regole.turnoMaxOre * regole.giorniLavoroMax, nonDisponibile: p.nonDisponibile }));
    esito = copriOrarioMinimo(base, esito, perCopertura, riservaCopertura, regole);
    // Il sabato o la domenica liberi si danno «solo quando possibile»: se il negozio
    // resterebbe vuoto, il libero di questa settimana salta e quelle persone tornano disponibili.
    const liberiSett = date.filter((d) => (weekendLiberi.get(d) ?? []).length);
    if (liberiSett.length && oreScoperte(base, esito) > 0) {
      const senzaLiberi = perCopertura.map((c) => {
        const p = contrattuali.find((x) => x.id === c.id);
        return { ...c, nonDisponibile: new Set([...(p?.nonDisponibile ?? [])]) };
      });
      esito = copriOrarioMinimo(base, esito, senzaLiberi, riservaCopertura, regole);
      for (const d of liberiSett) {
        const restano = (weekendLiberi.get(d) ?? []).filter((id) => !esito.some((t) => t.employeeId === id && t.data === d));
        if (restano.length) weekendLiberi.set(d, restano); else weekendLiberi.delete(d);
      }
    }
    // Le ore liberate dalla riparazione tornano dove MODA vede piu' gente.
    esito = usaOreResidue(gg, esito, candidati, args.atteso, regole);
    // Poi, se ammessi, gli straordinari di chi ha un contratto: prima la
    // riserva (ore normali), poi le ore in piu' dei titolari.
    const straordDi = (id: string) => args.straordinariPersona?.get(id) ?? args.straordinariSettimana ?? 0;
    if (candidati.some((c) => straordDi(c.id) > 0) && oreScoperte(gg, esito) > 0) {
      const conExtra: PersonaTurni[] = candidati.map((c) => ({ ...c, ore: c.ore + straordDi(c.id) * date.length / 7 }));
      const ids = new Set(conExtra.map((c) => c.id));
      const altri = esito.filter((t) => !ids.has(t.employeeId));
      esito = [...altri, ...ritoccaScoperture(gg, esito.filter((t) => ids.has(t.employeeId)), altri, conExtra, regole)];
    }
    turni.push(...esito);
  }

  const persone: EsitoPianoMese['persone'] = {};
  for (const p of args.persone) {
    const pianificate = turni.filter((t) => t.employeeId === p.id).reduce((a, t) => a + oreLavorate(t), 0);
    const contratto = p.oreSettimana == null ? 0 : settimane.reduce((a, lun) => a + orePersona(p, lun), 0);
    const contrattoMese = p.oreSettimana == null ? 0 : settimane.reduce((a, lun) => a + contrattoSett(p, lun), 0);
    const ferie = args.giorni.filter((g) => nelMese(g.data) && !g.chiuso).reduce((a, g) => a + (p.oreFerie.get(g.data) ?? 0), 0);
    const settimanePiene = settimane.filter((lun) => {
      const date = giorniDellaSettimana(lun).filter(nelMese);
      return new Set(turni.filter((t) => t.employeeId === p.id && date.includes(t.data)).map((t) => t.data)).size >= Math.min(regole.giorniLavoroMax, date.length);
    }).length;
    // Settimane a cavallo del mese: ore oltre la quota di questo mese = anticipo.
    const anticipo = p.oreSettimana == null ? 0 : settimane.reduce((a, lun) => {
      const date = giorniDellaSettimana(lun);
      if (date.every(nelMese)) return a;
      const fatte = turni.filter((t) => t.employeeId === p.id && date.includes(t.data)).reduce((x, t) => x + oreLavorate(t), 0);
      return a + Math.max(0, fatte - orePersona(p, lun));
    }, 0);
    persone[p.id] = {
      ferie,
      contrattoMese,
      anticipo,
      settimanePiene,
      contratto,
      pianificate,
      straordinario: p.oreSettimana == null ? 0 : Math.max(0, pianificate - contratto - anticipo),
      weekendLiberi: [...weekendLiberi.values()].filter((ids) => ids.includes(p.id)).length,
      riserva: p.oreSettimana == null,
    };
  }
  const scoperture = giorniMese.flatMap((g) => scopertureDelGiorno(g, turni));
  return {
    turni: turni.sort((a, b) => a.data.localeCompare(b.data) || a.inizio.localeCompare(b.inizio)),
    weekendLiberi,
    scoperture,
    oreScoperte: oreScoperte(giorniMese, turni),
    giorni: giorniMese,
    persone,
    oreRiserva: riserva.reduce((a, p) => a + persone[p.id].pianificate, 0),
  };
}
