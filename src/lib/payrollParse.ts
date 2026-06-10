// Parser puri per gli import del personale (testabili senza React/DOM).
// La ricostruzione testo dei PDF è in pdfText.ts; qui si lavora su righe già pronte.

export interface PreviewRow {
  matricola: string; cognome: string; nome: string; outlet: string;
  netto: number | null; retribuzione: number | null; contributi: number | null; inail: number | null; tfr: number | null; altri: number | null;
  isNew: boolean; matchedId: string | null;
}
export type ParsedImport = { rows: PreviewRow[]; fileTotal: number | null };
export type ParserOutlet = { name: string; cost_center_key: string | null };

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
  for (const o of outlets) {
    const n = norm(o.name);
    if (n && (n === t || t.includes(n) || n.includes(t))) return o.name;
  }
  for (const o of outlets) {
    const k = norm((o.cost_center_key || '').replace(/_/g, ' '));
    if (k && (t.includes(k) || k.includes(t))) return o.name;
  }
  const firstWord = t.split(' ')[0];
  for (const o of outlets) {
    if (firstWord && norm(o.name).startsWith(firstWord)) return o.name;
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

// PDF "Elenco netti" Infinity: sezioni per Filiale, righe `matricola COGNOME NOME importo`.
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
