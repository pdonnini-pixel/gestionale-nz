import * as pdfjsLib from 'pdfjs-dist';

// Stesso worker usato da PdfViewer.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

/**
 * Estrae il testo di un PDF ricostruendo le righe per coordinata verticale.
 * pdfjs restituisce gli item di testo senza concetto di "riga": vanno raggruppati
 * per Y (transform[5], con tolleranza) e ordinati per X (transform[4]), altrimenti
 * gli importi si attaccano alla matricola successiva e il parsing fallisce.
 * Ritorna un array di righe pulite, nell'ordine del documento.
 */
export async function extractPdfLines(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: { x: number; y: number; str: string }[] = [];
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string' || it.str === '') continue;
      items.push({ x: it.transform[4], y: it.transform[5], str: it.str });
    }
    // alto → basso, poi sinistra → destra
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    // raggruppa per Y con tolleranza (sub-pixel / baseline)
    const TOL = 2.5;
    const lines: { x: number; y: number; str: string }[][] = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last[0].y - it.y) <= TOL) last.push(it);
      else lines.push([it]);
    }
    for (const ln of lines) {
      ln.sort((a, b) => a.x - b.x);
      const s = ln.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (s) out.push(s);
    }
  }
  return out;
}
