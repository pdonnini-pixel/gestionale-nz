import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import PageHelp from '../components/PageHelp'
import PageHeader from '../components/PageHeader'
import { useToast } from '../components/Toast'

// Tab principale Fatturazione — persistito in URL come ?tab=
type FatturazioneTab = 'passive' | 'active' | 'corrispettivi'
const VALID_FATTURAZIONE_TABS: FatturazioneTab[] = ['passive', 'active', 'corrispettivi']
import InvoiceViewer from '../components/InvoiceViewer'
import StatusBadge from '../components/ui/StatusBadge'
import { supabase } from '../lib/supabase'
import { useCompany } from '../hooks/useCompany'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import { getCurrentTenant } from '../lib/tenants'
import { usePeriod } from '../hooks/usePeriod'
import { useTableSort } from '../hooks/useTableSort'
import SortableTh from '../components/ui/SortableTh'
import Tooltip from '../components/Tooltip'
import SyncStatusBadge from '../components/SyncStatusBadge'
import PaymentAnomaliesPanel from '../components/PaymentAnomaliesPanel'
import {
  FileText, Upload, Send, RefreshCw, Search, Filter, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Clock, AlertTriangle, Eye, Download, X,
  Building2, Calendar, Euro, Hash, FileCode, Inbox, ArrowUpRight, Loader2,
  BarChart3, Store, FileMinus
} from 'lucide-react'

// ─── Helpers ────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined): string => n != null ? Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const fmtDate = (d: string | null | undefined): string => d ? new Date(d).toLocaleDateString('it-IT') : '—'

// Tipo documento FatturaPA: codice → etichetta leggibile. Codici sconosciuti
// restano mostrati così come arrivano (con il codice nel tooltip).
const TIPO_DOC_LABEL: Record<string, string> = {
  TD01: 'Fattura', TD02: 'Acconto fattura', TD03: 'Acconto parcella',
  TD04: 'Nota di credito', TD05: 'Nota di debito', TD06: 'Parcella',
  TD16: 'Integrazione reverse charge interno',
  TD17: 'Integrazione/autofattura acquisti estero servizi',
  TD18: 'Integrazione acquisti intra UE beni',
  TD19: 'Integrazione/autofattura art.17 c.2',
  TD24: 'Fattura differita', TD25: 'Fattura differita (triangolazione)',
  TD26: 'Cessione beni ammortizzabili', TD27: 'Autofattura per autoconsumo',
}
const tipoDocLabel = (code?: string | null): string => {
  if (!code) return '—'
  return TIPO_DOC_LABEL[code.toUpperCase()] ?? code
}

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

type StatusConfigEntry = { label: string; color: string; icon?: React.ComponentType<{ size?: number }> }
type StatusConfigMap = Record<string, StatusConfigEntry>

function SdiStatusBadge({ status, configMap = SDI_STATUS_CONFIG as StatusConfigMap }: { status: string; configMap?: StatusConfigMap }) {
  const cfg = configMap[status] || configMap.PENDING
  const Icon = cfg.icon || Clock
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon && <Icon size={12} />}
      {cfg.label}
    </span>
  )
}

// Legenda esplicativa stati SDI — per Sabrina/Veronica che non conoscono i termini
const SDI_LEGEND_PASSIVE: Array<{ key: string; what: string }> = [
  { key: 'RECEIVED', what: 'Arrivata dal fornitore via SDI. Visibile nel gestionale.' },
  { key: 'PENDING', what: 'SDI sta ancora processando la fattura. Attendi esito.' },
  { key: 'ACCEPTED', what: 'Validata dall’Agenzia delle Entrate. Registrabile in contabilità.' },
  { key: 'REJECTED', what: 'Scartata dall’AdE per dati invalidi. NON contabilizzare. Chiedi nuova fattura al fornitore.' },
]

const SDI_LEGEND_ACTIVE: Array<{ key: string; what: string }> = [
  { key: 'DRAFT', what: 'Bozza creata nel gestionale, non ancora inviata via SDI.' },
  { key: 'SENT', what: 'Trasmessa all’AdE, in attesa di ricevuta SDI.' },
  { key: 'DELIVERED', what: 'Consegnata al destinatario tramite SDI.' },
  { key: 'ACCEPTED', what: 'Validata e accettata dall’AdE. Definitiva.' },
  { key: 'REJECTED', what: 'Rifiutata. Rivedi XML, correggi e ritrasmetti.' },
  { key: 'ERROR', what: 'Errore tecnico di invio. Chiama Patrizio o Lilian.' },
]

function SdiLegend({ tipo }: { tipo: 'passive' | 'active' }) {
  const items = tipo === 'passive' ? SDI_LEGEND_PASSIVE : SDI_LEGEND_ACTIVE
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Legenda stato SDI:</span>
      {items.map(it => {
        const cfg = SDI_STATUS_CONFIG[it.key as keyof typeof SDI_STATUS_CONFIG]
        if (!cfg) return null
        const Icon = cfg.icon || Clock
        return (
          <div key={it.key} className="flex items-center gap-1.5" title={it.what}>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
              <Icon size={12} />
              {cfg.label}
            </span>
            <span className="text-xs text-slate-600 hidden lg:inline max-w-[280px] truncate" title={it.what}>{it.what}</span>
          </div>
        )
      })}
    </div>
  )
}

type KpiColor = 'blue' | 'green' | 'red' | 'amber' | 'slate'
function KpiCard({ icon: Icon, label, value, sub, color = 'blue' }: { icon: React.ComponentType<{ size?: number }>; label: string; value: string | number; sub?: string; color?: KpiColor }) {
  const colorMap: Record<KpiColor, string> = {
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

// Errore semantico: l'Edge Function ha risposto in modo che indica che SDI
// non è configurato per il tenant (401 reale, oppure response con
// `code: 'SDI_NOT_CONFIGURED'`). Usato per disabilitare bottoni SDI
// senza ritentare in loop.
export class SdiNotConfiguredError extends Error {
  constructor(message = 'SDI non configurato per questo tenant') {
    super(message)
    this.name = 'SdiNotConfiguredError'
  }
}

async function callEdgeFunction(fnName: string, method = 'GET', body: Record<string, unknown> | null = null, params: Record<string, string> | null = null) {
  // URL e anon key del tenant attivo: vengono dalla config tenants.ts
  // (selezionata via hostname). Niente più fallback hardcoded sul progetto NZ.
  const tenant = getCurrentTenant()
  const anonKey = tenant.supabaseAnonKey
  const baseUrl = tenant.supabaseUrl

  let url = `${baseUrl}/functions/v1/${fnName}`
  if (params) {
    const qs = new URLSearchParams(params).toString()
    if (qs) url += `?${qs}`
  }

  const doFetch = async (accessToken: string) => {
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

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Non autenticato')

  // Singolo tentativo. Niente retry-on-401: per le Edge Function SDI il 401
  // arriva quando il tenant non ha certificati SDI configurati nel Vault,
  // e ritentare con un nuovo token NON cambia il risultato — anzi, il loop
  // di refreshSession + re-fetch può scatenare ri-render cascata.
  // Inoltre catturiamo CORS/network failures (TypeError "Failed to fetch")
  // come SdiNotConfigured: succede quando l'Edge Function non è deployata
  // sul tenant o il preflight CORS fallisce. Stesso effetto pratico: SDI
  // non disponibile per questo tenant.
  let res: Response
  try {
    res = await doFetch(session.access_token)
  } catch (fetchErr) {
    throw new SdiNotConfiguredError(`Edge Function ${fnName} non raggiungibile (CORS/network): ${(fetchErr as Error).message}`)
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new SdiNotConfiguredError(`Edge Function ${fnName} ha risposto ${res.status} — SDI probabilmente non configurato.`)
  }
  let json: { error?: string } & Record<string, unknown>
  try {
    json = await res.json()
  } catch {
    throw new Error(`Edge Function ${fnName}: risposta non-JSON (status ${res.status})`)
  }
  if (!res.ok) {
    const code = (json as { code?: string }).code
    if (code === 'SDI_NOT_CONFIGURED' || code === 'CERTIFICATE_MISSING') {
      throw new SdiNotConfiguredError(json.error || code)
    }
    throw new Error(json.error || `Errore ${res.status}`)
  }
  return json
}

// ═══════════════════════════════════════════════════════════════════════
// TAB 1: FATTURE PASSIVE (ricevute da fornitori)
// ═══════════════════════════════════════════════════════════════════════

function FatturePassive() {
  type InvoiceRow = {
    id: string
    invoice_date?: string | null
    invoice_number?: string | null
    supplier_name?: string | null
    supplier_vat?: string | null
    supplier_fiscal_code?: string | null
    sdi_status?: string | null
    sdi_id?: string | null
    description?: string | null
    notes?: string | null
    gross_amount?: number | null
    net_amount?: number | null
    taxable_amount?: number | null
    vat_amount?: number | null
    tipo_documento?: string | null
    payment_method?: string | null
    payment_terms?: string | null
    codice_destinatario?: string | null
    due_date?: string | null
    has_xml?: boolean | null
    notification_history?: Array<{ tipo?: string; data?: string; codice?: string; descrizione?: string }> | null
  }
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  // Filtro anno: si allinea al filtro globale del PeriodContext (header
  // in alto). Quando l'utente cambia anno nell'header, qui si aggiorna
  // automaticamente. L'utente puo' comunque sovrascriverlo localmente col
  // select in pagina. Se arriva da Dashboard con ?year= ha la priorita'.
  const { toast } = useToast()
  const { year: globalYear } = usePeriod()
  const { company } = useCompany()
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
  const [viewingXml, setViewingXml] = useState<string | null>(null) // XML content for InvoiceViewer
  const [uploading, setUploading] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null) // id fattura in apertura (spinner occhio)

  // Scarica xml_content della singola fattura on-demand (per-id). Evita di
  // tenere i 54 MB di XML in memoria sulla lista. Restituisce null in errore.
  const fetchXmlFor = useCallback(async (id: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from('electronic_invoices')
      .select('xml_content')
      .eq('id', id)
      .single()
    if (error) {
      toast({ type: 'error', message: 'Errore caricamento XML: ' + error.message })
      return null
    }
    return (data?.xml_content as string | null) ?? null
  }, [toast])

  // Apre direttamente la fattura formattata (InvoiceViewer) dall'XML reale.
  // Niente scheda-riepilogo: il documento formattato contiene già tutti i dati.
  const openFormatted = useCallback(async (inv: InvoiceRow) => {
    setOpeningId(inv.id)
    const xml = await fetchXmlFor(inv.id)
    setOpeningId(null)
    const clean = (xml ?? '').replace(/^﻿/, '').trimStart()
    if (clean.startsWith('<') && clean.includes('FatturaElettronica')) setViewingXml(clean)
    else toast({ type: 'warning', message: 'Documento XML non disponibile per questa fattura.' })
  }, [fetchXmlFor, toast])

  const loadInvoices = useCallback(async () => {
    setLoading(true)
    try {
      // Lista da v_electronic_invoices_list: tutte le colonne TRANNE xml_content
      // (54 MB complessivi, causa del timeout 15s) + flag has_xml. L'XML si
      // carica lazy per-id solo al click "Visualizza" (vedi fetchXmlFor).
      // Niente .limit(500): la vista esclude xml_content (leggera), quindi
      // carichiamo l'intero set → KPI e conteggi coincidono col badge tab.
      const { data, error } = await supabase
        .from('v_electronic_invoices_list')
        .select('*')
        .order('invoice_date', { ascending: false })
        .limit(10000)
      if (error) throw error
      setInvoices((data || []) as InvoiceRow[])
    } catch (err: unknown) {
      console.error('Errore caricamento fatture passive:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  // Upload XML FatturaPA
  const handleXmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const xmlContent = await file.text()
      if (!xmlContent.includes('FatturaElettronica')) {
        toast({ type: 'warning', message: 'Il file non sembra essere un XML FatturaPA valido.' })
        return
      }
      const result = await callEdgeFunction('sdi-receive', 'POST', { xmlContent }) as { data?: { action?: string; invoice?: { invoice_number?: string } } }
      if (result.data) {
        toast({ type: 'success', message: `Fattura ${result.data.action === 'created' ? 'importata' : 'aggiornata'}: ${result.data.invoice?.invoice_number}` })
        loadInvoices()
      }
    } catch (err: unknown) {
      toast({ type: 'error', message: 'Errore upload: ' + (err as Error).message })
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // Carica XML multipli per associare xml_content alle fatture esistenti
  type XmlProgress = { total: number; done: number; matched: number; errors: number; finished?: boolean }
  const [xmlUpdateProgress, setXmlUpdateProgress] = useState<XmlProgress | null>(null)
  const handleBulkXmlUpdate = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      } catch (err: unknown) {
        console.error('Errore XML update:', file.name, err)
        errors++
      }
      done++
      setXmlUpdateProgress({ total: files.length, done, matched, errors })
    }

    setXmlUpdateProgress(prev => prev ? { ...prev, finished: true } : prev)
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

  // KPI sull'intero set filtrato per ANNO (indipendenti da ricerca/stato) →
  // coerenti col badge del tab. Note di credito = tipo_documento TD04
  // (la classificazione corretta, non gross<0).
  const yearSet = useMemo(() => invoices.filter(inv =>
    yearFilter === 'ALL' || (inv.invoice_date && String(new Date(inv.invoice_date).getFullYear()) === yearFilter)
  ), [invoices, yearFilter])
  type Stats = { total: number; totalAmount: number; totalVat: number; noteCredito: number }
  const stats = useMemo<Stats>(() => {
    const s: Stats = { total: 0, totalAmount: 0, totalVat: 0, noteCredito: 0 }
    for (const inv of yearSet) {
      s.total++
      s.totalAmount += Number(inv.gross_amount || 0)
      s.totalVat += Number(inv.vat_amount || 0)
      if ((inv.tipo_documento || '').toUpperCase() === 'TD04') s.noteCredito++
    }
    return s
  }, [yearSet])

  // Sort tabella fatture passive: default invoice_date desc (le piu' recenti
  // in cima), persistente per refresh, reset al cambio anno.
  const { sorted: sortedFiltered, sortBy: ftSortBy, onSort: ftOnSort, reset: ftResetSort } = useTableSort(
    filtered,
    [{ key: 'invoice_date', dir: 'desc' }],
    { persistKey: 'fatture_passive', resetOn: [yearFilter] }
  );

  return (
    <div className="space-y-4">
      {/* KPI sull'intero set filtrato per anno: fatture e note di credito (TD04)
          sono conteggi distinti; importi su tutto il set. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={FileText} label="Fatture passive" value={stats.total - stats.noteCredito} color="blue" />
        <KpiCard icon={FileMinus} label="Note di credito" value={stats.noteCredito} color="amber" />
        <KpiCard icon={Euro} label="Totale lordo" value={`€ ${fmt(stats.totalAmount)}`} color="blue" />
        <KpiCard icon={Euro} label="Totale IVA" value={`€ ${fmt(stats.totalVat)}`} color="blue" />
      </div>

      {/* Segnalazioni: anomalie configurazione pagamento fornitore (badge rosso) */}
      <PaymentAnomaliesPanel />

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
                <SortableTh sortKey="invoice_number" sortBy={ftSortBy} onSort={ftOnSort} className="min-w-[120px]">Numero</SortableTh>
                <SortableTh sortKey="supplier_name" sortBy={ftSortBy} onSort={ftOnSort} className="min-w-[200px]">Fornitore</SortableTh>
                <SortableTh sortKey="tipo_documento" sortBy={ftSortBy} onSort={ftOnSort}>Tipo</SortableTh>
                <SortableTh sortKey="net_amount" sortBy={ftSortBy} onSort={ftOnSort} align="right" className="min-w-[100px]">Imponibile</SortableTh>
                <SortableTh sortKey="vat_amount" sortBy={ftSortBy} onSort={ftOnSort} align="right" className="min-w-[100px]">IVA</SortableTh>
                <SortableTh sortKey="gross_amount" sortBy={ftSortBy} onSort={ftOnSort} align="right" className="min-w-[100px]">Totale</SortableTh>
                <th className="text-center px-4 py-3 font-medium text-slate-600 text-[11px] uppercase tracking-wider">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Caricamento fatture...</td></tr>
              ) : sortedFiltered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400">Nessuna fattura trovata</td></tr>
              ) : sortedFiltered.map((inv, idx) => (
                <tr key={inv.id} onClick={() => openFormatted(inv)} className={`border-b border-slate-100 hover:bg-blue-50/50 transition-colors cursor-pointer ${idx % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(inv.invoice_date)}</td>
                  <Tooltip content={inv.invoice_number || ''}>
                    <td className="px-4 py-3 font-medium text-slate-900 truncate min-w-[120px] max-w-[180px]">{inv.invoice_number || '—'}</td>
                  </Tooltip>
                  <td className="px-4 py-3 min-w-[200px]">
                    <Tooltip content={inv.supplier_name || ''}>
                      <div className="font-medium text-slate-800 truncate max-w-[200px]">{inv.supplier_name || '—'}</div>
                    </Tooltip>
                    {inv.supplier_vat && <div className="text-xs text-slate-400">P.IVA {inv.supplier_vat}</div>}
                  </td>
                  <Tooltip content={inv.tipo_documento ? `Codice ${inv.tipo_documento}` : ''}>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{tipoDocLabel(inv.tipo_documento)}</td>
                  </Tooltip>
                  <td className="px-4 py-3 text-right text-slate-700 min-w-[100px] whitespace-nowrap">{fmt(inv.net_amount)}</td>
                  <td className="px-4 py-3 text-right text-slate-500 min-w-[100px] whitespace-nowrap">{fmt(inv.vat_amount)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900 min-w-[100px] whitespace-nowrap">{fmt(inv.gross_amount)}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); openFormatted(inv) }}
                      disabled={openingId === inv.id}
                      className="p-1.5 text-slate-400 hover:text-blue-600 rounded transition disabled:opacity-50"
                      title="Apri fattura formattata"
                    >
                      {openingId === inv.id ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && <div className="px-4 py-2 bg-slate-50 text-xs text-slate-500 border-t border-slate-200">{filtered.length} fatture visualizzate su {invoices.length} totali</div>}
      </div>


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
  type ActiveInvoiceRow = {
    id: string
    invoice_number?: string | null
    invoice_date?: string | null
    client_name?: string | null
    client_vat?: string | null
    client_fiscal_code?: string | null
    codice_destinatario?: string | null
    pec_destinatario?: string | null
    sdi_id?: string | null
    sdi_status?: string | null
    sdi_notifications?: Array<{ type?: string; timestamp?: string; message?: string; date?: string; description?: string }> | null
    notes?: string | null
    tipo_documento?: string | null
    total_amount?: number | null
    taxable_amount?: number | null
    vat_amount?: number | null
    vat_rate?: number | string | null
    gross_amount?: number | null
    xml_content?: string | null
    description?: string | null
    payment_method?: string | null
    due_date?: string | null
    [key: string]: unknown
  }
  const { toast } = useToast()
  const [invoices, setInvoices] = useState<ActiveInvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null) // invoiceId in corso di invio
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<ActiveInvoiceRow | null>(null)
  const [showXml, setShowXml] = useState(false)
  const [viewingXml, setViewingXml] = useState<string | null>(null)

  const loadInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('active_invoices')
        .select('*')
        .order('invoice_date', { ascending: false })
        .limit(500)
      if (error) throw error
      setInvoices((data || []) as ActiveInvoiceRow[])
    } catch (err: unknown) {
      console.error('Errore caricamento fatture attive:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  // Genera XML per una fattura
  const handleGenerateXml = async (invoiceId: string) => {
    try {
      await callEdgeFunction('sdi-generate-xml', 'POST', { invoiceId })
      toast({ type: 'success', message: 'XML generato con successo' })
      loadInvoices()
    } catch (err: unknown) {
      toast({ type: 'error', message: 'Errore generazione XML: ' + (err as Error).message })
    }
  }

  // Invia fattura a SDI
  const handleSend = async (invoiceId: string) => {
    setSending(invoiceId)
    try {
      const result = await callEdgeFunction('sdi-send', 'POST', { invoiceId }) as { data?: { sdiId?: string; environment?: string } }
      toast({ type: 'success', message: `Fattura inviata! SDI ID: ${result.data?.sdiId} (${result.data?.environment})` })
      loadInvoices()
    } catch (err: unknown) {
      toast({ type: 'error', message: 'Errore invio SDI: ' + (err as Error).message })
    } finally {
      setSending(null)
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
    sent: invoices.filter(i => ['SENT', 'DELIVERED', 'ACCEPTED'].includes(i.sdi_status || '')).length,
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
        <Link
          to="/fatturazione/converti-xml"
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition"
          title="Converti l'export Excel del gestionale in XML FatturaPA (FPR12) per l'import in AdE"
        >
          <FileCode size={16} />
          Converti Excel → XML
        </Link>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-400 text-sm rounded-lg border border-slate-200 cursor-not-allowed"
          title="Emissione diretta via A-Cube temporaneamente disattivata — per ora usa «Converti Excel → XML»"
        >
          <Send size={16} />
          Nuova via A-Cube
        </button>
        <button onClick={loadInvoices} className="p-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Legenda stati SDI per operatore */}
      <SdiLegend tipo="active" />

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
                      const NOTIF_COLORS: Record<string, string> = {
                        RC: 'bg-green-500', NS: 'bg-red-500', MC: 'bg-amber-500',
                        AT: 'bg-amber-500', NE: 'bg-blue-500', DT: 'bg-green-500',
                      }
                      const NOTIF_LABELS: Record<string, string> = {
                        RC: 'Ricevuta di consegna', NS: 'Notifica di scarto', MC: 'Mancata consegna',
                        AT: 'Attestazione trasmissione', NE: 'Esito committente', DT: 'Decorrenza termini',
                      }
                      const t = notif.type || ''
                      return (
                        <div key={i} className="relative">
                          <div className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full ${NOTIF_COLORS[t] || 'bg-slate-400'} border-2 border-white`} />
                          <div className="text-sm font-medium text-slate-800">{NOTIF_LABELS[t] || t}</div>
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
                    onClick={() => setViewingXml(selectedInvoice.xml_content ?? null)}
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
  const labels = useCompanyLabels()
  type RevenueRow = {
    id?: string
    date?: string | null
    outlet_id?: string | null
    outlet_name?: string | null
    gross_revenue?: number | null
    net_revenue?: number | null
    transactions_count?: number | null
    avg_ticket?: number | null
    outlets?: { name?: string | null } | null
    [key: string]: unknown
  }
  type OutletLite = { id: string; name?: string | null }
  type MonthAgg = { month: string; outlet: string; grossRevenue: number; netRevenue: number; transactions: number; days: number; totalTicket: number }
  const [dailyRevenue, setDailyRevenue] = useState<RevenueRow[]>([])
  const [corrispettiviLog, setCorrispettiviLog] = useState<RevenueRow[]>([])
  const [outlets, setOutlets] = useState<OutletLite[]>([])
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
      const outletMap = new Map<string, string>((outs || []).map(o => [o.id, o.name || '']))
      const enrich = (rows: RevenueRow[] | null): RevenueRow[] => (rows || []).map(r => ({
        ...r,
        outlets: { name: (r.outlet_id ? outletMap.get(r.outlet_id) : null) || r.outlet_name || 'Sconosciuto' },
      }))
      setDailyRevenue(enrich(revenue as RevenueRow[] | null))
      setOutlets((outs || []) as OutletLite[])
      setCorrispettiviLog(enrich(corrLog as RevenueRow[] | null))
    } catch (err: unknown) {
      console.error('Errore caricamento corrispettivi:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filtered = dailyRevenue.filter(e => selectedOutlet === 'ALL' || e.outlet_id === selectedOutlet)

  // Aggregate by month + outlet
  const monthlyData = filtered.reduce<Record<string, MonthAgg>>((acc, row) => {
    const d = new Date(row.date || '')
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

  const fmtMonth = (m: string) => {
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
        <KpiCard icon={Hash} label="Transazioni totali" value={stats.totalTransactions.toLocaleString('de-DE')} color="amber" />
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
          <option value="ALL">Tutti gli {labels.pointOfSalePluralLower}</option>
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
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{labels.pointOfSale}/Dispositivo</th>
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
                    <p className="text-xs mt-1">Il canale di sincronizzazione dei corrispettivi telematici non è ancora attivo.</p>
                  </td></tr>
                ) : corrispettiviLog
                    .filter(c => selectedOutlet === 'ALL' || c.outlet_id === selectedOutlet)
                    .map((corr) => (
                  <tr key={String(corr.id)} className="border-b border-slate-100 hover:bg-blue-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{fmtDate(corr.date)}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {corr.outlets?.name || 'N/A'}
                      {Boolean(corr.device_serial) && <span className="text-xs text-slate-400 ml-1">({String(corr.device_serial)})</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(Number(corr.total_amount) || 0)}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {corr.vat_breakdown ? (
                        typeof corr.vat_breakdown === 'object'
                          ? Object.entries(corr.vat_breakdown as Record<string, unknown>).map(([k, v]) => `${k}: ${fmt(Number(v) || 0)}`).join(', ')
                          : String(corr.vat_breakdown)
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <SdiStatusBadge status={String(corr.submission_status || 'PENDING')} configMap={{
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
                <th className="text-left px-4 py-3 font-medium text-slate-600">{labels.pointOfSale}</th>
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
                    <td className="px-4 py-3 text-right text-slate-700">{row.transactions.toLocaleString('de-DE')}</td>
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
  const { year } = usePeriod()
  const { toast } = useToast()
  // activeTab persistito in URL come ?tab=… (default 'passive')
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: FatturazioneTab = VALID_FATTURAZIONE_TABS.includes(tabParam as FatturazioneTab)
    ? (tabParam as FatturazioneTab)
    : 'passive'
  const setActiveTab = (next: FatturazioneTab) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', next)
    setSearchParams(params)
  }
  type SdiStats = {
    config?: { sdi_environment?: string; sdi_recipient_code?: string; auto_send_enabled?: boolean; environment?: string; accreditation_status?: string }
    passive?: { total?: number }
    active?: { total?: number }
    corrispettivi?: { total?: number }
    sentToday?: number
    pendingCount?: number
    errorCount?: number
    totalToday?: number
  } | null
  const [sdiStats, setSdiStats] = useState<SdiStats>(null)
  // Stato disponibilità SDI:
  //  null    = non ancora controllato
  //  true    = sdi-status-check ha risposto OK
  //  false   = ha risposto 401/403/SDI_NOT_CONFIGURED → tenant senza
  //            accreditamento. NON ritentare automaticamente.
  const [sdiAvailable, setSdiAvailable] = useState<boolean | null>(null)
  const [invoiceCounts, setInvoiceCounts] = useState({ passive: 0, active: 0 })
  const [syncing, setSyncing] = useState(false)
  const [syncKey, setSyncKey] = useState(0) // increment to force child refresh

  // Carica statistiche SDI globali (config + stato). Se l'Edge Function
  // risponde 401/403 o con codice SDI_NOT_CONFIGURED, marchiamo il tenant
  // come "senza SDI" e NON ritentiamo. L'utente vede un banner informativo
  // e i bottoni SDI sono disabilitati.
  const loadStats = useCallback(async () => {
    try {
      const result = await callEdgeFunction('sdi-status-check', 'GET') as { data?: NonNullable<SdiStats> }
      setSdiStats(result.data ?? null)
      setSdiAvailable(true)
    } catch (err: unknown) {
      if (err instanceof SdiNotConfiguredError) {
        setSdiAvailable(false)
        setSdiStats(null)
        // Niente console.error: questo è uno stato "atteso" per tenant senza
        // accreditamento, non un errore.
        return
      }
      console.error('Errore caricamento statistiche SDI:', err)
      // Errori di rete o altre eccezioni → trattiamo come "non disponibile"
      // per coerenza UX (evitiamo loop di retry).
      setSdiAvailable(false)
    }
  }, [])

  // Count per badge tab: ogni badge conta ESATTAMENTE la tabella che la
  // rispettiva lista mostra, così badge e lista coincidono sempre.
  //   passive → electronic_invoices (stessa fonte della vista v_electronic_invoices_list)
  //   active  → active_invoices     (le attive A-Cube arrivano qui via trigger DB
  //                                   sync_acube_sdi_active_to_einvoice; ci finiscono
  //                                   anche le fatture create dal form manuale)
  // Storico: il vecchio conteggio discriminava attiva/passiva su
  // electronic_invoices.supplier_vat == company.vat_number. Ma le fatture attive
  // NON stanno in electronic_invoices — vanno in active_invoices — quindi il badge
  // attive contava 0 mentre la lista ne elencava 27. Le due tabelle sono già
  // disgiunte per costruzione (nessuna attiva "sfuggita" in electronic_invoices).
  const loadInvoiceCounts = useCallback(async () => {
    try {
      // Filtro anno globale (da usePeriod) → counter coerente con le tabelle sotto.
      const yearStart = `${year}-01-01`
      const yearEnd = `${year}-12-31`
      const [passiveRes, activeRes] = await Promise.all([
        supabase.from('electronic_invoices').select('id', { count: 'exact', head: true })
          .gte('invoice_date', yearStart).lte('invoice_date', yearEnd),
        supabase.from('active_invoices').select('id', { count: 'exact', head: true })
          .gte('invoice_date', yearStart).lte('invoice_date', yearEnd),
      ])
      setInvoiceCounts({
        passive: passiveRes.count || 0,
        active: activeRes.count || 0,
      })
    } catch (err: unknown) {
      console.warn('loadInvoiceCounts:', (err as Error).message)
    }
  }, [year])

  useEffect(() => { loadStats(); loadInvoiceCounts() }, [loadStats, loadInvoiceCounts])

  // Sincronizza fatture passive da A-Cube SDI (pull manuale on-demand).
  // Fonte: pull REST A-Cube via RPC acube_sdi_sync_inbound_production (lo stesso
  // motore del cron automatico ogni 6h). Questo bottone forza un pull immediato.
  // Stage A-Cube fisso a 'production': in esercizio si scaricano sempre le
  // fatture reali. La sandbox serve solo a noi per test e si lancia da SQL/RPC,
  // non dalla UI (un toggle in pagina sarebbe una trappola per l'utente finale).
  const handleSyncAcubeSdi = async () => {
    setSyncing(true)
    try {
      // Pull manuale via RPC SECURITY DEFINER (stesso motore del cron 6h:
      // login A-Cube + fetch /invoices con guardia tenant, idempotente, logga
      // sync_runs con origine='manuale'). Un'unica implementazione corretta.
      const { data, error } = await supabase.rpc('acube_sdi_sync_inbound_production' as never, {
        p_stage: 'production',
        p_origine: 'manuale',
      } as never)
      if (error) throw new Error(error.message)
      const result = (data ?? {}) as { ok?: boolean; inserted?: number; found?: number; status?: string; error?: string | null }
      const inserted = result.inserted ?? 0
      const total = result.found ?? 0
      const skipped = Math.max(0, total - inserted)
      const hasErrors = result.ok === false || !!result.error || result.status === 'parziale' || result.status === 'errore'

      const summary = `${inserted} nuove fatture, ${skipped} già presenti\n(trovate su A-Cube: ${total})`
      toast({
        type: hasErrors ? 'warning' : 'success',
        message: hasErrors && result.error ? `${summary}\n\n${result.error}` : summary,
      })
      setSyncKey(prev => prev + 1)
      loadStats()
    } catch (err: unknown) {
      toast({ type: 'error', message: 'Errore sincronizzazione:\n' + (err as Error).message, duration: 20000 })
    } finally {
      setSyncing(false)
    }
  }

  const tabs: { id: FatturazioneTab; label: string; icon: typeof Inbox; count: number | undefined }[] = [
    // Badge: count diretto da electronic_invoices (stessa fonte del KPI
    // dentro la tab) cosi' i due numeri NON divergono mai.
    { id: 'passive', label: 'Fatture Passive', icon: Inbox, count: invoiceCounts.passive || sdiStats?.passive?.total },
    { id: 'active', label: 'Fatture Attive', icon: ArrowUpRight, count: invoiceCounts.active || sdiStats?.active?.total },
    { id: 'corrispettivi', label: 'Corrispettivi', icon: Store, count: sdiStats?.corrispettivi?.total },
  ]

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Le fatture passive SDI arrivano via pull REST A-Cube: cron automatico
          ogni 6h + pull manuale on-demand col bottone "Sincronizza SDI". */}

      <PageHeader
        title="Fatturazione Elettronica"
        subtitle="Gestione fatture SDI, emissione e corrispettivi telematici"
        noDivider
        actions={
          <>
            <SyncStatusBadge feed="fatture_passive" refreshKey={syncKey} />
            <button
              onClick={handleSyncAcubeSdi}
              disabled={syncing}
              title="Forza ora il pull delle fatture passive da A-Cube SDI. In automatico vengono già scaricate ogni 6 ore."
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Sincronizzazione...' : 'Sincronizza SDI'}
            </button>
          </>
        }
      />

      {/* Banner syncResult rimosso: il risultato della sync ora è mostrato via toast centrale globale. */}

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
    </div>
  )
}
