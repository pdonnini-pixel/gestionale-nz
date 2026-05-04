// @ts-nocheck — TODO tighten: pagina complessa con shape Supabase + indexing dinamico, da rivedere
import { useState, useEffect, lazy, Suspense } from 'react'
import PageHelp from '../components/PageHelp'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  Store, RefreshCw, MapPin, Calendar, Target, TrendingUp,
  ChevronRight, ArrowLeft, DollarSign, Users, FileText, X, Search, Plus,
  Upload, Paperclip, CheckCircle2, AlertCircle, Clock, Trash2, Download,
  Eye, Filter, Folder, Bell, History, User
} from 'lucide-react'
import OutletWizard from '../components/OutletWizard'
import OutletValutazione from '../components/OutletValutazione'
const PdfViewer = lazy(() => import('../components/PdfViewer'))
import ContractUploader from '../components/ContractUploader'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'
import { formatOutletName } from '../lib/formatters'

const MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const DOCUMENT_CATEGORIES = [
  { value: 'contratto', label: 'Contratto' },
  { value: 'allegato', label: 'Allegato' },
  { value: 'rinnovo', label: 'Rinnovo' },
  { value: 'comunicazione', label: 'Comunicazione' }
]

function fmt(n: number | null | undefined, decimals = 0) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n)
}

// Calcola lo status outlet dinamicamente da opening_date / closing_date.
// Fallback su is_active solo se le date non sono disponibili.
// TODO: tighten type
function getOutletStatus(outlet: any) {
  if (!outlet) return 'attivo'
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const opening = outlet.opening_date ? new Date(outlet.opening_date) : null
  const closing = outlet.closing_date ? new Date(outlet.closing_date) : null

  // Outlet chiuso (data di chiusura nel passato)
  if (closing && closing < today) return 'chiuso'
  // Outlet programmato (data apertura futura)
  if (opening && opening > today) return 'programmato'
  // Senza data apertura: usa flag is_active
  if (!opening) return outlet.is_active === false ? 'chiuso' : 'attivo'
  // Outlet aperto e non chiuso
  return 'attivo'
}

const OUTLET_STATUS_STYLE = {
  attivo: { label: 'Attivo', cls: 'bg-emerald-50 text-emerald-700' },
  programmato: { label: 'Programmato', cls: 'bg-blue-50 text-blue-700' },
  chiuso: { label: 'Chiuso', cls: 'bg-slate-100 text-slate-500' },
}

// TODO: tighten type
function StatusBadge({ isActive, outlet }: { isActive?: boolean; outlet?: any }) {
  // Se viene passato l'outlet completo, usa il calcolo dinamico
  if (outlet && (outlet.opening_date !== undefined || outlet.closing_date !== undefined)) {
    const status = getOutletStatus(outlet)
    const cfg = OUTLET_STATUS_STYLE[status as keyof typeof OUTLET_STATUS_STYLE] || OUTLET_STATUS_STYLE.attivo
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
        {cfg.label}
      </span>
    )
  }
  // Fallback: comportamento originale (per usi su Dipendenti, ecc.)
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
      isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
    }`}>
      {isActive ? 'Attivo' : 'Chiuso'}
    </span>
  )
}

// ====== GRIGLIA OUTLET ======
// TODO: tighten type
function OutletGrid({ outlets, revenue, onSelect }: { outlets: any[]; revenue: Record<string, any>; onSelect: (outlet: any) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {outlets.map(outlet => {
        const outletRev = revenue[outlet.id] || {}
        const ytd = Object.values(outletRev).reduce((s: number, v: any) => s + v, 0)
        const months = Object.keys(outletRev).length

        return (
          <div
            key={outlet.id}
            onClick={() => onSelect(outlet)}
            className="rounded-2xl p-5 shadow-lg hover:shadow-xl cursor-pointer transition group"
            style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600">
                  <Store size={20} />
                </div>
                <div>
                  <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition">
                    {formatOutletName(outlet.name)}
                  </div>
                  <div className="text-xs text-slate-400">{outlet.code}</div>
                </div>
              </div>
              <StatusBadge outlet={outlet} isActive={outlet.is_active} />
            </div>

            <div className="space-y-2 text-sm">
              {outlet.mall_name && (
                <div className="flex items-center gap-2 text-slate-500">
                  <MapPin size={14} />
                  <span>{outlet.mall_name}</span>
                </div>
              )}
              {outlet.opening_date && (
                <div className="flex items-center gap-2 text-slate-500">
                  <Calendar size={14} />
                  <span>Apertura: {new Date(outlet.opening_date).toLocaleDateString('it-IT')}</span>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">Fatturato YTD</div>
                <div className="text-lg font-bold text-slate-900">{fmt(ytd)} €</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">Mesi attivi</div>
                <div className="text-lg font-bold text-slate-600">{months}</div>
              </div>
              <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-400 transition" />
            </div>

            {outlet.min_revenue_target && (
              <div className="mt-2 text-xs text-slate-400">
                <Target size={12} className="inline mr-1" />
                Target: {fmt(outlet.min_revenue_target)} €
                {outlet.min_revenue_period && ` / ${outlet.min_revenue_period}`}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ====== MODAL CONFERMA ELIMINAZIONE ======
function DeleteConfirmModal({ title, message, onConfirm, onCancel, loading: delLoading }: { title: string; message: string; onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-full bg-red-50">
            <Trash2 size={22} className="text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500">Questa azione non può essere annullata</p>
          </div>
        </div>
        <p className="text-sm text-slate-700 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition"
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            disabled={delLoading}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50"
          >
            {delLoading ? 'Eliminazione...' : 'Elimina'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ====== DOCUMENT ARCHIVE ======
function DocumentArchive({ outletId, companyId }: { outletId: string; companyId: string }) {
  const { profile } = useAuth()
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadCategory, setUploadCategory] = useState('contratto')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [versionHistory, setVersionHistory] = useState(null)

  useEffect(() => {
    loadDocuments()
  }, [outletId])

  async function loadDocuments() {
    setLoading(true)
    try {
      // Load from contract_documents table
      const { data: contractDocs } = await supabase
        .from('contract_documents')
        .select('*')
        .eq('outlet_id', outletId)
        .order('created_at', { ascending: false })

      // Load from documents table (with reference_type = outlet)
      const { data: refDocs } = await supabase
        .from('documents')
        .select('*')
        .eq('reference_type', 'outlet')
        .eq('reference_id', outletId)
        .order('created_at', { ascending: false })

      // Merge both sources
      const allDocs = [
        ...(contractDocs || []).map(d => ({ ...d, source: 'contract_documents' })),
        ...(refDocs || []).map(d => ({ ...d, source: 'documents' }))
      ]
      setDocuments(allDocs)
    } catch (err) {
      console.error('Error loading documents:', err)
    } finally {
      setLoading(false)
    }
  }

  function closePreviewDoc() {
    if (previewDoc?.blobUrl) URL.revokeObjectURL(previewDoc.blobUrl)
    setPreviewDoc(null)
  }

  const UPLOAD_BUCKET = 'outlet-attachments'

  async function getSignedUrl(doc) {
    const filePath = doc.file_path || doc.file_name
    if (!filePath) return null
    // Usa il bucket salvato se disponibile, altrimenti il default
    const bucket = doc.storage_bucket || UPLOAD_BUCKET
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, 3600)
    if (data?.signedUrl && !error) return data.signedUrl
    return null
  }

  async function handlePreview(doc) {
    const filePath = doc.file_path || doc.file_name
    if (!filePath) { alert('File non trovato'); return }
    const bucket = doc.storage_bucket || UPLOAD_BUCKET
    // Scarica il file come blob tramite Supabase client (no CORS issues)
    const { data: blob, error } = await supabase.storage
      .from(bucket)
      .download(filePath)
    if (error || !blob) {
      // Fallback: prova signed URL
      const url = await getSignedUrl(doc)
      if (url) {
        setPreviewDoc({ ...doc, signedUrl: url, pdfData: null })
      } else {
        alert('File non trovato nello storage')
      }
      return
    }
    const arrayBuffer = await blob.arrayBuffer()
    // Crea blob URL per immagini
    const blobUrl = URL.createObjectURL(blob)
    // Ottieni anche signed URL per download button
    const url = await getSignedUrl(doc)
    setPreviewDoc({ ...doc, signedUrl: url, pdfData: arrayBuffer, blobUrl })
  }

  async function handleDownload(doc) {
    const url = await getSignedUrl(doc)
    if (url) {
      window.open(url, '_blank')
    } else {
      alert('File non trovato nello storage')
    }
  }

  async function confirmDeleteDocument() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const doc = deleteTarget
      const table = doc.source === 'contract_documents' ? 'contract_documents' : 'documents'
      await supabase.from(table).delete().eq('id', doc.id)
      if (doc.file_path) {
        const buckets = doc.storage_bucket
          ? [doc.storage_bucket]
          : [UPLOAD_BUCKET, 'contract-documents', 'general-documents']
        for (const bucket of buckets) {
          await supabase.storage.from(bucket).remove([doc.file_path])
        }
      }
      setDeleteTarget(null)
      await loadDocuments()
    } catch (err) {
      console.error('Delete error:', err)
      alert('Errore eliminazione: ' + (err.message || ''))
    } finally {
      setDeleting(false)
    }
  }

  const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

  // Upload singolo file con versioning + audit trail
  async function uploadSingleDocument(file) {
    if (file.size > MAX_FILE_SIZE) {
      return { error: `${file.name}: troppo grande (${(file.size / 1024 / 1024).toFixed(1)} MB, max 50 MB)` }
    }
    const cid = companyId
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = `${cid}/${outletId}/${timestamp}_${safeName}`

    // Versioning: cerca documento esistente con stesso nome
    const existing = documents.find(d => d.file_name === file.name)
    if (existing) {
      // Salva versione precedente
      await supabase.from('document_versions').insert({
        document_id: existing.id,
        document_table: existing.source || 'documents',
        version_number: (existing.version_count || 0) + 1,
        file_name: existing.file_name,
        file_path: existing.file_path,
        file_size: existing.file_size,
        storage_bucket: existing.storage_bucket || UPLOAD_BUCKET,
        uploaded_by: existing.uploaded_by,
        uploaded_by_name: existing.uploaded_by_name,
      })
    }

    // Upload su storage
    const { error: upErr } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .upload(filePath, file, { upsert: false })
    if (upErr) return { error: `${file.name}: ${upErr.message}` }

    // Audit trail: chi ha caricato
    const uploadedBy = profile?.id || null
    const uploadedByName = profile?.full_name || profile?.email || 'Utente'

    if (existing) {
      // Aggiorna documento esistente (sovrascrive con nuova versione)
      const table = existing.source === 'contract_documents' ? 'contract_documents' : 'documents'
      await supabase.from(table).update({
        file_path: filePath,
        file_size: file.size,
        uploaded_by: uploadedBy,
        uploaded_by_name: uploadedByName,
      }).eq('id', existing.id)
    } else {
      // Crea nuovo record
      const { error: dbErr } = await supabase.from('documents').insert({
        company_id: cid,
        reference_type: 'outlet',
        reference_id: outletId,
        category: uploadCategory,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        storage_bucket: UPLOAD_BUCKET,
        uploaded_by: uploadedBy,
        uploaded_by_name: uploadedByName,
      })
      if (dbErr) return { error: `${file.name}: ${dbErr.message}` }
    }
    return { ok: true }
  }

  // Upload multiplo (batch)
  async function handleUploadDocuments(files) {
    if (!files || files.length === 0) return
    setUploading(true)
    const errors = []
    for (const file of files) {
      const result = await uploadSingleDocument(file)
      if (result.error) errors.push(result.error)
    }
    if (errors.length > 0) {
      alert('Errori durante upload:\n' + errors.join('\n'))
    }
    await loadDocuments()
    setUploading(false)
  }

  // Singolo file (compatibilità)
  async function handleUploadDocument(file) {
    await handleUploadDocuments([file])
  }

  // Drag & Drop handlers
  function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); setDragOver(true) }
  function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); setDragOver(false) }
  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) handleUploadDocuments(files)
  }

  // Carica storico versioni
  async function loadVersionHistory(doc) {
    const { data } = await supabase
      .from('document_versions')
      .select('*')
      .eq('document_id', doc.id)
      .order('created_at', { ascending: false })
    setVersionHistory({ doc, versions: data || [] })
  }

  if (loading) {
    return (
      <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <div className="text-sm text-slate-400 text-center py-4">Caricamento archivio contratti...</div>
      </div>
    )
  }

  // Filtra per categoria E per ricerca full-text
  const filtered = documents
    .filter(d => selectedCategory ? d.category === selectedCategory : true)
    .filter(d => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (d.file_name?.toLowerCase().includes(q)) ||
             (d.category?.toLowerCase().includes(q)) ||
             (d.description?.toLowerCase().includes(q)) ||
             (d.uploaded_by_name?.toLowerCase().includes(q))
    })

  const uploadSection = (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
      {/* Drag & Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-4 text-center transition cursor-pointer ${
          dragOver
            ? 'border-blue-400 bg-blue-50 text-blue-600'
            : 'border-slate-200 text-slate-400 hover:border-slate-300'
        }`}
      >
        <Upload size={20} className="mx-auto mb-1" />
        <div className="text-xs">
          {uploading ? 'Caricamento in corso...' : 'Trascina file qui oppure usa il bottone sotto'}
        </div>
        <div className="text-xs opacity-60 mt-1">Supporta upload multiplo (max 50 MB/file)</div>
      </div>
      {/* Upload button row */}
      <div className="flex items-center gap-2">
        <select
          value={uploadCategory}
          onChange={e => setUploadCategory(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
        >
          {DOCUMENT_CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <label className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg cursor-pointer transition ${
          uploading
            ? 'bg-slate-100 text-slate-400'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}>
          {uploading ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? 'Caricamento...' : 'Carica documenti'}
          <input
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx,.txt"
            disabled={uploading}
            onChange={e => { if (e.target.files?.length) handleUploadDocuments(Array.from(e.target.files)); e.target.value = '' }}
          />
        </label>
      </div>
    </div>
  )

  if (documents.length === 0) {
    return (
      <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-3">
          <Folder size={16} />
          Archivio documenti
        </h3>
        <div className="text-sm text-slate-400 text-center py-4">
          <FileText size={32} className="mx-auto mb-2 opacity-40" />
          Nessun documento caricato per questo outlet.
        </div>
        {uploadSection}
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Folder size={16} />
          Archivio documenti
        </h3>
        <div className="text-xs text-slate-500">
          {documents.length} document{documents.length !== 1 ? 'i' : 'o'}
        </div>
      </div>

      {/* Search + Category filters */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Cerca nei documenti..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-3 py-1.5 text-xs rounded-lg transition ${
            selectedCategory === null
              ? 'bg-blue-100 text-blue-700 border border-blue-300'
              : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-150'
          }`}
        >
          Tutti
        </button>
        {DOCUMENT_CATEGORIES.map(cat => (
          <button
            key={cat.value}
            onClick={() => setSelectedCategory(cat.value)}
            className={`px-3 py-1.5 text-xs rounded-lg transition ${
              selectedCategory === cat.value
                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-150'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Documents list */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-4">
            Nessun documento in questa categoria
          </div>
        ) : (
          filtered.map(doc => (
            <div
              key={`${doc.source}-${doc.id}`}
              className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900">{doc.file_name}</div>
                <div className="text-xs text-slate-500 space-x-2">
                  <span>{doc.category ? DOCUMENT_CATEGORIES.find(c => c.value === doc.category)?.label : 'Documento'}</span>
                  {doc.file_size && (
                    <>
                      <span>•</span>
                      <span>{(doc.file_size / 1024 / 1024).toFixed(2)} MB</span>
                    </>
                  )}
                  {doc.created_at && (
                    <>
                      <span>•</span>
                      <span>{new Date(doc.created_at).toLocaleDateString('it-IT')}</span>
                    </>
                  )}
                  {doc.uploaded_by_name && (
                    <>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1"><User size={10} /> {doc.uploaded_by_name}</span>
                    </>
                  )}
                </div>
              </div>
              {/* Version history button */}
              <button
                onClick={() => loadVersionHistory(doc)}
                className="p-2 rounded-lg hover:bg-slate-100 transition text-slate-400 hover:text-slate-600"
                title="Storico versioni"
              >
                <History size={16} />
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handlePreview(doc)}
                  className="p-2 rounded-lg hover:bg-blue-100 transition text-blue-600"
                  title="Anteprima"
                >
                  <Eye size={16} />
                </button>
                <button
                  onClick={() => handleDownload(doc)}
                  className="p-2 rounded-lg hover:bg-slate-200 transition text-slate-600"
                  title="Scarica"
                >
                  <Download size={16} />
                </button>
                <button
                  onClick={() => setDeleteTarget(doc)}
                  className="p-2 rounded-lg hover:bg-red-100 transition text-red-500"
                  title="Elimina"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Upload section */}
      {uploadSection}

      {/* Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => closePreviewDoc()}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl overflow-hidden flex flex-col" style={{ height: '90vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200 shrink-0">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-slate-900 truncate">{previewDoc.file_name}</h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => window.open(previewDoc.signedUrl, '_blank')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 transition text-slate-600"
                >
                  <Download size={14} />
                  Scarica
                </button>
                <button
                  onClick={() => closePreviewDoc()}
                  className="p-2 rounded-lg hover:bg-slate-100 transition"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {previewDoc.file_name?.toLowerCase().match(/\.pdf$/i) ? (
                <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>}><PdfViewer pdfData={previewDoc.pdfData} url={previewDoc.signedUrl} /></Suspense>
              ) : previewDoc.file_name?.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                <div className="flex items-center justify-center h-full p-6">
                  <img src={previewDoc.blobUrl || previewDoc.signedUrl} alt={previewDoc.file_name} className="max-w-full max-h-full rounded-lg shadow object-contain" />
                </div>
              ) : previewDoc.file_name?.toLowerCase().match(/\.(doc|docx|xls|xlsx)$/i) ? (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <p className="text-center">
                    Anteprima non disponibile per file Word/Excel.<br/>
                    <button
                      onClick={() => window.open(previewDoc.signedUrl, '_blank')}
                      className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                    >
                      Scarica il file
                    </button>
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <p className="text-center">
                    Anteprima non disponibile per questo tipo di file.<br/>
                    <button
                      onClick={() => window.open(previewDoc.signedUrl, '_blank')}
                      className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                      Scarica il file
                    </button>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {versionHistory && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setVersionHistory(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <History size={18} />
                Storico versioni
              </h3>
              <button onClick={() => setVersionHistory(null)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-3">{versionHistory.doc.file_name}</p>
            {versionHistory.versions.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-6">
                <History size={24} className="mx-auto mb-2 opacity-40" />
                Nessuna versione precedente.<br/>
                Lo storico viene creato quando un file viene sovrascritto.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-auto">
                {versionHistory.versions.map((v, i) => (
                  <div key={v.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 text-sm">
                    <div className="p-1.5 rounded bg-slate-100 text-slate-500 text-xs font-mono">v{v.version_number}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-700 truncate">{v.file_name}</div>
                      <div className="text-xs text-slate-400">
                        {new Date(v.created_at).toLocaleString('it-IT')}
                        {v.uploaded_by_name && ` — ${v.uploaded_by_name}`}
                        {v.file_size && ` — ${(v.file_size / 1024 / 1024).toFixed(2)} MB`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          title="Elimina documento"
          message={<>Sei sicuro di voler eliminare <strong>{deleteTarget.file_name}</strong>? Il file verrà rimosso dallo storage.</>}
          onConfirm={confirmDeleteDocument}
          onCancel={() => setDeleteTarget(null)}
          loading={deleting}
        />
      )}
    </div>
  )
}

// ====== EXTRACTED CONTRACT DATA ======
// TODO: tighten type
function ExtractedContractData({ outlet }: { outlet: any }) {
  const hasContractData = outlet.contract_start || outlet.rent_annual || outlet.deposit_guarantee
    || outlet.contract_duration_months || outlet.contract_end

  if (!hasContractData) return null

  const calculateEndDate = () => {
    if (outlet.contract_end) return new Date(outlet.contract_end)
    if (outlet.contract_start && outlet.contract_duration_months) {
      const d = new Date(outlet.contract_start)
      d.setMonth(d.getMonth() + parseInt(outlet.contract_duration_months))
      return d
    }
    return null
  }

  const endDate = calculateEndDate()
  const daysToEnd = endDate ? Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)) : null
  const isExpiring = daysToEnd && daysToEnd > 0 && daysToEnd < 180

  return (
    <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <h3 className="text-sm font-semibold text-slate-900 mb-4">Dati estratti dal contratto</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* Key Dates Section */}
        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Date Chiave</div>
          {outlet.contract_start && (
            <div className="flex items-start gap-3">
              <Calendar size={16} className="mt-0.5 text-blue-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Inizio contratto</div>
                <div className="text-sm font-medium text-slate-900">{new Date(outlet.contract_start).toLocaleDateString('it-IT')}</div>
              </div>
            </div>
          )}
          {endDate && (
            <div className="flex items-start gap-3">
              <Calendar size={16} className={`mt-0.5 shrink-0 ${isExpiring ? 'text-amber-600' : 'text-slate-400'}`} />
              <div>
                <div className="text-xs text-slate-500">Fine contratto</div>
                <div className={`text-sm font-medium ${isExpiring ? 'text-amber-600' : 'text-slate-900'}`}>
                  {endDate.toLocaleDateString('it-IT')}
                  {isExpiring && <span className="ml-2 text-xs bg-amber-100 px-2 py-0.5 rounded text-amber-700">Scade tra {daysToEnd} gg</span>}
                </div>
              </div>
            </div>
          )}
          {outlet.exit_clause_month && (
            <div className="flex items-start gap-3">
              <Clock size={16} className="mt-0.5 text-purple-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Clausola uscita</div>
                <div className="text-sm font-medium text-slate-900">Mese {outlet.exit_clause_month}</div>
              </div>
            </div>
          )}
        </div>

        {/* Key Amounts Section */}
        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Importi</div>
          {outlet.rent_annual && (
            <div className="flex items-start gap-3">
              <DollarSign size={16} className="mt-0.5 text-emerald-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Canone annuo</div>
                <div className="text-sm font-medium text-slate-900">{fmt(outlet.rent_annual)} €</div>
              </div>
            </div>
          )}
          {outlet.rent_per_sqm && outlet.sqm && (
            <div className="flex items-start gap-3">
              <Target size={16} className="mt-0.5 text-emerald-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Canone €/mq</div>
                <div className="text-sm font-medium text-slate-900">{fmt(outlet.rent_per_sqm, 2)} € ({outlet.sqm} mq)</div>
              </div>
            </div>
          )}
          {outlet.deposit_guarantee && (
            <div className="flex items-start gap-3">
              <DollarSign size={16} className="mt-0.5 text-red-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Fideiussione</div>
                <div className="text-sm font-medium text-slate-900">{fmt(outlet.deposit_guarantee)} €</div>
              </div>
            </div>
          )}
        </div>

        {/* Key Clauses Section */}
        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Condizioni</div>
          {outlet.variable_rent_pct && (
            <div className="flex items-start gap-3">
              <TrendingUp size={16} className="mt-0.5 text-blue-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Canone variabile</div>
                <div className="text-sm font-medium text-slate-900">{outlet.variable_rent_pct}% Volume Affari</div>
              </div>
            </div>
          )}
          {outlet.rent_free_days && outlet.rent_free_days > 0 && (
            <div className="flex items-start gap-3">
              <CheckCircle2 size={16} className="mt-0.5 text-emerald-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Giorni gratuiti</div>
                <div className="text-sm font-medium text-slate-900">{outlet.rent_free_days} giorni</div>
              </div>
            </div>
          )}
          {outlet.contract_min_months && (
            <div className="flex items-start gap-3">
              <Clock size={16} className="mt-0.5 text-slate-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Durata minima</div>
                <div className="text-sm font-medium text-slate-900">{outlet.contract_min_months} mesi</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contract Duration Summary */}
      {outlet.contract_duration_months && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div className="text-xs font-semibold text-slate-600 mb-1">Durata contratto</div>
          <div className="text-sm text-slate-900">{outlet.contract_duration_months} mesi</div>
        </div>
      )}
    </div>
  )
}

// ====== ALLEGATI OUTLET ======
function OutletAllegati({ outletId, companyId }: { outletId: string; companyId: string }) {
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [previewAtt, setPreviewAtt] = useState(null)

  function closePreviewAtt() {
    if (previewAtt?.blobUrl) URL.revokeObjectURL(previewAtt.blobUrl)
    setPreviewAtt(null)
  }

  useEffect(() => {
    loadAttachments()
  }, [outletId])

  async function loadAttachments() {
    setLoading(true)
    const { data } = await supabase
      .from('outlet_attachments')
      .select('*')
      .eq('outlet_id', outletId)
      .order('created_at')
    setAttachments(data || [])
    setLoading(false)
  }

  const MAX_ATTACH_SIZE = 50 * 1024 * 1024 // 50 MB

  async function handleFileUpload(attachment, file) {
    if (file.size > MAX_ATTACH_SIZE) {
      alert(`Il file è troppo grande (${(file.size / 1024 / 1024).toFixed(1)} MB).\nDimensione massima consentita: 50 MB.`)
      return
    }
    setUploading(attachment.id)
    try {
      const cid = companyId
      const ext = file.name.split('.').pop()
      const timestamp = Date.now()
      const filePath = `${cid}/${outletId}/${attachment.attachment_type}_${timestamp}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('outlet-attachments')
        .upload(filePath, file, { upsert: true })

      if (uploadErr) {
        console.error('Storage upload error:', uploadErr)
        const msg = uploadErr.message || ''
        if (msg.includes('maximum allowed size') || msg.includes('too large') || msg.includes('exceeded')) {
          alert('Il file supera la dimensione massima consentita dal server.\nProva con un file più piccolo (max 50 MB).')
        } else {
          alert('Errore upload file: ' + msg)
        }
        return
      }

      const { error: dbErr } = await supabase
        .from('outlet_attachments')
        .update({
          is_uploaded: true,
          file_name: file.name,
          file_path: filePath,
          uploaded_at: new Date().toISOString(),
        })
        .eq('id', attachment.id)

      if (dbErr) console.error('DB update error:', dbErr)

      await loadAttachments()
    } catch (err) {
      console.error('Upload error:', err)
      alert('Errore: ' + (err.message || ''))
    } finally {
      setUploading(null)
    }
  }

  async function handleAddAttachment() {
    if (!newLabel.trim()) return
    const cid = companyId
    const code = newLabel.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')
    const { error } = await supabase
      .from('outlet_attachments')
      .insert({
        company_id: cid,
        outlet_id: outletId,
        attachment_type: code,
        label: newLabel.trim(),
        is_required: false,
        is_uploaded: false,
      })
    if (error) {
      alert('Errore: ' + error.message)
    } else {
      setNewLabel('')
      setShowAddForm(false)
      await loadAttachments()
    }
  }

  async function confirmDeleteAttachment() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      if (deleteTarget.file_path) {
        await supabase.storage.from('outlet-attachments').remove([deleteTarget.file_path])
      }
      await supabase.from('outlet_attachments').delete().eq('id', deleteTarget.id)
      setDeleteTarget(null)
      await loadAttachments()
    } catch (err) {
      console.error('Delete attachment error:', err)
      alert('Errore eliminazione: ' + (err.message || ''))
    } finally {
      setDeleting(false)
    }
  }

  async function handlePreviewAttachment(att) {
    if (!att.file_path) { alert('File non ancora caricato'); return }
    // Scarica blob direttamente via Supabase client (no CORS)
    const { data: blob, error } = await supabase.storage
      .from('outlet-attachments')
      .download(att.file_path)
    if (error || !blob) {
      // Fallback: signed URL
      const { data: signedData } = await supabase.storage
        .from('outlet-attachments')
        .createSignedUrl(att.file_path, 3600)
      if (signedData?.signedUrl) {
        setPreviewAtt({ ...att, signedUrl: signedData.signedUrl, pdfData: null })
      } else {
        alert('Impossibile caricare anteprima')
      }
      return
    }
    const arrayBuffer = await blob.arrayBuffer()
    const blobUrl = URL.createObjectURL(blob)
    // Signed URL per il bottone Scarica
    const { data: signedData } = await supabase.storage
      .from('outlet-attachments')
      .createSignedUrl(att.file_path, 3600)
    setPreviewAtt({ ...att, signedUrl: signedData?.signedUrl, pdfData: arrayBuffer, blobUrl })
  }

  const addButton = (
    <div className="mt-3 pt-3 border-t border-slate-100">
      {showAddForm ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Nome documento (es. Planimetria, Visura...)"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddAttachment() }}
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button
            onClick={handleAddAttachment}
            disabled={!newLabel.trim()}
            className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition"
          >
            Aggiungi
          </button>
          <button
            onClick={() => { setShowAddForm(false); setNewLabel('') }}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition text-slate-400"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 transition"
        >
          <Plus size={14} />
          Aggiungi tipo allegato
        </button>
      )}
    </div>
  )

  if (loading) return <div className="text-sm text-slate-400 py-4 text-center">Caricamento allegati...</div>
  if (attachments.length === 0) return (
    <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-3">
        <Paperclip size={16} />
        Documenti e allegati
      </h3>
      <div className="text-sm text-slate-400 text-center py-4">
        Nessun allegato associato a questo outlet.
      </div>
      {addButton}
    </div>
  )

  const uploaded = attachments.filter(a => a.is_uploaded).length
  const required = attachments.filter(a => a.is_required).length
  const requiredUploaded = attachments.filter(a => a.is_required && a.is_uploaded).length

  return (
    <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Paperclip size={16} />
          Documenti e allegati
        </h3>
        <div className="text-xs text-slate-500">
          {uploaded}/{attachments.length} caricati
          {required > 0 && <span className="ml-2">({requiredUploaded}/{required} obbligatori)</span>}
        </div>
      </div>

      <div className="space-y-2">
        {attachments.map(att => (
          <label key={att.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
            att.is_uploaded ? 'bg-emerald-50 border-emerald-200' :
            att.is_required ? 'bg-amber-50 border-amber-200 hover:bg-amber-100/80' :
            'bg-slate-50 border-slate-200 hover:bg-slate-100/80'
          }`}>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
              onChange={e => {
                if (e.target.files[0]) handleFileUpload(att, e.target.files[0])
              }}
              disabled={uploading === att.id}
            />
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {uploading === att.id ? (
                <RefreshCw size={18} className="animate-spin text-blue-600 shrink-0" />
              ) : att.is_uploaded ? (
                <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              ) : att.is_required ? (
                <AlertCircle size={18} className="text-amber-600 shrink-0" />
              ) : (
                <Clock size={18} className="text-slate-400 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900">{att.label}</div>
                {att.is_uploaded && att.file_name ? (
                  <div className="text-xs text-emerald-600 truncate">{att.file_name}</div>
                ) : uploading === att.id ? (
                  <div className="text-xs text-blue-600">Caricamento in corso...</div>
                ) : (
                  <div className="text-xs text-amber-600">Clicca per caricare</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {att.is_required && !att.is_uploaded && (
                <span className="text-xs text-amber-600 font-medium mr-1">Richiesto</span>
              )}
              {att.is_uploaded ? (
                <>
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); handlePreviewAttachment(att) }}
                    className="p-1.5 rounded-lg hover:bg-blue-100 transition text-blue-600"
                    title="Visualizza"
                  >
                    <Eye size={15} />
                  </button>
                  <CheckCircle2 size={16} className="text-emerald-500" />
                </>
              ) : (
                <Upload size={16} className="text-amber-400" />
              )}
              <button
                onClick={e => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(att) }}
                className="p-1.5 rounded-lg hover:bg-red-100 transition text-red-400 hover:text-red-600"
                title="Elimina allegato"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </label>
        ))}
      </div>
      {addButton}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          title="Elimina allegato"
          message={<>Sei sicuro di voler eliminare <strong>{deleteTarget.label}</strong>?{deleteTarget.is_uploaded && ' Il file caricato verrà rimosso dallo storage.'}</>}
          onConfirm={confirmDeleteAttachment}
          onCancel={() => setDeleteTarget(null)}
          loading={deleting}
        />
      )}

      {/* Preview Modal per allegati */}
      {previewAtt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => closePreviewAtt()}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl overflow-hidden flex flex-col" style={{ height: '90vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200 shrink-0">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-slate-900 truncate">{previewAtt.label}</h3>
                {previewAtt.file_name && <p className="text-xs text-slate-500 truncate">{previewAtt.file_name}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => window.open(previewAtt.signedUrl, '_blank')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 transition text-slate-600"
                >
                  <Download size={14} />
                  Scarica
                </button>
                <button onClick={() => closePreviewAtt()} className="p-2 rounded-lg hover:bg-slate-100 transition">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {previewAtt.file_name?.toLowerCase().match(/\.pdf$/i) ? (
                <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>}><PdfViewer pdfData={previewAtt.pdfData} url={previewAtt.signedUrl} /></Suspense>
              ) : previewAtt.file_name?.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                <div className="flex items-center justify-center h-full p-6">
                  <img src={previewAtt.blobUrl || previewAtt.signedUrl} alt={previewAtt.label} className="max-w-full max-h-full rounded-lg shadow object-contain" />
                </div>
              ) : previewAtt.file_name?.toLowerCase().match(/\.(doc|docx|xls|xlsx)$/i) ? (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <p className="text-center">
                    Anteprima non disponibile per file Word/Excel.<br/>
                    <button
                      onClick={() => window.open(previewAtt.signedUrl, '_blank')}
                      className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                    >
                      Scarica il file
                    </button>
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <p className="text-center">
                    Anteprima non disponibile per questo tipo di file.<br/>
                    <button
                      onClick={() => window.open(previewAtt.signedUrl, '_blank')}
                      className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                      Scarica il file
                    </button>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ====== ALERT SCADENZE CONTRATTI ======
// TODO: tighten type
function ContractAlerts({ outlet }: { outlet: any }) {
  const alerts = []
  const today = new Date()

  // Scadenza contratto
  if (outlet.contract_end_date) {
    const end = new Date(outlet.contract_end_date)
    const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24))
    if (daysLeft <= 365) {
      alerts.push({
        type: daysLeft <= 90 ? 'critical' : daysLeft <= 180 ? 'warning' : 'info',
        icon: daysLeft <= 90 ? '🔴' : daysLeft <= 180 ? '🟡' : '🔵',
        title: daysLeft <= 0 ? 'Contratto SCADUTO' : `Contratto scade tra ${daysLeft} giorni`,
        detail: `Scadenza: ${end.toLocaleDateString('it-IT')}`,
        daysLeft,
      })
    }
  }

  // Clausola di recesso
  if (outlet.exit_clause_date) {
    const exit = new Date(outlet.exit_clause_date)
    const daysLeft = Math.ceil((exit - today) / (1000 * 60 * 60 * 24))
    if (daysLeft > 0 && daysLeft <= 180) {
      alerts.push({
        type: daysLeft <= 60 ? 'critical' : 'warning',
        icon: daysLeft <= 60 ? '🔴' : '🟡',
        title: `Clausola recesso tra ${daysLeft} giorni`,
        detail: `Data: ${exit.toLocaleDateString('it-IT')}`,
        daysLeft,
      })
    }
  }

  // Scadenza garanzia/fidejussione
  if (outlet.guarantee_expiry) {
    const exp = new Date(outlet.guarantee_expiry)
    const daysLeft = Math.ceil((exp - today) / (1000 * 60 * 60 * 24))
    if (daysLeft <= 90) {
      alerts.push({
        type: daysLeft <= 30 ? 'critical' : 'warning',
        icon: daysLeft <= 30 ? '🔴' : '🟡',
        title: daysLeft <= 0 ? 'Fidejussione SCADUTA' : `Fidejussione scade tra ${daysLeft} giorni`,
        detail: `Scadenza: ${exp.toLocaleDateString('it-IT')}`,
        daysLeft,
      })
    }
  }

  // Rinnovo automatico
  if (outlet.contract_start_date && outlet.contract_duration_months && !outlet.contract_end_date) {
    const start = new Date(outlet.contract_start_date)
    const endCalc = new Date(start)
    endCalc.setMonth(endCalc.getMonth() + outlet.contract_duration_months)
    const daysLeft = Math.ceil((endCalc - today) / (1000 * 60 * 60 * 24))
    if (daysLeft <= 180 && daysLeft > 0) {
      alerts.push({
        type: 'info',
        icon: '🔵',
        title: `Termine periodo contrattuale tra ${daysLeft} giorni`,
        detail: `Fine periodo: ${endCalc.toLocaleDateString('it-IT')} (${outlet.contract_duration_months} mesi da inizio)`,
        daysLeft,
      })
    }
  }

  if (alerts.length === 0) return null

  // Ordina per urgenza
  alerts.sort((a, b) => a.daysLeft - b.daysLeft)

  const bgColors = {
    critical: 'bg-red-50 border-red-200',
    warning: 'bg-amber-50 border-amber-200',
    info: 'bg-blue-50 border-blue-200',
  }

  return (
    <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-3">
        <Bell size={16} className="text-amber-500" />
        Alert scadenze
      </h3>
      <div className="space-y-2">
        {alerts.map((alert, i) => (
          <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${bgColors[alert.type]}`}>
            <span className="text-lg">{alert.icon}</span>
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-900">{alert.title}</div>
              <div className="text-xs text-slate-500">{alert.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ====== CORRISPETTIVI TAB ======
function CorrispettiviTab({ outletId, companyId }: { outletId: string; companyId: string }) {
  const [daily, setDaily] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30') // 7, 30, 90

  useEffect(() => {
    loadDaily()
  }, [outletId, period])

  async function loadDaily() {
    setLoading(true)
    try {
      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - parseInt(period))
      const fromDate = daysAgo.toISOString().split('T')[0]

      const { data } = await supabase
        .from('daily_revenue')
        .select('date, gross_revenue, transactions_count, avg_ticket')
        .eq('outlet_id', outletId)
        .eq('company_id', companyId)
        .gte('date', fromDate)
        .order('date', { ascending: true })

      setDaily(data || [])
    } catch (e) {
      console.error('Corrispettivi load error:', e)
    } finally {
      setLoading(false)
    }
  }

  const totalRev = daily.reduce((s, d) => s + (d.gross_revenue || 0), 0)
  const avgDaily = daily.length > 0 ? totalRev / daily.length : 0
  const totalTx = daily.reduce((s, d) => s + (d.transactions_count || 0), 0)
  const avgTicket = totalTx > 0 ? totalRev / totalTx : 0
  const bestDay = daily.reduce((best, d) => (d.gross_revenue || 0) > best.value ? { date: d.date, value: d.gross_revenue } : best, { date: '', value: 0 })

  const chartData = daily.map(d => ({
    ...d,
    label: new Date(d.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }),
    weekday: new Date(d.date).toLocaleDateString('it-IT', { weekday: 'short' }),
  }))

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Corrispettivi giornalieri</h3>
        <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {[
            { key: '7', label: '7 gg' },
            { key: '30', label: '30 gg' },
            { key: '90', label: '90 gg' },
          ].map(t => (
            <button key={t.key} onClick={() => setPeriod(t.key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                period === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI corrispettivi */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Totale periodo</div>
          <div className="text-xl font-bold text-slate-900">{fmt(totalRev)} €</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Media giornaliera</div>
          <div className="text-xl font-bold text-blue-600">{fmt(avgDaily)} €</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Scontrino medio</div>
          <div className="text-xl font-bold text-emerald-600">{fmt(avgTicket, 2)} €</div>
          <div className="text-[11px] text-slate-400">{fmt(totalTx)} transazioni</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Giorno migliore</div>
          <div className="text-xl font-bold text-amber-600">{fmt(bestDay.value)} €</div>
          <div className="text-[11px] text-slate-400">{bestDay.date ? new Date(bestDay.date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' }) : '—'}</div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={20} className="animate-spin text-slate-400" />
        </div>
      ) : daily.length === 0 ? (
        <div className="bg-slate-50 rounded-xl p-8 text-center">
          <Calendar size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 mb-2">Nessun corrispettivo registrato</p>
          <p className="text-xs text-slate-400">Importa i dati POS da <a href="/import-hub" className="text-blue-500 hover:underline">ImportHub</a></p>
        </div>
      ) : (
        <>
          {/* Chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-corr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="label" {...AXIS_STYLE} interval={period === '7' ? 0 : 'preserveStartEnd'} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
                <Bar dataKey="gross_revenue" name="Incasso" fill="url(#grad-corr)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Daily table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-[11px] text-slate-500 uppercase tracking-wider">
                    <th className="py-2 px-4 text-left font-medium">Data</th>
                    <th className="py-2 px-4 text-left font-medium">Giorno</th>
                    <th className="py-2 px-4 text-right font-medium">Incasso</th>
                    <th className="py-2 px-4 text-right font-medium">Scontrini</th>
                    <th className="py-2 px-4 text-right font-medium">Ticket medio</th>
                  </tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map(d => (
                    <tr key={d.date} className="border-t border-slate-50 hover:bg-slate-50/50">
                      <td className="py-2 px-4 font-medium text-slate-900">{new Date(d.date).toLocaleDateString('it-IT')}</td>
                      <td className="py-2 px-4 text-slate-500">{new Date(d.date).toLocaleDateString('it-IT', { weekday: 'long' })}</td>
                      <td className="py-2 px-4 text-right font-semibold text-slate-900">{fmt(d.gross_revenue)} €</td>
                      <td className="py-2 px-4 text-right text-slate-600">{d.transactions_count || '—'}</td>
                      <td className="py-2 px-4 text-right text-blue-600">{d.transactions_count ? fmt((d.gross_revenue || 0) / d.transactions_count, 2) + ' €' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ====== STAFF TAB ======
function StaffTab({ outletId, companyId }: { outletId: string; companyId: string }) {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStaff()
  }, [outletId])

  async function loadStaff() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('employees')
        .select('id, first_name, last_name, role, contract_type, annual_gross_salary, monthly_net_salary, hire_date, is_active')
        .eq('outlet_id', outletId)
        .eq('company_id', companyId)
        .order('last_name')

      setStaff(data || [])
    } catch (e) {
      console.error('Staff load error:', e)
    } finally {
      setLoading(false)
    }
  }

  const totalCost = staff.reduce((s, e) => s + (e.annual_gross_salary || 0), 0)
  const activeCount = staff.filter(e => e.is_active).length

  if (loading) return <div className="flex items-center justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Dipendenti attivi</div>
          <div className="text-xl font-bold text-slate-900">{activeCount}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Costo annuo lordo</div>
          <div className="text-xl font-bold text-amber-600">{fmt(totalCost)} €</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Costo medio/dip.</div>
          <div className="text-xl font-bold text-blue-600">{activeCount > 0 ? fmt(totalCost / activeCount) : '—'} €</div>
        </div>
      </div>

      {staff.length === 0 ? (
        <div className="bg-slate-50 rounded-xl p-8 text-center">
          <Users size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">Nessun dipendente assegnato a questo outlet</p>
          <p className="text-xs text-slate-400 mt-1">Assegna dipendenti dalla pagina <a href="/dipendenti" className="text-blue-500 hover:underline">Dipendenti</a></p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-[11px] text-slate-500 uppercase tracking-wider">
                <th className="py-2 px-4 text-left font-medium">Nome</th>
                <th className="py-2 px-4 text-left font-medium">Ruolo</th>
                <th className="py-2 px-4 text-left font-medium">Contratto</th>
                <th className="py-2 px-4 text-right font-medium">RAL</th>
                <th className="py-2 px-4 text-center font-medium">Stato</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(e => (
                <tr key={e.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="py-2 px-4 font-medium text-slate-900">{e.first_name} {e.last_name}</td>
                  <td className="py-2 px-4 text-slate-600">{e.role || '—'}</td>
                  <td className="py-2 px-4 text-slate-500 text-xs">{e.contract_type || '—'}</td>
                  <td className="py-2 px-4 text-right font-medium text-slate-900">{fmt(e.annual_gross_salary)} €</td>
                  <td className="py-2 px-4 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${e.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {e.is_active ? 'Attivo' : 'Cessato'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ====== DETTAGLIO OUTLET — HUB CON TAB ======
// TODO: tighten type
function OutletDetail({ outlet, revenue, onBack, onEdit, onDelete }: { outlet: any; revenue: Record<string, any>; onBack: () => void; onEdit: (o: any) => void; onDelete: (id: string) => void }) {
  const { profile } = useAuth()
  const currentYear = new Date().getFullYear()
  const yearData = revenue[outlet.id] || {}
  const [detailTab, setDetailTab] = useState('overview')

  // Corrispettivi sparkline (last 7 days for overview)
  const [recentDaily, setRecentDaily] = useState([])
  useEffect(() => {
    async function loadRecent() {
      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - 7)
      const { data } = await supabase
        .from('daily_revenue')
        .select('date, gross_revenue')
        .eq('outlet_id', outlet.id)
        .eq('company_id', outlet.company_id)
        .gte('date', daysAgo.toISOString().split('T')[0])
        .order('date', { ascending: true })
      setRecentDaily(data || [])
    }
    loadRecent()
  }, [outlet.id])

  const chartData = MONTHS.map((name, i) => ({
    month: name,
    ricavi: yearData[i + 1] || 0,
  }))

  const ytd = Object.values(yearData).reduce((s, v) => s + v, 0)
  const avgMonth = Object.keys(yearData).length > 0 ? ytd / Object.keys(yearData).length : 0
  const bestMonth = Object.entries(yearData).reduce(
    (best, [m, v]) => v > best.value ? { month: parseInt(m), value: v } : best,
    { month: 0, value: 0 }
  )

  const rentAnnual = (outlet.rent_monthly || 0) * 12
  const condoAnnual = (outlet.condo_marketing_monthly || 0) * 12
  const occupancyCost = rentAnnual + condoAnnual
  const occupancyRatio = ytd > 0 ? (occupancyCost / ytd * 100) : 0
  const yesterdayRev = recentDaily.length > 0 ? recentDaily[recentDaily.length - 1]?.gross_revenue || 0 : null

  const DETAIL_TABS = [
    { key: 'overview', label: 'Overview', icon: Store },
    { key: 'corrispettivi', label: 'Corrispettivi', icon: DollarSign },
    { key: 'budget', label: 'Budget', icon: Target },
    { key: 'staff', label: 'Staff', icon: Users },
    { key: 'documenti', label: 'Documenti', icon: FileText },
  ]

  return (
    <div className="space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 transition text-slate-600">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">{formatOutletName(outlet.name)}</h2>
            <StatusBadge outlet={outlet} isActive={outlet.is_active} />
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            {outlet.mall_name} — {outlet.code}
            {yesterdayRev != null && yesterdayRev > 0 && (
              <span className="text-emerald-600 font-medium ml-2">· Ieri: {fmt(yesterdayRev)} €</span>
            )}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <button onClick={() => onEdit(outlet)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition text-slate-700">
            <FileText size={15} /> Modifica
          </button>
          <button onClick={() => onDelete(outlet)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-red-200 hover:bg-red-50 transition text-red-600">
            <Trash2 size={15} /> Elimina
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5 overflow-x-auto">
        {DETAIL_TABS.map(t => (
          <button key={t.key} onClick={() => setDetailTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition whitespace-nowrap ${
              detailTab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {/* ─── Tab: Overview ─── */}
      {detailTab === 'overview' && (
        <div className="space-y-4">
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-600 inline-flex mb-2"><DollarSign size={18} /></div>
              <div className="text-xl font-bold text-slate-900">{fmt(ytd)} €</div>
              <div className="text-xs text-slate-500">Fatturato YTD {currentYear - 1}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 inline-flex mb-2"><TrendingUp size={18} /></div>
              <div className="text-xl font-bold text-slate-900">{fmt(avgMonth)} €</div>
              <div className="text-xs text-slate-500">Media mensile</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600 inline-flex mb-2"><Target size={18} /></div>
              <div className="text-xl font-bold text-slate-900">{bestMonth.month > 0 ? MONTHS[bestMonth.month - 1] : '—'}</div>
              <div className="text-xs text-slate-500">Mese migliore ({fmt(bestMonth.value)} €)</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="p-2 rounded-lg bg-purple-50 text-purple-600 inline-flex mb-2"><Store size={18} /></div>
              <div className="text-xl font-bold text-slate-900">{occupancyRatio.toFixed(1)}%</div>
              <div className="text-xs text-slate-500">Incidenza locazione ({fmt(occupancyCost)} €/a)</div>
            </div>
          </div>

          {/* Corrispettivi sparkline — last 7 days */}
          {recentDaily.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-900">Incassi ultimi 7 giorni</h3>
                <button onClick={() => setDetailTab('corrispettivi')} className="text-xs text-blue-500 font-medium flex items-center gap-1 hover:text-blue-700">
                  Dettaglio <ChevronRight size={12} />
                </button>
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={recentDaily.map(d => ({ ...d, label: new Date(d.date).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit' }) }))}>
                  <XAxis dataKey="label" {...AXIS_STYLE} />
                  <YAxis hide />
                  <Tooltip formatter={v => [`${fmt(v)} €`, 'Incasso']} />
                  <Bar dataKey="gross_revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Contract alerts */}
          <ContractAlerts outlet={outlet} />

          {/* Revenue Chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Fatturato mensile — {currentYear - 1}</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <defs>
                  <linearGradient id="grad-ricavi-outlet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={1} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="month" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
                <Bar dataKey="ricavi" fill="url(#grad-ricavi-outlet)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Anagrafica compatta */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Anagrafica</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Centro commerciale</span><span className="font-medium">{outlet.mall_name || '—'}</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Tipo</span><span className="font-medium">{outlet.outlet_type || '—'}</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Apertura</span><span className="font-medium">{outlet.opening_date ? new Date(outlet.opening_date).toLocaleDateString('it-IT') : '—'}</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Superficie</span><span className="font-medium">{outlet.sqm || '—'} mq</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Canone mensile</span><span className="font-medium">{fmt(outlet.rent_monthly, 2)} €</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Spese cond.</span><span className="font-medium">{fmt(outlet.condo_marketing_monthly, 2)} €</span></div>
            </div>
          </div>

          {/* Extracted Contract Data */}
          <ExtractedContractData outlet={outlet} />
        </div>
      )}

      {/* ─── Tab: Corrispettivi ─── */}
      {detailTab === 'corrispettivi' && (
        <CorrispettiviTab outletId={outlet.id} companyId={outlet.company_id} />
      )}

      {/* ─── Tab: Budget ─── */}
      {detailTab === 'budget' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Budget vs Consuntivo</h3>
          <p className="text-sm text-slate-500">
            Vai alla pagina <a href="/budget" className="text-blue-500 hover:underline">Budget & Controllo</a> per il dettaglio budget vs actual di questo outlet.
          </p>
          {/* Revenue chart as proxy */}
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="month" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
                <Bar dataKey="ricavi" name="Consuntivo" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ─── Tab: Staff ─── */}
      {detailTab === 'staff' && (
        <StaffTab outletId={outlet.id} companyId={outlet.company_id} />
      )}

      {/* ─── Tab: Documenti ─── */}
      {detailTab === 'documenti' && (
        <div className="space-y-4">
          <DocumentArchive outletId={outlet.id} companyId={outlet.company_id} />
          <OutletAllegati outletId={outlet.id} companyId={outlet.company_id} />
        </div>
      )}
    </div>
  )
}

// ====== MAIN PAGE ======
export default function Outlet() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  // TODO: tighten type — Supabase rows
  const [outlets, setOutlets] = useState<any[]>([])
  const [revenue, setRevenue] = useState<Record<string, any>>({})
  // Anno effettivamente usato per caricare i dati di fatturato (quello
  // in cui sono state trovate righe in budget_entries). Serve a mostrare
  // nel titolo l'anno CORRETTO invece dell'hardcoded 'currentYear - 1'.
  const [revenueYear, setRevenueYear] = useState<number | null>(null)
  // TODO: tighten type
  const [selectedOutlet, setSelectedOutlet] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [showContractUploader, setShowContractUploader] = useState(false)
  // TODO: tighten type
  const [wizardInitialData, setWizardInitialData] = useState<any>(null)
  const [wizardAllegati, setWizardAllegati] = useState<any>(null)
  const [wizardContractFile, setWizardContractFile] = useState<any>(null)
  const [wizardUploadedFiles, setWizardUploadedFiles] = useState<any>(null)
  const [editOutlet, setEditOutlet] = useState<any>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [tab, setTab] = useState('operativi')
  const canWrite = profile?.role === 'super_advisor'
  const currentYear = new Date().getFullYear()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Carica outlets
      const { data: outData, error: outErr } = await supabase
        .from('outlets')
        .select('*')
        .eq('company_id', profile?.company_id)
        .order('name')

      if (outErr) {
        console.error('Outlets error:', outErr)
      } else {
        setOutlets(outData || [])
      }

      // Carica ricavi da budget_entries (ricavi consuntivo per outlet)
      // Mappa bidirezionale: codice outlet (BRB) ↔ codice cost_center (barberino)
      const COST_CENTER_MAP = {
        'barberino': 'BRB', 'brugnato': 'BRG', 'franciacorta': 'FRC',
        'palmanova': 'PLM', 'torino': 'TRN', 'valdichiana': 'VDC',
        'valmontone': 'VLM', 'sede_magazzino': 'SEDE',
      }

      // Also map outlet name (lowercase) → outlet id
      const codeToId = {}
      const nameToId = {}
      ;(outData || []).forEach(o => {
        codeToId[o.code] = o.id
        nameToId[(o.name || '').toLowerCase()] = o.id
      })

      // Try current year first, then previous year
      let budgetData = null
      let budgetDataYear = null
      for (const yr of [currentYear, currentYear - 1]) {
        const { data, error: budgetErr } = await supabase
          .from('budget_entries')
          .select('cost_center, month, actual_amount, budget_amount, account_code')
          .eq('company_id', profile?.company_id)
          .eq('year', yr)

        if (!budgetErr && data && data.length > 0) {
          budgetData = data
          budgetDataYear = yr
          break
        }
      }
      // Memorizzo l'anno effettivo per il titolo "Fatturato catena {anno}"
      setRevenueYear(budgetDataYear)

      if (budgetData && budgetData.length > 0) {
        const grouped = {}
        budgetData.forEach(r => {
          // Prova match diretto con code, poi con mappa, poi con nome outlet
          let outletId = codeToId[r.cost_center]
          if (!outletId) {
            const mappedCode = COST_CENTER_MAP[r.cost_center]
            if (mappedCode) outletId = codeToId[mappedCode]
          }
          if (!outletId) {
            outletId = nameToId[(r.cost_center || '').toLowerCase()]
          }
          if (!outletId) return
          const amount = parseFloat(r.actual_amount) || parseFloat(r.budget_amount) || 0
          if (amount === 0) return
          if (!grouped[outletId]) grouped[outletId] = {}
          grouped[outletId][r.month] = (grouped[outletId][r.month] || 0) + amount
        })
        setRevenue(grouped)
      }
    } catch (err) {
      console.error('Errore caricamento dati:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleEdit(outlet) {
    const formData = {
      name: outlet.name || '', code: outlet.code || '', brand: outlet.brand || '',
      outlet_type: outlet.outlet_type || 'outlet',
      sqm: outlet.sqm?.toString() || '', sell_sqm: outlet.sell_sqm?.toString() || '',
      unit_code: outlet.unit_code || '',
      mall_name: outlet.mall_name || '', concedente: outlet.concedente || '',
      address: outlet.address || '', city: outlet.city || '',
      province: outlet.province || '', region: outlet.region || '',
      delivery_date: outlet.delivery_date || '', opening_date: outlet.opening_date || '',
      opening_confirmed: outlet.opening_confirmed || false,
      contract_start: outlet.contract_start || '', contract_end: outlet.contract_end || '',
      contract_duration_months: outlet.contract_duration_months?.toString() || '',
      contract_min_months: outlet.contract_min_months?.toString() || '',
      rent_free_days: outlet.rent_free_days?.toString() || '',
      exit_clause_month: outlet.exit_clause_month?.toString() || '',
      rent_annual: outlet.rent_annual?.toString() || '',
      rent_monthly: outlet.rent_monthly?.toString() || '',
      rent_per_sqm: outlet.rent_per_sqm?.toString() || '',
      variable_rent_pct: outlet.variable_rent_pct?.toString() || '',
      rent_year2_annual: outlet.rent_year2_annual?.toString() || '',
      rent_year3_annual: outlet.rent_year3_annual?.toString() || '',
      condo_marketing_monthly: outlet.condo_marketing_monthly?.toString() || '',
      staff_budget_monthly: outlet.staff_budget_monthly?.toString() || '',
      deposit_guarantee: outlet.deposit_guarantee?.toString() || '',
      advance_payment: outlet.advance_payment?.toString() || '',
      setup_cost: outlet.setup_cost?.toString() || '',
      target_margin_pct: outlet.target_margin_pct?.toString() || '60',
      target_cogs_pct: outlet.target_cogs_pct?.toString() || '40',
      exit_revenue_threshold: outlet.exit_revenue_threshold?.toString() || outlet.min_revenue_target?.toString() || '',
      min_revenue_period: outlet.min_revenue_period || '',
      notes: outlet.notes || '',
    }
    setEditOutlet(outlet)
    setWizardInitialData(formData)
    setWizardAllegati(null)
    setWizardContractFile(null)
    setWizardUploadedFiles(null)
    setShowWizard(true)
  }

  async function handleDelete(outlet) {
    setShowDeleteConfirm(outlet)
  }

  async function confirmDelete() {
    if (!showDeleteConfirm) return
    setDeleting(true)
    const outletId = showDeleteConfirm.id

    const { error: attErr } = await supabase.from('outlet_attachments').delete().eq('outlet_id', outletId)
    if (attErr) console.warn('Allegati delete warning:', attErr)

    await supabase.from('employees').update({ outlet_id: null }).eq('outlet_id', outletId)

    const { data: delData, error: err } = await supabase
      .from('outlets')
      .delete()
      .eq('id', outletId)
      .select()

    if (err) {
      console.error('Delete error:', err)
      alert('Errore eliminazione: ' + err.message)
      setDeleting(false)
      setShowDeleteConfirm(null)
      return
    }

    if (!delData || delData.length === 0) {
      alert('Non e\' stato possibile eliminare l\'outlet. Potrebbe essere un problema di permessi (RLS).')
      setDeleting(false)
      setShowDeleteConfirm(null)
      return
    }

    setSelectedOutlet(null)
    setShowDeleteConfirm(null)
    setDeleting(false)
    loadData()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={24} className="animate-spin text-blue-600" />
      </div>
    )
  }

  const filtered = outlets.filter(o =>
    !search ||
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.code?.toLowerCase().includes(search.toLowerCase()) ||
    o.mall_name?.toLowerCase().includes(search.toLowerCase())
  )

  const totalRevenue = Object.values(revenue).reduce(
    (sum, outletRev) => sum + Object.values(outletRev).reduce((s, v) => s + v, 0), 0
  )

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* ── Tab bar (hide when viewing outlet detail) ── */}
      {!selectedOutlet && (
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          {[
            { key: 'operativi', label: 'Outlet operativi' },
            { key: 'valutazione', label: 'Outlet in valutazione' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition ${
                tab === t.key
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Tab: Outlet in valutazione ── */}
      {tab === 'valutazione' && !selectedOutlet && (
        <OutletValutazione />
      )}

      {/* ── Tab: Outlet operativi ── */}
      {(tab === 'operativi' || selectedOutlet) && (
        <>
          {selectedOutlet ? (
            <OutletDetail
              outlet={selectedOutlet}
              revenue={revenue}
              onBack={() => setSelectedOutlet(null)}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">Outlet</h1>
                  <p className="text-sm text-slate-500">
                    {outlets.length} punti vendita — Fatturato catena {revenueYear || currentYear}: {fmt(totalRevenue)} €
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={loadData}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-white transition"
                  >
                    <RefreshCw size={16} />
                    Aggiorna
                  </button>
                  {canWrite && (
                    <>
                      <button
                        onClick={() => setShowContractUploader(true)}
                        className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
                      >
                        <Upload size={16} />
                        Crea da contratto
                      </button>
                      <button
                        onClick={() => { setWizardInitialData(null); setWizardAllegati(null); setShowWizard(true) }}
                        className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
                      >
                        <Plus size={16} />
                        Nuovo outlet
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cerca per nome, codice o centro commerciale..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>

              {filtered.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <Store size={40} className="mx-auto mb-3 opacity-50" />
                  <p className="text-sm">{search ? 'Nessun outlet trovato per la ricerca.' : 'Nessun outlet disponibile.'}</p>
                  {!search && outlets.length === 0 && (
                    <p className="text-xs mt-1">Verifica le policy RLS e i permessi del tuo utente.</p>
                  )}
                </div>
              ) : (
                <OutletGrid
                  outlets={filtered}
                  revenue={revenue}
                  onSelect={setSelectedOutlet}
                />
              )}
            </>
          )}
        </>
      )}

      {showContractUploader && (
        <ContractUploader
          onCancel={() => setShowContractUploader(false)}
          onDataExtracted={(data, allegati, fileName, uploadedFiles) => {
            setShowContractUploader(false)
            setWizardInitialData(data)
            setWizardAllegati(allegati)
            setWizardContractFile(fileName)
            setWizardUploadedFiles(uploadedFiles || {})
            setShowWizard(true)
          }}
        />
      )}

      {showWizard && (
        <OutletWizard
          onClose={() => { setShowWizard(false); setWizardInitialData(null); setWizardAllegati(null); setWizardUploadedFiles(null); setEditOutlet(null) }}
          onSaved={() => { setShowWizard(false); setWizardInitialData(null); setWizardAllegati(null); setWizardUploadedFiles(null); setEditOutlet(null); setSelectedOutlet(null); loadData() }}
          initialData={wizardInitialData}
          allegati={wizardAllegati}
          contractFileName={wizardContractFile}
          uploadedFiles={wizardUploadedFiles}
          editId={editOutlet?.id || null}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-full bg-red-50">
                <Trash2 size={22} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Elimina outlet</h3>
                <p className="text-sm text-slate-500">Questa azione non puo' essere annullata</p>
              </div>
            </div>
            <p className="text-sm text-slate-700 mb-6">
              Sei sicuro di voler eliminare <strong>{formatOutletName(showDeleteConfirm.name)}</strong> ({showDeleteConfirm.code})?
              Verranno eliminati anche tutti gli allegati collegati.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition"
              >
                Annulla
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50"
              >
                {deleting ? 'Eliminazione...' : 'Elimina outlet'}
              </button>
            </div>
          </div>
        </div>
      )}
      <PageHelp page="outlet" />
    </div>
  )
}
