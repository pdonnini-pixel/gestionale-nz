// @ts-nocheck
// TODO: tighten types
import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from 'recharts';
import { Info, TrendingUp, Package, Percent } from 'lucide-react';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';

function fmt(n: number, dec = 0): string {
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}

const initialData = {
  SS26: {
    Valdichiana: {
      vendite_previste: 185000,
      ricarico_target: 58,
      scorta_iniziale: 42000,
      scorta_finale_target: 38000,
      markdown_previsto: 12,
    },
    Barberino: {
      vendite_previste: 220000,
      ricarico_target: 60,
      scorta_iniziale: 48000,
      scorta_finale_target: 45000,
      markdown_previsto: 14,
    },
    Franciacorta: {
      vendite_previste: 165000,
      ricarico_target: 55,
      scorta_iniziale: 38000,
      scorta_finale_target: 35000,
      markdown_previsto: 11,
    },
    Palmanova: {
      vendite_previste: 245000,
      ricarico_target: 62,
      scorta_iniziale: 52000,
      scorta_finale_target: 50000,
      markdown_previsto: 13,
    },
    Brugnato: {
      vendite_previste: 140000,
      ricarico_target: 56,
      scorta_iniziale: 32000,
      scorta_finale_target: 30000,
      markdown_previsto: 10,
    },
    Valmontone: {
      vendite_previste: 210000,
      ricarico_target: 59,
      scorta_iniziale: 46000,
      scorta_finale_target: 43000,
      markdown_previsto: 12,
    },
    Torino: {
      vendite_previste: 155000,
      ricarico_target: 57,
      scorta_iniziale: 35000,
      scorta_finale_target: 33000,
      markdown_previsto: 11,
    },
  },
  FW26: {
    Valdichiana: {
      vendite_previste: 210000,
      ricarico_target: 60,
      scorta_iniziale: 38000,
      scorta_finale_target: 42000,
      markdown_previsto: 13,
    },
    Barberino: {
      vendite_previste: 245000,
      ricarico_target: 62,
      scorta_iniziale: 45000,
      scorta_finale_target: 48000,
      markdown_previsto: 15,
    },
    Franciacorta: {
      vendite_previste: 190000,
      ricarico_target: 58,
      scorta_iniziale: 35000,
      scorta_finale_target: 38000,
      markdown_previsto: 12,
    },
    Palmanova: {
      vendite_previste: 270000,
      ricarico_target: 63,
      scorta_iniziale: 50000,
      scorta_finale_target: 55000,
      markdown_previsto: 14,
    },
    Brugnato: {
      vendite_previste: 160000,
      ricarico_target: 58,
      scorta_iniziale: 30000,
      scorta_finale_target: 33000,
      markdown_previsto: 11,
    },
    Valmontone: {
      vendite_previste: 235000,
      ricarico_target: 61,
      scorta_iniziale: 43000,
      scorta_finale_target: 46000,
      markdown_previsto: 13,
    },
    Torino: {
      vendite_previste: 175000,
      ricarico_target: 59,
      scorta_iniziale: 33000,
      scorta_finale_target: 36000,
      markdown_previsto: 12,
    },
  },
};

const outlets = ['Valdichiana', 'Barberino', 'Franciacorta', 'Palmanova', 'Brugnato', 'Valmontone', 'Torino'];

export default function OpenToBuy() {
  const [season, setSeason] = useState<'SS26' | 'FW26'>('SS26');
  const [data, setData] = useState(initialData);

  const handleInputChange = (outlet: string, field: string, value: string) => {
    setData((prev) => ({
      ...prev,
      [season]: {
        ...prev[season],
        [outlet]: {
          ...prev[season][outlet],
          [field]: field.includes('vendite') || field.includes('scorta') ? parseFloat(value) || 0 : parseFloat(value) || 0,
        },
      },
    }));
  };

  const calculateOTB = (outlet: string): number => {
    const d = data[season][outlet];
    // OTB = Planned Sales + Planned Markdowns + Planned End Inventory - Beginning Inventory
    // In cost: Planned Sales = vendite_previste / (1 + ricarico_target/100)
    const costo_vendite = d.vendite_previste / (1 + d.ricarico_target / 100);
    const costo_markdown = (d.vendite_previste * d.markdown_previsto) / 100 / (1 + d.ricarico_target / 100);
    const otb = costo_vendite + costo_markdown + d.scorta_finale_target - d.scorta_iniziale;
    return otb;
  };

  const chartData = useMemo(() => {
    return outlets.map((outlet) => ({
      outlet: outlet.slice(0, 10),
      OTB: Math.round(calculateOTB(outlet)),
      vendite: Math.round(data[season][outlet].vendite_previste),
      markdown: Math.round((data[season][outlet].vendite_previste * data[season][outlet].markdown_previsto) / 100),
      scorta: Math.round(data[season][outlet].scorta_finale_target),
    }));
  }, [season, data]);

  const summaryData = useMemo(() => {
    return outlets.map((outlet) => ({
      outlet,
      ...data[season][outlet],
      otb: calculateOTB(outlet),
    }));
  }, [season, data]);

  const kpis = useMemo(() => {
    const totalOTB = summaryData.reduce((sum, d) => sum + d.otb, 0);
    const avgOTB = totalOTB / outlets.length;
    const totalSales = summaryData.reduce((sum, d) => sum + d.vendite_previste, 0);
    const totalMarkdown = summaryData.reduce((sum, d) => sum + (d.vendite_previste * d.markdown_previsto) / 100, 0);
    const sellThrough = (totalSales / (totalSales + totalMarkdown)) * 100;

    return { totalOTB, avgOTB, sellThrough, totalMarkdown };
  }, [summaryData]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Open-to-Buy Planner</h1>
          <p className="text-slate-600">Pianificazione stagionale acquisti per New Zago S.R.L.</p>
        </div>

        {/* Season Selector */}
        <div className="flex gap-3 mb-8">
          {['SS26', 'FW26'].map((s) => (
            <button
              key={s}
              onClick={() => setSeason(s)}
              className={`px-6 py-2 rounded-lg font-medium transition-all ${
                season === s
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {s === 'SS26' ? 'Primavera/Estate 2026' : 'Autunno/Inverno 2026'}
            </button>
          ))}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600">Budget OTB Totale</h3>
              <Package className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">€{fmt(kpis.totalOTB, 0)}</p>
            <p className="text-xs text-slate-500 mt-1">Budget acquisti disponibile</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600">OTB Medio per Outlet</h3>
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">€{fmt(kpis.avgOTB, 0)}</p>
            <p className="text-xs text-slate-500 mt-1">Media dei 7 outlet</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600">Target Sell-Through</h3>
              <Percent className="w-5 h-5 text-purple-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{fmt(kpis.sellThrough, 1)}%</p>
            <p className="text-xs text-slate-500 mt-1">% vendite su totale</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600">Budget Markdown</h3>
              <TrendingUp className="w-5 h-5 text-orange-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">€{fmt(kpis.totalMarkdown, 0)}</p>
            <p className="text-xs text-slate-500 mt-1">Riduzioni previste</p>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-8">
          <div className="flex gap-3">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-900 mb-1">Formula Open-to-Buy</h4>
              <p className="text-sm text-blue-800">
                <strong>OTB = Vendite Previste + Markdown Previsto + Scorta Finale Target − Scorta Iniziale</strong>
                <br />
                Rappresenta il budget disponibile (al costo) per nuovi acquisti nel periodo stagionale.
              </p>
            </div>
          </div>
        </div>

        {/* Outlet Editable Cards */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Parametri per Outlet</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {outlets.map((outlet) => {
              const d = data[season][outlet];
              const otb = calculateOTB(outlet);
              return (
                <div key={outlet} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h3 className="text-lg font-bold text-slate-900 mb-4">{outlet}</h3>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">Vendite Previste (€)</label>
                      <input
                        type="number"
                        value={d.vendite_previste}
                        onChange={(e) => handleInputChange(outlet, 'vendite_previste', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">Ricarico Target (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={d.ricarico_target}
                        onChange={(e) => handleInputChange(outlet, 'ricarico_target', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">Scorta Iniziale (€)</label>
                      <input
                        type="number"
                        value={d.scorta_iniziale}
                        onChange={(e) => handleInputChange(outlet, 'scorta_iniziale', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">Scorta Finale Target (€)</label>
                      <input
                        type="number"
                        value={d.scorta_finale_target}
                        onChange={(e) => handleInputChange(outlet, 'scorta_finale_target', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Markdown Previsto (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={d.markdown_previsto}
                      onChange={(e) => handleInputChange(outlet, 'markdown_previsto', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                    />
                  </div>
                  <div className="pt-4 border-t border-slate-200">
                    <div className="flex justify-between items-baseline">
                      <span className="text-sm font-medium text-slate-600">OTB Calcolato</span>
                      <span className="text-2xl font-bold text-blue-600">€{fmt(otb, 0)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* OTB per Outlet */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Budget OTB per Outlet</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <defs>
                  <linearGradient id="grad-otb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="outlet" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => `€${fmt(value, 0)}`} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="OTB" fill="url(#grad-otb)" radius={[8, 8, 0, 0]} animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sales + Markdown + Inventory */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Composizione Disponibilità</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id="grad-vendite" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="grad-markdown" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="grad-scorta" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="outlet" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => `€${fmt(value, 0)}`} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Legend />
                <Bar dataKey="vendite" stackId="a" fill="url(#grad-vendite)" name="Vendite Previste" radius={[8, 8, 0, 0]} animationDuration={800} />
                <Bar dataKey="markdown" stackId="a" fill="url(#grad-markdown)" name="Markdown" animationDuration={800} />
                <Bar dataKey="scorta" stackId="a" fill="url(#grad-scorta)" name="Scorta Finale" radius={[0, 0, 8, 8]} animationDuration={800} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Summary Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Riepilogo Completo Outlet</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-3 text-left font-semibold text-slate-900">Outlet</th>
                  <th className="px-6 py-3 text-right font-semibold text-slate-900">Vendite Previste</th>
                  <th className="px-6 py-3 text-right font-semibold text-slate-900">Ricarico %</th>
                  <th className="px-6 py-3 text-right font-semibold text-slate-900">Scorta Iniz.</th>
                  <th className="px-6 py-3 text-right font-semibold text-slate-900">Scorta Fin. Target</th>
                  <th className="px-6 py-3 text-right font-semibold text-slate-900">Markdown %</th>
                  <th className="px-6 py-3 text-right font-semibold text-slate-900">OTB Calcolato</th>
                </tr>
              </thead>
              <tbody>
                {summaryData.map((row, idx) => (
                  <tr key={row.outlet} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-6 py-3 font-medium text-slate-900">{row.outlet}</td>
                    <td className="px-6 py-3 text-right text-slate-700">€{fmt(row.vendite_previste, 0)}</td>
                    <td className="px-6 py-3 text-right text-slate-700">{fmt(row.ricarico_target, 1)}%</td>
                    <td className="px-6 py-3 text-right text-slate-700">€{fmt(row.scorta_iniziale, 0)}</td>
                    <td className="px-6 py-3 text-right text-slate-700">€{fmt(row.scorta_finale_target, 0)}</td>
                    <td className="px-6 py-3 text-right text-slate-700">{fmt(row.markdown_previsto, 1)}%</td>
                    <td className="px-6 py-3 text-right font-bold text-blue-600">€{fmt(row.otb, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
