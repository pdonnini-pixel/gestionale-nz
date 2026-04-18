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
  Loader,
  CheckCircle,
  Clock
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import ExportMenu from '../components/ExportMenu';

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

  // Actual monthly data from cash_movements
  const [actualMonthlyData, setActualMonthlyData] = useState([]);

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

      // 7. Fetch actual monthly data from cash_movements for the selected year
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const { data: rawMovements, error: movError } = await supabase
        .from('cash_movements')
        .select('date, type, amount')
        .eq('company_id', COMPANY_ID)
        .gte('date', yearStart)
        .lte('date', yearEnd)
        .order('date', { ascending: true });

      if (!movError && rawMovements && rawMovements.length > 0) {
        const monthActual = Array.from({ length: 12 }, (_, i) => ({
          month: i,
          entrate: 0,
          uscite: 0,
          netto: 0,
          hasData: false
        }));

        rawMovements.forEach(m => {
          const monthIdx = new Date(m.date).getMonth();
          monthActual[monthIdx].hasData = true;
          if (m.type === 'entrata') {
            monthActual[monthIdx].entrate += Math.abs(m.amount || 0);
          } else {
            monthActual[monthIdx].uscite += Math.abs(m.amount || 0);
          }
        });

        monthActual.forEach(m => {
          m.netto = m.entrate - m.uscite;
        });

        setActualMonthlyData(monthActual);
      } else {
        setActualMonthlyData([]);
      }

      // Merge actual data flags into monthData for display
      const today = new Date();
      const currentMonth = today.getMonth(); // 0-11
      const currentYear = today.getFullYear();

      monthData.forEach((month, idx) => {
        // Determine if this month is in the past (has actual data)
        if (year < currentYear || (year === currentYear && idx < currentMonth)) {
          month.tipo = 'Consuntivo';
        } else if (year === currentYear && idx === currentMonth) {
          month.tipo = 'In corso';
        } else {
          month.tipo = 'Previsione';
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
    csv += 'Mese,Tipo,Entrate Reali,Uscite Reali,Netto Reale,Entrate SDI,Entrate Budget,Tot Entrate,Uscite SDI,Costi Ricorrenti,Rate Finanziamenti,Tot Uscite,Flusso Netto,Saldo Progressivo\n';

    monthlyData.forEach((month, idx) => {
      const actual = actualMonthlyData[idx];
      const hasActual = actual && actual.hasData;
      csv += `${month.monthName},${month.tipo || 'Previsione'},${hasActual ? Math.round(actual.entrate) : ''},${hasActual ? Math.round(actual.uscite) : ''},${hasActual ? Math.round(actual.netto) : ''},${month.entrate_sdi},${month.entrate_budget},${month.tot_entrate},${month.uscite_sdi},${month.uscite_ricorrenti},${month.rate_finanziamenti},${month.tot_uscite},${month.flusso_netto},${month.saldo_progressivo}\n`;
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

          <div className="ml-auto">
            <ExportMenu
              data={monthlyData.map((m, idx) => {
                const a = actualMonthlyData[idx];
                return {
                  mese: m.monthName,
                  tipo: m.tipo || 'Previsione',
                  entrate_reali: a?.hasData ? Math.round(a.entrate) : '',
                  uscite_reali: a?.hasData ? Math.round(a.uscite) : '',
                  netto_reale: a?.hasData ? Math.round(a.netto) : '',
                  tot_entrate: m.tot_entrate,
                  tot_uscite: m.tot_uscite,
                  flusso_netto: m.flusso_netto,
                  saldo_progressivo: m.saldo_progressivo,
                };
              })}
              columns={[
                { key: 'mese', label: 'Mese' },
                { key: 'tipo', label: 'Tipo' },
                { key: 'entrate_reali', label: 'Entrate Reali', format: 'euro' },
                { key: 'uscite_reali', label: 'Uscite Reali', format: 'euro' },
                { key: 'netto_reale', label: 'Netto Reale', format: 'euro' },
                { key: 'tot_entrate', label: 'Tot Entrate', format: 'euro' },
                { key: 'tot_uscite', label: 'Tot Uscite', format: 'euro' },
                { key: 'flusso_netto', label: 'Flusso Netto', format: 'euro' },
                { key: 'saldo_progressivo', label: 'Saldo Progressivo', format: 'euro' },
              ]}
              filename={`cashflow_prospettico_${year}`}
              title={`Cashflow Prospettico ${year}`}
            />
          </div>
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
        <h2 className="text-lg font-bold text-slate-900 mb-2">Andamento Cashflow 12 Mesi</h2>
        <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
          <span className="flex items-center gap-1"><CheckCircle size={14} className="text-emerald-700" /> Consuntivo (barre piene)</span>
          <span className="flex items-center gap-1"><Clock size={14} className="text-emerald-400" /> Previsione (barre sfumate)</span>
        </div>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={monthlyData.map((m, idx) => {
            const actual = actualMonthlyData[idx];
            const hasActual = actual && actual.hasData;
            return {
              ...m,
              entrate_reali: hasActual ? Math.round(actual.entrate) : null,
              uscite_reali: hasActual ? Math.round(actual.uscite) : null,
              netto_reale: hasActual ? Math.round(actual.netto) : null,
            };
          })}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="monthName" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<GlassTooltip />} />
            <Legend />
            {/* Actual bars (solid, darker) */}
            <Bar dataKey="entrate_reali" fill="#059669" name="Entrate Reali" radius={[8, 8, 0, 0]} />
            <Bar dataKey="uscite_reali" fill="#dc2626" name="Uscite Reali" radius={[8, 8, 0, 0]} />
            {/* Projected bars (lighter) */}
            <Bar dataKey="tot_entrate" fill="#10b981" name="Entrate Previste" radius={[8, 8, 0, 0]} opacity={0.5} />
            <Bar dataKey="tot_uscite" fill="#ef4444" name="Uscite Previste" radius={[8, 8, 0, 0]} opacity={0.5} />
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
                <th className="px-4 py-3 text-center font-semibold text-slate-900">Tipo</th>
                <th className="px-4 py-3 text-right font-semibold text-emerald-800">Entrate Reali</th>
                <th className="px-4 py-3 text-right font-semibold text-red-800">Uscite Reali</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Tot Entrate (prev.)</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Tot Uscite (prev.)</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Flusso Netto</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Saldo Progressivo</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.map((month, idx) => {
                const actual = actualMonthlyData[idx];
                const hasActual = actual && actual.hasData;
                const isConsuntivo = month.tipo === 'Consuntivo';
                const isInCorso = month.tipo === 'In corso';

                return (
                  <tr
                    key={idx}
                    className={`border-b border-slate-200 hover:bg-slate-50 transition ${
                      month.saldo_progressivo < 0 ? 'bg-red-50' : ''
                    } ${isConsuntivo ? 'bg-emerald-50/30' : ''}`}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-900">{month.monthName}</td>
                    <td className="px-4 py-3 text-center">
                      {isConsuntivo && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                          <CheckCircle size={12} /> Consuntivo
                        </span>
                      )}
                      {isInCorso && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                          <Clock size={12} /> In corso
                        </span>
                      )}
                      {month.tipo === 'Previsione' && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                          <Clock size={12} /> Previsione
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-700 font-medium">
                      {hasActual ? formatCurrency(Math.round(actual.entrate)) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-red-700 font-medium">
                      {hasActual ? formatCurrency(Math.round(actual.uscite)) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-green-600">
                      {formatCurrency(month.tot_entrate)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">
                      {formatCurrency(month.tot_uscite)}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${
                      (hasActual ? actual.netto : month.flusso_netto) >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {hasActual
                        ? formatCurrency(Math.round(actual.netto))
                        : formatCurrency(month.flusso_netto)
                      }
                      {hasActual && (
                        <span className="text-xs text-slate-400 ml-1">(reale)</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${
                      month.saldo_progressivo >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {formatCurrency(month.saldo_progressivo)}
                    </td>
                  </tr>
                );
              })}
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
