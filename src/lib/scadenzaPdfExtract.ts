// Estrazione automatica dei dati di una scadenza da un documento (PDF).
//
// Flusso: all'edge function `extract-scadenza` arriva il PDF intero (fino a 4 MB)
// insieme al testo letto qui con pdfjs. Il PDF intero serve perché il fornitore
// sta spesso solo nel logo o nell'intestazione grafica, e perché le scansioni
// non hanno testo. La funzione chiede a Claude i campi strutturati (fornitore, P.IVA, numero/data documento, importo da
// pagare, metodo, IBAN, scadenze). Il risultato pre-compila il form "Aggiungi
// scadenza"; l'operatrice verifica e corregge sempre prima di salvare.
//
// Sola lettura: nessun dato aziendale viene modificato qui.
import { supabase } from './supabase';
import { extractTextFromPdf } from './contractParser';

export type ExtractedInstallment = { dueDate: string; amount: number };

export type ExtractedScadenza = {
  supplierName: string | null;
  supplierVat: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  grossAmount: number | null;
  paymentMethod: string | null;
  iban: string | null;
  isCreditNote: boolean;
  documentType: string | null;
  confidence: number | null;
  installments: ExtractedInstallment[];
};

export class ScadenzaExtractError extends Error {}

/** Oltre questa dimensione il PDF non viaggia intero: si manda solo il testo. */
const MAX_PDF_BYTES = 4 * 1024 * 1024;

const fileInBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('lettura non riuscita'));
    reader.readAsDataURL(file);
  });

/**
 * Estrae dal file i dati di una scadenza. Supporta PDF: manda il documento
 * intero (fino a 4 MB) e il testo estratto via pdfjs. Lancia ScadenzaExtractError con un messaggio leggibile in caso di
 * problemi (file senza testo, servizio non disponibile, ecc.).
 */
export async function extractScadenzaFromPdf(file: File): Promise<ExtractedScadenza> {
  const name = (file.name || '').toLowerCase();
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
  if (!isPdf) {
    throw new ScadenzaExtractError('Formato non supportato: carica un PDF.');
  }

  // Il testo è un aiuto, non più un requisito: se pdfjs non lo estrae (scansione,
  // file particolare) il documento si legge lo stesso dalle pagine.
  let text = '';
  let erroreTesto = '';
  try {
    text = await extractTextFromPdf(file);
  } catch (e) {
    erroreTesto = (e as Error)?.message || 'file non valido';
  }
  const haTesto = !!text && text.replace(/\s/g, '').length >= 20;

  let pdfBase64: string | null = null;
  if (file.size <= MAX_PDF_BYTES) {
    try { pdfBase64 = await fileInBase64(file); } catch { pdfBase64 = null; }
  }

  if (!pdfBase64 && !haTesto) {
    throw new ScadenzaExtractError(erroreTesto
      ? `Non riesco a leggere il PDF: ${erroreTesto}.`
      : 'Il PDF supera i 4 MB e non contiene testo leggibile (forse è una scansione). Inserisci i dati a mano.');
  }

  const { data, error } = await supabase.functions.invoke('extract-scadenza', {
    body: { ...(haTesto ? { text } : {}), ...(pdfBase64 ? { pdfBase64 } : {}) },
  });
  if (error) {
    // supabase.functions.invoke incapsula il corpo di errore nella FunctionsHttpError.
    let msg = error.message || 'Estrazione non riuscita.';
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) msg = body.error;
      }
    } catch { /* corpo non JSON: tengo il messaggio generico */ }
    throw new ScadenzaExtractError(msg);
  }

  const d = (data as { data?: Partial<ExtractedScadenza> } | null)?.data;
  if (!d) throw new ScadenzaExtractError('Nessun dato estratto dal documento.');

  return {
    supplierName: d.supplierName ?? null,
    supplierVat: d.supplierVat ?? null,
    invoiceNumber: d.invoiceNumber ?? null,
    invoiceDate: d.invoiceDate ?? null,
    grossAmount: typeof d.grossAmount === 'number' ? d.grossAmount : null,
    paymentMethod: d.paymentMethod ?? null,
    iban: d.iban ?? null,
    isCreditNote: Boolean(d.isCreditNote),
    documentType: d.documentType ?? null,
    confidence: typeof d.confidence === 'number' ? d.confidence : null,
    installments: Array.isArray(d.installments)
      ? d.installments.filter((it): it is ExtractedInstallment => !!it && typeof it.dueDate === 'string' && typeof it.amount === 'number')
      : [],
  };
}
