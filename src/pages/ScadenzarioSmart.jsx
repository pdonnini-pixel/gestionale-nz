import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar, TrendingUp, TrendingDown, Filter, AlertCircle, Clock,
  DollarSign, BarChart3, Eye, EyeOff, ChevronDown, CheckCircle2,
  AlertTriangle, Clock3, Plus, Edit2, Trash2, Save, X, Download,
  CheckSquare, Square, Settings, Send, Ban, Wallet, Repeat,
  ChevronRight, Landmark, Building2, Search, RefreshCw
} from 'lucide-react';
import CostiRicorrenti from '../components/CostiRicorrenti';
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// Utility functions
function fmt(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Status config
const statusConfig = {
  scaduto: { label: 'Scaduto', bg: 'bg-red-100 text-red-700' },
  in_scadenza: { label: 'In scadenza', bg: 'bg-amber-100 text-amber-700' },
  da_pagare: { label: 'Da pagare', bg: 'bg-blue-100 text-blue-700' },
  parziale: { label: 'Parziale', bg: 'bg-orange-100 text-orange-700' },
  sospeso: { label: 'Sospeso', bg: 'bg-slate-100 text-slate-600' },
  rimandato: { label: 'Rimandato', bg: 'bg-purple-100 text-purple-700' },
  pagato: { label: 'Pagato', bg: 'bg-emerald-100 text-emerald-700' },
  annullato: { label: 'Annullato', bg: 'bg-gray-100 text-gray-500' },
  contestato: { label: 'Contestato', bg: 'bg-purple-100 text-purple-700' },
};

// Payment method labels
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

// Payment groups for filtering
const paymentGroups = [
  { label: 'Bonifici', key: 'bonifici', methods: ['bonifico_ordinario', 'bonifico_urgente', 'bonifico_sepa', 'bonifico'] },
  { label: 'RiBa', key: 'riba', methods: ['riba_30', 'riba_60', 'riba_90', 'riba_120', 'riba'] },
  { label: 'Addebito diretto', key: 'addebito', methods: ['rid', 'sdd_core', 'sdd_b2b'] },
  { label: 'Altro', key: 'altro', methods: ['rimessa_diretta', 'carta_credito', 'carta_debito', 'carta', 'assegno', 'contanti', 'compensazione', 'f24', 'mav', 'rav', 'bollettino_postale', 'altro'] },
];

const RIBA_DAYS = { riba_30: 30, riba_60: 60, riba_90: 90, riba_120: 120 };

// Status pill component
function StatusPill({ status }) {
  const cfg = statusConfig[status] || { label: status, bg: 'bg-gray-100 text-gray-600' }
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.bg}`}>{cfg.label}</span>
}

// Modal component
function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} mx-4 max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// Main component
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
  const [selectedMethodGroup, setSelectedMethodGroup] = useState(null);
  const [supplierDetail, setSupplierDetail] = useState(null);

  // Selection helpers
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

  // Date range
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

  // Bank balances
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

  // Totale allocato per banca (quanto si sta pagando)
  const bankSpending = useMemo(() => {
    const spending = {};
    Object.values(paymentPlan).forEach(plan => {
      if (plan.bankId) {
        spending[plan.bankId] = (spending[plan.bankId] || 0) + (plan.amount || 0);
      }
    });
    return spending;
  }, [paymentPlan]);

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

  // Load data (funzione riusabile)
  const fetchData = useCallback(async () => {
    if (!COMPANY_ID) return;
    try {
      setLoading(true);

      const { data: viewData } = await supabase
        .from('v_payables_operative')
        .select('*');

      const { data: suppliersData } = await supabase
        .from('suppliers')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .or('is_deleted.is.null,is_deleted.eq.false');

      const { data: accountsData } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .eq('is_active', true);

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
        supplier_id: row.supplier_id,
        supplier_iban: row.supplier_iban || '',
        supplier_vat: row.supplier_vat || '',
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
      setSuppliers(suppliersData || []);
      setBankAccounts(accountsData || []);

      const totalBalance = (accountsData || []).reduce((sum, acc) => sum + (acc.current_balance || 0), 0);
      setCashPosition(totalBalance);

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
  }, [COMPANY_ID]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filter payables
  const filteredPayables = useMemo(() => {
    return payables.filter((p) => {
      const matchOutlet = !selectedOutlet || p.outlet_id === selectedOutlet;
      const isNotaCredito = (p.gross_amount || 0) < 0;
      const matchStatus = !selectedStatus
        || (selectedStatus === 'nota_credito' && isNotaCredito)
        || (selectedStatus === 'da_saldare' && !isNotaCredito && p.status !== 'pagato')
        || (selectedStatus !== 'nota_credito' && selectedStatus !== 'da_saldare' && p.status === selectedStatus);
      const matchSearch = !searchTerm || p.invoice_number.includes(searchTerm) || (p.suppliers?.ragione_sociale || suppliers?.name || '').toLowerCase().includes(searchTerm.toLowerCase());
      const dueDate = new Date(p.due_date);
      const matchDate = dueDate >= new Date(dateRange.start) && dueDate <= new Date(dateRange.end);

      let matchMethodGroup = true;
      if (selectedMethodGroup) {
        matchMethodGroup = p.payment_method === selectedMethodGroup;
      }

      return matchOutlet && matchStatus && matchSearch && matchDate && matchMethodGroup;
    });
  }, [payables, selectedOutlet, selectedStatus, searchTerm, dateRange, selectedMethodGroup]);

  // KPIs
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

    const totalToPay = filteredPayables
      .filter((p) => p.status !== 'pagato')
      .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

    const cashShortfall = totalToPay > cashPosition ? totalToPay - cashPosition : 0;

    return {
      totalDuePending,
      totalOverdue,
      nextSevenDays,
      totalToPay,
      cashShortfall,
      availableCash: cashPosition,
    };
  }, [filteredPayables, cashPosition, today]);

  // Totali per singolo metodo di pagamento (KPI individuali)
  const methodTotals = useMemo(() => {
    const activePays = payables.filter(p => p.status !== 'pagato' && p.status !== 'annullato');
    const map = {};
    activePays.forEach(p => {
      const m = p.payment_method || 'altro';
      if (!map[m]) map[m] = { key: m, label: paymentMethodLabels[m] || m, total: 0, count: 0 };
      map[m].total += (p.amount_remaining || 0);
      map[m].count += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [payables]);

  // Monthly data
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

  // Category data
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

  // Handlers
  const handleMarkAsPaid = useCallback(async (payableId, amount, bankAccountId) => {
    try {
      await supabase.from('payables').update({
        amount_paid: amount,
        payment_date: today.toISOString().split('T')[0],
        payment_bank_account_id: bankAccountId,
        status: amount >= (modals.payment.payable?.amount_remaining || 0) ? 'pagato' : 'parziale',
      }).eq('id', payableId);
      fetchData();
    } catch (error) {
      console.error('Error marking payment:', error);
    }
  }, [today, modals]);

  const handleCreateInvoice = useCallback(async (invoiceData) => {
    try {
      const { data: inv } = await supabase.from('electronic_invoices').insert([{
        company_id: COMPANY_ID,
        supplier_id: invoiceData.supplierId,
        invoice_number: invoiceData.invoiceNumber,
        invoice_date: invoiceData.invoiceDate,
        due_date: invoiceData.dueDate,
        total_amount: invoiceData.grossAmount,
        payment_method: invoiceData.paymentMethod,
        source: 'manual',
      }]).select();

      await supabase.from('payables').insert([{
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
      }]);

      fetchData();
    } catch (error) {
      console.error('Error creating invoice:', error);
    }
  }, [COMPANY_ID]);

  const handleCreateSupplier = useCallback(async (supplierData) => {
    try {
      const { data } = await supabase.from('suppliers').insert([{
        company_id: COMPANY_ID,
        ragione_sociale: supplierData.name,
        name: supplierData.name,
        partita_iva: supplierData.vat,
        codice_fiscale: supplierData.fiscal,
        iban: supplierData.iban,
        category: supplierData.category,
        payment_method: supplierData.paymentMethod || 'bonifico',
        is_active: true,
      }]).select();

      if (data) {
        setSuppliers([...suppliers, ...data]);
        setModals({ ...modals, supplier: { open: false, data: null } });
      }
    } catch (error) {
      console.error('Error creating supplier:', error);
    }
  }, [suppliers, modals, COMPANY_ID]);

  const handleEditSchedule = useCallback(async (scheduleData) => {
    try {
      setIsSaving(true);
      await supabase.from('payables').update({
        gross_amount: scheduleData.amount,
        due_date: scheduleData.due_date,
        status: scheduleData.status,
        amount_remaining: (scheduleData.amount || 0) - (scheduleData.amount_paid || 0),
      }).eq('id', scheduleData.id);

      setModals({ ...modals, editSchedule: { open: false, schedule: null } });
      fetchData();
    } catch (error) {
      console.error('Error updating schedule:', error);
      setIsSaving(false);
    }
  }, [modals]);

  const handleDeleteSchedule = useCallback(async (scheduleId) => {
    try {
      setIsSaving(true);
      await supabase.from('payables').update({ status: 'annullato' }).eq('id', scheduleId);
      setModals({ ...modals, deleteConfirm: { open: false, scheduleId: null, invoiceNumber: null } });
      fetchData();
    } catch (error) {
      console.error('Error deleting schedule:', error);
      setIsSaving(false);
    }
  }, [modals]);

  const confirmPayments = async () => {
    if (hasNegativeBalance || selectedIds.size === 0) return;
    setIsSaving(true);
    const results = [];
    const today_str = new Date().toISOString().split('T')[0];

    try {
      for (const id of selectedIds) {
        const plan = paymentPlan[id];
        const payable = payables.find(p => p.id === id);
        if (!plan || !payable) continue;

        const newPaid = (payable.amount_paid || 0) + plan.amount;
        const newStatus = plan.type === 'saldo' ? 'pagato' : 'parziale';
        const bank = bankAccounts.find(b => b.id === plan.bankId);

        await supabase.from('payables').update({
          amount_paid: newPaid,
          amount_remaining: payable.gross_amount - newPaid,
          payment_date: today_str,
          payment_bank_account_id: plan.bankId || null,
          status: newStatus,
        }).eq('id', id);

        await supabase.from('payable_actions').insert({
          payable_id: id,
          action_type: newStatus === 'pagato' ? 'pagamento' : 'pagamento_parziale',
          old_status: payable.status,
          new_status: newStatus,
          amount: plan.amount,
          bank_account_id: plan.bankId || null,
          note: plan.note || null,
        });

        results.push({
          fornitore: payable.suppliers?.ragione_sociale || payable.suppliers?.name || 'N/A',
          fattura: payable.invoice_number,
          importo: plan.amount,
          bankId: plan.bankId,
          banca: bank?.bank_name || 'N/D',
          iban: bank?.iban || '',
          ibanBeneficiario: payable.supplier_iban || '',
          pivaBeneficiario: payable.supplier_vat || '',
          tipo: plan.type === 'saldo' ? 'SALDO' : 'PARZIALE',
          metodo: paymentMethodLabels[payable.payment_method] || '',
          note: plan.note || '',
        });
      }

      // Raggruppa per banca con saldi prima/dopo
      const bankMap = {};
      results.forEach(r => {
        if (!bankMap[r.bankId]) {
          const ba = bankAccounts.find(b => b.id === r.bankId);
          bankMap[r.bankId] = {
            bankName: r.banca,
            iban: ba?.iban || '',
            saldoIniziale: ba?.current_balance || 0,
            totalePagamenti: 0,
            pagamenti: [],
          };
        }
        bankMap[r.bankId].totalePagamenti += r.importo;
        bankMap[r.bankId].pagamenti.push(r);
      });
      // Calcola saldo finale per banca
      Object.values(bankMap).forEach(b => {
        b.saldoFinale = b.saldoIniziale - b.totalePagamenti;
      });
      const banks = Object.values(bankMap);
      const totaleComplessivo = results.reduce((s, r) => s + r.importo, 0);
      const dataStr = new Date().toLocaleDateString('it-IT');

      // Costruisci email strutturata
      const emailSubject = `Disposizione pagamenti fornitori - ${dataStr}`;
      const emailBody = `Buongiorno,\n\ndi seguito la disposizione dei pagamenti fornitori da eseguire in data odierna (${dataStr}).\n\n` +
        banks.map(b => {
          const header = `═══ ${b.bankName} ═══\nIBAN: ${b.iban}\nSaldo attuale: ${fmt(b.saldoIniziale)} €\n`;
          const rows = b.pagamenti.map((r, i) => `  ${i+1}. ${r.fornitore}${r.pivaBeneficiario ? ' (P.IVA: ' + r.pivaBeneficiario + ')' : ''}\n     Fattura: ${r.fattura} | ${r.tipo} | Importo: ${fmt(r.importo)} €${r.ibanBeneficiario ? '\n     IBAN beneficiario: ' + r.ibanBeneficiario : ''}${r.metodo ? '\n     Metodo: ' + r.metodo : ''}${r.note ? '\n     Note: ' + r.note : ''}`).join('\n');
          const footer = `\n  Totale banca: ${fmt(b.totalePagamenti)} €\n  Saldo residuo stimato: ${fmt(b.saldoFinale)} €`;
          return header + rows + footer;
        }).join('\n\n') +
        `\n\n${'─'.repeat(40)}\nTOTALE COMPLESSIVO: ${fmt(totaleComplessivo)} €\nNumero operazioni: ${results.length}\n\nCordiali saluti`;

      setConfirmResult({ results, banks, totaleComplessivo, emailBody, emailSubject });
      setSelectedIds(new Set());
      setPaymentPlan({});
      setIsSaving(false);
    } catch (error) {
      console.error('Error confirming payments:', error);
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw size={24} className="animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Caricamento scadenzario...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Barre Banche — sticky dentro griglia */}
      <div className="sticky top-0 z-40 -mx-6 px-6 py-3 bg-white border-b border-slate-200">
        {bankAccounts.length > 0 ? (
          <div className="flex items-center gap-3 overflow-x-auto">
            {bankAccounts.map((ba, idx) => {
              const saldoIniziale = ba.current_balance || 0;
              const spending = bankSpending[ba.id] || 0;
              const saldoProiettato = bankBalances[ba.id] || 0;
              const isNeg = saldoProiettato < 0;
              const hasSpending = spending > 0;
              const colors = [
                { bg: 'bg-blue-50', border: 'border-blue-200', name: 'text-blue-700', spend: 'text-blue-500' },
                { bg: 'bg-emerald-50', border: 'border-emerald-200', name: 'text-emerald-700', spend: 'text-emerald-500' },
                { bg: 'bg-purple-50', border: 'border-purple-200', name: 'text-purple-700', spend: 'text-purple-500' },
                { bg: 'bg-amber-50', border: 'border-amber-200', name: 'text-amber-700', spend: 'text-amber-500' },
                { bg: 'bg-rose-50', border: 'border-rose-200', name: 'text-rose-700', spend: 'text-rose-500' },
                { bg: 'bg-cyan-50', border: 'border-cyan-200', name: 'text-cyan-700', spend: 'text-cyan-500' },
              ];
              const c = isNeg
                ? { bg: 'bg-red-50', border: 'border-red-300 ring-2 ring-red-400/50', name: 'text-red-700', spend: 'text-red-500' }
                : colors[idx % colors.length];
              return (
                <div key={ba.id} className={`flex-shrink-0 px-5 py-3 rounded-xl border ${c.bg} ${c.border} ${isNeg ? 'animate-pulse' : ''}`}>
                  <div className={`text-xs font-semibold ${c.name}`}>{ba.bank_name}</div>
                  <div className={`text-base font-bold mt-1 ${isNeg ? 'text-red-600' : 'text-slate-900'}`}>{fmt(saldoProiettato)} €</div>
                  {hasSpending && (
                    <div className={`text-xs mt-1 ${isNeg ? 'text-red-500' : c.spend} font-medium`}>
                      − {fmt(spending)} €{isNeg && ' ⚠️'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700 flex items-center gap-2 w-fit">
            <Wallet size={14} /> Nessun conto bancario. Aggiungi dalla sezione Banche.
          </div>
        )}
      </div>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Scadenzario</h1>
          <p className="text-sm text-slate-500">Gestione scadenze fornitori</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEmailConfig(true)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600">
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Tab: Scadenze / Ricorrenti */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[
          { key: 'scadenze', label: 'Scadenze', icon: Clock3 },
          { key: 'ricorrenti', label: 'Costi Ricorrenti', icon: Repeat },
        ].map(t => (
          <button key={t.key} onClick={() => setSection(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              section === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {section === 'ricorrenti' ? (
        <CostiRicorrenti />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-blue-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 font-medium mb-1"><DollarSign size={13} /> Da Pagare</div>
                  <div className="text-xl font-bold text-slate-900">{fmt(kpis.totalToPay)} €</div>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg"><DollarSign size={18} className="text-blue-500" /></div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-red-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium mb-1"><AlertTriangle size={13} /> Scaduto</div>
                  <div className="text-xl font-bold text-red-700">{fmt(kpis.totalOverdue)} €</div>
                </div>
                <div className="p-2 bg-red-50 rounded-lg"><AlertTriangle size={18} className="text-red-400" /></div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-amber-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 font-medium mb-1"><Clock size={13} /> Prossimi 7 gg</div>
                  <div className="text-xl font-bold text-amber-700">{fmt(kpis.nextSevenDays)} €</div>
                </div>
                <div className="p-2 bg-amber-50 rounded-lg"><Clock size={18} className="text-amber-400" /></div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-emerald-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium mb-1"><Wallet size={13} /> Cassa</div>
                  <div className={`text-xl font-bold ${kpis.cashShortfall > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {fmt(kpis.availableCash)} €
                  </div>
                </div>
                <div className={`p-2 rounded-lg ${kpis.cashShortfall > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                  <Wallet size={18} className={kpis.cashShortfall > 0 ? 'text-red-400' : 'text-emerald-400'} />
                </div>
              </div>
              {kpis.cashShortfall > 0 && (
                <div className="mt-2 text-xs text-red-600 font-medium">Deficit: {fmt(kpis.cashShortfall)} €</div>
              )}
            </div>
          </div>

          {/* Payment Method Filter Chips */}
          <div className="flex flex-wrap gap-2">
            {/* Tasto Tutti */}
            <button onClick={() => setSelectedMethodGroup(null)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition ${
                !selectedMethodGroup ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
              }`}>
              Tutti
            </button>
            {/* KPI per ogni singolo metodo di pagamento presente */}
            {methodTotals.map(m => {
              const isActive = selectedMethodGroup === m.key;
              return (
                <button key={m.key} onClick={() => setSelectedMethodGroup(isActive ? null : m.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition ${
                    isActive ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
                  }`}>
                  <span>{m.label}</span>
                  <span className="font-bold">{fmt(m.total)} €</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {m.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Filters */}
          <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
            <div className="flex-1">
              <input type="text" placeholder="Cerca fornitore o fattura..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
            </div>
            <div className="flex items-center gap-2">
              <input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
              <span className="text-slate-400">—</span>
              <input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
            </div>
            <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
              <option value="">Tutti gli stati</option>
              <option value="da_saldare">Da Saldare</option>
              <option value="da_pagare">Da Pagare</option>
              <option value="in_scadenza">In Scadenza</option>
              <option value="scaduto">Scaduto</option>
              <option value="parziale">Parziale</option>
              <option value="pagato">Pagato</option>
              <option value="contestato">Contestato</option>
              <option value="nota_credito">Note di Credito</option>
            </select>
            <div className="flex gap-1">
              {[
                { key: 'timeline', icon: Clock3 },
                { key: 'fornitore', icon: Building2 },
                { key: 'mese', icon: Calendar },
                { key: 'charts', icon: BarChart3 },
              ].map(v => (
                <button key={v.key} onClick={() => setViewMode(v.key)}
                  className={`p-2 rounded-lg transition ${
                    viewMode === v.key ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:text-slate-600'
                  }`}>
                  <v.icon size={14} />
                </button>
              ))}
            </div>
            <div className="border-l border-slate-200 h-6 mx-1" />
            <button onClick={() => setModals({ ...modals, invoice: { open: true, data: null } })}
              className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition font-medium">
              <Plus size={13} /> Fattura
            </button>
            <button onClick={() => setModals({ ...modals, supplier: { open: true, data: null } })}
              className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition font-medium border border-slate-200">
              <Plus size={13} /> Fornitore
            </button>
          </div>

          {/* Timeline View */}
          {viewMode === 'timeline' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-4 text-center w-12">
                        <button onClick={toggleSelectAll} className="text-slate-400 hover:text-indigo-600">
                          {selectedIds.size > 0 ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                      </th>
                      <th className="py-3 px-4 text-left font-medium">Fornitore</th>
                      <th className="py-3 px-4 text-left font-medium">Fattura</th>
                      <th className="py-3 px-4 text-center font-medium">Scadenza</th>
                      <th className="py-3 px-4 text-right font-medium">Importo</th>
                      <th className="py-3 px-4 text-right font-medium">Rimane</th>
                      <th className="py-3 px-4 text-center font-medium">Stato</th>
                      <th className="py-3 px-4 text-center font-medium">Metodo</th>
                      <th className="py-3 px-4 text-right font-medium">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayables.map((p) => (
                      <React.Fragment key={p.id}>
                        <tr className="border-b border-slate-50 hover:bg-slate-50/50">
                          <td className="py-3 px-4 text-center">
                            {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && (
                              <button onClick={() => toggleSelect(p.id, p)}>
                                {selectedIds.has(p.id) ? <CheckSquare size={18} className="text-indigo-600" /> : <Square size={18} />}
                              </button>
                            )}
                          </td>
                          <td className="py-3 px-4 text-sm font-medium">
                            <button onClick={() => {
                              const sup = suppliers.find(s =>
                                s.ragione_sociale === (p.suppliers?.ragione_sociale || p.suppliers?.name) ||
                                s.name === (p.suppliers?.name || p.suppliers?.ragione_sociale)
                              );
                              setSupplierDetail(sup || { ragione_sociale: p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A' });
                            }} className="text-left hover:text-indigo-600 hover:underline">
                              {p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A'}
                            </button>
                          </td>
                          <td className="py-3 px-4 text-sm text-slate-600">{p.invoice_number}</td>
                          <td className="py-3 px-4 text-sm text-center">{fmtDate(p.due_date)}</td>
                          <td className="py-3 px-4 text-sm text-right font-medium">{fmt(p.gross_amount)} €</td>
                          <td className="py-3 px-4 text-sm text-right font-bold">{fmt(p.amount_remaining)} €</td>
                          <td className="py-3 px-4 text-center"><StatusPill status={p.status} /></td>
                          <td className="py-3 px-4 text-xs text-center text-slate-500">{paymentMethodLabels[p.payment_method] || '—'}</td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex justify-end gap-1">
                              <button onClick={() => setModals({ ...modals, editSchedule: { open: true, schedule: p } })}
                                className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50">
                                <Edit2 size={14} />
                              </button>
                              <button onClick={() => setModals({ ...modals, deleteConfirm: { open: true, scheduleId: p.id, invoiceNumber: p.invoice_number } })}
                                className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {selectedIds.has(p.id) && paymentPlan[p.id] && (
                          <tr className="bg-indigo-50 border-b border-indigo-200">
                            <td colSpan={9} className="px-4 py-3">
                              <div className="flex items-center gap-4 flex-wrap">
                                <div>
                                  <label className="text-xs font-medium text-slate-600 block mb-1">Banca</label>
                                  <select value={paymentPlan[p.id].bankId} onChange={e => updatePlan(p.id, 'bankId', e.target.value)}
                                    className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-52">
                                    <option value="">Seleziona banca...</option>
                                    {bankAccounts.map(ba => (
                                      <option key={ba.id} value={ba.id}>{ba.bank_name} ({fmt(bankBalances[ba.id] || 0)} €)</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-600 block mb-1">Tipo</label>
                                  <div className="flex rounded-lg overflow-hidden border border-slate-300">
                                    <button onClick={() => { updatePlan(p.id, 'type', 'saldo'); updatePlan(p.id, 'amount', p.amount_remaining || 0); }}
                                      className={`px-3 py-1.5 text-sm font-medium ${paymentPlan[p.id].type === 'saldo' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600'}`}>
                                      Saldo
                                    </button>
                                    <button onClick={() => updatePlan(p.id, 'type', 'parziale')}
                                      className={`px-3 py-1.5 text-sm font-medium ${paymentPlan[p.id].type === 'parziale' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600'}`}>
                                      Parziale
                                    </button>
                                  </div>
                                </div>
                                {paymentPlan[p.id].type === 'parziale' && (
                                  <>
                                    <div>
                                      <label className="text-xs font-medium text-slate-600 block mb-1">Importo</label>
                                      <input type="number" step="0.01" value={paymentPlan[p.id].amount}
                                        onChange={e => updatePlan(p.id, 'amount', Math.min(parseFloat(e.target.value) || 0, p.amount_remaining || 0))}
                                        className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-32" />
                                    </div>
                                    <div className="flex-1 min-w-48">
                                      <label className="text-xs font-medium text-slate-600 block mb-1">Note</label>
                                      <input type="text" value={paymentPlan[p.id].note} onChange={e => updatePlan(p.id, 'note', e.target.value)}
                                        placeholder="Motivo..." className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-full" />
                                    </div>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Per Fornitore View */}
          {viewMode === 'fornitore' && (
            <div className="space-y-3">
              {groupedBySupplier.map(([name, group]) => (
                <div key={name} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-slate-900">{name}</h3>
                      <span className="text-xs text-slate-500">{group.items.length} fatture</span>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Totale</div>
                        <div className="font-bold">{fmt(group.total)} €</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-emerald-600">Pagato</div>
                        <div className="font-bold text-emerald-600">{fmt(group.paid)} €</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-red-600">Rimane</div>
                        <div className="font-bold text-red-600">{fmt(group.remaining)} €</div>
                      </div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="py-2 px-3 text-center w-10"></th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Fattura</th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Scadenza</th>
                          <th className="py-2 px-4 text-right text-xs font-medium text-slate-600">Importo</th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Stato</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map(p => (
                          <tr key={p.id} className="border-b border-slate-50">
                            <td className="py-2 px-3 text-center">
                              {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && (
                                <button onClick={() => toggleSelect(p.id, p)}>
                                  {selectedIds.has(p.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                                </button>
                              )}
                            </td>
                            <td className="py-2 px-4">{p.invoice_number}</td>
                            <td className="py-2 px-4">{fmtDate(p.due_date)}</td>
                            <td className="py-2 px-4 text-right">{fmt(p.amount_remaining)} €</td>
                            <td className="py-2 px-4"><StatusPill status={p.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Per Mese View */}
          {viewMode === 'mese' && (
            <div className="space-y-3">
              {groupedByMonth.map(([key, group]) => (
                <div key={key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-slate-900 capitalize">{group.label}</h3>
                      <span className="text-xs text-slate-500">{group.items.length} fatture</span>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Totale</div>
                        <div className="font-bold">{fmt(group.total)} €</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-emerald-600">Pagato</div>
                        <div className="font-bold text-emerald-600">{fmt(group.paid)} €</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-red-600">Rimane</div>
                        <div className="font-bold text-red-600">{fmt(group.remaining)} €</div>
                      </div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="py-2 px-3 text-center w-10"></th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Fornitore</th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Fattura</th>
                          <th className="py-2 px-4 text-right text-xs font-medium text-slate-600">Importo</th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Stato</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map(p => (
                          <tr key={p.id} className="border-b border-slate-50">
                            <td className="py-2 px-3 text-center">
                              {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && (
                                <button onClick={() => toggleSelect(p.id, p)}>
                                  {selectedIds.has(p.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                                </button>
                              )}
                            </td>
                            <td className="py-2 px-4 font-medium">{p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A'}</td>
                            <td className="py-2 px-4">{p.invoice_number}</td>
                            <td className="py-2 px-4 text-right">{fmt(p.amount_remaining)} €</td>
                            <td className="py-2 px-4"><StatusPill status={p.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Charts View */}
          {viewMode === 'charts' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="font-medium text-slate-900 mb-1 text-sm">Proiezione Scadenze</h3>
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

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="font-medium text-slate-900 mb-1 text-sm">Categoria</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={categoryData} cx="50%" cy="50%" outerRadius={80} dataKey="value">
                      {categoryData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444'][index % 5]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="font-medium text-slate-900 mb-1 text-sm">Aging</h3>
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

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="font-medium text-slate-900 mb-1 text-sm">Statistiche</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-600">Fatture</span>
                    <span className="font-bold">{filteredPayables.length}</span>
                  </div>
                  <div className="flex justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-600">Fornitori</span>
                    <span className="font-bold">{new Set(filteredPayables.map(p => p.suppliers?.ragione_sociale)).size}</span>
                  </div>
                  <div className="flex justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-600">Importo Medio</span>
                    <span className="font-bold">{fmt(filteredPayables.length > 0 ? filteredPayables.reduce((s, p) => s + (p.amount_remaining || 0), 0) / filteredPayables.length : 0)} €</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Floating Action Bar for Bulk Payments */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
              <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-6 py-4">
                <div className="flex items-center justify-between gap-8">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-slate-900">{selectedIds.size} fattura{selectedIds.size !== 1 ? 'e' : ''}</span>
                    <span className="text-lg font-bold">{fmt(selectedTotal)} €</span>
                    {hasNegativeBalance && <span className="text-sm font-medium text-red-600">Saldo insufficiente</span>}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => { setSelectedIds(new Set()); setPaymentPlan({}); }}
                      className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium">
                      Annulla
                    </button>
                    {hasNegativeBalance && (
                      <div className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
                        <AlertTriangle size={14} /> Saldo insufficiente su una o più banche
                      </div>
                    )}
                    <button onClick={confirmPayments} disabled={isSaving || hasNegativeBalance || Array.from(selectedIds).some(id => !paymentPlan[id]?.bankId)}
                      className="px-6 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed">
                      {isSaving ? 'Elaborazione...' : 'Conferma'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Email Config Modal */}
      {showEmailConfig && (
        <Modal open={true} onClose={() => setShowEmailConfig(false)} title="Destinatari Email">
          <div className="space-y-3">
            <input type="text" value={emailRecipients} onChange={e => setEmailRecipients(e.target.value)}
              placeholder="admin@azienda.com, contabile@azienda.com"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowEmailConfig(false)} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
              <button onClick={async () => {
                await supabase.from('companies').update({ settings: { email_scadenzario: emailRecipients } }).eq('id', COMPANY_ID);
                setShowEmailConfig(false);
              }} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Salva</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Supplier Detail Popup */}
      {supplierDetail && (
        <Modal open={true} onClose={() => setSupplierDetail(null)} title="Dettaglio Fornitore">
          <div className="space-y-3">
            <div>
              <div className="text-xs text-slate-500 uppercase">Ragione Sociale</div>
              <div className="text-base font-semibold text-slate-900">{supplierDetail.ragione_sociale || supplierDetail.name || '—'}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-500 uppercase">P.IVA</div>
                <div className="text-sm text-slate-800 mt-0.5">{supplierDetail.partita_iva || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">CF</div>
                <div className="text-sm text-slate-800 mt-0.5">{supplierDetail.codice_fiscale || '—'}</div>
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase">IBAN</div>
              <div className="text-sm text-slate-800 mt-0.5">{supplierDetail.iban || '—'}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-500 uppercase">Email</div>
                <div className="text-sm text-slate-800 mt-0.5">{supplierDetail.email || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Telefono</div>
                <div className="text-sm text-slate-800 mt-0.5">{supplierDetail.telefono || '—'}</div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {modals.deleteConfirm.open && (
        <Modal open={true} onClose={() => setModals({ ...modals, deleteConfirm: { open: false, scheduleId: null, invoiceNumber: null } })}
          title="Conferma Cancellazione">
          <div className="space-y-3">
            <p className="text-sm">Sei sicuro di voler cancellare <span className="font-mono text-red-600">{modals.deleteConfirm.invoiceNumber}</span>?</p>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModals({ ...modals, deleteConfirm: { open: false, scheduleId: null, invoiceNumber: null } })}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
              <button onClick={() => handleDeleteSchedule(modals.deleteConfirm.scheduleId)} disabled={isSaving}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {isSaving ? 'Cancellazione...' : 'Cancella'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Schedule Modal */}
      {modals.editSchedule.open && modals.editSchedule.schedule && (
        <Modal open={true} onClose={() => setModals({ ...modals, editSchedule: { open: false, schedule: null } })}
          title={`Modifica: ${modals.editSchedule.schedule.invoice_number}`}>
          <EditScheduleModal schedule={modals.editSchedule.schedule} onUpdate={(s) => setModals({ ...modals, editSchedule: { open: true, schedule: s } })} onSave={handleEditSchedule} />
        </Modal>
      )}

      {/* Invoice Modal */}
      {modals.invoice.open && (
        <Modal open={true} onClose={() => setModals({ ...modals, invoice: { open: false, data: null } })} title="Nuova Fattura Fornitore">
          <InvoiceModal suppliers={suppliers} paymentGroups={paymentGroups} paymentMethodLabels={paymentMethodLabels} onSave={handleCreateInvoice} onClose={() => setModals({ ...modals, invoice: { open: false, data: null } })} />
        </Modal>
      )}

      {/* Supplier Modal */}
      {modals.supplier.open && (
        <Modal open={true} onClose={() => setModals({ ...modals, supplier: { open: false, data: null } })} title="Nuovo Fornitore">
          <SupplierModal onSave={handleCreateSupplier} onClose={() => setModals({ ...modals, supplier: { open: false, data: null } })} />
        </Modal>
      )}

      {/* Confirm Result Modal */}
      {confirmResult && (
        <Modal open={true} onClose={() => { setConfirmResult(null); fetchData(); }} title="Pagamenti Confermati" wide>
          <div className="space-y-4">
            {/* Header riepilogo */}
            <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                <CheckCircle2 size={18} /> {confirmResult.results.length} pagamenti registrati con successo
              </p>
              <span className="text-lg font-bold text-emerald-700">{fmt(confirmResult.totaleComplessivo)} €</span>
            </div>

            {/* Dettaglio per banca */}
            {confirmResult.banks.map((bank, bIdx) => {
              const bankColors = [
                { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', accent: 'text-blue-600', bar: 'bg-blue-500' },
                { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', accent: 'text-emerald-600', bar: 'bg-emerald-500' },
                { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', accent: 'text-purple-600', bar: 'bg-purple-500' },
                { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', accent: 'text-amber-600', bar: 'bg-amber-500' },
                { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', accent: 'text-rose-600', bar: 'bg-rose-500' },
                { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', accent: 'text-cyan-600', bar: 'bg-cyan-500' },
              ];
              const c = bank.saldoFinale < 0
                ? { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', accent: 'text-red-600', bar: 'bg-red-500' }
                : bankColors[bIdx % bankColors.length];

              return (
                <div key={bIdx} className={`rounded-xl border ${c.border} overflow-hidden`}>
                  {/* Intestazione banca */}
                  <div className={`${c.bg} px-4 py-3 flex items-center justify-between`}>
                    <div className="flex items-center gap-2">
                      <Landmark size={16} className={c.text} />
                      <div>
                        <div className={`text-sm font-bold ${c.text}`}>{bank.bankName}</div>
                        {bank.iban && <div className="text-xs text-slate-500 font-mono">{bank.iban}</div>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Totale disposto</div>
                      <div className={`text-base font-bold ${c.text}`}>{fmt(bank.totalePagamenti)} €</div>
                    </div>
                  </div>

                  {/* Saldi banca */}
                  <div className="px-4 py-2 bg-white border-b border-slate-100 flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-slate-500">Saldo prima:</div>
                      <div className="text-sm font-semibold text-slate-700">{fmt(bank.saldoIniziale)} €</div>
                    </div>
                    <ChevronRight size={14} className="text-slate-300" />
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-slate-500">Saldo dopo:</div>
                      <div className={`text-sm font-semibold ${bank.saldoFinale < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmt(bank.saldoFinale)} €</div>
                    </div>
                    {/* Barra progresso saldo */}
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${c.bar} rounded-full transition-all`} style={{ width: `${Math.max(0, Math.min(100, (bank.saldoFinale / bank.saldoIniziale) * 100))}%` }} />
                    </div>
                  </div>

                  {/* Lista pagamenti */}
                  <div className="divide-y divide-slate-50">
                    {bank.pagamenti.map((p, pIdx) => (
                      <div key={pIdx} className="px-4 py-2.5 bg-white hover:bg-slate-50/50">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-800 truncate">{p.fornitore}</div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-xs text-slate-500">Fatt. {p.fattura}</span>
                              {p.metodo && <span className="text-xs text-slate-400">• {p.metodo}</span>}
                              <span className={`text-xs px-1.5 py-0.5 rounded ${p.tipo === 'SALDO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{p.tipo}</span>
                            </div>
                          </div>
                          <div className="text-sm font-bold text-slate-900 ml-4">{fmt(p.importo)} €</div>
                        </div>
                        {(p.ibanBeneficiario || p.pivaBeneficiario) && (
                          <div className="mt-1.5 flex items-center gap-3 text-xs">
                            {p.ibanBeneficiario && (
                              <span className="text-slate-500 font-mono bg-slate-50 px-2 py-0.5 rounded">IBAN: {p.ibanBeneficiario}</span>
                            )}
                            {p.pivaBeneficiario && (
                              <span className="text-slate-400">P.IVA: {p.pivaBeneficiario}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Totale complessivo */}
            <div className="flex items-center justify-between p-3 bg-slate-100 rounded-xl">
              <span className="text-sm font-semibold text-slate-700">Totale complessivo</span>
              <span className="text-lg font-bold text-slate-900">{fmt(confirmResult.totaleComplessivo)} €</span>
            </div>

            {/* Azioni email */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send size={14} className="text-indigo-600" />
                  <span className="text-sm font-semibold text-slate-700">Disposizione pagamenti via email</span>
                </div>
                {emailRecipients && <span className="text-xs text-slate-500">A: {emailRecipients}</span>}
              </div>
              <div className="p-3">
                <textarea readOnly value={confirmResult.emailBody} rows={8}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-slate-50 mb-3" />
                <div className="flex gap-2">
                  <button onClick={() => navigator.clipboard.writeText(confirmResult.emailBody)}
                    className="flex-1 py-2.5 bg-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-300 flex items-center justify-center gap-2">
                    <Download size={14} /> Copia testo
                  </button>
                  <button onClick={() => {
                    const to = emailRecipients || '';
                    const subject = encodeURIComponent(confirmResult.emailSubject);
                    const body = encodeURIComponent(confirmResult.emailBody);
                    window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank');
                  }}
                    className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center justify-center gap-2">
                    <Send size={14} /> Apri nella posta
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// Edit Schedule Modal Component
const EditScheduleModal = ({ schedule, onUpdate, onSave }) => {
  const [formData, setFormData] = useState({
    id: schedule.id,
    amount: schedule.gross_amount || 0,
    due_date: schedule.due_date || '',
    status: schedule.status || 'da_pagare',
  });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Importo</label>
        <input type="number" step="0.01" value={formData.amount} onChange={e => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Scadenza</label>
        <input type="date" value={formData.due_date} onChange={e => setFormData({ ...formData, due_date: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Stato</label>
        <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
          <option value="da_pagare">Da Pagare</option>
          <option value="pagato">Pagato</option>
          <option value="parziale">Parziale</option>
        </select>
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={() => onSave({ ...schedule, ...formData })} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Salva</button>
      </div>
    </div>
  );
};

// Invoice Modal Component
const InvoiceModal = ({ suppliers, paymentGroups, paymentMethodLabels, onSave, onClose }) => {
  const [formData, setFormData] = useState({
    supplierId: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    grossAmount: 0,
    paymentMethod: 'bonifico_ordinario',
  });

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Fornitore</label>
        <select value={formData.supplierId} onChange={e => setFormData({ ...formData, supplierId: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
          <option value="">Seleziona fornitore...</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.ragione_sociale || s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Numero Fattura</label>
        <input type="text" value={formData.invoiceNumber} onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Data Fattura</label>
          <input type="date" value={formData.invoiceDate} onChange={e => setFormData({ ...formData, invoiceDate: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Scadenza</label>
          <input type="date" value={formData.dueDate} onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Importo Lordo</label>
        <input type="number" step="0.01" value={formData.grossAmount} onChange={e => setFormData({ ...formData, grossAmount: parseFloat(e.target.value) })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Metodo Pagamento</label>
        <select value={formData.paymentMethod} onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
          {paymentGroups.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.methods.map(m => <option key={m} value={m}>{paymentMethodLabels[m]}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
        <button onClick={() => onSave(formData)} className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">Crea Fattura</button>
      </div>
    </div>
  );
};

// Supplier Modal Component
const SupplierModal = ({ onSave, onClose }) => {
  const [formData, setFormData] = useState({
    name: '', vat: '', fiscal: '', iban: '', category: 'merce',
    paymentMethod: 'bonifico_ordinario', paymentTerms: 30,
  });

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Ragione Sociale *</label>
        <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">P.IVA</label>
          <input type="text" value={formData.vat} onChange={e => setFormData({ ...formData, vat: e.target.value })} maxLength={16}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Codice Fiscale</label>
          <input type="text" value={formData.fiscal} onChange={e => setFormData({ ...formData, fiscal: e.target.value })} maxLength={16}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">IBAN</label>
        <input type="text" value={formData.iban} onChange={e => setFormData({ ...formData, iban: e.target.value })} maxLength={34}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
          <select value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
            {['merce', 'servizi', 'utenze', 'affitti', 'stipendi', 'imposte', 'finanziamenti'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Termini (gg)</label>
          <input type="number" value={formData.paymentTerms} onChange={e => setFormData({ ...formData, paymentTerms: parseInt(e.target.value) })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
        <button onClick={() => onSave(formData)} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Crea Fornitore</button>
      </div>
    </div>
  );
};

export default ScadenzarioSmart;
