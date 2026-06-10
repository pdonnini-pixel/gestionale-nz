import * as pdfjsLib from 'pdfjs-dist';

// Stesso worker usato da PdfViewer.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

/**
 * Estrae il testo di un PDF ricostruendo le righe per posizione verticale.
 * Ritorna un array di righe (una stringa per riga logica), nell'ordine del documento.
 */
export async function extractPdfLines(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows: Record<number, { x: number; str: string }[]> = {};
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string') continue;
      const y = Math.round(it.transform[5]);
      (rows[y] ||= []).push({ x: it.transform[4], str: it.str });
    }
    const ys = Object.keys(rows).map(Number).sort((a, b) => b - a); // alto → basso
    for (const y of ys) {
      const line = rows[y].sort((a, b) => a.x - b.x).map((s) => s.str).join(' ').replace(/\s+/g, ' ').trim();
      if (line) out.push(line);
    }
  }
  return out;
}
