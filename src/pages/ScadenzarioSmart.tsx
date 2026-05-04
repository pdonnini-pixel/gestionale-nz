// @ts-nocheck — TODO tighten: pagina complessa con shape Supabase + indexing dinamico, da rivedere
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import PageHelp from '../components/PageHelp';
import {
  Calendar, TrendingUp, TrendingDown, Filter, AlertCircle, Clock,
  DollarSign, BarChart3, Eye, EyeOff, ChevronDown, CheckCircle2,
  AlertTriangle, Clock3, Plus, Edit2, Trash2, Save, X, Download,
  CheckSquare, Square, Settings, Send, Ban, Wallet, Repeat,
  ChevronRight, ChevronLeft, Landmark, Building2, Search, RefreshCw,
  List, CalendarDays, Receipt
} from 'lucide-react';
import CostiRicorrenti from '../components/CostiRicorrenti';
import ExportMenu from '../components/ExportMenu';
import StatusBadge from '../components/ui/StatusBadge';
import SortableTh from '../components/ui/SortableTh';
import InvoiceViewer from '../components/InvoiceViewer';
import { useTableSort } from '../hooks/useTableSort';
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// Utility functions
/**
 * Calcola lo stato di una payable in base alle sue date.
 * Stati terminali (pagato, nota_credito, sospeso, rimandato, annullato,
 * parziale) rispettati. Altrimenti deduce da due_date:
 *   - oggi > due_date  -> 'scaduto'
 *   - 0..30 giorni     -> 'in_scadenza' (allineato al filtro 'Prossimi 30gg')
 *   - oltre 30 giorni  -> 'da_pagare'
 */
// TODO: tighten type
function calculatePayableStatus(p: any): string {
  const TERMINAL = new Set(['pagato', 'nota_credito', 'sospeso', 'rimandato', 'annullato', 'parziale']);
  if (p.status && TERMINAL.has(p.status)) return p.status;
  if (p.payment_date) return 'pagato';
  if (!p.due_date) return p.status || 'da_pagare';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(p.due_date);
  due.setHours(0, 0, 0, 0);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'scaduto';
  if (days <= 30) return 'in_scadenza';
  return 'da_pagare';
}

/**
 * Formattatore importi unico per tutto lo Scadenzario.
 * Sempre formato italiano "1.234,56" con simbolo o senza, due decimali.
 * Usato per Fix 5.3 (formato numeri inconsistente).
 */
function formatCurrency(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n)) + ' €';
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  // Parsing robusto. Supabase puo' ritornare gross_amount come:
  //   - number (1234.56) -> ok
  //   - string '1234.56' -> Number() funziona
  //   - string '1.234,56' (formato IT) -> Number() ritorna NaN, parse a mano
  // useGrouping: 'always' forza il separatore migliaia anche per browser
  // che lo omettono per default su numeri 4 cifre.
  let num
  if (typeof n === 'number') {
    num = n
  } else {
    const s = String(n).trim()
    // Se contiene sia '.' che ',' assumo formato italiano: '.' migliaia, ',' decimali
    if (s.includes(',') && s.includes('.')) {
      num = parseFloat(s.replace(/\./g, '').replace(',', '.'))
    } else if (s.includes(',') && !s.includes('.')) {
      num = parseFloat(s.replace(',', '.'))
    } else {
      num = parseFloat(s)
    }
  }
  if (!isFinite(num)) return '—'
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(num)
}

function fmtDate(d: string | null | undefined): string {
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
  nota_credito: { label: 'Nota Credito', bg: 'bg-emerald-100 text-emerald-700' },
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

// Status pill component — delegates to shared StatusBadge
function StatusPill({ status }: { status: string }) {
  return <StatusBadge status={status} size="sm" />
}

// Modal component
// TODO: tighten type
function Modal({ open, onClose, title, children, wide }: any) {
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

  // Leggi parametri URL per pre-filtrare (da Scheda Contabile o Fornitori)
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const urlSupplier = urlParams.get('supplier');
  const urlSearch = urlParams.get('search');

  const [section, setSection] = useState('scadenze'); // 'situazione' | 'scadenze' | 'ricorrenti' | 'regole'
  const [loading, setLoading] = useState(true);
  const [payables, setPayables] = useState<any[]>([]);
  const [fiscalDeadlines, setFiscalDeadlines] = useState<any[]>([]);
  const [sourceFilter, setSourceFilter] = useState('tutte'); // 'tutte' | 'fornitori' | 'fiscali'

  // Tab Incassi: i VERI incassi sono i movimenti in entrata dagli estratti
  // conto (bank_transactions.amount > 0), NON le payables pagate. La tabella
  // payables mostrava '0,00 €' di totale perche' i payables pagati sono
  // spese saldate, non incassi.
  const [bankIncomes, setBankIncomes] = useState<any[]>([]);
  const [bankIncomesLoading, setBankIncomesLoading] = useState(false);
  // Filtri dedicati al tab Incassi: tipo (POS/Contanti/Bonifico/…) + banca.
  // Sono indipendenti dai filtri dei Pagamenti (che non hanno senso per
  // movimenti bancari in entrata).
  const [incomeTypeFilter, setIncomeTypeFilter] = useState('all');
  const [incomeBankFilter, setIncomeBankFilter] = useState('all');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [cashPosition, setCashPosition] = useState(0);

  const [viewMode, setViewMode] = useState('timeline');
  const [scadViewMode, setScadViewMode] = useState('lista'); // 'lista' | 'calendario'
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<any>(null);
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState(urlSearch || '');
  const [isSaving, setIsSaving] = useState(false);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [paymentPlan, setPaymentPlan] = useState<Record<string, any>>({});
  const [emailRecipients, setEmailRecipients] = useState('');
  const [showEmailConfig, setShowEmailConfig] = useState(false);
  const [confirmResult, setConfirmResult] = useState<any>(null);
  const [selectedMethodGroup, setSelectedMethodGroup] = useState<any>(null);
  const [supplierDetail, setSupplierDetail] = useState<any>(null);
  const [viewingXml, setViewingXml] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [categoryDropdownId, setCategoryDropdownId] = useState<any>(null);
  const [categorySearch, setCategorySearch] = useState('');
  const [statusDropdownId, setStatusDropdownId] = useState<any>(null);

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
    // Default: NESSUN filtro data, cosi' l'utente vede TUTTE le scadenze
    // non pagate (incluse quelle scadute) dal primo accesso, come richiesto.
    // Prima il default era -3 mesi / +6 mesi e il chip 'A partire da oggi'
    // mostrava date passate nonostante la label lo negasse.
    return { start: '', end: '' };
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

      // Fetch extra fields from payables (cost_category_id, verified,
      // cash_movement_id, payment_date, payment_bank_account_id) per:
      //  - calcolo stato dinamico (Fix 5.1)
      //  - colonna CONTO con nome banca (Fix 5.2)
      const { data: payablesRaw } = await supabase
        .from('payables')
        .select('id, cash_movement_id, cost_category_id, verified, payment_date, payment_bank_account_id')
        .eq('company_id', COMPANY_ID);
      const payablesExtraMap = {};
      (payablesRaw || []).forEach(p => {
        payablesExtraMap[p.id] = {
          cash_movement_id: p.cash_movement_id || null,
          cost_category_id: p.cost_category_id || null,
          verified: p.verified || false,
          payment_date: p.payment_date || null,
          payment_bank_account_id: p.payment_bank_account_id || null,
        };
      });

      // Fetch categories
      const { data: categoriesData } = await supabase
        .from('cost_categories')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('sort_order', { ascending: true });
      setCategories(categoriesData || []);

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

      // Lookup banca per Fix 5.2: due livelli di matching.
      // 1) payment_bank_account_id (set quando l'utente paga dal modale Salda)
      // 2) cash_movement_id -> cash_movements.bank_account_id (riconciliazione
      //    automatica: la banca e' quella su cui e' stato registrato il
      //    movimento bancario abbinato).
      const bankNameById = new Map((accountsData || []).map(b => [b.id, b.bank_name]));
      const movementIds = (payablesRaw || []).map(p => p.cash_movement_id).filter(Boolean);
      const cashMovBankMap = new Map();
      if (movementIds.length > 0) {
        const { data: movs } = await supabase
          .from('cash_movements')
          .select('id, bank_account_id')
          .in('id', movementIds);
        (movs || []).forEach(m => {
          if (m.bank_account_id) cashMovBankMap.set(m.id, m.bank_account_id);
        });
      }

      const enrichedPayables = (viewData || []).map(row => {
        const extra = payablesExtraMap[row.id] || {};
        const baseRow = {
          id: row.id,
          invoice_number: row.invoice_number || '-',
          invoice_date: row.invoice_date,
          due_date: row.due_date,
          original_due_date: row.original_due_date,
          gross_amount: row.gross_amount || 0,
          amount_paid: row.amount_paid || 0,
          amount_remaining: row.amount_remaining || 0,
          status: row.status, // overridden sotto da calculatePayableStatus
          payment_method: row.payment_method,
          payment_date: extra.payment_date,
          payment_bank_account_id: extra.payment_bank_account_id,
          // Nome banca per la colonna CONTO. Provo prima il banca diretta,
          // poi via cash_movement (per riconciliazioni automatiche).
          payment_bank_name: (() => {
            const direct = extra.payment_bank_account_id ? bankNameById.get(extra.payment_bank_account_id) : null;
            if (direct) return direct;
            const viaCM = extra.cash_movement_id ? cashMovBankMap.get(extra.cash_movement_id) : null;
            return viaCM ? bankNameById.get(viaCM) || null : null;
          })(),
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
          cash_movement_id: extra.cash_movement_id || null,
          cost_category_id: extra.cost_category_id || null,
          verified: extra.verified || false,
        };
        // Fix 5.1: ricalcolo lo stato dalla data se non e' terminale
        baseRow.status = calculatePayableStatus(baseRow);
        return baseRow;
      });

      setPayables(enrichedPayables);
      setSuppliers(suppliersData || []);
      setBankAccounts(accountsData || []);

      // Load fiscal deadlines for unified view
      try {
        const { data: fiscalData } = await supabase
          .from('fiscal_deadlines')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .neq('status', 'cancelled')
          .order('due_date', { ascending: true });
        setFiscalDeadlines(fiscalData || []);
      } catch (e) { console.warn('fiscal_deadlines not available:', e.message); }

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

  // Carica incassi reali lazy quando il tab Incassi viene aperto.
  // IMPORTANTE: le importazioni EC vanno in DUE tabelle diverse:
  //   - ImportHub -> cash_movements (campo 'date')
  //   - TesoreriaManuale -> bank_transactions (campo 'transaction_date')
  // Query separate (non Promise.all) perche' una puo' fallire per mancanza
  // di FK: se una va in errore NON blocca l'altra. Nessun embed SQL
  // (bank_accounts(...)) — lookup client-side sul bankAccounts gia' caricato.
  async function loadBankIncomes() {
    if (bankIncomes.length > 0 || !COMPANY_ID) return;
    setBankIncomesLoading(true);
    try {
      const rows = [];

      try {
        const { data, error } = await supabase
          .from('bank_transactions')
          .select('id, transaction_date, description, amount, bank_account_id')
          .eq('company_id', COMPANY_ID)
          .gt('amount', 0)
          .order('transaction_date', { ascending: false })
          .limit(2000);
        if (error) throw error;
        for (const r of (data || [])) {
          rows.push({
            id: 'bt_' + r.id,
            transaction_date: r.transaction_date,
            description: r.description,
            amount: r.amount,
            bank_account_id: r.bank_account_id,
          });
        }
      } catch (e) {
        console.warn('bank_transactions incomes:', e.message);
      }

      try {
        const { data, error } = await supabase
          .from('cash_movements')
          .select('id, date, description, amount, bank_account_id')
          .eq('company_id', COMPANY_ID)
          .gt('amount', 0)
          .order('date', { ascending: false })
          .limit(2000);
        if (error) throw error;
        for (const r of (data || [])) {
          rows.push({
            id: 'cm_' + r.id,
            transaction_date: r.date,
            description: r.description,
            amount: r.amount,
            bank_account_id: r.bank_account_id,
          });
        }
      } catch (e) {
        console.warn('cash_movements incomes:', e.message);
      }

      // Arricchisci con bank_name dal lookup sul bankAccounts gia' caricato
      const bankMap = new Map((bankAccounts || []).map(b => [b.id, b]));
      for (const r of rows) {
        const b = bankMap.get(r.bank_account_id);
        if (b) {
          r.bank_accounts = { bank_name: b.bank_name, account_name: b.account_name };
        }
      }

      rows.sort((a, b) => new Date(b.transaction_date || 0) - new Date(a.transaction_date || 0));
      setBankIncomes(rows);
    } catch (err: unknown) {
      console.warn('load bank incomes:', (err as Error).message);
      setBankIncomes([]);
    } finally {
      setBankIncomesLoading(false);
    }
  }

  // Pre-filtra per fornitore se arrivi da Scheda Contabile con ?supplier=ID
  useEffect(() => {
    if (!urlSupplier || !COMPANY_ID) return;
    (async () => {
      const { data: sup } = await supabase
        .from('suppliers')
        .select('name, ragione_sociale')
        .eq('id', urlSupplier)
        .single();
      if (sup) {
        const name = sup.name || sup.ragione_sociale;
        setSearchTerm(name);
        // Rimuovi il filtro data per mostrare tutte le fatture del fornitore
        setDateRange({ start: '2020-01-01', end: '2030-12-31' });
      }
    })();
  }, [urlSupplier, COMPANY_ID]);

  // Auto-allineamento categorie al caricamento (D4)
  useEffect(() => {
    if (!COMPANY_ID) return;
    (async () => {
      const { data, error } = await supabase.rpc('align_payable_categories', { p_company_id: COMPANY_ID });
      if (!error && data > 0) {
        console.log(`[Scadenzario] Allineate ${data} categorie fornitore`);
        fetchData(); // ricarica dati con le categorie aggiornate
      }
    })();
  }, [COMPANY_ID]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = () => { setCategoryDropdownId(null); setStatusDropdownId(null); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Handler: update category con propagazione a tutte le fatture dello stesso fornitore
  // Gestisce sia payables con supplier_id che senza (match per supplier_name/supplier_vat)
  const handleSetCategory = async (payableId, categoryId) => {
    const payable = payables.find(p => p.id === payableId);
    if (!payable) return;

    // 1. Aggiorna la fattura specifica
    const { error: err1 } = await supabase
      .from('payables')
      .update({ cost_category_id: categoryId })
      .eq('id', payableId);
    if (err1) { console.error('Errore aggiornamento payable:', err1); return; }

    let propagatedCount = 0;
    const supplierName = payable.suppliers?.ragione_sociale || payable.suppliers?.name || '';
    const supplierVat = payable.supplier_vat || '';

    if (payable.supplier_id) {
      // 2a. Ha supplier_id — aggiorna direttamente il fornitore
      await supabase
        .from('suppliers')
        .update({ default_cost_category_id: categoryId })
        .eq('id', payable.supplier_id);

      // 3a. Propaga a tutte le fatture dello stesso supplier_id senza categoria
      const { count } = await supabase
        .from('payables')
        .update({ cost_category_id: categoryId })
        .eq('supplier_id', payable.supplier_id)
        .is('cost_category_id', null);
      propagatedCount = count || 0;
    } else if (supplierVat) {
      // 2b. Senza supplier_id ma con P.IVA — trova il fornitore per P.IVA
      const { data: matchedSupplier } = await supabase
        .from('suppliers')
        .select('id')
        .eq('company_id', COMPANY_ID)
        .or(`vat_number.eq.${supplierVat},partita_iva.eq.${supplierVat}`)
        .limit(1)
        .maybeSingle();

      if (matchedSupplier) {
        await supabase
          .from('suppliers')
          .update({ default_cost_category_id: categoryId })
          .eq('id', matchedSupplier.id);
      }

      // 3b. Propaga a tutte le payables con stessa P.IVA senza categoria
      const { count } = await supabase
        .from('payables')
        .update({ cost_category_id: categoryId })
        .eq('supplier_vat', supplierVat)
        .eq('company_id', COMPANY_ID)
        .is('cost_category_id', null);
      propagatedCount = count || 0;
    } else if (supplierName) {
      // 2c. Senza supplier_id e senza P.IVA — match per nome
      const { data: matchedSupplier } = await supabase
        .from('suppliers')
        .select('id')
        .eq('company_id', COMPANY_ID)
        .or(`name.eq.${supplierName},ragione_sociale.eq.${supplierName}`)
        .limit(1)
        .maybeSingle();

      if (matchedSupplier) {
        await supabase
          .from('suppliers')
          .update({ default_cost_category_id: categoryId })
          .eq('id', matchedSupplier.id);
      }

      // 3c. Propaga a tutte le payables con stesso nome senza categoria
      const { count } = await supabase
        .from('payables')
        .update({ cost_category_id: categoryId })
        .eq('supplier_name', supplierName)
        .eq('company_id', COMPANY_ID)
        .is('cost_category_id', null);
      propagatedCount = count || 0;
    }

    // Aggiorna UI locale — match per supplier_id, supplier_vat, o supplier_name
    setPayables(prev => prev.map(p => {
      if (p.id === payableId) return { ...p, cost_category_id: categoryId };
      if (p.cost_category_id) return p; // già categorizzata, non sovrascrivere
      // Match per supplier_id
      if (payable.supplier_id && p.supplier_id === payable.supplier_id) {
        return { ...p, cost_category_id: categoryId };
      }
      // Match per P.IVA
      if (supplierVat && p.supplier_vat === supplierVat) {
        return { ...p, cost_category_id: categoryId };
      }
      // Match per nome fornitore
      if (supplierName && (p.suppliers?.name === supplierName || p.suppliers?.ragione_sociale === supplierName)) {
        return { ...p, cost_category_id: categoryId };
      }
      return p;
    }));

    setCategoryDropdownId(null);
    setCategorySearch('');

    const catName = categories.find(c => c.id === categoryId)?.name || 'categoria';
    const displayName = supplierName || 'fornitore';
    alert(`Categoria "${catName}" applicata a ${displayName}${propagatedCount > 0 ? ` e propagata a ${propagatedCount} fatture` : ''}`);
  };

  // Handler: update status inline
  const handleSetStatus = async (payableId, newStatus) => {
    const updates = { status: newStatus };
    if (newStatus === 'pagato') { updates.payment_date = new Date().toISOString().split('T')[0]; }
    const { error } = await supabase
      .from('payables')
      .update(updates)
      .eq('id', payableId);
    if (!error) {
      setPayables(prev => prev.map(p => p.id === payableId ? { ...p, status: newStatus } : p));
    }
    setStatusDropdownId(null);
  };

  // Filter payables
  // Convert fiscal deadlines to payable-like objects for unified view
  const fiscalAsPayables = useMemo(() => {
    return fiscalDeadlines.map(fd => ({
      id: `fiscal_${fd.id}`,
      _isFiscal: true,
      invoice_number: fd.title || fd.deadline_type,
      invoice_date: fd.created_at,
      due_date: fd.due_date,
      original_due_date: fd.due_date,
      gross_amount: fd.amount || 0,
      amount_paid: fd.status === 'paid' ? (fd.amount || 0) : 0,
      amount_remaining: fd.status === 'paid' ? 0 : (fd.amount || 0),
      status: fd.status === 'paid' ? 'pagato' : fd.status === 'overdue' ? 'scaduto' : fd.status === 'upcoming' ? 'in_scadenza' : 'da_pagare',
      payment_method: fd.payment_method || 'f24',
      outlet_id: null,
      outlet_name: '',
      cost_center: 'fiscale',
      notes: fd.notes || '',
      days_to_due: fd.due_date ? Math.round((new Date(fd.due_date) - new Date()) / (1000 * 60 * 60 * 24)) : null,
      urgency: null,
      priority: null,
      supplier_id: null,
      supplier_iban: '',
      supplier_vat: '',
      suppliers: { name: `📋 ${fd.deadline_type?.toUpperCase() || 'Fiscale'}`, ragione_sociale: fd.title || fd.deadline_type, category: 'fiscale' },
      last_action_type: null,
      last_action_note: null,
      last_action_date: null,
      cash_movement_id: null,
      cost_category_id: null,
      verified: false,
    }));
  }, [fiscalDeadlines]);

  const filteredPayables = useMemo(() => {
    // Combine sources based on filter
    let source = [];
    if (sourceFilter === 'fornitori') source = payables;
    else if (sourceFilter === 'fiscali') source = fiscalAsPayables;
    else source = [...payables, ...fiscalAsPayables];

    return source.filter((p) => {
      // Escludi note credito dallo Scadenzario (importi negativi o status nota_credito)
      if (p.status === 'nota_credito' || parseFloat(p.gross_amount || 0) < 0) return false;

      const matchOutlet = !selectedOutlet || p.outlet_id === selectedOutlet;
      const matchStatus = !selectedStatus
        || (selectedStatus === 'da_saldare' && p.status !== 'pagato')
        || (selectedStatus !== 'da_saldare' && p.status === selectedStatus);
      const matchSearch = !searchTerm || (p.invoice_number || '').toLowerCase().includes(searchTerm.toLowerCase()) || (p.suppliers?.ragione_sociale || p.suppliers?.name || '').toLowerCase().includes(searchTerm.toLowerCase());
      // Filtro data: applica SOLO se start/end sono valorizzati (string non
      // vuota e date valide). Prima filtrava tutto out quando start='' perche'
      // new Date('') = Invalid Date e i confronti restituivano false.
      const dueDate = p.due_date ? new Date(p.due_date) : null;
      const startD = dateRange.start ? new Date(dateRange.start) : null;
      const endD = dateRange.end ? new Date(dateRange.end) : null;
      let matchDate = true;
      if (dueDate && !isNaN(dueDate.getTime())) {
        if (startD && !isNaN(startD.getTime()) && dueDate < startD) matchDate = false;
        if (endD && !isNaN(endD.getTime()) && dueDate > endD) matchDate = false;
      }

      let matchMethodGroup = true;
      if (selectedMethodGroup) {
        matchMethodGroup = p.payment_method === selectedMethodGroup;
      }

      return matchOutlet && matchStatus && matchSearch && matchDate && matchMethodGroup;
    });
  }, [payables, fiscalAsPayables, sourceFilter, selectedOutlet, selectedStatus, searchTerm, dateRange, selectedMethodGroup]);

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

    // Reconciliation: how many paid payables have cash_movement_id
    const paidPayables = filteredPayables.filter(p => p.status === 'pagato');
    const reconciledCount = paidPayables.filter(p => p.cash_movement_id).length;
    const paidCount = paidPayables.length;

    return {
      totalDuePending,
      totalOverdue,
      nextSevenDays,
      totalToPay,
      cashShortfall,
      availableCash: cashPosition,
      reconciledCount,
      paidCount,
    };
  }, [filteredPayables, cashPosition, today]);

  // Totali per singolo metodo di pagamento (stessa base filtrata dei KPI)
  const methodTotals = useMemo(() => {
    const activePays = filteredPayables.filter(p => p.status !== 'pagato' && p.status !== 'annullato');
    const map = {};
    activePays.forEach(p => {
      const m = p.payment_method || 'altro';
      if (!map[m]) map[m] = { key: m, label: paymentMethodLabels[m] || m, total: 0, count: 0 };
      map[m].total += (p.amount_remaining || 0);
      map[m].count += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filteredPayables]);

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

  // Sibill-style sub-tab counts
  const tabCounts = useMemo(() => {
    const all = payables || [];
    return {
      tutte: filteredPayables.length,
      scadute: filteredPayables.filter(p => p.status === 'scaduto').length,
      da_saldare: filteredPayables.filter(p => p.status !== 'pagato' && p.status !== 'annullato' && (p.gross_amount || 0) >= 0).length,
      saldate: filteredPayables.filter(p => p.status === 'pagato').length,
    };
  }, [filteredPayables, payables]);

  // Sibill-style sub-tab filter for the table
  const [sibillTab, setSibillTab] = useState('tutte');

  const displayPayables = useMemo(() => {
    let list = filteredPayables;
    if (sibillTab === 'scadute') list = list.filter(p => p.status === 'scaduto');
    else if (sibillTab === 'da_saldare') list = list.filter(p => p.status !== 'pagato' && p.status !== 'annullato' && (p.gross_amount || 0) >= 0);
    else if (sibillTab === 'saldate') list = list.filter(p => p.status === 'pagato');
    return list;
  }, [filteredPayables, sibillTab]);

  // Ordinamento tabella scadenze (modello standard SortableTh + useTableSort).
  // Default: scadenza piu' vecchia in cima. Persistente tra refresh per
  // questa pagina. Reset automatico al cambio sibillTab.
  const { sorted: sortedDisplayPayables, sortBy: sortByPayables, onSort: onSortPayables, reset: resetPayablesSort } = useTableSort(
    displayPayables,
    [{ key: 'due_date', dir: 'asc' }],
    { persistKey: 'scadenzario_payables', resetOn: [sibillTab] }
  );

  // Aging analysis
  const agingAnalysis = useMemo(() => {
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    displayPayables.forEach((p) => {
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
  }, [displayPayables, today]);

  // Grouped by supplier
  const groupedBySupplier = useMemo(() => {
    const groups = {};
    displayPayables.forEach(p => {
      const name = p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A';
      if (!groups[name]) groups[name] = { items: [], total: 0, paid: 0, remaining: 0 };
      groups[name].items.push(p);
      groups[name].total += p.gross_amount || 0;
      groups[name].paid += p.amount_paid || 0;
      groups[name].remaining += p.amount_remaining || 0;
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [displayPayables]);

  // Grouped by month
  const groupedByMonth = useMemo(() => {
    const groups = {};
    displayPayables.forEach(p => {
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
  }, [displayPayables]);

  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw size={20} className="animate-spin text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Caricamento scadenzario...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* ===== TOP BAR — Logo + 4 Tab principali Sibill ===== */}
      <div className="border-b border-slate-200">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-base font-bold text-slate-800 tracking-tight">Scadenze</h1>
            {/* 4 tab principali come Sibill: Situazione | Scadenzario | Ricorrenze | Regole.
                Fix 13.1: tab 'Regole' disabilitata visivamente (Coming soon)
                perche' la funzionalita' non e' ancora pronta — evitare che
                Sabrina/Veronica clicchino e si confondano con la pagina vuota. */}
            <div className="flex gap-1">
              {[
                { key: 'situazione', label: 'Situazione' },
                { key: 'scadenze', label: 'Scadenzario' },
                { key: 'ricorrenti', label: 'Ricorrenze' },
                { key: 'regole', label: 'Regole', disabled: true },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => !t.disabled && setSection(t.key)}
                  disabled={t.disabled}
                  title={t.disabled ? 'Funzione in arrivo' : undefined}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 ${
                    t.disabled
                      ? 'text-slate-400 cursor-not-allowed opacity-60'
                      : section === t.key
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  }`}>
                  {t.label}
                  {t.disabled && (
                    <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                      Coming soon
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Source filter: Tutte / Fornitori / Fiscali */}
            <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5 mr-2">
              {[
                { key: 'tutte', label: 'Tutte' },
                { key: 'fornitori', label: 'Fornitori' },
                { key: 'fiscali', label: 'Fiscali' },
              ].map(t => (
                <button key={t.key} onClick={() => setSourceFilter(t.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                    sourceFilter === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
            <ExportMenu
              data={filteredPayables.map(p => ({
                fornitore: p.suppliers?.name || '—',
                fattura: p.invoice_number,
                scadenza: p.due_date,
                importo: p.gross_amount,
                residuo: p.amount_remaining,
                stato: statusConfig[p.status]?.label || p.status,
                metodo: paymentMethodLabels[p.payment_method] || p.payment_method,
              }))}
              columns={[
                { key: 'fornitore', label: 'Fornitore' },
                { key: 'fattura', label: 'Fattura' },
                { key: 'scadenza', label: 'Scadenza', format: 'date' },
                { key: 'importo', label: 'Importo', format: 'euro' },
                { key: 'residuo', label: 'Residuo', format: 'euro' },
                { key: 'stato', label: 'Stato' },
                { key: 'metodo', label: 'Pagamento' },
              ]}
              filename="scadenzario"
              title="Scadenzario"
            />
            <button onClick={() => setModals({ ...modals, invoice: { open: true, data: null } })}
              className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition font-medium">
              <Plus size={13} /> Aggiungi scadenza
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-5 space-y-4">

      {/* ===== TAB SITUAZIONE — riepilogo come Sibill ===== */}
      {section === 'situazione' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            {/* DA PAGARE */}
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-baseline justify-between mb-1">
                <span className={`text-2xl font-bold ${kpis.totalToPay > 0 ? 'text-slate-800' : 'text-slate-400'}`}>{fmt(kpis.totalToPay)} €</span>
                <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Da pagare</span>
              </div>
              <p className="text-xs text-slate-400 mb-4">Prossime {displayPayables.filter(p => p.status !== 'pagato').length} scadenze</p>
              <div className="space-y-2">
                {displayPayables.filter(p => p.status !== 'pagato' && p.status !== 'annullato').slice(0, 3).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 truncate max-w-[200px]" title={p.suppliers?.ragione_sociale || p.suppliers?.name || '—'}>{p.suppliers?.ragione_sociale || p.suppliers?.name || '—'}</span>
                    <span className="font-medium text-slate-800">{fmt(p.amount_remaining || p.gross_amount)} €</span>
                  </div>
                ))}
              </div>
              {displayPayables.filter(p => p.status !== 'pagato').length > 3 && (
                <button onClick={() => setSection('scadenze')} className="mt-4 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                  Vedi tutte <ChevronRight size={12} />
                </button>
              )}
            </div>
            {/* DA INCASSARE — placeholder */}
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-2xl font-bold text-slate-400">0,00 €</span>
                <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Da incassare</span>
              </div>
              <p className="text-xs text-slate-400 mb-4">Nessuna scadenza in entrata</p>
              <div className="flex flex-col items-center justify-center py-6 text-slate-300">
                <CheckCircle2 size={32} className="mb-2" />
                <span className="text-xs">Nessuna scadenza prevista. Ottimo lavoro!</span>
              </div>
            </div>
          </div>
          {/* Pagamenti ed incassi scaduti */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Pagamenti ed incassi scaduti</h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-2xl font-bold text-slate-800">{fmt(kpis.totalOverdue)} €</span>
                  <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Pagamenti scaduti</span>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-2xl font-bold text-slate-400">0,00 €</span>
                  <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Incassi scaduti</span>
                </div>
              </div>
            </div>
          </div>
          {/* KPI tesoreria */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Riepilogo banche</h3>
            <div className="grid grid-cols-5 gap-4 text-center">
              <div>
                <span className="text-[10px] text-slate-400 uppercase block">Saldo oggi</span>
                <span className={`text-lg font-bold ${cashPosition >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{fmt(cashPosition)} €</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase block">Da pagare</span>
                <span className="text-lg font-bold text-red-500">{fmt(kpis.totalToPay)} €</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase block">Scaduto</span>
                <span className="text-lg font-bold text-amber-600">{fmt(kpis.totalOverdue)} €</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase block">Prossimi 7gg</span>
                <span className="text-lg font-bold text-blue-600">{fmt(kpis.nextSevenDays)} €</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase block">Saldo proiettato</span>
                <span className={`text-lg font-bold ${(cashPosition - kpis.totalToPay) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(cashPosition - kpis.totalToPay)} €</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== TAB REGOLE — placeholder ===== */}
      {section === 'regole' && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <Settings size={32} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Regole automatiche</h3>
          <p className="text-xs text-slate-400">Imposta regole per la categorizzazione automatica delle scadenze. Funzionalità in arrivo.</p>
        </div>
      )}

      {section === 'ricorrenti' ? (
        <CostiRicorrenti />
      ) : section === 'scadenze' ? (
        <>
          {/* Sub-tab Sibill: Pagamenti | Incassi | Tutte le scadenze */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {[
                { key: 'tutte', label: 'Pagamenti' },
                { key: 'saldate', label: 'Incassi' },
                { key: 'da_saldare', label: 'Tutte le scadenze' },
              ].map(t => (
                <button key={t.key} onClick={() => {
                  setSibillTab(t.key);
                  if (t.key === 'saldate') {
                    // Entrando in Incassi resetto i filtri pagamenti che non
                    // devono influenzare la vista. Data di fine = oggi, data
                    // di inizio vuota (la decide l'utente se vuole).
                    loadBankIncomes();
                    setSelectedStatus('');
                    setSelectedMethodGroup(null);
                    setDateRange({ start: '', end: new Date().toISOString().split('T')[0] });
                  }
                }}
                  className={`px-3 py-1.5 text-sm font-medium transition border-b-2 ${
                    sibillTab === t.key
                      ? 'border-slate-800 text-slate-800'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Filters — Sibill-style (solo Pagamenti / Tutte le scadenze) */}
          {sibillTab !== 'saldate' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-[240px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
              <input type="text" placeholder="Ricerca" value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40 focus:border-blue-300 bg-white placeholder:text-slate-300" />
            </div>
            <input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-500" />
            <input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-500" />
            <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-500">
              <option value="">Tutti gli stati</option>
              {/* Allineato a statusConfig (badge): include in_scadenza,
                  sospeso, rimandato, nota_credito che prima mancavano */}
              <option value="scaduto">Scaduto</option>
              <option value="in_scadenza">In scadenza</option>
              <option value="da_pagare">Da pagare</option>
              <option value="parziale">Parziale</option>
              <option value="pagato">Pagato</option>
              <option value="sospeso">Sospeso</option>
              <option value="rimandato">Rimandato</option>
              <option value="nota_credito">Nota Credito</option>
              <option value="annullato">Annullato</option>
            </select>
            {/* Filter count badge — Sibill */}
            {(searchTerm || selectedStatus || selectedMethodGroup || dateRange.start || dateRange.end) && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 bg-slate-50">
                <Filter size={12} /> Filtri ({[searchTerm, selectedStatus, selectedMethodGroup, dateRange.start, dateRange.end].filter(Boolean).length})
              </span>
            )}
            <div className="flex-1" />
            {/* Payment method chips */}
            {methodTotals.slice(0, 4).map(m => {
              const isActive = selectedMethodGroup === m.key;
              return (
                <button key={m.key} onClick={() => setSelectedMethodGroup(isActive ? null : m.key)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition border ${
                    isActive ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                  }`}>
                  {m.label} {m.count}
                </button>
              );
            })}
          </div>
          )}

          {/* Filtri dedicati per Tab INCASSI: ricerca + tipo + banca + date.
              Sostituiscono i filtri dei Pagamenti che non hanno senso qui. */}
          {sibillTab === 'saldate' && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px] max-w-[240px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                <input type="text" placeholder="Cerca descrizione, importo..." value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40 focus:border-blue-300 bg-white placeholder:text-slate-300" />
              </div>
              <select value={incomeTypeFilter} onChange={e => setIncomeTypeFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-600"
                title="Filtra per tipo di incasso">
                <option value="all">Tutti i tipi ({bankIncomes.length})</option>
                {(() => {
                  // Genera la lista dinamicamente dai dati caricati: mostro
                  // solo i tipi presenti. Per ognuno il count dei movimenti.
                  const categorize = (desc) => {
                    const d = (desc || '').toLowerCase();
                    if (d.includes('p.o.s.') || /\bpos\b/.test(d)) return 'POS';
                    if (d.includes('bonifico') && (d.includes('favore') || d.includes('ordinante'))) return 'Bonifico';
                    if (d.includes('versamento') && d.includes('contant')) return 'Contanti';
                    if (d.includes('accredito')) return 'Accredito';
                    if (d.includes('incass')) return 'Incasso';
                    if (d.includes('giroconto')) return 'Giroconto';
                    return 'Altro';
                  };
                  const counts = {};
                  bankIncomes.forEach(i => {
                    const t = categorize(i.description);
                    counts[t] = (counts[t] || 0) + 1;
                  });
                  return Object.entries(counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([tipo, n]) => (
                      <option key={tipo} value={tipo}>{tipo} ({n})</option>
                    ));
                })()}
              </select>
              <select value={incomeBankFilter} onChange={e => setIncomeBankFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-600"
                title="Filtra per banca">
                <option value="all">Tutte le banche</option>
                {(bankAccounts || []).map(b => (
                  <option key={b.id} value={b.id}>{b.bank_name}{b.account_name ? ` — ${b.account_name}` : ''}</option>
                ))}
              </select>
              <input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-500" title="Da" />
              <input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-500" title="A" />
              {(searchTerm || incomeTypeFilter !== 'all' || incomeBankFilter !== 'all' || dateRange.start || dateRange.end) && (
                <button onClick={() => {
                  setSearchTerm('');
                  setIncomeTypeFilter('all');
                  setIncomeBankFilter('all');
                  setDateRange({ start: '', end: '' });
                }} className="text-xs text-red-500 hover:text-red-600 font-medium ml-1">
                  Rimuovi filtri
                </button>
              )}
            </div>
          )}

          {/* Active filter chips — removable, Sibill style (solo NON Incassi) */}
          {sibillTab !== 'saldate' && (searchTerm || selectedStatus || selectedMethodGroup || dateRange.start || dateRange.end) && (
            <div className="flex items-center gap-2 flex-wrap">
              {dateRange.start && (() => {
                // Il chip mostra la VERA data di inizio del filtro, non un
                // label fisso che ingannava l'utente (es. 'A partire da oggi'
                // con dateRange.start=2026-01-01 includeva scadenze gia'
                // passate). Se la data coincide con oggi, uso label "oggi".
                const today = new Date().toISOString().split('T')[0];
                const label = dateRange.start === today
                  ? 'A partire da oggi'
                  : `Da ${fmtDate(dateRange.start)}`;
                return (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600">
                    {label}
                    <button onClick={() => setDateRange({ ...dateRange, start: '' })} className="text-slate-400 hover:text-slate-600"><X size={11} /></button>
                  </span>
                );
              })()}
              {selectedStatus && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600">
                  {statusConfig[selectedStatus]?.label || selectedStatus} <button onClick={() => setSelectedStatus('')} className="text-slate-400 hover:text-slate-600"><X size={11} /></button>
                </span>
              )}
              {searchTerm && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600">
                  "{searchTerm}" <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600"><X size={11} /></button>
                </span>
              )}
              {selectedMethodGroup && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600">
                  {paymentGroups.find(g => g.key === selectedMethodGroup)?.label || selectedMethodGroup} <button onClick={() => setSelectedMethodGroup(null)} className="text-slate-400 hover:text-slate-600"><X size={11} /></button>
                </span>
              )}
              <button onClick={() => { setSearchTerm(''); setSelectedStatus(''); setSelectedMethodGroup(null); setDateRange({ start: '', end: '' }); }}
                className="text-xs text-red-500 hover:text-red-600 font-medium">
                Rimuovi filtri
              </button>
            </div>
          )}

          {/* Quick filter chips — Sibill sub-filters (solo NON Incassi) */}
          {sibillTab !== 'saldate' && (
          <div className="flex items-center gap-2">
            <button onClick={() => { setSelectedStatus('da_pagare'); setDateRange({ start: new Date().toISOString().split('T')[0], end: new Date(Date.now() + 30*86400000).toISOString().split('T')[0] }); }}
              className="px-3 py-1 rounded-full text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 transition">
              Da pagare nei prossimi 30 giorni
            </button>
            <button onClick={() => setSelectedStatus('scaduto')}
              className="px-3 py-1 rounded-full text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 transition">
              Scaduto
            </button>
          </div>
          )}

          {/* Result count + total + view toggle — Sibill style.
              Sugli Incassi il toggle Lista/Calendario e il totale payables
              non hanno senso, quindi riga nascosta. Il count+totale incassi
              e' gia' mostrato dentro la tabella dedicata. */}
          {sibillTab !== 'saldate' && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">{displayPayables.length} risultati</span>
            <div className="flex items-center gap-3">
              {/* Lista / Calendario toggle */}
              <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => setScadViewMode('lista')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                    scadViewMode === 'lista' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  <List size={13} /> Lista
                </button>
                <button onClick={() => setScadViewMode('calendario')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                    scadViewMode === 'calendario' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  <CalendarDays size={13} /> Calendario
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <TrendingDown size={14} className="text-slate-400" />
                <span className="text-sm font-bold text-slate-700">{fmt(displayPayables.reduce((s, p) => s + (p.amount_remaining || 0), 0))} €</span>
              </div>
            </div>
          </div>
          )}

          {/* ===== CALENDARIO VIEW ===== */}
          {scadViewMode === 'calendario' && (() => {
            const year = calendarMonth.getFullYear();
            const month = calendarMonth.getMonth();
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            // Monday=0 ... Sunday=6 (ISO week)
            const startDow = (firstDay.getDay() + 6) % 7;
            const daysInMonth = lastDay.getDate();

            // Build a map: day number -> array of payables
            const dayMap = {};
            displayPayables.forEach(p => {
              if (!p.due_date) return;
              const d = new Date(p.due_date);
              if (d.getFullYear() === year && d.getMonth() === month) {
                const day = d.getDate();
                if (!dayMap[day]) dayMap[day] = [];
                dayMap[day].push(p);
              }
            });

            // Determine dot color for a payable
            const dotColor = (p) => {
              if (p.status === 'scaduto') return 'bg-red-500';
              if (p.status === 'in_scadenza') return 'bg-amber-500';
              if (p.status === 'pagato') return 'bg-emerald-500';
              return 'bg-blue-500'; // da_pagare, parziale, etc.
            };

            // Build grid cells: leading blanks + days
            const cells = [];
            for (let i = 0; i < startDow; i++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(d);

            const todayDate = new Date();
            const isToday = (day) => day && todayDate.getFullYear() === year && todayDate.getMonth() === month && todayDate.getDate() === day;

            const monthLabel = calendarMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

            // Payables for selected day
            const selectedDayPayables = selectedCalendarDay && dayMap[selectedCalendarDay] ? dayMap[selectedCalendarDay] : [];

            return (
              <div className="space-y-4">
                {/* Month navigation */}
                <div className="flex items-center justify-between">
                  <button onClick={() => setCalendarMonth(new Date(year, month - 1, 1))}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition">
                    <ChevronLeft size={18} />
                  </button>
                  <h3 className="text-sm font-semibold text-slate-800 capitalize">{monthLabel}</h3>
                  <button onClick={() => setCalendarMonth(new Date(year, month + 1, 1))}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition">
                    <ChevronRight size={18} />
                  </button>
                </div>

                {/* Calendar grid */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  {/* Day-of-week header */}
                  <div className="grid grid-cols-7 border-b border-slate-100">
                    {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
                      <div key={d} className="py-2 text-center text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{d}</div>
                    ))}
                  </div>
                  {/* Day cells */}
                  <div className="grid grid-cols-7">
                    {cells.map((day, idx) => {
                      const items = day ? (dayMap[day] || []) : [];
                      const isSelected = day && selectedCalendarDay === day;
                      return (
                        <button key={idx}
                          disabled={!day}
                          onClick={() => day && setSelectedCalendarDay(isSelected ? null : day)}
                          className={`relative min-h-[64px] p-1.5 border-b border-r border-slate-50 text-left transition
                            ${!day ? 'bg-slate-50/30' : 'hover:bg-blue-50/40 cursor-pointer'}
                            ${isSelected ? 'bg-blue-50 ring-1 ring-blue-300 ring-inset' : ''}
                          `}>
                          {day && (
                            <>
                              <span className={`text-xs font-medium ${
                                isToday(day) ? 'bg-blue-600 text-white w-5 h-5 rounded-full inline-flex items-center justify-center' : 'text-slate-600'
                              }`}>
                                {day}
                              </span>
                              {items.length > 0 && (
                                <div className="flex flex-wrap gap-0.5 mt-1">
                                  {items.slice(0, 4).map((p, i) => (
                                    <span key={i} className={`w-2 h-2 rounded-full ${dotColor(p)}`} title={`${p.suppliers?.name || ''} - ${fmt(p.amount_remaining)} EUR`} />
                                  ))}
                                  {items.length > 4 && (
                                    <span className="text-[9px] text-slate-400 leading-none">+{items.length - 4}</span>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Scaduto</div>
                  <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> In scadenza</div>
                  <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Pagato</div>
                  <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Da pagare</div>
                </div>

                {/* Selected day detail */}
                {selectedCalendarDay && (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                      <h4 className="text-sm font-semibold text-slate-700">
                        Scadenze del {selectedCalendarDay} {calendarMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
                        <span className="ml-2 text-xs font-normal text-slate-400">({selectedDayPayables.length} scadenz{selectedDayPayables.length === 1 ? 'a' : 'e'})</span>
                      </h4>
                    </div>
                    {selectedDayPayables.length === 0 ? (
                      <div className="p-6 text-center text-sm text-slate-400">Nessuna scadenza in questo giorno</div>
                    ) : (
                      <div className="divide-y divide-slate-50">
                        {selectedDayPayables.map(p => (
                          <div key={p.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/50">
                            <div className="flex items-center gap-3">
                              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor(p)}`} />
                              <div>
                                <div className="text-sm font-medium text-slate-800 truncate max-w-[280px]" title={p.suppliers?.ragione_sociale || p.suppliers?.name || ''}>{p.suppliers?.ragione_sociale || p.suppliers?.name || '—'}</div>
                                <div className="text-xs text-slate-400 truncate max-w-[280px]" title={p.invoice_number || ''}>Fatt. {p.invoice_number || '—'} {p.payment_method ? `- ${paymentMethodLabels[p.payment_method] || p.payment_method}` : ''}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`text-sm font-semibold ${p.status === 'pagato' ? 'text-slate-400' : p.status === 'scaduto' ? 'text-red-600' : 'text-slate-800'}`}>
                                {fmt(p.amount_remaining || p.gross_amount)} €
                              </span>
                              <StatusPill status={p.status} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ===== LISTA VIEWS ===== */}
          {/* Tab Incassi: mostra movimenti in entrata dagli EC (NON payables
              pagate). Sorgente: bank_transactions con amount > 0.
              Categorizzazione automatica della descrizione. */}
          {scadViewMode === 'lista' && viewMode === 'timeline' && sibillTab === 'saldate' && (
            <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
              {bankIncomesLoading ? (
                <div className="p-10 text-center text-sm text-slate-500">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-emerald-600" /> Caricamento incassi dagli estratti conto...
                </div>
              ) : bankIncomes.length === 0 ? (
                <div className="p-12 text-center">
                  <Receipt size={28} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500 font-medium">Nessun incasso trovato</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Gli incassi sono movimenti in entrata (importo positivo) dagli estratti conto bancari.
                    Importa un EC da Import Hub per popolare questa sezione.
                  </p>
                </div>
              ) : (() => {
                // Filtri incassi: testo + tipo + banca + range date
                const q = (searchTerm || '').toLowerCase();
                const from = dateRange.start ? new Date(dateRange.start) : null;
                const to = dateRange.end ? new Date(dateRange.end) : null;
                const categorize = (desc) => {
                  const d = (desc || '').toLowerCase();
                  if (d.includes('p.o.s.') || /\bpos\b/.test(d)) return { tipo: 'POS', cls: 'bg-violet-50 text-violet-700' };
                  if (d.includes('bonifico') && (d.includes('favore') || d.includes('ordinante'))) return { tipo: 'Bonifico', cls: 'bg-blue-50 text-blue-700' };
                  if (d.includes('versamento') && d.includes('contant')) return { tipo: 'Contanti', cls: 'bg-amber-50 text-amber-700' };
                  if (d.includes('accredito')) return { tipo: 'Accredito', cls: 'bg-emerald-50 text-emerald-700' };
                  if (d.includes('incass')) return { tipo: 'Incasso', cls: 'bg-emerald-50 text-emerald-700' };
                  if (d.includes('giroconto')) return { tipo: 'Giroconto', cls: 'bg-slate-100 text-slate-600' };
                  return { tipo: 'Altro', cls: 'bg-slate-100 text-slate-600' };
                };
                const filteredIncomes = bankIncomes.filter(i => {
                  if (q && !(i.description || '').toLowerCase().includes(q) && !String(i.amount).includes(q)) return false;
                  if (incomeBankFilter !== 'all' && i.bank_account_id !== incomeBankFilter) return false;
                  if (incomeTypeFilter !== 'all' && categorize(i.description).tipo !== incomeTypeFilter) return false;
                  const d = i.transaction_date ? new Date(i.transaction_date) : null;
                  if (from && d && d < from) return false;
                  if (to && d && d > to) return false;
                  return true;
                });
                const totale = filteredIncomes.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
                return (
                  <>
                    <div className="px-4 py-2 bg-emerald-50/50 border-b border-emerald-100 flex items-center justify-between text-xs">
                      <span className="text-emerald-800 font-medium">{filteredIncomes.length} incassi</span>
                      <span className="text-emerald-700 font-semibold">Totale: {fmt(totale)} €</span>
                    </div>
                    <div className="overflow-x-auto max-h-[70vh]">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 sticky top-0 z-10">
                          <tr className="text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-200">
                            <th className="py-2 px-3 text-left font-semibold">Data</th>
                            <th className="py-2 px-3 text-left font-semibold">Descrizione</th>
                            <th className="py-2 px-3 text-left font-semibold">Tipo</th>
                            <th className="py-2 px-3 text-left font-semibold">Banca</th>
                            <th className="py-2 px-3 text-right font-semibold">Importo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredIncomes.slice(0, 500).map(i => {
                            const cat = categorize(i.description);
                            return (
                              <tr key={i.id} className="hover:bg-slate-50/60">
                                <td className="py-2 px-3 whitespace-nowrap text-slate-600">{fmtDate(i.transaction_date)}</td>
                                <td className="py-2 px-3 truncate max-w-md text-slate-700" title={i.description}>{i.description || '—'}</td>
                                <td className="py-2 px-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${cat.cls}`}>{cat.tipo}</span></td>
                                <td className="py-2 px-3 text-xs text-slate-500">{i.bank_accounts?.bank_name || '—'}</td>
                                <td className="py-2 px-3 text-right font-semibold text-emerald-700 whitespace-nowrap">+{fmt(i.amount)} €</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {filteredIncomes.length > 500 && (
                        <div className="px-3 py-2 bg-slate-50 text-xs text-slate-500 text-center">
                          Mostrati i primi 500 su {filteredIncomes.length}. Usa i filtri per restringere.
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Timeline View — Sibill style (Pagamenti / Tutte le scadenze) */}
          {scadViewMode === 'lista' && viewMode === 'timeline' && sibillTab !== 'saldate' && (
            <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
              <div className="overflow-x-auto">
                {/* Bottone reset ordinamento (visibile solo se sort attivo
                    oltre al default) */}
                {sortByPayables.length > 0 && !(sortByPayables.length === 1 && sortByPayables[0].key === 'due_date' && sortByPayables[0].dir === 'asc') && (
                  <div className="px-3 py-1.5 bg-blue-50/50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-2">
                    <span>Ordinamento personalizzato attivo ({sortByPayables.length} colonn{sortByPayables.length === 1 ? 'a' : 'e'})</span>
                    <button onClick={resetPayablesSort} className="ml-auto text-blue-600 hover:text-blue-800 font-medium">Reset</button>
                  </div>
                )}
                <table className="w-full">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-slate-100">
                      <th className="py-2.5 px-3 text-center w-10">
                        <button onClick={toggleSelectAll} className="text-slate-300 hover:text-slate-600">
                          {selectedIds.size > 0 ? <CheckSquare size={15} /> : <Square size={15} />}
                        </button>
                      </th>
                      <SortableTh sortKey="due_date" sortBy={sortByPayables} onSort={onSortPayables}>Pagamenti</SortableTh>
                      <SortableTh sortKey="suppliers.ragione_sociale" sortBy={sortByPayables} onSort={onSortPayables}>Descrizione</SortableTh>
                      <SortableTh sortKey="gross_amount" sortBy={sortByPayables} onSort={onSortPayables} align="right">Importo</SortableTh>
                      <SortableTh sortKey="status" sortBy={sortByPayables} onSort={onSortPayables} align="center">Stato</SortableTh>
                      <SortableTh sortKey="payment_bank_name" sortBy={sortByPayables} onSort={onSortPayables} align="center">Conto</SortableTh>
                      <SortableTh sortKey="cost_center" sortBy={sortByPayables} onSort={onSortPayables} align="center">Categoria</SortableTh>
                      <th className="py-2.5 px-3 text-right font-medium w-20 text-[11px] uppercase tracking-wider text-slate-500">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDisplayPayables.map((p, idx) => (
                      <React.Fragment key={p.id}>
                        <tr className={`border-b border-slate-50 hover:bg-blue-50/50 transition-colors group ${idx % 2 === 1 ? 'even:bg-slate-50/50' : ''}`}>
                          <td className="py-2.5 px-3 text-center">
                            {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && (
                              <button onClick={() => toggleSelect(p.id, p)}>
                                {selectedIds.has(p.id) ? <CheckSquare size={15} className="text-slate-700" /> : <Square size={15} className="text-slate-300" />}
                              </button>
                            )}
                          </td>
                          {/* PAGAMENTI — data + tipo (Sibill style) */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="text-[13px] font-medium text-slate-800">
                              {p.due_date ? new Date(p.due_date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {paymentMethodLabels[p.payment_method] || 'Bonifico'}
                            </div>
                          </td>
                          {/* DESCRIZIONE — fornitore + fattura (Sibill style) */}
                          <td className="py-2.5 px-3">
                            <button onClick={() => {
                              const sup = suppliers.find(s =>
                                s.ragione_sociale === (p.suppliers?.ragione_sociale || p.suppliers?.name) ||
                                s.name === (p.suppliers?.name || p.suppliers?.ragione_sociale)
                              );
                              setSupplierDetail(sup || { ragione_sociale: p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A' });
                            }} className="text-left">
                              <div className="text-[13px] text-slate-800 hover:text-blue-600 font-medium truncate max-w-[220px]" title={p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A'}>
                                {p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A'}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[220px]" title={`Fattura • ${p.invoice_number || '—'}`}>
                                Fattura • {p.invoice_number || '—'}
                              </div>
                            </button>
                          </td>
                          {/* IMPORTO */}
                          <td className={`py-2.5 px-3 text-right text-[13px] font-medium whitespace-nowrap ${
                            p.status === 'pagato' ? 'text-slate-400' : p.status === 'scaduto' ? 'text-red-600' : 'text-slate-800'
                          }`}>
                            {p.amount_remaining > 0 && p.amount_remaining !== p.gross_amount
                              ? <><span className="text-slate-300 line-through text-[11px] mr-1">{fmt(p.gross_amount)}</span>{fmt(p.amount_remaining)} €</>
                              : <>{fmt(p.gross_amount)} €</>
                            }
                          </td>
                          {/* STATO — dropdown editabile Sibill */}
                          <td className="py-2.5 px-3 text-center relative">
                            <button onClick={(e) => { e.stopPropagation(); setStatusDropdownId(statusDropdownId === p.id ? null : p.id); setCategoryDropdownId(null); }}>
                              <StatusPill status={p.status} />
                            </button>
                            {statusDropdownId === p.id && (
                              <div className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[140px]" onClick={e => e.stopPropagation()}>
                                {['da_pagare', 'scaduto', 'parziale', 'pagato', 'contestato', 'annullato'].map(s => (
                                  <button key={s} onClick={() => handleSetStatus(p.id, s)}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2 ${p.status === s ? 'font-bold' : ''}`}>
                                    <span className={`w-2 h-2 rounded-full ${statusConfig[s]?.bg?.split(' ')[0] || 'bg-slate-200'}`} />
                                    {statusConfig[s]?.label || s}
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                          {/* CONTO — banca su cui è stata saldata.
                              3 stati visivi:
                                a) banca nota -> pillola verde con nome
                                b) pagata MA banca non tracciata -> badge ambra
                                   'Off-system' (es. cash/altro non riconciliato)
                                c) non pagata -> trattino */}
                          <td className="py-2.5 px-3 text-center">
                            {p.payment_bank_name ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-[10px] text-emerald-700 font-medium border border-emerald-200" title={`Pagato su ${p.payment_bank_name}`}>
                                <Landmark size={10} /> {p.payment_bank_name}
                              </span>
                            ) : p.status === 'pagato' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-[10px] text-amber-700 font-medium border border-amber-200" title="Pagata ma senza banca tracciata in Supabase. Probabilmente saldata fuori dall'app o tramite riconciliazione legacy.">
                                Off-system
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-300">—</span>
                            )}
                          </td>
                          {/* CATEGORIA — dropdown con ricerca Sibill */}
                          <td className="py-2.5 px-3 text-center relative">
                            {(() => {
                              const cat = categories.find(c => c.id === p.cost_category_id);
                              return (
                                <button onClick={(e) => { e.stopPropagation(); setCategoryDropdownId(categoryDropdownId === p.id ? null : p.id); setCategorySearch(''); setStatusDropdownId(null); }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition hover:shadow-sm"
                                  style={cat ? { backgroundColor: cat.color + '18', color: cat.color, borderColor: cat.color + '40' } : { backgroundColor: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}>
                                  {cat ? <><span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />{cat.name}</> : 'Non categorizzata'}
                                </button>
                              );
                            })()}
                            {categoryDropdownId === p.id && (
                              <div className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg w-[220px] max-h-[280px] overflow-hidden" onClick={e => e.stopPropagation()}>
                                <div className="p-2 border-b border-slate-100">
                                  <input type="text" placeholder="Cerca o crea una categoria" value={categorySearch}
                                    onChange={e => setCategorySearch(e.target.value)} autoFocus
                                    className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                </div>
                                <div className="overflow-y-auto max-h-[220px] py-1">
                                  <button onClick={() => handleSetCategory(p.id, null)}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 text-slate-400 flex items-center gap-2">
                                    <X size={10} /> Rimuovi categoria
                                  </button>
                                  {categories
                                    .filter(c => !categorySearch || c.name.toLowerCase().includes(categorySearch.toLowerCase()))
                                    .map(c => (
                                    <button key={c.id} onClick={() => handleSetCategory(p.id, c.id)}
                                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2 ${p.cost_category_id === c.id ? 'font-bold bg-slate-50' : ''}`}>
                                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                                      <span className="truncate" title={c.name}>{c.name}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                          {/* AZIONI — Paga + Vedi fattura + Edit + Delete */}
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex justify-end gap-0.5">
                              {/* Paga — naviga a Banche con fattura pre-selezionata */}
                              {p.status !== 'pagato' && (
                                <button onClick={() => window.location.href = `/banche?tab=pagamenti&select=${p.id}`}
                                  className="p-1 rounded text-slate-400 hover:text-green-600 hover:bg-green-50"
                                  title="Paga questa fattura">
                                  <Wallet size={13} />
                                </button>
                              )}
                              {/* Vedi fattura XML */}
                              {p.invoice_number && (
                                <button onClick={async () => {
                                  const { data } = await supabase.from('electronic_invoices')
                                    .select('xml_content')
                                    .eq('invoice_number', p.invoice_number)
                                    .not('xml_content', 'is', null)
                                    .limit(1)
                                    .maybeSingle()
                                  if (data?.xml_content) {
                                    setViewingXml(data.xml_content)
                                  } else {
                                    alert('XML fattura non disponibile per questa scadenza')
                                  }
                                }}
                                  className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                                  title="Visualizza fattura XML">
                                  <Eye size={13} />
                                </button>
                              )}
                              <button onClick={() => setModals({ ...modals, editSchedule: { open: true, schedule: p } })}
                                className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                title="Modifica">
                                <Edit2 size={12} />
                              </button>
                              <button onClick={() => setModals({ ...modals, deleteConfirm: { open: true, scheduleId: p.id, invoiceNumber: p.invoice_number } })}
                                className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                                title="Elimina">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {selectedIds.has(p.id) && paymentPlan[p.id] && (
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <td colSpan={9} className="px-4 py-2.5">
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
          {scadViewMode === 'lista' && viewMode === 'fornitore' && (
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
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 z-10">
                        <tr>
                          <th className="py-2 px-3 text-center w-10"></th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Fattura</th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Scadenza</th>
                          <th className="py-2 px-4 text-right text-xs font-medium text-slate-600">Importo</th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Stato</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((p, idx) => (
                          <tr key={p.id} className={`border-b border-slate-50 hover:bg-blue-50/50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
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
                            <td className="py-2 px-4">
                              <div className="flex items-center gap-1">
                                <StatusPill status={p.status} />
                                {p.status === 'pagato' && (
                                  p.cash_movement_id
                                    ? <span title="Riconciliato" className="text-emerald-500 text-xs">&#x2705;</span>
                                    : <span title="Non riconciliato" className="text-amber-500 text-xs">&#x26A0;&#xFE0F;</span>
                                )}
                              </div>
                            </td>
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
          {scadViewMode === 'lista' && viewMode === 'mese' && (
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
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 z-10">
                        <tr>
                          <th className="py-2 px-3 text-center w-10"></th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Fornitore</th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Fattura</th>
                          <th className="py-2 px-4 text-right text-xs font-medium text-slate-600">Importo</th>
                          <th className="py-2 px-4 text-left text-xs font-medium text-slate-600">Stato</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((p, idx) => (
                          <tr key={p.id} className={`border-b border-slate-50 hover:bg-blue-50/50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
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
                            <td className="py-2 px-4">
                              <div className="flex items-center gap-1">
                                <StatusPill status={p.status} />
                                {p.status === 'pagato' && (
                                  p.cash_movement_id
                                    ? <span title="Riconciliato" className="text-emerald-500 text-xs">&#x2705;</span>
                                    : <span title="Non riconciliato" className="text-amber-500 text-xs">&#x26A0;&#xFE0F;</span>
                                )}
                              </div>
                            </td>
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
          {scadViewMode === 'lista' && viewMode === 'charts' && (
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
                    <span className="font-bold">{displayPayables.length}</span>
                  </div>
                  <div className="flex justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-600">Fornitori</span>
                    <span className="font-bold">{new Set(displayPayables.map(p => p.suppliers?.ragione_sociale)).size}</span>
                  </div>
                  <div className="flex justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-600">Importo Medio</span>
                    <span className="font-bold">{fmt(displayPayables.length > 0 ? displayPayables.reduce((s, p) => s + (p.amount_remaining || 0), 0) / displayPayables.length : 0)} €</span>
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
      ) : null}
      </div>{/* chiude content wrapper */}

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
                            <div className="text-sm font-medium text-slate-800 truncate" title={p.fornitore}>{p.fornitore}</div>
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
      <PageHelp page="scadenzario" />

      {/* InvoiceViewer modal */}
      {viewingXml && (
        <InvoiceViewer xmlContent={viewingXml} onClose={() => setViewingXml(null)} />
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
