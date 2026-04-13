import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar,
  TrendingUp,
  TrendingDown,
  Filter,
  AlertCircle,
  Clock,
  DollarSign,
  BarChart3,
  Eye,
  EyeOff,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Clock3,
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Download,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const COLORI_STATO = {
  pagato: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300', badge: 'bg-green-500' },
  da_pagare: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300', badge: 'bg-blue-500' },
  parziale: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300', badge: 'bg-amber-500' },
  scaduto: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300', badge: 'bg-red-500' },
  in_scadenza: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300', badge: 'bg-orange-500' },
  contestato: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300', badge: 'bg-purple-500' },
};

const PAYMENT_METHODS = ['bonifico', 'riba', 'rid', 'carta', 'contanti', 'compensazione', 'altro'];
const SUPPLIER_CATEGORIES = ['merce', 'servizi', 'utenze', 'affitti', 'stipendi', 'imposte', 'finanziamenti'];

// Modal wrapper component
const Modal = ({ isOpen, title, children, onClose, onSave, isSaving }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-96 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
        <div className="border-t border-slate-200 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition"
          >
            Annulla
          </button>
          {onSave && (
            <button
              onClick={onSave}
              disabled={isSaving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {isSaving ? 'Salvataggio...' : 'Salva'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const ScadenzarioSmart = () => {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [loading, setLoading] = useState(true);
  const [payables, setPayables] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [cashPosition, setCashPosition] = useState(0);

  const [viewMode, setViewMode] = useState('timeline');
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Calculate dynamic date range: 3 months ago to 6 months ahead
  const getDynamicDateRange = () => {
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const sixMonthsAhead = new Date(now);
    sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);
    return {
      start: threeMonthsAgo.toISOString().split('T')[0],
      end: sixMonthsAhead.toISOString().split('T')[0],
    };
  };

  const [dateRange, setDateRange] = useState(getDynamicDateRange());

  // Modals
  const [modals, setModals] = useState({
    payment: { open: false, payable: null },
    invoice: { open: false, data: null },
    supplier: { open: false, data: null },
    editSchedule: { open: false, schedule: null },
    deleteConfirm: { open: false, scheduleId: null, invoiceNumber: null },
  });

  const today = new Date();

  // Load data from Supabase
  useEffect(() => {
    if (!COMPANY_ID) return;

    const fetchData = async () => {
      try {
        setLoading(true);

        // Fetch payables from operative view (includes supplier/outlet/cost info)
        const { data: viewData, error: viewError } = await supabase
          .from('v_payables_operative')
          .select('*');

        if (viewError) console.warn('v_payables_operative error:', viewError.message);

        // Fetch suppliers
        const { data: suppliersData, error: suppliersError } = await supabase
          .from('suppliers')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .or('is_deleted.is.null,is_deleted.eq.false');

        if (suppliersError) throw suppliersError;
        setSuppliers(suppliersData || []);

        // Fetch bank accounts
        const { data: accountsData, error: accountsError } = await supabase
          .from('bank_accounts')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('is_active', true);

        if (accountsError) throw accountsError;
        setBankAccounts(accountsData || []);

        // Map view data to component format
        const enrichedPayables = (viewData || []).map(row => ({
          id: row.id,
          invoice_number: row.invoice_number || '-',
          invoice_date: row.invoice_date,
          due_date: row.due_date,
          original_due_date: row.original_due_date,
          gross_amount: row.gross_amount || 0,
          amount_paid: row.amount_paid || 0,
          amount_remaining: row.amount_remaining || 0,
          status: row.status,
          payment_method: row.payment_method,
          outlet_id: row.outlet_id,
          outlet_name: row.outlet_name,
          cost_center: row.cost_category_name || row.macro_group || 'altro',
          notes: row.suspend_reason,
          days_to_due: row.days_to_due,
          urgency: row.urgency,
          priority: row.priority,
          suppliers: {
            name: row.supplier_name,
            ragione_sociale: row.supplier_name,
            category: row.supplier_category || 'altro',
          },
          last_action_type: row.last_action_type,
          last_action_note: row.last_action_note,
          last_action_date: row.last_action_date,
        }));

        setPayables(enrichedPayables);

        // Calculate cash position from bank account balances
        const totalBalance = (accountsData || []).reduce((sum, acc) => sum + (acc.current_balance || 0), 0);
        setCashPosition(totalBalance);

      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [COMPANY_ID]);

  // Filter payables
  const filteredPayables = useMemo(() => {
    return payables.filter((p) => {
      const matchOutlet = !selectedOutlet || p.outlet_id === selectedOutlet;
      const isNotaCredito = (p.gross_amount || 0) < 0;
      const matchStatus = !selectedStatus
        || (selectedStatus === 'nota_credito' && isNotaCredito)
        || (selectedStatus === 'da_saldare' && !isNotaCredito && p.status !== 'pagato')
        || (selectedStatus !== 'nota_credito' && selectedStatus !== 'da_saldare' && p.status === selectedStatus);
      const matchSearch =
        !searchTerm ||
        p.invoice_number.includes(searchTerm) ||
        (p.suppliers?.ragione_sociale || suppliers?.name || '').toLowerCase().includes(searchTerm.toLowerCase());

      const dueDate = new Date(p.due_date);
      const matchDate = dueDate >= new Date(dateRange.start) && dueDate <= new Date(dateRange.end);

      return matchOutlet && matchStatus && matchSearch && matchDate;
    });
  }, [payables, selectedOutlet, selectedStatus, searchTerm, dateRange]);

  // Calculate KPIs
  const kpis = useMemo(() => {
    const totalDuePending = filteredPayables
      .filter((p) => p.status !== 'pagato' && new Date(p.due_date) <= today)
      .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

    const totalOverdue = filteredPayables
      .filter((p) => p.status === 'scaduto')
      .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

    const nextSevenDays = filteredPayables
      .filter((p) => {
        const d = new Date(p.due_date);
        return d >= today && d <= new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) && p.status !== 'pagato';
      })
      .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

    const totalSuspended = filteredPayables
      .filter((p) => p.status === 'contestato')
      .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

    const totalToPay = filteredPayables
      .filter((p) => p.status !== 'pagato')
      .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

    const cashShortfall = totalToPay > cashPosition ? totalToPay - cashPosition : 0;

    return {
      totalDuePending,
      totalOverdue,
      nextSevenDays,
      totalSuspended,
      totalToPay,
      cashShortfall,
      availableCash: cashPosition,
    };
  }, [filteredPayables, cashPosition, today]);

  // Monthly projection
  const monthlyData = useMemo(() => {
    const months = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(today);
      d.setMonth(d.getMonth() + i);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);

      const total = payables
        .filter((p) => {
          const dueDate = new Date(p.due_date);
          return dueDate >= monthStart && dueDate <= monthEnd && p.status !== 'pagato';
        })
        .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

      months.push({
        month: d.toLocaleDateString('it-IT', { month: 'short' }),
        scadenze: Math.round(total / 1000),
      });
    }
    return months;
  }, [payables, today]);

  // Category composition
  const categoryData = useMemo(() => {
    const cats = {};
    payables.forEach((p) => {
      const category = p.suppliers?.category || 'altro';
      cats[category] = (cats[category] || 0) + (p.amount_remaining || 0);
    });
    return Object.entries(cats).map(([name, value]) => ({
      name,
      value: Math.round(value / 1000),
    }));
  }, [payables]);

  // Aging analysis
  const agingAnalysis = useMemo(() => {
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    filteredPayables.forEach((p) => {
      const diff = Math.floor((today - new Date(p.due_date)) / (1000 * 60 * 60 * 24));
      if (diff <= 30) buckets['0-30'] += p.amount_remaining || 0;
      else if (diff <= 60) buckets['31-60'] += p.amount_remaining || 0;
      else if (diff <= 90) buckets['61-90'] += p.amount_remaining || 0;
      else buckets['90+'] += p.amount_remaining || 0;
    });
    return Object.entries(buckets).map(([range, value]) => ({
      range,
      value: Math.round(value / 1000),
    }));
  }, [filteredPayables, today]);

  // Format currency
  const formatCurrency = (num) =>
    new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(num);

  // Status color helper
  const getStatusColor = (status) => COLORI_STATO[status] || COLORI_STATO.da_pagare;

  // Handle payment record
  const handleMarkAsPaid = useCallback(
    async (payableId, amount, bankAccountId, bankReference) => {
      try {
        const { error } = await supabase
          .from('payables')
          .update({
            amount_paid: amount,
            payment_date: today.toISOString().split('T')[0],
            payment_bank_account_id: bankAccountId,
            status: amount >= (modals.payment.payable?.amount_remaining || 0) ? 'pagato' : 'parziale',
          })
          .eq('id', payableId);

        if (error) throw error;
        // Refresh - re-run fetchData
        window.location.reload();
      } catch (error) {
        console.error('Error marking payment:', error);
      }
    },
    [today, modals]
  );

  // Handle new invoice
  const handleCreateInvoice = useCallback(
    async (invoiceData) => {
      try {
        // 1. Create electronic invoice
        const { data: inv, error: invErr } = await supabase.from('electronic_invoices').insert([
          {
            company_id: COMPANY_ID,
            supplier_id: invoiceData.supplierId,
            invoice_number: invoiceData.invoiceNumber,
            invoice_date: invoiceData.invoiceDate,
            due_date: invoiceData.dueDate,
            total_amount: invoiceData.grossAmount,
            taxable_amount: invoiceData.netAmount || invoiceData.grossAmount * 0.8,
            vat_amount: invoiceData.vatAmount || invoiceData.grossAmount * 0.2,
            payment_method: invoiceData.paymentMethod,
            source: 'manual',
          },
        ]).select();

        if (invErr) throw invErr;

        // 2. Create payable entry
        await supabase.from('payables').insert([
          {
            company_id: COMPANY_ID,
            supplier_id: invoiceData.supplierId,
            invoice_number: invoiceData.invoiceNumber,
            invoice_date: invoiceData.invoiceDate,
            due_date: invoiceData.dueDate,
            original_due_date: invoiceData.dueDate,
            gross_amount: invoiceData.grossAmount,
            amount_remaining: invoiceData.grossAmount,
            payment_method: invoiceData.paymentMethod || 'bonifico',
            electronic_invoice_id: inv?.[0]?.id,
          },
        ]);

        window.location.reload();
      } catch (error) {
        console.error('Error creating invoice:', error);
      }
    },
    [modals]
  );

  // Handle new supplier
  const handleCreateSupplier = useCallback(
    async (supplierData) => {
      try {
        const { data } = await supabase
          .from('suppliers')
          .insert([
            {
              company_id: COMPANY_ID,
              ragione_sociale: supplierData.name,
              name: supplierData.name,
              partita_iva: supplierData.vat,
              codice_fiscale: supplierData.fiscal,
              iban: supplierData.iban,
              category: supplierData.category,
              payment_method: supplierData.paymentMethod || 'bonifico',
              payment_terms: supplierData.paymentTerms || 30,
              is_active: true,
            },
          ])
          .select();

        if (data) {
          setSuppliers([...suppliers, ...data]);
          setModals({ ...modals, supplier: { open: false, data: null } });
        }
      } catch (error) {
        console.error('Error creating supplier:', error);
      }
    },
    [suppliers, modals]
  );

  // Handle edit payment schedule
  const handleEditSchedule = useCallback(
    async (scheduleData) => {
      try {
        setIsSaving(true);
        const { error } = await supabase
          .from('payables')
          .update({
            gross_amount: scheduleData.amount,
            due_date: scheduleData.due_date,
            status: scheduleData.status,
            amount_remaining: (scheduleData.amount || 0) - (scheduleData.amount_paid || 0),
          })
          .eq('id', scheduleData.id);

        if (error) throw error;

        // Refresh data
        setModals({ ...modals, editSchedule: { open: false, schedule: null } });
        window.location.reload();
      } catch (error) {
        console.error('Error updating schedule:', error);
        setIsSaving(false);
      }
    },
    [modals]
  );

  // Handle delete payment schedule
  const handleDeleteSchedule = useCallback(
    async (scheduleId) => {
      try {
        setIsSaving(true);
        const { error } = await supabase
          .from('payables')
          .update({ status: 'annullato' })
          .eq('id', scheduleId);

        if (error) throw error;

        // Refresh data
        setModals({ ...modals, deleteConfirm: { open: false, scheduleId: null, invoiceNumber: null } });
        window.location.reload();
      } catch (error) {
        console.error('Error deleting schedule:', error);
        setIsSaving(false);
      }
    },
    [modals]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
          <p className="text-slate-600">Caricamento scadenzario...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-slate-900 flex items-center gap-3">
                <Clock className="w-10 h-10 text-indigo-600" />
                Scadenzario Smart
              </h1>
              <p className="text-slate-600 mt-1">Gestione intelligente scadenze fornitori</p>
            </div>
            <div className="text-right text-sm text-slate-500">
              Data riferimento: {today.toLocaleDateString('it-IT')}
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-blue-500">
              <div className="text-sm text-slate-600 font-medium">Totale da Pagare</div>
              <div className="text-2xl font-bold text-blue-600">{formatCurrency(kpis.totalToPay)}</div>
              <div className="text-xs text-slate-500 mt-1">pendente</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-red-500">
              <div className="text-sm text-slate-600 font-medium">Scaduto</div>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(kpis.totalOverdue)}</div>
              <div className="text-xs text-slate-500 mt-1">urgente</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-orange-500">
              <div className="text-sm text-slate-600 font-medium">Prossimi 7gg</div>
              <div className="text-2xl font-bold text-orange-600">{formatCurrency(kpis.nextSevenDays)}</div>
              <div className="text-xs text-slate-500 mt-1">in scadenza</div>
            </div>
            <div
              className={`bg-white rounded-xl shadow-sm p-4 border-l-4 ${
                kpis.cashShortfall > 0 ? 'border-red-500' : 'border-emerald-500'
              }`}
            >
              <div className="text-sm text-slate-600 font-medium">Disponibilità Cassa</div>
              <div
                className={`text-2xl font-bold ${
                  kpis.cashShortfall > 0 ? 'text-red-600' : 'text-emerald-600'
                }`}
              >
                {formatCurrency(kpis.availableCash)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {kpis.cashShortfall > 0 ? `Mancano: ${formatCurrency(kpis.cashShortfall)}` : 'Sufficiente'}
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6 border border-slate-200">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-slate-600" />
            <h3 className="font-semibold text-slate-900">Filtri</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-sm text-slate-600 font-medium block mb-2">Ricerca</label>
              <input
                type="text"
                placeholder="Fornitore o fattura..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-sm text-slate-600 font-medium block mb-2">Stato</label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Tutti</option>
                <option value="da_saldare">Da Saldare</option>
                <option value="da_pagare">Da Pagare</option>
                <option value="in_scadenza">In Scadenza</option>
                <option value="scaduto">Scaduto</option>
                <option value="parziale">Parziale</option>
                <option value="pagato">Pagato</option>
                <option value="nota_credito">Note di Credito</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-slate-600 font-medium block mb-2">Dal</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-sm text-slate-600 font-medium block mb-2">Al</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* View Mode Selector */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={() => setViewMode('timeline')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              viewMode === 'timeline'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Clock3 className="w-4 h-4 inline mr-2" />
            Timeline
          </button>
          <button
            onClick={() => setViewMode('charts')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              viewMode === 'charts'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <BarChart3 className="w-4 h-4 inline mr-2" />
            Grafici
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={() => setModals({ ...modals, invoice: { open: true, data: null } })}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nuova Fattura
          </button>
          <button
            onClick={() => setModals({ ...modals, supplier: { open: true, data: null } })}
            className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nuovo Fornitore
          </button>
        </div>

        {/* Timeline View - Payables Table */}
        {viewMode === 'timeline' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-900">Fornitore</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-900">Fattura</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-900">Scadenza</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-900">Importo</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-900">Pagato</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-900">Rimane</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-900">Stato</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-900">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredPayables.map((p) => {
                    const statusColor = getStatusColor(p.status);
                    const daysTo = Math.ceil(
                      (new Date(p.due_date) - today) / (1000 * 60 * 60 * 24)
                    );
                    return (
                      <tr key={p.id} className="hover:bg-slate-50 transition">
                        <td className="px-6 py-3 text-slate-900 font-medium">
                          {p.suppliers?.ragione_sociale || suppliers?.name || 'N/A'}
                        </td>
                        <td className="px-6 py-3 text-slate-600">{p.invoice_number}</td>
                        <td className="px-6 py-3 text-slate-600">
                          {new Date(p.due_date).toLocaleDateString('it-IT')}
                          <div className="text-xs text-slate-500">
                            {daysTo < 0 ? `${Math.abs(daysTo)}gg scaduto` : `${daysTo}gg`}
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right text-slate-900">
                          {formatCurrency(p.gross_amount)}
                        </td>
                        <td className="px-6 py-3 text-right text-emerald-600">
                          {formatCurrency(p.amount_paid || 0)}
                        </td>
                        <td className="px-6 py-3 text-right text-slate-900 font-semibold">
                          {formatCurrency(p.amount_remaining || 0)}
                        </td>
                        <td className="px-6 py-3">
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${statusColor.bg} ${statusColor.text}`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                setModals({ ...modals, payment: { open: true, payable: p } })
                              }
                              className="text-indigo-600 hover:text-indigo-700 font-medium text-xs"
                            >
                              Gestisci
                            </button>
                            <button
                              onClick={() =>
                                setModals({ ...modals, editSchedule: { open: true, schedule: p } })
                              }
                              className="text-blue-600 hover:text-blue-700 font-medium text-xs flex items-center gap-1"
                            >
                              <Edit2 className="w-3 h-3" />
                              Modifica
                            </button>
                            <button
                              onClick={() =>
                                setModals({
                                  ...modals,
                                  deleteConfirm: { open: true, scheduleId: p.id, invoiceNumber: p.invoice_number },
                                })
                              }
                              className="text-red-600 hover:text-red-700 font-medium text-xs flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              Cancella
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredPayables.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                Nessun pagamento trovato
              </div>
            )}
          </div>
        )}

        {/* Charts View */}
        {viewMode === 'charts' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Monthly Projection */}
            <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-4">Proiezione Scadenze (6 mesi)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} />
                  <XAxis dataKey="month" {...AXIS_STYLE} />
                  <YAxis {...AXIS_STYLE} />
                  <Tooltip content={<GlassTooltip />} />
                  <Bar dataKey="scadenze" fill="#6366f1" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Category Breakdown */}
            <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-4">Breakdown per Categoria</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: €${value}k`}
                    outerRadius={80}
                    dataKey="value"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444'][index % 5]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Aging Analysis */}
            <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-4">Analisi Aging</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={agingAnalysis}>
                  <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} />
                  <XAxis dataKey="range" {...AXIS_STYLE} />
                  <YAxis {...AXIS_STYLE} />
                  <Tooltip content={<GlassTooltip />} />
                  <Bar dataKey="value" fill="#ef4444" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Summary Stats */}
            <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-4">Statistiche</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                  <span className="text-slate-600">Numero Fatture</span>
                  <span className="font-bold text-slate-900">{filteredPayables.length}</span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                  <span className="text-slate-600">Fornitori</span>
                  <span className="font-bold text-slate-900">
                    {new Set(filteredPayables.map((p) => p.supplier_id)).size}
                  </span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                  <span className="text-slate-600">Importo Medio</span>
                  <span className="font-bold text-slate-900">
                    {formatCurrency(
                      filteredPayables.length > 0
                        ? filteredPayables.reduce((s, p) => s + (p.amount_remaining || 0), 0) /
                            filteredPayables.length
                        : 0
                    )}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Giorni Medi</span>
                  <span className="font-bold text-slate-900">
                    {Math.round(
                      filteredPayables.length > 0
                        ? filteredPayables.reduce(
                            (s, p) =>
                              s + Math.ceil((new Date(p.due_date) - today) / (1000 * 60 * 60 * 24)),
                            0
                          ) / filteredPayables.length
                        : 0
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Payment Modal */}
      <Modal
        isOpen={modals.payment.open}
        title={`Gestisci Pagamento: ${modals.payment.payable?.invoice_number || ''}`}
        onClose={() => setModals({ ...modals, payment: { open: false, payable: null } })}
      >
        {modals.payment.payable && (
          <PaymentModal
            payable={modals.payment.payable}
            bankAccounts={bankAccounts}
            onSave={handleMarkAsPaid}
          />
        )}
      </Modal>

      {/* Invoice Modal */}
      <Modal
        isOpen={modals.invoice.open}
        title="Nuova Fattura Fornitore"
        onClose={() => setModals({ ...modals, invoice: { open: false, data: null } })}
      >
        <InvoiceModal suppliers={suppliers} onSave={handleCreateInvoice} />
      </Modal>

      {/* Supplier Modal */}
      <Modal
        isOpen={modals.supplier.open}
        title="Nuovo Fornitore"
        onClose={() => setModals({ ...modals, supplier: { open: false, data: null } })}
      >
        <SupplierModal onSave={handleCreateSupplier} />
      </Modal>

      {/* Edit Schedule Modal */}
      <Modal
        isOpen={modals.editSchedule.open}
        title={`Modifica Scadenza: ${modals.editSchedule.schedule?.invoice_number || ''}`}
        onClose={() => setModals({ ...modals, editSchedule: { open: false, schedule: null } })}
        onSave={() => {
          if (modals.editSchedule.schedule) {
            handleEditSchedule(modals.editSchedule.schedule);
          }
        }}
        isSaving={isSaving}
      >
        {modals.editSchedule.schedule && (
          <EditScheduleModal
            schedule={modals.editSchedule.schedule}
            onUpdate={(updatedSchedule) =>
              setModals({ ...modals, editSchedule: { open: true, schedule: updatedSchedule } })
            }
          />
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <div>
        {modals.deleteConfirm.open && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
              <div className="p-6 border-b border-slate-200">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  Conferma Cancellazione
                </h2>
              </div>
              <div className="p-6">
                <p className="text-slate-700 mb-2">
                  Sei sicuro di voler cancellare la scadenza <strong>{modals.deleteConfirm.invoiceNumber}</strong>?
                </p>
                <p className="text-sm text-slate-500">
                  Questa azione non pu essere annullata.
                </p>
              </div>
              <div className="border-t border-slate-200 px-6 py-4 flex justify-end gap-3">
                <button
                  onClick={() =>
                    setModals({ ...modals, deleteConfirm: { open: false, scheduleId: null, invoiceNumber: null } })
                  }
                  className="px-4 py-2 text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition"
                >
                  Annulla
                </button>
                <button
                  onClick={() => handleDeleteSchedule(modals.deleteConfirm.scheduleId)}
                  disabled={isSaving}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50"
                >
                  {isSaving ? 'Cancellazione...' : 'Cancella'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Payment Modal Component
const PaymentModal = ({ payable, bankAccounts, onSave }) => {
  const [formData, setFormData] = useState({
    amount: payable.amount_remaining || 0,
    bankAccountId: '',
    bankReference: '',
  });

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Fornitore: {payable.suppliers?.ragione_sociale || suppliers?.name || 'N/A'}
        </label>
        <p className="text-sm text-slate-600">
          Importo totale: {new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(payable.gross_amount)}
        </p>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Importo da Pagare
        </label>
        <input
          type="number"
          step="0.01"
          value={formData.amount}
          onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Conto Bancario
        </label>
        <select
          value={formData.bankAccountId}
          onChange={(e) => setFormData({ ...formData, bankAccountId: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Seleziona conto...</option>
          {bankAccounts.map((ba) => (
            <option key={ba.id} value={ba.id}>
              {ba.account_holder} - {ba.iban?.slice(-4)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Riferimento Bancario
        </label>
        <input
          type="text"
          placeholder="es. Causale pagamento"
          value={formData.bankReference}
          onChange={(e) => setFormData({ ...formData, bankReference: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <button
        onClick={() => onSave(payable.id, formData.amount, formData.bankAccountId, formData.bankReference)}
        className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium"
      >
        Registra Pagamento
      </button>
    </div>
  );
};

// Invoice Modal Component
const InvoiceModal = ({ suppliers, onSave }) => {
  const [formData, setFormData] = useState({
    supplierId: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    grossAmount: 0,
    paymentMethod: 'bonifico',
  });

  return (
    <div className="space-y-4 max-h-96 overflow-y-auto">
      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">Fornitore</label>
        <select
          value={formData.supplierId}
          onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Seleziona fornitore...</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Numero Fattura
        </label>
        <input
          type="text"
          value={formData.invoiceNumber}
          onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-slate-900 block mb-2">
            Data Fattura
          </label>
          <input
            type="date"
            value={formData.invoiceDate}
            onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-900 block mb-2">
            Scadenza
          </label>
          <input
            type="date"
            value={formData.dueDate}
            onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Importo Lordo
        </label>
        <input
          type="number"
          step="0.01"
          value={formData.grossAmount}
          onChange={(e) => setFormData({ ...formData, grossAmount: parseFloat(e.target.value) })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Metodo Pagamento
        </label>
        <select
          value={formData.paymentMethod}
          onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={() => onSave(formData)}
        className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
      >
        Crea Fattura
      </button>
    </div>
  );
};

// Edit Schedule Modal Component
const EditScheduleModal = ({ schedule, onUpdate }) => {
  const [formData, setFormData] = useState({
    id: schedule.id,
    amount: schedule.gross_amount || 0,
    due_date: schedule.due_date || '',
    status: schedule.status || 'da_pagare',
    note: schedule.notes || '',
  });

  const statusOptions = ['da_pagare', 'pagato', 'parziale', 'scaduto', 'in_scadenza', 'contestato'];

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Fornitore: {schedule.suppliers?.ragione_sociale || 'N/A'}
        </label>
        <p className="text-xs text-slate-500 mb-3">
          Fattura: {schedule.invoice_number}
        </p>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Importo
        </label>
        <input
          type="number"
          step="0.01"
          value={formData.amount}
          onChange={(e) => {
            const newVal = parseFloat(e.target.value);
            setFormData({ ...formData, amount: newVal });
            onUpdate({ ...schedule, gross_amount: newVal });
          }}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Scadenza
        </label>
        <input
          type="date"
          value={formData.due_date}
          onChange={(e) => {
            setFormData({ ...formData, due_date: e.target.value });
            onUpdate({ ...schedule, due_date: e.target.value });
          }}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Stato
        </label>
        <select
          value={formData.status}
          onChange={(e) => {
            setFormData({ ...formData, status: e.target.value });
            onUpdate({ ...schedule, status: e.target.value });
          }}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Note
        </label>
        <textarea
          value={formData.note}
          onChange={(e) => {
            setFormData({ ...formData, note: e.target.value });
            onUpdate({ ...schedule, notes: e.target.value });
          }}
          rows="3"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          placeholder="Note aggiuntive..."
        />
      </div>
    </div>
  );
};

// Supplier Modal Component
const SupplierModal = ({ onSave }) => {
  const [formData, setFormData] = useState({
    name: '',
    vat: '',
    fiscal: '',
    iban: '',
    category: 'merce',
    paymentMethod: 'bonifico',
    paymentTerms: 30,
  });

  return (
    <div className="space-y-4 max-h-96 overflow-y-auto">
      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Ragione Sociale
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-slate-900 block mb-2">
            Partita IVA
          </label>
          <input
            type="text"
            value={formData.vat}
            onChange={(e) => setFormData({ ...formData, vat: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-900 block mb-2">
            Cod. Fiscale
          </label>
          <input
            type="text"
            value={formData.fiscal}
            onChange={(e) => setFormData({ ...formData, fiscal: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">IBAN</label>
        <input
          type="text"
          value={formData.iban}
          onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-slate-900 block mb-2">
            Categoria
          </label>
          <select
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {SUPPLIER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-900 block mb-2">
            Metodo Pag.
          </label>
          <select
            value={formData.paymentMethod}
            onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-900 block mb-2">
          Termini Pagamento (gg)
        </label>
        <input
          type="number"
          value={formData.paymentTerms}
          onChange={(e) => setFormData({ ...formData, paymentTerms: parseInt(e.target.value) })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <button
        onClick={() => onSave(formData)}
        className="w-full px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition font-medium"
      >
        Crea Fornitore
      </button>
    </div>
  );
};

export default ScadenzarioSmart;
