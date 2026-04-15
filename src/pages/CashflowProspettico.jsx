import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Download,
  Filter,
  Calendar,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';

const MONTH_LABELS = [
  'Gen',
  'Feb',
  'Mar',
  'Apr',
  'Mag',
  'Giu',
  'Lug',
  'Ago',
  'Set',
  'Ott',
  'Nov',
  'Dic',
];

const fmt = (n) =>
  new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(n)) + ' €';

export default function CashflowProspettico() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [year, setYear] = useState(2026);
  const [selectedOutlet, setSelectedOutlet] = useState('tutti');
  const [scenario, setScenario] = useState('base');
  const [costCenters, setCostCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Raw data from DB
  const [initialBalance, setInitialBalance] = useState(0);
  const [recurringCosts, setRecurringCosts] = useState([]);
  const [payables, setPayables] = useState([]);
  const [budgetEntries, setBudgetEntries] = useState([]);
  const [budgetConfronti, setBudgetConfronti] = useState([]);
  const [loans, setLoans] = useState([]);
  const [balanceSheetData, setBalanceSheetData] = useState([]);

  // Load cost centers (outlets)
  useEffect(() => {
    if (!COMPANY_ID) return;

    const loadCostCenters = async () => {
      try {
        const { data, error: err } = await supabase
          .from('cost_centers')
          .select('*')
          .eq('company_id', COMPANY_ID);

        if (err) throw err;
        setCostCenters(data || []);
      } catch (e) {
        console.error('Error loading cost centers:', e);
      }
    };

    loadCostCenters();
  }, [COMPANY_ID]);

  // Load all cashflow data
  useEffect(() => {
    if (!COMPANY_ID) return;

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. Load initial bank balance
        const { data: bankData, error: bankErr } = await supabase
          .from('v_cash_position')
          .select('current_balance')
          .eq('company_id', COMPANY_ID)
          .single();

        if (bankErr && bankErr.code !== 'PGRST116')
          console.error('Error loading bank balance:', bankErr);
        setInitialBalance(bankData?.current_balance || 0);

        // 2. Load recurring costs
        const { data: costsData, error: costsErr } = await supabase
          .from('recurring_costs')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('is_active', true);

        if (costsErr) throw costsErr;
        setRecurringCosts(costsData || []);

        // 3. Load payables
        const { data: payablesData, error: payablesErr } = await supabase
          .from('v_payables_operative')
          .select('*')
          .eq('company_id', COMPANY_ID);

        if (payablesErr) throw payablesErr;
        setPayables(payablesData || []);

        // 4. Load budget entries
        const { data: budgetData, error: budgetErr } = await supabase
          .from('budget_entries')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('year', year);

        if (budgetErr) throw budgetErr;
        setBudgetEntries(budgetData || []);

        // 5. Load budget_confronto (monthly budgets)
        const { data: confrontiData, error: confrontiErr } = await supabase
          .from('budget_confronto')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('year', year);

        if (confrontiErr) throw confrontiErr;
        setBudgetConfronti(confrontiData || []);

        // 6. Load loans
        const { data: loansData, error: loansErr } = await supabase
          .from('loans')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('is_active', true);

        if (loansErr) throw loansErr;
        setLoans(loansData || []);

        // 7. Load balance sheet data (for past months comparison)
        const { data: balanceData, error: balanceErr } = await supabase
          .from('balance_sheet_data')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('year', year);

        if (balanceErr) throw balanceErr;
        setBalanceSheetData(balanceData || []);
      } catch (e) {
        console.error('Error loading cashflow data:', e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [COMPANY_ID, year]);

  // Calculate monthly cashflow
  const monthlyData = useMemo(() => {
    if (!COMPANY_ID) return [];

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      label: MONTH_LABELS[i],
      inflows_sdi: 0,
      inflows_budget: 0,
      outflows_sdi: 0,
      outflows_recurring: 0,
      outflows_loans: 0,
    }));

    // Apply outlet filter
    const filteredCC =
      selectedOutlet === 'tutti'
        ? costCenters.map((cc) => cc.code)
        : [selectedOutlet];

    // 1. Add SDI inflows (from payables - use actual received as revenue proxy)
    // For now, we'll use budget data for projected inflows
    budgetConfronti.forEach((entry) => {
      if (
        entry.entry_type === 'rev_monthly' &&
        filteredCC.includes(entry.cost_center)
      ) {
        const monthIdx = entry.month - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
          let amount = entry.amount || 0;
          if (scenario === 'ottimistico') amount *= 1.1;
          if (scenario === 'pessimistico') amount *= 0.9;
          months[monthIdx].inflows_budget += amount;
        }
      }
    });

    // Fallback: if no monthly budget data, use annual budget / 12
    budgetEntries.forEach((entry) => {
      if (
        entry.account_code?.startsWith('4') &&
        filteredCC.includes(entry.cost_center)
      ) {
        // Revenue accounts typically start with 4
        let monthlyAmount = (entry.amount || 0) / 12;
        if (scenario === 'ottimistico') monthlyAmount *= 1.1;
        if (scenario === 'pessimistico') monthlyAmount *= 0.9;

        // Only add if not already added from confronto
        months.forEach((m) => {
          m.inflows_budget += monthlyAmount;
        });
      }
    });

    // 2. Add SDI payables outflows
    payables.forEach((payable) => {
      if (!filteredCC.includes(payable.cost_center_code)) return;

      const statuses = [
        'da_pagare',
        'in_scadenza',
        'scaduto',
        'parziale',
        'rimandato',
      ];
      if (!statuses.includes(payable.status)) return;

      const dueDate = new Date(payable.due_date);
      const dueMonth = dueDate.getMonth(); // 0-11
      const dueYear = dueDate.getFullYear();

      if (dueYear === year && dueMonth >= 0 && dueMonth < 12) {
        const remainingAmount =
          (payable.amount_total || 0) - (payable.amount_paid || 0);
        months[dueMonth].outflows_sdi += remainingAmount;
      }
    });

    // 3. Add recurring costs
    recurringCosts.forEach((cost) => {
      if (!filteredCC.includes(cost.cost_center)) return;

      const monthStart = cost.month_start || 1;
      const frequency = cost.frequency || 'monthly';
      const amount = cost.amount || 0;

      for (let monthNum = 1; monthNum <= 12; monthNum++) {
        let shouldInclude = false;

        if (frequency === 'monthly') {
          shouldInclude = true;
        } else if (frequency === 'bimonthly') {
          shouldInclude = (monthNum - monthStart) % 2 === 0 && monthNum >= monthStart;
        } else if (frequency === 'quarterly') {
          shouldInclude = (monthNum - monthStart) % 3 === 0 && monthNum >= monthStart;
        } else if (frequency === 'semiannual') {
          shouldInclude = (monthNum - monthStart) % 6 === 0 && monthNum >= monthStart;
        } else if (frequency === 'annual') {
          shouldInclude = monthNum === monthStart;
        }

        if (shouldInclude) {
          months[monthNum - 1].outflows_recurring += amount;
        }
      }
    });

    // 4. Add loan payments
    loans.forEach((loan) => {
      if (!filteredCC.includes(loan.cost_center)) return;

      const monthlyPayment = loan.monthly_payment || 0;
      for (let monthNum = 1; monthNum <= 12; monthNum++) {
        months[monthNum - 1].outflows_loans += monthlyPayment;
      }
    });

    // 5. Calculate totals and running balance
    let balance = initialBalance;
    const chartData = months.map((m) => {
      const totalInflows = m.inflows_sdi + m.inflows_budget;
      const totalOutflows =
        m.outflows_sdi + m.outflows_recurring + m.outflows_loans;
      const netFlow = totalInflows - totalOutflows;
      balance += netFlow;

      return {
        month: m.month,
        label: m.label,
        inflows: totalInflows,
        outflows: totalOutflows,
        balance_running: balance,
        inflows_sdi: m.inflows_sdi,
        inflows_budget: m.inflows_budget,
        outflows_sdi: m.outflows_sdi,
        outflows_recurring: m.outflows_recurring,
        outflows_loans: m.outflows_loans,
        net_flow: netFlow,
      };
    });

    return chartData;
  }, [
    COMPANY_ID,
    year,
    selectedOutlet,
    scenario,
    costCenters,
    budgetConfronti,
    budgetEntries,
    payables,
    recurringCosts,
    loans,
    initialBalance,
  ]);

  // Calculate KPIs
  const kpis = useMemo(() => {
    if (monthlyData.length === 0) {
      return {
        initialBalance: 0,
        totalInflows: 0,
        totalOutflows: 0,
        finalBalance: 0,
        hasNegativeMonth: false,
      };
    }

    const totalInflows = monthlyData.reduce((sum, m) => sum + m.inflows, 0);
    const totalOutflows = monthlyData.reduce((sum, m) => sum + m.outflows, 0);
    const finalBalance = monthlyData[monthlyData.length - 1].balance_running;
    const hasNegativeMonth = monthlyData.some((m) => m.balance_running < 0);

    return {
      initialBalance,
      totalInflows,
      totalOutflows,
      finalBalance,
      hasNegativeMonth,
    };
  }, [monthlyData, initialBalance]);

  // Handle export to CSV
  const handleExport = useCallback(() => {
    if (monthlyData.length === 0) return;

    const headers = [
      'Mese',
      'Entrate SDI',
      'Entrate Budget',
      'Tot Entrate',
      'Uscite SDI',
      'Costi Ricorrenti',
      'Rate Finanziamenti',
      'Tot Uscite',
      'Flusso Netto',
      'Saldo Progressivo',
    ];

    const rows = monthlyData.map((m) => [
      m.label,
      m.inflows_sdi.toFixed(2),
      m.inflows_budget.toFixed(2),
      m.inflows.toFixed(2),
      m.outflows_sdi.toFixed(2),
      m.outflows_recurring.toFixed(2),
      m.outflows_loans.toFixed(2),
      m.outflows.toFixed(2),
      m.net_flow.toFixed(2),
      m.balance_running.toFixed(2),
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n');

    navigator.clipboard.writeText(csv).then(() => {
      alert('Dati copiati negli appunti!');
    });
  }, [monthlyData]);

  if (!COMPANY_ID) {
    return (
      <div className="p-6 bg-white rounded-xl shadow-sm">
        <p className="text-slate-600">Caricamento in corso...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-xl shadow-sm">
        <p className="text-slate-600">Caricamento dati cashflow...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 rounded-xl shadow-sm border border-red-200">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-900 font-medium">Errore nel caricamento</p>
            <p className="text-red-700 text-sm mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-100 p-3 rounded-xl">
            <Wallet className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Cashflow Prospettico
            </h1>
            <p className="text-sm text-slate-600">
              Previsione flussi di cassa a 12 mesi
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-slate-600" />
          <input
            type="number"
            min="2020"
            max="2099"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-600 uppercase">
                Saldo Iniziale
              </p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {fmt(kpis.initialBalance)}
              </p>
            </div>
            <div className="bg-blue-100 p-2 rounded-lg">
              <Wallet className="w-5 h-5 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-600 uppercase">
                Entrate Stimate
              </p>
              <p className="text-2xl font-bold text-green-600 mt-1">
                {fmt(kpis.totalInflows)}
              </p>
            </div>
            <div className="bg-green-100 p-2 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-600 uppercase">
                Uscite Stimate
              </p>
              <p className="text-2xl font-bold text-red-600 mt-1">
                {fmt(kpis.totalOutflows)}
              </p>
            </div>
            <div className="bg-red-100 p-2 rounded-lg">
              <TrendingDown className="w-5 h-5 text-red-600" />
            </div>
          </div>
        </div>

        <div
          className={`p-4 rounded-xl shadow-sm border ${
            kpis.hasNegativeMonth
              ? 'bg-red-50 border-red-200'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-600 uppercase">
                Saldo Finale
              </p>
              <p
                className={`text-2xl font-bold mt-1 ${
                  kpis.finalBalance >= 0
                    ? 'text-slate-900'
                    : 'text-red-600'
                }`}
              >
                {fmt(kpis.finalBalance)}
              </p>
            </div>
            {kpis.hasNegativeMonth && (
              <div className="bg-red-100 p-2 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
            )}
          </div>
          {kpis.hasNegativeMonth && (
            <p className="text-xs text-red-700 mt-2">
              ⚠️ Almeno un mese è in negativo
            </p>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-600" />
          <label className="text-sm font-medium text-slate-700">Outlet:</label>
          <select
            value={selectedOutlet}
            onChange={(e) => setSelectedOutlet(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
          >
            <option value="tutti">Tutti gli outlet</option>
            {costCenters.map((cc) => (
              <option key={cc.code} value={cc.code}>
                {cc.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700">
            Scenario:
          </label>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
          >
            <option value="pessimistico">Pessimistico (-10%)</option>
            <option value="base">Base</option>
            <option value="ottimistico">Ottimistico (+10%)</option>
          </select>
        </div>

        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          <Download className="w-4 h-4" />
          Esporta CSV
        </button>
      </div>

      {/* Chart */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Andamento Mensile
        </h2>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={monthlyData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="label"
              {...AXIS_STYLE}
            />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<GlassTooltip formatter={fmt} />} />
            <Legend />
            <Area
              type="monotone"
              dataKey="inflows"
              fill="#10b981"
              stroke="#059669"
              fillOpacity={0.3}
              name="Entrate"
            />
            <Bar
              dataKey="outflows"
              fill="#ef4444"
              name="Uscite"
              opacity={0.7}
            />
            <Line
              type="monotone"
              dataKey="balance_running"
              stroke="#3b82f6"
              strokeWidth={2}
              name="Saldo Cumulativo"
              yAxisId="right"
            />
            <YAxis yAxisId="right" orientation="right" {...AXIS_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Detail Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
        <h2 className="text-lg font-semibold text-slate-900 p-6 pb-4">
          Dettaglio Mese per Mese
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-900">
                Mese
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">
                Entrate SDI
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">
                Entrate Budget
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">
                Tot Entrate
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">
                Uscite SDI
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">
                Costi Ricorrenti
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">
                Rate Finanziamenti
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">
                Tot Uscite
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">
                Flusso Netto
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">
                Saldo Progressivo
              </th>
            </tr>
          </thead>
          <tbody>
            {monthlyData.map((row, idx) => (
              <tr
                key={idx}
                className={`border-t border-slate-200 ${
                  idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                }`}
              >
                <td className="px-4 py-3 font-medium text-slate-900">
                  {row.label}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {fmt(row.inflows_sdi)}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {fmt(row.inflows_budget)}
                </td>
                <td className="px-4 py-3 text-right font-medium text-green-600">
                  {fmt(row.inflows)}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {fmt(row.outflows_sdi)}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {fmt(row.outflows_recurring)}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {fmt(row.outflows_loans)}
                </td>
                <td className="px-4 py-3 text-right font-medium text-red-600">
                  {fmt(row.outflows)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-medium ${
                    row.net_flow >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {fmt(row.net_flow)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-bold ${
                    row.balance_running >= 0
                      ? 'text-slate-900'
                      : 'text-red-600'
                  }`}
                >
                  {fmt(row.balance_running)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
