import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, DollarSign, Store, Wallet, Users,
  ArrowUpRight, ArrowRight, Landmark, Building2, HandCoins,
  BarChart3, GitCompare, Receipt, FileText, Percent,
  AlertTriangle, CheckCircle2, Target, Loader, Info,
  Brain, Sparkles, Eye, Shield
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell
} from 'recharts'
import { GlassTooltip, ChartGradients, AXIS_STYLE, GRID_STYLE, BAR_RADIUS, ModernPieLabel, DonutCenter, PALETTE, fmtEuro } from '../components/ChartTheme'

/* ═══════════════════════════════════════════════════════════
   DATA FETCHED FROM SUPABASE
   ═══════════════════════════════════════════════════════════ */

// Color palette for outlets
const OUTLET_COLORS = ['#6366f1', '#f43f5e', '#06b6d4', '#10b981', '#8b5cf6', '#f97316', '#0ea5e9']

/* ───── helpers ───── */
function fmt(n, dec = 0) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}

/* ═══════════════════════════════════════
   COMPONENTI
   ═══════════════════════════════════════ */

function KpiCard({ title, value, subtitle, icon: Icon, color = 'blue', trend, link }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    cyan: 'bg-cyan-50 text-cyan-600',
  }
  const card = (
    <div className={`bg-white rounded-xl border border-slate-200 p-5 shadow-sm ${link ? 'hover:border-blue-300 hover:shadow-md transition cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-lg ${colorMap[color]}`}><Icon size={20} /></div>
        {trend != null && (
          <span className={`flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
            trend > 0 ? 'bg-emerald-50 text-emerald-600' : trend < 0 ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-400'
          }`}>
            {trend > 0 ? <ArrowUpRight size={12} /> : <TrendingDown size={12} />}
            {trend > 0 ? '+' : ''}{trend.toFixed(1)}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-sm text-slate-500 mt-0.5">{title}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
      {link && (
        <div className="flex items-center gap-1 text-xs text-blue-500 mt-2 font-medium">
          Dettaglio <ArrowRight size={12} />
        </div>
      )}
    </div>
  )
  return link ? <Link to={link}>{card}</Link> : card
}

function QuickLink({ to, icon: Icon, label, color }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-slate-50 transition group">
      <div className={`p-2 rounded-lg ${color}`}><Icon size={16} /></div>
      <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">{label}</span>
      <ArrowRight size={14} className="ml-auto text-slate-300 group-hover:text-slate-500" />
    </Link>
  )
}

function AlertCard({ icon: Icon, color, title, children }) {
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="flex items-start gap-3">
        <Icon size={18} className="mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs mt-0.5 opacity-80">{children}</div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════
   DASHBOARD PRINCIPALE
   ═══════════════════════════════════════ */
export default function Dashboard() {
  const { profile } = useAuth()
  const COMPANY_ID = profile?.company_id
  const CURRENT_YEAR = new Date().getFullYear()
  const [dashYear, setDashYear] = useState(CURRENT_YEAR)

  // State for all data
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dataSource, setDataSource] = useState('') // 'views' or 'bilancio'

  // Financial data
  const [ricavi, setRicavi] = useState(0)
  const [ricaviPrevYear, setRicaviPrevYear] = useState(0)
  const [utile, setUtile] = useState(0)
  const [totalCosti, setTotalCosti] = useState(0)

  // Outlets
  const [outletsData, setOutletsData] = useState([])
  const [totalOutlets, setTotalOutlets] = useState(0)

  // Cash & debt
  const [liquidita, setLiquidita] = useState(0)
  const [debtiFin, setDebtiFin] = useState(0)

  // Staff
  const [totalStaff, setTotalStaff] = useState(0)
  const [staffCosts, setStaffCosts] = useState(0)

  // Costs breakdown
  const [pieCosti, setPieCosti] = useState([])

  // Cash flow trends (weekly)
  const [cashFlowWeekly, setCashFlowWeekly] = useState([])
  const [cashFlowTotals, setCashFlowTotals] = useState({ entrate: 0, uscite: 0 })

  // AI Insights
  const [aiInsights, setAiInsights] = useState(null)

  // Company info
  const [visura, setVisura] = useState({
    denominazione: '—',
    sede: '—',
    piva: '—',
    amministratore: '—',
    soci: '—',
    ateco: '—',
    costituzione: '—',
  })

  // Fetch all data from Supabase
  useEffect(() => {
    if (!COMPANY_ID) return
    const YEAR = dashYear

    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        // 1. Try operational views first
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
        } catch (e) { console.warn('v_executive_dashboard not available:', e.message) }

        // 2. FALLBACK: Read from balance_sheet_data (bilancio importato)
        if (!hasViewData) {
          const { data: bsData } = await supabase
            .from('balance_sheet_data')
            .select('account_code, amount')
            .eq('company_id', COMPANY_ID)
            .eq('year', YEAR)
            .eq('period_type', 'annuale')
            .eq('section', 'conto_economico')

          if (bsData && bsData.length > 0) {
            const bs = {}
            bsData.forEach(r => { bs[r.account_code] = r.amount })
            setRicavi(bs.ricavi_vendite || 0)
            setUtile(bs.utile_netto || 0)
            setTotalCosti(bs.totale_costi_produzione || 0)
            setStaffCosts(bs.totale_personale || 0)
            setDataSource('bilancio')

            // Cost composition from bilancio
            const costColors = ['#f43f5e', '#6366f1', '#06b6d4', '#8b5cf6', '#94a3b8']
            const costEntries = [
              { name: 'Merci', value: bs.materie_prime || 0, color: costColors[0] },
              { name: 'Personale', value: bs.totale_personale || 0, color: costColors[1] },
              { name: 'Servizi', value: bs.servizi || 0, color: costColors[2] },
              { name: 'Affitti', value: bs.godimento_beni_terzi || 0, color: costColors[3] },
              { name: 'Altro', value: (bs.oneri_finanziari || 0) + (bs.oneri_diversi || 0), color: costColors[4] },
            ]
            setPieCosti(costEntries)
            hasViewData = true // prevent fatture fallback
          }
        }

        // 3. FALLBACK: Read from fatture / monthly_actuals (dati operativi)
        if (!hasViewData) {
          try {
            // Get monthly purchases from monthly_actuals
            const { data: maData } = await supabase
              .from('monthly_actuals')
              .select('month, purchases')
              .eq('company_id', COMPANY_ID)
              .eq('year', YEAR)
              .is('outlet_id', null)

            // Get cost breakdown from monthly_cost_lines via monthly_actuals
            const maIds = (maData || []).map(r => r.id).filter(Boolean)
            const totalPurchases = (maData || []).reduce((s, r) => s + parseFloat(r.purchases || 0), 0)

            // Get electronic invoices summary
            const { data: invData } = await supabase
              .from('electronic_invoices')
              .select('gross_amount, invoice_date')
              .eq('company_id', COMPANY_ID)
              .gte('invoice_date', `${YEAR}-01-01`)
              .lte('invoice_date', `${YEAR}-12-31`)

            if (invData && invData.length > 0) {
              const totalGross = invData.reduce((s, r) => s + parseFloat(r.gross_amount || 0), 0)
              setTotalCosti(totalGross)
              setDataSource('fatture')

              // Get cost breakdown by category from monthly_cost_lines
              const { data: mclData } = await supabase
                .from('monthly_cost_lines')
                .select('amount, cost_category_id, label, monthly_actual_id')

              // Filter to only our monthly_actuals
              const ourMaIds = new Set((maData || []).map(r => r.id))
              const ourCostLines = (mclData || []).filter(r => ourMaIds.has(r.monthly_actual_id))

              // Get cost categories for labeling
              const { data: catData } = await supabase
                .from('cost_categories')
                .select('id, code, name, macro_group')
                .eq('company_id', COMPANY_ID)

              const catMap = {}
              ;(catData || []).forEach(c => { catMap[c.id] = c })

              // Aggregate by macro_group
              const macroTotals = { locazione: 0, personale: 0, generali_amministrative: 0, finanziarie: 0, oneri_diversi: 0 }
              let merciTotal = 0
              ourCostLines.forEach(cl => {
                const cat = catMap[cl.cost_category_id]
                if (cat) {
                  macroTotals[cat.macro_group] = (macroTotals[cat.macro_group] || 0) + parseFloat(cl.amount || 0)
                }
              })
              // Merci = total purchases - sum of cost lines (the rest is costo venduto)
              const costLinesTotal = Object.values(macroTotals).reduce((s, v) => s + v, 0)
              merciTotal = totalGross - costLinesTotal

              const costColors = ['#f43f5e', '#6366f1', '#06b6d4', '#8b5cf6', '#94a3b8']
              setPieCosti([
                { name: 'Merci/Merce', value: Math.max(0, merciTotal), color: costColors[0] },
                { name: 'Locazioni', value: macroTotals.locazione || 0, color: costColors[3] },
                { name: 'Servizi/Admin', value: macroTotals.generali_amministrative || 0, color: costColors[2] },
                { name: 'Personale', value: macroTotals.personale || 0, color: costColors[1] },
                { name: 'Altro', value: (macroTotals.finanziarie || 0) + (macroTotals.oneri_diversi || 0), color: costColors[4] },
              ])
            }
          } catch (e) { console.warn('fatture fallback error:', e.message) }
        }

        // 3. Previous year for comparison
        let prevRicavi = 0
        try {
          const { data: dashPrevData } = await supabase
            .from('v_executive_dashboard')
            .select('total_revenue')
            .eq('company_id', COMPANY_ID)
            .eq('year', YEAR - 1)
            .maybeSingle()
          prevRicavi = dashPrevData?.total_revenue || 0
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

        // 4. Outlet ranking (from views)
        try {
          const { data: outletsRaw } = await supabase
            .from('v_outlet_ranking')
            .select('*')
            .eq('company_id', COMPANY_ID)
            .eq('year', YEAR)
            .order('rank_revenue', { ascending: true })

          const outlets = (outletsRaw || []).map((o, i) => ({
            name: o.outlet_name,
            ricavi: o.ytd_revenue || 0,
            dip: o.staff_count || 0,
            colore: OUTLET_COLORS[i % OUTLET_COLORS.length],
          }))
          setOutletsData(outlets)
          setTotalOutlets(outlets.length)
        } catch (e) { console.warn('v_outlet_ranking not available:', e.message) }

        // 5. Cash position
        try {
          const { data: cashData } = await supabase
            .from('v_cash_position')
            .select('current_balance')
            .eq('company_id', COMPANY_ID)
          setLiquidita((cashData || []).reduce((sum, c) => sum + (c.current_balance || 0), 0))
        } catch (e) { console.warn('v_cash_position not available:', e.message) }

        // 5b. Cash flow trends (weekly from cash_movements, last 30 days)
        try {
          const thirtyDaysAgo = new Date()
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
          const fromDate = thirtyDaysAgo.toISOString().split('T')[0]

          const { data: cmData } = await supabase
            .from('cash_movements')
            .select('date, type, amount')
            .eq('company_id', COMPANY_ID)
            .gte('date', fromDate)

          if (cmData && cmData.length > 0) {
            // Aggregate by week and type
            const weekMap = {}
            let totEntrate = 0, totUscite = 0
            cmData.forEach(row => {
              const d = new Date(row.date)
              // Get Monday of the week
              const day = d.getDay()
              const diff = d.getDate() - day + (day === 0 ? -6 : 1)
              const monday = new Date(d.setDate(diff))
              const weekKey = monday.toISOString().split('T')[0]
              if (!weekMap[weekKey]) weekMap[weekKey] = { week: weekKey, entrate: 0, uscite: 0 }
              const absAmount = Math.abs(parseFloat(row.amount) || 0)
              if (row.type === 'inflow') {
                weekMap[weekKey].entrate += absAmount
                totEntrate += absAmount
              } else {
                weekMap[weekKey].uscite += absAmount
                totUscite += absAmount
              }
            })
            const weeklyData = Object.values(weekMap).sort((a, b) => a.week.localeCompare(b.week))
            setCashFlowWeekly(weeklyData)
            setCashFlowTotals({ entrate: totEntrate, uscite: totUscite })
          } else {
            setCashFlowWeekly([])
            setCashFlowTotals({ entrate: 0, uscite: 0 })
          }
        } catch (e) { console.warn('cash_movements trends error:', e.message) }

        // 6. Loans
        try {
          const { data: loansData } = await supabase
            .from('v_loans_overview')
            .select('total_amount')
            .eq('company_id', COMPANY_ID)
          setDebtiFin((loansData || []).reduce((sum, l) => sum + (l.total_amount || 0), 0))
        } catch (e) { console.warn('v_loans_overview not available:', e.message) }

        // 7. Staff
        try {
          const { data: staffData } = await supabase
            .from('v_staff_analysis')
            .select('active_employees, total_annual_cost')
            .eq('company_id', COMPANY_ID)
          if (staffData && staffData.length > 0) {
            setTotalStaff(staffData.reduce((sum, s) => sum + (s.active_employees || 0), 0))
            const viewStaffCosts = staffData.reduce((sum, s) => sum + (s.total_annual_cost || 0), 0)
            if (viewStaffCosts > 0) setStaffCosts(viewStaffCosts)
          }
        } catch (e) { console.warn('v_staff_analysis not available:', e.message) }

        // 8. P&L monthly for cost composition (only if views had data)
        if (hasViewData) {
          try {
            const { data: pnlData } = await supabase
              .from('v_pnl_monthly')
              .select('*')
              .eq('company_id', COMPANY_ID)
              .eq('year', YEAR)

            const costCategories = { 'Merci': 0, 'Personale': 0, 'Servizi': 0, 'Affitti': 0, 'Altro': 0 }
            ;(pnlData || []).forEach(row => {
              costCategories['Merci'] += row.cogs || 0
              costCategories['Personale'] += row.staff_costs || 0
              costCategories['Servizi'] += row.general_admin_costs || 0
              costCategories['Affitti'] += row.location_costs || 0
              costCategories['Altro'] += (row.financial_costs || 0) + (row.other_costs || 0)
            })
            const costColors = ['#f43f5e', '#6366f1', '#06b6d4', '#8b5cf6', '#94a3b8']
            setPieCosti(Object.entries(costCategories).map(([name, value], i) => ({
              name, value, color: costColors[i],
            })))
          } catch (e) { console.warn('v_pnl_monthly not available:', e.message) }
        }

        // 9. Company settings
        try {
          const { data: companyData } = await supabase
            .from('company_settings')
            .select('ragione_sociale, sede_legale, partita_iva, amministratore, soci, ateco, data_costituzione')
            .eq('company_id', COMPANY_ID)
            .maybeSingle()

          if (companyData) {
            setVisura({
              denominazione: companyData.ragione_sociale || '—',
              sede: companyData.sede_legale || '—',
              piva: companyData.partita_iva || '—',
              amministratore: companyData.amministratore || '—',
              soci: Array.isArray(companyData.soci)
                ? companyData.soci.map(s => `${s.nome} (${s.quota})`).join(', ')
                : (companyData.soci || '—'),
              ateco: companyData.ateco || '—',
              costituzione: companyData.data_costituzione || '—',
            })
          }
        } catch (e) { console.warn('company_settings error:', e.message) }

        setLoading(false)
      } catch (err) {
        console.error('Dashboard fetch error:', err)
        setError(err.message)
        setLoading(false)
      }
    }

    fetchData()
  }, [COMPANY_ID, dashYear])

  // Fetch AI insights (separate to not slow down main load)
  useEffect(() => {
    if (!COMPANY_ID) return
    const fetchAI = async () => {
      try {
        const [movRes, anomRes, reconRes, payRes] = await Promise.all([
          supabase.from('cash_movements').select('id, cost_category_id, ai_category_id, ai_confidence, ai_method, amount, type', { count: 'exact' }).eq('company_id', COMPANY_ID),
          supabase.from('ai_anomaly_log').select('id, anomaly_type', { count: 'exact' }).eq('company_id', COMPANY_ID).eq('resolved', false),
          supabase.from('reconciliation_log').select('id, match_type', { count: 'exact' }).eq('company_id', COMPANY_ID),
          supabase.from('payables').select('id, status, due_date', { count: 'exact' }).eq('company_id', COMPANY_ID).in('status', ['da_pagare', 'in_scadenza', 'scaduto']),
        ])
        const movs = movRes.data || []
        const categorized = movs.filter(m => m.cost_category_id).length
        const aiPending = movs.filter(m => m.ai_category_id && !m.cost_category_id).length
        const uncategorized = movs.filter(m => !m.cost_category_id && !m.ai_category_id).length
        const avgConfidence = movs.filter(m => m.ai_confidence).reduce((s, m) => s + Number(m.ai_confidence), 0) / (movs.filter(m => m.ai_confidence).length || 1)

        const reconTotal = reconRes.count || 0
        const anomalies = anomRes.count || 0

        const overdue = (payRes.data || []).filter(p => p.status === 'scaduto').length
        const dueThisWeek = (payRes.data || []).filter(p => {
          if (!p.due_date) return false
          const due = new Date(p.due_date)
          const now = new Date()
          const diffDays = Math.round((due - now) / (1000 * 60 * 60 * 24))
          return diffDays >= 0 && diffDays <= 7
        }).length

        setAiInsights({
          totalMov: movs.length, categorized, aiPending, uncategorized,
          categorizationPct: movs.length > 0 ? Math.round((categorized / movs.length) * 100) : 0,
          avgConfidence: Math.round(avgConfidence * 100),
          anomalies, reconTotal, overdue, dueThisWeek,
        })
      } catch (e) {
        console.warn('AI insights fetch error:', e)
      }
    }
    fetchAI()
  }, [COMPANY_ID])

  // Derived calculations
  const YEAR = dashYear
  const deltaRicaviPct = ricaviPrevYear > 0 ? ((ricavi - ricaviPrevYear) / ricaviPrevYear * 100) : 0
  const pfn = liquidita - debtiFin
  const incidenzaPersonale = ricavi > 0 ? (staffCosts / ricavi * 100) : 0
  const incidenzaMerci = ricavi > 0 ? ((pieCosti[0]?.value || 0) / ricavi * 100) : 0
  const ricavoPerDip = totalStaff > 0 ? ricavi / totalStaff : 0
  const ricavoMedioOutlet = outletsData.length > 0 ? ricavi / outletsData.length : 0
  const outletsAttivi = outletsData.length

  // Loading state
  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <Loader className="animate-spin mx-auto text-slate-400" size={40} />
          <p className="text-slate-500">Caricamento dati dashboard...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
          <h2 className="text-lg font-semibold mb-2">Errore nel caricamento</h2>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Buongiorno, {profile?.first_name || 'Patrizio'}
          </h1>
          <p className="text-sm text-slate-500">
            {visura.denominazione} — Cruscotto direzionale | Dati {YEAR}
          </p>
          {dataSource === 'bilancio' && (
            <p className="text-xs text-blue-500 mt-0.5 flex items-center gap-1">
              <FileText size={12} /> Dati da bilancio importato (Conto Economico)
            </p>
          )}
          {dataSource === 'fatture' && (
            <p className="text-xs text-emerald-500 mt-0.5 flex items-center gap-1">
              <Receipt size={12} /> Dati da fatture elettroniche AdE (Q1 {YEAR})
            </p>
          )}
        </div>
        <select value={dashYear} onChange={(e) => setDashYear(parseInt(e.target.value))}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
          {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* ─── KPI PRINCIPALI ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={DollarSign} title={`Ricavi ${YEAR}`} color="blue"
          value={`${fmt(ricavi)} €`}
          trend={deltaRicaviPct}
          subtitle={`vs ${fmt(ricaviPrevYear)} € nel ${YEAR - 1}`}
          link="/conto-economico"
        />
        <KpiCard
          icon={TrendingUp} title="Utile netto" color={utile > 0 ? 'green' : 'red'}
          value={`${fmt(utile)} €`}
          subtitle={`Margine: ${ricavi > 0 ? (utile / ricavi * 100).toFixed(1) : '—'}%`}
          link="/conto-economico"
        />
        <KpiCard
          icon={Wallet} title="Liquidità totale" color="cyan"
          value={`${fmt(liquidita)} €`}
          subtitle="Conto corrente + Casse"
          link="/banche"
        />
        <KpiCard
          icon={HandCoins} title="Posizione fin. netta" color={pfn >= 0 ? 'green' : 'red'}
          value={`${fmt(pfn)} €`}
          subtitle={`Debiti fin.: ${fmt(debtiFin)} €`}
          link="/banche"
        />
      </div>

      {/* ─── KPI SECONDARI ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs text-slate-400">Outlet attivi</div>
          <div className="text-xl font-bold text-slate-900">{outletsAttivi}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs text-slate-400">Dipendenti</div>
          <div className="text-xl font-bold text-slate-900">{totalStaff}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs text-slate-400">Costo personale</div>
          <div className="text-xl font-bold text-amber-600">{fmt(staffCosts)} €</div>
          <div className="text-xs text-slate-400">{incidenzaPersonale.toFixed(1)}% ricavi</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs text-slate-400">Acquisto merci</div>
          <div className="text-xl font-bold text-red-600">{fmt(pieCosti[0]?.value || 0)} €</div>
          <div className="text-xs text-slate-400">{incidenzaMerci.toFixed(1)}% ricavi</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs text-slate-400">Ricavo/dipendente</div>
          <div className="text-xl font-bold text-blue-600">{fmt(ricavoPerDip)} €</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs text-slate-400">Media per outlet</div>
          <div className="text-xl font-bold text-slate-700">{fmt(ricavoMedioOutlet)} €</div>
        </div>
      </div>

      {/* ─── FLUSSO DI CASSA REALE ─── */}
      <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%)', border: '1px solid rgba(16,185,129,0.12)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Wallet size={16} className="text-emerald-500" /> Flusso di Cassa Reale — Ultimi 30 giorni
          </h2>
          <Link to="/banche" className="flex items-center gap-1 text-xs text-emerald-600 font-medium hover:text-emerald-800">
            Dettaglio banche <ArrowRight size={12} />
          </Link>
        </div>

        {cashFlowWeekly.length === 0 ? (
          <div className="flex items-center gap-3 py-6 px-4 bg-slate-50 rounded-xl">
            <Info size={18} className="text-slate-400 shrink-0" />
            <p className="text-sm text-slate-500">
              Importa estratti conto da ImportHub per vedere il flusso di cassa reale
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Summary cards */}
            <div className="space-y-3">
              <div className="bg-white rounded-xl border border-emerald-100 p-4">
                <div className="text-xs text-slate-400 mb-1">Totale Entrate</div>
                <div className="text-xl font-bold text-emerald-600">+{fmt(cashFlowTotals.entrate)} €</div>
              </div>
              <div className="bg-white rounded-xl border border-red-100 p-4">
                <div className="text-xs text-slate-400 mb-1">Totale Uscite</div>
                <div className="text-xl font-bold text-red-500">-{fmt(cashFlowTotals.uscite)} €</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-400 mb-1">Flusso Netto</div>
                <div className={`text-xl font-bold ${(cashFlowTotals.entrate - cashFlowTotals.uscite) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {(cashFlowTotals.entrate - cashFlowTotals.uscite) >= 0 ? '+' : ''}{fmt(cashFlowTotals.entrate - cashFlowTotals.uscite)} €
                </div>
              </div>
            </div>

            {/* Weekly bar chart */}
            <div className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={cashFlowWeekly} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="grad-entrate" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                    </linearGradient>
                    <linearGradient id="grad-uscite" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID_STYLE} />
                  <XAxis
                    dataKey="week"
                    {...AXIS_STYLE}
                    tickFormatter={v => {
                      const d = new Date(v)
                      return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
                    }}
                  />
                  <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    content={<GlassTooltip suffix="€" />}
                    cursor={{ fill: 'rgba(16,185,129,0.04)', radius: 8 }}
                  />
                  <Bar dataKey="entrate" name="Entrate" fill="url(#grad-entrate)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="uscite" name="Uscite" fill="url(#grad-uscite)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* ─── AI INSIGHTS ─── */}
      {aiInsights && (
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #faf5ff 50%, #f0fdfa 100%)', border: '1px solid rgba(99,102,241,0.12)' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Sparkles size={16} className="text-indigo-500" /> AI Insights
            </h2>
            <Link to="/banche" className="text-xs text-indigo-500 font-medium hover:text-indigo-700 flex items-center gap-1" onClick={() => {}}>
              AI Categorie <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="bg-white/80 rounded-xl p-3 border border-white/60">
              <div className="flex items-center gap-1.5 mb-1">
                <Brain size={13} className="text-blue-500" />
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Categorizzati</span>
              </div>
              <div className="text-lg font-bold text-slate-900">{aiInsights.categorizationPct}%</div>
              <div className="text-[10px] text-slate-400">{aiInsights.categorized}/{aiInsights.totalMov} movimenti</div>
            </div>
            <div className="bg-white/80 rounded-xl p-3 border border-white/60">
              <div className="flex items-center gap-1.5 mb-1">
                <Eye size={13} className="text-amber-500" />
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Da verificare</span>
              </div>
              <div className="text-lg font-bold text-amber-600">{aiInsights.aiPending}</div>
              <div className="text-[10px] text-slate-400">suggerimenti AI</div>
            </div>
            <div className="bg-white/80 rounded-xl p-3 border border-white/60">
              <div className="flex items-center gap-1.5 mb-1">
                <Target size={13} className="text-emerald-500" />
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Confidenza</span>
              </div>
              <div className="text-lg font-bold text-emerald-600">{aiInsights.avgConfidence}%</div>
              <div className="text-[10px] text-slate-400">media AI</div>
            </div>
            <div className="bg-white/80 rounded-xl p-3 border border-white/60">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle size={13} className="text-purple-500" />
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Anomalie</span>
              </div>
              <div className={`text-lg font-bold ${aiInsights.anomalies > 0 ? 'text-purple-600' : 'text-slate-400'}`}>{aiInsights.anomalies}</div>
              <div className="text-[10px] text-slate-400">da investigare</div>
            </div>
            <div className="bg-white/80 rounded-xl p-3 border border-white/60">
              <div className="flex items-center gap-1.5 mb-1">
                <Receipt size={13} className="text-red-500" />
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Scadute</span>
              </div>
              <div className={`text-lg font-bold ${aiInsights.overdue > 0 ? 'text-red-500' : 'text-slate-400'}`}>{aiInsights.overdue}</div>
              <div className="text-[10px] text-slate-400">fatture non pagate</div>
            </div>
            <div className="bg-white/80 rounded-xl p-3 border border-white/60">
              <div className="flex items-center gap-1.5 mb-1">
                <Shield size={13} className="text-blue-500" />
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Riconciliazioni</span>
              </div>
              <div className="text-lg font-bold text-blue-600">{aiInsights.reconTotal}</div>
              <div className="text-[10px] text-slate-400">totale storico</div>
            </div>
          </div>
        </div>
      )}

      {/* ─── GRAFICI + OUTLET RANKING ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Ricavi per outlet — gradient bars */}
        <div className="lg:col-span-2 rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Ricavi per outlet {YEAR}</h2>
            <Link to="/confronto-outlet" className="flex items-center gap-1 text-xs text-indigo-500 font-medium hover:text-indigo-700">
              Confronto completo <ArrowRight size={12} />
            </Link>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={outletsData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
              <defs>
                {outletsData.map((o, i) => (
                  <linearGradient key={i} id={`bar-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={o.colore} stopOpacity={1} />
                    <stop offset="100%" stopColor={o.colore} stopOpacity={0.5} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="name" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<GlassTooltip suffix="€" />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
              <Bar dataKey="ricavi" radius={[8, 8, 0, 0]} animationDuration={800}>
                {outletsData.map((o, i) => <Cell key={i} fill={`url(#bar-grad-${i})`} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Composizione costi — donut con centro */}
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Composizione costi {YEAR}</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <defs>
                {pieCosti.map((d, i) => (
                  <linearGradient key={i} id={`pie-grad-${i}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={d.color} stopOpacity={1} />
                    <stop offset="100%" stopColor={d.color} stopOpacity={0.6} />
                  </linearGradient>
                ))}
              </defs>
              <Pie data={pieCosti} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} strokeWidth={0} paddingAngle={3}>
                {pieCosti.map((d, i) => <Cell key={i} fill={`url(#pie-grad-${i})`} stroke="white" strokeWidth={2} />)}
              </Pie>
              <Tooltip content={<GlassTooltip suffix="€" />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-3">
            {pieCosti.map(d => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-md" style={{ background: `linear-gradient(135deg, ${d.color}, ${d.color}99)` }} />
                  <span className="text-slate-600 font-medium">{d.name}</span>
                </div>
                <span className="font-semibold text-slate-800">{ricavi > 0 ? (d.value / ricavi * 100).toFixed(1) : '—'}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── RANKING OUTLET + ALERT ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Ranking */}
        <div className="lg:col-span-2 rounded-2xl shadow-lg overflow-hidden" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="px-5 py-4 border-b border-slate-100/60 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Target size={16} className="text-indigo-500" /> Ranking outlet per ricavi
            </h2>
            <Link to="/confronto-outlet" className="text-xs text-blue-500 font-medium hover:text-blue-700">
              Vedi P&L completo →
            </Link>
          </div>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr className="text-xs text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 px-4 text-left font-medium">#</th>
                <th className="py-2.5 px-4 text-left font-medium">Outlet</th>
                <th className="py-2.5 px-4 text-right font-medium">Ricavi</th>
                <th className="py-2.5 px-4 text-right font-medium">% Tot</th>
                <th className="py-2.5 px-4 text-right font-medium">Dip.</th>
                <th className="py-2.5 px-4 text-right font-medium">€/Dip.</th>
              </tr>
            </thead>
            <tbody>
              {outletsData.map((o, i) => (
                <tr key={o.name} className="border-t border-slate-50 hover:bg-slate-50/50 transition text-sm">
                  <td className="py-2.5 px-4">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      i === 0 ? 'bg-yellow-100 text-yellow-700' : 'text-slate-400'
                    }`}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: o.colore }} />
                      <span className="font-medium text-slate-900">{o.name}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-semibold text-slate-900">{fmt(o.ricavi)} €</td>
                  <td className="py-2.5 px-4 text-right text-slate-500">{ricavi > 0 ? (o.ricavi / ricavi * 100).toFixed(1) : '—'}%</td>
                  <td className="py-2.5 px-4 text-right text-slate-600">{o.dip}</td>
                  <td className="py-2.5 px-4 text-right text-blue-600 font-medium">{fmt(o.dip > 0 ? o.ricavi / o.dip : 0)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Colonna destra: alert + info azienda + quick links */}
        <div className="space-y-4">
          {/* Alert / Segnalazioni */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Segnalazioni</h3>

            {pfn < 0 && (
              <AlertCard icon={AlertTriangle} color="bg-red-50 border-red-200 text-red-700" title="Indebitamento netto">
                PFN negativa: {fmt(pfn)} €.
              </AlertCard>
            )}

            {incidenzaMerci > 50 && (
              <AlertCard icon={AlertTriangle} color="bg-amber-50 border-amber-200 text-amber-700" title="Incidenza merci elevata">
                Le materie prime pesano il {incidenzaMerci.toFixed(1)}% sui ricavi. Margine da monitorare.
              </AlertCard>
            )}

            {utile > 0 ? (
              <AlertCard icon={CheckCircle2} color="bg-emerald-50 border-emerald-200 text-emerald-700" title="Esercizio in utile">
                Risultato positivo: +{fmt(utile)} €. Margine: {ricavi > 0 ? (utile / ricavi * 100).toFixed(1) : '—'}%.
              </AlertCard>
            ) : (
              <AlertCard icon={AlertTriangle} color="bg-red-50 border-red-200 text-red-700" title="Esercizio in perdita">
                Risultato negativo: {fmt(utile)} €.
              </AlertCard>
            )}
          </div>

          {/* Info azienda */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Società</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Ragione sociale</span><span className="font-medium text-slate-900">{visura.denominazione}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Sede</span><span className="text-slate-700">{visura.sede}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">P.IVA</span><span className="font-mono text-slate-700">{visura.piva}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Amministratore</span><span className="text-slate-700">{visura.amministratore}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Costituzione</span><span className="text-slate-700">{visura.costituzione}</span></div>
              <div className="text-xs text-slate-400 mt-1">{visura.soci}</div>
            </div>
          </div>

          {/* Quick links */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Accesso rapido</h3>
            </div>
            <div className="divide-y divide-slate-50">
              <QuickLink to="/confronto-outlet" icon={GitCompare} label="Confronto Outlet" color="bg-blue-50 text-blue-600" />
              <QuickLink to="/conto-economico" icon={BarChart3} label="Conto Economico" color="bg-emerald-50 text-emerald-600" />
              <QuickLink to="/banche" icon={Landmark} label="Banche & Tesoreria" color="bg-amber-50 text-amber-600" />
              <QuickLink to="/dipendenti" icon={Users} label="Dipendenti & Costi" color="bg-purple-50 text-purple-600" />
              <QuickLink to="/outlet" icon={Store} label="Gestione Outlet" color="bg-cyan-50 text-cyan-600" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
