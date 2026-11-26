// Lettura dei documenti del rapporto (edge function `contratto-leggi`) e
// scrittura sulla scheda del dipendente. La logica di confronto è in
// ./contrattoLetto.ts (pura e testata).
//
// Dove resta traccia:
// - sul documento, `employee_documents.extracted_data.lettura`: quando è stato
//   letto, cosa dice, l'esito e le differenze che aspettano una conferma;
// - sulla scheda, una nota datata in coda a `employees.note` per ogni campo scritto.
import { supabase } from './supabase';
import {
  TIPI_DA_LEGGERE, normalizzaLettura, confrontaContratto, valoriDaScrivere, notaContratto, dataEffettiva,
  type CampoContratto, type ContrattoLetto, type SchedaContratto,
} from './contrattoLetto';

export class LetturaContrattoError extends Error {}

/** Quello che resta scritto sul documento. */
export interface LetturaSalvata {
  letta_il: string;
  stato: 'non_rapporto' | 'altra_persona' | 'storico' | 'allineata' | 'scritta' | 'da_confermare' | 'confermata';
  testo: string;
  dati: ContrattoLetto;
  /** Campi scritti da soli (scheda vuota) o confermati. */
  scritti: CampoContratto[];
  /** Differenze che sostituirebbero un valore: aspettano la conferma. */
  da_confermare: CampoContratto[];
  /** Cambi che valgono da una data futura: non scritti. */
  rinviati: CampoContratto[];
  decorrenza: string | null;
}

type Riga = { id: string; employee_id: string; doc_type: string | null; file_name: string | null; extracted_data: unknown };

const COLONNE_SCHEDA = 'id, note, nome, cognome, first_name, last_name, codice_fiscale, fiscal_code, contratto_tipo, data_assunzione, hire_date, scadenza_td, ore_settimanali, part_time_pct, livello, level, qualifica, role_description, data_cessazione, termination_date';

const info = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});

export const letturaDi = (extracted: unknown): LetturaSalvata | null => {
  const l = info(extracted).lettura;
  return l && typeof l === 'object' ? l as LetturaSalvata : null;
};

/** Data «effettiva» di un documento archiviato: quella letta, se c'è, altrimenti quella del nome del file. */
function dataDelDocumento(r: Riga): string | null {
  const l = letturaDi(r.extracted_data);
  const ripiego = String(info(r.extracted_data).data_documento || '').slice(0, 10) || null;
  return l?.dati ? dataEffettiva(l.dati, ripiego) : ripiego;
}

async function messaggioErrore(error: { message?: string }): Promise<string> {
  let msg = error.message || 'Lettura del documento non riuscita.';
  try {
    const ctx = (error as unknown as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      if (body?.error) msg = body.error;
    }
  } catch { /* corpo non JSON */ }
  return msg;
}

async function salvaLettura(r: Riga, lettura: LetturaSalvata) {
  const { error } = await supabase.from('employee_documents')
    .update({ extracted_data: { ...info(r.extracted_data), lettura } as never })
    .eq('id', r.id);
  if (error) throw new LetturaContrattoError(`Letto, ma non riesco a salvare l'esito sul documento: ${error.message}`);
}

async function scriviScheda(schedaId: string, notaPrima: string | null, campi: CampoContratto[], nota: string) {
  const { error } = await supabase.from('employees')
    .update({ ...valoriDaScrivere(campi), note: [notaPrima, nota].filter(Boolean).join('\n') } as never)
    .eq('id', schedaId);
  if (error) throw new LetturaContrattoError(`Non riesco a scrivere sulla scheda: ${error.message}`);
}

/**
 * Legge un documento del rapporto, lo confronta con la scheda e scrive da sé i
 * campi vuoti. Le differenze che sostituirebbero un valore restano sul
 * documento, da confermare con `confermaLettura`.
 */
export async function leggiDocumentoRapporto(documentId: string, oggi: string): Promise<LetturaSalvata> {
  const { data: doc, error: dErr } = await supabase.from('employee_documents')
    .select('id, employee_id, doc_type, file_name, extracted_data').eq('id', documentId).single();
  if (dErr || !doc) throw new LetturaContrattoError('Documento non trovato.');
  const riga = doc as Riga;
  if (!TIPI_DA_LEGGERE.has(riga.doc_type || '')) throw new LetturaContrattoError('Questo tipo di documento non si legge.');

  const { data, error } = await supabase.functions.invoke('contratto-leggi', { body: { documentId } });
  if (error) throw new LetturaContrattoError(await messaggioErrore(error));
  const dati = normalizzaLettura((data as { data?: unknown } | null)?.data);

  // Scheda e altri documenti si leggono adesso dal database, non dalla pagina:
  // con più file caricati insieme la scheda cambia fra un file e l'altro.
  const [sch, altri] = await Promise.all([
    supabase.from('employees').select(COLONNE_SCHEDA).eq('id', riga.employee_id).single(),
    supabase.from('employee_documents').select('id, employee_id, doc_type, file_name, extracted_data').eq('employee_id', riga.employee_id).neq('id', documentId),
  ]);
  if (sch.error || !sch.data) throw new LetturaContrattoError('Non riesco a leggere la scheda del dipendente.');
  const scheda = sch.data as SchedaContratto & { id: string; note: string | null };
  const altreDate = ((altri.data as Riga[]) ?? []).filter((r) => TIPI_DA_LEGGERE.has(r.doc_type || '')).map(dataDelDocumento);

  const esito = confrontaContratto(scheda, dati, oggi, altreDate);
  const base = { letta_il: new Date().toISOString(), dati, scritti: [] as CampoContratto[], da_confermare: [] as CampoContratto[], rinviati: [] as CampoContratto[], decorrenza: null as string | null };
  let lettura: LetturaSalvata;
  if (esito.stato === 'da_scrivere') {
    if (esito.riempimenti.length) {
      await scriviScheda(scheda.id, scheda.note, esito.riempimenti, notaContratto(oggi, riga.file_name || 'documento', dati, esito.riempimenti));
    }
    lettura = {
      ...base, scritti: esito.riempimenti, da_confermare: esito.sostituzioni, rinviati: esito.rinviati, decorrenza: esito.decorrenza,
      stato: esito.sostituzioni.length ? 'da_confermare' : 'scritta', testo: esito.testo,
    };
  } else if (esito.stato === 'allineata') {
    lettura = { ...base, rinviati: esito.rinviati, decorrenza: esito.decorrenza, stato: 'allineata', testo: esito.testo };
  } else {
    lettura = { ...base, stato: esito.stato, testo: esito.testo };
  }
  await salvaLettura(riga, lettura);
  return lettura;
}

/** Scrive sulla scheda le differenze confermate da chi carica. */
export async function confermaLettura(documentId: string, oggi: string): Promise<LetturaSalvata> {
  const { data: doc, error } = await supabase.from('employee_documents')
    .select('id, employee_id, doc_type, file_name, extracted_data').eq('id', documentId).single();
  if (error || !doc) throw new LetturaContrattoError('Documento non trovato.');
  const riga = doc as Riga;
  const l = letturaDi(riga.extracted_data);
  if (!l || l.stato !== 'da_confermare' || !l.da_confermare.length) throw new LetturaContrattoError('Non c\'è niente da confermare su questo documento.');

  // Ricontrollo sulla scheda di adesso: se nel frattempo qualcuno l'ha cambiata,
  // si rilegge invece di scrivere valori pensati sulla scheda di prima.
  const { data: sch, error: sErr } = await supabase.from('employees').select(COLONNE_SCHEDA).eq('id', riga.employee_id).single();
  if (sErr || !sch) throw new LetturaContrattoError('Non riesco a leggere la scheda del dipendente.');
  const scheda = sch as SchedaContratto & { id: string; note: string | null };
  // Anche gli altri documenti di adesso: se nel frattempo ne è arrivato uno più
  // recente, questo non deve più sovrascrivere la scheda (revisore codice, 26/11/2026).
  const { data: altri } = await supabase.from('employee_documents')
    .select('id, employee_id, doc_type, file_name, extracted_data').eq('employee_id', riga.employee_id).neq('id', documentId);
  const altreDate = ((altri as Riga[]) ?? []).filter((r) => TIPI_DA_LEGGERE.has(r.doc_type || '')).map(dataDelDocumento);
  const adesso = confrontaContratto(scheda, l.dati, oggi, altreDate);
  if (adesso.stato === 'storico' || adesso.stato === 'altra_persona') {
    await salvaLettura(riga, { ...l, stato: adesso.stato, testo: adesso.testo, da_confermare: [] });
    throw new LetturaContrattoError(adesso.testo);
  }
  const ancora = adesso.stato === 'da_scrivere' ? [...adesso.riempimenti, ...adesso.sostituzioni] : [];
  const chiavi = new Set(l.da_confermare.map((c) => `${c.campo}|${c.dopo}`));
  const daScrivere = ancora.filter((c) => chiavi.has(`${c.campo}|${c.dopo}`));
  if (daScrivere.length !== l.da_confermare.length) {
    throw new LetturaContrattoError('La scheda è cambiata dopo la lettura: premi «Rileggi» e controlla di nuovo le differenze.');
  }
  await scriviScheda(scheda.id, scheda.note, daScrivere, notaContratto(oggi, riga.file_name || 'documento', l.dati, daScrivere));
  const lettura: LetturaSalvata = {
    ...l, stato: 'confermata', scritti: [...l.scritti, ...daScrivere], da_confermare: [],
    testo: `Scheda allineata al documento (${daScrivere.length === 1 ? '1 dato' : `${daScrivere.length} dati`}).`,
  };
  await salvaLettura(riga, lettura);
  return lettura;
}
