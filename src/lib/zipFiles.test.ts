import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { espandiZip, isZip } from './zipFiles';

const zipCon = async (voci: Record<string, string>, nome = 'estratti.zip'): Promise<File> => {
  const zip = new JSZip();
  for (const [percorso, contenuto] of Object.entries(voci)) zip.file(percorso, contenuto);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], nome, { type: 'application/zip' });
};

const pdf = (nome: string) => new File(['%PDF-1.4 finto'], nome, { type: 'application/pdf' });

describe('isZip', () => {
  it('riconosce lo zip dal nome e dal tipo', () => {
    expect(isZip(new File([''], 'estratti.ZIP'))).toBe(true);
    expect(isZip(new File([''], 'x', { type: 'application/x-zip-compressed' }))).toBe(true);
    expect(isZip(pdf('estratto.pdf'))).toBe(false);
  });
});

describe('espandiZip', () => {
  it('lascia passare i file sciolti senza toccarli', async () => {
    const f = pdf('estratto.pdf');
    const { files, problemi } = await espandiZip([f]);
    expect(problemi).toHaveLength(0);
    expect(files).toHaveLength(1);
    expect(files[0].file).toBe(f);
    expect(files[0].daZip).toBeNull();
  });

  it('apre lo zip e tiene solo i PDF, in ordine', async () => {
    const z = await zipCon({
      'Estratto conto Marzo 2026 (6).pdf': 'uno',
      'Estratto conto Marzo 2026 (7).pdf': 'due',
      'note.txt': 'da ignorare',
      '__MACOSX/._Estratto conto Marzo 2026 (6).pdf': 'spazzatura di macOS',
      '.DS_Store': 'spazzatura',
    });
    const { files, problemi } = await espandiZip([z]);
    expect(problemi).toHaveLength(0);
    expect(files.map(f => f.file.name)).toEqual([
      'Estratto conto Marzo 2026 (6).pdf',
      'Estratto conto Marzo 2026 (7).pdf',
    ]);
    expect(files[0].daZip).toBe('estratti.zip');
    expect(files[0].file.type).toBe('application/pdf');
    expect(await files[0].file.text()).toBe('uno');
  });

  it('prende i PDF anche dentro le cartelle, col nome corto', async () => {
    const z = await zipCon({ 'dicembre/nexi/estratto.pdf': 'contenuto' });
    const { files } = await espandiZip([z]);
    expect(files.map(f => f.file.name)).toEqual(['estratto.pdf']);
  });

  it('segnala lo zip senza PDF invece di fallire in silenzio', async () => {
    const z = await zipCon({ 'lettera.docx': 'niente pdf' }, 'vuoto.zip');
    const { files, problemi } = await espandiZip([z]);
    expect(files).toHaveLength(0);
    expect(problemi).toEqual([{ zip: 'vuoto.zip', testo: 'nessun file PDF dentro l\'archivio' }]);
  });

  it('un archivio rotto non blocca gli altri file', async () => {
    const rotto = new File(['non sono uno zip'], 'rotto.zip', { type: 'application/zip' });
    const buono = pdf('estratto.pdf');
    const { files, problemi } = await espandiZip([rotto, buono]);
    expect(files.map(f => f.file.name)).toEqual(['estratto.pdf']);
    expect(problemi).toHaveLength(1);
    expect(problemi[0].zip).toBe('rotto.zip');
  });

  it('rifiuta gli archivi troppo grandi invece di aprirli', async () => {
    const voci: Record<string, string> = {};
    for (let i = 0; i < 5; i++) voci[`f${i}.pdf`] = 'x';
    const z = await zipCon(voci, 'tanti.zip');
    const { files, problemi } = await espandiZip([z], { max: 3 });
    expect(files).toHaveLength(0);
    expect(problemi[0].testo).toContain('troppi file');
  });
});
