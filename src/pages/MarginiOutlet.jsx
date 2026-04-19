import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { TrendingUp, Loader2, AlertCircle } from 'lucide-react'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE, OUTLET_COLORS } from '../components/ChartTheme'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const fmt = (n) => n == null ? '\u2014' : new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(n)
const fmtPct = (n) => n == null ? '\u2014' : `${n.toFixed(1)}%`

export default function MarginiOutlet() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [year, setYear] = useState(2026)
  const [rawData, setRawData] = useState([])

  // Fetch budget_entries for all outlets, selected year
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const companyId = profile?.company_id
        let query = supabase
          .from('budget_entries')
          .select('cost_center, account_code, budget_amount')
          .eq('year', year)

        if (companyId) {
          query = query.eq('company_id', companyId)
        }

        const { data, error: fetchError } = await query

        if (fetchError) throw fetchError
        setRawData(data || [])
      } catch (err) {
        console.error('[MarginiOutlet] fetch error:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [year, profile?.company_id])

  // Compute margins per outlet
  const outletMargins = useMemo(() => {
    if (!rawData.length) return []

    // Group by cost_center (outlet)
    const byOutlet = {}
    rawData.forEach(row => {
      const outlet = row.cost_center || 'Sconosciuto'
      if (!byOutlet[outlet]) byOutlet[outlet] = { ricavi: 0, costi: 0 }

      const code = (row.account_code || '').toString()
      const amount = parseFloat(row.budget_amount) || 0

      // Revenue accounts: codes starting with '5'
      if (code.startsWith('5')) {
        byOutlet[outlet].ricavi += amount
      }
      // Cost accounts: codes starting with '6' or '7'
      else if (code.startsWith('6') || code.startsWith('7')) {
        byOutlet[outlet].costi += amount
      }
    })

    return Object.entries(byOutlet)
      .map(([nome, vals]) => {
        const margine = vals.ricavi - vals.costi
        const marginePercent = vals.ricavi > 0 ? (margine / vals.ricavi) * 100 : 0
        return {
          nome,
          ricavi: vals.ricavi,
          costi: vals.costi,
          margine,
          marginePercent,
        }
      })
      .sort((a, b) => b.marginePercent - a.marginePercent)
  }, [rawData])

  // Chart data
  const chartData = useMemo(() => {
    return outletMargins.map(o => ({
      nome: o.nome,
      Ricavi: Math.round(o.ricavi),
      Costi: Math.round(o.costi),
      Margine: Math.round(o.margine),
    }))
  }, [outletMargins])

  // Color helper for margin %
  const marginColor = (pct) => {
    if (pct > 10) return 'text-green-700 bg-green-50'
    if (pct >= 0) return 'text-amber-700 bg-amber-50'
    return 'text-red-700 bg-red-50'
  }

  const marginBadge = (pct) => {
    if (pct > 10) return 'bg-green-100 text-green-800'
    if (pct >= 0) return 'bg-amber-100 text-amber-800'
    return 'bg-red-100 text-red-800'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-600">Caricamento margini outlet...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <p className="text-red-800 font-medium">Errore nel caricamento</p>
          <p className="text-red-600 text-sm mt-1">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 mb-2 flex items-center gap-3">
              <TrendingUp className="w-10 h-10 text-blue-600" />
              Analisi Margini per Outlet
            </h1>
            <p className="text-slate-600">Confronto ricavi, costi e margini tra tutti gli outlet - Anno {year}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700">Anno:</label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {[2024, 2025, 2026, 2027].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        {outletMargins.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 text-lg">Nessun dato budget trovato per l'anno {year}</p>
            <p className="text-slate-500 text-sm mt-2">Verifica che esistano budget_entries con account_code che inizia per 5 (ricavi) o 6/7 (costi)</p>
          </div>
        ) : (
          <>
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <p className="text-slate-600 text-sm font-medium mb-1">Outlet Analizzati</p>
                <p className="text-2xl font-bold text-slate-900">{outletMargins.length}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <p className="text-slate-600 text-sm font-medium mb-1">Ricavi Totali</p>
                <p className="text-2xl font-bold text-slate-900">{fmt(outletMargins.reduce((s, o) => s + o.ricavi, 0))} &euro;</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <p className="text-slate-600 text-sm font-medium mb-1">Costi Totali</p>
                <p className="text-2xl font-bold text-slate-900">{fmt(outletMargins.reduce((s, o) => s + o.costi, 0))} &euro;</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <p className="text-slate-600 text-sm font-medium mb-1">Margine Medio</p>
                <p className="text-2xl font-bold text-slate-900">
                  {fmtPct(outletMargins.reduce((s, o) => s + o.marginePercent, 0) / outletMargins.length)}
                </p>
              </div>
            </div>

            {/* Bar Chart - Outlet Comparison */}
            <div className="rounded-2xl p-6 shadow-lg mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Confronto Ricavi vs Costi per Outlet</h2>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={chartData} barGap={4}>
                  <defs>
                    <linearGradient id="grad-ricavi-mo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                    </linearGradient>
                    <linearGradient id="grad-costi-mo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
                    </linearGradient>
                    <linearGradient id="grad-margine-mo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID_STYLE} />
                  <XAxis dataKey="nome" {...AXIS_STYLE} />
                  <YAxis {...AXIS_STYLE} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip content={<GlassTooltip formatter={(value) => fmt(value) + ' \u20ac'} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                  <Legend />
                  <Bar dataKey="Ricavi" fill="url(#grad-ricavi-mo)" radius={[8, 8, 0, 0]} animationDuration={800} />
                  <Bar dataKey="Costi" fill="url(#grad-costi-mo)" radius={[8, 8, 0, 0]} animationDuration={800} />
                  <Bar dataKey="Margine" fill="url(#grad-margine-mo)" radius={[8, 8, 0, 0]} animationDuration={800} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Dettaglio Margini per Outlet</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-4 py-3 text-left text-slate-700 font-semibold">Outlet</th>
                      <th className="px-4 py-3 text-right text-slate-700 font-semibold">Ricavi</th>
                      <th className="px-4 py-3 text-right text-slate-700 font-semibold">Costi</th>
                      <th className="px-4 py-3 text-right text-slate-700 font-semibold">Margine</th>
                      <th className="px-4 py-3 text-right text-slate-700 font-semibold">Margine %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outletMargins.map((o, idx) => (
                      <tr key={o.nome} className={`border-b border-slate-100 ${idx === 0 ? 'bg-green-50' : idx === outletMargins.length - 1 ? 'bg-red-50' : ''}`}>
                        <td className="px-4 py-3 text-slate-900 font-medium">{o.nome}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(o.ricavi)} &euro;</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(o.costi)} &euro;</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(o.margine)} &euro;</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${marginBadge(o.marginePercent)}`}>
                            {fmtPct(o.marginePercent)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                      <td className="px-4 py-3 text-slate-900">TOTALE</td>
                      <td className="px-4 py-3 text-right text-slate-900">{fmt(outletMargins.reduce((s, o) => s + o.ricavi, 0))} &euro;</td>
                      <td className="px-4 py-3 text-right text-slate-900">{fmt(outletMargins.reduce((s, o) => s + o.costi, 0))} &euro;</td>
                      <td className="px-4 py-3 text-right text-slate-900">
                        {fmt(outletMargins.reduce((s, o) => s + o.margine, 0))} &euro;
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(() => {
                          const totR = outletMargins.reduce((s, o) => s + o.ricavi, 0)
                          const totM = outletMargins.reduce((s, o) => s + o.margine, 0)
                          const pct = totR > 0 ? (totM / totR) * 100 : 0
                          return (
                            <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${marginBadge(pct)}`}>
                              {fmtPct(pct)}
                            </span>
                          )
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
