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
  CheckSquare,
  Square,
  Settings,
  Send,
  Ban,
  Wallet,
  Repeat,
  ChevronRight,
  Landmark,
  Building2,
} from 'lucide-react';
import CostiRicorrenti from '../components/CostiRicorrenti';
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

// --- Etichette metodi pagamento (da fatture SDI) ---
const paymentMethodLabels = {
  bonifico_ordinario: 'Bonifico ordinario',
  bonifico_urgente: 'Bonifico urgente',
  bonifico_sepa: 'Bonifico SEPA',
  bonifico: 'Bonifico',
  riba_30: 'RiBa 30 gg',
  riba_60: 'RiBa 60 gg',
  riba_90: 'RiBa 90 gg',
  riba_120: 'RiBa 120 gg',
  riba: 'RiBa',
  rid: 'RID',
  sdd_core: 'SDD Core',
  sdd_b2b: 'SDD B2B',
  rimessa_diretta: 'Rimessa diretta',
  carta_credito: 'Carta di credito',
  carta_debito: 'Carta di debito',
  carta: 'Carta',
  assegno: 'Assegno',
  contanti: 'Contanti',
  compensazione: 'Compensazione',
  f24: 'F24',
  mav: 'MAV',
  rav: 'RAV',
  bollettino_postale: 'Bollettino postale',
  altro: 'Altro',
};

// --- Raggruppamento metodi pagamento per KPI ---
const paymentGroups = [
  { label: 'Bonifici', key: 'bonifici', methods: ['bonifico_ordinario', 'bonifico_urgente', 'bonifico_sepa', 'bonifico'] },
  { label: 'RiBa', key: 'riba', methods: ['riba_30', 'riba_60', 'riba_90', 'riba_120', 'riba'] },
  { label: 'Addebito diretto', key: 'addebito', methods: ['rid', 'sdd_core', 'sdd_b2b'] },
  { label: 'Altro', key: 'altro', methods: ['rimessa_diretta', 'carta_credito', 'carta_debito', 'carta', 'assegno', 'contanti', 'compensazione', 'f24', 'mav', 'rav', 'bollettino_postale', 'altro'] },
];

// RIBA maturity days lookup
const RIBA_DAYS = { riba_30: 30, riba_60: 60, riba_90: 90, riba_120: 120 };

// --- StatusPill con etichette italiane ---
const statusLabels = {
  scaduto: 'Scaduto',
  in_scadenza: 'In scadenza',
  da_pagare: 'Da pagare',
  parziale: 'Parziale',
  sospeso: 'Sospeso',
  rimandato: 'Rimandato',
  pagato: 'Pagato',
  annullato: 'Annullato',
  contestato: 'Contestato',
};

function StatusPill({ status }) {
  const colors = COLORI_STATO[status] || COLORI_STATO.da_pagare;
  const label = statusLabels[status] || status;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
      {label}
    </span>
  );
}

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

  const [section, setSection] = useState('scadenze'); // 'scadenze' | 'ricorrenti'
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

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [paymentPlan, setPaymentPlan] = useState({});
  const [emailRecipients, setEmailRecipients] = useState('');
  const [showEmailConfig, setShowEmailConfig] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const [selectedMethodGroup, setSelectedMethodGroup] = useState(null); // filtro per gruppo metodo pagamento
  const [supplierDetail, setSupplierDetail] = useState(null); // popup dettaglio fornitore

  // Selection helpers for bulk payment workflow
  const toggleSelect = (id, payable) => {
    const next = new Set(selectedIds);
    const nextPlan = { ...paymentPlan };
    if (next.has(id)) {
      next.delete(id);
      delete nextPlan[id];
    } else {
      next.add(id);
      nextPlan[id] = { bankId: '', type: 'saldo', amount: payable.amount_remaining || 0, note: '' };
    }
    setSelectedIds(next);
    setPaymentPlan(nextPlan);
  };

  const toggleSelectAll = () => {
    const nonPaid = filteredPayables.filter(p => p.status !== 'pagato' && (p.gross_amount || 0) >= 0);
    if (selectedIds.size === nonPaid.length) {
      setSelectedIds(new Set());
      setPaymentPlan({});
    } else {
      const next = new Set();
      const nextPlan = {};
      nonPaid.forEach(p => {
        next.add(p.id);
        nextPlan[p.id] = paymentPlan[p.id] || { bankId: '', type: 'saldo', amount: p.amount_remaining || 0, note: '' };
      });
      setSelectedIds(next);
      setPaymentPlan(nextPlan);
    }
  };

  const updatePlan = (id, field, value) => {
    setPaymentPlan(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));
  };

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

  // Compute bank balances with real-time deductions from payment plan
  const bankBalances = useMemo(() => {
    const balances = {};
    bankAccounts.forEach(ba => { balances[ba.id] = ba.current_balance || 0; });
    Object.values(paymentPlan).forEach(plan => {
      if (plan.bankId && balances[plan.bankId] !== undefined) {
        balances[plan.bankId] -= (plan.amount || 0);
      }
    });
    return balances;
  }, [bankAccounts, paymentPlan]);

  const hasNegativeBalance = useMemo(() => {
    return Object.values(bankBalances).some(b => b < 0);
  }, [bankBalances]);

  const selectedTotal = useMemo(() => {
    return Array.from(selectedIds).reduce((sum, id) => {
      const plan = paymentPlan[id];
      return sum + (plan?.amount || 0);
    }, 0);
  }, [selectedIds, paymentPlan]);

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

        // Load email recipients from company settings
        const { data: companyData } = await supabase
          .from('companies')
          .select('settings')
          .eq('id', COMPANY_ID)
          .single();
        if (companyData?.settings?.email_scadenzario) {
          setEmailRecipients(companyData.settings.email_scadenzario);
        }

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

      // Filtro per gruppo metodo pagamento
      let matchMethodGroup = true;
      if (selectedMethodGroup) {
        const group = paymentGroups.find(g => g.key === selectedMethodGroup);
        if (group) {
          matchMethodGroup = group.methods.includes(p.payment_method);
        }
      }

      return matchOutlet && matchStatus && matchSearch && matchDate && matchMethodGroup;
    });
  }, [payables, selectedOutlet, selectedStatus, searchTerm, dateRange, selectedMethodGroup]);

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

  // Totali per gruppo metodo pagamento (per KPI chips)
  const methodGroupTotals = useMemo(() => {
    const activePays = payables.filter(p => p.status !== 'pagato' && p.status !== 'annullato');
    return paymentGroups.map(group => {
      const groupPayables = activePays.filter(p => group.methods.includes(p.payment_method));
      return {
        ...group,
        total: groupPayables.reduce((sum, p) => sum + (p.amount_remaining || 0), 0),
        count: groupPayables.length,
      };
    });
  }, [payables]);

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

  // Grouped by supplier
  const groupedBySupplier = useMemo(() => {
    const groups = {};
    filteredPayables.forEach(p => {
      const name = p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A';
      if (!groups[name]) groups[name] = { items: [], total: 0, paid: 0, remaining: 0 };
      groups[name].items.push(p);
      groups[name].total += p.gross_amount || 0;
      groups[name].paid += p.amount_paid || 0;
      groups[name].remaining += p.amount_remaining || 0;
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredPayables]);

  // Grouped by month
  const groupedByMonth = useMemo(() => {
    const groups = {};
    filteredPayables.forEach(p => {
      const d = p.due_date ? new Date(p.due_date) : null;
      const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'N/D';
      const label = d ? d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : 'Senza data';
      if (!groups[key]) groups[key] = { label, items: [], total: 0, paid: 0, remaining: 0 };
      groups[key].items.push(p);
      groups[key].total += p.gross_amount || 0;
      groups[key].paid += p.amount_paid || 0;
      groups[key].remaining += p.amount_remaining || 0;
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredPayables]);

  // Format currency
  const formatCurrency = (num) =>
    new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(num);

  // Render inline payment controls for a selected row
  const renderPaymentRow = (p, colSpan = 9) => {
    if (!selectedIds.has(p.id) || !paymentPlan[p.id]) return null;
    const plan = paymentPlan[p.id];
    return (
      <tr className="bg-indigo-50 border-b border-indigo-100">
        <td colSpan={colSpan} className="px-6 py-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Banca</label>
              <select value={plan.bankId} onChange={e => updatePlan(p.id, 'bankId', e.target.value)}
                className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-52 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Seleziona banca...</option>
                {bankAccounts.map(ba => (
                  <option key={ba.id} value={ba.id}>{ba.bank_name} ({formatCurrency(bankBalances[ba.id] || 0)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Tipo</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-300">
                <button onClick={() => { updatePlan(p.id, 'type', 'saldo'); updatePlan(p.id, 'amount', p.amount_remaining || 0); }}
                  className={`px-3 py-1.5 text-sm font-medium transition ${plan.type === 'saldo' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  Saldo
                </button>
                <button onClick={() => updatePlan(p.id, 'type', 'parziale')}
                  className={`px-3 py-1.5 text-sm font-medium transition ${plan.type === 'parziale' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  Parziale
                </button>
              </div>
            </div>
            {plan.type === 'parziale' && (
              <>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Importo</label>
                  <input type="number" step="0.01" value={plan.amount}
                    onChange={e => updatePlan(p.id, 'amount', Math.min(parseFloat(e.target.value) || 0, p.amount_remaining || 0))}
                    className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-28 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="flex-1 min-w-48">
                  <label className="text-xs text-slate-500 block mb-1">Note</label>
                  <input type="text" value={plan.note} onChange={e => updatePlan(p.id, 'note', e.target.value)}
                    placeholder="Motivo parziale..." className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  };

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

  // Confirm and process bulk payments
  const confirmPayments = async () => {
    if (hasNegativeBalance || selectedIds.size === 0) return;
    setIsSaving(true);
    const results = [];
    const today = new Date().toISOString().split('T')[0];

    try {
      for (const id of selectedIds) {
        const plan = paymentPlan[id];
        const payable = payables.find(p => p.id === id);
        if (!plan || !payable) continue;

        const newPaid = (payable.amount_paid || 0) + plan.amount;
        const newStatus = plan.type === 'saldo' ? 'pagato' : 'parziale';
        const bank = bankAccounts.find(b => b.id === plan.bankId);

        const { error: updateError } = await supabase.from('payables').update({
          amount_paid: newPaid,
          amount_remaining: payable.gross_amount - newPaid,
          payment_date: today,
          payment_bank_account_id: plan.bankId || null,
          status: newStatus,
        }).eq('id', id);

        if (updateError) throw updateError;

        const { error: actionError } = await supabase.from('payable_actions').insert({
          payable_id: id,
          action_type: newStatus === 'pagato' ? 'pagamento' : 'pagamento_parziale',
          old_status: payable.status,
          new_status: newStatus,
          amount: plan.amount,
          bank_account_id: plan.bankId || null,
          note: plan.note || null,
        });

        if (actionError) throw actionError;

        results.push({
          fornitore: payable.suppliers?.ragione_sociale || payable.suppliers?.name || 'N/A',
          fattura: payable.invoice_number,
          importo: plan.amount,
          banca: bank?.bank_name || 'N/D',
          iban: bank?.iban || '',
          tipo: plan.type === 'saldo' ? 'SALDO' : 'PARZIALE',
          note: plan.note || '',
        });
      }

      // Build email summary
      const bankTotals = {};
      results.forEach(r => {
        bankTotals[r.banca] = (bankTotals[r.banca] || 0) + r.importo;
      });

      const emailBody = `RIEPILOGO PAGAMENTI - ${new Date().toLocaleDateString('it-IT')}\n\n` +
        results.map((r, i) =>
          `${i+1}. ${r.fornitore}\n   Fattura: ${r.fattura} | ${r.tipo} | ${new Intl.NumberFormat('it-IT', {style:'currency',currency:'EUR'}).format(r.importo)}\n   Banca: ${r.banca} (${r.iban})${r.note ? '\n   Note: ' + r.note : ''}`
        ).join('\n\n') +
        `\n\n--- TOTALI PER BANCA ---\n` +
        Object.entries(bankTotals).map(([b, t]) => `${b}: ${new Intl.NumberFormat('it-IT', {style:'currency',currency:'EUR'}).format(t)}`).join('\n') +
        `\n\nTOTALE COMPLESSIVO: ${new Intl.NumberFormat('it-IT', {style:'currency',currency:'EUR'}).format(results.reduce((s,r) => s + r.importo, 0))}`;

      setConfirmResult({ results, emailBody });
      setSelectedIds(new Set());
      setPaymentPlan({});
      setIsSaving(false);

      // Reload data
      window.location.reload();
    } catch (error) {
      console.error('Error confirming payments:', error);
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
          <p className="text-slate-600 font-medium">Caricamento scadenzario...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Sticky Bank Bar - Glassmorphism */}
      <div className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200/50 px-6 py-3 transition-all duration-200">
        <div className="max-w-7xl mx-auto">
          {bankAccounts.length > 0 ? (
            <div className="flex items-center gap-3 overflow-x-auto pb-1">
              {bankAccounts.map(ba => {
                const bal = bankBalances[ba.id] || 0;
                const orig = ba.current_balance || 0;
                const used = orig - bal;
                const isNeg = bal < 0;
                const percentUsed = orig > 0 ? (used / orig) * 100 : 0;
                return (
                  <div
                    key={ba.id}
                    className={`flex-shrink-0 px-4 py-2.5 rounded-xl border transition-all duration-200 ${
                      isNeg
                        ? 'bg-red-50/50 border-red-300/50'
                        : 'bg-slate-50/50 border-slate-200/50'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-600">{ba.bank_name}</div>
                    <div className={`text-sm font-bold mt-0.5 ${isNeg ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatCurrency(bal)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-amber-50/50 border border-amber-200/50 rounded-xl px-4 py-2.5 text-xs text-amber-700 flex items-center gap-2 w-fit transition-all duration-200">
              <Wallet className="w-4 h-4 flex-shrink-0" />
              <span className="font-medium">Nessun conto bancario. Aggiungi dalla sezione Banche.</span>
            </div>
          )}
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          {/* Clean Header - Single Line */}
          <div className="flex items-center justify-between mb-8 transition-all duration-200">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Scadenzario</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-500">
                {today.toLocaleDateString('it-IT')}
              </span>
              <button
                onClick={() => setShowEmailConfig(true)}
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-indigo-600 transition-all duration-200"
                title="Configura email"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* KPI Cards - Horizontal Strip with Modern Design */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {/* Total to Pay */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 hover:shadow-md transition-all duration-200 hover:scale-[1.02]">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Da Pagare</div>
                  <div className="text-2xl font-bold text-slate-900 mt-2 font-mono">{formatCurrency(kpis.totalToPay)}</div>
                </div>
                <div className="p-2.5 bg-blue-100/50 rounded-lg">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                </div>
              </div>
              <div className="border-t-4 border-blue-500 mt-3 pt-2"></div>
            </div>

            {/* Overdue */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 hover:shadow-md transition-all duration-200 hover:scale-[1.02]">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Scaduto</div>
                  <div className="text-2xl font-bold text-red-600 mt-2 font-mono">{formatCurrency(kpis.totalOverdue)}</div>
                </div>
                <div className="p-2.5 bg-red-100/50 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
              </div>
              <div className="border-t-4 border-red-500 mt-3 pt-2"></div>
            </div>

            {/* Next 7 Days */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 hover:shadow-md transition-all duration-200 hover:scale-[1.02]">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Prossimi 7gg</div>
                  <div className="text-2xl font-bold text-orange-600 mt-2 font-mono">{formatCurrency(kpis.nextSevenDays)}</div>
                </div>
                <div className="p-2.5 bg-orange-100/50 rounded-lg">
                  <Clock className="w-5 h-5 text-orange-600" />
                </div>
              </div>
              <div className="border-t-4 border-orange-500 mt-3 pt-2"></div>
            </div>

            {/* Cash Position */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 hover:shadow-md transition-all duration-200 hover:scale-[1.02]">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Cassa</div>
                  <div
                    className={`text-2xl font-bold mt-2 font-mono ${
                      kpis.cashShortfall > 0 ? 'text-red-600' : 'text-emerald-600'
                    }`}
                  >
                    {formatCurrency(kpis.availableCash)}
                  </div>
                </div>
                <div
                  className={`p-2.5 rounded-lg ${
                    kpis.cashShortfall > 0 ? 'bg-red-100/50' : 'bg-emerald-100/50'
                  }`}
                >
                  <Wallet className={`w-5 h-5 ${kpis.cashShortfall > 0 ? 'text-red-600' : 'text-emerald-600'}`} />
                </div>
              </div>
              {kpis.cashShortfall > 0 && (
                <>
                  <div className="mt-3 bg-red-50 rounded-lg p-2">
                    <div className="text-xs text-red-700 font-semibold">Deficit: {formatCurrency(kpis.cashShortfall)}</div>
                    <div className="w-full bg-red-200 rounded-full h-1.5 mt-2">
                      <div
                        className="bg-red-600 h-1.5 rounded-full"
                        style={{ width: `${Math.min((kpis.totalToPay / (kpis.availableCash + kpis.cashShortfall)) * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </>
              )}
              <div className={`border-t-4 mt-3 pt-2 ${kpis.cashShortfall > 0 ? 'border-red-500' : 'border-emerald-500'}`}></div>
            </div>
          </div>

        {/* KPI Modalità Pagamento - Clickable Chips */}
        <div className="flex flex-wrap gap-2 mb-8">
          {methodGroupTotals.map(group => {
            const isActive = selectedMethodGroup === group.key;
            return (
              <button
                key={group.key}
                onClick={() => setSelectedMethodGroup(isActive ? null : group.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                }`}
              >
                <span>{group.label}</span>
                <span className={`font-bold ${isActive ? 'text-white' : 'text-slate-900'}`}>
                  {formatCurrency(group.total)}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {group.count}
                </span>
              </button>
            );
          })}
          {selectedMethodGroup && (
            <button
              onClick={() => setSelectedMethodGroup(null)}
              className="flex items-center gap-1 px-3 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-all duration-200"
            >
              <X className="w-3.5 h-3.5" /> Rimuovi filtro
            </button>
          )}
        </div>

        {/* Tab Scadenze / Costi Ricorrenti - Underline Style */}
        <div className="flex gap-6 mb-8 border-b border-slate-200 transition-all duration-200">
          {[
            { key: 'scadenze', icon: Clock3, label: 'Scadenze SDI' },
            { key: 'ricorrenti', icon: Repeat, label: 'Costi Ricorrenti' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setSection(t.key)}
              className={`px-1 py-3 text-sm font-semibold flex items-center gap-2 transition-all duration-200 border-b-2 ${
                section === t.key
                  ? 'text-indigo-600 border-indigo-600'
                  : 'text-slate-600 border-transparent hover:text-slate-900'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {section === 'ricorrenti' ? (
          <CostiRicorrenti />
        ) : (
          <div>
            {/* Filters - Single Row, Smarter Layout */}
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4 mb-8 transition-all duration-200">
              {/* Search + Status in one row */}
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  placeholder="Cerca fornitore o fattura..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                />
              </div>

              {/* Date Range - Inline Style */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                />
                <span className="text-slate-400 font-medium">—</span>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                />
              </div>

              {/* Status Filter */}
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white transition-all duration-200 flex-shrink-0"
              >
                <option value="">Tutti gli stati</option>
                <option value="da_saldare">Da Saldare</option>
                <option value="da_pagare">Da Pagare</option>
                <option value="in_scadenza">In Scadenza</option>
                <option value="scaduto">Scaduto</option>
                <option value="parziale">Parziale</option>
                <option value="pagato">Pagato</option>
                <option value="nota_credito">Note di Credito</option>
              </select>

              {/* View Mode Icons - Right Aligned */}
              <div className="flex items-center gap-1 border-l border-slate-200 pl-4 flex-shrink-0">
                {[
                  { key: 'timeline', icon: Clock3, label: 'Timeline' },
                  { key: 'fornitore', icon: Filter, label: 'Per Fornitore' },
                  { key: 'mese', icon: Calendar, label: 'Per Mese' },
                  { key: 'charts', icon: BarChart3, label: 'Grafici' },
                ].map(v => (
                  <button
                    key={v.key}
                    onClick={() => setViewMode(v.key)}
                    className={`p-2.5 rounded-lg transition-all duration-200 ${
                      viewMode === v.key
                        ? 'bg-indigo-100 text-indigo-600'
                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                    }`}
                    title={v.label}
                  >
                    <v.icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons - Top Right of Content */}
            <div className="flex gap-2 mb-6 justify-end">
              <button
                onClick={() => setModals({ ...modals, invoice: { open: true, data: null } })}
                className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-all duration-200 flex items-center gap-2 hover:shadow-md"
              >
                <Plus className="w-4 h-4" />
                Nuova Fattura
              </button>
              <button
                onClick={() => setModals({ ...modals, supplier: { open: true, data: null } })}
                className="px-4 py-2.5 bg-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-300 transition-all duration-200 flex items-center gap-2 hover:shadow-md"
              >
                <Plus className="w-4 h-4" />
                Fornitore
              </button>
            </div>

            {/* Timeline View - Clean Table */}
            {viewMode === 'timeline' && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-200">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                      <tr>
                        <th className="px-4 py-3 text-center w-12">
                          <button
                            onClick={toggleSelectAll}
                            className="text-slate-400 hover:text-indigo-600 transition-all duration-200"
                            title="Seleziona tutto"
                          >
                            {selectedIds.size > 0 ? <CheckSquare size={18} className="text-indigo-600" /> : <Square size={18} />}
                          </button>
                        </th>
                        <th className="px-6 py-3 text-left font-semibold text-slate-900 text-xs uppercase tracking-wider">Fornitore</th>
                        <th className="px-6 py-3 text-left font-semibold text-slate-900 text-xs uppercase tracking-wider">Fattura</th>
                        <th className="px-6 py-3 text-left font-semibold text-slate-900 text-xs uppercase tracking-wider">Scadenza</th>
                        <th className="px-6 py-3 text-right font-semibold text-slate-900 text-xs uppercase tracking-wider">Importo</th>
                        <th className="px-6 py-3 text-right font-semibold text-slate-900 text-xs uppercase tracking-wider">Pagato</th>
                        <th className="px-6 py-3 text-right font-semibold text-slate-900 text-xs uppercase tracking-wider">Rimane</th>
                        <th className="px-6 py-3 text-left font-semibold text-slate-900 text-xs uppercase tracking-wider">Stato</th>
                        <th className="px-6 py-3 text-center font-semibold text-slate-900 text-xs uppercase tracking-wider">Metodo</th>
                        <th className="px-6 py-3 text-center font-semibold text-slate-900 text-xs uppercase tracking-wider">Azioni</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredPayables.map((p, idx) => {
                        const statusColor = getStatusColor(p.status);
                        const daysTo = Math.ceil(
                          (new Date(p.due_date) - today) / (1000 * 60 * 60 * 24)
                        );
                        const isOverdue = daysTo < 0;
                        return (
                          <React.Fragment key={p.id}>
                            <tr
                              className={`transition-all duration-200 ${
                                idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
                              } ${
                                selectedIds.has(p.id) ? 'bg-indigo-50 border-l-4 border-indigo-500' : ''
                              } ${
                                p.status === 'pagato' ? 'opacity-60' : ''
                              } hover:bg-slate-100/50`}
                            >
                              <td className="px-4 py-3.5 text-center">
                                {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && (
                                  <button
                                    onClick={() => toggleSelect(p.id, p)}
                                    className={`transition-all duration-200 ${
                                      selectedIds.has(p.id)
                                        ? 'text-indigo-600'
                                        : 'text-slate-300 hover:text-slate-500'
                                    }`}
                                    title="Seleziona"
                                  >
                                    {selectedIds.has(p.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                )}
                              </td>
                              <td className="px-6 py-3.5 text-slate-900 font-semibold">
                                <button
                                  onClick={() => {
                                    const sup = suppliers.find(s =>
                                      s.ragione_sociale === (p.suppliers?.ragione_sociale || p.suppliers?.name) ||
                                      s.name === (p.suppliers?.name || p.suppliers?.ragione_sociale)
                                    );
                                    setSupplierDetail(sup || { ragione_sociale: p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A' });
                                  }}
                                  className="text-left hover:text-indigo-600 hover:underline transition-colors"
                                  title="Clicca per dettagli fornitore"
                                >
                                  {p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A'}
                                </button>
                              </td>
                              <td className="px-6 py-3.5 text-slate-600 font-mono text-xs">{p.invoice_number}</td>
                              <td className="px-6 py-3.5">
                                <div className="text-slate-900 font-medium">
                                  {new Date(p.due_date).toLocaleDateString('it-IT')}
                                </div>
                                <div
                                  className={`text-xs font-semibold inline-block mt-1 px-2 py-1 rounded-full ${
                                    isOverdue
                                      ? 'bg-red-100 text-red-700'
                                      : daysTo <= 7
                                      ? 'bg-orange-100 text-orange-700'
                                      : 'bg-emerald-100 text-emerald-700'
                                  }`}
                                >
                                  {isOverdue ? `${Math.abs(daysTo)}gg scaduto` : `${daysTo}gg`}
                                </div>
                              </td>
                              <td className="px-6 py-3.5 text-right text-slate-900 font-mono font-semibold">
                                {formatCurrency(p.gross_amount)}
                              </td>
                              <td className="px-6 py-3.5 text-right text-emerald-600 font-mono font-semibold">
                                {formatCurrency(p.amount_paid || 0)}
                              </td>
                              <td className="px-6 py-3.5 text-right text-slate-900 font-mono font-bold">
                                {formatCurrency(p.amount_remaining || 0)}
                              </td>
                              <td className="px-6 py-3.5">
                                <StatusPill status={p.status} />
                              </td>
                              <td className="px-6 py-3.5 text-xs text-center text-slate-500">
                                {paymentMethodLabels[p.payment_method] || p.payment_method || '—'}
                              </td>
                              <td className="px-6 py-3.5 text-center">
                                <div className="flex justify-center gap-1">
                                  <button
                                    onClick={() =>
                                      setModals({ ...modals, editSchedule: { open: true, schedule: p } })
                                    }
                                    className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 hover:text-blue-700 transition-all duration-200"
                                    title="Modifica"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() =>
                                      setModals({
                                        ...modals,
                                        deleteConfirm: { open: true, scheduleId: p.id, invoiceNumber: p.invoice_number },
                                      })
                                    }
                                    className="p-1.5 hover:bg-red-100 rounded-lg text-red-600 hover:text-red-700 transition-all duration-200"
                                    title="Cancella"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {selectedIds.has(p.id) && paymentPlan[p.id] && (
                              <tr className="bg-indigo-50/50 border-b border-indigo-200">
                                <td colSpan={10} className="px-6 py-4">
                                  <div className="flex items-center gap-4 flex-wrap">
                                    <div>
                                      <label className="text-xs font-semibold text-slate-600 block mb-2">Banca</label>
                                      <select
                                        value={paymentPlan[p.id].bankId}
                                        onChange={e => updatePlan(p.id, 'bankId', e.target.value)}
                                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-52 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                                      >
                                        <option value="">Seleziona banca...</option>
                                        {bankAccounts.map(ba => (
                                          <option key={ba.id} value={ba.id}>
                                            {ba.bank_name} ({formatCurrency(bankBalances[ba.id] || 0)})
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="text-xs font-semibold text-slate-600 block mb-2">Tipo</label>
                                      <div className="flex rounded-lg overflow-hidden border border-slate-300">
                                        <button
                                          onClick={() => {
                                            updatePlan(p.id, 'type', 'saldo');
                                            updatePlan(p.id, 'amount', p.amount_remaining || 0);
                                          }}
                                          className={`px-4 py-2 text-sm font-medium transition-all duration-200 ${
                                            paymentPlan[p.id].type === 'saldo'
                                              ? 'bg-emerald-600 text-white'
                                              : 'bg-white text-slate-600 hover:bg-slate-50'
                                          }`}
                                        >
                                          Saldo
                                        </button>
                                        <button
                                          onClick={() => updatePlan(p.id, 'type', 'parziale')}
                                          className={`px-4 py-2 text-sm font-medium transition-all duration-200 ${
                                            paymentPlan[p.id].type === 'parziale'
                                              ? 'bg-amber-500 text-white'
                                              : 'bg-white text-slate-600 hover:bg-slate-50'
                                          }`}
                                        >
                                          Parziale
                                        </button>
                                      </div>
                                    </div>
                                    {paymentPlan[p.id].type === 'parziale' && (
                                      <>
                                        <div>
                                          <label className="text-xs font-semibold text-slate-600 block mb-2">Importo</label>
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={paymentPlan[p.id].amount}
                                            onChange={e =>
                                              updatePlan(
                                                p.id,
                                                'amount',
                                                Math.min(parseFloat(e.target.value) || 0, p.amount_remaining || 0)
                                              )
                                            }
                                            className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                                          />
                                        </div>
                                        <div className="flex-1 min-w-64">
                                          <label className="text-xs font-semibold text-slate-600 block mb-2">Note</label>
                                          <input
                                            type="text"
                                            value={paymentPlan[p.id].note}
                                            onChange={e => updatePlan(p.id, 'note', e.target.value)}
                                            placeholder="Motivo parziale..."
                                            className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                                          />
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredPayables.length === 0 && (
                  <div className="text-center py-16 text-slate-500">
                    <div className="text-4xl mb-3">∅</div>
                    <p className="font-medium">Nessun pagamento trovato</p>
                  </div>
                )}
              </div>
            )}

            {/* Per Fornitore View - Accordion Style */}
            {viewMode === 'fornitore' && (
              <div className="space-y-3 mb-6">
                {groupedBySupplier.map(([name, group]) => (
                  <div
                    key={name}
                    className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-all duration-200"
                  >
                    <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-center justify-between hover:bg-slate-50 transition-all duration-200">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900">{name}</h3>
                        <span className="text-xs text-slate-500 font-medium">{group.items.length} fatture</span>
                      </div>
                      <div className="flex gap-8 text-sm flex-shrink-0">
                        <div className="text-right">
                          <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">Totale</div>
                          <div className="font-bold text-slate-900 font-mono mt-0.5">{formatCurrency(group.total)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-emerald-600 font-medium uppercase tracking-wide">Pagato</div>
                          <div className="font-bold text-emerald-600 font-mono mt-0.5">{formatCurrency(group.paid)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-red-600 font-medium uppercase tracking-wide">Rimane</div>
                          <div className="font-bold text-red-600 font-mono mt-0.5">{formatCurrency(group.remaining)}</div>
                        </div>
                      </div>
                    </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-3 py-2 text-center w-10"></th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Fattura</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Scadenza</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Importo</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Rimane</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Stato</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.items.map(p => {
                      const sc = getStatusColor(p.status);
                      return (
                        <React.Fragment key={p.id}>
                          <tr className={`${p.status === 'pagato' ? 'bg-emerald-50 border-l-4 border-emerald-400' : ''} ${selectedIds.has(p.id) ? 'bg-indigo-50' : ''}`}>
                            <td className="px-3 py-2 text-center">
                              {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && (
                                <button onClick={() => toggleSelect(p.id, p)} className={selectedIds.has(p.id) ? 'text-indigo-600' : 'text-slate-300 hover:text-slate-500'}>
                                  {selectedIds.has(p.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-2 text-slate-700">{p.invoice_number}</td>
                            <td className="px-4 py-2 text-slate-600">{p.due_date ? new Date(p.due_date).toLocaleDateString('it-IT') : '-'}</td>
                            <td className="px-4 py-2 text-right text-slate-900">{formatCurrency(p.gross_amount)}</td>
                            <td className="px-4 py-2 text-right font-semibold text-slate-900">{formatCurrency(p.amount_remaining || 0)}</td>
                            <td className="px-4 py-2">
                              <StatusPill status={p.status} />
                            </td>
                          </tr>
                          {renderPaymentRow(p, 6)}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
            {groupedBySupplier.length === 0 && (
              <div className="text-center py-12 text-slate-500">Nessun pagamento trovato</div>
            )}
          </div>
        )}

            {/* Per Mese View - Accordion Style */}
            {viewMode === 'mese' && (
              <div className="space-y-3 mb-6">
                {groupedByMonth.map(([key, group]) => (
                  <div
                    key={key}
                    className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-all duration-200"
                  >
                    <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-center justify-between hover:bg-slate-50 transition-all duration-200">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900 capitalize">{group.label}</h3>
                        <span className="text-xs text-slate-500 font-medium">{group.items.length} fatture</span>
                      </div>
                      <div className="flex gap-8 text-sm flex-shrink-0">
                        <div className="text-right">
                          <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">Totale</div>
                          <div className="font-bold text-slate-900 font-mono mt-0.5">{formatCurrency(group.total)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-emerald-600 font-medium uppercase tracking-wide">Pagato</div>
                          <div className="font-bold text-emerald-600 font-mono mt-0.5">{formatCurrency(group.paid)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-red-600 font-medium uppercase tracking-wide">Rimane</div>
                          <div className="font-bold text-red-600 font-mono mt-0.5">{formatCurrency(group.remaining)}</div>
                        </div>
                      </div>
                    </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-3 py-2 text-center w-10"></th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Fornitore</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Fattura</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Scadenza</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Importo</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Rimane</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Stato</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.items.map(p => {
                      const sc = getStatusColor(p.status);
                      return (
                        <React.Fragment key={p.id}>
                          <tr className={`${p.status === 'pagato' ? 'bg-emerald-50 border-l-4 border-emerald-400' : ''} ${selectedIds.has(p.id) ? 'bg-indigo-50' : ''}`}>
                            <td className="px-3 py-2 text-center">
                              {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && (
                                <button onClick={() => toggleSelect(p.id, p)} className={selectedIds.has(p.id) ? 'text-indigo-600' : 'text-slate-300 hover:text-slate-500'}>
                                  {selectedIds.has(p.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-2 text-slate-900 font-medium">{p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A'}</td>
                            <td className="px-4 py-2 text-slate-600">{p.invoice_number}</td>
                            <td className="px-4 py-2 text-slate-600">{p.due_date ? new Date(p.due_date).toLocaleDateString('it-IT') : '-'}</td>
                            <td className="px-4 py-2 text-right text-slate-900">{formatCurrency(p.gross_amount)}</td>
                            <td className="px-4 py-2 text-right font-semibold text-slate-900">{formatCurrency(p.amount_remaining || 0)}</td>
                            <td className="px-4 py-2">
                              <StatusPill status={p.status} />
                            </td>
                          </tr>
                          {renderPaymentRow(p, 7)}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
                {groupedByMonth.length === 0 && (
                  <div className="text-center py-16 text-slate-500">
                    <div className="text-4xl mb-3">∅</div>
                    <p className="font-medium">Nessun pagamento trovato</p>
                  </div>
                )}
              </div>
            )}

            {/* Charts View - Dashboard Feel */}
            {viewMode === 'charts' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Monthly Projection */}
                <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200 hover:shadow-md transition-all duration-200">
                  <h3 className="font-semibold text-slate-900 mb-1">Proiezione Scadenze</h3>
                  <p className="text-xs text-slate-500 mb-4 font-medium">Prossimi 6 mesi</p>
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
                <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200 hover:shadow-md transition-all duration-200">
                  <h3 className="font-semibold text-slate-900 mb-1">Breakdown per Categoria</h3>
                  <p className="text-xs text-slate-500 mb-4 font-medium">Incidenza per categoria</p>
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
                <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200 hover:shadow-md transition-all duration-200">
                  <h3 className="font-semibold text-slate-900 mb-1">Analisi Aging</h3>
                  <p className="text-xs text-slate-500 mb-4 font-medium">Distribuzione per giorni</p>
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
                <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200 hover:shadow-md transition-all duration-200">
                  <h3 className="font-semibold text-slate-900 mb-1">Statistiche</h3>
                  <p className="text-xs text-slate-500 mb-4 font-medium">Riepilogo metriche</p>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                      <span className="text-sm text-slate-600 font-medium">Numero Fatture</span>
                      <span className="font-bold text-slate-900 text-lg">{filteredPayables.length}</span>
                    </div>
                    <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                      <span className="text-sm text-slate-600 font-medium">Fornitori</span>
                      <span className="font-bold text-slate-900 text-lg">
                        {new Set(filteredPayables.map((p) => p.supplier_id)).size}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                      <span className="text-sm text-slate-600 font-medium">Importo Medio</span>
                      <span className="font-bold text-slate-900 text-sm font-mono">
                        {formatCurrency(
                          filteredPayables.length > 0
                            ? filteredPayables.reduce((s, p) => s + (p.amount_remaining || 0), 0) /
                                filteredPayables.length
                            : 0
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600 font-medium">Giorni Medi</span>
                      <span className="font-bold text-slate-900 text-lg">
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

        {/* Floating Action Bar - Premium Pill */}
        {selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 transition-all duration-200">
            <div className="bg-white/90 backdrop-blur-xl border border-slate-200/50 rounded-2xl shadow-2xl px-6 py-4">
              <div className="flex items-center justify-between gap-8">
                <div className="flex items-center gap-6">
                  <span className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <CheckSquare className="w-5 h-5 text-indigo-600" />
                    {selectedIds.size} fattura{selectedIds.size !== 1 ? 'e' : ''}
                  </span>
                  <div className="w-px h-6 bg-slate-200"></div>
                  <span className="text-lg font-bold text-slate-900 font-mono">{formatCurrency(selectedTotal)}</span>
                  {hasNegativeBalance && (
                    <>
                      <div className="w-px h-6 bg-slate-200"></div>
                      <span className="text-sm font-semibold text-red-600 flex items-center gap-1">
                        <Ban className="w-4 h-4" />
                        Saldo insufficiente
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setSelectedIds(new Set());
                      setPaymentPlan({});
                    }}
                    className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-all duration-200"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={confirmPayments}
                    disabled={isSaving || hasNegativeBalance || Array.from(selectedIds).some(id => !paymentPlan[id]?.bankId)}
                    className="px-6 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg text-sm font-bold flex items-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
                  >
                    <Send className="w-4 h-4" />
                    {isSaving ? 'Elaborazione...' : 'Conferma'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Result Modal */}
        {confirmResult && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all duration-200">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden border border-slate-200 flex flex-col">
              <div className="sticky top-0 bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-6 py-4 flex justify-between items-center">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  Pagamenti Confermati
                </h2>
                <button
                  onClick={() => setConfirmResult(null)}
                  className="p-1 hover:bg-emerald-700/50 rounded-lg transition-all duration-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <div className="mb-4 p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                  <p className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    {confirmResult.results.length} pagamenti registrati
                  </p>
                </div>
                {emailRecipients && (
                  <div className="mb-4 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                    <p className="text-xs text-indigo-600 font-medium">Destinatari Email:</p>
                    <p className="text-sm text-indigo-700 mt-1">{emailRecipients}</p>
                  </div>
                )}
                <p className="text-xs text-slate-500 mb-3 font-medium uppercase tracking-wide">Riepilogo</p>
                <textarea
                  readOnly
                  value={confirmResult.emailBody}
                  rows={12}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg text-xs font-mono bg-slate-50 focus:outline-none transition-all duration-200"
                />
              </div>
              <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(confirmResult.emailBody);
                  }}
                  className="w-full px-4 py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Copia Riepilogo
                </button>
              </div>
            </div>
          </div>
        )}

        </div>
        )}

        </div>
      </div>

      {/* Supplier Detail Popup */}
      {supplierDetail && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSupplierDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-600" />
                Dettaglio Fornitore
              </h3>
              <button onClick={() => setSupplierDetail(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Ragione Sociale</div>
                <div className="text-base font-semibold text-slate-900 mt-0.5">{supplierDetail.ragione_sociale || supplierDetail.name || '—'}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">P.IVA</div>
                  <div className="text-sm font-mono text-slate-800 mt-0.5">{supplierDetail.partita_iva || '—'}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Codice Fiscale</div>
                  <div className="text-sm font-mono text-slate-800 mt-0.5">{supplierDetail.codice_fiscale || '—'}</div>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">IBAN</div>
                <div className="text-sm font-mono text-slate-800 mt-0.5">{supplierDetail.iban || '—'}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Email</div>
                  <div className="text-sm text-slate-800 mt-0.5">{supplierDetail.email || '—'}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Telefono</div>
                  <div className="text-sm text-slate-800 mt-0.5">{supplierDetail.telefono || '—'}</div>
                </div>
              </div>
              {supplierDetail.indirizzo && (
                <div>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Indirizzo</div>
                  <div className="text-sm text-slate-800 mt-0.5">{supplierDetail.indirizzo}</div>
                </div>
              )}
              {supplierDetail.category && (
                <div>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Categoria</div>
                  <div className="text-sm text-slate-800 mt-0.5 capitalize">{supplierDetail.category}</div>
                </div>
              )}
              {supplierDetail.note && (
                <div>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Note</div>
                  <div className="text-sm text-slate-600 mt-0.5">{supplierDetail.note}</div>
                </div>
              )}
            </div>
            <div className="border-t border-slate-100 px-6 py-3 flex justify-end">
              <button onClick={() => setSupplierDetail(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition">
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

            {/* Email Config Modal */}
            {showEmailConfig && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all duration-200">
                <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
                  <h3 className="font-bold text-slate-900 mb-2 text-lg">Destinatari Email</h3>
                  <p className="text-xs text-slate-500 mb-4 font-medium">Indirizzi separati da virgola</p>
                  <input
                    type="text"
                    value={emailRecipients}
                    onChange={e => setEmailRecipients(e.target.value)}
                    placeholder="admin@azienda.com, contabile@azienda.com"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowEmailConfig(false)}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-all duration-200"
                    >
                      Annulla
                    </button>
                    <button
                      onClick={async () => {
                        await supabase
                          .from('companies')
                          .update({ settings: { email_scadenzario: emailRecipients } })
                          .eq('id', COMPANY_ID);
                        setShowEmailConfig(false);
                      }}
                      className="px-4 py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      Salva
                    </button>
                  </div>
                </div>
              </div>
            )}

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
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all duration-200">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200">
              <div className="p-6 border-b border-red-200 bg-red-50">
                <h2 className="text-lg font-bold text-red-900 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  Conferma Cancellazione
                </h2>
              </div>
              <div className="p-6">
                <p className="text-slate-700 mb-3 font-medium">
                  Sei sicuro di voler cancellare la scadenza <span className="font-mono text-sm text-red-600">{modals.deleteConfirm.invoiceNumber}</span>?
                </p>
                <p className="text-sm text-slate-500 font-medium">
                  Questa azione non potra essere annullata.
                </p>
              </div>
              <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50 flex justify-end gap-3">
                <button
                  onClick={() =>
                    setModals({ ...modals, deleteConfirm: { open: false, scheduleId: null, invoiceNumber: null } })
                  }
                  className="px-4 py-2.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-all duration-200"
                >
                  Annulla
                </button>
                <button
                  onClick={() => handleDeleteSchedule(modals.deleteConfirm.scheduleId)}
                  disabled={isSaving}
                  className="px-4 py-2.5 bg-red-600 text-white hover:bg-red-700 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
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
