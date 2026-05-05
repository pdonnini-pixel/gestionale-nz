import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// Vista AnalyticsPOS — persistita in URL come ?view=
type AnalyticsView = 'annual' | 'month';
const VALID_ANALYTICS_VIEWS: AnalyticsView[] = ['annual', 'month'];
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { TrendingUp, TrendingDown, ShoppingCart, DollarSign, Package, Eye } from 'lucide-react';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';

// Formato numero italiano
function fmt(n: number, dec = 0): string {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  }).format(n);
}

interface OutletConfig { id: string; label: string; annual_revenue: number; color: string }

// Outlet configuration
const OUTLETS: OutletConfig[] = [
  { id: 'valdichiana', label: 'Valdichiana Village', annual_revenue: 815000, color: '#3b82f6' },
  { id: 'barberino', label: 'Barberino Outlet', annual_revenue: 355000, color: '#10b981' },
  { id: 'franciacorta', label: 'Franciacorta Village', annual_revenue: 411000, color: '#f59e0b' },
  { id: 'palmanova', label: 'Palmanova Outlet', annual_revenue: 281000, color: '#8b5cf6' },
  { id: 'brugnato', label: 'Brugnato 5Terre', annual_revenue: 195000, color: '#ec4899' },
  { id: 'valmontone', label: 'Valmontone Outlet', annual_revenue: 219000, color: '#06b6d4' }
];

interface POSMonthEntry {
  month: number
  month_label: string
  n_scontrini: number
  importo_totale: number
  scontrino_medio: number
  n_pezzi_venduti: number
  outlet_id: string
  outlet_label: string
}

type POSData = Record<string, Record<number, POSMonthEntry>>

// Seasonal multiplier (higher in summer and Dec, lower in Jan-Feb)
const SEASONAL_MULTIPLIER: Record<number, number> = {
  1: 0.75,  // January
  2: 0.80,  // February
  3: 0.90,  // March
  4: 0.95,  // April
  5: 1.05,  // May
  6: 1.25,  // June
  7: 1.30,  // July
  8: 1.25,  // August
  9: 1.00,  // September
  10: 1.10, // October
  11: 1.20, // November
  12: 1.35  // December
};

// Generate 12 months of POS data per outlet
function generatePOSData(): POSData {
  const data: POSData = {};
  const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

  OUTLETS.forEach(outlet => {
    data[outlet.id] = {};

    for (let month = 1; month <= 12; month++) {
      const baseScontrini = Math.round((outlet.annual_revenue / 12) / 42); // avg scontrino ~42€
      const seasonalFactor = SEASONAL_MULTIPLIER[month];
      const variance = 0.92 + Math.random() * 0.16; // ±8% variance

      const n_scontrini = Math.round(baseScontrini * seasonalFactor * variance);
      const scontrino_medio = 38 + Math.random() * 8; // 38-46€ average
      const importo_totale = Math.round(n_scontrini * scontrino_medio);
      const n_pezzi_venduti = Math.round(n_scontrini * (2.1 + Math.random() * 0.4)); // 2.1-2.5 pezzi/scontrino

      data[outlet.id][month] = {
        month,
        month_label: months[month - 1],
        n_scontrini,
        importo_totale,
        scontrino_medio,
        n_pezzi_venduti,
        outlet_id: outlet.id,
        outlet_label: outlet.label
      };
    }
  });

  return data;
}

// Build chart data structure
type ChartRow = { month: number; month_label: string } & Record<string, number | string>

function buildChartData(posData: POSData): ChartRow[] {
  const monthlyData: Record<number, ChartRow> = {};

  Object.keys(posData).forEach(outletId => {
    for (let month = 1; month <= 12; month++) {
      if (!monthlyData[month]) {
        monthlyData[month] = { month, month_label: posData[outletId][month].month_label };
      }
      monthlyData[month][`scontrini_${outletId}`] = posData[outletId][month].n_scontrini;
      monthlyData[month][`medio_${outletId}`] = parseFloat(posData[outletId][month].scontrino_medio.toFixed(2));
      monthlyData[month][`importo_${outletId}`] = posData[outletId][month].importo_totale;
    }
  });

  return Object.values(monthlyData).sort((a, b) => a.month - b.month);
}

// Calculate KPIs
function calculateKPIs(posData: POSData, selectedOutlet: string | null) {
  let totalScontrini = 0;
  let totalImporto = 0;
  let totalPezzi = 0;

  const outlets = selectedOutlet ? [selectedOutlet] : Object.keys(posData);

  outlets.forEach(outletId => {
    for (let month = 1; month <= 12; month++) {
      const data = posData[outletId][month];
      totalScontrini += data.n_scontrini;
      totalImporto += data.importo_totale;
      totalPezzi += data.n_pezzi_venduti;
    }
  });

  const scontrino_medio = totalScontrini > 0 ? totalImporto / totalScontrini : 0;
  const pezzi_per_scontrino = totalScontrini > 0 ? totalPezzi / totalScontrini : 0;
  const ricavo_per_pezzo = totalPezzi > 0 ? totalImporto / totalPezzi : 0;

  return {
    totalScontrini,
    scontrino_medio,
    pezzi_per_scontrino,
    ricavo_per_pezzo,
    totalImporto,
    totalPezzi
  };
}

// Distribution by amount ranges
function calculateDistribution(posData: POSData, selectedOutlet: string | null) {
  const ranges: Record<string, number> = {
    '0-20€': 0,
    '20-50€': 0,
    '50-100€': 0,
    '100-200€': 0,
    '200+€': 0
  };

  const outlets = selectedOutlet ? [selectedOutlet] : Object.keys(posData);

  outlets.forEach(outletId => {
    for (let month = 1; month <= 12; month++) {
      const data = posData[outletId][month];

      // Simulate distribution: most transactions around average ±40%
      const low = Math.round(data.n_scontrini * 0.15);
      const midLow = Math.round(data.n_scontrini * 0.25);
      const mid = Math.round(data.n_scontrini * 0.35);
      const high = Math.round(data.n_scontrini * 0.20);
      const veryHigh = Math.round(data.n_scontrini * 0.05);

      ranges['0-20€'] += low;
      ranges['20-50€'] += midLow;
      ranges['50-100€'] += mid;
      ranges['100-200€'] += high;
      ranges['200+€'] += veryHigh;
    }
  });

  return Object.entries(ranges).map(([label, value]) => ({ name: label, value }));
}

// Best/worst performers
function getPerformers(posData: POSData) {
  const outletMetrics = OUTLETS.map(outlet => {
    let totalImporto = 0;
    let totalScontrini = 0;
    for (let month = 1; month <= 12; month++) {
      totalImporto += posData[outlet.id][month].importo_totale;
      totalScontrini += posData[outlet.id][month].n_scontrini;
    }
    return {
      id: outlet.id,
      label: outlet.label,
      annual_revenue: totalImporto,
      scontrini: totalScontrini,
      medio: totalImporto / totalScontrini,
      color: outlet.color
    };
  });

  outletMetrics.sort((a, b) => b.annual_revenue - a.annual_revenue);
  return {
    best: outletMetrics[0],
    worst: outletMetrics[outletMetrics.length - 1]
  };
}

export default function AnalyticsPOS() {
  const [selectedOutlet, setSelectedOutlet] = useState<string | null>(null);
  // viewMode persistito in URL come ?view=… (default 'annual')
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const viewMode: AnalyticsView = VALID_ANALYTICS_VIEWS.includes(viewParam as AnalyticsView)
    ? (viewParam as AnalyticsView)
    : 'annual';
  const setViewMode = (next: AnalyticsView) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', next);
    setSearchParams(params);
  };

  const posData = useMemo(() => generatePOSData(), []);
  const chartData = useMemo(() => buildChartData(posData), [posData]);
  const kpis = useMemo(() => calculateKPIs(posData, selectedOutlet), [posData, selectedOutlet]);
  const distribution = useMemo(() => calculateDistribution(posData, selectedOutlet), [posData, selectedOutlet]);
  const performers = useMemo(() => getPerformers(posData), [posData]);

  const outletData = selectedOutlet
    ? OUTLETS.filter(o => o.id === selectedOutlet)
    : OUTLETS;

  // Table: outlet comparison
  const tableData = OUTLETS.map(outlet => {
    let totalScontrini = 0;
    let totalImporto = 0;
    let totalPezzi = 0;

    for (let month = 1; month <= 12; month++) {
      totalScontrini += posData[outlet.id][month].n_scontrini;
      totalImporto += posData[outlet.id][month].importo_totale;
      totalPezzi += posData[outlet.id][month].n_pezzi_venduti;
    }

    const scontrino_medio = totalImporto / totalScontrini;
    const pezzi_per_scontrino = totalPezzi / totalScontrini;
    const ricavo_per_pezzo = totalImporto / totalPezzi;

    return {
      outlet: outlet.label,
      color: outlet.color,
      scontrini: totalScontrini,
      scontrino_medio,
      pezzi_per_scontrino,
      ricavo_per_pezzo,
      upt: pezzi_per_scontrino // Units per transaction
    };
  }).sort((a, b) => b.scontrini - a.scontrini);

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Analytics POS</h1>
          <p className="text-slate-600">Analisi dati transazioni - Anno 2026</p>
        </div>

        {/* Controls */}
        <div className="mb-8 flex flex-wrap gap-4 items-center">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Outlet</label>
            <select
              value={selectedOutlet || ''}
              onChange={(e) => setSelectedOutlet(e.target.value || null)}
              className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Tutti gli outlet</option>
              {OUTLETS.map(outlet => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Visualizzazione</label>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('annual')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  viewMode === 'annual'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Annuale
              </button>
              <button
                onClick={() => setViewMode('month')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  viewMode === 'month'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Mensile
              </button>
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-600 font-medium">Scontrini Totali</span>
              <ShoppingCart className="w-5 h-5 text-blue-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{fmt(kpis.totalScontrini)}</p>
            <p className="text-sm text-slate-500 mt-2">Anno 2026</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-600 font-medium">Scontrino Medio</span>
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900">€ {fmt(kpis.scontrino_medio, 2)}</p>
            <p className="text-sm text-slate-500 mt-2">Valore medio</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-600 font-medium">Pezzi/Scontrino</span>
              <Package className="w-5 h-5 text-amber-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{fmt(kpis.pezzi_per_scontrino, 2)}</p>
            <p className="text-sm text-slate-500 mt-2">UPT medio</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-600 font-medium">Ricavo/Pezzo</span>
              <Eye className="w-5 h-5 text-purple-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900">€ {fmt(kpis.ricavo_per_pezzo, 2)}</p>
            <p className="text-sm text-slate-500 mt-2">Prezzo medio</p>
          </div>
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Line Chart - Scontrino medio trend */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-bold text-slate-900 mb-6">Trend Scontrino Medio Mensile</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="month_label" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => `€ ${fmt(value, 2)}`} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Legend />
                {outletData.map(outlet => (
                  <Line
                    key={outlet.id}
                    type="monotone"
                    dataKey={`medio_${outlet.id}`}
                    stroke={outlet.color}
                    name={outlet.label}
                    strokeWidth={2.5}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Pie Chart - Distribution */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-bold text-slate-900 mb-6">Distribuzione per Fascia Importo</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <defs>
                  <linearGradient id="pie-grad-1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-grad-2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-grad-3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-grad-4" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-grad-5" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ec4899" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ec4899" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <Pie
                  data={distribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${fmt(value)}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {[
                    'url(#pie-grad-1)',
                    'url(#pie-grad-2)',
                    'url(#pie-grad-3)',
                    'url(#pie-grad-4)',
                    'url(#pie-grad-5)'
                  ].map((color, index) => (
                    <Cell key={`cell-${index}`} fill={color} stroke="white" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip content={<GlassTooltip formatter={(value) => fmt(value)} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bar Chart - Scontrini per outlet */}
        <div className="rounded-2xl p-6 shadow-lg mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h3 className="text-lg font-bold text-slate-900 mb-6">Numero Scontrini per Outlet - Trend Mensile</h3>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-scontrini-1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                </linearGradient>
                <linearGradient id="grad-scontrini-2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                </linearGradient>
                <linearGradient id="grad-scontrini-3" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.5} />
                </linearGradient>
                <linearGradient id="grad-scontrini-4" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={1} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.5} />
                </linearGradient>
                <linearGradient id="grad-scontrini-5" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ec4899" stopOpacity={1} />
                  <stop offset="100%" stopColor="#ec4899" stopOpacity={0.5} />
                </linearGradient>
                <linearGradient id="grad-scontrini-6" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={1} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.5} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="month_label" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} />
              <Tooltip content={<GlassTooltip formatter={(value) => fmt(value)} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
              <Legend />
              {outletData.map((outlet, idx) => {
                const gradientId = `grad-scontrini-${idx + 1}`;
                return (
                  <Bar
                    key={outlet.id}
                    dataKey={`scontrini_${outlet.id}`}
                    fill={`url(#${gradientId})`}
                    name={outlet.label}
                    radius={[8, 8, 0, 0]}
                    animationDuration={800}
                  />
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Table - Outlet Comparison */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-8">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Confronto Outlet - Metriche Annuali</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-semibold text-slate-900">Outlet</th>
                  <th className="text-right py-3 px-4 font-semibold text-slate-900">Scontrini</th>
                  <th className="text-right py-3 px-4 font-semibold text-slate-900">Scontrino Medio</th>
                  <th className="text-right py-3 px-4 font-semibold text-slate-900">Pezzi/Scontrino</th>
                  <th className="text-right py-3 px-4 font-semibold text-slate-900">Ricavo/Pezzo</th>
                  <th className="text-right py-3 px-4 font-semibold text-slate-900">UPT</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: row.color }}></div>
                        <span className="font-medium text-slate-900">{row.outlet}</span>
                      </div>
                    </td>
                    <td className="text-right py-3 px-4 text-slate-700">{fmt(row.scontrini)}</td>
                    <td className="text-right py-3 px-4 text-slate-700">€ {fmt(row.scontrino_medio, 2)}</td>
                    <td className="text-right py-3 px-4 text-slate-700">{fmt(row.pezzi_per_scontrino, 2)}</td>
                    <td className="text-right py-3 px-4 text-slate-700">€ {fmt(row.ricavo_per_pezzo, 2)}</td>
                    <td className="text-right py-3 px-4 text-slate-700">{fmt(row.upt, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Best/Worst Performers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Best Performer */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-6 h-6 text-green-500" />
              <h3 className="text-lg font-bold text-slate-900">Miglior Performer</h3>
            </div>
            <div
              className="flex items-center gap-3 mb-4"
              style={{ borderLeft: `4px solid ${performers.best.color}` }}
            >
              <div className="pl-2">
                <p className="text-2xl font-bold text-slate-900">{performers.best.label}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Scontrini Annuali:</span>
                <span className="font-semibold text-slate-900">{fmt(performers.best.scontrini)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Ricavo Totale:</span>
                <span className="font-semibold text-slate-900">€ {fmt(performers.best.annual_revenue, 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Scontrino Medio:</span>
                <span className="font-semibold text-slate-900">€ {fmt(performers.best.medio, 2)}</span>
              </div>
            </div>
          </div>

          {/* Worst Performer */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <TrendingDown className="w-6 h-6 text-red-500" />
              <h3 className="text-lg font-bold text-slate-900">Performer Inferiore</h3>
            </div>
            <div
              className="flex items-center gap-3 mb-4"
              style={{ borderLeft: `4px solid ${performers.worst.color}` }}
            >
              <div className="pl-2">
                <p className="text-2xl font-bold text-slate-900">{performers.worst.label}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Scontrini Annuali:</span>
                <span className="font-semibold text-slate-900">{fmt(performers.worst.scontrini)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Ricavo Totale:</span>
                <span className="font-semibold text-slate-900">€ {fmt(performers.worst.annual_revenue, 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Scontrino Medio:</span>
                <span className="font-semibold text-slate-900">€ {fmt(performers.worst.medio, 2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
