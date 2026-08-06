// Estrazione automatica dei dati di una scadenza da un documento (PDF).
//
// Flusso: il PDF viene letto lato client (pdfjs, nessun upload del file), il
// testo estratto viene inviato all'edge function `extract-scadenza` che chiede a
// Claude i campi strutturati (fornitore, P.IVA, numero/data documento, importo da
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

/**
 * Estrae dal file i dati di una scadenza. Supporta PDF (testo estratto via
 * pdfjs). Lancia ScadenzaExtractError con un messaggio leggibile in caso di
 * problemi (file senza testo, servizio non disponibile, ecc.).
 */
export async function extractScadenzaFromPdf(file: File): Promise<ExtractedScadenza> {
  const name = (file.name || '').toLowerCase();
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
  if (!isPdf) {
    throw new ScadenzaExtractError('Formato non supportato: carica un PDF.');
  }

  let text = '';
  try {
    text = await extractTextFromPdf(file);
  } catch (e) {
    throw new ScadenzaExtractError('Non riesco a leggere il PDF: ' + ((e as Error)?.message || 'file non valido') + '.');
  }

  // PDF "immagine" (scansione senza testo selezionabile): pdfjs non estrae nulla.
  if (!text || text.replace(/\s/g, '').length < 20) {
    throw new ScadenzaExtractError('Il PDF non contiene testo leggibile (forse è una scansione). Inserisci i dati a mano.');
  }

  const { data, error } = await supabase.functions.invoke('extract-scadenza', { body: { text } });
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
