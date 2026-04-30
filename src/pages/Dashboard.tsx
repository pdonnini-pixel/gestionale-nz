import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import PageHelp from '../components/PageHelp'
import { usePeriod } from '../hooks/usePeriod'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, DollarSign, Store, Wallet,
  ArrowUpRight, ArrowRight, Receipt, Percent,
  AlertTriangle, CheckCircle2, Target, Loader, Info,
  Clock, CreditCard, BarChart3, Sparkles, ChevronRight
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
// TODO: tighten type — recharts tooltip payload
function SparklineTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
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

          if (bsData?.length > 0) {
            const bs: Record<string, number> = {}
            bsData.forEach((r: any) => { bs[r.account_code] = r.amount })
            setRicavi(bs.ricavi_vendite || 0)
            setUtile(bs.utile_netto || 0)
            setTotalCosti(bs.totale_costi_produzione || 0)
            setStaffCosts(bs.totale_personale || 0)
            hasViewData = true
            setDataSource('bilancio')
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

            if (invData?.length > 0) {
              setTotalCosti(invData.reduce((s, r) => s + parseFloat(r.gross_amount || 0), 0))
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
              name: o.outlet_name,
              ricavi: o.ytd_revenue || 0,
              dip: o.staff_count || 0,
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
                .select('id, name')
                .eq('company_id', COMPANY_ID)
            ])

            const outletNameMap = {}
            ;(outletsList || []).forEach(o => { outletNameMap[o.id] = o.name })

            if (drAgg && drAgg.length > 0) {
              // Group by outlet_id and sum gross_revenue
              const outletMap = {}
              drAgg.forEach(r => {
                const oid = r.outlet_id
                if (!outletMap[oid]) {
                  outletMap[oid] = { name: outletNameMap[oid] || '?', ricavi: 0 }
                }
                outletMap[oid].ricavi += parseFloat(r.gross_revenue) || 0
              })
              const sorted = Object.values(outletMap).sort((a, b) => b.ricavi - a.ricavi)
              setOutletsData(sorted.map((o, i) => ({
                name: o.name,
                ricavi: o.ricavi,
                dip: 0,
                colore: OUTLET_COLORS[i % OUTLET_COLORS.length],
              })))
            }

            // Fallback 3: use budget_entries revenue data per cost_center
            if (!drAgg || drAgg.length === 0) {
              const { data: budgetData } = await supabase
                .from('budget_entries')
                .select('cost_center, budget_amount')
                .eq('company_id', COMPANY_ID)
                .eq('year', YEAR)
                .in('account_code', ['510107', '51010101', '510108', 'RIC001', 'RIC002', 'RIC003'])

              if (budgetData && budgetData.length > 0) {
                const bMap = {}
                budgetData.forEach(r => {
                  const cc = r.cost_center
                  if (!bMap[cc]) bMap[cc] = { name: cc.charAt(0).toUpperCase() + cc.slice(1), ricavi: 0 }
                  bMap[cc].ricavi += parseFloat(r.budget_amount) || 0
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

              // Fallback 3b: try with RIC% pattern and actual_amount for previous or current year
              if (!budgetData || budgetData.length === 0) {
                const { data: budgetRic } = await supabase
                  .from('budget_entries')
                  .select('cost_center, actual_amount, budget_amount')
                  .eq('company_id', COMPANY_ID)
                  .eq('year', YEAR)

                if (budgetRic && budgetRic.length > 0) {
                  const bMap = {}
                  budgetRic.forEach(r => {
                    const cc = r.cost_center
                    if (!cc) return
                    // Escludi rettifiche bilancio e spese non divise dalla vista outlet
                    if (cc === 'rettifica_bilancio' || cc === 'spese_non_divise') return
                    const amt = parseFloat(r.actual_amount) || parseFloat(r.budget_amount) || 0
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
            .select('current_balance')
            .eq('company_id', COMPANY_ID)
          setLiquidita((cashData || []).reduce((s, c) => s + (c.current_balance || 0), 0))
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

          if (cmData?.length > 0) {
            const dayMap = {}
            let totE = 0, totU = 0
            cmData.forEach(row => {
              const dk = row.date
              if (!dayMap[dk]) dayMap[dk] = { date: dk, entrate: 0, uscite: 0, netto: 0 }
              const abs = Math.abs(parseFloat(row.amount) || 0)
              if (row.type === 'inflow') {
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

        // 8. Uncategorized movements
        try {
          const { count } = await supabase
            .from('cash_movements')
            .select('id', { count: 'exact' })
            .eq('company_id', COMPANY_ID)
            .is('cost_category_id', null)
            .is('ai_category_id', null)
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
          const latestByOutlet = {}
          ;(drData || []).forEach(r => {
            if (!latestByOutlet[r.outlet_id]) {
              latestByOutlet[r.outlet_id] = r
            }
          })

          setDailyRevenue(Object.values(latestByOutlet).map(r => ({
            outlet: r.outlets?.name || '?',
            revenue: parseFloat(r.gross_revenue) || 0,
            date: r.date,
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
      icon: Sparkles,
      color: 'bg-blue-50 border-blue-200 text-blue-700',
      title: `${uncategorizedMov} movimenti da classificare`,
      description: 'Usa l\'AI per categorizzare automaticamente',
      link: '/ai-categorie',
      linkLabel: 'Classifica',
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
    <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* ─── HEADER ─── */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          Buongiorno, {profile?.first_name || 'Patrizio'}
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Cruscotto direzionale — {periodRange.label}
          {dataSource === 'bilancio' && <span className="text-blue-500 ml-2">· Dati da bilancio importato</span>}
          {lastUpdate && <span className="ml-2"><DataFreshness lastUpdate={lastUpdate} source="Dati" /></span>}
        </p>
      </div>

      {/* ─── 4 KPI PRINCIPALI ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          icon={DollarSign} title="Ricavi" color={dataSource === 'fatture' ? 'amber' : 'blue'}
          value={ricavi > 0 ? `${fmtCompact(ricavi)} €` : 'N/D'}
          trend={ricavi > 0 ? deltaRicaviPct : null}
          subtitle={ricavi > 0 ? (ricaviPrevYear > 0 ? `vs ${fmtCompact(ricaviPrevYear)} € anno prec.` : periodRange.label) : 'Importa bilancio per i ricavi'}
          link="/conto-economico"
        />
        <KpiCard
          icon={Percent} title={dataSource === 'fatture' ? 'Costi' : 'Margine netto'} helpTerm="margine"
          color={dataSource === 'fatture' ? 'blue' : utile >= 0 ? 'green' : 'red'}
          value={dataSource === 'fatture' ? `${fmtCompact(totalCosti)} €` : `${marginePct.toFixed(1)}%`}
          subtitle={dataSource === 'fatture' ? `Totale fatture passive ${year}` : `Utile: ${fmtCompact(utile)} €`}
          link={dataSource === 'fatture' ? `/fatturazione?year=${year}` : '/conto-economico'}
          alert={dataSource !== 'fatture' && utile < 0}
        />
        <KpiCard
          icon={Wallet} title="Liquidità" color={liquidita >= 0 ? 'cyan' : 'red'}
          value={`${fmtCompact(liquidita)} €`}
          subtitle={`PFN: ${fmtCompact(pfn)} €`}
          helpTerm="pfn"
          link="/banche"
          alert={pfn < 0}
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
                  <div className="text-sm font-bold text-emerald-600">+{fmtCompact(cashFlowTotals.entrate)} €</div>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Uscite</span>
                  <div className="text-sm font-bold text-red-500">-{fmtCompact(cashFlowTotals.uscite)} €</div>
                </div>
                <div className="ml-auto">
                  <span className="text-xs text-slate-400">Netto</span>
                  <div className={`text-sm font-bold ${cashFlowNetto >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {cashFlowNetto >= 0 ? '+' : ''}{fmtCompact(cashFlowNetto)} €
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
            <Store size={15} className="text-indigo-500" /> Performance Outlet
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
                  ? <>Dati per outlet non disponibili per il {year}. Importa il bilancio {year} o <Link to="/allocazione-fornitori" className="text-blue-500 hover:underline">assegna i fornitori agli outlet</Link>.</>
                  : <>Nessun dato outlet. <Link to="/import-hub" className="text-blue-500 hover:underline">Importa dati</Link> per vedere il ranking.</>
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
                    <th className="py-2 px-4 text-left font-medium">Outlet</th>
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
                      <div className="text-sm font-medium text-slate-900 truncate">{formatOutletName(o.name)}</div>
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
  )
}
