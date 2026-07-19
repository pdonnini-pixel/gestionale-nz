import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
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
import SortableTh from '../components/ui/SortableTh';
import InvoiceViewer from '../components/InvoiceViewer';
import { UiTooltip } from '../components/Tooltip';
import { useTableSort } from '../hooks/useTableSort';
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import { supabase } from '../lib/supabase';
import { todayYMD } from '../lib/dateLocal';
import { useAuth } from '../hooks/useAuth';
// Spezzatura (ondata 9): helper/config, UI condivisa e modali dello Scadenzario
// vivono in src/pages/scadenzario/ — estrazione senza cambi funzionali.
import {
  type ScadenzarioSection, VALID_SCADENZARIO_SECTIONS,
  calculatePayableStatus, fmt, fmtDate,
  statusConfig, paymentMethodLabels, paymentGroups,
  ESTIMATE_HORIZON_MONTHS, ESTIMATE_MATCH_TOLERANCE_PCT, ESTIMATE_MATCH_TOLERANCE_ABS,
  RECURRENCE_STEP_MONTHS, normSupplier, categorizeIncome,
} from './scadenzario/helpers';
import { StatusPill, Modal } from './scadenzario/SharedUI';
import { EditScheduleModal, InvoiceModal, SupplierModal, type InvoiceFormState } from './scadenzario/modals';
import { SituazioneTab } from './scadenzario/SituazioneTab';
import { ScadenzeCharts } from './scadenzario/ScadenzeCharts';
import { BulkPaymentBar } from './scadenzario/BulkPaymentBar';
import { SupplierDetailModal } from './scadenzario/SupplierDetailModal';

// Main component
const ScadenzarioSmart = () => {
  const { toast } = useToast();
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  // Leggi parametri URL per pre-filtrare (da Scheda Contabile o Fornitori)
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const urlSupplier = urlParams.get('supplier');
  const urlSearch = urlParams.get('search');

  type SupplierEmbed = { name?: string | null; ragione_sociale?: string | null; category?: string | null }
  type AnyRow = {
    id?: string
    invoice_number?: string | null
    invoice_date?: string | null
    due_date?: string | null
    original_due_date?: string | null
    gross_amount?: number | null
    amount_paid?: number | null
    amount_remaining?: number | null
    status?: string | null
    payment_method?: string | null
    payment_date?: string | null
    payment_bank_account_id?: string | null
    payment_bank_name?: string | null
    outlet_id?: string | null
    outlet_name?: string | null
    cost_center?: string | null
    notes?: string | null
    days_to_due?: number | null
    urgency?: string | null
    priority?: string | number | null
    supplier_id?: string | null
    supplier_iban?: string | null
    supplier_vat?: string | null
    suppliers?: SupplierEmbed | null
    last_action_type?: string | null
    last_action_note?: string | null
    last_action_date?: string | null
    cash_movement_id?: string | null
    cost_category_id?: string | null
    verified?: boolean | null
    transaction_date?: string | null
    description?: string | null
    amount?: number | null
    bank_account_id?: string | null
    bank_accounts?: { bank_name?: string | null; account_name?: string | null } | null
    name?: string | null
    bank_name?: string | null
    account_name?: string | null
    current_balance?: number | null
    company_id?: string | null
    is_active?: boolean | null
    is_deleted?: boolean | null
    fiscal_code?: string | null
    vat_number?: string | null
    iban?: string | null
    macro_group?: string | null
    sort_order?: number | null
    [key: string]: unknown
  }
  // section persistita in URL come ?section=… (default 'scadenze')
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section');
  const section: ScadenzarioSection = VALID_SCADENZARIO_SECTIONS.includes(sectionParam as ScadenzarioSection)
    ? (sectionParam as ScadenzarioSection)
    : 'scadenze';
  const setSection = (next: ScadenzarioSection) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', next);
    setSearchParams(params);
  };
  const [loading, setLoading] = useState(true);
  const [payables, setPayables] = useState<AnyRow[]>([]);
  const [fiscalDeadlines, setFiscalDeadlines] = useState<AnyRow[]>([]);
  // Asse TIPO unificato (sostituisce sourceFilter + i sotto-tab Sibill).
  // '' = tutte le scadenze (default) | 'fornitori' | 'fiscali' | 'incassi'.
  // 'incassi' commuta sulla tabella dedicata dei movimenti in entrata.
  const [typeFilter, setTypeFilter] = useState(''); // '' | 'fornitori' | 'fiscali' | 'incassi'
  // Layout della lista scadenze: 'mese' (default, sezioni collassabili con
  // subtotale) | 'lista' (lista piatta).
  const [listLayout, setListLayout] = useState('mese'); // 'mese' | 'lista'
  // Mesi collassati nella vista raggruppata (chiave 'YYYY-MM').
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  // Mesi collassati nella vista INCASSI (set separato: collassare un mese nei
  // pagamenti non deve influenzare gli incassi e viceversa).
  const [collapsedIncomeMonths, setCollapsedIncomeMonths] = useState<Set<string>>(new Set());

  // Tab Incassi: i VERI incassi sono i movimenti in entrata dagli estratti
  // conto (bank_transactions.amount > 0), NON le payables pagate. La tabella
  // payables mostrava '0,00 €' di totale perche' i payables pagati sono
  // spese saldate, non incassi.
  const [bankIncomes, setBankIncomes] = useState<AnyRow[]>([]);
  const [bankIncomesLoading, setBankIncomesLoading] = useState(false);
  // Filtro banca dedicato agli Incassi (i filtri pagamenti non si applicano ai
  // movimenti bancari in entrata). Reso nella barra unificata come chip.
  const [incomeBankFilter, setIncomeBankFilter] = useState('all');
  const [suppliers, setSuppliers] = useState<AnyRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<AnyRow[]>([]);
  const [cashPosition, setCashPosition] = useState(0);

  const [viewMode, setViewMode] = useState('timeline');
  const [scadViewMode, setScadViewMode] = useState('lista'); // 'lista' | 'calendario'
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<any>(null);
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState(urlSearch || '');
  const [isSaving, setIsSaving] = useState(false);

  // PlanEntry: piano di pagamento per singola fattura selezionata in distinta.
  //  - type: 'saldo' | 'parziale' (toggle in assegnazione banca)
  //  - baseAmount: importo lordo previsto PRIMA delle NC (residuo per saldo, acconto per parziale)
  //  - amount: importo NETTO effettivo del bonifico = baseAmount − Σ|NC compensate| (è quello che
  //    incide su saldi banca e distinta)
  //  - ncIds: id dei payables nota-di-credito (stesso fornitore) compensati su questa fattura
  type PlanEntry = { bankId: string; type: string; amount: number; note: string; baseAmount?: number; ncIds?: string[] }
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paymentPlan, setPaymentPlan] = useState<Record<string, PlanEntry>>({});
  const [emailRecipients, setEmailRecipients] = useState('');
  const [showEmailConfig, setShowEmailConfig] = useState(false);
  // Conferma custom (vietati confirm/alert/prompt nativi)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);
  const askConfirm = useCallback((message: string) => new Promise<boolean>((resolve) => setConfirmDialog({ message, resolve })), []);
  type ConfirmPayment = { fornitore: string; fattura: string; importo: number; bankId: string; banca: string; iban: string; ibanBeneficiario: string; pivaBeneficiario: string; tipo: string; metodo: string; note: string }
  type ConfirmBank = { bankName: string; iban: string; saldoIniziale: number; totalePagamenti: number; pagamenti: ConfirmPayment[]; saldoFinale?: number }
  // Item grezzo da salvare in distinta SOLO alla conferma esplicita (no side-effect).
  // ncIds: note di credito compensate su questa fattura — alla conferma vengono chiuse in AVERE.
  type DistintaItem = { payableId: string; bankId: string; amount: number; status: string; note: string; ncIds?: string[] }
  type ConfirmResult = { results: ConfirmPayment[]; banks: ConfirmBank[]; totaleComplessivo: number; emailBody: string; emailSubject: string; items: DistintaItem[] } | null
  const [confirmResult, setConfirmResult] = useState<ConfirmResult>(null);
  // La distinta è stata effettivamente salvata? (gate per "Conferma distinta")
  const [distintaSaved, setDistintaSaved] = useState(false);
  // Modale "Rimuovi dalla distinta" (conferma)
  const [removeDistintaModal, setRemoveDistintaModal] = useState<{ payableId: string; invoiceNumber: string } | null>(null);
  const [selectedMethodGroup, setSelectedMethodGroup] = useState<any>(null);
  const [supplierDetail, setSupplierDetail] = useState<any>(null);
  const [viewingXml, setViewingXml] = useState<any>(null);
  const [categories, setCategories] = useState<AnyRow[]>([]);
  // Centri di costo (outlet + sede + spese da ripartire): servono al form
  // "Aggiungi scadenza" quando si imposta una periodicità (recurring_costs.cost_center).
  const [costCenters, setCostCenters] = useState<AnyRow[]>([]);
  // Costi ricorrenti attivi: sorgente delle SCADENZE-STIMA generate on-the-fly
  // (read-only; nessuna riga materializzata, nessuna migration).
  const [recurringCosts, setRecurringCosts] = useState<AnyRow[]>([]);
  const [categoryDropdownId, setCategoryDropdownId] = useState<any>(null);
  const [categorySearch, setCategorySearch] = useState('');
  const [statusDropdownId, setStatusDropdownId] = useState<any>(null);
  // Inline edit dell'importo: click su cella importo → input numerico
  const [inlineEditAmountId, setInlineEditAmountId] = useState<string | null>(null);
  const [inlineEditAmountValue, setInlineEditAmountValue] = useState<string>('');

  // Modal Rimanda scadenza (cambia due_date) — quick action +7/+15/+30 gg o data custom
  const [rinviaModal, setRinviaModal] = useState<{ open: boolean; scheduleId: string | null; currentDueDate: string | null; invoiceNumber: string | null }>(
    { open: false, scheduleId: null, currentDueDate: null, invoiceNumber: null }
  );
  const [rinviaCustomDate, setRinviaCustomDate] = useState<string>('');
  // Modale "Chiudi a mano" — chiusura contabile manuale con registrazione in partitario
  const [manualCloseModal, setManualCloseModal] = useState<{ open: boolean; payable: AnyRow | null }>({ open: false, payable: null });
  const [manualCloseDate, setManualCloseDate] = useState<string>('');
  const [manualCloseReason, setManualCloseReason] = useState<string>('');
  const [manualCloseAmount, setManualCloseAmount] = useState<string>(''); // importo da chiudere (totale o parziale)

  // Selection helpers
  // Banca di default alla selezione: se la fattura ha gia' un conto di pagamento
  // salvato lo riuso; altrimenti, se esiste UN SOLO conto attivo, preseleziono
  // quello. Con piu' conti resta vuoto (l'utente deve scegliere).
  const defaultBankIdFor = (payable: AnyRow): string => {
    const stored = payable.payment_bank_account_id ? String(payable.payment_bank_account_id) : '';
    if (stored && bankAccounts.some(b => String(b.id) === stored)) return stored;
    if (bankAccounts.length === 1 && bankAccounts[0]?.id) return String(bankAccounts[0].id);
    return '';
  };

  const toggleSelect = (id: string, payable: AnyRow) => {
    const next = new Set(selectedIds);
    const nextPlan = { ...paymentPlan };
    if (next.has(id)) {
      next.delete(id);
      delete nextPlan[id];
    } else {
      next.add(id);
      const residuo0 = Number(payable.amount_remaining) || 0;
      nextPlan[id] = { bankId: defaultBankIdFor(payable), type: 'saldo', amount: residuo0, baseAmount: residuo0, note: '', ncIds: [] };
      if (payable.disposizione_date && payable.status !== 'pagato' && payable.status !== 'annullato') {
        toast({ type: 'warning', message: `Fattura ${payable.invoice_number || ''} è già in distinta dal ${new Date(payable.disposizione_date as string).toLocaleDateString('it-IT')}: non verrà aggiunta di nuovo.` });
      }
    }
    setSelectedIds(next);
    setPaymentPlan(nextPlan);
  };

  const toggleSelectAll = () => {
    const nonPaid = filteredPayables.filter(p => p.status !== 'pagato' && (Number(p.gross_amount) || 0) >= 0);
    if (selectedIds.size === nonPaid.length) {
      setSelectedIds(new Set());
      setPaymentPlan({});
    } else {
      const next = new Set<string>();
      const nextPlan: Record<string, PlanEntry> = {};
      nonPaid.forEach(p => {
        if (!p.id) return;
        next.add(p.id);
        const residuo0 = Number(p.amount_remaining) || 0;
        nextPlan[p.id] = paymentPlan[p.id] || { bankId: defaultBankIdFor(p), type: 'saldo', amount: residuo0, baseAmount: residuo0, note: '', ncIds: [] };
      });
      setSelectedIds(next);
      setPaymentPlan(nextPlan);
    }
  };

  const updatePlan = (id: string, field: keyof PlanEntry, value: string | number) => {
    setPaymentPlan(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value as never }
    }));
  };

  // Importo (valore assoluto) di una nota di credito
  const ncAmountOf = (nc: AnyRow): number => Math.abs(Number(nc.gross_amount) || 0);

  // Note di credito APERTE dello stesso fornitore di `payable`, compensabili in distinta.
  // NC = payable con importo negativo o status 'nota_credito', non ancora chiusa a mano.
  // Aggancio fornitore per supplier_id o per P.IVA (come da regola PAYMENT_PLAN_NOTES).
  const openCreditNotesFor = (payable: AnyRow): AnyRow[] => {
    const sid = payable.supplier_id ? String(payable.supplier_id) : '';
    const svat = payable.supplier_vat ? String(payable.supplier_vat) : '';
    return payables.filter(x => {
      const g = Number(x.gross_amount) || 0;
      const isNC = x.status === 'nota_credito' || g < 0;
      if (!isNC || x.closed_manually) return false;
      const sameById = sid && String(x.supplier_id || '') === sid;
      const sameByVat = svat && String(x.supplier_vat || '') === svat;
      return Boolean(sameById || sameByVat);
    });
  };

  // Ricalcola l'importo NETTO del piano dopo una modifica (type/baseAmount/ncIds):
  //   netto = base (residuo se saldo, acconto se parziale) − Σ|NC selezionate|, min 0
  const recomputePlan = (pid: string, patch: Partial<PlanEntry>) => {
    setPaymentPlan(prev => {
      const cur = { ...prev[pid], ...patch } as PlanEntry;
      const payable = payables.find(p => p.id === pid);
      const residuo = Number(payable?.amount_remaining) || 0;
      const base = cur.type === 'saldo' ? residuo : Math.min(Number(cur.baseAmount) || 0, residuo);
      const ncTot = (cur.ncIds || []).reduce((s, nid) => {
        const nc = payables.find(p => p.id === nid);
        return s + (nc ? ncAmountOf(nc) : 0);
      }, 0);
      const net = Math.max(0, +(base - ncTot).toFixed(2));
      return { ...prev, [pid]: { ...cur, baseAmount: base, amount: net } };
    });
  };

  // Tipo riga distinta (ACCONTO vs SALDO) come richiesto:
  //  - 'parziale' (acconto scelto in assegnazione banca) → ACCONTO
  //  - rata intermedia di un piano 30/60/90 (es. 1/3, 2/3) → ACCONTO
  //  - pagamento pieno che chiude / ultima rata → SALDO
  // Restituisce anche l'etichetta con l'eventuale "(rata i/N)".
  const distintaTipo = (payable: AnyRow, plan: PlanEntry): { tipo: 'ACCONTO' | 'SALDO'; label: string } => {
    const nRate = Number(payable.installment_total) || 0;
    const rata = Number(payable.installment_number) || 0;
    const isRata = nRate > 1;
    const isIntermedia = isRata && rata > 0 && rata < nRate;
    const tipo: 'ACCONTO' | 'SALDO' = (plan.type === 'parziale' || isIntermedia) ? 'ACCONTO' : 'SALDO';
    const label = `${tipo}${isRata ? ` (rata ${rata}/${nRate})` : ''}`;
    return { tipo, label };
  };

  // Accesso alla tabella payable_credit_note_links (legami NC↔fattura del Passo 2).
  // Non è ancora nei tipi generati finché la migration 090 non è applicata + tipi rigenerati:
  // cast localizzato (niente any). Tutte le chiamate sono best-effort (try/catch a monte).
  type PcnlBuilder = {
    upsert: (values: unknown, options?: unknown) => Promise<{ error: { code?: string; message: string } | null }>
    delete: () => { eq: (col: string, val: unknown) => { eq: (col: string, val: unknown) => Promise<{ error: { message: string } | null }> } }
  }
  const pcnlTable = (): PcnlBuilder => (supabase.from as unknown as (t: string) => PcnlBuilder)('payable_credit_note_links');

  // Riepilogo NC compensate su una fattura (per causale/note distinta)
  const ncBreakdown = (plan: PlanEntry): { num: string; amt: number }[] =>
    (plan.ncIds || [])
      .map(nid => { const nc = payables.find(p => p.id === nid); return nc ? { num: nc.invoice_number || 'NC', amt: ncAmountOf(nc) } : null; })
      .filter(Boolean) as { num: string; amt: number }[];

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
  const bankBalances = useMemo<Record<string, number>>(() => {
    const balances: Record<string, number> = {};
    bankAccounts.forEach(ba => { if (ba.id) balances[ba.id] = Number(ba.current_balance) || 0; });
    Object.values(paymentPlan).forEach(plan => {
      if (plan.bankId && balances[plan.bankId] !== undefined) {
        balances[plan.bankId] -= (plan.amount || 0);
      }
    });
    return balances;
  }, [bankAccounts, paymentPlan]);

  // Totale allocato per banca (quanto si sta pagando)
  const bankSpending = useMemo<Record<string, number>>(() => {
    const spending: Record<string, number> = {};
    Object.values(paymentPlan).forEach(plan => {
      if (plan.bankId) {
        spending[plan.bankId] = (spending[plan.bankId] || 0) + (plan.amount || 0);
      }
    });
    return spending;
  }, [paymentPlan]);

  // ───── BOZZA DISTINTA PERSISTENTE (localStorage) ─────
  // Il lavoro in corso (fatture selezionate + piano di pagamento) vive solo in memoria
  // React: cambiare pagina, finestra o ricaricare lo perdeva ("distinta prodotta senza
  // salvarla"). Lo persistiamo nel browser così sopravvive a navigazione/reload. Per
  // singola operatrice (nessun dato condiviso, nessuna migration).
  const DRAFT_KEY = COMPANY_ID ? `scad_distinta_draft_${COMPANY_ID}` : '';
  const draftReady = useRef(false);

  // Ripristino una sola volta, quando i payables sono caricati (per validare le righe).
  useEffect(() => {
    if (!DRAFT_KEY || draftReady.current) return;
    if (!payables || payables.length === 0) return;
    draftReady.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { ids?: string[]; plan?: Record<string, PlanEntry> };
      // Tieni solo le fatture ancora presenti e non pagate/annullate.
      const validIds = (draft.ids || []).filter(id => {
        const p = payables.find(x => x.id === id);
        return p && p.status !== 'pagato' && p.status !== 'annullato';
      });
      if (validIds.length === 0) { localStorage.removeItem(DRAFT_KEY); return; }
      const plan: Record<string, PlanEntry> = {};
      validIds.forEach(id => { if (draft.plan && draft.plan[id]) plan[id] = draft.plan[id]; });
      setSelectedIds(new Set(validIds));
      setPaymentPlan(plan);
      toast({ type: 'info', message: `Bozza distinta ripristinata: ${validIds.length} fattur${validIds.length === 1 ? 'a' : 'e'} in lavorazione.` });
    } catch { /* bozza illeggibile: ignora */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DRAFT_KEY, payables]);

  // Salvataggio automatico a ogni modifica (dopo il primo ripristino). Selezione vuota → pulisce.
  useEffect(() => {
    if (!DRAFT_KEY || !draftReady.current) return;
    try {
      if (selectedIds.size === 0) {
        localStorage.removeItem(DRAFT_KEY);
      } else {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ids: Array.from(selectedIds), plan: paymentPlan, savedAt: new Date().toISOString() }));
      }
    } catch { /* quota o storage non disponibile: ignora */ }
  }, [DRAFT_KEY, selectedIds, paymentPlan]);

  // Saldo insufficiente: controlla SOLO le banche effettivamente in uso nei pagamenti
  // selezionati (non tutti i conti del tenant). Se un conto X è negativo ma non lo stai
  // usando per pagare, non deve bloccare l'operazione.
  const hasNegativeBalance = useMemo(() => {
    const usedBankIds = new Set<string>();
    for (const id of selectedIds) {
      const plan = paymentPlan[id];
      if (plan?.bankId) usedBankIds.add(plan.bankId);
    }
    for (const bid of usedBankIds) {
      if ((bankBalances[bid] ?? 0) < 0) return true;
    }
    return false;
  }, [bankBalances, selectedIds, paymentPlan]);

  const selectedTotal = useMemo(() => {
    return Array.from(selectedIds).reduce((sum, id) => {
      const plan = paymentPlan[id];
      return sum + (plan?.amount || 0);
    }, 0);
  }, [selectedIds, paymentPlan]);

  // Fatture selezionate SENZA banca assegnata: bloccano la creazione distinta.
  // Serve per dare un feedback esplicito all'utente (altrimenti il tasto resta
  // grigio senza spiegazione).
  const missingBankCount = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) if (!paymentPlan[id]?.bankId) n++;
    return n;
  }, [selectedIds, paymentPlan]);

  // Modals
  type ModalsState = {
    payment: { open: boolean; payable: AnyRow | null }
    invoice: { open: boolean; data: AnyRow | null }
    supplier: { open: boolean; data: AnyRow | null }
    editSchedule: { open: boolean; schedule: AnyRow | null }
    deleteConfirm: { open: boolean; scheduleId: string | null; invoiceNumber: string | null; recurringCostId: string | null }
  }
  const [modals, setModals] = useState<ModalsState>({
    payment: { open: false, payable: null },
    invoice: { open: false, data: null },
    supplier: { open: false, data: null },
    editSchedule: { open: false, schedule: null },
    deleteConfirm: { open: false, scheduleId: null, invoiceNumber: null, recurringCostId: null },
  });

  const today = new Date();

  // Load data (funzione riusabile)
  const fetchData = useCallback(async () => {
    if (!COMPANY_ID) return;
    try {
      setLoading(true);

      // PostgREST limita ogni richiesta a 1000 righe. Con oltre 1000 payables il
      // semplice .select('*') troncava i dati e i totali mensili risultavano
      // incompleti (scadenze mancanti nei subtotali). Pagino esplicitamente in
      // blocchi da 1000 finche' la sorgente e' esaurita.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fetchAllPaged = async (makeQuery: (from: number, to: number) => any, label: string): Promise<any[]> => {
        const PAGE = 1000;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const acc: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await makeQuery(from, from + PAGE - 1);
          if (error) { console.error(`[scadenzario] ${label} fetch:`, error?.message); break; }
          const batch = data || [];
          acc.push(...batch);
          if (batch.length < PAGE) break;
        }
        return acc;
      };

      // NB: ordine UNIVOCO per id. La vista ha un ORDER BY interno NON univoco
      // (stato, due_date) con pareggi enormi: senza una chiave univoca la
      // paginazione .range() su richieste HTTP separate puo' perdere/duplicare
      // righe al confine tra le pagine. Ordinando per id la paginazione e' stabile.
      const viewData = await fetchAllPaged(
        (from, to) => supabase.from('v_payables_operative').select('*').order('id', { ascending: true }).range(from, to),
        'v_payables_operative',
      );

      // Fetch extra fields from payables (cost_category_id, verified,
      // cash_movement_id, payment_date, payment_bank_account_id) per:
      //  - calcolo stato dinamico (Fix 5.1)
      //  - colonna CONTO con nome banca (Fix 5.2)
      const payablesRaw = await fetchAllPaged(
        (from, to) => supabase
          .from('payables')
          .select('id, cash_movement_id, cost_category_id, verified, payment_date, payment_bank_account_id, installment_number, installment_total, recurring_cost_id, closed_manually, manual_close_reason')
          .eq('company_id', COMPANY_ID!)
          .order('id', { ascending: true })
          .range(from, to),
        'payables extra',
      );
      const payablesExtraMap: Record<string, AnyRow> = {};
      (payablesRaw || []).forEach(p => {
        if (!p.id) return;
        payablesExtraMap[p.id] = {
          cash_movement_id: p.cash_movement_id || null,
          cost_category_id: p.cost_category_id || null,
          verified: p.verified || false,
          payment_date: p.payment_date || null,
          payment_bank_account_id: p.payment_bank_account_id || null,
          installment_number: (p as { installment_number?: number | null }).installment_number ?? null,
          installment_total: (p as { installment_total?: number | null }).installment_total ?? null,
          recurring_cost_id: (p as { recurring_cost_id?: string | null }).recurring_cost_id ?? null,
          closed_manually: (p as { closed_manually?: boolean | null }).closed_manually ?? false,
          manual_close_reason: (p as { manual_close_reason?: string | null }).manual_close_reason ?? null,
        };
      });

      // Fetch categories
      const { data: categoriesData } = await supabase
        .from('cost_categories')
        .select('*')
        .eq('company_id', COMPANY_ID!)
        .order('sort_order', { ascending: true });
      setCategories(categoriesData || []);

      const { data: suppliersData } = await supabase
        .from('suppliers')
        .select('*')
        .eq('company_id', COMPANY_ID!)
        .or('is_deleted.is.null,is_deleted.eq.false');

      const { data: centersData } = await supabase
        .from('cost_centers')
        .select('code, label, role, sort_order')
        .eq('company_id', COMPANY_ID!)
        .order('sort_order', { ascending: true });
      // I tipi generati non conoscono la colonna 'role' su cost_centers (types
      // stale): il cast evita il falso SelectQueryError senza toccare la query.
      setCostCenters((centersData || []) as unknown as AnyRow[]);

      // Ricorrenze attive: alimentano le scadenze-stima on-the-fly. Solo lettura.
      const { data: recurringData } = await supabase
        .from('recurring_costs')
        .select('id, supplier_name, cost_center, amount, frequency, day_of_month, payment_method, start_date, end_date, is_active, description')
        .eq('company_id', COMPANY_ID!)
        .or('is_active.is.null,is_active.eq.true');
      setRecurringCosts(recurringData || []);

      const { data: accountsData } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('company_id', COMPANY_ID!)
        .eq('is_active', true);

      // Lookup banca per Fix 5.2: due livelli di matching.
      // 1) payment_bank_account_id (set quando l'utente paga dal modale Salda)
      // 2) cash_movement_id -> cash_movements.bank_account_id (riconciliazione
      //    automatica: la banca e' quella su cui e' stato registrato il
      //    movimento bancario abbinato).
      const bankNameById = new Map<string, string>((accountsData || []).map(b => [b.id, b.bank_name || '']));
      const movementIds = (payablesRaw || []).map(p => p.cash_movement_id).filter((v): v is string => Boolean(v));
      const cashMovBankMap = new Map<string, string>();
      if (movementIds.length > 0) {
        // Filtro per azienda invece di .in(movementIds): la lista cresce con i payables
        // riconciliati e l'URL .in(...) rischia il 400 oltre i ~25KB. Bounded per azienda.
        // Paginato: oltre 1000 movimenti la mappa era parziale e la colonna CONTO
        // mostrava una banca mancante/errata (cash_movements cresce a ogni import EC).
        const movs = await fetchAllPaged(
          (from, to) => supabase
            .from('cash_movements')
            .select('id, bank_account_id')
            .eq('company_id', COMPANY_ID!)
            .order('id', { ascending: true })
            .range(from, to),
          'cash_movements bank map',
        );
        (movs || []).forEach(m => {
          if (m.bank_account_id) cashMovBankMap.set(m.id, m.bank_account_id);
        });
      }

      // Ultima disposizione (distinta) per payable -> badge "In distinta".
      // L'azione 'disposizione' viene scritta da confirmPayments al momento della
      // creazione della distinta; la fattura resta aperta finche' non riconciliata.
      const dispMap = new Map<string, { date: string | null; bankId: string | null }>();
      {
        // Filtro per azienda via embedded join (payables!inner) invece di .in(payableIds):
        // con molti payables (>~700) l'URL .in(...) superava i ~25KB e Supabase rispondeva
        // 400. Il join filtrato e' bounded e indipendente dalla crescita dei dati.
        // Paginato: oltre 1000 disposizioni il badge "In distinta" spariva per
        // alcune fatture. Ordine stabile (performed_at desc + payable_id) per non
        // perdere/duplicare righe al confine tra le pagine.
        const dispActions = await fetchAllPaged(
          (from, to) => supabase
            .from('payable_actions')
            .select('payable_id, bank_account_id, performed_at, payables!inner(company_id)')
            .eq('action_type', 'disposizione')
            .eq('payables.company_id', COMPANY_ID!)
            .order('performed_at', { ascending: false })
            .order('payable_id', { ascending: true })
            .range(from, to),
          'payable_actions disposizione',
        );
        (dispActions || []).forEach(a => {
          // La riga include la chiave nidificata `payables` (solo per il filtro): ignorata.
          if (a.payable_id && !dispMap.has(a.payable_id)) {
            dispMap.set(a.payable_id, { date: a.performed_at, bankId: a.bank_account_id || null });
          }
        });
      }

      const enrichedPayables: AnyRow[] = (viewData || []).map(row => {
        const extra = ((row.id && payablesExtraMap[row.id]) || {}) as AnyRow;
        const baseRow: AnyRow = {
          id: row.id || undefined,
          invoice_number: row.invoice_number || '-',
          invoice_date: row.invoice_date,
          due_date: row.due_date,
          original_due_date: row.original_due_date,
          gross_amount: row.gross_amount || 0,
          amount_paid: row.amount_paid || 0,
          amount_remaining: row.amount_remaining || 0,
          status: row.status, // overridden sotto da calculatePayableStatus
          payment_method: row.payment_method,
          payment_date: (extra.payment_date as string | null) ?? null,
          payment_bank_account_id: (extra.payment_bank_account_id as string | null) ?? null,
          // Nome banca per la colonna CONTO. Provo prima il banca diretta,
          // poi via cash_movement (per riconciliazioni automatiche).
          payment_bank_name: (() => {
            const direct = extra.payment_bank_account_id ? bankNameById.get(String(extra.payment_bank_account_id)) : null;
            if (direct) return direct;
            const viaCM = extra.cash_movement_id ? cashMovBankMap.get(String(extra.cash_movement_id)) : null;
            return viaCM ? bankNameById.get(viaCM) || null : null;
          })(),
          outlet_id: row.outlet_id,
          outlet_name: row.outlet_name,
          cost_center: row.cost_category_name || row.macro_group || 'altro',
          notes: (row as { notes?: string | null }).notes ?? null,
          suspend_reason: row.suspend_reason ?? null,
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
          cash_movement_id: (extra.cash_movement_id as string | null) ?? null,
          cost_category_id: (extra.cost_category_id as string | null) ?? null,
          verified: Boolean(extra.verified),
          installment_number: (extra.installment_number as number | null) ?? null,
          installment_total: (extra.installment_total as number | null) ?? null,
          recurring_cost_id: (extra.recurring_cost_id as string | null) ?? null,
          closed_manually: Boolean(extra.closed_manually),
          manual_close_reason: (extra.manual_close_reason as string | null) ?? null,
          disposizione_date: row.id ? (dispMap.get(row.id)?.date ?? null) : null,
          disposizione_bank_name: (() => {
            const b = row.id ? dispMap.get(row.id)?.bankId : null;
            return b ? bankNameById.get(b) || null : null;
          })(),
        };
        // Fix 5.1: ricalcolo lo stato dalla data se non e' terminale
        baseRow.status = calculatePayableStatus(baseRow);
        return baseRow;
      });

      setPayables(enrichedPayables);
      setSuppliers((suppliersData || []) as AnyRow[]);
      setBankAccounts((accountsData || []) as AnyRow[]);

      // Load fiscal deadlines for unified view
      try {
        const { data: fiscalData } = await supabase
          .from('fiscal_deadlines')
          .select('*')
          .eq('company_id', COMPANY_ID!)
          .neq('status', 'cancelled')
          .order('due_date', { ascending: true });
        setFiscalDeadlines((fiscalData || []) as AnyRow[]);
      } catch (e: unknown) { console.warn('fiscal_deadlines not available:', (e as Error).message); }

      const totalBalance = (accountsData || []).reduce((sum, acc) => sum + (Number(acc.current_balance) || 0), 0);
      setCashPosition(totalBalance);

      const { data: companyData } = await supabase
        .from('companies')
        .select('settings')
        .eq('id', COMPANY_ID)
        .single();
      const settings = companyData?.settings as { email_scadenzario?: string } | null;
      if (settings?.email_scadenzario) {
        setEmailRecipients(settings.email_scadenzario);
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
      const rows: AnyRow[] = [];

      try {
        const { data, error } = await supabase
          .from('bank_transactions')
          .select('id, transaction_date, description, amount, bank_account_id')
          .eq('company_id', COMPANY_ID!)
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
      } catch (e: unknown) {
        console.warn('bank_transactions incomes:', (e as Error).message);
      }

      try {
        const { data, error } = await supabase
          .from('cash_movements')
          .select('id, date, description, amount, bank_account_id')
          .eq('company_id', COMPANY_ID!)
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
      } catch (e: unknown) {
        console.warn('cash_movements incomes:', (e as Error).message);
      }

      // Arricchisci con bank_name dal lookup sul bankAccounts gia' caricato
      const bankMap = new Map<string, AnyRow>((bankAccounts || []).map(b => [String(b.id), b]));
      for (const r of rows) {
        const b = r.bank_account_id ? bankMap.get(String(r.bank_account_id)) : undefined;
        if (b) {
          r.bank_accounts = { bank_name: b.bank_name, account_name: b.account_name };
        }
      }

      rows.sort((a, b) => new Date(String(b.transaction_date || 0)).getTime() - new Date(String(a.transaction_date || 0)).getTime());
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
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(urlSupplier);
      const supQuery = supabase.from('suppliers').select('name, ragione_sociale') as unknown as { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { name?: string | null; ragione_sociale?: string | null } | null }> } };
      const { data: sup } = await supQuery.eq(isUuid ? 'id' : 'slug', urlSupplier).maybeSingle();
      if (sup) {
        const supLite = sup as { name?: string | null; ragione_sociale?: string | null };
        const name = supLite.name || supLite.ragione_sociale || '';
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
  const handleSetCategory = async (payableId: string, categoryId: string) => {
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
        .eq('company_id', COMPANY_ID!)
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
        .eq('company_id', COMPANY_ID!)
        .is('cost_category_id', null);
      propagatedCount = count || 0;
    } else if (supplierName) {
      // 2c. Senza supplier_id e senza P.IVA — match per nome
      const { data: matchedSupplier } = await supabase
        .from('suppliers')
        .select('id')
        .eq('company_id', COMPANY_ID!)
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
        .eq('company_id', COMPANY_ID!)
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
    toast({ type: 'info', message: `Categoria "${catName}" applicata a ${displayName}${propagatedCount > 0 ? ` e propagata a ${propagatedCount} fatture` : ''}` });
  };

  // Nome operatore per la registrazione in partitario (payable_actions)
  const operatorName = ([profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim())
    || profile?.email || 'Operatore';

  // Chiusura manuale TRACCIATA: chiude la fattura (totale o PARZIALE) e registra
  // SEMPRE la riga in partitario (payable_actions) con dicitura "Chiusa a mano" e
  // data di chiusura. Nessuna chiusura muta.
  //   - closeAmount === residuo (o undefined) → chiusura TOTALE: status='pagato'
  //   - closeAmount < residuo               → chiusura PARZIALE: status='parziale'
  const closePayableManually = async (payableId: string, closeDate: string, reason: string | null, closeAmount?: number): Promise<boolean> => {
    const payable = payables.find(p => p.id === payableId);
    const prevStatus = (payable?.status as string | null) ?? null;
    const gross = Number(payable?.gross_amount ?? 0) || 0;
    const prevPaid = Number(payable?.amount_paid ?? 0) || 0;
    const remaining = Number(payable?.amount_remaining ?? (gross - prevPaid)) || 0;

    // ───── NOTA DI CREDITO (gross < 0 o status nota_credito) ─────
    // "Chiudere" una NC = usarla/compensarla: marco closed_manually + data, SENZA
    // riclassificarla come pagata (resta NC ovunque). Nel partitario comparira'
    // la riga di chiusura in AVERE che annulla il DARE della nota di credito.
    const isNotaCredito = prevStatus === 'nota_credito' || gross < 0;
    if (isNotaCredito) {
      const ncAmount = Math.abs(gross);
      const { error } = await supabase
        .from('payables')
        .update({
          payment_date: closeDate,
          closed_manually: true,
          manual_close_reason: reason || null,
          payment_bank_account_id: null,
        } as never)
        .eq('id', payableId);
      if (error) {
        toast({ type: 'error', message: `Errore chiusura nota di credito: ${error.message}` });
        return false;
      }
      const dateLabelNC = new Date(closeDate).toLocaleDateString('it-IT');
      await supabase.from('payable_actions').insert({
        payable_id: payableId,
        action_type: 'chiusura_manuale',
        amount: ncAmount,
        bank_account_id: null,
        note: `Chiusura nota di credito a mano il ${dateLabelNC}${reason ? ` — ${reason}` : ''} (registrata in AVERE)`,
        operator_name: operatorName,
        performed_at: new Date().toISOString(),
      } as never);
      setPayables(prev => prev.map(p => p.id === payableId
        ? { ...p, payment_date: closeDate, closed_manually: true, manual_close_reason: reason || null }
        : p));
      return true;
    }

    // Importo da chiudere: default = residuo. Clamp tra 0 (escluso) e residuo.
    let amount = (closeAmount === undefined || !Number.isFinite(closeAmount)) ? remaining : closeAmount;
    if (amount <= 0) { toast({ type: 'error', message: 'Importo di chiusura non valido' }); return false; }
    if (amount > remaining + 0.005) amount = remaining;

    const newPaid = prevPaid + amount;
    const newRemaining = Math.max(0, remaining - amount);
    const isFull = newRemaining <= 0.005;
    const newStatus = isFull ? 'pagato' : 'parziale';

    const { error } = await supabase
      .from('payables')
      .update({
        status: newStatus,
        payment_date: closeDate,
        amount_paid: newPaid,
        amount_remaining: newRemaining,
        closed_manually: true,
        manual_close_reason: reason || null,
        payment_bank_account_id: null,
      } as never)
      .eq('id', payableId);
    if (error) {
      toast({ type: 'error', message: `Errore chiusura manuale: ${error.message}` });
      return false;
    }

    // Registrazione contabile in partitario (audit). Uso solo colonne stabili:
    // tutta l'informazione (dicitura + data + parziale/totale) sta in note.
    const dateLabel = new Date(closeDate).toLocaleDateString('it-IT');
    const tipoChiusura = isFull ? '' : ' — PARZIALE';
    await supabase.from('payable_actions').insert({
      payable_id: payableId,
      action_type: 'chiusura_manuale',
      amount,
      bank_account_id: null,
      note: `Chiusa a mano il ${dateLabel}${tipoChiusura}${reason ? ` — ${reason}` : ''} (${prevStatus || '—'} → ${newStatus})`,
      operator_name: operatorName,
      performed_at: new Date().toISOString(),
    } as never);

    setPayables(prev => prev.map(p => p.id === payableId
      ? { ...p, status: newStatus, payment_date: closeDate, amount_paid: newPaid, amount_remaining: newRemaining, closed_manually: true, manual_close_reason: reason || null, payment_bank_account_id: null, payment_bank_name: null }
      : p));
    return true;
  };

  // Apre la modale "Chiudi a mano" precompilando data (oggi) e importo (residuo).
  // Per le note di credito l'importo e' fisso = valore assoluto della NC.
  const openManualCloseModal = (p: AnyRow) => {
    setStatusDropdownId(null);
    setManualCloseModal({ open: true, payable: p });
    setManualCloseDate(todayYMD());
    setManualCloseReason('');
    const gross = Number(p.gross_amount ?? 0) || 0;
    const isNC = p.status === 'nota_credito' || gross < 0;
    const amount = isNC ? Math.abs(gross) : (Number(p.amount_remaining ?? gross) || 0);
    setManualCloseAmount(amount ? String(amount.toFixed(2)) : '');
  };

  // Handler: update status inline. La transizione a 'pagato' viene SEMPRE
  // instradata sulla chiusura tracciata (registra in partitario), cosi' nessuna
  // fattura si chiude piu' senza traccia contabile.
  const handleSetStatus = async (payableId: string, newStatus: string) => {
    if (newStatus === 'pagato') {
      const today = todayYMD();
      await closePayableManually(payableId, today, null);
      setStatusDropdownId(null);
      return;
    }
    const { error } = await supabase
      .from('payables')
      .update({ status: newStatus } as never)
      .eq('id', payableId);
    if (!error) {
      setPayables(prev => prev.map(p => p.id === payableId ? { ...p, status: newStatus } : p));
    }
    setStatusDropdownId(null);
  };

  // Handler: submit della modale "Chiudi a mano"
  const handleManualCloseSubmit = async () => {
    if (!manualCloseModal.payable?.id || !manualCloseDate) return;
    const grossMC = Number(manualCloseModal.payable.gross_amount ?? 0) || 0;
    const isNC = manualCloseModal.payable.status === 'nota_credito' || grossMC < 0;

    // Nota di credito → chiusura totale (importo fisso = |NC|), nessun parziale.
    if (isNC) {
      setIsSaving(true);
      const ok = await closePayableManually(manualCloseModal.payable.id, manualCloseDate, manualCloseReason.trim() || null);
      setIsSaving(false);
      if (ok) {
        toast({ type: 'success', message: 'Nota di credito chiusa a mano — registrata in AVERE nel partitario' });
        setManualCloseModal({ open: false, payable: null });
        setManualCloseDate(''); setManualCloseReason(''); setManualCloseAmount('');
      }
      return;
    }

    const remaining = Number(manualCloseModal.payable.amount_remaining ?? manualCloseModal.payable.gross_amount ?? 0) || 0;
    const parsed = parseFloat((manualCloseAmount || '').replace(',', '.'));
    const amount = Number.isFinite(parsed) ? parsed : remaining;
    if (amount <= 0 || amount > remaining + 0.005) {
      toast({ type: 'error', message: `Importo non valido: deve essere tra 0 e ${fmt(remaining)} €` });
      return;
    }
    setIsSaving(true);
    const ok = await closePayableManually(manualCloseModal.payable.id, manualCloseDate, manualCloseReason.trim() || null, amount);
    setIsSaving(false);
    if (ok) {
      const isFull = amount >= remaining - 0.005;
      toast({ type: 'success', message: isFull ? 'Fattura chiusa a mano e registrata in partitario' : `Chiusura parziale di ${fmt(amount)} € registrata in partitario` });
      setManualCloseModal({ open: false, payable: null });
      setManualCloseDate('');
      setManualCloseReason('');
      setManualCloseAmount('');
    }
  };

  // Filter payables
  // Convert fiscal deadlines to payable-like objects for unified view
  const fiscalAsPayables = useMemo<AnyRow[]>(() => {
    return fiscalDeadlines.map((fd): AnyRow => ({
      id: `fiscal_${fd.id}`,
      _isFiscal: true,
      invoice_number: (fd.title as string | null) || (fd.deadline_type as string | null),
      invoice_date: (fd.created_at as string | null),
      due_date: (fd.due_date as string | null),
      original_due_date: (fd.due_date as string | null),
      gross_amount: Number(fd.amount) || 0,
      amount_paid: fd.status === 'paid' ? (Number(fd.amount) || 0) : 0,
      amount_remaining: fd.status === 'paid' ? 0 : (Number(fd.amount) || 0),
      status: fd.status === 'paid' ? 'pagato' : fd.status === 'overdue' ? 'scaduto' : fd.status === 'upcoming' ? 'in_scadenza' : 'da_pagare',
      payment_method: (fd.payment_method as string | null) || 'f24',
      outlet_id: null,
      outlet_name: '',
      cost_center: 'fiscale',
      notes: (fd.notes as string | null) || '',
      days_to_due: fd.due_date ? Math.round((new Date(String(fd.due_date)).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null,
      urgency: null,
      priority: null,
      supplier_id: null,
      supplier_iban: '',
      supplier_vat: '',
      suppliers: { name: `📋 ${(fd.deadline_type as string | null)?.toUpperCase() || 'Fiscale'}`, ragione_sociale: (fd.title as string | null) || (fd.deadline_type as string | null), category: 'fiscale' },
      last_action_type: null,
      last_action_note: null,
      last_action_date: null,
      cash_movement_id: null,
      cost_category_id: null,
      verified: false,
    }));
  }, [fiscalDeadlines]);

  const filteredPayables = useMemo(() => {
    // Combine sources based on TYPE filter (default '' = fornitori + fiscali).
    // 'incassi' usa una tabella dedicata (bank_transactions in entrata), quindi
    // qui resta sull'unione: il ramo incassi non legge questa lista.
    let source: AnyRow[] = [];
    if (typeFilter === 'fornitori') source = payables;
    else if (typeFilter === 'fiscali') source = fiscalAsPayables;
    else source = [...payables, ...fiscalAsPayables];

    return source.filter((p) => {
      // Le note di credito (status 'nota_credito' / importo negativo) RESTANO visibili
      // nello Scadenzario: hanno importo negativo e scalano il dovuto per fornitore
      // (passivo che riduce la quota da pagare). Non sono pagabili (no checkbox).

      // Escludi annullati per default — visibili SOLO se utente filtra esplicitamente 'annullato'
      if (p.status === 'annullato' && selectedStatus !== 'annullato') return false;

      // Stato speciale 'In distinta': scadenze disposte ma non ancora pagate/annullate.
      if (selectedStatus === 'in_distinta' && !(p.disposizione_date && p.status !== 'pagato' && p.status !== 'annullato')) return false;

      // NB: esclusione delle pagate per default applicata in displayPayables
      // (sotto), NON qui — displayPayables è derivato DOPO questo useMemo, causa
      // ReferenceError TDZ runtime "Cannot access Y before initialization".

      const matchOutlet = !selectedOutlet || p.outlet_id === selectedOutlet;
      const matchStatus = !selectedStatus
        || selectedStatus === 'all' // "Tutti gli stati": include le pagate
        || selectedStatus === 'in_distinta' // gestito sopra
        || (selectedStatus === 'da_saldare' && p.status !== 'pagato')
        || (selectedStatus !== 'da_saldare' && p.status === selectedStatus);
      const matchSearch = !searchTerm || (p.invoice_number || '').toLowerCase().includes(searchTerm.toLowerCase()) || (p.suppliers?.ragione_sociale || p.suppliers?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || (p.notes || '').toLowerCase().includes(searchTerm.toLowerCase());
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
  }, [payables, fiscalAsPayables, typeFilter, selectedOutlet, selectedStatus, searchTerm, dateRange, selectedMethodGroup]);

  // KPIs
  const kpis = useMemo(() => {
    const totalDuePending = filteredPayables
      .filter((p) => p.status !== 'pagato' && p.due_date && new Date(p.due_date) <= today)
      .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

    const totalOverdue = filteredPayables
      .filter((p) => p.status === 'scaduto')
      .reduce((sum, p) => sum + (p.amount_remaining || 0), 0);

    const nextSevenDays = filteredPayables
      .filter((p) => {
        if (!p.due_date) return false;
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

  // Fatture IN SOSPESO = disposte in distinta, in attesa di riscontro bancario.
  // Conteggio/totale globali (indipendenti dal filtro attivo), per l'accesso rapido.
  const suspendedInfo = useMemo(() => {
    const list = payables.filter(p => !!p.disposizione_date && p.status !== 'pagato' && p.status !== 'annullato');
    return { count: list.length, total: list.reduce((s, p) => s + (Number(p.amount_remaining) || 0), 0) };
  }, [payables]);

  // Totali per singolo metodo di pagamento (stessa base filtrata dei KPI)
  type MethodAgg = { key: string; label: string; total: number; count: number }
  const methodTotals = useMemo<MethodAgg[]>(() => {
    const activePays = filteredPayables.filter(p => p.status !== 'pagato' && p.status !== 'annullato');
    const map: Record<string, MethodAgg> = {};
    activePays.forEach(p => {
      const m = p.payment_method || 'altro';
      const labels = paymentMethodLabels as Record<string, string>;
      if (!map[m]) map[m] = { key: m, label: labels[m] || m, total: 0, count: 0 };
      map[m].total += (p.amount_remaining || 0);
      map[m].count += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filteredPayables]);

  // Monthly data
  const monthlyData = useMemo(() => {
    const months: Array<{ month: string; scadenze: number }> = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(today);
      d.setMonth(d.getMonth() + i);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);

      const total = payables
        .filter((p) => {
          if (!p.due_date) return false;
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
    const cats: Record<string, number> = {};
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
  // Override manuale per pagamenti eseguiti fuori dall'app (RID, F24, home banking):
  // somma additiva su amount_paid (cap a gross_amount), ricalcolo residuo e stato.
  const handleMarkAsPaid = useCallback(async (payableId: string, amount: number, bankAccountId: string | null) => {
    try {
      const payableMod = modals.payment.payable as AnyRow | null;
      const gross = Number(payableMod?.gross_amount) || 0;
      const newPaid = Math.min(gross, (Number(payableMod?.amount_paid) || 0) + amount);
      const newRemaining = Math.max(0, gross - newPaid);
      const { error } = await supabase.from('payables').update({
        amount_paid: newPaid,
        amount_remaining: newRemaining,
        payment_date: today.toISOString().split('T')[0],
        payment_bank_account_id: bankAccountId,
        status: newRemaining <= 0 ? 'pagato' : 'parziale',
      } as never).eq('id', payableId);
      if (error) {
        toast({ type: 'error', message: 'Errore registrazione pagamento: ' + error.message });
        return;
      }
      fetchData();
    } catch (error) {
      console.error('Error marking payment:', error);
      toast({ type: 'error', message: 'Errore registrazione pagamento: ' + (error instanceof Error ? error.message : String(error)) });
    }
  }, [today, modals, fetchData, toast]);

  const handleCreateInvoice = useCallback(async (invoiceData: InvoiceFormState) => {
    // Validazione minima (niente dialog nativi): nominativo + scadenze + importo.
    const newName = (invoiceData.newSupplierName || '').trim();
    if (!invoiceData.supplierId && !newName) { toast({ type: 'warning', message: 'Indica un fornitore esistente o un nuovo nominativo.' }); return; }
    // Le scadenze arrivano già calcolate dalle REGOLE INTERNE (piano del fornitore o
    // default aziendale "a vista"), ma restano correggibili a mano: qui validiamo il minimo.
    const rate = Array.isArray(invoiceData.rate) ? invoiceData.rate.filter(r => r && r.dueDate) : [];
    if (rate.length === 0) { toast({ type: 'warning', message: 'Indica almeno una scadenza di pagamento.' }); return; }
    if (!(Number(invoiceData.grossAmount) > 0)) { toast({ type: 'warning', message: 'Indica un importo maggiore di zero.' }); return; }
    // La somma delle rate deve quadrare col totale (tolleranza 1 cent).
    const sumRate = rate.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (Math.abs(sumRate - Number(invoiceData.grossAmount)) > 0.01) {
      toast({ type: 'warning', message: `La somma delle rate (€ ${sumRate.toFixed(2)}) non corrisponde all'importo totale (€ ${Number(invoiceData.grossAmount).toFixed(2)}).` });
      return;
    }
    const firstDue = rate[0].dueDate;
    const isRecurring = !!invoiceData.frequency && invoiceData.frequency !== 'una_tantum';
    if (isRecurring && !invoiceData.costCenter) { toast({ type: 'warning', message: 'Per una scadenza ricorrente scegli il centro di costo / outlet.' }); return; }
    try {
      // 0) Nominativo NON a sistema: creo un'anagrafica leggera (nome + tipo scelto
      //    come categoria) così è riutilizzabile e il tipo resta salvato.
      let supplierId = invoiceData.supplierId;
      if (!supplierId && newName) {
        const { data: newSup, error: supErr } = await supabase.from('suppliers').insert([{
          company_id: COMPANY_ID,
          ragione_sociale: newName,
          name: newName,
          category: invoiceData.supplierType || 'fornitore',
          is_active: true,
        } as never]).select('id');
        if (supErr || !newSup?.[0]) {
          toast({ type: 'error', message: 'Errore nel creare il nominativo: ' + (supErr?.message || 'sconosciuto') });
          return;
        }
        supplierId = String((newSup[0] as { id?: string }).id || '');
        // Aggiorno la lista locale così compare subito nelle ricerche successive.
        setSuppliers(prev => [...prev, { id: supplierId, name: newName, ragione_sociale: newName, category: invoiceData.supplierType || 'fornitore' } as AnyRow]);
      }
      const effectiveName = newName
        || (suppliers.find(s => s.id === supplierId)?.ragione_sociale
          || suppliers.find(s => s.id === supplierId)?.name || '') as string;

      // 1) Se ricorrente, crea PRIMA la ricorrenza (così posso collegarla alla
      //    payable): il link recurring_cost_id permette la cancellazione a
      //    cascata — niente più ricorrenze fantasma in cashflow/stime.
      let recurringId: string | null = null;
      let recurringMsg = '';
      if (isRecurring) {
        const supplierName = effectiveName;
        const dueDay = firstDue ? new Date(firstDue).getDate() : 1;
        const { data: recData, error: recErr } = await supabase.from('recurring_costs').insert([{
          company_id: COMPANY_ID,
          cost_center: invoiceData.costCenter,
          description: [supplierName, invoiceData.invoiceNumber].filter(Boolean).join(' · ') || 'Scadenza ricorrente',
          amount: invoiceData.grossAmount,
          frequency: invoiceData.frequency,
          day_of_month: Math.min(28, Math.max(1, dueDay)),
          payment_method: invoiceData.paymentMethod || 'bonifico_ordinario',
          supplier_name: supplierName || null,
          start_date: firstDue,
          end_date: invoiceData.endDate || null,
          is_active: true,
        } as never]).select('id');
        if (recErr) {
          toast({ type: 'error', message: 'Errore nel registrare la ricorrenza: ' + recErr.message });
          return;
        }
        recurringId = (recData?.[0] as { id?: string } | undefined)?.id ?? null;
        recurringMsg = ' — ricorrenza registrata in Ricorrenze';
      }

      // 2) Crea le scadenze: una payable per rata. Con rata unica lascio
      //    installment_number/total a null (coerente con le fatture a rata singola
      //    esistenti); la ricorrenza si collega solo alla prima rata (come il bridge A-Cube).
      const nRate = rate.length;
      const rows = rate.map((r, idx) => ({
        company_id: COMPANY_ID,
        supplier_id: supplierId,
        supplier_name: effectiveName || null,
        invoice_number: invoiceData.invoiceNumber,
        invoice_date: invoiceData.invoiceDate,
        due_date: r.dueDate,
        original_due_date: r.dueDate,
        gross_amount: Number(r.amount) || 0,
        amount_remaining: Number(r.amount) || 0,
        payment_method: invoiceData.paymentMethod || 'bonifico',
        installment_number: nRate > 1 ? idx + 1 : null,
        installment_total: nRate > 1 ? nRate : null,
        recurring_cost_id: idx === 0 ? recurringId : null,
      }));
      const { error: payErr } = await supabase.from('payables').insert(rows as never);
      if (payErr) {
        // Rollback ricorrenza per non lasciare orfani.
        if (recurringId) await supabase.from('recurring_costs').delete().eq('id', recurringId);
        toast({ type: 'error', message: 'Errore creazione scadenza: ' + payErr.message });
        return;
      }

      setModals(prev => ({ ...prev, invoice: { open: false, data: null } }));
      toast({ type: 'success', message: (rate.length > 1 ? `${rate.length} rate create` : 'Scadenza creata') + recurringMsg + '.' });
      fetchData();
    } catch (error) {
      console.error('Error creating scadenza:', error);
      toast({ type: 'error', message: 'Errore creazione scadenza: ' + (error instanceof Error ? error.message : String(error)) });
    }
  }, [COMPANY_ID, suppliers, toast]);

  type SupplierData = { name: string; vat?: string; fiscal?: string; iban?: string; category?: string; paymentMethod?: string }
  const handleCreateSupplier = useCallback(async (supplierData: SupplierData) => {
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
      } as never]).select();

      if (data) {
        setSuppliers([...suppliers, ...(data as AnyRow[])]);
        setModals({ ...modals, supplier: { open: false, data: null } });
      }
    } catch (error) {
      console.error('Error creating supplier:', error);
    }
  }, [suppliers, modals, COMPANY_ID]);

  type ScheduleData = { id: string; amount?: number; due_date?: string; status?: string; amount_paid?: number }
  // Mapping bidirezionale status payables <-> fiscal_deadlines
  const mapStatusToFiscal = (payableStatus?: string): string => {
    switch (payableStatus) {
      case 'pagato': return 'paid';
      case 'parziale': return 'pending';
      case 'scaduto': return 'overdue';
      case 'in_scadenza': return 'upcoming';
      case 'annullato': return 'cancelled';
      default: return 'pending';
    }
  };

  const handleEditSchedule = useCallback(async (scheduleData: ScheduleData) => {
    setIsSaving(true);
    try {
      const newAmount = Number(scheduleData.amount) || 0;
      const newPaid = Number(scheduleData.amount_paid) || 0;
      // Dispatch: scadenza fiscale (id fiscal_xxx) → tabella fiscal_deadlines
      //          scadenza normale (uuid) → tabella payables
      if (scheduleData.id.startsWith('fiscal_')) {
        const realId = scheduleData.id.substring('fiscal_'.length);
        const { error } = await supabase.from('fiscal_deadlines').update({
          amount: newAmount,
          due_date: scheduleData.due_date,
          status: mapStatusToFiscal(scheduleData.status),
          amount_paid: newPaid,
        } as never).eq('id', realId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('payables').update({
          gross_amount: newAmount,
          due_date: scheduleData.due_date,
          status: scheduleData.status,
          amount_remaining: Math.max(0, newAmount - newPaid),
          amount_paid: newPaid,
        } as never).eq('id', scheduleData.id);
        if (error) throw new Error(error.message);
      }
      setModals({ ...modals, editSchedule: { open: false, schedule: null } });
      toast({ type: 'success', message: `Scadenza aggiornata: € ${newAmount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}` });
      fetchData();
    } catch (error) {
      console.error('Error updating schedule:', error);
      toast({ type: 'error', message: 'Errore salvataggio: ' + (error instanceof Error ? error.message : String(error)) });
    } finally {
      setIsSaving(false);
    }
  }, [modals, fetchData, toast]);

  // Rimanda scadenza: aggiorna due_date e resetta status a 'da_pagare' (se era scaduto)
  // Dispatch fiscal_deadlines vs payables
  const handleRinviaSchedule = useCallback(async (scheduleId: string, newDueDate: string) => {
    if (!newDueDate) return;
    setIsSaving(true);
    try {
      if (scheduleId.startsWith('fiscal_')) {
        const realId = scheduleId.substring('fiscal_'.length);
        const { error } = await supabase.from('fiscal_deadlines').update({
          due_date: newDueDate,
          status: 'pending',
        } as never).eq('id', realId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('payables').update({
          due_date: newDueDate,
          status: 'da_pagare',
        } as never).eq('id', scheduleId);
        if (error) throw new Error(error.message);
      }
      toast({ type: 'success', message: `Scadenza rimandata al ${new Date(newDueDate).toLocaleDateString('it-IT')}` });
      setRinviaModal({ open: false, scheduleId: null, currentDueDate: null, invoiceNumber: null });
      setRinviaCustomDate('');
      fetchData();
    } catch (err) {
      toast({ type: 'error', message: 'Errore rimando: ' + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setIsSaving(false);
    }
  }, [toast, fetchData]);

  // cascadeRecurring: se valorizzato, elimina anche la ricorrenza collegata
  // (così stime on-the-fly e cashflow si aggiornano da soli, niente fantasmi).
  const handleDeleteSchedule = useCallback(async (scheduleId: string, cascadeRecurringId?: string | null) => {
    setIsSaving(true);
    try {
      // Dispatch fiscal vs payable
      if (scheduleId.startsWith('fiscal_')) {
        const realId = scheduleId.substring('fiscal_'.length);
        const { error } = await supabase.from('fiscal_deadlines').update({ status: 'cancelled' } as never).eq('id', realId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('payables').update({ status: 'annullato' } as never).eq('id', scheduleId);
        if (error) throw new Error(error.message);
      }
      if (cascadeRecurringId) {
        const { error: recErr } = await supabase.from('recurring_costs').delete().eq('id', cascadeRecurringId);
        if (recErr) throw new Error(recErr.message);
      }
      setModals({ ...modals, deleteConfirm: { open: false, scheduleId: null, invoiceNumber: null, recurringCostId: null } });
      toast({ type: 'success', message: cascadeRecurringId ? 'Scadenza e ricorrenza eliminate' : 'Scadenza annullata' });
      fetchData();
    } catch (error) {
      console.error('Error deleting schedule:', error);
      toast({ type: 'error', message: 'Errore cancellazione: ' + (error instanceof Error ? error.message : String(error)) });
    } finally {
      setIsSaving(false);
    }
  }, [modals, fetchData]);

  // Inline-edit importo: dispatch fiscal_deadlines vs payables
  const handleInlineSaveAmount = useCallback(async (payableId: string, newValue: string) => {
    const newAmount = parseFloat(newValue.replace(',', '.'));
    if (isNaN(newAmount) || newAmount < 0) {
      toast({ type: 'error', message: 'Importo non valido' });
      setInlineEditAmountId(null);
      return;
    }
    try {
      if (payableId.startsWith('fiscal_')) {
        const realId = payableId.substring('fiscal_'.length);
        const { error } = await supabase.from('fiscal_deadlines').update({ amount: newAmount } as never).eq('id', realId);
        if (error) throw new Error(error.message);
      } else {
        const p = payables.find(x => x.id === payableId);
        const currentPaid = Number(p?.amount_paid) || 0;
        const { error } = await supabase.from('payables').update({
          gross_amount: newAmount,
          amount_remaining: Math.max(0, newAmount - currentPaid),
        } as never).eq('id', payableId);
        if (error) throw new Error(error.message);
      }
      toast({ type: 'success', message: `Importo aggiornato a € ${newAmount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}` });
      setInlineEditAmountId(null);
      fetchData();
    } catch (err) {
      toast({ type: 'error', message: 'Errore aggiornamento importo: ' + (err instanceof Error ? err.message : String(err)) });
      setInlineEditAmountId(null);
    }
  }, [payables, toast, fetchData]);

  // "Crea distinta" (bottom bar): costruisce SOLO l'anteprima (recap + email).
  // NESSUNA scrittura su DB qui: il salvataggio avviene solo con "Conferma distinta"
  // nel modale. Cosi' chiudere senza confermare non lascia righe "In distinta".
  const confirmPayments = async () => {
    if (hasNegativeBalance || selectedIds.size === 0) return;
    setIsSaving(true);
    const results = [];
    const items: DistintaItem[] = [];
    const dataStr = new Date().toLocaleDateString('it-IT');

    try {
      for (const id of selectedIds) {
        const plan = paymentPlan[id];
        const payable = payables.find(p => p.id === id);
        if (!plan || !payable) continue;

        const bank = bankAccounts.find(b => b.id === plan.bankId);

        // Tipo ACCONTO/SALDO (con eventuale rata) + note di credito compensate.
        const { label: tipoLabel } = distintaTipo(payable, plan);
        const ncList = ncBreakdown(plan);
        // Causale NC per il bonifico (la scrive Sabrina): "al netto NC n.X (importo) e NC n.Y (importo)"
        const ncNote = ncList.length
          ? `al netto ${ncList.map(n => `NC n.${n.num} (${fmt(n.amt)})`).join(' e ')}`
          : '';
        const composedNote = [plan.note, ncNote].filter(Boolean).join(' — ');

        // Riga da salvare alla conferma (la disposizione NON marca la fattura pagata:
        // resta aperta finche' il movimento non viene riconciliato). La nota include tipo
        // (ACCONTO/SALDO) e l'eventuale scalatura NC, così resta tracciata anche in Storico.
        items.push({
          payableId: id,
          bankId: plan.bankId || '',
          amount: plan.amount,
          status: (payable.status as string) || 'da_pagare',
          note: `Distinta del ${dataStr} — ${bank?.bank_name || 'N/D'} — ${tipoLabel}${ncNote ? ` — ${ncNote}` : ''}`,
          ncIds: plan.ncIds && plan.ncIds.length ? [...plan.ncIds] : undefined,
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
          tipo: tipoLabel,
          metodo: (paymentMethodLabels as Record<string, string>)[payable.payment_method || ''] || '',
          note: composedNote,
        });
      }

      // Raggruppa per banca con saldi prima/dopo
      type BankAgg = { bankName: string; iban: string; saldoIniziale: number; totalePagamenti: number; pagamenti: Array<typeof results[number]>; saldoFinale?: number }
      const bankMap: Record<string, BankAgg> = {};
      results.forEach(r => {
        if (!bankMap[r.bankId]) {
          const ba = bankAccounts.find(b => b.id === r.bankId);
          bankMap[r.bankId] = {
            bankName: r.banca,
            iban: (ba?.iban as string) || '',
            saldoIniziale: Number(ba?.current_balance) || 0,
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

      setConfirmResult({ results, banks, totaleComplessivo, emailBody, emailSubject, items } as unknown as NonNullable<ConfirmResult>);
      setDistintaSaved(false);
      setIsSaving(false);
      // NB: nessuna scrittura né fetchData qui — è solo l'anteprima.
    } catch (error) {
      console.error('Error building distinta preview:', error);
      toast({ type: 'error', message: 'Errore creazione anteprima distinta: ' + (error instanceof Error ? error.message : String(error)) });
      setIsSaving(false);
    }
  };

  // "Conferma distinta": salva le disposizioni (azione esplicita). Dedup: non inserisce
  // se la fattura è già in distinta (controllo applicativo + indice unique parziale lato DB).
  const confirmDistinta = async () => {
    if (!confirmResult || distintaSaved) return;
    const items = confirmResult.items || [];
    if (items.length === 0) return;
    setIsSaving(true);
    try {
      const ids = items.map(i => i.payableId);
      // Quali sono già in distinta? (batch piccolo = ids selezionati, nessun rischio URL)
      const { data: existing } = await supabase
        .from('payable_actions')
        .select('payable_id, payables!inner(company_id)')
        .eq('action_type', 'disposizione')
        .eq('payables.company_id', COMPANY_ID!)
        .in('payable_id', ids);
      const already = new Set((existing || []).map(r => r.payable_id));

      let inserted = 0, skipped = 0;
      const errors: string[] = [];
      for (const it of items) {
        if (already.has(it.payableId)) { skipped++; continue; }
        const { error: actErr } = await supabase.from('payable_actions').insert({
          payable_id: it.payableId,
          action_type: 'disposizione',
          old_status: it.status,
          new_status: it.status,
          amount: it.amount,
          bank_account_id: it.bankId || null,
          note: it.note,
        } as never);
        if (actErr) {
          // 23505 = violazione unique (indice parziale): già in distinta, non è un errore
          if ((actErr as { code?: string }).code === '23505') { skipped++; continue; }
          errors.push(`${it.payableId}: ${actErr.message}`);
          continue;
        }
        // Banca attesa per la riconciliazione (nessun altro campo della fattura toccato)
        await supabase.from('payables').update({ payment_bank_account_id: it.bankId || null } as never).eq('id', it.payableId);
        inserted++;
      }

      // NOTE DI CREDITO: NON si chiudono qui. La compensazione è solo un'INTENZIONE finché
      // il bonifico netto non è realmente uscito e riconciliato. Alla Conferma la distinta
      // porta solo il netto + la causale (numeri NC) nella disposizione; la chiusura di
      // fattura e NC avviene insieme al momento della riconciliazione del movimento
      // bancario (o della chiusura a mano di normalizzazione). Vedi Passo 2.
      //
      // Passo 2: registro il LEGAME fattura↔NC (tabella payable_credit_note_links) così che,
      // quando il movimento netto viene riconciliato, la funzione reconcile_movement consumi
      // le NC e chiuda la fattura. Best-effort: se la tabella non esiste ancora (migration 090
      // non applicata) l'errore viene ignorato e la distinta resta valida comunque.
      try {
        const links = items.flatMap(it => (it.ncIds || []).map(ncId => {
          const nc = payables.find(p => p.id === ncId);
          return {
            company_id: COMPANY_ID,
            payable_id: it.payableId,
            credit_note_payable_id: ncId,
            amount: nc ? Math.abs(Number(nc.gross_amount) || 0) : 0,
            status: 'pending',
          };
        }));
        if (links.length > 0) {
          const { error: linkErr } = await pcnlTable()
            .upsert(links, { onConflict: 'payable_id,credit_note_payable_id', ignoreDuplicates: true });
          if (linkErr && linkErr.code !== '42P01') {
            // 42P01 = tabella inesistente (migration non ancora applicata): silenzioso.
            console.warn('[distinta] legami NC non salvati:', linkErr.message);
          }
        }
      } catch (e) {
        console.warn('[distinta] legami NC: errore ignorato', e);
      }

      setIsSaving(false);
      if (errors.length > 0) {
        toast({ type: 'error', message: `Distinta salvata con errori: ${inserted} aggiunte, ${errors.length} fallite.` });
      } else if (skipped > 0) {
        toast({ type: 'success', message: `Distinta confermata: ${inserted} aggiunte${skipped > 0 ? `, ${skipped} già in distinta (saltate)` : ''}.` });
      } else {
        toast({ type: 'success', message: `Distinta confermata: ${inserted} scadenze in distinta.` });
      }
      setDistintaSaved(true);
      setSelectedIds(new Set());
      setPaymentPlan({});
      // Chiudi subito il pop-up dopo la conferma: la distinta è salvata, non deve
      // ripresentarsi. Azzero anche la bozza in localStorage così, tornando sulla
      // pagina o ricaricando, l'anteprima non viene ricostruita/ripristinata.
      setConfirmResult(null);
      setDistintaSaved(false);
      if (DRAFT_KEY) { try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage non disponibile */ } }
      fetchData();
    } catch (error) {
      console.error('Error confirming distinta:', error);
      toast({ type: 'error', message: 'Errore conferma distinta: ' + (error instanceof Error ? error.message : String(error)) });
      setIsSaving(false);
    }
  };

  // "Rimuovi dalla distinta": cancella la SINGOLA riga disposizione di quel payable e
  // riporta davvero allo stato precedente azzerando payment_bank_account_id (la banca
  // attesa scritta dalla conferma distinta). Guardia lato DB: NON tocca la banca se la
  // scadenza è pagata/parziale o ha già una payment_date (banca dei flussi reali).
  const removeFromDistinta = async (payableId: string) => {
    try {
      // Passo 2: rimuovo anche i legami NC↔fattura ancora 'pending' (l'intenzione di
      // compensazione decade con la distinta). Best-effort: ignoro se la tabella non c'è.
      try {
        await pcnlTable().delete().eq('payable_id', payableId).eq('status', 'pending');
      } catch { /* tabella assente o errore non bloccante */ }
      const { error } = await supabase
        .from('payable_actions')
        .delete()
        .eq('payable_id', payableId)
        .eq('action_type', 'disposizione');
      if (error) {
        toast({ type: 'error', message: 'Errore rimozione dalla distinta: ' + error.message });
        return;
      }
      // Azzero la banca attesa solo se la scadenza è ancora "aperta" (non pagata/parziale,
      // nessuna data pagamento): condizioni applicate nella query, niente race su stato stale.
      const { error: bankErr } = await supabase
        .from('payables')
        .update({ payment_bank_account_id: null } as never)
        .eq('id', payableId)
        .is('payment_date', null)
        .not('status', 'in', '("pagato","parziale")');
      if (bankErr) {
        toast({ type: 'error', message: 'Scadenza rimossa, ma errore azzerando la banca attesa: ' + bankErr.message });
        setRemoveDistintaModal(null);
        fetchData();
        return;
      }
      toast({ type: 'success', message: 'Scadenza rimossa dalla distinta.' });
      setRemoveDistintaModal(null);
      fetchData();
    } catch (error) {
      toast({ type: 'error', message: 'Errore rimozione dalla distinta: ' + (error instanceof Error ? error.message : String(error)) });
    }
  };

  // Apertura in Gmail (le utenti usano Gmail dal browser): compose in NUOVA scheda.
  // mailto via location.href era un no-op silenzioso senza client di posta desktop.
  // Gmail ha un limite pratico ~8000 char sull'URL: se superato, niente apertura ->
  // messaggio chiaro che invita a usare "Copia testo" (sempre visibile qui sotto).
  const openDistintaGmail = () => {
    if (!confirmResult) return;
    const to = encodeURIComponent(emailRecipients || '');
    const su = encodeURIComponent(confirmResult.emailSubject);
    const body = encodeURIComponent(confirmResult.emailBody);
    const url = `https://mail.google.com/mail/?view=cm&fs=1${emailRecipients ? `&to=${to}` : ''}&su=${su}&body=${body}`;
    if (url.length > 8000) {
      toast({ type: 'warning', message: 'Testo troppo lungo per Gmail: usa "Copia testo" e incollalo nella mail.' });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Lancia bonifico reale via A-Cube PSD2: raggruppa per banca, crea distinta + items,
  // chiama Edge Function acube-payment-send. Aggiorna payables come pagati e mostra
  // URL autorizzazione PSD2 da aprire sulla banca beneficiaria.
  const confirmPaymentsViaAcube = async () => {
    if (hasNegativeBalance || selectedIds.size === 0) return;

    // Raggruppa per banca; valida che ogni banca abbia acube_account_uuid
    type AcubeGroup = { bank: AnyRow; items: Array<{ payableId: string; plan: typeof paymentPlan[string]; payable: AnyRow }> };
    const groupsByBank = new Map<string, AcubeGroup>();
    const skipped: Array<{ invoice: string; reason: string }> = [];

    for (const id of selectedIds) {
      const plan = paymentPlan[id];
      const payable = payables.find(p => p.id === id);
      if (!plan || !payable || !plan.bankId) continue;
      const bank = bankAccounts.find(b => b.id === plan.bankId);
      if (!bank) continue;
      const acubeUuid = (bank as AnyRow & { acube_account_uuid?: string | null }).acube_account_uuid;
      if (!acubeUuid) {
        skipped.push({ invoice: payable.invoice_number || '—', reason: `Conto ${bank.bank_name} non collegato A-Cube` });
        continue;
      }
      const beneficiaryIban = (payable.suppliers as AnyRow | undefined)?.iban || (payable as AnyRow).supplier_iban || '';
      if (!beneficiaryIban) {
        skipped.push({ invoice: payable.invoice_number || '—', reason: 'IBAN beneficiario mancante' });
        continue;
      }
      const key = String(plan.bankId);
      if (!groupsByBank.has(key)) groupsByBank.set(key, { bank, items: [] });
      groupsByBank.get(key)!.items.push({ payableId: id, plan, payable });
    }

    if (groupsByBank.size === 0) {
      toast({ type: 'warning', message: 'Nessun pagamento eseguibile via A-Cube.\n\n' + (skipped.length > 0
        ? 'Motivi:\n' + skipped.map(s => `• ${s.invoice}: ${s.reason}`).join('\n')
        : 'Seleziona fatture con banca A-Cube collegata e IBAN beneficiario.') });
      return;
    }

    if (!(await askConfirm(`Lanciare ${Array.from(groupsByBank.values()).reduce((n, g) => n + g.items.length, 0)} bonifico/i via A-Cube su ${groupsByBank.size} banca/banche?\n\nVerrà generata 1 distinta per banca. Si apriranno gli URL di autorizzazione PSD2 da firmare sulla banca.`))) return;

    setIsSaving(true);
    const today_str = todayYMD();
    const allAuthorizeUrls: Array<{ batchNumber: string; bankName: string; url: string }> = [];
    const errors: string[] = [];

    try {
      for (const [, group] of groupsByBank) {
        const bank = group.bank;
        const totalGroup = group.items.reduce((s, it) => s + (it.plan.amount || 0), 0);
        const balanceBefore = Number(bank.current_balance) || 0;
        const batchNumber = `DIST-${today_str.replace(/-/g, '')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;

        // 1) crea payment_batch
        const { data: batch, error: batchErr } = await supabase.from('payment_batches').insert({
          company_id: COMPANY_ID,
          bank_account_id: bank.id,
          batch_number: batchNumber,
          status: 'draft',
          total_amount: totalGroup,
          payment_count: group.items.length,
          balance_before: balanceBefore,
        } as never).select().single();
        if (batchErr || !batch) {
          errors.push(`${bank.bank_name}: errore creazione distinta — ${batchErr?.message || 'sconosciuto'}`);
          continue;
        }
        const batchId = (batch as { id: string }).id;

        // 2) insert payment_batch_items (uno per fattura)
        const itemsPayload = group.items.map((it, idx) => {
          const beneficiaryIban = (it.payable.suppliers as AnyRow | undefined)?.iban || (it.payable as AnyRow).supplier_iban || '';
          const beneficiaryName = (it.payable.suppliers as AnyRow | undefined)?.ragione_sociale || (it.payable.suppliers as AnyRow | undefined)?.name || (it.payable as AnyRow).supplier_name || '—';
          return {
            batch_id: batchId,
            company_id: COMPANY_ID,
            payable_id: it.payableId,
            beneficiary_name: beneficiaryName,
            beneficiary_iban: beneficiaryIban,
            amount: it.plan.amount,
            currency: 'EUR',
            payment_reason: `Pag. fatt. ${it.payable.invoice_number || ''}`.trim(),
            invoice_number: it.payable.invoice_number,
            invoice_date: it.payable.invoice_date,
            due_date: it.payable.due_date,
            priority: idx + 1,
            status: 'pending',
          };
        });
        const { error: itemsErr } = await supabase.from('payment_batch_items').insert(itemsPayload as never);
        if (itemsErr) {
          errors.push(`${bank.bank_name}: errore inserimento righe — ${itemsErr.message}`);
          continue;
        }

        // 3) UPDATE payable + audit (status pagato/parziale, banca per riconciliazione/prima nota)
        for (const it of group.items) {
          const newPaid = (Number(it.payable.amount_paid) || 0) + it.plan.amount;
          const newStatus = it.plan.type === 'saldo' ? 'pagato' : 'parziale';
          await supabase.from('payables').update({
            amount_paid: newPaid,
            amount_remaining: (Number(it.payable.gross_amount) ?? 0) - newPaid,
            payment_date: today_str,
            payment_bank_account_id: bank.id,
            status: newStatus,
          } as never).eq('id', it.payableId);
          await supabase.from('payable_actions').insert({
            payable_id: it.payableId,
            action_type: newStatus === 'pagato' ? 'pagamento' : 'pagamento_parziale',
            old_status: it.payable.status,
            new_status: newStatus,
            amount: it.plan.amount,
            bank_account_id: bank.id,
            note: `Pagamento via A-Cube PSD2 — distinta ${batchNumber}`,
          } as never);
        }

        // 4) chiama Edge Function acube-payment-send
        const { data: fnData, error: fnErr } = await supabase.functions.invoke('acube-payment-send', { body: { batch_id: batchId, stage: 'sandbox' } });
        if (fnErr) {
          errors.push(`${bank.bank_name} (distinta ${batchNumber}): A-Cube error — ${fnErr.message}`);
          continue;
        }
        const fnResult = fnData as { initiated?: number; failed?: number; items?: Array<{ acube_authorize_url?: string; error?: string }> };
        if ((fnResult.failed ?? 0) > 0) {
          const itemErrs = (fnResult.items || []).filter(i => i.error).map(i => i.error).join('; ');
          errors.push(`${bank.bank_name} (distinta ${batchNumber}): ${fnResult.failed} item falliti — ${itemErrs}`);
        }
        // raccogli URL autorizzazione PSD2
        (fnResult.items || []).forEach(it => {
          if (it.acube_authorize_url) allAuthorizeUrls.push({ batchNumber, bankName: bank.bank_name || '', url: it.acube_authorize_url });
        });
      }

      // Apri tutte le URL autorizzazione PSD2 (1 tab per fattura)
      allAuthorizeUrls.forEach(u => window.open(u.url, '_blank'));

      // Recap finale
      const recap =
        `✅ Distinte create: ${groupsByBank.size}\n` +
        `🔗 URL PSD2 aperti: ${allAuthorizeUrls.length}\n` +
        (skipped.length > 0 ? `\n⚠️ Saltati ${skipped.length}:\n${skipped.map(s => `• ${s.invoice}: ${s.reason}`).join('\n')}\n` : '') +
        (errors.length > 0 ? `\n❌ Errori:\n${errors.join('\n')}` : '');
      toast({ type: 'info', message: recap });

      setSelectedIds(new Set());
      setPaymentPlan({});
      setIsSaving(false);
      fetchData();
    } catch (error) {
      console.error('Error confirming payments via A-Cube:', error);
      toast({ type: 'error', message: 'Errore inatteso: ' + (error instanceof Error ? error.message : String(error)) });
      setIsSaving(false);
    }
  };

  // Per il bottone "Paga via A-Cube" del bottom-sheet: serve almeno una banca selezionata
  // con acube_account_uuid valorizzato.
  const someSelectedBankIsAcube = useMemo(() => {
    for (const id of selectedIds) {
      const plan = paymentPlan[id];
      if (!plan?.bankId) continue;
      const bank = bankAccounts.find(b => b.id === plan.bankId);
      if (bank && (bank as AnyRow & { acube_account_uuid?: string | null }).acube_account_uuid) return true;
    }
    return false;
  }, [selectedIds, paymentPlan, bankAccounts]);

  // Sibill-style sub-tab counts
  const tabCounts = useMemo(() => {
    const all = payables || [];
    return {
      tutte: filteredPayables.length,
      scadute: filteredPayables.filter(p => p.status === 'scaduto').length,
      da_saldare: filteredPayables.filter(p => p.status !== 'pagato' && p.status !== 'annullato').length,
      saldate: filteredPayables.filter(p => p.status === 'pagato').length,
      in_distinta: filteredPayables.filter(p => !!p.disposizione_date && p.status !== 'pagato' && p.status !== 'annullato').length,
    };
  }, [filteredPayables, payables]);

  // Quando l'utente sceglie il tipo "Incassi" carico i movimenti in entrata
  // (tabella dedicata) e azzero i filtri tipici dei pagamenti, che non si
  // applicano agli incassi. Nessun filtro resta attivo in modo invisibile.
  useEffect(() => {
    if (typeFilter === 'incassi') {
      loadBankIncomes();
      setSelectedStatus('');
      setSelectedMethodGroup(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  // ── SCADENZE-STIMA da ricorrenza (on-the-fly, orizzonte 12 mesi mobili) ──
  // Genera occorrenze previste per ogni ricorrenza attiva, SENZA materializzare
  // righe nel DB. Riconciliazione VISIVA (no-data-loss): se per lo stesso
  // fornitore+mese esiste già una fattura reale entro tolleranza, la stima è
  // "coperta" e non viene mostrata (la reale conta una volta sola, niente doppi
  // nel totale né nel cashflow). Se esiste una reale stesso fornitore+mese ma
  // con importo fuori tolleranza, la stima resta visibile con indicatore
  // "possibile corrispondenza" (l'utente decide, niente azioni automatiche).
  const estimateRows = useMemo<AnyRow[]>(() => {
    if (!recurringCosts.length) return [];
    // Indice fatture reali (non stime, non annullate/nota credito) per
    // fornitore-normalizzato|YYYY-MM → importi lordi.
    const realIndex = new Map<string, number[]>();
    payables.forEach(p => {
      if (p._isEstimate) return;
      if (p.status === 'annullato' || p.status === 'nota_credito') return;
      const d = p.due_date ? new Date(String(p.due_date)) : null;
      if (!d || isNaN(d.getTime())) return;
      const name = normSupplier((p.suppliers?.ragione_sociale || p.suppliers?.name || p.supplier_name) as string);
      if (!name) return;
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const key = `${name}|${ym}`;
      (realIndex.get(key) || realIndex.set(key, []).get(key)!).push(Number(p.gross_amount) || 0);
    });

    const now = new Date();
    const curIdx = now.getFullYear() * 12 + now.getMonth();
    const horizonIdx = curIdx + ESTIMATE_HORIZON_MONTHS;
    const out: AnyRow[] = [];

    recurringCosts.forEach(rc => {
      if (rc.is_active === false) return;
      const amount = Number(rc.amount) || 0;
      if (!(amount > 0)) return;
      const step = RECURRENCE_STEP_MONTHS[String(rc.frequency)] || 1;
      const day = Math.min(28, Math.max(1, Number(rc.day_of_month) || 1));
      const supplierName = (rc.supplier_name || rc.description || 'Ricorrenza') as string;
      const nName = normSupplier(supplierName);
      const sd = rc.start_date ? new Date(String(rc.start_date)) : null;
      const ed = rc.end_date ? new Date(String(rc.end_date)) : null;
      const anchorIdx = sd && !isNaN(sd.getTime()) ? sd.getFullYear() * 12 + sd.getMonth() : curIdx;
      const endIdx = ed && !isNaN(ed.getTime()) ? ed.getFullYear() * 12 + ed.getMonth() : Infinity;

      for (let mi = curIdx; mi <= Math.min(horizonIdx, endIdx); mi++) {
        if (mi < anchorIdx) continue;
        if ((mi - anchorIdx) % step !== 0) continue;
        const y = Math.floor(mi / 12);
        const m = mi % 12;
        const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
        const reals = realIndex.get(`${nName}|${ym}`);
        let possibleMatch = false;
        if (reals && reals.length) {
          const covered = reals.some(a => Math.abs(a - amount) <= Math.max(amount * ESTIMATE_MATCH_TOLERANCE_PCT, ESTIMATE_MATCH_TOLERANCE_ABS));
          if (covered) continue; // coperta dalla fattura reale → non mostrare
          possibleMatch = true;  // stessa voce ma importo diverso → segnala
        }
        out.push({
          id: `est_${rc.id}_${ym}`,
          _isEstimate: true,
          _possibleMatch: possibleMatch,
          _recurringId: rc.id,
          invoice_number: '',
          due_date: `${ym}-${String(day).padStart(2, '0')}`,
          original_due_date: `${ym}-${String(day).padStart(2, '0')}`,
          gross_amount: amount,
          amount_paid: 0,
          amount_remaining: amount,
          status: 'stima',
          payment_method: (rc.payment_method as string) || 'bonifico',
          suppliers: { name: supplierName, ragione_sociale: supplierName, category: 'ricorrente' },
          notes: (rc.description as string) || '',
          cost_center: (rc.cost_center as string) || '',
          supplier_id: null,
          days_to_due: null,
          urgency: null,
        } as AnyRow);
      }
    });
    return out;
  }, [recurringCosts, payables]);

  const displayPayables = useMemo(() => {
    // Vista default "Aperte" (selectedStatus=''): nascondi le pagate. Le pagate
    // compaiono SOLO se l'utente filtra esplicitamente 'Pagato' oppure sceglie
    // "Tutti gli stati" ('all'), che mostra davvero tutto incluse le pagate.
    // Tutto il resto (tipo, stato, periodo, ricerca) è già in filteredPayables.
    const reals = filteredPayables.filter(p => {
      // Viste "chiuse/tutte" o filtro esplicito NC → mostra tutto (incluse le chiuse).
      if (selectedStatus === 'pagato' || selectedStatus === 'all' || selectedStatus === 'nota_credito') return true;
      // Fatture "in distinta" (disposte, in attesa di riscontro bancario): sono IN SOSPESO
      // e vanno tolte dalla lista attiva dello scadenzario. Si vedono solo nella vista
      // dedicata "In sospeso" (selectedStatus='in_distinta'). Lo stato DB resta invariato
      // (da_pagare/scaduto) così il motore di riconciliazione le aggancia comunque.
      const isInDistinta = !!p.disposizione_date && p.status !== 'pagato' && p.status !== 'annullato';
      if (isInDistinta && selectedStatus !== 'in_distinta') return false;
      // Pagate nascoste di default.
      if (p.status === 'pagato') return false;
      // NC CHIUSA a mano (registrata in partitario): esce dalle Aperte come una pagata,
      // altrimenti resterebbe visibile perche' mantiene status 'nota_credito'.
      const isNC = p.status === 'nota_credito' || (Number(p.gross_amount) || 0) < 0;
      if (isNC && (p.closed_manually || p.payment_date)) return false;
      return true;
    });

    // Le STIME compaiono solo nella vista scadenze "fornitori/tutte", senza un
    // filtro di stato reale attivo (non sono scaduto/pagato/in distinta), e
    // rispettano gli stessi filtri ricerca/periodo/metodo/outlet.
    const showEstimates = (typeFilter === '' || typeFilter === 'fornitori') && !selectedStatus && !selectedOutlet;
    if (!showEstimates || !estimateRows.length) return reals;

    const q = searchTerm.trim().toLowerCase();
    const startD = dateRange.start ? new Date(dateRange.start) : null;
    const endD = dateRange.end ? new Date(dateRange.end) : null;
    const methodSet = selectedMethodGroup ? new Set(paymentGroups.find(g => g.key === selectedMethodGroup)?.methods || []) : null;
    const estimates = estimateRows.filter(e => {
      if (q) {
        const hay = `${e.suppliers?.ragione_sociale || ''} ${e.suppliers?.name || ''} ${e.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const d = e.due_date ? new Date(String(e.due_date)) : null;
      if (d && !isNaN(d.getTime())) {
        if (startD && !isNaN(startD.getTime()) && d < startD) return false;
        if (endD && !isNaN(endD.getTime()) && d > endD) return false;
      }
      if (methodSet && !methodSet.has(String(e.payment_method))) return false;
      return true;
    });
    return [...reals, ...estimates];
  }, [filteredPayables, selectedStatus, estimateRows, typeFilter, selectedOutlet, searchTerm, dateRange, selectedMethodGroup]);

  // Ordinamento tabella scadenze (modello standard SortableTh + useTableSort).
  // Default: scadenza piu' vecchia in cima. Persistente tra refresh per
  // questa pagina. Reset automatico al cambio tipo/stato.
  const { sorted: sortedDisplayPayables, sortBy: sortByPayables, onSort: onSortPayables, reset: resetPayablesSort } = useTableSort(
    displayPayables,
    [{ key: 'due_date', dir: 'asc' }],
    { persistKey: 'scadenzario_payables', resetOn: [typeFilter, selectedStatus] }
  );

  // Aging analysis
  type AgingBucket = '0-30' | '31-60' | '61-90' | '90+'
  const agingAnalysis = useMemo(() => {
    const buckets: Record<AgingBucket, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    displayPayables.forEach((p) => {
      if (!p.due_date) return;
      const diff = Math.floor((today.getTime() - new Date(p.due_date).getTime()) / (1000 * 60 * 60 * 24));
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
  type Group = { items: AnyRow[]; total: number; paid: number; remaining: number; label?: string }
  const groupedBySupplier = useMemo(() => {
    const groups: Record<string, Group> = {};
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
    const groups: Record<string, Group> = {};
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

  // Toggle collasso di una sezione-mese.
  const toggleMonth = useCallback((key: string) => {
    setCollapsedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Lista "appiattita" per il render: sezioni-mese (header) + righe, in ordine
  // cronologico (inclusi mesi passati con scaduto). I mesi derivano dai dati,
  // niente anni/mesi hardcoded. 'N/D' (senza data) va in fondo. Se un mese è
  // collassato, le sue righe non vengono emesse (resta solo l'header con
  // subtotale e conteggio).
  // Ordinamento DENTRO al mese: di default le righe sono raggruppate per
  // FORNITORE in ordine alfabetico (aggregato). A parità di fornitore si
  // ordina dalla fattura più vecchia: prima per DATA DI EMISSIONE fattura
  // (invoice_date) crescente, poi per NUMERO FATTURA (ordinamento numerico
  // naturale) crescente, infine per data di scadenza. Se l'utente attiva un
  // ordinamento personalizzato dalle colonne (SortableTh), quello ha la
  // precedenza e le righe seguono l'ordine globale della tabella.
  // Subtotale/conteggio del mese tengono SEPARATE le scadenze reali dalle
  // STIME (azzurre): il subtotale "da saldare" resta reale, le stime sono un
  // di-cui previsionale a parte. Niente somma reale+stima.
  type MonthRenderItem =
    | { kind: 'header'; key: string; label: string; count: number; subtotal: number; estimateCount: number; estimateSubtotal: number; collapsed: boolean }
    | { kind: 'row'; p: AnyRow };
  // Nome fornitore normalizzato per l'ordinamento alfabetico (vuoto in fondo).
  const supplierSortName = (p: AnyRow): string =>
    ((p.suppliers?.ragione_sociale || p.suppliers?.name || '') as string).trim().toLowerCase() || '￿';
  const monthRenderItems = useMemo<MonthRenderItem[]>(() => {
    // Il default della vista Mese è: scadenza più vecchia in cima (due_date asc,
    // criterio unico). Solo in quel caso applichiamo l'aggregazione alfabetica
    // per fornitore dentro ogni mese; con un sort personalizzato la rispettiamo.
    const isDefaultSort = sortByPayables.length === 1
      && sortByPayables[0].key === 'due_date'
      && sortByPayables[0].dir === 'asc';
    const map = new Map<string, { key: string; label: string; items: AnyRow[]; subtotal: number; estimateCount: number; estimateSubtotal: number }>();
    sortedDisplayPayables.forEach(p => {
      const d = p.due_date ? new Date(p.due_date) : null;
      const valid = d && !isNaN(d.getTime());
      const key = valid ? `${d!.getFullYear()}-${String(d!.getMonth() + 1).padStart(2, '0')}` : 'N/D';
      const label = valid ? d!.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : 'Senza data';
      if (!map.has(key)) map.set(key, { key, label, items: [], subtotal: 0, estimateCount: 0, estimateSubtotal: 0 });
      const g = map.get(key)!;
      g.items.push(p);
      if (p._isEstimate) { g.estimateCount += 1; g.estimateSubtotal += p.amount_remaining || 0; }
      else g.subtotal += p.amount_remaining || 0;
    });
    const keys = Array.from(map.keys()).sort((a, b) => (a === 'N/D' ? 1 : b === 'N/D' ? -1 : a.localeCompare(b)));
    const out: MonthRenderItem[] = [];
    keys.forEach(k => {
      const g = map.get(k)!;
      const collapsed = collapsedMonths.has(k);
      out.push({ kind: 'header', key: k, label: g.label, count: g.items.length - g.estimateCount, subtotal: g.subtotal, estimateCount: g.estimateCount, estimateSubtotal: g.estimateSubtotal, collapsed });
      if (!collapsed) {
        // Con l'ordinamento di default: dentro il mese ordina per fornitore
        // (alfabetico, aggregato); a parità di fornitore dalla fattura più
        // vecchia (data emissione, poi numero fattura, poi scadenza).
        const rows = isDefaultSort
          ? [...g.items].sort((a, b) => {
              const byName = supplierSortName(a).localeCompare(supplierSortName(b), 'it');
              if (byName !== 0) return byName;
              // Data di emissione fattura crescente (più vecchia in alto).
              const ia = a.invoice_date ? new Date(a.invoice_date).getTime() : Infinity;
              const ib = b.invoice_date ? new Date(b.invoice_date).getTime() : Infinity;
              if (ia !== ib) return ia - ib;
              // Numero fattura crescente, con ordinamento numerico naturale
              // (es. "2" prima di "10"). I valori vuoti/"-" vanno in fondo.
              const na = (a.invoice_number || '').trim() || '￿';
              const nb = (b.invoice_number || '').trim() || '￿';
              const byNum = na.localeCompare(nb, 'it', { numeric: true, sensitivity: 'base' });
              if (byNum !== 0) return byNum;
              // Ultimo criterio: data di scadenza crescente.
              const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
              const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
              return da - db;
            })
          : g.items;
        rows.forEach(p => out.push({ kind: 'row', p }));
      }
    });
    return out;
  }, [sortedDisplayPayables, collapsedMonths, sortByPayables]);

  // ===== INCASSI — stessa pipeline dei pagamenti, dataset bankIncomes =====
  // Filtri unificati: ricerca (descrizione/importo) + banca + periodo. Niente
  // filtro "tipo incasso" separato (era la barra parallela da eliminare).
  const filteredIncomes = useMemo(() => {
    const q = (searchTerm || '').toLowerCase();
    const from = dateRange.start ? new Date(dateRange.start) : null;
    const to = dateRange.end ? new Date(dateRange.end) : null;
    return bankIncomes.filter(i => {
      if (q && !(i.description || '').toLowerCase().includes(q) && !String(i.amount).includes(q)) return false;
      if (incomeBankFilter !== 'all' && i.bank_account_id !== incomeBankFilter) return false;
      const d = i.transaction_date ? new Date(String(i.transaction_date)) : null;
      if (from && d && d < from) return false;
      if (to && d && d > to) return false;
      return true;
    });
  }, [bankIncomes, searchTerm, incomeBankFilter, dateRange]);

  // Ordine cronologico ascendente per data incasso (come i pagamenti).
  const sortedIncomes = useMemo(() => {
    return [...filteredIncomes].sort((a, b) =>
      new Date(String(a.transaction_date || 0)).getTime() - new Date(String(b.transaction_date || 0)).getTime());
  }, [filteredIncomes]);

  const incomesTotal = useMemo(() => filteredIncomes.reduce((s, i) => s + (Number(i.amount) || 0), 0), [filteredIncomes]);

  const toggleIncomeMonth = useCallback((key: string) => {
    setCollapsedIncomeMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Sezioni-mese (header + righe appiattiti) per gli incassi, ordine cronologico,
  // 'N/D' in fondo. Mesi derivati dai dati. Collassabili via collapsedIncomeMonths.
  type IncomeRenderItem =
    | { kind: 'header'; key: string; label: string; count: number; subtotal: number; collapsed: boolean }
    | { kind: 'row'; i: AnyRow };
  const incomeMonthRenderItems = useMemo<IncomeRenderItem[]>(() => {
    const map = new Map<string, { key: string; label: string; items: AnyRow[]; subtotal: number }>();
    sortedIncomes.forEach(i => {
      const d = i.transaction_date ? new Date(String(i.transaction_date)) : null;
      const valid = d && !isNaN(d.getTime());
      const key = valid ? `${d!.getFullYear()}-${String(d!.getMonth() + 1).padStart(2, '0')}` : 'N/D';
      const label = valid ? d!.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : 'Senza data';
      if (!map.has(key)) map.set(key, { key, label, items: [], subtotal: 0 });
      const g = map.get(key)!;
      g.items.push(i);
      g.subtotal += Number(i.amount) || 0;
    });
    const keys = Array.from(map.keys()).sort((a, b) => (a === 'N/D' ? 1 : b === 'N/D' ? -1 : a.localeCompare(b)));
    const out: IncomeRenderItem[] = [];
    keys.forEach(k => {
      const g = map.get(k)!;
      const collapsed = collapsedIncomeMonths.has(k);
      out.push({ kind: 'header', key: k, label: g.label, count: g.items.length, subtotal: g.subtotal, collapsed });
      if (!collapsed) g.items.forEach(i => out.push({ kind: 'row', i }));
    });
    return out;
  }, [sortedIncomes, collapsedIncomeMonths]);

  if (loading) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto flex items-center justify-center min-h-screen">
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
        {/* flex-wrap + gap ridotti: su 360-430px la barra si impila invece di
            forzare lo scroll orizzontale dell'intera pagina. */}
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-3 sm:gap-8 min-w-0">
            <h1 className="text-base font-bold text-slate-800 tracking-tight">Scadenze</h1>
            {/* Tab principali: Situazione | Scadenzario | Ricorrenze.
                La tab 'Regole (Coming soon)' è stata rimossa: niente elementi
                morti cliccabili che confondono Sabrina/Veronica. */}
            <div className="flex gap-1 overflow-x-auto">
              {([
                { key: 'situazione', label: 'Situazione' },
                { key: 'scadenze', label: 'Scadenzario' },
                { key: 'ricorrenti', label: 'Ricorrenze' },
              ] as { key: ScadenzarioSection; label: string }[]).map(t => (
                <button
                  key={t.key}
                  onClick={() => setSection(t.key)}
                  className={`shrink-0 px-3 sm:px-4 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 ${
                    section === t.key
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Il filtro TIPO (Tutte/Fornitori/Fiscali/Incassi) vive ora nella
                barra filtri unificata sotto, con chip removibile: niente più
                asse-tipo duplicato e invisibile qui in alto. */}
            <ExportMenu
              /* Esporta ESATTAMENTE le righe visibili nello Scadenzario: le
                 scadenze APERTE (payables non pagate/annullate/note credito +
                 F24 aperte, via displayPayables) rispettando i filtri attivi a
                 video (tipo/stato/fornitore/date/ricerca). Esclude le STIME
                 previsionali (_isEstimate) e lo storico/pagato. Niente colonna
                 Descrizione. Multi-tenant: i dati sono già caricati per
                 company_id corrente. */
              data={sortedDisplayPayables.filter(p => !p._isEstimate).map(p => ({
                scadenza: p.due_date,
                fornitore: p.suppliers?.ragione_sociale || p.suppliers?.name || '—',
                fattura: (p.invoice_number && p.invoice_number !== '-') ? p.invoice_number : '',
                importo: p.gross_amount,
                residuo: p.amount_remaining,
                stato: (statusConfig as Record<string, { label?: string }>)[p.status || '']?.label || p.status,
                categoria: ((categories.find(c => c.id === p.cost_category_id)?.name as string | undefined) || (p.cost_center as string | null) || '—'),
              }))}
              columns={[
                { key: 'scadenza', label: 'Scadenza', format: 'date' },
                { key: 'fornitore', label: 'Fornitore' },
                { key: 'fattura', label: 'NR fattura' },
                { key: 'importo', label: 'Importo', format: 'euro' },
                { key: 'residuo', label: 'Residuo', format: 'euro' },
                { key: 'stato', label: 'Stato' },
                { key: 'categoria', label: 'Categoria/Conto' },
              ]}
              filename="scadenzario-aperte"
              title="Scadenzario — scadenze aperte"
            />
            <button onClick={() => setModals({ ...modals, invoice: { open: true, data: null } })}
              className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition font-medium">
              <Plus size={13} /> <span className="hidden sm:inline">Aggiungi scadenza</span><span className="sm:hidden">Aggiungi</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-5 space-y-4">

      {/* ===== TAB SITUAZIONE — riepilogo come Sibill ===== */}
      {section === 'situazione' && (
        <SituazioneTab
          kpis={kpis}
          displayPayables={displayPayables}
          cashPosition={cashPosition}
          onGoToScadenze={() => setSection('scadenze')}
        />
      )}

      {section === 'ricorrenti' ? (
        <CostiRicorrenti />
      ) : section === 'scadenze' ? (
        <>
          {/* ===== BARRA FILTRI UNIFICATA =====
              Vista default = "Tutte le scadenze". Tutti i filtri sono OPZIONALI
              e li sceglie l'utente: nessun asse-tipo o sotto-tab resta attivo in
              modo invisibile. Ogni filtro attivo compare come chip removibile
              sotto (vedi blocco "chip"). */}
          {typeFilter !== 'incassi' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-[240px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
              <input type="text" placeholder="Cerca fornitore, fattura, nota…" value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40 focus:border-blue-300 bg-white placeholder:text-slate-300" />
            </div>
            {/* TIPO */}
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-600"
              title="Tipo di scadenza">
              <option value="">Tutte le scadenze</option>
              <option value="fornitori">Solo Fornitori</option>
              <option value="fiscali">Solo Fiscali / Interni</option>
              <option value="incassi">Incassi</option>
            </select>
            {/* STATO (include In distinta come stato) */}
            <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-600"
              title="Stato della scadenza">
              <option value="">Aperte</option>
              <option value="all">Tutti gli stati</option>
              <option value="scaduto">Scaduto</option>
              <option value="in_scadenza">In scadenza</option>
              <option value="da_pagare">Da pagare</option>
              <option value="parziale">Parziale</option>
              <option value="pagato">Pagato</option>
              <option value="in_distinta">In sospeso (in attesa di riscontro)</option>
              <option value="sospeso">Sospeso</option>
              <option value="rimandato">Rimandato</option>
              <option value="annullato">Annullato</option>
            </select>
            {/* Accesso rapido "In sospeso": le fatture disposte in distinta sono tolte dalla
                lista attiva; questo pill le richiama (o torna alle Aperte se già attivo). */}
            {suspendedInfo.count > 0 && (
              <button
                onClick={() => setSelectedStatus(selectedStatus === 'in_distinta' ? '' : 'in_distinta')}
                title="Fatture disposte in distinta, in attesa di riscontro sul movimento bancario"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${selectedStatus === 'in_distinta' ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}>
                <Clock size={12} />
                In sospeso: {suspendedInfo.count} ({fmt(suspendedInfo.total)} €)
              </button>
            )}
            <input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-500" title="Periodo: da" />
            <input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-500" title="Periodo: a" />
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

          {/* ===== BARRA FILTRI UNIFICATA — INCASSI =====
              Stessa barra dei pagamenti: ricerca + Tipo (per tornare alle
              scadenze) + Banca + periodo. Niente seconda barra parallela; i
              filtri attivi compaiono come chip removibili sotto. */}
          {typeFilter === 'incassi' && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px] max-w-[240px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                <input type="text" placeholder="Cerca descrizione, importo…" value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40 focus:border-blue-300 bg-white placeholder:text-slate-300" />
              </div>
              {/* TIPO */}
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-600"
                title="Tipo di scadenza">
                <option value="">Tutte le scadenze</option>
                <option value="fornitori">Solo Fornitori</option>
                <option value="fiscali">Solo Fiscali / Interni</option>
                <option value="incassi">Incassi</option>
              </select>
              {/* BANCA */}
              <select value={incomeBankFilter} onChange={e => setIncomeBankFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-600"
                title="Filtra per banca">
                <option value="all">Tutte le banche</option>
                {(bankAccounts || []).map(b => (
                  <option key={b.id} value={b.id}>{b.bank_name}{b.account_name ? ` — ${b.account_name}` : ''}</option>
                ))}
              </select>
              <input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-500" title="Periodo: da" />
              <input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-500" title="Periodo: a" />
            </div>
          )}

          {/* ===== CHIP FILTRI ATTIVI — INCASSI (removibili) ===== */}
          {typeFilter === 'incassi' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400 font-medium">Stai vedendo:</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 text-xs text-indigo-700 font-medium">
                Incassi
                <button onClick={() => setTypeFilter('')} className="text-indigo-400 hover:text-indigo-600"><X size={11} /></button>
              </span>
              {incomeBankFilter !== 'all' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600">
                  {(() => { const b = (bankAccounts || []).find(x => String(x.id) === String(incomeBankFilter)); return b ? String(b.bank_name || 'Banca') : 'Banca'; })()}
                  <button onClick={() => setIncomeBankFilter('all')} className="text-slate-400 hover:text-slate-600"><X size={11} /></button>
                </span>
              )}
              {(dateRange.start || dateRange.end) && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600">
                  Periodo {dateRange.start ? `da ${fmtDate(dateRange.start)}` : ''}{dateRange.end ? ` a ${fmtDate(dateRange.end)}` : ''}
                  <button onClick={() => setDateRange({ start: '', end: '' })} className="text-slate-400 hover:text-slate-600"><X size={11} /></button>
                </span>
              )}
              {searchTerm && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600">
                  "{searchTerm}" <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600"><X size={11} /></button>
                </span>
              )}
              {(searchTerm || incomeBankFilter !== 'all' || dateRange.start || dateRange.end) && (
                <button onClick={() => { setSearchTerm(''); setIncomeBankFilter('all'); setDateRange({ start: '', end: '' }); }}
                  className="text-xs text-red-500 hover:text-red-600 font-medium">
                  Rimuovi tutti i filtri
                </button>
              )}
            </div>
          )}

          {/* ===== TOTALE DA INCASSARE (coerente col filtro) + vista ===== */}
          {typeFilter === 'incassi' && !bankIncomesLoading && bankIncomes.length > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-2 border-y border-slate-100 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Totale da incassare</span>
              <span className="text-xl font-bold text-slate-900">{fmt(incomesTotal)} €</span>
              <span className="text-sm text-slate-400">· {filteredIncomes.length} incass{filteredIncomes.length === 1 ? 'o' : 'i'}</span>
            </div>
            {/* Vista: Mese (default) | Lista piatta | Calendario */}
            <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
              <button onClick={() => { setScadViewMode('lista'); setListLayout('mese'); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  scadViewMode === 'lista' && listLayout === 'mese' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                <CalendarDays size={13} /> Mese
              </button>
              <button onClick={() => { setScadViewMode('lista'); setListLayout('lista'); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  scadViewMode === 'lista' && listLayout === 'lista' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                <List size={13} /> Lista piatta
              </button>
              <button onClick={() => setScadViewMode('calendario')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  scadViewMode === 'calendario' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                <Calendar size={13} /> Calendario
              </button>
            </div>
          </div>
          )}

          {/* ===== CHIP FILTRI ATTIVI — removibili =====
              "Stai vedendo:" rende esplicito ogni filtro attivo. Nessun filtro
              deve restare attivo in modo invisibile. */}
          {typeFilter !== 'incassi' && (typeFilter || searchTerm || selectedStatus || selectedMethodGroup || dateRange.start || dateRange.end) && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400 font-medium">Stai vedendo:</span>
              {typeFilter && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 text-xs text-indigo-700 font-medium">
                  {typeFilter === 'fornitori' ? 'Solo Fornitori' : typeFilter === 'fiscali' ? 'Solo Fiscali / Interni' : typeFilter}
                  <button onClick={() => setTypeFilter('')} className="text-indigo-400 hover:text-indigo-600"><X size={11} /></button>
                </span>
              )}
              {selectedStatus && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600">
                  {selectedStatus === 'in_distinta' ? 'In sospeso' : ((statusConfig as Record<string, { label?: string }>)[selectedStatus]?.label || selectedStatus)} <button onClick={() => setSelectedStatus('')} className="text-slate-400 hover:text-slate-600"><X size={11} /></button>
                </span>
              )}
              {(dateRange.start || dateRange.end) && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600">
                  Periodo {dateRange.start ? `da ${fmtDate(dateRange.start)}` : ''}{dateRange.end ? ` a ${fmtDate(dateRange.end)}` : ''}
                  <button onClick={() => setDateRange({ start: '', end: '' })} className="text-slate-400 hover:text-slate-600"><X size={11} /></button>
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
              <button onClick={() => { setTypeFilter(''); setSearchTerm(''); setSelectedStatus(''); setSelectedMethodGroup(null); setDateRange({ start: '', end: '' }); }}
                className="text-xs text-red-500 hover:text-red-600 font-medium">
                Rimuovi tutti i filtri
              </button>
            </div>
          )}

          {/* ===== BANNER "IN SOSPESO" — spiega lo stato e come chiudere ===== */}
          {selectedStatus === 'in_distinta' && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <Clock size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <div className="font-semibold">Fatture in sospeso — in attesa di riscontro bancario</div>
                <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                  Disposte in distinta e tolte dallo scadenzario attivo. Si chiudono da sole quando il
                  movimento bancario viene riconciliato. Se il bonifico non trova riscontro (causale non
                  riconosciuta, o importo netto per note di credito) puoi abbinarlo a mano dalla
                  <Link to="/banche?tab=riconciliazione" className="font-semibold underline mx-1 hover:text-amber-900">Riconciliazione</Link>
                  senza creare doppioni, oppure chiudere la fattura a mano (data + banca) qui sotto con «Chiudi a mano».
                </p>
              </div>
            </div>
          )}

          {/* ===== TOTALE (sempre visibile, coerente col filtro) + vista ===== */}
          {typeFilter !== 'incassi' && (
          <div className="flex items-center justify-between flex-wrap gap-2 border-y border-slate-100 py-2.5">
            {/* Totale "da saldare" = UN unico numero che include reali + stime
                ricorrenti previste (decisione post-#200). Le stime restano azzurre
                nelle righe; qui sotto al totale una nota discreta indica quanta
                parte è stimata. Le stime coperte da fattura reale sono già escluse
                (riconciliazione #200) → niente doppio conteggio. */}
            {(() => {
              const reals = displayPayables.filter(p => !p._isEstimate);
              const estimates = displayPayables.filter(p => p._isEstimate);
              const estTot = estimates.reduce((s, p) => s + (p.amount_remaining || 0), 0);
              const total = displayPayables.reduce((s, p) => s + (p.amount_remaining || 0), 0);
              const count = reals.length + estimates.length;
              return (
                <div className="flex flex-col">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Totale da saldare</span>
                    <span className="text-xl font-bold text-slate-900">{fmt(total)} €</span>
                    <span className="text-sm text-slate-400">· {count} scadenz{count === 1 ? 'a' : 'e'}</span>
                  </div>
                  {estimates.length > 0 && (
                    <span className="text-[11px] text-sky-600 mt-0.5">include ≈ {fmt(estTot)} € di ricorrenti previste ({estimates.length} stim{estimates.length === 1 ? 'a' : 'e'})</span>
                  )}
                </div>
              );
            })()}
            {/* Vista: Mese (default) | Lista piatta | Calendario */}
            <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
              <button onClick={() => { setScadViewMode('lista'); setListLayout('mese'); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  scadViewMode === 'lista' && listLayout === 'mese' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                <CalendarDays size={13} /> Mese
              </button>
              <button onClick={() => { setScadViewMode('lista'); setListLayout('lista'); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  scadViewMode === 'lista' && listLayout === 'lista' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                <List size={13} /> Lista piatta
              </button>
              <button onClick={() => setScadViewMode('calendario')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  scadViewMode === 'calendario' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                <Calendar size={13} /> Calendario
              </button>
            </div>
          </div>
          )}

          {/* ===== CALENDARIO VIEW ===== */}
          {scadViewMode === 'calendario' && typeFilter !== 'incassi' && (() => {
            const year = calendarMonth.getFullYear();
            const month = calendarMonth.getMonth();
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            // Monday=0 ... Sunday=6 (ISO week)
            const startDow = (firstDay.getDay() + 6) % 7;
            const daysInMonth = lastDay.getDate();

            // Build a map: day number -> array of payables
            const dayMap: Record<number, AnyRow[]> = {};
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
            const dotColor = (p: AnyRow) => {
              if (p._isEstimate) return 'bg-sky-400'; // stima da ricorrenza
              if (p.status === 'scaduto') return 'bg-red-500';
              if (p.status === 'in_scadenza') return 'bg-amber-500';
              if (p.status === 'pagato') return 'bg-emerald-500';
              return 'bg-blue-500'; // da_pagare, parziale, etc.
            };

            // Build grid cells: leading blanks + days
            const cells: (number | null)[] = [];
            for (let i = 0; i < startDow; i++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(d);

            const todayDate = new Date();
            const isToday = (day: number | null) => day != null && todayDate.getFullYear() === year && todayDate.getMonth() === month && todayDate.getDate() === day;

            const monthLabel = calendarMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

            // Payables for selected day
            const selectedDayPayables = selectedCalendarDay && dayMap[selectedCalendarDay] ? dayMap[selectedCalendarDay] : [];

            return (
              <div className="space-y-4">
                {/* Month navigation */}
                <div className="flex items-center justify-between">
                  <button onClick={() => setCalendarMonth(new Date(year, month - 1, 1))}
                    title="Mese precedente"
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition">
                    <ChevronLeft size={18} />
                  </button>
                  <h3 className="text-sm font-semibold text-slate-800 capitalize">{monthLabel}</h3>
                  <button onClick={() => setCalendarMonth(new Date(year, month + 1, 1))}
                    title="Mese successivo"
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
                                  {items.slice(0, 4).map((p: AnyRow, i: number) => (
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
                        {selectedDayPayables.map((p: AnyRow) => (
                          <div key={p.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/50">
                            <div className="flex items-center gap-3">
                              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor(p)}`} />
                              <div>
                                <UiTooltip content={p.suppliers?.ragione_sociale || p.suppliers?.name || ''}><div className="text-sm font-medium text-slate-800 truncate max-w-[280px]">{p.suppliers?.ragione_sociale || p.suppliers?.name || '—'}</div></UiTooltip>
                                <UiTooltip content={p.invoice_number || ''}><div className="text-xs text-slate-400 truncate max-w-[280px]">{(p.status === 'nota_credito' || (Number(p.gross_amount) || 0) < 0) ? 'Nota di credito' : 'Fatt.'} {p.invoice_number || '—'} {p.payment_method ? `- ${(paymentMethodLabels as Record<string, string>)[p.payment_method] || p.payment_method}` : ''}</div></UiTooltip>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`text-sm font-semibold ${p.status === 'pagato' ? 'text-slate-400' : (p.status === 'nota_credito' || (Number(p.gross_amount) || 0) < 0) ? 'text-red-600' : 'text-slate-800'}`}>
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

          {/* ===== INCASSI — CALENDARIO VIEW ===== */}
          {scadViewMode === 'calendario' && typeFilter === 'incassi' && !bankIncomesLoading && bankIncomes.length > 0 && (() => {
            const year = calendarMonth.getFullYear();
            const month = calendarMonth.getMonth();
            const firstDay = new Date(year, month, 1);
            const startDow = (firstDay.getDay() + 6) % 7;
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            const dayMap: Record<number, AnyRow[]> = {};
            filteredIncomes.forEach(i => {
              if (!i.transaction_date) return;
              const d = new Date(String(i.transaction_date));
              if (d.getFullYear() === year && d.getMonth() === month) {
                const day = d.getDate();
                (dayMap[day] = dayMap[day] || []).push(i);
              }
            });

            const cells: (number | null)[] = [];
            for (let k = 0; k < startDow; k++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(d);
            const todayDate = new Date();
            const isToday = (day: number | null) => day != null && todayDate.getFullYear() === year && todayDate.getMonth() === month && todayDate.getDate() === day;
            const monthLabel = calendarMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
            const selectedDayIncomes = selectedCalendarDay && dayMap[selectedCalendarDay] ? dayMap[selectedCalendarDay] : [];

            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <button onClick={() => setCalendarMonth(new Date(year, month - 1, 1))} title="Mese precedente" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition"><ChevronLeft size={18} /></button>
                  <h3 className="text-sm font-semibold text-slate-800 capitalize">{monthLabel}</h3>
                  <button onClick={() => setCalendarMonth(new Date(year, month + 1, 1))} title="Mese successivo" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition"><ChevronRight size={18} /></button>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="grid grid-cols-7 border-b border-slate-100">
                    {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
                      <div key={d} className="py-2 text-center text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {cells.map((day, idx) => {
                      const items = day ? (dayMap[day] || []) : [];
                      const isSelected = day && selectedCalendarDay === day;
                      return (
                        <button key={idx} disabled={!day}
                          onClick={() => day && setSelectedCalendarDay(isSelected ? null : day)}
                          className={`relative min-h-[64px] p-1.5 border-b border-r border-slate-50 text-left transition
                            ${!day ? 'bg-slate-50/30' : 'hover:bg-blue-50/40 cursor-pointer'}
                            ${isSelected ? 'bg-blue-50 ring-1 ring-blue-300 ring-inset' : ''}`}>
                          {day && (
                            <>
                              <span className={`text-xs font-medium ${isToday(day) ? 'bg-blue-600 text-white w-5 h-5 rounded-full inline-flex items-center justify-center' : 'text-slate-600'}`}>{day}</span>
                              {items.length > 0 && (
                                <div className="flex flex-wrap gap-0.5 mt-1">
                                  {items.slice(0, 4).map((i: AnyRow, k: number) => (
                                    <span key={k} className="w-2 h-2 rounded-full bg-blue-500" title={`${(i.description || '').slice(0, 40)} — ${fmt(i.amount)} €`} />
                                  ))}
                                  {items.length > 4 && <span className="text-[9px] text-slate-400 leading-none">+{items.length - 4}</span>}
                                </div>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {selectedCalendarDay && (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                      <h4 className="text-sm font-semibold text-slate-700">
                        Incassi del {selectedCalendarDay} {calendarMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
                        <span className="ml-2 text-xs font-normal text-slate-400">({selectedDayIncomes.length} incass{selectedDayIncomes.length === 1 ? 'o' : 'i'})</span>
                      </h4>
                    </div>
                    {selectedDayIncomes.length === 0 ? (
                      <div className="p-6 text-center text-sm text-slate-400">Nessun incasso in questo giorno</div>
                    ) : (
                      <div className="divide-y divide-slate-50">
                        {selectedDayIncomes.map((i: AnyRow) => (
                          <div key={i.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/50">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-blue-500" />
                              <div className="min-w-0">
                                <UiTooltip content={i.description || ''}><div className="text-sm font-medium text-slate-800 truncate max-w-[280px]">{i.description || '—'}</div></UiTooltip>
                                <div className="text-xs text-slate-400 truncate max-w-[280px]">{categorizeIncome(i.description).tipo}{i.bank_accounts?.bank_name ? ` · ${i.bank_accounts.bank_name}` : ''}</div>
                              </div>
                            </div>
                            <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">{fmt(i.amount)} €</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ===== INCASSI — viste LISTA (mese collassabile / lista piatta) =====
              Stessa struttura dei pagamenti, dataset bankIncomes. Sorgente:
              bank_transactions + cash_movements con amount > 0. Importi NERI
              senza segno (convenzione granito), niente verde. */}
          {viewMode === 'timeline' && typeFilter === 'incassi' && (scadViewMode === 'lista' || bankIncomesLoading || bankIncomes.length === 0) && (
            bankIncomesLoading ? (
              <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center text-sm text-slate-500">
                <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-slate-400" /> Caricamento incassi dagli estratti conto…
              </div>
            ) : bankIncomes.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center">
                <Receipt size={28} className="text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500 font-medium">Nessun incasso trovato</p>
                <p className="text-xs text-slate-400 mt-1">
                  Gli incassi sono movimenti in entrata (importo positivo) dagli estratti conto bancari.
                  Importa un EC da Import Hub per popolare questa sezione.
                </p>
              </div>
            ) : filteredIncomes.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center">
                <CheckCircle2 size={28} className="text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-600">Nessun incasso con questi filtri</p>
                <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                  {incomeBankFilter !== 'all' && (
                    <button onClick={() => setIncomeBankFilter('all')} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600 hover:bg-slate-200">Rimuovi banca <X size={11} /></button>
                  )}
                  {(dateRange.start || dateRange.end) && (
                    <button onClick={() => setDateRange({ start: '', end: '' })} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600 hover:bg-slate-200">Rimuovi periodo <X size={11} /></button>
                  )}
                  {searchTerm && (
                    <button onClick={() => setSearchTerm('')} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600 hover:bg-slate-200">Rimuovi "{searchTerm}" <X size={11} /></button>
                  )}
                  <button onClick={() => { setSearchTerm(''); setIncomeBankFilter('all'); setDateRange({ start: '', end: '' }); }}
                    className="text-xs text-red-500 hover:text-red-600 font-medium">Rimuovi tutti i filtri</button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
                <div className="overflow-x-auto scroll-shadow-x">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="py-2.5 px-3 text-left font-medium">Data</th>
                        <th className="py-2.5 px-3 text-left font-medium">Descrizione</th>
                        <th className="py-2.5 px-3 text-left font-medium">Tipo</th>
                        <th className="py-2.5 px-3 text-left font-medium">Banca</th>
                        <th className="py-2.5 px-3 text-right font-medium">Importo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(listLayout === 'lista'
                        ? sortedIncomes.map((i): IncomeRenderItem => ({ kind: 'row', i }))
                        : incomeMonthRenderItems
                      ).map((item, idx) => item.kind === 'header' ? (
                        <tr key={`ih-${item.key}`} className="bg-slate-50/80 border-y border-slate-200">
                          <td colSpan={5} className="px-3 py-2">
                            <button onClick={() => toggleIncomeMonth(item.key)} className="w-full flex items-center justify-between text-left">
                              <span className="flex items-center gap-2">
                                <ChevronDown size={15} className={`text-slate-400 transition-transform ${item.collapsed ? '-rotate-90' : ''}`} />
                                <span className="text-sm font-semibold text-slate-800 capitalize">{item.label}</span>
                                <span className="text-xs text-slate-400">· {item.count} incass{item.count === 1 ? 'o' : 'i'}</span>
                              </span>
                              <span className="text-sm font-bold text-slate-900">{fmt(item.subtotal)} €</span>
                            </button>
                          </td>
                        </tr>
                      ) : (() => { const i = item.i; const cat = categorizeIncome(i.description); return (
                        <tr key={i.id} className={`border-b border-slate-50 hover:bg-blue-50/50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                          <td className="py-2.5 px-3 whitespace-nowrap text-[13px] text-slate-600">{fmtDate(i.transaction_date)}</td>
                          <td className="py-2.5 px-3 text-[13px] text-slate-700"><UiTooltip content={i.description || ''}><div className="truncate max-w-md">{i.description || '—'}</div></UiTooltip></td>
                          <td className="py-2.5 px-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${cat.cls}`}>{cat.tipo}</span></td>
                          <td className="py-2.5 px-3 text-xs text-slate-500">{i.bank_accounts?.bank_name || '—'}</td>
                          <td className="py-2.5 px-3 text-right text-[13px] font-medium text-slate-900 whitespace-nowrap">{fmt(i.amount)} €</td>
                        </tr>
                      ); })())}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {/* Timeline View — Sibill style (Pagamenti / Tutte le scadenze) */}
          {/* ===== EMPTY-STATE CONTESTUALE =====
              Quando un filtro svuota la lista, il sistema spiega il perché e
              offre la rimozione mirata. Mai liste misteriosamente vuote. */}
          {scadViewMode === 'lista' && viewMode === 'timeline' && typeFilter !== 'incassi' && displayPayables.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center">
              <CheckCircle2 size={28} className="text-slate-300 mx-auto mb-2" />
              {(typeFilter || selectedStatus || selectedMethodGroup || searchTerm || dateRange.start || dateRange.end) ? (
                <>
                  <p className="text-sm font-medium text-slate-600">Nessuna scadenza con questi filtri</p>
                  <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                    {typeFilter && (
                      <button onClick={() => setTypeFilter('')} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600 hover:bg-slate-200">
                        Rimuovi "{typeFilter === 'fornitori' ? 'Solo Fornitori' : typeFilter === 'fiscali' ? 'Solo Fiscali / Interni' : typeFilter}" <X size={11} />
                      </button>
                    )}
                    {selectedStatus && (
                      <button onClick={() => setSelectedStatus('')} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600 hover:bg-slate-200">
                        Rimuovi "{selectedStatus === 'in_distinta' ? 'In distinta' : ((statusConfig as Record<string, { label?: string }>)[selectedStatus]?.label || selectedStatus)}" <X size={11} />
                      </button>
                    )}
                    {(dateRange.start || dateRange.end) && (
                      <button onClick={() => setDateRange({ start: '', end: '' })} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600 hover:bg-slate-200">
                        Rimuovi periodo <X size={11} />
                      </button>
                    )}
                    {searchTerm && (
                      <button onClick={() => setSearchTerm('')} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600 hover:bg-slate-200">
                        Rimuovi "{searchTerm}" <X size={11} />
                      </button>
                    )}
                    {selectedMethodGroup && (
                      <button onClick={() => setSelectedMethodGroup(null)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-600 hover:bg-slate-200">
                        Rimuovi metodo <X size={11} />
                      </button>
                    )}
                    <button onClick={() => { setTypeFilter(''); setSearchTerm(''); setSelectedStatus(''); setSelectedMethodGroup(null); setDateRange({ start: '', end: '' }); }}
                      className="text-xs text-red-500 hover:text-red-600 font-medium">Rimuovi tutti i filtri</button>
                  </div>
                </>
              ) : (
                <p className="text-sm font-medium text-slate-600">Nessuna scadenza da saldare. Tutto in regola!</p>
              )}
            </div>
          )}

          {scadViewMode === 'lista' && viewMode === 'timeline' && typeFilter !== 'incassi' && displayPayables.length > 0 && (
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
                        <button onClick={toggleSelectAll} title="Seleziona/deseleziona tutte" className="text-slate-300 hover:text-slate-600">
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
                    {(listLayout === 'lista'
                      ? sortedDisplayPayables.map((p): MonthRenderItem => ({ kind: 'row', p }))
                      : monthRenderItems
                    ).map((item, idx) => item.kind === 'header' ? (
                      <tr key={`mh-${item.key}`} className="bg-slate-50/80 border-y border-slate-200">
                        <td colSpan={8} className="px-3 py-2">
                          <button onClick={() => toggleMonth(item.key)} className="w-full flex items-center justify-between text-left">
                            <span className="flex items-center gap-2">
                              <ChevronDown size={15} className={`text-slate-400 transition-transform ${item.collapsed ? '-rotate-90' : ''}`} />
                              <span className="text-sm font-semibold text-slate-800 capitalize">{item.label}</span>
                              <span className="text-xs text-slate-400">· {item.count + item.estimateCount} scadenz{(item.count + item.estimateCount) === 1 ? 'a' : 'e'}</span>
                            </span>
                            {/* Subtotale mese = reali + stime (numero unico); nota azzurra discreta della quota stimata. */}
                            <span className="flex items-baseline gap-2">
                              <span className="text-sm font-bold text-slate-900">{fmt(item.subtotal + item.estimateSubtotal)} €</span>
                              {item.estimateSubtotal > 0 && <span className="text-[11px] text-sky-600">incl. ≈ {fmt(item.estimateSubtotal)} €</span>}
                            </span>
                          </button>
                        </td>
                      </tr>
                    ) : (() => { const p = item.p;
                      // ── RIGA STIMA da ricorrenza (azzurra, non selezionabile,
                      //    non pagabile): è una previsione, non una scadenza reale. ──
                      if (p._isEstimate) return (
                        <tr key={p.id} className="border-b border-slate-50 bg-sky-50/30 hover:bg-sky-50/60 transition-colors">
                          <td className="py-2.5 px-3 text-center">
                            <UiTooltip content="Stima da ricorrenza: diventa pagabile quando arriva la fattura reale"><Repeat size={13} className="text-sky-400 inline" /></UiTooltip>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="text-[13px] font-medium text-sky-700">
                              {p.due_date ? new Date(p.due_date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                            </div>
                            <div className="text-[10px] text-sky-400 mt-0.5">{(paymentMethodLabels as Record<string, string>)[p.payment_method || ''] || 'Bonifico'}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <UiTooltip content={(p.suppliers?.ragione_sociale || p.suppliers?.name || '') as string}>
                              <div className="text-[13px] text-sky-800 font-medium truncate max-w-[220px]">{p.suppliers?.ragione_sociale || p.suppliers?.name || '—'}</div>
                            </UiTooltip>
                            <div className="text-[10px] text-sky-500 mt-0.5">≈ Stima da ricorrenza{p.notes ? ` • ${p.notes}` : ''}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right text-[13px] font-medium whitespace-nowrap text-sky-700">≈ {fmt(p.gross_amount)} €</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-100 text-[10px] text-sky-700 font-medium">Stima</span>
                            {Boolean(p._possibleMatch) && (
                              <UiTooltip content="Esiste una fattura reale per questo fornitore nel mese, ma con importo diverso: verifica se è la stessa. Nessuna azione automatica.">
                                <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-[10px] text-amber-700 font-medium border border-amber-200"><AlertTriangle size={10} /> Possibile corrispondenza</span>
                              </UiTooltip>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center"><span className="text-[11px] text-slate-300">—</span></td>
                          <td className="py-2.5 px-3 text-center"><span className="text-[10px] text-sky-500">da Ricorrenze</span></td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[11px] text-slate-300">—</span></td>
                        </tr>
                      );
                      return (
                      <React.Fragment key={p.id}>
                        <tr className={`border-b border-slate-50 hover:bg-blue-50/50 transition-colors group ${idx % 2 === 1 ? 'even:bg-slate-50/50' : ''}`}>
                          <td className="py-2.5 px-3 text-center">
                            {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && p.id && (
                              <button onClick={() => p.id && toggleSelect(p.id, p)} title="Seleziona per la distinta">
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
                              {(paymentMethodLabels as Record<string, string>)[p.payment_method || ''] || 'Bonifico'}
                            </div>
                          </td>
                          {/* DESCRIZIONE — fornitore (riga primaria) + notes/fattura (riga
                              secondaria). La descrizione integrale (notes) è sempre raggiungibile
                              via Tooltip e, se valorizzata, mostrata in chiaro come riga di dettaglio;
                              la riga non è mai anonima (fallback fattura). */}
                          <td className="py-2.5 px-3">
                            {(() => {
                              const supplierLabel = (p.suppliers?.ragione_sociale || p.suppliers?.name || '').trim()
                              const note = (p.notes || '').trim()
                              const isNotaCredito = p.status === 'nota_credito' || (Number(p.gross_amount) || 0) < 0
                              const invoiceLabel = p.invoice_number && p.invoice_number !== '-' ? `${isNotaCredito ? 'Nota di credito' : 'Fattura'} • ${p.invoice_number}` : ''
                              // Fattura a rate (split dall'XML): badge dedicato "rata X/N", sempre
                              // visibile quando le rate sono >1, così tre righe della stessa fattura
                              // non sembrano un doppione.
                              const isRata = (Number(p.installment_total) || 0) > 1
                              // Riga primaria: fornitore se presente, altrimenti la nota, altrimenti la fattura
                              const mainText = supplierLabel || note || (p.invoice_number && p.invoice_number !== '-' ? p.invoice_number : '') || 'N/A'
                              // Riga secondaria: SEMPRE il numero fattura/NC (così si sceglie
                              // senza espandere la riga); se manca, fallback sulla nota. La nota
                              // completa resta comunque leggibile nel tooltip.
                              const subText = invoiceLabel || note
                              const subTooltip = [invoiceLabel, note].filter(Boolean).join(' — ') || subText
                              return (
                                <button onClick={() => {
                                  const sup = suppliers.find(s =>
                                    s.ragione_sociale === (p.suppliers?.ragione_sociale || p.suppliers?.name) ||
                                    s.name === (p.suppliers?.name || p.suppliers?.ragione_sociale)
                                  );
                                  setSupplierDetail(sup || { ragione_sociale: p.suppliers?.ragione_sociale || p.suppliers?.name || 'N/A' });
                                }} className="text-left">
                                  <div className="flex items-center gap-1.5">
                                    <UiTooltip content={mainText}>
                                      <div className={`text-[13px] text-slate-800 hover:text-blue-600 font-medium truncate ${isRata ? 'max-w-[150px]' : 'max-w-[220px]'}`}>
                                        {mainText}
                                      </div>
                                    </UiTooltip>
                                    {isRata && (
                                      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md bg-indigo-50 text-[10px] font-semibold text-indigo-700 border border-indigo-100">
                                        rata {String(p.installment_number)}/{String(p.installment_total)}
                                      </span>
                                    )}
                                  </div>
                                  {subText && (
                                    <UiTooltip content={subTooltip}>
                                      <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[220px]">
                                        {subText}
                                      </div>
                                    </UiTooltip>
                                  )}
                                </button>
                              )
                            })()}
                          </td>
                          {/* IMPORTO — click per editare inline (anche scadenze fiscali via dispatch).
                              ROSSO riservato SOLO alle note di credito (importo negativo, con il
                              segno -). Le altre voci, incluse le scadute, restano in nero. */}
                          <td className={`py-2.5 px-3 text-right text-[13px] font-medium whitespace-nowrap ${
                            p.status === 'pagato' ? 'text-slate-400'
                              : (p.status === 'nota_credito' || (Number(p.gross_amount) || 0) < 0) ? 'text-red-600'
                              : 'text-slate-800'
                          }`}>
                            {inlineEditAmountId === p.id ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                autoFocus
                                value={inlineEditAmountValue}
                                onChange={(e) => setInlineEditAmountValue(e.target.value)}
                                onBlur={() => p.id && handleInlineSaveAmount(p.id, inlineEditAmountValue)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') e.currentTarget.blur()
                                  if (e.key === 'Escape') setInlineEditAmountId(null)
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-24 px-1.5 py-0.5 text-right border-2 border-blue-500 rounded text-sm font-mono focus:outline-none"
                              />
                            ) : (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (p.status === 'pagato' || p.status === 'nota_credito' || (Number(p.gross_amount) || 0) < 0) return;
                                  setInlineEditAmountId(p.id || null);
                                  setInlineEditAmountValue(String(p.gross_amount ?? 0));
                                }}
                                className={`cursor-pointer hover:bg-blue-50 rounded px-1 -mx-1 transition ${
                                  (Number(p.gross_amount) || 0) === 0 ? 'bg-amber-50 text-amber-700 border border-amber-300 font-medium' : ''
                                }`}
                                title={p.status === 'pagato' ? 'Scadenza pagata' : 'Click per modificare importo'}
                              >
                                {(p.amount_remaining ?? 0) > 0 && p.amount_remaining !== p.gross_amount
                                  ? <><span className="text-slate-500 line-through text-xs mr-1">{fmt(p.gross_amount)}</span>{fmt(p.amount_remaining)} €</>
                                  : (Number(p.gross_amount) || 0) === 0 ? <>Importo da definire</> : <>{fmt(p.gross_amount)} €</>
                                }
                              </span>
                            )}
                          </td>
                          {/* STATO — dropdown editabile Sibill */}
                          <td className="py-2.5 px-3 text-center relative">
                            <button onClick={(e) => { e.stopPropagation(); setStatusDropdownId(statusDropdownId === p.id ? null : p.id); setCategoryDropdownId(null); }}>
                              <StatusPill status={p.status} />
                            </button>
                            {!!p.disposizione_date && p.status !== 'pagato' && p.status !== 'annullato' && (
                              <UiTooltip content={`Disposta il ${new Date(p.disposizione_date as string).toLocaleDateString('it-IT')}${p.disposizione_bank_name ? ' da ' + p.disposizione_bank_name : ''} — in attesa di addebito e riconciliazione`}>
                                <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-[10px] text-amber-700 font-medium border border-amber-200">
                                  <Clock size={10} /> In distinta {new Date(p.disposizione_date as string).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
                                </span>
                              </UiTooltip>
                            )}
                            {Boolean(p.closed_manually) && (
                              <div className="mt-1">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-50 text-[9px] text-violet-700 font-medium border border-violet-200"
                                  title={`Chiusa a mano${p.payment_date ? ' il ' + new Date(p.payment_date as string).toLocaleDateString('it-IT') : ''}${p.manual_close_reason ? ' — ' + String(p.manual_close_reason) : ''}`}>
                                  ✎ Chiusa a mano{p.status === 'parziale' ? ' (parziale)' : ''}
                                </span>
                              </div>
                            )}
                            {statusDropdownId === p.id && (
                              <div className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px]" onClick={e => e.stopPropagation()}>
                                {['da_pagare', 'scaduto', 'parziale', 'pagato', 'contestato', 'annullato'].map(s => (
                                  <button key={s} onClick={() => p.id && handleSetStatus(p.id, s)}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2 ${p.status === s ? 'font-bold' : ''}`}>
                                    <span className={`w-2 h-2 rounded-full ${(statusConfig as Record<string, { bg?: string }>)[s]?.bg?.split(' ')[0] || 'bg-slate-200'}`} />
                                    {(statusConfig as Record<string, { label?: string }>)[s]?.label || s}
                                  </button>
                                ))}
                                <div className="my-1 border-t border-slate-100" />
                                <button onClick={() => openManualCloseModal(p)}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-violet-50 text-violet-700 font-medium flex items-center gap-2">
                                  ✎ Chiudi a mano…
                                </button>
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
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-xs text-emerald-700 font-medium border border-emerald-200" title={`Pagato su ${p.payment_bank_name}`}>
                                <Landmark size={10} /> {p.payment_bank_name}
                              </span>
                            ) : p.status === 'pagato' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-xs text-amber-700 font-medium border border-amber-200" title="Pagata ma senza banca tracciata in Supabase. Probabilmente saldata fuori dall'app o tramite riconciliazione legacy.">
                                Off-system
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          {/* CATEGORIA — dropdown con ricerca Sibill */}
                          <td className="py-2.5 px-3 text-center relative">
                            {(() => {
                              const cat = categories.find(c => c.id === p.cost_category_id);
                              return (
                                <button onClick={(e) => { e.stopPropagation(); setCategoryDropdownId(categoryDropdownId === p.id ? null : (p.id || null)); setCategorySearch(''); setStatusDropdownId(null); }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition hover:shadow-sm"
                                  style={cat ? { backgroundColor: String(cat.color) + '18', color: String(cat.color || ''), borderColor: String(cat.color) + '40' } : { backgroundColor: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}>
                                  {cat ? <><span className="w-2 h-2 rounded-full" style={{ backgroundColor: String(cat.color || '') }} />{String(cat.name || '')}</> : 'Non categorizzata'}
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
                                  <button onClick={() => p.id && handleSetCategory(p.id, '')}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 text-slate-400 flex items-center gap-2">
                                    <X size={10} /> Rimuovi categoria
                                  </button>
                                  {categories
                                    .filter(c => !categorySearch || (c.name as string | null | undefined)?.toLowerCase().includes(categorySearch.toLowerCase()))
                                    .map(c => (
                                    <button key={c.id} onClick={() => p.id && c.id && handleSetCategory(p.id, c.id)}
                                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2 ${p.cost_category_id === c.id ? 'font-bold bg-slate-50' : ''}`}>
                                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: String(c.color || '') }} />
                                      <UiTooltip content={String(c.name || '')}><span className="truncate">{String(c.name || '')}</span></UiTooltip>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                          {/* AZIONI — Paga + Vedi fattura + Edit + Delete */}
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex justify-end gap-0.5">
                              {/* NB: pagamento via A-Cube si lancia dal bottom-sheet multi-checkbox.
                                  Bottone singolo rimosso per evitare duplicato di TesoreriaManuale. */}
                              {/* Vedi fattura XML */}
                              {p.invoice_number && (
                                <button onClick={async () => {
                                  // Fix ticket "CT INDUSTRIE / MICHELE FISCO": il numero fattura NON e'
                                  // univoco tra fornitori. 1) match esatto via electronic_invoice_id del
                                  // payable; 2) fallback numero + azienda + P.IVA fornitore.
                                  let xml: string | null = null
                                  if (p.id) {
                                    const { data: pay } = await supabase.from('payables')
                                      .select('electronic_invoice_id')
                                      .eq('id', p.id)
                                      .maybeSingle()
                                    if (pay?.electronic_invoice_id) {
                                      const { data } = await supabase.from('electronic_invoices')
                                        .select('xml_content')
                                        .eq('id', pay.electronic_invoice_id)
                                        .not('xml_content', 'is', null)
                                        .maybeSingle()
                                      xml = data?.xml_content || null
                                    }
                                  }
                                  if (!xml && COMPANY_ID) {
                                    let q = supabase.from('electronic_invoices')
                                      .select('xml_content')
                                      .eq('invoice_number', p.invoice_number || '')
                                      .eq('company_id', COMPANY_ID)
                                      .not('xml_content', 'is', null)
                                    if (p.supplier_vat) q = q.eq('supplier_vat', p.supplier_vat)
                                    const { data } = await q.limit(1).maybeSingle()
                                    xml = data?.xml_content || null
                                  }
                                  if (xml) {
                                    setViewingXml(xml)
                                  } else {
                                    toast({ type: 'warning', message: 'XML fattura non disponibile per questa scadenza' })
                                  }
                                }}
                                  className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                                  title="Visualizza fattura XML">
                                  <Eye size={13} />
                                </button>
                              )}
                              {/* Rimuovi dalla distinta — solo se la scadenza è in distinta */}
                              {!!p.disposizione_date && p.status !== 'pagato' && p.status !== 'annullato' && (
                                <button onClick={() => p.id && setRemoveDistintaModal({ payableId: p.id, invoiceNumber: p.invoice_number || '' })}
                                  className="p-1 rounded text-amber-500 hover:text-amber-700 hover:bg-amber-50"
                                  title="Rimuovi dalla distinta">
                                  <Ban size={12} />
                                </button>
                              )}
                              {/* Rimanda scadenza (cambia due_date) — visibile su tutte le non pagate */}
                              {p.status !== 'pagato' && (
                                <button onClick={() => setRinviaModal({ open: true, scheduleId: p.id || null, currentDueDate: p.due_date || null, invoiceNumber: p.invoice_number || null })}
                                  className="p-1 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                                  title="Rimanda scadenza (fine mese successivo o data scelta)">
                                  <Calendar size={12} />
                                </button>
                              )}
                              {/* Chiudi a mano — chiusura contabile manuale (fatture: totale/parziale; NC: chiusura in AVERE) */}
                              {p.status !== 'pagato' && p.status !== 'annullato' && !p.closed_manually && p.id && (
                                <button onClick={() => openManualCloseModal(p)}
                                  className="p-1 rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50"
                                  title={(p.status === 'nota_credito' || (Number(p.gross_amount) || 0) < 0)
                                    ? 'Chiudi a mano la nota di credito — registra in AVERE nel partitario'
                                    : 'Chiudi a mano (totale o parziale) — registra in partitario'}>
                                  <CheckCircle2 size={13} />
                                </button>
                              )}
                              <button onClick={() => setModals({ ...modals, editSchedule: { open: true, schedule: p } })}
                                className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                title="Modifica">
                                <Edit2 size={12} />
                              </button>
                              <button onClick={() => setModals({ ...modals, deleteConfirm: { open: true, scheduleId: p.id || null, invoiceNumber: p.invoice_number || null, recurringCostId: (p.recurring_cost_id as string | null) || null } })}
                                className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                                title="Elimina">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {p.id && selectedIds.has(p.id) && paymentPlan[p.id] && (() => {
                          const pid = p.id;
                          const plan = paymentPlan[pid];
                          const residuo = Number(p.amount_remaining) || 0;
                          const ncOpts = openCreditNotesFor(p);
                          const ncTot = (plan.ncIds || []).reduce((s, nid) => { const nc = payables.find(x => x.id === nid); return s + (nc ? ncAmountOf(nc) : 0); }, 0);
                          const baseAmt = plan.type === 'saldo' ? residuo : (Number(plan.baseAmount) || 0);
                          const { tipo: tipoKind, label: tipoLabel } = distintaTipo(p, plan);
                          return (
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <td colSpan={9} className="px-4 py-2.5">
                              <div className="flex items-center gap-4 flex-wrap">
                                <div>
                                  <label className="text-xs font-medium text-slate-600 block mb-1">Banca</label>
                                  <select value={plan.bankId} onChange={e => updatePlan(pid, 'bankId', e.target.value)}
                                    className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-52">
                                    <option value="">Seleziona banca...</option>
                                    {bankAccounts.map(ba => (
                                      <option key={String(ba.id)} value={String(ba.id)}>{ba.bank_name} ({fmt(bankBalances[String(ba.id)] || 0)} €)</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-600 block mb-1">Tipo</label>
                                  <div className="flex rounded-lg overflow-hidden border border-slate-300">
                                    <button onClick={() => recomputePlan(pid, { type: 'saldo' })}
                                      className={`px-3 py-1.5 text-sm font-medium ${plan.type === 'saldo' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600'}`}>
                                      Saldo
                                    </button>
                                    <button onClick={() => recomputePlan(pid, { type: 'parziale', baseAmount: plan.baseAmount ?? residuo })}
                                      className={`px-3 py-1.5 text-sm font-medium ${plan.type === 'parziale' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600'}`}>
                                      Parziale
                                    </button>
                                  </div>
                                </div>
                                {plan.type === 'parziale' && (
                                  <div>
                                    <label className="text-xs font-medium text-slate-600 block mb-1">Acconto (lordo)</label>
                                    <input type="number" step="0.01" value={plan.baseAmount ?? plan.amount}
                                      onChange={e => recomputePlan(pid, { baseAmount: Math.min(Number(e.target.value) || 0, residuo) })}
                                      onWheel={e => e.currentTarget.blur()}
                                      className="no-spin px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-32" />
                                  </div>
                                )}
                                {/* Scala note di credito — NC aperte dello stesso fornitore. Selezionandole,
                                    l'importo del bonifico scende del loro valore e la causale le cita. */}
                                {ncOpts.length > 0 && (
                                  <div className="min-w-48">
                                    <label className="text-xs font-medium text-slate-600 block mb-1">Scala note di credito</label>
                                    <div className="flex flex-wrap gap-1">
                                      {ncOpts.map(nc => {
                                        const on = (plan.ncIds || []).includes(nc.id as string);
                                        return (
                                          <button key={String(nc.id)} type="button"
                                            onClick={() => {
                                              const cur = new Set(plan.ncIds || []);
                                              if (on) cur.delete(nc.id as string); else cur.add(nc.id as string);
                                              recomputePlan(pid, { ncIds: Array.from(cur) });
                                            }}
                                            className={`px-2 py-1 rounded-md text-xs font-medium border ${on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                                            title={`Nota di credito ${nc.invoice_number || ''} — ${fmt(ncAmountOf(nc))} €`}>
                                            {on ? '✓ ' : ''}NC {nc.invoice_number || 's/n'} −{fmt(ncAmountOf(nc))}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                                <div className="flex-1 min-w-48">
                                  <label className="text-xs font-medium text-slate-600 block mb-1">Note (causale)</label>
                                  <input type="text" value={plan.note} onChange={e => updatePlan(pid, 'note', e.target.value)}
                                    placeholder="Causale / motivo..." className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-full" />
                                </div>
                              </div>
                              {/* Riepilogo tipo + netto bonifico (aggiornato live) */}
                              <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                                <span className={`px-1.5 py-0.5 rounded font-semibold ${tipoKind === 'SALDO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{tipoLabel}</span>
                                <span className="text-slate-500">Netto bonifico:</span>
                                <span className="font-bold text-slate-800">{fmt(plan.amount)} €</span>
                                {ncTot > 0 && (
                                  <span className="text-slate-400">({fmt(baseAmt)} − NC {fmt(ncTot)})</span>
                                )}
                              </div>
                            </td>
                          </tr>
                          );
                        })()}
                      </React.Fragment>
                    ); })())}
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
                  <div className="overflow-x-auto scroll-shadow-x">
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
                              {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && p.id && (
                                <button onClick={() => p.id && toggleSelect(p.id, p)} title="Seleziona per la distinta">
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
                  <div className="overflow-x-auto scroll-shadow-x">
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
                              {p.status !== 'pagato' && (p.gross_amount || 0) >= 0 && p.id && (
                                <button onClick={() => p.id && toggleSelect(p.id, p)} title="Seleziona per la distinta">
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
            <ScadenzeCharts
              monthlyData={monthlyData}
              categoryData={categoryData}
              agingAnalysis={agingAnalysis}
              displayPayables={displayPayables}
            />
          )}

          {/* Floating Action Bar for Bulk Payments */}
          <BulkPaymentBar
            selectedCount={selectedIds.size}
            selectedTotal={selectedTotal}
            bankSpending={bankSpending}
            bankBalances={bankBalances}
            bankAccounts={bankAccounts}
            hasNegativeBalance={hasNegativeBalance}
            missingBankCount={missingBankCount}
            isSaving={isSaving}
            onClear={() => { setSelectedIds(new Set()); setPaymentPlan({}); }}
            onConfirm={confirmPayments}
          />
        </>
      ) : null}
      </div>{/* chiude content wrapper */}

      {/* Conferma custom (sostituisce confirm() nativo) */}
      <Modal open={!!confirmDialog} onClose={() => { confirmDialog?.resolve(false); setConfirmDialog(null); }} title="Conferma">
        <div className="space-y-4">
          <p className="text-sm text-slate-700 whitespace-pre-line">{confirmDialog?.message}</p>
          <div className="flex gap-3 pt-2">
            <button onClick={() => { confirmDialog?.resolve(false); setConfirmDialog(null); }}
              className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
            <button onClick={() => { confirmDialog?.resolve(true); setConfirmDialog(null); }}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Conferma</button>
          </div>
        </div>
      </Modal>

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
                if (COMPANY_ID) await supabase.from('companies').update({ settings: { email_scadenzario: emailRecipients } } as never).eq('id', COMPANY_ID);
                setShowEmailConfig(false);
              }} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Salva</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Supplier Detail Popup */}
      <SupplierDetailModal supplier={supplierDetail} onClose={() => setSupplierDetail(null)} />

      {/* Rimanda Scadenza Modal — default "fine mese successivo" o data scelta */}
      {rinviaModal.open && (() => {
        // Fine del mese successivo (rispetto a oggi): ultimo giorno di (mese corrente + 1).
        const _now = new Date();
        const _endNext = new Date(_now.getFullYear(), _now.getMonth() + 2, 0);
        const endNextMonthStr = `${_endNext.getFullYear()}-${String(_endNext.getMonth() + 1).padStart(2, '0')}-${String(_endNext.getDate()).padStart(2, '0')}`;
        return (
        <Modal open={true} onClose={() => { setRinviaModal({ open: false, scheduleId: null, currentDueDate: null, invoiceNumber: null }); setRinviaCustomDate(''); }}
          title={`Rimanda: ${rinviaModal.invoiceNumber || 'scadenza'}`}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Scadenza attuale: <span className="font-medium text-slate-900">{rinviaModal.currentDueDate ? new Date(rinviaModal.currentDueDate).toLocaleDateString('it-IT') : '—'}</span>
            </p>
            <div>
              <button
                onClick={() => rinviaModal.scheduleId && handleRinviaSchedule(rinviaModal.scheduleId, endNextMonthStr)}
                disabled={isSaving}
                className="w-full px-4 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold border border-amber-500 transition disabled:opacity-50 flex items-center justify-between">
                <span>Fine mese successivo</span>
                <span className="font-medium text-amber-50">{_endNext.toLocaleDateString('it-IT')}</span>
              </button>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 mb-2 block uppercase tracking-wide">Oppure scegli una data</label>
              <div className="flex gap-2">
                <input type="date" value={rinviaCustomDate} onChange={(e) => setRinviaCustomDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
                <button onClick={() => rinviaModal.scheduleId && rinviaCustomDate && handleRinviaSchedule(rinviaModal.scheduleId, rinviaCustomDate)}
                  disabled={isSaving || !rinviaCustomDate}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  Rimanda
                </button>
              </div>
            </div>
          </div>
        </Modal>
        );
      })()}

      {/* Chiudi a mano Modal — chiusura contabile manuale (totale o parziale) con registrazione in partitario */}
      {manualCloseModal.open && (() => {
        const closeModal = () => { setManualCloseModal({ open: false, payable: null }); setManualCloseDate(''); setManualCloseReason(''); setManualCloseAmount(''); };
        const grossMC = Number(manualCloseModal.payable?.gross_amount ?? 0) || 0;
        const isNC = manualCloseModal.payable?.status === 'nota_credito' || grossMC < 0;
        const ncAmount = Math.abs(grossMC);
        const remaining = Number(manualCloseModal.payable?.amount_remaining ?? manualCloseModal.payable?.gross_amount ?? 0) || 0;
        const parsed = parseFloat((manualCloseAmount || '').replace(',', '.'));
        const amount = Number.isFinite(parsed) ? parsed : remaining;
        const isPartial = !isNC && amount > 0 && amount < remaining - 0.005;
        const invalid = isNC ? false : !(amount > 0 && amount <= remaining + 0.005);
        return (
        <Modal open={true} onClose={closeModal}
          title={`${isNC ? 'Chiudi a mano nota di credito' : 'Chiudi a mano'}: ${manualCloseModal.payable?.invoice_number || (isNC ? 'NC' : 'fattura')}`}>
          <div className="space-y-4">
            <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2.5 text-xs text-violet-800">
              {isNC
                ? <>La nota di credito verrà <span className="font-semibold">chiusa a mano</span> e nel <span className="font-semibold">partitario fornitore</span> comparirà la scrittura di chiusura in <span className="font-semibold">AVERE</span> per <span className="font-semibold">{fmt(ncAmount)} €</span>, che annulla l'effetto della NC sul saldo. Nessun movimento bancario.</>
                : isPartial
                ? <>Verrà registrata una <span className="font-semibold">chiusura parziale</span> di <span className="font-semibold">{fmt(amount)} €</span> nel <span className="font-semibold">partitario fornitore</span> (dicitura «Chiusa a mano», con data). La fattura resta <span className="font-semibold">parziale</span> per il residuo. Nessun movimento bancario.</>
                : <>La fattura verrà marcata come <span className="font-semibold">pagata (chiusa a mano)</span> e registrata nel <span className="font-semibold">partitario fornitore</span> con dicitura «Chiusa a mano» e la data scelta. Nessun movimento bancario.</>}
            </div>
            <p className="text-sm text-slate-600">
              {isNC
                ? <>Importo nota di credito: <span className="font-medium text-slate-900">{fmt(ncAmount)} €</span></>
                : <>Residuo da chiudere: <span className="font-medium text-slate-900">{fmt(remaining)} €</span></>}
            </p>
            {!isNC && (
              <div>
                <label className="text-xs font-semibold text-slate-700 mb-2 block uppercase tracking-wide">Importo da chiudere</label>
                <div className="flex gap-2">
                  <input type="number" step="0.01" min="0" max={remaining} value={manualCloseAmount}
                    onChange={(e) => setManualCloseAmount(e.target.value)}
                    onWheel={e => e.currentTarget.blur()}
                    className="no-spin flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500" />
                  <button type="button" onClick={() => setManualCloseAmount(String(remaining.toFixed(2)))}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                    Tutto il residuo
                  </button>
                </div>
                {invalid && manualCloseAmount !== '' && (
                  <p className="text-[11px] text-red-600 mt-1">Inserisci un importo tra 0 e {fmt(remaining)} €.</p>
                )}
                {!invalid && (
                  <p className="text-[11px] text-slate-500 mt-1">{isPartial ? `Chiusura parziale — residuo dopo: ${fmt(remaining - amount)} €` : 'Chiusura totale della fattura.'}</p>
                )}
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-700 mb-2 block uppercase tracking-wide">Data di chiusura</label>
              <input type="date" value={manualCloseDate} onChange={(e) => setManualCloseDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 mb-2 block uppercase tracking-wide">Motivazione (opzionale)</label>
              <input type="text" value={manualCloseReason} onChange={(e) => setManualCloseReason(e.target.value)}
                placeholder={isNC ? 'es. compensazione, rimborso, storno…' : 'es. pagata contanti, compensazione, stralcio…'}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={closeModal}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
              <button onClick={handleManualCloseSubmit} disabled={isSaving || !manualCloseDate || invalid}
                className="flex-1 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50">
                {isSaving ? 'Chiusura…' : (isNC ? 'Chiudi NC a mano' : (isPartial ? 'Chiudi parziale' : 'Chiudi a mano'))}
              </button>
            </div>
          </div>
        </Modal>
        );
      })()}

      {/* Delete Confirmation Modal */}
      {modals.deleteConfirm.open && (() => {
        const dc = modals.deleteConfirm;
        const isRecurring = !!dc.recurringCostId;
        const close = () => setModals({ ...modals, deleteConfirm: { open: false, scheduleId: null, invoiceNumber: null, recurringCostId: null } });
        return (
        <Modal open={true} onClose={close} title="Conferma cancellazione">
          <div className="space-y-3">
            <p className="text-sm">Eliminare la scadenza <span className="font-mono text-red-600">{dc.invoiceNumber || ''}</span>?</p>
            {isRecurring && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-[13px] text-amber-800">
                <Repeat size={15} className="mt-0.5 shrink-0 text-amber-500" />
                <span>Questa scadenza è <strong>ricorrente</strong>. Eliminandola viene rimossa anche la <strong>ricorrenza</strong> collegata, così sparisce anche dalle stime future e dal cashflow. Per non lasciare residui, è l'opzione consigliata.</span>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={close}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
              <button onClick={() => dc.scheduleId && handleDeleteSchedule(dc.scheduleId, dc.recurringCostId)} disabled={isSaving}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {isSaving ? 'Eliminazione…' : (isRecurring ? 'Elimina scadenza e ricorrenza' : 'Elimina')}
              </button>
            </div>
            {isRecurring && (
              <button onClick={() => dc.scheduleId && handleDeleteSchedule(dc.scheduleId, null)} disabled={isSaving}
                className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600">
                Elimina solo questa scadenza (mantieni la ricorrenza)
              </button>
            )}
          </div>
        </Modal>
        );
      })()}

      {/* Edit Schedule Modal */}
      {modals.editSchedule.open && modals.editSchedule.schedule && (
        <Modal open={true} onClose={() => setModals({ ...modals, editSchedule: { open: false, schedule: null } })}
          title={`Modifica: ${modals.editSchedule.schedule.invoice_number}`}>
          <EditScheduleModal schedule={modals.editSchedule.schedule} onUpdate={(s) => setModals({ ...modals, editSchedule: { open: true, schedule: s } })} onSave={handleEditSchedule} />
        </Modal>
      )}

      {/* Invoice Modal */}
      {modals.invoice.open && (
        <Modal open={true} onClose={() => setModals({ ...modals, invoice: { open: false, data: null } })} title="Nuova scadenza">
          <InvoiceModal suppliers={suppliers} costCenters={costCenters} paymentGroups={paymentGroups} paymentMethodLabels={paymentMethodLabels} onSave={handleCreateInvoice} onClose={() => setModals({ ...modals, invoice: { open: false, data: null } })} />
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
        <Modal open={true} onClose={() => { setConfirmResult(null); setDistintaSaved(false); fetchData(); }} title={distintaSaved ? 'Distinta confermata' : 'Anteprima distinta'} wide>
          <div className="space-y-4">
            {/* Header riepilogo */}
            {distintaSaved ? (
              <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 size={18} /> {confirmResult.results.length} scadenze messe in distinta
                </p>
                <span className="text-lg font-bold text-emerald-700">{fmt(confirmResult.totaleComplessivo)} €</span>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl border border-amber-200">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                  <Clock size={18} /> Anteprima: {confirmResult.results.length} scadenze — premi "Conferma distinta" per salvarle
                </p>
                <span className="text-lg font-bold text-amber-700">{fmt(confirmResult.totaleComplessivo)} €</span>
              </div>
            )}

            {/* Conferma distinta (salvataggio esplicito) */}
            <button onClick={confirmDistinta} disabled={isSaving || distintaSaved}
              className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition ${distintaSaved ? 'bg-emerald-100 text-emerald-700 cursor-default' : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'}`}>
              {distintaSaved ? <><CheckCircle2 size={16} /> Distinta confermata</> : (isSaving ? 'Salvataggio...' : <><CheckCircle2 size={16} /> Conferma distinta</>)}
            </button>

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
              const c = (bank.saldoFinale ?? 0) < 0
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
                      <div className={`text-sm font-semibold ${(bank.saldoFinale ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmt((bank.saldoFinale ?? 0))} €</div>
                    </div>
                    {/* Barra progresso saldo */}
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${c.bar} rounded-full transition-all`} style={{ width: `${Math.max(0, Math.min(100, ((bank.saldoFinale ?? 0) / bank.saldoIniziale) * 100))}%` }} />
                    </div>
                  </div>

                  {/* Lista pagamenti */}
                  <div className="divide-y divide-slate-50">
                    {bank.pagamenti.map((p, pIdx) => (
                      <div key={pIdx} className="px-4 py-2.5 bg-white hover:bg-slate-50/50">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <UiTooltip content={p.fornitore || ''}><div className="text-sm font-medium text-slate-800 truncate">{p.fornitore}</div></UiTooltip>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-xs text-slate-500">Fatt. {p.fattura}</span>
                              {p.metodo && <span className="text-xs text-slate-400">• {p.metodo}</span>}
                              <span className={`text-xs px-1.5 py-0.5 rounded ${p.tipo.startsWith('SALDO') ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{p.tipo}</span>
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
                        {p.note && (
                          <div className="mt-1 text-xs text-slate-500 italic">{p.note}</div>
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
                  <button onClick={() => { navigator.clipboard.writeText(confirmResult.emailBody); toast({ type: 'success', message: 'Testo della distinta copiato.' }); }}
                    className="flex-1 py-2.5 bg-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-300 flex items-center justify-center gap-2">
                    <Download size={14} /> Copia testo
                  </button>
                  <button onClick={openDistintaGmail}
                    className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center justify-center gap-2">
                    <Send size={14} /> Apri in Gmail
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Si apre Gmail in una nuova scheda con la distinta già compilata. In alternativa usa "Copia testo".</p>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Modale conferma "Rimuovi dalla distinta" */}
      {removeDistintaModal && (
        <Modal open={true} onClose={() => setRemoveDistintaModal(null)} title="Rimuovere dalla distinta?">
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              La scadenza <strong>{removeDistintaModal.invoiceNumber || 'selezionata'}</strong> verrà tolta dalla distinta e tornerà esattamente allo stato precedente: sparirà il badge "In distinta" e verrà azzerata la banca attesa.
            </p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setRemoveDistintaModal(null)} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
              <button onClick={() => removeFromDistinta(removeDistintaModal.payableId)}
                className="flex-1 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700">Rimuovi dalla distinta</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Guida: usa il pannello globale HelpPanel (voce '/scadenzario', ricco: step + FAQ),
          montato una sola volta in Layout. Il vecchio <PageHelp> per-pagina è stato rimosso
          per evitare il doppio pulsante guida sovrapposto in basso a destra. */}

      {/* InvoiceViewer modal */}
      {viewingXml && (
        <InvoiceViewer xmlContent={viewingXml} onClose={() => setViewingXml(null)} />
      )}
    </div>
  );
};

export default ScadenzarioSmart;
