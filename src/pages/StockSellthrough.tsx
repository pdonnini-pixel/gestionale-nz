import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts'
import { TrendingUp, AlertTriangle, Package, Calendar, DollarSign, ChevronDown, ChevronUp, Store } from 'lucide-react'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import { useOutlets } from '../hooks/useOutlets'
import PageHeader from '../components/PageHeader'

function fmt(n: number, dec = 0): string {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}

// I dati di sell-through/giacenza di questa pagina sono SIMULATI: non esiste
// (ancora) una sorgente magazzino reale nel DB. Non sono più cablati sui 7
// outlet NZ — si generano per gli outlet reali del tenant (useOutlets) da un
// template di categorie scalato in modo deterministico per outlet (nessun
// Math.random → stabile). La pagina mostra un badge "dati simulati".
// Colori = pool di rotazione (non business data).
const COLOR_POOL = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f43f5e', '#14b8a6', '#a855f7', '#eab308']

// Template categoria: numeri base per un outlet "medio", poi scalati per outlet.
const CATEGORY_TEMPLATE: Record<string, CategoryData> = {
  'T-shirt':   { pezzi_acquistati: 400, pezzi_venduti: 320, pezzi_stock: 80, prezzo_medio_acquisto: 12.5, prezzo_medio_vendita: 19.99, giorni_medi_giacenza: 28 },
  'Felpe':     { pezzi_acquistati: 260, pezzi_venduti: 180, pezzi_stock: 80, prezzo_medio_acquisto: 22.0, prezzo_medio_vendita: 34.99, giorni_medi_giacenza: 45 },
  'Pantaloni': { pezzi_acquistati: 300, pezzi_venduti: 210, pezzi_stock: 90, prezzo_medio_acquisto: 28.0, prezzo_medio_vendita: 44.99, giorni_medi_giacenza: 52 },
  'Giacche':   { pezzi_acquistati: 140, pezzi_venduti: 72,  pezzi_stock: 68, prezzo_medio_acquisto: 45.0, prezzo_medio_vendita: 69.99, giorni_medi_giacenza: 68 },
  'Accessori': { pezzi_acquistati: 560, pezzi_venduti: 470, pezzi_stock: 90, prezzo_medio_acquisto: 6.0,  prezzo_medio_vendita: 9.99,  giorni_medi_giacenza: 22 },
  'Calzature': { pezzi_acquistati: 190, pezzi_venduti: 120, pezzi_stock: 70, prezzo_medio_acquisto: 35.0, prezzo_medio_vendita: 54.99, giorni_medi_giacenza: 58 },
}

// Fattori deterministici per differenziare gli outlet (dimensione + aging).
const SIZE_FACTORS = [1.0, 1.15, 0.85, 0.7, 0.6, 0.5, 0.4, 0.9, 0.75, 0.55]
const AGING_DELTAS = [0, 6, -4, 10, 14, -6, 2, 8, -2, 4]

function buildOutletsData(
  tenantOutlets: { id: string; name: string }[]
): Record<string, OutletData> {
  const result: Record<string, OutletData> = {}
  tenantOutlets.forEach((o, i) => {
    const size = SIZE_FACTORS[i % SIZE_FACTORS.length]
    const agingDelta = AGING_DELTAS[i % AGING_DELTAS.length]
    const categories: Record<string, CategoryData> = {}
    for (const [cat, base] of Object.entries(CATEGORY_TEMPLATE)) {
      categories[cat] = {
        pezzi_acquistati: Math.round(base.pezzi_acquistati * size),
        pezzi_venduti: Math.round(base.pezzi_venduti * size),
        pezzi_stock: Math.max(0, Math.round(base.pezzi_stock * size)),
        prezzo_medio_acquisto: base.prezzo_medio_acquisto,
        prezzo_medio_vendita: base.prezzo_medio_vendita,
        giorni_medi_giacenza: Math.max(5, base.giorni_medi_giacenza + agingDelta),
      }
    }
    result[o.name] = { color: COLOR_POOL[i % COLOR_POOL.length], categories }
  })
  return result
}

function getAgingStatus(days: number) {
  if (days > 90) return { label: 'Critico', color: 'bg-red-100 text-red-800', badge: 'bg-red-500' }
  if (days >= 60) return { label: 'Attenzione', color: 'bg-amber-100 text-amber-800', badge: 'bg-amber-500' }
  return { label: 'OK', color: 'bg-green-100 text-green-800', badge: 'bg-green-500' }
}

type AgingBucket = '0-30 gg' | '31-60 gg' | '61-90 gg' | '90+ gg'

function getAgingBucket(days: number): AgingBucket {
  if (days <= 30) return '0-30 gg'
  if (days <= 60) return '31-60 gg'
  if (days <= 90) return '61-90 gg'
  return '90+ gg'
}

interface CategoryData {
  pezzi_acquistati: number
  pezzi_venduti: number
  pezzi_stock: number
  prezzo_medio_acquisto: number
  prezzo_medio_vendita: number
  giorni_medi_giacenza: number
}

interface OutletData {
  color: string
  categories: Record<string, CategoryData>
}

interface OutletMetric {
  sellthrough: number
  stockValue: number
  avgGiacenza: number
}

interface AlertEntry {
  type: string
  outlet: string
  category: string
  value: number | string
  severity: 'red' | 'amber'
}

export default function StockSellthrough() {
  const labels = useCompanyLabels()
  const { outlets: tenantOutlets, loading: outletsLoading } = useOutlets()
  const [selectedOutlet, setSelectedOutlet] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [expandedOutlet, setExpandedOutlet] = useState<string | null>(null)

  // Dati simulati per-tenant: generati dagli outlet reali del tenant.
  // NB: tutti gli hook (useMemo) stanno PRIMA degli early-return più in basso,
  // per non violare le regole degli hook (React #310).
  const outletsData = useMemo(() => buildOutletsData(tenantOutlets), [tenantOutlets])
  const hasOutlets = tenantOutlets.length > 0

  // Calculate metrics
  const metrics = useMemo(() => {
    let totalStockValue = 0
    let totalPezziVenduti = 0
    let totalPezziAcquistati = 0
    let alertCount = 0
    let totalGiacenzaDays = 0
    let itemCount = 0
    const outletMetrics: Record<string, OutletMetric> = {}
    const agingBuckets: Record<AgingBucket, number> = { '0-30 gg': 0, '31-60 gg': 0, '61-90 gg': 0, '90+ gg': 0 }

    Object.entries(outletsData).forEach(([outletName, outletData]) => {
      let outletStockValue = 0
      let outletVenduti = 0
      let outletAcquistati = 0
      let outletGiacenzaDays = 0
      let outletCount = 0

      Object.entries(outletData.categories).forEach(([catName, catData]) => {
        const stockValue = catData.pezzi_stock * catData.prezzo_medio_acquisto
        outletStockValue += stockValue
        totalStockValue += stockValue
        outletVenduti += catData.pezzi_venduti
        outletAcquistati += catData.pezzi_acquistati
        totalPezziVenduti += catData.pezzi_venduti
        totalPezziAcquistati += catData.pezzi_acquistati
        outletGiacenzaDays += catData.giorni_medi_giacenza
        totalGiacenzaDays += catData.giorni_medi_giacenza
        outletCount += 1
        itemCount += 1

        const sellthrough = (catData.pezzi_venduti / catData.pezzi_acquistati) * 100
        if (sellthrough < 40 || catData.giorni_medi_giacenza > 90) {
          alertCount++
        }

        const bucket = getAgingBucket(catData.giorni_medi_giacenza)
        agingBuckets[bucket] += catData.pezzi_stock
      })

      const sellthrough = (outletVenduti / outletAcquistati) * 100
      outletMetrics[outletName] = {
        sellthrough,
        stockValue: outletStockValue,
        avgGiacenza: outletGiacenzaDays / outletCount,
      }
    })

    const overallSellthrough = (totalPezziVenduti / totalPezziAcquistati) * 100
    const avgGiacenza = totalGiacenzaDays / itemCount

    return {
      totalStockValue,
      overallSellthrough,
      alertCount,
      avgGiacenza,
      outletMetrics,
      agingBuckets,
    }
  }, [outletsData])

  // Filter alerts
  const alerts = useMemo<AlertEntry[]>(() => {
    const alertList: AlertEntry[] = []
    Object.entries(outletsData).forEach(([outletName, outletData]) => {
      Object.entries(outletData.categories).forEach(([catName, catData]) => {
        const sellthrough = (catData.pezzi_venduti / catData.pezzi_acquistati) * 100
        if (sellthrough < 40) {
          alertList.push({
            type: 'Basso sell-through',
            outlet: outletName,
            category: catName,
            value: sellthrough.toFixed(1),
            severity: 'red',
          })
        }
        if (catData.giorni_medi_giacenza > 90) {
          alertList.push({
            type: 'Stock aged',
            outlet: outletName,
            category: catName,
            value: catData.giorni_medi_giacenza,
            severity: 'red',
          })
        } else if (catData.giorni_medi_giacenza >= 60) {
          alertList.push({
            type: 'Stock aging',
            outlet: outletName,
            category: catName,
            value: catData.giorni_medi_giacenza,
            severity: 'amber',
          })
        }
      })
    })
    return alertList
  }, [outletsData])

  // Chart data
  const sellthroughChartData = useMemo(() => {
    return Object.entries(metrics.outletMetrics).map(([outlet, data]) => ({
      name: outlet.split(' ')[0],
      'Sell-through %': parseFloat(data.sellthrough.toFixed(1)),
      fullName: outlet,
    }))
  }, [metrics])

  const stockValueChartData = useMemo(() => {
    return Object.entries(metrics.outletMetrics).map(([outlet, data]) => ({
      name: outlet.split(' ')[0],
      'Valore Stock': parseFloat(data.stockValue.toFixed(0)),
      fullName: outlet,
    }))
  }, [metrics])

  const agingChartData = useMemo(() => {
    return [
      { name: '0-30 gg', pezzi: metrics.agingBuckets['0-30 gg'] },
      { name: '31-60 gg', pezzi: metrics.agingBuckets['31-60 gg'] },
      { name: '61-90 gg', pezzi: metrics.agingBuckets['61-90 gg'] },
      { name: '90+ gg', pezzi: metrics.agingBuckets['90+ gg'] },
    ]
  }, [metrics])

  if (outletsLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto text-sm text-slate-400">Caricamento…</div>
      </div>
    )
  }
  if (!hasOutlets) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Analisi Sell-Through Magazzino</h1>
          <p className="text-slate-600 mb-8">Monitoraggio giacenze e rotazione stock per i punti vendita</p>
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
            <Store className="w-14 h-14 mx-auto mb-4 text-slate-300" />
            <h2 className="text-lg font-semibold text-slate-700 mb-2">Nessun dato di stock disponibile</h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              I dati di sell-through verranno popolati automaticamente quando saranno disponibili.
              Per gestire l'elenco dei {labels.pointOfSalePluralLower} vai su Impostazioni.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
        <PageHeader
          title="Analisi Sell-Through Magazzino"
          subtitle="Monitoraggio giacenze e rotazione stock per i punti vendita"
        />

        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="mt-0.5 font-semibold whitespace-nowrap">Dati simulati (demo)</span>
          <span className="text-amber-700">
            Le giacenze e i sell-through mostrati sono generati come demo sugli {labels.pointOfSalePluralLower}
            del tenant: la pagina non è ancora collegata al magazzino reale.
          </span>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">Valore Stock Totale</p>
                <p className="text-2xl font-bold text-slate-900 mt-2">€ {fmt(metrics.totalStockValue, 2)}</p>
              </div>
              <Package className="w-10 h-10 text-blue-500" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">Sell-Through Rate</p>
                <p className="text-2xl font-bold text-slate-900 mt-2">{metrics.overallSellthrough.toFixed(1)}%</p>
              </div>
              <TrendingUp className="w-10 h-10 text-green-500" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">Giorni Medi Giacenza</p>
                <p className="text-2xl font-bold text-slate-900 mt-2">{metrics.avgGiacenza.toFixed(0)}</p>
              </div>
              <Calendar className="w-10 h-10 text-amber-500" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">Alert Critici</p>
                <p className="text-2xl font-bold text-slate-900 mt-2">{metrics.alertCount}</p>
              </div>
              <AlertTriangle className="w-10 h-10 text-red-500" />
            </div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Sell-Through % per {labels.pointOfSale}</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sellthroughChartData}>
                <defs>
                  <linearGradient id="grad-sellthrough" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="name" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="Sell-through %" fill="url(#grad-sellthrough)" radius={[8, 8, 0, 0]} animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Valore Stock per {labels.pointOfSalePlural} (€)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stockValueChartData}>
                <defs>
                  <linearGradient id="grad-stockvalue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="name" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => `€ ${fmt(value, 0)}`} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="Valore Stock" fill="url(#grad-stockvalue)" radius={[8, 8, 0, 0]} animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Aging Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Distribuzione Giacenza Pezzi</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={agingChartData}>
                <defs>
                  <linearGradient id="grad-aging" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="name" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="pezzi" fill="url(#grad-aging)" radius={[8, 8, 0, 0]} animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Summary Giacenza</h3>
            <div className="space-y-3">
              {Object.entries(metrics.agingBuckets).map(([bucket, count]) => {
                let color = 'bg-green-100 text-green-800'
                if (bucket === '61-90 gg') color = 'bg-amber-100 text-amber-800'
                if (bucket === '90+ gg') color = 'bg-red-100 text-red-800'
                return (
                  <div key={bucket} className="flex justify-between items-center">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${color}`}>{bucket}</span>
                    <span className="font-semibold text-slate-900">{fmt(count)} pezzi</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Alerts Section */}
        {alerts.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8">
            <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Avvisi ({alerts.length})
            </h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {alerts.slice(0, 20).map((alert, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border-l-4 ${
                    alert.severity === 'red'
                      ? 'bg-red-50 border-red-500 text-red-800'
                      : 'bg-amber-50 border-amber-500 text-amber-800'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-sm">{alert.type}</p>
                      <p className="text-xs mt-1">
                        {alert.outlet} - {alert.category}
                      </p>
                    </div>
                    <span className="font-bold text-sm">
                      {alert.type.includes('sell') ? `${alert.value}%` : `${alert.value}gg`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outlets Accordion */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Dettaglio per {labels.pointOfSale}</h3>
          {Object.entries(outletsData).map(([outletName, outletData]) => {
            const outletMetric = metrics.outletMetrics[outletName]
            const isExpanded = expandedOutlet === outletName

            return (
              <div key={outletName} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Header */}
                <button
                  onClick={() => setExpandedOutlet(isExpanded ? null : outletName)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition"
                >
                  <div className="flex items-center gap-4 flex-1 text-left">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: outletData.color }}
                    />
                    <div>
                      <p className="font-semibold text-slate-900">{outletName}</p>
                      <p className="text-sm text-slate-600">
                        Sell-through: {outletMetric.sellthrough.toFixed(1)}% | Valore: €{fmt(outletMetric.stockValue, 2)} | Giacenza: {outletMetric.avgGiacenza.toFixed(0)}gg
                      </p>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {/* Content */}
                {isExpanded && (
                  <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200">
                            <th className="text-left py-2 px-2 font-semibold text-slate-900">Categoria</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-900">Acquistati</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-900">Venduti</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-900">Stock</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-900">Sell-th. %</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-900">Giacenza gg</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-900">Valore Stock</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-900">Potenziale €</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(outletData.categories).map(([catName, catData]) => {
                            const sellthrough = (catData.pezzi_venduti / catData.pezzi_acquistati) * 100
                            const stockValue = catData.pezzi_stock * catData.prezzo_medio_acquisto
                            const revenuePotential = catData.pezzi_stock * catData.prezzo_medio_vendita
                            const agingStatus = getAgingStatus(catData.giorni_medi_giacenza)

                            return (
                              <tr key={catName} className="border-b border-slate-100 hover:bg-white transition">
                                <td className="py-2 px-2 text-slate-900 font-medium">{catName}</td>
                                <td className="text-right py-2 px-2 text-slate-700">{fmt(catData.pezzi_acquistati)}</td>
                                <td className="text-right py-2 px-2 text-slate-700">{fmt(catData.pezzi_venduti)}</td>
                                <td className="text-right py-2 px-2 text-slate-700">{fmt(catData.pezzi_stock)}</td>
                                <td className="text-right py-2 px-2">
                                  <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${sellthrough < 50 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                    {sellthrough.toFixed(1)}%
                                  </span>
                                </td>
                                <td className="text-right py-2 px-2">
                                  <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${agingStatus.color}`}>
                                    {catData.giorni_medi_giacenza}gg
                                  </span>
                                </td>
                                <td className="text-right py-2 px-2 text-slate-700">€ {fmt(stockValue, 2)}</td>
                                <td className="text-right py-2 px-2 font-semibold text-slate-900">€ {fmt(revenuePotential, 2)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
