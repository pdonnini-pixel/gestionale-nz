// Il passo finale della proposta dei turni (Patrizio, 11/11/2026, Roma Soratte).
//
// La proposta di turni.ts e i ritocchi di pianoMensile.ts guardano una regola
// alla volta. Le regole decise l'11/11/2026 si pestano i piedi fra loro (nel
// weekend lavorano tutti, ognuno ha il suo giorno libero fisso, le coppie dei
// feriali cambiano, il lunedi' c'e' la responsabile o la vice) e vanno pesate
// insieme. Qui si parte dai turni gia' proposti e si cerca, con piccole mosse,
// una settimana che costa meno secondo un unico conto:
//
//   1. mai una mezz'ora di apertura vuota;
//   2. mai un giorno con una persona sola;
//   3. il lunedi' almeno una fra responsabile e vice;
//   4. sabato e domenica lavorano tutti;
//   5. il minimo delle fasce di «Orari e fabbisogno»;
//   6. le persone che chiede il traffico MODA;
//   7. il giorno libero fisso di ognuno;
//   8. niente ore oltre quelle che chiede il traffico;
//   9. pochi turni lunghi invece di tanti corti;
//  10. coppie dei feriali diverse dalle settimane prima.
//
// Nei negozi con «ore fino al contratto» accesa, a settimana sistemata le ore di
// contratto rimaste libere si mettono in turno allungando i turni di venerdi',
// sabato e domenica, poi degli altri giorni, poi con un turno nuovo.
//
// L'ordine e' quello dei pesi: una regola piu' in basso non si compra mai con una
// piu' in alto. Restano vincoli duri, mai violati: turno minimo e massimo, un
// turno al giorno, i giorni di lavoro della settimana, gli accordi della scheda,
// le ore di contratto (oltre si va solo nei giorni di evento con straordinari).
// I turni fissi (messi a mano, pubblicati, trasferte, riserva) non si toccano.
//
// Il risultato non e' mai peggiore di quello di partenza. Stessa settimana,
// stessi dati, stesso risultato: i numeri a caso hanno un seme fisso.
//
// Funzioni pure, nessuna query. Test in ottimizzaTurni.test.ts.

import {
  SLOT_MINUTI, REGOLE_DEFAULT, RIPOSO_LEGALE, LUNEDI_MAX_PERSONE, giornoIso, giornoPieno, hhmm, minuti, oreLavorate, pausaMinimaPerPresenza, limitiPersona,
  type GiornoPiano, type PersonaTurni, type RegoleTurni, type Turno,
} from './turni';

export interface RegoleNuove {
  /** giorno libero fisso di ognuno (1 = lunedi' ... 7 = domenica) */
  giornoLibero?: Map<string, number>;
  /** quante volte due persone hanno gia' lavorato insieme nei feriali delle settimane prima: chiave `coppia(a, b)` */
  coppiePrima?: Map<string, number>;
  /** responsabile e vice del negozio: il lunedi' almeno una delle due ha un turno. Vuoto o una sola = regola spenta. */
  guida?: string[];
  /**
   * Straordinari anche il sabato e la domenica, quando servono a coprire il traffico (Patrizio,
   * 11/11/2026). Spento nelle simulazioni, dove gli straordinari li decide chi simula.
   */
  straordinariWeekend?: boolean;
  /**
   * La responsabile del negozio: il sabato e la domenica entra all'apertura ed esce dopo nove ore
   * (10-19 in un negozio che apre alle 10; Patrizio, 11/11/2026).
   */
  responsabile?: string | null;
  /** la vice responsabile: con la responsabile serve a `sceltePerLaSettimana` per apertura e chiusura dei giorni caldi */
  vice?: string | null;
  /** le ore di contratto che il traffico non chiede vanno comunque in turno, prima venerdi', sabato e domenica */
  riempiContratto?: boolean;
  /** i giorni a organico pieno (sabato, domenica, festivi, eventi); senza, valgono sabato e domenica */
  giorniPieni?: Set<string>;
  /** giorni gia' lavorati da ognuno nei giorni dell'altro mese della stessa settimana: contano nel massimo dei giorni */
  giorniGia?: Map<string, number>;
  /** giri di ricerca per partenza (default in proporzione a persone e giorni) */
  giri?: number;
  // ── Regole del 12/11/2026 ──
  /**
   * Riposi: quanti a settimana a testa se possibile (mai meno di uno, per legge), e per ogni
   * persona i giorni in cui riposa di preferenza e quelli in cui non riposa mai (1 = lunedi' ...
   * 5 = venerdi'). Senza preferenze il riposo lo decide la turnazione.
   */
  riposi?: { min?: number; preferiti?: Map<string, number[]>; mai?: Map<string, number[]> };
  /** giorni della settimana che non stanno in `giorni` (settimana a cavallo di due mesi): servono a contare i riposi */
  giorniFuori?: number;
  /** straordinari il piu' possibile pari fra tutte */
  straordinariPari?: boolean;
  /**
   * Responsabile e vice nei giorni caldi: `ids` = [responsabile, vice] (o solo la responsabile).
   * In ogni giorno di `giorni` una apre e resta `ore` ore; con `alterna` l'altra fa la chiusura e
   * il giorno caldo dopo si scambiano. Sostituisce `responsabile`.
   */
  guidaCaldi?: { ids: string[]; ore: number; alterna: boolean; giorni: Set<string> };
  /** i giorni caldi in cui sono ammessi gli straordinari; senza, valgono i `giorniPieni` */
  giorniStraordinari?: Set<string>;
  /**
   * Il lunedi' a due persone (Patrizio, 12/11/2026): le coppie dei lunedi' precedenti, dalla piu'
   * recente (chiave `coppia(a, b)`). La coppia di questo lunedi' non deve essere quella di prima.
   * Il tetto delle due persone sta sul giorno (`GiornoPiano.lunediDue`).
   */
  lunediPrima?: string[];
}

/** La chiave di una coppia di persone, uguale in tutti e due gli ordini. */
export function coppia(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Le coppie dei feriali in una lista di turni: per ogni giorno da lunedi' a
 * venerdi', le persone che stanno in negozio insieme almeno un'ora.
 */
export function coppieFeriali(turni: Turno[]): Map<string, number> {
  const out = new Map<string, number>();
  const perGiorno = new Map<string, Turno[]>();
  for (const t of turni) {
    if (giornoIso(t.data) > 5) continue;
    perGiorno.set(t.data, [...(perGiorno.get(t.data) ?? []), t]);
  }
  for (const lista of perGiorno.values()) {
    const viste = new Set<string>();
    for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
      const a = lista[i]; const b = lista[j];
      if (a.employeeId === b.employeeId) continue;
      const insieme = Math.min(minuti(a.fine), minuti(b.fine)) - Math.max(minuti(a.inizio), minuti(b.inizio));
      const k = coppia(a.employeeId, b.employeeId);
      if (insieme >= 60 && !viste.has(k)) { viste.add(k); out.set(k, (out.get(k) ?? 0) + 1); }
    }
  }
  return out;
}

/** Le due persone in turno in un giorno, come chiave di coppia; null se non sono esattamente due. */
export function coppiaDelGiorno(turni: Turno[], data: string): string | null {
  const chi = [...new Set(turni.filter((t) => t.data === data).map((t) => t.employeeId))];
  return chi.length === 2 ? coppia(chi[0], chi[1]) : null;
}

/** Le coppie dei lunedi' di questi turni, dal lunedi' piu' recente: solo i lunedi' con due persone esatte. */
export function coppieDeiLunedi(turni: Turno[]): string[] {
  const lunedi = [...new Set(turni.map((t) => t.data).filter((d) => giornoIso(d) === 1))].sort().reverse();
  return lunedi.map((d) => coppiaDelGiorno(turni, d)).filter((k): k is string => !!k);
}

/**
 * Il giorno libero fisso scelto dal sistema per chi non ne ha uno (Patrizio,
 * 11/11/2026: «la sceglie il sistema e poi semmai viene cambiata»). Un giorno
 * da lunedi' a venerdi', distribuito in modo che ogni giorno ne abbia il meno
 * possibile; la responsabile e la vice non hanno mai tutte e due il lunedi'.
 * Chi ha gia' un giorno lo tiene.
 */
export function scegliGiorniLiberi(ids: string[], gia: Map<string, number> = new Map(), guida: string[] = []): Map<string, number> {
  const out = new Map<string, number>();
  const conta = new Map<number, number>();
  for (const id of ids) {
    const g = gia.get(id);
    if (g && g >= 1 && g <= 7) { out.set(id, g); conta.set(g, (conta.get(g) ?? 0) + 1); }
  }
  // a parita' si parte da meta' settimana: lunedi' e venerdi' restano gli ultimi
  const ordine = [3, 4, 2, 1, 5];
  for (const id of ids) {
    if (out.has(id)) continue;
    const altraGuidaDiLunedi = guida.includes(id) && guida.some((x) => x !== id && out.get(x) === 1);
    let scelto = 0;
    for (const g of ordine) {
      if (g === 1 && (altraGuidaDiLunedi || (guida.includes(id) && guida.length < 2))) continue;
      if (!scelto || (conta.get(g) ?? 0) < (conta.get(scelto) ?? 0)) scelto = g;
    }
    out.set(id, scelto || 3);
    conta.set(scelto || 3, (conta.get(scelto || 3) ?? 0) + 1);
  }
  return out;
}

/**
 * Le scelte del negozio del 12/11/2026 tradotte per `ottimizzaSettimana`, lette dai giorni
 * (che sanno gia' se sono caldi) e dalle regole. Dove il negozio non ha i giorni caldi ne' i
 * riposi minimi restituisce un oggetto vuoto: chi chiama resta con il comportamento di prima.
 *
 *  - giorni in cui lavorano tutte e giorni con gli straordinari ammessi;
 *  - responsabile e vice: una apre e resta le sue ore, l'altra chiude, a turno;
 *  - riposi: il minimo della settimana (quello del negozio, o meno se un periodo ne chiede
 *    meno, mai sotto uno) con i giorni preferiti e vietati di ognuna;
 *  - straordinari pari.
 * `simulazione`: gli straordinari li decide chi simula, non i giorni caldi.
 */
export function sceltePerLaSettimana(args: {
  giorni: GiornoPiano[];
  regole: RegoleTurni;
  responsabile?: string | null;
  vice?: string | null;
  riposi?: { preferiti?: Map<string, number[]>; mai?: Map<string, number[]> };
  /** giorni della settimana che non stanno in `giorni` */
  giorniFuori?: number;
  simulazione?: boolean;
}): Partial<RegoleNuove> {
  const { giorni, regole } = args;
  const aperti = giorni.filter((g) => !g.chiuso);
  const conFlag = aperti.some((g) => g.caldo !== undefined);
  const out: Partial<RegoleNuove> = {};
  if (conFlag && aperti.some((g) => g.caldo)) {
    // dove i giorni caldi del negozio sono spenti resta «nel weekend lavorano tutti» (regola 8, tutti i
    // negozi): un evento nuovo aggiunge il suo giorno, non toglie sabato e domenica
    out.giorniPieni = new Set(aperti.filter((g) => g.tutti || (!regole.giorniPieni && giornoIso(g.data) >= 6)).map((g) => g.data));
    out.giorniStraordinari = new Set(aperti.filter((g) => g.straordinariCaldo).map((g) => g.data));
    out.straordinariWeekend = !args.simulazione && out.giorniStraordinari.size > 0;
    const ids = [args.responsabile, regole.caldiGuidaApreChiude ? args.vice : null].filter((x): x is string => !!x);
    const giorniGuida = new Set(aperti.filter((g) => g.guida).map((g) => g.data));
    if (ids.length && giorniGuida.size) {
      out.guidaCaldi = { ids: [...new Set(ids)], ore: regole.caldiOreApertura ?? PRESENZA_RESPONSABILE_WEEKEND / 60, alterna: !!regole.caldiGuidaApreChiude, giorni: giorniGuida };
    }
  }
  const dePeriodi = aperti.map((g) => g.riposiMin).filter((n): n is number => typeof n === 'number');
  const minimi = [...(regole.riposiMinSettimana != null ? [regole.riposiMinSettimana] : []), ...dePeriodi];
  if (minimi.length || args.riposi?.preferiti?.size || args.riposi?.mai?.size) {
    out.riposi = { ...(minimi.length ? { min: Math.max(RIPOSO_LEGALE, Math.min(...minimi)) } : {}), preferiti: args.riposi?.preferiti, mai: args.riposi?.mai };
    out.giorniFuori = args.giorniFuori ?? Math.max(0, 7 - giorni.length);
  }
  if (regole.straordinariPari) out.straordinariPari = true;
  return out;
}

// ── Il conto ─────────────────────────────────────────────────────────────

/** Sabato e domenica la responsabile resta nove ore dall'apertura: 10-19 (Patrizio, 11/11/2026). */
export const PRESENZA_RESPONSABILE_WEEKEND = 9 * 60;

/** Quanto pesa ogni regola: ogni riga vale piu' di tutto quello che sta sotto. */
export const PESI = {
  vuota: 10_000_000_000,    // mezz'ora di apertura senza nessuno
  unaSola: 200_000_000,     // giorno con una persona sola
  lunediSenzaGuida: 200_000_000,
  // Nel weekend lavorano tutti anche a costo del minimo delle fasce di un feriale
  // (Patrizio, 11/11/2026), ma mai lasciando un giorno vuoto o con una persona sola.
  weekendLibero: 4_000_000, // persona che puo' lavorare e non ha turno il sabato o la domenica
  domenicaApertura: 4_000_000, // la responsabile che il sabato o la domenica non fa il suo orario (apertura + 9 ore)
  sottoMinimo: 100_000,     // persona che manca al minimo delle fasce, per mezz'ora
  scoperta: 10_000,         // persona che manca al traffico MODA, per mezz'ora
  scopertaEsatta: 1_000,    // lo stesso senza arrotondare, per mezz'ora di persona
  giornoLibero: 3_000,      // turno nel giorno libero fisso
  straordinario: 3_000,     // ora oltre il contratto
  straordinarioQuadro: 300,
  inPiu: 200,               // mezz'ora di persona oltre il traffico
  turno: 150,               // ogni turno: meglio pochi lunghi
  coppiaPrima: 40,          // coppia dei feriali gia' vista nelle settimane prima, per volta
  coppiaRipetuta: 60,       // coppia che si ripete nella stessa settimana
  // ── 12/11/2026. I riposi si cercano «se possibile»: stanno sotto il minimo delle fasce (110.000
  // la mezz'ora), che non si perde mai, e valgono piu' degli straordinari pari («prima i riposi a
  // testa, poi gli straordinari pari»). Sopra le fasce, un riposo vale al massimo un'ora e un
  // quarto di una persona che MODA chiederebbe in piu' (misura sulla settimana del Black Friday
  // 2026 a Roma Soratte: sotto i 15.000 vinceva la parita' degli straordinari e la responsabile
  // restava con un riposo solo). ──
  riposoVietato: 30_000,    // persona a riposo in un giorno in cui non riposa mai
  riposoMancante: 25_000,   // riposo che manca per arrivare al minimo del negozio, a persona
  riposoInPiu: 400,         // riposi oltre il minimo, al quadrato: si distribuiscono fra tutte
  // ── Lunedi' a due persone (Patrizio, 12/11/2026): il tetto vince sulle fasce e su MODA (che sul
  // giorno sono gia' tagliate a due), non sul negozio vuoto, sulla persona sola o sulla guida del lunedi'.
  lunediTroppi: 50_000_000, // persona oltre le due, il lunedi'
  lunediStessaCoppia: 60_000, // stessa coppia del lunedi' prima (meta' per quello prima ancora)
  // pesa meno di un riposo: con un evento prima i riposi a testa, poi gli straordinari pari (Patrizio, 12/11/2026)
  straordinarioPari: 200,   // distanza al quadrato dalla media degli straordinari
} as const;

// Inizio e presenza in minuti, tutti e due sulla griglia delle mezz'ore. Le ore lavorate
// sono la presenza meno la pausa: con la pausa da 10 minuti (Patrizio, 11/11/2026) un turno
// 10-18 vale 7 ore e 50, e l'orario scritto resta tondo.
interface Pezzo { s: number; w: number }
type Stato = (Pezzo | null)[][];          // [persona][giorno]

interface Quadro {
  giorni: GiornoPiano[];
  persone: PersonaTurni[];
  regole: RegoleTurni;
  nuove: RegoleNuove;
  /** copertura dei turni fissi, per giorno e mezz'ora */
  fissa: number[][];
  /** persone fisse (non nostre) in turno, per giorno */
  fissePersone: Set<string>[];
  /** ore fisse gia' nei turni di ogni nostra persona, e giorni in cui ha gia' un turno fisso */
  oreFisse: number[];
  giornoFisso: boolean[][];
  /** `max` e `minLavoro` sono presenze: la piu' lunga e la piu' corta che stanno nel turno massimo e minimo */
  limiti: { apre: number; chiude: number; max: number }[][];
  minLavoro: number;
  /** ore lavorate per ogni presenza (indice = presenza / mezz'ora) */
  lav: number[];
  /** chi apre e chi chiude in ogni giorno caldo (indice fra le persone, o -1), e la presenza di chi apre */
  apreP: number[];
  chiudeP: number[];
  aprePresenza: number[];
  straordWeekend: boolean;
  pieno: boolean[];
  /** giorni in cui le ore possono andare oltre il contratto perche' caldi */
  straordCaldo: boolean[];
  /** riposi: minimo del negozio (0 = regola spenta), giorni della settimana, preferiti e vietati per persona (bit per giorno 1-7) */
  riposiMin: number;
  giorniSettimana: number;
  settimanaIntera: boolean;
  /** caselle chiuse per prova: li' la persona non puo' avere un turno (serve a `riparaRiposi`) */
  blocco: boolean[][];
  preferiti: number[];
  mai: number[];
  /** la persona potrebbe lavorare quel giorno (aperto, disponibile, non fisso) */
  puo: boolean[][];
  pari: boolean;
  /**
   * Le ore che ognuno puo' fare: il contratto, oppure quelle che aveva gia' nei
   * turni di partenza se erano di piu' (straordinari ammessi, ore anticipate nelle
   * settimane a cavallo del mese). Oltre si va solo nei giorni di evento.
   */
  tetto: number[];
  /** ore oltre il contratto che la partenza aveva gia' fuori dai giorni di evento */
  oltreLibero: number[];
  // precalcolati e appoggi del conto, per non allocare a ogni giro
  iso: number[];
  libero: number[];
  eGuida: boolean[];
  guidaAttiva: boolean;
  guidaFissa: boolean[];
  guidaPossibile: boolean[];
  weekendDovuto: boolean[][];
  giorniFissi: number[];
  coppiePrima: number[];
  /** lunedi' con il tetto di due persone, e quanto pesa ogni coppia perche' gia' vista nei lunedi' prima */
  lunDue: boolean[];
  lunPrima: number[];
  bufOre: number[]; bufEvento: number[]; bufGiorni: number[]; bufCoppie: number[]; bufCop: number[]; bufInTurno: number[];
}

/** Minuti lavorati in una presenza: la presenza meno la pausa che le spetta. */
function lavoroDi(presenza: number, regole: RegoleTurni): number { return presenza - pausaMinimaPerPresenza(presenza, regole); }
// La presenza e' gia' la durata del turno: resta la funzione per leggibilita'.
function durata(w: number, _regole: RegoleTurni): number { return w; }

function costo(q: Quadro, st: Stato): number {
  const { giorni, persone, regole } = q;
  const P = persone.length;
  let c = 0;
  const ore = q.bufOre; const oreEvento = q.bufEvento; const giorniLavoro = q.bufGiorni; const coppieSett = q.bufCoppie;
  for (let p = 0; p < P; p++) { ore[p] = q.oreFisse[p]; oreEvento[p] = 0; giorniLavoro[p] = q.giorniFissi[p]; }
  coppieSett.fill(0);
  const inTurno = q.bufInTurno;
  for (let d = 0; d < giorni.length; d++) {
    const g = giorni[d];
    if (g.chiuso) continue;
    const fissa = q.fissa[d];
    const n = fissa.length;
    const cop = q.bufCop;
    for (let k = 0; k < n; k++) cop[k] = fissa[k];
    let quanti = 0;
    const iso = q.iso[d];
    let guidaPresente = q.guidaFissa[d];
    const riga = d;
    for (let p = 0; p < P; p++) {
      const x = st[p][riga];
      if (!x) continue;
      inTurno[quanti++] = p;
      const h = q.lav[x.w / SLOT_MINUTI];
      ore[p] += h;
      // straordinari: nei giorni di evento e, quando serve, il sabato e la domenica (Patrizio, 11/11/2026)
      if (g.straordinari || (q.straordCaldo[d] && q.straordWeekend)) oreEvento[p] += h;
      giorniLavoro[p] += 1;
      c += PESI.turno;
      if (q.eGuida[p]) guidaPresente = true;
      if (q.libero[p] === iso || (q.preferiti[p] >> iso) & 1) c += PESI.giornoLibero;
      let a = (x.s - g.apre) / SLOT_MINUTI; if (a < 0) a = 0;
      let b = (x.s + x.w - g.apre) / SLOT_MINUTI; if (b > n) b = n;
      for (let k = a; k < b; k++) cop[k] += 1;
    }
    const minimo = g.minimo; const esatto = g.esatto; const fabb = g.fabbisogno;
    for (let k = 0; k < n; k++) {
      const serve = fabb[k]; const ci = cop[k];
      if (ci < 1 && serve >= 1) c += PESI.vuota;
      if (minimo) {
        const m = minimo[k];
        const base = serve < m ? serve : m;
        if (ci < base) c += (base - ci) * (PESI.sottoMinimo + PESI.scoperta);
        else if (serve > m + 1e-9 && ci < serve) c += (serve - ci) * PESI.scoperta;
        if (ci < base) { if (esatto) c += (base - ci) * PESI.scopertaEsatta; }
        else if (esatto && esatto[k] > m + 1e-9 && ci < esatto[k]) c += (esatto[k] - ci) * PESI.scopertaEsatta;
      } else {
        if (ci < serve) c += (serve - ci) * PESI.scoperta;
        if (esatto && ci < esatto[k]) c += (esatto[k] - ci) * PESI.scopertaEsatta;
      }
      if (ci > serve) c += (ci - serve) * PESI.inPiu;
    }
    if (quanti + q.fissePersone[d].size === 1) c += PESI.unaSola;
    if (q.lunDue[d]) {
      // i fissi che sono anche nostre persone non hanno un pezzo nello stato: nessuno contato due volte
      const tot = quanti + q.fissePersone[d].size;
      if (tot > LUNEDI_MAX_PERSONE) c += (tot - LUNEDI_MAX_PERSONE) * PESI.lunediTroppi;
      else if (quanti === 2 && q.fissePersone[d].size === 0) c += q.lunPrima[inTurno[0] * P + inTurno[1]] * PESI.lunediStessaCoppia;
    }
    if (iso === 1 && q.guidaAttiva && !guidaPresente && q.guidaPossibile[d]) c += PESI.lunediSenzaGuida;
    // giorni caldi: chi apre fa il suo orario dall'apertura, chi chiude arriva alla chiusura
    const ap = q.apreP[d];
    if (ap >= 0) {
      const x = st[ap][riga];
      if (!x || x.s !== q.limiti[ap][d].apre || x.w !== q.aprePresenza[d]) c += PESI.domenicaApertura;
    }
    const ch = q.chiudeP[d];
    if (ch >= 0) {
      const x = st[ch][riga];
      if (!x || x.s + x.w !== q.limiti[ch][d].chiude) c += PESI.domenicaApertura;
    }
    // chi non riposa mai in questo giorno della settimana e non ha un turno
    if (iso <= 5) for (let p = 0; p < P; p++) if ((q.mai[p] >> iso) & 1 && !st[p][riga] && q.puo[p][d]) c += PESI.riposoVietato;
    if (q.pieno[d]) {
      for (let p = 0; p < P; p++) if (!st[p][riga] && q.weekendDovuto[p][d]) c += PESI.weekendLibero;
    } else {
      for (let i = 0; i < quanti; i++) for (let j = i + 1; j < quanti; j++) {
        const a = st[inTurno[i]][riga]!; const b = st[inTurno[j]][riga]!;
        const fa = a.s + a.w; const fb = b.s + b.w;
        if ((fa < fb ? fa : fb) - (a.s > b.s ? a.s : b.s) >= 60) coppieSett[inTurno[i] * P + inTurno[j]] += 1;
      }
    }
  }
  for (let k = 0; k < coppieSett.length; k++) {
    const n = coppieSett[k];
    if (n) c += q.coppiePrima[k] * n * PESI.coppiaPrima + (n - 1) * PESI.coppiaRipetuta;
  }
  let sommaOltre = 0;
  for (let p = 0; p < P; p++) { const o = ore[p] - persone[p].ore; if (o > 1e-9) sommaOltre += o; }
  const mediaOltre = q.pari && P > 0 ? sommaOltre / P : 0;
  for (let p = 0; p < P; p++) {
    const oltre = ore[p] - persone[p].ore;
    if (q.pari) { const o = oltre > 0 ? oltre : 0; c += (o - mediaOltre) * (o - mediaOltre) * PESI.straordinarioPari; }
    if (q.riposiMin > 0 && q.giorniSettimana >= 7) {
      const riposi = q.giorniSettimana - giorniLavoro[p];
      if (riposi < q.riposiMin) c += (q.riposiMin - riposi) * PESI.riposoMancante;
      // i riposi in piu' si distribuiscono solo sulla settimana intera: in un pezzo a cavallo del
      // mese i giorni dell'altro mese non si conoscono tutti, e il conto spingerebbe a far lavorare tutte
      else if (q.settimanaIntera) c += (riposi - q.riposiMin) * (riposi - q.riposiMin) * PESI.riposoInPiu;
    }
    // per legge almeno un giorno di riposo nella settimana intera
    if (q.giorniSettimana >= 7 && giorniLavoro[p] > 7 - RIPOSO_LEGALE) return Infinity;
    if (oltre > 1e-9) {
      // oltre il contratto solo con le ore dei giorni di evento, piu' quelle che la partenza
      // aveva gia' fuori dagli eventi (straordinari ammessi, anticipo a cavallo del mese)
      if (oltre - oreEvento[p] > q.oltreLibero[p] + 1e-9) return Infinity;
      c += oltre * PESI.straordinario + oltre * oltre * PESI.straordinarioQuadro;
    }
    if (giorniLavoro[p] > regole.giorniLavoroMax) return Infinity;
  }
  return c;
}

/** Numeri a caso con il seme: stessa settimana, stesso risultato. */
function casuale(seme: number): () => number {
  let a = seme >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function semeDi(testo: string): number {
  let h = 2166136261;
  for (let i = 0; i < testo.length; i++) { h ^= testo.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Un pezzo dentro i limiti della persona quel giorno, o null se non ci sta. */
function dentro(q: Quadro, p: number, d: number, s: number, w: number): Pezzo | null {
  const l = q.limiti[p][d];
  if (q.giornoFisso[p][d] || q.blocco[p][d] || l.max < q.minLavoro) return null;
  const lavoro = Math.max(q.minLavoro, Math.min(l.max, Math.round(w / SLOT_MINUTI) * SLOT_MINUTI));
  const dur = durata(lavoro, q.regole);
  if (dur > l.chiude - l.apre) return null;
  const inizio = Math.max(l.apre, Math.min(l.chiude - dur, Math.round(s / SLOT_MINUTI) * SLOT_MINUTI));
  return { s: inizio, w: lavoro };
}

function copia(st: Stato): Stato { return st.map((r) => r.slice()); }

/** Le celle cambiate dall'ultima mossa, per tornare indietro senza copiare tutto. */
type Registro = [number, number, Pezzo | null][];

function metti(st: Stato, reg: Registro, p: number, d: number, x: Pezzo | null): void {
  reg.push([p, d, st[p][d]]);
  st[p][d] = x;
}

function annulla(st: Stato, reg: Registro): void {
  for (let i = reg.length - 1; i >= 0; i--) st[reg[i][0]][reg[i][1]] = reg[i][2];
  reg.length = 0;
}

/** Una mossa a caso sullo stato; false se non ha cambiato niente. */
function mossa(q: Quadro, st: Stato, reg: Registro, r: () => number): boolean {
  const P = q.persone.length; const D = q.giorni.length;
  const p = Math.floor(r() * P); const d = Math.floor(r() * D);
  if (q.giorni[d].chiuso) return false;
  const x = st[p][d];
  const tipo = r();
  if (!x) {
    if (tipo < 0.5) {
      // un turno nuovo: da apertura, a chiusura o in mezzo, lungo a caso
      const l = q.limiti[p][d];
      const w = q.minLavoro + Math.floor(r() * (Math.max(0, l.max - q.minLavoro) / SLOT_MINUTI + 1)) * SLOT_MINUTI;
      const dove = r();
      const s = dove < 0.35 ? l.apre : dove < 0.7 ? l.chiude - durata(w, q.regole) : l.apre + Math.floor(r() * ((l.chiude - l.apre) / SLOT_MINUTI)) * SLOT_MINUTI;
      const n = dentro(q, p, d, s, w);
      if (!n) return false;
      metti(st, reg, p, d, n); return true;
    }
    if (tipo < 0.8) {
      // porta qui un turno della stessa persona da un altro giorno
      const d2 = Math.floor(r() * D);
      const y = st[p][d2];
      if (!y || d2 === d) return false;
      const n = dentro(q, p, d, y.s, y.w);
      if (!n) return false;
      metti(st, reg, p, d, n); metti(st, reg, p, d2, null); return true;
    }
    // prende il turno di una collega quel giorno
    const p2 = Math.floor(r() * P);
    const y = st[p2][d];
    if (!y || p2 === p) return false;
    const n = dentro(q, p, d, y.s, y.w);
    if (!n) return false;
    metti(st, reg, p, d, n); metti(st, reg, p2, d, null); return true;
  }
  if (tipo < 0.1) { metti(st, reg, p, d, null); return true; }
  if (tipo < 0.3) {
    const n = dentro(q, p, d, x.s + (r() < 0.5 ? -1 : 1) * SLOT_MINUTI * (1 + Math.floor(r() * 3)), x.w);
    if (!n || (n.s === x.s && n.w === x.w)) return false;
    metti(st, reg, p, d, n); return true;
  }
  if (tipo < 0.5) {
    // piu' lungo o piu' corto, tenendo fermo l'inizio o la fine
    const passo = (r() < 0.5 ? -1 : 1) * SLOT_MINUTI * (1 + Math.floor(r() * 3));
    const fine = x.s + durata(x.w, q.regole);
    const w = Math.max(q.minLavoro, Math.min(q.limiti[p][d].max, x.w + passo));
    const n = dentro(q, p, d, r() < 0.5 ? fine - durata(w, q.regole) : x.s, w);
    if (!n || (n.s === x.s && n.w === x.w)) return false;
    metti(st, reg, p, d, n); return true;
  }
  if (tipo < 0.62) {
    // passa mezz'ora o piu' a un altro turno della stessa persona: le ore restano quelle
    const d2 = Math.floor(r() * D);
    const y = st[p][d2];
    if (!y || d2 === d) return false;
    const passo = SLOT_MINUTI * (1 + Math.floor(r() * 4));
    const a = dentro(q, p, d, x.s, x.w - passo); const b = dentro(q, p, d2, y.s, y.w + passo);
    if (!a || !b || a.w !== x.w - passo || b.w !== y.w + passo) return false;
    metti(st, reg, p, d, a); metti(st, reg, p, d2, b); return true;
  }
  if (tipo < 0.82) {
    // scambio con una collega: stesso giorno, oppure il suo turno passa a lei
    const p2 = Math.floor(r() * P);
    if (p2 === p) return false;
    const y = st[p2][d];
    if (y) {
      const a = dentro(q, p, d, y.s, y.w); const b = dentro(q, p2, d, x.s, x.w);
      if (!a || !b) return false;
      metti(st, reg, p, d, a); metti(st, reg, p2, d, b); return true;
    }
    const n = dentro(q, p2, d, x.s, x.w);
    if (!n) return false;
    metti(st, reg, p2, d, n); metti(st, reg, p, d, null);
    // e lei le rende un turno di un altro giorno, se puo'
    const d2 = Math.floor(r() * D);
    const z = st[p2][d2];
    if (z && d2 !== d && !st[p][d2]) {
      const m = dentro(q, p, d2, z.s, z.w);
      if (m) { metti(st, reg, p, d2, m); metti(st, reg, p2, d2, null); }
    }
    return true;
  }
  // sposta il turno in un altro giorno
  const d2 = Math.floor(r() * D);
  if (d2 === d || st[p][d2] || q.giorni[d2].chiuso) return false;
  const n = dentro(q, p, d2, x.s, x.w);
  if (!n) return false;
  metti(st, reg, p, d2, n); metti(st, reg, p, d, null); return true;
}

/** I turni possibili di una persona in un giorno: ogni inizio e ogni durata, a passi. */
function possibili(q: Quadro, p: number, d: number, passoInizio: number, lunghezze?: number[]): Pezzo[] {
  const l = q.limiti[p][d];
  if (q.giornoFisso[p][d] || q.blocco[p][d] || l.max < q.minLavoro) return [];
  const out: Pezzo[] = [];
  const ws = lunghezze ?? Array.from({ length: (l.max - q.minLavoro) / SLOT_MINUTI + 1 }, (_, i) => q.minLavoro + i * SLOT_MINUTI);
  for (const w of new Set(ws.map((x) => Math.max(q.minLavoro, Math.min(l.max, x))))) {
    const dur = durata(w, q.regole);
    const visti = new Set<number>();
    for (let s = l.apre; s + dur <= l.chiude; s += passoInizio) visti.add(s);
    if (l.chiude - dur >= l.apre) visti.add(l.chiude - dur);
    for (const s of visti) out.push({ s, w });
  }
  return out;
}

/** Una settimana costruita da zero: si aggiunge ogni volta il turno che fa scendere di piu' il conto. */
function costruisci(q: Quadro): Stato {
  const st: Stato = q.persone.map(() => q.giorni.map(() => null));
  let c = costo(q, st);
  const lunghezze = [q.minLavoro, 300, 360, 480, 540, 600];
  for (;;) {
    let meglio: { p: number; d: number; x: Pezzo; c: number } | null = null;
    for (let p = 0; p < q.persone.length; p++) for (let d = 0; d < q.giorni.length; d++) {
      if (st[p][d] || q.giorni[d].chiuso) continue;
      for (const x of possibili(q, p, d, 60, lunghezze)) {
        st[p][d] = x;
        const cn = costo(q, st);
        st[p][d] = null;
        if (cn < (meglio?.c ?? c) - 1e-9) meglio = { p, d, x, c: cn };
      }
    }
    if (!meglio) return st;
    st[meglio.p][meglio.d] = meglio.x; c = meglio.c;
  }
}

/** Discesa finale: ogni casella prova ogni turno possibile (o nessuno) finche' il conto scende. */
function rifinisci(q: Quadro, st: Stato, c0: number, passate = 6): number {
  let c = c0;
  for (let giro = 0; giro < passate; giro++) {
    let mosso = false;
    for (let p = 0; p < q.persone.length; p++) for (let d = 0; d < q.giorni.length; d++) {
      if (q.giorni[d].chiuso || q.giornoFisso[p][d]) continue;
      const prima = st[p][d];
      let scelto = prima;
      for (const x of [null, ...possibili(q, p, d, SLOT_MINUTI)]) {
        st[p][d] = x;
        const cn = costo(q, st);
        if (cn < c - 1e-9) { c = cn; scelto = x; mosso = true; }
      }
      st[p][d] = scelto;
    }
    // scambio dei turni fra due persone nello stesso giorno: serve alle regole che guardano
    // chi lavora con chi (coppie, giorno libero fisso, apertura della domenica)
    for (let d = 0; d < q.giorni.length; d++) {
      if (q.giorni[d].chiuso) continue;
      for (let p = 0; p < q.persone.length; p++) for (let p2 = p + 1; p2 < q.persone.length; p2++) {
        const x = st[p][d]; const y = st[p2][d];
        if ((!x && !y) || q.giornoFisso[p][d] || q.giornoFisso[p2][d]) continue;
        const a = y ? dentro(q, p, d, y.s, y.w) : null; const b2 = x ? dentro(q, p2, d, x.s, x.w) : null;
        if ((y && (!a || a.s !== y.s || a.w !== y.w)) || (x && (!b2 || b2.s !== x.s || b2.w !== x.w))) continue;
        st[p][d] = a; st[p2][d] = b2;
        const cn = costo(q, st);
        if (cn < c - 1e-9) { c = cn; mosso = true; } else { st[p][d] = x; st[p2][d] = y; }
      }
    }
    if (!mosso) break;
  }
  return c;
}

/**
 * Chi resta senza turno il sabato o la domenica: gli si da' un turno li' togliendo
 * o accorciando un altro suo turno della settimana, se il conto scende. E' la
 * mossa che la ricerca a caso trova di rado, perche' tocca due giorni insieme.
 */
function riparaWeekend(q: Quadro, st: Stato, c0: number): number {
  let c = c0;
  const lunghezze = [q.minLavoro, 300, 360, 480, 540, 600];
  for (let d = 0; d < q.giorni.length; d++) {
    if (q.giorni[d].chiuso || !q.pieno[d]) continue;
    for (let p = 0; p < q.persone.length; p++) {
      if (st[p][d]) continue;
      let meglio: { x: Pezzo; d2: number; y: Pezzo | null; c: number } | null = null;
      for (const x of possibili(q, p, d, 60, lunghezze)) {
        st[p][d] = x;
        for (let d2 = 0; d2 < q.giorni.length; d2++) {
          const y = st[p][d2];
          if (!y || d2 === d) continue;
          const fine = y.s + durata(y.w, q.regole);
          const prove: (Pezzo | null)[] = [null];
          for (let w = y.w - SLOT_MINUTI; w >= q.minLavoro; w -= SLOT_MINUTI) {
            prove.push({ s: y.s, w }, { s: fine - durata(w, q.regole), w });
          }
          for (const z of prove) {
            st[p][d2] = z;
            const cn = costo(q, st);
            if (cn < (meglio?.c ?? c) - 1e-9) meglio = { x, d2, y: z, c: cn };
          }
          st[p][d2] = y;
        }
        st[p][d] = null;
      }
      if (meglio) { st[p][d] = meglio.x; st[p][meglio.d2] = meglio.y; c = meglio.c; }
    }
  }
  return c;
}

/**
 * Chi ha meno riposi del minimo del negozio (12/11/2026): si prova a toglierle un turno di un
 * giorno non caldo e a far risistemare la settimana alle altre, tenendo chiusa quella casella.
 * Se il conto scende la mossa resta. La ricerca a caso non la trova, perche' togliere il turno
 * e ricoprire il giorno sono molti passi che uno per uno peggiorano.
 */
function riparaRiposi(q: Quadro, st: Stato, c0: number, r: () => number): number {
  if (!q.riposiMin || q.giorniSettimana < 7) return c0;
  let c = c0;
  const lavorati = (p: number) => q.giorniFissi[p] + st[p].filter(Boolean).length;
  for (let giro = 0; giro < 4; giro++) {
    let mosso = false;
    for (let p = 0; p < q.persone.length; p++) {
      if (q.giorniSettimana - lavorati(p) >= q.riposiMin) continue;
      let meglio: { st: Stato; c: number } | null = null;
      for (let d = 0; d < q.giorni.length; d++) {
        if (!st[p][d] || q.pieno[d] || q.giornoFisso[p][d]) continue;
        const prova = copia(st);
        prova[p][d] = null;
        q.blocco[p][d] = true;
        // una ricerca breve con la casella chiusa: le ore tolte si ridistribuiscono fra tutte
        // (chi resta allunga, le altre si scambiano i giorni), cosa che la sola discesa non trova
        const esito = ricuoci(q, prova, 15_000, r, 20_000);
        const c1 = rifinisci(q, esito.st, esito.c, 3);
        q.blocco[p][d] = false;
        if (Number.isFinite(c1) && c1 < (meglio?.c ?? c) - 1e-9) meglio = { st: esito.st, c: c1 };
      }
      if (meglio) {
        for (let i = 0; i < st.length; i++) st[i] = meglio.st[i];
        c = meglio.c; mosso = true;
      }
    }
    if (!mosso) break;
  }
  return c;
}

/** Persone che mancano nel giorno, sommate sulle mezz'ore: serve a sapere dove riparare. */
function mancaNelGiorno(q: Quadro, st: Stato, d: number): number {
  const g = q.giorni[d];
  if (g.chiuso) return 0;
  let manca = 0;
  for (let k = 0; k < g.fabbisogno.length; k++) {
    const m = g.apre + k * SLOT_MINUTI;
    let ci = q.fissa[d][k];
    for (let p = 0; p < q.persone.length; p++) { const x = st[p][d]; if (x && m >= x.s && m < x.s + x.w) ci += 1; }
    if (ci < g.fabbisogno[k]) manca += g.fabbisogno[k] - ci;
  }
  return manca;
}

/**
 * Dove restano ore scoperte: chi e' gia' in turno quel giorno allunga, togliendo le stesse
 * ore a un altro suo turno della settimana; se li' resta un buco lo chiude una collega
 * allungando il suo. Sono tre caselle mosse insieme, che la ricerca a caso trova di rado
 * (misura del 11/11/2026, Roma Soratte: domenica dalle 17 alle 19 con una persona a 3 ore
 * dal contratto e nessuno che potesse restare).
 */
function riparaScoperture(q: Quadro, st: Stato, c0: number): number {
  let c = c0;
  const variante = (x: Pezzo, w: number, daInizio: boolean): Pezzo => (daInizio ? { s: x.s + x.w - w, w } : { s: x.s, w });
  for (let giro = 0; giro < 6; giro++) {
    let meglio: { celle: [number, number, Pezzo | null][]; c: number } | null = null;
    for (let d1 = 0; d1 < q.giorni.length; d1++) {
      if (mancaNelGiorno(q, st, d1) <= 0) continue;
      for (let p = 0; p < q.persone.length; p++) {
        const x = st[p][d1];
        if (!x) continue;
        for (let k = 1; k <= 6; k++) for (const prima of [true, false]) {
          const x1 = dentro(q, p, d1, prima ? x.s - k * SLOT_MINUTI : x.s, x.w + k * SLOT_MINUTI);
          if (!x1 || x1.w !== x.w + k * SLOT_MINUTI) continue;
          st[p][d1] = x1;
          for (let d2 = 0; d2 < q.giorni.length; d2++) {
            const y = st[p][d2];
            if (!y || d2 === d1 || y.w - k * SLOT_MINUTI < q.minLavoro) continue;
            for (const taglioInizio of [true, false]) {
              const y1 = variante(y, y.w - k * SLOT_MINUTI, taglioInizio);
              st[p][d2] = y1;
              const c1 = costo(q, st);
              if (c1 < (meglio?.c ?? c) - 1e-9) meglio = { celle: [[p, d1, x1], [p, d2, y1]], c: c1 };
              for (let p3 = 0; p3 < q.persone.length; p3++) {
                const z = st[p3][d2];
                if (!z || p3 === p) continue;
                for (const zPrima of [true, false]) {
                  const z1 = dentro(q, p3, d2, zPrima ? z.s - k * SLOT_MINUTI : z.s, z.w + k * SLOT_MINUTI);
                  if (!z1 || z1.w !== z.w + k * SLOT_MINUTI) continue;
                  st[p3][d2] = z1;
                  const c2 = costo(q, st);
                  if (c2 < (meglio?.c ?? c) - 1e-9) meglio = { celle: [[p, d1, x1], [p, d2, y1], [p3, d2, z1]], c: c2 };
                  st[p3][d2] = z;
                }
              }
              st[p][d2] = y;
            }
          }
          st[p][d1] = x;
        }
      }
    }
    if (!meglio) break;
    for (const [p, d, x] of meglio.celle) st[p][d] = x;
    c = meglio.c;
  }
  return c;
}

/**
 * Ore fino al contratto (Patrizio, 11/11/2026, scelta del negozio): le ore che il
 * traffico non chiede si mettono comunque in turno. Prima si allungano i turni di
 * venerdi', sabato e domenica, poi quelli degli altri giorni, poi si aggiunge un
 * turno nuovo se ne restano almeno quante il turno minimo. Mai oltre il contratto,
 * il turno massimo, i giorni di lavoro e gli accordi; fra le scelte possibili
 * vince quella dove ci sono meno persone in piu'.
 */
function riempiOre(q: Quadro, st: Stato): void {
  const oreDi = (p: number) => q.oreFisse[p] + st[p].reduce((a, x) => a + (x ? q.lav[x.w / SLOT_MINUTI] : 0), 0);
  const ordine = q.giorni.map((_, d) => d).sort((a, b) => Number(giornoIso(q.giorni[b].data) >= 5) - Number(giornoIso(q.giorni[a].data) >= 5));
  for (let giro = 0; giro < 200; giro++) {
    let mosso = false;
    for (let p = 0; p < q.persone.length; p++) {
      const libere = q.persone[p].ore - oreDi(p);
      if (libere < 1 / 6 - 1e-9) continue;
      // 1. allunga un turno: prima il fine settimana
      const scelta: { v: { d: number; x: Pezzo; c: number } | null } = { v: null };
      for (const fine of [true, false]) {
        for (const d of ordine) {
          if ((giornoIso(q.giorni[d].data) >= 5) !== fine) continue;
          const x = st[p][d];
          if (!x) continue;
          const termine = x.s + durata(x.w, q.regole);
          const w = x.w + SLOT_MINUTI;
          for (const n of [dentro(q, p, d, x.s, w), dentro(q, p, d, termine - durata(w, q.regole), w)]) {
            if (!n || n.w !== w || q.lav[n.w / SLOT_MINUTI] - q.lav[x.w / SLOT_MINUTI] > libere + 1e-9) continue;
            st[p][d] = n;
            const c = costo(q, st);
            st[p][d] = x;
            if (Number.isFinite(c) && (!scelta.v || c < scelta.v.c - 1e-9)) scelta.v = { d, x: n, c };
          }
        }
        if (scelta.v) break;
      }
      // 2. un turno nuovo, se le ore libere bastano per il turno minimo
      if (!scelta.v && libere >= q.lav[q.minLavoro / SLOT_MINUTI] - 1e-9) {
        for (const fine of [true, false]) {
          for (const d of ordine) {
            if ((giornoIso(q.giorni[d].data) >= 5) !== fine || st[p][d] || q.giorni[d].chiuso) continue;
            if (q.nuove.giornoLibero?.get(q.persone[p].id) === giornoIso(q.giorni[d].data)) continue;
            for (const n of possibili(q, p, d, 60, [q.minLavoro])) {
              st[p][d] = n;
              const c = costo(q, st);
              st[p][d] = null;
              if (Number.isFinite(c) && (!scelta.v || c < scelta.v.c - 1e-9)) scelta.v = { d, x: n, c };
            }
          }
          if (scelta.v) break;
        }
      }
      if (scelta.v) { st[p][scelta.v.d] = scelta.v.x; mosso = true; }
    }
    if (!mosso) return;
  }
}

/** La ricerca a caso: la temperatura scende da `t0` (accetto di peggiorare) a «accetto solo miglioramenti». */
function ricuoci(q: Quadro, partenza: Stato, giri: number, r: () => number, t0 = 30_000): { st: Stato; c: number } {
  const st = copia(partenza);
  let c = costo(q, st);
  let meglio = { st: copia(st), c };
  if (!Number.isFinite(c)) return meglio;
  const reg: Registro = [];
  const t1 = 8;
  for (let i = 0; i < giri; i++) {
    reg.length = 0;
    if (!mossa(q, st, reg, r)) { annulla(st, reg); continue; }
    const cn = costo(q, st);
    const t = t0 * Math.pow(t1 / t0, i / giri);
    if (Number.isFinite(cn) && (cn <= c || r() < Math.exp((c - cn) / t))) {
      c = cn;
      if (c < meglio.c - 1e-9) meglio = { st: copia(st), c };
    } else annulla(st, reg);
  }
  return meglio;
}

function cerca(q: Quadro, partenza: Stato, giri: number, r: () => number): { st: Stato; c: number } {
  const meglio = ricuoci(q, partenza, giri, r);
  if (!Number.isFinite(meglio.c)) return meglio;
  meglio.c = rifinisci(q, meglio.st, meglio.c);
  let riparato = riparaScoperture(q, meglio.st, riparaWeekend(q, meglio.st, meglio.c));
  riparato = riparaRiposi(q, meglio.st, riparato, r);
  if (riparato < meglio.c - 1e-9) meglio.c = rifinisci(q, meglio.st, riparato);
  return meglio;
}

/**
 * La settimana sistemata secondo tutte le regole insieme. `turni` sono quelli gia'
 * proposti per le persone di `persone`; `fissi` contano come presenza e non si
 * toccano. Restituisce solo i turni delle persone (senza i fissi), mai peggiori
 * di quelli di partenza.
 */
interface Preparata { q: Quadro; partenza: Stato; altri: Turno[]; fuoriStato: Turno[]; tuttiFissi: Turno[] }

/** Il quadro della settimana e i turni di partenza portati sulla griglia; null se non c'e' niente da sistemare. */
function prepara(
  giorni: GiornoPiano[], turni: Turno[], persone: PersonaTurni[], regole: RegoleTurni, nuove: RegoleNuove, fissi: Turno[],
): Preparata | null {
  const aperti = giorni.filter((g) => !g.chiuso);
  if (!aperti.length || !persone.length) return null;
  const indice = new Map(persone.map((p, i) => [p.id, i]));
  // La presenza piu' corta che vale il turno minimo, e la tabella delle ore lavorate per presenza.
  const passi = Math.ceil(24 * 60 / SLOT_MINUTI);
  const lavMin = Array.from({ length: passi + 1 }, (_, i) => lavoroDi(i * SLOT_MINUTI, regole));
  let minLavoro = regole.turnoMinOre * 60;
  while (minLavoro < 24 * 60 && lavMin[Math.ceil(minLavoro / SLOT_MINUTI)] < regole.turnoMinOre * 60 - 1e-9) minLavoro += SLOT_MINUTI;
  minLavoro = Math.ceil(minLavoro / SLOT_MINUTI) * SLOT_MINUTI;
  /** La presenza piu' lunga che sta nell'orario e nel turno massimo. */
  const presenzaMassima = (giornata: number) => {
    let d = Math.floor(giornata / SLOT_MINUTI) * SLOT_MINUTI;
    while (d > 0 && lavMin[d / SLOT_MINUTI] > regole.turnoMaxOre * 60 + 1e-9) d -= SLOT_MINUTI;
    return d;
  };
  // I turni che non sono di queste persone, o che sono in piu' nello stesso giorno, restano com'erano.
  const altri = turni.filter((t) => !indice.has(t.employeeId) || !giorni.some((g) => g.data === t.data));
  const tuttiFissi = [...fissi, ...altri];
  const q = {
    giorni, persone, regole, nuove, minLavoro,
    lav: lavMin.map((m) => m / 60),
    straordWeekend: !!nuove.straordinariWeekend,
    fissa: giorni.map((g) => {
      const cop = g.fabbisogno.map(() => 0);
      for (const t of tuttiFissi) {
        if (t.data !== g.data) continue;
        for (let k = 0; k < cop.length; k++) { const m = g.apre + k * SLOT_MINUTI; if (m >= minuti(t.inizio) && m < minuti(t.fine)) cop[k] += 1; }
      }
      return cop;
    }),
    fissePersone: giorni.map((g) => new Set(tuttiFissi.filter((t) => t.data === g.data).map((t) => t.employeeId))),
    oreFisse: persone.map((p) => tuttiFissi.filter((t) => t.employeeId === p.id && giorni.some((g) => g.data === t.data)).reduce((a, t) => a + oreLavorate(t), 0)),
    giornoFisso: persone.map((p) => giorni.map((g) => tuttiFissi.some((t) => t.employeeId === p.id && t.data === g.data))),
    limiti: persone.map((p) => giorni.map((g) => {
      if (g.chiuso || p.nonDisponibile.has(g.data)) return { apre: 0, chiude: 0, max: 0 };
      const l = limitiPersona(p, g);
      return { ...l, max: presenzaMassima(l.chiude - l.apre) };
    })),
  } as Quadro;
  const guidaIds = (nuove.guida ?? []).length >= 2 ? nuove.guida! : [];
  q.iso = giorni.map((g) => giornoIso(g.data));
  // sabato, domenica, festivi e giorni di evento: lavorano tutti, la responsabile fa il suo orario
  q.pieno = giorni.map((g) => (nuove.giorniPieni ? nuove.giorniPieni.has(g.data) : giornoIso(g.data) >= 6));
  q.straordCaldo = giorni.map((g, d) => (nuove.giorniStraordinari ? nuove.giorniStraordinari.has(g.data) : q.pieno[d]));
  q.lunDue = giorni.map((g) => !!g.lunediDue && !g.chiuso);
  q.lunPrima = new Array(persone.length * persone.length).fill(0);
  (nuove.lunediPrima ?? []).forEach((k, quando) => {
    const [a, b] = k.split('|').map((id) => indice.get(id) ?? -1);
    if (a < 0 || b < 0) return;
    const peso = quando === 0 ? 1 : quando === 1 ? 0.5 : 0.25;
    q.lunPrima[a * persone.length + b] += peso; q.lunPrima[b * persone.length + a] += peso;
  });
  q.puo = persone.map((p, i) => giorni.map((g, d) => !g.chiuso && p.ore >= regole.turnoMinOre && q.limiti[i][d].max >= minLavoro));
  // Chi apre e chi chiude nei giorni caldi. Senza `guidaCaldi` vale la regola dell'11/11: apre la
  // responsabile in tutti i giorni pieni. Con la vice e `alterna`, una apre e l'altra chiude, e
  // da un giorno caldo al successivo si scambiano (anche da una settimana all'altra).
  {
    const gc = nuove.guidaCaldi ?? (nuove.responsabile ? { ids: [nuove.responsabile], ore: PRESENZA_RESPONSABILE_WEEKEND / 60, alterna: false, giorni: new Set(giorni.filter((_, d) => q.pieno[d]).map((g) => g.data)) } : null);
    const idx = (gc?.ids ?? []).map((id) => indice.get(id) ?? -1).filter((i) => i >= 0);
    const puoAprire = (i: number, d: number) => !q.giornoFisso[i][d] && q.puo[i][d];
    let giro = giorni.length ? Math.floor(Date.parse(`${giorni[0].data}T00:00:00Z`) / 86_400_000 / 7) : 0;
    q.apreP = giorni.map(() => -1); q.chiudeP = giorni.map(() => -1); q.aprePresenza = giorni.map(() => 0);
    giorni.forEach((g, d) => {
      if (!gc || g.chiuso || !gc.giorni.has(g.data) || !idx.length) return;
      let apre = idx[gc.alterna && idx.length > 1 ? giro % 2 : 0];
      let chiude = gc.alterna && idx.length > 1 ? idx[(giro + 1) % 2] : -1;
      giro += 1;
      // chi doveva aprire quel giorno non puo': apre l'altra, se puo'
      if (!puoAprire(apre, d) && chiude >= 0 && puoAprire(chiude, d)) { const t = apre; apre = chiude; chiude = t; }
      if (puoAprire(apre, d)) { q.apreP[d] = apre; q.aprePresenza[d] = Math.min(Math.round(gc.ore * 60 / SLOT_MINUTI) * SLOT_MINUTI, q.limiti[apre][d].max); }
      if (chiude >= 0 && puoAprire(chiude, d)) q.chiudeP[d] = chiude;
    });
  }
  q.riposiMin = nuove.riposi?.min != null ? Math.max(RIPOSO_LEGALE, nuove.riposi.min) : 0;
  q.giorniSettimana = giorni.length + (nuove.giorniFuori ?? 0);
  q.settimanaIntera = giorni.length >= 7;
  q.blocco = persone.map(() => giorni.map(() => false));
  const bit = (lista: number[] | undefined) => (lista ?? []).reduce((a, g) => (g >= 1 && g <= 7 ? a | (1 << g) : a), 0);
  q.preferiti = persone.map((p) => bit(nuove.riposi?.preferiti?.get(p.id)));
  q.mai = persone.map((p) => bit(nuove.riposi?.mai?.get(p.id)));
  q.pari = !!nuove.straordinariPari;
  q.libero = persone.map((p) => nuove.giornoLibero?.get(p.id) ?? 0);
  q.eGuida = persone.map((p) => guidaIds.includes(p.id));
  q.guidaAttiva = guidaIds.length >= 2;
  q.guidaFissa = giorni.map((_, d) => guidaIds.some((id) => q.fissePersone[d].has(id)));
  // la regola del lunedi' vale se almeno una delle due quel giorno potrebbe lavorare
  q.guidaPossibile = giorni.map((_, d) => persone.some((_p, i) => q.eGuida[i] && q.limiti[i][d].max >= minLavoro));
  q.weekendDovuto = persone.map((p, i) => giorni.map((_, d) => !q.giornoFisso[i][d] && p.ore >= regole.turnoMinOre && q.limiti[i][d].max >= minLavoro));
  q.giorniFissi = persone.map((p, i) => q.giornoFisso[i].filter(Boolean).length + (nuove.giorniGia?.get(p.id) ?? 0));
  q.coppiePrima = persone.flatMap((a) => persone.map((b) => nuove.coppiePrima?.get(coppia(a.id, b.id)) ?? 0));
  q.bufOre = persone.map(() => 0); q.bufEvento = persone.map(() => 0); q.bufGiorni = persone.map(() => 0);
  q.bufCoppie = new Array(persone.length * persone.length).fill(0);
  q.bufCop = new Array(Math.max(1, ...giorni.map((g) => g.fabbisogno.length))).fill(0);
  q.bufInTurno = persone.map(() => 0);
  const partenza: Stato = persone.map(() => giorni.map(() => null));
  const fuoriStato: Turno[] = [];
  for (const t of turni) {
    const p = indice.get(t.employeeId); const d = giorni.findIndex((g) => g.data === t.data);
    if (p == null || d < 0) continue;
    if (partenza[p][d]) { fuoriStato.push(t); continue; }
    // L'orario si porta sulla griglia delle mezz'ore: l'inizio all'indietro, la fine in avanti
    // (un 10:00-17:40 della proposta diventa 10:00-18:00, con la sua pausa da 10 minuti).
    const l = q.limiti[p][d];
    const s = Math.max(l.apre, Math.floor(minuti(t.inizio) / SLOT_MINUTI) * SLOT_MINUTI);
    const fine = Math.min(l.chiude, Math.ceil(minuti(t.fine) / SLOT_MINUTI) * SLOT_MINUTI);
    const w = fine - s;
    // un turno che il conto non sa rappresentare (fuori dai limiti della persona) resta fisso
    if (w < minLavoro || w > l.max || minuti(t.inizio) < l.apre || minuti(t.fine) > l.chiude) { fuoriStato.push(t); continue; }
    partenza[p][d] = { s, w };
  }
  // Il tetto delle ore: il contratto, o le ore della partenza se erano di piu'. Oltre il
  // contratto si va con le ore dei giorni di evento, del sabato e della domenica; quelle che
  // la partenza aveva gia' in piu' nei feriali (straordinari ammessi, anticipo) restano.
  const speciale = (d: number) => !!giorni[d].straordinari || (q.pieno[d] && q.straordWeekend);
  q.tetto = persone.map((p, i) => Math.max(p.ore, q.oreFisse[i] + partenza[i].reduce((a, x) => a + (x ? q.lav[x.w / SLOT_MINUTI] : 0), 0)));
  q.oltreLibero = persone.map((p, i) => {
    // solo i turni che il conto muove: le ore dei turni fissi nei giorni speciali il conto non le
    // mette fra quelle «di evento», quindi non si tolgono nemmeno qui (altrimenti la partenza sarebbe fuori regola)
    const inSpeciale = partenza[i].reduce((a, x, d) => a + (x && speciale(d) ? q.lav[x.w / SLOT_MINUTI] : 0), 0);
    return Math.max(0, q.tetto[i] - p.ore - inSpeciale);
  });
  return { q, partenza, altri, fuoriStato, tuttiFissi };
}

/**
 * Quanto costa una settimana di turni secondo il conto del motore (piu' basso = meglio;
 * Infinity = fuori dai vincoli duri). Serve ai test e alle misure per confrontare due settimane
 * con le stesse regole. I turni che il conto non sa rappresentare contano come fissi.
 */
export function contoSettimana(
  giorni: GiornoPiano[], turni: Turno[], persone: PersonaTurni[], regole: RegoleTurni = REGOLE_DEFAULT,
  nuove: RegoleNuove = {}, fissi: Turno[] = [],
): number {
  const pr = prepara(giorni, turni, persone, regole, nuove, fissi);
  if (!pr) return 0;
  if (pr.fuoriStato.length) {
    const tenuti = new Set(pr.fuoriStato);
    return contoSettimana(giorni, turni.filter((t) => !tenuti.has(t) && !pr.altri.includes(t)), persone, regole, nuove, [...pr.tuttiFissi, ...pr.fuoriStato]);
  }
  return costo(pr.q, pr.partenza);
}

export function ottimizzaSettimana(
  giorni: GiornoPiano[], turni: Turno[], persone: PersonaTurni[], regole: RegoleTurni = REGOLE_DEFAULT,
  nuove: RegoleNuove = {}, fissi: Turno[] = [],
): Turno[] {
  const pr = prepara(giorni, turni, persone, regole, nuove, fissi);
  if (!pr) return turni;
  const { q, partenza, altri, fuoriStato, tuttiFissi } = pr;
  if (fuoriStato.length) {
    // rari: si ricomincia tenendoli fra i fissi, cosi' il conto li vede
    const tenuti = new Set(fuoriStato);
    return [...ottimizzaSettimana(giorni, turni.filter((t) => !tenuti.has(t) && !altri.includes(t)), persone, regole, nuove, [...tuttiFissi, ...fuoriStato]), ...fuoriStato, ...altri];
  }
  const c0 = costo(q, partenza);
  // una partenza che il conto non sa leggere (piu' giorni del massimo gia' nei turni fissi) resta com'e'
  if (!Number.isFinite(c0)) return turni;
  // il conto costa in proporzione alle persone: i giri calano con loro, cosi' il tempo resta quello
  // (misura del 11/11/2026 su Roma Soratte: sotto i 60.000 giri restava qualche ora scoperta che si poteva coprire)
  const giri = nuove.giri ?? Math.max(12_000, Math.min(60_000, Math.round(240_000 / persone.length)));
  const seme = semeDi(`${giorni[0].data}|${persone.map((p) => p.id).join(',')}`);
  let meglio = { st: partenza, c: c0 };
  // due partenze: i turni gia' proposti e la settimana costruita da zero
  const daZero = costruisci(q);
  for (const [k, inizio] of [partenza, daZero].entries()) {
    const esito = cerca(q, inizio, giri, casuale(seme + k * 7919));
    if (esito.c < meglio.c - 1e-9) meglio = esito;
  }
  // se la ricerca non migliora si tengono i turni di partenza, riportati sulla griglia
  if (!(meglio.c < c0 - 1e-9)) meglio = { st: copia(partenza), c: c0 };
  if (nuove.riempiContratto) riempiOre(q, meglio.st);
  const out: Turno[] = [];
  for (let p = 0; p < persone.length; p++) for (let d = 0; d < giorni.length; d++) {
    const x = meglio.st[p][d];
    if (!x) continue;
    out.push({ employeeId: persone[p].id, data: giorni[d].data, inizio: hhmm(x.s), fine: hhmm(x.s + x.w), pausaMinuti: pausaMinimaPerPresenza(x.w, regole) });
  }
  return [...out, ...altri];
}

// ── Le deroghe ───────────────────────────────────────────────────────────

export interface Deroga {
  regola: 'weekend' | 'giorno_libero' | 'lunedi_guida' | 'domenica_apertura' | 'caldo_chiusura' | 'una_sola' | 'vuoto' | 'turno_corto' | 'troppi_giorni' | 'oltre_contratto' | 'riposi' | 'riposo_vietato' | 'lunedi_troppi' | 'lunedi_fasce' | 'lunedi_coppia';
  data: string | null;
  employeeId: string | null;
  testo: string;
}

/**
 * Le regole che i turni di una settimana non rispettano (Patrizio, 11/11/2026:
 * le modifiche a mano restano possibili, ma la deroga si deve vedere). I nomi
 * servono solo per il testo.
 */
export function derogheSettimana(args: {
  giorni: GiornoPiano[];
  turni: Turno[];
  persone: (PersonaTurni & { nome: string })[];
  regole?: RegoleTurni;
  giornoLibero?: Map<string, number>;
  guida?: { responsabile: string | null; vice: string | null };
  /** riposi del 12/11/2026: minimo del negozio, giorni preferiti e giorni in cui non si riposa mai */
  riposi?: { min?: number; preferiti?: Map<string, number[]>; mai?: Map<string, number[]> };
  /** le coppie dei lunedi' precedenti, dalla piu' recente (lunedi' a due persone, 12/11/2026) */
  lunediPrima?: string[];
}): Deroga[] {
  const regole = args.regole ?? REGOLE_DEFAULT;
  const out: Deroga[] = [];
  const giornoTesto = (d: string) => `${['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'][giornoIso(d)]} ${Number(d.slice(8))}`;
  const nomi = new Map(args.persone.map((p) => [p.id, p.nome]));
  for (const g of args.giorni) {
    if (g.chiuso) continue;
    const del = args.turni.filter((t) => t.data === g.data);
    const iso = giornoIso(g.data);
    if (!del.length) { out.push({ regola: 'vuoto', data: g.data, employeeId: null, testo: `${giornoTesto(g.data)}: nessuno in turno` }); continue; }
    if (new Set(del.map((t) => t.employeeId)).size === 1) out.push({ regola: 'una_sola', data: g.data, employeeId: null, testo: `${giornoTesto(g.data)}: una persona sola` });
    if (iso === 1 && args.guida?.responsabile && args.guida.vice
      && !del.some((t) => t.employeeId === args.guida!.responsabile || t.employeeId === args.guida!.vice)) {
      out.push({ regola: 'lunedi_guida', data: g.data, employeeId: null, testo: `${giornoTesto(g.data)}: né la responsabile né la vice sono in turno (versamento in banca)` });
    }
    // lunedi' a due persone (Patrizio, 12/11/2026): al massimo due, e non la coppia del lunedi' prima
    if (g.lunediDue) {
      const chi = [...new Set(del.map((t) => t.employeeId))];
      if (chi.length > LUNEDI_MAX_PERSONE) out.push({ regola: 'lunedi_troppi', data: g.data, employeeId: null, testo: `${giornoTesto(g.data)}: ${chi.length} persone in turno, il lunedì dopo il weekend al massimo ${LUNEDI_MAX_PERSONE}` });
      else if (chi.length === 2 && args.lunediPrima?.[0] === coppia(chi[0], chi[1])) out.push({ regola: 'lunedi_coppia', data: g.data, employeeId: null, testo: `${giornoTesto(g.data)}: lavorano le stesse due persone del lunedì prima` });
      if (g.lunediFasceOltre) out.push({ regola: 'lunedi_fasce', data: g.data, employeeId: null, testo: `${giornoTesto(g.data)}: le fasce salvate chiedono più di ${LUNEDI_MAX_PERSONE} persone, ma il lunedì comanda il tetto di ${LUNEDI_MAX_PERSONE}` });
    }
    // giorni caldi: una fra responsabile e vice fa l'apertura e resta le sue ore; con la regola
    // «una apre, l'altra chiude» l'altra arriva alla chiusura (Patrizio, 11 e 12/11/2026)
    const pieno = regole.giorniPieni ? giornoPieno(g) : iso >= 6;
    const conGuida = regole.giorniPieni && (g.guida ?? pieno);
    const guide = [args.guida?.responsabile, regole.caldiGuidaApreChiude ? args.guida?.vice : null]
      .map((id) => (id ? args.persone.find((p) => p.id === id) : undefined))
      .filter((p): p is PersonaTurni & { nome: string } => !!p && p.ore >= regole.turnoMinOre && !p.nonDisponibile.has(g.data));
    if (conGuida && guide.length) {
      const fineApre = Math.min(g.chiude, g.apre + Math.round((regole.caldiOreApertura ?? PRESENZA_RESPONSABILE_WEEKEND / 60) * 60));
      const apre = guide.find((p) => del.some((t) => t.employeeId === p.id && minuti(t.inizio) === g.apre && minuti(t.fine) === fineApre));
      if (!apre) {
        out.push({ regola: 'domenica_apertura', data: g.data, employeeId: guide[0].id, testo: `${giornoTesto(g.data)}: ${guide.length > 1 ? 'né la responsabile né la vice fanno' : `${guide[0].nome}, la responsabile, non fa`} ${hhmm(g.apre)}-${hhmm(fineApre)}` });
      } else if (guide.length > 1 && !guide.some((p) => p.id !== apre.id && del.some((t) => t.employeeId === p.id && minuti(t.fine) === g.chiude))) {
        out.push({ regola: 'caldo_chiusura', data: g.data, employeeId: guide.find((p) => p.id !== apre.id)!.id, testo: `${giornoTesto(g.data)}: apre ${apre.nome}, ma l'altra fra responsabile e vice non fa la chiusura` });
      }
    }
    for (const p of args.persone) {
      const suo = del.filter((t) => t.employeeId === p.id);
      if (pieno && !suo.length && p.ore >= regole.turnoMinOre && !p.nonDisponibile.has(g.data)) {
        out.push({ regola: 'weekend', data: g.data, employeeId: p.id, testo: `${p.nome} non lavora ${giornoTesto(g.data)}: nel weekend lavorano tutti` });
      }
      if (suo.length && (args.giornoLibero?.get(p.id) === iso || args.riposi?.preferiti?.get(p.id)?.includes(iso))) {
        out.push({ regola: 'giorno_libero', data: g.data, employeeId: p.id, testo: `${p.nome} lavora ${giornoTesto(g.data)}, il suo giorno di riposo` });
      }
      if (!suo.length && !pieno && args.riposi?.mai?.get(p.id)?.includes(iso) && p.ore >= regole.turnoMinOre && !p.nonDisponibile.has(g.data)) {
        out.push({ regola: 'riposo_vietato', data: g.data, employeeId: p.id, testo: `${p.nome} riposa ${giornoTesto(g.data)}, un giorno in cui non riposa mai` });
      }
    }
    for (const t of del) {
      if (oreLavorate(t) < regole.turnoMinOre - 1e-9) out.push({ regola: 'turno_corto', data: g.data, employeeId: t.employeeId, testo: `${nomi.get(t.employeeId) ?? 'Un turno'} ${giornoTesto(g.data)}: turno sotto le ${regole.turnoMinOre} ore` });
    }
  }
  const date = new Set(args.giorni.map((g) => g.data));
  for (const p of args.persone) {
    const suoi = args.turni.filter((t) => t.employeeId === p.id && date.has(t.data));
    const lavorati = new Set(suoi.map((t) => t.data)).size;
    if (lavorati > regole.giorniLavoroMax) out.push({ regola: 'troppi_giorni', data: null, employeeId: p.id, testo: `${p.nome} lavora più di ${regole.giorniLavoroMax} giorni` });
    else if (args.giorni.length >= 7 && lavorati > 7 - RIPOSO_LEGALE) out.push({ regola: 'troppi_giorni', data: null, employeeId: p.id, testo: `${p.nome} non ha un giorno di riposo nella settimana: per legge ne serve almeno uno` });
    else if (args.giorni.length >= 7 && args.riposi?.min && 7 - lavorati < args.riposi.min && lavorati > 0) {
      out.push({ regola: 'riposi', data: null, employeeId: p.id, testo: `${p.nome} ha ${7 - lavorati} ${7 - lavorati === 1 ? 'giorno' : 'giorni'} di riposo: il negozio ne chiede ${args.riposi.min}` });
    }
  }
  return out;
}

/** I motivi di uno straordinario (Patrizio, 11/11/2026): giorno forte, oppure una persona in piu' chiesta dalla direzione. */
export const MOTIVI_STRAORDINARIO = [
  { id: 'giorno_forte', nome: 'Giorno forte (sabato, domenica, festivo, evento)' },
  { id: 'ricarico', nome: 'Ricarico del magazzino' },
  { id: 'allestimento', nome: 'Allestimento' },
] as const;
export type MotivoStraordinario = typeof MOTIVI_STRAORDINARIO[number]['id'];

/**
 * Lo straordinario della settimana scritto sui turni dei giorni forti, a ore e mezz'ore
 * (Patrizio, 11/11/2026: «2 ore, 2 ore e mezza, 3 ore»). Per ogni persona le ore oltre il
 * contratto si dividono fra i suoi turni di sabato, domenica, festivi ed eventi, mezz'ora alla
 * volta cominciando dal primo giorno, mai piu' delle ore del turno. Quello che non sta nei giorni
 * forti non si scrive: nei feriali lo straordinario lo decide una persona.
 */
export function ripartisciStraordinari(turni: Turno[], contratto: Map<string, number>, giorniPieni: Set<string>, esclusi?: Set<Turno>): Map<Turno, number> {
  const out = new Map<Turno, number>();
  for (const [id, ore] of contratto) {
    const suoi = turni.filter((t) => t.employeeId === id);
    let mezze = Math.floor((suoi.reduce((a, t) => a + oreLavorate(t), 0) - ore) * 2 + 1e-9);
    const forti = suoi.filter((t) => giorniPieni.has(t.data) && !esclusi?.has(t)).sort((a, b) => a.data.localeCompare(b.data));
    if (mezze <= 0 || !forti.length) continue;
    const date = forti.map(() => 0);
    while (mezze > 0) {
      let dato = false;
      for (let i = 0; i < forti.length && mezze > 0; i++) {
        if ((date[i] + 1) / 2 > oreLavorate(forti[i]) + 1e-9) continue;
        date[i]++; mezze--; dato = true;
      }
      if (!dato) break;
    }
    forti.forEach((t, i) => { if (date[i] > 0) out.set(t, date[i] / 2); });
  }
  return out;
}

/** Un turno salvato, con lo straordinario che porta scritto. */
export interface TurnoSalvato extends Turno {
  id: string;
  oreStraordinario: number;
  /** `giorno_forte`, `ricarico`, `allestimento`, oppure niente */
  motivo?: string | null;
  /** lo straordinario l'ha scritto una persona (`shifts.straordinario_a_mano`): il sistema non lo tocca */
  aMano?: boolean;
  /** il turno sta in un mese chiuso: non si riscrive, il suo straordinario resta com'e' */
  bloccato?: boolean;
}

/**
 * Lo straordinario che il sistema non tocca: quello scritto da una persona (qualunque
 * motivo), quello per ricarico o allestimento, quello fuori dai giorni forti e quello dei
 * turni di un mese chiuso. Conta come gia' assegnato.
 */
const straordinarioFermo = (t: TurnoSalvato, giorniForti: Set<string>) =>
  !!t.bloccato || (t.oreStraordinario > 0 && (!!t.aMano || t.motivo === 'ricarico' || t.motivo === 'allestimento' || !giorniForti.has(t.data)));

/**
 * Lo straordinario «giorno forte» da riscrivere dopo una modifica a mano (Patrizio,
 * 12/11/2026): la proposta lo scrive sui turni, ma accorciando, allungando, spostando o
 * togliendo un turno il valore restava quello di prima. `turni` sono i turni salvati di una
 * settimana (o del pezzo di settimana a video), `contratto` le ore di contratto di quella
 * settimana **delle sole persone toccate dalla modifica**, `giorniForti` i giorni in cui lo
 * straordinario e' ammesso.
 *
 * Per ogni persona: ore dei turni meno contratto, meno lo straordinario fermo (scritto a
 * mano, ricarico, allestimento, giorni non forti, mesi chiusi: restano come sono); quello
 * che avanza si divide a mezz'ore sui suoi altri turni dei giorni forti con
 * `ripartisciStraordinari`. `cambi` sono solo i turni il cui valore cambia; `nonTorna` le
 * persone a cui, per colpa dei turni di un mese chiuso, lo straordinario scritto non
 * corrisponde alle ore oltre il contratto (la pagina lo dice in «Da guardare»).
 */
export function ricalcoloStraordinari(turni: TurnoSalvato[], contratto: Map<string, number>, giorniForti: Set<string>): { cambi: { id: string; ore: number }[]; nonTorna: string[] } {
  const cambi: { id: string; ore: number }[] = [];
  const nonTorna: string[] = [];
  for (const [id, ore] of contratto) {
    const suoi = turni.filter((t) => t.employeeId === id);
    const fermi = new Set<Turno>(suoi.filter((t) => straordinarioFermo(t, giorniForti)));
    const giaDato = [...fermi].reduce((a, t) => a + (t as TurnoSalvato).oreStraordinario, 0);
    const nuovi = ripartisciStraordinari(suoi, new Map([[id, ore + giaDato]]), giorniForti, fermi);
    let scritto = giaDato;
    for (const t of suoi) {
      if (fermi.has(t) || !giorniForti.has(t.data)) continue;
      const nuovo = nuovi.get(t) ?? 0;
      scritto += nuovo;
      if (Math.abs(nuovo - t.oreStraordinario) > 1e-9 || (nuovo > 0 && t.motivo !== 'giorno_forte')) cambi.push({ id: t.id, ore: nuovo });
    }
    // con un turno in un mese chiuso: il conto torna se, potendo scrivere anche li', verrebbe uguale
    if (suoi.some((t) => t.bloccato)) {
      const liberi = suoi.map((t) => ({ ...t, bloccato: false }));
      const libero = ricalcoloStraordinari(liberi, new Map([[id, ore]]), giorniForti).cambi;
      const totale = liberi.reduce((a, t) => a + (libero.find((c) => c.id === t.id)?.ore ?? t.oreStraordinario), 0);
      if (Math.abs(totale - scritto) > 1e-9) nonTorna.push(id);
    }
  }
  return { cambi, nonTorna };
}

/** Come `ricalcoloStraordinari`, solo i turni da riscrivere. */
export function straordinariDaRiscrivere(turni: TurnoSalvato[], contratto: Map<string, number>, giorniForti: Set<string>): { id: string; ore: number }[] {
  return ricalcoloStraordinari(turni, contratto, giorniForti).cambi;
}
