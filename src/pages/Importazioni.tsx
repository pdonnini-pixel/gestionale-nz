// @ts-nocheck
// TODO: tighten types
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  Upload, RefreshCw, FileText, Check, X, AlertCircle,
  Clock, ChevronDown, ChevronUp, Download, Trash2, Eye
} from 'lucide-react'

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT').format(n)
}

const SOURCE_LABELS = {
  csv_banca: 'Estratto conto banca',
  csv_ade: 'Fatture AdE',
  csv_pos: 'Incassi POS',
  api_pos: 'API POS',
  api_ade: 'API AdE',
  manuale: 'Inserimento manuale',
}

const STATUS_CONFIG = {
  pending: { label: 'In attesa', color: 'bg-slate-100 text-slate-600', icon: Clock },
  processing: { label: 'In elaborazione', color: 'bg-blue-50 text-blue-600', icon: RefreshCw },
  completed: { label: 'Completato', color: 'bg-emerald-50 text-emerald-700', icon: Check },
  error: { label: 'Errore', color: 'bg-red-50 text-red-600', icon: AlertCircle },
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending
  const Icon = config.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`}>
      <Icon size={12} />
      {config.label}
    </span>
  )
}

// ====== UPLOAD AREA ======
function UploadArea({ onUpload, uploading }: { onUpload: (file: File, source: string, outletId: string) => void; uploading: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [selectedSource, setSelectedSource] = useState('csv_banca')
  const [selectedOutlet, setSelectedOutlet] = useState('')
  // TODO: tighten type — Supabase data
  const [outlets, setOutlets] = useState<any[]>([])

  useEffect(() => {
    supabase.from('outlets').select('id, name, code')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => { if (data) setOutlets(data) })
  }, [])

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onUpload(file, selectedSource, selectedOutlet)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onUpload(file, selectedSource, selectedOutlet)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 mb-4">Nuova importazione</h2>

      {/* Opzioni */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Tipo sorgente</label>
          <select
            value={selectedSource}
            onChange={e => setSelectedSource(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="csv_banca">Estratto conto banca (CSV)</option>
            <option value="csv_ade">Fatture Agenzia Entrate (CSV)</option>
            <option value="csv_pos">Incassi POS (CSV)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Outlet (opzionale)</label>
          <select
            value={selectedOutlet}
            onChange={e => setSelectedOutlet(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Tutti gli outlet / Sede</option>
            {outlets.map(o => (
              <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
          dragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <RefreshCw size={32} className="text-blue-500 animate-spin" />
            <span className="text-sm text-blue-600 font-medium">Caricamento in corso...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={32} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-700">
              Trascina un file CSV o clicca per selezionare
            </span>
            <span className="text-xs text-slate-400">
              Formati supportati: CSV, XLSX — Max 10MB
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ====== STORICO IMPORTAZIONI ======
// TODO: tighten type — Supabase data
function ImportHistory({ batches, onRefresh }: { batches: any[]; onRefresh: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          Storico importazioni ({batches.length})
        </h2>
      </div>

      {batches.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-sm">
          Nessuna importazione effettuata.
          Carica il primo file per iniziare.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {batches.map(batch => (
            <div key={batch.id}>
              <div
                className="p-4 flex items-center gap-4 hover:bg-slate-50/50 cursor-pointer transition"
                onClick={() => setExpandedId(expandedId === batch.id ? null : batch.id)}
              >
                <div className="p-2 rounded-lg bg-slate-100 text-slate-500">
                  <FileText size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-slate-900 truncate">
                      {batch.file_name || 'Importazione'}
                    </span>
                    <StatusBadge status={batch.status} />
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                    <span>{SOURCE_LABELS[batch.source] || batch.source}</span>
                    <span>•</span>
                    <span>{new Date(batch.created_at).toLocaleDateString('it-IT', {
                      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}</span>
                    {batch.total_rows > 0 && (
                      <>
                        <span>•</span>
                        <span>{fmt(batch.total_rows)} righe</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right text-sm">
                  {batch.status === 'completed' && (
                    <div className="text-emerald-600 font-medium">
                      {fmt(batch.processed_rows || batch.total_rows)} elaborate
                    </div>
                  )}
                  {batch.error_rows > 0 && (
                    <div className="text-red-500 text-xs">{batch.error_rows} errori</div>
                  )}
                </div>
                {expandedId === batch.id ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </div>

              {expandedId === batch.id && (
                <div className="px-4 pb-4 bg-slate-50/50">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm py-3">
                    <div>
                      <div className="text-xs text-slate-400">Sorgente</div>
                      <div className="font-medium text-slate-700">{SOURCE_LABELS[batch.source]}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Righe totali</div>
                      <div className="font-medium text-slate-700">{fmt(batch.total_rows)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Elaborate</div>
                      <div className="font-medium text-emerald-600">{fmt(batch.processed_rows)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Errori</div>
                      <div className={`font-medium ${batch.error_rows > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {fmt(batch.error_rows)}
                      </div>
                    </div>
                  </div>
                  {batch.notes && (
                    <div className="text-xs text-slate-500 mt-1 p-2 bg-white rounded border border-slate-200">
                      {batch.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ====== PAGINA PRINCIPALE ======
export default function Importazioni() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  // TODO: tighten type — Supabase data
  const [batches, setBatches] = useState<any[]>([])
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null)

  useEffect(() => { loadBatches() }, [])

  async function loadBatches() {
    setLoading(true)
    const { data } = await supabase
      .from('import_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (data) setBatches(data)
    setLoading(false)
  }

  async function handleUpload(file: File, source: string, outletId: string) {
    setUploading(true)
    setMessage(null)

    try {
      // Leggi il CSV
      const text = await file.text()
      const lines = text.trim().split('\n')
      const totalRows = Math.max(0, lines.length - 1) // -1 per header

      // Crea batch record
      const { data: batch, error: batchError } = await supabase
        .from('import_batches')
        .insert({
          company_id: profile.company_id,
          outlet_id: outletId || null,
          source: source,
          file_name: file.name,
          total_rows: totalRows,
          processed_rows: 0,
          error_rows: 0,
          status: 'pending',
          notes: `Caricato da ${profile.first_name} ${profile.last_name}`
        })
        .select()
        .single()

      if (batchError) throw batchError

      // Simula elaborazione (in produzione qui ci sara il parser vero)
      await supabase
        .from('import_batches')
        .update({
          status: 'completed',
          processed_rows: totalRows,
          error_rows: 0,
          notes: `Caricato da ${profile.first_name} ${profile.last_name}. File pronto per elaborazione.`
        })
        .eq('id', batch.id)

      setMessage({
        type: 'success',
        text: `File "${file.name}" caricato con successo. ${totalRows} righe trovate.`
      })

      loadBatches()
    } catch (err: unknown) {
      setMessage({
        type: 'error',
        text: `Errore nel caricamento: ${(err as Error).message}`
      })
    }

    setUploading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={24} className="animate-spin text-blue-600" />
      </div>
    )
  }

  const completed = batches.filter(b => b.status === 'completed').length
  const totalRows = batches.reduce((s, b) => s + (b.processed_rows || 0), 0)
  const withErrors = batches.filter(b => b.error_rows > 0).length

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Importazioni</h1>
          <p className="text-sm text-slate-500">
            Carica file CSV da banche, POS o Agenzia delle Entrate
          </p>
        </div>
        <button
          onClick={loadBatches}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-white transition"
        >
          <RefreshCw size={16} />
          Aggiorna
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 inline-flex mb-3">
            <FileText size={20} />
          </div>
          <div className="text-2xl font-bold text-slate-900">{batches.length}</div>
          <div className="text-sm text-slate-500">Importazioni totali</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 inline-flex mb-3">
            <Check size={20} />
          </div>
          <div className="text-2xl font-bold text-slate-900">{fmt(totalRows)}</div>
          <div className="text-sm text-slate-500">Righe elaborate</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600 inline-flex mb-3">
            <AlertCircle size={20} />
          </div>
          <div className="text-2xl font-bold text-slate-900">{withErrors}</div>
          <div className="text-sm text-slate-500">Con errori</div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`flex items-center gap-3 p-4 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
          <span className="flex-1">{message.text}</span>
          <button onClick={() => setMessage(null)} className="hover:opacity-70">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Upload area */}
      <UploadArea onUpload={handleUpload} uploading={uploading} />

      {/* History */}
      <ImportHistory batches={batches} onRefresh={loadBatches} />
    </div>
  )
}
