// Lettura della visura (edge function visura-leggi) e scrittura nella scheda
// azienda e nelle sedi. La logica di confronto è in ./visura.ts.
import { supabase } from './supabase';
import { extractTextFromPdf } from './contractParser';
import { ETICHETTE_SEDE, type CampoScheda, type CampoSede, type Socio, type VisuraLetta } from './visura';

export class VisuraError extends Error {}

/** Una visura scansionata pesa sui 4-5 MB: oltre non viaggia intera. */
const MAX_PDF_BYTES = 4.6 * 1024 * 1024;

const fileInBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('lettura non riuscita'));
    reader.readAsDataURL(file);
  });

export async function leggiVisura(file: File): Promise<VisuraLetta> {
  const isPdf = file.type === 'application/pdf' || (file.name || '').toLowerCase().endsWith('.pdf');
  if (!isPdf) throw new VisuraError('Carica la visura in PDF.');

  let text = '';
  try { text = await extractTextFromPdf(file); } catch { text = ''; }
  const haTesto = text.replace(/\s/g, '').length >= 200;
  let pdfBase64: string | null = null;
  if (file.size <= MAX_PDF_BYTES) {
    try { pdfBase64 = await fileInBase64(file); } catch { pdfBase64 = null; }
  }
  if (!pdfBase64 && !haTesto) {
    throw new VisuraError('La visura supera i 4,5 MB ed è una scansione senza testo: scaricala di nuovo dal Registro Imprese in PDF.');
  }

  const { data, error } = await supabase.functions.invoke('visura-leggi', {
    body: { ...(haTesto ? { text } : {}), ...(pdfBase64 ? { pdfBase64 } : {}) },
  });
  if (error) {
    let msg = error.message || 'Lettura della visura non riuscita.';
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) msg = body.error;
      }
    } catch { /* corpo non JSON */ }
    throw new VisuraError(msg);
  }
  const d = (data as { data?: VisuraLetta } | null)?.data;
  if (!d) throw new VisuraError('Nessun dato letto dalla visura.');
  return {
    ...d,
    soci: Array.isArray(d.soci) ? d.soci : [],
    unitaLocali: Array.isArray(d.unitaLocali) ? d.unitaLocali : [],
  };
}

type ScriviScheda = {
  companyId: string;
  /** id della riga di company_settings; null se l'azienda non ne ha ancora una. */
  settingsId: string | null;
  campi: Partial<Record<CampoScheda, string | Socio[]>>;
  /** Provenienza attuale, da aggiornare con i campi scritti ora. */
  campiDaVisura: Record<string, string>;
  dataVisura: string | null;
  documentoId: string | null;
};

/** Scrive i campi letti dalla visura e ne segna la provenienza. */
export async function scriviSchedaDaVisura(p: ScriviScheda): Promise<string | null> {
  const data = p.dataVisura || new Date().toISOString().slice(0, 10);
  const provenienza = { ...p.campiDaVisura };
  for (const k of Object.keys(p.campi)) provenienza[k] = data;
  const riga: Record<string, unknown> = {
    ...p.campi,
    campi_da_visura: provenienza,
    visura_caricata_il: new Date().toISOString(),
    ...(p.dataVisura ? { visura_estratta_il: p.dataVisura } : {}),
    ...(p.documentoId ? { visura_documento_id: p.documentoId } : {}),
  };
  const q = p.settingsId
    ? supabase.from('company_settings').update(riga as never).eq('id', p.settingsId).select('id').maybeSingle()
    : supabase.from('company_settings').insert({ ...riga, company_id: p.companyId } as never).select('id').single();
  const { data: scritta, error } = await q;
  if (error) throw new VisuraError(error.message);
  // Nessuna riga toccata: la policy non lo permette (ruolo senza scrittura).
  if (!scritta) throw new VisuraError('Il tuo ruolo non può modificare i dati azienda.');
  return (scritta as { id: string }).id;
}

/** Aggiorna i campi di una sede e lascia una nota datata. */
export async function scriviSedeDaVisura(
  outletId: string,
  patch: Partial<Record<CampoSede, string>>,
  notaPrima: string | null,
  dataVisura: string | null,
): Promise<void> {
  const oggi = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome' }).format(new Date());
  const quando = dataVisura ? dataVisura.split('-').reverse().join('/') : '';
  const nota = `${oggi}: ${(Object.keys(patch) as CampoSede[]).map((k) => ETICHETTE_SEDE[k]).join(', ')} dalla visura camerale${quando ? ` del ${quando}` : ''}.`;
  const { data, error } = await supabase
    .from('outlets')
    .update({ ...patch, notes: notaPrima ? `${notaPrima}\n${nota}` : nota } as never)
    .eq('id', outletId)
    .select('id');
  if (error) throw new VisuraError(error.message);
  if (!data?.length) throw new VisuraError('Il tuo ruolo non può modificare le sedi dei negozi.');
}
