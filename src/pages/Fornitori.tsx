import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// Tab Fornitori — persistito in URL come ?tab=
type FornitoriTab = 'anagrafica' | 'analytics';
const VALID_FORNITORI_TABS: FornitoriTab[] = ['anagrafica', 'analytics'];
import PageHeader from '../components/PageHeader';
import { useCompanyLabels } from '../hooks/useCompanyLabels';
import {
  Building2, Search, Plus, Edit3, Trash2, FileText, Phone, Mail, MapPin,
  CreditCard, Clock, AlertTriangle, CheckCircle, ChevronDown, ChevronUp,
  X, Filter, Download, TrendingUp, Calendar, ArrowUpDown, ExternalLink,
  Loader2, BarChart3, PieChart as PieChartIcon, Banknote, BookOpen, Tag,
  SlidersHorizontal, Split, Eye, Paperclip, Info
} from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import ExportMenu from '../components/ExportMenu';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useTableSort } from '../hooks/useTableSort';
import SortableTh from '../components/ui/SortableTh';
import TextTooltip from '../components/Tooltip';
import TableScroll from '../components/ui/TableScroll';
import { useOutlets } from '../hooks/useOutlets';
import { usePeriod } from '../hooks/usePeriod';
import SupplierAllocationEditor, { MODE_META, type AllocationMode } from '../components/SupplierAllocationEditor';
import InvoiceViewer from '../components/InvoiceViewer';
import PdfViewer from '../components/PdfViewer';
import { Modal } from '../components/ui/Modal';
import { parseFatturaAllegati, downloadBytes, type FatturaAllegato } from '../lib/fatturaAllegati';
import {
  PAYMENT_METHOD_OPTIONS, PAYMENT_METHOD_LABELS as PAYMENT_LABEL,
  DEFAULT_PAYMENT_METHOD, isBankRequired, normalizePaymentMethod,
} from '../lib/paymentMethods';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const EMPTY_FORM = {
  ragione_sociale: '', partita_iva: '', codice_fiscale: '', codice_sdi: '',
  pec: '', email: '', telefono: '', iban: '', indirizzo: '', citta: '',
  provincia: '', cap: '', category: '', payment_terms: 30,
  payment_method: 'bonifico_ordinario', cost_center: 'all', note: '',
  // Piano rate scadenze (v2): usato per generare le scadenze delle fatture >= 31/07/2026.
  // Default base = 'fine_mese' (regola standard: le scadenze sono a fine mese, incluse
  // le rimesse dirette). L'operatrice puo' cambiarla in 'data_fattura' quando serve.
  payment_base: 'fine_mese', prima_scadenza_gg: 30, numero_rate: 1, payment_bank_account_id: '',
};

const CATEGORIES = [
  'Merci', 'Servizi', 'Affitti', 'Utenze', 'Marketing', 'Logistica',
  'Consulenza', 'Manutenzione', 'IT', 'Personale', 'Beni ammortizzabili', 'Altro',
];

// Etichetta leggibile della base/tipologia di calcolo scadenze
const BASE_LABEL: Record<string, string> = {
  data_fattura: 'Data fattura',
  fine_mese: 'Fine mese',
};

// Carica TUTTE le payables del tenant con colonne leggere (mai xml_content),
// paginando a blocchi da 1000 per superare il cap righe di PostgREST. Gli
// aggregati per-fornitore e i KPI vengono poi ricalcolati lato client e
// filtrati per anno (volume tipico ~769 righe).
async function fetchAllPayables(companyId: string): Promise<Array<Record<string, unknown> & { id: string }>> {
  const pageSize = 1000;
  const all: Array<Record<string, unknown> & { id: string }> = [];
  for (let guard = 0, from = 0; guard < 50; guard++, from += pageSize) {
    const { data, error } = await supabase.from('payables')
      .select('id, supplier_id, invoice_number, invoice_date, due_date, gross_amount, amount_remaining, status, payment_method, cash_movement_id')
      .eq('company_id', companyId)
      .not('supplier_id', 'is', null)
      .order('invoice_date', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) { console.warn('payables load:', error.message); break; }
    const chunk = (data || []) as unknown as Array<Record<string, unknown> & { id: string }>;
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return all;
}

// Anno (number) dalla data ISO di una payable, o null.
function yearOf(d: unknown): number | null {
  if (!d) return null;
  const y = new Date(String(d)).getFullYear();
  return Number.isFinite(y) ? y : null;
}

export default function Fornitori() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const labels = useCompanyLabels();
  const COMPANY_ID = profile?.company_id;

  // Outlet attivi del tenant: stesso criterio della sidebar (minOutlets=2)
  // per decidere se la "Divisione tra outlet" ha senso (>=2 centri di costo).
  const { outlets: tenantOutlets } = useOutlets();
  const activeOutletCount = tenantOutlets.length;

  // Anno selezionato (selettore globale ?anno= nel layout): filtra fatturato,
  // da pagare, KPI e tab Analytics. Fonte unica di verità via usePeriod, così
  // il selettore di pagina e le pillole globali restano sincronizzati.
  const { year, setYear } = usePeriod();

  // Data state
  type SupplierRow = Record<string, unknown> & { id: string }
  type PayableRow = Record<string, unknown> & { id: string }
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  // Conti banca (sezione Banche) per la tendina "Banca di pagamento" del fornitore
  const [bankAccounts, setBankAccounts] = useState<{ id: string; label: string }[]>([]);
  // Tutte le payables del tenant (colonne leggere, NO xml_content): aggregati
  // per-fornitore e KPI calcolati lato client e filtrabili per anno. Volume
  // piccolo (~769 righe NZ); paginato per superare il cap 1000 di PostgREST.
  const [allPayables, setAllPayables] = useState<PayableRow[]>([]);
  // Modalità di divisione attiva per fornitore (supplier_id → AllocationMode).
  // Caricata con UNA query aggregata in loadData (no N+1) e aggiornata in
  // place quando si salva dal pannello Gestione.
  const [ruleModeBySupplier, setRuleModeBySupplier] = useState<Record<string, AllocationMode>>({});
  const [loading, setLoading] = useState(true);

  // UI state
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  // Filtro "Stato lavorazione": '' = Tutti | lavorare | nocat | nosplit | scaduto
  const [filterWork, setFilterWork] = useState('all');
  const [sortField, setSortField] = useState('ragione_sociale');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Pannello "Gestione" — un solo fornitore aperto alla volta.
  const [gestioneId, setGestioneId] = useState<string | null>(null);
  // Blocco "Fatture" del pannello Gestione: lista leggera caricata on-demand
  // all'apertura (mai xml_content in lista). Aggancio per supplier_vat (=P.IVA).
  type InvoiceRow = { id: string; invoice_number: string | null; invoice_date: string | null; gross_amount: number | null; tipo_documento: string | null };
  const [gestInvoices, setGestInvoices] = useState<InvoiceRow[]>([]);
  const [gestInvLoading, setGestInvLoading] = useState(false);
  const [gestPayStatus, setGestPayStatus] = useState<Record<string, string>>({}); // invoice_number → status payables
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  // Cache per riga (id fattura) dell'xml e degli allegati estratti: 1 solo fetch
  // dell'xml_content per fattura, riusato sia da "Apri" sia da "PDF".
  const [xmlCache, setXmlCache] = useState<Record<string, string>>({});
  const [allegatiCache, setAllegatiCache] = useState<Record<string, FatturaAllegato[]>>({});
  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null); // spinner per riga
  // Modali: InvoiceViewer (xml) e PdfViewer (allegato PDF in modal custom).
  const [viewerXml, setViewerXml] = useState<string | null>(null);
  const [pdfModal, setPdfModal] = useState<{ data: Uint8Array; nome: string } | null>(null);
  // activeTab persistito in URL come ?tab=… (default 'anagrafica')
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: FornitoriTab = VALID_FORNITORI_TABS.includes(tabParam as FornitoriTab)
    ? (tabParam as FornitoriTab)
    : 'anagrafica';
  const setActiveTab = (next: FornitoriTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params);
  };

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const showToast = (msg: string, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  // ─── DATA LOADING ─────────────────────────────────────────────

  useEffect(() => {
    if (!COMPANY_ID) return;
    loadData();
  }, [COMPANY_ID]);

  // Carica i conti banca attivi per la tendina del piano di pagamento
  useEffect(() => {
    if (!COMPANY_ID) return;
    (async () => {
      const { data } = await supabase.from('bank_accounts')
        .select('id, bank_name, account_name, iban')
        .eq('company_id', COMPANY_ID)
        .or('is_active.is.null,is_active.eq.true');
      setBankAccounts((data || []).map((b: Record<string, unknown>) => ({
        id: String(b.id),
        label: [b.bank_name, b.account_name].filter(Boolean).join(' · ')
          || (b.iban ? String(b.iban) : String(b.id).slice(0, 8)),
      })));
    })();
  }, [COMPANY_ID]);

  async function loadData() {
    if (!COMPANY_ID) return;
    setLoading(true);
    // Timeout di sicurezza: se una query supera 15 secondi forziamo l'uscita
    // dallo stato di loading per evitare spinner infinito (bug segnalato
    // quando l'anno selezionato nel layout non ha dati).
    const timeoutId = setTimeout(() => {
      console.warn('Fornitori.loadData timeout 15s — forzo uscita spinner');
      setLoading(false);
    }, 15000);
    try {
      const [suppRes, payables, rulesRes] = await Promise.all([
        supabase.from('suppliers').select('*')
          .eq('company_id', COMPANY_ID)
          .or('is_deleted.is.null,is_deleted.eq.false')
          .order('ragione_sociale', { ascending: true }),
        // Tutte le payables del tenant con colonne leggere (NO xml_content): gli
        // aggregati per-fornitore e i KPI sono ricalcolati lato client filtrando
        // per anno (il vecchio v_fornitori_kpi era all-time → l'anno non filtrava).
        // Paginato in blocchi da 1000 per superare il cap PostgREST.
        fetchAllPayables(COMPANY_ID),
        // Regole di divisione attive: UNA query aggregata (supplier_id +
        // allocation_mode) per popolare la colonna "Divisione" senza N+1.
        supabase.from('supplier_allocation_rules')
          .select('supplier_id, allocation_mode')
          .eq('company_id', COMPANY_ID)
          .eq('is_active', true),
      ]);

      if (suppRes.error) console.warn('suppliers load:', suppRes.error.message);
      if (rulesRes.error) console.warn('allocation rules load:', rulesRes.error.message);

      setSuppliers((suppRes.data || []) as unknown as SupplierRow[]);
      setAllPayables(payables);
      const ruleMap: Record<string, AllocationMode> = {};
      (rulesRes.data || []).forEach((r: Record<string, unknown>) => {
        const sid = r.supplier_id as string | null;
        const mode = r.allocation_mode as AllocationMode | null;
        if (sid && mode) ruleMap[sid] = mode;
      });
      setRuleModeBySupplier(ruleMap);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  // ─── PANNELLO GESTIONE ─────────────────────────────────────────

  // Categoria merceologica: salvataggio immediato su suppliers.category.
  // Aggiorna lo state locale (chip colonna Cat. + KPI copertura) senza reload.
  async function saveCategory(supplierId: string, value: string) {
    const next = value || null;
    // Aggiornamento ottimistico locale
    setSuppliers(prev => prev.map(s => s.id === supplierId ? { ...s, category: next } : s));
    const { error } = await supabase.from('suppliers')
      .update({ category: next, updated_at: new Date().toISOString() })
      .eq('id', supplierId);
    if (error) {
      console.error('saveCategory error:', error.message);
      showToast('Errore nel salvataggio categoria', 'error');
      await loadData(); // ripristina lo stato reale
      return;
    }
    showToast(next ? `Categoria "${next}" salvata` : 'Categoria rimossa');
  }

  // Toggle pannello Gestione (uno solo aperto alla volta).
  function toggleGestione(id: string) {
    setGestioneId(prev => (prev === id ? null : id));
  }

  // Callback dopo salvataggio divisione: aggiorna badge colonna senza reload.
  function onAllocationSaved(supplierId: string, mode: AllocationMode | null) {
    setRuleModeBySupplier(prev => {
      const next = { ...prev };
      if (mode) next[supplierId] = mode;
      else delete next[supplierId];
      return next;
    });
    showToast(mode ? `Divisione "${MODE_META[mode].label}" salvata` : 'Divisione rimossa');
  }

  // ─── BLOCCO FATTURE (pannello Gestione) ────────────────────────

  // P.IVA del fornitore aperto: chiave d'aggancio su electronic_invoices.supplier_vat
  // (stesso criterio di SchedaContabileFornitore). Primitiva → evita reload
  // inutili dell'effetto quando cambia il riferimento dell'array suppliers.
  const gestioneVat = useMemo(() => {
    const sup = suppliers.find(s => s.id === gestioneId);
    return String(sup?.partita_iva || sup?.vat_number || '').trim();
  }, [suppliers, gestioneId]);

  // Deep-link ?edit=<supplier_id> (dal pannello anomalie in Fatturazione):
  // apre direttamente la scheda di modifica del fornitore.
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || suppliers.length === 0) return;
    const sup = suppliers.find(s => s.id === editId);
    if (sup) {
      openEdit(sup);
      const params = new URLSearchParams(searchParams);
      params.delete('edit');
      setSearchParams(params, { replace: true });
    }
  }, [suppliers, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carica lista fatture + stato payables SOLO all'apertura del pannello.
  useEffect(() => {
    if (!gestioneId || !COMPANY_ID) { setGestInvoices([]); setGestPayStatus({}); setShowAllInvoices(false); return; }
    let cancelled = false;
    setShowAllInvoices(false);
    setGestInvLoading(true);
    (async () => {
      // Senza P.IVA non c'è chiave d'aggancio affidabile → lista vuota.
      if (!gestioneVat) {
        if (!cancelled) { setGestInvoices([]); setGestPayStatus({}); setGestInvLoading(false); }
        return;
      }
      const [invRes, payRes] = await Promise.all([
        // Mai xml_content nella lista (trascina megabyte → timeout).
        supabase.from('electronic_invoices')
          .select('id, invoice_number, invoice_date, gross_amount, tipo_documento')
          .eq('company_id', COMPANY_ID)
          .eq('supplier_vat', gestioneVat)
          .order('invoice_date', { ascending: false })
          .limit(1000),
        supabase.from('payables')
          .select('invoice_number, status')
          .eq('company_id', COMPANY_ID)
          .eq('supplier_id', gestioneId)
          .limit(1000),
      ]);
      if (cancelled) return;
      if (invRes.error) console.warn('gestione invoices load:', invRes.error.message);
      if (payRes.error) console.warn('gestione payables load:', payRes.error.message);
      setGestInvoices((invRes.data || []) as unknown as InvoiceRow[]);
      const sm: Record<string, string> = {};
      (payRes.data || []).forEach((p: Record<string, unknown>) => {
        const num = p.invoice_number as string | null;
        const st = p.status as string | null;
        if (num && st && !sm[num]) sm[num] = st;
      });
      setGestPayStatus(sm);
      setGestInvLoading(false);
    })();
    return () => { cancelled = true; };
  }, [gestioneId, gestioneVat, COMPANY_ID]);

  // Fetch on-demand del solo xml_content di una fattura, con cache per riga.
  // Popola anche allegatiCache così "PDF" sa se mostrare/abilitare il bottone.
  async function fetchXml(id: string): Promise<string | null> {
    if (xmlCache[id]) return xmlCache[id];
    const { data, error } = await supabase.from('electronic_invoices')
      .select('xml_content')
      .eq('id', id)
      .not('xml_content', 'is', null)
      .maybeSingle();
    if (error) { console.warn('xml load:', error.message); return null; }
    const xml = (data?.xml_content as string | undefined) || null;
    if (xml) {
      setXmlCache(prev => ({ ...prev, [id]: xml }));
      setAllegatiCache(prev => ({ ...prev, [id]: parseFatturaAllegati(xml) }));
    }
    return xml;
  }

  // "Apri": scarica l'xml e apre InvoiceViewer.
  async function handleOpenInvoice(inv: InvoiceRow) {
    setBusyInvoiceId(inv.id);
    const xml = await fetchXml(inv.id);
    setBusyInvoiceId(null);
    if (xml) setViewerXml(xml);
    else showToast('XML non disponibile per questa fattura', 'error');
  }

  // "PDF": scarica l'xml (se non in cache), estrae l'allegato. Se è un PDF lo
  // apre nel PdfViewer; se è un altro formato lo scarica; se non c'è, avvisa.
  async function handleOpenPdf(inv: InvoiceRow) {
    setBusyInvoiceId(inv.id);
    const xml = await fetchXml(inv.id);
    setBusyInvoiceId(null);
    if (!xml) { showToast('XML non disponibile per questa fattura', 'error'); return; }
    const allegati = allegatiCache[inv.id] ?? parseFatturaAllegati(xml);
    const pdf = allegati.find(a => a.isPdf);
    if (pdf) {
      const nome = /\.pdf$/i.test(pdf.nome) ? pdf.nome : `${pdf.nome}.pdf`;
      setPdfModal({ data: pdf.data, nome });
    } else if (allegati.length > 0) {
      downloadBytes(allegati[0].data, allegati[0].nome);
      showToast(`Allegato "${allegati[0].nome}" scaricato`);
    } else {
      showToast('Nessun PDF allegato a questa fattura', 'error');
    }
  }

  // Copia disposable per pdf.js (può consumare il buffer): la sorgente in
  // pdfModal.data resta intatta per il pulsante "Scarica PDF".
  const pdfViewerData = useMemo(() => (pdfModal ? pdfModal.data.slice() : null), [pdfModal]);

  // ─── COMPUTED DATA ────────────────────────────────────────────

  // Aggregati per-fornitore calcolati lato client dalle payables FILTRATE per
  // anno (invoice_date). Replica la logica del vecchio v_fornitori_kpi ma resa
  // anno-consapevole: al cambio anno fatturato/da pagare/scaduto si aggiornano.
  interface SupplierStat { total: number; paid: number; pending: number; overdue: number; count: number; lastDate: string | null; grossTotal: number; methods: Set<string>; paidCount: number; reconciledCount: number }
  const CLOSED = ['pagato', 'annullato', 'bloccato'];
  const supplierStats = useMemo<Record<string, SupplierStat>>(() => {
    const stats: Record<string, SupplierStat> = {};
    for (const p of allPayables) {
      if (yearOf(p.invoice_date) !== year) continue;
      const key = p.supplier_id as string | null;
      if (!key) continue;
      const s = stats[key] || (stats[key] = { total: 0, paid: 0, pending: 0, overdue: 0, count: 0, lastDate: null, grossTotal: 0, methods: new Set<string>(), paidCount: 0, reconciledCount: 0 });
      const gross = Number(p.gross_amount) || 0;
      const remaining = Number(p.amount_remaining) || 0;
      const status = String(p.status || '');
      s.count++;
      s.grossTotal += gross;
      if (status === 'pagato') { s.paid += gross; s.paidCount++; if (p.cash_movement_id) s.reconciledCount++; }
      if (status === 'scaduto') s.overdue += remaining;
      if (!CLOSED.includes(status)) s.pending += remaining;
      if (p.payment_method) s.methods.add(String(p.payment_method));
      const d = p.invoice_date ? String(p.invoice_date) : null;
      if (d && (!s.lastDate || d > s.lastDate)) s.lastDate = d;
    }
    return stats;
  }, [allPayables, year]);

  // Filtered & sorted suppliers
  const filteredSuppliers = useMemo(() => {
    let list = [...suppliers];

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        String(s.ragione_sociale || s.name || '').toLowerCase().includes(q) ||
        String(s.partita_iva || s.vat_number || '').includes(q) ||
        String(s.category || '').toLowerCase().includes(q) ||
        String(s.citta || '').toLowerCase().includes(q)
      );
    }

    // Category filter
    if (filterCategory === '__none') {
      list = list.filter(s => !s.category);
    } else if (filterCategory !== 'all') {
      list = list.filter(s => s.category === filterCategory);
    }

    // Status filter
    if (filterStatus === 'attivi') list = list.filter(s => s.is_active !== false);
    if (filterStatus === 'inattivi') list = list.filter(s => s.is_active === false);

    // Stato lavorazione: copertura categoria / divisione / scaduto.
    if (filterWork !== 'all') {
      list = list.filter(s => {
        const hasCat = !!s.category;
        const hasDiv = !!ruleModeBySupplier[s.id];
        const overdue = (supplierStats[s.id]?.overdue || 0) > 0;
        switch (filterWork) {
          case 'lavorare': return !hasCat || !hasDiv;
          case 'nocat':    return !hasCat;
          case 'nosplit':  return !hasDiv;
          case 'scaduto':  return overdue;
          default:         return true;
        }
      });
    }

    // Sort: gestito da useTableSort (vedi sotto). Mantengo lo state
    // sortField/sortDir solo per backward-compat con l'export e le legacy
    // chiamate; il vero ordinamento e' applicato sulla 'sorted' del hook.
    return list;
  }, [suppliers, search, filterCategory, filterStatus, filterWork, ruleModeBySupplier, supplierStats]);

  // Sort tabella fornitori — modello standard SortableTh
  const { sorted: sortedSuppliers, sortBy: suSortBy, onSort: suOnSort, reset: suResetSort } = useTableSort(
    filteredSuppliers,
    [{ key: 'ragione_sociale', dir: 'asc' }],
    { persistKey: 'fornitori_anagrafica' }
  );

  // Anni disponibili: ricavati dai dati (invoice_date delle payables), mai
  // hardcoded. Includo sempre l'anno selezionato così il selettore lo mostra
  // anche se quell'anno non ha ancora payables (empty-state coerente).
  const availableYears = useMemo(() => {
    const set = new Set<number>();
    for (const p of allPayables) { const y = yearOf(p.invoice_date); if (y) set.add(y); }
    set.add(year);
    return Array.from(set).sort((a, b) => b - a);
  }, [allPayables, year]);

  // Etichetta banca per id (per dettaglio fornitore + export piano pagamento)
  const bankLabelById = useMemo(() => {
    const m: Record<string, string> = {};
    bankAccounts.forEach(b => { m[b.id] = b.label; });
    return m;
  }, [bankAccounts]);

  // Dati export: metodo/piano in forma leggibile, così Sabrina può verificare
  // la modalità e la tipologia caricate su ogni fornitore (Excel/CSV).
  const suppliersForExport = useMemo(() => filteredSuppliers.map(s => {
    const metodoRaw = String(s.payment_method || s.default_payment_method || '');
    const hasPiano = !!s.payment_base;
    return {
      ...s,
      _metodo: PAYMENT_LABEL[metodoRaw] || metodoRaw || '—',
      _base: hasPiano ? (BASE_LABEL[String(s.payment_base)] || String(s.payment_base)) : '—',
      _prima_gg: hasPiano && s.prima_scadenza_gg != null ? String(s.prima_scadenza_gg) : '',
      _rate: hasPiano && s.numero_rate != null ? String(s.numero_rate) : '',
      _banca: s.payment_bank_account_id ? (bankLabelById[String(s.payment_bank_account_id)] || '—') : '—',
    };
  }), [filteredSuppliers, bankLabelById]);

  // KPIs dell'anno selezionato — totali coerenti fra loro, dalle payables filtrate:
  // - totalFatturato: somma gross_amount POSITIVI (esclude note credito negative).
  // - totalPending: amount_remaining di fatture non chiuse (escluse anche NC).
  // - overdue: amount_remaining scaduto. - payCount: n. fatture dell'anno.
  const kpis = useMemo(() => {
    const active = suppliers.filter(s => s.is_active !== false).length;
    let totalPending = 0, overdue = 0, totalFatturato = 0, totalCrediti = 0, payCount = 0;
    const suppliersWithPayables = new Set<string>();
    for (const p of allPayables) {
      if (yearOf(p.invoice_date) !== year) continue;
      const gross = Number(p.gross_amount) || 0;
      const remaining = Number(p.amount_remaining) || 0;
      const status = String(p.status || '');
      const isNC = status === 'nota_credito' || gross < 0;
      payCount++;
      if (p.supplier_id) suppliersWithPayables.add(p.supplier_id as string);
      if (!isNC && gross > 0) totalFatturato += gross;        // gross positivi, escluse NC
      if (isNC) totalCrediti += Math.abs(gross);              // abs note credito
      if (status === 'scaduto') overdue += remaining;         // remaining scadute
      if (!CLOSED.includes(status) && !isNC) totalPending += remaining; // remaining aperte escluse NC
    }
    // Copertura lavorazione (sul totale fornitori, non filtrato per anno)
    const withCategory = suppliers.filter(s => !!s.category).length;
    const withDivision = suppliers.filter(s => !!ruleModeBySupplier[s.id]).length;
    return { active, total: suppliers.length, totalPending, overdue, totalFatturato, totalCrediti, payCount, withPayables: suppliersWithPayables.size, withCategory, withDivision };
  }, [suppliers, allPayables, year, ruleModeBySupplier]);

  // Charts data
  interface CatBucket { name: string; value: number; count: number }
  const spendByCategory = useMemo<CatBucket[]>(() => {
    const map: Record<string, CatBucket> = {};
    suppliers.forEach(s => {
      const cat = String(s.category || 'Non categorizzato');
      if (!map[cat]) map[cat] = { name: cat, value: 0, count: 0 };
      const stats = supplierStats[s.id] || { grossTotal: 0 } as SupplierStat;
      map[cat].value += stats.grossTotal;
      map[cat].count++;
    });
    return Object.values(map).filter(c => c.value > 0).sort((a, b) => b.value - a.value);
  }, [suppliers, supplierStats]);

  const topSuppliersBySpend = useMemo(() => {
    return suppliers
      .map(s => {
        const stats = supplierStats[s.id] || { grossTotal: 0 } as SupplierStat;
        return { name: String(s.ragione_sociale || s.name || '').substring(0, 20), value: stats.grossTotal };
      })
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [suppliers, supplierStats]);

  // ─── CRUD OPERATIONS ──────────────────────────────────────────

  function openNew() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  }

  function openEdit(supplier: SupplierRow) {
    const s = supplier as Record<string, unknown>
    const str = (k: string) => (s[k] != null ? String(s[k]) : '')
    const num = (k: string, fallback: number) => (s[k] != null ? Number(s[k]) : fallback)
    setEditingId(supplier.id);
    setForm({
      ragione_sociale: str('ragione_sociale') || str('name'),
      partita_iva: str('partita_iva') || str('vat_number'),
      codice_fiscale: str('codice_fiscale') || str('fiscal_code'),
      codice_sdi: str('codice_sdi'),
      pec: str('pec'),
      email: str('email'),
      telefono: str('telefono'),
      iban: str('iban'),
      indirizzo: str('indirizzo'),
      citta: str('citta'),
      provincia: str('provincia'),
      cap: str('cap'),
      category: str('category'),
      payment_terms: num('payment_terms', num('default_payment_terms', 30)),
      // Normalizza i valori legacy della colonna text (es. 'bonifico') verso l'enum
      // valido: senza questo, aprire e salvare un fornitore storico scriverebbe un
      // valore non-enum su default_payment_method e il salvataggio fallirebbe.
      payment_method: normalizePaymentMethod(str('payment_method'))
        || normalizePaymentMethod(str('default_payment_method'))
        || DEFAULT_PAYMENT_METHOD,
      cost_center: str('cost_center') || 'all',
      note: str('note') || str('notes'),
      payment_base: str('payment_base'),
      prima_scadenza_gg: num('prima_scadenza_gg', 30),
      numero_rate: num('numero_rate', 1),
      payment_bank_account_id: str('payment_bank_account_id'),
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.ragione_sociale.trim()) { showToast('Ragione sociale obbligatoria', 'error'); return; }
    // Banca obbligatoria per metodi che escono da un conto specifico (RiBa/RID/SDD/carta):
    // serve per lo storno nelle simulazioni di cashflow. Blocca al salvataggio invece di
    // lasciar passare una config incompleta (che poi genererebbe l'anomalia 'banca_mancante').
    if (isBankRequired(form.payment_method) && !form.payment_bank_account_id) {
      showToast(`Con metodo ${PAYMENT_LABEL[form.payment_method] || form.payment_method} la banca di pagamento è obbligatoria`, 'error');
      return;
    }
    setSaving(true);

    try {
      const record = {
        company_id: COMPANY_ID,
        ragione_sociale: form.ragione_sociale.trim(),
        name: form.ragione_sociale.trim(), // keep both fields in sync
        partita_iva: form.partita_iva.trim() || null,
        vat_number: form.partita_iva.trim() || null,
        codice_fiscale: form.codice_fiscale.trim() || null,
        fiscal_code: form.codice_fiscale.trim() || null,
        codice_sdi: form.codice_sdi.trim() || null,
        pec: form.pec.trim() || null,
        email: form.email.trim() || null,
        telefono: form.telefono.trim() || null,
        iban: form.iban.trim() || null,
        indirizzo: form.indirizzo.trim() || null,
        citta: form.citta.trim() || null,
        provincia: form.provincia.trim() || null,
        cap: form.cap.trim() || null,
        category: form.category || null,
        payment_terms: parseInt(String(form.payment_terms)) || 30,
        default_payment_terms: parseInt(String(form.payment_terms)) || 30,
        payment_method: form.payment_method || DEFAULT_PAYMENT_METHOD,
        default_payment_method: form.payment_method || DEFAULT_PAYMENT_METHOD,
        // Piano rate scadenze (v2)
        payment_base: form.payment_base || null,
        prima_scadenza_gg: Number(form.prima_scadenza_gg) || null,
        numero_rate: Number(form.numero_rate) || null,
        payment_bank_account_id: form.payment_bank_account_id || null,
        cost_center: form.cost_center || 'all',
        note: form.note.trim() || null,
        notes: form.note.trim() || null,
        is_active: true,
        is_deleted: false,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase.from('suppliers').update(record as never).eq('id', editingId);
        if (error) throw error;
        showToast('Fornitore aggiornato');
      } else {
        const { error } = await supabase.from('suppliers').insert(record as never);
        if (error) throw error;
        showToast('Fornitore creato');
      }

      setShowModal(false);
      await loadData();
    } catch (err: unknown) {
      console.error('Save error:', err);
      showToast('Errore: ' + (err instanceof Error ? err.message : ''), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Disattivare questo fornitore?')) return;
    try {
      await supabase.from('suppliers').update({ is_deleted: true, is_active: false }).eq('id', id);
      showToast('Fornitore disattivato');
      await loadData();
    } catch (err) {
      showToast('Errore eliminazione', 'error');
    }
  }

  function toggleSort(field: string) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  // Export CSV
  function exportCSV() {
    const headers = ['Ragione Sociale', 'P.IVA', 'Cod.Fiscale', 'SDI', 'PEC', 'Email', 'Telefono', 'IBAN', 'Indirizzo', 'Città', 'Provincia', 'CAP', 'Categoria', 'Termini Pag.', 'Metodo Pag.'];
    const rows = filteredSuppliers.map(s => [
      s.ragione_sociale || s.name, s.partita_iva || s.vat_number, s.codice_fiscale || s.fiscal_code,
      s.codice_sdi, s.pec, s.email, s.telefono, s.iban,
      s.indirizzo, s.citta, s.provincia, s.cap, s.category,
      s.payment_terms || s.default_payment_terms, s.payment_method || s.default_payment_method,
    ]);
    const csv = [headers.join(';'), ...rows.map(r => r.map(v => `"${v || ''}"`).join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Fornitori_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  // ─── HELPER: get supplier display name ────────────────────────
  const getName = (s: SupplierRow) => String(s.ragione_sociale || s.name || 'N/D');
  const getVat = (s: SupplierRow) => String(s.partita_iva || s.vat_number || '');

  // ─── DETTAGLIO + PANNELLO GESTIONE ────────────────────────────
  // Estratti in funzioni di render perché sono usati in DUE punti: nella riga
  // espansa della tabella desktop e dentro le card della vista mobile.
  const renderSupplierDetail = (s: SupplierRow) => {
    const name = getName(s);
    const vat = getVat(s);
    const stats = supplierStats[s.id] || { grossTotal: 0, overdue: 0, pending: 0, paid: 0, count: 0, lastDate: null, methods: new Set(), paidCount: 0, reconciledCount: 0 };
    // Scadenze del fornitore dell'anno selezionato, derivate da
    // allPayables (già ordinate per invoice_date desc) — coerenti
    // con KPI e statistiche year-aware.
    const supplierPays = allPayables.filter(p => p.supplier_id === s.id && yearOf(p.invoice_date) === year);
    const avgAmount = supplierPays.length > 0
      ? supplierPays.reduce((acc, p) => acc + (Number(p.gross_amount) || 0), 0) / supplierPays.length
      : 0;
    // Scadenze ancora DA PAGARE (esclude pagate, annullate, note di
    // credito e residui a zero), ordinate dalla piu' recente. Le
    // scadute vanno in cima. Serve per il riquadro qui sotto.
    const openPays = supplierPays
      .filter(p => !['pagato', 'annullato', 'nota_credito'].includes(String(p.status)))
      .filter(p => (Number(p.amount_remaining ?? p.gross_amount) || 0) > 0)
      .sort((a, b) => {
        const sa = a.status === 'scaduto' ? 0 : 1;
        const sb = b.status === 'scaduto' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return new Date(String(b.due_date || '')).getTime() - new Date(String(a.due_date || '')).getTime();
      });
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Col 1: Anagrafica completa */}
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5">
            <Building2 size={14} className="text-indigo-500" /> Anagrafica
          </h4>
          <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5 text-sm">
            <Detail label="Ragione Sociale" value={name} />
            <Detail label="P.IVA" value={vat} mono />
            <Detail label="Cod. Fiscale" value={(s.codice_fiscale || s.fiscal_code) as string | null | undefined} mono />
            <Detail label="Codice SDI" value={s.codice_sdi as string | null | undefined} mono />
            <Detail label="PEC" value={s.pec as string | null | undefined} />
            <Detail label="IBAN" value={s.iban as string | null | undefined} mono />
            <div className="border-t border-slate-100 pt-1.5 mt-1.5" />
            <Detail label="Indirizzo" value={s.indirizzo as string | null | undefined} />
            <Detail label="Città" value={[s.cap, s.citta, s.provincia ? `(${s.provincia})` : ''].filter(Boolean).join(' ')} />
            <Detail label="Email" value={s.email as string | null | undefined} />
            <Detail label="Telefono" value={s.telefono as string | null | undefined} />
          </div>
        </div>
        {/* Col 2: Condizioni & classificazione */}
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5">
            <CreditCard size={14} className="text-indigo-500" /> Condizioni
          </h4>
          <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5 text-sm">
            <Detail label="Termini pag." value={`${(s.payment_terms as number | null) || (s.default_payment_terms as number | null) || 30} giorni`} />
            <Detail label="Metodo pag." value={PAYMENT_LABEL[String(s.payment_method || s.default_payment_method || '')] || (s.payment_method as string | null) || (s.default_payment_method as string | null) || '—'} />
            <Detail label="Base scadenze" value={s.payment_base ? (BASE_LABEL[String(s.payment_base)] || String(s.payment_base)) : '—'} />
            <Detail label="1ª scadenza" value={s.payment_base && s.prima_scadenza_gg != null ? `${s.prima_scadenza_gg} gg` : '—'} />
            <Detail label="N° rate" value={s.payment_base && s.numero_rate != null ? String(s.numero_rate) : '—'} />
            <Detail label="Banca pag." value={s.payment_bank_account_id ? (bankLabelById[String(s.payment_bank_account_id)] || '—') : '—'} />
            <Detail label="Categoria" value={s.category as string | null | undefined} />
            <Detail label="Centro costo" value={s.cost_center === 'all' ? `Tutti gli ${labels.pointOfSalePluralLower}` : (s.cost_center as string | null | undefined)} />
            <Detail label="Stato" value={s.is_active !== false ? '✓ Attivo' : '✗ Disattivato'} />
            {(s.note || s.notes) ? (
              <>
                <div className="border-t border-slate-100 pt-1.5 mt-1.5" />
                <div className="text-xs text-slate-500 italic">{String(s.note || s.notes || '')}</div>
              </>
            ) : null}
          </div>
        </div>
        {/* Col 3: Statistiche & ultime fatture */}
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5">
            <BarChart3 size={14} className="text-indigo-500" /> Statistiche
          </h4>
          <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5 text-sm">
            <Detail label="Tot. fatture" value={stats.count || 0} />
            <Detail label="Tot. fatturato" value={stats.grossTotal > 0 ? `€ ${stats.grossTotal.toLocaleString('de-DE', { minimumFractionDigits: 2 })}` : '—'} />
            <Detail label="Già pagato" value={stats.paid > 0 ? `€ ${stats.paid.toLocaleString('de-DE', { minimumFractionDigits: 2 })}` : '—'} />
            {stats.paidCount > 0 && (
              <Detail label="Riconciliati" value={`${stats.reconciledCount}/${stats.paidCount} in banca`} />
            )}
            <Detail label="Da pagare" value={stats.pending > 0 ? `€ ${stats.pending.toLocaleString('de-DE', { minimumFractionDigits: 2 })}` : '—'} />
            {stats.overdue > 0 && (
              <div className="flex">
                <span className="text-red-500 w-28 shrink-0 text-xs font-medium">Scaduto</span>
                <span className="text-red-600 text-xs font-semibold">€ {stats.overdue.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            {avgAmount > 0 && (
              <Detail label="Media fattura" value={`€ ${avgAmount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            )}
            {stats.lastDate && (
              <Detail label="Ultima fattura" value={new Date(stats.lastDate).toLocaleDateString('it-IT')} />
            )}
          </div>
          {/* Scadenze ancora da pagare (max 5, scadute in cima) */}
          {openPays.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Scadenze da pagare</h4>
              <div className="space-y-1">
                {openPays.slice(0, 5).map((pay, i) => (
                  <div key={i} className="bg-white rounded border border-slate-200 px-2.5 py-1.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        pay.status === 'scaduto' ? 'bg-red-400' : 'bg-amber-400'
                      }`} />
                      <TextTooltip content={String(pay.invoice_number || '')}>
                        <span className="font-medium text-slate-700 truncate">{String(pay.invoice_number || '')}</span>
                      </TextTooltip>
                      <span className="text-slate-400">{pay.due_date ? new Date(String(pay.due_date)).toLocaleDateString('it-IT') : ''}</span>
                    </div>
                    <span className="font-semibold text-slate-700 shrink-0 ml-2">€ {(Number(pay.amount_remaining ?? pay.gross_amount) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
                {openPays.length > 5 && (
                  <div className="text-xs text-slate-400 text-center pt-0.5">+ altre {openPays.length - 5} da pagare</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderGestionePanel = (s: SupplierRow) => {
    const name = getName(s);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
          <span className="inline-flex items-center px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-[11px] font-semibold border border-violet-200">Pannello Gestione</span>
          <span className="font-medium text-slate-700">{name}</span>
          <span>— categoria, divisione e fatture nello stesso punto</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-4">
          {/* Blocco A — Categoria merceologica */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><Tag size={15} className="text-violet-600" /> Categoria merceologica</h3>
            <select
              value={String(s.category || '')}
              onChange={e => saveCategory(s.id, e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
            >
              <option value="">— scegli categoria —</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-[11.5px] text-slate-400 mt-2 leading-relaxed">Salvataggio immediato sull'anagrafica fornitore. Alimenta il grafico "Spesa per categoria" del tab Analytics.</p>
          </div>

          {/* Blocco B — Divisione tra outlet */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><Split size={15} className="text-violet-600" /> Divisione tra {labels.pointOfSalePluralLower}</h3>
            {activeOutletCount >= 2 ? (
              <SupplierAllocationEditor
                supplierId={s.id}
                onSaved={(m) => onAllocationSaved(s.id, m)}
                onCancel={() => setGestioneId(null)}
              />
            ) : (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 leading-relaxed">
                La divisione tra {labels.pointOfSalePluralLower} è disponibile solo con almeno 2 {labels.pointOfSalePluralLower} attivi.
                {activeOutletCount === 1 ? ` Questo tenant ne ha 1: tutti i costi sono attribuiti all'unica sede.` : ' Nessun outlet attivo configurato.'}
              </p>
            )}
          </div>
        </div>

        {/* Blocco C — Fatture del fornitore */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <FileText size={15} className="text-violet-600" /> Fatture del fornitore
            {!gestInvLoading && gestInvoices.length > 0 && (
              <span className="font-normal text-slate-400">({Math.min(gestInvoices.length, showAllInvoices ? gestInvoices.length : 20)} di {gestInvoices.length})</span>
            )}
          </h3>
          {gestInvLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Caricamento fatture…</div>
          ) : gestInvoices.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              {getVat(s) ? 'Nessuna fattura elettronica per questo fornitore.' : 'Fornitore senza P.IVA: impossibile agganciare le fatture elettroniche.'}
            </p>
          ) : (
            <TableScroll>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="py-1.5 px-2 font-semibold">Numero</th>
                    <th className="py-1.5 px-2 font-semibold">Data</th>
                    <th className="py-1.5 px-2 font-semibold text-right">Importo</th>
                    <th className="py-1.5 px-2 font-semibold text-center">Tipo</th>
                    <th className="py-1.5 px-2 font-semibold text-center">Stato</th>
                    <th className="py-1.5 px-2 font-semibold text-center">Documento</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllInvoices ? gestInvoices : gestInvoices.slice(0, 20)).map(inv => {
                    const amt = Number(inv.gross_amount) || 0;
                    const st = inv.invoice_number ? gestPayStatus[inv.invoice_number] : undefined;
                    const stInfo = st === 'pagato' ? { t: 'Pagata', c: 'bg-emerald-100 text-emerald-700' }
                      : st === 'scaduto' ? { t: 'Scaduta', c: 'bg-red-100 text-red-700' }
                      : st ? { t: 'In scadenza', c: 'bg-amber-100 text-amber-700' }
                      : { t: '—', c: 'bg-slate-100 text-slate-400' };
                    const allg = allegatiCache[inv.id];
                    const known = allg !== undefined;
                    const hasAttach = known && allg.length > 0;
                    const busy = busyInvoiceId === inv.id;
                    return (
                      <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="py-1.5 px-2 font-mono text-xs text-slate-700">
                          <TextTooltip content={String(inv.invoice_number || '')}>
                            <span className="truncate inline-block max-w-[160px] align-bottom">{inv.invoice_number || '—'}</span>
                          </TextTooltip>
                        </td>
                        <td className="py-1.5 px-2 text-slate-500 text-xs whitespace-nowrap">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('it-IT') : '—'}</td>
                        <td className={`py-1.5 px-2 text-right font-semibold whitespace-nowrap ${amt < 0 ? 'text-red-600' : 'text-slate-700'}`}>€ {amt.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="py-1.5 px-2 text-center"><span className="text-[10.5px] font-mono text-slate-500">{inv.tipo_documento || '—'}</span></td>
                        <td className="py-1.5 px-2 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${stInfo.c}`}>{stInfo.t}</span></td>
                        <td className="py-1.5 px-2">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenInvoice(inv)}
                              disabled={busy}
                              className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-200 rounded-md text-[11.5px] font-medium text-slate-600 hover:border-slate-400 disabled:opacity-50"
                              title="Apri la fattura elettronica formattata"
                            >
                              {busy ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} Apri
                            </button>
                            {(!known || hasAttach) ? (
                              <button
                                onClick={() => handleOpenPdf(inv)}
                                disabled={busy}
                                className="inline-flex items-center gap-1 px-2.5 py-1 border border-violet-200 bg-violet-50 rounded-md text-[11.5px] font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                                title="Apri il PDF allegato alla fattura"
                              >
                                {busy ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} PDF
                              </button>
                            ) : (
                              // Nessun allegato: il bottone resta cliccabile a fini
                              // informativi — spiega col toast (oltre al tooltip) che
                              // l'assenza del PDF non è un errore. L'utente non deve
                              // ricordarsi le spiegazioni: le dà il sistema nel dubbio.
                              <TextTooltip content="Nessun PDF allegato a questa fattura">
                                <button
                                  onClick={() => showToast("Questo fornitore non ha allegato il PDF alla fattura elettronica. Non è un errore: puoi vedere la fattura con 'Apri'.", 'info')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-100 rounded-md text-[11.5px] font-medium text-slate-300 hover:text-slate-500 hover:border-slate-200"
                                >
                                  <Paperclip size={12} /> PDF
                                </button>
                              </TextTooltip>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {gestInvoices.length > 20 && !showAllInvoices && (
                <button onClick={() => setShowAllInvoices(true)} className="mt-2 text-xs font-medium text-violet-600 hover:text-violet-800">
                  Mostra tutte ({gestInvoices.length})
                </button>
              )}
              <p className="text-[11.5px] text-slate-400 mt-2 leading-relaxed">"Apri" mostra la fattura XML formattata (stampa/PDF, download XML). "PDF" apre l'eventuale allegato della fattura senza uscire dalla pagina.</p>
            </TableScroll>
          )}
        </div>
      </div>
    );
  };

  // ─── RENDER ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Fornitori"
        subtitle="Gestione fornitori, condizioni di pagamento, analisi spesa"
        noDivider
        actions={
          <>
            <ExportMenu
              data={suppliersForExport}
              columns={[
                { key: 'ragione_sociale', label: 'Ragione Sociale' },
                { key: 'partita_iva', label: 'P.IVA' },
                { key: 'codice_fiscale', label: 'Cod. Fiscale' },
                { key: 'codice_sdi', label: 'SDI' },
                { key: 'pec', label: 'PEC' },
                { key: 'email', label: 'Email' },
                { key: 'telefono', label: 'Telefono' },
                { key: 'iban', label: 'IBAN' },
                { key: 'category', label: 'Categoria' },
                { key: 'payment_terms', label: 'Termini Pag.' },
                { key: '_metodo', label: 'Modalità Pag.' },
                { key: '_base', label: 'Base scadenze' },
                { key: '_prima_gg', label: '1ª scad. (gg)' },
                { key: '_rate', label: 'N° rate' },
                { key: '_banca', label: 'Banca pag.' },
              ]}
              filename={`Fornitori_${new Date().toISOString().slice(0, 10)}`}
              title="Fornitori"
            />
            <button onClick={() => navigate('/fornitori/revisione')} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 flex items-center gap-2 shadow-sm" title="Rivedi metodo, scadenze e banca di tutti i fornitori">
              <SlidersHorizontal size={16} /> Revisione pagamenti
            </button>
            <button onClick={openNew} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 flex items-center gap-2 shadow-sm">
              <Plus size={16} /> Nuovo Fornitore
            </button>
          </>
        }
      />

      {/* SELETTORE ANNO (anni dai dati) — filtra fatturato, da pagare, KPI, Analytics */}
      <div className="flex items-center gap-2">
        <Calendar size={16} className="text-slate-400" />
        <label htmlFor="fornitori-anno" className="text-sm text-slate-500">Anno</label>
        <select
          id="fornitori-anno"
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 bg-white"
        >
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="text-xs text-slate-400">dati {year}</span>
      </div>

      {/* KPI CARDS — riga unica, nessun numero ripetuto */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard icon={Building2} label="Fornitori" value={kpis.total} sub={`${kpis.active} attivi`} color="indigo" />
        <KpiCard icon={Tag} label="Con categoria" value={`${kpis.withCategory} / ${kpis.total}`} color="purple" />
        <KpiCard icon={Split} label="Con divisione" value={`${kpis.withDivision} / ${kpis.total}`} color="purple" />
        <KpiCard icon={AlertTriangle} label="Scaduto" value={`€ ${kpis.overdue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} color={kpis.overdue > 0 ? 'red' : 'green'} />
        <KpiCard icon={FileText} label="Totale fatture" value={`€ ${kpis.totalFatturato.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} sub={`${kpis.payCount.toLocaleString('de-DE')} fatture`} color="blue" />
      </div>

      {/* TAB NAV */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {([
          { id: 'anagrafica', label: 'Anagrafica', icon: Building2 },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition ${
              activeTab === tab.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ANAGRAFICA TAB */}
      {activeTab === 'anagrafica' && (
        <div className="space-y-4">
          {/* FILTERS */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca per nome, P.IVA, città..."
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              />
            </div>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600">
              <option value="all">Tutte le categorie</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__none">Senza categoria</option>
            </select>
            <select value={filterWork} onChange={e => setFilterWork(e.target.value)} className="px-3 py-2.5 border border-indigo-200 bg-indigo-50/40 rounded-lg text-sm text-indigo-700">
              <option value="all">Stato: tutti</option>
              <option value="lavorare">Da lavorare (senza cat. o divisione)</option>
              <option value="nocat">Senza categoria</option>
              <option value="nosplit">Senza divisione</option>
              <option value="scaduto">Con scaduto</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600">
              <option value="all">Tutti</option>
              <option value="attivi">Attivi</option>
              <option value="inattivi">Disattivati</option>
            </select>
          </div>

          {/* SUPPLIER LIST */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            {suSortBy.length > 0 && !(suSortBy.length === 1 && suSortBy[0].key === 'ragione_sociale' && suSortBy[0].dir === 'asc') && (
              <div className="px-3 py-1.5 bg-blue-50/50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-2">
                <span>Ordinamento personalizzato attivo</span>
                <button onClick={suResetSort} className="ml-auto text-blue-600 hover:text-blue-800 font-medium">Reset</button>
              </div>
            )}
            {/* Table (solo desktop: sotto md c'è la vista a schede) */}
            <TableScroll wrapperClassName="hidden md:block">
            <table className="w-full text-sm min-w-[920px]">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  <SortableTh sortKey="ragione_sociale" sortBy={suSortBy} onSort={suOnSort}>Fornitore</SortableTh>
                  <SortableTh sortKey="partita_iva" sortBy={suSortBy} onSort={suOnSort}>P.IVA</SortableTh>
                  <SortableTh sortKey="category" sortBy={suSortBy} onSort={suOnSort} align="center">Cat.</SortableTh>
                  <th className="px-3 py-2.5 text-center text-[11px] uppercase tracking-wider font-semibold text-indigo-600">Divisione</th>
                  <SortableTh sortKey="payment_method" sortBy={suSortBy} onSort={suOnSort} align="center">Metodo</SortableTh>
                  <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider font-semibold text-slate-500">Fatturato</th>
                  <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider font-semibold text-slate-500">Da pagare</th>
                  <th className="px-3 py-2.5 text-center text-[11px] uppercase tracking-wider font-semibold text-slate-500">Banca</th>
                  <th className="px-3 py-2.5 text-center text-[11px] uppercase tracking-wider font-semibold text-slate-500 w-20">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">

            {/* Table rows */}
            {sortedSuppliers.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-12 text-center">
                  <Building2 className="mx-auto text-slate-300 mb-3" size={48} />
                  <p className="text-slate-500 font-medium">Nessun fornitore trovato</p>
                  <p className="text-slate-400 text-sm mt-1">
                    {suppliers.length === 0
                      ? 'Importa fatture XML dall\'Import Hub per creare fornitori automaticamente'
                      : 'Prova a modificare i filtri di ricerca'}
                  </p>
                  {suppliers.length === 0 && (
                    <a href="/import-hub" className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-100">
                      <ExternalLink size={16} /> Vai all'Import Hub
                    </a>
                  )}
                </td>
              </tr>
            ) : (
              <>
                {sortedSuppliers.map(s => {
                  const name = getName(s);
                  const vat = getVat(s);
                  const stats = supplierStats[s.id] || { grossTotal: 0, overdue: 0, pending: 0, paid: 0, count: 0, lastDate: null, methods: new Set(), paidCount: 0, reconciledCount: 0 };
                  const isExpanded = expandedId === s.id;
                  const pm = s.payment_method || s.default_payment_method;

                  return (
                    <React.Fragment key={s.id}>
                      {/* Main row */}
                      <tr
                        className={`hover:bg-blue-50/50 cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/30' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.is_active !== false ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                            <div className="min-w-0">
                              <TextTooltip content={name}>
                                <div className="font-medium text-slate-800 truncate">{name}</div>
                              </TextTooltip>
                              <TextTooltip content={String([s.citta, s.provincia ? `(${s.provincia})` : ''].filter(Boolean).join(' ') || s.email || s.pec || '')}>
                                <div className="text-xs text-slate-400 truncate">
                                  {String([s.citta, s.provincia ? `(${s.provincia})` : ''].filter(Boolean).join(' ') || s.email || s.pec || '')}
                                </div>
                              </TextTooltip>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="text-xs text-slate-600 font-mono">{vat || '—'}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {s.category ? (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{String(s.category)}</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {ruleModeBySupplier[s.id] ? (
                            <span className="inline-block px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-xs font-medium">{MODE_META[ruleModeBySupplier[s.id]].label}</span>
                          ) : activeOutletCount >= 2 ? (
                            <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">manca</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {pm ? (
                            <span className="text-xs text-slate-600">{PAYMENT_LABEL[String(pm)] || String(pm)}</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {stats.grossTotal > 0 ? (
                            <div>
                              <div className="font-medium text-slate-700">€ {stats.grossTotal.toLocaleString('de-DE', { minimumFractionDigits: 0 })}</div>
                              <div className="text-xs text-slate-400">{stats.count} fatt.</div>
                            </div>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {stats.overdue > 0 ? (
                            <div>
                              <div className="font-semibold text-red-600">€ {stats.pending.toLocaleString('de-DE', { minimumFractionDigits: 0 })}</div>
                              <div className="text-xs text-red-500">{stats.overdue.toLocaleString('de-DE', { minimumFractionDigits: 0 })} scaduto</div>
                            </div>
                          ) : stats.pending > 0 ? (
                            <div className="font-medium text-amber-600">€ {stats.pending.toLocaleString('de-DE', { minimumFractionDigits: 0 })}</div>
                          ) : stats.grossTotal > 0 ? (
                            <span className="text-xs text-emerald-500 font-medium">Saldato</span>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {stats.paidCount > 0 ? (
                            <div className="flex items-center justify-center gap-1" title={`${stats.reconciledCount}/${stats.paidCount} pagamenti riconciliati in banca`}>
                              {stats.reconciledCount === stats.paidCount ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs font-medium">
                                  &#x2705; {stats.reconciledCount}/{stats.paidCount}
                                </span>
                              ) : stats.reconciledCount > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs font-medium">
                                  &#x26A0;&#xFE0F; {stats.reconciledCount}/{stats.paidCount}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-600 rounded text-xs font-medium">
                                  &#x26A0;&#xFE0F; 0/{stats.paidCount}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <button onClick={(e) => { e.stopPropagation(); navigate(`/fornitori/${(s as { slug?: string }).slug || s.id}/scheda-contabile`); }} className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition" title="Scheda contabile">
                              <BookOpen size={14} />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); openEdit(s); }} className="p-1 rounded hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition" title="Modifica">
                              <Edit3 size={14} />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition" title="Disattiva">
                              <Trash2 size={14} />
                            </button>
                            <span title={isExpanded ? 'Nascondi dettaglio' : 'Mostra dettaglio'}>{isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleGestione(s.id); }}
                              className={`p-1 rounded transition ${gestioneId === s.id ? 'bg-violet-600 text-white' : 'text-violet-500 hover:bg-violet-50 hover:text-violet-700'}`}
                              title="Gestione fornitore"
                            >
                              <SlidersHorizontal size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={9} className="px-4 py-4">{renderSupplierDetail(s)}</td>
                        </tr>
                      )}

                      {/* Pannello GESTIONE (categoria + divisione + fatture) */}
                      {gestioneId === s.id && (
                        <tr className="bg-violet-50/40">
                          <td colSpan={9} className="px-4 py-4 border-t-2 border-violet-300">{renderGestionePanel(s)}</td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </>
            )}
              </tbody>
            </table>
            </TableScroll>

            {/* Vista mobile a schede (sotto md): dati chiave + azioni con touch
                target >=44px. Dettaglio e pannello Gestione riusano le stesse
                funzioni di render della tabella desktop. */}
            <div className="md:hidden divide-y divide-slate-100">
              {sortedSuppliers.length === 0 ? (
                <div className="p-8 text-center">
                  <Building2 className="mx-auto text-slate-300 mb-3" size={40} />
                  <p className="text-slate-500 font-medium text-sm">Nessun fornitore trovato</p>
                  <p className="text-slate-400 text-xs mt-1">
                    {suppliers.length === 0
                      ? 'Importa fatture XML dall\'Import Hub per creare fornitori automaticamente'
                      : 'Prova a modificare i filtri di ricerca'}
                  </p>
                </div>
              ) : sortedSuppliers.map(s => {
                const name = getName(s);
                const vat = getVat(s);
                const stats = supplierStats[s.id] || { grossTotal: 0, overdue: 0, pending: 0, paid: 0, count: 0, lastDate: null, methods: new Set(), paidCount: 0, reconciledCount: 0 };
                const isExpanded = expandedId === s.id;
                const pm = s.payment_method || s.default_payment_method;
                return (
                  <div key={s.id} className={`p-3 ${isExpanded ? 'bg-indigo-50/30' : ''}`}>
                    <button onClick={() => setExpandedId(isExpanded ? null : s.id)} className="w-full text-left">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.is_active !== false ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800 break-words">{name}</div>
                            {vat && <div className="text-xs text-slate-500 font-mono">{vat}</div>}
                          </div>
                        </div>
                        {isExpanded
                          ? <ChevronUp size={16} className="text-slate-400 shrink-0 mt-1" />
                          : <ChevronDown size={16} className="text-slate-400 shrink-0 mt-1" />}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        {s.category ? (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{String(s.category)}</span>
                        ) : null}
                        {ruleModeBySupplier[s.id] ? (
                          <span className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-xs font-medium">{MODE_META[ruleModeBySupplier[s.id]].label}</span>
                        ) : activeOutletCount >= 2 ? (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">divisione da definire</span>
                        ) : null}
                        {pm ? <span className="text-xs text-slate-500">{PAYMENT_LABEL[String(pm)] || String(pm)}</span> : null}
                      </div>
                      <div className="flex items-center justify-between gap-3 mt-2">
                        <div className="text-xs text-slate-500">
                          Fatturato{' '}
                          <span className="font-medium text-slate-700">
                            {stats.grossTotal > 0 ? `€ ${stats.grossTotal.toLocaleString('de-DE', { minimumFractionDigits: 0 })}` : '—'}
                          </span>
                          {stats.count > 0 && <span className="text-slate-400"> · {stats.count} fatt.</span>}
                        </div>
                        <div className="text-right text-sm">
                          {stats.overdue > 0 ? (
                            <span className="font-semibold text-red-600">
                              € {stats.pending.toLocaleString('de-DE', { minimumFractionDigits: 0 })}
                              <span className="block text-[11px] font-medium text-red-500">di cui {stats.overdue.toLocaleString('de-DE', { minimumFractionDigits: 0 })} scaduto</span>
                            </span>
                          ) : stats.pending > 0 ? (
                            <span className="font-medium text-amber-600">€ {stats.pending.toLocaleString('de-DE', { minimumFractionDigits: 0 })} da pagare</span>
                          ) : stats.grossTotal > 0 ? (
                            <span className="text-xs text-emerald-500 font-medium">Saldato</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 mt-2.5">
                      <button
                        onClick={() => navigate(`/fornitori/${(s as { slug?: string }).slug || s.id}/scheda-contabile`)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2 text-xs font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition">
                        <BookOpen size={14} /> Scheda
                      </button>
                      <button
                        onClick={() => openEdit(s)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2 text-xs font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition">
                        <Edit3 size={14} /> Modifica
                      </button>
                      <button
                        onClick={() => toggleGestione(s.id)}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2 text-xs font-medium rounded-lg transition ${
                          gestioneId === s.id ? 'bg-violet-600 text-white border border-violet-600' : 'border border-violet-200 text-violet-600 hover:bg-violet-50'
                        }`}>
                        <SlidersHorizontal size={14} /> Gestione
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] border border-slate-200 text-slate-400 rounded-lg hover:text-red-500 hover:bg-red-50 transition"
                        title="Disattiva" aria-label="Disattiva fornitore">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-slate-200">{renderSupplierDetail(s)}</div>
                    )}
                    {gestioneId === s.id && (
                      <div className="mt-3 pt-3 border-t-2 border-violet-300">{renderGestionePanel(s)}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 bg-slate-50 border-t text-xs text-slate-500">
              {filteredSuppliers.length} fornitori su {suppliers.length} totali
            </div>
          </div>
        </div>
      )}

      {/* ANALYTICS TAB */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {suppliers.length === 0 ? (
            <div className="bg-white rounded-xl border p-12 text-center">
              <BarChart3 className="mx-auto text-slate-300 mb-3" size={48} />
              <p className="text-slate-500 font-medium">Nessun dato disponibile</p>
              <p className="text-slate-400 text-sm mt-1">Importa fatture o crea fornitori per visualizzare le analytics</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Suppliers by Spend */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Top fornitori per spesa</h3>
                {topSuppliersBySpend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topSuppliersBySpend} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid {...GRID_STYLE} horizontal={false} />
                      <XAxis type="number" {...AXIS_STYLE} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="name" {...AXIS_STYLE} width={120} tick={{ fontSize: 11 }} />
                      <Tooltip content={<GlassTooltip />} formatter={(v: unknown) => [`€ ${Number(v).toLocaleString('de-DE')}`, 'Spesa']} />
                      <Bar dataKey="value" fill="#6366f1" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-12">Nessuna spesa registrata</p>
                )}
              </div>

              {/* Spend by Category */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Spesa per categoria</h3>
                {/* Fix 12.1: empty state quando l'unica categoria e' "Non
                    categorizzato" (grafico con una sola fetta = inutile).
                    Suggeriamo all'utente di categorizzare i fornitori. */}
                {spendByCategory.length === 1 && spendByCategory[0].name === 'Non categorizzato' ? (
                  <div className="text-center py-12 px-4">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-100 flex items-center justify-center">
                      <Tag size={20} className="text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      Nessun fornitore categorizzato
                    </p>
                    <p className="text-xs text-slate-500 mb-4 max-w-xs mx-auto">
                      Assegna una categoria ai fornitori per vedere come si distribuisce la spesa.
                    </p>
                    <a
                      href="/ai-categorie"
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                      Categorizza fornitori
                    </a>
                  </div>
                ) : spendByCategory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={spendByCategory}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={110}
                        dataKey="value"
                        nameKey="name"
                        paddingAngle={2}
                      >
                        {spendByCategory.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: unknown) => `€ ${Number(v).toLocaleString('de-DE')}`} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-12">Nessuna categoria con spesa</p>
                )}
              </div>

              {/* Aging Analysis */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm lg:col-span-2">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Analisi aging fornitori</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase min-w-[200px]">Fornitore</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-slate-500 uppercase min-w-[100px] whitespace-nowrap">Totale</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-emerald-600 uppercase min-w-[100px] whitespace-nowrap">Pagato</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-amber-600 uppercase min-w-[100px] whitespace-nowrap">In scadenza</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-red-600 uppercase min-w-[100px] whitespace-nowrap">Scaduto</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">N. Fatture</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {suppliers
                        .map(s => {
                          const st = supplierStats[s.id] || { grossTotal: 0, paid: 0, pending: 0, overdue: 0, count: 0 };
                          return { ...s, ...st, displayName: getName(s) };
                        })
                        .filter(s => s.grossTotal > 0)
                        .sort((a, b) => b.grossTotal - a.grossTotal)
                        .slice(0, 15)
                        .map((s, idx) => (
                          <tr key={s.id} className={`hover:bg-blue-50/50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                            <td className="py-2 px-3 font-medium text-slate-700 min-w-[200px]">{s.displayName}</td>
                            <td className="py-2 px-3 text-right font-semibold min-w-[100px] whitespace-nowrap">€ {s.grossTotal.toLocaleString('de-DE', { minimumFractionDigits: 0 })}</td>
                            <td className="py-2 px-3 text-right text-emerald-600 min-w-[100px] whitespace-nowrap">€ {s.paid.toLocaleString('de-DE', { minimumFractionDigits: 0 })}</td>
                            <td className="py-2 px-3 text-right text-amber-600 min-w-[100px] whitespace-nowrap">€ {s.pending.toLocaleString('de-DE', { minimumFractionDigits: 0 })}</td>
                            <td className="py-2 px-3 text-right text-red-600 font-semibold">{s.overdue > 0 ? `€ ${s.overdue.toLocaleString('de-DE', { minimumFractionDigits: 0 })}` : '—'}</td>
                            <td className="py-2 px-3 text-right text-slate-500">{s.count}</td>
                          </tr>
                        ))}
                      {suppliers.every(s => {
                        const st = supplierStats[s.id] || { grossTotal: 0 };
                        return st.grossTotal === 0;
                      }) && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-400">Nessun dato di fatturazione disponibile</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL FORNITORE */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        bare
        ariaLabel={editingId ? 'Modifica Fornitore' : 'Nuovo Fornitore'}
        containerClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        panelClassName="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
      >
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId ? 'Modifica Fornitore' : 'Nuovo Fornitore'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-5">
              {/* Row 1: Anagrafica */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">Dati anagrafici</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-slate-600">Ragione Sociale *</label>
                    <input value={form.ragione_sociale} onChange={e => setForm(f => ({ ...f, ragione_sociale: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="Es. ACME S.R.L." />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Partita IVA</label>
                    <input value={form.partita_iva} onChange={e => setForm(f => ({ ...f, partita_iva: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono" placeholder="01234567890" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Codice Fiscale</label>
                    <input value={form.codice_fiscale} onChange={e => setForm(f => ({ ...f, codice_fiscale: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Codice SDI</label>
                    <input value={form.codice_sdi} onChange={e => setForm(f => ({ ...f, codice_sdi: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono" placeholder="0000000" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">PEC</label>
                    <input value={form.pec} onChange={e => setForm(f => ({ ...f, pec: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="pec@fornitore.it" />
                  </div>
                </div>
              </div>

              {/* Row 2: Contatti */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">Contatti & indirizzo</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600">Email</label>
                    <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Telefono</label>
                    <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-slate-600">Indirizzo</label>
                    <input value={form.indirizzo} onChange={e => setForm(f => ({ ...f, indirizzo: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Città</label>
                    <input value={form.citta} onChange={e => setForm(f => ({ ...f, citta: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium text-slate-600">Provincia</label>
                      <input value={form.provincia} onChange={e => setForm(f => ({ ...f, provincia: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" maxLength={2} placeholder="FI" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600">CAP</label>
                      <input value={form.cap} onChange={e => setForm(f => ({ ...f, cap: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" maxLength={5} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 3: Pagamento & Classificazione */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">Condizioni & classificazione</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600">IBAN</label>
                    <input value={form.iban} onChange={e => setForm(f => ({ ...f, iban: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono" placeholder="IT..." />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Categoria</label>
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                      <option value="">Seleziona...</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Termini pagamento (gg)</label>
                    <input type="number" value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: Number(e.target.value) || 0 }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" min={0} max={365} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Metodo pagamento</label>
                    <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                      {PAYMENT_METHOD_OPTIONS.map(g => (
                        <optgroup key={g.group} label={g.group}>
                          {g.items.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  {/* ── PIANO RATE SCADENZE (v2) ─────────────────────────── */}
                  <div className="col-span-2 mt-1 pt-3 border-t border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar size={14} className="text-indigo-500" />
                      <span className="text-xs font-semibold text-slate-700">Piano scadenze (fatture dal 31/07/2026)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-slate-600">Base di calcolo</label>
                        <select value={form.payment_base} onChange={e => setForm(f => ({ ...f, payment_base: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                          <option value="">— non impostata —</option>
                          <option value="data_fattura">Data fattura (a giorni)</option>
                          <option value="fine_mese">Fine mese (a mesi)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600">Banca di pagamento{isBankRequired(form.payment_method) && <span className="text-rose-500"> *</span>}</label>
                        <select value={form.payment_bank_account_id} onChange={e => setForm(f => ({ ...f, payment_bank_account_id: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                          <option value="">— nessuna —</option>
                          {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600">1ª scadenza (gg)</label>
                        <input type="number" value={form.prima_scadenza_gg} onChange={e => setForm(f => ({ ...f, prima_scadenza_gg: Number(e.target.value) || 0 }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" min={0} max={365} step={30} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600">Numero rate</label>
                        <input type="number" value={form.numero_rate} onChange={e => setForm(f => ({ ...f, numero_rate: Number(e.target.value) || 1 }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" min={1} max={12} />
                      </div>
                    </div>
                    {isBankRequired(form.payment_method) && !form.payment_bank_account_id && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600">
                        <AlertTriangle size={13} /> Con metodo {PAYMENT_LABEL[form.payment_method] || form.payment_method} la banca è obbligatoria (serve per il cashflow).
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-slate-400">Le rate successive sono +30gg (data fattura) o +1 mese (fine mese). Importo diviso equamente tra le rate.</p>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-slate-600">Note</label>
                    <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-6 border-t bg-slate-50">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
                Annulla
              </button>
              <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 size={16} className="animate-spin" />}
                {editingId ? 'Salva Modifiche' : 'Crea Fornitore'}
              </button>
            </div>
      </Modal>

      {/* INVOICE VIEWER (XML fattura formattato) */}
      {viewerXml && <InvoiceViewer xmlContent={viewerXml} onClose={() => setViewerXml(null)} />}

      {/* PDF VIEWER (allegato PDF della fattura) in modal custom */}
      <Modal
        open={!!pdfModal}
        onClose={() => setPdfModal(null)}
        bare
        ariaLabel={pdfModal?.nome ?? 'Anteprima PDF'}
        containerClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        panelClassName="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
      >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip size={16} className="text-violet-600 shrink-0" />
                <TextTooltip content={pdfModal?.nome ?? ''}>
                  <span className="font-semibold text-slate-800 truncate">{pdfModal?.nome}</span>
                </TextTooltip>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => { if (pdfModal) downloadBytes(pdfModal.data, pdfModal.nome, 'application/pdf') }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Download size={15} /> Scarica PDF
                </button>
                <button onClick={() => setPdfModal(null)} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <PdfViewer pdfData={pdfViewerData} className="h-full" />
            </div>
      </Modal>

      {/* TOAST */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-start gap-2 ${
          toast.type === 'error' ? 'bg-red-600 text-white' : toast.type === 'info' ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'
        }`}>
          <span className="shrink-0 mt-0.5">
            {toast.type === 'error' ? <AlertTriangle size={16} /> : toast.type === 'info' ? <Info size={16} /> : <CheckCircle size={16} />}
          </span>
          <span>{toast.msg}</span>
        </div>
      )}
      </div>
    </div>
  );
}

// ─── SUB-COMPONENTS ─────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string | number; sub?: string; color: string }) {
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600', purple: 'bg-purple-50 text-purple-600',
  };
  const cls = colorMap[color] || colorMap.indigo;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${cls}`}><Icon size={20} /></div>
        <div>
          <div className="text-xl font-bold text-slate-900">{value}</div>
          <div className="text-xs text-slate-500">{label}</div>
          {sub && <div className="text-xs text-slate-400">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div className="flex">
      <span className="text-slate-400 w-28 shrink-0 text-xs">{label}</span>
      <span className={`text-slate-700 text-xs ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}
