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
  Landmark,
  ChevronRight,
  FileText,
  History,
  Building2,
  Repeat,
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
  bloccato: { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-300', badge: 'bg-red-500' },
};

const SUPPLIER_CATEGORIES = ['merce', 'servizi', 'utenze', 'affitti', 'stipendi', 'imposte', 'finanziamenti'];

// ─── Metodi di pagamento: mapping da enum DB v2 → gruppo logico ───
// L'enum DB ha valori dettagliati (riba_30, bonifico_sepa, ecc.)
// Li raggruppiamo per logica operativa
const METHOD_GROUP = {
  bonifico_ordinario: 'bonifico', bonifico_urgente: 'bonifico', bonifico_sepa: 'bonifico',
  riba_30: 'riba', riba_60: 'riba', riba_90: 'riba', riba_120: 'riba',
  rid: 'rid', sdd_core: 'rid', sdd_b2b: 'rid',
  rimessa_diretta: 'rimessa',
  carta_credito: 'carta', carta_debito: 'carta',
  assegno: 'assegno', contanti: 'contanti', compensazione: 'compensazione',
  f24: 'f24', mav: 'mav', rav: 'rav', bollettino_postale: 'bollettino',
  altro: 'altro',
  // Fallback compatibilità enum v1 (se presenti)
  bonifico: 'bonifico', riba: 'riba', carta: 'carta',
};
const getMethodGroup = (m) => METHOD_GROUP[m] || 'altro';

// Metodi passivi: il fornitore incassa, noi possiamo solo bloccare
const PASSIVE_GROUPS = new Set(['riba', 'rid']);
const isPassiveMethod = (m) => PASSIVE_GROUPS.has(getMethodGroup(m));

// Badge colori per gruppo metodo
const GROUP_BADGE = {
  bonifico:      { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Bonifico' },
  riba:          { bg: 'bg-amber-100',   text: 'text-amber-700',  label: 'RIBA' },
  rid:           { bg: 'bg-orange-100',  text: 'text-orange-700', label: 'RID/SDD' },
  rimessa:       { bg: 'bg-teal-100',    text: 'text-teal-700',   label: 'Rimessa Dir.' },
  carta:         { bg: 'bg-purple-100',  text: 'text-purple-700', label: 'Carta' },
  assegno:       { bg: 'bg-cyan-100',    text: 'text-cyan-700',   label: 'Assegno' },
  contanti:      { bg: 'bg-green-100',   text: 'text-green-700',  label: 'Contanti' },
  compensazione: { bg: 'bg-slate-100',   text: 'text-slate-700',  label: 'Comp.' },
  f24:           { bg: 'bg-indigo-100',  text: 'text-indigo-700', label: 'F24' },
  mav:           { bg: 'bg-sky-100',     text: 'text-sky-700',    label: 'MAV' },
  rav:           { bg: 'bg-sky-100',     text: 'text-sky-700',    label: 'RAV' },
  bollettino:    { bg: 'bg-yellow-100',  text: 'text-yellow-700', label: 'Bollettino' },
  altro:         { bg: 'bg-slate-100',   text: 'text-slate-600',  label: 'Altro' },
};

// Label dettagliata per enum DB (tooltip/subtitle)
const METHOD_DETAIL_LABEL = {
  bonifico_ordinario: 'Ordinario', bonifico_urgente: 'Urgente', bonifico_sepa: 'SEPA',
  riba_30: '30gg', riba_60: '60gg', riba_90: '90gg', riba_120: '120gg',
  rid: 'RID', sdd_core: 'SDD Core', sdd_b2b: 'SDD B2B',
};

const PaymentMethodBadge = ({ method }) => {
  const group = getMethodGroup(method);
  const badge = GROUP_BADGE[group] || GROUP_BADGE.altro;
  const detail = METHOD_DETAIL_LABEL[method];
  const passive = PASSIVE_GROUPS.has(group);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}
      title={detail ? `${badge.label} ${detail}` : badge.label}>
      {badge.label}
      {detail && <span className="opacity-60 text-[10px]">{detail}</span>}
      {passive && <Ban className="w-3 h-3" title="Incasso passivo — bloccabile" />}
    </span>
  );
};

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
  const { profile, session } = useAuth();
  const COMPANY_ID = profile?.company_id;
  const operatorName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : (session?.user?.email || 'Operatore');

  const [section, setSection] = useState('scadenze'); // 'scadenze' | 'ricorrenti'
  const [loading, setLoading] = useState(true);
  const [payables, setPayables] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [cashPosition, setCashPosition] = useState(0);

  const [viewMode, setViewMode] = useState('timeline');
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedMethodGroup, setSelectedMethodGroup] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [paymentPlan, setPaymentPlan] = useState({});
  const [emailRecipients, setEmailRecipients] = useState('');
  const [showEmailConfig, setShowEmailConfig] = useState(false);

  // Riepilogo pagamenti completati nella sessione corrente (raggruppati per banca)
  const [completedPayments, setCompletedPayments] = useState([]);
  const [showPaymentReview, setShowPaymentReview] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [invoiceDetails, setInvoiceDetails] = useState({}); // cache: { payableId: { ... } }

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

  // Date range di default: da oggi a 12 mesi avanti
  const getDynamicDateRange = () => {
    const now = new Date();
    const twelveMonthsAhead = new Date(now);
    twelveMonthsAhead.setMonth(twelveMonthsAhead.getMonth() + 12);
    return {
      start: now.toISOString().split('T')[0],
      end: twelveMonthsAhead.toISOString().split('T')[0],
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

        // Map view data to component format — arricchisci con dati fornitore (IBAN, P.IVA)
        // Mappa per nome, ragione_sociale E vat_number per massimizzare il match
        const suppliersMap = {};
        const suppliersByVat = {};
        const suppliersById = {};
        (suppliersData || []).forEach(s => {
          if (s.name) suppliersMap[s.name.toLowerCase().trim()] = s;
          if (s.ragione_sociale) suppliersMap[s.ragione_sociale.toLowerCase().trim()] = s;
          if (s.vat_number) suppliersByVat[s.vat_number] = s;
          if (s.partita_iva) suppliersByVat[s.partita_iva] = s;
          if (s.id) suppliersById[s.id] = s;
        });

        const enrichedPayables = (viewData || []).map(row => {
          // Cerca il fornitore per: ID > P.IVA > nome (in ordine di affidabilità)
          const supplierMatch =
            (row.supplier_id && suppliersById[row.supplier_id]) ||
            (row.supplier_vat && suppliersByVat[row.supplier_vat]) ||
            (row.supplier_name && suppliersMap[row.supplier_name.toLowerCase().trim()]) ||
            {};
          return {
            id: row.id,
            supplier_id: row.supplier_id || supplierMatch.id,
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
              ragione_sociale: row.supplier_ragione_sociale || supplierMatch.ragione_sociale || supplierMatch.name || row.supplier_name,
              category: row.supplier_category || supplierMatch.category || 'altro',
              iban: row.supplier_iban || supplierMatch.iban || '',
              partita_iva: row.supplier_vat || supplierMatch.vat_number || supplierMatch.partita_iva || '',
            },
            last_action_type: row.last_action_type,
            last_action_note: row.last_action_note,
            last_action_date: row.last_action_date,
          };
        });

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

  // Base filter (senza filtro metodo — usato per i badge KPI che devono restare sempre visibili)
  const baseFilteredPayables = useMemo(() => {
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
      const isOverdueUnpaid = p.status !== 'pagato' && dueDate < new Date(dateRange.start);
      const matchDate = searchTerm
        ? true
        : isOverdueUnpaid || (dueDate >= new Date(dateRange.start) && dueDate <= new Date(dateRange.end));

      return matchOutlet && matchStatus && matchSearch && matchDate;
    });
  }, [payables, selectedOutlet, selectedStatus, searchTerm, dateRange]);

  // Filter payables (include filtro metodo)
  const filteredPayables = useMemo(() => {
    if (!selectedMethodGroup) return baseFilteredPayables;
    return baseFilteredPayables.filter(p => getMethodGroup(p.payment_method) === selectedMethodGroup);
  }, [baseFilteredPayables, selectedMethodGroup]);

  // Calculate KPIs
  const kpis = useMemo(() => {
    const totalDuePending = filteredPayables
      .filter((p) => p.status !== 'pagato' && new Date(p.due_date) <= today)
      .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

    const overdueItems = filteredPayables.filter((p) => p.status === 'scaduto');
    const totalOverdue = overdueItems.reduce((sum, p) => sum + (p.amount_remaining || 0), 0);
    const countOverdue = overdueItems.length;

    const sevenDayItems = filteredPayables.filter((p) => {
      const d = new Date(p.due_date);
      return d >= today && d <= new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) && p.status !== 'pagato';
    });
    const nextSevenDays = sevenDayItems.reduce((sum, p) => sum + (p.amount_remaining || 0), 0);
    const countSevenDays = sevenDayItems.length;

    const totalSuspended = filteredPayables
      .filter((p) => p.status === 'contestato')
      .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

    const toPayItems = filteredPayables.filter((p) => p.status !== 'pagato');
    const totalToPay = toPayItems.reduce((sum, p) => sum + (p.amount_remaining || 0), 0);
    const countToPay = toPayItems.length;
    const countTotal = filteredPayables.length;

    const cashShortfall = totalToPay > cashPosition ? totalToPay - cashPosition : 0;

    // Breakdown per gruppo modalità — calcolato su baseFilteredPayables (senza filtro metodo)
    // così i badge restano sempre tutti visibili anche quando uno è selezionato
    const byMethod = {};
    baseFilteredPayables.filter(p => p.status !== 'pagato').forEach(p => {
      const group = getMethodGroup(p.payment_method);
      if (!byMethod[group]) byMethod[group] = { count: 0, amount: 0 };
      byMethod[group].count += 1;
      byMethod[group].amount += (p.amount_remaining || 0);
    });

    return {
      totalDuePending,
      totalOverdue,
      countOverdue,
      nextSevenDays,
      countSevenDays,
      totalSuspended,
      totalToPay,
      countToPay,
      countTotal,
      cashShortfall,
      availableCash: cashPosition,
      byMethod,
    };
  }, [filteredPayables, baseFilteredPayables, cashPosition, today]);

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
      if (!groups[key]) groups[key] = { label, items: [], total: 0, paid: 0, remaining: 0, planned: 0 };
      groups[key].items.push(p);
      groups[key].total += p.gross_amount || 0;
      groups[key].paid += p.amount_paid || 0;
      groups[key].remaining += p.amount_remaining || 0;
      // Se questa fattura è selezionata per pagamento, somma l'importo pianificato
      if (selectedIds.has(p.id) && paymentPlan[p.id]) {
        groups[key].planned += paymentPlan[p.id].amount || 0;
      }
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredPayables, selectedIds, paymentPlan]);

  // Format currency
  const formatCurrency = (num) =>
    new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(num);

  // Process a single payment directly from inline row
  const handleSinglePayment = async (payableId) => {
    const plan = paymentPlan[payableId];
    const payable = payables.find(p => p.id === payableId);
    if (!plan || !payable) return;

    // Per blocco RIBA/RID non serve bankId
    const isBlocco = plan.type === 'blocco';
    if (!isBlocco && !plan.bankId) return;

    setIsSaving(true);
    try {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      if (isBlocco) {
        // ─── BLOCCO RIBA/RID: non scala saldo, segna come bloccato ───
        const { error: updateError } = await supabase.from('payables').update({
          status: 'bloccato',
        }).eq('id', payableId);
        if (updateError) throw updateError;

        await supabase.from('payable_actions').insert({
          payable_id: payableId,
          action_type: 'blocco_riba',
          old_status: payable.status,
          new_status: 'bloccato',
          amount: 0,
          note: plan.note || `Blocco ${payable.payment_method?.toUpperCase()} disposto`,
          operator_name: operatorName,
          requested_at: now.toISOString(),
        });

        const paymentRecord = {
          id: payableId,
          fornitore: payable.suppliers?.ragione_sociale || payable.suppliers?.name || 'N/A',
          fattura: payable.invoice_number,
          data_fattura: payable.invoice_date,
          scadenza: payable.due_date,
          importo: 0,
          importo_totale: payable.gross_amount,
          tipo: 'BLOCCATA',
          banca: '',
          banca_id: null,
          conto: '',
          iban_banca: '',
          iban_fornitore: payable.suppliers?.iban || '',
          partita_iva: payable.suppliers?.partita_iva || '',
          metodo_pagamento: payable.payment_method || 'riba',
          causale: `Blocco ${payable.payment_method?.toUpperCase()} fatt. n. ${payable.invoice_number} del ${payable.invoice_date ? new Date(payable.invoice_date).toLocaleDateString('it-IT') : '-'} - ${payable.suppliers?.ragione_sociale || payable.suppliers?.name || ''}`,
          note: plan.note || '',
          operatore: operatorName,
          timestamp: now.toISOString(),
        };
        setCompletedPayments(prev => [...prev, paymentRecord]);

        setPayables(prev => prev.map(p =>
          p.id === payableId ? { ...p, status: 'bloccato' } : p
        ));
      } else {
        // ─── PAGAMENTO STANDARD (saldo/parziale) ───
        const newPaid = (payable.amount_paid || 0) + plan.amount;
        const newStatus = plan.type === 'saldo' ? 'pagato' : 'parziale';
        const bank = bankAccounts.find(b => b.id === plan.bankId);

        const { error: updateError } = await supabase.from('payables').update({
          amount_paid: newPaid,
          amount_remaining: payable.gross_amount - newPaid,
          payment_date: todayStr,
          payment_bank_account_id: plan.bankId || null,
          status: newStatus,
        }).eq('id', payableId);
        if (updateError) throw updateError;

        // Scala il saldo del conto bancario
        if (bank) {
          const newBalance = (bank.current_balance || 0) - plan.amount;
          const { error: bankError } = await supabase.from('bank_accounts').update({
            current_balance: newBalance,
            last_update: now.toISOString(),
          }).eq('id', plan.bankId);
          if (bankError) console.error('Error updating bank balance:', bankError);
          setBankAccounts(prev => prev.map(b => b.id === plan.bankId ? { ...b, current_balance: newBalance } : b));
        }

        await supabase.from('payable_actions').insert({
          payable_id: payableId,
          action_type: newStatus === 'pagato' ? 'pagamento' : 'pagamento_parziale',
          old_status: payable.status,
          new_status: newStatus,
          amount: plan.amount,
          bank_account_id: plan.bankId || null,
          note: plan.note || null,
          operator_name: operatorName,
          requested_at: now.toISOString(),
        });

        const paymentRecord = {
          id: payableId,
          fornitore: payable.suppliers?.ragione_sociale || payable.suppliers?.name || 'N/A',
          fattura: payable.invoice_number,
          data_fattura: payable.invoice_date,
          scadenza: payable.due_date,
          importo: plan.amount,
          importo_totale: payable.gross_amount,
          tipo: plan.type === 'saldo' ? 'SALDO' : 'PARZIALE',
          banca: bank?.bank_name || 'N/D',
          banca_id: plan.bankId,
          conto: bank?.account_name || '',
          iban_banca: bank?.iban || '',
          iban_fornitore: payable.suppliers?.iban || '',
          partita_iva: payable.suppliers?.partita_iva || '',
          metodo_pagamento: payable.payment_method || 'bonifico',
          causale: `${plan.type === 'saldo' ? 'Saldo' : 'Acconto'} fatt. n. ${payable.invoice_number} del ${payable.invoice_date ? new Date(payable.invoice_date).toLocaleDateString('it-IT') : '-'} - ${payable.suppliers?.ragione_sociale || payable.suppliers?.name || ''}`,
          note: plan.note || '',
          operatore: operatorName,
          timestamp: now.toISOString(),
        };
        setCompletedPayments(prev => [...prev, paymentRecord]);

        setPayables(prev => prev.map(p =>
          p.id === payableId
            ? { ...p, amount_paid: newPaid, amount_remaining: payable.gross_amount - newPaid, status: newStatus }
            : p
        ));
      }

      // Rimuovi dalla selezione
      const next = new Set(selectedIds);
      next.delete(payableId);
      setSelectedIds(next);
      const nextPlan = { ...paymentPlan };
      delete nextPlan[payableId];
      setPaymentPlan(nextPlan);
      setIsSaving(false);
    } catch (error) {
      console.error('Error processing single payment:', error);
      setIsSaving(false);
    }
  };

  // Render inline payment controls for a selected row
  const renderPaymentRow = (p, colSpan = 7) => {
    if (!selectedIds.has(p.id) || !paymentPlan[p.id]) return null;
    const plan = paymentPlan[p.id];
    const isPassive = isPassiveMethod(p.payment_method);

    // Per RIBA/RID: mostra opzione "Blocca" (non paga, non scala saldo)
    if (isPassive) {
      return (
        <tr className="bg-amber-50 border-b border-amber-100">
          <td colSpan={colSpan} className="px-6 py-3">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-amber-700">
                <Ban className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {p.payment_method === 'riba' ? 'RIBA' : 'RID'} — Incasso passivo
                </span>
              </div>
              <div className="text-xs text-amber-600">
                Il fornitore incassa automaticamente. Puoi bloccare l'addebito oppure lasciarlo passare.
              </div>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => { updatePlan(p.id, 'type', 'blocco'); updatePlan(p.id, 'amount', 0); updatePlan(p.id, 'bankId', 'block'); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    plan.type === 'blocco'
                      ? 'bg-red-600 text-white'
                      : 'bg-white text-red-600 border border-red-200 hover:bg-red-50'
                  }`}
                >
                  <Ban className="w-3.5 h-3.5" /> Blocca
                </button>
                <button
                  onClick={() => { updatePlan(p.id, 'type', 'saldo'); updatePlan(p.id, 'amount', p.amount_remaining || 0); updatePlan(p.id, 'bankId', bankAccounts[0]?.id || ''); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                    plan.type !== 'blocco'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Lascia passare
                </button>
              </div>
              {plan.type !== 'blocco' && (
                <div className="w-full mt-2">
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-slate-500">Conto di addebito:</label>
                    <select value={plan.bankId} onChange={e => updatePlan(p.id, 'bankId', e.target.value)}
                      className="px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">Seleziona...</option>
                      {bankAccounts.map(ba => (
                        <option key={ba.id} value={ba.id}>{ba.bank_name} ({formatCurrency(bankBalances[ba.id] || 0)})</option>
                      ))}
                    </select>
                    <span className="text-xs text-slate-500">Importo: <strong>{formatCurrency(p.amount_remaining || 0)}</strong> — scalerà dal saldo</span>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      );
    }

    // Per bonifico/carta/contanti/altro: flusso standard
    return (
      <tr className="bg-indigo-50 border-b border-indigo-100">
        <td colSpan={colSpan} className="px-6 py-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Banca di addebito</label>
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
                  Acconto
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
                    placeholder="Motivo acconto..." className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </>
            )}
            {/* Indicatore stato */}
            <div className="ml-auto text-xs text-slate-400">
              {plan.bankId
                ? <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Pronta</span>
                : <span className="text-amber-500">Seleziona banca →</span>
              }
            </div>
          </div>
        </td>
      </tr>
    );
  };

  // Status color helper
  const getStatusColor = (status) => COLORI_STATO[status] || COLORI_STATO.da_pagare;

  // ─── DETTAGLIO FATTURA: fetch on-demand quando l'utente espande una riga ───
  const toggleExpand = async (payableId) => {
    if (expandedId === payableId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(payableId);

    // Se già in cache, non refetchare
    if (invoiceDetails[payableId]) return;

    try {
      const payable = payables.find(p => p.id === payableId);

      // Fetch parallelo: electronic_invoice (descrizione) + azioni storico + supplier completo
      const [eiResult, actionsResult, supplierResult] = await Promise.all([
        // 1. Electronic invoice (descrizione, net/vat breakdown)
        payable?.electronic_invoice_id
          ? supabase.from('electronic_invoices').select('*').eq('id', payable.electronic_invoice_id).single()
          : supabase.from('electronic_invoices').select('*').eq('invoice_number', payable?.invoice_number).eq('company_id', COMPANY_ID).limit(1).maybeSingle(),
        // 2. Storico azioni
        supabase.from('payable_actions').select('*').eq('payable_id', payableId).order('performed_at', { ascending: false }),
        // 3. Supplier completo
        payable?.supplier_id
          ? supabase.from('suppliers').select('*').eq('id', payable.supplier_id).single()
          : Promise.resolve({ data: null }),
      ]);

      setInvoiceDetails(prev => ({
        ...prev,
        [payableId]: {
          invoice: eiResult.data || null,
          actions: actionsResult.data || [],
          supplier: supplierResult.data || null,
        },
      }));
    } catch (err) {
      console.error('Error fetching invoice details:', err);
    }
  };

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

  // Confirm and process bulk payments — processa SOLO le fatture non ancora registrate
  const confirmPayments = async () => {
    setIsSaving(true);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Filtra: processa solo le fatture NON ancora registrate (da "Prepara Distinta")
    const toProcess = completedPayments.filter(p => !p._registrato);
    if (toProcess.length === 0) {
      // Tutte già registrate singolarmente — niente da fare, solo chiudi
      setIsSaving(false);
      return;
    }

    try {
      const updatedBanks = [...bankAccounts];
      const updatedPayables = [...payables];

      for (const record of toProcess) {
        const payable = payables.find(p => p.id === record.id);
        if (!payable) continue;

        if (record.tipo === 'BLOCCATA') {
          // ─── BLOCCO RIBA/RID: non scala saldo ───
          const { error: updateError } = await supabase.from('payables').update({
            status: 'bloccato',
          }).eq('id', record.id);
          if (updateError) throw updateError;

          await supabase.from('payable_actions').insert({
            payable_id: record.id,
            action_type: 'blocco_riba',
            old_status: payable.status,
            new_status: 'bloccato',
            amount: 0,
            note: record.note || `Blocco ${record.metodo_pagamento?.toUpperCase()} disposto`,
            operator_name: operatorName,
            requested_at: now.toISOString(),
          });

          const idx = updatedPayables.findIndex(p => p.id === record.id);
          if (idx >= 0) {
            updatedPayables[idx] = { ...updatedPayables[idx], status: 'bloccato' };
          }
        } else {
          // ─── PAGAMENTO STANDARD ───
          const newPaid = (payable.amount_paid || 0) + record.importo;
          const newStatus = record.tipo === 'SALDO' ? 'pagato' : 'parziale';
          const bank = updatedBanks.find(b => b.id === record.banca_id);

          const { error: updateError } = await supabase.from('payables').update({
            amount_paid: newPaid,
            amount_remaining: payable.gross_amount - newPaid,
            payment_date: todayStr,
            payment_bank_account_id: record.banca_id || null,
            status: newStatus,
          }).eq('id', record.id);
          if (updateError) throw updateError;

          // Scala il saldo del conto bancario
          if (bank) {
            const newBalance = (bank.current_balance || 0) - record.importo;
            await supabase.from('bank_accounts').update({
              current_balance: newBalance,
              last_update: now.toISOString(),
            }).eq('id', record.banca_id);
            bank.current_balance = newBalance;
          }

          await supabase.from('payable_actions').insert({
            payable_id: record.id,
            action_type: newStatus === 'pagato' ? 'pagamento' : 'pagamento_parziale',
            old_status: payable.status,
            new_status: newStatus,
            amount: record.importo,
            bank_account_id: record.banca_id || null,
            note: record.note || null,
            operator_name: operatorName,
            requested_at: now.toISOString(),
          });

          const idx = updatedPayables.findIndex(p => p.id === record.id);
          if (idx >= 0) {
            updatedPayables[idx] = { ...updatedPayables[idx], amount_paid: newPaid, amount_remaining: payable.gross_amount - newPaid, status: newStatus };
          }
        }
      }

      // Aggiorna stato locale senza reload
      setPayables(updatedPayables);
      setBankAccounts(updatedBanks);
      // Marca tutte come registrate
      setCompletedPayments(prev => prev.map(p => ({ ...p, _registrato: true })));
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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
          <p className="text-slate-600">Caricamento scadenzario...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Sticky header: Bank Balances + KPI Cards — sempre visibili */}
      <div className="sticky top-0 z-40 bg-gradient-to-br from-slate-50 to-slate-100 shadow-md border-b border-slate-200 px-6 pt-3 pb-3">
        <div className="max-w-7xl mx-auto space-y-3">
          {/* Bank Balances */}
          {bankAccounts.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {bankAccounts.map(ba => {
                const bal = bankBalances[ba.id] || 0;
                const orig = ba.current_balance || 0;
                const used = orig - bal;
                const isNeg = bal < 0;
                return (
                  <div key={ba.id} className={`bg-white rounded-xl shadow-sm p-3 border-l-4 ${isNeg ? 'border-red-500 bg-red-50' : 'border-emerald-500'}`}>
                    <div className="text-xs text-slate-500 font-medium truncate">{ba.bank_name}</div>
                    <div className="text-xs text-slate-400 truncate">{ba.account_name || ba.iban?.slice(-8)}</div>
                    <div className={`text-lg font-bold ${isNeg ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatCurrency(bal)}
                    </div>
                    {used > 0 && <div className="text-xs text-amber-600">Assegnati: {formatCurrency(used)}</div>}
                    {isNeg && <div className="text-xs text-red-500 font-semibold">Saldo insufficiente</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700 flex items-center gap-2">
              <Wallet className="w-4 h-4" /> Nessun conto bancario configurato.
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl shadow-sm p-3 border-l-4 border-blue-500">
              <div className="text-xs text-slate-600 font-medium">Totale da Pagare</div>
              <div className="text-xl font-bold text-blue-600">{formatCurrency(kpis.totalToPay)}</div>
              <div className="text-xs text-slate-500">{kpis.countToPay} fatture su {kpis.countTotal} totali</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-3 border-l-4 border-red-500">
              <div className="text-xs text-slate-600 font-medium">Scadute</div>
              <div className="text-xl font-bold text-red-600">{formatCurrency(kpis.totalOverdue)}</div>
              <div className="text-xs text-slate-500">{kpis.countOverdue} fatture scadute</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-3 border-l-4 border-orange-500">
              <div className="text-xs text-slate-600 font-medium">Prossimi 7gg</div>
              <div className="text-xl font-bold text-orange-600">{formatCurrency(kpis.nextSevenDays)}</div>
              <div className="text-xs text-slate-500">{kpis.countSevenDays} fatture in scadenza</div>
            </div>
            <div className={`bg-white rounded-xl shadow-sm p-3 border-l-4 ${kpis.cashShortfall > 0 ? 'border-red-500' : 'border-emerald-500'}`}>
              <div className="text-xs text-slate-600 font-medium">Disponibilità Cassa</div>
              <div className={`text-xl font-bold ${kpis.cashShortfall > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {formatCurrency(kpis.availableCash)}
              </div>
              <div className="text-xs text-slate-500">
                {kpis.cashShortfall > 0 ? `Mancano: ${formatCurrency(kpis.cashShortfall)}` : 'Copertura OK'}
              </div>
            </div>
          </div>

          {/* Breakdown per modalità pagamento */}
          {Object.keys(kpis.byMethod).length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 font-medium mr-1">Per modalità:</span>
              {Object.entries(kpis.byMethod)
                .sort((a, b) => b[1].amount - a[1].amount)
                .map(([group, data]) => {
                  const badge = GROUP_BADGE[group] || GROUP_BADGE.altro;
                  const passive = PASSIVE_GROUPS.has(group);
                  const isActive = selectedMethodGroup === group;
                  return (
                    <button key={group}
                      onClick={() => setSelectedMethodGroup(isActive ? '' : group)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        isActive
                          ? `${badge.bg} ${badge.text} ring-2 ring-offset-1 ring-current shadow-sm scale-105`
                          : `${badge.bg} ${badge.text} opacity-80 hover:opacity-100 hover:shadow-sm`
                      }`}>
                      {passive && <Ban className="w-3 h-3" />}
                      <span className="font-semibold">{badge.label}</span>
                      <span className="opacity-70">×{data.count}</span>
                      <span className="font-bold">{formatCurrency(data.amount)}</span>
                    </button>
                  );
                })}
              {selectedMethodGroup && (
                <button onClick={() => setSelectedMethodGroup('')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-slate-200 text-slate-600 hover:bg-slate-300 transition">
                  <X className="w-3 h-3" /> Reset filtro
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header compatto */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Clock className="w-8 h-8 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Scadenzario</h1>
              <p className="text-xs text-slate-500">{today.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
          </div>
          <button onClick={() => setShowEmailConfig(true)} className="text-slate-400 hover:text-indigo-600 transition p-2 rounded-lg hover:bg-slate-100" title="Configura email">
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Scadenze / Costi Ricorrenti */}
        <div className="flex gap-2 mb-5">
          {[
            { key: 'scadenze', icon: Clock3, label: 'Scadenze SDI' },
            { key: 'ricorrenti', icon: Repeat, label: 'Costi Ricorrenti' },
          ].map(t => (
            <button key={t.key}
              onClick={() => setSection(t.key)}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${
                section === t.key
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
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
        <>
        {/* Filtri compatti — una riga */}
        <div className="bg-white rounded-xl shadow-sm p-3 mb-5 border border-slate-200">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-48">
              <input
                type="text"
                placeholder="Cerca fornitore o n. fattura..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
              />
            </div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
            >
              <option value="">Tutti gli stati</option>
              <option value="da_saldare">Da Saldare</option>
              <option value="da_pagare">Da Pagare</option>
              <option value="in_scadenza">In Scadenza</option>
              <option value="scaduto">Scaduto</option>
              <option value="parziale">Parziale</option>
              <option value="pagato">Pagato</option>
              <option value="nota_credito">Note Credito</option>
            </select>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>Dal</span>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="px-2 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
              />
              <span>al</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="px-2 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
              />
            </div>
            <button
              onClick={() => setDateRange({ start: '2024-01-01', end: '2027-12-31' })}
              className="px-3 py-2 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition whitespace-nowrap"
            >
              Tutte le date
            </button>
            {(searchTerm || selectedStatus || selectedOutlet) && (
              <button
                onClick={() => { setSearchTerm(''); setSelectedStatus(''); setSelectedOutlet(''); setSelectedMethodGroup(''); setDateRange(getDynamicDateRange()); }}
                className="px-3 py-2 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition whitespace-nowrap flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Reset filtri
              </button>
            )}
          </div>
        </div>

        {/* Barra azioni: viste + bottoni */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex gap-2">
            {[
              { key: 'timeline', icon: Clock3, label: 'Tutte' },
              { key: 'fornitore', icon: Filter, label: 'Per Fornitore' },
              { key: 'mese', icon: Calendar, label: 'Per Mese' },
            ].map(v => (
              <button key={v.key}
                onClick={() => setViewMode(v.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  viewMode === v.key
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                <v.icon className="w-4 h-4 inline mr-1.5" />
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setModals({ ...modals, invoice: { open: true, data: null } })}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Nuova Fattura
            </button>
            <button
              onClick={() => setModals({ ...modals, supplier: { open: true, data: null } })}
              className="px-4 py-2 bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition text-sm font-medium flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Nuovo Fornitore
            </button>
          </div>
        </div>

        {/* Timeline View - Payables Table */}
        {viewMode === 'timeline' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-2 py-2.5 text-center w-8">
                      <button onClick={toggleSelectAll} className="text-slate-400 hover:text-indigo-600 transition" title="Seleziona tutto">
                        {selectedIds.size > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-700">Fornitore</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-700">Scadenza</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700">Rimane</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-700">Metodo</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-700">Stato</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-700 w-16">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredPayables.map((p) => {
                    const statusColor = getStatusColor(p.status);
                    const daysTo = Math.ceil(
                      (new Date(p.due_date) - today) / (1000 * 60 * 60 * 24)
                    );
                    return (
                      <React.Fragment key={p.id}>
                        <tr className={`hover:bg-slate-50 transition ${p.status === 'pagato' ? 'bg-emerald-50 border-l-4 border-emerald-400' : ''} ${selectedIds.has(p.id) ? 'bg-indigo-50' : ''}`}>
                          <td className="px-2 py-2 text-center">
                            {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && (
                              <button onClick={() => toggleSelect(p.id, p)} className={selectedIds.has(p.id) ? 'text-indigo-600' : 'text-slate-300 hover:text-slate-500'} title="Seleziona">
                                {selectedIds.has(p.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-900">
                            <button onClick={() => toggleExpand(p.id)} className="flex items-center gap-1.5 hover:text-indigo-600 transition text-left">
                              <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${expandedId === p.id ? 'rotate-90' : ''}`} />
                              <div className="min-w-0">
                                <div className="font-medium truncate">{p.suppliers?.ragione_sociale || p.supplier_name || 'N/A'}</div>
                                <div className="text-xs text-slate-400 truncate">Fatt. {p.invoice_number}</div>
                              </div>
                            </button>
                          </td>
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                            {new Date(p.due_date).toLocaleDateString('it-IT')}
                            <div className="text-xs text-slate-400">
                              {daysTo < 0 ? <span className="text-red-500">{Math.abs(daysTo)}gg fa</span> : `tra ${daysTo}gg`}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-900 font-semibold whitespace-nowrap">
                            {formatCurrency(p.amount_remaining || 0)}
                            {(p.amount_paid || 0) > 0 && (
                              <div className="text-xs text-emerald-500 font-normal">pagato {formatCurrency(p.amount_paid)}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <PaymentMethodBadge method={p.payment_method} />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor.bg} ${statusColor.text}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <div className="flex gap-1 justify-center">
                              <button
                                onClick={() => setModals({ ...modals, editSchedule: { open: true, schedule: p } })}
                                className="text-blue-600 hover:text-blue-700 p-1 rounded hover:bg-blue-50 transition" title="Modifica"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setModals({ ...modals, deleteConfirm: { open: true, scheduleId: p.id, invoiceNumber: p.invoice_number } })}
                                className="text-red-600 hover:text-red-700 p-1 rounded hover:bg-red-50 transition" title="Cancella"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                      </tr>
                      {renderPaymentRow(p, 7)}
                      {/* ─── RIGA ACCORDION: dettaglio fattura ─── */}
                      {expandedId === p.id && (() => {
                        const detail = invoiceDetails[p.id];
                        const isLoading = !detail;
                        const ei = detail?.invoice;
                        const actions = detail?.actions || [];
                        const sup = detail?.supplier;
                        const fmtD = (d) => d ? new Date(d).toLocaleDateString('it-IT') : '-';
                        return (
                          <tr className="bg-slate-50">
                            <td colSpan={7} className="px-4 py-3">
                              {isLoading ? (
                                <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
                                  <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                                  Caricamento dettagli...
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                  {/* Col 1: Dati Fattura */}
                                  <div className="space-y-3">
                                    <h4 className="font-bold text-slate-800 flex items-center gap-1.5"><FileText className="w-4 h-4 text-indigo-500" /> Dati Fattura</h4>
                                    <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5">
                                      <div><span className="text-slate-500">Numero:</span> <strong>{p.invoice_number}</strong></div>
                                      <div><span className="text-slate-500">Data fattura:</span> {fmtD(p.invoice_date)}</div>
                                      <div><span className="text-slate-500">Scadenza:</span> {fmtD(p.due_date)}</div>
                                      {p.original_due_date && p.original_due_date !== p.due_date && (
                                        <div><span className="text-slate-500">Scad. originale:</span> <span className="line-through text-slate-400">{fmtD(p.original_due_date)}</span></div>
                                      )}
                                      <div className="border-t border-slate-100 pt-1.5 mt-1.5">
                                        <div><span className="text-slate-500">Netto:</span> {formatCurrency(ei?.net_amount || p.net_amount || 0)}</div>
                                        <div><span className="text-slate-500">IVA:</span> {formatCurrency(ei?.vat_amount || p.vat_amount || 0)}</div>
                                        <div><span className="text-slate-500">Lordo:</span> <strong>{formatCurrency(p.gross_amount)}</strong></div>
                                        <div><span className="text-slate-500">Pagato:</span> <span className="text-emerald-600">{formatCurrency(p.amount_paid || 0)}</span></div>
                                        <div><span className="text-slate-500">Residuo:</span> <strong className="text-red-600">{formatCurrency(p.amount_remaining || 0)}</strong></div>
                                      </div>
                                      {p.payment_method && (
                                        <div className="pt-1"><span className="text-slate-500">Metodo:</span> <PaymentMethodBadge method={p.payment_method} /></div>
                                      )}
                                      {p.payment_method_label && (
                                        <div><span className="text-slate-500">Codice SDI:</span> {p.payment_method_code} — {p.payment_method_label}</div>
                                      )}
                                      {p.installment_number && (
                                        <div><span className="text-slate-500">Rata:</span> {p.installment_number} di {p.installment_total}</div>
                                      )}
                                    </div>
                                    {/* Descrizione/Causale */}
                                    {ei?.description && (
                                      <div className="bg-indigo-50 rounded-lg border border-indigo-100 p-3">
                                        <div className="text-xs text-indigo-600 font-semibold mb-1">Descrizione / Causale</div>
                                        <div className="text-slate-700">{ei.description}</div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Col 2: Dati Fornitore */}
                                  <div className="space-y-3">
                                    <h4 className="font-bold text-slate-800 flex items-center gap-1.5"><Building2 className="w-4 h-4 text-indigo-500" /> Fornitore</h4>
                                    <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5">
                                      <div className="font-semibold text-slate-900">{sup?.name || sup?.ragione_sociale || p.suppliers?.ragione_sociale || p.supplier_name || '-'}</div>
                                      {(sup?.vat_number || p.suppliers?.partita_iva) && (
                                        <div><span className="text-slate-500">P.IVA:</span> {sup?.vat_number || p.suppliers?.partita_iva}</div>
                                      )}
                                      {sup?.fiscal_code && (
                                        <div><span className="text-slate-500">Cod. Fiscale:</span> {sup.fiscal_code}</div>
                                      )}
                                      {sup?.iban && (
                                        <div><span className="text-slate-500">IBAN:</span> <span className="font-mono text-xs">{sup.iban}</span></div>
                                      )}
                                      {sup?.category && (
                                        <div><span className="text-slate-500">Categoria:</span> {sup.category}</div>
                                      )}
                                      {sup?.default_payment_terms && (
                                        <div><span className="text-slate-500">Termini pag.:</span> {sup.default_payment_terms}gg</div>
                                      )}
                                      {sup?.default_payment_method && (
                                        <div><span className="text-slate-500">Metodo default:</span> <PaymentMethodBadge method={sup.default_payment_method} /></div>
                                      )}
                                      {sup?.notes && (
                                        <div className="border-t border-slate-100 pt-1.5 mt-1.5 text-xs text-slate-500 italic">{sup.notes}</div>
                                      )}
                                      {!sup && <div className="text-xs text-slate-400 italic">Nessun fornitore collegato in anagrafica</div>}
                                    </div>
                                  </div>

                                  {/* Col 3: Storico Azioni */}
                                  <div className="space-y-3">
                                    <h4 className="font-bold text-slate-800 flex items-center gap-1.5"><History className="w-4 h-4 text-indigo-500" /> Storico Azioni</h4>
                                    {actions.length > 0 ? (
                                      <div className="space-y-2">
                                        {actions.map((a, i) => (
                                          <div key={i} className="bg-white rounded-lg border border-slate-200 p-2.5 flex items-start gap-2">
                                            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                                              a.action_type === 'pagamento' ? 'bg-emerald-500' :
                                              a.action_type === 'blocco_riba' ? 'bg-red-500' :
                                              'bg-blue-500'
                                            }`} />
                                            <div className="flex-1 min-w-0">
                                              <div className="font-medium text-slate-800 text-xs">{a.action_type.replace(/_/g, ' ')}</div>
                                              {a.amount > 0 && <div className="text-xs text-slate-600">{formatCurrency(a.amount)}</div>}
                                              {a.operator_name && <div className="text-xs text-slate-400">{a.operator_name}</div>}
                                              <div className="text-xs text-slate-400">{fmtD(a.performed_at)} {a.performed_at ? new Date(a.performed_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''}</div>
                                              {a.note && <div className="text-xs text-slate-500 italic mt-0.5">{a.note}</div>}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="bg-white rounded-lg border border-slate-200 p-3 text-xs text-slate-400 italic">
                                        Nessuna azione registrata
                                      </div>
                                    )}
                                    {/* Info importazione */}
                                    {ei?.source && (
                                      <div className="text-xs text-slate-400">
                                        Fonte: <span className="font-medium">{ei.source === 'xml_sdi' ? 'XML FatturaPA' : ei.source === 'api_ade' ? 'API Agenzia Entrate' : ei.source}</span>
                                        {ei.created_at && <span> — importata il {fmtD(ei.created_at)}</span>}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })()}
                    </React.Fragment>
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

        {/* Per Fornitore View */}
        {viewMode === 'fornitore' && (
          <div className="space-y-4 mb-6">
            {groupedBySupplier.map(([name, group]) => (
              <div key={name} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{name}</h3>
                    <span className="text-xs text-slate-500">{group.items.length} fatture</span>
                  </div>
                  <div className="flex gap-6 text-sm">
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Totale</div>
                      <div className="font-bold text-slate-900">{formatCurrency(group.total)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Pagato</div>
                      <div className="font-bold text-emerald-600">{formatCurrency(group.paid)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Rimane</div>
                      <div className="font-bold text-red-600">{formatCurrency(group.remaining)}</div>
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
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${sc.bg} ${sc.text}`}>{p.status}</span>
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

        {/* Per Mese View */}
        {viewMode === 'mese' && (
          <div className="space-y-4 mb-6">
            {groupedByMonth.map(([key, group]) => (
              <div key={key} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-900 capitalize">{group.label}</h3>
                      <span className="text-xs text-slate-500">{group.items.length} fatture</span>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Totale</div>
                        <div className="font-bold text-slate-900">{formatCurrency(group.total)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Pagato</div>
                        <div className="font-bold text-emerald-600">{formatCurrency(group.paid)}</div>
                      </div>
                      {group.planned > 0 && (
                        <div className="text-right">
                          <div className="text-xs text-indigo-500">In distinta</div>
                          <div className="font-bold text-indigo-600">{formatCurrency(group.planned)}</div>
                        </div>
                      )}
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Rimane</div>
                        <div className={`font-bold ${group.remaining - group.planned <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {formatCurrency(group.remaining - group.planned)}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Barra di avanzamento pagamento del mese */}
                  {group.total > 0 && (
                    <div className="mt-2">
                      <div className="w-full bg-slate-200 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(100, ((group.paid + group.planned) / group.total) * 100)}%`,
                            background: group.paid + group.planned >= group.remaining + group.paid
                              ? '#10b981'
                              : group.planned > 0
                                ? 'linear-gradient(90deg, #10b981 0%, #6366f1 100%)'
                                : '#10b981',
                          }}
                        />
                      </div>
                      <div className="flex justify-between mt-1 text-xs text-slate-400">
                        <span>{Math.round(((group.paid + group.planned) / group.total) * 100)}% coperto</span>
                        {group.paid + group.planned >= group.remaining + group.paid && (
                          <span className="text-emerald-600 font-medium">✓ Mese chiuso</span>
                        )}
                      </div>
                    </div>
                  )}
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
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${sc.bg} ${sc.text}`}>{p.status}</span>
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
              <div className="text-center py-12 text-slate-500">Nessun pagamento trovato</div>
            )}
          </div>
        )}

        {/* Charts View rimosso — le KPI in alto forniscono già le informazioni chiave */}

        {/* Floating Action Bar — visibile quando ci sono fatture selezionate O pagamenti singoli accumulati */}
        {(selectedIds.size > 0 || completedPayments.length > 0) && !showPaymentReview && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-indigo-500 shadow-2xl p-4 z-40">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <div className="flex items-center gap-6">
                {selectedIds.size > 0 && (
                  <span className="text-sm font-medium text-slate-600 flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-indigo-600" />
                    {selectedIds.size} fatture selezionate
                  </span>
                )}
                {completedPayments.length > 0 && (
                  <span className="text-sm font-medium text-emerald-600 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    {completedPayments.length} già registrate
                  </span>
                )}
                {selectedIds.size > 0 && (
                  <span className="text-lg font-bold text-slate-900">{formatCurrency(selectedTotal)}</span>
                )}
                {hasNegativeBalance && (
                  <span className="text-sm font-semibold text-red-600 flex items-center gap-1">
                    <Ban className="w-4 h-4" /> Saldo insufficiente
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => { setSelectedIds(new Set()); setPaymentPlan({}); setCompletedPayments([]); }}
                  className="px-4 py-2 text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition text-sm font-medium">
                  Annulla
                </button>
                {/* Se ci sono fatture selezionate (non ancora registrate), prepara distinta batch */}
                {selectedIds.size > 0 && (
                  <button
                    onClick={() => {
                      // Prepara distinta: unisci pagamenti già registrati singolarmente + quelli ancora da processare
                      const now = new Date();
                      const newRecords = [];
                      for (const id of selectedIds) {
                        const plan = paymentPlan[id];
                        const payable = payables.find(p => p.id === id);
                        if (!plan || !payable) continue;
                        const bank = bankAccounts.find(b => b.id === plan.bankId);
                        const isBlocco = plan.type === 'blocco';
                        newRecords.push({
                          id,
                          fornitore: payable.suppliers?.ragione_sociale || payable.suppliers?.name || 'N/A',
                          fattura: payable.invoice_number,
                          data_fattura: payable.invoice_date,
                          scadenza: payable.due_date,
                          importo: isBlocco ? 0 : plan.amount,
                          importo_totale: payable.gross_amount,
                          tipo: isBlocco ? 'BLOCCATA' : (plan.type === 'saldo' ? 'SALDO' : 'PARZIALE'),
                          banca: isBlocco ? '' : (bank?.bank_name || 'N/D'),
                          banca_id: isBlocco ? null : plan.bankId,
                          conto: isBlocco ? '' : (bank?.account_name || ''),
                          iban_banca: isBlocco ? '' : (bank?.iban || ''),
                          iban_fornitore: payable.suppliers?.iban || '',
                          partita_iva: payable.suppliers?.partita_iva || '',
                          metodo_pagamento: payable.payment_method || 'bonifico',
                          causale: isBlocco
                            ? `Blocco ${payable.payment_method?.toUpperCase()} fatt. n. ${payable.invoice_number} del ${payable.invoice_date ? new Date(payable.invoice_date).toLocaleDateString('it-IT') : '-'} - ${payable.suppliers?.ragione_sociale || payable.suppliers?.name || ''}`
                            : `${plan.type === 'saldo' ? 'Saldo' : 'Acconto'} fatt. n. ${payable.invoice_number} del ${payable.invoice_date ? new Date(payable.invoice_date).toLocaleDateString('it-IT') : '-'} - ${payable.suppliers?.ragione_sociale || payable.suppliers?.name || ''}`,
                          note: plan.note || '',
                          operatore: operatorName,
                          timestamp: now.toISOString(),
                          _registrato: false, // non ancora registrato su DB
                        });
                      }
                      // Unisci: prima i già registrati (da handleSinglePayment), poi i nuovi
                      const alreadyRegistered = completedPayments.map(p => ({ ...p, _registrato: true }));
                      setCompletedPayments([...alreadyRegistered, ...newRecords]);
                      setShowPaymentReview(true);
                      setEmailSent(false);
                    }}
                    disabled={hasNegativeBalance || Array.from(selectedIds).some(id => {
                      const p = paymentPlan[id];
                      if (!p) return true;
                      // Blocco RIBA/RID non richiede banca
                      if (p.type === 'blocco') return false;
                      return !p.bankId;
                    })}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    Prepara Distinta Pagamenti
                  </button>
                )}
                {/* Se ci sono solo pagamenti già registrati singolarmente, mostra review */}
                {selectedIds.size === 0 && completedPayments.length > 0 && (
                  <button
                    onClick={() => { setShowPaymentReview(true); setEmailSent(false); }}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-bold flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    Visualizza Distinta ({completedPayments.length} pagamenti)
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Pannello Distinta Pagamenti — raggruppati per banca con saldo iniziale/finale */}
        {showPaymentReview && completedPayments.length > 0 && (() => {
          // Separa RIBA/RID bloccate dai pagamenti attivi
          const blockedItems = completedPayments.filter(p => p.tipo === 'BLOCCATA');
          const activePayments = completedPayments.filter(p => p.tipo !== 'BLOCCATA');

          // Raggruppa pagamenti attivi per banca con saldo iniziale e finale
          const perBanca = {};
          activePayments.forEach(p => {
            const key = p.banca || 'N/D';
            if (!perBanca[key]) {
              const bankAccount = bankAccounts.find(b => b.id === p.banca_id);
              perBanca[key] = {
                iban_banca: p.iban_banca,
                conto: p.conto,
                saldo_iniziale: bankAccount?.current_balance || 0,
                items: [],
                totale: 0,
              };
            }
            perBanca[key].items.push(p);
            perBanca[key].totale += p.importo;
          });

          // Il totale complessivo include solo i pagamenti attivi (non le bloccate)
          const totaleComplessivo = activePayments.reduce((s, p) => s + p.importo, 0);
          const totaleBlocchi = blockedItems.reduce((s, p) => s + p.importo_totale, 0);
          const lastTimestamp = completedPayments[completedPayments.length - 1]?.timestamp;
          const lastOperator = completedPayments[completedPayments.length - 1]?.operatore;
          const fmtDate = (d) => d ? new Date(d).toLocaleDateString('it-IT') : '-';
          const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';

          // Costruisci email professionale
          const emailSubject = `Distinta pagamenti fornitori - ${fmtDate(lastTimestamp)}`;
          const emailLines = [
            `Buongiorno,`,
            ``,
            `di seguito la distinta delle fatture da pagare con i relativi importi, le banche di addebito e i dati per la disposizione dei bonifici.`,
            ``,
            `Richiesta predisposta da: ${lastOperator}`,
            `Data e ora: ${fmtDate(lastTimestamp)} ore ${fmtTime(lastTimestamp)}`,
            ``,
          ];

          Object.entries(perBanca).forEach(([banca, data]) => {
            const saldoFinale = data.saldo_iniziale - data.totale;
            emailLines.push(`${'='.repeat(60)}`);
            emailLines.push(`BANCA: ${banca}`);
            if (data.iban_banca) emailLines.push(`IBAN addebito (nostro): ${data.iban_banca}`);
            emailLines.push(`Saldo attuale: ${formatCurrency(data.saldo_iniziale)}`);
            emailLines.push(`${'='.repeat(60)}`);
            emailLines.push(``);

            data.items.forEach((item, i) => {
              emailLines.push(`${i + 1}. ${item.fornitore}`);
              if (item.partita_iva) emailLines.push(`   P.IVA: ${item.partita_iva}`);
              emailLines.push(`   Fattura n. ${item.fattura} del ${fmtDate(item.data_fattura)}`);
              emailLines.push(`   Scadenza: ${fmtDate(item.scadenza)} | ${item.tipo} | ${formatCurrency(item.importo)}`);
              emailLines.push(`   IBAN beneficiario (fornitore): ${item.iban_fornitore || '⚠ MANCANTE — da verificare'}`);
              emailLines.push(`   Causale: ${item.causale}`);
              if (item.note) emailLines.push(`   Note: ${item.note}`);
              emailLines.push(``);
            });

            emailLines.push(`   TOTALE da addebitare su ${banca}: ${formatCurrency(data.totale)}`);
            emailLines.push(`   SALDO RESIDUO dopo pagamenti: ${formatCurrency(saldoFinale)}`);
            emailLines.push(``);
          });

          // Sezione RIBA/RID bloccate
          if (blockedItems.length > 0) {
            emailLines.push(`${'='.repeat(60)}`);
            emailLines.push(`RIBA/RID BLOCCATE (${blockedItems.length})`);
            emailLines.push(`${'='.repeat(60)}`);
            emailLines.push(``);
            blockedItems.forEach((item, i) => {
              emailLines.push(`${i + 1}. ${item.fornitore} — ${item.metodo_pagamento?.toUpperCase()}`);
              emailLines.push(`   Fattura n. ${item.fattura} del ${fmtDate(item.data_fattura)}`);
              emailLines.push(`   Importo originale: ${formatCurrency(item.importo_totale)}`);
              emailLines.push(`   ⛔ ADDEBITO BLOCCATO`);
              emailLines.push(``);
            });
            emailLines.push(`   TOTALE BLOCCATO: ${formatCurrency(totaleBlocchi)}`);
            emailLines.push(``);
          }

          emailLines.push(`${'='.repeat(60)}`);
          emailLines.push(`TOTALE COMPLESSIVO PAGAMENTI: ${formatCurrency(totaleComplessivo)}`);
          if (blockedItems.length > 0) {
            emailLines.push(`TOTALE RIBA/RID BLOCCATE: ${formatCurrency(totaleBlocchi)}`);
          }
          emailLines.push(`${'='.repeat(60)}`);
          emailLines.push(``);
          emailLines.push(`Si prega di procedere con le disposizioni.`);
          emailLines.push(``);
          emailLines.push(`Cordiali saluti,`);
          emailLines.push(lastOperator);

          const emailBody = emailLines.join('\n');
          const mailtoLink = emailRecipients
            ? `mailto:${emailRecipients}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
            : null;

          return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-indigo-700 text-white px-6 py-4 rounded-t-2xl flex justify-between items-center z-10">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <Landmark className="w-5 h-5" />
                    Distinta Pagamenti ({completedPayments.length} fatture)
                  </h2>
                  <button onClick={() => { setShowPaymentReview(false); setCompletedPayments([]); setEmailSent(false); }}
                    className="text-white hover:text-indigo-200 transition"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Info operatore e timestamp */}
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex items-center justify-between flex-wrap gap-2">
                    <div className="text-sm text-slate-600">
                      Predisposta da: <strong className="text-slate-900">{lastOperator}</strong>
                    </div>
                    <div className="text-sm text-slate-600">
                      Data/Ora: <strong className="text-slate-900">{fmtDate(lastTimestamp)} {fmtTime(lastTimestamp)}</strong>
                    </div>
                  </div>

                  {/* Per ogni banca: saldo iniziale → fatture → saldo finale */}
                  {Object.entries(perBanca).map(([banca, data]) => {
                    const saldoFinale = data.saldo_iniziale - data.totale;
                    return (
                      <div key={banca} className="border border-slate-200 rounded-xl overflow-hidden">
                        {/* Header banca con saldi */}
                        <div className="bg-blue-50 px-5 py-4 border-b border-blue-100">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="font-bold text-blue-900 flex items-center gap-2 text-lg">
                              <Landmark className="w-5 h-5" /> {banca}
                            </h3>
                            <div className="text-right">
                              <div className="text-xs text-slate-500">Saldo attuale</div>
                              <div className="text-xl font-bold text-blue-900">{formatCurrency(data.saldo_iniziale)}</div>
                            </div>
                          </div>
                          {data.iban_banca && <div className="text-xs text-blue-600">IBAN addebito (nostro): {data.iban_banca}</div>}
                        </div>

                        {/* Tabella fatture */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50">
                              <tr className="text-xs text-slate-500 uppercase">
                                <th className="py-2 px-4 text-left font-medium">Fornitore</th>
                                <th className="py-2 px-4 text-left font-medium">N. Fattura</th>
                                <th className="py-2 px-4 text-left font-medium">Scadenza</th>
                                <th className="py-2 px-4 text-center font-medium">Tipo</th>
                                <th className="py-2 px-4 text-right font-medium">Importo</th>
                                <th className="py-2 px-4 text-left font-medium">IBAN Beneficiario</th>
                                <th className="py-2 px-4 text-left font-medium">Causale</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {data.items.map((item, i) => (
                                <tr key={i} className="hover:bg-slate-50">
                                  <td className="py-2.5 px-4">
                                    <div className="font-medium text-slate-900">{item.fornitore}</div>
                                    {item.partita_iva && <div className="text-xs text-slate-400">P.IVA {item.partita_iva}</div>}
                                  </td>
                                  <td className="py-2.5 px-4 text-slate-600">
                                    <div>{item.fattura}</div>
                                    <div className="text-xs text-slate-400">del {fmtDate(item.data_fattura)}</div>
                                  </td>
                                  <td className="py-2.5 px-4 text-slate-600">{fmtDate(item.scadenza)}</td>
                                  <td className="py-2.5 px-4 text-center">
                                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                                      item.tipo === 'SALDO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                    }`}>{item.tipo}</span>
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-bold text-slate-900">{formatCurrency(item.importo)}</td>
                                  <td className="py-2.5 px-4 text-xs font-mono">
                                    {item.iban_fornitore
                                      ? <span className="text-slate-600">{item.iban_fornitore}</span>
                                      : <span className="text-amber-500 italic font-sans">IBAN mancante</span>
                                    }
                                  </td>
                                  <td className="py-2.5 px-4 text-xs text-slate-600 max-w-48 truncate" title={item.causale}>{item.causale}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Footer banca: totale e saldo residuo */}
                        <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex items-center justify-between">
                          <div className="text-sm">
                            <span className="text-slate-600">Totale da addebitare:</span>
                            <span className="font-bold text-red-600 ml-2">{formatCurrency(data.totale)}</span>
                          </div>
                          <div className="text-sm">
                            <span className="text-slate-600">Saldo residuo dopo pagamenti:</span>
                            <span className={`font-bold ml-2 ${saldoFinale >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {formatCurrency(saldoFinale)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Sezione RIBA/RID Bloccate */}
                  {blockedItems.length > 0 && (
                    <div className="border border-red-200 rounded-xl overflow-hidden">
                      <div className="bg-red-50 px-5 py-3 border-b border-red-100 flex items-center justify-between">
                        <h3 className="font-bold text-red-800 flex items-center gap-2">
                          <Ban className="w-4 h-4" /> RIBA/RID Bloccate ({blockedItems.length})
                        </h3>
                        <span className="text-sm font-bold text-red-700">{formatCurrency(totaleBlocchi)} non addebitati</span>
                      </div>
                      <div className="p-4 space-y-2">
                        {blockedItems.map((item, i) => (
                          <div key={i} className="flex items-center justify-between py-2 px-3 bg-red-50/50 rounded-lg border border-red-100">
                            <div>
                              <div className="font-medium text-slate-900 text-sm">{item.fornitore}</div>
                              <div className="text-xs text-slate-500">Fatt. {item.fattura} — scad. {fmtDate(item.scadenza)}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <PaymentMethodBadge method={item.metodo_pagamento} />
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">
                                <Ban className="w-3 h-3" /> BLOCCATA
                              </span>
                              <span className="text-sm font-bold text-slate-400 line-through">{formatCurrency(item.importo_totale)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Totale complessivo */}
                  <div className="bg-slate-900 text-white rounded-xl p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-lg font-semibold">Totale complessivo pagamenti</div>
                      <div className="text-2xl font-bold">{formatCurrency(totaleComplessivo)}</div>
                    </div>
                    {blockedItems.length > 0 && (
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700">
                        <div className="text-sm text-red-300 flex items-center gap-1"><Ban className="w-3.5 h-3.5" /> RIBA/RID bloccate</div>
                        <div className="text-sm font-bold text-red-300">{formatCurrency(totaleBlocchi)}</div>
                      </div>
                    )}
                  </div>

                  {/* Email preview */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-indigo-50 px-5 py-3 border-b border-indigo-100 flex items-center justify-between">
                      <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                        <Send className="w-4 h-4" /> Email per il finanziario
                      </h3>
                      {emailRecipients && <span className="text-xs text-indigo-600">A: {emailRecipients}</span>}
                      {!emailRecipients && (
                        <button onClick={() => setShowEmailConfig(true)} className="text-xs text-indigo-600 underline hover:text-indigo-800">
                          Configura destinatari
                        </button>
                      )}
                    </div>
                    <div className="p-4">
                      <textarea readOnly value={emailBody} rows={14}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-slate-50 focus:outline-none resize-y" />
                    </div>
                  </div>

                  {/* Azioni */}
                  <div className="flex gap-3 flex-wrap">
                    <button
                      onClick={() => { navigator.clipboard.writeText(emailBody); }}
                      className="flex-1 min-w-40 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition text-sm font-medium flex items-center justify-center gap-2">
                      <Download className="w-4 h-4" /> Copia testo
                    </button>
                    {mailtoLink && (
                      <a href={mailtoLink} target="_blank" rel="noopener noreferrer"
                        onClick={() => setEmailSent(true)}
                        className="flex-1 min-w-40 px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition text-sm font-bold flex items-center justify-center gap-2">
                        <Send className="w-4 h-4" /> Invia Email
                      </a>
                    )}
                    {/* Mostra "Conferma e Registra" solo se ci sono fatture non ancora registrate */}
                    {completedPayments.some(p => !p._registrato) ? (
                      <button
                        onClick={async () => {
                          setIsSaving(true);
                          try {
                            await confirmPayments();
                            setConfirmResult('success');
                          } catch (e) {
                            console.error(e);
                            setConfirmResult('error');
                          }
                          setIsSaving(false);
                        }}
                        disabled={isSaving}
                        className="flex-1 min-w-40 px-4 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                        <CheckCircle2 className="w-4 h-4" />
                        {isSaving ? 'Registrazione...' : `Conferma e Registra (${completedPayments.filter(p => !p._registrato).length} fatture)`}
                      </button>
                    ) : (
                      <button
                        onClick={() => { setShowPaymentReview(false); setCompletedPayments([]); setEmailSent(false); setConfirmResult(null); }}
                        className="flex-1 min-w-40 px-4 py-3 bg-slate-600 text-white rounded-xl hover:bg-slate-700 transition text-sm font-bold flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-4 h-4" /> Chiudi
                      </button>
                    )}
                  </div>

                  {confirmResult === 'success' && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Tutti i pagamenti sono stati registrati con successo. I saldi bancari sono aggiornati.
                    </div>
                  )}

                  {emailSent && !confirmResult && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Email predisposta. Puoi ora confermare e registrare i pagamenti.
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        </>
        )}

        {/* Email Config Modal */}
        {showEmailConfig && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="font-bold text-slate-900 mb-3">Destinatari Email Riepilogativa</h3>
              <p className="text-xs text-slate-500 mb-3">Inserisci gli indirizzi email separati da virgola</p>
              <input type="text" value={emailRecipients} onChange={e => setEmailRecipients(e.target.value)}
                placeholder="admin@azienda.com, contabile@azienda.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowEmailConfig(false)} className="px-4 py-2 bg-slate-100 rounded-lg text-sm hover:bg-slate-200 transition">Annulla</button>
                <button onClick={async () => {
                  await supabase.from('companies').update({ settings: { email_scadenzario: emailRecipients } }).eq('id', COMPANY_ID);
                  setShowEmailConfig(false);
                }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition font-medium">
                  <Save className="w-4 h-4 inline mr-1" /> Salva
                </button>
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
