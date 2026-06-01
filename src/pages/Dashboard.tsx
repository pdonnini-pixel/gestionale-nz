import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import PageHelp from '../components/PageHelp'
import PageHeader from '../components/PageHeader'
import { usePeriod } from '../hooks/usePeriod'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, DollarSign, Store, Wallet,
  ArrowUpRight, ArrowRight, Receipt, Percent,
  AlertTriangle, CheckCircle2, Target, Loader, Info,
  Clock, CreditCard, BarChart3, ChevronRight
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import FinancialTooltip from '../components/FinancialTooltip'
import DataFreshness from '../components/DataFreshness'
import { formatOutletName } from '../lib/formatters'

/* ═══════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════ */
const OUTLET_COLORS = ['#6366f1', '#f43f5e', '#06b6d4', '#10b981', '#8b5cf6', '#f97316', '#0ea5e9']

function fmt(n: number | null | undefined, dec = 0): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}

function fmtCompact(n: number | null | undefined): string {
  if (n == null) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return fmt(n)
}

/* ═══════════════════════════════════════
   KPI CARD — cliccabile con drill-down
   ═══════════════════════════════════════ */
interface KpiCardProps {
  title: string
  value: string | number
  subtitle?: string | React.ReactNode
  icon: React.ComponentType<{ size?: number }>
  color?: string
  trend?: number | null
  link?: string
  alert?: boolean
  helpTerm?: string
}

function KpiCard({ title, value, subtitle, icon: Icon, color = 'blue', trend, link, alert, helpTerm }: KpiCardProps) {
  const colorMap: Record<string, { bg: string; text: string; ring: string }> = {
    blue:   { bg: 'bg-blue-50',    text: 'text-blue-600',    ring: 'ring-blue-100' },
    green:  { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    amber:  { bg: 'bg-amber-50',   text: 'text-amber-600',   ring: 'ring-amber-100' },
    red:    { bg: 'bg-red-50',     text: 'text-red-600',     ring: 'ring-red-100' },
    cyan:   { bg: 'bg-cyan-50',    text: 'text-cyan-600',    ring: 'ring-cyan-100' },
  }
  const c = colorMap[color] || colorMap.blue

  const card = (
    <div className={`bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-blue-200 transition cursor-pointer group relative ${alert ? 'ring-2 ' + c.ring : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <div className={`p-2 rounded-lg ${c.bg} ${c.text}`}><Icon size={18} /></div>
        {trend != null && trend !== 0 && (
          <span className={`flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
            trend > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
          }`}>
            {trend > 0 ? <ArrowUpRight size={11} /> : <TrendingDown size={11} />}
            {trend > 0 ? '+' : ''}{trend.toFixed(1)}%
          </span>
        )}
      </div>
      <div className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{value}</div>
      <div className="text-xs sm:text-sm text-slate-500 mt-0.5">
        {helpTerm ? <FinancialTooltip term={helpTerm}>{title}</FinancialTooltip> : title}
      </div>
      {subtitle && <div className="text-[11px] text-slate-400 mt-1">{subtitle}</div>}
      <div className="flex items-center gap-1 text-[11px] text-blue-500 mt-2 font-medium opacity-0 group-hover:opacity-100 transition">
        Dettaglio <ChevronRight size={11} />
      </div>
    </div>
  )
  return link ? <Link to={link}>{card}</Link> : card
}

/* ═══════════════════════════════════════
   ALERT ITEM — azionabile con link
   ═══════════════════════════════════════ */
interface AlertItemProps {
  icon: React.ComponentType<{ size?: number; className?: string }>
  color: string
  title: string
  description?: string
  link?: string
  linkLabel?: string
}

function AlertItem({ icon: Icon, color, title, description, link, linkLabel }: AlertItemProps) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${color}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="text-xs opacity-75 mt-0.5">{description}</div>}
      </div>
      {link && (
        <Link to={link} className="text-xs font-medium shrink-0 flex items-center gap-1 hover:underline">
          {linkLabel || 'Gestisci'} <ArrowRight size={11} />
        </Link>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════
   COMPACT SPARKLINE TOOLTIP
   ═══════════════════════════════════════ */
function SparklineTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label?: string; entrate?: number; uscite?: number } }> }) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="text-slate-500 mb-1">{d.label}</div>
      <div className="flex items-center gap-3">
        <span className="text-emerald-600 font-semibold">+{fmt(d.entrate)} €</span>
        <span className="text-red-500 font-semibold">-{fmt(d.uscite)} €</span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════
   DASHBOARD PRINCIPALE
   ═══════════════════════════════════════ */
export default function Dashboard() {
  const { profile } = useAuth()
  const labels = useCompanyLabels()
  const { year, quarter, getDateRange } = usePeriod()
  const COMPANY_ID = profile?.company_id
  const periodRange = getDateRange()

  // State
  const [loading, setLoading] = useState(true)
  const [ricavi, setRicavi] = useState(0)
  const [ricaviPrevYear, setRicaviPrevYear] = useState(0)
  const [utile, setUtile] = useState(0)
  const [totalCosti, setTotalCosti] = useState(0)
  const [liquidita, setLiquidita] = useState(0)
  const [debtiFin, setDebtiFin] = useState(0)
  const [staffCosts, setStaffCosts] = useState(0)
  // TODO: tighten type — Supabase data
  const [outletsData, setOutletsData] = useState<any[]>([])
  const [cashFlowDaily, setCashFlowDaily] = useState<any[]>([])
  const [cashFlowTotals, setCashFlowTotals] = useState({ entrate: 0, uscite: 0 })
  const [scaduteCount, setScaduteCount] = useState(0)
  const [prossimeCount, setProssimeCount] = useState(0)
  const [uncategorizedMov, setUncategorizedMov] = useState(0)
  const [dataSource, setDataSource] = useState<string | null>('')
  // TODO: tighten type — Supabase data
  const [dailyRevenue, setDailyRevenue] = useState<any[]>([])
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  // Anno di gestione (budget_confronto): previsto fine anno + presenza costi + mesi chiusi
  const [ricaviPrevisto, setRicaviPrevisto] = useState(0)
  const [costiPresent, setCostiPresent] = useState(false)
  const [mesiConsuntivo, setMesiConsuntivo] = useState(0)
  // Timestamp saldo liquidità (v_cash_position.last_updated_at)
  const [liquiditaUpdatedAt, setLiquiditaUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    if (!COMPANY_ID) return
    const YEAR = year
    const range = getDateRange()

    const fetchData = async () => {
      try {
        setLoading(true)
        // Reset esplicito al cambio anno: senza questo, se la query del
        // nuovo anno non trova dati, gli state mantengono il valore
        // dell'anno precedente e si vede lo stesso ricavo su piu' anni.
        setRicavi(0)
        setRicaviPrevYear(0)
        setUtile(0)
        setTotalCosti(0)
        setStaffCosts(0)
        setDataSource(null)
        setRicaviPrevisto(0)
        setCostiPresent(false)
        setMesiConsuntivo(0)

        // 1. Financial data — try views first, then bilancio, then fatture
        let hasViewData = false
        try {
          const { data: dashData } = await supabase
            .from('v_executive_dashboard')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .eq('year', YEAR)
            .maybeSingle()

          if (dashData?.total_revenue) {
            setRicavi(dashData.total_revenue)
            setUtile(dashData.total_net_result || 0)
            setTotalCosti(dashData.total_cogs || 0)
            hasViewData = true
            setDataSource('views')
          }
        } catch (e: unknown) { console.warn('v_executive_dashboard:', (e as Error).message) }

        if (!hasViewData) {
          const { data: bsData } = await supabase
            .from('balance_sheet_data')
            .select('account_code, amount')
            .eq('company_id', COMPANY_ID)
            .eq('year', YEAR)
            .eq('period_type', 'annuale')
            .eq('section', 'conto_economico')

          if (bsData && bsData.length > 0) {
            const bs: Record<string, number> = {}
            bsData.forEach(r => { if (r.account_code) bs[r.account_code] = r.amount ?? 0 })
            setRicavi(bs.ricavi_vendite || 0)
            setUtile(bs.utile_netto || 0)
            setTotalCosti(bs.totale_costi_produzione || 0)
            setStaffCosts(bs.totale_personale || 0)
            hasViewData = true
            setDataSource('bilancio')
          }
        }

        // 1b. Anno di gestione SENZA bilancio depositato (es. 2026): consuntivo + previsionale
        // dalle STESSE fonti di "Budget e Controllo" (budget_confronto), per non divergere.
        // Ricavi = conti che iniziano con '5' (stesso criterio di ContoEconomico/BudgetControl).
        //  - cons_monthly = CONSUNTIVO granitico (mesi chiusi)
        //  - rev_monthly  = PREVISIONALE/revisione full-year
        //  - prev_monthly = preventivo COSTI (può non esistere ancora: in tal caso margine = "—")
        if (!hasViewData) {
          const { data: cf } = await supabase
            .from('budget_confronto')
            .select('account_code, entry_type, amount, cost_center, month')
            .eq('company_id', COMPANY_ID)
            .eq('year', YEAR)
            .in('entry_type', ['cons_monthly', 'rev_monthly', 'prev_monthly'])
            .range(0, 9999)

          if (cf && cf.length > 0) {
            const isExcludedCc = (cc: string | null | undefined) => {
              const x = (cc || '').toLowerCase()
              return x === 'rettifica_bilancio' || x === 'spese_non_divise'
            }
            const isRevenue = (ac: string | null | undefined) => (ac || '').startsWith('5')
            let consRev = 0, prevRev = 0, consCost = 0, prevCost = 0
            let hasCost = false
            const consMonths = new Set<number>()
            cf.forEach(r => {
              if (isExcludedCc(r.cost_center)) return
              const amt = Number(r.amount) || 0
              const rev = isRevenue(r.account_code)
              if (!rev) hasCost = true
              if (r.entry_type === 'cons_monthly') {
                if (rev) { consRev += amt; if (r.month) consMonths.add(Number(r.month)) }
                else consCost += amt
              } else if (r.entry_type === 'rev_monthly') {
                if (rev) prevRev += amt; else prevCost += amt
              } else if (r.entry_type === 'prev_monthly') {
                if (!rev) prevCost += amt
              }
            })
            // prevCost/consCost usati solo quando i costi esistono davvero (hasCost)
            void prevCost
            if (consRev > 0 || prevRev > 0) {
              setRicavi(consRev)
              setRicaviPrevisto(prevRev)
              setMesiConsuntivo(consMonths.size)
              setCostiPresent(hasCost)
              if (hasCost) {
                setTotalCosti(consCost)
                setUtile(consRev - consCost)
              }
              hasViewData = true
              setDataSource('gestione')
            }
          }
        }

        if (!hasViewData) {
          try {
            const { data: invData } = await supabase
              .from('electronic_invoices')
              .select('gross_amount')
              .eq('company_id', COMPANY_ID)
              .gte('invoice_date', range.from)
              .lte('invoice_date', range.to)

            if (invData && invData.length > 0) {
              setTotalCosti(invData.reduce((s, r) => s + Number(r.gross_amount || 0), 0))
              setDataSource('fatture')
            }
          } catch (e) {}
        }

        // 2. Previous year for trend
        let prevRicavi = 0
        try {
          const { data: dashPrev } = await supabase
            .from('v_executive_dashboard')
            .select('total_revenue')
            .eq('company_id', COMPANY_ID)
            .eq('year', YEAR - 1)
            .maybeSingle()
          prevRicavi = dashPrev?.total_revenue || 0
        } catch (e) {}
        if (!prevRicavi) {
          const { data: bsPrev } = await supabase
            .from('balance_sheet_data')
            .select('amount')
            .eq('company_id', COMPANY_ID)
            .eq('year', YEAR - 1)
            .eq('period_type', 'annuale')
            .eq('section', 'conto_economico')
            .eq('account_code', 'ricavi_vendite')
            .maybeSingle()
          prevRicavi = bsPrev?.amount || 0
        }
        setRicaviPrevYear(prevRicavi)

        // 3. Outlet ranking — try view first, fallback to daily_revenue aggregation
        try {
          const { data: outletsRaw } = await supabase
            .from('v_outlet_ranking')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .eq('year', YEAR)
            .order('rank_revenue', { ascending: true })

          if (outletsRaw && outletsRaw.length > 0) {
            setOutletsData(outletsRaw.map((o, i) => ({
              name: o.outlet_name ?? '',
              ricavi: o.ytd_revenue || 0,
              dip: ((o as { staff_count?: number | null }).staff_count) ?? 0,
              colore: OUTLET_COLORS[i % OUTLET_COLORS.length],
            })))
          } else {
            // Fallback 2: aggregate daily_revenue per outlet for the year
            const yearStart = `${YEAR}-01-01`
            const yearEnd = `${YEAR}-12-31`

            // Fetch daily_revenue without FK join (may fail), and outlets separately
            const [{ data: drAgg }, { data: outletsList }] = await Promise.all([
              supabase
                .from('daily_revenue')
                .select('outlet_id, gross_revenue')
                .eq('company_id', COMPANY_ID)
                .gte('date', yearStart)
                .lte('date', yearEnd),
              supabase
                .from('outlets')
                .select('id, name, code, is_active')
                .eq('company_id', COMPANY_ID)
                .eq('is_active', true)
            ])

            interface OutletAggLocal { name: string; ricavi: number }
            const outletNameMap: Record<string, string> = {}
            ;(outletsList || []).forEach(o => { outletNameMap[o.id] = o.name })

            if (drAgg && drAgg.length > 0) {
              // Group by outlet_id and sum gross_revenue
              const outletMap: Record<string, OutletAggLocal> = {}
              drAgg.forEach(r => {
                const oid = r.outlet_id
                if (!oid) return
                if (!outletMap[oid]) {
                  outletMap[oid] = { name: outletNameMap[oid] || '?', ricavi: 0 }
                }
                outletMap[oid].ricavi += Number(r.gross_revenue) || 0
              })
              const sorted = Object.values(outletMap).sort((a, b) => b.ricavi - a.ricavi)
              setOutletsData(sorted.map((o, i) => ({
                name: o.name,
                ricavi: o.ricavi,
                dip: 0,
                colore: OUTLET_COLORS[i % OUTLET_COLORS.length],
              })))
            }

            // Sprint 2 (Patrizio 29/05/2026): PRIORITA' assoluta = dati Lilian
            // budget_confronto.cons_monthly (consuntivo reale, aggregato per outlet).
            // Hotfix 29/05 sera: NO 'return' dentro questa funzione (rompeva il
            // setLoading(false) successivo -> 'Cruscotto in caricamento' infinito).
            // Uso un flag boolean per saltare il Fallback 3 se ho gia' caricato.
            let lilianDataLoaded = false
            if (!drAgg || drAgg.length === 0) {
              const { data: cfData } = await supabase
                .from('budget_confronto')
                .select('cost_center, account_code, amount')
                .eq('company_id', COMPANY_ID)
                .eq('year', YEAR)
                .eq('entry_type', 'cons_monthly')
                .like('account_code', '5%')
                .range(0, 9999)
              if (cfData && cfData.length > 0) {
                const ricaviByCc: Record<string, number> = {}
                cfData.forEach(r => {
                  const cc = (r.cost_center || '').toLowerCase()
                  if (!cc || cc === 'rettifica_bilancio' || cc === 'spese_non_divise') return
                  ricaviByCc[cc] = (ricaviByCc[cc] || 0) + (Number(r.amount) || 0)
                })
                const outletsByCc: OutletAggLocal[] = (outletsList || [])
                  .filter(o => o.is_active !== false)
                  .map(o => {
                    const codeKey = String(o.code || '').toLowerCase()
                    const nameKey = String(o.name || '').toLowerCase()
                    const ricavi = ricaviByCc[codeKey] ?? ricaviByCc[nameKey] ?? 0
                    return { name: o.name || o.code || '?', ricavi }
                  })
                if (outletsByCc.some(o => o.ricavi > 0)) {
                  const sorted = outletsByCc.sort((a, b) => b.ricavi - a.ricavi)
                  setOutletsData(sorted.map((o, i) => ({
                    name: o.name,
                    ricavi: o.ricavi,
                    dip: 0,
                    colore: OUTLET_COLORS[i % OUTLET_COLORS.length],
                  })))
                  lilianDataLoaded = true
                }
              }
            }

            // Fallback 3: use budget_entries revenue data per cost_center
            if (!lilianDataLoaded && (!drAgg || drAgg.length === 0)) {
              // Query ricavi: tutti i conti corrispettivi outlet (510101..510199)
              // + legacy RIC001/2/3. Prima era .in() con SOLO 2 codici hardcoded
              // (510107 Valdichiana, 510108 Barberino) — mostrava solo 2 outlet.
              const { data: budgetData } = await supabase
                .from('budget_entries')
                .select('cost_center, budget_amount')
                .eq('company_id', COMPANY_ID)
                .eq('year', YEAR)
                .or('account_code.like.510%,account_code.like.RIC%')
                .range(0, 9999)

              // Aggrega ricavi per cost_center (chiave: stringa code/nome outlet)
              const ricaviByCc: Record<string, number> = {}
              ;(budgetData || []).forEach(r => {
                const cc = (r.cost_center || '').toLowerCase()
                if (!cc) return
                ricaviByCc[cc] = (ricaviByCc[cc] || 0) + (Number(r.budget_amount) || 0)
              })

              // Anagrafica outlets (TUTTI quelli attivi, anche con ricavi 0).
              // Lookup cost_center per outlet: prova in ordine code (lowercase),
              // poi name (lowercase). Match con budget_entries.cost_center.
              const outletsByCc: OutletAggLocal[] = (outletsList || [])
                .filter(o => o.is_active !== false)
                .map(o => {
                  const codeKey = String(o.code || '').toLowerCase()
                  const nameKey = String(o.name || '').toLowerCase()
                  const ricavi = ricaviByCc[codeKey] ?? ricaviByCc[nameKey] ?? 0
                  return { name: o.name || o.code || '?', ricavi }
                })

              if (outletsByCc.length > 0) {
                // Ordine: prima i top per ricavi (decrescente), poi alfabetico
                const sorted = outletsByCc.sort((a, b) => {
                  if (b.ricavi !== a.ricavi) return b.ricavi - a.ricavi
                  return a.name.localeCompare(b.name)
                })
                setOutletsData(sorted.map((o, i) => ({
                  name: o.name,
                  ricavi: o.ricavi,
                  dip: 0,
                  colore: OUTLET_COLORS[i % OUTLET_COLORS.length],
                })))
              }

              // Fallback 3b: try with RIC% pattern and actual_amount for previous or current year
              if (!budgetData || budgetData.length === 0) {
                const { data: budgetRic } = await supabase
                  .from('budget_entries')
                  .select('cost_center, actual_amount, budget_amount')
                  .eq('company_id', COMPANY_ID)
                  .eq('year', YEAR)
                  .range(0, 9999)

                if (budgetRic && budgetRic.length > 0) {
                  const bMap: Record<string, OutletAggLocal> = {}
                  budgetRic.forEach(r => {
                    const cc = r.cost_center
                    if (!cc) return
                    // Escludi rettifiche bilancio e spese non divise dalla vista outlet
                    if (cc === 'rettifica_bilancio' || cc === 'spese_non_divise') return
                    const amt = Number(r.actual_amount) || Number(r.budget_amount) || 0
                    if (!bMap[cc]) bMap[cc] = { name: cc.charAt(0).toUpperCase() + cc.slice(1), ricavi: 0 }
                    bMap[cc].ricavi += amt
                  })
                  const sorted = Object.values(bMap).sort((a, b) => b.ricavi - a.ricavi)
                  if (sorted.length > 0) {
                    setOutletsData(sorted.map((o, i) => ({
                      name: o.name,
                      ricavi: o.ricavi,
                      dip: 0,
                      colore: OUTLET_COLORS[i % OUTLET_COLORS.length],
                    })))
                  }
                }
              }
            }
          }
        } catch (e) { console.warn('Outlet ranking fallback error:', e) }

        // 4. Cash position
        try {
          const { data: cashData } = await supabase
            .from('v_cash_position')
            .select('current_balance, last_updated_at')
            .eq('company_id', COMPANY_ID)
          // last_updated_at non è ancora nei tipi generati della vista -> cast esplicito
          const cashRows = (cashData || []) as unknown as Array<{ current_balance?: number | null; last_updated_at?: string | null }>
          setLiquidita(cashRows.reduce((s, c) => s + (c.current_balance || 0), 0))
          const maxTs = cashRows.reduce<string | null>((m, c) => {
            const ts = c.last_updated_at
            return ts && (!m || ts > m) ? ts : m
          }, null)
          setLiquiditaUpdatedAt(maxTs)
        } catch (e) {}

        // 5. Loans
        try {
          const { data: loansData } = await supabase
            .from('v_loans_overview')
            .select('total_amount')
            .eq('company_id', COMPANY_ID)
          setDebtiFin((loansData || []).reduce((s, l) => s + (l.total_amount || 0), 0))
        } catch (e) {}

        // 6. Cash flow daily (last 30 days) — sparkline
        try {
          const thirtyDaysAgo = new Date()
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
          const fromDate = thirtyDaysAgo.toISOString().split('T')[0]

          const { data: cmData } = await supabase
            .from('cash_movements')
            .select('date, type, amount')
            .eq('company_id', COMPANY_ID)
            .gte('date', fromDate)
            .order('date', { ascending: true })

          if (cmData && cmData.length > 0) {
            interface DayRow { date: string; entrate: number; uscite: number; netto: number; label?: string }
            const dayMap: Record<string, DayRow> = {}
            let totE = 0, totU = 0
            cmData.forEach(row => {
              const dk = row.date
              if (!dayMap[dk]) dayMap[dk] = { date: dk, entrate: 0, uscite: 0, netto: 0 }
              const abs = Math.abs(Number(row.amount) || 0)
              if (row.type === 'entrata') {
                dayMap[dk].entrate += abs
                totE += abs
              } else {
                dayMap[dk].uscite += abs
                totU += abs
              }
            })
            // Compute running netto
            const daily = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date))
            let running = 0
            daily.forEach(d => {
              running += d.entrate - d.uscite
              d.netto = running
              d.label = new Date(d.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
            })
            setCashFlowDaily(daily)
            setCashFlowTotals({ entrate: totE, uscite: totU })
          }
        } catch (e) {}

        // 7. Scadenze count
        try {
          const today = new Date().toISOString().split('T')[0]
          const in7days = new Date()
          in7days.setDate(in7days.getDate() + 7)
          const in7str = in7days.toISOString().split('T')[0]

          const [scadRes, prossRes] = await Promise.all([
            supabase.from('payables').select('id', { count: 'exact' })
              .eq('company_id', COMPANY_ID).eq('status', 'scaduto'),
            supabase.from('payables').select('id', { count: 'exact' })
              .eq('company_id', COMPANY_ID).eq('status', 'in_scadenza'),
          ])
          setScaduteCount(scadRes.count || 0)
          setProssimeCount(prossRes.count || 0)
        } catch (e) {}

        // 8. Movimenti bancari senza categoria contabile (campo reale 'category').
        // NB: nella vista cash_movements le colonne cost_category_id/ai_category_id sono
        // SEMPRE NULL (non sono dati reali) -> la vecchia query contava TUTTI i movimenti.
        // Si conta il campo reale 'category' IS NULL.
        try {
          const { count } = await supabase
            .from('cash_movements')
            .select('id', { count: 'exact' })
            .eq('company_id', COMPANY_ID)
            .is('category', null)
          setUncategorizedMov(count || 0)
        } catch (e) {}

        // 9. Daily revenue (most recent record per outlet) for ranking
        try {
          const { data: drData } = await supabase
            .from('daily_revenue')
            .select('outlet_id, gross_revenue, date, outlets(name)')
            .eq('company_id', COMPANY_ID)
            .order('date', { ascending: false })

          // Keep only the most recent record per outlet
          type DailyRow = { outlet_id: string | null; gross_revenue: number | null; date: string | null; outlets: { name: string } | null }
          const latestByOutlet: Record<string, DailyRow> = {}
          ;((drData || []) as unknown as DailyRow[]).forEach(r => {
            if (!r.outlet_id) return
            if (!latestByOutlet[r.outlet_id]) {
              latestByOutlet[r.outlet_id] = r
            }
          })

          setDailyRevenue(Object.values(latestByOutlet).map(r => ({
            outlet: r.outlets?.name || '?',
            revenue: Number(r.gross_revenue) || 0,
            date: r.date ?? '',
          })))
        } catch (e) {}

        setLastUpdate(new Date())
        setLoading(false)
      } catch (err: unknown) {
        console.error('Dashboard fetch error:', err)
        setLoading(false)
      }
    }

    fetchData()
  }, [COMPANY_ID, year, quarter])

  // Derived
  const deltaRicaviPct = ricaviPrevYear > 0 ? ((ricavi - ricaviPrevYear) / ricaviPrevYear * 100) : 0
  const pfn = liquidita - debtiFin
  const marginePct = ricavi > 0 ? (utile / ricavi * 100) : 0
  const cashFlowNetto = cashFlowTotals.entrate - cashFlowTotals.uscite
  // Modalità "anno di gestione" (consuntivo/previsionale da budget_confronto, no bilancio)
  const isGestione = dataSource === 'gestione'
  // Il margine è calcolabile solo se i costi esistono (bilancio depositato, oppure
  // costi presenti in budget_confronto). Per l'anno di gestione senza costi -> "—".
  const margineAvailable = dataSource === 'fatture' ? false : (isGestione ? costiPresent : ricavi > 0)
  // Data/ora del saldo liquidità da v_cash_position.last_updated_at
  const liquiditaTs = liquiditaUpdatedAt ? new Date(liquiditaUpdatedAt) : null
  const liquiditaTsLabel = liquiditaTs
    ? liquiditaTs.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  // Loading
  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <Loader className="animate-spin mx-auto text-slate-400" size={32} />
          <p className="text-sm text-slate-500">Caricamento cruscotto...</p>
        </div>
      </div>
    )
  }

  // Build alerts
  const alerts: AlertItemProps[] = []
  if (scaduteCount > 0) {
    alerts.push({
      icon: AlertTriangle,
      color: 'bg-red-50 border-red-200 text-red-700',
      title: `${scaduteCount} fatture scadute`,
      description: 'Pagamenti non effettuati oltre la data di scadenza',
      link: '/scadenzario',
      linkLabel: 'Gestisci',
    })
  }
  if (pfn < 0) {
    alerts.push({
      icon: AlertTriangle,
      color: 'bg-red-50 border-red-200 text-red-700',
      title: `PFN negativa: ${fmtCompact(pfn)} €`,
      description: 'Posizione Finanziaria Netta: debiti > liquidità',
      link: '/banche',
      linkLabel: 'Banche',
    })
  }
  if (utile < 0) {
    alerts.push({
      icon: TrendingDown,
      color: 'bg-amber-50 border-amber-200 text-amber-700',
      title: `Esercizio in perdita: ${fmtCompact(utile)} €`,
      description: `Margine: ${marginePct.toFixed(1)}% — analizza i costi`,
      link: '/conto-economico',
      linkLabel: 'Analizza',
    })
  }
  if (prossimeCount > 0) {
    alerts.push({
      icon: Clock,
      color: 'bg-amber-50 border-amber-200 text-amber-700',
      title: `${prossimeCount} scadenze prossime 7 giorni`,
      link: '/scadenzario',
      linkLabel: 'Vedi',
    })
  }
  if (uncategorizedMov > 0) {
    alerts.push({
      icon: CreditCard,
      color: 'bg-blue-50 border-blue-200 text-blue-700',
      title: `${uncategorizedMov} movimenti bancari senza categoria contabile`,
      description: 'Assegna la categoria dalla lista movimenti bancari',
      link: '/banche?tab=movimenti&filter=senza-categoria',
      linkLabel: 'Vai ai movimenti',
    })
  }
  if (utile > 0) {
    alerts.push({
      icon: CheckCircle2,
      color: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      title: `Esercizio in utile: +${fmtCompact(utile)} €`,
      description: `Margine: ${marginePct.toFixed(1)}%`,
    })
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title={`Buongiorno, ${profile?.first_name || 'Patrizio'}`}
        subtitle={`Cruscotto direzionale — ${periodRange.label}${dataSource === 'bilancio' ? ' · Dati da bilancio importato' : ''}`}
        actions={lastUpdate ? <DataFreshness lastUpdate={lastUpdate} source="Dati" /> : undefined}
      />

      {/* ─── 4 KPI PRINCIPALI ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          icon={DollarSign} title="Ricavi" color={dataSource === 'fatture' ? 'amber' : 'blue'}
          value={ricavi > 0 ? `${fmt(ricavi, 0)} €` : '—'}
          trend={!isGestione && ricavi > 0 ? deltaRicaviPct : null}
          subtitle={
            isGestione ? (
              <span className="block space-y-1">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                  Consuntivo {mesiConsuntivo > 0 ? `${mesiConsuntivo} mesi chiusi` : 'ad oggi'} · granitico
                </span>
                <span className="block text-slate-500">
                  Previsto fine anno: <strong className="text-slate-700">{fmt(ricaviPrevisto, 0)} €</strong>
                  <span className="ml-1 text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">previsionale</span>
                </span>
              </span>
            ) : ricavi > 0 ? (
              ricaviPrevYear > 0 ? `vs ${fmt(ricaviPrevYear, 0)} € anno prec.` : periodRange.label
            ) : (
              `Nessun dato per il ${year} — inseriscili in Budget e Controllo`
            )
          }
          link={isGestione ? '/budget' : '/conto-economico'}
        />
        <KpiCard
          icon={Percent} title={dataSource === 'fatture' ? 'Costi' : 'Margine netto'} helpTerm="margine"
          color={dataSource === 'fatture' ? 'blue' : !margineAvailable ? 'amber' : utile >= 0 ? 'green' : 'red'}
          value={
            dataSource === 'fatture' ? `${fmt(totalCosti, 0)} €`
            : margineAvailable ? `${marginePct.toFixed(1)}%`
            : '—'
          }
          subtitle={
            dataSource === 'fatture' ? `Totale fatture passive ${year}`
            : margineAvailable ? `Utile: ${fmt(utile, 0)} €`
            : 'Margine disponibile dopo l\'inserimento dei costi'
          }
          link={dataSource === 'fatture' ? `/fatturazione?year=${year}` : isGestione ? '/budget' : '/conto-economico'}
          alert={margineAvailable && dataSource !== 'fatture' && utile < 0}
        />
        <KpiCard
          icon={Wallet} title="Liquidità" color={liquidita >= 0 ? 'cyan' : 'red'}
          value={`${fmt(liquidita, 2)} €`}
          subtitle={liquiditaTsLabel ? `Saldo conti correnti al ${liquiditaTsLabel}` : 'Saldo conti correnti'}
          link="/banche"
          alert={liquidita < 0}
        />
        <KpiCard
          icon={Receipt} title="Scadenze aperte" color={scaduteCount > 0 ? 'red' : 'amber'}
          value={scaduteCount + prossimeCount}
          subtitle={scaduteCount > 0 ? `${scaduteCount} scadute · ${prossimeCount} prossime` : `${prossimeCount} nei prossimi 7gg`}
          link="/scadenzario"
          alert={scaduteCount > 0}
        />
      </div>

      {/* ─── ALERT & AZIONI + CASHFLOW ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Alert & Azioni */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-500" /> Alert & Azioni
            </h2>
            {alerts.length > 0 && (
              <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                {alerts.length}
              </span>
            )}
          </div>
          <div className="p-3 space-y-2 max-h-[280px] overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="flex items-center gap-3 py-6 px-2 text-center">
                <CheckCircle2 size={20} className="text-emerald-400 mx-auto" />
                <p className="text-sm text-slate-500">Nessuna segnalazione — tutto sotto controllo</p>
              </div>
            ) : (
              alerts.map((a, i) => <AlertItem key={i} {...a} />)
            )}
          </div>
        </div>

        {/* Cashflow Compatto — Sparkline */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Wallet size={15} className="text-emerald-500" /> Cashflow ultimi 30 giorni
            </h2>
            <Link to="/banche" className="text-xs text-blue-500 font-medium hover:text-blue-700 flex items-center gap-1">
              Banche <ChevronRight size={12} />
            </Link>
          </div>

          {cashFlowDaily.length === 0 ? (
            <div className="p-4">
              <div className="flex items-center gap-3 py-4 px-3 bg-slate-50 rounded-lg">
                <Info size={16} className="text-slate-400 shrink-0" />
                <p className="text-xs text-slate-500">
                  Importa estratti conto da <Link to="/import-hub" className="text-blue-500 hover:underline">ImportHub</Link> per visualizzare il cashflow
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4">
              {/* Summary inline */}
              <div className="flex items-center gap-4 mb-3">
                <div>
                  <span className="text-xs text-slate-400">Entrate</span>
                  <div className="text-sm font-bold text-emerald-600">+{fmt(cashFlowTotals.entrate, 2)} €</div>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Uscite</span>
                  <div className="text-sm font-bold text-red-500">-{fmt(cashFlowTotals.uscite, 2)} €</div>
                </div>
                <div className="ml-auto">
                  <span className="text-xs text-slate-400">Netto</span>
                  <div className={`text-sm font-bold ${cashFlowNetto >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {cashFlowNetto >= 0 ? '+' : ''}{fmt(cashFlowNetto, 2)} €
                  </div>
                </div>
              </div>
              {/* Sparkline area chart */}
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={cashFlowDaily} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={cashFlowNetto >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={cashFlowNetto >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="netto"
                    stroke={cashFlowNetto >= 0 ? '#10b981' : '#ef4444'}
                    strokeWidth={2}
                    fill="url(#cashGrad)"
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                  <XAxis dataKey="label" hide />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip content={<SparklineTooltip />} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ─── OUTLET RANKING ─── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Store size={15} className="text-indigo-500" /> Performance {labels.pointOfSalePlural}
          </h2>
          <Link to="/confronto-outlet" className="text-xs text-blue-500 font-medium hover:text-blue-700 flex items-center gap-1">
            Confronto completo <ChevronRight size={12} />
          </Link>
        </div>

        {dataSource === 'fatture' || outletsData.length === 0 || (outletsData.length === 1 && !outletsData[0]?.name) ? (
          <div className="p-4">
            <div className="flex items-center gap-3 py-4 px-3 bg-amber-50 rounded-lg">
              <Info size={16} className="text-amber-500 shrink-0" />
              <p className="text-xs text-slate-600">
                {dataSource === 'fatture'
                  ? <>Dati per {labels.pointOfSalePluralLower} non disponibili per il {year}. Importa il bilancio {year} o <Link to="/allocazione-fornitori" className="text-blue-500 hover:underline">assegna i fornitori ai {labels.pointOfSalePluralLower}</Link>.</>
                  : <>Nessun dato {labels.pointOfSaleLower}. <Link to="/import-hub" className="text-blue-500 hover:underline">Importa dati</Link> per vedere il ranking.</>
                }
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr className="text-[11px] text-slate-500 uppercase tracking-wider">
                    <th className="py-2 px-4 text-left font-medium w-10">#</th>
                    <th className="py-2 px-4 text-left font-medium">{labels.pointOfSale}</th>
                    <th className="py-2 px-4 text-right font-medium">Ricavi {year}</th>
                    <th className="py-2 px-4 text-right font-medium">% Tot</th>
                    <th className="py-2 px-4 text-right font-medium">Ultimo</th>
                    <th className="py-2 px-4 text-right font-medium">Staff</th>
                    <th className="py-2 px-4 text-right font-medium">€/Dip</th>
                    <th className="py-2 px-4 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {outletsData.map((o, i) => {
                    const dailyRev = dailyRevenue.find(d => d.outlet === o.name)
                    const maxRicavi = outletsData[0]?.ricavi || 1
                    const barWidth = Math.round((o.ricavi / maxRicavi) * 100)
                    return (
                      <tr key={o.name} className="border-t border-slate-50 hover:bg-slate-50/50 transition text-sm group">
                        <td className="py-2.5 px-4">
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                            i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-100 text-slate-600' : i === 2 ? 'bg-orange-50 text-orange-600' : 'text-slate-400'
                          }`}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: o.colore }} />
                            <span className="font-medium text-slate-900">{formatOutletName(o.name)}</span>
                          </div>
                          {/* Mini bar */}
                          <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden w-32">
                            <div className="h-full rounded-full" style={{ width: `${barWidth}%`, backgroundColor: o.colore }} />
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-semibold text-slate-900">{fmt(o.ricavi)} €</td>
                        <td className="py-2.5 px-4 text-right text-slate-500 text-xs">{ricavi > 0 ? (o.ricavi / ricavi * 100).toFixed(1) : '—'}%</td>
                        <td className="py-2.5 px-4 text-right">
                          {dailyRev ? (
                            <span className="text-emerald-600 font-medium">{fmt(dailyRev.revenue)} €</span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-600">{o.dip || '—'}</td>
                        <td className="py-2.5 px-4 text-right text-blue-600 font-medium text-xs">
                          {o.dip > 0 ? `${fmt(Math.round(o.ricavi / o.dip))} €` : '—'}
                        </td>
                        <td className="py-2.5 px-4">
                          <Link to="/outlet" className="opacity-0 group-hover:opacity-100 transition">
                            <ChevronRight size={14} className="text-slate-400" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-slate-50">
              {outletsData.map((o, i) => {
                const dailyRev = dailyRevenue.find(d => d.outlet === o.name)
                return (
                  <Link key={o.name} to="/outlet" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition">
                    <span className={`text-xs font-bold w-6 text-center ${
                      i === 0 ? 'text-amber-600' : 'text-slate-400'
                    }`}>
                      #{i + 1}
                    </span>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: o.colore }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate" title={formatOutletName(o.name)}>{formatOutletName(o.name)}</div>
                      <div className="text-xs text-slate-400">{fmt(o.ricavi)} €</div>
                    </div>
                    {dailyRev && (
                      <div className="text-right shrink-0">
                        <div className="text-xs text-slate-400">Ultimo</div>
                        <div className="text-sm font-semibold text-emerald-600">{fmt(dailyRev.revenue)} €</div>
                      </div>
                    )}
                    <ChevronRight size={14} className="text-slate-300 shrink-0" />
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </div>
      <PageHelp page="dashboard" />
      </div>
    </div>
  )
}
