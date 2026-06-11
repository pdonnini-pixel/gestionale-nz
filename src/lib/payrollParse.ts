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

export type PdfItem = { str: string; x: number; y: number };
const RE_MAT_ONE = /^\d{7}$/;
const RE_MONEY_ONE = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;
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
      const toks = g.items.slice().sort((a, b) => a.y - b.y).map((i) => i.str.trim());
      const matTok = toks.find((t) => RE_MAT_ONE.test(t));
      const moneyToks = toks.filter((t) => RE_MONEY_ONE.test(t));
      if (!matTok || !moneyToks.length) continue; // intestazioni / totali → scartate
      const nameParts = toks.filter((t) => !RE_MAT_ONE.test(t) && !RE_MONEY_ONE.test(t) && !ROW_LABEL.test(t));
      const fullName = nameParts.join(' ').replace(/\s+/g, ' ').trim();
      const parts = fullName.split(' ');
      const r = blankRow();
      r.matricola = matTok;
      r.cognome = parts[0] || '';
      r.nome = parts.slice(1).join(' ');
      r.outlet = outlet;
      r.netto = parseItNum(moneyToks[0]);
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
        const money = g.items.map((i) => i.str.trim()).find((t) => RE_MONEY_ONE.test(t));
        if (money) totRip = parseItNum(money);
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
