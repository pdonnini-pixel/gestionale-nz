// ============================================================================
// ZIP IN INGRESSO
// ============================================================================
// Chi manda i documenti (il consulente, l'amministrazione) li spedisce quasi
// sempre come un unico archivio: sette estratti Nexi e un Amex viaggiano in uno
// zip solo. Chiedere all'utente di estrarli a mano prima di trascinarli e' un
// passaggio che il programma puo' fare da se'.
//
// Qui lo zip viene aperto nel browser (JSZip, nessun server) e ne escono i file
// veri, pronti per il parser che gia' esiste. Niente viene scritto: e' solo
// lettura in memoria.
import JSZip from 'jszip';

/** Un file da lavorare, con il nome dello zip da cui e' uscito (se ne viene). */
export type FileInIngresso = {
  file: File;
  /** Nome dell'archivio di provenienza, per dirlo negli esiti. */
  daZip: string | null;
};

export type EsitoEspansione = {
  files: FileInIngresso[];
  /** Zip che non si sono aperti, o che non contenevano niente di utile. */
  problemi: { zip: string; testo: string }[];
};

const ZIP_RX = /\.zip$/i;
const TIPI_ZIP = ['application/zip', 'application/x-zip-compressed', 'multipart/x-zip'];

export const isZip = (f: File) => ZIP_RX.test(f.name) || TIPI_ZIP.includes(f.type);

/**
 * Roba che gli zip si portano dietro e che non e' un documento: la cartella di
 * servizio di macOS, i file nascosti, le voci di directory.
 */
const daIgnorare = (percorso: string) => {
  const nome = percorso.split('/').pop() || '';
  return percorso.startsWith('__MACOSX/') || nome.startsWith('.') || nome === '';
};

const haEstensione = (nome: string, estensioni: string[]) => {
  const ext = (nome.split('.').pop() || '').toLowerCase();
  return estensioni.includes(ext);
};

const TIPO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xml: 'application/xml',
  csv: 'text/csv',
};

/**
 * Apre gli zip e restituisce i file che contengono, lasciando passare intatto
 * tutto il resto. Un archivio illeggibile non blocca gli altri: finisce in
 * `problemi` e il caricamento prosegue.
 *
 * @param estensioni estensioni da tenere (minuscole, senza punto)
 * @param max tetto di sicurezza sul numero di file estratti da un singolo zip
 */
export async function espandiZip(
  files: File[],
  { estensioni = ['pdf'], max = 200 }: { estensioni?: string[]; max?: number } = {},
): Promise<EsitoEspansione> {
  const risultato: FileInIngresso[] = [];
  const problemi: { zip: string; testo: string }[] = [];

  for (const f of files) {
    if (!isZip(f)) {
      risultato.push({ file: f, daZip: null });
      continue;
    }
    try {
      // Il File si passa come ArrayBuffer: JSZip legge i Blob solo nel browser,
      // e cosi' la stessa funzione gira anche sotto test.
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      const voci = Object.values(zip.files)
        .filter(v => !v.dir && !daIgnorare(v.name) && haEstensione(v.name, estensioni))
        .sort((a, b) => a.name.localeCompare(b.name, 'it'));

      if (!voci.length) {
        problemi.push({
          zip: f.name,
          testo: `nessun file ${estensioni.join(' o ').toUpperCase()} dentro l'archivio`,
        });
        continue;
      }
      if (voci.length > max) {
        problemi.push({ zip: f.name, testo: `troppi file nell'archivio (${voci.length}, il massimo è ${max})` });
        continue;
      }

      for (const v of voci) {
        const dati = await v.async('arraybuffer');
        const nome = v.name.split('/').pop() || v.name;
        const ext = (nome.split('.').pop() || '').toLowerCase();
        risultato.push({
          file: new File([dati], nome, { type: TIPO_MIME[ext] || 'application/octet-stream' }),
          daZip: f.name,
        });
      }
    } catch (e) {
      problemi.push({ zip: f.name, testo: `archivio non leggibile (${e instanceof Error ? e.message : String(e)})` });
    }
  }

  return { files: risultato, problemi };
}
