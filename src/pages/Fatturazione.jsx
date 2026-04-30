import { useState, useEffect, useCallback, useMemo } from 'react'
import PageHelp from '../components/PageHelp'
import InvoiceViewer from '../components/InvoiceViewer'
import StatusBadge from '../components/ui/StatusBadge'
import { supabase } from '../lib/supabase'
import { useYapily } from '../hooks/useYapily'
import { usePeriod } from '../hooks/usePeriod'
import { useTableSort } from '../hooks/useTableSort'
import SortableTh from '../components/ui/SortableTh'
import {
  FileText, Upload, Send, RefreshCw, Search, Filter, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Clock, AlertTriangle, Eye, Download, Plus, X,
  Building2, Calendar, Euro, Hash, FileCode, Inbox, ArrowUpRight, Loader2,
  BarChart3, Store, Zap
} from 'lucide-react'

// ─── Helpers ────────────────────────────────────────────────────────────

const fmt = (n) => n != null ? Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('it-IT') : '—'

const SDI_STATUS_CONFIG = {
  DRAFT: { label: 'Bozza', color: 'bg-slate-100 text-slate-700', icon: FileText },
  SENT: { label: 'Inviata', color: 'bg-blue-100 text-blue-700', icon: Send },
  RECEIVED: { label: 'Ricevuta', color: 'bg-blue-100 text-blue-700', icon: Inbox },
  DELIVERED: { label: 'Consegnata', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  ACCEPTED: { label: 'Accettata', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  REJECTED: { label: 'Scartata', color: 'bg-red-100 text-red-700', icon: XCircle },
  DEPOSITED: { label: 'Depositata', color: 'bg-amber-100 text-amber-700', icon: Clock },
  ERROR: { label: 'Errore', color: 'bg-red-100 text-red-700', icon: AlertTriangle },
  PENDING: { label: 'In attesa', color: 'bg-slate-100 text-slate-600', icon: Clock },
}

const CORR_STATUS_CONFIG = {
  PENDING: { label: 'Da inviare', color: 'bg-slate-100 text-slate-700' },
  SENT: { label: 'Inviato', color: 'bg-blue-100 text-blue-700' },
  ACCEPTED: { label: 'Accettato', color: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Rifiutato', color: 'bg-red-100 text-red-700' },
  ERROR: { label: 'Errore', color: 'bg-red-100 text-red-700' },
}

function SdiStatusBadge({ status, configMap = SDI_STATUS_CONFIG }) {
  const cfg = configMap[status] || configMap.PENDING
  const Icon = cfg.icon || Clock
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon && <Icon size={12} />}
      {cfg.label}
    </span>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-50 text-slate-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${colorMap[color]} flex items-center justify-center`}>
          <Icon size={20} />
        </div>
        <div>
          <div className="text-2xl font-bold text-slate-900">{value}</div>
          <div className="text-xs text-slate-500">{label}</div>
          {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── callFunction helper (same pattern as useYapily) ────────────────────

async function callEdgeFunction(fnName, method = 'GET', body = null, params = null) {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdmZ4c3ZxcG5wdmliZ2VxcHFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNDkwNDcsImV4cCI6MjA5MDcyNTA0N30.ohYziAXiOWS0TKU9HHuhUAbf5Geh10xbLGEoftOMJZA'
  const baseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xfvfxsvqpnpvibgeqpqp.supabase.co'

  let url = `${baseUrl}/functions/v1/${fnName}`
  if (params) {
    const qs = new URLSearchParams(params).toString()
    if (qs) url += `?${qs}`
  }

  const doFetch = async (accessToken) => {
    return fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'apikey': anonKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  let { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Non autenticato')

  let res = await doFetch(session.access_token)
  if (res.status === 401) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError || !refreshData.session) throw new Error('Sessione scaduta')
    res = await doFetch(refreshData.session.access_token)
  }

  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `Errore ${res.status}`)
  return json
}

// ═══════════════════════════════════════════════════════════════════════
// TAB 1: FATTURE PASSIVE (ricevute da fornitori)
// ═══════════════════════════════════════════════════════════════════════

function FatturePassive() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  // Filtro anno: si allinea al filtro globale del PeriodContext (header
  // in alto). Quando l'utente cambia anno nell'header, qui si aggiorna
  // automaticamente. L'utente puo' comunque sovrascriverlo localmente col
  // select in pagina. Se arriva da Dashboard con ?year= ha la priorita'.
  const { year: globalYear } = usePeriod()
  const [yearFilter, setYearFilter] = useState(() => {
    if (typeof window === 'undefined') return String(globalYear || new Date().getFullYear())
    const p = new URLSearchParams(window.location.search).get('year')
    if (p && /^\d{4}$/.test(p)) return p
    return String(globalYear || new Date().getFullYear())
  })
  // Sync quando il globalYear cambia (es. utente cambia selettore header)
  useEffect(() => {
    if (globalYear) setYearFilter(String(globalYear))
  }, [globalYear])
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [showXml, setShowXml] = useState(false)
  const [viewingXml, setViewingXml] = useState(null) // XML content for InvoiceViewer
  const [uploading, setUploading] = useState(false)

  const loadInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('electronic_invoices')
        .select('*')
        .order('invoice_date', { ascending: false })
        .limit(500)
      if (error) throw error
      setInvoices(data || [])
    } catch (err) {
      console.error('Errore caricamento fatture passive:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  // Upload XML FatturaPA
  const handleXmlUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const xmlContent = await file.text()
      if (!xmlContent.includes('FatturaElettronica')) {
        alert('Il file non sembra essere un XML FatturaPA valido.')
        return
      }
      const result = await callEdgeFunction('sdi-receive', 'POST', { xmlContent })
      if (result.data) {
        alert(`Fattura ${result.data.action === 'created' ? 'importata' : 'aggiornata'}: ${result.data.invoice.invoice_number}`)
        loadInvoices()
      }
    } catch (err) {
      alert('Errore upload: ' + err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // Carica XML multipli per associare xml_content alle fatture esistenti
  const [xmlUpdateProgress, setXmlUpdateProgress] = useState(null)
  const handleBulkXmlUpdate = async (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setXmlUpdateProgress({ total: files.length, done: 0, matched: 0, errors: 0 })
    let done = 0, matched = 0, errors = 0

    for (const file of files) {
      try {
        const xmlText = await file.text()
        if (!xmlText.includes('FatturaElettronica')) { done++; errors++; continue }

        // Estrai numero fattura e P.IVA dal XML per match
        const parser = new DOMParser()
        const doc = parser.parseFromString(xmlText, 'text/xml')
        const root = doc.documentElement
        // Cerca numero fattura
        const numero = root.querySelector('FatturaElettronicaBody DatiGenerali DatiGeneraliDocumento Numero')?.textContent?.trim()
        // Cerca P.IVA cedente
        const piva = root.querySelector('FatturaElettronicaHeader CedentePrestatore DatiAnagrafici IdFiscaleIVA IdCodice')?.textContent?.trim()

        if (numero) {
          // Match per invoice_number (e opzionalmente supplier_vat)
          let query = supabase.from('electronic_invoices')
            .update({ xml_content: xmlText })
            .eq('invoice_number', numero)
            .is('xml_content', null)
          if (piva) query = query.eq('supplier_vat', piva)
          const { data, error } = await query.select('id')
          if (!error && data && data.length > 0) matched += data.length
        }
      } catch (err) {
        console.error('Errore XML update:', file.name, err)
        errors++
      }
      done++
      setXmlUpdateProgress({ total: files.length, done, matched, errors })
    }

    setXmlUpdateProgress(prev => ({ ...prev, finished: true }))
    loadInvoices()
    e.target.value = ''
  }

  // Anni disponibili per il filtro: estratti dalle date fatture + anno corrente
  const availableYears = useMemo(() => {
    const years = new Set([String(new Date().getFullYear())])
    invoices.forEach(inv => {
      if (inv.invoice_date) years.add(String(new Date(inv.invoice_date).getFullYear()))
    })
    return Array.from(years).sort((a, b) => Number(b) - Number(a))
  }, [invoices])

  const filtered = invoices.filter(inv => {
    if (statusFilter !== 'ALL' && (inv.sdi_status || 'RECEIVED') !== statusFilter) return false
    if (yearFilter !== 'ALL' && inv.invoice_date) {
      const y = String(new Date(inv.invoice_date).getFullYear())
      if (y !== yearFilter) return false
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      return (
        (inv.supplier_name || '').toLowerCase().includes(q) ||
        (inv.invoice_number || '').toLowerCase().includes(q) ||
        (inv.sdi_id || '').toLowerCase().includes(q) ||
        (inv.description || '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // Stats calcolate sul SET FILTRATO — cosi i KPI si aggiornano con il filtro anno
  // e corrispondono al valore mostrato nella Dashboard (Costi = fatture {year}).
  const stats = useMemo(() => {
    const s = { total: 0, withSdi: 0, totalAmount: 0, byStatus: {} }
    for (const inv of filtered) {
      s.total++
      if (inv.sdi_id) s.withSdi++
      s.totalAmount += Number(inv.gross_amount || 0)
      const st = inv.sdi_status || 'RECEIVED'
      s.byStatus[st] = (s.byStatus[st] || 0) + 1
    }
    return s
  }, [filtered])

  // Sort tabella fatture passive: default invoice_date desc (le piu' recenti
  // in cima), persistente per refresh, reset al cambio anno.
  const { sorted: sortedFiltered, sortBy: ftSortBy, onSort: ftOnSort, reset: ftResetSort } = useTableSort(
    filtered,
    [{ key: 'invoice_date', dir: 'desc' }],
    { persistKey: 'fatture_passive', resetOn: [yearFilter] }
  );

  return (
    <div className="space-y-4">
      {/* KPI — coerenti col badge tab. Fatture totali include le NC: il
          sub-testo separa fatture positive da note credito cosi' il numero
          principale corrisponde al badge del tab (es. "202 = 198 fatt + 4 NC"). */}
      {stats && (() => {
        const notCrediti = filtered.filter(inv => (Number(inv.gross_amount) || 0) < 0).length;
        const fattureNormali = stats.total - notCrediti;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              icon={FileText}
              label="Fatture passive"
              value={stats.total}
              sub={notCrediti > 0 ? `${fattureNormali} fatture + ${notCrediti} note credito` : undefined}
              color="blue"
            />
            <KpiCard icon={Euro} label="Totale lordo" value={`€ ${fmt(stats.totalAmount)}`} color="green" />
            <KpiCard icon={Zap} label="Con ID SDI" value={stats.withSdi} sub={`${stats.total - stats.withSdi} senza`} color="amber" />
            <KpiCard icon={CheckCircle} label="Accettate" value={stats.byStatus.ACCEPTED || 0} sub={`${stats.byStatus.REJECTED || 0} scartate`} color="green" />
          </div>
        );
      })()}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Cerca fornitore, numero fattura, SDI..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
          title="Filtra per anno (coerente con KPI Costi della Dashboard)"
        >
          <option value="ALL">Tutti gli anni</option>
          {availableYears.map(y => <option key={y} value={y}>Anno {y}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
        >
          <option value="ALL">Tutti gli stati</option>
          <option value="RECEIVED">Ricevute</option>
          <option value="ACCEPTED">Accettate</option>
          <option value="REJECTED">Scartate</option>
          <option value="PENDING">In attesa</option>
        </select>
        <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 cursor-pointer transition">
          <Upload size={16} />
          {uploading ? 'Importazione...' : 'Importa XML'}
          <input type="file" accept=".xml" onChange={handleXmlUpload} className="hidden" disabled={uploading} />
        </label>
        <label className="flex items-center gap-2 px-3 py-2 bg-white text-slate-700 text-sm rounded-lg hover:bg-slate-50 cursor-pointer transition border border-slate-300"
          title="Carica gli XML originali per associarli alle fatture già importate (match per numero fattura)">
          <FileCode size={16} />
          Associa XML
          <input type="file" accept=".xml" multiple onChange={handleBulkXmlUpdate} className="hidden" />
        </label>
        <button onClick={loadInvoices} className="p-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Progresso aggiornamento XML */}
      {xmlUpdateProgress && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-amber-800">
              {xmlUpdateProgress.finished
                ? `Completato: ${xmlUpdateProgress.matched} fatture aggiornate su ${xmlUpdateProgress.total} file`
                : `Elaborazione ${xmlUpdateProgress.done}/${xmlUpdateProgress.total} file... (${xmlUpdateProgress.matched} match)`
              }
              {xmlUpdateProgress.errors > 0 && ` — ${xmlUpdateProgress.errors} errori`}
            </span>
            {xmlUpdateProgress.finished && (
              <button onClick={() => setXmlUpdateProgress(null)} className="text-amber-600 hover:text-amber-800">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tabella */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {ftSortBy.length > 0 && !(ftSortBy.length === 1 && ftSortBy[0].key === 'invoice_date' && ftSortBy[0].dir === 'desc') && (
          <div className="px-3 py-1.5 bg-blue-50/50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-2">
            <span>Ordinamento personalizzato attivo</span>
            <button onClick={ftResetSort} className="ml-auto text-blue-600 hover:text-blue-800 font-medium">Reset</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 z-10">
              <tr className="bg-slate-50 border-b border-slate-200">
                <SortableTh sortKey="invoice_date" sortBy={ftSortBy} onSort={ftOnSort}>Data</SortableTh>
                <SortableTh sortKey="invoice_number" sortBy={ftSortBy} onSort={ftOnSort} className="min-w-[150px]">Numero</SortableTh>
                <SortableTh sortKey="supplier_name" sortBy={ftSortBy} onSort={ftOnSort}>Fornitore</SortableTh>
                <SortableTh sortKey="tipo_documento" sortBy={ftSortBy} onSort={ftOnSort}>Tipo</SortableTh>
                <SortableTh sortKey="net_amount" sortBy={ftSortBy} onSort={ftOnSort} align="right">Imponibile</SortableTh>
                <SortableTh sortKey="vat_amount" sortBy={ftSortBy} onSort={ftOnSort} align="right">IVA</SortableTh>
                <SortableTh sortKey="gross_amount" sortBy={ftSortBy} onSort={ftOnSort} align="right">Totale</SortableTh>
                <SortableTh sortKey="sdi_status" sortBy={ftSortBy} onSort={ftOnSort} align="center">Stato SDI</SortableTh>
                <th className="text-center px-4 py-3 font-medium text-slate-600 text-[11px] uppercase tracking-wider">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Caricamento fatture...</td></tr>
              ) : sortedFiltered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400">Nessuna fattura trovata</td></tr>
              ) : sortedFiltered.map((inv, idx) => (
                <tr key={inv.id} onClick={() => { setSelectedInvoice(inv); setShowXml(false) }} className={`border-b border-slate-100 hover:bg-blue-50/50 transition-colors cursor-pointer ${idx % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(inv.invoice_date)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900 truncate min-w-[150px] max-w-[200px]" title={inv.invoice_number}>{inv.invoice_number || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800 truncate max-w-[280px]" title={inv.supplier_name}>{inv.supplier_name || '—'}</div>
                    {inv.supplier_vat && <div className="text-xs text-slate-400">P.IVA {inv.supplier_vat}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{inv.tipo_documento || '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{fmt(inv.net_amount)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{fmt(inv.vat_amount)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(inv.gross_amount)}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={inv.sdi_status || 'RECEIVED'} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedInvoice(inv); setShowXml(false) }}
                      className="p-1.5 text-slate-400 hover:text-blue-600 rounded transition"
                      title="Dettaglio"
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && <div className="px-4 py-2 bg-slate-50 text-xs text-slate-500 border-t border-slate-200">{filtered.length} fatture visualizzate su {invoices.length} totali</div>}
      </div>

      {/* Slide-over dettaglio fattura */}
      {selectedInvoice && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 transition-opacity" onClick={() => setSelectedInvoice(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/50">
              <div>
                <h3 className="font-semibold text-lg text-slate-900">Fattura {selectedInvoice.invoice_number || '—'}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge status={selectedInvoice.sdi_status || 'RECEIVED'} />
                  {selectedInvoice.tipo_documento && (
                    <span className="text-xs text-slate-400 font-medium">{selectedInvoice.tipo_documento}</span>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"><X size={20} /></button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Fornitore */}
              <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Fornitore</h4>
                <div className="text-base font-semibold text-slate-900">{selectedInvoice.supplier_name || '—'}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-slate-500">P.IVA</span>
                    <div className="text-sm font-medium text-slate-800 font-mono">{selectedInvoice.supplier_vat || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Codice Fiscale</span>
                    <div className="text-sm font-medium text-slate-800 font-mono">{selectedInvoice.supplier_fiscal_code || '—'}</div>
                  </div>
                </div>
              </div>

              {/* Importi */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Importi</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white border border-slate-200 rounded-lg p-3 text-center">
                    <span className="text-xs text-slate-500 block">Imponibile</span>
                    <div className="text-sm font-semibold text-slate-800 mt-0.5">{fmt(selectedInvoice.net_amount)}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-lg p-3 text-center">
                    <span className="text-xs text-slate-500 block">IVA</span>
                    <div className="text-sm font-semibold text-slate-800 mt-0.5">{fmt(selectedInvoice.vat_amount)}</div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                    <span className="text-xs text-blue-600 block">Totale</span>
                    <div className="text-lg font-bold text-blue-700 mt-0.5">{fmt(selectedInvoice.gross_amount)}</div>
                  </div>
                </div>
              </div>

              {/* Dettagli documento */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Dettagli documento</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-slate-500">Data fattura</span>
                    <div className="text-sm font-medium text-slate-800">{fmtDate(selectedInvoice.invoice_date)}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Tipo documento</span>
                    <div className="text-sm font-medium text-slate-800">{selectedInvoice.tipo_documento || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Stato SDI</span>
                    <div className="mt-0.5"><StatusBadge status={selectedInvoice.sdi_status || 'RECEIVED'} /></div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">ID SDI</span>
                    <div className="text-sm font-medium text-slate-800 font-mono">{selectedInvoice.sdi_id || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Scadenza</span>
                    <div className="text-sm font-medium text-slate-800">{fmtDate(selectedInvoice.due_date)}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Codice destinatario</span>
                    <div className="text-sm font-medium text-slate-800 font-mono">{selectedInvoice.codice_destinatario || '—'}</div>
                  </div>
                </div>
              </div>

              {/* Pagamento */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Pagamento</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-slate-500">Metodo</span>
                    <div className="text-sm font-medium text-slate-800">{selectedInvoice.payment_method || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Termini</span>
                    <div className="text-sm font-medium text-slate-800">{selectedInvoice.payment_terms || '—'}</div>
                  </div>
                </div>
              </div>

              {/* Note */}
              {(selectedInvoice.description || selectedInvoice.notes) && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Note</h4>
                  <div className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3">
                    {selectedInvoice.description || selectedInvoice.notes}
                  </div>
                </div>
              )}

              {/* Visualizza fattura formattata */}
              {selectedInvoice.xml_content && (
                <div className="space-y-2">
                  <button
                    onClick={() => setViewingXml(selectedInvoice.xml_content)}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
                  >
                    <Eye size={14} />
                    Visualizza fattura formattata
                  </button>
                  <button
                    onClick={() => setShowXml(!showXml)}
                    className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 transition"
                  >
                    <FileCode size={12} />
                    {showXml ? 'Nascondi XML grezzo' : 'Mostra XML grezzo'}
                  </button>
                  {showXml && (
                    <pre className="p-3 bg-slate-900 text-green-400 rounded-lg text-xs overflow-x-auto max-h-72 border border-slate-700 font-mono leading-relaxed">
                      {selectedInvoice.xml_content}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* InvoiceViewer modal */}
      {viewingXml && (
        <InvoiceViewer xmlContent={viewingXml} onClose={() => setViewingXml(null)} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// TAB 2: FATTURE ATTIVE (emesse)
// ═══════════════════════════════════════════════════════════════════════

function FattureAttive() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [sending, setSending] = useState(null) // invoiceId in corso di invio
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [showXml, setShowXml] = useState(false)
  const [viewingXml, setViewingXml] = useState(null)

  const loadInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('active_invoices')
        .select('*')
        .order('invoice_date', { ascending: false })
        .limit(500)
      if (error) throw error
      setInvoices(data || [])
    } catch (err) {
      console.error('Errore caricamento fatture attive:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  // Genera XML per una fattura
  const handleGenerateXml = async (invoiceId) => {
    try {
      await callEdgeFunction('sdi-generate-xml', 'POST', { invoiceId })
      alert('XML generato con successo')
      loadInvoices()
    } catch (err) {
      alert('Errore generazione XML: ' + err.message)
    }
  }

  // Invia fattura a SDI
  const handleSend = async (invoiceId) => {
    setSending(invoiceId)
    try {
      const result = await callEdgeFunction('sdi-send', 'POST', { invoiceId })
      alert(`Fattura inviata! SDI ID: ${result.data.sdiId} (${result.data.environment})`)
      loadInvoices()
    } catch (err) {
      alert('Errore invio SDI: ' + err.message)
    } finally {
      setSending(null)
    }
  }

  // Form nuova fattura
  const [form, setForm] = useState({
    invoice_number: '', invoice_date: new Date().toISOString().split('T')[0],
    tipo_documento: 'TD01', client_name: '', client_vat: '', client_fiscal_code: '',
    codice_destinatario: '', total_amount: '', taxable_amount: '', vat_amount: '',
    vat_rate: '22.00', payment_method: 'MP05', due_date: '', description: '',
  })

  const handleCreateInvoice = async (e) => {
    e.preventDefault()
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const companyId = user?.app_metadata?.company_id
      const record = {
        company_id: companyId,
        invoice_number: form.invoice_number,
        invoice_date: form.invoice_date,
        tipo_documento: form.tipo_documento,
        client_name: form.client_name,
        client_vat: form.client_vat || null,
        client_fiscal_code: form.client_fiscal_code || null,
        codice_destinatario: form.codice_destinatario || null,
        total_amount: Number(form.total_amount),
        taxable_amount: Number(form.taxable_amount) || null,
        vat_amount: Number(form.vat_amount) || null,
        vat_rate: Number(form.vat_rate),
        payment_method: form.payment_method,
        due_date: form.due_date || null,
        sdi_status: 'DRAFT',
      }
      const { error } = await supabase.from('active_invoices').insert(record)
      if (error) throw error
      setShowForm(false)
      setForm({ invoice_number: '', invoice_date: new Date().toISOString().split('T')[0], tipo_documento: 'TD01', client_name: '', client_vat: '', client_fiscal_code: '', codice_destinatario: '', total_amount: '', taxable_amount: '', vat_amount: '', vat_rate: '22.00', payment_method: 'MP05', due_date: '', description: '' })
      loadInvoices()
    } catch (err) {
      alert('Errore creazione fattura: ' + err.message)
    }
  }

  const filtered = invoices.filter(inv => {
    if (!searchTerm) return true
    const q = searchTerm.toLowerCase()
    return (inv.client_name || '').toLowerCase().includes(q) || (inv.invoice_number || '').toLowerCase().includes(q)
  })

  const stats = {
    total: invoices.length,
    draft: invoices.filter(i => i.sdi_status === 'DRAFT').length,
    sent: invoices.filter(i => ['SENT', 'DELIVERED', 'ACCEPTED'].includes(i.sdi_status)).length,
    totalAmount: invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0),
  }

  // Sort tabella fatture attive: default invoice_date desc.
  const { sorted: sortedFiltered, sortBy: faSortBy, onSort: faOnSort, reset: faResetSort } = useTableSort(
    filtered,
    [{ key: 'invoice_date', dir: 'desc' }],
    { persistKey: 'fatture_attive' }
  );

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={FileText} label="Fatture emesse" value={stats.total} color="blue" />
        <KpiCard icon={Euro} label="Totale emesso" value={`€ ${fmt(stats.totalAmount)}`} color="green" />
        <KpiCard icon={Clock} label="Bozze" value={stats.draft} color="amber" />
        <KpiCard icon={Send} label="Inviate SDI" value={stats.sent} color="green" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Cerca cliente, numero fattura..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={16} />
          Nuova fattura
        </button>
        <button onClick={loadInvoices} className="p-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabella */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {faSortBy.length > 0 && !(faSortBy.length === 1 && faSortBy[0].key === 'invoice_date' && faSortBy[0].dir === 'desc') && (
          <div className="px-3 py-1.5 bg-blue-50/50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-2">
            <span>Ordinamento personalizzato attivo</span>
            <button onClick={faResetSort} className="ml-auto text-blue-600 hover:text-blue-800 font-medium">Reset</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 z-10">
              <tr className="bg-slate-50 border-b border-slate-200">
                <SortableTh sortKey="invoice_date" sortBy={faSortBy} onSort={faOnSort}>Data</SortableTh>
                <SortableTh sortKey="invoice_number" sortBy={faSortBy} onSort={faOnSort}>Numero</SortableTh>
                <SortableTh sortKey="client_name" sortBy={faSortBy} onSort={faOnSort}>Cliente</SortableTh>
                <SortableTh sortKey="tipo_documento" sortBy={faSortBy} onSort={faOnSort}>Tipo</SortableTh>
                <SortableTh sortKey="total_amount" sortBy={faSortBy} onSort={faOnSort} align="right">Totale</SortableTh>
                <SortableTh sortKey="sdi_status" sortBy={faSortBy} onSort={faOnSort} align="center">Stato SDI</SortableTh>
                <th className="text-center px-4 py-3 font-medium text-slate-600 text-[11px] uppercase tracking-wider">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Caricamento...</td></tr>
              ) : sortedFiltered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400">
                  <FileText size={32} className="mx-auto mb-2 text-slate-300" />
                  Nessuna fattura attiva. Crea la prima!
                </td></tr>
              ) : sortedFiltered.map((inv, idx) => (
                <tr key={inv.id} onClick={() => { setSelectedInvoice(inv); setShowXml(false) }} className={`border-b border-slate-100 hover:bg-blue-50/50 transition-colors cursor-pointer ${idx % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(inv.invoice_date)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{inv.invoice_number}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{inv.client_name}</div>
                    {inv.client_vat && <div className="text-xs text-slate-400">P.IVA {inv.client_vat}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{inv.tipo_documento}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(inv.total_amount)}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={inv.sdi_status || 'DRAFT'} /></td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {inv.sdi_status === 'DRAFT' && !inv.xml_content && (
                        <button onClick={(e) => { e.stopPropagation(); handleGenerateXml(inv.id) }} className="p-1.5 text-slate-400 hover:text-blue-600 rounded transition" title="Genera XML">
                          <FileCode size={16} />
                        </button>
                      )}
                      {(inv.sdi_status === 'DRAFT' || inv.sdi_status === 'ERROR') && inv.xml_content && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSend(inv.id) }}
                          disabled={sending === inv.id}
                          className="p-1.5 text-slate-400 hover:text-green-600 rounded transition disabled:opacity-50"
                          title="Invia a SDI"
                        >
                          {sending === inv.id ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                      )}
                      {inv.sdi_id && (
                        <span className="text-xs text-slate-400 font-mono ml-1">{inv.sdi_id.substring(0, 12)}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal nuova fattura */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="font-semibold text-lg text-slate-900">Nuova Fattura Attiva</h3>
              <button onClick={() => setShowForm(false)} className="p-1 text-slate-400 hover:text-slate-700 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateInvoice} className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Numero fattura *</label>
                  <input type="text" required value={form.invoice_number} onChange={e => setForm({...form, invoice_number: e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Data *</label>
                  <input type="date" required value={form.invoice_date} onChange={e => setForm({...form, invoice_date: e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo documento</label>
                  <select value={form.tipo_documento} onChange={e => setForm({...form, tipo_documento: e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                    <option value="TD01">TD01 — Fattura</option>
                    <option value="TD02">TD02 — Acconto</option>
                    <option value="TD04">TD04 — Nota credito</option>
                    <option value="TD05">TD05 — Nota debito</option>
                    <option value="TD06">TD06 — Parcella</option>
                    <option value="TD24">TD24 — Fatt. differita</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Metodo pagamento</label>
                  <select value={form.payment_method} onChange={e => setForm({...form, payment_method: e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                    <option value="MP05">MP05 — Bonifico</option>
                    <option value="MP01">MP01 — Contanti</option>
                    <option value="MP02">MP02 — Assegno</option>
                    <option value="MP08">MP08 — Carta credito</option>
                    <option value="MP12">MP12 — RIBA</option>
                  </select>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <h4 className="text-sm font-medium text-slate-700 mb-2">Cliente</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Denominazione *</label>
                    <input type="text" required value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">P.IVA</label>
                    <input type="text" value={form.client_vat} onChange={e => setForm({...form, client_vat: e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Codice fiscale</label>
                    <input type="text" value={form.client_fiscal_code} onChange={e => setForm({...form, client_fiscal_code: e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Codice SDI (7 char)</label>
                    <input type="text" maxLength={7} value={form.codice_destinatario} onChange={e => setForm({...form, codice_destinatario: e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <h4 className="text-sm font-medium text-slate-700 mb-2">Importi</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Imponibile</label>
                    <input type="number" step="0.01" value={form.taxable_amount} onChange={e => {
                      const tax = Number(e.target.value)
                      const vatAmt = tax * Number(form.vat_rate) / 100
                      setForm({...form, taxable_amount: e.target.value, vat_amount: vatAmt.toFixed(2), total_amount: (tax + vatAmt).toFixed(2)})
                    }} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Aliquota IVA %</label>
                    <input type="number" step="0.01" value={form.vat_rate} onChange={e => {
                      const rate = Number(e.target.value)
                      const vatAmt = Number(form.taxable_amount) * rate / 100
                      setForm({...form, vat_rate: e.target.value, vat_amount: vatAmt.toFixed(2), total_amount: (Number(form.taxable_amount) + vatAmt).toFixed(2)})
                    }} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Totale *</label>
                    <input type="number" step="0.01" required value={form.total_amount} onChange={e => setForm({...form, total_amount: e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-semibold" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Scadenza pagamento</label>
                  <input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition">Annulla</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">Crea fattura</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Slide-over dettaglio fattura attiva */}
      {selectedInvoice && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 transition-opacity" onClick={() => setSelectedInvoice(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl border-l border-slate-200 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/50">
              <div>
                <h3 className="font-semibold text-lg text-slate-900">Fattura {selectedInvoice.invoice_number}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge status={selectedInvoice.sdi_status || 'DRAFT'} />
                  <span className="text-xs text-slate-400 font-medium">{selectedInvoice.tipo_documento}</span>
                </div>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"><X size={20} /></button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Cliente */}
              <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Cliente</h4>
                <div className="text-base font-semibold text-slate-900">{selectedInvoice.client_name}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-slate-500">P.IVA</span>
                    <div className="text-sm font-medium text-slate-800 font-mono">{selectedInvoice.client_vat || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Codice Fiscale</span>
                    <div className="text-sm font-medium text-slate-800 font-mono">{selectedInvoice.client_fiscal_code || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Codice SDI</span>
                    <div className="text-sm font-medium text-slate-800 font-mono">{selectedInvoice.codice_destinatario || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">PEC</span>
                    <div className="text-sm font-medium text-slate-800">{selectedInvoice.pec_destinatario || '—'}</div>
                  </div>
                </div>
              </div>

              {/* Importi */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Importi</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white border border-slate-200 rounded-lg p-3 text-center">
                    <span className="text-xs text-slate-500 block">Imponibile</span>
                    <div className="text-sm font-semibold text-slate-800 mt-0.5">{fmt(selectedInvoice.taxable_amount)}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-lg p-3 text-center">
                    <span className="text-xs text-slate-500 block">IVA {selectedInvoice.vat_rate}%</span>
                    <div className="text-sm font-semibold text-slate-800 mt-0.5">{fmt(selectedInvoice.vat_amount)}</div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                    <span className="text-xs text-blue-600 block">Totale</span>
                    <div className="text-lg font-bold text-blue-700 mt-0.5">{fmt(selectedInvoice.total_amount)}</div>
                  </div>
                </div>
              </div>

              {/* Dettagli */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Dettagli</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-slate-500">Data fattura</span>
                    <div className="text-sm font-medium text-slate-800">{fmtDate(selectedInvoice.invoice_date)}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Scadenza</span>
                    <div className="text-sm font-medium text-slate-800">{fmtDate(selectedInvoice.due_date)}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Metodo pagamento</span>
                    <div className="text-sm font-medium text-slate-800">{selectedInvoice.payment_method || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">ID SDI</span>
                    <div className="text-sm font-medium text-slate-800 font-mono">{selectedInvoice.sdi_id || '—'}</div>
                  </div>
                </div>
              </div>

              {/* Timeline notifiche SDI */}
              {selectedInvoice.sdi_notifications && Array.isArray(selectedInvoice.sdi_notifications) && selectedInvoice.sdi_notifications.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Timeline SDI</h4>
                  <div className="relative pl-4 border-l-2 border-slate-200 space-y-3">
                    {selectedInvoice.sdi_notifications.map((notif, i) => {
                      const NOTIF_COLORS = {
                        RC: 'bg-green-500', NS: 'bg-red-500', MC: 'bg-amber-500',
                        AT: 'bg-amber-500', NE: 'bg-blue-500', DT: 'bg-green-500',
                      }
                      const NOTIF_LABELS = {
                        RC: 'Ricevuta di consegna', NS: 'Notifica di scarto', MC: 'Mancata consegna',
                        AT: 'Attestazione trasmissione', NE: 'Esito committente', DT: 'Decorrenza termini',
                      }
                      return (
                        <div key={i} className="relative">
                          <div className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full ${NOTIF_COLORS[notif.type] || 'bg-slate-400'} border-2 border-white`} />
                          <div className="text-sm font-medium text-slate-800">{NOTIF_LABELS[notif.type] || notif.type}</div>
                          <div className="text-xs text-slate-400">{notif.timestamp ? new Date(notif.timestamp).toLocaleString('it-IT') : '—'}</div>
                          {notif.message && <div className="text-xs text-slate-500 mt-0.5">{notif.message}</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Azioni */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Azioni</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedInvoice.sdi_status === 'DRAFT' && !selectedInvoice.xml_content && (
                    <button onClick={() => { handleGenerateXml(selectedInvoice.id); setSelectedInvoice(null) }}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition">
                      <FileCode size={14} /> Genera XML
                    </button>
                  )}
                  {(selectedInvoice.sdi_status === 'DRAFT' || selectedInvoice.sdi_status === 'ERROR') && selectedInvoice.xml_content && (
                    <button onClick={() => { handleSend(selectedInvoice.id); setSelectedInvoice(null) }}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                      <Send size={14} /> Invia a SDI
                    </button>
                  )}
                </div>
              </div>

              {/* XML */}
              {selectedInvoice.xml_content && (
                <div className="space-y-2">
                  <button
                    onClick={() => setViewingXml(selectedInvoice.xml_content)}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
                  >
                    <Eye size={14} />
                    Visualizza fattura formattata
                  </button>
                  <button onClick={() => setShowXml(!showXml)}
                    className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 transition">
                    <FileCode size={12} />
                    {showXml ? 'Nascondi XML grezzo' : 'Mostra XML grezzo'}
                  </button>
                  {showXml && (
                    <pre className="p-3 bg-slate-900 text-green-400 rounded-lg text-xs overflow-x-auto max-h-72 border border-slate-700 font-mono leading-relaxed">
                      {selectedInvoice.xml_content}
                    </pre>
                  )}
                </div>
              )}

              {/* Note */}
              {selectedInvoice.notes && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Note</h4>
                  <div className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3">{selectedInvoice.notes}</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* InvoiceViewer modal */}
      {viewingXml && (
        <InvoiceViewer xmlContent={viewingXml} onClose={() => setViewingXml(null)} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// TAB 3: CORRISPETTIVI TELEMATICI
// ═══════════════════════════════════════════════════════════════════════

function Corrispettivi() {
  const [dailyRevenue, setDailyRevenue] = useState([])
  const [corrispettiviLog, setCorrispettiviLog] = useState([])
  const [outlets, setOutlets] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedOutlet, setSelectedOutlet] = useState('ALL')
  const [viewSource, setViewSource] = useState('pos') // 'pos' | 'ade'

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Limit alzato a 5000 per evitare troncamento (con 7 outlet x 365 gg
      // si arriva a 2555 all'anno). Embed outlets(name) rimosso per evitare
      // fallimento 400 se FK non definita: lookup client-side piu' robusto.
      const [{ data: revenue }, { data: outs }, { data: corrLog }] = await Promise.all([
        supabase.from('daily_revenue').select('*').order('date', { ascending: false }).limit(5000),
        supabase.from('outlets').select('id, name').order('name'),
        supabase.from('corrispettivi_log').select('*').order('date', { ascending: false }).limit(5000),
      ])
      const outletMap = new Map((outs || []).map(o => [o.id, o.name]))
      const enrich = (rows) => (rows || []).map(r => ({
        ...r,
        outlets: { name: outletMap.get(r.outlet_id) || r.outlet_name || 'Sconosciuto' },
      }))
      setDailyRevenue(enrich(revenue))
      setOutlets(outs || [])
      setCorrispettiviLog(enrich(corrLog))
    } catch (err) {
      console.error('Errore caricamento corrispettivi:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filtered = dailyRevenue.filter(e => selectedOutlet === 'ALL' || e.outlet_id === selectedOutlet)

  // Aggregate by month + outlet
  const monthlyData = filtered.reduce((acc, row) => {
    const d = new Date(row.date)
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const outletName = row.outlets?.name || 'Sconosciuto'
    const key = `${monthKey}|${outletName}`
    if (!acc[key]) {
      acc[key] = { month: monthKey, outlet: outletName, grossRevenue: 0, netRevenue: 0, transactions: 0, days: 0, totalTicket: 0 }
    }
    acc[key].grossRevenue += Number(row.gross_revenue || 0)
    acc[key].netRevenue += Number(row.net_revenue || 0)
    acc[key].transactions += Number(row.transactions_count || 0)
    acc[key].days += 1
    acc[key].totalTicket += Number(row.avg_ticket || 0)
    return acc
  }, {})

  const monthlyRows = Object.values(monthlyData).sort((a, b) => b.month.localeCompare(a.month) || a.outlet.localeCompare(b.outlet))

  const stats = {
    total: dailyRevenue.length,
    totalGross: dailyRevenue.reduce((s, e) => s + Number(e.gross_revenue || 0), 0),
    totalTransactions: dailyRevenue.reduce((s, e) => s + Number(e.transactions_count || 0), 0),
    avgTicket: dailyRevenue.length > 0
      ? dailyRevenue.reduce((s, e) => s + Number(e.avg_ticket || 0), 0) / dailyRevenue.length
      : 0,
  }

  const fmtMonth = (m) => {
    const [y, mo] = m.split('-')
    const monthNames = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
    return `${monthNames[parseInt(mo) - 1]} ${y}`
  }

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Store} label="Giorni registrati" value={stats.total} sub={`${new Set(dailyRevenue.map(r => r.outlet_id)).size} outlet`} color="blue" />
        <KpiCard icon={Euro} label="Incasso lordo totale" value={`${fmt(stats.totalGross)}`} color="green" />
        <KpiCard icon={Hash} label="Transazioni totali" value={stats.totalTransactions.toLocaleString('it-IT')} color="amber" />
        <KpiCard icon={BarChart3} label="Scontrino medio" value={`${fmt(stats.avgTicket)}`} color="slate" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => setViewSource('pos')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${viewSource === 'pos' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500'}`}>
            POS ({dailyRevenue.length})
          </button>
          <button onClick={() => setViewSource('ade')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${viewSource === 'ade' ? 'bg-white shadow-sm text-green-700' : 'text-slate-500'}`}>
            Cassetto Fiscale ({corrispettiviLog.length})
          </button>
        </div>
        <select
          value={selectedOutlet}
          onChange={(e) => setSelectedOutlet(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
        >
          <option value="ALL">Tutti gli outlet</option>
          {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button onClick={loadData} className="p-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Vista AdE: corrispettivi_log */}
      {viewSource === 'ade' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Data</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Outlet/Dispositivo</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Totale</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Dettaglio IVA</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Stato AdE</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-12 text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Caricamento...</td></tr>
                ) : corrispettiviLog.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12 text-slate-400">
                    <Inbox size={32} className="mx-auto mb-2 text-slate-300" />
                    <p>Nessun corrispettivo dal cassetto fiscale.</p>
                    <p className="text-xs mt-1">Clicca "Sincronizza SDI" per scaricare i corrispettivi da Agenzia delle Entrate.</p>
                  </td></tr>
                ) : corrispettiviLog
                    .filter(c => selectedOutlet === 'ALL' || c.outlet_id === selectedOutlet)
                    .map((corr) => (
                  <tr key={corr.id} className="border-b border-slate-100 hover:bg-blue-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{fmtDate(corr.date)}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {corr.outlets?.name || 'N/A'}
                      {corr.device_serial && <span className="text-xs text-slate-400 ml-1">({corr.device_serial})</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(corr.total_amount)}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {corr.vat_breakdown ? (
                        typeof corr.vat_breakdown === 'object'
                          ? Object.entries(corr.vat_breakdown).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ')
                          : String(corr.vat_breakdown)
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <SdiStatusBadge status={corr.submission_status || 'PENDING'} configMap={{
                        SUBMITTED: { label: 'Inviato', color: 'bg-green-100 text-green-700', icon: CheckCircle },
                        PENDING: { label: 'In attesa', color: 'bg-amber-100 text-amber-700', icon: Clock },
                        ERROR: { label: 'Errore', color: 'bg-red-100 text-red-700', icon: XCircle },
                      }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && corrispettiviLog.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 text-xs text-slate-500 border-t border-slate-200">
              {corrispettiviLog.length} corrispettivi dal cassetto fiscale AdE
            </div>
          )}
        </div>
      )}

      {/* Vista POS: tabella riepilogo mensile */}
      {viewSource === 'pos' && <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 z-10">
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Mese</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Outlet</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Incasso Lordo</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Transazioni</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Scontrino Medio</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Giorni</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Caricamento...</td></tr>
              ) : monthlyRows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400">
                  <BarChart3 size={32} className="mx-auto mb-2 text-slate-300" />
                  Nessun corrispettivo. Importa i dati POS per visualizzarli.
                </td></tr>
              ) : monthlyRows.map((row, i) => {
                const avgTicket = row.transactions > 0 ? row.grossRevenue / row.transactions : (row.days > 0 ? row.totalTicket / row.days : 0)
                return (
                  <tr key={`${row.month}-${row.outlet}`} className={`border-b border-slate-100 hover:bg-blue-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">{fmtMonth(row.month)}</td>
                    <td className="px-4 py-3 text-slate-700">{row.outlet}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(row.grossRevenue)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{row.transactions.toLocaleString('it-IT')}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(avgTicket)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{row.days}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!loading && monthlyRows.length > 0 && (
          <div className="px-4 py-2 bg-slate-50 text-xs text-slate-500 border-t border-slate-200">
            {monthlyRows.length} righe mensili da {filtered.length} record giornalieri
          </div>
        )}
      </div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// PAGINA PRINCIPALE: FATTURAZIONE
// ═══════════════════════════════════════════════════════════════════════

export default function Fatturazione() {
  const [activeTab, setActiveTab] = useState('passive')
  const [sdiStats, setSdiStats] = useState(null)
  // Conteggio diretto da electronic_invoices — fonte unica per il badge
  // sul tab cosi' e' SEMPRE coerente con la tabella mostrata sotto. Prima
  // il badge usava sdiStats (edge function SDI) e il KPI 'Fatture passive'
  // usava la query DB — differivano di 4 unita'.
  const [invoiceCounts, setInvoiceCounts] = useState({ passive: 0, active: 0 })
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [syncKey, setSyncKey] = useState(0) // increment to force child refresh

  // Carica statistiche SDI globali (config + stato)
  const loadStats = useCallback(async () => {
    try {
      const result = await callEdgeFunction('sdi-status-check', 'GET')
      setSdiStats(result.data)
    } catch (err) {
      console.error('Errore caricamento statistiche SDI:', err)
    }
  }, [])

  // Count diretto da electronic_invoices per badge tab coerente
  const loadInvoiceCounts = useCallback(async () => {
    try {
      // Uso head:true + count:'exact' per ottenere solo il count senza dati
      const [passiveRes, activeRes] = await Promise.all([
        supabase.from('electronic_invoices').select('id', { count: 'exact', head: true }).eq('direction', 'inbound'),
        supabase.from('electronic_invoices').select('id', { count: 'exact', head: true }).eq('direction', 'outbound'),
      ])
      setInvoiceCounts({
        passive: passiveRes.count || 0,
        active: activeRes.count || 0,
      })
    } catch (err) {
      console.warn('loadInvoiceCounts:', err.message)
    }
  }, [])

  useEffect(() => { loadStats(); loadInvoiceCounts() }, [loadStats, loadInvoiceCounts])

  // Sincronizza fatture + corrispettivi dal cassetto fiscale AdE
  // Usa Netlify Function (Node.js) per supporto mTLS con certificati client
  const handleSyncSdi = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      let { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
        if (refreshError || !refreshData.session) throw new Error('Sessione scaduta')
        session = refreshData.session
      }

      const res = await fetch('/.netlify/functions/sdi-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          dateFrom: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          dateTo: new Date().toISOString().split('T')[0],
        }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || `Errore ${res.status}`)

      setSyncResult(result)
      // Refresh tabs data
      setSyncKey(prev => prev + 1)
      loadStats()
    } catch (err) {
      setSyncResult({ error: err.message })
    } finally {
      setSyncing(false)
      // Auto-hide result after 8 seconds
      setTimeout(() => setSyncResult(null), 8000)
    }
  }

  const tabs = [
    // Badge: count diretto da electronic_invoices (stessa fonte del KPI
    // dentro la tab) cosi' i due numeri NON divergono mai.
    { id: 'passive', label: 'Fatture Passive', icon: Inbox, count: invoiceCounts.passive || sdiStats?.passive?.total },
    { id: 'active', label: 'Fatture Attive', icon: ArrowUpRight, count: invoiceCounts.active || sdiStats?.active?.total },
    { id: 'corrispettivi', label: 'Corrispettivi', icon: Store, count: sdiStats?.corrispettivi?.total },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fatturazione Elettronica</h1>
          <p className="text-sm text-slate-500 mt-1">
            Gestione fatture SDI, emissione e corrispettivi telematici
            {sdiStats?.config && (
              <span className={`ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                sdiStats.config.environment === 'PRODUCTION' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {sdiStats.config.environment === 'PRODUCTION' ? 'Produzione' : 'Test'}
                {' — '}{sdiStats.config.accreditation_status}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={handleSyncSdi}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {syncing ? 'Sincronizzazione...' : 'Sincronizza SDI'}
        </button>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div className={`rounded-xl border p-4 flex items-start gap-3 ${
          syncResult.error
            ? 'bg-red-50 border-red-200 text-red-800'
            : (syncResult.errors?.length > 0)
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-green-50 border-green-200 text-green-800'
        }`}>
          {syncResult.error ? (
            <>
              <XCircle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Errore sincronizzazione</p>
                <p className="text-sm mt-0.5">{syncResult.error}</p>
              </div>
            </>
          ) : (
            <>
              <CheckCircle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Sincronizzazione completata</p>
                <p className="text-sm mt-0.5">
                  {syncResult.fatture ?? syncResult.fattureSincronizzate ?? 0} fatture e {syncResult.corrispettivi ?? syncResult.corrispettiviSincronizzati ?? 0} corrispettivi
                  sincronizzati dal cassetto fiscale
                  {syncResult.durationMs && <span className="text-xs ml-1">({Math.round(syncResult.durationMs / 1000)}s)</span>}
                </p>
                {syncResult.errors?.map((err, i) => (
                  <p key={i} className="text-xs mt-1 text-amber-600">{err}</p>
                ))}
              </div>
            </>
          )}
          <button onClick={() => setSyncResult(null)} className="ml-auto shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">{tab.count}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'passive' && <FatturePassive key={`p-${syncKey}`} />}
      {activeTab === 'active' && <FattureAttive key={`a-${syncKey}`} />}
      {activeTab === 'corrispettivi' && <Corrispettivi key={`c-${syncKey}`} />}
      <PageHelp page="fatturazione" />
    </div>
  )
}
