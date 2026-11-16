// ============================================================================
// IL FILE DELLA PRIMA NOTA: ARCHIVIO E INVII ALLO STUDIO
// ============================================================================
// Nato il 16/11/2026 da un controllo di Patrizio sul pacco di ottobre mandato
// allo studio: diciannove file, diciotto già archiviati nel gestionale, e
// l'unico mancante era il nostro, l'Excel della Prima Nota. Si generava, si
// scaricava, finiva nella cartella di chi lo spediva. A settimane di distanza
// non si poteva più dire che cosa avesse in mano lo studio.
//
// Due pezzi, e la differenza fra loro conta:
//
// 1. L'ARCHIVIO è automatico. Ogni export dell'Excel finisce in
//    `import_documents` come ogni altro documento, con periodo e data: il file
//    esatto che è stato prodotto, riapribile mesi dopo.
//
// 2. L'INVIO lo dichiara una persona. Le mail allo studio partono dal Gmail di
//    chi le manda: il gestionale non le vede e non può dedurre niente. Quindi
//    «mandato il giorno X a Y» è una riga che qualcuno conferma, non un dato
//    che il sistema si inventa. Senza conferma il file resta archiviato e
//    segnato come non inviato, che è la verità.
//
// Niente nomi e niente caselle scritti nel codice: il destinatario è testo
// libero, proposto a partire dall'ultimo usato in quell'azienda.
import { supabase } from './supabase';
import { archiviaFile, type FileArchiviato } from './archivioFile';

/** Etichetta della funzione in archivio: la chiave con cui si ritrovano questi file. */
export const FUNZIONE_ARCHIVIO = 'Prima nota · file per lo studio';

export type DocumentoPrimaNota = {
  id: string;
  file_name: string;
  file_size: number | null;
  storage_bucket: string | null;
  file_path: string | null;
  year: number | null;
  month: number | null;
  uploaded_at: string | null;
};

export type InvioPrimaNota = {
  id: string;
  document_id: string;
  periodo_year: number;
  periodo_month: number | null;
  inviato_il: string;
  destinatario: string;
  note: string | null;
};

/**
 * Stato di un file archiviato rispetto agli invii: la riga che la pagina mostra
 * accanto al documento. Pura, così il test la copre senza database.
 *
 * Un file può essere stato mandato più volte (allo studio, e poi di nuovo a chi
 * chiede il mese): si riportano tutti, con il più recente per primo.
 */
export function statoInvio(
  documentId: string,
  invii: InvioPrimaNota[],
): { inviato: boolean; ultimo: InvioPrimaNota | null; quanti: number } {
  const miei = invii
    .filter(i => i.document_id === documentId)
    .sort((a, b) => (a.inviato_il < b.inviato_il ? 1 : a.inviato_il > b.inviato_il ? -1 : 0));
  return { inviato: miei.length > 0, ultimo: miei[0] ?? null, quanti: miei.length };
}

/**
 * Il destinatario da proporre: l'ultimo usato in azienda. Nessun valore di
 * ripiego inventato (niente nomi nel codice): se non c'è storia, campo vuoto e
 * lo scrive chi registra.
 */
export function destinatarioProposto(invii: InvioPrimaNota[]): string {
  const ordinati = [...invii].sort((a, b) => (a.inviato_il < b.inviato_il ? 1 : -1));
  return ordinati[0]?.destinatario ?? '';
}

/** «ottobre 2026», «anno 2026»: periodo in chiaro per le etichette. */
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export function periodoInChiaro(year: number | null, month: number | null): string {
  if (!year) return 'senza periodo';
  return month ? `${MESI[month - 1]} ${year}` : `anno ${year}`;
}

/**
 * Archivia l'Excel appena generato. Non lancia: se l'archivio non risponde il
 * file è già stato scaricato dal browser, e il chiamante mostra l'avviso.
 */
export async function archiviaExportPrimaNota(p: {
  blob: Blob;
  nomeFile: string;
  companyId: string;
  userId?: string | null;
  year: number;
  month: number | null;
  note?: string | null;
}): Promise<FileArchiviato> {
  const file = new File([p.blob], p.nomeFile, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return archiviaFile({
    file,
    companyId: p.companyId,
    userId: p.userId ?? null,
    modulo: 'Banche',
    funzione: FUNZIONE_ARCHIVIO,
    year: p.year,
    month: p.month,
    note: p.note ?? null,
  });
}

/** I file della Prima Nota archiviati per un periodo, dal più recente. */
export async function caricaDocumentiPrimaNota(
  companyId: string,
  year: number,
  month: number | null,
): Promise<DocumentoPrimaNota[]> {
  let q = supabase.from('import_documents')
    .select('id, file_name, file_size, storage_bucket, file_path, year, month, uploaded_at')
    .eq('company_id', companyId)
    .eq('funzione', FUNZIONE_ARCHIVIO)
    .eq('year', year)
    .order('uploaded_at', { ascending: false });
  q = month == null ? q.is('month', null) : q.eq('month', month);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as DocumentoPrimaNota[];
}

/** Gli invii registrati per quei documenti. */
export async function caricaInvii(
  companyId: string,
  documentIds: string[],
): Promise<InvioPrimaNota[]> {
  if (documentIds.length === 0) return [];
  const { data, error } = await supabase.from('prima_nota_invii')
    .select('id, document_id, periodo_year, periodo_month, inviato_il, destinatario, note')
    .eq('company_id', companyId)
    .in('document_id', documentIds)
    .order('inviato_il', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as InvioPrimaNota[];
}

/** L'ultimo destinatario usato in azienda, per proporlo senza inventarlo. */
export async function ultimoDestinatario(companyId: string): Promise<string> {
  const { data } = await supabase.from('prima_nota_invii')
    .select('destinatario, inviato_il')
    .eq('company_id', companyId)
    .order('inviato_il', { ascending: false })
    .limit(1);
  return (data?.[0] as { destinatario?: string } | undefined)?.destinatario ?? '';
}

/** Registra l'invio di un file archiviato. */
export async function registraInvio(p: {
  companyId: string;
  documento: DocumentoPrimaNota;
  inviatoIl: string;
  destinatario: string;
  note?: string | null;
}): Promise<void> {
  const destinatario = p.destinatario.trim();
  if (!destinatario) throw new Error('Serve sapere a chi è stato mandato il file.');
  if (!p.documento.year) throw new Error('Il documento in archivio non ha un periodo: non si può registrare l\'invio.');
  const { error } = await supabase.from('prima_nota_invii').insert([{
    company_id: p.companyId,
    document_id: p.documento.id,
    periodo_year: p.documento.year,
    periodo_month: p.documento.month,
    inviato_il: p.inviatoIl,
    destinatario,
    note: p.note?.trim() || null,
  }]);
  if (error) throw new Error(error.message);
}

/** Toglie un invio registrato per sbaglio. Il file in archivio non si tocca. */
export async function annullaInvio(id: string): Promise<void> {
  const { error } = await supabase.from('prima_nota_invii').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
