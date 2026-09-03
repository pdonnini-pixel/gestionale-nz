// ============================================================================
// ARCHIVIO UNICO — un elenco solo, diviso in sezioni da aprire.
// ============================================================================
// Prima i documenti stavano in due schede diverse con criteri diversi: una per
// tipo di documento (fatture, bilanci, estratti conto), una per ordine di
// caricamento. Chi cercava un file doveva sapere in anticipo da quale porta era
// entrato. Qui la fonte è una sola, la vista v_archivio_documenti (migration
// 164), che normalizza le sei tabelle dove i documenti vivono davvero.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Search, FolderOpen, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export type RigaArchivio = {
  id: string;
  sezione: string;
  titolo: string | null;
  file_name: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  ha_file: boolean | null;
  anno: number | null;
  mese: number | null;
  funzione: string | null;
  fonte: string | null;
  riferimento_id: string | null;
  data: string | null;
  file_size: number | null;
};

const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

// Ordine di presentazione: prima quello che si cerca più spesso.
const ORDINE_SEZIONI = ['Fatture', 'Estratti conto', 'Paghe e personale', 'Scadenzario', 'Contratti e outlet', 'Bilanci', 'Altro'];
const rangoSezione = (s: string) => { const i = ORDINE_SEZIONI.indexOf(s); return i >= 0 ? i : 900; };

const pesoLeggibile = (b: number | null) =>
  b == null ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

const periodoLeggibile = (r: RigaArchivio) => {
  if (!r.anno) return '—';
  return r.mese ? `${MESI[r.mese - 1]} ${r.anno}` : String(r.anno);
};

export default function ArchivioUnificato({ companyId, showToast, onApriFattura }: {
  companyId?: string;
  showToast: (msg: string, type?: string) => void;
  onApriFattura: (invoiceId: string) => void;
}) {
  const [righe, setRighe] = useState<RigaArchivio[]>([]);
  const [caricando, setCaricando] = useState(false);
  const [aperte, setAperte] = useState<Set<string>>(new Set());
  const [anno, setAnno] = useState('tutti');
  const [ricerca, setRicerca] = useState('');
  const [aprendo, setAprendo] = useState<string | null>(null);

  const carica = useCallback(async () => {
    if (!companyId) return;
    setCaricando(true);
    const { data, error } = await supabase
      .from('v_archivio_documenti')
      .select('id, sezione, titolo, file_name, storage_bucket, storage_path, ha_file, anno, mese, funzione, fonte, riferimento_id, data, file_size')
      .eq('company_id', companyId)
      .order('data', { ascending: false })
      .limit(5000);
    if (error) showToast(`Impossibile leggere l'archivio: ${error.message}`, 'error');
    setRighe(((data as unknown) as RigaArchivio[]) || []);
    setCaricando(false);
  }, [companyId, showToast]);

  // showToast cambia identità a ogni render del padre: fuori dalle dipendenze,
  // altrimenti la lettura si rilancia in continuazione.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carica(); }, [companyId]);

  const anni = useMemo(
    () => Array.from(new Set(righe.map(r => r.anno).filter(Boolean))).sort((a, b) => Number(b) - Number(a)) as number[],
    [righe],
  );

  const filtrate = useMemo(() => righe.filter(r => {
    if (anno !== 'tutti' && String(r.anno || '') !== anno) return false;
    if (!ricerca.trim()) return true;
    const q = ricerca.toLowerCase();
    return (r.titolo || '').toLowerCase().includes(q)
      || (r.file_name || '').toLowerCase().includes(q)
      || (r.funzione || '').toLowerCase().includes(q);
  }), [righe, anno, ricerca]);

  const sezioni = useMemo(() => {
    const m = new Map<string, RigaArchivio[]>();
    filtrate.forEach(r => {
      const s = r.sezione || 'Altro';
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(r);
    });
    return [...m.entries()].sort((a, b) => rangoSezione(a[0]) - rangoSezione(b[0]) || a[0].localeCompare(b[0], 'it'));
  }, [filtrate]);

  const toggle = (s: string) => setAperte(prev => {
    const n = new Set(prev);
    n.has(s) ? n.delete(s) : n.add(s);
    return n;
  });

  const apri = async (r: RigaArchivio) => {
    // Le fatture elettroniche non hanno un file su Storage: l'XML vive in
    // colonna e si apre con il visualizzatore.
    if (r.fonte === 'electronic_invoices') { onApriFattura(r.riferimento_id || ''); return; }
    if (!r.storage_bucket || !r.storage_path) {
      showToast('Di questo documento è rimasta solo la registrazione: il file non era stato archiviato.', 'error');
      return;
    }
    setAprendo(r.id);
    const { data, error } = await supabase.storage.from(r.storage_bucket).createSignedUrl(r.storage_path, 3600);
    setAprendo(null);
    if (error || !data?.signedUrl) { showToast(`Impossibile aprire il file: ${error?.message || 'link non disponibile'}`, 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center gap-2">
        <select value={anno} onChange={e => setAnno(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300">
          <option value="tutti">Tutti gli anni</option>
          {anni.map(a => <option key={a} value={String(a)}>{a}</option>)}
        </select>
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={ricerca} onChange={e => setRicerca(e.target.value)}
            placeholder="Cerca per fornitore, nome file o funzione…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300" />
        </div>
        <span className="text-sm text-slate-500">{filtrate.length} documenti</span>
        <button onClick={() => void carica()} disabled={caricando}
          className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40" title="Ricarica">
          <RefreshCw size={16} className={caricando ? 'animate-spin' : ''} />
        </button>
      </div>

      {caricando && righe.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm shadow-sm">
          Lettura dell&rsquo;archivio…
        </div>
      ) : sezioni.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500 text-sm shadow-sm">
          <FolderOpen size={28} className="mx-auto mb-3 text-slate-300" />
          Nessun documento{righe.length ? ' con questi filtri' : ' in archivio'}.
        </div>
      ) : (
        <div className="space-y-3">
          {sezioni.map(([sezione, elenco]) => {
            const aperta = aperte.has(sezione);
            const senzaFile = elenco.filter(r => !r.ha_file).length;
            return (
              <div key={sezione} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <button onClick={() => toggle(sezione)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition">
                  <span className="flex items-center gap-2 min-w-0">
                    {aperta ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                    <span className="font-semibold text-slate-800">{sezione}</span>
                    <span className="text-xs text-slate-500">· {elenco.length} document{elenco.length === 1 ? 'o' : 'i'}</span>
                    {senzaFile > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                        {senzaFile} senza file
                      </span>
                    )}
                  </span>
                </button>

                {aperta && (
                  <div className="border-t border-slate-100 max-h-[520px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium">Documento</th>
                          <th className="px-4 py-2 text-left font-medium">Da dove arriva</th>
                          <th className="px-4 py-2 text-left font-medium">Periodo</th>
                          <th className="px-4 py-2 text-right font-medium">Peso</th>
                          <th className="px-4 py-2 text-center font-medium">Apri</th>
                        </tr>
                      </thead>
                      <tbody>
                        {elenco.slice(0, 500).map(r => (
                          <tr key={r.id} className="border-t border-slate-50 hover:bg-slate-50">
                            <td className="px-4 py-2 text-slate-700 max-w-[320px]">
                              <div className="truncate" title={r.titolo || r.file_name || ''}>{r.titolo || r.file_name || '—'}</div>
                              {r.file_name && r.titolo !== r.file_name && (
                                <div className="text-[11px] text-slate-400 truncate" title={r.file_name}>{r.file_name}</div>
                              )}
                            </td>
                            <td className="px-4 py-2 text-slate-500 max-w-[240px] truncate" title={r.funzione || ''}>{r.funzione || '—'}</td>
                            <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{periodoLeggibile(r)}</td>
                            <td className="px-4 py-2 text-right text-slate-500 whitespace-nowrap">{pesoLeggibile(r.file_size)}</td>
                            <td className="px-4 py-2 text-center">
                              <button onClick={() => apri(r)} disabled={aprendo === r.id || !r.ha_file}
                                className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-40 inline-flex items-center gap-1">
                                <ExternalLink size={13} /> {aprendo === r.id ? 'apro…' : 'apri'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {elenco.length > 500 && (
                      <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-100">
                        Mostrati i 500 più recenti su {elenco.length}. Restringi con l&rsquo;anno o la ricerca.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
