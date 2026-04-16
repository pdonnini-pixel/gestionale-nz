import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText, Search, Download, Eye, RefreshCw,
  X, Clock, FileWarning, CheckCircle,
  AlertCircle, Database, FolderOpen, Archive, Store, Users, Receipt
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// ─── SOURCE CONFIG ──────────────────────────────────────────────
const SOURCE_META = {
  import_documents: { label: 'Importazioni', icon: Database, color: 'blue' },
  contract_documents: { label: 'Contratti', icon: Receipt, color: 'purple' },
  employee_documents: { label: 'Dipendenti', icon: Users, color: 'green' },
  outlet_attachments: { label: 'Outlet', icon: Store, color: 'amber' },
  documents: { label: 'Documenti', icon: FileText, color: 'slate' },
};

const BUCKET_MAP = {
  bank: 'bank-statements',
  invoices: 'invoices',
  payroll: 'employee-documents',
  balance_sheet: 'balance-sheets',
  pos_data: 'pos-data',
  receipts: 'receipts',
  general_docs: 'general-documents',
};

export default function ArchivioDocumenti() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [allDocs, setAllDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ─── LOAD ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!COMPANY_ID) return;
    loadAll();
  }, [COMPANY_ID]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    const results = [];

    // Each query wrapped individually
    try {
      const { data } = await supabase.from('import_documents').select('*').eq('company_id', COMPANY_ID).order('uploaded_at', { ascending: false }).limit(500);
      (data || []).forEach(d => results.push({ ...d, _table: 'import_documents', _date: d.uploaded_at || d.created_at, _status: d.status || d.upload_status || 'uploaded' }));
    } catch (e) { console.warn('import_documents:', e.message); }

    try {
      const { data } = await supabase.from('contract_documents').select('*').order('created_at', { ascending: false }).limit(500);
      (data || []).forEach(d => results.push({ ...d, _table: 'contract_documents', _date: d.created_at, _status: 'archiviato' }));
    } catch (e) { console.warn('contract_documents:', e.message); }

    try {
      const { data } = await supabase.from('employee_documents').select('*').eq('company_id', COMPANY_ID).order('created_at', { ascending: false }).limit(500);
      (data || []).forEach(d => results.push({ ...d, _table: 'employee_documents', _date: d.created_at, _status: d.status || 'archiviato' }));
    } catch (e) { console.warn('employee_documents:', e.message); }

    try {
      const { data } = await supabase.from('outlet_attachments').select('*').eq('company_id', COMPANY_ID).order('created_at', { ascending: false }).limit(500);
      (data || []).forEach(d => results.push({ ...d, _table: 'outlet_attachments', _date: d.created_at, _status: 'archiviato' }));
    } catch (e) { console.warn('outlet_attachments:', e.message); }

    try {
      const { data } = await supabase.from('documents').select('*').eq('company_id', COMPANY_ID).order('created_at', { ascending: false }).limit(500);
      (data || []).forEach(d => results.push({ ...d, _table: 'documents', _date: d.created_at, _status: d.document_status || 'archiviato' }));
    } catch (e) { console.warn('documents:', e.message); }

    setAllDocs(results);
    setLoading(false);
  }

  // ─── BUCKET RESOLVER ──────────────────────────────────────────
  function getBucket(doc) {
    if (doc._table === 'import_documents') return BUCKET_MAP[doc.source_type] || 'general-documents';
    if (doc._table === 'contract_documents') return 'contract-documents';
    if (doc._table === 'employee_documents') return 'employee-documents';
    if (doc._table === 'outlet_attachments') return doc.storage_bucket || 'outlet-attachments';
    if (doc._table === 'documents') return doc.storage_bucket || 'general-documents';
    return 'general-documents';
  }

  // ─── DOWNLOAD ─────────────────────────────────────────────────
  async function handleDownload(doc) {
    if (!doc.file_path) return;
    setDownloading(doc.id);
    try {
      const { data: blob, error } = await supabase.storage.from(getBucket(doc)).download(doc.file_path);
      if (error) throw error;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Download completato');
    } catch (err) {
      showToast('Errore download: ' + err.message, 'error');
    } finally {
      setDownloading(null);
    }
  }

  // ─── PREVIEW ──────────────────────────────────────────────────
  async function handlePreview(doc) {
    if (!doc.file_path) return;
    setPreviewDoc(doc);
    setPreviewUrl(null);
    try {
      const { data, error } = await supabase.storage.from(getBucket(doc)).createSignedUrl(doc.file_path, 3600);
      if (error) throw error;
      setPreviewUrl(data.signedUrl);
    } catch (err) {
      showToast('Errore anteprima', 'error');
      setPreviewDoc(null);
    }
  }

  // ─── HELPERS ──────────────────────────────────────────────────
  function getExt(doc) {
    const name = doc.file_name || doc.file_path || '';
    return name.split('.').pop()?.toLowerCase() || doc.file_type || '';
  }

  function canPreview(doc) {
    const ext = getExt(doc);
    return ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
  }

  function getSourceLabel(doc) {
    if (doc._table === 'import_documents') {
      const map = { bank: 'Estratto Conto', invoices: 'Fattura', payroll: 'Cedolino', balance_sheet: 'Bilancio', pos_data: 'Dati POS', receipts: 'Corrispettivi', general_docs: 'Generico' };
      return map[doc.source_type] || doc.source_type || 'Import';
    }
    if (doc._table === 'contract_documents') return 'Contratto';
    if (doc._table === 'employee_documents') return doc.doc_type || 'Dipendente';
    if (doc._table === 'outlet_attachments') return doc.attachment_type || 'Outlet';
    if (doc._table === 'documents') return doc.category || 'Documento';
    return 'Documento';
  }

  function formatSize(bytes) {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function formatDate(d) {
    if (!d) return '-';
    try { return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return '-'; }
  }

  // ─── STATS ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const bySource = {};
    allDocs.forEach(d => { bySource[d._table] = (bySource[d._table] || 0) + 1; });
    return { total: allDocs.length, bySource };
  }, [allDocs]);

  // ─── FILE TYPES FOR FILTER ────────────────────────────────────
  const fileTypes = useMemo(() => {
    const types = new Set();
    allDocs.forEach(d => { const e = getExt(d); if (e) types.add(e.toUpperCase()); });
    return Array.from(types).sort();
  }, [allDocs]);

  // ─── FILTERED + SORTED ────────────────────────────────────────
  const filteredDocs = useMemo(() => {
    let docs = [...allDocs];
    if (filterSource !== 'all') docs = docs.filter(d => d._table === filterSource);
    if (filterType !== 'all') docs = docs.filter(d => getExt(d).toUpperCase() === filterType);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter(d =>
        (d.file_name || '').toLowerCase().includes(q) ||
        (d.source_type || '').toLowerCase().includes(q) ||
        (d.category || '').toLowerCase().includes(q) ||
        (d.doc_type || '').toLowerCase().includes(q)
      );
    }
    if (sortBy === 'date_desc') docs.sort((a, b) => new Date(b._date || 0) - new Date(a._date || 0));
    else if (sortBy === 'date_asc') docs.sort((a, b) => new Date(a._date || 0) - new Date(b._date || 0));
    else if (sortBy === 'name') docs.sort((a, b) => (a.file_name || '').localeCompare(b.file_name || ''));
    else if (sortBy === 'size') docs.sort((a, b) => (b.file_size || 0) - (a.file_size || 0));
    return docs;
  }, [allDocs, filterSource, filterType, searchQuery, sortBy]);

  // ─── FILE ICON COLOR ──────────────────────────────────────────
  function fileIconStyle(doc) {
    const ext = getExt(doc);
    if (ext === 'pdf') return 'text-red-500 bg-red-50';
    if (['csv', 'xlsx', 'xls'].includes(ext)) return 'text-emerald-500 bg-emerald-50';
    if (ext === 'xml') return 'text-orange-500 bg-orange-50';
    if (['jpg', 'jpeg', 'png'].includes(ext)) return 'text-violet-500 bg-violet-50';
    return 'text-slate-500 bg-slate-50';
  }

  function statusBadge(status) {
    const s = (status || '').toLowerCase();
    if (['completed', 'parsed', 'archiviato'].includes(s)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (['processing', 'pending', 'uploaded', 'pending_parsing'].includes(s)) return 'bg-amber-50 text-amber-700 border-amber-200';
    if (['error', 'failed'].includes(s)) return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-slate-50 text-slate-600 border-slate-200';
  }

  // ─── RENDER ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 p-6 space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-100 rounded-xl">
            <Archive className="w-7 h-7 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Archivio Documenti</h1>
            <p className="text-sm text-slate-500">{stats.total} documenti totali</p>
          </div>
        </div>
        <button onClick={loadAll} disabled={loading} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 shadow-sm disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Aggiorna
        </button>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <FolderOpen size={14} className="text-blue-500" />
            <span className="text-xs font-semibold text-slate-500 uppercase">Totali</span>
          </div>
          <div className="text-xl font-bold text-slate-900">{stats.total}</div>
        </div>
        {Object.entries(SOURCE_META).map(([key, meta]) => {
          const count = stats.bySource[key] || 0;
          const Icon = meta.icon;
          const active = filterSource === key;
          return (
            <button
              key={key}
              onClick={() => setFilterSource(active ? 'all' : key)}
              className={`rounded-xl border p-3 shadow-sm text-left transition ${active ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200' : 'bg-white border-slate-200 hover:border-slate-300'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={14} className={active ? 'text-blue-600' : 'text-slate-400'} />
                <span className="text-xs font-semibold text-slate-500 uppercase truncate">{meta.label}</span>
              </div>
              <div className="text-xl font-bold text-slate-900">{count}</div>
            </button>
          );
        })}
      </div>

      {/* SEARCH BAR */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cerca per nome file, tipo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700">
            <option value="all">Tutti i formati</option>
            {fileTypes.map(t => <option key={t} value={t}>.{t.toLowerCase()}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700">
            <option value="date_desc">Più recenti</option>
            <option value="date_asc">Più vecchi</option>
            <option value="name">Nome A-Z</option>
            <option value="size">Dimensione</option>
          </select>
          {filterSource !== 'all' && (
            <button onClick={() => setFilterSource('all')} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold flex items-center gap-1 border border-blue-200">
              <X size={12} /> {SOURCE_META[filterSource]?.label}
            </button>
          )}
          <span className="text-xs text-slate-400 ml-auto">{filteredDocs.length} risultati</span>
        </div>
      </div>

      {/* LOADING */}
      {loading && (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Caricamento documenti...</p>
        </div>
      )}

      {/* TABLE */}
      {!loading && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {filteredDocs.length === 0 ? (
            <div className="text-center py-16">
              <FileWarning className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">Nessun documento trovato</p>
              <p className="text-xs text-slate-400 mt-1">Prova a modificare i filtri o importa documenti dall'Import Hub</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Documento</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Fonte</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Data</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Dim.</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Stato</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDocs.map((doc) => {
                    const ext = getExt(doc);
                    return (
                      <tr key={doc._table + '-' + doc.id} className="hover:bg-slate-50/60 transition group">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={'p-2 rounded-lg shrink-0 ' + fileIconStyle(doc).split(' ').slice(1).join(' ')}>
                              <FileText size={16} className={fileIconStyle(doc).split(' ')[0]} />
                            </div>
                            <span className="text-sm font-medium text-slate-800 truncate max-w-xs" title={doc.file_name}>
                              {doc.file_name || 'Senza nome'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                            {getSourceLabel(doc)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded uppercase">
                            {ext || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatDate(doc._date)}</td>
                        <td className="px-4 py-3 text-sm text-slate-500">{formatSize(doc.file_size)}</td>
                        <td className="px-4 py-3">
                          <span className={'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ' + statusBadge(doc._status)}>
                            {doc._status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                            {canPreview(doc) && doc.file_path && (
                              <button onClick={() => handlePreview(doc)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600" title="Anteprima">
                                <Eye size={16} />
                              </button>
                            )}
                            {doc.file_path && (
                              <button onClick={() => handleDownload(doc)} disabled={downloading === doc.id} className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 disabled:opacity-50" title="Scarica">
                                {downloading === doc.id ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PREVIEW MODAL */}
      {previewDoc && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => { setPreviewDoc(null); setPreviewUrl(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-red-500" />
                <span className="font-semibold text-slate-900 text-sm">{previewDoc.file_name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleDownload(previewDoc)} className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 flex items-center gap-1 border border-blue-200">
                  <Download size={13} /> Scarica
                </button>
                <button onClick={() => { setPreviewDoc(null); setPreviewUrl(null); }} className="p-1.5 hover:bg-slate-100 rounded-lg">
                  <X size={18} className="text-slate-500" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {previewUrl ? (
                <iframe src={previewUrl} className="w-full h-full min-h-[75vh]" title="Anteprima" />
              ) : (
                <div className="flex items-center justify-center h-[75vh]">
                  <RefreshCw size={24} className="animate-spin text-blue-600" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div className={'fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ' + (toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white')}>
          {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
