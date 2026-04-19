import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, AlertCircle, Target, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

function fmt(n, dec = 0) {
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}

export default function ScenarioPlanning() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [year, setYear] = useState(2026);
  const [rawEntries, setRawEntries] = useState([]);

  // Scenario sliders
  const [varRicavi, setVarRicavi] = useState(0);       // -30 to +30 %
  const [varPersonale, setVarPersonale] = useState(0);  // -30 to +30 %
  const [nuovoOutlet, setNuovoOutlet] = useState(false);

  // Fetch budget_entries
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const companyId = profile?.company_id;
        let query = supabase
          .from('budget_entries')
          .select('cost_center, account_code, budget_amount')
          .eq('year', year);

        if (companyId) query = query.eq('company_id', companyId);

        const { data, error: fetchError } = await query;
        if (fetchError) throw fetchError;
        setRawEntries(data || []);
      } catch (err) {
        console.error('[ScenarioPlanning] fetch error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [year, profile?.company_id]);

  // Compute baseline totals
  const baseline = useMemo(() => {
    let ricaviTotali = 0;
    let costiPersonale = 0;
    let costiTotali = 0;
    let outletCount = new Set();

    rawEntries.forEach(row => {
      const code = (row.account_code || '').toString();
      const amount = parseFloat(row.budget_amount) || 0;
      if (row.cost_center) outletCount.add(row.cost_center);

      if (code.startsWith('5')) {
        ricaviTotali += amount;
      }
      if (code.startsWith('63')) {
        costiPersonale += amount;
      }
      if (code.startsWith('6') || code.startsWith('7')) {
        costiTotali += amount;
      }
    });

    const numOutlet = outletCount.size || 1;
    const avgRicaviOutlet = ricaviTotali / numOutlet;
    const avgCostiOutlet = costiTotali / numOutlet;
    const avgPersonaleOutlet = costiPersonale / numOutlet;

    return {
      ricaviTotali,
      costiPersonale,
      costiTotali,
      numOutlet,
      avgRicaviOutlet,
      avgCostiOutlet,
      avgPersonaleOutlet,
      utile: ricaviTotali - costiTotali,
    };
  }, [rawEntries]);

  // Compute scenario
  const scenario = useMemo(() => {
    const ricaviAdj = baseline.ricaviTotali * (1 + varRicavi / 100);
    const personaleAdj = baseline.costiPersonale * (1 + varPersonale / 100);
    // Non-staff costs stay the same
    const altriCosti = baseline.costiTotali - baseline.costiPersonale;
    let costiAdj = personaleAdj + altriCosti;
    let ricaviTot = ricaviAdj;

    // Nuovo outlet: add average outlet revenue and costs
    if (nuovoOutlet) {
      ricaviTot += baseline.avgRicaviOutlet;
      costiAdj += baseline.avgCostiOutlet;
    }

    const utileSimulato = ricaviTot - costiAdj;
    const deltaUtile = utileSimulato - baseline.utile;
    const deltaPercent = baseline.utile !== 0 ? (deltaUtile / Math.abs(baseline.utile)) * 100 : 0;

    return {
      ricavi: ricaviTot,
      costi: costiAdj,
      utile: utileSimulato,
      deltaUtile,
      deltaPercent,
    };
  }, [baseline, varRicavi, varPersonale, nuovoOutlet]);

  // Chart data: Base vs Scenario
  const chartData = useMemo(() => [
    {
      nome: 'Base',
      Ricavi: Math.round(baseline.ricaviTotali),
      Costi: Math.round(baseline.costiTotali),
      Utile: Math.round(baseline.utile),
    },
    {
      nome: 'Scenario',
      Ricavi: Math.round(scenario.ricavi),
      Costi: Math.round(scenario.costi),
      Utile: Math.round(scenario.utile),
    },
  ], [baseline, scenario]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-600">Caricamento dati scenario...</span>
      </div>
    );
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
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 flex items-center gap-3">
              <Target className="w-10 h-10 text-blue-600" />
              Scenario Planning
            </h1>
            <p className="text-slate-600 mt-2">Simula variazioni di ricavi, costi e apertura nuovo outlet - Anno {year}</p>
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

        {baseline.ricaviTotali === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 text-lg">Nessun dato budget trovato per l'anno {year}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* LEFT: Baseline Info */}
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Baseline {year}</h2>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Outlet attivi</span>
                    <span className="font-semibold text-slate-900">{baseline.numOutlet}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Ricavi Totali</span>
                    <span className="font-semibold text-green-700">{fmt(baseline.ricaviTotali)} &euro;</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Costi Totali</span>
                    <span className="font-semibold text-red-700">{fmt(baseline.costiTotali)} &euro;</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">di cui Personale</span>
                    <span className="font-semibold text-slate-700">{fmt(baseline.costiPersonale)} &euro;</span>
                  </div>
                  <div className="border-t border-slate-200 pt-3 flex justify-between">
                    <span className="text-slate-900 font-semibold">Utile Base</span>
                    <span className={`font-bold ${baseline.utile >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {fmt(baseline.utile)} &euro;
                    </span>
                  </div>
                </div>
              </div>

              {/* Sliders */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-6">Parametri Scenario</h2>

                {/* Revenue slider */}
                <div className="mb-6">
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">Variazione Ricavi</label>
                    <span className={`text-sm font-bold ${varRicavi > 0 ? 'text-green-600' : varRicavi < 0 ? 'text-red-600' : 'text-slate-600'}`}>
                      {varRicavi > 0 ? '+' : ''}{varRicavi}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-30"
                    max="30"
                    step="5"
                    value={varRicavi}
                    onChange={(e) => setVarRicavi(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>-30%</span>
                    <span>0%</span>
                    <span>+30%</span>
                  </div>
                </div>

                {/* Staff cost slider */}
                <div className="mb-6">
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">Variazione Costi Personale</label>
                    <span className={`text-sm font-bold ${varPersonale > 0 ? 'text-red-600' : varPersonale < 0 ? 'text-green-600' : 'text-slate-600'}`}>
                      {varPersonale > 0 ? '+' : ''}{varPersonale}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-30"
                    max="30"
                    step="5"
                    value={varPersonale}
                    onChange={(e) => setVarPersonale(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>-30%</span>
                    <span>0%</span>
                    <span>+30%</span>
                  </div>
                </div>

                {/* New outlet toggle */}
                <div className="flex items-center justify-between py-3 border-t border-slate-200">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Nuovo Outlet</label>
                    <p className="text-xs text-slate-500 mt-0.5">Aggiunge ricavi/costi medi di un outlet</p>
                  </div>
                  <button
                    onClick={() => setNuovoOutlet(!nuovoOutlet)}
                    className="flex items-center gap-2"
                  >
                    {nuovoOutlet ? (
                      <ToggleRight className="w-10 h-10 text-blue-600" />
                    ) : (
                      <ToggleLeft className="w-10 h-10 text-slate-400" />
                    )}
                  </button>
                </div>

                {/* Reset */}
                <button
                  onClick={() => { setVarRicavi(0); setVarPersonale(0); setNuovoOutlet(false); }}
                  className="w-full mt-4 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Resetta Scenario
                </button>
              </div>
            </div>

            {/* CENTER + RIGHT: Results */}
            <div className="lg:col-span-2 space-y-6">
              {/* Results Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Ricavi Simulati</p>
                  <p className="text-xl font-bold text-slate-900">{fmt(scenario.ricavi)} &euro;</p>
                  {varRicavi !== 0 || nuovoOutlet ? (
                    <p className={`text-xs mt-1 ${scenario.ricavi > baseline.ricaviTotali ? 'text-green-600' : 'text-red-600'}`}>
                      {scenario.ricavi > baseline.ricaviTotali ? '+' : ''}{fmt(scenario.ricavi - baseline.ricaviTotali)} vs base
                    </p>
                  ) : null}
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Costi Simulati</p>
                  <p className="text-xl font-bold text-slate-900">{fmt(scenario.costi)} &euro;</p>
                  {varPersonale !== 0 || nuovoOutlet ? (
                    <p className={`text-xs mt-1 ${scenario.costi < baseline.costiTotali ? 'text-green-600' : 'text-red-600'}`}>
                      {scenario.costi > baseline.costiTotali ? '+' : ''}{fmt(scenario.costi - baseline.costiTotali)} vs base
                    </p>
                  ) : null}
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Utile Simulato</p>
                  <p className={`text-xl font-bold ${scenario.utile >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {fmt(scenario.utile)} &euro;
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Delta vs Base</p>
                  <p className={`text-xl font-bold ${scenario.deltaUtile >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {scenario.deltaUtile >= 0 ? '+' : ''}{fmt(scenario.deltaUtile)} &euro;
                  </p>
                  <p className={`text-xs mt-1 ${scenario.deltaPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {scenario.deltaPercent >= 0 ? '+' : ''}{scenario.deltaPercent.toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* Bar Chart: Base vs Scenario */}
              <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Confronto Base vs Scenario</h2>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={chartData} barGap={8}>
                    <defs>
                      <linearGradient id="grad-ricavi-sc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                      </linearGradient>
                      <linearGradient id="grad-costi-sc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
                      </linearGradient>
                      <linearGradient id="grad-utile-sc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis dataKey="nome" {...AXIS_STYLE} />
                    <YAxis {...AXIS_STYLE} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip content={<GlassTooltip formatter={(value) => fmt(value) + ' \u20ac'} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                    <Legend />
                    <Bar dataKey="Ricavi" fill="url(#grad-ricavi-sc)" radius={[8, 8, 0, 0]} animationDuration={800} />
                    <Bar dataKey="Costi" fill="url(#grad-costi-sc)" radius={[8, 8, 0, 0]} animationDuration={800} />
                    <Bar dataKey="Utile" fill="url(#grad-utile-sc)" radius={[8, 8, 0, 0]} animationDuration={800} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Impact summary */}
              {(varRicavi !== 0 || varPersonale !== 0 || nuovoOutlet) && (
                <div className={`rounded-xl p-5 border ${scenario.deltaUtile >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <h3 className={`font-semibold mb-2 ${scenario.deltaUtile >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                    Riepilogo Impatto Scenario
                  </h3>
                  <ul className={`text-sm space-y-1 ${scenario.deltaUtile >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                    {varRicavi !== 0 && (
                      <li>Variazione ricavi del {varRicavi > 0 ? '+' : ''}{varRicavi}%: {fmt(baseline.ricaviTotali * varRicavi / 100)} &euro;</li>
                    )}
                    {varPersonale !== 0 && (
                      <li>Variazione costi personale del {varPersonale > 0 ? '+' : ''}{varPersonale}%: {fmt(baseline.costiPersonale * varPersonale / 100)} &euro;</li>
                    )}
                    {nuovoOutlet && (
                      <li>Nuovo outlet: +{fmt(baseline.avgRicaviOutlet)} &euro; ricavi, +{fmt(baseline.avgCostiOutlet)} &euro; costi</li>
                    )}
                    <li className="font-semibold pt-1 border-t border-current/20">
                      Effetto netto sull'utile: {scenario.deltaUtile >= 0 ? '+' : ''}{fmt(scenario.deltaUtile)} &euro; ({scenario.deltaPercent >= 0 ? '+' : ''}{scenario.deltaPercent.toFixed(1)}%)
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
