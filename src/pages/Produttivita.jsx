import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart
} from 'recharts';
import { TrendingUp, Users, Euro, Target, AlertCircle, CheckCircle } from 'lucide-react';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';

function fmt(n, dec = 0) {
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}

const outletData = [
  {
    nome: 'Valdichiana',
    dipendenti: 6,
    ricavi: 814816,
    costo_personale: 115918,
    ore_sett: 240,
    colore: '#3b82f6'
  },
  {
    nome: 'Barberino',
    dipendenti: 4,
    ricavi: 354565,
    costo_personale: 75778,
    ore_sett: 160,
    colore: '#10b981'
  },
  {
    nome: 'Franciacorta',
    dipendenti: 4,
    ricavi: 410564,
    costo_personale: 73046,
    ore_sett: 160,
    colore: '#f59e0b'
  },
  {
    nome: 'Palmanova',
    dipendenti: 5,
    ricavi: 281267,
    costo_personale: 89839,
    ore_sett: 200,
    colore: '#8b5cf6'
  },
  {
    nome: 'Brugnato',
    dipendenti: 4,
    ricavi: 195261,
    costo_personale: 68129,
    ore_sett: 160,
    colore: '#ec4899'
  },
  {
    nome: 'Valmontone',
    dipendenti: 6,
    ricavi: 219074,
    costo_personale: 106223,
    ore_sett: 240,
    colore: '#06b6d4'
  }
];

export default function Produttivita() {
  const [simulazioneAttiva, setSimulazioneAttiva] = useState(false);
  const [moved, setMoved] = useState({ from: null, to: null, count: 1 });

  // Calcolo metriche per ogni outlet
  const metriche = useMemo(() => {
    const base = outletData.map(outlet => {
      const ore_annuali = outlet.ore_sett * 52;
      const ricavo_per_dip = outlet.ricavi / outlet.dipendenti;
      const ricavo_per_ora = outlet.ricavi / ore_annuali;
      const costo_per_ora = outlet.costo_personale / ore_annuali;
      const margine_per_ora = ricavo_per_ora - costo_per_ora;
      const roi = outlet.ricavi / outlet.costo_personale;

      return {
        id: outlet.nome,
        nome: outlet.nome,
        dipendenti: outlet.dipendenti,
        ricavi: outlet.ricavi,
        costo_personale: outlet.costo_personale,
        ore_sett: outlet.ore_sett,
        ore_annuali,
        ricavo_per_dip,
        ricavo_per_ora,
        costo_per_ora,
        margine_per_ora,
        roi,
        colore: outlet.colore
      };
    });

    // Applica simulazione se attiva
    if (simulazioneAttiva && moved.from && moved.to && moved.count > 0) {
      const fromIdx = base.findIndex(m => m.nome === moved.from);
      const toIdx = base.findIndex(m => m.nome === moved.to);

      if (fromIdx >= 0 && toIdx >= 0 && base[fromIdx].dipendenti > moved.count) {
        base[fromIdx] = {
          ...base[fromIdx],
          dipendenti: base[fromIdx].dipendenti - moved.count,
          ore_sett: base[fromIdx].ore_sett - (moved.count * 40),
          ore_annuali: (base[fromIdx].ore_sett - moved.count * 40) * 52,
          ricavo_per_dip: base[fromIdx].ricavi / (base[fromIdx].dipendenti - moved.count),
          ricavo_per_ora: base[fromIdx].ricavi / ((base[fromIdx].ore_sett - moved.count * 40) * 52),
          costo_per_ora: base[fromIdx].costo_personale / ((base[fromIdx].ore_sett - moved.count * 40) * 52)
        };
        base[fromIdx].margine_per_ora = base[fromIdx].ricavo_per_ora - base[fromIdx].costo_per_ora;
        base[fromIdx].roi = base[fromIdx].ricavi / base[fromIdx].costo_personale;

        base[toIdx] = {
          ...base[toIdx],
          dipendenti: base[toIdx].dipendenti + moved.count,
          ore_sett: base[toIdx].ore_sett + (moved.count * 40),
          ore_annuali: (base[toIdx].ore_sett + moved.count * 40) * 52,
          ricavo_per_dip: base[toIdx].ricavi / (base[toIdx].dipendenti + moved.count),
          ricavo_per_ora: base[toIdx].ricavi / ((base[toIdx].ore_sett + moved.count * 40) * 52),
          costo_per_ora: base[toIdx].costo_personale / ((base[toIdx].ore_sett + moved.count * 40) * 52)
        };
        base[toIdx].margine_per_ora = base[toIdx].ricavo_per_ora - base[toIdx].costo_per_ora;
        base[toIdx].roi = base[toIdx].ricavi / base[toIdx].costo_personale;
      }
    }

    return base;
  }, [simulazioneAttiva, moved]);

  // KPI derivati
  const kpi = useMemo(() => {
    const best_produttivita = metriche.reduce((a, b) => a.ricavo_per_ora > b.ricavo_per_ora ? a : b);
    const worst_produttivita = metriche.reduce((a, b) => a.ricavo_per_ora < b.ricavo_per_ora ? a : b);
    const avg_ricavo_ora = metriche.reduce((sum, m) => sum + m.ricavo_per_ora, 0) / metriche.length;
    const avg_roi = metriche.reduce((sum, m) => sum + m.roi, 0) / metriche.length;

    return { best_produttivita, worst_produttivita, avg_ricavo_ora, avg_roi };
  }, [metriche]);

  // Dati per chart ricavo per dipendente (ranking)
  const ricavo_per_dip_chart = metriche
    .sort((a, b) => b.ricavo_per_dip - a.ricavo_per_dip)
    .map(m => ({ nome: m.nome, value: m.ricavo_per_dip, colore: m.colore }));

  // Dati per chart ricavo per ora
  const ricavo_per_ora_chart = metriche
    .sort((a, b) => b.ricavo_per_ora - a.ricavo_per_ora)
    .map(m => ({ nome: m.nome, value: m.ricavo_per_ora, colore: m.colore }));

  // Dati per chart ricavo vs costo per ora
  const ricavo_costo_chart = metriche.map(m => ({
    nome: m.nome,
    'Ricavo/ora': parseFloat(m.ricavo_per_ora.toFixed(2)),
    'Costo/ora': parseFloat(m.costo_per_ora.toFixed(2)),
    colore: m.colore
  }));

  // Trend mensile (con fattore stagionale)
  const trend_mensile = useMemo(() => {
    const mesi = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    const fattori = [0.85, 0.82, 0.88, 0.92, 1.05, 1.12, 1.15, 1.10, 1.08, 1.15, 1.20, 1.25];

    return mesi.map((mese, idx) => {
      const fattore = fattori[idx];
      return {
        mese,
        'Valdichiana': parseFloat((kpi.best_produttivita.ricavo_per_ora * fattore).toFixed(2)),
        'Barberino': parseFloat((metriche.find(m => m.nome === 'Barberino').ricavo_per_ora * fattore).toFixed(2)),
        'Media': parseFloat((kpi.avg_ricavo_ora * fattore).toFixed(2))
      };
    });
  }, [kpi, metriche]);

  // Raccomandazioni
  const raccomandazioni = useMemo(() => {
    const ottimal_ratio = 1.8; // rapporto ricavo/costo target
    const recs = [];

    metriche.forEach(m => {
      const rapporto = m.ricavi / m.costo_personale;
      if (rapporto < ottimal_ratio) {
        const dip_ottimali = Math.ceil(m.costo_personale / (m.ricavi / (m.dipendenti * ottimal_ratio)));
        if (dip_ottimali < m.dipendenti) {
          recs.push({
            outlet: m.nome,
            tipo: 'ridurre',
            dip_attuali: m.dipendenti,
            dip_ottimali: Math.max(1, dip_ottimali),
            impact: `Ridurre a ${Math.max(1, dip_ottimali)} dipendenti migliorerebbe ROI`
          });
        }
      }
    });

    // Top performer
    recs.push({
      outlet: kpi.best_produttivita.nome,
      tipo: 'mantenere',
      dip_attuali: kpi.best_produttivita.dipendenti,
      dip_ottimali: kpi.best_produttivita.dipendenti,
      impact: 'Outlet performante: mantenere struttura attuale'
    });

    return recs.slice(0, 4);
  }, [metriche, kpi]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Produttività Staff</h1>
          <p className="text-slate-600">Analytics sulla performance dei dipendenti per outlet</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-600 text-sm font-medium">Best Ricavo/ora</span>
              <CheckCircle className="w-4 h-4 text-green-600" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{fmt(kpi.best_produttivita.ricavo_per_ora, 2)}€</div>
            <div className="text-xs text-slate-500 mt-2">{kpi.best_produttivita.nome}</div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-600 text-sm font-medium">Worst Ricavo/ora</span>
              <AlertCircle className="w-4 h-4 text-red-600" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{fmt(kpi.worst_produttivita.ricavo_per_ora, 2)}€</div>
            <div className="text-xs text-slate-500 mt-2">{kpi.worst_produttivita.nome}</div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-600 text-sm font-medium">Media Ricavo/ora</span>
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{fmt(kpi.avg_ricavo_ora, 2)}€</div>
            <div className="text-xs text-slate-500 mt-2">Tutti gli outlet</div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-600 text-sm font-medium">Media ROI Personale</span>
              <Euro className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{fmt(kpi.avg_roi, 2)}</div>
            <div className="text-xs text-slate-500 mt-2">Rapporto ricavi/costo</div>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Ricavo per Dipendente */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Ricavo per Dipendente (Ranked)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart layout="vertical" data={ricavo_per_dip_chart}>
                <defs>
                  <linearGradient id="grad-ricavo-dip" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis type="number" {...AXIS_STYLE} />
                <YAxis dataKey="nome" type="category" width={120} {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => fmt(value, 0) + '€'} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="value" fill="url(#grad-ricavo-dip)" radius={[0, 8, 8, 0]} animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Ricavo per Ora */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Ricavo per Ora Lavoro (Ranked)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart layout="vertical" data={ricavo_per_ora_chart}>
                <defs>
                  <linearGradient id="grad-ricavo-ora" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis type="number" {...AXIS_STYLE} />
                <YAxis dataKey="nome" type="category" width={120} {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => fmt(value, 2) + '€'} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="value" fill="url(#grad-ricavo-ora)" radius={[0, 8, 8, 0]} animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Ricavo vs Costo per Ora */}
          <div className="rounded-2xl p-6 shadow-lg lg:col-span-2" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Ricavo vs Costo per Ora Lavoro</h2>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={ricavo_costo_chart}>
                <defs>
                  <linearGradient id="grad-ricavo-vs-costo-1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="grad-ricavo-vs-costo-2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="nome" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => fmt(value, 2) + '€'} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Legend />
                <Bar dataKey="Ricavo/ora" fill="url(#grad-ricavo-vs-costo-1)" radius={[8, 8, 0, 0]} animationDuration={800} />
                <Bar dataKey="Costo/ora" fill="url(#grad-ricavo-vs-costo-2)" radius={[8, 8, 0, 0]} animationDuration={800} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Trend Mensile */}
          <div className="rounded-2xl p-6 shadow-lg lg:col-span-2" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Trend Mensile Ricavo/ora (Simulato)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={trend_mensile}>
                <defs>
                  <linearGradient id="grad-trend-1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="grad-trend-2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="grad-trend-3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="mese" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => fmt(value, 2) + '€'} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Legend />
                <Bar dataKey="Valdichiana" fill="url(#grad-trend-1)" radius={[8, 8, 0, 0]} animationDuration={800} />
                <Bar dataKey="Barberino" fill="url(#grad-trend-2)" radius={[8, 8, 0, 0]} animationDuration={800} />
                <Bar dataKey="Media" fill="url(#grad-trend-3)" radius={[8, 8, 0, 0]} animationDuration={800} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Tabella Comparativa */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Confronto Metriche Completo</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left text-slate-700 font-semibold">Outlet</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Dip.</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Ricavi Annui</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Costo Personale</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Ricavo/Dip</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Ricavo/Ora</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Costo/Ora</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Margine/Ora</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">ROI</th>
                </tr>
              </thead>
              <tbody>
                {metriche
                  .slice()
                  .sort((a, b) => b.ricavo_per_ora - a.ricavo_per_ora)
                  .map((m, idx) => {
                    const isTop = idx === 0;
                    const isBottom = idx === metriche.length - 1;
                    const rowClass = isTop ? 'bg-green-50' : isBottom ? 'bg-red-50' : '';

                    return (
                      <tr key={m.nome} className={`border-b border-slate-200 ${rowClass}`}>
                        <td className="px-4 py-3 text-slate-900 font-medium">{m.nome}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{m.dipendenti}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(m.ricavi, 0)}€</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(m.costo_personale, 0)}€</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(m.ricavo_per_dip, 0)}€</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(m.ricavo_per_ora, 2)}€</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(m.costo_per_ora, 2)}€</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(m.margine_per_ora, 2)}€</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(m.roi, 2)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Simulatore */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Simulatore: Sposta Dipendente</h2>
            <button
              onClick={() => setSimulazioneAttiva(!simulazioneAttiva)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                simulazioneAttiva
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-slate-200 text-slate-900 hover:bg-slate-300'
              }`}
            >
              {simulazioneAttiva ? 'Disattiva Simulazione' : 'Attiva Simulazione'}
            </button>
          </div>

          {simulazioneAttiva && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Da Outlet</label>
                  <select
                    value={moved.from || ''}
                    onChange={(e) => setMoved({ ...moved, from: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Seleziona outlet</option>
                    {metriche.map(m => (
                      <option key={m.nome} value={m.nome}>{m.nome}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">A Outlet</label>
                  <select
                    value={moved.to || ''}
                    onChange={(e) => setMoved({ ...moved, to: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Seleziona outlet</option>
                    {metriche.map(m => (
                      <option key={m.nome} value={m.nome}>{m.nome}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Numero Dipendenti</label>
                  <input
                    type="number"
                    min="1"
                    value={moved.count}
                    onChange={(e) => setMoved({ ...moved, count: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {moved.from && moved.to && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-900">
                    <strong>Simulazione attiva:</strong> Spostando {moved.count} dipendente(i) da <strong>{moved.from}</strong> a <strong>{moved.to}</strong>
                  </p>
                  {moved.from && (
                    <p className="text-xs text-blue-800 mt-2">
                      {moved.from}: Ricavo/ora da {fmt(metriche.find(m => m.nome === moved.from)?.ricavo_per_ora, 2)}€ → {fmt(
                        metriche.find(m => m.nome === moved.from && simulazioneAttiva)?.ricavo_per_ora || metriche.find(m => m.nome === moved.from)?.ricavo_per_ora,
                        2
                      )}€
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Raccomandazioni */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Raccomandazioni Struttura Personale</h2>
          <div className="space-y-3">
            {raccomandazioni.map((rec, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border ${
                  rec.tipo === 'mantenere'
                    ? 'bg-green-50 border-green-200'
                    : 'bg-amber-50 border-amber-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  {rec.tipo === 'mantenere' ? (
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <Target className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className={`font-medium ${rec.tipo === 'mantenere' ? 'text-green-900' : 'text-amber-900'}`}>
                      {rec.outlet}
                    </p>
                    <p className={`text-sm mt-1 ${rec.tipo === 'mantenere' ? 'text-green-800' : 'text-amber-800'}`}>
                      {rec.tipo === 'ridurre'
                        ? `Considerate riduzione da ${rec.dip_attuali} a ${rec.dip_ottimali} dipendenti. ${rec.impact}`
                        : rec.impact}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
