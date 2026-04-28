import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, LabelList,
} from 'recharts'
import { TrendingUp, Loader2, AlertCircle, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE, OUTLET_COLORS } from '../components/ChartTheme'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { usePeriod } from '../hooks/usePeriod'
import { useTableSort } from '../hooks/useTableSort'
import SortableTh from '../components/ui/SortableTh'
import PageHelp from '../components/PageHelp'

const fmt = (n) => n == null ? '\u2014' : new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(n)
const fmtPct = (n) => n == null ? '\u2014' : `${n.toFixed(1)}%`

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

// Heatmap color: green (high margin) -> yellow -> red (low/negative margin)
function heatmapColor(pct) {
  if (pct == null) return '#f1f5f9' // no data
  if (pct >= 15) return '#22c55e'
  if (pct >= 10) return '#86efac'
  if (pct >= 5) return '#fde047'
  if (pct >= 0) return '#fbbf24'
  if (pct >= -5) return '#f87171'
  return '#dc2626'
}

function heatmapText(pct) {
  if (pct == null) return 'text-slate-400'
  if (pct >= 10) return 'text-white'
  if (pct >= 5) return 'text-slate-900'
  if (pct >= 0) return 'text-slate-900'
  return 'text-white'
}

export default function MarginiOutlet() {
  const { profile } = useAuth()
  // Anno: si inizializza dal globalYear del PeriodContext (selettore header)
  // e si sincronizza quando cambia. L'utente puo' sovrascriverlo localmente.
  const { year: globalYear } = usePeriod()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [year, setYear] = useState(globalYear || 2026)
  useEffect(() => { if (globalYear) setYear(globalYear) }, [globalYear])
  const [rawData, setRawData] = useState([])
  const [expandedOutlet, setExpandedOutlet] = useState(null)

  // Fetch budget_entries for all outlets, selected year (including month for heatmap)
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const companyId = profile?.company_id
        let query = supabase
          .from('budget_entries')
          .select('cost_center, account_code, budget_amount, month')
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

  // Compute margins per outlet (aggregated)
  const outletMargins = useMemo(() => {
    if (!rawData.length) return []

    const byOutlet = {}
    rawData.forEach(row => {
      const outlet = row.cost_center || 'Sconosciuto'
      if (!byOutlet[outlet]) byOutlet[outlet] = { ricavi: 0, costi: 0 }

      const code = (row.account_code || '').toString()
      const amount = parseFloat(row.budget_amount) || 0

      if (code.startsWith('5')) {
        byOutlet[outlet].ricavi += amount
      } else if (code.startsWith('6') || code.startsWith('7')) {
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

  // Sort tabella margini per outlet
  const { sorted: sortedMargins, sortBy: moSortBy, onSort: moOnSort, reset: moResetSort } = useTableSort(
    outletMargins,
    [{ key: 'marginePercent', dir: 'desc' }],
    { persistKey: 'margini_outlet', resetOn: [year] }
  )

  // Heatmap data: months (columns) x outlets (rows) with margin %
  const heatmapData = useMemo(() => {
    if (!rawData.length) return {}

    const byOutletMonth = {}
    rawData.forEach(row => {
      const outlet = row.cost_center || 'Sconosciuto'
      const month = parseInt(row.month) || 0
      if (month < 1 || month > 12) return

      const key = `${outlet}__${month}`
      if (!byOutletMonth[key]) byOutletMonth[key] = { ricavi: 0, costi: 0 }

      const code = (row.account_code || '').toString()
      const amount = parseFloat(row.budget_amount) || 0

      if (code.startsWith('5')) {
        byOutletMonth[key].ricavi += amount
      } else if (code.startsWith('6') || code.startsWith('7')) {
        byOutletMonth[key].costi += amount
      }
    })

    // Build map: outlet -> month -> marginPercent
    const result = {}
    Object.entries(byOutletMonth).forEach(([key, vals]) => {
      const [outlet, monthStr] = key.split('__')
      const month = parseInt(monthStr)
      if (!result[outlet]) result[outlet] = {}
      const margine = vals.ricavi - vals.costi
      result[outlet][month] = vals.ricavi > 0 ? (margine / vals.ricavi) * 100 : (margine < 0 ? -100 : 0)
    })

    return result
  }, [rawData])

  // Drill-down: breakdown by account for the expanded outlet
  const drilldownData = useMemo(() => {
    if (!expandedOutlet || !rawData.length) return { ricaviAccounts: [], costiAccounts: [] }

    const ricaviMap = {}
    const costiMap = {}

    rawData.forEach(row => {
      const outlet = row.cost_center || 'Sconosciuto'
      if (outlet !== expandedOutlet) return

      const code = (row.account_code || '').toString()
      const amount = parseFloat(row.budget_amount) || 0

      if (code.startsWith('5')) {
        const key = code.substring(0, 4) || code
        if (!ricaviMap[key]) ricaviMap[key] = { code: key, amount: 0 }
        ricaviMap[key].amount += amount
      } else if (code.startsWith('6') || code.startsWith('7')) {
        const key = code.substring(0, 4) || code
        if (!costiMap[key]) costiMap[key] = { code: key, amount: 0 }
        costiMap[key].amount += amount
      }
    })

    return {
      ricaviAccounts: Object.values(ricaviMap).sort((a, b) => b.amount - a.amount),
      costiAccounts: Object.values(costiMap).sort((a, b) => b.amount - a.amount),
    }
  }, [expandedOutlet, rawData])

  // Chart data with percentage labels
  const chartData = useMemo(() => {
    return outletMargins.map(o => ({
      nome: o.nome,
      Ricavi: Math.round(o.ricavi),
      Costi: Math.round(o.costi),
      Margine: Math.round(o.margine),
      marginePct: o.marginePercent,
    }))
  }, [outletMargins])

  // Outlets with critically low margin
  const criticalOutlets = useMemo(() => {
    return outletMargins.filter(o => o.marginePercent < 5)
  }, [outletMargins])

  const marginBadge = (pct) => {
    if (pct > 10) return 'bg-green-100 text-green-800'
    if (pct >= 0) return 'bg-amber-100 text-amber-800'
    return 'bg-red-100 text-red-800'
  }

  // Sorted outlet names for heatmap rows
  const outletNames = useMemo(() => {
    return outletMargins.map(o => o.nome)
  }, [outletMargins])

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

        {/* Alert Banner: critical margins */}
        {criticalOutlets.length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded-xl p-4 mb-6 flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-900 font-semibold">Attenzione: margini critici rilevati</p>
              <p className="text-red-700 text-sm mt-1">
                {criticalOutlets.length === 1
                  ? `L'outlet "${criticalOutlets[0].nome}" ha un margine del ${fmtPct(criticalOutlets[0].marginePercent)} (sotto la soglia del 5%).`
                  : `${criticalOutlets.length} outlet hanno margine inferiore al 5%: ${criticalOutlets.map(o => `${o.nome} (${fmtPct(o.marginePercent)})`).join(', ')}.`
                }
                {' '}Verifica la struttura dei costi di questi punti vendita.
              </p>
            </div>
          </div>
        )}

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

            {/* Bar Chart - Outlet Comparison with percentage labels */}
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
                  <Bar dataKey="Margine" fill="url(#grad-margine-mo)" radius={[8, 8, 0, 0]} animationDuration={800}>
                    <LabelList
                      dataKey="marginePct"
                      position="top"
                      formatter={(v) => `${v.toFixed(1)}%`}
                      style={{ fontSize: 11, fontWeight: 600, fill: '#334155' }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Heatmap Grid: months x outlets */}
            {Object.keys(heatmapData).length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-8">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Heatmap Margini Mensili</h2>
                <p className="text-sm text-slate-500 mb-4">Colore per margine %: verde = alto, giallo = medio, rosso = basso/negativo</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="px-3 py-2 text-left text-slate-700 font-semibold bg-slate-50 sticky left-0 z-10">Outlet</th>
                        {MONTHS.map((m, idx) => (
                          <th key={idx} className="px-2 py-2 text-center text-slate-700 font-semibold bg-slate-50 min-w-[56px]">{m}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {outletNames.map((outlet) => (
                        <tr key={outlet} className="border-b border-slate-100">
                          <td className="px-3 py-2 text-slate-900 font-medium bg-white sticky left-0 z-10">{outlet}</td>
                          {MONTHS.map((_, idx) => {
                            const monthNum = idx + 1
                            const pct = heatmapData[outlet]?.[monthNum] ?? null
                            return (
                              <td key={idx} className="px-1 py-1 text-center">
                                <div
                                  className={`rounded-md px-1 py-2 text-xs font-semibold ${heatmapText(pct)}`}
                                  style={{ backgroundColor: heatmapColor(pct) }}
                                  title={pct != null ? `${outlet} - ${MONTHS[idx]}: ${pct.toFixed(1)}%` : 'Nessun dato'}
                                >
                                  {pct != null ? `${pct.toFixed(0)}%` : '\u2014'}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Legend */}
                <div className="flex items-center gap-3 mt-4 text-xs text-slate-600">
                  <span>Legenda:</span>
                  {[
                    { label: '> 15%', color: '#22c55e' },
                    { label: '10-15%', color: '#86efac' },
                    { label: '5-10%', color: '#fde047' },
                    { label: '0-5%', color: '#fbbf24' },
                    { label: '-5-0%', color: '#f87171' },
                    { label: '< -5%', color: '#dc2626' },
                  ].map(item => (
                    <span key={item.label} className="flex items-center gap-1">
                      <span className="inline-block w-4 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Table with drill-down */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Dettaglio Margini per Outlet</h2>
              <p className="text-sm text-slate-500 mb-4">Clicca su un outlet per espandere il breakdown dei conti</p>
              {moSortBy.length > 0 && !(moSortBy.length === 1 && moSortBy[0].key === 'marginePercent' && moSortBy[0].dir === 'desc') && (
                <div className="px-3 py-1.5 mb-2 bg-blue-50/50 rounded text-xs text-blue-700 flex items-center gap-2">
                  <span>Ordinamento personalizzato attivo</span>
                  <button onClick={moResetSort} className="ml-auto text-blue-600 hover:text-blue-800 font-medium">Reset</button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <SortableTh sortKey="nome" sortBy={moSortBy} onSort={moOnSort}>Outlet</SortableTh>
                      <SortableTh sortKey="ricavi" sortBy={moSortBy} onSort={moOnSort} align="right">Ricavi</SortableTh>
                      <SortableTh sortKey="costi" sortBy={moSortBy} onSort={moOnSort} align="right">Costi</SortableTh>
                      <SortableTh sortKey="margine" sortBy={moSortBy} onSort={moOnSort} align="right">Margine</SortableTh>
                      <SortableTh sortKey="marginePercent" sortBy={moSortBy} onSort={moOnSort} align="right">Margine %</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMargins.map((o, idx) => {
                      const isExpanded = expandedOutlet === o.nome
                      return (
                        <tr key={o.nome} className="contents">
                          <tr
                            className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${idx === 0 ? 'bg-green-50' : idx === sortedMargins.length - 1 ? 'bg-red-50' : ''}`}
                            onClick={() => setExpandedOutlet(isExpanded ? null : o.nome)}
                          >
                            <td className="px-4 py-3 text-slate-900 font-medium flex items-center gap-2">
                              {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                              {o.nome}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-700">{fmt(o.ricavi)} &euro;</td>
                            <td className="px-4 py-3 text-right text-slate-700">{fmt(o.costi)} &euro;</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(o.margine)} &euro;</td>
                            <td className="px-4 py-3 text-right">
                              <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${marginBadge(o.marginePercent)}`}>
                                {fmtPct(o.marginePercent)}
                              </span>
                            </td>
                          </tr>
                          {/* Drill-down expanded row */}
                          {isExpanded && (
                            <tr className="border-b border-slate-200">
                              <td colSpan={5} className="px-6 py-4 bg-slate-50">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                  {/* Revenue accounts */}
                                  <div>
                                    <h4 className="text-sm font-semibold text-green-800 mb-2">Conti Ricavi</h4>
                                    {drilldownData.ricaviAccounts.length === 0 ? (
                                      <p className="text-xs text-slate-500">Nessun conto ricavi trovato</p>
                                    ) : (
                                      <div className="space-y-1">
                                        {drilldownData.ricaviAccounts.map(acc => (
                                          <div key={acc.code} className="flex justify-between text-xs">
                                            <span className="text-slate-700">Conto {acc.code}</span>
                                            <span className="font-medium text-green-700">{fmt(acc.amount)} &euro;</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  {/* Cost accounts */}
                                  <div>
                                    <h4 className="text-sm font-semibold text-red-800 mb-2">Conti Costi</h4>
                                    {drilldownData.costiAccounts.length === 0 ? (
                                      <p className="text-xs text-slate-500">Nessun conto costi trovato</p>
                                    ) : (
                                      <div className="space-y-1">
                                        {drilldownData.costiAccounts.map(acc => (
                                          <div key={acc.code} className="flex justify-between text-xs">
                                            <span className="text-slate-700">Conto {acc.code}</span>
                                            <span className="font-medium text-red-700">{fmt(acc.amount)} &euro;</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tr>
                      )
                    })}
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
      <PageHelp page="margini-outlet" />
    </div>
  )
}
