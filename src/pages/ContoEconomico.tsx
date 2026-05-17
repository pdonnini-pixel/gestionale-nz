import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHelp from '../components/PageHelp'
import { useToast } from '../components/Toast'
import { useCompanyLabels } from '../hooks/useCompanyLabels'

// Tipologia periodo ContoEconomico — persistita in URL come ?periodo=
type ContoPeriod = 'annuale' | 'trimestrale' | 'mensile' | 'provvisorio'
const VALID_CONTO_PERIODS: ContoPeriod[] = ['annuale', 'trimestrale', 'mensile', 'provvisorio']

// Vista ContoEconomico (competenza/cassa/riconciliazione) — persistita come ?view=
type ContoView = 'competenza' | 'cassa' | 'riconciliazione'
const VALID_CONTO_VIEWS: ContoView[] = ['competenza', 'cassa', 'riconciliazione']
import {
  TrendingUp, TrendingDown, DollarSign, PieChart, BarChart3, Upload,
  ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, AlertCircle,
  Building2, Users, Warehouse, Banknote, Calculator, ShieldCheck, Store, MapPin,
  FileUp, Download, Lock, CheckCircle, Clock, ThumbsUp, ThumbsDown,
  Lightbulb, AlertTriangle, FileText, Save, X, Sparkles, LineChart as LineChartIcon, Loader2,
  RefreshCw, Target, Info
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart as RePie, Pie, Cell,
  LineChart, Line, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useRole } from '../hooks/useRole'
import { usePeriod } from '../hooks/usePeriod'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'

import PdfViewer from '../components/PdfViewer'
import { parseBilancio, toSupabaseRecords } from '../lib/parsers/bilancioParser'

// ===== TYPES =====
interface RiconRettifica {
  code: string
  name: string
  total: number
}

interface RiconBilancioUfficiale {
  ebit: number | null
  proventiFinanziari: number | null
  oneriFinanziari: number | null
  utileNetto: number | null
  available: boolean
}

interface RiconData {
  ricavi: number
  costiOutlet: number
  speseNonDivise: number
  risultatoGestionale: number
  rettifiche: RiconRettifica[]
  rettificheTotale: number
  risultatoConRettifica: number
  bilancioUfficiale: RiconBilancioUfficiale
  deltaClassificazione: number | null
  countEntries: number
  countRettifiche: number
}

// ===== HELPERS =====
function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—'
  const rounded = Math.round(n * 100) / 100
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(rounded)
}
function pct(v: number, total: number | null | undefined): string {
  if (!total || total === 0) return '—'
  return `${(v / total * 100).toFixed(1)}%`
}
function variation(curr: number | null | undefined, prev: number | null | undefined): number | null {
  // Ritorna null in tutti i casi in cui il delta non e' calcolabile o
  // significativo. La UI mostra '—' quando e' null. Mai NaN/Infinity.
  if (curr == null || prev == null) return null
  const c = Number(curr)
  const p = Number(prev)
  if (!isFinite(c) || !isFinite(p)) return null
  // Entrambi zero: nessuna variazione da mostrare
  if (c === 0 && p === 0) return null
  // Precedente = 0, corrente != 0 → variazione di +∞ (impossibile da
  // rappresentare significativamente): mostriamo '—'
  if (p === 0) return null
  const delta = ((c - p) / Math.abs(p)) * 100
  if (!isFinite(delta) || isNaN(delta)) return null
  return delta
}

// ===== Italian number formatting for form inputs =====
function fmtInput(n: number | string | null | undefined): string {
  if (n == null || n === '') return ''
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return ''
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num)
}
function parseInputNumber(str: string | null | undefined): number | string {
  if (!str || typeof str !== 'string') return ''
  // Remove thousand separators (dots), replace comma with dot for decimal
  const cleaned = str.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? '' : n
}

// ===== FORM FIELDS with labels and validation =====
const CE_FIELDS = [
  { key: 'ricavi_vendite', label: 'Ricavi delle vendite', required: true, min: 0 },
  { key: 'altri_ricavi', label: 'Altri ricavi', min: 0 },
  { key: 'materie_prime', label: 'Materie prime e merci', min: 0 },
  { key: 'servizi', label: 'Servizi', min: 0 },
  { key: 'godimento_beni_terzi', label: 'Godimento beni di terzi', min: 0 },
  { key: 'salari_stipendi', label: 'Salari e stipendi', min: 0 },
  { key: 'oneri_sociali', label: 'Oneri sociali', min: 0 },
  { key: 'tfr', label: 'TFR', min: 0 },
  { key: 'totale_personale', label: 'Totale personale', min: 0, computed: true },
  { key: 'variazione_rimanenze', label: 'Variazione rimanenze' },
  { key: 'totale_ammortamenti', label: 'Ammortamenti', min: 0 },
  { key: 'oneri_diversi', label: 'Oneri diversi', min: 0 },
  { key: 'totale_costi_produzione', label: 'Totale costi produzione', min: 0, computed: true },
  { key: 'differenza_ab', label: 'Differenza A-B (EBITDA)', computed: true },
  { key: 'oneri_finanziari', label: 'Oneri finanziari', min: 0 },
  { key: 'imposte', label: 'Imposte', min: 0 },
  { key: 'utile_netto', label: 'Utile netto', computed: true },
]

// PDF text extraction patterns for Italian P&L
// Supports both standard CE format and "sezioni contrapposte" (codici contabili 51, 61, 63...)
const PDF_PATTERNS = [
  // Ricavi — codice 51 o "Valore della produzione" o "Ricavi delle vendite"
  { pattern: /(?:valore\s*della\s*produzione|ricavi\s*(?:delle\s*)?vendite\s*(?:e\s*delle\s*prest)?)[^\d]*?([\d.,]+)/i, field: 'ricavi_vendite' },
  // Materie prime — codice 61 o "Costi della produzione" o "materie prime"
  { pattern: /(?:per\s*)?materie\s*prime[^\d]*?([\d.,]+)/i, field: 'materie_prime' },
  { pattern: /costi\s*della\s*produzione[^\d]*?([\d.,]+)/i, field: 'materie_prime' },
  // Servizi — codice 63 o "Per servizi"
  { pattern: /(?:^|\s)(?:per\s+)?servizi\b[^\d]*?([\d.,]+)/im, field: 'servizi' },
  // Godimento beni di terzi — codice 65
  { pattern: /(?:per\s*)?godimento\s*(?:di\s*)?beni\s*(?:di\s*)?terzi[^\d]*?([\d.,]+)/i, field: 'godimento_beni_terzi' },
  // Salari e stipendi
  { pattern: /salari\s*(?:e\s*)?stipendi[^\d]*?([\d.,]+)/i, field: 'salari_stipendi' },
  // Oneri sociali
  { pattern: /oneri\s*sociali[^\d]*?([\d.,]+)/i, field: 'oneri_sociali' },
  // TFR
  { pattern: /(?:trattamento\s*(?:di\s*)?fine\s*rapporto|t\.?f\.?r\.?)[^\d]*?([\d.,]+)/i, field: 'tfr' },
  // Totale personale — codice 67 o "Per il personale"
  { pattern: /(?:per\s*il\s*personale|totale\s*(?:costo\s*del\s*)?personale)[^\d]*?([\d.,]+)/i, field: 'totale_personale' },
  // Ammortamenti — codice 69 + 71 o "Amm."
  { pattern: /amm(?:ortament[io]|\.)\s*(?:delle\s*)?immobilizzazion[ie][^\d]*?([\d.,]+)/i, field: 'totale_ammortamenti' },
  // Variazione rimanenze — codice 73
  { pattern: /variaz(?:ione)?\s*riman(?:enze)?[^\d-]*?(-?[\d.,]+)/i, field: 'variazione_rimanenze' },
  // Oneri diversi di gestione — codice 77
  { pattern: /oneri\s*diversi\s*(?:di\s*gestione)?[^\d]*?([\d.,]+)/i, field: 'oneri_diversi' },
  // Oneri finanziari — codice 83
  { pattern: /(?:interessi\s*e\s*(?:altri\s*)?)?oneri\s*finanziari[^\d]*?([\d.,]+)/i, field: 'oneri_finanziari' },
  // Imposte
  { pattern: /imposte\s*(?:sul\s*reddito|correnti)?[^\d]*?([\d.,]+)/i, field: 'imposte' },
  // Utile/Perdita
  { pattern: /(?:utile|perdita)\s*(?:netto|netta|d['']esercizio|di\s*esercizio)?[^\d]*?([\d.,]+)/i, field: 'utile_netto' },
  // Differenza A-B / EBITDA
  { pattern: /differenza\s*(?:tra\s*)?(?:valore\s*e\s*costi|A[\s-]*B)[^\d]*?([\d.,]+)/i, field: 'differenza_ab' },
]

function parseItalianNumber(str: string | null | undefined): number {
  if (!str) return 0
  // Italian: 1.234.567,89 → 1234567.89
  const cleaned = str.replace(/\./g, '').replace(',', '.')
  return parseFloat(cleaned) || 0
}

// ===== UI COMPONENTS =====
// TODO: tighten type
type KpiColor = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'indigo'
function Kpi({ label, value, sub, icon: Icon, color = 'blue', trend }: { label: string; value: string | number; sub?: string; icon: React.ComponentType<{ size?: number }>; color?: KpiColor; trend?: number | null }) {
  const colors: Record<KpiColor, string> = {
    blue: 'bg-blue-50 text-blue-600', green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600', indigo: 'bg-indigo-50 text-indigo-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <div className={`p-2 rounded-lg ${colors[color]}`}><Icon size={16} /></div>
        {trend != null && (
          <div className={`flex items-center gap-0.5 text-xs font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {trend >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(trend).toFixed(0)}%
          </div>
        )}
      </div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function Section({ title, icon: Icon, children, defaultOpen = true, badge }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode; defaultOpen?: boolean; badge?: string | number | null }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-slate-500" />
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          {badge && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{badge}</span>}
        </div>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>
      {open && <div className="border-t border-slate-100">{children}</div>}
    </div>
  )
}

function CeRow({ label, v2025, v2024, total2025, total2024, bold, indent, highlight, sub, border, editable, onChange, simMode, onEditChange, fieldKey, isDirty }: { label: string; v2025?: number | null; v2024?: number | null; total2025?: number | null; total2024?: number | null; bold?: boolean; indent?: boolean; highlight?: boolean; sub?: boolean; border?: boolean; editable?: boolean; onChange?: (v: number) => void; simMode?: boolean; onEditChange?: (key: string, dirty: boolean) => void; fieldKey?: string; isDirty?: boolean }) {
  const var25vs24 = variation(v2025, v2024)
  const value = v2025 != null ? v2025 : ''
  return (
    <tr className={`${bold ? 'font-semibold' : ''} ${highlight ? 'bg-blue-50/50' : ''} ${isDirty ? 'bg-yellow-50' : ''} ${border ? 'border-t-2 border-slate-300' : 'border-b border-slate-50'}`}>
      <td className={`py-1.5 px-4 text-sm ${indent ? 'pl-8' : ''} ${sub ? 'pl-12 text-slate-500 text-xs' : 'text-slate-800'}`}>
        {label}
        {isDirty && <span className="ml-1 text-[10px] text-amber-600 font-medium">●</span>}
      </td>
      <td className={`py-1.5 px-3 text-sm text-right tabular-nums ${bold ? 'text-slate-900' : 'text-slate-700'}`}>
        {editable && (simMode || v2025 != null) ? (
          <input
            type="number"
            value={value}
            onChange={(e) => {
              onChange?.(parseFloat(e.target.value) || 0)
              if (onEditChange && fieldKey) {
                onEditChange(fieldKey, true)
              }
            }}
            className={`w-32 px-2 py-1 text-right border rounded text-sm ${isDirty ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
            disabled={!simMode}
          />
        ) : v2025 != null ? fmt(v2025) : ''}
      </td>
      <td className="py-1.5 px-3 text-[11px] text-right text-slate-400 tabular-nums">
        {total2025 && v2025 != null ? pct(v2025, total2025) : ''}
      </td>
      <td className="py-1.5 px-3 text-sm text-right tabular-nums text-slate-500">
        {v2024 != null ? fmt(v2024) : '—'}
      </td>
      <td className="py-1.5 px-3 text-[11px] text-right text-slate-400 tabular-nums">
        {total2024 && v2024 != null ? pct(v2024, total2024) : ''}
      </td>
      <td className="py-1.5 px-3 text-xs text-right tabular-nums">
        {var25vs24 != null ? (
          <span className={var25vs24 >= 0 ? 'text-emerald-600' : 'text-red-600'}>
            {var25vs24 >= 0 ? '+' : ''}{var25vs24.toFixed(0)}%
          </span>
        ) : ''}
      </td>
    </tr>
  )
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
const TREND_COLORS = { ricavi: '#3b82f6', ebitda: '#10b981', personale: '#f59e0b', utile: '#8b5cf6' }

// ===== ANALYSIS ENGINE =====
function analyzeStrengthsWeaknesses(ce: Record<string, number | null | undefined>, ricavi: number) {
  if (!ricavi || ricavi === 0) return { strengths: [], weaknesses: [], recommendations: [] }

  const strengths = []
  const weaknesses = []
  const recommendations = []

  const margineLordoPct = ricavi > 0 ? ((ricavi - (ce.materie_prime || 0) + (ce.variazione_rimanenze || 0)) / ricavi * 100) : 0
  const personaleOnRicavi = ricavi > 0 ? ((ce.totale_personale || 0) / ricavi * 100) : 0
  const affitiOnRicavi = ricavi > 0 ? ((ce.godimento_beni_terzi || 0) / ricavi * 100) : 0
  const serviziOnRicavi = ricavi > 0 ? ((ce.servizi || 0) / ricavi * 100) : 0
  const ebitPct = ricavi > 0 ? ((ce.differenza_ab || 0) / ricavi * 100) : 0
  const utilePct = ricavi > 0 ? ((ce.utile_netto || 0) / ricavi * 100) : 0

  // Margine lordo
  if (margineLordoPct > 55) {
    strengths.push({ text: `Margine lordo eccellente (${margineLordoPct.toFixed(1)}%)`, detail: 'Superiore al benchmark retail del 50-55%' })
  } else if (margineLordoPct > 45) {
    strengths.push({ text: `Margine lordo buono (${margineLordoPct.toFixed(1)}%)`, detail: 'In linea con il settore moda' })
  } else if (margineLordoPct > 0) {
    weaknesses.push({ text: `Margine lordo basso (${margineLordoPct.toFixed(1)}%)`, detail: 'Sotto il benchmark del 45% per il retail moda' })
    recommendations.push('Rivedere la politica di markup e ridurre le promozioni eccessive')
  }

  // Personale
  if (personaleOnRicavi > 0 && personaleOnRicavi < 20) {
    strengths.push({ text: `Costo personale contenuto (${personaleOnRicavi.toFixed(1)}%)`, detail: 'Efficienza operativa elevata' })
  } else if (personaleOnRicavi > 30) {
    weaknesses.push({ text: `Incidenza personale elevata (${personaleOnRicavi.toFixed(1)}%)`, detail: 'Superiore alla soglia critica del 30%' })
    recommendations.push('Ottimizzare i turni e valutare produttività per addetto/outlet')
  } else if (personaleOnRicavi > 25) {
    weaknesses.push({ text: `Incidenza personale da monitorare (${personaleOnRicavi.toFixed(1)}%)`, detail: 'Vicina alla soglia del 25-30%' })
    recommendations.push('Monitorare produttività e valutare eventuali riorganizzazioni')
  }

  // Affitti
  if (affitiOnRicavi > 0 && affitiOnRicavi < 12) {
    strengths.push({ text: `Affitti sotto controllo (${affitiOnRicavi.toFixed(1)}%)`, detail: 'Ben sotto la soglia del 15% per il retail' })
  } else if (affitiOnRicavi > 18) {
    weaknesses.push({ text: `Incidenza affitti elevata (${affitiOnRicavi.toFixed(1)}%)`, detail: 'Superiore al 18% — pesa sulla redditività' })
    recommendations.push('Rinegoziare i canoni di locazione o valutare ubicazioni alternative')
  }

  // Servizi
  if (serviziOnRicavi > 15) {
    weaknesses.push({ text: `Costi servizi elevati (${serviziOnRicavi.toFixed(1)}%)`, detail: 'Verificare voci principali e fornitori' })
    recommendations.push('Analizzare le singole voci di servizio e rinegoziare i contratti principali')
  }

  // EBIT
  if (ebitPct > 8) {
    strengths.push({ text: `EBIT eccellente (${ebitPct.toFixed(1)}%)`, detail: 'Reddittività operativa sopra la media del settore' })
  } else if (ebitPct > 3) {
    strengths.push({ text: `EBIT positivo (${ebitPct.toFixed(1)}%)`, detail: 'Reddittività operativa nella media' })
  } else if (ebitPct < 0) {
    weaknesses.push({ text: `EBIT negativo (${ebitPct.toFixed(1)}%)`, detail: 'L\'attività operativa è in perdita' })
    recommendations.push('Intervento urgente: ridurre i costi fissi o incrementare i ricavi')
  }

  // Utile
  if (utilePct > 5) {
    strengths.push({ text: `Utile netto solido (${utilePct.toFixed(1)}% dei ricavi)`, detail: 'Buona capacità di generare profitto' })
  } else if (utilePct < 0) {
    weaknesses.push({ text: `Esercizio in perdita`, detail: `Utile netto: ${fmt(ce.utile_netto)} €` })
    recommendations.push('Analizzare le cause della perdita e definire un piano di rientro')
  }

  // Oneri finanziari
  const oneriFin = (ce.oneri_finanziari || 0)
  if (oneriFin > 0 && ricavi > 0 && oneriFin / ricavi * 100 > 3) {
    weaknesses.push({ text: `Oneri finanziari pesanti (${(oneriFin / ricavi * 100).toFixed(1)}%)`, detail: 'Indebitamento da tenere sotto controllo' })
    recommendations.push('Valutare ristrutturazione del debito o rinegoziazione dei tassi')
  }

  if (strengths.length === 0 && weaknesses.length === 0) {
    recommendations.push('Inserire i dati del Conto Economico per generare l\'analisi automatica')
  }

  return { strengths, weaknesses, recommendations }
}

// ===== MAIN PAGE =====
export default function ContoEconomico() {
  const { toast } = useToast()
  const { profile } = useAuth()
  const { hasRole } = useRole()
  const labels = useCompanyLabels()
  const COMPANY_ID = profile?.company_id
  const { year, quarter, getDateRange } = usePeriod()
  // periodType persistito in URL come ?periodo=… (default 'annuale')
  const [searchParams, setSearchParams] = useSearchParams()
  const periodoParam = searchParams.get('periodo')
  const periodType: ContoPeriod = VALID_CONTO_PERIODS.includes(periodoParam as ContoPeriod)
    ? (periodoParam as ContoPeriod)
    : 'annuale'
  const setPeriodType = (next: ContoPeriod) => {
    const params = new URLSearchParams(searchParams)
    params.set('periodo', next)
    setSearchParams(params)
  }
  const [periodData, setPeriodData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [simulationMode, setSimulationMode] = useState(false)
  const [simData, setSimData] = useState<any>(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [companyInfo, setCompanyInfo] = useState<any>(null)
  const [imports, setImports] = useState<any[]>([])
  const [showImportForm, setShowImportForm] = useState(false)
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [formErrors, setFormErrors] = useState<Record<string, any>>({})

  // Feature 2: Approval workflow
  const [showApproveConfirm, setShowApproveConfirm] = useState<any>(null)

  // Feature 3: Nota integrativa
  const [notaIntegrativa, setNotaIntegrativa] = useState('')
  const [notaSaving, setNotaSaving] = useState(false)
  const [notaLoaded, setNotaLoaded] = useState(false)

  // Feature 4: PDF parsing
  const [pdfParsing, setPdfParsing] = useState(false)
  const [parsedFields, setParsedFields] = useState<any>(null)
  const [pdfPreview, setPdfPreview] = useState<any>(null)
  const [bilancioData, setBilancioData] = useState<any>(null) // full parsed bilancio tree
  const [showBilancioTree, setShowBilancioTree] = useState(false)
  const [bilancioSaving, setBilancioSaving] = useState(false)
  const [bilancioSaved, setBilancioSaved] = useState(false)

  // Feature: Previous year bilancio tree for YoY comparison
  const [prevBilancioData, setPrevBilancioData] = useState<any>(null)

  // Feature 6: Trend multi-anno
  const [trendData, setTrendData] = useState<any[]>([])
  const [showTrend, setShowTrend] = useState(false)

  // Feature: YoY comparison toggle
  const [showYoY, setShowYoY] = useState(true)

  // Feature: Cash-basis (Cassa) view
  // viewMode persistito in URL come ?view=… (default 'competenza')
  const viewParam = searchParams.get('view')
  const viewMode: ContoView = VALID_CONTO_VIEWS.includes(viewParam as ContoView)
    ? (viewParam as ContoView)
    : 'competenza'
  const setViewMode = (next: ContoView) => {
    const params = new URLSearchParams(searchParams)
    params.set('view', next)
    setSearchParams(params)
  }
  type CashMonth = { mese: number; meseLabel: string; entrate: number; uscite: number; netto: number }
  type CashCat = { category_id: string; entrate: number; uscite: number; category_name?: string; name?: string }
  type CashDataT = { monthly: CashMonth[]; byCategory: CashCat[]; totals: { entrate: number; uscite: number; netto: number }; count: number; hasCategorized: boolean } | null
  const [cashData, setCashData] = useState<CashDataT>(null)
  const [cashLoading, setCashLoading] = useState(false)

  // Riconciliazione Bilancio data
  const [riconData, setRiconData] = useState<RiconData | null>(null)
  const [riconLoading, setRiconLoading] = useState(false)

  // NEW: Manual save functionality
  const [dirtyFields, setDirtyFields] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<any>(null)
  // Anni disponibili dal DB. Default: anno corrente come fallback minimo per
  // tenant vergini (es. Made/Zago appena onboardati). Popolato in loadAvailableYears.
  const [availableYears, setAvailableYears] = useState<number[]>([new Date().getFullYear()])

  // ═══ STEP B2: Sincronia Competenza ↔ Budget e Controllo ═══
  // Aggregazione totali da budget_entries: preventivo, consuntivo, scostamento.
  // Mostrata in sezione "Confronto con Budget" della vista Competenza.
  // Ricavi: account_code che inizia con '5' (convenzione standard piano dei
  // conti italiano). Costi: tutto il resto, escluso cost_center='rettifica_bilancio'.
  type BudgetSummary = {
    ricaviPrev: number; ricaviCons: number;
    costiPrev: number; costiCons: number;
    lastRefresh: Date | null; anyStale: boolean;
    rowsTotal: number; rowsBudgetCompiled: number;
  }
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary | null>(null)
  const [budgetRefreshing, setBudgetRefreshing] = useState(false)

  // ═══ Load bilancio tree from Supabase (persists across page reloads) ═══
  type BilancioRow = { code: string; description: string; amount: number; level: number; isMacro: boolean }
  type BilancioNode = BilancioRow & { children: BilancioNode[] }
  type SectionKey = 'sp_attivita' | 'sp_passivita' | 'ce_costi' | 'ce_ricavi'
  const loadBilancioFromSupabase = async () => {
    try {
      if (!COMPANY_ID) return
      const companyId = COMPANY_ID
      const sections = ['sp_attivita', 'sp_passivita', 'ce_costi', 'ce_ricavi'] as const
      const { data } = await supabase
        .from('balance_sheet_data')
        .select('*')
        .eq('company_id', companyId)
        .eq('year', year)
        .eq('period_type', periodType)
        .in('section', sections as unknown as string[])
        .order('sort_order')

      if (!data || data.length === 0) {
        setBilancioData(null)
        setShowBilancioTree(false)
        return
      }

      // Filter out header/footer junk rows that were captured from PDF
      const junkPattern = /Azienda:|Cod\.\s*Fiscale|Partita\s*IVA|^VIA\s|PERIODO\s*DAL|Totali\s*fino|Considera\s*anche|^Pag\./i
      const cleanData = data.filter(row => !junkPattern.test(row.account_name || ''))

      // Reconstruct bilancio tree structure from flat Supabase records
      const bySection: Record<SectionKey, BilancioRow[]> = { sp_attivita: [], sp_passivita: [], ce_costi: [], ce_ricavi: [] }
      cleanData.forEach(row => {
        const sectionKey = row.section as SectionKey
        if (bySection[sectionKey]) {
          bySection[sectionKey].push({
            code: row.account_code || '',
            description: row.account_name || '',
            amount: row.amount || 0,
            level: getCodeLevel(row.account_code),
            isMacro: (row.account_code || '').replace(/\s/g, '').length <= 2,
          })
        }
      })

      // Build trees
      const buildTree = (rows: BilancioRow[]): BilancioNode[] => {
        if (!rows || rows.length === 0) return []
        const tree: BilancioNode[] = []
        const stack: { node: BilancioNode; level: number }[] = []
        for (const row of rows) {
          const node: BilancioNode = { ...row, children: [] }
          while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop()
          if (stack.length === 0) tree.push(node)
          else stack[stack.length - 1].node.children.push(node)
          stack.push({ node, level: node.level })
        }
        return tree
      }

      // Calculate totals
      const spAttMacros = bySection.sp_attivita.filter(r => r.isMacro)
      const spPasMacros = bySection.sp_passivita.filter(r => r.isMacro)
      const ceCostiMacros = bySection.ce_costi.filter(r => r.isMacro)
      const ceRicaviMacros = bySection.ce_ricavi.filter(r => r.isMacro)

      const totAttivita = spAttMacros.reduce((s, r) => s + r.amount, 0)
      const totPassivita = spPasMacros.reduce((s, r) => s + r.amount, 0)
      const totCosti = ceCostiMacros.reduce((s, r) => s + r.amount, 0)
      const totRicavi = ceRicaviMacros.reduce((s, r) => s + r.amount, 0)

      // Get risultato from conto_economico section
      const { data: ceData } = await supabase
        .from('balance_sheet_data')
        .select('amount')
        .eq('company_id', companyId)
        .eq('year', year)
        .eq('period_type', periodType)
        .eq('section', 'conto_economico')
        .eq('account_code', 'utile_netto')
        .maybeSingle()

      const risultato = ceData?.amount || 0

      // Get company info for meta
      const { data: impData } = await supabase
        .from('balance_sheet_imports')
        .select('file_name, period_label')
        .eq('company_id', companyId)
        .eq('year', year)
        .eq('period_type', periodType)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const reconstructed = {
        meta: {
          company: (companyInfo as { denominazione?: string } | null)?.denominazione || '',
          period: impData?.period_label || `${periodType} ${year}`,
        },
        patrimoniale: {
          attivita: bySection.sp_attivita,
          passivita: bySection.sp_passivita,
          attivitaTree: buildTree(bySection.sp_attivita),
          passivitaTree: buildTree(bySection.sp_passivita),
          totals: { attivita: totAttivita, passivita: totPassivita, risultato },
        },
        contoEconomico: {
          costi: bySection.ce_costi,
          ricavi: bySection.ce_ricavi,
          costiTree: buildTree(bySection.ce_costi),
          ricaviTree: buildTree(bySection.ce_ricavi),
          totals: { costi: totCosti, ricavi: totRicavi, risultato },
        },
      }

      setBilancioData(reconstructed)
      setShowBilancioTree(true)
      setBilancioSaved(true) // already saved since we loaded from DB
    } catch (err: unknown) {
      console.error('Error loading bilancio tree:', err)
    }
  }

  // ═══ Load PREVIOUS year bilancio tree from Supabase for YoY comparison ═══
  const loadPrevBilancioFromSupabase = async () => {
    try {
      if (!COMPANY_ID) return
      const companyId = COMPANY_ID
      const prevYear = year - 1
      const sections = ['sp_attivita', 'sp_passivita', 'ce_costi', 'ce_ricavi'] as const
      const { data } = await supabase
        .from('balance_sheet_data')
        .select('*')
        .eq('company_id', companyId)
        .eq('year', prevYear)
        .eq('period_type', periodType)
        .in('section', sections as unknown as string[])
        .order('sort_order')

      if (!data || data.length === 0) {
        setPrevBilancioData(null)
        return
      }

      const junkPattern = /Azienda:|Cod\.\s*Fiscale|Partita\s*IVA|^VIA\s|PERIODO\s*DAL|Totali\s*fino|Considera\s*anche|^Pag\./i
      const cleanData = data.filter(row => !junkPattern.test(row.account_name || ''))

      // Build a lookup map: account_code -> amount (for matching with current year)
      const prevByCode: Record<string, number> = {}
      cleanData.forEach(row => {
        if (row.account_code) prevByCode[row.account_code] = row.amount || 0
      })

      // Also build section-based structures for tree matching
      const bySection: Record<SectionKey, BilancioRow[]> = { sp_attivita: [], sp_passivita: [], ce_costi: [], ce_ricavi: [] }
      cleanData.forEach(row => {
        const sectionKey = row.section as SectionKey
        if (bySection[sectionKey]) {
          bySection[sectionKey].push({
            code: row.account_code || '',
            description: row.account_name || '',
            amount: row.amount || 0,
            level: getCodeLevel(row.account_code),
            isMacro: (row.account_code || '').replace(/\s/g, '').length <= 2,
          })
        }
      })

      const spAttMacros = bySection.sp_attivita.filter(r => r.isMacro)
      const spPasMacros = bySection.sp_passivita.filter(r => r.isMacro)
      const ceCostiMacros = bySection.ce_costi.filter(r => r.isMacro)
      const ceRicaviMacros = bySection.ce_ricavi.filter(r => r.isMacro)

      const totAttivita = spAttMacros.reduce((s, r) => s + r.amount, 0)
      const totPassivita = spPasMacros.reduce((s, r) => s + r.amount, 0)
      const totCosti = ceCostiMacros.reduce((s, r) => s + r.amount, 0)
      const totRicavi = ceRicaviMacros.reduce((s, r) => s + r.amount, 0)

      // Get risultato
      const { data: ceData } = await supabase
        .from('balance_sheet_data')
        .select('amount')
        .eq('company_id', companyId)
        .eq('year', prevYear)
        .eq('period_type', periodType)
        .eq('section', 'conto_economico')
        .eq('account_code', 'utile_netto')
        .maybeSingle()

      const risultato = ceData?.amount || 0

      setPrevBilancioData({
        byCode: prevByCode,
        year: prevYear,
        contoEconomico: {
          totals: { costi: totCosti, ricavi: totRicavi, risultato },
        },
        patrimoniale: {
          totals: { attivita: totAttivita, passivita: totPassivita, risultato },
        },
      })
    } catch (err: unknown) {
      console.error('Error loading prev bilancio:', err)
      setPrevBilancioData(null)
    }
  }

  // Helper to determine level from account code length
  function getCodeLevel(code: string | null | undefined): number {
    if (!code) return 0
    const len = code.replace(/\s/g, '').length
    if (len <= 2) return 0
    if (len <= 4) return 1
    if (len <= 6) return 2
    return 3
  }

  // Load data on mount and when year/period changes
  useEffect(() => {
    if (!COMPANY_ID) return
    loadPeriodData()
    loadCompanyInfo()
    loadImports()
    loadNotaIntegrativa()
    loadAvailableYears()
    loadBilancioFromSupabase()
    loadPrevBilancioFromSupabase()
  }, [year, quarter, periodType, COMPANY_ID])

  // Feature 6: Load trend on toggle
  useEffect(() => {
    if (showTrend) loadTrendData()
  }, [showTrend, periodType])

  const loadCompanyInfo = async () => {
    // Carico da 2 sorgenti: company_settings (dati estesi) + companies
    // (denominazione, partita iva, codice fiscale). Niente fallback hardcoded
    // a un tenant specifico — il prodotto è multi-tenant. Se i dati non sono
    // disponibili, mostro stringa vuota e l'utente può aggiornare in
    // Impostazioni.
    try {
      const [settingsRes, companyRes] = await Promise.all([
        supabase.from('company_settings').select('*').eq('company_id', COMPANY_ID!).maybeSingle(),
        supabase.from('companies').select('*').eq('id', COMPANY_ID!).maybeSingle(),
      ])
      const settings = (settingsRes.data || {}) as Record<string, unknown>
      const company = (companyRes.data || {}) as Record<string, unknown>
      setCompanyInfo({
        ...settings,
        denominazione: settings.denominazione || company.name || company.denominazione || '',
        cf_piva: settings.cf_piva || company.fiscal_code || company.vat_number || company.codice_fiscale || company.partita_iva || '',
        sede: settings.sede || company.city || '',
      })
    } catch (error) {
      console.error('Error loading company info:', error)
      // Fallback finale se entrambe le query falliscono: stringhe vuote.
      setCompanyInfo({
        denominazione: '',
        cf_piva: '',
        sede: '',
      })
    }
  }

  const loadImports = async () => {
    try {
      const { data } = await supabase
        .from('balance_sheet_imports')
        .select('*')
        .eq('company_id', COMPANY_ID!)
        .order('created_at', { ascending: false })
      setImports(data || [])
    } catch (error) {
      console.error('Error loading imports:', error)
    }
  }

  // NEW: Load available years dynamically
  const loadAvailableYears = async () => {
    try {
      const { data } = await supabase
        .from('balance_sheet_data')
        .select('year')
        .eq('company_id', COMPANY_ID!)
        .neq('section', 'nota_integrativa')
      if (data && data.length > 0) {
        const years = [...new Set(data.map(d => d.year))].sort((a, b) => b - a)
        if (years.length > 0) setAvailableYears(years)
      }
      // Se non ci sono righe in balance_sheet_data, lascia il default
      // (anno corrente). Tenant vergini ottengono cosi' lo year selector con
      // 1 sola voce invece di anni storici NZ-specifici.
    } catch (error) {
      console.error('Error loading available years:', error)
    }
  }

  const loadPeriodData = async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('balance_sheet_data')
        .select('*')
        .eq('company_id', COMPANY_ID!)
        .eq('year', year)
        .eq('period_type', periodType)
      setPeriodData(data || [])
      setSimData(null)
    } catch (error) {
      console.error('Error loading period data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Feature 3: Nota Integrativa load/save
  const loadNotaIntegrativa = async () => {
    try {
      const { data } = await supabase
        .from('balance_sheet_data')
        .select('*')
        .eq('company_id', COMPANY_ID!)
        .eq('year', year)
        .eq('period_type', periodType)
        .eq('section', 'nota_integrativa')
        .eq('account_code', 'nota_testo')
        .maybeSingle()
      setNotaIntegrativa(data?.account_name || '')
      setNotaLoaded(true)
    } catch (error) {
      console.error('Error loading nota integrativa:', error)
      setNotaLoaded(true)
    }
  }

  const handleSaveNota = async () => {
    setNotaSaving(true)
    try {
      // Upsert nota integrativa as a special record
      const { data: existing } = await supabase
        .from('balance_sheet_data')
        .select('id')
        .eq('company_id', COMPANY_ID!)
        .eq('year', year)
        .eq('period_type', periodType)
        .eq('section', 'nota_integrativa')
        .eq('account_code', 'nota_testo')
        .maybeSingle()

      if (existing) {
        await supabase
          .from('balance_sheet_data')
          .update({ account_name: notaIntegrativa })
          .eq('id', existing.id)
      } else {
        if (!COMPANY_ID) return
        await supabase
          .from('balance_sheet_data')
          .insert({
            company_id: COMPANY_ID,
            year,
            period_type: periodType,
            section: 'nota_integrativa',
            account_code: 'nota_testo',
            account_name: notaIntegrativa,
            amount: 0,
            sort_order: 999,
          })
      }
    } catch (error) {
      console.error('Error saving nota integrativa:', error)
    } finally {
      setNotaSaving(false)
    }
  }

  // Feature 6: Trend multi-anno
  const loadTrendData = async () => {
    try {
      // Anni dal DB (caricati in loadAvailableYears) invece di hardcoded NZ.
      // Su tenant vergini availableYears = [annoCorrente] → trend vuoto, OK.
      const years = availableYears.length > 0 ? availableYears : [new Date().getFullYear()]
      const { data } = await supabase
        .from('balance_sheet_data')
        .select('*')
        .eq('company_id', COMPANY_ID!)
        .eq('period_type', periodType)
        .in('year', years)
        .neq('section', 'nota_integrativa')

      const byYear: Record<number, Record<string, number>> = {}
      years.forEach(y => { byYear[y] = {} })
      ;(data || []).forEach(row => {
        if (!byYear[row.year]) byYear[row.year] = {}
        if (row.account_code) byYear[row.year][row.account_code] = row.amount || 0
      })

      const trend = years.map(y => ({
        anno: y.toString(),
        ricavi: byYear[y]?.ricavi_vendite || 0,
        ebitda: byYear[y]?.differenza_ab || 0,
        personale: byYear[y]?.totale_personale || 0,
        utile: byYear[y]?.utile_netto || 0,
      })).filter(t => t.ricavi > 0 || t.ebitda !== 0 || t.utile !== 0)

      setTrendData(trend)
    } catch (error) {
      console.error('Error loading trend data:', error)
    }
  }

  // Feature: Load cash-basis data from cash_movements
  const loadCashData = useCallback(async () => {
    if (!COMPANY_ID) return
    setCashLoading(true)
    try {
      const range = getDateRange()
      const { data, error } = await supabase
        .from('cash_movements')
        .select('id, date, type, amount, cost_category_id, description')
        .eq('company_id', COMPANY_ID!)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date')

      if (error) throw error

      if (!data || data.length === 0) {
        setCashData({ monthly: [], byCategory: [], totals: { entrate: 0, uscite: 0, netto: 0 }, count: 0, hasCategorized: false })
        setCashLoading(false)
        return
      }

      // Aggregate monthly
      type MonthAgg = { mese: number; meseLabel: string; entrate: number; uscite: number; netto: number }
      const monthlyMap: Record<number, MonthAgg> = {}
      for (let m = 1; m <= 12; m++) {
        monthlyMap[m] = { mese: m, meseLabel: new Date(year, m - 1, 1).toLocaleDateString('it-IT', { month: 'short' }), entrate: 0, uscite: 0, netto: 0 }
      }

      let totalEntrate = 0, totalUscite = 0
      let categorizedCount = 0
      type CatAgg = { category_id: string; entrate: number; uscite: number }
      const categoryMap: Record<string, CatAgg> = {}

      data.forEach(row => {
        if (!row.date) return
        const month = new Date(row.date).getMonth() + 1
        const amt = Math.abs(row.amount || 0)
        if (row.type === 'entrata') {
          monthlyMap[month].entrate += amt
          totalEntrate += amt
        } else {
          monthlyMap[month].uscite += amt
          totalUscite += amt
        }
        monthlyMap[month].netto = monthlyMap[month].entrate - monthlyMap[month].uscite

        if (row.cost_category_id) {
          categorizedCount++
          const key = row.cost_category_id
          if (!categoryMap[key]) categoryMap[key] = { category_id: key, entrate: 0, uscite: 0 }
          if (row.type === 'entrata') categoryMap[key].entrate += amt
          else categoryMap[key].uscite += amt
        }
      })

      const monthly = Object.values(monthlyMap).filter(m => m.entrate > 0 || m.uscite > 0)

      // Load category names if we have categorized data
      const byCategory: Array<CatAgg & { category_name?: string }> = Object.values(categoryMap)
      const catNameMap: Record<string, string> = {}
      if (byCategory.length > 0) {
        const catIds = byCategory.map(c => c.category_id)
        const { data: cats } = await supabase
          .from('cost_categories')
          .select('id, name')
          .in('id', catIds)
        ;(cats || []).forEach(c => { if (c.id && c.name) catNameMap[c.id] = c.name })
        byCategory.forEach(c => { c.category_name = catNameMap[c.category_id] || `Categoria ${c.category_id}` })
        byCategory.sort((a, b) => (b.uscite + b.entrate) - (a.uscite + a.entrate))
      }

      setCashData({
        monthly,
        byCategory,
        totals: { entrate: totalEntrate, uscite: totalUscite, netto: totalEntrate - totalUscite },
        count: data.length,
        hasCategorized: categorizedCount > data.length * 0.1, // at least 10% categorized
      })
    } catch (err: unknown) {
      console.error('Error loading cash data:', err)
      setCashData(null)
    } finally {
      setCashLoading(false)
    }
  }, [COMPANY_ID, year, quarter, getDateRange])

  // Load cash data when switching to cassa view or period changes
  useEffect(() => {
    if (viewMode === 'cassa') loadCashData()
  }, [viewMode, year, quarter, loadCashData])

  // ═══ Riconciliazione Bilancio — carica dati da budget_entries ═══
  const loadRiconciliazione = useCallback(async () => {
    if (!COMPANY_ID) return
    setRiconLoading(true)
    try {
      const { data, error } = await supabase
        .from('budget_entries')
        .select('account_code, account_name, budget_amount, actual_amount, cost_center, macro_group')
        .eq('company_id', COMPANY_ID!)
        .eq('year', year)
        .range(0, 9999) // override default Supabase limit 1000

      if (error) throw error
      if (!data || data.length === 0) {
        setRiconData(null)
        return
      }

      // Helper: prende actual_amount se disponibile, altrimenti budget_amount
      type BudgetRowLite = { account_code?: string | null; account_name?: string | null; budget_amount?: number | null; actual_amount?: number | null; cost_center?: string | null; macro_group?: string | null }
      const getAmount = (e: BudgetRowLite) => Number(e.actual_amount) || Number(e.budget_amount) || 0

      // Ricavi: account_code inizia con '5', esclusa rettifica
      const ricavi = data
        .filter(e => e.account_code?.startsWith('5') && e.cost_center !== 'rettifica_bilancio')
        .reduce((sum, e) => sum + getAmount(e), 0)

      // Costi outlet: non inizia con '5', non spese_non_divise, non rettifica
      const costiOutlet = data
        .filter(e => !e.account_code?.startsWith('5') && e.cost_center !== 'spese_non_divise' && e.cost_center !== 'rettifica_bilancio')
        .reduce((sum, e) => sum + getAmount(e), 0)

      // Spese non divise: cost_center = 'spese_non_divise', esclusi ricavi
      const speseNonDivise = data
        .filter(e => e.cost_center === 'spese_non_divise' && !e.account_code?.startsWith('5'))
        .reduce((sum, e) => sum + getAmount(e), 0)

      // Rettifiche: cost_center = 'rettifica_bilancio' (usano budget_amount)
      const rettificheEntries = data.filter(e => e.cost_center === 'rettifica_bilancio')
      const rettificheTotale = rettificheEntries.reduce((sum, e) => sum + (Number(e.budget_amount) || 0), 0)

      // Raggruppa rettifiche per tipo (account_code)
      const rettificheByType: Record<string, RiconRettifica> = {}
      rettificheEntries.forEach(e => {
        const key = e.account_code
        if (!key) return
        if (!rettificheByType[key]) {
          rettificheByType[key] = { code: key, name: e.account_name || '', total: 0 }
        }
        rettificheByType[key].total += Number(e.budget_amount) || 0
      })

      const risultatoGestionale = ricavi - costiOutlet - speseNonDivise
      const risultatoConRettifica = risultatoGestionale + Math.abs(rettificheTotale)

      // Bilancio civilistico ufficiale: letto da balance_sheet_data section='conto_economico'.
      // Sostituisce hardcoding NZ 2025 (trappola multi-tenant). Funziona automaticamente
      // su tutti i tenant: se non c'e' bilancio importato per l'anno, available=false e la
      // sezione "Bilancio civilistico" della vista Riconciliazione resta nascosta.
      const { data: bilancioCERows } = await supabase
        .from('balance_sheet_data')
        .select('account_code, amount')
        .eq('company_id', COMPANY_ID)
        .eq('year', year)
        .eq('section', 'conto_economico')
        .in('account_code', ['differenza_ab', 'oneri_finanziari', 'proventi_finanziari', 'utile_netto'])

      const bilancioMap: Record<string, number> = {}
      ;(bilancioCERows || []).forEach((r) => {
        if (r.account_code) bilancioMap[r.account_code] = Number(r.amount) || 0
      })

      // EBIT = differenza_ab (label "Differenza A-B" del CE civilistico).
      // Oneri finanziari sono salvati come positivi in DB ma vanno mostrati negativi.
      const hasBilancio = (bilancioCERows || []).length > 0
      const bilancioUfficiale = hasBilancio ? {
        ebit: bilancioMap['differenza_ab'] ?? 0,
        proventiFinanziari: bilancioMap['proventi_finanziari'] ?? 0,
        oneriFinanziari: bilancioMap['oneri_finanziari'] !== undefined ? -Math.abs(bilancioMap['oneri_finanziari']) : 0,
        utileNetto: bilancioMap['utile_netto'] ?? 0,
        available: true,
      } : { ebit: null, proventiFinanziari: null, oneriFinanziari: null, utileNetto: null, available: false }

      const deltaClassificazione = bilancioUfficiale.available && bilancioUfficiale.ebit !== null
        ? risultatoConRettifica - bilancioUfficiale.ebit
        : null

      setRiconData({
        ricavi,
        costiOutlet,
        speseNonDivise,
        risultatoGestionale,
        rettifiche: Object.values(rettificheByType),
        rettificheTotale,
        risultatoConRettifica,
        bilancioUfficiale,
        deltaClassificazione,
        countEntries: data.length,
        countRettifiche: rettificheEntries.length,
      })
    } catch (err: unknown) {
      console.error('Error loading riconciliazione data:', err)
      setRiconData(null)
    } finally {
      setRiconLoading(false)
    }
  }, [COMPANY_ID, year])

  useEffect(() => {
    if (viewMode === 'riconciliazione') loadRiconciliazione()
  }, [viewMode, year, loadRiconciliazione])

  // ═══ STEP B2: Carica aggregato budget_entries per Competenza ═══
  // Aggrega ricavi (account_code che inizia con '5') e costi (resto, escluso
  // rettifica_bilancio) da budget_entries dell'anno corrente. Risultati:
  // preventivo (budget_amount), consuntivo (actual_amount), freschezza refresh.
  type BudgetEntryAgg = {
    account_code?: string | null; cost_center?: string | null;
    budget_amount?: number | null; actual_amount?: number | null;
    actual_refreshed_at?: string | null
  }
  const loadBudgetSummary = useCallback(async () => {
    if (!COMPANY_ID) return
    try {
      const { data } = await supabase
        .from('budget_entries')
        .select('account_code, cost_center, budget_amount, actual_amount, actual_refreshed_at')
        .eq('company_id', COMPANY_ID)
        .eq('year', year)
        .range(0, 9999) as { data: BudgetEntryAgg[] | null } // override default Supabase limit 1000
      const rows = data || []
      let ricaviPrev = 0, ricaviCons = 0, costiPrev = 0, costiCons = 0
      let anyStale = false
      let lastTs = 0
      let rowsBudgetCompiled = 0
      rows.forEach((r) => {
        if (r.cost_center === 'rettifica_bilancio') return
        const ac = r.account_code || ''
        const isRev = ac.startsWith('5')
        const bp = Number(r.budget_amount || 0)
        const ac2 = Number(r.actual_amount || 0)
        if (isRev) {
          ricaviPrev += bp
          ricaviCons += ac2
        } else {
          costiPrev += bp
          costiCons += ac2
        }
        if (bp !== 0) rowsBudgetCompiled++
        if (!r.actual_refreshed_at) anyStale = true
        else {
          const t = new Date(r.actual_refreshed_at).getTime()
          if (t > lastTs) lastTs = t
        }
      })
      setBudgetSummary({
        ricaviPrev, ricaviCons, costiPrev, costiCons,
        lastRefresh: lastTs > 0 ? new Date(lastTs) : null,
        anyStale,
        rowsTotal: rows.length,
        rowsBudgetCompiled,
      })
    } catch (err) {
      console.error('[loadBudgetSummary]', err)
      setBudgetSummary(null)
    }
  }, [COMPANY_ID, year])

  useEffect(() => {
    if (viewMode === 'competenza' && COMPANY_ID) loadBudgetSummary()
  }, [viewMode, year, COMPANY_ID, loadBudgetSummary])

  // Chiama RPC refresh_budget_consuntivo (riusa quella creata in Task A,
  // Lavoro 1). Bypassata per ruolo 'ceo'. Dopo chiamata, ricarica summary.
  const handleRefreshBudget = async () => {
    if (!COMPANY_ID) return
    setBudgetRefreshing(true)
    try {
      const { data, error } = await supabase.rpc('refresh_budget_consuntivo', {
        p_outlet_id: null,
        p_year: year,
      })
      if (error) throw error
      const result = (data ?? {}) as { success?: boolean; error?: string }
      if (result.success === false) throw new Error(result.error || 'Errore aggiornamento consuntivo')
      await loadBudgetSummary()
    } catch (err) {
      console.error('[handleRefreshBudget]', err)
    } finally {
      setBudgetRefreshing(false)
    }
  }

  // Helper formato relative time (riuso pattern Budget e Controllo)
  const fmtRelTime = (d: Date | null): string => {
    if (!d) return 'mai'
    const diff = Date.now() - d.getTime()
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'pochi secondi fa'
    if (min < 60) return `${min} min fa`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h} ${h === 1 ? 'ora' : 'ore'} fa`
    const day = Math.floor(h / 24)
    return `${day} ${day === 1 ? 'giorno' : 'giorni'} fa`
  }

  // Feature 4: PDF parsing with pdfjs-dist
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingFile(true)
    setPdfParsing(true)
    try {
      // Upload to storage
      const fileName = `${Date.now()}-${file.name}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('balance-sheets')
        .upload(fileName, file)

      if (uploadError) throw uploadError

      // Delete previous imports for same year/period (avoid duplicates)
      await supabase
        .from('balance_sheet_imports')
        .delete()
        .eq('company_id', COMPANY_ID!)
        .eq('year', year)
        .eq('period_type', periodType)

      // Create import record
      if (!COMPANY_ID) throw new Error('No company id')
      const { error: insertError } = await supabase
        .from('balance_sheet_imports')
        .insert({
          company_id: COMPANY_ID,
          year: year,
          period_type: periodType,
          period_label: `${periodType} ${year}`,
          file_name: file.name,
          file_path: uploadData.path,
          file_size: file.size,
          status: 'uploaded',
          uploaded_by: profile?.id || null,
          uploaded_by_name: (profile as { full_name?: string; email?: string } | null)?.full_name || profile?.email || null,
        })
        .select()

      if (insertError) throw insertError

      // Try to parse PDF with advanced bilancio parser
      if (file.type === 'application/pdf') {
        try {
          const arrayBuffer = await file.arrayBuffer()

          // Clone buffer for PDF viewer (parseBilancio may detach the original)
          const pdfViewerCopy = arrayBuffer.slice(0)

          // Use advanced bilancio parser (extracts full chart of accounts)
          const parsed = await parseBilancio(arrayBuffer)
          setBilancioData(parsed)
          setShowBilancioTree(true)
          setBilancioSaved(false)

          // Store PDF copy for preview (use the cloned buffer)
          setPdfPreview(pdfViewerCopy)

          // Also populate legacy form fields for backward compatibility
          const t = parsed.contoEconomico.totals
          const ceMacro: Record<string, number> = {}
          parsed.contoEconomico.costi.forEach((row: BilancioRow) => {
            if (row.isMacro) ceMacro[row.code] = row.amount
          })
          const ceSub: Record<string, number> = {}
          parsed.contoEconomico.costi.forEach((row: BilancioRow) => {
            if (row.level === 1) ceSub[row.code] = row.amount
          })

          const totalePersonale = ceMacro['67'] || 0
          const totaleAmmortamenti = (ceMacro['69'] || 0) + (ceMacro['71'] || 0)
          const variazioneRimanenze = ceMacro['73'] || 0
          const oneriDiversi = ceMacro['77'] || 0
          const materiePrime = ceMacro['61'] || 0
          const servizi = ceMacro['63'] || 0
          const godimentoBeniTerzi = ceMacro['65'] || 0
          const totaleCostiProduzione = Math.round((materiePrime + servizi + godimentoBeniTerzi + totalePersonale + totaleAmmortamenti + variazioneRimanenze + oneriDiversi) * 100) / 100
          const ricaviVendite = t.ricavi || 0
          const extracted: Record<string, number> = {
            ricavi_vendite: ricaviVendite,
            materie_prime: materiePrime,
            servizi: servizi,
            godimento_beni_terzi: godimentoBeniTerzi,
            salari_stipendi: ceSub['6701'] || 0,
            oneri_sociali: ceSub['6703'] || 0,
            tfr: ceSub['6705'] || 0,
            totale_personale: totalePersonale,
            totale_ammortamenti: totaleAmmortamenti,
            variazione_rimanenze: variazioneRimanenze,
            oneri_diversi: oneriDiversi,
            oneri_finanziari: ceMacro['83'] || 0,
            imposte: 0,
            utile_netto: t.risultato || 0,
            totale_costi_produzione: totaleCostiProduzione,
            differenza_ab: Math.round((ricaviVendite - totaleCostiProduzione) * 100) / 100,
          }

          setParsedFields(extracted)
          setFormData(prev => ({ ...prev, ...extracted }))
        } catch (parseErr) {
          console.error('PDF parsing failed:', parseErr)
        }
      }

      setShowImportForm(true)
      loadImports()
    } catch (error) {
      console.error('Error uploading file:', error)
      toast({ type: 'error', message: 'Errore nel caricamento del file' })
    } finally {
      setUploadingFile(false)
      setPdfParsing(false)
    }
  }

  // Feature 5: Validation
  const validateFormData = () => {
    const errors: Record<string, string> = {}
    let hasErrors = false

    CE_FIELDS.forEach(field => {
      const val = formData[field.key]
      if (field.required && (val === undefined || val === '' || val === null)) {
        errors[field.key] = 'Campo obbligatorio'
        hasErrors = true
      }
      if (val !== undefined && val !== '' && field.min !== undefined && Number(val) < field.min) {
        errors[field.key] = `Il valore non può essere inferiore a ${field.min}`
        hasErrors = true
      }
    })

    // Cross-field validations removed — bilancio values from PDF may include
    // sub-items not broken out in the form (e.g., "altri costi del personale")

    setFormErrors(errors)
    return !hasErrors
  }

  const handleSaveImportedData = async () => {
    if (!validateFormData()) return

    try {
      if (!COMPANY_ID) return
      const records = Object.entries(formData)
        .filter(([, value]) => value !== '' && value !== undefined && value !== null)
        .map(([key, value]) => ({
          company_id: COMPANY_ID,
          year: year,
          period_type: periodType,
          section: 'conto_economico',
          account_code: key,
          account_name: CE_FIELDS.find(f => f.key === key)?.label || key.replace(/_/g, ' '),
          amount: Number(value) || 0,
          sort_order: CE_FIELDS.findIndex(f => f.key === key),
        }))

      // Delete existing data for same year/period before inserting
      await supabase
        .from('balance_sheet_data')
        .delete()
        .eq('company_id', COMPANY_ID!)
        .eq('year', year)
        .eq('period_type', periodType)
        .eq('section', 'conto_economico')

      const { error } = await supabase
        .from('balance_sheet_data')
        .insert(records)

      if (error) throw error

      setShowImportForm(false)
      setFormErrors({})
      setParsedFields(null)
      setPdfPreview(null)
      loadPeriodData()
    } catch (error) {
      console.error('Error saving imported data:', error)
      toast({ type: 'error', message: 'Errore nel salvataggio dei dati' })
    }
  }

  // NEW: Save manually edited fields
  const handleSaveManualChanges = async () => {
    if (Object.keys(dirtyFields).length === 0) {
      setSaveMessage({ type: 'info', text: 'Nessuna modifica da salvare' })
      setTimeout(() => setSaveMessage(null), 3000)
      return
    }

    setSaving(true)
    try {
      // Build records for dirty fields only
      if (!COMPANY_ID) return
      const records = Object.entries(dirtyFields)
        .filter(([, isDirty]) => isDirty)
        .map(([key]) => {
          const field = CE_FIELDS.find(f => f.key === key)
          return {
            company_id: COMPANY_ID,
            year: year,
            period_type: periodType,
            section: 'conto_economico',
            account_code: key,
            account_name: field?.label || key.replace(/_/g, ' '),
            amount: Number(ce25[key]) || 0,
            sort_order: CE_FIELDS.findIndex(f => f.key === key),
          }
        })

      // Upsert each record (delete existing, then insert)
      for (const record of records) {
        await supabase
          .from('balance_sheet_data')
          .delete()
          .eq('company_id', COMPANY_ID!)
          .eq('year', year)
          .eq('period_type', periodType)
          .eq('section', 'conto_economico')
          .eq('account_code', record.account_code)

        const { error } = await supabase
          .from('balance_sheet_data')
          .insert(record)

        if (error) throw error
      }

      setSaveMessage({ type: 'success', text: `Salvate ${records.length} modifiche` })
      setDirtyFields({})
      loadPeriodData()

      setTimeout(() => setSaveMessage(null), 3000)
    } catch (error) {
      console.error('Error saving manual changes:', error)
      setSaveMessage({ type: 'error', text: 'Errore nel salvataggio: ' + ((error as Error)?.message || 'sconosciuto') })
      setTimeout(() => setSaveMessage(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  // Feature 7: Save full bilancio data (all accounts)
  const handleSaveBilancio = async () => {
    if (!bilancioData || !COMPANY_ID) return
    setBilancioSaving(true)
    try {
      const records = toSupabaseRecords(bilancioData, COMPANY_ID, year, periodType)

      // Delete existing data for this year/period (all sections)
      const sections = ['sp_attivita', 'sp_passivita', 'ce_costi', 'ce_ricavi', 'conto_economico']
      for (const section of sections) {
        await supabase
          .from('balance_sheet_data')
          .delete()
          .eq('company_id', COMPANY_ID!)
          .eq('year', year)
          .eq('period_type', periodType)
          .eq('section', section)
      }

      // Insert in batches of 100
      for (let i = 0; i < records.length; i += 100) {
        const batch = records.slice(i, i + 100)
        const { error } = await supabase.from('balance_sheet_data').insert(batch as never)
        if (error) throw error
      }

      setBilancioSaved(true)
      loadPeriodData()
      loadAvailableYears()
    } catch (error) {
      console.error('Error saving bilancio:', error)
      toast({ type: 'error', message: 'Errore nel salvataggio: ' + ((error as Error)?.message || 'sconosciuto') })
    } finally {
      setBilancioSaving(false)
    }
  }

  // Feature 2: Approval workflow
  const handleApproveImport = async (imp: { id: string }) => {
    try {
      await supabase
        .from('balance_sheet_imports')
        .update({
          status: 'approved',
          approved_by: profile?.id || null,
          approved_at: new Date().toISOString(),
        })
        .eq('id', imp.id)

      setShowApproveConfirm(null)
      loadImports()
    } catch (error) {
      console.error('Error approving:', error)
    }
  }

  const handleRejectImport = async (imp: { id: string }) => {
    try {
      await supabase
        .from('balance_sheet_imports')
        .update({ status: 'rejected' })
        .eq('id', imp.id)

      setShowApproveConfirm(null)
      loadImports()
    } catch (error) {
      console.error('Error rejecting:', error)
    }
  }

  type CeMap = Record<string, number>
  const buildCeFromData = (data: unknown): CeMap | null => {
    if (!data || !Array.isArray(data) || data.length === 0) return null
    const ce: CeMap = {}
    data.filter((r: { section?: string }) => r.section !== 'nota_integrativa').forEach((row: { account_code?: string; amount?: number }) => {
      if (row.account_code) ce[row.account_code] = Number(row.amount) || 0
    })
    return ce
  }

  // Load previous year for comparison
  const [prevYearData, setPrevYearData] = useState<CeMap | null>(null)
  useEffect(() => {
    const loadPrev = async () => {
      try {
        const { data } = await supabase
          .from('balance_sheet_data')
          .select('*')
          .eq('company_id', COMPANY_ID!)
          .eq('year', year - 1)
          .eq('period_type', periodType)
          .neq('section', 'nota_integrativa')
        const ce: CeMap = {}
        ;(data || []).forEach(row => { if (row.account_code) ce[row.account_code] = Number(row.amount) || 0 })
        setPrevYearData(ce)
      } catch (e) { console.error(e) }
    }
    loadPrev()
  }, [year, periodType])

  const ce25 = simulationMode && simData ? simData : buildCeFromData(periodData) || {}
  const cePrev = prevYearData || {}
  const ricavi25 = ce25.ricavi_vendite || 0
  const ricaviPrev = cePrev.ricavi_vendite || 0

  // ═══ DATA QUALITY CHECK ═══════════════════════════════════════════════
  // Confronta valori chiave tra le 2 fonti del Conto Economico:
  //  - balance_sheet_data (bilancio importato, alimenta vista Competenza)
  //  - budget_entries (business plan operativo, alimenta Budget e Controllo)
  // Se i totali divergono > 1 €, mostra un alert giallo strutturale. Utile
  // su tutti i tenant + clienti SaaS futuri: rileva import bilanci sporchi
  // o disallineamenti tra commercialista e gestionale operativo.
  type CoherenceWarning = { voce: string; bilancio: number; budget: number; diff: number }
  const coherenceWarnings = useMemo<CoherenceWarning[]>(() => {
    if (!budgetSummary || !ce25 || Object.keys(ce25).length === 0) return []
    const TOL = 1 // 1 euro di tolleranza per arrotondamenti
    const warnings: CoherenceWarning[] = []
    // Ricavi: bilancio "ricavi_vendite" vs SUM budget_entries con account_code che inizia per 5
    const rb = Number(ce25.ricavi_vendite || 0)
    const rbg = budgetSummary.ricaviCons || budgetSummary.ricaviPrev || 0
    if (rb > 0 && rbg > 0 && Math.abs(rb - rbg) > TOL) {
      warnings.push({ voce: 'Ricavi delle vendite', bilancio: rb, budget: rbg, diff: rb - rbg })
    }
    // Costi: bilancio "totale_costi_produzione" vs |SUM budget_entries non-ricavi|
    const cb = Number(ce25.totale_costi_produzione || 0)
    const cbg = Math.abs(budgetSummary.costiCons || budgetSummary.costiPrev || 0)
    if (cb > 0 && cbg > 0 && Math.abs(cb - cbg) > TOL) {
      warnings.push({ voce: 'Totale costi di produzione', bilancio: cb, budget: cbg, diff: cb - cbg })
    }
    return warnings
  }, [budgetSummary, ce25])

  // Compute KPIs
  const margineLordo25 = ricavi25 - (ce25.materie_prime || 0) + (ce25.variazione_rimanenze || 0)
  const margineLordoPct25 = ricavi25 > 0 ? margineLordo25 / ricavi25 * 100 : 0
  const ebit25 = ce25.differenza_ab || 0
  const ebitPct25 = ricavi25 > 0 ? ebit25 / ricavi25 * 100 : 0
  const personaleOnRicavi = ricavi25 > 0 ? (ce25.totale_personale || 0) / ricavi25 * 100 : 0
  const affitiOnRicavi = ricavi25 > 0 ? (ce25.godimento_beni_terzi || 0) / ricavi25 * 100 : 0

  // Feature 1: Analysis
  const analysis = useMemo(() => analyzeStrengthsWeaknesses(ce25, ricavi25), [ce25, ricavi25])

  const costiPieData = [
    { name: 'Merci e materie prime', value: ce25.materie_prime || 0 },
    { name: 'Personale', value: ce25.totale_personale || 0 },
    { name: 'Affitti e locazioni', value: ce25.godimento_beni_terzi || 0 },
    { name: 'Servizi', value: ce25.servizi || 0 },
    { name: 'Oneri finanziari', value: ce25.oneri_finanziari || 0 },
    { name: 'Oneri diversi', value: ce25.oneri_diversi || 0 },
  ].filter(d => d.value > 0)

  const handleSimulationChange = (field: string, value: number) => {
    setSimData({ ...(simData || ce25), [field]: value })
  }

  const periodi: ContoPeriod[] = ['annuale', 'trimestrale', 'mensile', 'provvisorio']

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header with Period/Year Selector */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Conto Economico & Bilancio</h1>
          <p className="text-sm text-slate-500 mt-1">
            {companyInfo?.denominazione || '—'}
            {companyInfo?.cf_piva && <> — CF/P.IVA {companyInfo.cf_piva}</>}
          </p>
          {companyInfo?.sede && (
            <p className="text-xs text-slate-400 mt-0.5">Sede: {companyInfo.sede}</p>
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-3 flex-wrap justify-end">
          <div className="flex gap-2">
            <select value={periodType} onChange={(e) => setPeriodType(e.target.value as ContoPeriod)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              {periodi.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {/* Competenza / Cassa / Riconciliazione — Fix 10.1: stile uniforme
              "blu attivo / grigio inattivo" (era 3 colori diversi: blue, emerald,
              purple, generando inconsistenza visiva tra le tab) */}
          <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('competenza')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                viewMode === 'competenza' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              Competenza
            </button>
            <button
              onClick={() => setViewMode('cassa')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1 ${
                viewMode === 'cassa' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              <Banknote size={13} /> Cassa
            </button>
            <button
              onClick={() => setViewMode('riconciliazione')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1 ${
                viewMode === 'riconciliazione' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              <Calculator size={13} /> Riconciliazione
            </button>
          </div>
          <button
            onClick={() => setShowYoY(!showYoY)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1 ${
              showYoY ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-slate-100 text-slate-700 border border-slate-300'
            }`}>
            <BarChart3 size={14} /> Confronto YoY
          </button>
          {/* Trend / Simulation Mode / Import PDF: feature non ancora
              funzionanti, disabilitate visivamente con badge 'Coming soon'
              finche' non vengono implementate. */}
          <button
            disabled
            title="Funzione in arrivo — grafici multi-anno di ricavi e costi"
            className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-50 text-slate-400 border border-slate-200 flex items-center gap-1 cursor-not-allowed opacity-60">
            <LineChartIcon size={14} /> Trend
            <span className="ml-1 text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">Coming soon</span>
          </button>
          <button
            disabled
            title="Funzione in arrivo — simulazione what-if su ricavi/costi"
            className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-50 text-slate-400 border border-slate-200 flex items-center gap-1 cursor-not-allowed opacity-60">
            Simulation Mode
            <span className="ml-1 text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">Coming soon</span>
          </button>
          <span
            title="Funzione in arrivo — import bilancio da PDF/Excel"
            className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-50 text-slate-400 border border-slate-200 flex items-center gap-1 cursor-not-allowed opacity-60">
            <FileUp size={14} /> Import PDF
            <span className="ml-1 text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">Coming soon</span>
          </span>
          {Object.keys(dirtyFields).some(k => dirtyFields[k]) && (
            <button onClick={handleSaveManualChanges} disabled={saving}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-amber-100 text-amber-700 border border-amber-300 flex items-center gap-1 hover:bg-amber-200 disabled:opacity-50">
              <Save size={14} /> {saving ? 'Salvataggio...' : 'Salva Modifiche'}
            </button>
          )}
        </div>
      </div>

      {/* Save feedback message */}
      {saveMessage && (
        <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
          saveMessage.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' :
          saveMessage.type === 'error' ? 'bg-red-50 border border-red-200 text-red-800' :
          'bg-blue-50 border border-blue-200 text-blue-800'
        }`}>
          {saveMessage.type === 'success' && <CheckCircle size={14} className="text-emerald-600" />}
          {saveMessage.type === 'error' && <AlertCircle size={14} className="text-red-600" />}
          {saveMessage.type === 'info' && <Clock size={14} className="text-blue-600" />}
          {saveMessage.text}
        </div>
      )}

      {/* Import Form with validation */}
      {showImportForm && (
        <div className="bg-white rounded-xl border border-blue-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Upload size={16} /> Inserimento dati — {periodType} {year}
              {parsedFields && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Sparkles size={12} /> {Object.keys(parsedFields).length} campi estratti dal PDF
                </span>
              )}
            </h3>
            <button onClick={() => { setShowImportForm(false); setParsedFields(null); setPdfPreview(null); setFormErrors({}) }}
              className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>

          {/* PDF preview + form side by side */}
          <div className={`grid gap-4 ${pdfPreview ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
            {pdfPreview && (
              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-[500px] overflow-y-auto">
                <Suspense fallback={<div className="p-4 text-center text-slate-500">Caricamento anteprima...</div>}>
                  <PdfViewer pdfData={pdfPreview} />
                </Suspense>
              </div>
            )}
            <div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {CE_FIELDS.map(field => (
                  <div key={field.key}>
                    <label className="text-xs text-slate-600 font-medium block mb-1">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                      {field.computed && <span className="text-blue-400 ml-1 text-[10px]">(calcolato)</span>}
                      {parsedFields?.[field.key] !== undefined && <span className="text-green-500 ml-1 text-[10px]">PDF</span>}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={fmtInput(formData[field.key])}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d.,-]/g, '')
                        const parsed = parseInputNumber(raw)
                        setFormData({ ...formData, [field.key]: parsed })
                        if (formErrors[field.key]) setFormErrors({ ...formErrors, [field.key]: null })
                      }}
                      className={`w-full px-2 py-1 border rounded text-sm text-right tabular-nums ${
                        formErrors[field.key] ? 'border-red-400 bg-red-50' :
                        parsedFields?.[field.key] !== undefined ? 'border-green-300 bg-green-50' :
                        'border-slate-300'
                      }`}
                      placeholder="0,00"
                    />
                    {formErrors[field.key] && (
                      <p className="text-[10px] text-red-600 mt-0.5 flex items-center gap-0.5">
                        <AlertCircle size={10} /> {formErrors[field.key]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={handleSaveImportedData}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 flex items-center gap-1">
                  <Save size={14} /> Salva dati
                </button>
                <button onClick={() => { setShowImportForm(false); setFormErrors({}); setParsedFields(null); setPdfPreview(null) }}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50">
                  Annulla
                </button>
                {parsedFields && (
                  <button onClick={() => { setFormData({}); setParsedFields(null) }}
                    className="px-4 py-2 rounded-lg text-sm font-medium border border-amber-300 text-amber-700 hover:bg-amber-50">
                    Cancella valori estratti
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={DollarSign} label="Ricavi" value={`${fmt(ricavi25)} €`} color="blue"
          sub={`${periodType} ${year}`} trend={variation(ricavi25, ricaviPrev)} />
        <Kpi icon={TrendingUp} label="Margine lordo" value={`${margineLordoPct25.toFixed(1)}%`} color="green"
          sub={`${fmt(margineLordo25)} €`} />
        <Kpi icon={Users} label="Costo personale" value={`${fmt(ce25.totale_personale || 0)} €`} color="amber"
          sub={`${personaleOnRicavi.toFixed(1)}% ricavi`} />
        <Kpi icon={Building2} label="Affitti" value={`${fmt(ce25.godimento_beni_terzi || 0)} €`} color="purple"
          sub={`${affitiOnRicavi.toFixed(1)}% ricavi`} />
        <Kpi icon={Banknote} label="Utile" value={`${fmt(ce25.utile_netto || 0)} €`} color="green"
          sub={ricavi25 > 0 ? `${((ce25.utile_netto || 0) / ricavi25 * 100).toFixed(1)}%` : '—'} />
        <Kpi icon={Calculator} label="EBIT" value={`${fmt(ebit25)} €`} color="indigo"
          sub={`${ebitPct25.toFixed(1)}% ricavi`} trend={variation(ebit25, cePrev.differenza_ab)} />
      </div>

      {/* ═══ CASSA VIEW — Cash-basis metrics from bank movements ═══ */}
      {viewMode === 'cassa' && (
        <div className="space-y-5">
          {cashLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-emerald-600" />
              <span className="ml-2 text-slate-600">Caricamento movimenti bancari...</span>
            </div>
          ) : !cashData || cashData.count === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <Banknote size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">Nessun dato bancario importato</p>
              <p className="text-xs text-slate-400 mt-1">Importa i movimenti bancari dalla sezione Banche per visualizzare la vista per cassa</p>
            </div>
          ) : (
            <>
              {/* Cash KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi icon={TrendingUp} label="Entrate (cassa)" value={`${fmt(cashData.totals.entrate)} €`} color="green"
                  sub={`${cashData.count} movimenti — ${year}`} />
                <Kpi icon={TrendingDown} label="Uscite (cassa)" value={`${fmt(cashData.totals.uscite)} €`} color="red"
                  sub={`Anno ${year}`} />
                <Kpi icon={Banknote} label="Netto (cassa)" value={`${fmt(cashData.totals.netto)} €`}
                  color={cashData.totals.netto >= 0 ? 'green' : 'red'}
                  sub="Entrate - Uscite" />
                <Kpi icon={Calculator} label="Movimenti" value={cashData.count}
                  color="blue" sub={cashData.hasCategorized ? 'Parzialmente categorizzati' : 'Non categorizzati'} />
              </div>

              {/* Monthly cash chart */}
              {cashData.monthly.length > 0 && (
                <Section title={`Flussi di cassa mensili — ${year}`} icon={BarChart3} badge={`${cashData.monthly.length} mesi`}>
                  <div className="p-5">
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={cashData.monthly} barGap={2}>
                        <CartesianGrid {...GRID_STYLE} />
                        <XAxis dataKey="meseLabel" {...AXIS_STYLE} />
                        <YAxis {...AXIS_STYLE} tickFormatter={v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                        <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
                        <Legend />
                        <Bar dataKey="entrate" name="Entrate" fill="#10b981" radius={[4,4,0,0]} />
                        <Bar dataKey="uscite" name="Uscite" fill="#ef4444" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>

                    {/* Monthly table */}
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wider">
                            <th className="py-2 px-3 text-left">Mese</th>
                            <th className="py-2 px-3 text-right">Entrate</th>
                            <th className="py-2 px-3 text-right">Uscite</th>
                            <th className="py-2 px-3 text-right">Netto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashData.monthly.map(m => (
                            <tr key={m.mese} className="border-b border-slate-50 hover:bg-slate-50">
                              <td className="py-1.5 px-3 text-slate-700 font-medium capitalize">{m.meseLabel}</td>
                              <td className="py-1.5 px-3 text-right tabular-nums text-emerald-600">{fmt(m.entrate)} €</td>
                              <td className="py-1.5 px-3 text-right tabular-nums text-red-600">{fmt(m.uscite)} €</td>
                              <td className={`py-1.5 px-3 text-right tabular-nums font-semibold ${m.netto >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                {fmt(m.netto)} €
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-slate-300 font-bold">
                            <td className="py-2 px-3 text-slate-900">Totale</td>
                            <td className="py-2 px-3 text-right tabular-nums text-emerald-700">{fmt(cashData.totals.entrate)} €</td>
                            <td className="py-2 px-3 text-right tabular-nums text-red-700">{fmt(cashData.totals.uscite)} €</td>
                            <td className={`py-2 px-3 text-right tabular-nums ${cashData.totals.netto >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                              {fmt(cashData.totals.netto)} €
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Section>
              )}

              {/* Breakdown by category */}
              {cashData.hasCategorized && cashData.byCategory.length > 0 ? (
                <Section title="Dettaglio per categoria (cassa)" icon={PieChart} badge={`${cashData.byCategory.length} categorie`}>
                  <div className="p-5">
                    <ResponsiveContainer width="100%" height={280}>
                      <RePie>
                        <Pie data={cashData.byCategory.map(c => ({ name: c.category_name || c.name || '', value: c.uscite }))} dataKey="value" nameKey="name"
                          cx="50%" cy="50%" innerRadius={55} outerRadius={105} paddingAngle={3} strokeWidth={0}
                          label={({ name, percent }: { name?: string; percent?: number }) => (percent ?? 0) > 0.03 ? `${(name || '').split(' ')[0]} ${((percent ?? 0) * 100).toFixed(0)}%` : ''}>
                          {cashData.byCategory.map((_: CashCat, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="white" strokeWidth={2} />)}
                        </Pie>
                        <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
                      </RePie>
                    </ResponsiveContainer>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wider">
                            <th className="py-2 px-3 text-left">Categoria</th>
                            <th className="py-2 px-3 text-right">Entrate</th>
                            <th className="py-2 px-3 text-right">Uscite</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashData.byCategory.map((c: CashCat, i: number) => (
                            <tr key={c.category_id} className="border-b border-slate-50">
                              <td className="py-1.5 px-3 flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                <span className="text-slate-700">{c.category_name || c.name}</span>
                              </td>
                              <td className="py-1.5 px-3 text-right tabular-nums text-emerald-600">{c.entrate > 0 ? `${fmt(c.entrate)} €` : '—'}</td>
                              <td className="py-1.5 px-3 text-right tabular-nums text-red-600">{c.uscite > 0 ? `${fmt(c.uscite)} €` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Section>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Categorizza i movimenti bancari per dettaglio</p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      I movimenti bancari non sono ancora categorizzati. Assegna le categorie di costo dalla sezione Banche per vedere il dettaglio per voce.
                    </p>
                  </div>
                </div>
              )}

              {/* Competenza vs Cassa comparison */}
              {ricavi25 > 0 && (
                <Section title="Confronto Competenza vs Cassa" icon={Calculator} defaultOpen={true}>
                  <div className="p-5">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wider">
                            <th className="py-2 px-3 text-left">Voce</th>
                            <th className="py-2 px-3 text-right">Competenza</th>
                            <th className="py-2 px-3 text-right">Cassa</th>
                            <th className="py-2 px-3 text-right">Varianza</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-slate-50">
                            <td className="py-1.5 px-3 text-slate-700 font-medium">Ricavi / Entrate</td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-blue-600">{fmt(ricavi25)} €</td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-emerald-600">{fmt(cashData.totals.entrate)} €</td>
                            <td className={`py-1.5 px-3 text-right tabular-nums font-medium ${(cashData.totals.entrate - ricavi25) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {fmt(cashData.totals.entrate - ricavi25)} €
                            </td>
                          </tr>
                          <tr className="border-b border-slate-50">
                            <td className="py-1.5 px-3 text-slate-700 font-medium">Costi / Uscite</td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-blue-600">{fmt(ce25.totale_costi_produzione || 0)} €</td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-red-600">{fmt(cashData.totals.uscite)} €</td>
                            <td className={`py-1.5 px-3 text-right tabular-nums font-medium ${(cashData.totals.uscite - (ce25.totale_costi_produzione || 0)) <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {fmt(cashData.totals.uscite - (ce25.totale_costi_produzione || 0))} €
                            </td>
                          </tr>
                          <tr className="border-t-2 border-slate-300 font-bold">
                            <td className="py-2 px-3 text-slate-900">Risultato / Netto</td>
                            <td className="py-2 px-3 text-right tabular-nums text-blue-700">{fmt(ce25.utile_netto || ebit25)} €</td>
                            <td className={`py-2 px-3 text-right tabular-nums ${cashData.totals.netto >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {fmt(cashData.totals.netto)} €
                            </td>
                            <td className={`py-2 px-3 text-right tabular-nums ${(cashData.totals.netto - (ce25.utile_netto || ebit25)) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {fmt(cashData.totals.netto - (ce25.utile_netto || ebit25))} €
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-slate-400 mt-3 text-center">
                      La varianza indica la differenza tra i flussi di cassa effettivi e i valori per competenza.
                      Differenze sono normali e dipendono da tempistiche di incasso/pagamento.
                    </p>
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ RICONCILIAZIONE BILANCIO ═══ */}
      {viewMode === 'riconciliazione' && (
        <div className="space-y-4">
          {riconLoading && (
            <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
              <Loader2 className="animate-spin text-purple-500" size={24} />
              <span className="ml-2 text-sm text-slate-500">Caricamento dati riconciliazione...</span>
            </div>
          )}

          {!riconLoading && !riconData && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
              <Calculator size={32} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm">Nessun dato budget disponibile per l'anno {year}.</p>
              <p className="text-xs text-slate-400 mt-1">Inserire i dati del Conto Economico per visualizzare la riconciliazione.</p>
            </div>
          )}

          {!riconLoading && riconData && (
            <>
              {/* Box 1: Risultato Gestionale */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                  <Store size={18} className="text-blue-500" />
                  <span className="text-sm font-semibold text-slate-900">Risultato Gestionale (per {labels.pointOfSaleLower})</span>
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-slate-600">Ricavi totali (tutti gli {labels.pointOfSalePluralLower})</span>
                    <span className="text-sm font-semibold text-emerald-600 tabular-nums">+ {fmt(riconData.ricavi)} €</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-slate-600">Costi totali (tutti gli {labels.pointOfSalePluralLower})</span>
                    <span className="text-sm font-semibold text-red-600 tabular-nums">- {fmt(Math.abs(riconData.costiOutlet))} €</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-slate-600">Spese non divise</span>
                    <span className="text-sm font-semibold text-red-600 tabular-nums">- {fmt(Math.abs(riconData.speseNonDivise))} €</span>
                  </div>
                  <div className="border-t border-slate-200 pt-3 flex justify-between items-center">
                    <span className="text-sm font-bold text-slate-900">RISULTATO GESTIONALE</span>
                    <span className={`text-lg font-bold tabular-nums ${riconData.risultatoGestionale >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {riconData.risultatoGestionale >= 0 ? '+' : ''}{fmt(riconData.risultatoGestionale)} €
                    </span>
                  </div>
                </div>
              </div>

              {/* Freccia */}
              <div className="flex justify-center">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                  <ArrowDownRight size={16} className="text-purple-600 rotate-45" />
                </div>
              </div>

              {/* Box 2: Rettifiche di Riconciliazione */}
              <div className="bg-white rounded-xl border-2 border-purple-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-purple-100 bg-purple-50 flex items-center gap-2">
                  <Calculator size={18} className="text-purple-600" />
                  <span className="text-sm font-semibold text-purple-900">Rettifiche di Riconciliazione</span>
                </div>
                <div className="p-5 space-y-3">
                  {riconData.rettifiche.length > 0 ? (
                    <>
                      {riconData.rettifiche.map((r, i) => (
                        <div key={i} className="flex justify-between items-start py-2 px-3 bg-purple-50 rounded-lg">
                          <div>
                            <span className="text-sm font-medium text-purple-900">{r.code} — {r.name}</span>
                            {r.code === 'B11_RIM' && (
                              <p className="text-xs text-purple-600 mt-0.5">
                                Merci acquistate ma non vendute, rimaste in magazzino
                              </p>
                            )}
                          </div>
                          <span className="text-sm font-bold text-emerald-600 tabular-nums whitespace-nowrap ml-4">
                            + {fmt(Math.abs(r.total))} €
                          </span>
                        </div>
                      ))}
                      <div className="border-t border-purple-200 pt-3 flex justify-between items-center">
                        <span className="text-sm font-bold text-purple-900">TOTALE RETTIFICHE</span>
                        <span className="text-lg font-bold text-emerald-600 tabular-nums">
                          + {fmt(Math.abs(riconData.rettificheTotale))} €
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4 text-sm text-slate-400">
                      Nessuna rettifica di riconciliazione presente per {year}.
                    </div>
                  )}
                  <p className="text-[11px] text-purple-400 italic">
                    In futuro qui possono essere aggiunte altre rettifiche di riconciliazione
                  </p>
                </div>
              </div>

              {/* Freccia */}
              <div className="flex justify-center">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                  <ArrowDownRight size={16} className="text-purple-600 rotate-45" />
                </div>
              </div>

              {/* Box 3: Risultato Bilancio Civilistico */}
              <div className="bg-white rounded-xl border-2 border-emerald-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-emerald-100 bg-emerald-50 flex items-center gap-2">
                  <FileText size={18} className="text-emerald-600" />
                  <span className="text-sm font-semibold text-emerald-900">Risultato Bilancio Civilistico</span>
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-slate-600">Risultato gestionale</span>
                    <span className={`text-sm font-semibold tabular-nums ${riconData.risultatoGestionale >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {riconData.risultatoGestionale >= 0 ? '+' : ''}{fmt(riconData.risultatoGestionale)} €
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-slate-600">+ Rettifiche riconciliazione</span>
                    <span className="text-sm font-semibold text-emerald-600 tabular-nums">
                      + {fmt(Math.abs(riconData.rettificheTotale))} €
                    </span>
                  </div>
                  <div className="border-t border-slate-200 pt-3 flex justify-between items-center">
                    <span className="text-sm font-bold text-slate-900">EBIT (Risultato Operativo)</span>
                    <span className={`text-base font-bold tabular-nums ${riconData.risultatoConRettifica >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {riconData.risultatoConRettifica >= 0 ? '+' : ''}{fmt(riconData.risultatoConRettifica)} €
                    </span>
                  </div>

                  {riconData.bilancioUfficiale.available && (
                    <>
                      {riconData.deltaClassificazione != null && Math.abs(riconData.deltaClassificazione) > 1 && (
                        <div className="flex justify-between items-center py-2 px-3 bg-amber-50 rounded-lg">
                          <div>
                            <span className="text-xs font-medium text-amber-800">Delta di classificazione</span>
                            <p className="text-[10px] text-amber-600">Differenza fisiologica tra allocazione gestionale e civilistica</p>
                          </div>
                          <span className="text-xs font-semibold text-amber-700 tabular-nums">
                            {riconData.deltaClassificazione >= 0 ? '+' : ''}{fmt(riconData.deltaClassificazione)} €
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center py-2 text-slate-500">
                        <span className="text-sm">EBIT bilancio ufficiale</span>
                        <span className="text-sm font-semibold tabular-nums">+ {fmt(riconData.bilancioUfficiale.ebit)} €</span>
                      </div>
                      <div className="flex justify-between items-center py-2 text-slate-500">
                        <span className="text-sm">+ Proventi finanziari</span>
                        <span className="text-sm tabular-nums">+ {fmt(riconData.bilancioUfficiale.proventiFinanziari)} €</span>
                      </div>
                      <div className="flex justify-between items-center py-2 text-slate-500">
                        <span className="text-sm">- Oneri finanziari</span>
                        <span className="text-sm text-red-600 tabular-nums">{fmt(riconData.bilancioUfficiale.oneriFinanziari)} €</span>
                      </div>
                      <div className="border-t-2 border-emerald-300 pt-4 flex justify-between items-center">
                        <span className="text-base font-bold text-emerald-900">UTILE NETTO</span>
                        <span className={`text-xl font-bold tabular-nums ${(riconData.bilancioUfficiale.utileNetto ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {(riconData.bilancioUfficiale.utileNetto ?? 0) >= 0 ? '+' : ''}{fmt(riconData.bilancioUfficiale.utileNetto)} €
                        </span>
                      </div>
                    </>
                  )}

                  {!riconData.bilancioUfficiale.available && (
                    <div className="py-3 px-3 bg-slate-50 rounded-lg text-center">
                      <p className="text-xs text-slate-400">Bilancio civilistico ufficiale non ancora disponibile per {year}.</p>
                      <p className="text-[10px] text-slate-300 mt-1">L'EBIT calcolato sopra è la somma gestionale + rettifiche.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer note */}
              <div className="text-center text-xs text-slate-400 py-2">
                Dati dal bilancio ufficiale {companyInfo?.denominazione || ''} {year}
                {riconData.rettifiche.some(r => r.code === 'B11_RIM') && ' — Variazione rimanenze: voce B.11 CE civilistico'}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ INDICI DI BILANCIO — right after KPIs ═══ */}
      {viewMode === 'competenza' && (
      <Section title="Indici di bilancio" icon={ShieldCheck}>
        <div className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              {
                label: 'Margine lordo %',
                value: `${margineLordoPct25.toFixed(1)}%`,
                status: margineLordoPct25 > 30 ? 'green' : 'amber',
                formula: `(Ricavi − Materie prime + Var. rimanenze) / Ricavi × 100`,
                detail: `(${fmt(ricavi25)} − ${fmt(ce25.materie_prime || 0)} + ${fmt(ce25.variazione_rimanenze || 0)}) / ${fmt(ricavi25)} = ${margineLordoPct25.toFixed(1)}%`,
                benchmark: 'Retail moda: >45% buono, >55% eccellente',
              },
              {
                label: 'Incidenza personale',
                value: `${personaleOnRicavi.toFixed(1)}%`,
                status: personaleOnRicavi < 30 ? 'green' : 'amber',
                formula: `Totale personale / Ricavi × 100`,
                detail: `${fmt(ce25.totale_personale || 0)} / ${fmt(ricavi25)} = ${personaleOnRicavi.toFixed(1)}%`,
                benchmark: 'Retail: <20% ottimo, 20-30% normale, >30% critico',
              },
              {
                label: 'Incidenza affitti',
                value: `${affitiOnRicavi.toFixed(1)}%`,
                status: affitiOnRicavi < 18 ? 'green' : 'amber',
                formula: `Godimento beni terzi / Ricavi × 100`,
                detail: `${fmt(ce25.godimento_beni_terzi || 0)} / ${fmt(ricavi25)} = ${affitiOnRicavi.toFixed(1)}%`,
                benchmark: 'Retail: <12% ottimo, 12-18% normale, >18% critico',
              },
              {
                label: 'EBIT %',
                value: `${ebitPct25.toFixed(2)}%`,
                status: ebitPct25 > 3 ? 'green' : 'red',
                formula: `Differenza A-B / Ricavi × 100`,
                detail: `${fmt(ebit25)} / ${fmt(ricavi25)} = ${ebitPct25.toFixed(2)}%`,
                benchmark: '>8% eccellente, 3-8% buono, <3% critico',
              },
              { label: 'Periodo', value: `${periodType} ${year}`, status: 'blue', formula: '', detail: '', benchmark: '' },
              { label: 'Stato', value: simulationMode ? 'Simulazione' : 'Dati reali', status: simulationMode ? 'purple' : 'green', formula: '', detail: '', benchmark: '' },
            ].map(r => (
              <IndiceCard key={r.label} {...r} />
            ))}
          </div>
        </div>
      </Section>
      )}

      {/* ═══ DATA QUALITY ALERT — Incoerenza tra bilancio importato e budget operativo ═══
          Strutturale e multi-tenant: rileva discrepanze > 1 € tra le 2 fonti del CE.
          Compare solo se ci sono warnings reali (su tenant vergini Made/Zago, sempre vuoto). */}
      {viewMode === 'competenza' && coherenceWarnings.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="bg-amber-100 rounded-full p-2 shrink-0">
              <AlertTriangle size={20} className="text-amber-700" />
            </div>
            <div className="flex-1">
              <div className="font-bold text-amber-900">Attenzione: incoerenza tra bilancio importato e business plan operativo</div>
              <p className="text-sm text-amber-800 mt-1">
                Alcuni totali del bilancio civilistico importato non coincidono con la somma
                delle righe di Budget e Controllo. Verifica con il commercialista quale fonte è
                autoritativa per l'anno {year}.
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                {coherenceWarnings.map((w) => (
                  <li key={w.voce} className="bg-white rounded-md p-2 border border-amber-200">
                    <strong className="text-amber-900">{w.voce}:</strong>
                    <span className="ml-2 text-slate-700">
                      bilancio importato <strong>{w.bilancio.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</strong>
                      {' '} vs business plan <strong>{w.budget.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</strong>
                      {' '} <span className="text-amber-700">(differenza {w.diff >= 0 ? '+' : ''}{w.diff.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €)</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-700 mt-2">
                <strong>Suggerimento:</strong> i valori in <strong>Budget e Controllo</strong> sono i dati operativi inseriti per outlet.
                Quelli del <strong>bilancio importato</strong> arrivano dall'import del CE civilistico (CCIAA o commercialista).
                Allineare le due fonti spesso significa reimportare un bilancio corretto.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ═══ STEP B2: Confronto con Budget e Controllo ═══
          Mostra preventivo / consuntivo / scostamento aggregati per ricavi
          e costi, leggendo direttamente da budget_entries (popolato da
          RPC refresh_budget_consuntivo). Pensato per Massimo/Denise (CEO)
          per vedere a colpo d'occhio quanto stiamo performando vs budget.
          Replicato sui 3 tenant: non dipende da account_code specifici
          di NZ, usa solo convenzione "5xxxxx = ricavi" del piano dei conti italiano. */}
      {viewMode === 'competenza' && budgetSummary && (
        <Section title="Confronto con Budget e Controllo" icon={Target}
          badge={budgetSummary.rowsBudgetCompiled === 0
            ? 'Preventivo non compilato'
            : `${budgetSummary.rowsBudgetCompiled} righe preventivo`}>
          <div className="p-5 space-y-4">
            {/* Banner stato preventivo + bottone refresh */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                {budgetSummary.rowsBudgetCompiled === 0 ? (
                  <span className="text-amber-700">
                    <AlertTriangle size={14} className="inline mr-1" />
                    Nessuna riga del preventivo {year} è stata ancora compilata.
                    Vai su <strong>Budget e Controllo</strong> per popolare il business plan.
                  </span>
                ) : (
                  <>
                    Aggregato da <strong>{budgetSummary.rowsTotal}</strong> righe budget_entries · Consuntivo ultimo refresh: <strong>{fmtRelTime(budgetSummary.lastRefresh)}</strong>
                    {budgetSummary.anyStale && (
                      <span className="ml-2 text-amber-700">(alcune righe da rinfrescare)</span>
                    )}
                  </>
                )}
              </div>
              {!hasRole('ceo') && (
                <button
                  onClick={handleRefreshBudget}
                  disabled={budgetRefreshing}
                  className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 border transition shrink-0 ${
                    budgetSummary.anyStale
                      ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  } ${budgetRefreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title="Aggrega il consuntivo da fatture passive, ricavi POS e fatture attive"
                >
                  <RefreshCw size={14} className={budgetRefreshing ? 'animate-spin' : ''} />
                  {budgetRefreshing ? 'Aggiornamento…' : 'Aggiorna consuntivo'}
                </button>
              )}
            </div>

            {/* Tabella confronto */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-700">Voce</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-700">Preventivo</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-700">Consuntivo</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-700">Scostamento €</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-700">Scostamento %</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows = [
                      { label: 'Ricavi', prev: budgetSummary.ricaviPrev, cons: budgetSummary.ricaviCons, positive: true },
                      { label: 'Costi', prev: budgetSummary.costiPrev, cons: budgetSummary.costiCons, positive: false },
                      {
                        label: 'Risultato gestionale (Ricavi − Costi)',
                        prev: budgetSummary.ricaviPrev - Math.abs(budgetSummary.costiPrev),
                        cons: budgetSummary.ricaviCons - Math.abs(budgetSummary.costiCons),
                        positive: true, total: true,
                      },
                    ]
                    return rows.map((r) => {
                      const delta = r.cons - r.prev
                      const deltaPct = r.prev !== 0 ? (delta / Math.abs(r.prev)) * 100 : 0
                      // Per ricavi/utile: scostamento positivo è buono. Per costi: negativo è buono (meno costi).
                      const isGood = r.positive ? delta >= 0 : delta <= 0
                      const deltaColor = delta === 0 ? 'text-slate-500' : isGood ? 'text-emerald-700' : 'text-red-700'
                      return (
                        <tr key={r.label} className={`border-t border-slate-100 ${r.total ? 'bg-slate-50 font-semibold' : ''}`}>
                          <td className="px-4 py-2 text-slate-800">{r.label}</td>
                          <td className="px-4 py-2 text-right text-slate-700">
                            {r.prev.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                          </td>
                          <td className="px-4 py-2 text-right text-slate-700">
                            {r.cons.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                          </td>
                          <td className={`px-4 py-2 text-right ${deltaColor}`}>
                            {delta >= 0 ? '+' : ''}{delta.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
                          </td>
                          <td className={`px-4 py-2 text-right ${deltaColor}`}>
                            {r.prev === 0 ? '—' : `${delta >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`}
                          </td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-slate-500">
              <Info size={12} className="inline mr-1" />
              I dati provengono da <strong>budget_entries</strong> (popolati in Budget e Controllo).
              Il preventivo è il business plan annuo per outlet; il consuntivo è aggregato in tempo reale
              da fatture, ricavi POS e fatture attive via RPC <code>refresh_budget_consuntivo</code>.
            </div>
          </div>
        </Section>
      )}

      {/* ═══ YoY COMPARISON TABLE — Confronto Anno su Anno ═══ */}
      {viewMode === 'competenza' && showYoY && !loading && (
        <Section title={`Confronto Anno su Anno — ${year} vs ${year - 1}`} icon={BarChart3} defaultOpen={true}
          badge={prevBilancioData ? `${year - 1} disponibile` : `Nessun dato ${year - 1}`}>
          <div className="p-5">
            {/* CE Summary YoY Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 text-xs text-slate-500 uppercase tracking-wider">
                    <th className="py-2 px-4 text-left">Voce</th>
                    <th className="py-2 px-3 text-right">{year}</th>
                    <th className="py-2 px-3 text-right text-slate-400">% Ricavi</th>
                    <th className="py-2 px-3 text-right">{year - 1}</th>
                    <th className="py-2 px-3 text-right text-slate-400">% Ricavi</th>
                    <th className="py-2 px-3 text-right">{'\u0394'} %</th>
                  </tr>
                </thead>
                <tbody>
                  {CE_FIELDS.filter(f => !f.computed || ['totale_personale', 'totale_costi_produzione', 'differenza_ab', 'utile_netto'].includes(f.key)).map(field => {
                    const curr = ce25[field.key]
                    const prev = cePrev[field.key]
                    const delta = variation(curr, prev)
                    const isBold = field.computed
                    const isSummaryRow = ['differenza_ab', 'utile_netto'].includes(field.key)
                    const isCostLine = !['ricavi_vendite', 'altri_ricavi', 'differenza_ab', 'utile_netto', 'variazione_rimanenze'].includes(field.key)

                    // For costs: negative delta is good (costs went down). For revenues/profit: positive delta is good
                    const isPositiveImprovement = isCostLine
                      ? (delta != null && delta < 0)
                      : (delta != null && delta > 0)

                    if (curr == null && prev == null) return null

                    return (
                      <tr key={field.key}
                        className={`${isBold ? 'font-semibold' : ''} ${isSummaryRow ? 'border-t-2 border-slate-300 bg-slate-50' : 'border-b border-slate-50'}`}>
                        <td className={`py-1.5 px-4 text-sm ${isBold ? 'text-slate-900' : 'text-slate-700'} ${!isBold && !isSummaryRow ? 'pl-8' : ''}`}>
                          {field.label}
                        </td>
                        <td className="py-1.5 px-3 text-sm text-right tabular-nums text-slate-800 font-medium">
                          {curr != null ? `${fmt(curr)} \u20AC` : '\u2014'}
                        </td>
                        <td className="py-1.5 px-3 text-[11px] text-right text-slate-400 tabular-nums">
                          {ricavi25 && curr != null ? pct(curr, ricavi25) : ''}
                        </td>
                        <td className="py-1.5 px-3 text-sm text-right tabular-nums text-slate-500">
                          {prev != null ? `${fmt(prev)} \u20AC` : '\u2014'}
                        </td>
                        <td className="py-1.5 px-3 text-[11px] text-right text-slate-400 tabular-nums">
                          {ricaviPrev && prev != null ? pct(prev, ricaviPrev) : ''}
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          {delta != null ? (
                            <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
                              isPositiveImprovement
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                            </span>
                          ) : '\u2014'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full bg-emerald-100 border border-emerald-300" />
                Miglioramento (ricavi su / costi giu)
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full bg-red-100 border border-red-300" />
                Peggioramento (ricavi giu / costi su)
              </span>
            </div>

            {!prevBilancioData && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700">
                  Nessun dato disponibile per {year - 1}. Importa il bilancio dell'anno precedente per un confronto completo.
                </p>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ═══ BILANCIO TREE VIEW — after Indici ═══ */}
      {viewMode === 'competenza' && showBilancioTree && bilancioData && (
        <Section title="Bilancio — Dettaglio completo" icon={FileText} defaultOpen={true}
          badge={`${(bilancioData.contoEconomico?.costi?.length || 0) + (bilancioData.contoEconomico?.ricavi?.length || 0) + (bilancioData.patrimoniale?.attivita?.length || 0) + (bilancioData.patrimoniale?.passivita?.length || 0)} voci`}>
          <div className="p-5 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">
                  {bilancioData.meta?.company || 'Azienda'} — {bilancioData.meta?.period || 'Periodo'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  SP: {bilancioData.patrimoniale?.attivita?.length || 0} voci attività, {bilancioData.patrimoniale?.passivita?.length || 0} voci passività |
                  CE: {bilancioData.contoEconomico?.costi?.length || 0} voci costi, {bilancioData.contoEconomico?.ricavi?.length || 0} voci ricavi
                </p>
              </div>
              <button onClick={handleSaveBilancio} disabled={bilancioSaving || bilancioSaved}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                  bilancioSaved ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' :
                  'bg-blue-600 text-white hover:bg-blue-700'
                }`}>
                {bilancioSaving ? <><Loader2 size={14} className="animate-spin" /> Salvataggio...</> :
                 bilancioSaved ? <><CheckCircle size={14} /> Salvato in Supabase</> :
                 <><Save size={14} /> Salva bilancio completo</>}
              </button>
            </div>

            {/* Stato Patrimoniale */}
            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                <Building2 size={16} className="text-indigo-500" /> Stato Patrimoniale
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Attività</div>
                  <BilancioTree rows={bilancioData.patrimoniale?.attivitaTree || []} prevByCode={showYoY ? prevBilancioData?.byCode : null} showYoY={showYoY} isCost={false} currentYear={year} />
                  {bilancioData.patrimoniale?.totals?.attivita != null && (
                    <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                      <span className="text-sm font-bold text-slate-900">TOTALE</span>
                      <span className="text-sm font-bold text-slate-900">{fmt(bilancioData.patrimoniale.totals.attivita)} €</span>
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Passività</div>
                  <BilancioTree rows={bilancioData.patrimoniale?.passivitaTree || []} prevByCode={showYoY ? prevBilancioData?.byCode : null} showYoY={showYoY} isCost={false} currentYear={year} />
                  {bilancioData.patrimoniale?.totals?.passivita != null && (
                    <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                      <span className="text-sm font-bold text-slate-900">TOTALE</span>
                      <span className="text-sm font-bold text-slate-900">{fmt(bilancioData.patrimoniale.totals.passivita)} €</span>
                    </div>
                  )}
                </div>
              </div>
              {bilancioData.patrimoniale?.totals?.risultato != null && (
                <div className={`mt-3 p-3 rounded-lg text-center font-bold text-sm ${
                  bilancioData.patrimoniale.totals.risultato >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}>
                  {bilancioData.patrimoniale.totals.risultato >= 0 ? 'Utile' : 'Perdita'}: {fmt(Math.abs(bilancioData.patrimoniale.totals.risultato))} €
                </div>
              )}
            </div>

            {/* Conto Economico dettagliato */}
            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                <BarChart3 size={16} className="text-blue-500" /> Conto Economico
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">Componenti Negative</div>
                  <BilancioTree rows={bilancioData.contoEconomico?.costiTree || []} prevByCode={showYoY ? prevBilancioData?.byCode : null} showYoY={showYoY} isCost={true} currentYear={year} />
                  {bilancioData.contoEconomico?.totals?.costi != null && (
                    <div className="mt-2 pt-2 border-t-2 border-slate-300 flex items-center justify-between px-2">
                      <span className="text-sm font-bold text-slate-900">TOTALE COSTI</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-red-600">{fmt(bilancioData.contoEconomico.totals.costi)} €</span>
                        {showYoY && prevBilancioData?.contoEconomico?.totals?.costi != null && (() => {
                          const d = variation(bilancioData.contoEconomico.totals.costi, prevBilancioData.contoEconomico.totals.costi)
                          return d != null ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${d <= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {d >= 0 ? '+' : ''}{d.toFixed(1)}% vs {year - 1}
                            </span>
                          ) : null
                        })()}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-2">Componenti Positive</div>
                  <BilancioTree rows={bilancioData.contoEconomico?.ricaviTree || []} prevByCode={showYoY ? prevBilancioData?.byCode : null} showYoY={showYoY} isCost={false} currentYear={year} />
                  {bilancioData.contoEconomico?.totals?.ricavi != null && (
                    <div className="mt-2 pt-2 border-t-2 border-slate-300 flex items-center justify-between px-2">
                      <span className="text-sm font-bold text-slate-900">TOTALE RICAVI</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-emerald-600">{fmt(bilancioData.contoEconomico.totals.ricavi)} €</span>
                        {showYoY && prevBilancioData?.contoEconomico?.totals?.ricavi != null && (() => {
                          const d = variation(bilancioData.contoEconomico.totals.ricavi, prevBilancioData.contoEconomico.totals.ricavi)
                          return d != null ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${d >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {d >= 0 ? '+' : ''}{d.toFixed(1)}% vs {year - 1}
                            </span>
                          ) : null
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {bilancioData.contoEconomico?.totals?.risultato != null && (
                <div className={`mt-3 p-3 rounded-lg font-bold text-sm flex items-center justify-center gap-3 ${
                  bilancioData.contoEconomico.totals.risultato >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}>
                  <span>{bilancioData.contoEconomico.totals.risultato >= 0 ? 'Utile' : 'Perdita'}: {fmt(Math.abs(bilancioData.contoEconomico.totals.risultato))} €</span>
                  {showYoY && prevBilancioData?.contoEconomico?.totals?.risultato != null && (() => {
                    const d = variation(bilancioData.contoEconomico.totals.risultato, prevBilancioData.contoEconomico.totals.risultato)
                    return (
                      <span className="text-xs font-normal">
                        (Anno prec.: {fmt(Math.abs(prevBilancioData.contoEconomico.totals.risultato))} €
                        {d != null && (
                          <span className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${d >= 0 ? 'bg-emerald-200 text-emerald-800' : 'bg-red-200 text-red-800'}`}>
                            {d >= 0 ? '+' : ''}{d.toFixed(1)}%
                          </span>
                        )}
                        )
                      </span>
                    )
                  })()}
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      {/* Feature 6: Trend multi-anno */}
      {viewMode === 'competenza' && showTrend && trendData.length > 0 && (
        <Section title={`Trend multi-anno — ${periodType}`} icon={LineChartIcon} badge={`${trendData.length} anni`}>
          <div className="p-5">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={trendData}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="anno" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
                <Legend />
                <Line type="monotone" dataKey="ricavi" name="Ricavi" stroke={TREND_COLORS.ricavi} strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="ebitda" name="EBITDA" stroke={TREND_COLORS.ebitda} strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="personale" name="Personale" stroke={TREND_COLORS.personale} strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="utile" name="Utile" stroke={TREND_COLORS.utile} strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
            {trendData.length < 2 && (
              <p className="text-xs text-slate-400 text-center mt-2">Inserire dati per più anni per vedere il trend completo</p>
            )}
          </div>
        </Section>
      )}
      {viewMode === 'competenza' && showTrend && trendData.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">
          <LineChartIcon size={24} className="mx-auto mb-2 text-slate-300" />
          Nessun dato disponibile per il trend multi-anno. Inserire i dati del Conto Economico per più anni.
        </div>
      )}

      {/* CE comparison table removed — tree view provides full detail */}

      {/* Feature 1: Analisi punti di forza/debolezza */}
      {viewMode === 'competenza' && !loading && ricavi25 > 0 && (
        <Section title="Analisi e raccomandazioni" icon={Lightbulb} defaultOpen={true}>
          <div className="p-5 space-y-4">
            {/* Strengths */}
            {analysis.strengths.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5 mb-2">
                  <ThumbsUp size={15} /> Punti di forza
                </h4>
                <div className="space-y-2">
                  {analysis.strengths.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 bg-emerald-50 rounded-lg border border-emerald-100">
                      <CheckCircle size={15} className="text-emerald-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm text-emerald-800 font-medium">{s.text}</p>
                        <p className="text-xs text-emerald-600">{s.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Weaknesses */}
            {analysis.weaknesses.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-red-700 flex items-center gap-1.5 mb-2">
                  <ThumbsDown size={15} /> Punti di debolezza
                </h4>
                <div className="space-y-2">
                  {analysis.weaknesses.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 bg-red-50 rounded-lg border border-red-100">
                      <AlertTriangle size={15} className="text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm text-red-800 font-medium">{w.text}</p>
                        <p className="text-xs text-red-600">{w.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {analysis.recommendations.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-blue-700 flex items-center gap-1.5 mb-2">
                  <Lightbulb size={15} /> Raccomandazioni
                </h4>
                <div className="space-y-1.5">
                  {analysis.recommendations.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 bg-blue-50 rounded-lg border border-blue-100">
                      <Sparkles size={14} className="text-blue-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-blue-800">{r}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Charts + Imports */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cost composition pie */}
        {costiPieData.length > 0 && (
          <Section title="Composizione costi" icon={PieChart}>
            <div className="p-5">
              <ResponsiveContainer width="100%" height={280}>
                <RePie>
                  <Pie data={costiPieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={55} outerRadius={105} paddingAngle={3} strokeWidth={0}
                    label={({ name, percent }: { name?: string; percent?: number }) => (percent ?? 0) > 0.03 ? `${(name || '').split(' ')[0]} ${((percent ?? 0) * 100).toFixed(0)}%` : ''}>
                    {costiPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="white" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
                </RePie>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-1.5 mt-3">
                {costiPieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-slate-600 truncate">{d.name}: <strong>{fmt(d.value)} €</strong></span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* Feature 2: Imported files with approval workflow */}
        <Section title="Bilanci importati" icon={FileUp} badge={imports.filter(i => i.status === 'uploaded').length > 0 ? `${imports.filter(i => i.status === 'uploaded').length} da approvare` : null}>
          <div className="p-5">
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {imports.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">Nessun bilancio importato</p>
              ) : (
                imports.map(imp => (
                  <div key={imp.id} className={`flex items-center justify-between p-3 rounded-lg border ${
                    imp.status === 'approved' ? 'bg-emerald-50 border-emerald-200' :
                    imp.status === 'rejected' ? 'bg-red-50 border-red-200' :
                    'bg-slate-50 border-slate-200'
                  }`}>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{imp.file_name}</p>
                      <p className="text-xs text-slate-500">
                        {imp.period_label} • {imp.status === 'approved' ? 'Approvato' : imp.status === 'rejected' ? 'Rifiutato' : 'In attesa'}
                        {imp.approved_at && ` • ${new Date(imp.approved_at).toLocaleDateString('it-IT')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {imp.status === 'approved' && <CheckCircle size={16} className="text-green-600" />}
                      {imp.status === 'rejected' && <X size={16} className="text-red-600" />}
                      {imp.status === 'uploaded' && (
                        <>
                          <button onClick={() => setShowApproveConfirm(imp)}
                            className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 flex items-center gap-1">
                            <CheckCircle size={12} /> Approva
                          </button>
                          <button onClick={() => handleRejectImport(imp)}
                            className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 flex items-center gap-1">
                            <X size={12} /> Rifiuta
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Section>
      </div>

      {/* Feature 3: Nota Integrativa */}
      <Section title={`Nota Integrativa — ${periodType} ${year}`} icon={FileText} defaultOpen={false}>
        <div className="p-5">
          <p className="text-xs text-slate-500 mb-3">
            Annotazioni, commenti e note integrative al bilancio. Questo campo è libero e viene salvato per periodo/anno.
          </p>
          <textarea
            value={notaIntegrativa}
            onChange={(e) => setNotaIntegrativa(e.target.value)}
            className="w-full h-48 p-3 border border-slate-300 rounded-lg text-sm resize-y focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            placeholder="Inserire la nota integrativa, commenti sul bilancio, criteri di valutazione, fatti di rilievo..."
          />
          <div className="flex items-center gap-3 mt-3">
            <button onClick={handleSaveNota} disabled={notaSaving}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
              <Save size={14} /> {notaSaving ? 'Salvataggio...' : 'Salva nota'}
            </button>
            <span className="text-xs text-slate-400">
              {notaIntegrativa.length > 0 ? `${notaIntegrativa.length} caratteri` : 'Nessuna nota inserita'}
            </span>
          </div>
        </div>
      </Section>

      {/* Approval confirmation modal */}
      {showApproveConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowApproveConfirm(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Conferma approvazione</h3>
            <p className="text-sm text-slate-600 mb-1">
              Stai per approvare il bilancio:
            </p>
            <p className="text-sm font-medium text-slate-900 mb-3">
              {showApproveConfirm.file_name} — {showApproveConfirm.period_label}
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={14} />
                Una volta approvato, il bilancio sarà considerato definitivo. Verificare che i dati siano corretti.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowApproveConfirm(null)}
                className="px-4 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-50">
                Annulla
              </button>
              <button onClick={() => handleApproveImport(showApproveConfirm)}
                className="px-4 py-2 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700 font-medium flex items-center gap-1">
                <CheckCircle size={14} /> Approva bilancio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-slate-600">Caricamento dati...</span>
        </div>
      )}
      <PageHelp page="conto-economico" />
    </div>
  )
}

// ═══ INDICE CARD WITH TOOLTIP ═══
type IndiceStatus = 'green' | 'amber' | 'red' | 'blue' | 'purple'
function IndiceCard({ label, value, status, formula, detail, benchmark }: { label: string; value: string; status: string; formula?: string; detail?: string; benchmark?: string }) {
  const [showTip, setShowTip] = useState(false)
  const colors: Record<IndiceStatus, string> = {
    green: 'bg-emerald-50/50 border-emerald-200',
    amber: 'bg-amber-50/50 border-amber-200',
    red: 'bg-red-50/50 border-red-200',
    blue: 'bg-blue-50/50 border-blue-200',
    purple: 'bg-purple-50/50 border-purple-200',
  }
  return (
    <div className={`rounded-lg p-3 border relative ${colors[status as IndiceStatus] || colors.blue}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        {formula && (
          <button
            onClick={() => setShowTip(!showTip)}
            className="w-5 h-5 rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold flex items-center justify-center hover:bg-slate-300 transition"
            title="Come viene calcolato">
            ?
          </button>
        )}
      </div>
      <p className="text-lg font-bold text-slate-900 mt-1">{value}</p>
      {showTip && formula && (
        <div className="mt-2 p-2.5 bg-white rounded-lg border border-slate-200 shadow-sm text-xs space-y-1.5">
          <div>
            <span className="font-semibold text-slate-700">Formula: </span>
            <span className="text-slate-600">{formula}</span>
          </div>
          {detail && (
            <div>
              <span className="font-semibold text-slate-700">Calcolo: </span>
              <span className="text-slate-600 font-mono">{detail}</span>
            </div>
          )}
          {benchmark && (
            <div>
              <span className="font-semibold text-slate-700">Benchmark: </span>
              <span className="text-slate-600">{benchmark}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══ BILANCIO TREE COMPONENT ═══
type TreeNodeT = { code: string; description: string; amount: number; level: number; isMacro: boolean; children?: TreeNodeT[] }
function BilancioTree({ rows, prevByCode, showYoY, isCost, currentYear }: { rows: TreeNodeT[]; prevByCode: Record<string, number> | null; showYoY: boolean; isCost: boolean; currentYear: number }) {
  if (!rows || rows.length === 0) return <p className="text-xs text-slate-400 italic">Nessun dato</p>
  return (
    <div className="space-y-0.5">
      {showYoY && prevByCode && (
        <div className="flex items-center justify-end gap-1 px-2 pb-1 text-[10px] text-slate-400 uppercase tracking-wider">
          <span className="w-24 text-right">{currentYear}</span>
          <span className="w-24 text-right">Anno Prec.</span>
          <span className="w-16 text-right">{'\u0394'} %</span>
        </div>
      )}
      {rows.map((node, i) => <TreeNode key={`${node.code}-${i}`} node={node} prevByCode={prevByCode} showYoY={showYoY} isCost={isCost} />)}
    </div>
  )
}

function TreeNode({ node, depth = 0, prevByCode, showYoY, isCost }: { node: TreeNodeT; depth?: number; prevByCode: Record<string, number> | null; showYoY: boolean; isCost: boolean }) {
  const [open, setOpen] = useState(node.level === 0) // macro level open by default
  const hasChildren = node.children && node.children.length > 0
  const isMacroRow = node.level === 0
  const isNegative = node.amount < 0

  const prevAmount = prevByCode ? prevByCode[node.code] : null
  const delta = prevAmount != null && prevAmount !== 0 ? variation(node.amount, prevAmount) : null
  // For costs: negative delta = improvement. For revenues: positive delta = improvement
  const isPositiveImprovement = isCost ? (delta != null && delta < 0) : (delta != null && delta > 0)

  const fmtAmount = (n: number | null | undefined) => {
    if (n == null) return '\u2014'
    const abs = Math.abs(n)
    const formatted = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs)
    // Fix 12.3: evita "-0,00" quando il valore arrotondato e' zero ma il
    // numero originale era leggermente negativo (-0.001 \u2192 -0,00)
    if (formatted === '0,00' || abs < 0.005) return '0,00'
    return n < 0 ? `-${formatted}` : formatted
  }

  return (
    <div>
      <div
        onClick={() => hasChildren && setOpen(!open)}
        className={`flex items-center justify-between py-1 px-2 rounded transition ${
          hasChildren ? 'cursor-pointer hover:bg-slate-50' : ''
        } ${isMacroRow ? 'bg-slate-50' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {hasChildren ? (
            <span className="text-slate-400 w-4 shrink-0 text-center text-xs">{open ? '\u25BE' : '\u25B8'}</span>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span className={`font-mono text-slate-400 shrink-0 ${isMacroRow ? 'text-xs font-bold' : 'text-[10px]'}`}
            style={{ width: node.code.length > 4 ? '60px' : '30px' }}>
            {node.code}
          </span>
          <span className={`truncate ${isMacroRow ? 'text-xs font-bold text-slate-900' : 'text-xs text-slate-600'}`}>
            {node.description}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <span className={`tabular-nums text-right w-24 ${
            isMacroRow ? 'text-xs font-bold text-slate-900' : 'text-[11px] text-slate-600'
          } ${isNegative ? 'text-red-600' : ''}`}>
            {fmtAmount(node.amount)} {'\u20AC'}
          </span>
          {showYoY && prevByCode && (
            <>
              <span className={`tabular-nums text-right w-24 ${
                isMacroRow ? 'text-[11px] font-medium text-slate-500' : 'text-[10px] text-slate-400'
              }`}>
                {prevAmount != null ? `${fmtAmount(prevAmount)} \u20AC` : '\u2014'}
              </span>
              <span className="w-16 text-right">
                {delta != null ? (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-semibold ${
                    isMacroRow ? 'text-[10px]' : 'text-[9px]'
                  } ${isPositiveImprovement ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-300">{prevAmount == null ? '\u2014' : ''}</span>
                )}
              </span>
            </>
          )}
        </div>
      </div>
      {open && hasChildren && (
        <div>
          {(node.children || []).map((child: TreeNodeT, i: number) => (
            <TreeNode key={`${child.code}-${i}`} node={child} depth={depth + 1} prevByCode={prevByCode} showYoY={showYoY} isCost={isCost} />
          ))}
        </div>
      )}
    </div>
  )
}
