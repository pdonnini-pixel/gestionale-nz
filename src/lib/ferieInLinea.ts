// Ferie e permessi «in linea con il mese» (Patrizio, 14/11/2026).
//
// «la regola è far stare ferie e permessi in linea con il mese, cioè se devo consumare ferie e
//  permessi li consumo che tanto ogni mese vado a riaccumularli, ma quando arrivo lì poi posso
//  approvarli o cancellarli o spostarli e lui ricalcola tutto, sia i residui che le ore.»
//
// Quando l'HR crea il piano del mese il sistema propone da solo, persona per persona, ferie e
// permessi pari a quello che matura in quel mese: il residuo a fine mese non cresce. Nessun
// numero da impostare. Il maturato NON si calcola: è il rateo annuo del tabulato delle paghe
// diviso dodici (verificato sul tabulato di ottobre 2026: «da maturare» = rateo × mesi che
// restano / 12 su 75 righe su 81; le altre sei sono contratti che finiscono prima di dicembre).
// Chi non ha ancora una riga nel tabulato non riceve proposte: il gestionale non inventa ratei.
//
// Libreria pura: niente database, niente date di sistema. Le scritture stanno in ferieInLineaDb.ts.

import { giornoIso, lunediDi, giorniDellaSettimana, copertura, type GiornoPiano, type Turno } from './turni';

export type VoceFerie = 'F01' | 'F02' | 'F03';
export const VOCI_FERIE: VoceFerie[] = ['F01', 'F02', 'F03'];
export const NOME_VOCE: Record<VoceFerie, string> = { F01: 'ferie', F02: 'permessi ex festività', F03: 'permessi ROL' };

/** La riga del tabulato delle paghe di una persona per una voce (l'ultima letta). */
export interface RateoPersona {
  employeeId: string;
  voce: VoceFerie;
  /** ore che maturano in un anno; null = il tabulato non lo dice */
  rateoAnnuo: number | null;
  /** ore che la persona ha in tasca alla data del saldo */
  residuo: number | null;
  /** ultimo giorno del mese elaborato dallo studio (AAAA-MM-GG): il goduto fino a lì è già nel residuo */
  saldoAllaData: string | null;
}

/** Un giorno di ferie o permesso che esiste già: approvato, chiesto e in attesa, oppure proposto dal piano. */
export interface GiornoFerieEsistente {
  employeeId: string;
  data: string;
  voce: VoceFerie;
  ore: number;
  stato: 'approvato' | 'in_attesa' | 'proposta';
}

export interface PropostaFerie {
  employeeId: string;
  data: string;
  voce: VoceFerie;
  tipo: 'giornata' | 'ore';
  ore: number;
}

export type MotivoResto =
  | 'meno_di_mezzora'      // l'avanzo non arriva a mezz'ora, o in tutto a un'ora di permesso
  | 'nessun_giorno'        // nessun giorno ammesso in cui metterla
  | 'sotto_il_minimo'      // il negozio resterebbe sotto le persone minime
  | 'senza_saldo';         // il residuo non basta: non si propone quello che la persona non ha

export interface RestoFerie { employeeId: string; voce: VoceFerie; ore: number; motivo: MotivoResto }

export const TESTO_RESTO: Record<MotivoResto, string> = {
  meno_di_mezzora: 'meno di un\'ora: si recupera il mese dopo',
  nessun_giorno: 'nessun giorno adatto nel mese: giorni caldi, eventi o giorni già impegnati',
  sotto_il_minimo: 'il negozio resterebbe sotto le persone minime',
  senza_saldo: 'il residuo non basta',
};

const arr = (n: number) => Math.round(n * 100) / 100;
const mezzeOre = (n: number) => Math.floor(n * 2 + 1e-6) / 2;
const fineMese = (mese: string) => `${mese}-${String(new Date(Date.UTC(Number(mese.slice(0, 4)), Number(mese.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

/** Ore che maturano in un mese: il rateo annuo del tabulato diviso dodici. */
export const maturatoDelMese = (rateoAnnuo: number | null | undefined): number => (rateoAnnuo && rateoAnnuo > 0 ? rateoAnnuo / 12 : 0);

/** Mesi che maturano fra la data del saldo e la fine del mese del piano (0 se il saldo è già di quel mese o dopo). */
export function mesiDaMaturare(saldoAllaData: string | null, mese: string): number {
  if (!saldoAllaData) return 0;
  const n = (Number(mese.slice(0, 4)) - Number(saldoAllaData.slice(0, 4))) * 12 + (Number(mese.slice(5, 7)) - Number(saldoAllaData.slice(5, 7)));
  return Math.max(0, n);
}

export interface QuadroVoce {
  voce: VoceFerie;
  /** ore che maturano in questo mese (0 se la persona non matura il mese) */
  matura: number;
  /** ore del mese già approvate */
  approvate: number;
  /** ore del mese chieste e in attesa di decisione */
  inAttesa: number;
  /** ore del mese proposte dal piano e non ancora decise */
  proposte: number;
  /** quante ore il sistema deve ancora proporre per restare in linea con il mese */
  daProporre: number;
  /** residuo previsto a fine mese con tutto quello che c'è adesso (approvate, in attesa e proposte) */
  residuoFineMese: number;
  /** residuo previsto a fine mese senza le proposte */
  residuoSenzaProposte: number;
}

/**
 * Il quadro di una persona per il mese: quanto matura, quanto è già chiesto o approvato, quanto
 * resta da proporre e che residuo avrà a fine mese. `giorni` sono tutti i suoi giorni di ferie e
 * permesso (qualunque data): entrano solo quelli dopo la data del saldo, perché il goduto fino a
 * lì è già dentro il residuo del tabulato (stessa regola di v_leave_disponibilita).
 * `maturaIlMese` = la persona è in servizio abbastanza giorni da maturare il mese.
 */
export function quadroPersona(args: {
  ratei: RateoPersona[]; giorni: GiornoFerieEsistente[]; mese: string; maturaIlMese: boolean;
}): QuadroVoce[] {
  const fine = fineMese(args.mese);
  return args.ratei.map((r) => {
    const suoi = args.giorni.filter((g) => g.voce === r.voce && g.employeeId === r.employeeId);
    const delMese = suoi.filter((g) => g.data.startsWith(args.mese));
    const somma = (lista: GiornoFerieEsistente[], stato: GiornoFerieEsistente['stato']) => lista.filter((g) => g.stato === stato).reduce((a, g) => a + g.ore, 0);
    const matura = args.maturaIlMese ? maturatoDelMese(r.rateoAnnuo) : 0;
    // dal saldo alla fine del mese: i mesi prima di questo maturano per intero, questo solo se la persona lo matura
    const mesi = mesiDaMaturare(r.saldoAllaData, args.mese);
    const maturaFinoAFine = mesi > 0 ? maturatoDelMese(r.rateoAnnuo) * (mesi - 1) + matura : 0;
    const dopoSaldo = suoi.filter((g) => (!r.saldoAllaData || g.data > r.saldoAllaData) && g.data <= fine);
    const usate = dopoSaldo.filter((g) => g.stato !== 'proposta').reduce((a, g) => a + g.ore, 0);
    const proposteFino = dopoSaldo.filter((g) => g.stato === 'proposta').reduce((a, g) => a + g.ore, 0);
    const residuoSenzaProposte = (r.residuo ?? 0) + maturaFinoAFine - usate;
    const approvate = somma(delMese, 'approvato');
    const inAttesa = somma(delMese, 'in_attesa');
    const proposte = somma(delMese, 'proposta');
    // in linea con il mese: si propone quello che manca per arrivare al maturato, mai più di quello che la persona ha
    const daProporre = Math.max(0, Math.min(matura - approvate - inAttesa - proposte, residuoSenzaProposte - proposteFino));
    return {
      voce: r.voce, matura: arr(matura), approvate: arr(approvate), inAttesa: arr(inAttesa), proposte: arr(proposte),
      daProporre: arr(daProporre), residuoFineMese: arr(residuoSenzaProposte - proposteFino), residuoSenzaProposte: arr(residuoSenzaProposte),
    };
  });
}

/**
 * Le ore da proporre diventano giornate e permessi. Le ferie (F01) a giornate intere finché ce ne
 * sta una; l'avanzo delle ferie e i permessi (F02, F03) a ore, a mezz'ore. Quello che non arriva
 * a mezz'ora, o un permesso che in tutto non arriva a un'ora, non si propone e si dice.
 */
export function tagliaInGiorni(daProporre: Partial<Record<VoceFerie, number>>, oreGiornata: number): {
  giornate: number; permessi: { voce: VoceFerie; ore: number }[]; resti: { voce: VoceFerie; ore: number }[];
} {
  const f01 = daProporre.F01 ?? 0;
  const giornate = oreGiornata > 0 ? Math.floor((f01 + 1e-6) / oreGiornata) : 0;
  const permessi: { voce: VoceFerie; ore: number }[] = [];
  const resti: { voce: VoceFerie; ore: number }[] = [];
  const avanzi: [VoceFerie, number][] = [['F01', f01 - giornate * oreGiornata], ['F02', daProporre.F02 ?? 0], ['F03', daProporre.F03 ?? 0]];
  for (const [voce, ore] of avanzi) {
    const m = mezzeOre(ore);
    if (m >= 0.5) permessi.push({ voce, ore: m });
    if (ore - m > 0.01) resti.push({ voce, ore: arr(ore - m) });
  }
  // un permesso sotto l'ora non si propone: non vale un giorno accorciato
  if (permessi.reduce((a, x) => a + x.ore, 0) < 1) {
    for (const x of permessi) {
      const r = resti.find((y) => y.voce === x.voce);
      if (r) r.ore = arr(r.ore + x.ore); else resti.push({ voce: x.voce, ore: x.ore });
    }
    return { giornate, permessi: [], resti: resti.sort((a, b) => a.voce.localeCompare(b.voce)) };
  }
  return { giornate, permessi, resti };
}

export interface PersonaDaProporre {
  id: string;
  /** ore di una giornata di ferie proposta da noi (ore settimanali / 6 nei negozi) */
  oreGiornata: number;
  daProporre: Partial<Record<VoceFerie, number>>;
}

/**
 * Sceglie i giorni delle proposte. Le giornate di ferie vanno nei giorni con meno ingressi fra
 * quelli ammessi, una per settimana finché si può, mai due persone in ferie proposte lo stesso
 * giorno se c'è un'alternativa, e solo dove il negozio regge un'assenza in più (`postiLiberi`).
 * I permessi a ore vanno in un giorno in cui la persona lavora, il più tranquillo.
 */
export function scegliGiorni(args: {
  persone: PersonaDaProporre[];
  /** giorni in cui la persona può avere una giornata di ferie proposta */
  giorniPerGiornata: (id: string) => string[];
  /** giorni in cui la persona può avere un permesso a ore */
  giorniPerPermesso: (id: string) => string[];
  /** ingressi attesi del giorno: più basso = giorno più tranquillo */
  ingressi: (data: string) => number;
  /** quante assenze in più regge il negozio quel giorno, senza contare le proposte fatte qui */
  postiLiberi: (data: string) => number;
}): { proposte: PropostaFerie[]; resti: RestoFerie[] } {
  const proposte: PropostaFerie[] = [];
  const resti: RestoFerie[] = [];
  const assentiProposti = new Map<string, number>();
  const tagli = args.persone.map((p) => ({ p, ...tagliaInGiorni(p.daProporre, p.oreGiornata) }))
    // prima chi ha più giornate da mettere: sceglie i giorni migliori chi ne ha più bisogno
    .sort((a, b) => b.giornate - a.giornate || a.p.id.localeCompare(b.p.id));
  for (const { p, giornate, permessi, resti: avanzi } of tagli) {
    for (const r of avanzi) resti.push({ employeeId: p.id, voce: r.voce, ore: r.ore, motivo: 'meno_di_mezzora' });
    const settimaneUsate = new Set<string>();
    const presi = new Set<string>();
    for (let k = 0; k < giornate; k++) {
      const candidati = args.giorniPerGiornata(p.id).filter((d) => !presi.has(d));
      const conPosto = candidati.filter((d) => args.postiLiberi(d) - (assentiProposti.get(d) ?? 0) >= 1);
      if (!conPosto.length) {
        resti.push({ employeeId: p.id, voce: 'F01', ore: arr(p.oreGiornata * (giornate - k)), motivo: candidati.length ? 'sotto_il_minimo' : 'nessun_giorno' });
        break;
      }
      const punti = (d: string) => args.ingressi(d)
        // una settimana già usata da questa persona o un giorno già scelto per una collega si evitano, se c'è altro
        + (settimaneUsate.has(lunediDi(d)) ? 1e6 : 0) + (assentiProposti.get(d) ?? 0) * 1e5;
      const scelto = [...conPosto].sort((a, b) => punti(a) - punti(b) || a.localeCompare(b))[0];
      presi.add(scelto);
      settimaneUsate.add(lunediDi(scelto));
      assentiProposti.set(scelto, (assentiProposti.get(scelto) ?? 0) + 1);
      proposte.push({ employeeId: p.id, data: scelto, voce: 'F01', tipo: 'giornata', ore: arr(p.oreGiornata) });
    }
    if (permessi.length) {
      const candidati = args.giorniPerPermesso(p.id).filter((d) => !presi.has(d));
      if (!candidati.length) {
        for (const x of permessi) resti.push({ employeeId: p.id, voce: x.voce, ore: x.ore, motivo: 'nessun_giorno' });
      } else {
        // meglio una settimana senza una sua giornata di ferie, poi il giorno più tranquillo
        const punti = (d: string) => args.ingressi(d) + (settimaneUsate.has(lunediDi(d)) ? 1e6 : 0);
        const scelto = [...candidati].sort((a, b) => punti(a) - punti(b) || a.localeCompare(b))[0];
        for (const x of permessi) proposte.push({ employeeId: p.id, data: scelto, voce: x.voce, tipo: 'ore', ore: x.ore });
      }
    }
  }
  return { proposte: proposte.sort((a, b) => a.data.localeCompare(b.data) || a.employeeId.localeCompare(b.employeeId) || a.voce.localeCompare(b.voce)), resti };
}

/** Come sta un piano rispetto alle regole che una proposta di ferie non deve rompere. */
export interface MisuraPiano {
  /** ore sotto le persone minime delle fasce, per settimana (lunedì → ore) */
  sottoMinimo: Map<string, number>;
  /** giorni aperti con una persona sola, per settimana */
  unaSola: Map<string, number>;
  /** ore di apertura senza nessuno, per settimana */
  vuote: Map<string, number>;
  /** persone senza il giorno di riposo di legge, per settimana */
  senzaRiposo: Map<string, number>;
}

/** Misura i turni di un mese: persone minime delle fasce, giorni con una persona sola, ore vuote. */
export function misuraPiano(giorni: GiornoPiano[], turni: Turno[], mese: string, senzaRiposo: { lunedi: string }[] = []): MisuraPiano {
  const out: MisuraPiano = { sottoMinimo: new Map(), unaSola: new Map(), vuote: new Map(), senzaRiposo: new Map() };
  const piu = (m: Map<string, number>, k: string, n: number) => { if (n) m.set(k, (m.get(k) ?? 0) + n); };
  for (const g of giorni) {
    if (g.chiuso || !g.data.startsWith(mese)) continue;
    const lun = lunediDi(g.data);
    const cop = copertura(g, turni);
    let sotto = 0; let vuote = 0;
    cop.forEach((c, i) => {
      const minimo = g.minimo?.[i] ?? 1;
      if (c < minimo) sotto += (minimo - c) / 2;
      if (c < 1) vuote += 0.5;
    });
    piu(out.sottoMinimo, lun, sotto);
    piu(out.vuote, lun, vuote);
    if (new Set(turni.filter((t) => t.data === g.data).map((t) => t.employeeId)).size === 1) piu(out.unaSola, lun, 1);
  }
  for (const x of senzaRiposo) piu(out.senzaRiposo, x.lunedi, 1);
  return out;
}

/** Le settimane in cui `dopo` è peggio di `prima` per una delle regole che le ferie proposte non devono rompere. */
export function settimanePeggiorate(prima: MisuraPiano, dopo: MisuraPiano): string[] {
  const out = new Set<string>();
  const confronta = (a: Map<string, number>, b: Map<string, number>, soglia: number) => {
    for (const [k, v] of b) if (v > (a.get(k) ?? 0) + soglia) out.add(k);
  };
  confronta(prima.sottoMinimo, dopo.sottoMinimo, 0.25);
  confronta(prima.unaSola, dopo.unaSola, 0);
  confronta(prima.vuote, dopo.vuote, 0);
  confronta(prima.senzaRiposo, dopo.senzaRiposo, 0);
  return [...out].sort();
}

/**
 * Toglie le proposte che il negozio non regge. `misura` rifà il piano con le proposte date e lo
 * misura: finché una settimana è peggio che senza proposte si toglie da quella settimana la
 * proposta più pesante (prima le giornate, poi i permessi) e si rimisura. Al massimo `giri` volte:
 * se una settimana resta peggio, le sue proposte si tolgono tutte.
 */
export function rifinisciProposte(args: {
  proposte: PropostaFerie[]; misura: (proposte: PropostaFerie[]) => MisuraPiano; giri?: number;
  /** la misura senza proposte, se è già stata fatta */
  prima?: MisuraPiano;
}): { proposte: PropostaFerie[]; tolte: PropostaFerie[]; prima: MisuraPiano; dopo: MisuraPiano } {
  const prima = args.prima ?? args.misura([]);
  let tenute = [...args.proposte];
  const tolte: PropostaFerie[] = [];
  if (!tenute.length) return { proposte: [], tolte, prima, dopo: prima };
  let dopo = args.misura(tenute);
  const giri = args.giri ?? 6;
  for (let i = 0; i <= giri; i++) {
    const peggio = settimanePeggiorate(prima, dopo);
    if (!peggio.length) break;
    for (const lun of peggio) {
      const giorniSett = giorniDellaSettimana(lun);
      const sue = tenute.filter((p) => giorniSett.includes(p.data)).sort((a, b) => b.ore - a.ore || b.data.localeCompare(a.data));
      // all'ultimo giro la settimana si libera del tutto
      const via = i === giri ? sue : sue.slice(0, 1);
      // una giornata porta con sé le altre voci della stessa persona nello stesso giorno
      const chiavi = new Set(via.map((p) => `${p.employeeId}|${p.data}`));
      for (const p of tenute.filter((x) => chiavi.has(`${x.employeeId}|${x.data}`))) tolte.push(p);
      tenute = tenute.filter((x) => !chiavi.has(`${x.employeeId}|${x.data}`));
    }
    dopo = tenute.length ? args.misura(tenute) : prima;
  }
  return { proposte: tenute, tolte, prima, dopo };
}

/** La persona matura il mese se è in servizio per almeno 15 giorni di calendario (regola dello studio, da confermare). */
export const maturaIlMese = (giorniInServizio: number): boolean => giorniInServizio >= 15;

/** Giorni feriali (lunedì-venerdì) di una lista di date. */
export const soloFeriali = (date: string[]): string[] => date.filter((d) => giornoIso(d) <= 5);

/** Le ore di una persona in parole: «2 giornate di ferie (10 h) e 2,5 h di permesso». */
export function proposteInParole(proposte: PropostaFerie[], fmt: (n: number) => string): string {
  const giornate = proposte.filter((p) => p.tipo === 'giornata');
  const ore = proposte.filter((p) => p.tipo === 'ore').reduce((a, p) => a + p.ore, 0);
  const pezzi: string[] = [];
  if (giornate.length) pezzi.push(`${giornate.length === 1 ? 'una giornata' : `${giornate.length} giornate`} di ferie (${fmt(giornate.reduce((a, p) => a + p.ore, 0))} h)`);
  if (ore > 0) pezzi.push(`${fmt(ore)} h di permesso`);
  return pezzi.join(' e ');
}

/**
 * Cosa dire dopo aver tolto o spostato una proposta. La proposta e i turni sono due scritture
 * distinte: il messaggio dice sempre com'è finita la seconda, così non si legge «turni
 * ricalcolati» quando non lo sono (mese chiuso, errore a metà).
 */
export function messaggioDopoModifica(cosa: 'tolta' | 'spostata', esito: 'fatto' | 'non_fatto' | 'errore', dettaglio?: string): string {
  if (esito === 'fatto') {
    return cosa === 'tolta'
      ? 'Proposta tolta: i turni della settimana sono ricalcolati e le ore tornano da lavorare.'
      : 'Proposta spostata: i turni delle settimane toccate sono ricalcolati.';
  }
  if (esito === 'non_fatto') return `Proposta ${cosa}. I turni non sono stati rifatti: restano quelli di prima.`;
  return `Proposta ${cosa}, ma i turni non sono stati rifatti${dettaglio ? ` (${dettaglio})` : ''}: premi «Ricalcola il mese».`;
}
