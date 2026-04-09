import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  FileText, RefreshCw, Search, Plus, Calendar, AlertTriangle,
  Check, X, AlertCircle, Clock, ChevronDown, ChevronUp, MapPin,
  Upload, Eye, Paperclip, XCircle, FileUp, Edit2
} from 'lucide-react'

function fmt(n, decimals = 0) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n)
}

const STATUS_CONFIG = {
  attivo: { label: 'Attivo', color: 'bg-emerald-50 text-emerald-700' },
  in_scadenza: { label: 'In scadenza', color: 'bg-amber-50 text-amber-700' },
  scaduto: { label: 'Scaduto', color: 'bg-red-50 text-red-700' },
  disdettato: { label: 'Disdettato', color: 'bg-slate-100 text-slate-600' },
}

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.attivo
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  )
}

function KpiCard({ title, value, subtitle, icon: Icon, color = 'blue' }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className={`p-2.5 rounded-lg ${colorMap[color]} inline-flex mb-3`}>
        <Icon size={20} />
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-sm text-slate-500 mt-0.5">{title}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
    </div>
  )
}

// ====== MODAL NUOVO CONTRATTO ======
function ModalNuovoContratto({ outlets, onClose, onSave, editingContract = null, profile }) {
  const [form, setForm] = useState(editingContract ? {
    name: editingContract.name,
    counterpart: editingContract.counterpart,
    contract_type: editingContract.contract_type,
    outlet_id: editingContract.outlet_id || '',
    start_date: editingContract.start_date || '',
    end_date: editingContract.end_date || '',
    notice_days: editingContract.notice_days || 180,
    monthly_amount: editingContract.monthly_amount || '',
    annual_amount: editingContract.annual_amount || '',
    status: editingContract.status,
    auto_renew: editingContract.auto_renew || false,
    notes: editingContract.notes || ''
  } : {
    name: '', counterpart: '', contract_type: 'locazione',
    outlet_id: '', start_date: '', end_date: '', notice_days: 180,
    monthly_amount: '', annual_amount: '', status: 'attivo',
    auto_renew: false, notes: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [attachments, setAttachments] = useState([])

  async function uploadAttachments(contractId) {
    if (attachments.length === 0) return

    try {
      for (const file of attachments) {
        if (!file.path) {
          // Only upload files that don't have a path (new files)
          const ts = Date.now()
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const filePath = `${profile?.company_id || '00000000-0000-0000-0000-000000000001'}/${contractId}/${ts}_${safeName}`

          // Upload to Supabase Storage
          const { error: storageErr } = await supabase.storage
            .from('contract-documents')
            .upload(filePath, file, { upsert: false })

          // Save metadata to DB
          await supabase.from('contract_documents').insert({
            contract_id: contractId,
            file_name: file.name,
            file_path: storageErr ? null : filePath,
            file_size: file.size,
          })
        }
      }
    } catch (err) {
      console.error('Upload error:', err)
      throw err
    }
  }

  async function handleSave() {
    if (!form.name || !form.counterpart) {
      setError('Nome contratto e controparte sono obbligatori')
      return
    }
    setSaving(true)
    setError(null)

    try {
      const contractData = {
        name: form.name,
        counterpart: form.counterpart,
        contract_type: form.contract_type,
        outlet_id: form.outlet_id || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        notice_days: form.notice_days || null,
        monthly_amount: form.monthly_amount || null,
        annual_amount: form.annual_amount || (form.monthly_amount ? form.monthly_amount * 12 : null),
        status: form.status,
        auto_renew: form.auto_renew,
        notes: form.notes || null,
      }

      let contractId = editingContract?.id
      let err = null

      if (editingContract) {
        // Edit mode
        const result = await supabase.from('contracts').update(contractData).eq('id', editingContract.id)
        err = result.error
      } else {
        // Create mode
        const result = await supabase.from('contracts').insert({
          company_id: profile?.company_id,
          ...contractData
        }).select()
        err = result.error
        if (result.data?.length) {
          contractId = result.data[0].id
        }
      }

      if (err) {
        setError(err.message)
        setSaving(false)
        return
      }

      // Upload attachments after contract is saved
      if (contractId && attachments.length > 0) {
        await uploadAttachments(contractId)
      }

      onSave()
    } catch (err) {
      setError(err.message || 'Errore durante il salvataggio')
      setSaving(false)
    }
  }

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))
  const isEditing = !!editingContract

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900">{isEditing ? 'Modifica contratto' : 'Nuovo contratto'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              <AlertCircle size={16} />{error}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Nome contratto *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="es. Locazione Valdichiana Village"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Controparte *</label>
              <input value={form.counterpart} onChange={e => set('counterpart', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
              <select value={form.contract_type} onChange={e => set('contract_type', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="locazione">Locazione</option>
                <option value="utenza">Utenza</option>
                <option value="servizio">Servizio</option>
                <option value="assicurazione">Assicurazione</option>
                <option value="leasing">Leasing</option>
                <option value="altro">Altro</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Outlet</label>
            <select value={form.outlet_id} onChange={e => set('outlet_id', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">Sede / Tutti</option>
              {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Data inizio</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Data fine</label>
              <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Importo mensile (€)</label>
              <input type="number" value={form.monthly_amount} onChange={e => set('monthly_amount', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Giorni preavviso disdetta</label>
              <input type="number" value={form.notice_days} onChange={e => set('notice_days', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.auto_renew} onChange={e => set('auto_renew', e.target.checked)}
              className="rounded border-slate-300" />
            Rinnovo automatico
          </label>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Allega PDF contratto</label>
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-3 text-center cursor-pointer hover:border-indigo-300 hover:bg-slate-50 transition"
              onClick={() => document.getElementById('modal-pdf-input').click()}>
              <input id="modal-pdf-input" type="file" accept=".pdf" multiple className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf')
                  setAttachments(prev => [...prev, ...files.map(f => ({ name: f.name, size: f.size }))])
                }} />
              <FileUp size={18} className="mx-auto mb-1 text-slate-300" />
              <p className="text-xs text-slate-500">Trascina PDF o <span className="text-indigo-500 font-medium">sfoglia</span></p>
            </div>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {attachments.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-1.5 bg-slate-50 rounded-lg">
                    <span className="text-slate-600 truncate">{f.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Note</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition">Annulla</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
            {saving ? (isEditing ? 'Aggiornamento...' : 'Salvataggio...') : (isEditing ? 'Aggiorna' : 'Salva')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ====== PDF UPLOADER (Supabase Storage) ======
function PdfUploader({ contractId, files, loading: filesLoading, onUploadDone, onRemoveDone, onPreview }) {
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)

  async function handleFiles(fileList) {
    const pdfs = Array.from(fileList).filter(f =>
      f.type === 'application/pdf' || f.name.endsWith('.pdf')
    )
    if (!pdfs.length) return
    setUploading(true)
    try {
      for (const file of pdfs) {
        const ts = Date.now()
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const filePath = `00000000-0000-0000-0000-000000000001/${contractId}/${ts}_${safeName}`

        // Upload al bucket
        const { error: storageErr } = await supabase.storage
          .from('contract-documents')
          .upload(filePath, file, { upsert: false })

        // Salva metadati in DB
        await supabase.from('contract_documents').insert({
          contract_id: contractId,
          file_name: file.name,
          file_path: storageErr ? null : filePath,
          file_size: file.size,
        })
      }
      onUploadDone()
    } catch (err) {
      console.error('Upload error:', err)
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove(doc) {
    if (doc.file_path) {
      await supabase.storage.from('contract-documents').remove([doc.file_path])
    }
    await supabase.from('contract_documents').delete().eq('id', doc.id)
    onRemoveDone()
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Paperclip size={14} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Documenti allegati</span>
        <span className="text-xs text-slate-400">({(files || []).length} file)</span>
        {uploading && <RefreshCw size={13} className="animate-spin text-indigo-500" />}
      </div>

      {/* File list */}
      {(files || []).map((f) => (
        <div key={f.id} className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-200 group">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-red-50"><FileText size={16} className="text-red-500" /></div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-700 truncate">{f.file_name}</div>
              <div className="text-xs text-slate-400">
                {f.file_size ? `${(f.file_size / 1024).toFixed(0)} KB` : ''} — {new Date(f.uploaded_at).toLocaleDateString('it-IT')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {f.file_path && (
              <button onClick={() => onPreview(f)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition" title="Anteprima">
                <Eye size={15} />
              </button>
            )}
            <button onClick={() => handleRemove(f)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition" title="Rimuovi">
              <XCircle size={15} />
            </button>
          </div>
        </div>
      ))}

      {filesLoading && <div className="text-xs text-slate-400 text-center py-2">Caricamento...</div>}

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={e => { e.preventDefault(); setDragActive(false); handleFiles(e.dataTransfer.files) }}
        className={`relative border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer ${
          dragActive ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
        }`}
        onClick={() => document.getElementById(`pdf-input-${contractId}`).click()}
      >
        <input
          id={`pdf-input-${contractId}`}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
        />
        <FileUp size={20} className={`mx-auto mb-1.5 ${dragActive ? 'text-indigo-500' : 'text-slate-300'}`} />
        <p className="text-xs text-slate-500">
          {uploading ? 'Caricamento in corso...' : <>Trascina PDF o <span className="text-indigo-500 font-medium">sfoglia</span></>}
        </p>
      </div>
    </div>
  )
}

// ====== PDF PREVIEW MODAL (Supabase signed URL) ======
function PdfPreviewModal({ file, onClose }) {
  const [pdfUrl, setPdfUrl] = useState(null)
  const [loadingUrl, setLoadingUrl] = useState(false)

  useEffect(() => {
    if (!file?.file_path) { setPdfUrl(null); return }
    let cancelled = false
    setLoadingUrl(true)
    supabase.storage.from('contract-documents')
      .createSignedUrl(file.file_path, 300) // 5 min
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setPdfUrl(data.signedUrl)
      })
      .finally(() => { if (!cancelled) setLoadingUrl(false) })
    return () => { cancelled = true }
  }, [file])

  if (!file) return null
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-red-500" />
            <span className="font-semibold text-slate-900 text-sm">{file.file_name}</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-hidden">
          {loadingUrl ? (
            <div className="flex items-center justify-center h-[70vh]">
              <RefreshCw size={24} className="animate-spin text-blue-600" />
            </div>
          ) : pdfUrl ? (
            <iframe src={pdfUrl} className="w-full h-full min-h-[70vh]" title="Anteprima PDF" />
          ) : (
            <div className="flex items-center justify-center h-[70vh] text-slate-400 text-sm">
              Anteprima non disponibile
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ====== PAGINA PRINCIPALE ======
export default function Contratti() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState([])
  const [outlets, setOutlets] = useState([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingContract, setEditingContract] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [contractDocs, setContractDocs] = useState({}) // { contractId: [doc, ...] }
  const [docsLoading, setDocsLoading] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const canWrite = profile?.role === 'super_advisor'

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [conRes, outRes] = await Promise.all([
      supabase.from('contracts').select('*').order('end_date', { ascending: true }),
      supabase.from('outlets').select('id, name, code').order('name')
    ])
    if (conRes.data) setContracts(conRes.data)
    if (outRes.data) setOutlets(outRes.data)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={24} className="animate-spin text-blue-600" />
      </div>
    )
  }

  const outletMap = Object.fromEntries(outlets.map(o => [o.id, o.name]))
  const today = new Date().toISOString().split('T')[0]

  const filtered = contracts.filter(c => {
    const matchSearch = !search ||
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.counterpart?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !filterStatus || c.status === filterStatus
    return matchSearch && matchStatus
  })

  const active = contracts.filter(c => c.status === 'attivo').length
  const expiringSoon = contracts.filter(c => c.status === 'in_scadenza').length
  const expired = contracts.filter(c => c.status === 'scaduto').length
  const totalMonthly = contracts
    .filter(c => c.status === 'attivo' || c.status === 'in_scadenza')
    .reduce((s, c) => s + (c.monthly_amount || 0), 0)

  function daysUntil(dateStr) {
    if (!dateStr) return null
    const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24))
    return diff
  }

  async function loadContractDocs(contractId) {
    setDocsLoading(true)
    const { data } = await supabase
      .from('contract_documents')
      .select('*')
      .eq('contract_id', contractId)
      .order('uploaded_at', { ascending: false })
    setContractDocs(prev => ({ ...prev, [contractId]: data || [] }))
    setDocsLoading(false)
  }

  function handleExpand(contractId) {
    if (expandedId === contractId) {
      setExpandedId(null)
    } else {
      setExpandedId(contractId)
      loadContractDocs(contractId)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contratti</h1>
          <p className="text-sm text-slate-500">
            Contratti commerciali, locazioni e servizi
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadData}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-white transition">
            <RefreshCw size={16} /> Aggiorna
          </button>
          {canWrite && (
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              <Plus size={16} /> Nuovo
            </button>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={FileText} title="Contratti attivi" value={active} color="green" />
        <KpiCard icon={AlertTriangle} title="In scadenza" value={expiringSoon}
          subtitle={expired > 0 ? `${expired} scaduti` : ''} color="amber" />
        <KpiCard icon={Calendar} title="Scaduti" value={expired} color="red" />
        <KpiCard icon={Clock} title="Costo mensile attivi" value={`${fmt(totalMonthly)} €`}
          subtitle={`Annuo: ${fmt(totalMonthly * 12)} €`} color="blue" />
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Cerca per nome o controparte..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
          <option value="">Tutti gli stati</option>
          <option value="attivo">Attivo</option>
          <option value="in_scadenza">In scadenza</option>
          <option value="scaduto">Scaduto</option>
          <option value="disdettato">Disdettato</option>
        </select>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <FileText size={40} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">{search || filterStatus ? 'Nessun contratto trovato.' : 'Nessun contratto inserito.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(contract => {
            const days = daysUntil(contract.end_date)
            const isExpanded = expandedId === contract.id

            return (
              <div key={contract.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-5 hover:bg-slate-50/50 transition">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleExpand(contract.id)}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-slate-900">{contract.name}</span>
                        <StatusBadge status={contract.status} />
                        {contract.auto_renew && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">Rinnovo auto</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span>{contract.counterpart}</span>
                        {contract.outlet_id && (
                          <span className="flex items-center gap-1">
                            <MapPin size={12} /> {outletMap[contract.outlet_id]}
                          </span>
                        )}
                        <span className="capitalize">{contract.contract_type}</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 ml-4 shrink-0">
                      <div className="text-right">
                        {contract.monthly_amount && (
                          <div className="text-lg font-bold text-slate-900">{fmt(contract.monthly_amount)} €/mese</div>
                        )}
                        {days != null && (
                          <div className={`text-xs mt-0.5 ${
                            days < 0 ? 'text-red-600 font-medium' :
                            days < 90 ? 'text-amber-600' : 'text-slate-400'
                          }`}>
                            {days < 0 ? `Scaduto da ${Math.abs(days)} giorni` :
                             days === 0 ? 'Scade oggi' :
                             `Scade tra ${days} giorni`}
                          </div>
                        )}
                      </div>
                      {canWrite && (
                        <button
                          onClick={() => setEditingContract(contract)}
                          className="p-2 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition"
                          title="Modifica contratto"
                        >
                          <Edit2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-center mt-2 text-slate-400 cursor-pointer" onClick={() => handleExpand(contract.id)}>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-100 p-5 bg-slate-50/50">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-xs text-slate-400">Inizio</div>
                        <div className="font-medium text-slate-700">
                          {contract.start_date ? new Date(contract.start_date).toLocaleDateString('it-IT') : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">Fine</div>
                        <div className="font-medium text-slate-700">
                          {contract.end_date ? new Date(contract.end_date).toLocaleDateString('it-IT') : 'Indeterminato'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">Preavviso disdetta</div>
                        <div className="font-medium text-slate-700">
                          {contract.notice_days ? `${contract.notice_days} giorni` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">Importo annuale</div>
                        <div className="font-medium text-slate-700">
                          {contract.annual_amount ? `${fmt(contract.annual_amount)} €` :
                           contract.monthly_amount ? `${fmt(contract.monthly_amount * 12)} €` : '—'}
                        </div>
                      </div>
                    </div>
                    {contract.notes && (
                      <div className="mt-3 text-sm text-slate-500 p-3 bg-white rounded-lg border border-slate-200">
                        {contract.notes}
                      </div>
                    )}
                    <PdfUploader
                      contractId={contract.id}
                      files={contractDocs[contract.id]}
                      loading={docsLoading}
                      onUploadDone={() => loadContractDocs(contract.id)}
                      onRemoveDone={() => loadContractDocs(contract.id)}
                      onPreview={setPreviewFile}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {(showModal || editingContract) && (
        <ModalNuovoContratto
          outlets={outlets}
          editingContract={editingContract}
          profile={profile}
          onClose={() => { setShowModal(false); setEditingContract(null) }}
          onSave={() => { setShowModal(false); setEditingContract(null); loadData() }}
        />
      )}

      <PdfPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  )
}
