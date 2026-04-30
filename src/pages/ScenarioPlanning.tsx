// @ts-nocheck
// TODO: tighten types
import { useState, useEffect, useMemo, useCallback } from 'react';
import { TrendingUp, AlertCircle, Target, Loader2, ToggleLeft, ToggleRight, Save, CheckCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { usePeriod } from '../hooks/usePeriod';
import PageHelp from '../components/PageHelp';

function fmt(n: number, dec = 0) {
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}

export default function ScenarioPlanning() {
  const { profile } = useAuth();
  // Anno sincronizzato col PeriodContext globale (selettore header).
  const { year: globalYear } = usePeriod();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(globalYear || 2026);
  useEffect(() => { if (globalYear) setYear(globalYear); }, [globalYear]);
  // TODO: tighten type
  const [rawEntries, setRawEntries] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: string; text: string } | null>(null);

  // Scenario sliders
  const [varRicavi, setVarRicavi] = useState(0);           // -30 to +50 %
  const [varPersonale, setVarPersonale] = useState(0);      // -20 to +30 %
  const [nuovoOutlet, setNuovoOutlet] = useState(false);
  const [costiNuovoOutlet, setCostiNuovoOutlet] = useState(150000); // default 150K

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
      } catch (err: unknown) {
        console.error('[ScenarioPlanning] fetch error:', err);
        setError((err as Error).message);
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
    const marginePercent = ricaviTotali > 0 ? ((ricaviTotali - costiTotali) / ricaviTotali) * 100 : 0;

    return {
      ricaviTotali,
      costiPersonale,
      costiTotali,
      numOutlet,
      avgRicaviOutlet,
      avgCostiOutlet,
      avgPersonaleOutlet,
      utile: ricaviTotali - costiTotali,
      marginePercent,
    };
  }, [rawEntries]);

  // Compute scenario
  const scenario = useMemo(() => {
    const ricaviAdj = baseline.ricaviTotali * (1 + varRicavi / 100);
    const personaleAdj = baseline.costiPersonale * (1 + varPersonale / 100);
    const altriCosti = baseline.costiTotali - baseline.costiPersonale;
    let costiAdj = personaleAdj + altriCosti;
    let ricaviTot = ricaviAdj;

    // Nuovo outlet with custom costs
    if (nuovoOutlet) {
      // Revenue estimate: proportional to average outlet
      ricaviTot += baseline.avgRicaviOutlet;
      // Costs: user-defined estimate
      costiAdj += costiNuovoOutlet;
    }

    const utileSimulato = ricaviTot - costiAdj;
    const deltaUtile = utileSimulato - baseline.utile;
    const deltaPercent = baseline.utile !== 0 ? (deltaUtile / Math.abs(baseline.utile)) * 100 : 0;
    const marginePercent = ricaviTot > 0 ? ((ricaviTot - costiAdj) / ricaviTot) * 100 : 0;

    // Cash impact: delta on a monthly basis
    const cashImpactMensile = deltaUtile / 12;

    // Break-even months for new outlet
    let mesiBreakEven = null;
    if (nuovoOutlet && costiNuovoOutlet > 0) {
      const utileNuovoOutlet = baseline.avgRicaviOutlet - costiNuovoOutlet;
      if (utileNuovoOutlet > 0) {
        // Months to recover initial investment (estimated as 1 year of costs)
        mesiBreakEven = Math.ceil(costiNuovoOutlet / (utileNuovoOutlet / 12));
      } else {
        mesiBreakEven = -1; // never
      }
    }

    return {
      ricavi: ricaviTot,
      costi: costiAdj,
      utile: utileSimulato,
      deltaUtile,
      deltaPercent,
      marginePercent,
      cashImpactMensile,
      mesiBreakEven,
    };
  }, [baseline, varRicavi, varPersonale, nuovoOutlet, costiNuovoOutlet]);

  // Chart data: Base vs Scenario
  const chartData = useMemo(() => [
    {
      nome: 'Scenario Attuale',
      Ricavi: Math.round(baseline.ricaviTotali),
      Costi: Math.round(baseline.costiTotali),
      Utile: Math.round(baseline.utile),
    },
    {
      nome: 'Scenario Simulato',
      Ricavi: Math.round(scenario.ricavi),
      Costi: Math.round(scenario.costi),
      Utile: Math.round(scenario.utile),
    },
  ], [baseline, scenario]);

  // Save scenario
  const handleSaveScenario = useCallback(async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const companyId = profile?.company_id;
      const scenarioData = {
        company_id: companyId,
        year,
        var_ricavi: varRicavi,
        var_personale: varPersonale,
        nuovo_outlet: nuovoOutlet,
        costi_nuovo_outlet: nuovoOutlet ? costiNuovoOutlet : null,
        baseline_ricavi: baseline.ricaviTotali,
        baseline_costi: baseline.costiTotali,
        baseline_utile: baseline.utile,
        scenario_ricavi: scenario.ricavi,
        scenario_costi: scenario.costi,
        scenario_utile: scenario.utile,
        delta_utile: scenario.deltaUtile,
        created_at: new Date().toISOString(),
      };

      const { error: insertError } = await supabase
        .from('scenario_simulations')
        .insert(scenarioData);

      if (insertError) {
        // Table may not exist
        if (insertError.code === '42P01' || insertError.message?.includes('does not exist')) {
          setSaveMessage({ type: 'warning', text: 'La tabella scenario_simulations non esiste ancora. Scenario non salvato, ma i risultati sono visibili qui.' });
        } else {
          throw insertError;
        }
      } else {
        setSaveMessage({ type: 'success', text: 'Scenario salvato con successo!' });
      }
    } catch (err: unknown) {
      console.error('[ScenarioPlanning] save error:', err);
      setSaveMessage({ type: 'error', text: `Errore nel salvataggio: ${(err as Error).message}` });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(null), 5000);
    }
  }, [profile, year, varRicavi, varPersonale, nuovoOutlet, costiNuovoOutlet, baseline, scenario]);

  const isModified = varRicavi !== 0 || varPersonale !== 0 || nuovoOutlet;

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
          <div className="flex items-center gap-4">
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
            {/* Save button */}
            {isModified && (
              <button
                onClick={handleSaveScenario}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salva Scenario
              </button>
            )}
          </div>
        </div>

        {/* Save message */}
        {saveMessage && (
          <div className={`rounded-xl p-4 mb-6 border ${
            saveMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
            saveMessage.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' :
            'bg-red-50 border-red-200 text-red-800'
          }`}>
            <div className="flex items-center gap-2">
              {saveMessage.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              <p className="text-sm font-medium">{saveMessage.text}</p>
            </div>
          </div>
        )}

        {baseline.ricaviTotali === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 text-lg">Nessun dato budget trovato per l'anno {year}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* LEFT: Baseline Info + Sliders */}
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
                  <div className="flex justify-between">
                    <span className="text-slate-600">Margine %</span>
                    <span className={`font-semibold ${baseline.marginePercent >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {baseline.marginePercent.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Sliders */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-6">Parametri Scenario</h2>

                {/* Revenue slider: -30% to +50% */}
                <div className="mb-6">
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">Variazione Fatturato</label>
                    <span className={`text-sm font-bold ${varRicavi > 0 ? 'text-green-600' : varRicavi < 0 ? 'text-red-600' : 'text-slate-600'}`}>
                      {varRicavi > 0 ? '+' : ''}{varRicavi}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-30"
                    max="50"
                    step="1"
                    value={varRicavi}
                    onChange={(e) => setVarRicavi(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>-30%</span>
                    <span>0%</span>
                    <span>+50%</span>
                  </div>
                </div>

                {/* Staff cost slider: -20% to +30% */}
                <div className="mb-6">
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">Variazione Costo Personale</label>
                    <span className={`text-sm font-bold ${varPersonale > 0 ? 'text-red-600' : varPersonale < 0 ? 'text-green-600' : 'text-slate-600'}`}>
                      {varPersonale > 0 ? '+' : ''}{varPersonale}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-20"
                    max="30"
                    step="1"
                    value={varPersonale}
                    onChange={(e) => setVarPersonale(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>-20%</span>
                    <span>0%</span>
                    <span>+30%</span>
                  </div>
                </div>

                {/* New outlet toggle with cost input */}
                <div className="py-3 border-t border-slate-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium text-slate-700">Nuovo Outlet</label>
                      <p className="text-xs text-slate-500 mt-0.5">Simula apertura di un nuovo punto vendita</p>
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

                  {nuovoOutlet && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Costi stimati annui nuovo outlet</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="50000"
                          max="500000"
                          step="10000"
                          value={costiNuovoOutlet}
                          onChange={(e) => setCostiNuovoOutlet(parseInt(e.target.value) || 150000)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm text-slate-500 whitespace-nowrap">&euro;</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Ricavi stimati: {fmt(baseline.avgRicaviOutlet)} &euro; (media outlet)</p>
                    </div>
                  )}
                </div>

                {/* Reset */}
                <button
                  onClick={() => { setVarRicavi(0); setVarPersonale(0); setNuovoOutlet(false); setCostiNuovoOutlet(150000); }}
                  className="w-full mt-4 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Resetta Scenario
                </button>
              </div>
            </div>

            {/* CENTER + RIGHT: Results */}
            <div className="lg:col-span-2 space-y-6">
              {/* Real-time Result Panel */}
              <div className={`rounded-xl p-6 border-2 ${
                scenario.utile >= baseline.utile
                  ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
                  : 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
              }`}>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">Risultati Scenario in Tempo Reale</h3>
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Margine Previsto</p>
                    <p className={`text-2xl font-bold ${scenario.marginePercent >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {scenario.marginePercent.toFixed(1)}%
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      vs {baseline.marginePercent.toFixed(1)}% attuale
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Cash Impact Mensile</p>
                    <p className={`text-2xl font-bold ${scenario.cashImpactMensile >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {scenario.cashImpactMensile >= 0 ? '+' : ''}{fmt(scenario.cashImpactMensile)} &euro;
                    </p>
                    <p className="text-xs text-slate-500 mt-1">impatto su cash flow/mese</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">
                      {nuovoOutlet ? 'Mesi al Break-Even' : 'Delta Utile Annuo'}
                    </p>
                    {nuovoOutlet ? (
                      <p className={`text-2xl font-bold ${scenario.mesiBreakEven > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                        {scenario.mesiBreakEven > 0
                          ? `${scenario.mesiBreakEven} mesi`
                          : 'Mai'
                        }
                      </p>
                    ) : (
                      <p className={`text-2xl font-bold ${scenario.deltaUtile >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {scenario.deltaUtile >= 0 ? '+' : ''}{fmt(scenario.deltaUtile)} &euro;
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-1">
                      {nuovoOutlet
                        ? `Investimento: ${fmt(costiNuovoOutlet)} \u20ac/anno`
                        : `${scenario.deltaPercent >= 0 ? '+' : ''}${scenario.deltaPercent.toFixed(1)}% vs base`
                      }
                    </p>
                  </div>
                </div>
              </div>

              {/* Comparison Table: Scenario Attuale vs Simulato */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Confronto Scenario Attuale vs Simulato</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-4 py-3 text-left text-slate-700 font-semibold">Voce</th>
                        <th className="px-4 py-3 text-right text-slate-700 font-semibold">Scenario Attuale</th>
                        <th className="px-4 py-3 text-right text-slate-700 font-semibold">Scenario Simulato</th>
                        <th className="px-4 py-3 text-right text-slate-700 font-semibold">Differenza</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-100">
                        <td className="px-4 py-3 text-slate-900 font-medium">Ricavi</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(baseline.ricaviTotali)} &euro;</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(scenario.ricavi)} &euro;</td>
                        <td className="px-4 py-3 text-right">
                          <span className={scenario.ricavi >= baseline.ricaviTotali ? 'text-green-700' : 'text-red-700'}>
                            {scenario.ricavi >= baseline.ricaviTotali ? '+' : ''}{fmt(scenario.ricavi - baseline.ricaviTotali)} &euro;
                          </span>
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="px-4 py-3 text-slate-900 font-medium">Costi Totali</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(baseline.costiTotali)} &euro;</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(scenario.costi)} &euro;</td>
                        <td className="px-4 py-3 text-right">
                          <span className={scenario.costi <= baseline.costiTotali ? 'text-green-700' : 'text-red-700'}>
                            {scenario.costi > baseline.costiTotali ? '+' : ''}{fmt(scenario.costi - baseline.costiTotali)} &euro;
                          </span>
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="px-4 py-3 text-slate-900 font-medium">di cui Personale</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(baseline.costiPersonale)} &euro;</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(baseline.costiPersonale * (1 + varPersonale / 100))} &euro;</td>
                        <td className="px-4 py-3 text-right">
                          <span className={varPersonale <= 0 ? 'text-green-700' : 'text-red-700'}>
                            {varPersonale > 0 ? '+' : ''}{fmt(baseline.costiPersonale * varPersonale / 100)} &euro;
                          </span>
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100 bg-slate-50 font-semibold">
                        <td className="px-4 py-3 text-slate-900">Utile</td>
                        <td className="px-4 py-3 text-right">
                          <span className={baseline.utile >= 0 ? 'text-green-700' : 'text-red-700'}>{fmt(baseline.utile)} &euro;</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={scenario.utile >= 0 ? 'text-green-700' : 'text-red-700'}>{fmt(scenario.utile)} &euro;</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={scenario.deltaUtile >= 0 ? 'text-green-700' : 'text-red-700'}>
                            {scenario.deltaUtile >= 0 ? '+' : ''}{fmt(scenario.deltaUtile)} &euro;
                          </span>
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="px-4 py-3 text-slate-900 font-medium">Margine %</td>
                        <td className="px-4 py-3 text-right text-slate-700">{baseline.marginePercent.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-right text-slate-700">{scenario.marginePercent.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-right">
                          <span className={scenario.marginePercent >= baseline.marginePercent ? 'text-green-700' : 'text-red-700'}>
                            {(scenario.marginePercent - baseline.marginePercent) >= 0 ? '+' : ''}{(scenario.marginePercent - baseline.marginePercent).toFixed(1)} pp
                          </span>
                        </td>
                      </tr>
                      {nuovoOutlet && (
                        <tr className="border-b border-slate-100 bg-blue-50">
                          <td className="px-4 py-3 text-blue-900 font-medium">Nuovo Outlet</td>
                          <td className="px-4 py-3 text-right text-slate-400">-</td>
                          <td className="px-4 py-3 text-right text-blue-700">
                            +{fmt(baseline.avgRicaviOutlet)} ricavi / +{fmt(costiNuovoOutlet)} costi
                          </td>
                          <td className="px-4 py-3 text-right text-blue-700">
                            Utile outlet: {fmt(baseline.avgRicaviOutlet - costiNuovoOutlet)} &euro;
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Results Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Ricavi Simulati</p>
                  <p className="text-xl font-bold text-slate-900">{fmt(scenario.ricavi)} &euro;</p>
                  {(varRicavi !== 0 || nuovoOutlet) ? (
                    <p className={`text-xs mt-1 ${scenario.ricavi > baseline.ricaviTotali ? 'text-green-600' : 'text-red-600'}`}>
                      {scenario.ricavi > baseline.ricaviTotali ? '+' : ''}{fmt(scenario.ricavi - baseline.ricaviTotali)} vs base
                    </p>
                  ) : null}
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Costi Simulati</p>
                  <p className="text-xl font-bold text-slate-900">{fmt(scenario.costi)} &euro;</p>
                  {(varPersonale !== 0 || nuovoOutlet) ? (
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
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Confronto Visivo Base vs Scenario</h2>
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
              {isModified && (
                <div className={`rounded-xl p-5 border ${scenario.deltaUtile >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <h3 className={`font-semibold mb-2 ${scenario.deltaUtile >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                    Riepilogo Impatto Scenario
                  </h3>
                  <ul className={`text-sm space-y-1 ${scenario.deltaUtile >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                    {varRicavi !== 0 && (
                      <li>Variazione fatturato del {varRicavi > 0 ? '+' : ''}{varRicavi}%: {varRicavi > 0 ? '+' : ''}{fmt(baseline.ricaviTotali * varRicavi / 100)} &euro;</li>
                    )}
                    {varPersonale !== 0 && (
                      <li>Variazione costi personale del {varPersonale > 0 ? '+' : ''}{varPersonale}%: {varPersonale > 0 ? '+' : ''}{fmt(baseline.costiPersonale * varPersonale / 100)} &euro;</li>
                    )}
                    {nuovoOutlet && (
                      <li>Nuovo outlet: +{fmt(baseline.avgRicaviOutlet)} &euro; ricavi, +{fmt(costiNuovoOutlet)} &euro; costi</li>
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
      <PageHelp page="scenario-planning" />
    </div>
  );
}
