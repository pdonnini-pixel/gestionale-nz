import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText, Search, Filter, Download, Eye, Trash2, RefreshCw,
  Calendar, Building2, Users, Landmark, Receipt, BarChart3, Store,
  FileUp, X, ChevronDown, ChevronUp, Clock, FileWarning, CheckCircle,
  AlertCircle, Database, Paperclip, FolderOpen, Archive
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// ─── SOURCE DEFINITIONS ──────────────────────────────────────────
const DOC_SOURCES = {
  import_documents: {
    label: 'Importazioni',
    icon: Database,
    color: 'blue',
    bucketField: 'source_type', // bucket depends on source_type
    bucketMap: {
      bank: 'bank-statements',
      invoices: 'invoices',
      payroll: 'employee-documents',
      balance_sheet: 'balance-sheets',
      pos_data: 'pos-data',
      receipts: 'receipts',
      general_docs: 'general-documents',
    },
    sourceLabel: (row) => {
      const map = {
        bank: 'Estratto Conto',
        invoices: 'Fattura Elettronica',
        payroll: 'Cedolino',
        balance_sheet: 'Bilancio',
        pos_data: 'Dati POS',
        receipts: 'Corrispettivi',
        general_docs: 'Documento Generico',
      };
      return map[row.source_type] || row.source_type || 'Import';
    },
  },
  contract_documents: {
    label: 'Contratti',
    icon: Receipt,
    color: 'purple',
    bucket: 'contract-documents',
    sourceLabel: () => 'Allegato Contratto',
  },
  employee_documents: {
    label: 'Dipendenti',
    icon: Users,
    color: 'green',
    bucket: 'employee-documents',
    sourceLabel: (row) => {
      const map = { cedolino: 'Cedolino', comunicazione: 'Comunicazione', contratto: 'Contratto Lavoro' };
      return map[row.doc_type] || row.doc_type || 'Documento Dipendente';
    },
  },
  outlet_attachments: {
    label: 'Outlet',
    icon: Store,
    color: 'amber',
    bucket: 'outlet-attachments',
    sourceLabel: (row) => {
      const map = { planimetria: 'Planimetria', allegato: 'Allegato', comunicazione: 'Comunicazione' };
      return map[row.attachment_type] || row.attachment_type || 'Allegato Outlet';
    },
  },
  documents: {
    label: 'Documenti Generali',
    icon: FileText,
    color: 'slate',
    bucketField: 'storage_bucket',
    bucket: 'general-documents',
    sourceLabel: (row) => {
      const map = { fattura: 'Fattura', contratto: 'Contratto', allegato: 'Allegato', comunicazione: 'Comunicazione' };
      return map[row.category] || row.category || 'Documento';
    },
  },
};

const COLOR_MAP = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700' },
  green: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', badge: 'bg-green-100 text-green-700' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' },
  slate: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', badge: 'bg-slate-100 text-slate-700' },
};

export default function ArchivioDocumenti() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [allDocs, setAllDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [toast, setToast] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [stats, setStats] = useState({ total: 0, bySource: {} });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ─── LOAD ALL DOCUMENTS ──────────────────────────────────────
  const loadAllDocuments = useCallback(async () => {
    if (!COMPANY_ID) return;
    setLoading(true);

    try {
      const results = [];

      // 1. import_documents (central import registry)
      const { data: imports } = await supabase
        .from('import_documents')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('uploaded_at', { ascending: false });

      (imports || []).forEach(doc => {
        results.push({
          ...doc,
          _table: 'import_documents',
          _date: doc.uploaded_at || doc.created_at,
          _status: doc.status || doc.upload_status || 'uploaded',
        });
      });

      // 2. contract_documents
      const { data: contracts } = await supabase
        .from('contract_documents')
        .select('*, contracts(title, outlet_code)')
        .eq('company_id', COMPANY_ID)
        .order('created_at', { ascending: false });

      (contracts || []).forEach(doc => {
        results.push({
          ...doc,
          _table: 'contract_documents',
          _date: doc.created_at,
          _status: 'archiviato',
          _ref: doc.contracts?.title || doc.contracts?.outlet_code || null,
        });
      });

      // 3. employee_documents
      const { data: empDocs } = await supabase
        .from('employee_documents')
        .select('*, employees(nome, cognome)')
        .eq('company_id', COMPANY_ID)
        .order('created_at', { ascending: false });

      (empDocs || []).forEach(doc => {
        results.push({
          ...doc,
          _table: 'employee_documents',
          _date: doc.created_at,
          _status: doc.status || 'archiviato',
          _ref: doc.employees ? `${doc.employees.cognome} ${doc.employees.nome}` : null,
        });
      });

      // 4. outlet_attachments
      const { data: outletDocs } = await supabase
        .from('outlet_attachments')
        .select('*, outlets(name)')
        .eq('company_id', COMPANY_ID)
        .order('created_at', { ascending: false });

      (outletDocs || []).forEach(doc => {
        results.push({
          ...doc,
          _table: 'outlet_attachments',
          _date: doc.created_at,
          _status: 'archiviato',
          _ref: doc.outlets?.name || null,
        });
      });

      // 5. documents (general)
      const { data: genDocs } = await supabase
        .from('documents')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('created_at', { ascending: false });

      (genDocs || []).forEach(doc => {
        results.push({
          ...doc,
          _table: 'documents',
          _date: doc.created_at || doc.updated_at,
          _status: doc.document_status || 'archiviato',
        });
      });

      setAllDocs(results);

      // Compute stats
      const bySource = {};
      for (const d of results) {
        bySource[d._table] = (bySource[d._table] || 0) + 1;
      }
      setStats({ total: results.length, bySource });

    } catch (err) {
      console.error('ArchivioDocumenti load error:', err);
      showToast('Errore caricamento documenti', 'error');
    } finally {
      setLoading(false);
    }
  }, [COMPANY_ID]);

  useEffect(() => {
    loadAllDocuments();
  }, [loadAllDocuments]);

  // ─── BUCKET RESOLVER ─────────────────────────────────────────
  function getBucket(doc) {
    const src = DOC_SOURCES[doc._table];
    if (!src) return 'general-documents';
    if (src.bucket) return src.bucket;
    if (src.bucketField === 'storage_bucket' && doc.storage_bucket) return doc.storage_bucket;
    if (src.bucketField === 'source_type' && src.bucketMap) {
      return src.bucketMap[doc.source_type] || 'general-documents';
    }
    return 'general-documents';
  }

  // ─── DOWNLOAD ─────────────────────────────────────────────────
  async function handleDownload(doc) {
    if (!doc.file_path) { showToast('File path non disponibile', 'error'); return; }
    setDownloading(doc.id);
    try {
      const bucket = getBucket(doc);
      const { data: blob, error } = await supabase.storage.from(bucket).download(doc.file_path);
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
      console.error('Download error:', err);
      showToast('Errore download: ' + err.message, 'error');
    } finally {
      setDownloading(null);
    }
  }

  // ─── PREVIEW ──────────────────────────────────────────────────
  async function handlePreview(doc) {
    if (!doc.file_path) { showToast('File path non disponibile', 'error'); return; }
    setPreviewDoc(doc);
    setPreviewUrl(null);
    try {
      const bucket = getBucket(doc);
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(doc.file_path, 3600);
      if (error) throw error;
      setPreviewUrl(data.signedUrl);
    } catch (err) {
      console.error('Preview error:', err);
      showToast('Errore anteprima', 'error');
      setPreviewDoc(null);
    }
  }

  function closePreview() {
    setPreviewDoc(null);
    setPreviewUrl(null);
  }

  // ─── FILE TYPE DETECTION ──────────────────────────────────────
  function getFileExt(doc) {
    const name = doc.file_name || doc.file_path || '';
    const ext = name.split('.').pop()?.toLowerCase();
    return ext || doc.file_type || 'unknown';
  }

  function isPDF(doc) { return getFileExt(doc) === 'pdf'; }
  function isImage(doc) { return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(getFileExt(doc)); }
  function isPreviewable(doc) { return isPDF(doc) || isImage(doc); }

  // ─── UNIQUE FILE TYPES FOR FILTER ─────────────────────────────
  const fileTypes = useMemo(() => {
    const types = new Set();
    allDocs.forEach(d => {
      const ext = getFileExt(d);
      if (ext && ext !== 'unknown') types.add(ext.toUpperCase());
    });
    return ['all', ...Array.from(types).sort()];
  }, [allDocs]);

  // ─── FILTERED + SORTED ────────────────────────────────────────
  const filteredDocs = useMemo(() => {
    let docs = [...allDocs];

    // Filter by source table
    if (filterSource !== 'all') {
      docs = docs.filter(d => d._table === filterSource);
    }

    // Filter by file type
    if (filterType !== 'all') {
      docs = docs.filter(d => getFileExt(d).toUpperCase() === filterType);
    }

    // Search by file name
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter(d =>
        (d.file_name || '').toLowerCase().includes(q) ||
        (d._ref || '').toLowerCase().includes(q) ||
        (d.source_type || '').toLowerCase().includes(q) ||
        (d.category || '').toLowerCase().includes(q) ||
        (d.doc_type || '').toLowerCase().includes(q)
      );
    }

    // Sort
    if (sortBy === 'date_desc') docs.sort((a, b) => new Date(b._date || 0) - new Date(a._date || 0));
    else if (sortBy === 'date_asc') docs.sort((a, b) => new Date(a._date || 0) - new Date(b._date || 0));
    else if (sortBy === 'name') docs.sort((a, b) => (a.file_name || '').localeCompare(b.file_name || ''));
    else if (sortBy === 'size') docs.sort((a, b) => (b.file_size || 0) - (a.file_size || 0));

    return docs;
  }, [allDocs, filterSource, filterType, searchQuery, sortBy]);

  // ─── STATUS STYLING ───────────────────────────────────────────
  function getStatusStyle(status) {
    const s = (status || '').toLowerCase();
    if (['completed', 'parsed', 'archiviato'].includes(s))
      return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: CheckCircle };
    if (['processing', 'pending', 'uploaded', 'pending_parsing'].includes(s))
      return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: Clock };
    if (['error', 'failed'].includes(s))
      return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: AlertCircle };
    return { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: FileText };
  }

  function getFileIcon(doc) {
    const ext = getFileExt(doc);
    if (ext === 'pdf') return { color: 'text-red-500', bg: 'bg-red-50' };
    if (['csv', 'xlsx', 'xls'].includes(ext)) return { color: 'text-emerald-500', bg: 'bg-emerald-50' };
    if (['xml'].includes(ext)) return { color: 'text-orange-500', bg: 'bg-orange-50' };
    if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return { color: 'text-violet-500', bg: 'bg-violet-50' };
    if (['doc', 'docx'].includes(ext)) return { color: 'text-blue-500', bg: 'bg-blue-50' };
    return { color: 'text-slate-500', bg: 'bg-slate-50' };
  }

  const formatSize = (bytes) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ─── RENDER ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Caricamento archivio documenti...</p>
        </div>
      </div>
    );
  }

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
            <p className="text-sm text-slate-500">Tutti i documenti importati e archiviati — {stats.total} file totali</p>
          </div>
        </div>
        <button
          onClick={loadAllDocuments}
          className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 shadow-sm"
        >
          <RefreshCw size={15} /> Aggiorna
        </button>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {/* Total */}
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <FolderOpen size={14} className="text-blue-500" />
            <span className="text-xs font-semibold text-slate-500 uppercase">Totali</span>
          </div>
          <div className="text-xl font-bold text-slate-900">{stats.total}</div>
        </div>
        {/* Per source */}
        {Object.entries(DOC_SOURCES).map(([key, src]) => {
          const count = stats.bySource[key] || 0;
          const colors = COLOR_MAP[src.color];
          const Icon = src.icon;
          return (
            <button
              key={key}
              onClick={() => setFilterSource(filterSource === key ? 'all' : key)}
              className={`rounded-xl border p-3 shadow-sm text-left transition ${
                filterSource === key
                  ? `${colors.bg} ${colors.border} ring-2 ring-offset-1 ring-${src.color}-300`
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={14} className={colors.text} />
                <span className="text-xs font-semibold text-slate-500 uppercase truncate">{src.label}</span>
              </div>
              <div className="text-xl font-bold text-slate-900">{count}</div>
            </button>
          );
        })}
      </div>

      {/* SEARCH + FILTERS BAR */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cerca per nome file, riferimento, tipo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>

          {/* File type */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Tutti i formati</option>
            {fileTypes.filter(t => t !== 'all').map(t => (
              <option key={t} value={t}>.{t.toLowerCase()}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-blue-500"
          >
            <option value="date_desc">Più recenti</option>
            <option value="date_asc">Più vecchi</option>
            <option value="name">Nome A-Z</option>
            <option value="size">Dimensione</option>
          </select>

          {/* Filter source reset */}
          {filterSource !== 'all' && (
            <button
              onClick={() => setFilterSource('all')}
              className="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold flex items-center gap-1 border border-blue-200"
            >
              <X size={12} /> {DOC_SOURCES[filterSource]?.label}
            </button>
          )}

          <span className="text-xs text-slate-400 ml-auto">{filteredDocs.length} risultati</span>
        </div>
      </div>

      {/* DOCUMENTS TABLE */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filteredDocs.length === 0 ? (
          <div className="text-center py-16">
            <FileWarning className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">Nessun documento trovato</p>
            <p className="text-xs text-slate-400 mt-1">Prova a modificare i filtri di ricerca</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-[40%]">Documento</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Fonte</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Data</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Dimensione</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Stato</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocs.map((doc) => {
                  const src = DOC_SOURCES[doc._table];
                  const srcColors = COLOR_MAP[src?.color || 'slate'];
                  const fileStyle = getFileIcon(doc);
                  const statusStyle = getStatusStyle(doc._status);
                  const StatusIcon = statusStyle.icon;
                  const ext = getFileExt(doc);

                  return (
                    <tr key={`${doc._table}-${doc.id}`} className="hover:bg-slate-50/60 transition group">
                      {/* File name + ref */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${fileStyle.bg} shrink-0`}>
                            <FileText size={16} className={fileStyle.color} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-800 truncate max-w-xs" title={doc.file_name}>
                              {doc.file_name || 'Senza nome'}
                            </div>
                            {doc._ref && (
                              <div className="text-xs text-slate-400 truncate">
                                {doc._ref}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Source badge */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${srcColors.badge}`}>
                          {src?.sourceLabel(doc)}
                        </span>
                      </td>

                      {/* File extension */}
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded uppercase">
                          {ext}
                        </span>
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                        {doc._date ? new Date(doc._date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                      </td>

                      {/* Size */}
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {formatSize(doc.file_size)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                          <StatusIcon size={11} />
                          {doc._status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                          {isPreviewable(doc) && doc.file_path && (
                            <button
                              onClick={() => handlePreview(doc)}
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition"
                              title="Anteprima"
                            >
                              <Eye size={16} />
                            </button>
                          )}
                          {doc.file_path && (
                            <button
                              onClick={() => handleDownload(doc)}
                              disabled={downloading === doc.id}
                              className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition disabled:opacity-50"
                              title="Scarica"
                            >
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

      {/* PDF/IMAGE PREVIEW MODAL */}
      {previewDoc && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closePreview}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-red-500" />
                <span className="font-semibold text-slate-900 text-sm">{previewDoc.file_name}</span>
                {previewDoc.file_size && <span className="text-xs text-slate-400">{formatSize(previewDoc.file_size)}</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownload(previewDoc); }}
                  className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 flex items-center gap-1 border border-blue-200"
                >
                  <Download size={13} /> Scarica
                </button>
                <button onClick={closePreview} className="p-1.5 hover:bg-slate-100 rounded-lg">
                  <X size={18} className="text-slate-500" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {previewUrl ? (
                isImage(previewDoc) ? (
                  <div className="flex items-center justify-center h-full p-4 bg-slate-50">
                    <img src={previewUrl} alt={previewDoc.file_name} className="max-w-full max-h-[75vh] object-contain rounded-lg shadow" />
                  </div>
                ) : (
                  <iframe src={previewUrl} className="w-full h-full min-h-[75vh]" title="Anteprima documento" />
                )
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
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 transition-all ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
        }`}>
          {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
