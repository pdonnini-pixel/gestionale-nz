import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts'
import { TrendingUp, AlertTriangle, Package, Calendar, DollarSign, ChevronDown, ChevronUp } from 'lucide-react'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'

function fmt(n: number, dec = 0): string {
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}

// Hardcoded data for all outlets
const outletsData: Record<string, OutletData> = {
  'Valdichiana Village': {
    color: '#3b82f6',
    categories: {
      'T-shirt': {
        pezzi_acquistati: 450,
        pezzi_venduti: 382,
        pezzi_stock: 68,
        prezzo_medio_acquisto: 12.50,
        prezzo_medio_vendita: 19.99,
        giorni_medi_giacenza: 28,
      },
      'Felpe': {
        pezzi_acquistati: 280,
        pezzi_venduti: 198,
        pezzi_stock: 82,
        prezzo_medio_acquisto: 22.00,
        prezzo_medio_vendita: 34.99,
        giorni_medi_giacenza: 45,
      },
      'Pantaloni': {
        pezzi_acquistati: 320,
        pezzi_venduti: 224,
        pezzi_stock: 96,
        prezzo_medio_acquisto: 28.00,
        prezzo_medio_vendita: 44.99,
        giorni_medi_giacenza: 52,
      },
      'Giacche': {
        pezzi_acquistati: 150,
        pezzi_venduti: 78,
        pezzi_stock: 72,
        prezzo_medio_acquisto: 45.00,
        prezzo_medio_vendita: 69.99,
        giorni_medi_giacenza: 68,
      },
      'Accessori': {
        pezzi_acquistati: 600,
        pezzi_venduti: 510,
        pezzi_stock: 90,
        prezzo_medio_acquisto: 6.00,
        prezzo_medio_vendita: 9.99,
        giorni_medi_giacenza: 22,
      },
      'Calzature': {
        pezzi_acquistati: 200,
        pezzi_venduti: 130,
        pezzi_stock: 70,
        prezzo_medio_acquisto: 35.00,
        prezzo_medio_vendita: 54.99,
        giorni_medi_giacenza: 58,
      },
    },
  },
  'Barberino Outlet': {
    color: '#10b981',
    categories: {
      'T-shirt': {
        pezzi_acquistati: 520,
        pezzi_venduti: 468,
        pezzi_stock: 52,
        prezzo_medio_acquisto: 12.50,
        prezzo_medio_vendita: 19.99,
        giorni_medi_giacenza: 18,
      },
      'Felpe': {
        pezzi_acquistati: 320,
        pezzi_venduti: 256,
        pezzi_stock: 64,
        prezzo_medio_acquisto: 22.00,
        prezzo_medio_vendita: 34.99,
        giorni_medi_giacenza: 32,
      },
      'Pantaloni': {
        pezzi_acquistati: 380,
        pezzi_venduti: 304,
        pezzi_stock: 76,
        prezzo_medio_acquisto: 28.00,
        prezzo_medio_vendita: 44.99,
        giorni_medi_giacenza: 38,
      },
      'Giacche': {
        pezzi_acquistati: 180,
        pezzi_venduti: 126,
        pezzi_stock: 54,
        prezzo_medio_acquisto: 45.00,
        prezzo_medio_vendita: 69.99,
        giorni_medi_giacenza: 72,
      },
      'Accessori': {
        pezzi_acquistati: 700,
        pezzi_venduti: 658,
        pezzi_stock: 42,
        prezzo_medio_acquisto: 6.00,
        prezzo_medio_vendita: 9.99,
        giorni_medi_giacenza: 12,
      },
      'Calzature': {
        pezzi_acquistati: 240,
        pezzi_venduti: 192,
        pezzi_stock: 48,
        prezzo_medio_acquisto: 35.00,
        prezzo_medio_vendita: 54.99,
        giorni_medi_giacenza: 42,
      },
    },
  },
  'Franciacorta Village': {
    color: '#f59e0b',
    categories: {
      'T-shirt': {
        pezzi_acquistati: 480,
        pezzi_venduti: 336,
        pezzi_stock: 144,
        prezzo_medio_acquisto: 12.50,
        prezzo_medio_vendita: 19.99,
        giorni_medi_giacenza: 62,
      },
      'Felpe': {
        pezzi_acquistati: 300,
        pezzi_venduti: 180,
        pezzi_stock: 120,
        prezzo_medio_acquisto: 22.00,
        prezzo_medio_vendita: 34.99,
        giorni_medi_giacenza: 75,
      },
      'Pantaloni': {
        pezzi_acquistati: 350,
        pezzi_venduti: 210,
        pezzi_stock: 140,
        prezzo_medio_acquisto: 28.00,
        prezzo_medio_vendita: 44.99,
        giorni_medi_giacenza: 85,
      },
      'Giacche': {
        pezzi_acquistati: 160,
        pezzi_venduti: 64,
        pezzi_stock: 96,
        prezzo_medio_acquisto: 45.00,
        prezzo_medio_vendita: 69.99,
        giorni_medi_giacenza: 105,
      },
      'Accessori': {
        pezzi_acquistati: 650,
        pezzi_venduti: 455,
        pezzi_stock: 195,
        prezzo_medio_acquisto: 6.00,
        prezzo_medio_vendita: 9.99,
        giorni_medi_giacenza: 48,
      },
      'Calzature': {
        pezzi_acquistati: 220,
        pezzi_venduti: 99,
        pezzi_stock: 121,
        prezzo_medio_acquisto: 35.00,
        prezzo_medio_vendita: 54.99,
        giorni_medi_giacenza: 98,
      },
    },
  },
  'Palmanova Outlet': {
    color: '#8b5cf6',
    categories: {
      'T-shirt': {
        pezzi_acquistati: 500,
        pezzi_venduti: 425,
        pezzi_stock: 75,
        prezzo_medio_acquisto: 12.50,
        prezzo_medio_vendita: 19.99,
        giorni_medi_giacenza: 35,
      },
      'Felpe': {
        pezzi_acquistati: 310,
        pezzi_venduti: 217,
        pezzi_stock: 93,
        prezzo_medio_acquisto: 22.00,
        prezzo_medio_vendita: 34.99,
        giorni_medi_giacenza: 54,
      },
      'Pantaloni': {
        pezzi_acquistati: 360,
        pezzi_venduti: 252,
        pezzi_stock: 108,
        prezzo_medio_acquisto: 28.00,
        prezzo_medio_vendita: 44.99,
        giorni_medi_giacenza: 61,
      },
      'Giacche': {
        pezzi_acquistati: 170,
        pezzi_venduti: 102,
        pezzi_stock: 68,
        prezzo_medio_acquisto: 45.00,
        prezzo_medio_vendita: 69.99,
        giorni_medi_giacenza: 88,
      },
      'Accessori': {
        pezzi_acquistati: 680,
        pezzi_venduti: 544,
        pezzi_stock: 136,
        prezzo_medio_acquisto: 6.00,
        prezzo_medio_vendita: 9.99,
        giorni_medi_giacenza: 36,
      },
      'Calzature': {
        pezzi_acquistati: 230,
        pezzi_venduti: 138,
        pezzi_stock: 92,
        prezzo_medio_acquisto: 35.00,
        prezzo_medio_vendita: 54.99,
        giorni_medi_giacenza: 72,
      },
    },
  },
  'Brugnato 5Terre': {
    color: '#ec4899',
    categories: {
      'T-shirt': {
        pezzi_acquistati: 420,
        pezzi_venduti: 252,
        pezzi_stock: 168,
        prezzo_medio_acquisto: 12.50,
        prezzo_medio_vendita: 19.99,
        giorni_medi_giacenza: 78,
      },
      'Felpe': {
        pezzi_acquistati: 280,
        pezzi_venduti: 140,
        pezzi_stock: 140,
        prezzo_medio_acquisto: 22.00,
        prezzo_medio_vendita: 34.99,
        giorni_medi_giacenza: 95,
      },
      'Pantaloni': {
        pezzi_acquistati: 330,
        pezzi_venduti: 165,
        pezzi_stock: 165,
        prezzo_medio_acquisto: 28.00,
        prezzo_medio_vendita: 44.99,
        giorni_medi_giacenza: 112,
      },
      'Giacche': {
        pezzi_acquistati: 140,
        pezzi_venduti: 42,
        pezzi_stock: 98,
        prezzo_medio_acquisto: 45.00,
        prezzo_medio_vendita: 69.99,
        giorni_medi_giacenza: 118,
      },
      'Accessori': {
        pezzi_acquistati: 600,
        pezzi_venduti: 360,
        pezzi_stock: 240,
        prezzo_medio_acquisto: 6.00,
        prezzo_medio_vendita: 9.99,
        giorni_medi_giacenza: 72,
      },
      'Calzature': {
        pezzi_acquistati: 200,
        pezzi_venduti: 80,
        pezzi_stock: 120,
        prezzo_medio_acquisto: 35.00,
        prezzo_medio_vendita: 54.99,
        giorni_medi_giacenza: 105,
      },
    },
  },
  'Valmontone Outlet': {
    color: '#06b6d4',
    categories: {
      'T-shirt': {
        pezzi_acquistati: 510,
        pezzi_venduti: 433,
        pezzi_stock: 77,
        prezzo_medio_acquisto: 12.50,
        prezzo_medio_vendita: 19.99,
        giorni_medi_giacenza: 32,
      },
      'Felpe': {
        pezzi_acquistati: 330,
        pezzi_venduti: 264,
        pezzi_stock: 66,
        prezzo_medio_acquisto: 22.00,
        prezzo_medio_vendita: 34.99,
        giorni_medi_giacenza: 42,
      },
      'Pantaloni': {
        pezzi_acquistati: 370,
        pezzi_venduti: 296,
        pezzi_stock: 74,
        prezzo_medio_acquisto: 28.00,
        prezzo_medio_vendita: 44.99,
        giorni_medi_giacenza: 40,
      },
      'Giacche': {
        pezzi_acquistati: 175,
        pezzi_venduti: 105,
        pezzi_stock: 70,
        prezzo_medio_acquisto: 45.00,
        prezzo_medio_vendita: 69.99,
        giorni_medi_giacenza: 78,
      },
      'Accessori': {
        pezzi_acquistati: 720,
        pezzi_venduti: 648,
        pezzi_stock: 72,
        prezzo_medio_acquisto: 6.00,
        prezzo_medio_vendita: 9.99,
        giorni_medi_giacenza: 18,
      },
      'Calzature': {
        pezzi_acquistati: 250,
        pezzi_venduti: 175,
        pezzi_stock: 75,
        prezzo_medio_acquisto: 35.00,
        prezzo_medio_vendita: 54.99,
        giorni_medi_giacenza: 52,
      },
    },
  },
  'Torino': {
    color: '#94a3b8',
    categories: {
      'T-shirt': {
        pezzi_acquistati: 150,
        pezzi_venduti: 75,
        pezzi_stock: 75,
        prezzo_medio_acquisto: 12.50,
        prezzo_medio_vendita: 19.99,
        giorni_medi_giacenza: 20,
      },
      'Felpe': {
        pezzi_acquistati: 100,
        pezzi_venduti: 60,
        pezzi_stock: 40,
        prezzo_medio_acquisto: 22.00,
        prezzo_medio_vendita: 34.99,
        giorni_medi_giacenza: 25,
      },
      'Pantaloni': {
        pezzi_acquistati: 120,
        pezzi_venduti: 72,
        pezzi_stock: 48,
        prezzo_medio_acquisto: 28.00,
        prezzo_medio_vendita: 44.99,
        giorni_medi_giacenza: 28,
      },
      'Giacche': {
        pezzi_acquistati: 60,
        pezzi_venduti: 30,
        pezzi_stock: 30,
        prezzo_medio_acquisto: 45.00,
        prezzo_medio_vendita: 69.99,
        giorni_medi_giacenza: 32,
      },
      'Accessori': {
        pezzi_acquistati: 250,
        pezzi_venduti: 175,
        pezzi_stock: 75,
        prezzo_medio_acquisto: 6.00,
        prezzo_medio_vendita: 9.99,
        giorni_medi_giacenza: 18,
      },
      'Calzature': {
        pezzi_acquistati: 80,
        pezzi_venduti: 48,
        pezzi_stock: 32,
        prezzo_medio_acquisto: 35.00,
        prezzo_medio_vendita: 54.99,
        giorni_medi_giacenza: 30,
      },
    },
  },
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
  const [selectedOutlet, setSelectedOutlet] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [expandedOutlet, setExpandedOutlet] = useState<string | null>(null)

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
  }, [])

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
  }, [])

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

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Analisi Sell-Through Magazzino</h1>
          <p className="text-slate-600">Monitoraggio giacenze e rotazione stock per i punti vendita</p>
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
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Sell-Through % per Outlet</h3>
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
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Valore Stock per Outlet (€)</h3>
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
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Dettaglio per Outlet</h3>
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
