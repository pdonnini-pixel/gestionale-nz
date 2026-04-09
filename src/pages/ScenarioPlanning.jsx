import { useState, useMemo } from 'react';
import { TrendingUp, AlertCircle, BarChart3, Target } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';

function fmt(n, dec = 0) {
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}

const REFERENCE_DATA = {
  avgRent: 55000,
  avgPersonnel: 88000,
  avgServices: 35000,
  merciIncidence: 0.54,
  sedeBaseCosts: 354684,
  currentOutlets: 7,
  companyRevenue2025: 2324000,
  companyProfit2025: 14441,
};

const SCENARIOS = {
  Conservative: {
    nome: 'Outlet Conservativo',
    localita: 'Torino',
    dipendenti: 4,
    affitto: 50000,
    capex: 45000,
    ricaviAnno1: 350000,
    crescitaAnno2: 0.12,
    crescitaAnno3: 0.10,
    costoPersonale: 18000,
    merciIncidence: 0.54,
  },
  Moderate: {
    nome: 'Outlet Standard',
    localita: 'Milano',
    dipendenti: 5,
    affitto: 55000,
    capex: 60000,
    ricaviAnno1: 480000,
    crescitaAnno2: 0.18,
    crescitaAnno3: 0.15,
    costoPersonale: 18000,
    merciIncidence: 0.54,
  },
  Aggressive: {
    nome: 'Outlet Premium',
    localita: 'Roma',
    dipendenti: 6,
    affitto: 65000,
    capex: 80000,
    ricaviAnno1: 620000,
    crescitaAnno2: 0.25,
    crescitaAnno3: 0.20,
    costoPersonale: 19000,
    merciIncidence: 0.53,
  },
};

export default function ScenarioPlanning() {
  const [inputs, setInputs] = useState({
    nome: 'Nuovo Outlet',
    localita: 'Città',
    dipendenti: 4,
    affitto: 55000,
    capex: 60000,
    ricaviAnno1: 480000,
    crescitaAnno2: 0.18,
    crescitaAnno3: 0.15,
    costoPersonale: 18000,
    merciIncidence: 0.54,
  });

  const handleInputChange = (field, value) => {
    setInputs(prev => ({ ...prev, [field]: value }));
  };

  const applyScenario = (scenario) => {
    setInputs(SCENARIOS[scenario]);
  };

  const calculations = useMemo(() => {
    const { dipendenti, affitto, capex, ricaviAnno1, crescitaAnno2, crescitaAnno3, costoPersonale, merciIncidence } = inputs;

    // Annual fixed costs
    const costiPersonale = dipendenti * costoPersonale;
    const costiServizi = (affitto / REFERENCE_DATA.avgRent) * REFERENCE_DATA.avgServices;
    const newSedeTotal = REFERENCE_DATA.sedeBaseCosts;
    const newOutletCount = REFERENCE_DATA.currentOutlets + 1;
    const quotaSede = newSedeTotal / newOutletCount;

    const costiAnnuali = costiPersonale + affitto + costiServizi + quotaSede;

    // 3-year projection
    const years = [
      {
        anno: 1,
        ricavi: ricaviAnno1,
        merci: ricaviAnno1 * merciIncidence,
        personale: costiPersonale,
        affitto: affitto,
        servizi: costiServizi,
        quotaSede: quotaSede,
      },
      {
        anno: 2,
        ricavi: ricaviAnno1 * (1 + crescitaAnno2),
        merci: ricaviAnno1 * (1 + crescitaAnno2) * merciIncidence,
        personale: costiPersonale,
        affitto: affitto,
        servizi: costiServizi,
        quotaSede: quotaSede,
      },
      {
        anno: 3,
        ricavi: ricaviAnno1 * (1 + crescitaAnno2) * (1 + crescitaAnno3),
        merci: ricaviAnno1 * (1 + crescitaAnno2) * (1 + crescitaAnno3) * merciIncidence,
        personale: costiPersonale,
        affitto: affitto,
        servizi: costiServizi,
        quotaSede: quotaSede,
      },
    ];

    years.forEach(year => {
      year.costiTotali = year.merci + year.personale + year.affitto + year.servizi + year.quotaSede;
      year.margine = year.ricavi - year.costiTotali;
    });

    // Breakeven revenue
    const breakeven = costiAnnuali / (1 - merciIncidence);

    // Payback period (months)
    let paybackMonths = null;
    let cumulativeProfit = 0;
    for (let m = 0; m < 36; m++) {
      const anno = Math.floor(m / 12) + 1;
      const yearData = years[anno - 1];
      const monthlyProfit = yearData.margine / 12;
      cumulativeProfit += monthlyProfit;
      if (cumulativeProfit > capex && paybackMonths === null) {
        paybackMonths = m + 1;
      }
    }

    // Cumulative cash flow for chart (36 months)
    const cashFlowData = [];
    cumulativeProfit = -capex;
    for (let m = 0; m < 36; m++) {
      const anno = Math.floor(m / 12) + 1;
      const yearData = years[anno - 1];
      const monthlyProfit = yearData.margine / 12;
      cumulativeProfit += monthlyProfit;
      cashFlowData.push({
        mese: m + 1,
        cumulative: cumulativeProfit,
        monthly: monthlyProfit,
      });
    }

    // ROI
    const totalProfit3Yr = years.reduce((sum, y) => sum + y.margine, 0);
    const roi = (totalProfit3Yr / capex) * 100;

    // Company impact
    const oldSedeQuota = REFERENCE_DATA.sedeBaseCosts / REFERENCE_DATA.currentOutlets;
    const sedaSaving = (oldSedeQuota - quotaSede) * REFERENCE_DATA.currentOutlets;
    const newCompanyRevenue = REFERENCE_DATA.companyRevenue2025 + ricaviAnno1;
    const newCompanyMargin = REFERENCE_DATA.companyProfit2025 + years[0].margine + sedaSaving;

    // Comparison data
    const newOutletRevenuePerEmployee = ricaviAnno1 / dipendenti;
    const avgOutletRevenue = REFERENCE_DATA.companyRevenue2025 / REFERENCE_DATA.currentOutlets;
    const avgRevenuePerEmployee = avgOutletRevenue / 5; // avg 5 employees

    const comparisonData = [
      {
        nome: 'Nuovo Outlet',
        ricaviPerDip: newOutletRevenuePerEmployee,
        marginePercent: ((years[0].margine / ricaviAnno1) * 100),
      },
      {
        nome: 'Media Outlet',
        ricaviPerDip: avgRevenuePerEmployee,
        marginePercent: ((REFERENCE_DATA.companyProfit2025 / REFERENCE_DATA.companyRevenue2025) * 100),
      },
    ];

    return {
      costiAnnuali,
      breakeven,
      paybackMonths,
      roi,
      years,
      cashFlowData,
      oldSedeQuota,
      newSedeQuota: quotaSede,
      sedaSaving,
      newCompanyRevenue,
      newCompanyMargin,
      comparisonData,
      totalProfit3Yr,
    };
  }, [inputs]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Target className="w-10 h-10 text-blue-600" />
            Scenario Planning - Apertura Nuovo Outlet
          </h1>
          <p className="text-gray-600 mt-2">Simula l'apertura di un nuovo outlet e analizza l'impatto sulla rete</p>
        </div>

        {/* Preset Scenarios */}
        <div className="mb-6 flex gap-3">
          {Object.keys(SCENARIOS).map(scenario => (
            <button
              key={scenario}
              onClick={() => applyScenario(scenario)}
              className="px-4 py-2 rounded-lg bg-white border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 font-medium text-gray-700 transition"
            >
              📊 {scenario}
            </button>
          ))}
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* LEFT: Input Panel */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Parametri Scenario</h2>

              {/* Outlet Info */}
              <div className="space-y-4 pb-4 border-b">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nome Outlet</label>
                  <input
                    type="text"
                    value={inputs.nome}
                    onChange={e => handleInputChange('nome', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Località</label>
                  <input
                    type="text"
                    value={inputs.localita}
                    onChange={e => handleInputChange('localita', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Staffing */}
              <div className="space-y-4 py-4 border-b">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Numero Dipendenti: {inputs.dipendenti}
                  </label>
                  <input
                    type="range"
                    min="3"
                    max="8"
                    value={inputs.dipendenti}
                    onChange={e => handleInputChange('dipendenti', parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Costo Personale per Dipendente (€/anno)</label>
                  <input
                    type="number"
                    value={inputs.costoPersonale}
                    onChange={e => handleInputChange('costoPersonale', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Costs */}
              <div className="space-y-4 py-4 border-b">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Affitto Annuale (€)</label>
                  <input
                    type="number"
                    value={inputs.affitto}
                    onChange={e => handleInputChange('affitto', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Capex Allestimento Iniziale (€)</label>
                  <input
                    type="number"
                    value={inputs.capex}
                    onChange={e => handleInputChange('capex', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Revenue */}
              <div className="space-y-4 py-4 border-b">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ricavi Anno 1 (€)</label>
                  <input
                    type="number"
                    value={inputs.ricaviAnno1}
                    onChange={e => handleInputChange('ricaviAnno1', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Crescita Anno 2: {fmt(inputs.crescitaAnno2 * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.01"
                    value={inputs.crescitaAnno2}
                    onChange={e => handleInputChange('crescitaAnno2', parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Crescita Anno 3: {fmt(inputs.crescitaAnno3 * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.01"
                    value={inputs.crescitaAnno3}
                    onChange={e => handleInputChange('crescitaAnno3', parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              {/* COGS */}
              <div className="space-y-4 pt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Incidenza Merci: {fmt(inputs.merciIncidence * 100)}%</label>
                  <input
                    type="range"
                    min="0.40"
                    max="0.65"
                    step="0.01"
                    value={inputs.merciIncidence}
                    onChange={e => handleInputChange('merciIncidence', parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Results Panel */}
          <div className="space-y-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Breakeven Revenue</p>
                <p className="text-2xl font-bold text-gray-900">{fmt(calculations.breakeven, 0)}€</p>
                {calculations.breakeven > inputs.ricaviAnno1 && (
                  <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Sopra ricavi anno 1
                  </p>
                )}
              </div>
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Payback Period</p>
                <p className="text-2xl font-bold text-gray-900">{calculations.paybackMonths ? fmt(calculations.paybackMonths) + ' mesi' : '> 36 mesi'}</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">ROI 3 anni</p>
                <p className="text-2xl font-bold text-gray-900">{fmt(calculations.roi, 1)}%</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Margine Anno 1</p>
                <p className="text-2xl font-bold text-gray-900">{fmt(calculations.years[0].margine, 0)}€</p>
                <p className="text-xs text-gray-600 mt-1">{fmt((calculations.years[0].margine / inputs.ricaviAnno1) * 100, 1)}% di ROS</p>
              </div>
            </div>

            {/* Warning Alert */}
            {calculations.breakeven > inputs.ricaviAnno1 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-900">Attenzione: Breakeven non raggiungibile</p>
                  <p className="text-sm text-red-800">I ricavi stimati (€{fmt(inputs.ricaviAnno1, 0)}) non coprono il breakeven (€{fmt(calculations.breakeven, 0)})</p>
                </div>
              </div>
            )}

            {/* Impact Card */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-700 uppercase mb-2">Impatto sulla Rete</p>
              <p className="text-sm text-blue-900">
                Con questo outlet, la quota sede scende da <span className="font-bold">{fmt(calculations.oldSedeQuota, 0)}€</span> a <span className="font-bold">{fmt(calculations.newSedeQuota, 0)}€</span> per outlet,
                generando un risparmio di <span className="font-bold text-green-600">{fmt(calculations.sedaSaving, 0)}€</span> sull'intera rete.
              </p>
              <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                <div className="bg-white rounded-lg p-2">
                  <p className="text-xs text-gray-600">Ricavi Totali</p>
                  <p className="text-sm font-bold text-gray-900">{fmt(calculations.newCompanyRevenue, 0)}€</p>
                </div>
                <div className="bg-white rounded-lg p-2">
                  <p className="text-xs text-gray-600">Margine Anno 1</p>
                  <p className="text-sm font-bold text-gray-900">{fmt(calculations.newCompanyMargin, 0)}€</p>
                </div>
                <div className="bg-white rounded-lg p-2">
                  <p className="text-xs text-gray-600">Outlet Totali</p>
                  <p className="text-sm font-bold text-gray-900">8</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* P&L Table */}
        <div className="mt-8 bg-white rounded-xl shadow overflow-hidden">
          <div className="p-6 border-b">
            <h3 className="text-lg font-bold text-gray-900">Proiezione P&L - 3 Anni</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Voce</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Anno 1</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Anno 2</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Anno 3</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Ricavi', key: 'ricavi', bold: true },
                  { label: 'Merci (COGS)', key: 'merci', indent: true },
                  { label: 'Personale', key: 'personale', indent: true },
                  { label: 'Affitto', key: 'affitto', indent: true },
                  { label: 'Servizi', key: 'servizi', indent: true },
                  { label: 'Quota Sede', key: 'quotaSede', indent: true },
                  { label: 'Margine Lordo', key: 'margine', bold: true, highlight: true },
                ].map((row, idx) => (
                  <tr key={idx} className={row.highlight ? 'bg-green-50 border-t border-b' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className={`px-6 py-3 ${row.bold ? 'font-bold text-gray-900' : 'text-gray-600'} ${row.indent ? 'pl-12' : ''}`}>
                      {row.label}
                    </td>
                    {[0, 1, 2].map(year => (
                      <td key={year} className={`px-6 py-3 text-right ${row.bold ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                        {fmt(calculations.years[year][row.key], 0)}€
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Charts */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Cumulative Cash Flow */}
          <div className="rounded-2xl shadow-lg p-6" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">Flusso di Cassa Cumulativo - 36 Mesi</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={calculations.cashFlowData}>
                <defs>
                  <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="mese" label={{ value: 'Mesi', position: 'insideBottomRight', offset: -5 }} {...AXIS_STYLE} />
                <YAxis label={{ value: '€', angle: -90, position: 'insideLeft' }} {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={value => fmt(value, 0) + '€'} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorCumulative)"
                />
              </AreaChart>
            </ResponsiveContainer>
            {calculations.paybackMonths && (
              <p className="text-sm text-gray-600 mt-4">
                <span className="font-semibold">Breakeven nel mese {calculations.paybackMonths}</span> ({Math.floor(calculations.paybackMonths / 12)} anno{Math.floor(calculations.paybackMonths / 12) > 1 ? 'i' : ''})
              </p>
            )}
          </div>

          {/* Comparison */}
          <div className="rounded-2xl shadow-lg p-6" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">Confronto con Media Rete</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={calculations.comparisonData}>
                <defs>
                  <linearGradient id="grad-ricavi-per-dip" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="grad-margine-percent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="nome" {...AXIS_STYLE} />
                <YAxis yAxisId="left" label={{ value: 'Ricavi/Dip (€)', angle: -90, position: 'insideLeft' }} {...AXIS_STYLE} />
                <YAxis yAxisId="right" orientation="right" label={{ value: 'Margine %', angle: 90, position: 'insideRight' }} {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={value => fmt(value, 1)} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Legend />
                <Bar yAxisId="left" dataKey="ricaviPerDip" fill="url(#grad-ricavi-per-dip)" name="Ricavi per Dipendente" radius={[8, 8, 0, 0]} animationDuration={800} />
                <Bar yAxisId="right" dataKey="marginePercent" fill="url(#grad-margine-percent)" name="Margine %" radius={[8, 8, 0, 0]} animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
