import React, { useState, useEffect, useMemo } from 'react';
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
  Clock,
  ChevronDown,
  ChevronRight,
  X
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import ExportMenu from '../components/ExportMenu';

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

const formatCurrency = (value) => {
  if (value === null || value === undefined) return '€ 0';
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value) + ' €';
};

const formatDate = (date) => {
  const d = new Date(date);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
};

const formatDateFull = (date) => {
  const d = new Date(date);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
};

const parseMonth = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  return date.getMonth(); // 0-11
};

const getMonthName = (month) => {
  return MONTHS[month] || 'N/A';
};

// Helper: get ISO date string YYYY-MM-DD
const toISODate = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
};

// Helper: get Monday of the week containing the given date
const getWeekStart = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  return new Date(d.setDate(diff));
};

export default function CashflowProspettico() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  // State
  const [year, setYear] = useState(2026);
  const [selectedOutlet, setSelectedOutlet] = useState('all');
  const [scenario, setScenario] = useState('base'); // 'base', 'ottimistico', 'pessimistico'
  const [viewMode, setViewMode] = useState('mensile'); // 'giornaliero' | 'settimanale' | 'mensile'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Data state
  const [initialBalance, setInitialBalance] = useState(0);
  const [costCenters, setCostCenters] = useState([]);
  const [monthlyData, setMonthlyData] = useState([]);
  const [hasNegativeMonth, setHasNegativeMonth] = useState(false);

  // Raw data for daily/weekly views
  const [rawPayables, setRawPayables] = useState([]);
  const [rawDailyRevenue, setRawDailyRevenue] = useState([]);
  const [rawOutlets, setRawOutlets] = useState([]);
  const [rawRecurringCosts, setRawRecurringCosts] = useState([]);
  const [rawLoans, setRawLoans] = useState([]);
  const [rawBudgetConfronto, setRawBudgetConfronto] = useState([]);

  // Actual monthly data from cash_movements
  const [actualMonthlyData, setActualMonthlyData] = useState([]);

  // Summary KPIs
  const [totalInflows, setTotalInflows] = useState(0);
  const [totalOutflows, setTotalOutflows] = useState(0);
  const [finalBalance, setFinalBalance] = useState(0);

  // Drill-down state
  const [expandedRow, setExpandedRow] = useState(null); // index of expanded row
  const [expandedColumn, setExpandedColumn] = useState(null); // 'entrate' | 'uscite'

  // Negative balance alert
  const [negativeAlert, setNegativeAlert] = useState(null);

  // Fetch all data
  useEffect(() => {
    if (!COMPANY_ID) return;
    fetchAllData();
  }, [COMPANY_ID, year, selectedOutlet, scenario]);

  // Reset expanded row when view mode changes
  useEffect(() => {
    setExpandedRow(null);
    setExpandedColumn(null);
  }, [viewMode]);

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
        { data: loansData },
        { data: outletsData },
        { data: payablesScadenze },
        { data: dailyRevenueData }
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
          .eq('is_active', true),
        supabase
          .from('outlets')
          .select('id, code, name, rent_monthly')
          .eq('company_id', COMPANY_ID)
          .eq('is_active', true),
        supabase
          .from('payables')
          .select('id, due_date, gross_amount, amount_paid, outlet_id, status, supplier_id, invoice_number')
          .eq('company_id', COMPANY_ID)
          .in('status', ['da_pagare', 'in_scadenza', 'scaduto']),
        // Daily revenue for daily/weekly views
        supabase
          .from('daily_revenue')
          .select('id, date, outlet_id, gross_revenue, net_revenue')
          .eq('company_id', COMPANY_ID)
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`)
      ]);

      // Store raw data for drill-down
      setRawPayables(payablesScadenze || []);
      setRawDailyRevenue(dailyRevenueData || []);
      setRawOutlets(outletsData || []);
      setRawRecurringCosts(recurringCosts || []);
      setRawLoans(loansData || []);
      setRawBudgetConfronto(budgetConfrontoData || []);

      // Filter by outlet if not 'all'
      let filteredOutlet = selectedOutlet === 'all' ? null : selectedOutlet;

      // B4: Calculate total monthly rent from active outlets
      let totalMonthlyRent = 0;
      if (outletsData) {
        outletsData.forEach(outlet => {
          if (!filteredOutlet || outlet.code === filteredOutlet) {
            totalMonthlyRent += parseFloat(outlet.rent_monthly) || 0;
          }
        });
      }

      // B1: Build a map of outlet_id -> outlet.code for payables filtering
      const outletIdToCode = {};
      if (outletsData) {
        outletsData.forEach(outlet => {
          outletIdToCode[outlet.id] = outlet.code;
        });
      }

      // Process monthly data
      const monthData = Array.from({ length: 12 }, (_, i) => ({
        month: i,
        monthName: MONTHS[i],
        entrate_sdi: 0,
        entrate_budget: 0,
        uscite_sdi: 0,
        uscite_ricorrenti: 0,
        uscite_scadenze: 0,
        uscite_canoni: totalMonthlyRent,
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

      // 3.2b Add payables scadenze (B1: uscite previste from payables table)
      if (payablesScadenze) {
        payablesScadenze.forEach(payable => {
          const dueDate = payable.due_date;
          if (!dueDate) return;
          const payableDate = new Date(dueDate);
          // Only include payables for the selected year
          if (payableDate.getFullYear() !== year) return;
          const month = payableDate.getMonth();
          // Filter by outlet if selected
          if (filteredOutlet && outletIdToCode[payable.outlet_id] !== filteredOutlet) return;
          const outstanding = (parseFloat(payable.gross_amount) || 0) - (parseFloat(payable.amount_paid) || 0);
          if (outstanding > 0) {
            monthData[month].uscite_scadenze += outstanding;
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
        month.tot_uscite = month.uscite_sdi + month.uscite_ricorrenti + month.uscite_scadenze + month.uscite_canoni + month.rate_finanziamenti;
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

  // ===== DAILY VIEW COMPUTATION =====
  const dailyData = useMemo(() => {
    if (viewMode !== 'giornaliero') return [];

    const filteredOutlet = selectedOutlet === 'all' ? null : selectedOutlet;
    const multiplier = scenario === 'ottimistico' ? 1.1 : scenario === 'pessimistico' ? 0.9 : 1;

    const outletIdToCode = {};
    const outletIdToName = {};
    rawOutlets.forEach(o => {
      outletIdToCode[o.id] = o.code;
      outletIdToName[o.id] = o.name || o.code;
    });

    // Total daily rent (monthly rent / 30)
    let totalDailyRent = 0;
    rawOutlets.forEach(outlet => {
      if (!filteredOutlet || outlet.code === filteredOutlet) {
        totalDailyRent += (parseFloat(outlet.rent_monthly) || 0) / 30;
      }
    });

    // Daily recurring costs (monthly costs prorated to daily)
    let dailyRecurring = 0;
    (rawRecurringCosts || []).forEach(cost => {
      if (!filteredOutlet || cost.cost_center === filteredOutlet) {
        if (cost.frequency === 'monthly') {
          dailyRecurring += (cost.amount || 0) / 30;
        } else if (cost.frequency === 'quarterly') {
          dailyRecurring += (cost.amount || 0) / 90;
        } else if (cost.frequency === 'annual') {
          dailyRecurring += (cost.amount || 0) / 365;
        } else if (cost.frequency === 'semiannual') {
          dailyRecurring += (cost.amount || 0) / 180;
        } else if (cost.frequency === 'bimonthly') {
          dailyRecurring += (cost.amount || 0) / 60;
        }
      }
    });

    // Daily loan payment
    let dailyLoan = 0;
    (rawLoans || []).forEach(loan => {
      dailyLoan += (loan.monthly_payment || 0) / 30;
    });

    // Build revenue by date
    const revenueByDate = {};
    (rawDailyRevenue || []).forEach(rev => {
      const dateKey = rev.date;
      if (!revenueByDate[dateKey]) revenueByDate[dateKey] = [];
      if (!filteredOutlet || outletIdToCode[rev.outlet_id] === filteredOutlet) {
        revenueByDate[dateKey].push({
          outlet_name: outletIdToName[rev.outlet_id] || 'N/A',
          gross_revenue: parseFloat(rev.gross_revenue) || 0
        });
      }
    });

    // Build payables by date
    const payablesByDate = {};
    (rawPayables || []).forEach(p => {
      if (!p.due_date) return;
      if (filteredOutlet && outletIdToCode[p.outlet_id] !== filteredOutlet) return;
      const outstanding = (parseFloat(p.gross_amount) || 0) - (parseFloat(p.amount_paid) || 0);
      if (outstanding <= 0) return;
      const dateKey = p.due_date;
      if (!payablesByDate[dateKey]) payablesByDate[dateKey] = [];
      payablesByDate[dateKey].push({
        invoice_number: p.invoice_number || '-',
        supplier_id: p.supplier_id,
        gross_amount: outstanding
      });
    });

    // Build budget-based daily revenue estimate (monthly budget / days in month)
    const monthlyBudgetRevenue = Array(12).fill(0);
    (rawBudgetConfronto || []).forEach(entry => {
      if (entry.entry_type === 'rev_monthly') {
        const month = (entry.month || 1) - 1;
        if (!filteredOutlet || entry.cost_center === filteredOutlet) {
          monthlyBudgetRevenue[month] += entry.amount || 0;
        }
      }
    });

    const today = new Date();
    const startDate = new Date(today);
    startDate.setHours(0, 0, 0, 0);
    const days = [];
    let cumBalance = initialBalance;

    for (let i = 0; i < 30; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const dateKey = toISODate(date);
      const month = date.getMonth();
      const daysInMonth = new Date(date.getFullYear(), month + 1, 0).getDate();

      // Entrate: daily_revenue records + prorated budget
      const revenueItems = revenueByDate[dateKey] || [];
      const revenueTotal = revenueItems.reduce((sum, r) => sum + r.gross_revenue, 0);
      const budgetDaily = monthlyBudgetRevenue[month] / daysInMonth;
      const entrateRaw = revenueTotal > 0 ? revenueTotal : budgetDaily;
      const entrate = Math.round(entrateRaw * multiplier);

      // Uscite: payables due + prorated rent + prorated recurring + prorated loans
      const payableItems = payablesByDate[dateKey] || [];
      const payablesTotal = payableItems.reduce((sum, p) => sum + p.gross_amount, 0);
      const uscite = Math.round(payablesTotal + totalDailyRent + dailyRecurring + dailyLoan);

      const flusso = entrate - uscite;
      cumBalance += flusso;

      // Build rent detail items for drill-down
      const rentItems = rawOutlets
        .filter(o => !filteredOutlet || o.code === filteredOutlet)
        .map(o => ({
          label: o.name || o.code,
          amount: Math.round((parseFloat(o.rent_monthly) || 0) / 30)
        }))
        .filter(item => item.amount > 0);

      days.push({
        label: `${DAYS_SHORT[date.getDay()]} ${formatDate(date)}`,
        dateKey,
        dateFull: formatDateFull(date),
        entrate,
        uscite,
        flusso_netto: flusso,
        saldo_progressivo: cumBalance,
        // Drill-down data
        entrateItems: revenueItems.length > 0
          ? revenueItems.map(r => ({ label: r.outlet_name, amount: Math.round(r.gross_revenue * multiplier) }))
          : [{ label: 'Stima da budget', amount: Math.round(budgetDaily * multiplier) }],
        usciteItems: [
          ...payableItems.map(p => ({ label: `Fatt. ${p.invoice_number}`, amount: Math.round(p.gross_amount) })),
          ...rentItems,
          ...(dailyRecurring > 0 ? [{ label: 'Costi ricorrenti (pro-rata)', amount: Math.round(dailyRecurring) }] : []),
          ...(dailyLoan > 0 ? [{ label: 'Rate finanziamenti (pro-rata)', amount: Math.round(dailyLoan) }] : [])
        ]
      });
    }

    return days;
  }, [viewMode, rawDailyRevenue, rawPayables, rawOutlets, rawRecurringCosts, rawLoans, rawBudgetConfronto, initialBalance, selectedOutlet, scenario]);

  // ===== WEEKLY VIEW COMPUTATION =====
  const weeklyData = useMemo(() => {
    if (viewMode !== 'settimanale') return [];
    if (dailyData.length === 0) return []; // We reuse daily logic but extend to 13 weeks

    const filteredOutlet = selectedOutlet === 'all' ? null : selectedOutlet;
    const multiplier = scenario === 'ottimistico' ? 1.1 : scenario === 'pessimistico' ? 0.9 : 1;

    const outletIdToCode = {};
    const outletIdToName = {};
    rawOutlets.forEach(o => {
      outletIdToCode[o.id] = o.code;
      outletIdToName[o.id] = o.name || o.code;
    });

    let totalDailyRent = 0;
    rawOutlets.forEach(outlet => {
      if (!filteredOutlet || outlet.code === filteredOutlet) {
        totalDailyRent += (parseFloat(outlet.rent_monthly) || 0) / 30;
      }
    });

    let dailyRecurring = 0;
    (rawRecurringCosts || []).forEach(cost => {
      if (!filteredOutlet || cost.cost_center === filteredOutlet) {
        if (cost.frequency === 'monthly') dailyRecurring += (cost.amount || 0) / 30;
        else if (cost.frequency === 'quarterly') dailyRecurring += (cost.amount || 0) / 90;
        else if (cost.frequency === 'annual') dailyRecurring += (cost.amount || 0) / 365;
        else if (cost.frequency === 'semiannual') dailyRecurring += (cost.amount || 0) / 180;
        else if (cost.frequency === 'bimonthly') dailyRecurring += (cost.amount || 0) / 60;
      }
    });

    let dailyLoan = 0;
    (rawLoans || []).forEach(loan => {
      dailyLoan += (loan.monthly_payment || 0) / 30;
    });

    const revenueByDate = {};
    (rawDailyRevenue || []).forEach(rev => {
      if (!filteredOutlet || outletIdToCode[rev.outlet_id] === filteredOutlet) {
        if (!revenueByDate[rev.date]) revenueByDate[rev.date] = [];
        revenueByDate[rev.date].push({
          outlet_name: outletIdToName[rev.outlet_id] || 'N/A',
          gross_revenue: parseFloat(rev.gross_revenue) || 0
        });
      }
    });

    const payablesByDate = {};
    (rawPayables || []).forEach(p => {
      if (!p.due_date) return;
      if (filteredOutlet && outletIdToCode[p.outlet_id] !== filteredOutlet) return;
      const outstanding = (parseFloat(p.gross_amount) || 0) - (parseFloat(p.amount_paid) || 0);
      if (outstanding <= 0) return;
      if (!payablesByDate[p.due_date]) payablesByDate[p.due_date] = [];
      payablesByDate[p.due_date].push({
        invoice_number: p.invoice_number || '-',
        supplier_id: p.supplier_id,
        gross_amount: outstanding
      });
    });

    const monthlyBudgetRevenue = Array(12).fill(0);
    (rawBudgetConfronto || []).forEach(entry => {
      if (entry.entry_type === 'rev_monthly') {
        const month = (entry.month || 1) - 1;
        if (!filteredOutlet || entry.cost_center === filteredOutlet) {
          monthlyBudgetRevenue[month] += entry.amount || 0;
        }
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Start from Monday of current week
    const weekStart = getWeekStart(today);

    const weeks = [];
    let cumBalance = initialBalance;

    for (let w = 0; w < 13; w++) {
      const wStart = new Date(weekStart);
      wStart.setDate(weekStart.getDate() + w * 7);
      const wEnd = new Date(wStart);
      wEnd.setDate(wStart.getDate() + 6);

      let weekEntrate = 0;
      let weekUscite = 0;
      const weekEntrateItems = [];
      const weekUsciteItems = [];

      for (let d = 0; d < 7; d++) {
        const date = new Date(wStart);
        date.setDate(wStart.getDate() + d);
        const dateKey = toISODate(date);
        const month = date.getMonth();
        const daysInMonth = new Date(date.getFullYear(), month + 1, 0).getDate();

        const revenueItems = revenueByDate[dateKey] || [];
        const revenueTotal = revenueItems.reduce((sum, r) => sum + r.gross_revenue, 0);
        const budgetDaily = monthlyBudgetRevenue[month] / daysInMonth;
        const dayEntrate = Math.round((revenueTotal > 0 ? revenueTotal : budgetDaily) * multiplier);
        weekEntrate += dayEntrate;

        revenueItems.forEach(r => {
          weekEntrateItems.push({ label: `${formatDate(date)} - ${r.outlet_name}`, amount: Math.round(r.gross_revenue * multiplier) });
        });
        if (revenueItems.length === 0 && budgetDaily > 0) {
          weekEntrateItems.push({ label: `${formatDate(date)} - Stima budget`, amount: Math.round(budgetDaily * multiplier) });
        }

        const payableItems = payablesByDate[dateKey] || [];
        const payablesTotal = payableItems.reduce((sum, p) => sum + p.gross_amount, 0);
        const dayUscite = Math.round(payablesTotal + totalDailyRent + dailyRecurring + dailyLoan);
        weekUscite += dayUscite;

        payableItems.forEach(p => {
          weekUsciteItems.push({ label: `${formatDate(date)} - Fatt. ${p.invoice_number}`, amount: Math.round(p.gross_amount) });
        });
      }

      // Add weekly rent/recurring/loan totals
      const weeklyRent = Math.round(totalDailyRent * 7);
      const weeklyRecurring = Math.round(dailyRecurring * 7);
      const weeklyLoan = Math.round(dailyLoan * 7);
      if (weeklyRent > 0) weekUsciteItems.push({ label: 'Canoni affitto (settimana)', amount: weeklyRent });
      if (weeklyRecurring > 0) weekUsciteItems.push({ label: 'Costi ricorrenti (settimana)', amount: weeklyRecurring });
      if (weeklyLoan > 0) weekUsciteItems.push({ label: 'Rate finanziamenti (settimana)', amount: weeklyLoan });

      const flusso = weekEntrate - weekUscite;
      cumBalance += flusso;

      weeks.push({
        label: `${formatDate(wStart)} - ${formatDate(wEnd)}`,
        dateKey: toISODate(wStart),
        entrate: weekEntrate,
        uscite: weekUscite,
        flusso_netto: flusso,
        saldo_progressivo: cumBalance,
        entrateItems: weekEntrateItems,
        usciteItems: weekUsciteItems
      });
    }

    return weeks;
  }, [viewMode, rawDailyRevenue, rawPayables, rawOutlets, rawRecurringCosts, rawLoans, rawBudgetConfronto, initialBalance, selectedOutlet, scenario]);

  // Force daily computation for weekly view by making dailyData not depend on viewMode for weekly
  // Actually, weeklyData computes independently. Let's fix the dependency:
  // weeklyData already computes from raw data, not from dailyData. Good.

  // ===== ACTIVE DATA based on viewMode =====
  const activeData = useMemo(() => {
    if (viewMode === 'giornaliero') return dailyData;
    if (viewMode === 'settimanale') return weeklyData;
    return monthlyData;
  }, [viewMode, dailyData, weeklyData, monthlyData]);

  // ===== NEGATIVE ALERT COMPUTATION =====
  useEffect(() => {
    let alertInfo = null;

    if (viewMode === 'mensile') {
      for (const m of monthlyData) {
        if (m.saldo_progressivo < 0) {
          alertInfo = {
            period: `${m.monthName} ${year}`,
            uscite: m.tot_uscite,
            saldo: m.saldo_progressivo
          };
          break;
        }
      }
    } else if (viewMode === 'giornaliero') {
      for (const d of dailyData) {
        if (d.saldo_progressivo < 0) {
          alertInfo = {
            period: d.dateFull || d.label,
            uscite: d.uscite,
            saldo: d.saldo_progressivo
          };
          break;
        }
      }
    } else if (viewMode === 'settimanale') {
      for (const w of weeklyData) {
        if (w.saldo_progressivo < 0) {
          alertInfo = {
            period: `Settimana ${w.label}`,
            uscite: w.uscite,
            saldo: w.saldo_progressivo
          };
          break;
        }
      }
    }

    setNegativeAlert(alertInfo);
  }, [viewMode, monthlyData, dailyData, weeklyData, year]);

  // ===== DRILL-DOWN DETAIL FOR MONTHLY VIEW =====
  const getMonthlyDrillDown = (monthIdx, column) => {
    const filteredOutlet = selectedOutlet === 'all' ? null : selectedOutlet;
    const outletIdToCode = {};
    const outletIdToName = {};
    rawOutlets.forEach(o => {
      outletIdToCode[o.id] = o.code;
      outletIdToName[o.id] = o.name || o.code;
    });

    if (column === 'entrate') {
      const items = [];
      // Daily revenue records for this month
      (rawDailyRevenue || []).forEach(rev => {
        const d = new Date(rev.date);
        if (d.getMonth() === monthIdx && d.getFullYear() === year) {
          if (!filteredOutlet || outletIdToCode[rev.outlet_id] === filteredOutlet) {
            items.push({
              label: `${formatDateFull(rev.date)} - ${outletIdToName[rev.outlet_id] || 'N/A'}`,
              amount: Math.round(parseFloat(rev.gross_revenue) || 0)
            });
          }
        }
      });
      // Budget entries
      (rawBudgetConfronto || []).forEach(entry => {
        if (entry.entry_type === 'rev_monthly' && (entry.month - 1) === monthIdx) {
          if (!filteredOutlet || entry.cost_center === filteredOutlet) {
            items.push({
              label: `Budget - ${entry.cost_center || 'Generale'}`,
              amount: Math.round(entry.amount || 0)
            });
          }
        }
      });
      return items;
    } else {
      const items = [];
      // Payables due this month
      (rawPayables || []).forEach(p => {
        if (!p.due_date) return;
        const d = new Date(p.due_date);
        if (d.getMonth() !== monthIdx || d.getFullYear() !== year) return;
        if (filteredOutlet && outletIdToCode[p.outlet_id] !== filteredOutlet) return;
        const outstanding = (parseFloat(p.gross_amount) || 0) - (parseFloat(p.amount_paid) || 0);
        if (outstanding > 0) {
          items.push({
            label: `Fatt. ${p.invoice_number || '-'} (scad. ${formatDateFull(p.due_date)})`,
            amount: Math.round(outstanding)
          });
        }
      });
      // Rent
      rawOutlets.forEach(o => {
        if (!filteredOutlet || o.code === filteredOutlet) {
          const rent = parseFloat(o.rent_monthly) || 0;
          if (rent > 0) {
            items.push({ label: `Canone - ${o.name || o.code}`, amount: Math.round(rent) });
          }
        }
      });
      // Recurring costs
      (rawRecurringCosts || []).forEach(cost => {
        if (!filteredOutlet || cost.cost_center === filteredOutlet) {
          // Check if this cost applies to this month
          const startMonth = (cost.month_start || 1) - 1;
          let applies = false;
          if (cost.frequency === 'monthly') applies = true;
          else if (cost.frequency === 'bimonthly') applies = (monthIdx - startMonth) % 2 === 0 && monthIdx >= startMonth;
          else if (cost.frequency === 'quarterly') applies = (monthIdx - startMonth) % 3 === 0 && monthIdx >= startMonth;
          else if (cost.frequency === 'semiannual') applies = (monthIdx - startMonth) % 6 === 0 && monthIdx >= startMonth;
          else if (cost.frequency === 'annual') applies = monthIdx === startMonth;
          if (applies) {
            items.push({ label: `${cost.description || cost.category || 'Costo ricorrente'}`, amount: Math.round(cost.amount || 0) });
          }
        }
      });
      // Loan payments
      (rawLoans || []).forEach(loan => {
        if (loan.monthly_payment > 0) {
          items.push({ label: `Rata - ${loan.description || 'Finanziamento'}`, amount: Math.round(loan.monthly_payment) });
        }
      });
      return items;
    }
  };

  const handleDrillDown = (rowIdx, column) => {
    if (expandedRow === rowIdx && expandedColumn === column) {
      setExpandedRow(null);
      setExpandedColumn(null);
    } else {
      setExpandedRow(rowIdx);
      setExpandedColumn(column);
    }
  };

  const getDrillDownItems = (rowIdx, column) => {
    if (viewMode === 'mensile') {
      return getMonthlyDrillDown(rowIdx, column);
    }
    // For daily/weekly, items are pre-computed
    const row = activeData[rowIdx];
    if (!row) return [];
    return column === 'entrate' ? (row.entrateItems || []) : (row.usciteItems || []);
  };

  const handleExportCSV = () => {
    let csv = 'Cashflow Prospettico - ' + year + '\n';
    csv += 'Mese,Tipo,Entrate Reali,Uscite Reali,Netto Reale,Entrate SDI,Entrate Budget,Tot Entrate,Uscite SDI,Costi Ricorrenti,Scadenze Fornitori,Canoni Affitto,Rate Finanziamenti,Tot Uscite,Flusso Netto,Saldo Progressivo\n';

    monthlyData.forEach((month, idx) => {
      const actual = actualMonthlyData[idx];
      const hasActual = actual && actual.hasData;
      csv += `${month.monthName},${month.tipo || 'Previsione'},${hasActual ? Math.round(actual.entrate) : ''},${hasActual ? Math.round(actual.uscite) : ''},${hasActual ? Math.round(actual.netto) : ''},${month.entrate_sdi},${month.entrate_budget},${month.tot_entrate},${month.uscite_sdi},${month.uscite_ricorrenti},${month.uscite_scadenze},${month.uscite_canoni},${month.rate_finanziamenti},${month.tot_uscite},${month.flusso_netto},${month.saldo_progressivo}\n`;
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

  // Determine chart data based on view mode
  const chartData = viewMode === 'mensile'
    ? monthlyData.map((m, idx) => {
        const actual = actualMonthlyData[idx];
        const hasActual = actual && actual.hasData;
        return {
          ...m,
          entrate_reali: hasActual ? Math.round(actual.entrate) : null,
          uscite_reali: hasActual ? Math.round(actual.uscite) : null,
          netto_reale: hasActual ? Math.round(actual.netto) : null,
        };
      })
    : viewMode === 'giornaliero'
      ? dailyData.map(d => ({
          monthName: d.label,
          tot_entrate: d.entrate,
          tot_uscite: d.uscite,
          saldo_progressivo: d.saldo_progressivo,
          flusso_netto: d.flusso_netto
        }))
      : weeklyData.map(w => ({
          monthName: w.label,
          tot_entrate: w.entrate,
          tot_uscite: w.uscite,
          saldo_progressivo: w.saldo_progressivo,
          flusso_netto: w.flusso_netto
        }));

  const chartTitle = viewMode === 'giornaliero'
    ? 'Andamento Cashflow 30 Giorni'
    : viewMode === 'settimanale'
      ? 'Andamento Cashflow 13 Settimane'
      : 'Andamento Cashflow 12 Mesi';

  return (
    <div className="p-8 bg-slate-50 min-h-screen">
      {/* Negative Balance Alert */}
      {negativeAlert && (
        <div className="mb-6 bg-red-600 text-white rounded-xl p-4 shadow-lg sticky top-4 z-10">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 flex-shrink-0" />
            <div>
              <p className="font-bold text-lg">
                Attenzione: il saldo diventera negativo il {negativeAlert.period}
              </p>
              <p className="text-red-100 mt-1">
                Uscite previste: {formatCurrency(negativeAlert.uscite)} — Saldo atteso: {formatCurrency(negativeAlert.saldo)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-6">
          <Wallet className="w-8 h-8 text-indigo-600" />
          <h1 className="text-3xl font-bold text-slate-900">Cashflow Prospettico</h1>
        </div>

        {/* View Mode Selector */}
        <div className="flex gap-1 mb-4 bg-slate-200 rounded-lg p-1 w-fit">
          {[
            { value: 'giornaliero', label: 'Giornaliero', sub: '30 giorni' },
            { value: 'settimanale', label: 'Settimanale', sub: '3 mesi' },
            { value: 'mensile', label: 'Mensile', sub: '12 mesi' }
          ].map(mode => (
            <button
              key={mode.value}
              onClick={() => setViewMode(mode.value)}
              className={`px-4 py-2 rounded-md font-medium transition text-sm ${
                viewMode === mode.value
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {mode.label}
              <span className={`ml-1 text-xs ${viewMode === mode.value ? 'text-indigo-400' : 'text-slate-400'}`}>
                ({mode.sub})
              </span>
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-4 items-center">
          {viewMode === 'mensile' && (
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
          )}

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
                  uscite_scadenze: m.uscite_scadenze,
                  uscite_canoni: m.uscite_canoni,
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
                { key: 'uscite_scadenze', label: 'Scadenze Fornitori', format: 'euro' },
                { key: 'uscite_canoni', label: 'Canoni Affitto', format: 'euro' },
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
        <h2 className="text-lg font-bold text-slate-900 mb-2">{chartTitle}</h2>
        {viewMode === 'mensile' && (
          <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><CheckCircle size={14} className="text-emerald-700" /> Consuntivo (barre piene)</span>
            <span className="flex items-center gap-1"><Clock size={14} className="text-emerald-400" /> Previsione (barre sfumate)</span>
          </div>
        )}
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={chartData}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="monthName"
              {...AXIS_STYLE}
              angle={viewMode !== 'mensile' ? -45 : 0}
              textAnchor={viewMode !== 'mensile' ? 'end' : 'middle'}
              height={viewMode !== 'mensile' ? 60 : 30}
              interval={viewMode === 'giornaliero' ? 2 : 0}
              tick={{ fontSize: viewMode !== 'mensile' ? 10 : 12 }}
            />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<GlassTooltip />} />
            <Legend />
            {viewMode === 'mensile' && (
              <>
                <Bar dataKey="entrate_reali" fill="#059669" name="Entrate Reali" radius={[8, 8, 0, 0]} />
                <Bar dataKey="uscite_reali" fill="#dc2626" name="Uscite Reali" radius={[8, 8, 0, 0]} />
              </>
            )}
            <Bar dataKey="tot_entrate" fill="#10b981" name="Entrate Previste" radius={[8, 8, 0, 0]} opacity={viewMode === 'mensile' ? 0.5 : 0.8} />
            <Bar dataKey="tot_uscite" fill="#ef4444" name="Uscite Previste" radius={[8, 8, 0, 0]} opacity={viewMode === 'mensile' ? 0.5 : 0.8} />
            <Line
              type="monotone"
              dataKey="saldo_progressivo"
              stroke="#3b82f6"
              strokeWidth={3}
              name="Saldo Cumulativo"
              dot={{ fill: '#3b82f6', r: viewMode === 'giornaliero' ? 2 : 4 }}
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
                <th className="px-4 py-3 text-left font-semibold text-slate-900">
                  {viewMode === 'giornaliero' ? 'Giorno' : viewMode === 'settimanale' ? 'Settimana' : 'Mese'}
                </th>
                {viewMode === 'mensile' && (
                  <>
                    <th className="px-4 py-3 text-center font-semibold text-slate-900">Tipo</th>
                    <th className="px-4 py-3 text-right font-semibold text-emerald-800">Entrate Reali</th>
                    <th className="px-4 py-3 text-right font-semibold text-red-800">Uscite Reali</th>
                  </>
                )}
                <th className="px-4 py-3 text-right font-semibold text-slate-900">
                  {viewMode === 'mensile' ? 'Tot Entrate (prev.)' : 'Entrate'}
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">
                  {viewMode === 'mensile' ? 'Tot Uscite (prev.)' : 'Uscite'}
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Flusso Netto</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Saldo Progressivo</th>
              </tr>
            </thead>
            <tbody>
              {viewMode === 'mensile' ? (
                // Monthly view (original)
                monthlyData.map((month, idx) => {
                  const actual = actualMonthlyData[idx];
                  const hasActual = actual && actual.hasData;
                  const isConsuntivo = month.tipo === 'Consuntivo';
                  const isInCorso = month.tipo === 'In corso';
                  const isExpanded = expandedRow === idx;

                  return (
                    <React.Fragment key={idx}>
                      <tr
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
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDrillDown(idx, 'entrate')}
                            className="font-semibold text-green-600 hover:underline cursor-pointer inline-flex items-center gap-1"
                          >
                            {formatCurrency(month.tot_entrate)}
                            {isExpanded && expandedColumn === 'entrate'
                              ? <ChevronDown size={14} />
                              : <ChevronRight size={14} className="opacity-40" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDrillDown(idx, 'uscite')}
                            className="font-semibold text-red-600 hover:underline cursor-pointer inline-flex items-center gap-1"
                          >
                            {formatCurrency(month.tot_uscite)}
                            {isExpanded && expandedColumn === 'uscite'
                              ? <ChevronDown size={14} />
                              : <ChevronRight size={14} className="opacity-40" />}
                          </button>
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
                      {/* Drill-down detail row */}
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-6 py-4">
                            <DrillDownPanel
                              items={getDrillDownItems(idx, expandedColumn)}
                              column={expandedColumn}
                              onClose={() => { setExpandedRow(null); setExpandedColumn(null); }}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                // Daily / Weekly view
                activeData.map((row, idx) => {
                  const isExpanded = expandedRow === idx;
                  return (
                    <React.Fragment key={idx}>
                      <tr
                        className={`border-b border-slate-200 hover:bg-slate-50 transition ${
                          row.saldo_progressivo < 0 ? 'bg-red-50' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">{row.label}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDrillDown(idx, 'entrate')}
                            className="font-semibold text-green-600 hover:underline cursor-pointer inline-flex items-center gap-1"
                          >
                            {formatCurrency(row.entrate)}
                            {isExpanded && expandedColumn === 'entrate'
                              ? <ChevronDown size={14} />
                              : <ChevronRight size={14} className="opacity-40" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDrillDown(idx, 'uscite')}
                            className="font-semibold text-red-600 hover:underline cursor-pointer inline-flex items-center gap-1"
                          >
                            {formatCurrency(row.uscite)}
                            {isExpanded && expandedColumn === 'uscite'
                              ? <ChevronDown size={14} />
                              : <ChevronRight size={14} className="opacity-40" />}
                          </button>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${
                          row.flusso_netto >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {formatCurrency(row.flusso_netto)}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          row.saldo_progressivo >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {formatCurrency(row.saldo_progressivo)}
                        </td>
                      </tr>
                      {/* Drill-down detail row */}
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={5} className="px-6 py-4">
                            <DrillDownPanel
                              items={getDrillDownItems(idx, expandedColumn)}
                              column={expandedColumn}
                              onClose={() => { setExpandedRow(null); setExpandedColumn(null); }}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
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

// ===== DRILL-DOWN PANEL COMPONENT =====
function DrillDownPanel({ items, column, onClose }) {
  const isEntrate = column === 'entrate';
  const total = items.reduce((sum, item) => sum + (item.amount || 0), 0);

  return (
    <div className={`rounded-lg border p-4 ${isEntrate ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className={`font-semibold text-sm ${isEntrate ? 'text-green-800' : 'text-red-800'}`}>
          {isEntrate ? 'Dettaglio Entrate' : 'Dettaglio Uscite'}
        </h4>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 transition"
        >
          <X size={16} />
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-slate-500 text-xs italic">Nessun dettaglio disponibile per questo periodo.</p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {items.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
              <span className="text-slate-700 truncate mr-4">{item.label}</span>
              <span className={`font-medium whitespace-nowrap ${isEntrate ? 'text-green-700' : 'text-red-700'}`}>
                {formatCurrency(item.amount)}
              </span>
            </div>
          ))}
          {items.length > 1 && (
            <div className="flex items-center justify-between text-xs py-2 border-t-2 border-slate-300 font-bold mt-1">
              <span className="text-slate-900">Totale</span>
              <span className={isEntrate ? 'text-green-800' : 'text-red-800'}>
                {formatCurrency(total)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
