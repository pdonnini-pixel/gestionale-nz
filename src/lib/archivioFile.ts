// ============================================================================
// ARCHIVIO DEI FILE CARICATI
// ============================================================================
// Prima di questo modulo, dieci punti del gestionale leggevano un file, ne
// estraevano i numeri e lo buttavano via: nel log restava il nome, non il
// documento. Se un mese non quadrava, il file da riaprire non c'era piu'.
//
// Qui il file viene messo su Storage e registrato in `import_documents`, che e'
// il registro unico dei caricamenti: chi, quando, da quale funzione, per quale
// periodo, e a quale dato si riferisce.
//
// Regola: l'archiviazione non deve MAI far fallire l'import. Se lo Storage non
// risponde, i dati si salvano lo stesso e il chiamante riceve un errore da
// mostrare (mai un fallimento silenzioso).
import { supabase } from './supabase';

export type ModuloArchivio =
  | 'Personale' | 'Banche' | 'Fatturazione' | 'Scadenzario'
  | 'Outlet' | 'Bilancio' | 'Ticket' | 'Strumenti';

export type ArchiviaParams = {
  file: File;
  companyId: string;
  userId?: string | null;
  modulo: ModuloArchivio;
  /** Etichetta leggibile della funzione che ha caricato il file. */
  funzione: string;
  bucket?: string;
  year?: number | null;
  month?: number | null;
  /** Tabella e riga del dato prodotto dal file, per il salto file ↔ dato. */
  referenceTable?: string | null;
  referenceId?: string | null;
  note?: string | null;
};

export type FileArchiviato = {
  id: string | null;
  bucket: string;
  path: string;
  /** Valorizzato quando il file NON e' stato archiviato: da mostrare all'utente. */
  errore?: string;
};

const BUCKET_DI_DEFAULT = 'general-documents';

/** Nome file prevedibile e senza sorprese nei path di Storage. */
const nomeSicuro = (nome: string) =>
  nome.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);

const cartellaPeriodo = (year?: number | null, month?: number | null) => {
  if (!year) return 'senza-periodo';
  return month ? `${year}/${String(month).padStart(2, '0')}` : `${year}`;
};

/**
 * Mette il file in archivio e lo registra. Non lancia mai: in caso di problema
 * torna `errore` valorizzato, e sta al chiamante dirlo all'utente.
 */
export async function archiviaFile(p: ArchiviaParams): Promise<FileArchiviato> {
  const bucket = p.bucket || BUCKET_DI_DEFAULT;
  const slug = p.modulo.toLowerCase();
  const path = `${p.companyId}/${slug}/${cartellaPeriodo(p.year, p.month)}/${Date.now()}_${nomeSicuro(p.file.name)}`;
  try {
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, p.file, { upsert: false });
    if (upErr) return { id: null, bucket, path, errore: upErr.message };

    const { data, error: dbErr } = await supabase.from('import_documents').insert([{
      company_id: p.companyId,
      file_name: p.file.name,
      file_path: path,
      file_size: p.file.size,
      file_type: (p.file.name.split('.').pop() || '').toLowerCase(),
      storage_bucket: bucket,
      source: p.funzione,
      modulo: p.modulo,
      funzione: p.funzione,
      year: p.year ?? null,
      month: p.month ?? null,
      reference_table: p.referenceTable ?? null,
      reference_id: p.referenceId ?? null,
      uploaded_by: p.userId ?? null,
      note: p.note ?? null,
      uploaded_at: new Date().toISOString(),
    }]).select('id').single();

    if (dbErr) {
      // Il file c'e' ma non e' indicizzato: si toglie, meglio niente che un
      // documento fantasma che nessuna schermata sapra' mai mostrare.
      await supabase.storage.from(bucket).remove([path]);
      return { id: null, bucket, path, errore: dbErr.message };
    }
    return { id: (data as { id: string } | null)?.id || null, bucket, path };
  } catch (e) {
    return { id: null, bucket, path, errore: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * «Ricaricare sovrascrive», anche in archivio.
 *
 * Quando lo stesso documento viene ricaricato per lo stesso periodo (il consulente
 * ristampa, oppure il primo file era quello sbagliato), i dati vengono sostituiti:
 * l'archivio deve dire la stessa cosa, altrimenti chi lo riapre per capire un
 * numero rischia di leggere la versione vecchia.
 *
 * Non cancella niente: il caricamento precedente resta, marcato come sostituito e
 * con il puntatore a quello che l'ha rimpiazzato. La UI mostra di default solo la
 * versione corrente.
 */
export async function sostituisciPrecedenti(p: {
  companyId: string;
  funzione: string;
  year?: number | null;
  month?: number | null;
  nuovoId: string | null;
}): Promise<number> {
  if (!p.nuovoId) return 0;
  let q = supabase.from('import_documents')
    .update({ superseded_at: new Date().toISOString(), superseded_by: p.nuovoId })
    .eq('company_id', p.companyId)
    .eq('funzione', p.funzione)
    .neq('id', p.nuovoId)
    .is('superseded_at', null);
  q = p.year == null ? q.is('year', null) : q.eq('year', p.year);
  q = p.month == null ? q.is('month', null) : q.eq('month', p.month);
  const { data, error } = await q.select('id');
  if (error) return 0;
  return (data || []).length;
}

/** Collega a posteriori il file al dato che ha prodotto. */
export async function collegaFileArchiviato(
  documentId: string | null,
  referenceTable: string,
  referenceId: string | null,
): Promise<void> {
  if (!documentId || !referenceId) return;
  await supabase.from('import_documents')
    .update({ reference_table: referenceTable, reference_id: referenceId })
    .eq('id', documentId);
}

/** URL temporaneo per riaprire un file archiviato (1 ora). */
export async function urlFileArchiviato(bucket: string | null, path: string | null): Promise<string | null> {
  if (!bucket || !path) return null;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

/** Messaggio pronto quando l'archiviazione fallisce ma i dati sono salvi. */
export const avvisoArchiviazioneFallita = (nomeFile: string, errore: string) =>
  `I dati di «${nomeFile}» sono stati salvati, ma il file non è finito in archivio (${errore}). Puoi ricaricarlo più tardi dall'Archivio documenti.`;
