// Il report MODA «Statistica Situazione Vendite con Conversion Rate»
// per giorno e ora, stampato in PDF da Crystal Reports, in due forme:
//   * tutti i negozi insieme (raggruppamenti Negozio, Giorno, Ora): il
//     negozio e' una riga «BARB   Barberino» dentro il report;
//   * un PDF per negozio (raggruppamenti Giorno, Ora): il negozio sta solo
//     nell'intestazione, «Filtro su Negozio : BARB - Barberino».
// Il report per giorno (Negozio, Mese, Giorno) non ha le ore: si rifiuta.
// Da qui arrivano gli ingressi per ora (fabbisogno dei turni,
// ORGANICO_TURNI_NOTES.md) e, dalla 464, pezzi, valore teorico, valore reale
// e costo d'acquisto (sezione «Vendite e ingressi»). Gli importi del report
// sono tutti IMPONIBILI (senza IVA).
//
// Funzioni pure, nessuna query. Test in trafficoModa.test.ts.
//
// Il PDF si legge per POSIZIONE, non per ordine dei numeri: un'ora con
// ingressi ma senza vendite ha solo «N.P.», un reso puo' avere vendite senza
// scontrini, e i numeri slittano. Ogni numero e' allineato a destra sotto la
// sua intestazione («N.» di N.P., «N.» di Scontr), quindi si assegna alla
// colonna con il bordo destro piu' vicino.

import type { PdfItem } from './pdfText';

/** Gli importi di un'ora: tutti imponibili. Ci sono solo se il report ha le colonne (sempre, nei report veri). */
export interface ImportiOra {
  /** Qta Vend */
  pezzi: number;
  /** Valore Vendite Teorico: a prezzo di listino */
  teorico: number;
  /** Valore Vendite Reale: incassato */
  reale: number;
  /** V.Acq: costo d'acquisto della merce venduta (costo medio) */
  costo: number;
}
export interface OraModa { ora: number; ingressi: number; scontrini: number; importi?: ImportiOra }
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
  /** il report ha le colonne di pezzi, valori e costo d'acquisto */
  importi: boolean;
  /** «Negozio, Giorno, Ora» oppure «Giorno, Ora» (un negozio solo) */
  raggruppamento: string | null;
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

/**
 * Le colonne che servono, come bordo destro dell'intestazione, piu' le vicine
 * per non sbagliare. Nel PDF vero (bordi destri): N.P. 348, Scontr 384,
 * Qta 420, Teorico 468, Reale 522, Scon 552, Prz.Medi 594, UPT 624, V.Acq 678,
 * Ricarichi 708 e 738, Resa 798. Prz.Medi e UPT hanno l'etichetta solo nella
 * prima riga d'intestazione: senza, il valore di UPT finirebbe nel costo.
 */
type Chiave = 'np' | 'scontr' | 'qta' | 'teorico' | 'reale' | 'costo';
type Colonne = { pos: Partial<Record<Chiave, number>>; altre: number[] };

function colonneDa(riga: Riga, primaRiga: number[]): Colonne | null {
  // La seconda riga d'intestazione: «Codice Descrizione % N. N. Vend Teorico Reale % Importo Teo Rea Importo»
  const enne = riga.items.filter((i) => i.str.trim() === 'N.');
  if (enne.length < 2) return null;
  const pos: Colonne['pos'] = { np: destra(enne[0]), scontr: destra(enne[1]) };
  const usati = new Set<PdfItem>(enne.slice(0, 2));
  const prendi = (etichetta: string, k: Chiave) => {
    const it = riga.items.find((i) => i.str.trim() === etichetta && !usati.has(i));
    if (it) { pos[k] = destra(it); usati.add(it); }
  };
  prendi('Vend', 'qta'); prendi('Teorico', 'teorico'); prendi('Reale', 'reale'); prendi('Importo', 'costo');
  const altre = [...riga.items.filter((i) => i.x > 200 && !usati.has(i)).map(destra), ...primaRiga];
  return { pos, altre };
}

/** Il numero sta in una delle colonne che servono, o in un'altra (null). */
function colonnaDi(item: PdfItem, c: Colonne): Chiave | null {
  const r = destra(item);
  const cand: { k: Chiave | null; d: number }[] = [
    ...(Object.entries(c.pos) as [Chiave, number][]).map(([k, x]) => ({ k, d: Math.abs(r - x) })),
    ...c.altre.map((x) => ({ k: null, d: Math.abs(r - x) })),
  ];
  cand.sort((a, b) => a.d - b.d);
  return cand.length && cand[0].d <= 8 ? cand[0].k : null;
}

const conImporti = (c: Colonne | null) => !!c && ['qta', 'teorico', 'reale', 'costo'].every((k) => c.pos[k as Chiave] != null);

const RE_NEGOZIO_FILTRO = /Filtro\s+su\s+Negozio\s*:\s*([A-Z][A-Z0-9]{1,9})\s*-\s*(.+)$/;

/** Legge le pagine del report. Lancia un errore se il PDF non e' un report «Conversion Rate» per negozio, giorno e ora. */
export function leggiReportModa(pagine: PdfItem[][]): ReportModa {
  const out: ReportModa = { stampa: null, dal: null, al: null, impostazioniStandard: false, importi: false, raggruppamento: null, negozi: [] };
  /** il negozio dell'intestazione, nei PDF di un negozio solo */
  let negozioFiltro: { codice: string; descrizione: string } | null = null;
  /** bordi destri delle etichette della prima riga d'intestazione che non hanno la seconda riga (Prz.Medi, UPT) */
  let primaRiga: number[] = [];
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
      if (/Raggruppament/i.test(testo)) {
        out.raggruppamento = testo.replace(/^.*Raggruppamenti?\s*:\s*/i, '').replace(/\s*,\s*/g, ', ').trim();
        if (!/\bOra\b/i.test(out.raggruppamento)) {
          throw new Error(`È il report per giorno (raggruppamento «${out.raggruppamento}»): serve quello per giorno e ora. In MODA scegli i raggruppamenti Negozio, Giorno, Ora (oppure Giorno, Ora per un negozio solo).`);
        }
        continue;
      }
      const f = RE_NEGOZIO_FILTRO.exec(testo);
      if (f) { negozioFiltro = { codice: f[1], descrizione: f[2].trim() }; continue; }
      if (/Filtro\s+su\s+Data/i.test(testo)) {
        const date = [...testo.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((m) => iso(m[1]));
        out.dal = date[0] ?? null; out.al = date[1] ?? date[0] ?? null;
        continue;
      }
      if (/Vendite\s+SENZA\s+Iva/i.test(testo)) senzaIva = true;
      if (/ESCLUSE/i.test(testo) && /Vendite\s+libere/i.test(testo)) escluse = true;
      if (testi.includes('Codice') && testi.includes('N.')) { colonne = colonneDa(riga, primaRiga) ?? colonne; continue; }
      if (testi.includes('N.P.') || testi.includes('C.R.')) {
        primaRiga = riga.items.filter((i) => ['Prz.Medi', 'UPT'].includes(i.str.trim())).map(destra);
        continue;
      }

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
        if (!negozio && negozioFiltro) {
          negozio = { ...negozioFiltro, giorni: [] };
          out.negozi.push(negozio);
        }
        if (!negozio) continue;
        giorno = { data: d, ore: [], totale: null };
        negozio.giorni.push(giorno);
        continue;
      }
      if (!colonne || !negozio) continue;
      const valori = (rs: PdfItem[]) => {
        const v: Record<Chiave, number> = { np: 0, scontr: 0, qta: 0, teorico: 0, reale: 0, costo: 0 };
        let trovato = false;
        for (const it of rs) {
          if (!RE_NUMERO.test(it.str.trim())) continue;
          const k = colonnaDi(it, colonne!);
          if (k) { v[k] = numeroIt(it.str); if (k === 'np' || k === 'scontr') trovato = true; }
        }
        // Un'ora con ingressi e senza vendite ha solo N.P.: gli importi sono zero.
        const importi: ImportiOra | undefined = conImporti(colonne)
          ? { pezzi: v.qta, teorico: v.teorico, reale: v.reale, costo: v.costo }
          : undefined;
        return { ingressi: v.np, scontrini: v.scontr, importi, trovato };
      };
      // Ora: «1000» seguito dai numeri
      if (RE_ORA.test(p) && primo.x < 150) {
        if (!giorno) continue;
        const v = valori(riga.items.slice(1));
        giorno.ore.push({ ora: Number(p.slice(0, 2)), ingressi: v.ingressi, scontrini: v.scontrini, ...(v.importi ? { importi: v.importi } : {}) });
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
  out.importi = conImporti(colonne);
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

export interface RigaTrafficoDb {
  outlet_id: string; data: string; ora: number; ingressi: number; scontrini: number;
  /** importi imponibili: null nel database = non ancora caricati; assenti nel file = il report non li ha */
  pezzi?: number | null; valore_teorico?: number | null; vendite?: number | null; costo_acquisto?: number | null;
}

export interface EsitoGiorno {
  outletId: string;
  data: string;
  /**
   * nuovo = niente nel database; uguale = gia' identico;
   * completa = ingressi e scontrini uguali, il database non aveva gli importi e il file li aggiunge (si salva da solo);
   * diverso = caricarlo cambia numeri gia' presenti (si chiede conferma)
   */
  stato: 'nuovo' | 'uguale' | 'completa' | 'diverso';
  ingressiFile: number;
  ingressiDb: number;
  righe: RigaTrafficoDb[];
  /** ore del database che nel file non ci sono: salvando il giorno si tolgono, cosi' il giorno e' esattamente quello del file */
  oreDaTogliere: number[];
}

const centesimi = (n: number | null | undefined) => Math.round(Number(n ?? 0) * 100);

/** Le righe da scrivere per un giorno del report. */
export function righeDelGiorno(outletId: string, giorno: GiornoModa): RigaTrafficoDb[] {
  return giorno.ore.map((o) => ({
    outlet_id: outletId, data: giorno.data, ora: o.ora, ingressi: o.ingressi, scontrini: o.scontrini,
    ...(o.importi ? { pezzi: o.importi.pezzi, valore_teorico: o.importi.teorico, vendite: o.importi.reale, costo_acquisto: o.importi.costo } : {}),
  }));
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
    const righe = righeDelGiorno(outletId, giorno);
    const ingressiFile = righe.reduce((a, r) => a + r.ingressi, 0);
    const ingressiDb = db.reduce((a, r) => a + r.ingressi, 0);
    const oreFile = new Set(righe.map((r) => r.ora));
    const oreDaTogliere = db.filter((r) => !oreFile.has(r.ora)).map((r) => r.ora).sort((a, b) => a - b);
    let stato: EsitoGiorno['stato'] = 'nuovo';
    if (db.length) {
      const perOra = new Map(db.map((r) => [r.ora, r]));
      let cambia = oreDaTogliere.length > 0;
      let aggiunge = false;
      for (const r of righe) {
        const x = perOra.get(r.ora);
        if (!x || x.ingressi !== r.ingressi || x.scontrini !== r.scontrini) { cambia = true; break; }
        if (r.valore_teorico == null) continue; // il file non ha gli importi: quelli nel database restano
        if (x.valore_teorico == null) { aggiunge = true; continue; }
        if (Number(x.pezzi ?? 0) !== Number(r.pezzi ?? 0) || centesimi(x.valore_teorico) !== centesimi(r.valore_teorico)
          || centesimi(x.vendite) !== centesimi(r.vendite) || centesimi(x.costo_acquisto) !== centesimi(r.costo_acquisto)) { cambia = true; break; }
      }
      stato = cambia ? 'diverso' : aggiunge ? 'completa' : 'uguale';
    }
    return { outletId, data: giorno.data, stato, ingressiFile, ingressiDb, righe, oreDaTogliere };
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
