import React, { useState, useEffect } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Download,
  Filter,
  Calendar,
  Loader
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const formatCurrency = (value) => {
  if (value === null || value === undefined) return '€ 0';
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value) + ' €';
};

const parseMonth = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  return date.getMonth(); // 0-11
};

const getMonthName = (month) => {
  return MONTHS[month] || 'N/A';
};

export default function CashflowProspettico() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  // State
  const [year, setYear] = useState(2026);
  const [selectedOutlet, setSelectedOutlet] = useState('all');
  const [scenario, setScenario] = useState('base'); // 'base', 'ottimistico', 'pessimistico'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Data state
  const [initialBalance, setInitialBalance] = useState(0);
  const [costCenters, setCostCenters] = useState([]);
  const [monthlyData, setMonthlyData] = useState([]);
  const [hasNegativeMonth, setHasNegativeMonth] = useState(false);

  // Summary KPIs
  const [totalInflows, setTotalInflows] = useState(0);
  const [totalOutflows, setTotalOutflows] = useState(0);
  const [finalBalance, setFinalBalance] = useState(0);

  // Fetch all data
  useEffect(() => {
    if (!COMPANY_ID) return;
    fetchAllData();
  }, [COMPANY_ID, year, selectedOutlet, scenario]);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Get cost centers
      const { data: costCenterData, error: ccError } = await supabase
        .from('cost_centers')
        .select('*');

      if (ccError) throw ccError;
      setCostCenters(costCenterData || []);

      // 2. Get initial bank balance
      const { data: balanceData, error: balError } = await supabase
        .from('v_cash_position')
        .select('current_balance')
        .eq('company_id', COMPANY_ID)
        .single();

      const balance = balanceData?.current_balance || 0;
      setInitialBalance(balance);

      // 3. Fetch all required data
      const [
        { data: recurringCosts },
        { data: payablesData },
        { data: budgetConfrontoData },
        { data: loansData }
      ] = await Promise.all([
        supabase
          .from('recurring_costs')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('is_active', true),
        supabase
          .from('v_payables_operative')
          .select('*')
          .eq('company_id', COMPANY_ID),
        supabase
          .from('budget_confronto')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('year', year),
        supabase
          .from('loans')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('is_active', true)
      ]);

      // Filter by outlet if not 'all'
      let filteredOutlet = selectedOutlet === 'all' ? null : selectedOutlet;

      // Process monthly data
      const monthData = Array.from({ length: 12 }, (_, i) => ({
        month: i,
        monthName: MONTHS[i],
        entrate_sdi: 0,
        entrate_budget: 0,
        uscite_sdi: 0,
        uscite_ricorrenti: 0,
        rate_finanziamenti: 0
      }));

      // 3.1 Add budget revenues
      if (budgetConfrontoData) {
        budgetConfrontoData.forEach(entry => {
          if (entry.entry_type === 'rev_monthly') {
            const month = entry.month - 1; // 1-12 to 0-11
            if (!filteredOutlet || entry.cost_center === filteredOutlet) {
              monthData[month].entrate_budget += entry.amount || 0;
            }
          }
        });
      }

      // 3.2 Add SDI payables
      if (payablesData) {
        payablesData.forEach(payable => {
          if (!['pagato', 'annullato'].includes(payable.status)) {
            const month = parseMonth(payable.due_date);
            if (month !== null && (!filteredOutlet || payable.cost_center_code === filteredOutlet)) {
              const outstandingAmount = (payable.amount_total || 0) - (payable.amount_paid || 0);
              monthData[month].uscite_sdi += outstandingAmount;
            }
          }
        });
      }

      // 3.3 Add recurring costs
      if (recurringCosts) {
        recurringCosts.forEach(cost => {
          if (!filteredOutlet || cost.cost_center === filteredOutlet) {
            const dayOfMonth = cost.day_of_month || 1;
            const startMonth = (cost.month_start || 1) - 1; // 1-12 to 0-11

            for (let m = 0; m < 12; m++) {
              let shouldInclude = false;

              if (cost.frequency === 'monthly') {
                shouldInclude = true;
              } else if (cost.frequency === 'bimonthly') {
                shouldInclude = (m - startMonth) % 2 === 0 && m >= startMonth;
              } else if (cost.frequency === 'quarterly') {
                shouldInclude = (m - startMonth) % 3 === 0 && m >= startMonth;
              } else if (cost.frequency === 'semiannual') {
                shouldInclude = (m - startMonth) % 6 === 0 && m >= startMonth;
              } else if (cost.frequency === 'annual') {
                shouldInclude = m === startMonth;
              }

              if (shouldInclude) {
                monthData[m].uscite_ricorrenti += cost.amount || 0;
              }
            }
          }
        });
      }

      // 3.4 Add loan payments
      if (loansData) {
        loansData.forEach(loan => {
          for (let m = 0; m < 12; m++) {
            monthData[m].rate_finanziamenti += loan.monthly_payment || 0;
          }
        });
      }

      // 4. Apply scenario multiplier to revenues
      const multiplier = scenario === 'ottimistico' ? 1.1 : scenario === 'pessimistico' ? 0.9 : 1;

      // 5. Calculate totals, flows, and cumulative balance
      let cumulativeBalance = balance;
      let totalIn = 0, totalOut = 0;
      let foundNegative = false;

      monthData.forEach((month, idx) => {
        month.entrate_sdi = Math.round(month.entrate_sdi * multiplier);
        month.entrate_budget = Math.round(month.entrate_budget * multiplier);

        month.tot_entrate = month.entrate_sdi + month.entrate_budget;
        month.tot_uscite = month.uscite_sdi + month.uscite_ricorrenti + month.rate_finanziamenti;
        month.flusso_netto = month.tot_entrate - month.tot_uscite;

        cumulativeBalance += month.flusso_netto;
        month.saldo_progressivo = cumulativeBalance;

        totalIn += month.tot_entrate;
        totalOut += month.tot_uscite;

        if (cumulativeBalance < 0) {
          foundNegative = true;
        }
      });

      setMonthlyData(monthData);
      setTotalInflows(totalIn);
      setTotalOutflows(totalOut);
      setFinalBalance(cumulativeBalance);
      setHasNegativeMonth(foundNegative);

    } catch (err) {
      console.error('Error fetching cashflow data:', err);
      setError(err.message || 'Errore nel caricamento dei dati');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    let csv = 'Cashflow Prospettico - ' + year + '\n';
    csv += 'Mese,Entrate SDI,Entrate Budget,Tot Entrate,Uscite SDI,Costi Ricorrenti,Rate Finanziamenti,Tot Uscite,Flusso Netto,Saldo Progressivo\n';

    monthlyData.forEach(month => {
      csv += `${month.monthName},${month.entrate_sdi},${month.entrate_budget},${month.tot_entrate},${month.uscite_sdi},${month.uscite_ricorrenti},${month.rate_finanziamenti},${month.tot_uscite},${month.flusso_netto},${month.saldo_progressivo}\n`;
    });

    navigator.clipboard.writeText(csv).then(() => {
      alert('Dati copiati negli appunti');
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <Loader className="w-12 h-12 animate-spin mx-auto mb-4 text-indigo-600" />
          <p className="text-slate-600">Caricamento cashflow...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">Errore: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-6">
          <Wallet className="w-8 h-8 text-indigo-600" />
          <h1 className="text-3xl font-bold text-slate-900">Cashflow Prospettico</h1>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-slate-500" />
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-3 py-2 border border-slate-300 rounded-lg text-slate-900 bg-white hover:border-slate-400"
            >
              {[2024, 2025, 2026, 2027, 2028].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-slate-500" />
            <select
              value={selectedOutlet}
              onChange={(e) => setSelectedOutlet(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-slate-900 bg-white hover:border-slate-400"
            >
              <option value="all">Tutti gli outlet</option>
              {costCenters.map(cc => (
                <option key={cc.code} value={cc.code}>{cc.label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            {['base', 'ottimistico', 'pessimistico'].map(s => (
              <button
                key={s}
                onClick={() => setScenario(s)}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  scenario === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-700 border border-slate-300 hover:border-slate-400'
                }`}
              >
                {s === 'base' ? 'Base' : s === 'ottimistico' ? '+10%' : '-10%'}
              </button>
            ))}
          </div>

          <button
            onClick={handleExportCSV}
            className="ml-auto px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Esporta CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
          <p className="text-slate-600 text-sm font-medium mb-2">Saldo Iniziale</p>
          <p className={`text-2xl font-bold ${initialBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(initialBalance)}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <p className="text-slate-600 text-sm font-medium">Entrate Stimate</p>
          </div>
          <p className="text-2xl font-bold text-green-600">
            {formatCurrency(totalInflows)}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-red-600" />
            <p className="text-slate-600 text-sm font-medium">Uscite Stimate</p>
          </div>
          <p className="text-2xl font-bold text-red-600">
            {formatCurrency(totalOutflows)}
          </p>
        </div>

        <div className={`rounded-xl shadow-sm p-6 border ${
          hasNegativeMonth
            ? 'bg-red-50 border-red-200'
            : 'bg-white border-slate-200'
        }`}>
          <p className={`text-sm font-medium mb-2 ${hasNegativeMonth ? 'text-red-700' : 'text-slate-600'}`}>
            Saldo Finale Stimato
          </p>
          <p className={`text-2xl font-bold ${finalBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(finalBalance)}
          </p>
          {hasNegativeMonth && (
            <div className="flex items-center gap-1 mt-3 text-red-600 text-xs">
              <AlertTriangle className="w-4 h-4" />
              <span>Saldo negativo in alcuni mesi</span>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-8 border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900 mb-6">Andamento Cashflow 12 Mesi</h2>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={monthlyData}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="monthName" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<GlassTooltip />} />
            <Legend />
            <Bar dataKey="tot_entrate" fill="#10b981" name="Entrate" radius={[8, 8, 0, 0]} />
            <Bar dataKey="tot_uscite" fill="#ef4444" name="Uscite" radius={[8, 8, 0, 0]} />
            <Line
              type="monotone"
              dataKey="saldo_progressivo"
              stroke="#3b82f6"
              strokeWidth={3}
              name="Saldo Cumulativo"
              dot={{ fill: '#3b82f6', r: 4 }}
              activeDot={{ r: 6 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Detail Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-900">Mese</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Entrate SDI</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Entrate Budget</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Tot Entrate</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Uscite SDI</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Costi Ricorrenti</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Rate Finanziamenti</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Tot Uscite</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Flusso Netto</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Saldo Progressivo</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.map((month, idx) => (
                <tr
                  key={idx}
                  className={`border-b border-slate-200 hover:bg-slate-50 transition ${
                    month.saldo_progressivo < 0 ? 'bg-red-50' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-semibold text-slate-900">{month.monthName}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(month.entrate_sdi)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(month.entrate_budget)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-600">
                    {formatCurrency(month.tot_entrate)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(month.uscite_sdi)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(month.uscite_ricorrenti)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(month.rate_finanziamenti)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-600">
                    {formatCurrency(month.tot_uscite)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${
                    month.flusso_netto >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {formatCurrency(month.flusso_netto)}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${
                    month.saldo_progressivo >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {formatCurrency(month.saldo_progressivo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary row */}
      <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
        <div className="grid grid-cols-5 gap-4 text-center">
          <div>
            <p className="text-xs font-medium text-indigo-700 mb-1">TOTALE ENTRATE</p>
            <p className="text-lg font-bold text-indigo-900">{formatCurrency(totalInflows)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-indigo-700 mb-1">TOTALE USCITE</p>
            <p className="text-lg font-bold text-indigo-900">{formatCurrency(totalOutflows)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-indigo-700 mb-1">FLUSSO NETTO ANNUALE</p>
            <p className={`text-lg font-bold ${totalInflows - totalOutflows >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(totalInflows - totalOutflows)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-indigo-700 mb-1">SALDO INIZIALE</p>
            <p className="text-lg font-bold text-indigo-900">{formatCurrency(initialBalance)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-indigo-700 mb-1">SALDO FINALE</p>
            <p className={`text-lg font-bold ${finalBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(finalBalance)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
