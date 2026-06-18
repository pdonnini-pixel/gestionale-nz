import * as pdfjsLib from 'pdfjs-dist';

// Stesso worker usato da PdfViewer.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

type It = { s: string; x: number; y: number };

export type PdfItem = { str: string; x: number; y: number; w?: number };

/**
 * Estrae gli item di testo per PAGINA con la loro geometria (x = transform[4], y = transform[5]).
 * Necessario per l'"Elenco netti" che è RUOTATO: le righe si identificano con la X, le colonne
 * con la Y. Il raggruppamento riga/colonna lo fa il parser (payrollParse), qui niente assunzioni.
 */
export async function extractPdfItems(file: File): Promise<PdfItem[][]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: PdfItem[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: PdfItem[] = (tc.items as any[])
      .filter((i) => typeof i.str === 'string' && i.str.trim() !== '')
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    pages.push(items);
  }
  return pages;
}

/**
 * Estrae gli item per PAGINA in coordinate di DISPLAY (viewport), così la
 * rotazione della pagina è già applicata: x cresce verso destra, y verso il
 * basso, a prescindere dall'orientamento del PDF. Serve ai report "Paghe
 * Infinity" che sono RUOTATI a 90° (es. "Statistica costo orario"): senza
 * normalizzazione transform[4]/[5] sono gli assi scambiati.
 */
export async function extractPdfItemsOriented(file: File): Promise<PdfItem[][]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: PdfItem[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: PdfItem[] = (tc.items as any[])
      .filter((i) => typeof i.str === 'string' && i.str.trim() !== '')
      .map((i) => {
        const [dx, dy] = vp.convertToViewportPoint(i.transform[4], i.transform[5]);
        return { str: i.str, x: dx, y: dy, w: i.width };
      });
    pages.push(items);
  }
  return pages;
}

// Ricostruisce le righe di UNA pagina dagli item di testo pdfjs.
// pdfjs restituisce gli item nell'ordine di stream (su alcuni PDF è column-major):
// vanno raggruppati per Y (con tolleranza) e ordinati per X, altrimenti gli importi
// escono tutti insieme e si staccano da matricole/nomi.
function pageLines(items: It[]): string[] {
  const TOL = 2;
  const lines: { y: number; items: It[] }[] = [];
  for (const it of items) {
    // cerca una riga esistente entro la tolleranza (qualsiasi, non solo l'ultima)
    let line = lines.find((l) => Math.abs(l.y - it.y) <= TOL);
    if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
    line.items.push(it);
  }
  // in pdfjs Y cresce verso l'ALTO → ordine riga = Y decrescente
  lines.sort((a, b) => b.y - a.y);
  return lines.map((l) =>
    l.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim()
  ).filter((s) => s);
}

/**
 * Estrae il testo per PAGINA nell'ordine NATIVO di stream di pdfjs (NON riordinato).
 * Serve all'"Elenco netti", dove pdfjs restituisce ogni colonna come blocco unico
 * (tutte le matricole, poi tutti i nomi, poi tutti gli importi): l'abbinamento si fa
 * per posizione nelle colonne, non per riga. Ritorna una stringa per pagina.
 */
export async function extractPdfPages(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const text = (tc.items as any[])
      .map((i) => (typeof i.str === 'string' ? i.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push(text);
  }
  return pages;
}

/**
 * Estrae il testo di un PDF ricostruendo le righe per GEOMETRIA (Y con tolleranza, X crescente).
 * Ritorna un array di righe pulite, nell'ordine del documento.
 */
export async function extractPdfLines(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: It[] = (tc.items as any[])
      .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }))
      .filter((it) => typeof it.s === 'string' && it.s.trim() !== '');
    out.push(...pageLines(items));
  }
  return out;
}
