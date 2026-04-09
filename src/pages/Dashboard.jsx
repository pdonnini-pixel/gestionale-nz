import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, DollarSign, Store, Wallet, Users,
  ArrowUpRight, ArrowRight, Landmark, Building2, HandCoins,
  BarChart3, GitCompare, Receipt, FileText, Percent,
  AlertTriangle, CheckCircle2, Target, Loader
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
  const CURRENT_YEAR = 2025
  const YEAR = CURRENT_YEAR - 1

  // State for all data
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        // 1. Fetch executive dashboard for current year
        const { data: dashData, error: dashErr } = await supabase
          .from('v_executive_dashboard')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('year', YEAR)
          .single()

        if (dashErr) throw dashErr

        setRicavi(dashData?.total_revenue || 0)
        setUtile(dashData?.total_net_result || 0)
        setTotalCosti(dashData?.total_cogs || 0)

        // 2. Fetch executive dashboard for previous year
        const { data: dashPrevData } = await supabase
          .from('v_executive_dashboard')
          .select('total_revenue')
          .eq('company_id', COMPANY_ID)
          .eq('year', YEAR - 1)
          .single()

        setRicaviPrevYear(dashPrevData?.total_revenue || 0)

        // 3. Fetch outlet ranking
        const { data: outletsRaw, error: outletsErr } = await supabase
          .from('v_outlet_ranking')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('year', YEAR)
          .order('rank_revenue', { ascending: true })

        if (outletsErr) throw outletsErr

        const outlets = (outletsRaw || []).map((o, i) => ({
          name: o.outlet_name,
          ricavi: o.ytd_revenue || 0,
          dip: o.staff_count || 0,
          colore: OUTLET_COLORS[i % OUTLET_COLORS.length],
        }))

        setOutletsData(outlets)
        setTotalOutlets(outlets.length)

        // 4. Fetch cash position
        const { data: cashData, error: cashErr } = await supabase
          .from('v_cash_position')
          .select('current_balance')
          .eq('company_id', COMPANY_ID)

        if (cashErr) throw cashErr

        const totalLiquidita = (cashData || []).reduce((sum, c) => sum + (c.current_balance || 0), 0)
        setLiquidita(totalLiquidita)

        // 5. Fetch loans overview
        const { data: loansData, error: loansErr } = await supabase
          .from('v_loans_overview')
          .select('total_amount')
          .eq('company_id', COMPANY_ID)

        if (loansErr) throw loansErr

        const totalDebts = (loansData || []).reduce((sum, l) => sum + (l.total_amount || 0), 0)
        setDebtiFin(totalDebts)

        // 6. Fetch staff analysis
        const { data: staffData, error: staffErr } = await supabase
          .from('v_staff_analysis')
          .select('active_employees, total_annual_cost')
          .eq('company_id', COMPANY_ID)

        if (staffErr) throw staffErr

        const totalEmps = (staffData || []).reduce((sum, s) => sum + (s.active_employees || 0), 0)
        const totalStaffCosts = (staffData || []).reduce((sum, s) => sum + (s.total_annual_cost || 0), 0)
        setTotalStaff(totalEmps)
        setStaffCosts(totalStaffCosts)

        // 7. Fetch P&L monthly for cost composition
        const { data: pnlData, error: pnlErr } = await supabase
          .from('v_pnl_monthly')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('year', YEAR)

        if (pnlErr) throw pnlErr

        // Aggregate costs by category
        const costCategories = {
          'Merci': 0,
          'Personale': 0,
          'Servizi': 0,
          'Affitti': 0,
          'Altro': 0,
        }

        (pnlData || []).forEach(row => {
          costCategories['Merci'] += row.cogs || 0
          costCategories['Personale'] += row.staff_costs || 0
          costCategories['Servizi'] += row.general_admin_costs || 0
          costCategories['Affitti'] += row.location_costs || 0
          costCategories['Altro'] += (row.financial_costs || 0) + (row.other_costs || 0)
        })

        const costColors = ['#f43f5e', '#6366f1', '#06b6d4', '#8b5cf6', '#94a3b8']
        const costEntries = Object.entries(costCategories).map(([name, value], i) => ({
          name,
          value,
          color: costColors[i],
        }))

        setPieCosti(costEntries)

        // 8. Fetch company settings
        const { data: companyData, error: companyErr } = await supabase
          .from('company_settings')
          .select('ragione_sociale, sede, p_iva, amministratore, soci, ateco, data_costituzione')
          .eq('company_id', COMPANY_ID)
          .single()

        if (companyErr && companyErr.code !== 'PGRST116') throw companyErr

        if (companyData) {
          setVisura({
            denominazione: companyData.ragione_sociale || '—',
            sede: companyData.sede || '—',
            piva: companyData.p_iva || '—',
            amministratore: companyData.amministratore || '—',
            soci: companyData.soci || '—',
            ateco: companyData.ateco || '—',
            costituzione: companyData.data_costituzione || '—',
          })
        }

        setLoading(false)
      } catch (err) {
        console.error('Dashboard fetch error:', err)
        setError(err.message)
        setLoading(false)
      }
    }

    fetchData()
  }, [COMPANY_ID, YEAR])

  // Derived calculations
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
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Buongiorno, {profile?.first_name || 'Patrizio'}
        </h1>
        <p className="text-sm text-slate-500">
          {visura.denominazione} — Cruscotto direzionale | Dati {YEAR}
        </p>
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
