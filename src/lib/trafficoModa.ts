// Il report MODA «Statistica Situazione Vendite con Conversion Rate»
// (raggruppamenti Negozio, Giorno, Ora), stampato in PDF da Crystal Reports.
// Da qui arrivano gli ingressi per ora di ogni negozio, la fonte del
// fabbisogno dei turni (outlet_traffic_hourly, ORGANICO_TURNI_NOTES.md).
//
// Funzioni pure, nessuna query. Test in trafficoModa.test.ts.
//
// Il PDF si legge per POSIZIONE, non per ordine dei numeri: un'ora con
// ingressi ma senza vendite ha solo «N.P.», un reso puo' avere vendite senza
// scontrini, e i numeri slittano. Ogni numero e' allineato a destra sotto la
// sua intestazione («N.» di N.P., «N.» di Scontr), quindi si assegna alla
// colonna con il bordo destro piu' vicino.

import type { PdfItem } from './pdfText';

export interface OraModa { ora: number; ingressi: number; scontrini: number }
export interface GiornoModa {
  data: string; // YYYY-MM-DD
  ore: OraModa[];
  /** la riga dei totali del giorno nel report (null se manca) */
  totale: { ingressi: number; scontrini: number } | null;
}
export interface NegozioModa { codice: string; descrizione: string; giorni: GiornoModa[] }
export interface ReportModa {
  /** data e ora di stampa del report (YYYY-MM-DD, HH:MM) */
  stampa: { data: string; ora: string } | null;
  dal: string | null;
  al: string | null;
  /** «Importi Vendite SENZA Iva» e «sono ESCLUSE Vendite libere, Buoni e Acconti»: le impostazioni di sempre */
  impostazioniStandard: boolean;
  negozi: NegozioModa[];
}

const RE_DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const RE_ORA = /^([01]\d|2[0-3])00$/;
const RE_CODICE = /^[A-Z][A-Z0-9]{1,9}$/;
const RE_NUMERO = /^-?[\d.]+(,\d+)?$/;

const iso = (d: string): string | null => {
  const m = RE_DATA.exec(d.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** «1.481,96» -> 1481.96; «12» -> 12 */
export function numeroIt(s: string): number {
  return Number(s.trim().replace(/\./g, '').replace(',', '.'));
}

type Riga = { y: number; items: PdfItem[] };

/** Le righe di una pagina: item con la stessa y (tolleranza 2 punti), da sinistra a destra, dall'alto in basso. */
export function righePagina(items: PdfItem[]): Riga[] {
  const righe: Riga[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    let r = righe.find((x) => Math.abs(x.y - it.y) <= 2);
    if (!r) { r = { y: it.y, items: [] }; righe.push(r); }
    r.items.push(it);
  }
  righe.sort((a, b) => b.y - a.y);
  for (const r of righe) r.items.sort((a, b) => a.x - b.x);
  return righe;
}

const destra = (i: PdfItem) => i.x + (i.w ?? 0);

/** Le colonne che servono, come bordo destro dell'intestazione: N.P. (ingressi) e Scontr (scontrini), piu' le vicine per non sbagliare. */
type Colonne = { np: number; scontr: number; altre: number[] };

function colonneDa(riga: Riga): Colonne | null {
  // La seconda riga d'intestazione: «Codice Descrizione % N. N. Vend Teorico Reale % ...»
  const enne = riga.items.filter((i) => i.str.trim() === 'N.');
  if (enne.length < 2) return null;
  const np = destra(enne[0]);
  const scontr = destra(enne[1]);
  const altre = riga.items.filter((i) => i.x > 200 && i.str.trim() !== 'N.').map(destra);
  return { np, scontr, altre };
}

/** Il numero sta nella colonna np, scontr o in un'altra (null). */
function colonnaDi(item: PdfItem, c: Colonne): 'np' | 'scontr' | null {
  const r = destra(item);
  const cand: { k: 'np' | 'scontr' | null; d: number }[] = [
    { k: 'np', d: Math.abs(r - c.np) },
    { k: 'scontr', d: Math.abs(r - c.scontr) },
    ...c.altre.map((x) => ({ k: null, d: Math.abs(r - x) })),
  ];
  cand.sort((a, b) => a.d - b.d);
  return cand[0].d <= 8 ? cand[0].k : null;
}

/** Legge le pagine del report. Lancia un errore se il PDF non e' un report «Conversion Rate» per negozio, giorno e ora. */
export function leggiReportModa(pagine: PdfItem[][]): ReportModa {
  const out: ReportModa = { stampa: null, dal: null, al: null, impostazioniStandard: false, negozi: [] };
  let senzaIva = false;
  let escluse = false;
  let intestazione = false;
  let colonne: Colonne | null = null;
  let negozio: NegozioModa | null = null;
  let giorno: GiornoModa | null = null;

  for (const items of pagine) {
    for (const riga of righePagina(items)) {
      const testi = riga.items.map((i) => i.str.trim());
      const testo = testi.join(' ');
      if (/Conversion Rate/i.test(testo)) intestazione = true;
      if (/Data Stampa/i.test(testo)) {
        const d = testi.map(iso).find(Boolean);
        const o = testi.find((t) => /^\d{1,2}[.:]\d{2}([.:]\d{2})?$/.test(t));
        if (d) out.stampa = { data: d, ora: o ? o.replace(/\./g, ':').slice(0, 5).padStart(5, '0') : '' };
        continue;
      }
      if (/Filtro\s+su\s+Data/i.test(testo)) {
        const date = [...testo.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((m) => iso(m[1]));
        out.dal = date[0] ?? null; out.al = date[1] ?? date[0] ?? null;
        continue;
      }
      if (/Vendite\s+SENZA\s+Iva/i.test(testo)) senzaIva = true;
      if (/ESCLUSE/i.test(testo) && /Vendite\s+libere/i.test(testo)) escluse = true;
      if (testi.includes('Codice') && testi.includes('N.')) { colonne = colonneDa(riga) ?? colonne; continue; }
      if (testi.includes('N.P.') || testi.includes('C.R.')) continue;

      const primo = riga.items[0];
      const p = primo.str.trim();

      // Negozio: «BARB   Barberino» (codice e descrizione, nessun numero)
      if (RE_CODICE.test(p) && riga.items.length >= 2 && !RE_NUMERO.test(testi[1]) && !iso(testi[1])) {
        negozio = { codice: p, descrizione: testi.slice(1).join(' '), giorni: [] };
        out.negozi.push(negozio);
        giorno = null;
        continue;
      }
      // Giorno: «01/10/2026   Giovedi»
      const d = iso(p);
      if (d) {
        if (!negozio) continue;
        giorno = { data: d, ore: [], totale: null };
        negozio.giorni.push(giorno);
        continue;
      }
      if (!colonne || !negozio) continue;
      const valori = (rs: PdfItem[]) => {
        let ingressi = 0; let scontrini = 0; let trovato = false;
        for (const it of rs) {
          if (!RE_NUMERO.test(it.str.trim())) continue;
          const k = colonnaDi(it, colonne!);
          if (k === 'np') { ingressi = numeroIt(it.str); trovato = true; }
          if (k === 'scontr') { scontrini = numeroIt(it.str); trovato = true; }
        }
        return { ingressi, scontrini, trovato };
      };
      // Ora: «1000» seguito dai numeri
      if (RE_ORA.test(p) && primo.x < 150) {
        if (!giorno) continue;
        const v = valori(riga.items.slice(1));
        giorno.ore.push({ ora: Number(p.slice(0, 2)), ingressi: v.ingressi, scontrini: v.scontrini });
        continue;
      }
      // Totale del giorno: solo numeri, dopo le ore. Il secondo totale di fila e' quello del negozio.
      if (RE_NUMERO.test(p) && primo.x > 200 && giorno && giorno.ore.length && !giorno.totale) {
        const v = valori(riga.items);
        if (v.trovato) giorno.totale = { ingressi: v.ingressi, scontrini: v.scontrini };
      }
    }
  }
  if (!intestazione || !out.negozi.some((n) => n.giorni.some((g) => g.ore.length))) {
    throw new Error('Non sembra un report MODA «Conversion Rate» per negozio, giorno e ora: non ci sono righe orarie da leggere.');
  }
  out.impostazioniStandard = senzaIva && escluse;
  return out;
}

/** I giorni in cui la somma delle ore non torna con il totale del giorno stampato nel report. */
export function totaliCheNonTornano(r: ReportModa): { codice: string; data: string; ore: number; totale: number }[] {
  const out: { codice: string; data: string; ore: number; totale: number }[] = [];
  for (const n of r.negozi) for (const g of n.giorni) {
    if (!g.totale) continue;
    const somma = g.ore.reduce((a, o) => a + o.ingressi, 0);
    if (somma !== g.totale.ingressi) out.push({ codice: n.codice, data: g.data, ore: somma, totale: g.totale.ingressi });
  }
  return out;
}

/**
 * Il giorno stampato a negozio aperto non e' finito: il 29/10 stampato alle
 * 16:01 ha solo le ore fino alle 16. Quel giorno non si carica (lo si
 * prendera' dal report successivo). Null se il report non lo contiene.
 */
export function giornoIncompleto(r: ReportModa): string | null {
  if (!r.stampa) return null;
  const d = r.stampa.data;
  return r.negozi.some((n) => n.giorni.some((g) => g.data === d)) ? d : null;
}

// ── Il negozio del gestionale per ogni negozio MODA ─────────────────────────

export interface NegozioAbbinabile { id: string; name: string; code: string | null }

const GENERICHE = new Set(['ZAGO', 'NEW', 'OUTLET', 'VILLAGE', 'NEGOZIO', 'PUNTO', 'VENDITA', 'DI', 'DEL', 'DELLA', 'TERRE', 'STORE', 'SHOP']);
const parole = (s: string) => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Z0-9]+/)
  .filter((w) => w.length >= 3 && !GENERICHE.has(w) && !/^\d+$/.test(w));

/**
 * Il negozio del gestionale che corrisponde a un negozio del report: stesso
 * codice, oppure una parola del nome in comune («Brugnato 5 Terre» ->
 * BRUGNATO, «Valdichiana - Foiano» -> VALDICHIANA). Null se nessuno o piu'
 * di uno: allora lo sceglie chi carica.
 */
export function abbinaNegozio(codice: string, descrizione: string, negozi: NegozioAbbinabile[]): NegozioAbbinabile | null {
  const perCodice = negozi.filter((n) => n.code && n.code.toUpperCase() === codice.toUpperCase());
  if (perCodice.length === 1) return perCodice[0];
  const delReport = new Set(parole(descrizione));
  const trovati = negozi.filter((n) => parole(n.name).some((w) => delReport.has(w)));
  return trovati.length === 1 ? trovati[0] : null;
}

// ── Confronto con quello che c'e' gia' ──────────────────────────────────────

export interface RigaTrafficoDb { outlet_id: string; data: string; ora: number; ingressi: number; scontrini: number }

export interface EsitoGiorno {
  outletId: string;
  data: string;
  /** nuovo = niente nel database; uguale = gia' identico; diverso = caricarlo cambia dei numeri */
  stato: 'nuovo' | 'uguale' | 'diverso';
  ingressiFile: number;
  ingressiDb: number;
  righe: RigaTrafficoDb[];
}

/** Giorno per giorno, cosa cambierebbe nel database caricando il report. */
export function confrontaGiorni(
  giorni: { outletId: string; giorno: GiornoModa }[],
  esistenti: RigaTrafficoDb[],
): EsitoGiorno[] {
  const perGiorno = new Map<string, RigaTrafficoDb[]>();
  for (const r of esistenti) {
    const k = `${r.outlet_id}|${r.data}`;
    if (!perGiorno.has(k)) perGiorno.set(k, []);
    perGiorno.get(k)!.push(r);
  }
  return giorni.map(({ outletId, giorno }) => {
    const db = perGiorno.get(`${outletId}|${giorno.data}`) ?? [];
    const righe = giorno.ore.map((o) => ({ outlet_id: outletId, data: giorno.data, ora: o.ora, ingressi: o.ingressi, scontrini: o.scontrini }));
    const ingressiFile = righe.reduce((a, r) => a + r.ingressi, 0);
    const ingressiDb = db.reduce((a, r) => a + r.ingressi, 0);
    let stato: EsitoGiorno['stato'] = 'nuovo';
    if (db.length) {
      const perOra = new Map(db.map((r) => [r.ora, r]));
      const cambia = righe.some((r) => {
        const x = perOra.get(r.ora);
        return !x || x.ingressi !== r.ingressi || x.scontrini !== r.scontrini;
      });
      stato = cambia ? 'diverso' : 'uguale';
    }
    return { outletId, data: giorno.data, stato, ingressiFile, ingressiDb, righe };
  });
}

const NOMI_MESE = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** «dal 01/10/2026 al 28/10/2026» */
export function periodoLeggibile(dal: string, al: string): string {
  const it = (d: string) => d.split('-').reverse().join('/');
  return dal === al ? `il ${it(dal)}` : `dal ${it(dal)} al ${it(al)}`;
}

/** «ottobre 2026» */
export function meseLeggibile(mese: string): string {
  return `${NOMI_MESE[Number(mese.slice(5, 7)) - 1]} ${mese.slice(0, 4)}`;
}

/** I giorni del mese che mancano, raccolti in intervalli: «25-30», «3, 7-9». */
export function giorniMancanti(mese: string, presenti: Set<string>, finoA: string): string {
  const [a, m] = mese.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mancanti: number[] = [];
  for (let g = 1; g <= ultimo; g++) {
    const d = `${mese}-${String(g).padStart(2, '0')}`;
    if (d > finoA) break;
    if (!presenti.has(d)) mancanti.push(g);
  }
  const pezzi: string[] = [];
  for (let i = 0; i < mancanti.length; i++) {
    let j = i;
    while (j + 1 < mancanti.length && mancanti[j + 1] === mancanti[j] + 1) j++;
    pezzi.push(i === j ? `${mancanti[i]}` : `${mancanti[i]}-${mancanti[j]}`);
    i = j;
  }
  return pezzi.join(', ');
}
