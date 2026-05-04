import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { usePeriod } from '../hooks/usePeriod'
import ExportMenu from '../components/ExportMenu'
import {
  Store, TrendingUp, Users, DollarSign, RefreshCw, ChevronDown, ChevronUp,
  ArrowUpRight, ArrowDownRight, BarChart3, Target, Percent, Building2, AlertCircle,
  Download, CheckCircle2, Filter, Calendar
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts'
import { GlassTooltip, ChartGradients, AXIS_STYLE, GRID_STYLE, BAR_RADIUS, ModernLegend, fmtEuro, fmtK } from '../components/ChartTheme'
import { formatOutletName, shortOutletName } from '../lib/formatters'

function fmt(n: number | null | undefined, dec = 0): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}

/* ═══════════════════════════════════════
   KPI Badge small
   ═══════════════════════════════════════ */
type BadgeColor = 'blue' | 'green' | 'amber' | 'purple' | 'red'
function KpiBadge({ label, value, sub, color = 'blue' }: { label: string; value: string | number; sub?: string; color?: BadgeColor }) {
  const colors: Record<BadgeColor, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    red: 'bg-red-50 text-red-600 border-red-100',
  }
  return (
    <div className={`rounded-lg border p-3 ${colors[color]}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      {sub && <div className="text-xs opacity-60">{sub}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════
   CARD OUTLET — Singola colonna confronto
   ═══════════════════════════════════════ */
// TODO: tighten type
function OutletCard({ name, outletData, calculatedMetrics, ranking, onNavigate }: any) {
  const [open, setOpen] = useState(false)

  if (!calculatedMetrics) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-300 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-100" style={{ borderTopWidth: 4, borderTopColor: '#9ca3af' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Store size={18} style={{ color: '#9ca3af' }} />
              <div className="font-bold text-slate-900 text-sm">{shortOutletName(name)}</div>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500 border border-dashed border-slate-300">
              Nessun dato
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{formatOutletName(name)}</div>
        </div>
        <div className="px-4 py-6 text-center">
          <AlertCircle size={24} className="text-slate-300 mx-auto mb-2" />
          <div className="text-sm text-slate-400">Carica i dati dal Budget o dal Bilancio per visualizzare il confronto</div>
        </div>
      </div>
    )
  }

  const { ricavi, margine, marginePct, costoPersonale, affitto, servizi, personaleCount,
    ricavoPerDip, incidenzaPersonale, incidenzaAffitto, breakeven, merci, costiDiretti, costiTotali,
    isVariance } = calculatedMetrics

  const isPositive = margine >= 0
  // null = non calcolabile (0 dipendenti). La UI mostra 'N/D'. Prima
  // ritornava 0 ma costi/ricavi per dipendente con 0 dipendenti non
  // hanno senso di essere '0 €' — sono indeterminati.
  const costoPerDip = personaleCount > 0 ? costoPersonale / personaleCount : null

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden flex flex-col border-slate-200`}>
      {/* Header con colore outlet */}
      <div className="p-4 border-b border-slate-100" style={{ borderTopWidth: 4, borderTopColor: outletData.color || '#6366f1' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store size={18} style={{ color: outletData.color || '#6366f1' }} />
            <button onClick={onNavigate} className="font-bold text-slate-900 text-sm hover:text-indigo-600 transition cursor-pointer text-left">
              {shortOutletName(name)}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {ranking && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                ranking === 1 ? 'bg-yellow-100 text-yellow-700' :
                ranking === 2 ? 'bg-slate-100 text-slate-600' :
                ranking === 3 ? 'bg-amber-100 text-amber-700' :
                'bg-slate-50 text-slate-400'
              }`}>
                #{ranking}
              </span>
            )}
          </div>
        </div>
        <div className="text-xs text-slate-400 mt-0.5">{formatOutletName(name)}</div>
      </div>

      {/* Ricavi - Hero KPI + varianza */}
      <div className="px-4 pt-4 pb-2">
        <div className="text-xs text-slate-400">{isVariance ? 'Δ Ricavi (Cons. − Prev.)' : 'Ricavi'}</div>
        <div className={`text-2xl font-bold ${isVariance ? (ricavi >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-slate-900'}`}>
          {isVariance && ricavi > 0 ? '+' : ''}{fmt(ricavi)} €
        </div>
        {/* Banner "vs budget" nascosto in modalità Scostamento: sarebbe duplicato del valore stesso */}
        {!isVariance && calculatedMetrics.variance && calculatedMetrics.budgetRicavi > 0 && (
          <div className={`text-xs font-medium ${calculatedMetrics.variance.ricavi >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {calculatedMetrics.variance.ricavi >= 0 ? '+' : ''}{fmt(calculatedMetrics.variance.ricavi)} € ({calculatedMetrics.variance.ricaviPct >= 0 ? '+' : ''}{calculatedMetrics.variance.ricaviPct.toFixed(1)}%) vs budget
          </div>
        )}
        {calculatedMetrics.approvalPct > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <CheckCircle2 size={10} className={calculatedMetrics.approvalPct >= 100 ? 'text-emerald-500' : 'text-amber-400'} />
            <span className="text-xs text-slate-400">Approvato: {calculatedMetrics.approvalPct}%</span>
          </div>
        )}
      </div>

      {/* KPI Grid — in variance i delta sono colorati per significato:
          ricavi/margini: positivo=verde (meglio); costi: positivo=rosso (peggio).
          Il prefisso '+' viene aggiunto ai delta positivi per leggibilità. */}
      <div className="px-4 py-3 grid grid-cols-2 gap-2">
        <KpiBadge
          label={isVariance ? 'Δ Margine' : 'Margine'}
          value={`${isVariance && margine > 0 ? '+' : ''}${fmt(margine)} €`}
          sub={`${isVariance && marginePct > 0 ? '+' : ''}${marginePct.toFixed(1)}${isVariance ? ' p.p.' : '%'}`}
          color={margine >= 0 ? 'green' : 'red'} />
        <KpiBadge label="Dipendenti" value={personaleCount || 0}
          sub={ricavoPerDip != null ? `${isVariance && ricavoPerDip > 0 ? '+' : ''}${fmt(ricavoPerDip)} €/dip` : 'N/D'} color="blue" />
        <KpiBadge
          label={isVariance ? 'Δ Costo personale' : 'Costo personale'}
          value={`${isVariance && costoPersonale > 0 ? '+' : ''}${fmt(costoPersonale)} €`}
          sub={`${isVariance && incidenzaPersonale > 0 ? '+' : ''}${incidenzaPersonale.toFixed(1)}${isVariance ? ' p.p.' : '% ricavi'}`}
          color={isVariance ? (costoPersonale > 0 ? 'red' : costoPersonale < 0 ? 'green' : 'amber') : 'amber'} />
        <KpiBadge
          label={isVariance ? 'Δ Affitto' : 'Affitto'}
          value={`${isVariance && affitto > 0 ? '+' : ''}${fmt(affitto)} €`}
          sub={`${isVariance && incidenzaAffitto > 0 ? '+' : ''}${incidenzaAffitto.toFixed(1)}${isVariance ? ' p.p.' : '% ricavi'}`}
          color={isVariance ? (affitto > 0 ? 'red' : affitto < 0 ? 'green' : 'purple') : 'purple'} />
      </div>

      {/* Dettaglio costi espandibile */}
      <div className="px-4 pb-3">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition w-full justify-center py-1"
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {open ? 'Nascondi dettaglio' : 'Mostra dettaglio'}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-1.5 text-sm bg-slate-50/30">
          {[
            { label: 'Ricavi vendite', val: ricavi, pct: 100, bold: true },
            { label: 'Merci/materie', val: -merci, pct: -(merci / (ricavi || 1) * 100) },
            { label: 'Personale', val: -costoPersonale, pct: -incidenzaPersonale },
            { label: 'Affitto/godimento', val: -affitto, pct: -incidenzaAffitto },
            { label: 'Servizi', val: -servizi, pct: -(servizi / (ricavi || 1) * 100) },
          ].map(r => (
            <div key={r.label} className={`flex items-center justify-between ${r.bold ? 'font-semibold text-slate-900 pb-1 border-b border-slate-100' : 'text-slate-600'}`}>
              <span>{r.label}</span>
              <div className="text-right">
                <span className={`font-medium ${r.val < 0 ? 'text-red-600' : r.bold ? 'text-slate-900' : 'text-slate-600'}`}>
                  {r.val < 0 ? '-' : ''}{fmt(Math.abs(r.val))} €
                </span>
                {r.pct !== null && !r.bold && (
                  <span className="text-xs text-slate-400 ml-1">({Math.abs(r.pct).toFixed(1)}%)</span>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200 font-bold">
            <span className="text-slate-900">MARGINE OUTLET</span>
            <span className={isPositive ? 'text-emerald-600' : 'text-red-600'}>
              {fmt(margine)} € ({marginePct.toFixed(1)}%)
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
            <span>Costo medio per dipendente</span>
            <span>{costoPerDip != null ? `${fmt(costoPerDip)} €/anno` : 'N/D'}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Ricavo per dipendente</span>
            <span className="font-medium text-blue-600">{ricavoPerDip != null ? `${fmt(ricavoPerDip)} €/anno` : 'N/D'}</span>
          </div>
          {/* Breakeven non significativo sui delta → nascosto in modalità Scostamento */}
          {!isVariance && (
            <>
              <div className="flex items-center justify-between text-xs pt-2 border-t border-amber-200 mt-1">
                <span className="text-amber-700 font-semibold">Breakeven</span>
                <span className="font-bold text-amber-600">{fmt(breakeven)} €/anno — {fmt(breakeven / 12)} €/mese</span>
              </div>
              {ricavi > 0 && (
                <div className={`flex items-center justify-between text-xs ${ricavi >= breakeven ? 'text-emerald-600' : 'text-red-600'}`}>
                  <span>{ricavi >= breakeven ? 'Sopra breakeven' : 'Sotto breakeven'}</span>
                  <span className="font-medium">{ricavi >= breakeven ? '+' : ''}{fmt(ricavi - breakeven)} € ({((ricavi - breakeven) / (breakeven || 1) * 100).toFixed(1)}%)</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════
   TABELLA BENCHMARK COMPARATIVA
   ═══════════════════════════════════════ */
type CalculatedMetrics = {
  ricavi: number
  margine: number
  marginePct: number
  costoPersonale: number
  affitto: number
  servizi: number
  merci: number
  costiDiretti: number
  costiTotali: number
  personaleCount: number
  ricavoPerDip: number | null
  incidenzaPersonale: number
  incidenzaAffitto: number
  breakeven: number
  quotaSede: number
  variance: { ricavi: number; margine: number; ricaviPct: number }
  approvalPct: number
  budgetRicavi: number
  actualRicavi: number
  isVariance: boolean
}
type OutletDataLite = {
  id?: string
  code?: string
  label?: string
  name?: string
  color?: string
}
type OutletMetric = {
  name: string
  outletData: OutletDataLite
  calculatedMetrics: CalculatedMetrics | null
}

function TabellaBenchmark({ outletMetrics }: { outletMetrics: OutletMetric[] }) {
  if (!outletMetrics || outletMetrics.length === 0) return null

  const rows = outletMetrics
    .filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => o.calculatedMetrics !== null)
    .sort((a, b) => b.calculatedMetrics.ricavi - a.calculatedMetrics.ricavi)

  const isVariance = rows[0]?.calculatedMetrics?.isVariance || false

  type MetricBest = 'max' | 'min' | null
  type MetricRow = { label: string; key: string; fn: (r: typeof rows[number]) => number; best: MetricBest; pct?: boolean }
  // In variance le metriche di costo sono "delta": un delta positivo significa
  // costo aumentato (peggio), un delta negativo significa costo diminuito (meglio).
  // Per i ricavi/margini è il contrario: positivo è meglio.
  const metrics: MetricRow[] = [
    { label: isVariance ? 'Δ Ricavi' : 'Ricavi', key: 'ricavi', fn: r => r.calculatedMetrics.ricavi || 0, best: 'max' },
    { label: isVariance ? 'Δ Margine €' : 'Margine €', key: 'margine', fn: r => r.calculatedMetrics.margine || 0, best: 'max' },
    { label: isVariance ? 'Δ Margine %' : 'Margine %', key: 'marginePct', fn: r => r.calculatedMetrics.marginePct || 0, best: 'max', pct: true },
    { label: 'Dipendenti', key: 'ndip', fn: r => r.calculatedMetrics.personaleCount || 0, best: null },
    { label: isVariance ? 'Δ €/Dipendente' : '€/Dipendente', key: 'ricPerDip', fn: r => r.calculatedMetrics.ricavoPerDip || 0, best: 'max' },
    { label: isVariance ? 'Δ Costo personale' : 'Costo personale', key: 'costoPers', fn: r => r.calculatedMetrics.costoPersonale || 0, best: 'min' },
    { label: isVariance ? 'Δ Affitto' : 'Affitto', key: 'affitto', fn: r => r.calculatedMetrics.affitto || 0, best: 'min' },
    { label: isVariance ? 'Δ Inc. personale %' : 'Inc. personale %', key: 'incPers', fn: r => r.calculatedMetrics.incidenzaPersonale || 0, best: 'min', pct: true },
    { label: isVariance ? 'Δ Inc. affitto %' : 'Inc. affitto %', key: 'incAff', fn: r => r.calculatedMetrics.incidenzaAffitto || 0, best: 'min', pct: true },
    // Breakeven sui delta non è significativo: rimosso in modalità Scostamento
    ...(isVariance ? [] : [{ label: 'Breakeven', key: 'breakeven', fn: (r: typeof rows[number]) => r.calculatedMetrics.breakeven || 0, best: 'min' as MetricBest }]),
  ]

  return (
    <div className="rounded-2xl overflow-hidden shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Target size={18} className="text-blue-600" />
        <h3 className="font-semibold text-slate-900">Benchmark comparativo</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr className="text-xs text-slate-500 uppercase tracking-wider">
              <th className="py-2.5 px-4 text-left font-medium sticky left-0 bg-slate-50 z-10">Metrica</th>
              {rows.map(r => (
                <th key={r.name} className="py-2.5 px-4 text-right font-medium whitespace-nowrap">
                  <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: r.outletData?.color || '#6366f1' }} />
                  {shortOutletName(r.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => {
              const values = rows.map(r => m.fn(r))
              const bestVal = m.best === 'max' ? Math.max(...values) : m.best === 'min' ? Math.min(...values) : null
              return (
                <tr key={m.key} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="py-2.5 px-4 text-sm font-medium text-slate-700 sticky left-0 bg-white z-10">{m.label}</td>
                  {rows.map((r, i) => {
                    const val = values[i]
                    const isBest = bestVal !== null && Math.abs(val - bestVal) < 0.01
                    return (
                      <td key={r.name} className={`py-2.5 px-4 text-sm text-right font-medium ${
                        isBest ? 'text-emerald-600 font-bold' :
                        // In variance: il colore segue il SIGNIFICATO del delta,
                        // non il segno aritmetico. Per ricavi/margini (best='max')
                        // val>0 e' meglio (verde), val<0 e' peggio (rosso).
                        // Per i costi (best='min') e' invertito: val>0 (costo
                        // aumentato) e' peggio, val<0 (costo diminuito) e' meglio.
                        isVariance && m.key !== 'ndip' && val !== 0 && (
                          (m.best === 'max' && val > 0) || (m.best === 'min' && val < 0)
                        ) ? 'text-emerald-600' :
                        isVariance && m.key !== 'ndip' && val !== 0 && (
                          (m.best === 'max' && val < 0) || (m.best === 'min' && val > 0)
                        ) ? 'text-red-600' :
                        'text-slate-600'
                      }`}>
                        {isVariance && m.key !== 'ndip' && val > 0 ? '+' : ''}
                        {m.pct ? `${val.toFixed(1)}%` : fmt(val)}
                        {!m.pct && m.key !== 'ndip' && ' €'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════
   PAGINA PRINCIPALE — CONFRONTO OUTLET
   ═══════════════════════════════════════ */
const PERIOD_OPTIONS = [
  { value: 'annual', label: 'Annuale' },
  { value: 'q1', label: 'Q1 (Gen-Mar)', months: [1,2,3] },
  { value: 'q2', label: 'Q2 (Apr-Giu)', months: [4,5,6] },
  { value: 'q3', label: 'Q3 (Lug-Set)', months: [7,8,9] },
  { value: 'q4', label: 'Q4 (Ott-Dic)', months: [10,11,12] },
  { value: 'm1', label: 'Gennaio', months: [1] },
  { value: 'm2', label: 'Febbraio', months: [2] },
  { value: 'm3', label: 'Marzo', months: [3] },
  { value: 'm4', label: 'Aprile', months: [4] },
  { value: 'm5', label: 'Maggio', months: [5] },
  { value: 'm6', label: 'Giugno', months: [6] },
  { value: 'm7', label: 'Luglio', months: [7] },
  { value: 'm8', label: 'Agosto', months: [8] },
  { value: 'm9', label: 'Settembre', months: [9] },
  { value: 'm10', label: 'Ottobre', months: [10] },
  { value: 'm11', label: 'Novembre', months: [11] },
  { value: 'm12', label: 'Dicembre', months: [12] },
]

export default function ConfrontoOutlet() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const COMPANY_ID = profile?.company_id
  const { year, quarter } = usePeriod()
  type CostCenterRow = { id?: string; code?: string; label?: string; name?: string; color?: string; sort_order?: number; is_active?: boolean }
  type BudgetEntryRow = { cost_center?: string | null; account_code?: string | null; account_name?: string | null; macro_group?: string | null; budget_amount?: number | null; actual_amount?: number | null; month?: number | null; is_approved?: boolean | null }
  type EmployeeCostRow = { outlet_code?: string | null; employee_id?: string | null; month?: number | null; totale_allocato?: number | null }
  type BalanceRow = Record<string, unknown>
  const [outlets, setOutlets] = useState<CostCenterRow[]>([])
  const [budgetData, setBudgetData] = useState<BudgetEntryRow[]>([])
  const [employeeCosts, setEmployeeCosts] = useState<EmployeeCostRow[]>([])
  const [balanceData, setBalanceData] = useState<BalanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('budget') // 'budget', 'actual', 'variance'
  const [hasData, setHasData] = useState(false)

  // Mappa quarter globale al period locale per filtrare per mesi
  const period = useMemo(() => {
    if (quarter === 'year' || quarter === 'ytd') return 'annual'
    if (quarter.startsWith('q')) return quarter // q1-q4 match directly
    if (quarter.startsWith('m')) return 'm' + parseInt(quarter.slice(1)) // m01→m1, m12→m12
    return 'annual'
  }, [quarter])

  const selectedMonths = PERIOD_OPTIONS.find(p => p.value === period)?.months || null // null = annuale

  // Fetch outlets, budget, balance_sheet_data, and employee costs
  useEffect(() => {
    if (!COMPANY_ID) return
    const companyId = COMPANY_ID
    async function loadData() {
      setLoading(true)
      try {
        const { data: costCenters } = await supabase
          .from('cost_centers')
          .select('*')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('sort_order')

        const { data: budgetEntries } = await supabase
          .from('budget_entries')
          .select('*')
          .eq('company_id', companyId)
          .eq('year', year)

        // Anche balance_sheet_data per confronto
        const { data: bsData } = await supabase
          .from('balance_sheet_data')
          .select('*')
          .eq('company_id', companyId)
          .eq('year', year)

        const { data: empCosts } = await supabase
          .from('v_employee_costs_by_outlet')
          .select('*')
          .eq('year', year)

        setOutlets((costCenters || []) as CostCenterRow[])
        setBudgetData((budgetEntries || []) as BudgetEntryRow[])
        setBalanceData((bsData || []) as BalanceRow[])
        setEmployeeCosts((empCosts || []) as EmployeeCostRow[])
        setHasData((budgetEntries?.length || 0) > 0 || (bsData?.length || 0) > 0)
      } catch (err: unknown) {
        console.error('Error loading data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [year, quarter, COMPANY_ID])

  // Helper: somma un campo da righe filtrate
  function sumField<T extends Record<string, unknown>>(rows: T[], field: keyof T): number {
    return rows.reduce((s, b) => s + (Number(b[field]) || 0), 0)
  }

  // Quota sede: calcola costi sede e ripartisci equamente tra outlet attivi
  const quotaSedePerOutlet = useMemo(() => {
    const sedeEntries = budgetData.filter(b => {
      const cc = (b.cost_center || '').toLowerCase()
      return (cc === 'sede' || cc === 'sede_magazzino' || cc === 'all') &&
        (selectedMonths ? (b.month != null && selectedMonths.includes(b.month)) : true)
    })
    const amountField: 'actual_amount' | 'budget_amount' = viewMode === 'actual' ? 'actual_amount' : 'budget_amount'
    const totalSede = sedeEntries.reduce((s, b) => s + Math.abs(Number(b[amountField]) || 0), 0)
    const activeOutlets = outlets.filter(o => o.code !== 'SEDE' && o.code !== 'sede_magazzino').length
    return activeOutlets > 0 ? totalSede / activeOutlets : 0
  }, [budgetData, outlets, selectedMonths, viewMode])

  // Calculate metrics for each outlet
  const outletMetrics = useMemo(() => {
    if (!outlets.length) return []

    const amtBudget = 'budget_amount'
    const amtActual = 'actual_amount'

    // Build a lookup: for each cost_center code in budget_entries, match to an outlet
    // cost_centers.code may differ from budget_entries.cost_center (case, naming)
    // We match case-insensitively and also try the outlet label (first word, lowercase)
    const allBudgetCCs = [...new Set(budgetData.map(b => b.cost_center).filter((cc): cc is string => Boolean(cc)))]

    return outlets
      .filter(o => o.code !== 'SEDE' && o.code !== 'sede_magazzino') // escludi sede dalla comparazione
      .map(outlet => {
      // Match budget_entries cost_center to this outlet flexibly:
      // Try exact match, then case-insensitive match on code, then on label first word
      const outletCode = (outlet.code || '').toLowerCase()
      const outletLabel = (outlet.label || '').split(' ')[0].toLowerCase()
      const outletName = (outlet.name || '').toLowerCase()

      const matchingCC = allBudgetCCs.find(cc => {
        const ccLower = cc.toLowerCase()
        return ccLower === outletCode || ccLower === outletLabel || ccLower === outletName
      }) || outlet.code // fallback to exact code

      // Filtra per periodo
      const outletBudget = budgetData
        .filter(b => {
          const ccLower = (b.cost_center || '').toLowerCase()
          const matchCode = matchingCC ? ccLower === matchingCC.toLowerCase() : ccLower === outletCode
          return matchCode
        })
        .filter(b => selectedMonths ? (b.month != null && selectedMonths.includes(b.month)) : true)

      if (!outletBudget.length) {
        return { name: outlet.label || '', outletData: outlet, calculatedMetrics: null } as OutletMetric
      }

      // Calcola sia budget che actual per confronto
      function calcMetrics(field: 'budget_amount' | 'actual_amount') {
        // Revenue: account_code starts with '5', or macro_group contains 'Ricavi'
        const ricavi = outletBudget
          .filter(b => b.account_code?.startsWith('5') || b.macro_group?.includes('Ricavi'))
          .reduce((sum, b) => sum + (Number(b[field]) || 0), 0)

        // Costo personale: account_code starts with '6' (personale), or name matches
        const costoPersonale = outletBudget
          .filter(b => b.account_code?.startsWith('6') || b.account_name?.toLowerCase().match(/personal|dipendent|retrib|stipend/))
          .reduce((sum, b) => sum + Math.abs(Number(b[field]) || 0), 0)

        const affitto = outletBudget
          .filter(b => b.account_name?.toLowerCase().match(/affitto|godimento|locazion/))
          .reduce((sum, b) => sum + Math.abs(Number(b[field]) || 0), 0)

        const servizi = outletBudget
          .filter(b => (b.account_name?.toLowerCase().includes('servizi') || b.account_name?.toLowerCase().includes('manut')))
          .reduce((sum, b) => sum + Math.abs(Number(b[field]) || 0), 0)

        // Merci: account_code starts with '7', or macro_group contains Acquisti/Merci
        const merci = outletBudget
          .filter(b => b.account_code?.startsWith('7') || b.macro_group?.includes('Acquisti') || b.macro_group?.includes('Merci'))
          .reduce((sum, b) => sum + Math.abs(Number(b[field]) || 0), 0)

        return { ricavi, costoPersonale, affitto, servizi, merci }
      }

      const budget = calcMetrics(amtBudget)
      const actual = calcMetrics(amtActual)

      // Scegli i dati in base a viewMode.
      // viewMode === 'variance' → mostra lo SCOSTAMENTO consuntivo - preventivo
      // (delta per ogni voce). Senza questo ramo, il tab Scostamento ricadeva
      // su `budget` mostrando dati identici a Preventivo (bug 8.2).
      const isVariance = viewMode === 'variance'
      const data = viewMode === 'actual'
        ? actual
        : isVariance
          ? {
              ricavi: actual.ricavi - budget.ricavi,
              costoPersonale: actual.costoPersonale - budget.costoPersonale,
              affitto: actual.affitto - budget.affitto,
              servizi: actual.servizi - budget.servizi,
              merci: actual.merci - budget.merci,
            }
          : budget

      // Dipendenti dalla view (filtro per mesi se necessario)
      const empRows = employeeCosts
        .filter(e => e.outlet_code === outlet.code)
        .filter(e => selectedMonths ? (e.month != null && selectedMonths.includes(e.month)) : true)
      const personaleCount = new Set(empRows.map(e => e.employee_id).filter((id): id is string => Boolean(id))).size
      const costoPersonaleFromDb = empRows.reduce((sum, e) => sum + (e.totale_allocato || 0), 0)

      // In variance non sostituiamo con il dato DB (che è solo actual):
      // il delta sul costo personale deve restare actual-budget.
      const finalCostoPersonale = isVariance
        ? data.costoPersonale
        : (costoPersonaleFromDb || data.costoPersonale)
      const { ricavi, affitto, servizi, merci } = data

      const costiDiretti = merci + finalCostoPersonale + affitto + servizi
      const quotaSede = isVariance ? 0 : quotaSedePerOutlet
      const costiTotali = costiDiretti + quotaSede

      const margine = ricavi - costiTotali
      // In variance le percentuali sono "delta in punti percentuali"
      // (incidenza_actual - incidenza_budget); altrimenti calcolo classico.
      let marginePct: number, incidenzaPersonale: number, incidenzaAffitto: number
      if (isVariance) {
        const aPersonale = costoPersonaleFromDb || actual.costoPersonale
        const aMargine = actual.ricavi - actual.merci - aPersonale - actual.affitto - actual.servizi - quotaSedePerOutlet
        const bMargine = budget.ricavi - budget.merci - budget.costoPersonale - budget.affitto - budget.servizi - quotaSedePerOutlet
        const aMargPct = actual.ricavi > 0 ? (aMargine / actual.ricavi * 100) : 0
        const bMargPct = budget.ricavi > 0 ? (bMargine / budget.ricavi * 100) : 0
        const aIncP = actual.ricavi > 0 ? (aPersonale / actual.ricavi * 100) : 0
        const bIncP = budget.ricavi > 0 ? (budget.costoPersonale / budget.ricavi * 100) : 0
        const aIncA = actual.ricavi > 0 ? (actual.affitto / actual.ricavi * 100) : 0
        const bIncA = budget.ricavi > 0 ? (budget.affitto / budget.ricavi * 100) : 0
        marginePct = aMargPct - bMargPct
        incidenzaPersonale = aIncP - bIncP
        incidenzaAffitto = aIncA - bIncA
      } else {
        marginePct = ricavi > 0 ? (margine / ricavi * 100) : 0
        incidenzaPersonale = ricavi > 0 ? (finalCostoPersonale / ricavi * 100) : 0
        incidenzaAffitto = ricavi > 0 ? (affitto / ricavi * 100) : 0
      }
      // null = non calcolabile (0 dipendenti, indeterminato). La UI mostra
      // 'N/D'. Bug segnalato: con 0 dipendenti mostrava il totale ricavi.
      const ricavoPerDip = personaleCount > 0 ? ricavi / personaleCount : null

      const costiFissi = finalCostoPersonale + affitto + servizi + quotaSede
      // In variance il breakeven calcolato sui delta è privo di significato
      // (denominatore può essere negativo o piccolissimo). Lo mettiamo a 0,
      // la card lo nasconderà in modalità scostamento.
      let breakeven: number
      if (isVariance) {
        breakeven = 0
      } else {
        const incidenzaMerci = ricavi > 0 ? (merci / ricavi) : 0.5
        breakeven = incidenzaMerci < 1 ? costiFissi / (1 - incidenzaMerci) : 0
      }

      // Varianza budget vs actual (banner sempre visibile sulla card,
      // indipendente dal viewMode → uso quotaSedePerOutlet originale)
      const variance = {
        ricavi: actual.ricavi - budget.ricavi,
        margine: (actual.ricavi - actual.merci - (costoPersonaleFromDb || actual.costoPersonale) - actual.affitto - actual.servizi - quotaSedePerOutlet)
                - (budget.ricavi - budget.merci - (costoPersonaleFromDb || budget.costoPersonale) - budget.affitto - budget.servizi - quotaSedePerOutlet),
        ricaviPct: budget.ricavi > 0 ? ((actual.ricavi - budget.ricavi) / budget.ricavi * 100) : 0,
      }

      // Tracking approvazione: check quanti mesi sono approvati
      const approvedMonths = outletBudget.filter(b => b.is_approved).length
      const totalMonthEntries = outletBudget.length
      const approvalPct = totalMonthEntries > 0 ? Math.round(approvedMonths / totalMonthEntries * 100) : 0

      return {
        name: outlet.label || '',
        outletData: outlet,
        calculatedMetrics: {
          ricavi, margine, marginePct,
          costoPersonale: finalCostoPersonale,
          affitto, servizi, merci,
          costiDiretti, costiTotali,
          personaleCount, ricavoPerDip,
          incidenzaPersonale, incidenzaAffitto,
          breakeven, quotaSede,
          variance, approvalPct,
          budgetRicavi: budget.ricavi,
          actualRicavi: actual.ricavi,
          isVariance, // 8.2: per la UI distinguere modalità Scostamento
        },
      } as OutletMetric
    })
  }, [outlets, budgetData, balanceData, employeeCosts, selectedMonths, viewMode, quotaSedePerOutlet])

  // Rankings
  const rankings = useMemo<Record<string, number>>(() => {
    const withData = outletMetrics.filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => o.calculatedMetrics !== null)
    const sorted = [...withData].sort((a, b) => b.calculatedMetrics.ricavi - a.calculatedMetrics.ricavi)
    const map: Record<string, number> = {}
    sorted.forEach((o, i) => { map[o.name] = i + 1 })
    return map
  }, [outletMetrics])

  // Chart data
  const chartRicavi = useMemo(() => {
    return outletMetrics
      .filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => Boolean(o.calculatedMetrics?.ricavi))
      .map(o => ({
        name: shortOutletName(o.name),
        ricavi: o.calculatedMetrics.ricavi,
        color: o.outletData.color || '#6366f1',
      }))
  }, [outletMetrics])

  const chartMargini = useMemo(() => {
    return outletMetrics
      .filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => o.calculatedMetrics !== null)
      .map(o => ({
        name: shortOutletName(o.name),
        margine: o.calculatedMetrics.margine,
        marginePct: o.calculatedMetrics.marginePct,
        color: o.outletData.color || '#6366f1',
      }))
  }, [outletMetrics])

  // Aggregates
  const totRicavi = outletMetrics.reduce((s, o) => s + (o.calculatedMetrics?.ricavi || 0), 0)
  const totPersonale = outletMetrics.reduce((s, o) => s + (o.calculatedMetrics?.costoPersonale || 0), 0)
  const totDipendenti = outletMetrics.reduce((s, o) => s + (o.calculatedMetrics?.personaleCount || 0), 0)
  const totAffitti = outletMetrics.reduce((s, o) => s + (o.calculatedMetrics?.affitto || 0), 0)
  const avgRicavi = outletMetrics.filter(o => o.calculatedMetrics).length > 0
    ? totRicavi / outletMetrics.filter(o => o.calculatedMetrics).length
    : 0

  // Export Excel (CSV come fallback leggero)
  function exportExcel(): void {
    const rows = outletMetrics.filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => o.calculatedMetrics !== null)
    if (!rows.length) return
    const header = ['Outlet','Ricavi','Margine','Margine %','Dipendenti','€/Dipendente','Costo personale','Affitto','Servizi','Merci','Breakeven','Quota sede','Approvazione %']
    const csvRows = [header.join(';')]
    rows.forEach(o => {
      const m = o.calculatedMetrics
      csvRows.push([
        `"${formatOutletName(o.name)}"`,
        m.ricavi.toFixed(2), m.margine.toFixed(2), m.marginePct.toFixed(1),
        m.personaleCount, (m.ricavoPerDip ?? 0).toFixed(2),
        m.costoPersonale.toFixed(2), m.affitto.toFixed(2),
        m.servizi.toFixed(2), m.merci.toFixed(2),
        m.breakeven.toFixed(2), m.quotaSede.toFixed(2),
        m.approvalPct,
      ].join(';'))
    })
    // Varianza se in modalità scostamento
    if (viewMode === 'variance') {
      csvRows.push('')
      csvRows.push('--- SCOSTAMENTO BUDGET vs CONSUNTIVO ---')
      rows.forEach(o => {
        const v = o.calculatedMetrics.variance
        csvRows.push([`"${formatOutletName(o.name)}"`, `Ricavi: ${v.ricavi.toFixed(2)}`, `(${v.ricaviPct.toFixed(1)}%)`].join(';'))
      })
    }
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Confronto_Outlet_${year}_${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={24} className="animate-spin text-blue-600" />
      </div>
    )
  }

  if (!hasData) {
    return (
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Confronto Outlet</h1>
          <p className="text-sm text-slate-500">Comparazione parallela P&L per outlet</p>
        </div>

        <div className="rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center bg-slate-50/50">
          <AlertCircle size={48} className="text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 mb-2">Nessun dato disponibile</h2>
          <p className="text-sm text-slate-500 mb-4">
            Carica i dati dal Budget o dal Bilancio per visualizzare il confronto tra gli outlet
          </p>
          <button
            onClick={() => window.location.href = '/budget'}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
          >
            Vai al Budget
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Confronto Outlet</h1>
        <p className="text-sm text-slate-500">
          Comparazione parallela P&L per outlet — Anno {year}
        </p>
      </div>

      {/* Filtri: anno, periodo, vista, export */}
      <div className="flex flex-wrap gap-3 items-center">
        <span className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold bg-slate-50">
          {year} — {PERIOD_OPTIONS.find(p => p.value === period)?.label || 'Annuale'}
        </span>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {[
            { value: 'budget', label: 'Preventivo' },
            { value: 'actual', label: 'Consuntivo' },
            { value: 'variance', label: 'Scostamento' },
          ].map(v => (
            <button
              key={v.value}
              onClick={() => setViewMode(v.value)}
              className={`px-3 py-2 text-xs font-medium transition ${
                viewMode === v.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <ExportMenu
            data={outletMetrics
              .filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => o.calculatedMetrics !== null)
              .map(o => {
                const m = o.calculatedMetrics;
                return {
                  outlet: formatOutletName(o.name), ricavi: m.ricavi, margine: m.margine,
                  margine_pct: m.marginePct, dipendenti: m.personaleCount,
                  per_dipendente: m.ricavoPerDip ?? 0, costo_personale: m.costoPersonale,
                  affitto: m.affitto, servizi: m.servizi, merci: m.merci,
                  breakeven: m.breakeven, quota_sede: m.quotaSede,
                };
              })}
            columns={[
              { key: 'outlet', label: 'Outlet' },
              { key: 'ricavi', label: 'Ricavi', format: 'euro' },
              { key: 'margine', label: 'Margine', format: 'euro' },
              { key: 'margine_pct', label: 'Margine %', format: 'percent' },
              { key: 'dipendenti', label: 'Dipendenti' },
              { key: 'per_dipendente', label: '€/Dipendente', format: 'euro' },
              { key: 'costo_personale', label: 'Costo Personale', format: 'euro' },
              { key: 'affitto', label: 'Affitto', format: 'euro' },
              { key: 'servizi', label: 'Servizi', format: 'euro' },
              { key: 'merci', label: 'Merci', format: 'euro' },
              { key: 'breakeven', label: 'Breakeven', format: 'euro' },
              { key: 'quota_sede', label: 'Quota Sede', format: 'euro' },
            ]}
            filename="confronto_outlet"
            title="Confronto Outlet"
          />
        </div>
      </div>

      {/* KPI aggregati */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 inline-flex mb-3"><Store size={20} /></div>
          <div className="text-2xl font-bold text-slate-900">{outletMetrics.filter(o => o.calculatedMetrics).length}</div>
          <div className="text-sm text-slate-500">Outlet con dati</div>
          <div className="text-xs text-slate-400">su {outletMetrics.length} totali</div>
        </div>
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 inline-flex mb-3"><TrendingUp size={20} /></div>
          <div className="text-2xl font-bold text-slate-900">{fmt(totRicavi)} €</div>
          <div className="text-sm text-slate-500">Ricavi totali outlet</div>
          <div className="text-xs text-slate-400">Media: {fmt(avgRicavi)} €</div>
        </div>
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600 inline-flex mb-3"><Users size={20} /></div>
          <div className="text-2xl font-bold text-slate-900">{totDipendenti}</div>
          <div className="text-sm text-slate-500">Dipendenti outlet</div>
          <div className="text-xs text-slate-400">Media: {(totDipendenti / (outletMetrics.filter(o => o.calculatedMetrics).length || 1)).toFixed(1)} per outlet</div>
        </div>
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="p-2.5 rounded-lg bg-purple-50 text-purple-600 inline-flex mb-3"><DollarSign size={20} /></div>
          <div className="text-2xl font-bold text-slate-900">
            {totDipendenti > 0 ? `${fmt(totRicavi / totDipendenti)} €` : 'N/D'}
          </div>
          <div className="text-sm text-slate-500">Ricavo per dipendente</div>
          <div className="text-xs text-slate-400">
            {totDipendenti > 0 ? 'KPI produttività media' : 'Nessun dipendente assegnato agli outlet'}
          </div>
        </div>
      </div>

      {/* Grafici comparativi */}
      {chartRicavi.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Ricavi per outlet */}
          <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Ricavi per outlet</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartRicavi} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <defs>
                  {chartRicavi.map((d, i) => (
                    <linearGradient key={`grad-${i}`} id={`gradient-ricavi-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={d.color} stopOpacity={1} />
                      <stop offset="100%" stopColor={d.color} stopOpacity={0.5} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="name" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="ricavi" radius={[8, 8, 0, 0]} animationDuration={800}>
                  {chartRicavi.map((d, i) => <Cell key={i} fill={`url(#gradient-ricavi-${i})`} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Margine per outlet */}
          <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Margine per outlet</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartMargini} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <defs>
                  {chartMargini.map((d, i) => {
                    const color = d.margine >= 0 ? '#10b981' : '#ef4444'
                    return (
                      <linearGradient key={`grad-margine-${i}`} id={`gradient-margine-${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={1} />
                        <stop offset="100%" stopColor={color} stopOpacity={0.5} />
                      </linearGradient>
                    )
                  })}
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="name" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="margine" radius={[8, 8, 0, 0]} animationDuration={800}>
                  {chartMargini.map((d, i) => (
                    <Cell key={i} fill={`url(#gradient-margine-${i})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tabella benchmark */}
      <TabellaBenchmark outletMetrics={outletMetrics} />

      {/* Cards parallele — confronto diretto */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <BarChart3 size={20} className="text-blue-600" />
          Schede outlet — P&L comparativo
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {outletMetrics.map(o => (
            <OutletCard
              key={o.name}
              name={o.name}
              outletData={o.outletData}
              calculatedMetrics={o.calculatedMetrics}
              ranking={rankings[o.name]}
              onNavigate={() => navigate(`/outlet?id=${o.outletData.id}`)}
            />
          ))}
        </div>
      </div>

      {/* Info nota */}
      <div className="flex items-start gap-3 bg-blue-50/50 border border-blue-200 rounded-xl p-4">
        <AlertCircle size={18} className="text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          <span className="font-semibold">
            {year} — {PERIOD_OPTIONS.find(p => p.value === period)?.label || 'Annuale'}
            {viewMode === 'budget' && ' (Preventivo)'}
            {viewMode === 'actual' && ' (Consuntivo)'}
            {viewMode === 'variance' && ' (Scostamento)'}
          </span>
          <div className="text-xs text-blue-600 mt-1">
            Dati da budget_entries + balance_sheet_data + employee_costs_by_outlet.
            Quota sede ({fmt(quotaSedePerOutlet)} €) ripartita equamente tra outlet.
            {viewMode === 'variance' && ' Le variazioni mostrano consuntivo - preventivo.'}
          </div>
        </div>
      </div>
    </div>
  )
}
