import { useState, useMemo, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from 'recharts';
import { Info, TrendingUp, Package, Percent, Store } from 'lucide-react';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import { useCompanyLabels } from '../hooks/useCompanyLabels';
import { useOutlets } from '../hooks/useOutlets';
import PageHeader from '../components/PageHeader';

function fmt(n: number, dec = 0): string {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}

type Season = 'SS26' | 'FW26'

interface OutletPlan {
  vendite_previste: number
  ricarico_target: number
  scorta_iniziale: number
  scorta_finale_target: number
  markdown_previsto: number
}

type SeasonData = Record<string, OutletPlan>
type SeasonDataset = Record<Season, SeasonData>

// Valori di esempio (NON salvati, solo stato locale): baseline neutro variato
// per outlet in modo deterministico. Non più cablati sui 7 outlet NZ — gli
// outlet si derivano dal tenant (useOutlets). L'utente modifica i parametri a mano.
const SIZE_FACTORS = [1.0, 1.2, 0.9, 1.35, 0.75, 1.15, 0.85, 1.0, 0.7, 1.1]
const SS_BASE: OutletPlan = { vendite_previste: 180000, ricarico_target: 58, scorta_iniziale: 40000, scorta_finale_target: 37000, markdown_previsto: 12 }
const FW_BASE: OutletPlan = { vendite_previste: 210000, ricarico_target: 60, scorta_iniziale: 38000, scorta_finale_target: 42000, markdown_previsto: 13 }
const DEFAULT_PLAN: OutletPlan = SS_BASE

function scalePlan(base: OutletPlan, factor: number): OutletPlan {
  return {
    vendite_previste: Math.round(base.vendite_previste * factor),
    ricarico_target: base.ricarico_target,
    scorta_iniziale: Math.round(base.scorta_iniziale * factor),
    scorta_finale_target: Math.round(base.scorta_finale_target * factor),
    markdown_previsto: base.markdown_previsto,
  }
}

function buildSeedData(outletNames: string[]): SeasonDataset {
  const ss: SeasonData = {}
  const fw: SeasonData = {}
  outletNames.forEach((name, i) => {
    const f = SIZE_FACTORS[i % SIZE_FACTORS.length]
    ss[name] = scalePlan(SS_BASE, f)
    fw[name] = scalePlan(FW_BASE, f)
  })
  return { SS26: ss, FW26: fw }
}

export default function OpenToBuy() {
  const labels = useCompanyLabels();
  const { outlets: tenantOutlets, loading: outletsLoading } = useOutlets();
  const [season, setSeason] = useState<'SS26' | 'FW26'>('SS26');

  // Outlet reali del tenant (non più cablati su NZ).
  const outletNames = useMemo(() => tenantOutlets.map((o) => o.name), [tenantOutlets]);
  const hasOutlets = outletNames.length > 0;

  // Valori di esempio per gli outlet del tenant (NON salvati). Vengono
  // riallineati quando cambia l'insieme di outlet (es. primo caricamento),
  // senza sovrascrivere le modifiche fatte dall'utente durante l'uso.
  const seededData = useMemo(() => buildSeedData(outletNames), [outletNames]);
  const [data, setData] = useState<SeasonDataset>(seededData);
  const outletsKey = outletNames.join('|');
  const seededKeyRef = useRef('');
  useEffect(() => {
    if (seededKeyRef.current !== outletsKey) {
      seededKeyRef.current = outletsKey;
      setData(seededData);
    }
  }, [outletsKey, seededData]);

  const planFor = (outlet: string): OutletPlan => data[season]?.[outlet] ?? DEFAULT_PLAN;

  const handleInputChange = (outlet: string, field: string, value: string) => {
    setData((prev) => ({
      ...prev,
      [season]: {
        ...prev[season],
        [outlet]: {
          ...(prev[season]?.[outlet] ?? DEFAULT_PLAN),
          [field]: field.includes('vendite') || field.includes('scorta') ? parseFloat(value) || 0 : parseFloat(value) || 0,
        },
      },
    }));
  };

  const calculateOTB = (outlet: string): number => {
    const d = planFor(outlet);
    // OTB = Planned Sales + Planned Markdowns + Planned End Inventory - Beginning Inventory
    // In cost: Planned Sales = vendite_previste / (1 + ricarico_target/100)
    const costo_vendite = d.vendite_previste / (1 + d.ricarico_target / 100);
    const costo_markdown = (d.vendite_previste * d.markdown_previsto) / 100 / (1 + d.ricarico_target / 100);
    const otb = costo_vendite + costo_markdown + d.scorta_finale_target - d.scorta_iniziale;
    return otb;
  };

  const chartData = useMemo(() => {
    return outletNames.map((outlet) => {
      const d = planFor(outlet);
      return {
        outlet: outlet.slice(0, 10),
        OTB: Math.round(calculateOTB(outlet)),
        vendite: Math.round(d.vendite_previste),
        markdown: Math.round((d.vendite_previste * d.markdown_previsto) / 100),
        scorta: Math.round(d.scorta_finale_target),
      };
    });
  }, [season, data, outletNames]);

  const summaryData = useMemo(() => {
    return outletNames.map((outlet) => ({
      outlet,
      ...planFor(outlet),
      otb: calculateOTB(outlet),
    }));
  }, [season, data, outletNames]);

  const kpis = useMemo(() => {
    const totalOTB = summaryData.reduce((sum, d) => sum + d.otb, 0);
    const avgOTB = summaryData.length ? totalOTB / summaryData.length : 0;
    const totalSales = summaryData.reduce((sum, d) => sum + d.vendite_previste, 0);
    const totalMarkdown = summaryData.reduce((sum, d) => sum + (d.vendite_previste * d.markdown_previsto) / 100, 0);
    const sellThrough = (totalSales / (totalSales + totalMarkdown)) * 100;

    return { totalOTB, avgOTB, sellThrough, totalMarkdown };
  }, [summaryData]);

  if (outletsLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto text-sm text-slate-400">Caricamento…</div>
      </div>
    );
  }
  if (!hasOutlets) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Open-to-Buy Planner</h1>
          <p className="text-slate-600 mb-8">Pianificazione stagionale acquisti</p>
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
            <Store className="w-14 h-14 mx-auto mb-4 text-slate-300" />
            <h2 className="text-lg font-semibold text-slate-700 mb-2">Nessun piano OTB disponibile</h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Il planner Open-to-Buy verrà popolato quando saranno disponibili dati di vendita storici
              per i {labels.pointOfSalePluralLower}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
        <PageHeader
          title="Open-to-Buy Planner"
          subtitle="Pianificazione stagionale acquisti"
        />

        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="mt-0.5 font-semibold whitespace-nowrap">Valori di esempio</span>
          <span className="text-amber-700">
            I parametri partono da valori di esempio sugli {labels.pointOfSalePluralLower} del tenant e
            si modificano a mano. Le modifiche non vengono salvate: servono a simulare il piano OTB.
          </span>
        </div>

        {/* Season Selector */}
        <div className="flex gap-3 mb-8">
          {(['SS26', 'FW26'] as const).map((s) => (
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
              <h3 className="text-sm font-medium text-slate-600">OTB Medio per {labels.pointOfSale}</h3>
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">€{fmt(kpis.avgOTB, 0)}</p>
            <p className="text-xs text-slate-500 mt-1">Media dei {outletNames.length} {labels.pointOfSalePluralLower}</p>
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
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Parametri per {labels.pointOfSale}</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {outletNames.map((outlet) => {
              const d = planFor(outlet);
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
            <h3 className="text-lg font-bold text-slate-900 mb-4">Budget OTB per {labels.pointOfSale}</h3>
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
            <h3 className="text-lg font-bold text-slate-900">Riepilogo Completo {labels.pointOfSalePlural}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-3 text-left font-semibold text-slate-900">{labels.pointOfSale}</th>
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
