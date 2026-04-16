import { useState, useMemo, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { AlertTriangle, TrendingDown, TrendingUp, Wallet, CheckCircle, Clock } from 'lucide-react';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE, BAR_RADIUS, ModernLegend, fmtEuro, fmtK } from '../components/ChartTheme';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

// Formatting utility
function fmt(n, dec = 0) {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  }).format(n);
}

// Default seasonal factors (fallback if no historical data)
const DEFAULT_SEASONAL_FACTORS = {
  1: 1.05, 2: 0.95, 3: 0.95, 4: 0.9, 5: 0.9, 6: 0.95,
  7: 1.15, 8: 1.15, 9: 0.95, 10: 1.0, 11: 1.05, 12: 1.3
};

export default function CashFlow() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [scenario, setScenario] = useState('base'); // 'base', 'pessimistic', 'optimistic'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // State for fetched data
  const [initialBalance, setInitialBalance] = useState(0);
  const [annualSales, setAnnualSales] = useState(2324000); // Default fallback
  const [fixedCosts, setFixedCosts] = useState({});
  const [loanPayment, setLoanPayment] = useState(0);
  const [seasonalFactors, setSeasonalFactors] = useState(DEFAULT_SEASONAL_FACTORS);

  // State for actual (consuntivo) weekly data from cash_movements
  const [actualWeeklyData, setActualWeeklyData] = useState([]);

  // Fetch data from Supabase
  useEffect(() => {
    if (!COMPANY_ID) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. Fetch initial cash position from v_cash_position
        const { data: cashData, error: cashError } = await supabase
          .from('v_cash_position')
          .select('current_balance')
          .eq('company_id', COMPANY_ID);

        if (cashError) throw cashError;

        const totalBalance = (cashData || []).reduce((sum, acc) => sum + (acc.current_balance || 0), 0);
        setInitialBalance(totalBalance);

        // 2. Fetch annual budget for current year
        const currentYear = new Date().getFullYear();
        const { data: budgetData, error: budgetError } = await supabase
          .from('annual_budgets')
          .select('revenue_target')
          .eq('company_id', COMPANY_ID)
          .eq('year', currentYear)
          .single();

        if (budgetError && budgetError.code !== 'PGRST116') throw budgetError;
        if (budgetData?.revenue_target) {
          setAnnualSales(budgetData.revenue_target);
        }

        // 3. Fetch fixed costs from cost_categories (is_fixed=true)
        const { data: costsData, error: costsError } = await supabase
          .from('cost_categories')
          .select('code, macro_group')
          .eq('company_id', COMPANY_ID)
          .eq('is_fixed', true)
          .eq('is_active', true);

        if (costsError) throw costsError;

        // Build fixed costs dictionary by macro_group
        const costsByGroup = {};
        (costsData || []).forEach(cat => {
          if (!costsByGroup[cat.macro_group]) {
            costsByGroup[cat.macro_group] = 0;
          }
        });
        setFixedCosts(costsByGroup);

        // 4. Fetch loan details from v_loans_overview
        const { data: loansData, error: loansError } = await supabase
          .from('v_loans_overview')
          .select('total_amount, interest_rate')
          .eq('company_id', COMPANY_ID);

        if (loansError) throw loansError;

        // Estimate quarterly payment: assume 5-year amortization, quarterly payments
        const totalLoanAmount = (loansData || []).reduce((sum, loan) => sum + (loan.total_amount || 0), 0);
        const estimatedQuarterlyPayment = totalLoanAmount > 0 ? totalLoanAmount / 20 : 0;
        setLoanPayment(estimatedQuarterlyPayment);

        // 5. Fetch historical monthly revenue to derive seasonal factors
        const lastYear = currentYear - 1;
        const { data: pnlData, error: pnlError } = await supabase
          .from('v_pnl_monthly')
          .select('month, revenue')
          .eq('company_id', COMPANY_ID)
          .eq('year', lastYear);

        if (pnlError) throw pnlError;

        // Calculate seasonal factors from historical data
        if (pnlData && pnlData.length > 0) {
          const monthlyRevenue = {};
          const monthlySum = {};

          (pnlData || []).forEach(row => {
            if (!monthlySum[row.month]) {
              monthlySum[row.month] = 0;
            }
            monthlySum[row.month] += row.revenue || 0;
          });

          // Calculate average per month and derive seasonal factor
          const monthlyAverage = Object.values(monthlySum).reduce((a, b) => a + b, 0) / 12;
          const newSeasonalFactors = {};

          Object.entries(monthlySum).forEach(([month, total]) => {
            newSeasonalFactors[month] = monthlyAverage > 0 ? total / monthlyAverage : 1;
          });

          // Fill missing months with default
          for (let m = 1; m <= 12; m++) {
            if (!newSeasonalFactors[m]) {
              newSeasonalFactors[m] = DEFAULT_SEASONAL_FACTORS[m] || 1;
            }
          }

          setSeasonalFactors(newSeasonalFactors);
        }

        // 6. Fetch actual weekly data from cash_movements (last 13 weeks)
        const { data: actualData, error: actualError } = await supabase
          .rpc('get_weekly_cash_movements', { p_company_id: COMPANY_ID })
          .select('*');

        // If RPC doesn't exist, fall back to direct query
        if (actualError) {
          // Try direct query on cash_movements
          const { data: rawMovements, error: rawError } = await supabase
            .from('cash_movements')
            .select('date, type, amount')
            .eq('company_id', COMPANY_ID)
            .gte('date', new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
            .order('date', { ascending: true });

          if (!rawError && rawMovements && rawMovements.length > 0) {
            // Group by ISO week manually
            const weekMap = {};
            rawMovements.forEach(m => {
              const d = new Date(m.date);
              // Get Monday of the week
              const day = d.getDay();
              const diff = d.getDate() - day + (day === 0 ? -6 : 1);
              const monday = new Date(d);
              monday.setDate(diff);
              const weekKey = monday.toISOString().slice(0, 10);

              if (!weekMap[weekKey]) {
                weekMap[weekKey] = { week: weekKey, entrate: 0, uscite: 0, netto: 0 };
              }
              if (m.type === 'entrata') {
                weekMap[weekKey].entrate += Math.abs(m.amount || 0);
              } else {
                weekMap[weekKey].uscite += Math.abs(m.amount || 0);
              }
            });

            // Calculate netto
            Object.values(weekMap).forEach(w => {
              w.netto = w.entrate - w.uscite;
            });

            const sorted = Object.values(weekMap).sort((a, b) => a.week.localeCompare(b.week));
            setActualWeeklyData(sorted);
          } else {
            setActualWeeklyData([]);
          }
        } else if (actualData && actualData.length > 0) {
          setActualWeeklyData(actualData);
        } else {
          setActualWeeklyData([]);
        }

        setLoading(false);
      } catch (err) {
        console.error('Error fetching CashFlow data:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchData();
  }, [COMPANY_ID]);

  // Generate 13-week forecast from April 2026
  const weeklyData = useMemo(() => {
    if (loading || !COMPANY_ID) return [];

    const data = [];
    let saldo_precedente = initialBalance;
    const WEEKLY_BASE = annualSales / 52;

    // April 2026 starts on week 1 (Thursday)
    const startDate = new Date(2026, 3, 1); // April 1, 2026

    for (let week = 0; week < 13; week++) {
      const week_start = new Date(startDate);
      week_start.setDate(startDate.getDate() + week * 7);

      const month = week_start.getMonth() + 1;

      // Seasonal sales adjustment
      const seasonalFactor = seasonalFactors[month] || 1.0;
      let sales = WEEKLY_BASE * seasonalFactor;

      // Apply scenario multiplier
      if (scenario === 'pessimistic') sales *= 0.8;
      if (scenario === 'optimistic') sales *= 1.1;

      // Fixed weekly costs (monthly total / 4.33)
      const monthlyFixedTotal = Object.values(fixedCosts).reduce((a, b) => a + b, 0);
      const weekly_fixed = monthlyFixedTotal / 4.33;

      // Quarterly loan payment (every 13 weeks, distributed or lump)
      // Week 13 is end of Q2
      const loan_payment = (week === 12) ? loanPayment : 0;

      // Variable costs (estimated at ~25% of sales for inventory, supplies)
      const variable_costs = sales * 0.25;

      const total_outflows = weekly_fixed + loan_payment + variable_costs;
      const saldo_finale = saldo_precedente + sales - total_outflows;

      data.push({
        week: week + 1,
        month,
        weekStart: week_start.toLocaleDateString('it-IT', { month: 'short', day: 'numeric' }),
        saldo_iniziale: Math.round(saldo_precedente),
        entrate_previste: Math.round(sales),
        uscite_fisse: Math.round(weekly_fixed),
        uscite_variabili: Math.round(variable_costs),
        uscite_mutuo: loan_payment,
        uscite_totali: Math.round(total_outflows),
        saldo_finale: Math.round(saldo_finale),
        warning: saldo_finale < 50000
      });

      saldo_precedente = saldo_finale;
    }

    return data;
  }, [scenario, loading, COMPANY_ID, initialBalance, annualSales, fixedCosts, loanPayment, seasonalFactors]);

  // Calculate KPIs
  const kpis = useMemo(() => {
    const balances = weeklyData.map(w => w.saldo_finale);
    const min_balance = Math.min(...balances);
    const min_week = weeklyData.find(w => w.saldo_finale === min_balance);

    const monthly_burn = weeklyData.reduce((sum, w) => sum + (w.uscite_totali - w.entrate_previste), 0) / 13 * 4.33;

    return {
      current_balance: weeklyData[0].saldo_iniziale,
      min_balance,
      critical_week: min_week?.week || 0,
      monthly_burn: Math.abs(monthly_burn)
    };
  }, [weeklyData]);

  // Monthly summary
  const monthlySummary = useMemo(() => {
    const summary = {};
    weeklyData.forEach(week => {
      if (!summary[week.month]) {
        summary[week.month] = {
          month: week.month,
          entrate: 0,
          uscite: 0,
          saldo_finale: 0
        };
      }
      summary[week.month].entrate += week.entrate_previste;
      summary[week.month].uscite += week.uscite_totali;
    });

    // Calculate ending balance per month
    let saldo = initialBalance;
    Object.keys(summary).forEach(month => {
      saldo = saldo + summary[month].entrate - summary[month].uscite;
      summary[month].saldo_finale = saldo;
    });

    return Object.values(summary);
  }, [weeklyData, initialBalance]);

  // Combine actual (consuntivo) + forecast data for the unified chart
  const combinedChartData = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    // Format actual weeks
    const actualFormatted = actualWeeklyData.map((w, idx) => {
      const weekDate = new Date(w.week);
      return {
        label: weekDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }),
        tipo: 'Consuntivo',
        entrate_reali: Math.round(w.entrate),
        uscite_reali: Math.round(w.uscite),
        netto_reale: Math.round(w.netto),
        entrate_previste: null,
        uscite_previste: null,
        saldo_finale: null,
        sortKey: w.week
      };
    });

    // Format forecast weeks
    const forecastFormatted = weeklyData.map(w => ({
      label: w.weekStart,
      tipo: 'Previsione',
      entrate_reali: null,
      uscite_reali: null,
      netto_reale: null,
      entrate_previste: w.entrate_previste,
      uscite_previste: w.uscite_totali,
      saldo_finale: w.saldo_finale,
      sortKey: `2026-${String(w.month).padStart(2, '0')}-${String(w.week).padStart(2, '0')}`
    }));

    return [...actualFormatted, ...forecastFormatted];
  }, [actualWeeklyData, weeklyData]);

  const hasWarnings = weeklyData.some(w => w.warning);

  if (!COMPANY_ID) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="rounded-2xl shadow-lg p-8 text-center">
          <p className="text-slate-600">Please log in to view Cash Flow data.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="rounded-2xl shadow-lg p-8">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="text-slate-600">Loading cash flow data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="rounded-2xl shadow-lg p-8 bg-red-50 border border-red-200">
          <p className="text-red-900 font-semibold mb-2">Error loading data:</p>
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Cash Flow Forecast</h1>
          <p className="text-slate-600">Previsione di liquidità rolling 13 settimane (Aprile-Giugno 2026)</p>
          <p className="text-xs text-slate-500 mt-1">
            Ricavi annui: {fmt(annualSales)} | Saldo iniziale: {fmt(initialBalance)}
          </p>
        </div>

        {/* Alert Banner */}
        {hasWarnings && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="text-red-600 flex-shrink-0 mt-1" size={20} />
            <div>
              <p className="text-red-900 font-semibold">Attenzione: Saldo critico previsto</p>
              <p className="text-red-800 text-sm">Il saldo scenderà sotto i 50.000€ in almeno una settimana. Pianificare finanziamenti.</p>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="rounded-2xl shadow-lg p-5" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-600 text-sm font-medium">Saldo Attuale</p>
              <Wallet className="text-blue-600" size={20} />
            </div>
            <p className="text-2xl font-bold text-slate-900">{fmt(kpis.current_balance)}</p>
            <p className="text-xs text-slate-500 mt-1">€ (banche + casse)</p>
          </div>

          <div className="rounded-2xl shadow-lg p-5" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-600 text-sm font-medium">Saldo Minimo (13W)</p>
              <TrendingDown className={kpis.min_balance < 50000 ? 'text-red-600' : 'text-amber-600'} size={20} />
            </div>
            <p className={`text-2xl font-bold ${kpis.min_balance < 50000 ? 'text-red-600' : 'text-amber-600'}`}>
              {fmt(kpis.min_balance)}
            </p>
            <p className="text-xs text-slate-500 mt-1">Settimana {kpis.critical_week}</p>
          </div>

          <div className="rounded-2xl shadow-lg p-5" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-600 text-sm font-medium">Burn Rate Mensile</p>
              <TrendingUp className="text-red-600" size={20} />
            </div>
            <p className="text-2xl font-bold text-slate-900">{fmt(kpis.monthly_burn)}</p>
            <p className="text-xs text-slate-500 mt-1">€/mese (costi netti)</p>
          </div>

          <div className="rounded-2xl shadow-lg p-5" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-600 text-sm font-medium">Scenario Attivo</p>
            </div>
            <p className="text-2xl font-bold text-slate-900 capitalize">
              {scenario === 'base' ? 'Base' : scenario === 'pessimistic' ? 'Pessimistico' : 'Ottimistico'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {scenario === 'base' && 'Ricavi normali'}
              {scenario === 'pessimistic' && 'Ricavi -20%'}
              {scenario === 'optimistic' && 'Ricavi +10%'}
            </p>
          </div>
        </div>

        {/* Scenario Selector */}
        <div className="rounded-2xl shadow-lg p-5 mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <p className="text-slate-600 text-sm font-medium mb-3">Seleziona Scenario</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setScenario('base')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                scenario === 'base'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Base
            </button>
            <button
              onClick={() => setScenario('pessimistic')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                scenario === 'pessimistic'
                  ? 'bg-red-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Pessimistico (Ricavi -20%)
            </button>
            <button
              onClick={() => setScenario('optimistic')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                scenario === 'optimistic'
                  ? 'bg-green-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Ottimistico (Ricavi +10%)
            </button>
          </div>
        </div>

        {/* Area Chart - Balance Trend */}
        <div className="rounded-2xl shadow-lg p-6 mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Saldo Previsto (settimana/settimana)</h2>
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={weeklyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis
                dataKey="week"
                label={{ value: 'Settimana', position: 'insideBottomRight', offset: -5 }}
                {...AXIS_STYLE}
              />
              <YAxis
                label={{ value: '€', angle: -90, position: 'insideLeft' }}
                {...AXIS_STYLE}
              />
              <Tooltip content={<GlassTooltip formatter={fmtEuro} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
              <Area
                type="monotone"
                dataKey="saldo_finale"
                stroke="#6366f1"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#colorBalance)"
              />
              {/* Red reference line at 50k */}
              <line x1="0" y1="50000" x2="100%" y2="50000" stroke="#f43f5e" strokeDasharray="5 5" />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-500 text-center mt-2">Linea rossa: soglia critica 50.000€</p>
        </div>

        {/* Stacked Bar Chart - Inflows vs Outflows */}
        <div className="rounded-2xl shadow-lg p-6 mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Entrate vs Uscite (per settimana)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={weeklyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-entrate" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                </linearGradient>
                <linearGradient id="grad-uscite" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis
                dataKey="week"
                label={{ value: 'Settimana', position: 'insideBottomRight', offset: -5 }}
                {...AXIS_STYLE}
              />
              <YAxis
                label={{ value: '€', angle: -90, position: 'insideLeft' }}
                {...AXIS_STYLE}
              />
              <Tooltip content={<GlassTooltip formatter={fmtEuro} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
              <Legend content={<ModernLegend />} />
              <Bar dataKey="entrate_previste" stackId="stack" fill="url(#grad-entrate)" name="Entrate" radius={[8, 8, 0, 0]} animationDuration={800} />
              <Bar dataKey="uscite_totali" stackId="stack" fill="url(#grad-uscite)" name="Uscite" radius={[8, 8, 0, 0]} animationDuration={800} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Combined Consuntivo + Previsione Chart */}
        {actualWeeklyData.length > 0 && (
          <div className="rounded-2xl shadow-lg p-6 mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Consuntivo vs Previsione</h2>
            <p className="text-sm text-slate-500 mb-4">Dati reali (ultime 13 settimane) e previsioni a confronto</p>
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={combinedChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-entrate-reali" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#059669" stopOpacity={1} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="grad-uscite-reali" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity={1} />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="grad-entrate-prev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.2} />
                  </linearGradient>
                  <linearGradient id="grad-uscite-prev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="label" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={fmtEuro} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Legend content={<ModernLegend />} />
                <Bar dataKey="entrate_reali" fill="url(#grad-entrate-reali)" name="Entrate Reali" radius={[6, 6, 0, 0]} animationDuration={800} />
                <Bar dataKey="uscite_reali" fill="url(#grad-uscite-reali)" name="Uscite Reali" radius={[6, 6, 0, 0]} animationDuration={800} />
                <Bar dataKey="entrate_previste" fill="url(#grad-entrate-prev)" name="Entrate Previste" radius={[6, 6, 0, 0]} animationDuration={800} />
                <Bar dataKey="uscite_previste" fill="url(#grad-uscite-prev)" name="Uscite Previste" radius={[6, 6, 0, 0]} animationDuration={800} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-6 justify-center mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><CheckCircle size={14} className="text-emerald-700" /> Consuntivo (dati reali)</span>
              <span className="flex items-center gap-1"><Clock size={14} className="text-emerald-400" /> Previsione (stima)</span>
            </div>
          </div>
        )}

        {/* Consuntivo Table - Actual Past Weeks */}
        {actualWeeklyData.length > 0 && (
          <div className="rounded-2xl shadow-lg p-6 mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="text-emerald-600" size={20} />
              <h2 className="text-lg font-semibold text-slate-900">Consuntivo Settimanale (Dati Reali)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-emerald-50">
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Settimana</th>
                    <th className="px-4 py-3 text-right font-semibold text-green-700">Entrate</th>
                    <th className="px-4 py-3 text-right font-semibold text-red-700">Uscite</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Flusso Netto</th>
                  </tr>
                </thead>
                <tbody>
                  {actualWeeklyData.map((week, idx) => {
                    const weekDate = new Date(week.week);
                    return (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {weekDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3 text-right text-green-600 font-medium">
                          {fmt(Math.round(week.entrate))}
                        </td>
                        <td className="px-4 py-3 text-right text-red-600 font-medium">
                          {fmt(Math.round(week.uscite))}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${week.netto >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmt(Math.round(week.netto))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td className="px-4 py-3 font-bold text-slate-900">Totale</td>
                    <td className="px-4 py-3 text-right text-green-600 font-bold">
                      {fmt(actualWeeklyData.reduce((s, w) => s + w.entrate, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600 font-bold">
                      {fmt(actualWeeklyData.reduce((s, w) => s + w.uscite, 0))}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${
                      actualWeeklyData.reduce((s, w) => s + w.netto, 0) >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {fmt(actualWeeklyData.reduce((s, w) => s + w.netto, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Weekly Detail Table */}
        <div className="rounded-2xl shadow-lg p-6 mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="text-blue-600" size={20} />
            <h2 className="text-lg font-semibold text-slate-900">Previsione Settimanale</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">W</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Periodo</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Saldo Iniz.</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Entrate</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Uscite Fisse</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Uscite Var.</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Mutuo</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Saldo Finale</th>
                </tr>
              </thead>
              <tbody>
                {weeklyData.map((week, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${
                      week.warning ? 'bg-red-50' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">{week.week}</td>
                    <td className="px-4 py-3 text-slate-600">{week.weekStart}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(week.saldo_iniziale)}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-medium">{fmt(week.entrate_previste)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(week.uscite_fisse)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(week.uscite_variabili)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(week.uscite_mutuo)}</td>
                    <td
                      className={`px-4 py-3 text-right font-bold ${
                        week.warning ? 'text-red-600' : 'text-slate-900'
                      }`}
                    >
                      {fmt(week.saldo_finale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly Summary */}
        <div className="rounded-2xl shadow-lg p-6" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Riepilogo Mensile</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Mese</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Entrate</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Uscite</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Risultato</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Saldo Finale</th>
                </tr>
              </thead>
              <tbody>
                {monthlySummary.map((month, idx) => {
                  const risultato = month.entrate - month.uscite;
                  return (
                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {new Date(2026, month.month - 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 text-right text-green-600 font-medium">{fmt(month.entrate)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{fmt(month.uscite)}</td>
                      <td
                        className={`px-4 py-3 text-right font-bold ${
                          risultato >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {fmt(risultato)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{fmt(month.saldo_finale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
