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
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
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

        // 3. Ranking outlet — metriche da budget_confronto (consuntivo "granitico"
        //    di Lilian) classificate via chart_of_accounts.is_revenue, per
        //    cost_center role='outlet'. Niente hardcoded: codici ricavo, outlet e
        //    cost center arrivano tutti dal DB. Per ogni outlet:
        //      ricavi (cons_ytd) = Σ amount cons_monthly su conti is_revenue
        //      ult_mese          = max(mese) con cons_monthly != 0 (derivato dai dati)
        //      budget_ytd        = Σ amount rev_monthly sui mesi <= ult_mese
        //      budget_anno       = Σ amount rev_monthly su tutti i mesi
        //      vs_budget_pct     = cons_ytd / budget_ytd * 100 (null se budget_ytd 0)
        //      pct_gruppo        = cons_ytd / Σ cons_ytd di tutti gli outlet
        try {
          const [{ data: outletsList }, { data: ccRows }, { data: coaRows }] = await Promise.all([
            supabase.from('outlets').select('id, name, code, is_active').eq('company_id', COMPANY_ID),
            supabase.from('cost_centers').select('code, role, is_active').eq('company_id', COMPANY_ID),
            supabase.from('chart_of_accounts').select('code').eq('company_id', COMPANY_ID).eq('is_active', true).eq('is_revenue', true),
          ])

          const activeOutlets = (outletsList || []).filter(o => o.is_active !== false)
          const revenueCodes = new Set((coaRows || []).map(c => c.code))
          const outletCcSet = new Set(
            ((ccRows || []) as Array<{ code?: string | null; role?: string | null; is_active?: boolean | null }>)
              .filter(c => c.role === 'outlet' && c.is_active !== false)
              .map(c => String(c.code || '').toLowerCase())
              .filter(Boolean)
          )

          // budget_confronto: consuntivo (cons_monthly) + preventivo (rev_monthly)
          // mensile, solo conti is_revenue. Mai sommare i due entry_type insieme.
          const { data: bcRows } = await supabase
            .from('budget_confronto')
            .select('cost_center, account_code, month, amount, entry_type')
            .eq('company_id', COMPANY_ID)
            .eq('year', YEAR)
            .in('entry_type', ['cons_monthly', 'rev_monthly'])
            .range(0, 9999)

          type MonthMap = { cons: Record<number, number>; rev: Record<number, number> }
          const byCc: Record<string, MonthMap> = {}
          ;((bcRows || []) as Array<{ cost_center?: string | null; account_code?: string | null; month?: number | null; amount?: number | null; entry_type?: string | null }>).forEach(r => {
            const cc = String(r.cost_center || '').toLowerCase()
            if (!cc) return
            if (outletCcSet.size > 0 && !outletCcSet.has(cc)) return
            if (!r.account_code || !revenueCodes.has(r.account_code)) return
            const m = r.month ?? 0
            if (m < 1) return
            const amt = Number(r.amount) || 0
            if (!byCc[cc]) byCc[cc] = { cons: {}, rev: {} }
            if (r.entry_type === 'cons_monthly') byCc[cc].cons[m] = (byCc[cc].cons[m] || 0) + amt
            else if (r.entry_type === 'rev_monthly') byCc[cc].rev[m] = (byCc[cc].rev[m] || 0) + amt
          })

          // Fallback (anni/tenant senza budget_confronto, es. annate chiuse):
          // ricavo da budget_entries sui conti is_revenue. In questa modalità non
          // c'è split consuntivo/preventivo → vs Budget resta "—".
          const hasConfronto = Object.keys(byCc).length > 0
          const entriesByCc: Record<string, number> = {}
          if (!hasConfronto) {
            const { data: beRows } = await supabase
              .from('budget_entries')
              .select('cost_center, account_code, budget_amount')
              .eq('company_id', COMPANY_ID)
              .eq('year', YEAR)
              .range(0, 9999)
            ;((beRows || []) as Array<{ cost_center?: string | null; account_code?: string | null; budget_amount?: number | null }>).forEach(r => {
              const cc = String(r.cost_center || '').toLowerCase()
              if (!cc) return
              if (outletCcSet.size > 0 && !outletCcSet.has(cc)) return
              if (!r.account_code || !revenueCodes.has(r.account_code)) return
              entriesByCc[cc] = (entriesByCc[cc] || 0) + (Number(r.budget_amount) || 0)
            })
          }

          // Una riga per ogni outlet anagrafico (anche a 0): mai outlet "fantasma",
          // mai crash, mai divisione per 0.
          const rows = activeOutlets.map(o => {
            const nameKey = String(o.name || '').toLowerCase()
            const codeKey = String(o.code || '').toLowerCase()
            const mm = byCc[nameKey] || byCc[codeKey] || { cons: {}, rev: {} }
            const consYtd = Object.values(mm.cons).reduce((s, v) => s + v, 0)
            const consMonths = Object.entries(mm.cons).filter(([, v]) => v !== 0).map(([k]) => Number(k))
            const ultMese = consMonths.length ? Math.max(...consMonths) : 0
            const budgetYtd = ultMese > 0
              ? Object.entries(mm.rev).reduce((s, [k, v]) => (Number(k) <= ultMese ? s + v : s), 0)
              : 0
            const budgetAnno = Object.values(mm.rev).reduce((s, v) => s + v, 0)
            const fallbackRev = hasConfronto ? 0 : (entriesByCc[nameKey] ?? entriesByCc[codeKey] ?? 0)
            return {
              id: o.id,
              name: o.name || o.code || '?',
              ricavi: consYtd || fallbackRev,
              ult_mese: ultMese,
              budget_ytd: budgetYtd,
              budget_anno: budgetAnno || fallbackRev,
              vs_budget_pct: budgetYtd > 0 ? (consYtd / budgetYtd * 100) : null,
            }
          })

          const totaleCons = rows.reduce((s, r) => s + r.ricavi, 0)
          rows.sort((a, b) => (b.ricavi - a.ricavi) || a.name.localeCompare(b.name))

          if (rows.some(r => r.ricavi !== 0 || r.budget_anno !== 0)) {
            setOutletsData(rows.map((o, i) => ({
              ...o,
              pct_gruppo: totaleCons > 0 ? (o.ricavi / totaleCons * 100) : null,
              colore: OUTLET_COLORS[i % OUTLET_COLORS.length],
            })))
          }
        } catch (e) { console.warn('Outlet ranking error:', e) }

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
  // URL diretta al dettaglio del singolo outlet (/outlet/:outletId). Si preferisce
  // l'id quando disponibile; in mancanza si usa il nome (la pagina Outlet risolve
  // sia per id sia per nome). Le righe del ranking aprono così la scheda del
  // punto vendita specifico, non la pagina generale.
  const outletHref = (o: { id?: string; name?: string }) =>
    o.id ? `/outlet/${o.id}` : `/outlet/${encodeURIComponent((o.name || '').toLowerCase())}`
  // Colore "vs Budget" (convenzione progetto): >=100% a target/sopra → nero;
  // sotto target → rosso; nessun dato → grigio. NIENTE verde.
  const vsBudgetColor = (pct: number | null | undefined) =>
    pct == null ? 'text-slate-400' : pct >= 100 ? 'text-slate-900' : 'text-red-600'
  // Totali gruppo per la riga in fondo al ranking (somma ricavi YTD, budget anno,
  // e vs Budget aggregato Σcons/Σbudget_ytd).
  const rankTotRicavi = outletsData.reduce((s, o) => s + (Number(o.ricavi) || 0), 0)
  const rankTotBudgetAnno = outletsData.reduce((s, o) => s + (Number(o.budget_anno) || 0), 0)
  const rankTotBudgetYtd = outletsData.reduce((s, o) => s + (Number(o.budget_ytd) || 0), 0)
  const rankTotVsBudget = rankTotBudgetYtd > 0 ? (rankTotRicavi / rankTotBudgetYtd * 100) : null
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
          link="/outlet"
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
                    <th className="py-2 px-4 text-right font-medium">Ricavi YTD</th>
                    <th className="py-2 px-4 text-right font-medium">% sul gruppo</th>
                    <th className="py-2 px-4 text-right font-medium">vs Budget (YTD)</th>
                    <th className="py-2 px-4 text-right font-medium">Budget anno</th>
                    <th className="py-2 px-4 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {outletsData.map((o, i) => {
                    const maxRicavi = outletsData[0]?.ricavi || 1
                    const barWidth = Math.max(0, Math.round((o.ricavi / maxRicavi) * 100))
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
                        <td className="py-2.5 px-4 text-right text-slate-500 text-xs">{o.pct_gruppo != null ? `${fmt(o.pct_gruppo, 1)}%` : '—'}</td>
                        <td className={`py-2.5 px-4 text-right font-semibold ${vsBudgetColor(o.vs_budget_pct)}`}>
                          {o.vs_budget_pct != null ? `${fmt(o.vs_budget_pct, 1)}%` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-600">{o.budget_anno ? `${fmt(o.budget_anno)} €` : '—'}</td>
                        <td className="py-2.5 px-4">
                          <Link to={outletHref(o)} className="opacity-0 group-hover:opacity-100 transition">
                            <ChevronRight size={14} className="text-slate-400" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/60 text-sm font-semibold text-slate-900">
                    <td className="py-2.5 px-4"></td>
                    <td className="py-2.5 px-4">Totale gruppo</td>
                    <td className="py-2.5 px-4 text-right">{fmt(rankTotRicavi)} €</td>
                    <td className="py-2.5 px-4 text-right text-slate-500 text-xs">100%</td>
                    <td className={`py-2.5 px-4 text-right ${vsBudgetColor(rankTotVsBudget)}`}>
                      {rankTotVsBudget != null ? `${fmt(rankTotVsBudget, 1)}%` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-600">{rankTotBudgetAnno ? `${fmt(rankTotBudgetAnno)} €` : '—'}</td>
                    <td className="py-2.5 px-4"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-slate-50">
              {outletsData.map((o, i) => (
                <Link key={o.name} to={outletHref(o)} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition">
                  <span className={`text-xs font-bold w-6 text-center ${
                    i === 0 ? 'text-amber-600' : 'text-slate-400'
                  }`}>
                    #{i + 1}
                  </span>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: o.colore }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate" title={formatOutletName(o.name)}>{formatOutletName(o.name)}</div>
                    <div className="text-xs text-slate-400">Ricavi YTD {fmt(o.ricavi)} €</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-slate-400">vs Budget</div>
                    <div className={`text-sm font-semibold ${vsBudgetColor(o.vs_budget_pct)}`}>
                      {o.vs_budget_pct != null ? `${fmt(o.vs_budget_pct, 1)}%` : '—'}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-slate-300 shrink-0" />
                </Link>
              ))}
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-50/60 font-semibold text-slate-900">
                <span className="w-6" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">Totale gruppo</div>
                  <div className="text-xs text-slate-500">Ricavi YTD {fmt(rankTotRicavi)} €</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-400">vs Budget</div>
                  <div className={`text-sm font-semibold ${vsBudgetColor(rankTotVsBudget)}`}>
                    {rankTotVsBudget != null ? `${fmt(rankTotVsBudget, 1)}%` : '—'}
                  </div>
                </div>
                <span className="w-3.5 shrink-0" />
              </div>
            </div>
          </>
        )}
      </div>
      <PageHelp page="dashboard" />
      </div>
    </div>
  )
}
