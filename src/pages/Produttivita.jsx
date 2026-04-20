import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart,
  LineChart, Line,
} from 'recharts';
import { TrendingUp, Users, Euro, Target, AlertCircle, CheckCircle, Loader2, Award } from 'lucide-react';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE, PALETTE } from '../components/ChartTheme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import PageHelp from '../components/PageHelp';

function fmt(n, dec = 0) {
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MEDAL = ['', '\u{1F947}', '\u{1F948}', '\u{1F949}'];

export default function Produttivita() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [year, setYear] = useState(2026);
  const [rawEntries, setRawEntries] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [simulazioneAttiva, setSimulazioneAttiva] = useState(false);
  const [moved, setMoved] = useState({ from: null, to: null, count: 1 });

  // Fetch budget_entries + employees + allocations
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const companyId = profile?.company_id;

        // Fetch budget entries (with month for trend)
        let budgetQuery = supabase
          .from('budget_entries')
          .select('cost_center, account_code, budget_amount, month')
          .eq('year', year);
        if (companyId) budgetQuery = budgetQuery.eq('company_id', companyId);

        // Fetch employees
        let empQuery = supabase
          .from('employees')
          .select('id, outlet_name, cost_center');
        if (companyId) empQuery = empQuery.eq('company_id', companyId);

        // Fetch employee_outlet_allocations for per-outlet headcount
        let allocQuery = supabase
          .from('employee_outlet_allocations')
          .select('employee_id, outlet_id, cost_center, allocation_percentage');
        if (companyId) allocQuery = allocQuery.eq('company_id', companyId);

        const [budgetRes, empRes, allocRes] = await Promise.all([budgetQuery, empQuery, allocQuery]);

        if (budgetRes.error) throw budgetRes.error;
        setRawEntries(budgetRes.data || []);

        // Employees may not exist as a table - graceful fallback
        if (!empRes.error && empRes.data) {
          setEmployees(empRes.data);
        }

        // Allocations may not exist
        if (!allocRes.error && allocRes.data) {
          setAllocations(allocRes.data);
        }
      } catch (err) {
        console.error('[Produttivita] fetch error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [year, profile?.company_id]);

  // Compute employee count per outlet from allocations (FTE-weighted) or employees table
  const empCountByOutlet = useMemo(() => {
    const counts = {};

    // Prefer allocations (FTE-weighted)
    if (allocations.length > 0) {
      allocations.forEach(a => {
        const outlet = a.cost_center || 'Sconosciuto';
        const pct = parseFloat(a.allocation_percentage) || 100;
        counts[outlet] = (counts[outlet] || 0) + (pct / 100);
      });
    } else if (employees.length > 0) {
      // Fallback to employee table
      employees.forEach(emp => {
        const outlet = emp.cost_center || emp.outlet_name || 'Sconosciuto';
        counts[outlet] = (counts[outlet] || 0) + 1;
      });
    }
    // If no employee data at all, returns empty - will use fallback of 4

    return counts;
  }, [allocations, employees]);

  // Compute per-outlet productivity metrics from budget_entries
  const outletBaseData = useMemo(() => {
    if (!rawEntries.length) return [];

    const byOutlet = {};
    rawEntries.forEach(row => {
      const outlet = row.cost_center || 'Sconosciuto';
      if (!byOutlet[outlet]) byOutlet[outlet] = { ricavi: 0, costo_personale: 0, costi_totali: 0 };

      const code = (row.account_code || '').toString();
      const amount = parseFloat(row.budget_amount) || 0;

      if (code.startsWith('5')) {
        byOutlet[outlet].ricavi += amount;
      }
      if (code.startsWith('63')) {
        byOutlet[outlet].costo_personale += amount;
      }
      if (code.startsWith('6') || code.startsWith('7')) {
        byOutlet[outlet].costi_totali += amount;
      }
    });

    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444'];

    return Object.entries(byOutlet)
      .map(([nome, vals], idx) => ({
        nome,
        ricavi: vals.ricavi,
        costo_personale: vals.costo_personale,
        costi_totali: vals.costi_totali,
        dipendenti: empCountByOutlet[nome] || null,
        colore: colors[idx % colors.length],
      }))
      .sort((a, b) => b.ricavi - a.ricavi);
  }, [rawEntries, empCountByOutlet]);

  // Monthly trend data for fatturato/dipendente per outlet
  const monthlyTrendData = useMemo(() => {
    if (!rawEntries.length) return [];

    // Group revenue by outlet and month
    const byOutletMonth = {};
    const outletSet = new Set();
    rawEntries.forEach(row => {
      const outlet = row.cost_center || 'Sconosciuto';
      const month = parseInt(row.month) || 0;
      if (month < 1 || month > 12) return;

      const code = (row.account_code || '').toString();
      const amount = parseFloat(row.budget_amount) || 0;

      if (code.startsWith('5')) {
        const key = `${outlet}__${month}`;
        byOutletMonth[key] = (byOutletMonth[key] || 0) + amount;
        outletSet.add(outlet);
      }
    });

    // Build array of { month, outlet1: fatturato/dip, outlet2: ... }
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const row = { mese: MONTHS[m - 1] };
      let hasData = false;
      outletSet.forEach(outlet => {
        const rev = byOutletMonth[`${outlet}__${m}`] || 0;
        const dip = empCountByOutlet[outlet] || 4; // fallback
        if (rev > 0) {
          row[outlet] = Math.round(rev / dip);
          hasData = true;
        }
      });
      if (hasData) months.push(row);
    }
    return months;
  }, [rawEntries, empCountByOutlet]);

  // Calcolo metriche per ogni outlet (with simulation support)
  const metriche = useMemo(() => {
    const base = outletBaseData.map(outlet => {
      const dip = outlet.dipendenti || 4; // fallback if no employee data
      const ore_sett = dip * 40;
      const ore_annuali = ore_sett * 52;
      const ricavo_per_dip = outlet.ricavi / dip;
      const ricavo_per_ora = outlet.ricavi / ore_annuali;
      const costo_per_ora = outlet.costo_personale / ore_annuali;
      const margine_per_ora = ricavo_per_ora - costo_per_ora;
      const roi = outlet.costo_personale > 0 ? outlet.ricavi / outlet.costo_personale : 0;
      const incidenza_personale = outlet.ricavi > 0 ? (outlet.costo_personale / outlet.ricavi) * 100 : 0;

      return {
        nome: outlet.nome,
        dipendenti: dip,
        ricavi: outlet.ricavi,
        costo_personale: outlet.costo_personale,
        ore_sett,
        ore_annuali,
        ricavo_per_dip,
        ricavo_per_ora,
        costo_per_ora,
        margine_per_ora,
        roi,
        incidenza_personale,
        colore: outlet.colore,
        has_employee_data: outlet.dipendenti !== null,
      };
    });

    // Apply simulation if active
    if (simulazioneAttiva && moved.from && moved.to && moved.count > 0) {
      const fromIdx = base.findIndex(m => m.nome === moved.from);
      const toIdx = base.findIndex(m => m.nome === moved.to);

      if (fromIdx >= 0 && toIdx >= 0 && base[fromIdx].dipendenti > moved.count) {
        const newFromDip = base[fromIdx].dipendenti - moved.count;
        const newFromOre = newFromDip * 40 * 52;
        base[fromIdx] = {
          ...base[fromIdx],
          dipendenti: newFromDip,
          ore_sett: newFromDip * 40,
          ore_annuali: newFromOre,
          ricavo_per_dip: base[fromIdx].ricavi / newFromDip,
          ricavo_per_ora: base[fromIdx].ricavi / newFromOre,
          costo_per_ora: base[fromIdx].costo_personale / newFromOre,
        };
        base[fromIdx].margine_per_ora = base[fromIdx].ricavo_per_ora - base[fromIdx].costo_per_ora;
        base[fromIdx].roi = base[fromIdx].costo_personale > 0 ? base[fromIdx].ricavi / base[fromIdx].costo_personale : 0;

        const newToDip = base[toIdx].dipendenti + moved.count;
        const newToOre = newToDip * 40 * 52;
        base[toIdx] = {
          ...base[toIdx],
          dipendenti: newToDip,
          ore_sett: newToDip * 40,
          ore_annuali: newToOre,
          ricavo_per_dip: base[toIdx].ricavi / newToDip,
          ricavo_per_ora: base[toIdx].ricavi / newToOre,
          costo_per_ora: base[toIdx].costo_personale / newToOre,
        };
        base[toIdx].margine_per_ora = base[toIdx].ricavo_per_ora - base[toIdx].costo_per_ora;
        base[toIdx].roi = base[toIdx].costo_personale > 0 ? base[toIdx].ricavi / base[toIdx].costo_personale : 0;
      }
    }

    return base;
  }, [outletBaseData, simulazioneAttiva, moved]);

  // KPI
  const kpi = useMemo(() => {
    if (!metriche.length) return null;
    const best = metriche.reduce((a, b) => a.ricavo_per_ora > b.ricavo_per_ora ? a : b);
    const worst = metriche.reduce((a, b) => a.ricavo_per_ora < b.ricavo_per_ora ? a : b);
    const avg_ricavo_ora = metriche.reduce((sum, m) => sum + m.ricavo_per_ora, 0) / metriche.length;
    const avg_roi = metriche.reduce((sum, m) => sum + m.roi, 0) / metriche.length;
    const totRicavi = metriche.reduce((sum, m) => sum + m.ricavi, 0);
    const totDipendenti = metriche.reduce((sum, m) => sum + m.dipendenti, 0);
    const fatturato_medio_dip = totDipendenti > 0 ? totRicavi / totDipendenti : 0;
    return { best_produttivita: best, worst_produttivita: worst, avg_ricavo_ora, avg_roi, fatturato_medio_dip, totRicavi, totDipendenti };
  }, [metriche]);

  // Ranked table data: per outlet with rank/medal
  const rankedMetriche = useMemo(() => {
    return metriche
      .slice()
      .sort((a, b) => b.ricavo_per_dip - a.ricavo_per_dip)
      .map((m, idx) => ({ ...m, rank: idx + 1 }));
  }, [metriche]);

  // Chart: incidenza personale per outlet
  const incidenzaChart = useMemo(() => {
    return metriche
      .slice()
      .sort((a, b) => a.incidenza_personale - b.incidenza_personale)
      .map(m => ({
        nome: m.nome,
        Ricavi: Math.round(m.ricavi),
        'Costo Personale': Math.round(m.costo_personale),
        'Incidenza %': parseFloat(m.incidenza_personale.toFixed(1)),
      }));
  }, [metriche]);

  // Chart: ricavo vs costo per ora
  const ricavoCostoChart = metriche.map(m => ({
    nome: m.nome,
    'Ricavo/ora': parseFloat(m.ricavo_per_ora.toFixed(2)),
    'Costo/ora': parseFloat(m.costo_per_ora.toFixed(2)),
  }));

  // Outlet names for line chart
  const outletNamesForTrend = useMemo(() => {
    return metriche.map(m => m.nome);
  }, [metriche]);

  // Raccomandazioni
  const raccomandazioni = useMemo(() => {
    if (!metriche.length || !kpi) return [];
    const ottimal_ratio = 1.8;
    const recs = [];

    metriche.forEach(m => {
      const rapporto = m.costo_personale > 0 ? m.ricavi / m.costo_personale : 999;
      if (rapporto < ottimal_ratio) {
        recs.push({
          outlet: m.nome,
          tipo: 'attenzione',
          impact: `Incidenza personale ${m.incidenza_personale.toFixed(1)}% - rapporto ricavi/costo personale: ${rapporto.toFixed(2)}x (target: ${ottimal_ratio}x)`
        });
      }
    });

    recs.push({
      outlet: kpi.best_produttivita.nome,
      tipo: 'mantenere',
      impact: 'Outlet con migliore produttivita per ora: mantenere struttura attuale'
    });

    return recs.slice(0, 4);
  }, [metriche, kpi]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-600">Caricamento dati produttivita...</span>
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

  if (!metriche.length) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Analisi Produttivita</h1>
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center mt-8">
            <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 text-lg">Nessun dato budget trovato per l'anno {year}</p>
          </div>
        </div>
        <PageHelp page="produttivita" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 mb-2">Analisi Produttivita</h1>
            <p className="text-slate-600">Analytics sulla performance dei dipendenti per outlet - Anno {year}</p>
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

        {/* Prominent KPI Card: Fatturato Medio per Dipendente */}
        {kpi && (
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 mb-8 shadow-lg text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium mb-1">Fatturato Medio per Dipendente</p>
                <p className="text-4xl font-bold">{fmt(kpi.fatturato_medio_dip, 0)} &euro;</p>
                <p className="text-blue-200 text-sm mt-2">
                  {fmt(kpi.totRicavi, 0)} &euro; ricavi totali / {fmt(kpi.totDipendenti, 1)} dipendenti (FTE)
                </p>
              </div>
              <div className="bg-white/20 rounded-xl p-4">
                <Users className="w-10 h-10 text-white" />
              </div>
            </div>
          </div>
        )}

        {/* KPI Cards Row */}
        {kpi && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-600 text-sm font-medium">Best Ricavo/ora</span>
                <CheckCircle className="w-4 h-4 text-green-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900">{fmt(kpi.best_produttivita.ricavo_per_ora, 2)}&euro;</div>
              <div className="text-xs text-slate-500 mt-2">{kpi.best_produttivita.nome}</div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-600 text-sm font-medium">Worst Ricavo/ora</span>
                <AlertCircle className="w-4 h-4 text-red-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900">{fmt(kpi.worst_produttivita.ricavo_per_ora, 2)}&euro;</div>
              <div className="text-xs text-slate-500 mt-2">{kpi.worst_produttivita.nome}</div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-600 text-sm font-medium">Media Ricavo/ora</span>
                <TrendingUp className="w-4 h-4 text-blue-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900">{fmt(kpi.avg_ricavo_ora, 2)}&euro;</div>
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
        )}

        {/* Ranking Table: per outlet with medals */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-500" />
            Classifica Produttivita per Outlet
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-center text-slate-700 font-semibold w-16">Rank</th>
                  <th className="px-4 py-3 text-left text-slate-700 font-semibold">Outlet</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Fatturato</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">N. Dipendenti</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Fatturato/Dipendente</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Incidenza %</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">ROI</th>
                </tr>
              </thead>
              <tbody>
                {rankedMetriche.map((m) => {
                  const medal = m.rank <= 3 ? MEDAL[m.rank] : '';
                  const rowBg = m.rank === 1 ? 'bg-amber-50' : m.rank === 2 ? 'bg-slate-50' : m.rank === 3 ? 'bg-orange-50' : '';
                  return (
                    <tr key={m.nome} className={`border-b border-slate-100 ${rowBg}`}>
                      <td className="px-4 py-3 text-center text-lg">
                        {medal || <span className="text-slate-400 text-sm">{m.rank}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-900 font-medium">{m.nome}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{fmt(m.ricavi, 0)} &euro;</td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {fmt(m.dipendenti, m.has_employee_data ? 1 : 0)}
                        {!m.has_employee_data && <span className="text-xs text-slate-400 ml-1">(stima)</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(m.ricavo_per_dip, 0)} &euro;</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                          m.incidenza_personale < 20 ? 'bg-green-100 text-green-800' :
                          m.incidenza_personale < 35 ? 'bg-amber-100 text-amber-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {m.incidenza_personale.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(m.roi, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly Trend LineChart: fatturato/dipendente per outlet */}
        {monthlyTrendData.length > 0 && (
          <div className="rounded-2xl p-6 shadow-lg mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Trend Mensile Fatturato/Dipendente</h2>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={monthlyTrendData}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="mese" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip content={<GlassTooltip formatter={(value) => fmt(value, 0) + ' \u20ac'} />} />
                <Legend />
                {outletNamesForTrend.map((name, idx) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={PALETTE[idx % PALETTE.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                    animationDuration={800}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Incidenza Personale */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Ricavi vs Costo Personale</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={incidenzaChart}>
                <defs>
                  <linearGradient id="grad-ricavi-prod" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="grad-personale-prod" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="nome" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip content={<GlassTooltip formatter={(value) => fmt(value, 0) + ' \u20ac'} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Legend />
                <Bar dataKey="Ricavi" fill="url(#grad-ricavi-prod)" radius={[8, 8, 0, 0]} animationDuration={800} />
                <Bar dataKey="Costo Personale" fill="url(#grad-personale-prod)" radius={[8, 8, 0, 0]} animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Ricavo vs Costo per Ora */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Ricavo vs Costo per Ora Lavoro</h2>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={ricavoCostoChart}>
                <defs>
                  <linearGradient id="grad-ricavo-ora-p" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="grad-costo-ora-p" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="nome" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => fmt(value, 2) + ' \u20ac'} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Legend />
                <Bar dataKey="Ricavo/ora" fill="url(#grad-ricavo-ora-p)" radius={[8, 8, 0, 0]} animationDuration={800} />
                <Bar dataKey="Costo/ora" fill="url(#grad-costo-ora-p)" radius={[8, 8, 0, 0]} animationDuration={800} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Full Metrics Table */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Confronto Metriche Completo</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left text-slate-700 font-semibold">Outlet</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Ricavi</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Costo Personale</th>
                  <th className="px-4 py-3 text-right text-slate-700 font-semibold">Incidenza %</th>
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
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(m.ricavi, 0)} &euro;</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(m.costo_personale, 0)} &euro;</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                            m.incidenza_personale < 20 ? 'bg-green-100 text-green-800' :
                            m.incidenza_personale < 35 ? 'bg-amber-100 text-amber-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {m.incidenza_personale.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(m.ricavo_per_ora, 2)} &euro;</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(m.costo_per_ora, 2)} &euro;</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmt(m.margine_per_ora, 2)} &euro;</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmt(m.roi, 2)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Simulator */}
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
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recommendations */}
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
                      {rec.impact}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <PageHelp page="produttivita" />
    </div>
  );
}
