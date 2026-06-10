import * as pdfjsLib from 'pdfjs-dist';

// Stesso worker usato da PdfViewer.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

type It = { s: string; x: number; y: number };

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
