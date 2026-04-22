import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import PageHelp from '../components/PageHelp'
import {
  TrendingUp, TrendingDown, DollarSign, PieChart, BarChart3, Upload,
  ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, AlertCircle,
  Building2, Users, Warehouse, Banknote, Calculator, ShieldCheck, Store, MapPin,
  FileUp, Download, Lock, CheckCircle, Clock, ThumbsUp, ThumbsDown,
  Lightbulb, AlertTriangle, FileText, Save, X, Sparkles, LineChart as LineChartIcon, Loader2
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart as RePie, Pie, Cell,
  LineChart, Line, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { usePeriod } from '../hooks/usePeriod'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'

import PdfViewer from '../components/PdfViewer'
import { parseBilancio, toSupabaseRecords } from '../lib/parsers/bilancioParser'

// ===== HELPERS =====
function fmt(n, decimals = 0) {
  if (n == null) return '—'
  const rounded = Math.round(n * 100) / 100
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(rounded)
}
function pct(v, total) {
  if (!total || total === 0) return '—'
  return `${(v / total * 100).toFixed(1)}%`
}
function variation(curr, prev) {
  if (!prev || prev === 0) return null
  return ((curr - prev) / Math.abs(prev) * 100)
}

// ===== Italian number formatting for form inputs =====
function fmtInput(n) {
  if (n == null || n === '') return ''
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return ''
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num)
}
function parseInputNumber(str) {
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

function parseItalianNumber(str) {
  if (!str) return 0
  // Italian: 1.234.567,89 → 1234567.89
  const cleaned = str.replace(/\./g, '').replace(',', '.')
  return parseFloat(cleaned) || 0
}

// ===== UI COMPONENTS =====
function Kpi({ label, value, sub, icon: Icon, color = 'blue', trend }) {
  const colors = {
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

function Section({ title, icon: Icon, children, defaultOpen = true, badge }) {
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

function CeRow({ label, v2025, v2024, total2025, total2024, bold, indent, highlight, sub, border, editable, onChange, simMode, onEditChange, fieldKey, isDirty }) {
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
              onChange(parseFloat(e.target.value) || 0)
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
function analyzeStrengthsWeaknesses(ce, ricavi) {
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
  const { profile } = useAuth()
  const COMPANY_ID = profile?.company_id
  const { year, quarter, getDateRange } = usePeriod()
  const [periodType, setPeriodType] = useState('annuale')
  const [periodData, setPeriodData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [simulationMode, setSimulationMode] = useState(false)
  const [simData, setSimData] = useState(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [companyInfo, setCompanyInfo] = useState(null)
  const [imports, setImports] = useState([])
  const [showImportForm, setShowImportForm] = useState(false)
  const [formData, setFormData] = useState({})
  const [formErrors, setFormErrors] = useState({})

  // Feature 2: Approval workflow
  const [showApproveConfirm, setShowApproveConfirm] = useState(null)

  // Feature 3: Nota integrativa
  const [notaIntegrativa, setNotaIntegrativa] = useState('')
  const [notaSaving, setNotaSaving] = useState(false)
  const [notaLoaded, setNotaLoaded] = useState(false)

  // Feature 4: PDF parsing
  const [pdfParsing, setPdfParsing] = useState(false)
  const [parsedFields, setParsedFields] = useState(null)
  const [pdfPreview, setPdfPreview] = useState(null)
  const [bilancioData, setBilancioData] = useState(null) // full parsed bilancio tree
  const [showBilancioTree, setShowBilancioTree] = useState(false)
  const [bilancioSaving, setBilancioSaving] = useState(false)
  const [bilancioSaved, setBilancioSaved] = useState(false)

  // Feature: Previous year bilancio tree for YoY comparison
  const [prevBilancioData, setPrevBilancioData] = useState(null)

  // Feature 6: Trend multi-anno
  const [trendData, setTrendData] = useState([])
  const [showTrend, setShowTrend] = useState(false)

  // Feature: YoY comparison toggle
  const [showYoY, setShowYoY] = useState(true)

  // Feature: Cash-basis (Cassa) view
  const [viewMode, setViewMode] = useState('competenza') // 'competenza' | 'cassa' | 'riconciliazione'
  const [cashData, setCashData] = useState(null) // { monthly: [...], byCategory: [...], totals: {} }
  const [cashLoading, setCashLoading] = useState(false)

  // Riconciliazione Bilancio data
  const [riconData, setRiconData] = useState(null)
  const [riconLoading, setRiconLoading] = useState(false)

  // NEW: Manual save functionality
  const [dirtyFields, setDirtyFields] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)
  const [availableYears, setAvailableYears] = useState([2023, 2024, 2025, 2026])

  // ═══ Load bilancio tree from Supabase (persists across page reloads) ═══
  const loadBilancioFromSupabase = async () => {
    try {
      const sections = ['sp_attivita', 'sp_passivita', 'ce_costi', 'ce_ricavi']
      const { data } = await supabase
        .from('balance_sheet_data')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .eq('year', year)
        .eq('period_type', periodType)
        .in('section', sections)
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
      const bySection = { sp_attivita: [], sp_passivita: [], ce_costi: [], ce_ricavi: [] }
      cleanData.forEach(row => {
        if (bySection[row.section]) {
          bySection[row.section].push({
            code: row.account_code || '',
            description: row.account_name || '',
            amount: row.amount || 0,
            level: getCodeLevel(row.account_code),
            isMacro: (row.account_code || '').replace(/\s/g, '').length <= 2,
          })
        }
      })

      // Build trees
      const buildTree = (rows) => {
        if (!rows || rows.length === 0) return []
        const tree = []
        const stack = []
        for (const row of rows) {
          const node = { ...row, children: [] }
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
        .eq('company_id', COMPANY_ID)
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
        .eq('company_id', COMPANY_ID)
        .eq('year', year)
        .eq('period_type', periodType)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const reconstructed = {
        meta: {
          company: companyInfo?.denominazione || 'NEW ZAGO S.R.L.',
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
    } catch (err) {
      console.error('Error loading bilancio tree:', err)
    }
  }

  // ═══ Load PREVIOUS year bilancio tree from Supabase for YoY comparison ═══
  const loadPrevBilancioFromSupabase = async () => {
    try {
      const prevYear = year - 1
      const sections = ['sp_attivita', 'sp_passivita', 'ce_costi', 'ce_ricavi']
      const { data } = await supabase
        .from('balance_sheet_data')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .eq('year', prevYear)
        .eq('period_type', periodType)
        .in('section', sections)
        .order('sort_order')

      if (!data || data.length === 0) {
        setPrevBilancioData(null)
        return
      }

      const junkPattern = /Azienda:|Cod\.\s*Fiscale|Partita\s*IVA|^VIA\s|PERIODO\s*DAL|Totali\s*fino|Considera\s*anche|^Pag\./i
      const cleanData = data.filter(row => !junkPattern.test(row.account_name || ''))

      // Build a lookup map: account_code -> amount (for matching with current year)
      const prevByCode = {}
      cleanData.forEach(row => {
        prevByCode[row.account_code] = row.amount || 0
      })

      // Also build section-based structures for tree matching
      const bySection = { sp_attivita: [], sp_passivita: [], ce_costi: [], ce_ricavi: [] }
      cleanData.forEach(row => {
        if (bySection[row.section]) {
          bySection[row.section].push({
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
        .eq('company_id', COMPANY_ID)
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
    } catch (err) {
      console.error('Error loading prev bilancio:', err)
      setPrevBilancioData(null)
    }
  }

  // Helper to determine level from account code length
  function getCodeLevel(code) {
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
    try {
      const { data } = await supabase
        .from('company_settings')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .single()
      setCompanyInfo(data)
    } catch (error) {
      console.error('Error loading company info:', error)
    }
  }

  const loadImports = async () => {
    try {
      const { data } = await supabase
        .from('balance_sheet_imports')
        .select('*')
        .eq('company_id', COMPANY_ID)
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
        .eq('company_id', COMPANY_ID)
        .neq('section', 'nota_integrativa')
      if (data && data.length > 0) {
        const years = [...new Set(data.map(d => d.year))].sort((a, b) => b - a)
        setAvailableYears(years.length > 0 ? years : [2023, 2024, 2025, 2026])
      }
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
        .eq('company_id', COMPANY_ID)
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
        .eq('company_id', COMPANY_ID)
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
        .eq('company_id', COMPANY_ID)
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
      const years = [2023, 2024, 2025, 2026]
      const { data } = await supabase
        .from('balance_sheet_data')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .eq('period_type', periodType)
        .in('year', years)
        .neq('section', 'nota_integrativa')

      const byYear = {}
      years.forEach(y => { byYear[y] = {} })
      ;(data || []).forEach(row => {
        if (!byYear[row.year]) byYear[row.year] = {}
        byYear[row.year][row.account_code] = row.amount
      })

      const trend = years.map(y => ({
        anno: y.toString(),
        ricavi: byYear[y].ricavi_vendite || 0,
        ebitda: byYear[y].differenza_ab || 0,
        personale: byYear[y].totale_personale || 0,
        utile: byYear[y].utile_netto || 0,
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
        .eq('company_id', COMPANY_ID)
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
      const monthlyMap = {}
      for (let m = 1; m <= 12; m++) {
        monthlyMap[m] = { mese: m, meseLabel: new Date(year, m - 1, 1).toLocaleDateString('it-IT', { month: 'short' }), entrate: 0, uscite: 0, netto: 0 }
      }

      let totalEntrate = 0, totalUscite = 0
      let categorizedCount = 0
      const categoryMap = {}

      data.forEach(row => {
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
      let byCategory = Object.values(categoryMap)
      if (byCategory.length > 0) {
        const catIds = byCategory.map(c => c.category_id)
        const { data: cats } = await supabase
          .from('cost_categories')
          .select('id, name')
          .in('id', catIds)
        const catNameMap = {}
        ;(cats || []).forEach(c => { catNameMap[c.id] = c.name })
        byCategory = byCategory.map(c => ({ ...c, name: catNameMap[c.category_id] || `Categoria ${c.category_id}` }))
          .sort((a, b) => (b.uscite + b.entrate) - (a.uscite + a.entrate))
      }

      setCashData({
        monthly,
        byCategory,
        totals: { entrate: totalEntrate, uscite: totalUscite, netto: totalEntrate - totalUscite },
        count: data.length,
        hasCategorized: categorizedCount > data.length * 0.1, // at least 10% categorized
      })
    } catch (err) {
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
        .eq('company_id', COMPANY_ID)
        .eq('year', year)

      if (error) throw error
      if (!data || data.length === 0) {
        setRiconData(null)
        return
      }

      // Helper: prende actual_amount se disponibile, altrimenti budget_amount
      const getAmount = (e) => parseFloat(e.actual_amount) || parseFloat(e.budget_amount) || 0

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
      const rettificheTotale = rettificheEntries.reduce((sum, e) => sum + (parseFloat(e.budget_amount) || 0), 0)

      // Raggruppa rettifiche per tipo (account_code)
      const rettificheByType = {}
      rettificheEntries.forEach(e => {
        const key = e.account_code
        if (!rettificheByType[key]) {
          rettificheByType[key] = { code: key, name: e.account_name, total: 0 }
        }
        rettificheByType[key].total += parseFloat(e.budget_amount) || 0
      })

      const risultatoGestionale = ricavi - costiOutlet - speseNonDivise
      const risultatoConRettifica = risultatoGestionale + Math.abs(rettificheTotale)

      // Dati bilancio civilistico (valori fissi dal bilancio ufficiale 2025)
      const bilancioUfficiale = year === 2025 ? {
        ebit: 47549.41,
        proventiFinanziari: 86.94,
        oneriFinanziari: -29662.74,
        utileNetto: 17973.61,
        available: true,
      } : { ebit: null, proventiFinanziari: null, oneriFinanziari: null, utileNetto: null, available: false }

      const deltaClassificazione = bilancioUfficiale.available
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
    } catch (err) {
      console.error('Error loading riconciliazione data:', err)
      setRiconData(null)
    } finally {
      setRiconLoading(false)
    }
  }, [COMPANY_ID, year])

  useEffect(() => {
    if (viewMode === 'riconciliazione') loadRiconciliazione()
  }, [viewMode, year, loadRiconciliazione])

  // Feature 4: PDF parsing with pdfjs-dist
  const handleFileUpload = async (e) => {
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
        .eq('company_id', COMPANY_ID)
        .eq('year', year)
        .eq('period_type', periodType)

      // Create import record
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
          uploaded_by_name: profile?.full_name || profile?.email || null,
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
          const ceMacro = {}
          parsed.contoEconomico.costi.forEach(row => {
            if (row.isMacro) ceMacro[row.code] = row.amount
          })
          const ceSub = {}
          parsed.contoEconomico.costi.forEach(row => {
            if (row.level === 1) ceSub[row.code] = row.amount
          })

          const extracted = {
            ricavi_vendite: t.ricavi || 0,
            materie_prime: ceMacro['61'] || 0,
            servizi: ceMacro['63'] || 0,
            godimento_beni_terzi: ceMacro['65'] || 0,
            salari_stipendi: ceSub['6701'] || 0,
            oneri_sociali: ceSub['6703'] || 0,
            tfr: ceSub['6705'] || 0,
            totale_personale: ceMacro['67'] || 0,
            totale_ammortamenti: (ceMacro['69'] || 0) + (ceMacro['71'] || 0),
            variazione_rimanenze: ceMacro['73'] || 0,
            oneri_diversi: ceMacro['77'] || 0,
            oneri_finanziari: ceMacro['83'] || 0,
            imposte: 0,
            utile_netto: t.risultato || 0,
          }
          extracted.totale_costi_produzione = Math.round((extracted.materie_prime + extracted.servizi +
            extracted.godimento_beni_terzi + extracted.totale_personale +
            extracted.totale_ammortamenti + extracted.variazione_rimanenze + extracted.oneri_diversi) * 100) / 100
          extracted.differenza_ab = Math.round((extracted.ricavi_vendite - extracted.totale_costi_produzione) * 100) / 100

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
      alert('Errore nel caricamento del file')
    } finally {
      setUploadingFile(false)
      setPdfParsing(false)
    }
  }

  // Feature 5: Validation
  const validateFormData = () => {
    const errors = {}
    let hasErrors = false

    CE_FIELDS.forEach(field => {
      const val = formData[field.key]
      if (field.required && (val === undefined || val === '' || val === null)) {
        errors[field.key] = 'Campo obbligatorio'
        hasErrors = true
      }
      if (val !== undefined && val !== '' && field.min !== undefined && parseFloat(val) < field.min) {
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
      const records = Object.entries(formData)
        .filter(([, value]) => value !== '' && value !== undefined && value !== null)
        .map(([key, value]) => ({
          company_id: COMPANY_ID,
          year: year,
          period_type: periodType,
          section: 'conto_economico',
          account_code: key,
          account_name: CE_FIELDS.find(f => f.key === key)?.label || key.replace(/_/g, ' '),
          amount: parseFloat(value) || 0,
          sort_order: CE_FIELDS.findIndex(f => f.key === key),
        }))

      // Delete existing data for same year/period before inserting
      await supabase
        .from('balance_sheet_data')
        .delete()
        .eq('company_id', COMPANY_ID)
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
      alert('Errore nel salvataggio dei dati')
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
            amount: parseFloat(ce25[key]) || 0,
            sort_order: CE_FIELDS.findIndex(f => f.key === key),
          }
        })

      // Upsert each record (delete existing, then insert)
      for (const record of records) {
        await supabase
          .from('balance_sheet_data')
          .delete()
          .eq('company_id', COMPANY_ID)
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
      setSaveMessage({ type: 'error', text: 'Errore nel salvataggio: ' + (error.message || 'sconosciuto') })
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
          .eq('company_id', COMPANY_ID)
          .eq('year', year)
          .eq('period_type', periodType)
          .eq('section', section)
      }

      // Insert in batches of 100
      for (let i = 0; i < records.length; i += 100) {
        const batch = records.slice(i, i + 100)
        const { error } = await supabase.from('balance_sheet_data').insert(batch)
        if (error) throw error
      }

      setBilancioSaved(true)
      loadPeriodData()
      loadAvailableYears()
    } catch (error) {
      console.error('Error saving bilancio:', error)
      alert('Errore nel salvataggio: ' + (error.message || 'sconosciuto'))
    } finally {
      setBilancioSaving(false)
    }
  }

  // Feature 2: Approval workflow
  const handleApproveImport = async (imp) => {
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

  const handleRejectImport = async (imp) => {
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

  const buildCeFromData = (data) => {
    if (!data || !Array.isArray(data) || data.length === 0) return null
    const ce = {}
    data.filter(r => r.section !== 'nota_integrativa').forEach(row => {
      ce[row.account_code] = row.amount
    })
    return ce
  }

  // Load previous year for comparison
  const [prevYearData, setPrevYearData] = useState(null)
  useEffect(() => {
    const loadPrev = async () => {
      try {
        const { data } = await supabase
          .from('balance_sheet_data')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('year', year - 1)
          .eq('period_type', periodType)
          .neq('section', 'nota_integrativa')
        const ce = {}
        ;(data || []).forEach(row => { ce[row.account_code] = row.amount })
        setPrevYearData(ce)
      } catch (e) { console.error(e) }
    }
    loadPrev()
  }, [year, periodType])

  const ce25 = simulationMode && simData ? simData : buildCeFromData(periodData) || {}
  const cePrev = prevYearData || {}
  const ricavi25 = ce25.ricavi_vendite || 0
  const ricaviPrev = cePrev.ricavi_vendite || 0

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

  const handleSimulationChange = (field, value) => {
    setSimData({ ...simData || ce25, [field]: value })
  }

  const periodi = ['annuale', 'trimestrale', 'mensile', 'provvisorio']

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header with Period/Year Selector */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Conto Economico & Bilancio</h1>
          <p className="text-sm text-slate-500 mt-1">
            {companyInfo?.denominazione || 'NEW ZAGO S.R.L.'} — {companyInfo?.cf_piva || 'CF'}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Sede: {companyInfo?.sede || 'FIRENZE (FI)'}
          </p>
        </div>

        {/* Controls */}
        <div className="flex gap-3 flex-wrap justify-end">
          <div className="flex gap-2">
            <select value={periodType} onChange={(e) => setPeriodType(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              {periodi.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {/* Competenza / Cassa toggle */}
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
                viewMode === 'cassa' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              <Banknote size={13} /> Cassa
            </button>
            <button
              onClick={() => setViewMode('riconciliazione')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1 ${
                viewMode === 'riconciliazione' ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
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
          <button
            onClick={() => setShowTrend(!showTrend)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1 ${
              showTrend ? 'bg-indigo-100 text-indigo-700 border border-indigo-300' : 'bg-slate-100 text-slate-700 border border-slate-300'
            }`}>
            <LineChartIcon size={14} /> Trend
          </button>
          <button
            onClick={() => setSimulationMode(!simulationMode)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
              simulationMode
                ? 'bg-purple-100 text-purple-700 border border-purple-300'
                : 'bg-slate-100 text-slate-700 border border-slate-300'
            }`}>
            {simulationMode ? 'Exit Simulation' : 'Simulation Mode'}
          </button>
          <label className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-100 text-blue-700 border border-blue-300 flex items-center gap-1 cursor-pointer">
            <FileUp size={14} /> Import PDF
            <input type="file" accept=".pdf,.xlsx,.csv" onChange={handleFileUpload} className="hidden" />
          </label>
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
                        <Pie data={cashData.byCategory.map(c => ({ name: c.name, value: c.uscite }))} dataKey="value" nameKey="name"
                          cx="50%" cy="50%" innerRadius={55} outerRadius={105} paddingAngle={3} strokeWidth={0}
                          label={({ name, percent }) => percent > 0.03 ? `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%` : ''}>
                          {cashData.byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="white" strokeWidth={2} />)}
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
                          {cashData.byCategory.map((c, i) => (
                            <tr key={c.category_id} className="border-b border-slate-50">
                              <td className="py-1.5 px-3 flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                <span className="text-slate-700">{c.name}</span>
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
                  <span className="text-sm font-semibold text-slate-900">Risultato Gestionale (per outlet)</span>
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-slate-600">Ricavi totali (tutti gli outlet)</span>
                    <span className="text-sm font-semibold text-emerald-600 tabular-nums">+ {fmt(riconData.ricavi)} €</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-slate-600">Costi totali (tutti gli outlet)</span>
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
                        <span className={`text-xl font-bold tabular-nums ${riconData.bilancioUfficiale.utileNetto >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {riconData.bilancioUfficiale.utileNetto >= 0 ? '+' : ''}{fmt(riconData.bilancioUfficiale.utileNetto)} €
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
                Dati dal bilancio ufficiale {companyInfo?.denominazione || 'New Zago S.R.L.'} {year}
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
              { label: 'Periodo', value: `${periodType} ${year}`, status: 'blue' },
              { label: 'Stato', value: simulationMode ? 'Simulazione' : 'Dati reali', status: simulationMode ? 'purple' : 'green' },
            ].map(r => (
              <IndiceCard key={r.label} {...r} />
            ))}
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
                    label={({ name, percent }) => percent > 0.03 ? `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%` : ''}>
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
function IndiceCard({ label, value, status, formula, detail, benchmark }) {
  const [showTip, setShowTip] = useState(false)
  const colors = {
    green: 'bg-emerald-50/50 border-emerald-200',
    amber: 'bg-amber-50/50 border-amber-200',
    red: 'bg-red-50/50 border-red-200',
    blue: 'bg-blue-50/50 border-blue-200',
    purple: 'bg-purple-50/50 border-purple-200',
  }
  return (
    <div className={`rounded-lg p-3 border relative ${colors[status] || colors.blue}`}>
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
function BilancioTree({ rows, prevByCode, showYoY, isCost, currentYear }) {
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

function TreeNode({ node, depth = 0, prevByCode, showYoY, isCost }) {
  const [open, setOpen] = useState(node.level === 0) // macro level open by default
  const hasChildren = node.children && node.children.length > 0
  const isMacroRow = node.level === 0
  const isNegative = node.amount < 0

  const prevAmount = prevByCode ? prevByCode[node.code] : null
  const delta = prevAmount != null && prevAmount !== 0 ? variation(node.amount, prevAmount) : null
  // For costs: negative delta = improvement. For revenues: positive delta = improvement
  const isPositiveImprovement = isCost ? (delta != null && delta < 0) : (delta != null && delta > 0)

  const fmtAmount = (n) => {
    if (n == null) return '\u2014'
    const formatted = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))
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
          {node.children.map((child, i) => (
            <TreeNode key={`${child.code}-${i}`} node={child} depth={depth + 1} prevByCode={prevByCode} showYoY={showYoY} isCost={isCost} />
          ))}
        </div>
      )}
    </div>
  )
}
