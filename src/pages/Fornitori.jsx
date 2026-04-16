import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Building2, Search, Plus, Edit3, Trash2, FileText, Phone, Mail, MapPin,
  CreditCard, Clock, AlertTriangle, CheckCircle, ChevronDown, ChevronUp,
  X, Filter, Download, TrendingUp, Calendar, ArrowUpDown, ExternalLink,
  Loader2, Eye, BarChart3, PieChart as PieChartIcon, Banknote
} from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const EMPTY_FORM = {
  ragione_sociale: '', partita_iva: '', codice_fiscale: '', codice_sdi: '',
  pec: '', email: '', telefono: '', iban: '', indirizzo: '', citta: '',
  provincia: '', cap: '', category: '', payment_terms: 30,
  payment_method: 'bonifico_ordinario', cost_center: 'all', note: '',
};

// v2 payment method enum options for dropdown
const PAYMENT_METHOD_OPTIONS = [
  { group: 'Bonifico', items: [
    { value: 'bonifico_ordinario', label: 'Bonifico Ordinario' },
    { value: 'bonifico_urgente', label: 'Bonifico Urgente' },
    { value: 'bonifico_sepa', label: 'Bonifico SEPA' },
  ]},
  { group: 'RIBA', items: [
    { value: 'riba_30', label: 'Ri.Ba. 30gg' },
    { value: 'riba_60', label: 'Ri.Ba. 60gg' },
    { value: 'riba_90', label: 'Ri.Ba. 90gg' },
    { value: 'riba_120', label: 'Ri.Ba. 120gg' },
  ]},
  { group: 'RID / SDD', items: [
    { value: 'rid', label: 'RID' },
    { value: 'sdd_core', label: 'SDD Core' },
    { value: 'sdd_b2b', label: 'SDD B2B' },
  ]},
  { group: 'Altro', items: [
    { value: 'rimessa_diretta', label: 'Rimessa Diretta' },
    { value: 'carta_credito', label: 'Carta di Credito' },
    { value: 'carta_debito', label: 'Carta di Debito' },
    { value: 'assegno', label: 'Assegno' },
    { value: 'contanti', label: 'Contanti' },
    { value: 'compensazione', label: 'Compensazione' },
    { value: 'f24', label: 'F24' },
    { value: 'mav', label: 'MAV' },
    { value: 'rav', label: 'RAV' },
    { value: 'bollettino_postale', label: 'Bollettino Postale' },
    { value: 'altro', label: 'Altro' },
  ]},
];

// Human-readable label for payment method enum
const PAYMENT_LABEL = {};
PAYMENT_METHOD_OPTIONS.forEach(g => g.items.forEach(i => { PAYMENT_LABEL[i.value] = i.label; }));
// v1 fallbacks
PAYMENT_LABEL.bonifico = 'Bonifico';
PAYMENT_LABEL.riba = 'Ri.Ba.';
PAYMENT_LABEL.rid = 'RID';
PAYMENT_LABEL.carta = 'Carta';

const CATEGORIES = [
  'Merci', 'Servizi', 'Affitti', 'Utenze', 'Marketing', 'Logistica',
  'Consulenza', 'Manutenzione', 'IT', 'Personale', 'Altro',
];

export default function Fornitori() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  // Data state
  const [suppliers, setSuppliers] = useState([]);
  const [payables, setPayables] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); // all, attivi, inattivi
  const [sortField, setSortField] = useState('ragione_sociale');
  const [sortDir, setSortDir] = useState('asc');
  const [expandedId, setExpandedId] = useState(null);
  const [activeTab, setActiveTab] = useState('anagrafica'); // anagrafica, analytics

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  // ─── DATA LOADING ─────────────────────────────────────────────

  useEffect(() => {
    if (!COMPANY_ID) return;
    loadData();
  }, [COMPANY_ID]);

  async function loadData() {
    setLoading(true);
    try {
      const [suppRes, payRes, invRes] = await Promise.all([
        supabase.from('suppliers').select('*')
          .eq('company_id', COMPANY_ID)
          .or('is_deleted.is.null,is_deleted.eq.false')
          .order('ragione_sociale', { ascending: true }),
        supabase.from('payables').select('*')
          .eq('company_id', COMPANY_ID),
        supabase.from('electronic_invoices').select('*')
          .eq('company_id', COMPANY_ID),
      ]);

      setSuppliers(suppRes.data || []);
      setPayables(payRes.data || []);
      setInvoices(invRes.data || []);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  // ─── COMPUTED DATA ────────────────────────────────────────────

  // Aggregate payable data per supplier — keyed by supplier_id
  const supplierStats = useMemo(() => {
    const stats = {};
    payables.forEach(p => {
      const key = p.supplier_id;
      if (!key) return;
      if (!stats[key]) stats[key] = { total: 0, paid: 0, pending: 0, overdue: 0, count: 0, lastDate: null, grossTotal: 0, methods: new Set(), paidCount: 0, reconciledCount: 0 };
      const gross = parseFloat(p.gross_amount) || 0;
      const remaining = parseFloat(p.amount_remaining) || 0;
      stats[key].grossTotal += gross;
      stats[key].count++;
      if (p.payment_method) stats[key].methods.add(p.payment_method);
      if (p.status === 'pagato') {
        stats[key].paid += gross;
        stats[key].paidCount++;
        if (p.cash_movement_id) stats[key].reconciledCount++;
      } else if (p.status === 'scaduto') {
        stats[key].overdue += remaining;
        stats[key].pending += remaining;
      } else if (p.status !== 'annullato' && p.status !== 'bloccato') {
        stats[key].pending += remaining;
      }
      // Track last invoice date
      if (p.invoice_date && (!stats[key].lastDate || p.invoice_date > stats[key].lastDate)) {
        stats[key].lastDate = p.invoice_date;
      }
    });
    return stats;
  }, [payables]);

  // Invoice totals per supplier — keyed by supplier_id
  const invoiceStats = useMemo(() => {
    const stats = {};
    invoices.forEach(inv => {
      // Try supplier_id first, fallback to vat match
      let key = inv.supplier_id;
      if (!key) {
        const match = suppliers.find(s =>
          (inv.supplier_vat && (s.partita_iva === inv.supplier_vat || s.vat_number === inv.supplier_vat)) ||
          (inv.supplier_name && (s.ragione_sociale === inv.supplier_name || s.name === inv.supplier_name))
        );
        key = match?.id;
      }
      if (!key) return;
      if (!stats[key]) stats[key] = { totalGross: 0, totalNet: 0, count: 0 };
      stats[key].totalGross += parseFloat(inv.gross_amount) || 0;
      stats[key].totalNet += parseFloat(inv.net_amount) || 0;
      stats[key].count++;
    });
    return stats;
  }, [invoices, suppliers]);

  // Filtered & sorted suppliers
  const filteredSuppliers = useMemo(() => {
    let list = [...suppliers];

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        (s.ragione_sociale || s.name || '').toLowerCase().includes(q) ||
        (s.partita_iva || s.vat_number || '').includes(q) ||
        (s.category || '').toLowerCase().includes(q) ||
        (s.citta || '').toLowerCase().includes(q)
      );
    }

    // Category filter
    if (filterCategory !== 'all') {
      list = list.filter(s => s.category === filterCategory);
    }

    // Status filter
    if (filterStatus === 'attivi') list = list.filter(s => s.is_active !== false);
    if (filterStatus === 'inattivi') list = list.filter(s => s.is_active === false);

    // Sort
    list.sort((a, b) => {
      const aVal = (a[sortField] || '').toString().toLowerCase();
      const bVal = (b[sortField] || '').toString().toLowerCase();
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });

    return list;
  }, [suppliers, search, filterCategory, filterStatus, sortField, sortDir]);

  // KPIs
  const kpis = useMemo(() => {
    const active = suppliers.filter(s => s.is_active !== false).length;
    const totalPending = payables
      .filter(p => p.status !== 'pagato' && p.status !== 'annullato' && p.status !== 'bloccato')
      .reduce((s, p) => s + (parseFloat(p.amount_remaining) || 0), 0);
    const overdue = payables
      .filter(p => p.status === 'scaduto')
      .reduce((s, p) => s + (parseFloat(p.amount_remaining) || 0), 0);
    const totalFatturato = payables.reduce((s, p) => s + (parseFloat(p.gross_amount) || 0), 0);
    const withPayables = new Set(payables.map(p => p.supplier_id).filter(Boolean)).size;
    return { active, total: suppliers.length, totalPending, overdue, totalFatturato, withPayables };
  }, [suppliers, payables]);

  // Charts data
  const spendByCategory = useMemo(() => {
    const map = {};
    suppliers.forEach(s => {
      const cat = s.category || 'Non categorizzato';
      if (!map[cat]) map[cat] = { name: cat, value: 0, count: 0 };
      const stats = supplierStats[s.id] || { grossTotal: 0 };
      map[cat].value += stats.grossTotal;
      map[cat].count++;
    });
    return Object.values(map).filter(c => c.value > 0).sort((a, b) => b.value - a.value);
  }, [suppliers, supplierStats]);

  const topSuppliersBySpend = useMemo(() => {
    return suppliers
      .map(s => {
        const stats = supplierStats[s.id] || { grossTotal: 0 };
        return { name: (s.ragione_sociale || s.name || '').substring(0, 20), value: stats.grossTotal };
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

  function openEdit(supplier) {
    setEditingId(supplier.id);
    setForm({
      ragione_sociale: supplier.ragione_sociale || supplier.name || '',
      partita_iva: supplier.partita_iva || supplier.vat_number || '',
      codice_fiscale: supplier.codice_fiscale || supplier.fiscal_code || '',
      codice_sdi: supplier.codice_sdi || '',
      pec: supplier.pec || '',
      email: supplier.email || '',
      telefono: supplier.telefono || '',
      iban: supplier.iban || '',
      indirizzo: supplier.indirizzo || '',
      citta: supplier.citta || '',
      provincia: supplier.provincia || '',
      cap: supplier.cap || '',
      category: supplier.category || '',
      payment_terms: supplier.payment_terms || supplier.default_payment_terms || 30,
      payment_method: supplier.payment_method || supplier.default_payment_method || 'bonifico',
      cost_center: supplier.cost_center || 'all',
      note: supplier.note || supplier.notes || '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.ragione_sociale.trim()) { showToast('Ragione sociale obbligatoria', 'error'); return; }
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
        payment_terms: parseInt(form.payment_terms) || 30,
        default_payment_terms: parseInt(form.payment_terms) || 30,
        payment_method: form.payment_method || 'bonifico_ordinario',
        default_payment_method: form.payment_method || 'bonifico_ordinario',
        cost_center: form.cost_center || 'all',
        note: form.note.trim() || null,
        notes: form.note.trim() || null,
        is_active: true,
        is_deleted: false,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase.from('suppliers').update(record).eq('id', editingId);
        if (error) throw error;
        showToast('Fornitore aggiornato');
      } else {
        const { error } = await supabase.from('suppliers').insert(record);
        if (error) throw error;
        showToast('Fornitore creato');
      }

      setShowModal(false);
      await loadData();
    } catch (err) {
      console.error('Save error:', err);
      showToast('Errore: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Disattivare questo fornitore?')) return;
    try {
      await supabase.from('suppliers').update({ is_deleted: true, is_active: false }).eq('id', id);
      showToast('Fornitore disattivato');
      await loadData();
    } catch (err) {
      showToast('Errore eliminazione', 'error');
    }
  }

  function toggleSort(field) {
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
  const getName = (s) => s.ragione_sociale || s.name || 'N/D';
  const getVat = (s) => s.partita_iva || s.vat_number || '';

  // ─── RENDER ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Building2 className="text-indigo-600" size={28} />
            Anagrafica Fornitori
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Gestione fornitori, condizioni di pagamento, analisi spesa
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={exportCSV} className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
            <Download size={16} /> Esporta
          </button>
          <button onClick={openNew} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 flex items-center gap-2 shadow-sm">
            <Plus size={16} /> Nuovo Fornitore
          </button>
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard icon={Building2} label="Fornitori attivi" value={kpis.active} sub={`${kpis.withPayables} con fatture`} color="indigo" />
        <KpiCard icon={Banknote} label="Tot. fatturato" value={`€ ${kpis.totalFatturato.toLocaleString('it-IT', { minimumFractionDigits: 0 })}`} color="blue" />
        <KpiCard icon={Clock} label="Da pagare" value={`€ ${kpis.totalPending.toLocaleString('it-IT', { minimumFractionDigits: 0 })}`} color="amber" />
        <KpiCard icon={AlertTriangle} label="Scaduto" value={`€ ${kpis.overdue.toLocaleString('it-IT', { minimumFractionDigits: 0 })}`} color={kpis.overdue > 0 ? 'red' : 'green'} />
        <KpiCard icon={FileText} label="Fatture importate" value={invoices.length} color="purple" />
      </div>

      {/* TAB NAV */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[
          { id: 'anagrafica', label: 'Anagrafica', icon: Building2 },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        ].map(tab => (
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
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600">
              <option value="all">Tutti</option>
              <option value="attivi">Attivi</option>
              <option value="inattivi">Disattivati</option>
            </select>
          </div>

          {/* SUPPLIER LIST */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            {/* Table */}
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 cursor-pointer" onClick={() => toggleSort('ragione_sociale')}>
                    <span className="flex items-center gap-1">Fornitore <ArrowUpDown size={11} /></span>
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">P.IVA</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600 cursor-pointer" onClick={() => toggleSort('category')}>
                    <span className="flex items-center gap-1 justify-center">Cat. <ArrowUpDown size={11} /></span>
                  </th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600">Metodo</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600">Fatturato</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600">Da pagare</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600">Banca</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600 w-20">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">

            {/* Table rows */}
            {filteredSuppliers.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-12 text-center">
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
                {filteredSuppliers.map(s => {
                  const name = getName(s);
                  const vat = getVat(s);
                  const stats = supplierStats[s.id] || { grossTotal: 0, overdue: 0, pending: 0, paid: 0, count: 0, lastDate: null, methods: new Set(), paidCount: 0, reconciledCount: 0 };
                  const isExpanded = expandedId === s.id;
                  const pm = s.payment_method || s.default_payment_method;

                  return (
                    <React.Fragment key={s.id}>
                      {/* Main row */}
                      <tr
                        className={`hover:bg-slate-50/50 cursor-pointer transition ${isExpanded ? 'bg-indigo-50/30' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.is_active !== false ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                            <div className="min-w-0">
                              <div className="font-medium text-slate-800 truncate">{name}</div>
                              <div className="text-xs text-slate-400 truncate">
                                {[s.citta, s.provincia ? `(${s.provincia})` : ''].filter(Boolean).join(' ') || (s.email || s.pec || '')}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="text-xs text-slate-600 font-mono">{vat || '—'}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {s.category ? (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{s.category}</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {pm ? (
                            <span className="text-xs text-slate-600">{PAYMENT_LABEL[pm] || pm}</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {stats.grossTotal > 0 ? (
                            <div>
                              <div className="font-medium text-slate-700">€ {stats.grossTotal.toLocaleString('it-IT', { minimumFractionDigits: 0 })}</div>
                              <div className="text-xs text-slate-400">{stats.count} fatt.</div>
                            </div>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {stats.overdue > 0 ? (
                            <div>
                              <div className="font-semibold text-red-600">€ {stats.pending.toLocaleString('it-IT', { minimumFractionDigits: 0 })}</div>
                              <div className="text-xs text-red-500">{stats.overdue.toLocaleString('it-IT', { minimumFractionDigits: 0 })} scaduto</div>
                            </div>
                          ) : stats.pending > 0 ? (
                            <div className="font-medium text-amber-600">€ {stats.pending.toLocaleString('it-IT', { minimumFractionDigits: 0 })}</div>
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
                            <button onClick={(e) => { e.stopPropagation(); openEdit(s); }} className="p-1 rounded hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition" title="Modifica">
                              <Edit3 size={14} />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition" title="Disattiva">
                              <Trash2 size={14} />
                            </button>
                            {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail */}
                      {isExpanded && (() => {
                        // Find payables for this supplier by ID
                        const supplierPays = payables.filter(p => p.supplier_id === s.id)
                          .sort((a, b) => new Date(b.invoice_date || b.created_at) - new Date(a.invoice_date || a.created_at));
                        const avgAmount = supplierPays.length > 0
                          ? supplierPays.reduce((acc, p) => acc + (parseFloat(p.gross_amount) || 0), 0) / supplierPays.length
                          : 0;
                        return (
                        <tr className="bg-slate-50/50">
                          <td colSpan={8} className="px-4 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                              {/* Col 1: Anagrafica completa */}
                              <div>
                                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5">
                                  <Building2 size={14} className="text-indigo-500" /> Anagrafica
                                </h4>
                                <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5 text-sm">
                                  <Detail label="Ragione Sociale" value={name} />
                                  <Detail label="P.IVA" value={vat} mono />
                                  <Detail label="Cod. Fiscale" value={s.codice_fiscale || s.fiscal_code} mono />
                                  <Detail label="Codice SDI" value={s.codice_sdi} mono />
                                  <Detail label="PEC" value={s.pec} />
                                  <Detail label="IBAN" value={s.iban} mono />
                                  <div className="border-t border-slate-100 pt-1.5 mt-1.5" />
                                  <Detail label="Indirizzo" value={s.indirizzo} />
                                  <Detail label="Città" value={[s.cap, s.citta, s.provincia ? `(${s.provincia})` : ''].filter(Boolean).join(' ')} />
                                  <Detail label="Email" value={s.email} />
                                  <Detail label="Telefono" value={s.telefono} />
                                </div>
                              </div>
                              {/* Col 2: Condizioni & classificazione */}
                              <div>
                                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5">
                                  <CreditCard size={14} className="text-indigo-500" /> Condizioni
                                </h4>
                                <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5 text-sm">
                                  <Detail label="Termini pag." value={`${s.payment_terms || s.default_payment_terms || 30} giorni`} />
                                  <Detail label="Metodo pag." value={PAYMENT_LABEL[s.payment_method || s.default_payment_method] || s.payment_method || s.default_payment_method || '—'} />
                                  <Detail label="Categoria" value={s.category} />
                                  <Detail label="Centro costo" value={s.cost_center === 'all' ? 'Tutti gli outlet' : s.cost_center} />
                                  <Detail label="Stato" value={s.is_active !== false ? '✓ Attivo' : '✗ Disattivato'} />
                                  {(s.note || s.notes) && (
                                    <>
                                      <div className="border-t border-slate-100 pt-1.5 mt-1.5" />
                                      <div className="text-xs text-slate-500 italic">{s.note || s.notes}</div>
                                    </>
                                  )}
                                </div>
                              </div>
                              {/* Col 3: Statistiche & ultime fatture */}
                              <div>
                                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5">
                                  <BarChart3 size={14} className="text-indigo-500" /> Statistiche
                                </h4>
                                <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5 text-sm">
                                  <Detail label="Tot. fatture" value={stats.count || 0} />
                                  <Detail label="Tot. fatturato" value={stats.grossTotal > 0 ? `€ ${stats.grossTotal.toLocaleString('it-IT', { minimumFractionDigits: 2 })}` : '—'} />
                                  <Detail label="Già pagato" value={stats.paid > 0 ? `€ ${stats.paid.toLocaleString('it-IT', { minimumFractionDigits: 2 })}` : '—'} />
                                  {stats.paidCount > 0 && (
                                    <Detail label="Riconciliati" value={`${stats.reconciledCount}/${stats.paidCount} in banca`} />
                                  )}
                                  <Detail label="Da pagare" value={stats.pending > 0 ? `€ ${stats.pending.toLocaleString('it-IT', { minimumFractionDigits: 2 })}` : '—'} />
                                  {stats.overdue > 0 && (
                                    <div className="flex">
                                      <span className="text-red-500 w-28 shrink-0 text-xs font-medium">Scaduto</span>
                                      <span className="text-red-600 text-xs font-semibold">€ {stats.overdue.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                  )}
                                  {avgAmount > 0 && (
                                    <Detail label="Media fattura" value={`€ ${avgAmount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                                  )}
                                  {stats.lastDate && (
                                    <Detail label="Ultima fattura" value={new Date(stats.lastDate).toLocaleDateString('it-IT')} />
                                  )}
                                </div>
                                {/* Ultime 5 scadenze */}
                                {supplierPays.length > 0 && (
                                  <div className="mt-3">
                                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Ultime scadenze</h4>
                                    <div className="space-y-1">
                                      {supplierPays.slice(0, 5).map((pay, i) => (
                                        <div key={i} className="bg-white rounded border border-slate-200 px-2.5 py-1.5 flex items-center justify-between text-xs">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                              pay.status === 'pagato' ? 'bg-emerald-400' : pay.status === 'scaduto' ? 'bg-red-400' : 'bg-amber-400'
                                            }`} />
                                            <span className="font-medium text-slate-700 truncate">{pay.invoice_number}</span>
                                            <span className="text-slate-400">{pay.due_date ? new Date(pay.due_date).toLocaleDateString('it-IT') : ''}</span>
                                          </div>
                                          <span className="font-semibold text-slate-700 shrink-0 ml-2">€ {(parseFloat(pay.gross_amount) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })}</span>
                                        </div>
                                      ))}
                                      {supplierPays.length > 5 && (
                                        <div className="text-xs text-slate-400 text-center pt-0.5">+ altre {supplierPays.length - 5} scadenze</div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                        );
                      })()}
                    </React.Fragment>
                  );
                })}
              </>
            )}
              </tbody>
            </table>

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
                      <Tooltip content={<GlassTooltip />} formatter={v => [`€ ${v.toLocaleString('it-IT')}`, 'Spesa']} />
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
                {spendByCategory.length > 0 ? (
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
                      <Tooltip formatter={v => `€ ${v.toLocaleString('it-IT')}`} />
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
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase">Fornitore</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-slate-500 uppercase">Totale</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-emerald-600 uppercase">Pagato</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-amber-600 uppercase">In scadenza</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-red-600 uppercase">Scaduto</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-slate-500 uppercase">N. Fatture</th>
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
                        .map(s => (
                          <tr key={s.id} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-medium text-slate-700">{s.displayName}</td>
                            <td className="py-2 px-3 text-right font-semibold">€ {s.grossTotal.toLocaleString('it-IT', { minimumFractionDigits: 0 })}</td>
                            <td className="py-2 px-3 text-right text-emerald-600">€ {s.paid.toLocaleString('it-IT', { minimumFractionDigits: 0 })}</td>
                            <td className="py-2 px-3 text-right text-amber-600">€ {s.pending.toLocaleString('it-IT', { minimumFractionDigits: 0 })}</td>
                            <td className="py-2 px-3 text-right text-red-600 font-semibold">{s.overdue > 0 ? `€ ${s.overdue.toLocaleString('it-IT', { minimumFractionDigits: 0 })}` : '—'}</td>
                            <td className="py-2 px-3 text-right text-slate-500">{s.count}</td>
                          </tr>
                        ))}
                      {suppliers.every(s => {
                        const st = supplierStats[s.id] || { grossTotal: 0 };
                        return st.grossTotal === 0;
                      }) && (
                        <tr>
                          <td colSpan="6" className="py-8 text-center text-slate-400">Nessun dato di fatturazione disponibile</td>
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
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
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
                    <input type="number" value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" min={0} max={365} />
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
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
        }`}>
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── SUB-COMPONENTS ─────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color }) {
  const colorMap = {
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

function Detail({ label, value, mono }) {
  return (
    <div className="flex">
      <span className="text-slate-400 w-28 shrink-0 text-xs">{label}</span>
      <span className={`text-slate-700 text-xs ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}
