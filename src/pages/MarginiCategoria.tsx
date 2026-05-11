import { useState, useEffect, useMemo, useCallback } from 'react'
import ExportMenu from '../components/ExportMenu'
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, Area, AreaChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Store, Download, Calendar,
  ArrowUpRight, ArrowDownRight, Loader2, AlertCircle, Building2,
  Banknote, Receipt, PieChart as PieChartIcon, BarChart3, Target,
  ChevronDown, Info,
} from 'lucide-react'
import {
  GlassTooltip, AXIS_STYLE, GRID_STYLE, PALETTE, OUTLET_COLORS,
  ChartGradients, ModernLegend, ModernPieLabel, fmtK, fmtEuro, BAR_RADIUS,
} from '../components/ChartTheme'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useCompanyLabels } from '../hooks/useCompanyLabels'

// ═══ HELPERS ═══
const fmt = (n: number | null | undefined): string => n == null ? '—' : new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(n)
const fmtPct = (n: number | null | undefined): string => n == null ? '—' : `${n.toFixed(1)}%`
const MONTHS_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

function getMonthLabel(dateStr: string) {
  const d = new Date(dateStr)
  return `${MONTHS_IT[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`
}

// ═══ MAIN COMPONENT ═══
export default function MarginiCategoria() {
  const { profile } = useAuth()
  const labels = useCompanyLabels()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'outlet' | 'costi' | 'trend'>('outlet')
  const [period, setPeriod] = useState<'ytd' | 'last12' | 'custom'>('ytd')
  const [year, setYear] = useState(new Date().getFullYear())

  // Raw data — Supabase data
  type OutletLite = { id: string; name: string; code?: string | null; rent_monthly?: number | null; staff_budget_monthly?: number | null; condo_marketing_monthly?: number | null; admin_cost_monthly?: number | null; target_margin_pct?: number | null; target_cogs_pct?: number | null; is_active?: boolean | null }
  type RevenueRow = { outlet_id?: string | null; date?: string | null; gross_revenue?: number | null; net_revenue?: number | null; transactions_count?: number | null }
  type PayableRow = { outlet_id?: string | null; invoice_date?: string | null; net_amount?: number | null; vat_amount?: number | null; gross_amount?: number | null; cost_category_id?: string | null; status?: string | null }
  type CashRow = { outlet_id?: string | null; date?: string | null; type?: string | null; amount?: number | null; cost_category_id?: string | null }
  type CostCategoryRow = { id: string; code?: string | null; name?: string | null; macro_group?: string | null; is_fixed?: boolean | null; sort_order?: number | null }
  type BudgetTemplateRow = { outlet_id?: string | null; cost_category_id?: string | null; budget_monthly?: number | null; budget_annual?: number | null; is_fixed?: boolean | null }
  const [outlets, setOutlets] = useState<OutletLite[]>([])
  const [revenue, setRevenue] = useState<RevenueRow[]>([])
  const [costs, setCosts] = useState<PayableRow[]>([])
  const [bankCosts, setBankCosts] = useState<CashRow[]>([])
  const [costCategories, setCostCategories] = useState<CostCategoryRow[]>([])
  const [budgets, setBudgets] = useState<BudgetTemplateRow[]>([])

  // ── Date range ──
  const dateRange = useMemo(() => {
    const now = new Date()
    if (period === 'ytd') {
      return { from: `${year}-01-01`, to: `${year}-12-31` }
    }
    if (period === 'last12') {
      const from = new Date(now)
      from.setMonth(from.getMonth() - 12)
      return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
    }
    return { from: `${year}-01-01`, to: `${year}-12-31` }
  }, [period, year])

  // ── Fetch all data ──
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [outletRes, revenueRes, costsRes, bankRes, catRes, budgetRes] = await Promise.all([
        supabase.from('outlets').select('id, name, code, rent_monthly, staff_budget_monthly, condo_marketing_monthly, admin_cost_monthly, target_margin_pct, target_cogs_pct, is_active').eq('is_active', true).order('name'),
        supabase.from('daily_revenue').select('outlet_id, date, gross_revenue, net_revenue, transactions_count').gte('date', dateRange.from).lte('date', dateRange.to),
        supabase.from('payables').select('outlet_id, invoice_date, net_amount, vat_amount, gross_amount, cost_category_id, status').gte('invoice_date', dateRange.from).lte('invoice_date', dateRange.to),
        supabase.from('cash_movements').select('outlet_id, date, type, amount, cost_category_id').eq('type', 'uscita').gte('date', dateRange.from).lte('date', dateRange.to),
        supabase.from('cost_categories').select('id, code, name, macro_group, is_fixed, sort_order').order('sort_order'),
        supabase.from('outlet_cost_template').select('outlet_id, cost_category_id, budget_monthly, budget_annual, is_fixed'),
      ])

      if (outletRes.error) throw outletRes.error
      setOutlets((outletRes.data || []) as OutletLite[])
      setRevenue((revenueRes.data || []) as RevenueRow[])
      setCosts((costsRes.data || []) as PayableRow[])
      setBankCosts((bankRes.data || []) as CashRow[])
      setCostCategories((catRes.data || []) as CostCategoryRow[])
      setBudgets((budgetRes.data || []) as BudgetTemplateRow[])
    } catch (err: unknown) {
      console.error('Fetch error:', err)
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [dateRange])

  useEffect(() => { fetchData() }, [fetchData])

  // ═══ COMPUTED DATA ═══

  // Revenue per outlet
  type RevenueAgg = { gross: number; net: number; transactions: number }
  type CostAgg = { total: number; byCategory: Record<string, number> }
  const revenueByOutlet = useMemo(() => {
    const map: Record<string, RevenueAgg> = {}
    revenue.forEach(r => {
      const id = r.outlet_id || '_company'
      if (!map[id]) map[id] = { gross: 0, net: 0, transactions: 0 }
      map[id].gross += Number(r.gross_revenue) || 0
      map[id].net += Number(r.net_revenue) || 0
      map[id].transactions += Number(r.transactions_count) || 0
    })
    return map
  }, [revenue])

  // Costs per outlet (from payables)
  const costsByOutlet = useMemo(() => {
    const map: Record<string, CostAgg> = {}
    costs.forEach(c => {
      const oid = c.outlet_id || '_company'
      if (!map[oid]) map[oid] = { total: 0, byCategory: {} }
      const amt = Number(c.gross_amount) || 0
      map[oid].total += amt
      const catId = c.cost_category_id || '_uncategorized'
      map[oid].byCategory[catId] = (map[oid].byCategory[catId] || 0) + amt
    })
    return map
  }, [costs])

  // Bank costs per outlet (from cash_movements uscite)
  const bankCostsByOutlet = useMemo(() => {
    const map: Record<string, CostAgg> = {}
    bankCosts.forEach(m => {
      const oid = m.outlet_id || '_company'
      if (!map[oid]) map[oid] = { total: 0, byCategory: {} }
      const amt = Number(m.amount) || 0
      map[oid].total += amt
      const catId = m.cost_category_id || '_uncategorized'
      map[oid].byCategory[catId] = (map[oid].byCategory[catId] || 0) + amt
    })
    return map
  }, [bankCosts])

  // Budget annuale per outlet
  const budgetByOutlet = useMemo(() => {
    const map: Record<string, number> = {}
    budgets.forEach(b => {
      const id = b.outlet_id
      if (!id) return
      if (!map[id]) map[id] = 0
      map[id] += Number(b.budget_annual) || (Number(b.budget_monthly) || 0) * 12
    })
    // Also add from outlets table (rent, staff, etc.)
    outlets.forEach(o => {
      const monthlyTotal = (Number(o.rent_monthly) || 0) + (Number(o.staff_budget_monthly) || 0) +
        (Number(o.condo_marketing_monthly) || 0) + (Number(o.admin_cost_monthly) || 0)
      if (!map[o.id]) map[o.id] = 0
      // Only add if no template budget exists
      if (map[o.id] === 0 && monthlyTotal > 0) {
        const months = period === 'last12' ? 12 : new Date().getMonth() + 1
        map[o.id] = monthlyTotal * months
      }
    })
    return map
  }, [budgets, outlets, period])

  // Outlet table data
  const outletData = useMemo(() => {
    return outlets.map(o => {
      const rev = revenueByOutlet[o.id] || { gross: 0, net: 0, transactions: 0 }
      const payCosts = costsByOutlet[o.id]?.total || 0
      const bnkCosts = bankCostsByOutlet[o.id]?.total || 0
      // Use the larger of the two cost sources to avoid double counting
      const totalCosts = Math.max(payCosts, bnkCosts)
      const margin = rev.gross - totalCosts
      const marginPct = rev.gross > 0 ? (margin / rev.gross) * 100 : 0
      const budget = budgetByOutlet[o.id] || 0
      const budgetVar = budget > 0 ? ((totalCosts - budget) / budget) * 100 : null
      const targetMargin = Number(o.target_margin_pct) || 60

      return {
        id: o.id,
        name: o.name,
        code: o.code,
        revenue: rev.gross,
        netRevenue: rev.net,
        transactions: rev.transactions,
        avgTicket: rev.transactions > 0 ? rev.gross / rev.transactions : 0,
        costs: totalCosts,
        margin,
        marginPct,
        budget,
        budgetVar,
        targetMargin,
        onTarget: marginPct >= targetMargin,
        color: (OUTLET_COLORS as Record<string, { main?: string }>)[o.name]?.main || PALETTE[0],
      }
    }).sort((a, b) => b.revenue - a.revenue)
  }, [outlets, revenueByOutlet, costsByOutlet, bankCostsByOutlet, budgetByOutlet])

  // Totals
  type Totals = { revenue: number; costs: number; margin: number; transactions: number; budget: number; marginPct: number; budgetVar: number | null }
  const totals = useMemo<Totals>(() => {
    const base = outletData.reduce((acc, o) => ({
      revenue: acc.revenue + o.revenue,
      costs: acc.costs + o.costs,
      margin: acc.margin + o.margin,
      transactions: acc.transactions + o.transactions,
      budget: acc.budget + o.budget,
    }), { revenue: 0, costs: 0, margin: 0, transactions: 0, budget: 0 })
    return {
      ...base,
      marginPct: base.revenue > 0 ? (base.margin / base.revenue) * 100 : 0,
      budgetVar: base.budget > 0 ? ((base.costs - base.budget) / base.budget) * 100 : null,
    }
  }, [outletData])

  // Cost breakdown by macro_group
  type GroupAgg = { group: string; name: string; total: number; items: Record<string, number> }
  const costBreakdown = useMemo<GroupAgg[]>(() => {
    const catMap: Record<string, CostCategoryRow> = {}
    costCategories.forEach(c => { catMap[c.id] = c })

    const groups: Record<string, GroupAgg> = {}
    // Merge payables costs
    Object.values(costsByOutlet).forEach(outlet => {
      Object.entries(outlet.byCategory).forEach(([catId, amt]) => {
        const cat = catMap[catId]
        const group = cat?.macro_group || 'altro'
        const name = cat?.name || 'Non categorizzato'
        if (!groups[group]) groups[group] = { group, name: groupLabel(group), total: 0, items: {} }
        groups[group].total += amt
        groups[group].items[name] = (groups[group].items[name] || 0) + amt
      })
    })
    return Object.values(groups).sort((a, b) => b.total - a.total)
  }, [costsByOutlet, costCategories])

  // Monthly trend
  type MonthAgg = { month: string; revenue: number; costs: number }
  const monthlyTrend = useMemo(() => {
    const map: Record<string, MonthAgg> = {}
    revenue.forEach(r => {
      const m = r.date?.slice(0, 7) // YYYY-MM
      if (!m) return
      if (!map[m]) map[m] = { month: m, revenue: 0, costs: 0 }
      map[m].revenue += Number(r.gross_revenue) || 0
    })
    costs.forEach(c => {
      const m = c.invoice_date?.slice(0, 7)
      if (!m) return
      if (!map[m]) map[m] = { month: m, revenue: 0, costs: 0 }
      map[m].costs += Number(c.gross_amount) || 0
    })
    return Object.values(map)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({
        ...m,
        label: getMonthLabel(m.month + '-01'),
        margin: m.revenue - m.costs,
        marginPct: m.revenue > 0 ? ((m.revenue - m.costs) / m.revenue) * 100 : 0,
      }))
  }, [revenue, costs])

  // Best / worst outlet
  const bestOutlet = outletData.length ? outletData.reduce((a, b) => a.marginPct > b.marginPct ? a : b) : null
  const worstOutlet = outletData.length ? outletData.reduce((a, b) => a.marginPct < b.marginPct ? a : b) : null

  // ── Export CSV ──
  const handleExport = () => {
    const header = 'Outlet;Ricavi;Costi;Margine;Margine%;Scontrini;Scontrino Medio;Budget;Var Budget%\n'
    const rows = outletData.map(o =>
      `${o.name};${o.revenue};${o.costs};${o.margin};${o.marginPct.toFixed(1)};${o.transactions};${o.avgTicket.toFixed(0)};${o.budget};${o.budgetVar?.toFixed(1) || ''}`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `margini_outlet_${year}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ═══ RENDER ═══
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="text-red-500" size={20} />
          <span className="text-red-700 text-sm">Errore nel caricamento: {error}</span>
        </div>
      </div>
    )
  }

  const noData = outletData.every(o => o.revenue === 0 && o.costs === 0)

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Margini per {labels.pointOfSale}</h1>
          <p className="text-sm text-slate-500 mt-1">Ricavi, costi e margini operativi per punto vendita</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {([
              { key: 'ytd', label: `YTD ${year}` },
              { key: 'last12', label: 'Ultimi 12m' },
            ] as const).map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${period === p.key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <ExportMenu
            data={outletData}
            columns={[
              { key: 'name', label: labels.pointOfSale },
              { key: 'revenue', label: 'Ricavi', format: 'euro' },
              { key: 'costs', label: 'Costi', format: 'euro' },
              { key: 'margin', label: 'Margine', format: 'euro' },
              { key: 'marginPct', label: 'Margine %', format: 'percent' },
              { key: 'budget', label: 'Budget', format: 'euro' },
              { key: 'transactions', label: 'Transazioni' },
            ]}
            filename="margini_categoria"
            title="Margini per Categoria"
          />
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={Banknote} label="Ricavi totali" value={`${fmtK(totals.revenue)} €`} color="blue" />
        <Kpi icon={Receipt} label="Costi totali" value={`${fmtK(totals.costs)} €`} color="red" />
        <Kpi icon={TrendingUp} label="Margine" value={`${fmtK(totals.margin)} €`}
          sub={fmtPct(totals.marginPct)} color={totals.margin >= 0 ? 'green' : 'red'} />
        <Kpi icon={Store} label="Outlet attivi" value={outlets.length} color="indigo" />
        <Kpi icon={Target} label="Miglior margine"
          value={bestOutlet ? fmtPct(bestOutlet.marginPct) : '—'}
          sub={bestOutlet?.name || ''} color="green" />
        <Kpi icon={AlertCircle} label="Peggior margine"
          value={worstOutlet ? fmtPct(worstOutlet.marginPct) : '—'}
          sub={worstOutlet?.name || ''} color="amber" />
      </div>

      {noData && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <Info className="text-amber-500 mt-0.5" size={18} />
          <div>
            <p className="text-sm font-medium text-amber-800">Nessun dato nel periodo selezionato</p>
            <p className="text-xs text-amber-600 mt-1">
              Importa i corrispettivi e le fatture fornitori dall'Import Hub per vedere i margini reali.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {([
          { key: 'outlet', label: 'Per Outlet', icon: Store },
          { key: 'costi', label: 'Struttura Costi', icon: PieChartIcon },
          { key: 'trend', label: 'Trend Mensile', icon: BarChart3 },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition ${tab === t.key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'outlet' && <OutletTab outletData={outletData} totals={totals} />}
      {tab === 'costi' && <CostiTab costBreakdown={costBreakdown} totalCosts={totals.costs} />}
      {tab === 'trend' && <TrendTab data={monthlyTrend} />}
    </div>
  )
}

// ═══ OUTLET TAB ═══
// TODO: tighten type
function OutletTab({ outletData, totals }: { outletData: any[]; totals: any }) {
  const labels = useCompanyLabels()
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const sorted = useMemo(() => {
    return [...outletData].sort((a, b) => sortDir === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey])
  }, [outletData, sortKey, sortDir])

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortHeader = ({ k, label }: { k: string; label: string }) => (
    <th onClick={() => toggleSort(k)}
      className="py-3 px-3 text-xs font-semibold text-slate-500 text-right cursor-pointer hover:text-slate-700 select-none whitespace-nowrap">
      {label} {sortKey === k && (sortDir === 'desc' ? '↓' : '↑')}
    </th>
  )

  // Bar chart data
  const chartData = outletData.map(o => ({
    name: o.name, ricavi: o.revenue, costi: o.costs, margine: o.margin,
  }))

  return (
    <div className="space-y-6">
      {/* Bar chart */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Ricavi vs Costi per {labels.pointOfSale}</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="name" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={fmtK} />
            <Tooltip content={<GlassTooltip />} />
            <Legend content={<ModernLegend />} />
            <Bar dataKey="ricavi" name="Ricavi" fill="#6366f1" radius={BAR_RADIUS} />
            <Bar dataKey="costi" name="Costi" fill="#ef4444" radius={BAR_RADIUS} />
            <Bar dataKey="margine" name="Margine" fill="#10b981" radius={BAR_RADIUS} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 text-left">{labels.pointOfSale}</th>
                <SortHeader k="revenue" label="Ricavi" />
                <SortHeader k="costs" label="Costi" />
                <SortHeader k="margin" label="Margine" />
                <SortHeader k="marginPct" label="Margine %" />
                <SortHeader k="transactions" label="Scontrini" />
                <SortHeader k="avgTicket" label="Scontrino Medio" />
                <th className="py-3 px-3 text-xs font-semibold text-slate-500 text-right">Budget</th>
                <th className="py-3 px-3 text-xs font-semibold text-slate-500 text-center">Target</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((o, i) => (
                <tr key={o.id} className={`border-b border-slate-50 hover:bg-slate-50/50 transition ${i % 2 === 0 ? '' : 'bg-slate-25'}`}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: o.color }} />
                      <span className="text-sm font-medium text-slate-900">{o.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-sm text-right tabular-nums text-slate-700">{fmt(o.revenue)} €</td>
                  <td className="py-3 px-3 text-sm text-right tabular-nums text-slate-700">{fmt(o.costs)} €</td>
                  <td className={`py-3 px-3 text-sm text-right tabular-nums font-medium ${o.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fmt(o.margin)} €
                  </td>
                  <td className="py-3 px-3 text-right">
                    <span className={`inline-flex items-center gap-1 text-sm font-medium ${o.marginPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {o.marginPct >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                      {fmtPct(o.marginPct)}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-sm text-right tabular-nums text-slate-600">{fmt(o.transactions)}</td>
                  <td className="py-3 px-3 text-sm text-right tabular-nums text-slate-600">{fmt(o.avgTicket)} €</td>
                  <td className="py-3 px-3 text-sm text-right tabular-nums text-slate-500">
                    {o.budget > 0 ? (
                      <span>
                        {fmt(o.budget)} €
                        {o.budgetVar != null && (
                          <span className={`ml-1 text-xs ${o.budgetVar > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                            ({o.budgetVar > 0 ? '+' : ''}{o.budgetVar.toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {o.revenue > 0 ? (
                      <span className={`inline-block w-2 h-2 rounded-full ${o.onTarget ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    ) : (
                      <span className="inline-block w-2 h-2 rounded-full bg-slate-300" />
                    )}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-slate-100 border-t-2 border-slate-300 font-semibold">
                <td className="py-3 px-4 text-sm text-slate-900">Totale</td>
                <td className="py-3 px-3 text-sm text-right tabular-nums">{fmt(totals.revenue)} €</td>
                <td className="py-3 px-3 text-sm text-right tabular-nums">{fmt(totals.costs)} €</td>
                <td className={`py-3 px-3 text-sm text-right tabular-nums ${totals.margin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {fmt(totals.margin)} €
                </td>
                <td className="py-3 px-3 text-sm text-right">{fmtPct(totals.marginPct)}</td>
                <td className="py-3 px-3 text-sm text-right tabular-nums">{fmt(totals.transactions)}</td>
                <td className="py-3 px-3 text-sm text-right tabular-nums">
                  {totals.transactions > 0 ? `${fmt(Math.round(totals.revenue / totals.transactions))} €` : '—'}
                </td>
                <td className="py-3 px-3 text-sm text-right tabular-nums">
                  {totals.budget > 0 ? `${fmt(totals.budget)} €` : '—'}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ═══ COSTI TAB ═══
// TODO: tighten type
function CostiTab({ costBreakdown, totalCosts }: { costBreakdown: any[]; totalCosts: number }) {
  const pieData = costBreakdown.map((g, i) => ({
    name: g.name, value: g.total, fill: PALETTE[i % PALETTE.length],
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie chart */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Distribuzione Costi per Macro-Gruppo</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={120} innerRadius={60}
                  dataKey="value" label={ModernPieLabel as never} paddingAngle={2}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip content={<GlassTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[320px] flex items-center justify-center text-slate-400 text-sm">
              Nessun dato costi disponibile
            </div>
          )}
        </div>

        {/* Cost breakdown table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Dettaglio per Categoria</h3>
          <div className="space-y-4 max-h-[400px] overflow-y-auto">
            {costBreakdown.map((group, gi) => (
              <div key={gi}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded" style={{ background: PALETTE[gi % PALETTE.length] }} />
                    <span className="text-sm font-semibold text-slate-800">{group.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-slate-900">{fmt(group.total)} €</span>
                    <span className="text-xs text-slate-400 ml-2">
                      {totalCosts > 0 ? fmtPct((group.total / totalCosts) * 100) : ''}
                    </span>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 bg-slate-100 rounded-full mb-2">
                  <div className="h-full rounded-full transition-all" style={{
                    width: totalCosts > 0 ? `${Math.min((group.total / totalCosts) * 100, 100)}%` : '0%',
                    background: PALETTE[gi % PALETTE.length],
                  }} />
                </div>
                {/* Sub-items */}
                <div className="ml-5 space-y-1">
                  {Object.entries(group.items)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .map(([name, amt], i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-slate-500">{name}</span>
                        <span className="text-slate-700 tabular-nums">{fmt(amt as number)} €</span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
            {costBreakdown.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">
                Nessun costo categorizzato nel periodo selezionato
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══ TREND TAB ═══
// TODO: tighten type
function TrendTab({ data }: { data: any[] }) {
  return (
    <div className="space-y-6">
      {/* Revenue vs Costs trend */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Trend Ricavi vs Costi (mensile)</h3>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data} barGap={2}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="label" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} tickFormatter={fmtK} />
              <Tooltip content={<GlassTooltip />} />
              <Legend content={<ModernLegend />} />
              <Bar dataKey="revenue" name="Ricavi" fill="#6366f1" radius={BAR_RADIUS} />
              <Bar dataKey="costs" name="Costi" fill="#ef4444" radius={BAR_RADIUS} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[320px] flex items-center justify-center text-slate-400 text-sm">
            Nessun dato nel periodo selezionato
          </div>
        )}
      </div>

      {/* Margin % trend */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Trend Margine %</h3>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="gradMargin" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="label" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} tickFormatter={v => `${v.toFixed(0)}%`} />
              <Tooltip content={<GlassTooltip suffix="%" />} />
              <Area type="monotone" dataKey="marginPct" name="Margine %" stroke="#10b981" strokeWidth={2.5}
                fill="url(#gradMargin)" dot={{ r: 4, fill: '#10b981' }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">
            Nessun dato nel periodo selezionato
          </div>
        )}
      </div>
    </div>
  )
}

// ═══ HELPERS ═══
function groupLabel(macro: string | null): string {
  const labels: Record<string, string> = {
    locazione: 'Locazione & Affitti',
    personale: 'Personale',
    generali_amministrative: 'Generali & Amministrative',
    finanziarie: 'Oneri Finanziari',
    oneri_diversi: 'Oneri Diversi',
  }
  return (macro && labels[macro]) || macro || 'Altro'
}

function Kpi({ icon: Icon, label, value, sub, color }: { icon: React.ComponentType<{ size?: number }>; label: string; value: string | number; sub?: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600', green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600',
    indigo: 'bg-indigo-50 text-indigo-600', purple: 'bg-purple-50 text-purple-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color] || colors.indigo}`}><Icon size={18} /></div>
        <div className="min-w-0">
          <div className="text-lg font-bold text-slate-900 truncate">{value}</div>
          <div className="text-xs text-slate-500">{label}</div>
          {sub && <div className="text-xs text-slate-400">{sub}</div>}
        </div>
      </div>
    </div>
  )
}
