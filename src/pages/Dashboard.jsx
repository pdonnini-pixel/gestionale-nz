import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import {
  TrendingUp, TrendingDown, DollarSign, Store, Wallet, Receipt,
  ArrowUpRight, ArrowDownRight, Minus, RefreshCw
} from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
  ComposedChart, Area
} from 'recharts'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
const MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

function fmt(n, decimals = 0) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n)
}

function KpiCard({ title, value, subtitle, icon: Icon, trend, color = 'blue' }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-lg ${colorMap[color]}`}>
          <Icon size={20} />
        </div>
        {trend != null && (
          <span className={`flex items-center gap-0.5 text-xs font-semibold ${
            trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-600' : 'text-slate-400'
          }`}>
            {trend > 0 ? <ArrowUpRight size={14} /> : trend < 0 ? <ArrowDownRight size={14} /> : <Minus size={14} />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-sm text-slate-500 mt-0.5">{title}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
    </div>
  )
}

function OutletRow({ outlet, rank }) {
  const signalColors = { green: 'bg-emerald-500', yellow: 'bg-amber-500', red: 'bg-red-500' }

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition">
      <td className="py-3 px-4 text-sm">
        <span className="text-slate-400 text-xs mr-2">#{rank}</span>
        <span className="font-medium text-slate-900">{outlet.outlet_name}</span>
      </td>
      <td className="py-3 px-4 text-sm text-right font-medium">{fmt(outlet.ytd_revenue)}</td>
      <td className="py-3 px-4 text-sm text-right">{fmt(outlet.ytd_ebitda)}</td>
      <td className="py-3 px-4 text-sm text-right">{outlet.avg_margin_pct}%</td>
      <td className="py-3 px-4 text-sm text-right">{fmt(outlet.revenue_per_sqm)}</td>
      <td className="py-3 px-4 text-center">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${
          outlet.avg_margin_pct >= 55 ? signalColors.green :
          outlet.avg_margin_pct >= 40 ? signalColors.yellow : signalColors.red
        }`} />
      </td>
    </tr>
  )
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState(null)
  const [outletRanking, setOutletRanking] = useState([])
  const [revenueByMonth, setRevenueByMonth] = useState([])
  const [bankTotals, setBankTotals] = useState(null)
  const [payablesSummary, setPayablesSummary] = useState({ total: 0, overdue: 0, next7d: 0 })
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)

    // Fetch in parallelo
    const [execRes, rankRes, trendRes, bankRes, payRes] = await Promise.all([
      supabase.from('v_executive_dashboard')
        .select('*')
        .eq('year', currentYear - 1)
        .order('month', { ascending: true }),
      supabase.from('v_outlet_ranking')
        .select('*')
        .eq('year', currentYear - 1)
        .order('rank_revenue', { ascending: true }),
      supabase.from('v_revenue_trend')
        .select('*')
        .eq('year', currentYear - 1)
        .order('month', { ascending: true }),
      supabase.from('v_bank_totals').select('*').limit(1).single(),
      supabase.from('v_payables_schedule').select('days_to_due, amount_remaining')
    ])

    // KPI aggregati
    if (execRes.data?.length) {
      const totals = execRes.data.reduce((acc, m) => ({
        revenue: acc.revenue + (m.total_revenue || 0),
        ebitda: acc.ebitda + (m.total_ebitda || 0),
        opex: acc.opex + (m.total_opex || 0),
        cogs: acc.cogs + (m.total_cogs || 0),
        outlets: m.active_outlets || acc.outlets,
      }), { revenue: 0, ebitda: 0, opex: 0, cogs: 0, outlets: 0 })

      setKpis(totals)

      // Dati per grafico mensile
      setRevenueByMonth(execRes.data.map(m => ({
        month: MONTHS[m.month - 1],
        ricavi: m.total_revenue || 0,
        cogs: m.total_cogs || 0,
        opex: m.total_opex || 0,
        ebitda: m.total_ebitda || 0,
      })))
    }

    // Ranking outlet
    if (rankRes.data) setOutletRanking(rankRes.data)

    // Banche
    if (bankRes.data) setBankTotals(bankRes.data)

    // Scadenze
    if (payRes.data) {
      const total = payRes.data.reduce((s, p) => s + (p.amount_remaining || 0), 0)
      const overdue = payRes.data.filter(p => p.days_to_due < 0).reduce((s, p) => s + (p.amount_remaining || 0), 0)
      const next7d = payRes.data.filter(p => p.days_to_due >= 0 && p.days_to_due <= 7).reduce((s, p) => s + (p.amount_remaining || 0), 0)
      setPayablesSummary({ total, overdue, next7d })
    }

    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={24} className="animate-spin text-blue-600" />
      </div>
    )
  }

  const ebitdaMargin = kpis?.revenue > 0 ? (kpis.ebitda / kpis.revenue * 100) : 0
  const cogsRatio = kpis?.revenue > 0 ? (kpis.cogs / kpis.revenue * 100) : 0

  // Dati per pie chart costi
  const costBreakdown = revenueByMonth.length > 0 ? [
    { name: 'COGS', value: revenueByMonth.reduce((s, m) => s + m.cogs, 0) },
    { name: 'OPEX', value: revenueByMonth.reduce((s, m) => s + m.opex, 0) },
    { name: 'EBITDA', value: Math.max(0, revenueByMonth.reduce((s, m) => s + m.ebitda, 0)) },
  ] : []

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Benvenuto, {profile?.first_name}. Dati anno {currentYear - 1}.
          </p>
        </div>
        <button
          onClick={loadDashboard}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-white transition"
        >
          <RefreshCw size={16} />
          Aggiorna
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={DollarSign}
          title="Fatturato YTD"
          value={`${fmt(kpis?.revenue)} €`}
          subtitle={`${kpis?.outlets || 0} outlet attivi`}
          color="blue"
        />
        <KpiCard
          icon={TrendingUp}
          title="EBITDA"
          value={`${fmt(kpis?.ebitda)} €`}
          subtitle={`Margine ${ebitdaMargin.toFixed(1)}%`}
          color={ebitdaMargin > 0 ? 'green' : 'red'}
        />
        <KpiCard
          icon={Wallet}
          title="Liquidita"
          value={bankTotals ? `${fmt(bankTotals.total_balance)} €` : '—'}
          subtitle={bankTotals ? `Disponibile: ${fmt(bankTotals.total_available)} €` : ''}
          color="purple"
        />
        <KpiCard
          icon={Receipt}
          title="Scadenze aperte"
          value={`${fmt(payablesSummary.total)} €`}
          subtitle={payablesSummary.overdue > 0 ? `Scadute: ${fmt(payablesSummary.overdue)} €` : 'Nessuna scaduta'}
          color={payablesSummary.overdue > 0 ? 'red' : 'amber'}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue + EBITDA chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Ricavi, Costi e EBITDA — {currentYear - 1}</h2>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={revenueByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v, name) => [`${fmt(v)} €`, name]}
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Legend />
              <Bar dataKey="cogs" name="COGS" stackId="a" fill="#94a3b8" radius={[0,0,0,0]} />
              <Bar dataKey="opex" name="OPEX" stackId="a" fill="#cbd5e1" radius={[2,2,0,0]} />
              <Line dataKey="ricavi" name="Ricavi" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line dataKey="ebitda" name="EBITDA" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Cost breakdown pie */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Distribuzione Costi</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={costBreakdown}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={3}
                dataKey="value"
              >
                {costBreakdown.map((_, i) => (
                  <Cell key={i} fill={COLORS[i]} />
                ))}
              </Pie>
              <Tooltip formatter={v => `${fmt(v)} €`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Outlet ranking table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Ranking Outlet — {currentYear - 1}</h2>
        </div>
        {outletRanking.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4 text-left font-medium">Outlet</th>
                <th className="py-3 px-4 text-right font-medium">Fatturato YTD</th>
                <th className="py-3 px-4 text-right font-medium">EBITDA</th>
                <th className="py-3 px-4 text-right font-medium">Margine %</th>
                <th className="py-3 px-4 text-right font-medium">€/mq</th>
                <th className="py-3 px-4 text-center font-medium">Stato</th>
              </tr>
            </thead>
            <tbody>
              {outletRanking.map((o, i) => (
                <OutletRow key={o.outlet_id} outlet={o} rank={i + 1} />
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-8 text-center text-slate-400 text-sm">
            Nessun dato disponibile per il ranking. I dati appariranno quando verranno inseriti i consuntivi mensili.
          </div>
        )}
      </div>
    </div>
  )
}
