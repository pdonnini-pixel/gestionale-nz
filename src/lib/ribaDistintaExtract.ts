// Estrazione delle righe di una DISTINTA di ricevute bancarie (RiBa) da file.
//
// Supporta:
//  - PDF  -> testo estratto lato client (pdfjs) + edge function `extract-distinta`
//            (AI) che restituisce le righe. L'AI fa SOLO estrazione: il riscontro
//            AL CENTESIMO e la chiusura avvengono lato DB (rpc_*_riba_distinta).
//  - CSV / XLSX -> parsing DETERMINISTICO lato client (nessuna AI): il piu'
//            affidabile per gli importi. Rileva le colonne per intestazione.
//
// Sola lettura: non modifica dati aziendali. La chiusura al centesimo la fanno
// gli RPC lato DB dopo che l'operatrice ha rivisto i riscontri.
import { supabase } from './supabase';
import { extractTextFromPdf } from './contractParser';

export type DistintaLine = {
  supplier: string | null;
  vat: string | null;      // P.IVA o codice fiscale del creditore (chiave di aggancio piu' affidabile)
  invoice: string | null;
  amount: number;          // sempre valorizzato (le righe senza importo sono scartate)
  dueDate: string | null;  // ISO YYYY-MM-DD se noto
};

const cleanVat = (raw: unknown): string | null => {
  const s = String(raw ?? '').replace(/[^0-9A-Za-z]/g, '').replace(/^IT/i, '');
  return s ? s : null;
};

export type DistintaExtract = {
  declaredTotal: number | null;
  lines: DistintaLine[];
  sourceKind: 'pdf' | 'csv' | 'xlsx';
};

export class DistintaExtractError extends Error {}

// Parsing importo robusto al formato italiano ("1.234,56" -> 1234.56) e a quello
// con punto decimale ("1234.56"). Ritorna null se non e' un numero.
export function parseItAmount(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  let s = String(raw).trim().replace(/[€\s]/g, '');
  if (!s) return null;
  const neg = /^-/.test(s) || /-$/.test(s);
  s = s.replace(/-/g, '');
  if (s.includes(',') && s.includes('.')) {
    // se la virgola e' dopo il punto -> IT (punto migliaia, virgola decimali)
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

function toIsoDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd/mm/yyyy o dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    let y = m[3];
    if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y;
    return `${y}-${mo}-${d}`;
  }
  return null;
}

const norm = (h: unknown) => String(h ?? '').toLowerCase().trim();

// Rileva gli indici di colonna da una riga di intestazione.
function detectCols(headers: unknown[]) {
  const find = (keys: string[]) => headers.findIndex(h => keys.some(k => norm(h).includes(k)));
  return {
    supplier: find(['fornitor', 'beneficiar', 'ragione', 'denominaz', 'creditor', 'debitor', 'nominativ', 'cliente']),
    vat: find(['p.iva', 'piva', 'partita', 'codice fiscale', 'cod.fisc', 'cod fisc', 'c.f.', 'vat']),
    invoice: find(['fattura', 'documento', 'num.', 'numero', 'fatt', 'rif']),
    amount: find(['importo', 'ammontare', 'totale', 'saldo']),
    due: find(['scadenz', 'data']),
  };
}

// Trova la riga di intestazione (la prima con una colonna "importo" riconoscibile).
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols = detectCols(rows[i]);
    if (cols.amount >= 0) return i;
  }
  return -1;
}

function rowsToLines(rows: unknown[][]): DistintaLine[] {
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) {
    throw new DistintaExtractError('Non riconosco le colonne del file: serve almeno una colonna "Importo".');
  }
  const cols = detectCols(rows[headerRow]);
  const out: DistintaLine[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => norm(c) === '')) continue;
    const amount = parseItAmount(r[cols.amount]);
    if (amount == null || amount === 0) continue; // righe di totale/vuote scartate
    out.push({
      supplier: cols.supplier >= 0 ? (norm(r[cols.supplier]) ? String(r[cols.supplier]).trim() : null) : null,
      vat: cols.vat >= 0 ? cleanVat(r[cols.vat]) : null,
      invoice: cols.invoice >= 0 ? (norm(r[cols.invoice]) ? String(r[cols.invoice]).trim() : null) : null,
      amount: Math.abs(amount),
      dueDate: cols.due >= 0 ? toIsoDate(r[cols.due]) : null,
    });
  }
  if (!out.length) throw new DistintaExtractError('Nessuna riga con importo trovata nel file.');
  return out;
}

async function extractXlsx(file: File): Promise<DistintaExtract> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as unknown[][];
  return { declaredTotal: null, lines: rowsToLines(rows), sourceKind: 'xlsx' };
}

async function extractCsv(file: File): Promise<DistintaExtract> {
  const text = await file.text();
  const rawLines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!rawLines.length) throw new DistintaExtractError('File CSV vuoto.');
  const delim = (rawLines[0].match(/;/g)?.length || 0) >= (rawLines[0].match(/,/g)?.length || 0) ? ';' : ',';
  const rows = rawLines.map(l => l.split(delim).map(c => c.replace(/^"|"$/g, '').trim()));
  return { declaredTotal: null, lines: rowsToLines(rows), sourceKind: 'csv' };
}

async function extractPdf(file: File): Promise<DistintaExtract> {
  let text = '';
  try {
    text = await extractTextFromPdf(file);
  } catch (e) {
    throw new DistintaExtractError('Non riesco a leggere il PDF: ' + ((e as Error)?.message || 'file non valido') + '.');
  }
  if (!text || text.replace(/\s/g, '').length < 20) {
    throw new DistintaExtractError('Il PDF non contiene testo leggibile (forse è una scansione). Usa un CSV/Excel o inserisci a mano.');
  }
  const { data, error } = await supabase.functions.invoke('extract-distinta', { body: { text } });
  if (error) {
    let msg = error.message || 'Estrazione non riuscita.';
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) msg = body.error;
      }
    } catch { /* corpo non JSON */ }
    throw new DistintaExtractError(msg);
  }
  const d = (data as { data?: { declaredTotal?: number | null; lines?: unknown[] } } | null)?.data;
  const rawLines = Array.isArray(d?.lines) ? d!.lines : [];
  const lines: DistintaLine[] = rawLines
    .map((it) => {
      const o = (it ?? {}) as { supplier?: unknown; vat?: unknown; invoice?: unknown; amount?: unknown; dueDate?: unknown };
      const amount = parseItAmount(o.amount);
      return {
        supplier: o.supplier ? String(o.supplier) : null,
        vat: cleanVat(o.vat),
        invoice: o.invoice ? String(o.invoice) : null,
        amount: amount == null ? NaN : Math.abs(amount),
        dueDate: toIsoDate(o.dueDate),
      };
    })
    .filter((l): l is DistintaLine => isFinite(l.amount) && l.amount > 0);
  if (!lines.length) throw new DistintaExtractError('Nessuna riga con importo estratta dal PDF.');
  return { declaredTotal: typeof d?.declaredTotal === 'number' ? d!.declaredTotal! : null, lines, sourceKind: 'pdf' };
}

/**
 * Estrae le righe della distinta dal file (PDF, CSV o XLSX). Lancia
 * DistintaExtractError con messaggio leggibile in caso di problemi.
 */
export async function extractDistinta(file: File): Promise<DistintaExtract> {
  const name = (file.name || '').toLowerCase();
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
  const isCsv = name.endsWith('.csv') || file.type === 'text/csv';
  const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls')
    || file.type.includes('spreadsheet') || file.type.includes('excel');
  if (isPdf) return extractPdf(file);
  if (isXlsx) return extractXlsx(file);
  if (isCsv) return extractCsv(file);
  throw new DistintaExtractError('Formato non supportato: carica un PDF, un CSV o un Excel (.xlsx).');
}
