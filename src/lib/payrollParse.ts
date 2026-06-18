// Parser puri per gli import del personale (testabili senza React/DOM).
// La ricostruzione testo dei PDF è in pdfText.ts; qui si lavora su righe già pronte.

export interface PreviewRow {
  matricola: string; cognome: string; nome: string; outlet: string;
  netto: number | null; retribuzione: number | null; contributi: number | null; inail: number | null; tfr: number | null; altri: number | null;
  isNew: boolean; matchedId: string | null;
  warn?: boolean; // filiale che non quadra (somma netti ≠ totale di ripartizione)
}
export type ParsedImport = { rows: PreviewRow[]; fileTotal: number | null };
export type ParserOutlet = { name: string; cost_center_key: string | null; mall_name?: string | null; city?: string | null };

// Parsing numero italiano: "1.234,56" → 1234.56 ; gestisce anche "1234.56".
export function parseItNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[€\s]/g, '');
  if (!s || s === '-') return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (hasComma) s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Mapping filiale→outlet a RUNTIME (niente tabella hardcoded): confronta il testo
// della filiale con outlets.name (normalizzato), fallback su cost_center_key.
export function matchOutletName(text: string, outlets: ParserOutlet[]): string {
  const t = norm(text);
  if (!t) return '';
  const contains = (a: string, b: string) => a !== '' && b !== '' && (a === b || a.includes(b) || b.includes(a));
  // 1) nome / mall_name / city (campi runtime dell'outlet — alias data-driven, no hardcoded)
  for (const o of outlets) {
    const cands = [o.name, o.mall_name, o.city].map(norm).filter(Boolean);
    if (cands.some((c) => contains(t, c))) return o.name;
  }
  // 2) cost_center_key (es. "valdichiana")
  for (const o of outlets) {
    const k = norm((o.cost_center_key || '').replace(/_/g, ' '));
    if (contains(t, k)) return o.name;
  }
  // 3) prima parola significativa (es. "VALDICHIANA VILLAGE" → "valdichiana")
  const firstWord = t.split(' ')[0];
  for (const o of outlets) {
    if (firstWord && [o.name, o.mall_name, o.city].some((c) => norm(c).startsWith(firstWord))) return o.name;
  }
  return '';
}

export const FIELD_SYNS: Record<string, string[]> = {
  matricola: ['matricola', 'cod dip', 'cod. dip', 'coddip', 'cod.dip', 'cod dipendente', 'codice', 'id dip', 'cod'],
  cognome: ['cognome', 'surname'],
  nome: ['nome', 'name'],
  nominativo: ['nominativo', 'dipendente', 'cognome e nome', 'cognome nome', 'cognome/nome'],
  outlet: ['filiale', 'outlet', 'punto vendita', 'sede', 'negozio', 'store', 'ramo', 'punto'],
  netto: ['netto', 'netto in busta', 'netto a pagare', 'netto busta', 'netto mese', 'netto del mese'],
  retribuzione: ['lordo', 'retribuzione', 'stipendio', 'competenze', 'totale competenze', 'imponibile'],
  contributi: ['contributi', 'inps', 'oneri sociali', 'contributi inps'],
  inail: ['inail'],
  tfr: ['tfr', 'quota tfr', 'acc tfr', 'accantonamento tfr', 'acc.to tfr'],
  altri: ['altri', 'altri costi', 'altro', 'altre voci'],
};

// La riga filiale può avere testo prima (es. "Progressivo ripartizione n.2: Filiale: 0000000001 - VALDICHIANA VILLAGE ;")
// quindi NON ancorare a inizio riga; il nome termina al ';' (o a fine riga).
const RE_FILIALE = /filiale[:\s]*\d+\s*[-–]\s*([^;]+?)\s*(?:;|$)/i;
const RE_TOT_AZIENDALE = /totale aziendale\s+(-?[\d.]+,\d{2})/i;
const RE_IMPORTO_IT = /\d{1,3}(?:\.\d{3})*,\d{2}/;
export const blankRow = (): PreviewRow => ({ matricola: '', cognome: '', nome: '', outlet: '', netto: null, retribuzione: null, contributi: null, inail: null, tfr: null, altri: null, isNew: false, matchedId: null });

export const LORDI_FIELDS: { key: 'retribuzione' | 'contributi' | 'inail' | 'tfr' | 'altri'; col: string }[] = [
  { key: 'retribuzione', col: 'retribuzione' }, { key: 'contributi', col: 'contributi' },
  { key: 'inail', col: 'inail' }, { key: 'tfr', col: 'tfr' }, { key: 'altri', col: 'altri_costi' },
];
export const rowLordo = (r: PreviewRow) => LORDI_FIELDS.reduce((s, f) => s + Number((r as any)[f.key] || 0), 0);
export const rowHasLordo = (r: PreviewRow) => LORDI_FIELDS.some((f) => (r as any)[f.key] != null);

// Collassa i caratteri raddoppiati del grassetto PDF ("NNrr" → "Nr"). Solo per keyword.
const deDouble = (s: string) => s.replace(/(.)\1/g, '$1');
const RE_MATRICOLA = /\b\d{7}\b/g;
const RE_MONEY_G = /\d{1,3}(?:\.\d{3})*,\d{2}/g;
// "Totale aziendale" tollerante ai caratteri raddoppiati del grassetto
// ("TToottaallee aazziieennddaallee"): ogni lettera 1-2 volte.
const RE_TOT_AZIENDALE_LOOSE = /t{1,2}o{1,2}t{1,2}a{1,2}l{1,2}e{1,2}\s+a{1,2}z{1,2}i{1,2}e{1,2}n{1,2}d{1,2}a{1,2}l{1,2}e{1,2}/i;
const NAME_LABELS = /^(filiale|cod|dip|cognome|nome|importo|importi|totale|totali|di|del|della|ripartizione|aziendale|nr|n|dipendenti|dipendente|progressivo|coordinate|bancarie|iban|villaggio|village|outlet|udine|mensilita|normale|elenco|netti|netto|pag|pagina|data|periodo|azienda|ditta)$/i;

// Estrazione nomi best-effort: la colonna "Cognome e nome" è un blocco unico non
// splittabile in modo affidabile. Se il numero di parole-nome è esattamente 2×N le
// abbino a coppie (cognome, nome); altrimenti ritorno null (nome provvisorio = matricola).
function extractNames(page: string, filialeMatch: string | null, n: number): { cognome: string; nome: string }[] | null {
  let t = page;
  if (filialeMatch) t = t.replace(filialeMatch, ' ');
  t = t
    .replace(/\bIT[0-9A-Z]{10,}\b/gi, ' ') // IBAN
    .replace(RE_MONEY_G, ' ')              // importi
    .replace(/\d+/g, ' ');                 // qualsiasi cifra (matricole, nr, ecc.)
  const words = t.split(/\s+/)
    .map((w) => w.replace(/[.,;:()]/g, ''))
    .filter((w) => /^[A-Za-zÀ-ÿ'’]{2,}$/.test(w) && !NAME_LABELS.test(w));
  if (words.length !== 2 * n || n === 0) return null;
  const out: { cognome: string; nome: string }[] = [];
  for (let i = 0; i < n; i++) out.push({ cognome: words[2 * i], nome: words[2 * i + 1] });
  return out;
}

export type PdfItem = { str: string; x: number; y: number; w?: number };
const RE_MAT_ONE = /^\d{7}$/;
// L'item importo può avere l'IBAN concatenato ("1.417,00 IT53…"): riconosci un importo
// in TESTA all'item (non full-string) ed estrai solo quello.
const RE_MONEY_LEAD = /^(\d{1,3}(?:\.\d{3})*,\d{2})(?![\d.,])/;
const moneyLead = (s: string): number | null => { const m = s.trim().match(RE_MONEY_LEAD); return m ? parseItNum(m[1]) : null; };
const isMoneyItem = (s: string) => RE_MONEY_LEAD.test(s.trim());
const ROW_LABEL = /^(totale|totali|nr|n|di|del|della|ripartizione|aziendale|importo|importi|cod\.?|dip\.?|cognome|nome|filiale|e|progressivo)$/i;

// PDF "Elenco netti" — il documento è RUOTATO: le RIGHE sono sull'asse X (transform[4]),
// le colonne sull'asse Y. Per ogni pagina (= una filiale) raggruppo gli item per X (toll. ~3):
// ogni gruppo è una persona con matricola + NOME (un solo item, anche multi-parola) + netto.
export function parseInfinityNettiItems(pages: PdfItem[][], outlets: ParserOutlet[]): ParsedImport {
  const rows: PreviewRow[] = [];
  const TOL = 3;
  for (const items of pages) {
    const fullText = items.map((i) => i.str).join(' ');
    const mf = fullText.match(/Filiale:\s*\d+\s*-\s*(.+?)\s*;/i);
    const outlet = mf ? matchOutletName(mf[1], outlets) : '';

    // raggruppa per X (riga)
    const groups: { x: number; items: PdfItem[] }[] = [];
    for (const it of items) {
      let g = groups.find((gr) => Math.abs(gr.x - it.x) <= TOL);
      if (!g) { g = { x: it.x, items: [] }; groups.push(g); }
      g.items.push(it);
    }

    const pageRows: PreviewRow[] = [];
    for (const g of groups) {
      const sorted = g.items.slice().sort((a, b) => a.y - b.y);
      const matTok = sorted.find((i) => RE_MAT_ONE.test(i.str.trim()));
      const moneyItems = sorted.filter((i) => isMoneyItem(i.str)); // importo in testa (IBAN concatenato ok)
      if (!matTok || !moneyItems.length) continue; // intestazioni / totali → scartate
      const nettoItem = moneyItems[0]; // il netto è la colonna importo (Y più bassa dei money)
      // Il NOME è solo la colonna nome: token con Y < Y(netto). Esclude IBAN/banca/beneficiario
      // (Y maggiore, colonne coordinate bancarie compilate solo per alcuni dipendenti).
      const nameParts = sorted
        .filter((i) => i.y < nettoItem.y)
        .map((i) => i.str.trim())
        .filter((t) => !RE_MAT_ONE.test(t) && !isMoneyItem(t) && !ROW_LABEL.test(t));
      const fullName = nameParts.join(' ').replace(/\s+/g, ' ').trim();
      const parts = fullName.split(' ');
      const r = blankRow();
      r.matricola = matTok.str.trim();
      r.cognome = parts[0] || '';
      r.nome = parts.slice(1).join(' ');
      r.outlet = outlet;
      r.netto = moneyLead(nettoItem.str); // solo l'importo in testa (eventuale IBAN concatenato escluso)
      pageRows.push(r);
    }

    // Validazione di filiale: somma netti == Totale di ripartizione. Il totale di ripartizione
    // si legge dal GRUPPO (riga) che contiene la dicitura, prendendone il money item ORIGINALE
    // (deDouble solo per riconoscere la label, mai per estrarre cifre → niente "33"→"3").
    let totRip: number | null = null;
    let nrDip: number | null = null;
    for (const g of groups) {
      const gtxt = deDouble(g.items.map((i) => i.str).join(' '));
      if (/totale\s+aziendale/i.test(gtxt)) continue; // ignora il totale documento
      if (/totale\s+di\s+ripartizione/i.test(gtxt)) {
        const money = g.items.map((i) => i.str.trim()).find((t) => isMoneyItem(t));
        if (money) totRip = moneyLead(money);
        const nm = gtxt.match(/nr\s+dipendenti[^\d]{0,10}(\d+)/i);
        if (nm) nrDip = parseInt(nm[1], 10);
      }
    }
    const sum = pageRows.reduce<number>((s, r) => s + (r.netto || 0), 0);
    const quadra = (totRip == null || Math.abs(sum - totRip) < 0.01) && (nrDip == null || nrDip === pageRows.length);
    if (!quadra) pageRows.forEach((r) => { r.warn = true; });
    rows.push(...pageRows);
  }
  const fileTotal = rows.reduce<number>((s, r) => s + (r.netto || 0), 0);
  return { rows, fileTotal: rows.length ? fileTotal : null };
}

// PDF "Elenco netti" — abbinamento per COLONNA (ordine di stream). Una filiale = una pagina.
// 1 filiale, N matricole, N netti (primi N token money), poi i totali (da ignorare).
// Validazione per filiale: somma(netti) == totale di ripartizione e N == Nr dipendenti.
export function parseInfinityNettiPages(pages: string[], outlets: ParserOutlet[]): ParsedImport {
  const rows: PreviewRow[] = [];
  for (const page of pages) {
    const mf = page.match(/Filiale:\s*\d+\s*-\s*(.+?)\s*;/i);
    if (!mf) continue;
    const outlet = matchOutletName(mf[1], outlets);
    // La validazione di filiale ignora tutto DA "Totale aziendale" in poi:
    // sull'ultima pagina ci sono due totali (ripartizione filiale + aziendale documento)
    // e l'aziendale non deve essere scambiato per il totale di filiale.
    const azCut = page.search(RE_TOT_AZIENDALE_LOOSE);
    const work = azCut >= 0 ? page.slice(0, azCut) : page;
    const mats = work.match(RE_MATRICOLA) || [];
    if (!mats.length) continue;
    const amts = (work.match(RE_MONEY_G) || []).map((a) => parseItNum(a));
    const N = mats.length;
    const netti = amts.slice(0, N);
    // totale di ripartizione = PRIMO token money dopo gli N netti (non l'ultimo della pagina)
    const totRip = amts.length > N ? amts[N] : null;
    const sum = netti.reduce<number>((s, v) => s + (v || 0), 0);
    const dd = deDouble(work);
    const nrm = dd.match(/nr\s+dipendenti\s+(\d+)/i);
    const nrDip = nrm ? parseInt(nrm[1], 10) : null;
    const quadra = (totRip == null || Math.abs(sum - totRip) < 0.01) && (nrDip == null || nrDip === N);
    const names = extractNames(work, mf[0], N);
    for (let i = 0; i < N; i++) {
      const r = blankRow();
      r.matricola = mats[i];
      r.outlet = outlet;
      r.netto = netti[i] ?? null;
      if (names) { r.cognome = names[i].cognome; r.nome = names[i].nome; }
      if (!quadra) r.warn = true;
      rows.push(r);
    }
  }
  const fileTotal = rows.reduce<number>((s, r) => s + (r.netto || 0), 0);
  return { rows, fileTotal: rows.length ? fileTotal : null };
}

// PDF "Elenco netti" Infinity (versione riga-based, fallback): sezioni per Filiale, righe `matricola COGNOME NOME importo`.
// Il totale di controllo si calcola sommando i netti letti (il "Totale aziendale" del PDF
// esce con caratteri raddoppiati e non è affidabile). Mapping filiale→outlet a runtime.
export function parseInfinityNetti(lines: string[], outlets: ParserOutlet[]): ParsedImport {
  const rows: PreviewRow[] = [];
  let currentOutlet = '';
  // matricola(6-7) + nome completo + importo it; lookahead negativo per non troncare
  // l'importo; NON ancorato a fine riga (dopo l'importo può esserci l'IBAN).
  const reEmp = /^(\d{6,7})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?![\d.,])/;
  for (const ln of lines) {
    const mf = ln.match(RE_FILIALE);
    if (mf) { currentOutlet = matchOutletName(mf[1], outlets); continue; }
    // Le righe Totale (anche con lettere raddoppiate "TToottaallee") non iniziano con
    // una matricola → vengono scartate da sé dal reEmp.
    const me = ln.match(reEmp);
    if (me) {
      const parts = me[2].trim().split(/\s+/);
      const r = blankRow();
      r.matricola = me[1]; r.cognome = parts[0] || ''; r.nome = parts.slice(1).join(' ');
      r.outlet = currentOutlet; r.netto = parseItNum(me[3]);
      rows.push(r);
    }
  }
  // Totale di controllo = somma dei netti letti (no fiducia nel totale del PDF).
  const fileTotal = rows.reduce<number>((s, r) => s + (r.netto || 0), 0);
  return { rows, fileTotal: rows.length ? fileTotal : null };
}

// PDF costi lordi — best-effort finché non arriva il tracciato definitivo:
// cerca una riga intestazione con ≥2 etichette note, poi mappa i numeri per ordine.
export function parsePdfLordi(lines: string[], outlets: ParserOutlet[]): ParsedImport {
  const LABELS: { field: 'retribuzione' | 'contributi' | 'inail' | 'tfr' | 'altri'; re: RegExp }[] = [
    { field: 'retribuzione', re: /lord|retribuz|compet|imponibile/i },
    { field: 'contributi', re: /contrib|inps|oneri/i },
    { field: 'inail', re: /inail/i },
    { field: 'tfr', re: /tfr/i },
    { field: 'altri', re: /altri|altro/i },
  ];
  let order: ('retribuzione' | 'contributi' | 'inail' | 'tfr' | 'altri')[] | null = null;
  let currentOutlet = '';
  let fileTotal: number | null = null;
  const rows: PreviewRow[] = [];
  for (const ln of lines) {
    const mf = ln.match(RE_FILIALE);
    if (mf) { currentOutlet = matchOutletName(mf[1], outlets); continue; }
    const ta = ln.match(RE_TOT_AZIENDALE);
    if (ta) { fileTotal = parseItNum(ta[1]); continue; }
    if (!order) {
      const present = LABELS.filter((l) => l.re.test(ln));
      if (present.length >= 2) {
        order = present.map((l) => ({ field: l.field, idx: ln.toLowerCase().search(l.re) })).sort((a, b) => a.idx - b.idx).map((x) => x.field);
        continue;
      }
    }
    const m = ln.match(/^(\d{6,7})\s+(.+)$/);
    if (m && order) {
      const rest = m[2];
      const nums = (rest.match(RE_IMPORTO_IT) ? rest.match(/-?[\d.]+,\d{2}/g) || [] : []).map((x) => parseItNum(x));
      const parts = rest.replace(/-?[\d.]+,\d{2}/g, '').trim().split(/\s+/);
      const r = blankRow();
      r.matricola = m[1]; r.cognome = parts[0] || ''; r.nome = parts.slice(1).join(' '); r.outlet = currentOutlet;
      order.forEach((f, i) => { if (nums[i] != null) (r as any)[f] = nums[i]; });
      rows.push(r);
    }
  }
  return { rows, fileTotal };
}

// CSV/Excel mapping-driven sugli header (entrambe le corsie).
export function parseSpreadsheet(matrix: any[][]): ParsedImport {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(12, matrix.length); i++) {
    const cells = matrix[i].map(norm);
    if (cells.some((c) => c === 'netto' || c.includes('matricola') || c === 'cognome' || c.includes('retribuzione') || c.includes('lordo') || c.includes('nominativo'))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return { rows: [], fileTotal: null };
  const header = matrix[headerIdx].map(norm);
  const findCol = (field: string): number => {
    const syns = FIELD_SYNS[field];
    for (const s of syns) { const idx = header.indexOf(s); if (idx >= 0) return idx; }
    for (let i = 0; i < header.length; i++) { if (syns.some((s) => header[i].includes(s))) return i; }
    return -1;
  };
  const cols: Record<string, number> = {};
  Object.keys(FIELD_SYNS).forEach((f) => { cols[f] = findCol(f); });
  const get = (r: any[], field: string) => (cols[field] >= 0 ? r[cols[field]] : undefined);
  const rows: PreviewRow[] = [];
  let fileTotal: number | null = null;
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!r || r.every((c) => c == null || String(c).trim() === '')) continue;
    const matricola = String(get(r, 'matricola') ?? '').trim().replace(/\.0$/, '');
    let cognome = String(get(r, 'cognome') ?? '').trim();
    let nome = String(get(r, 'nome') ?? '').trim();
    if (!cognome && cols.nominativo >= 0) {
      const full = String(get(r, 'nominativo') ?? '').trim();
      const parts = full.split(/\s+/);
      cognome = parts[0] || ''; nome = parts.slice(1).join(' ');
    }
    const netto = parseItNum(get(r, 'netto'));
    const retribuzione = parseItNum(get(r, 'retribuzione'));
    const labelBlob = norm(`${matricola} ${cognome} ${nome}`);
    if (!matricola && /totale|totali|tot\./.test(labelBlob)) {
      if (netto != null) fileTotal = netto; else if (retribuzione != null) fileTotal = retribuzione;
      continue;
    }
    if (!cognome && !matricola && netto == null && retribuzione == null) continue;
    const row = blankRow();
    row.matricola = matricola; row.cognome = cognome; row.nome = nome;
    row.outlet = String(get(r, 'outlet') ?? '').trim();
    row.netto = netto; row.retribuzione = retribuzione;
    row.contributi = parseItNum(get(r, 'contributi'));
    row.inail = parseItNum(get(r, 'inail'));
    row.tfr = parseItNum(get(r, 'tfr'));
    row.altri = parseItNum(get(r, 'altri'));
    rows.push(row);
  }
  return { rows, fileTotal };
}

// ============================================================================
// PROSPETTO RIEPILOGATIVO ELABORAZIONE PAGHE (Zucchetti Paghe Infinity)
// Documento per PERIODO, una sezione per FILIALE. Dà il costo del lavoro
// AGGREGATO per outlet/mese (niente matricole). Parser puro: lavora sulle righe
// già ricostruite per geometria da extractPdfLines (TOL=2), che fonde l'imponibile
// INAIL sulla riga della PAT. Verificato su gen-apr 2026 NZ.
//
// Costo lordo outlet (decisione contabile Lilian):
//   totale_retribuzioni − compensi_amm + (INPS+EBINTER+EST Contr.Azienda)
//   + INAIL(Σ imponibile_PAT × tasso_PAT) + T.F.R. trasf. (Contr.Azienda)
// Gli amministratori (Compensi Collaboratori/Ammin. + I.N.P.S. Gestione separata)
// vanno in una voce SEPARATA, fuori dal costo outlet.
// ============================================================================

export type ProspettoPat = { code: string; label: string; imponibile: number };
export type ProspettoOutletRow = {
  filialeCode: string;
  filialeName: string;       // testo grezzo della filiale (per tooltip/export)
  outlet: string;            // outlet riconosciuto ('' se non mappato → "Non attribuito")
  year: number; month: number;
  numeroDipendenti: number | null;
  retribuzioniLorde: number | null;  // "1 Retribuzioni Lorde" (dettaglio)
  totaleRetribuzioni: number | null; // base del costo
  compensiAmm: number;               // "2 Compensi Collaboratori/Ammin." (→ amministratori)
  contrInps: number;                 // I.N.P.S. ordinaria Contr.Azienda
  contrEbinter: number;
  contrEst: number;
  contrGestioneSeparata: number;     // I.N.P.S. Gestione separata (→ amministratori)
  tfrFondo: number;                  // T.F.R. trasf. <fondo> Contr.Azienda
  inailPat: ProspettoPat[];          // imponibili INAIL per PAT (tasso applicato a runtime)
  warn?: string;
};
export type ProspettoParsed = {
  isProspetto: boolean;
  rows: ProspettoOutletRow[];
  months: { year: number; month: number }[]; // periodi distinti trovati nel file
};

const MONTHS_IT: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};
const RE_MONEY_ALL = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
const moneyAt = (s: string): number[] => (s.match(RE_MONEY_ALL) || []).map((m) => parseItNum(m) as number).filter((n) => n != null);
const firstMoney = (s: string): number | null => { const a = moneyAt(s); return a.length ? a[0] : null; };

// somma INPS+EBINTER+EST (Contr.Azienda) che resta sull'outlet
export const contrAziendaOutlet = (r: Pick<ProspettoOutletRow, 'contrInps' | 'contrEbinter' | 'contrEst'>) =>
  r.contrInps + r.contrEbinter + r.contrEst;

/**
 * Parser del Prospetto. `lines` = output di extractPdfLines (righe per geometria).
 * `outlets` per il mapping filiale→outlet a runtime (matchOutletName).
 */
export function parseProspettoPaghe(lines: string[], outlets: ParserOutlet[]): ProspettoParsed {
  const isProspetto = lines.some((l) => /Prospetto riepilogativo elaborazione paghe/i.test(l));
  const sections = new Map<string, ProspettoOutletRow>();
  const months: { year: number; month: number }[] = [];
  let curYear = 0, curMonth = 0;
  let cur: ProspettoOutletRow | null = null;
  let ente: 'inps' | 'ebinter' | 'est' | 'gsep' | 'tfr' | null = null;
  let inInail = false;

  const setPeriod = (ln: string) => {
    // "Dal Gennaio 2026 Norm. - Al Gennaio 2026 Norm." oppure "Dal Marzo 2026 Agg.1 - Al Marzo 2026 Norm."
    // il mese di competenza è quello del periodo (Dal/Al coincidono): prendo l'ultimo "<mese> <anno>".
    const all = [...ln.matchAll(/([A-Za-zàèéìòù]+)\s+(\d{4})/g)];
    for (let i = all.length - 1; i >= 0; i--) {
      const mname = all[i][1].toLowerCase();
      if (MONTHS_IT[mname]) { curMonth = MONTHS_IT[mname]; curYear = parseInt(all[i][2], 10); break; }
    }
    if (curYear && curMonth && !months.some((m) => m.year === curYear && m.month === curMonth)) {
      months.push({ year: curYear, month: curMonth });
    }
  };

  for (const raw of lines) {
    const ln = raw.trim();
    if (!ln) continue;

    if (/Periodo di elaborazione:/i.test(ln)) { setPeriod(ln); continue; }

    // Filiale: sia "Ripartizione: Filiale: 0000000001 NOME" sia "Progressivo ripartizione n.2: Filiale: ..."
    const mf = ln.match(/Filiale:\s*(\d{10})\s+(.+?)\s*$/i);
    if (mf) {
      const code = mf[1];
      const name = mf[2].trim();
      ente = null; inInail = false;
      if (cur && cur.filialeCode === code) continue; // header ripetuto su pagina di continuazione
      const existing = sections.get(code);
      if (existing) { cur = existing; continue; }
      const outlet = matchOutletName(name, outlets);
      cur = {
        filialeCode: code, filialeName: name, outlet,
        year: curYear, month: curMonth,
        numeroDipendenti: null, retribuzioniLorde: null, totaleRetribuzioni: null,
        compensiAmm: 0, contrInps: 0, contrEbinter: 0, contrEst: 0,
        contrGestioneSeparata: 0, tfrFondo: 0, inailPat: [],
        warn: outlet ? undefined : 'Outlet non riconosciuto dal nome filiale',
      };
      sections.set(code, cur);
      continue;
    }
    if (!cur) continue;

    const mnd = ln.match(/NUMERO DIPENDENTI\s+(\d+)/i);
    if (mnd) { cur.numeroDipendenti = parseInt(mnd[1], 10); continue; }

    if (/^1\s+Retribuzioni Lorde\b/i.test(ln)) { cur.retribuzioniLorde = firstMoney(ln); continue; }
    if (/Compensi Collaboratori\/Ammin/i.test(ln)) { cur.compensiAmm = firstMoney(ln) ?? 0; continue; }
    if (/^Totale retribuzioni\b/i.test(ln)) { cur.totaleRetribuzioni = firstMoney(ln); continue; }

    // INAIL
    if (/SEZIONE I\.N\.A\.I\.L\./i.test(ln)) { inInail = true; ente = null; continue; }
    if (inInail) {
      if (/SEZIONE FISCALE|RIEPILOGO IMPORTI|SEZIONE CONTRIBUTIVA/i.test(ln)) { inInail = false; }
      else {
        // Dentro la sezione INAIL ogni riga "<n> <NOME PAT> [imponibile] [Imp.Dip.]" è una PAT.
        // Il nome può contenere parentesi/typo ("PALMANOVA OUTLED (UDINE)") o numeri ("BRUGNATO 5 TERRE").
        // imponibile = primo importo POSITIVO; l'eventuale negativo è l'Imp.Dipendente (da ignorare).
        const mp = ln.match(/^(\d{1,2})\s+([A-ZÀ-ÿ].*)$/);
        if (mp) {
          const monies = moneyAt(mp[2]);
          const imp = monies.find((m) => m > 0) ?? 0;
          const label = mp[2].replace(RE_MONEY_ALL, ' ').replace(/\s+/g, ' ').trim();
          cur.inailPat.push({ code: mp[1], label, imponibile: imp });
        }
        continue;
      }
    }

    // Enti contributivi
    if (/Gestione separata/i.test(ln)) { ente = 'gsep'; continue; }
    if (/^I\.N\.P\.S\.\s*$/i.test(ln)) { ente = 'inps'; continue; }
    if (/^EBINTER\b/i.test(ln)) { ente = 'ebinter'; continue; }
    if (/^Fondo EST\b/i.test(ln)) { ente = 'est'; continue; }
    if (/T\.F\.R\. trasf\./i.test(ln)) { ente = 'tfr'; /* la riga di dettaglio precede il Totale id */ }

    if (/^Totale id\b/i.test(ln)) {
      const v = firstMoney(ln);
      if (v != null) {
        if (ente === 'inps') cur.contrInps += v;
        else if (ente === 'ebinter') cur.contrEbinter += v;
        else if (ente === 'est') cur.contrEst += v;
        else if (ente === 'gsep') cur.contrGestioneSeparata += v;
        else if (ente === 'tfr') cur.tfrFondo += v;
      }
      continue;
    }
  }

  return { isProspetto, rows: [...sections.values()], months };
}

// ============================================================================
// "Statistica costo orario" (Zucchetti Paghe Infinity) — costo lordo per
// DIPENDENTE/MESE. File multi-azienda: si importa una sola azienda per volta
// (companyCode = codice 6 cifre della riga "Azienda:"). Vedi migration 082.
//
// Regole verificate sul file reale (column-major, niente split inventati):
//  - colonne riconosciute per posizione X dall'header
//    (Costo retribuzione | contribuzione | Inail | Totale | Ore | Costo medio);
//    Ore e Costo medio NON sono importi → scartate.
//  - blocchi dipendente spezzati a cavallo di pagina: la matricola si ristampa,
//    lo stato (matricola/mese) viene PORTATO fra le pagine, non azzerato.
//  - mese rilevato da un token "MM/AAAA" anche quando l'anno è spezzato
//    ("02/20 2 6") → si guarda solo MM.
//  - il blocco di coda "Totale aziendale" è la sintesi azienda: NON è un
//    dipendente → escluso dai dati, usato solo come totale di controllo.
//  - lordo = colonna "Totale" = retribuzione + contribuzione + inail.
//    Il TFR (voce 930) è GIÀ dentro la retribuzione → salvato a parte, mai risommato.
// ============================================================================

export type StatEmpMonth = {
  matricola: string;
  name: string;            // "COGNOME NOME" come nel report
  year: number; month: number;
  retribuzione: number; contribuzione: number; inail: number;
  tfr: number;             // informativo (già incluso in retribuzione)
  lordo: number;           // = retribuzione + contribuzione + inail
};
export type StatParsed = {
  isStatistica: boolean;
  companyCode: string;
  rows: StatEmpMonth[];
  employees: number;
  totalLordo: number;
  monthly: { month: number; lordo: number }[];
  controlTotal: number | null;   // "Totale aziendale" → lordo Gen–…: totale di controllo
};

type GItem = { str: string; x: number; y: number; w?: number };
type StatCol = 'retrib' | 'contrib' | 'inail' | 'totale' | 'ore' | 'medio';
const STAT_COLS: StatCol[] = ['retrib', 'contrib', 'inail', 'totale', 'ore', 'medio'];
const RE_STAT_MONEY = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

// Item in coordinate di DISPLAY (vedi extractPdfItemsOriented): y cresce verso il
// basso → l'ordine di lettura è y CRESCENTE; le colonne sono x crescente.
function statClusterRows(items: GItem[], tol = 2.5): GItem[][] {
  const rows: { y: number; n: number; items: GItem[] }[] = [];
  for (const it of [...items].sort((a, b) => a.y - b.y)) {
    let r = rows.find((rr) => Math.abs(rr.y - it.y) <= tol);
    if (!r) { r = { y: it.y, n: 0, items: [] }; rows.push(r); }
    r.items.push(it); r.y = (r.y * r.n + it.y) / (r.n + 1); r.n++;
  }
  rows.sort((a, b) => a.y - b.y);
  return rows.map((r) => r.items.slice().sort((a, b) => a.x - b.x));
}
// Colonne riconosciute dall'header (x = bordo sinistro dell'etichetta, in ordine).
// Un importo appartiene alla colonna la cui etichetta inizia più a destra senza
// superare l'importo (gli importi sono allineati a destra rispetto all'header e
// stanno sempre prima dell'header successivo): più robusto del nearest puro.
type StatColPos = { k: StatCol; x: number };
const statAssign = (cellX: number, cols: StatColPos[]): StatCol => {
  let chosen = cols[0].k;
  for (const c of cols) { if (cellX >= c.x - 6) chosen = c.k; else break; }
  return chosen;
};

export function parseStatisticaCostoOrario(pages: GItem[][], opts: { companyCode: string }): StatParsed {
  const company = opts.companyCode;
  const empName = new Map<string, string>();
  const monthly = new Map<string, Map<number, number[]>>();   // mat → month → [r,c,i,t]
  const tfr = new Map<string, Map<number, number>>();         // mat → month → tfr
  let col: StatColPos[] | null = null;
  let cur: string | null = null, curM: number | null = null;
  let inTot = false, az: string | null = null, skip = false, seenStat = false;
  let controlTotal: number | null = null, controlM: number | null = null;
  let year = 0;

  for (const items of pages) {
    for (const row of statClusterRows(items)) {
      const txt = row.map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
      if (/Statistica costo orario/i.test(txt)) seenStat = true;
      const py = txt.match(/Periodo di elaborazione:.*?(\d{4})/i);
      if (py) year = +py[1];
      const ma = txt.match(/Azienda:\s*(\d{6})/);
      if (ma) { az = ma[1]; skip = false; continue; }
      if (az !== company) continue;

      if (/Costo retribuzione/i.test(txt) && /Inail/i.test(txt)) {
        const cc: Partial<Record<StatCol, number>> = {};
        for (const t of row) {
          const s = t.str.toLowerCase();
          if (s.includes('retribuzione')) cc.retrib = t.x;
          else if (s.includes('contribuzione')) cc.contrib = t.x;
          else if (s.includes('inail')) cc.inail = t.x;
          else if (s === 'totale') cc.totale = t.x;
          else if (s === 'ore') cc.ore = t.x;
          else if (s.includes('medio')) cc.medio = t.x;
        }
        if (cc.retrib != null && cc.contrib != null && cc.inail != null && cc.totale != null && cc.ore != null && cc.medio != null)
          col = STAT_COLS.map((k) => ({ k, x: cc[k] as number })).sort((a, b) => a.x - b.x);
        continue;
      }

      // Sintesi azienda di coda: non un dipendente → solo totale di controllo.
      if (/Totale\s+aziendale/i.test(txt)) { skip = true; }
      if (skip) {
        if (!col) continue;
        const dm = txt.match(/(\d{2})\/\d{2,4}/);
        if (dm) { const M = +dm[1]; if (M >= 1 && M <= 12) controlM = M; }
        if (/\bTotali\b/i.test(txt)) controlM = null; // blocco "Totali" finale = grand total
        if (row[0]?.str === 'Totale' && row[1] && RE_STAT_MONEY.test(row[1].str) && controlM === null) {
          let tot = 0;
          for (const t of row) { if (RE_STAT_MONEY.test(t.str) && statAssign(t.x, col) === 'totale') { tot = parseItNum(t.str) ?? 0; break; } }
          if (tot) controlTotal = round2(tot);
        }
        continue;
      }

      const mm = txt.match(/^(\d{7})\s+(.*)/);
      if (mm && mm[1] !== cur) {
        cur = mm[1]; curM = null; inTot = false;
        empName.set(cur, mm[2].split(/\s+\d{2}\/\d{2}/)[0].trim());
      }
      if (/\bTotali\b/i.test(txt)) { inTot = true; curM = null; }
      if (!inTot) {
        for (const t of row) { const d = t.str.match(/^(\d{2})\/\d{2,4}$/); if (d) { const M = +d[1]; if (M >= 1 && M <= 12) { curM = M; break; } } }
      }
      if (!col || !cur) continue;

      // voce 930 T.F.R. → colonna retribuzione (informativo)
      if (!inTot && curM && row[0]?.str === '930') {
        for (const t of row) { if (RE_STAT_MONEY.test(t.str) && statAssign(t.x, col) === 'retrib') { if (!tfr.has(cur)) tfr.set(cur, new Map()); tfr.get(cur)!.set(curM, parseItNum(t.str) ?? 0); break; } }
      }
      // riga "Totale" del mese (o del blocco "Totali" del dipendente → cross-check, ignorata)
      if (row[0]?.str === 'Totale' && row[1] && RE_STAT_MONEY.test(row[1].str)) {
        const v: Record<StatCol, number> = { retrib: 0, contrib: 0, inail: 0, totale: 0, ore: 0, medio: 0 };
        for (const t of row) { if (!RE_STAT_MONEY.test(t.str)) continue; v[statAssign(t.x, col)] = parseItNum(t.str) ?? 0; }
        if (!inTot && curM) {
          if (!monthly.has(cur)) monthly.set(cur, new Map());
          if (!monthly.get(cur)!.has(curM)) monthly.get(cur)!.set(curM, [round2(v.retrib), round2(v.contrib), round2(v.inail), round2(v.totale)]);
        }
      }
    }
  }

  const rows: StatEmpMonth[] = [];
  const monthTot = new Map<number, number>();
  for (const [mat, mmap] of monthly) {
    for (const [m, arr] of mmap) {
      const lordo = round2(arr[3]);
      rows.push({ matricola: mat, name: empName.get(mat) || mat, year: year || new Date().getFullYear(), month: m,
        retribuzione: arr[0], contribuzione: arr[1], inail: arr[2], tfr: round2(tfr.get(mat)?.get(m) ?? 0), lordo });
      monthTot.set(m, round2((monthTot.get(m) ?? 0) + lordo));
    }
  }
  rows.sort((a, b) => (a.matricola === b.matricola ? a.month - b.month : a.matricola < b.matricola ? -1 : 1));
  return {
    isStatistica: seenStat && rows.length > 0,
    companyCode: company,
    rows,
    employees: empName.size,
    totalLordo: round2(rows.reduce((s, r) => s + r.lordo, 0)),
    monthly: [...monthTot.entries()].sort((a, b) => a[0] - b[0]).map(([month, lordo]) => ({ month, lordo })),
    controlTotal,
  };
}

// Elenca le aziende presenti nel file "Statistica costo orario" (è multi-azienda):
// l'utente sceglie quale importare per il proprio tenant. Codice 6 cifre + nome.
export function listStatisticaCompanies(pages: GItem[][]): { code: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const items of pages) {
    for (const row of statClusterRows(items)) {
      const txt = row.map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
      const m = txt.match(/Azienda:\s*(\d{6})\s+(.+?)\s*$/);
      if (m && !seen.has(m[1])) seen.set(m[1], m[2].trim());
    }
  }
  return [...seen.entries()].map(([code, name]) => ({ code, name }));
}
