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
  payment_method: 'bonifico', cost_center: 'all', note: '',
};

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

  // Aggregate payable data per supplier
  const supplierStats = useMemo(() => {
    const stats = {};
    payables.forEach(p => {
      const key = p.supplier_name || p.supplier_vat || 'unknown';
      if (!stats[key]) stats[key] = { total: 0, paid: 0, pending: 0, overdue: 0, count: 0 };
      const amount = parseFloat(p.amount) || 0;
      stats[key].total += amount;
      stats[key].count++;
      if (p.status === 'pagato') stats[key].paid += amount;
      else if (p.status === 'scaduto') stats[key].overdue += amount;
      else stats[key].pending += amount;
    });
    return stats;
  }, [payables]);

  // Invoice totals per supplier
  const invoiceStats = useMemo(() => {
    const stats = {};
    invoices.forEach(inv => {
      const key = inv.supplier_vat || inv.supplier_name || 'unknown';
      if (!stats[key]) stats[key] = { totalGross: 0, totalNet: 0, count: 0 };
      stats[key].totalGross += parseFloat(inv.gross_amount) || 0;
      stats[key].totalNet += parseFloat(inv.net_amount) || 0;
      stats[key].count++;
    });
    return stats;
  }, [invoices]);

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
    const totalPayables = payables.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const overdue = payables.filter(p => p.status === 'scaduto').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const avgPaymentTerms = suppliers.length > 0
      ? Math.round(suppliers.reduce((s, sup) => s + (sup.payment_terms || 30), 0) / suppliers.length)
      : 30;
    return { active, total: suppliers.length, totalPayables, overdue, avgPaymentTerms };
  }, [suppliers, payables]);

  // Charts data
  const spendByCategory = useMemo(() => {
    const map = {};
    suppliers.forEach(s => {
      const cat = s.category || 'Non categorizzato';
      if (!map[cat]) map[cat] = { name: cat, value: 0, count: 0 };
      const key = s.partita_iva || s.vat_number || s.ragione_sociale || s.name;
      const stats = supplierStats[key] || supplierStats[s.ragione_sociale] || { total: 0 };
      map[cat].value += stats.total;
      map[cat].count++;
    });
    return Object.values(map).filter(c => c.value > 0).sort((a, b) => b.value - a.value);
  }, [suppliers, supplierStats]);

  const topSuppliersBySpend = useMemo(() => {
    return suppliers
      .map(s => {
        const key = s.partita_iva || s.vat_number || s.ragione_sociale || s.name;
        const stats = supplierStats[key] || supplierStats[s.ragione_sociale] || { total: 0 };
        return { name: (s.ragione_sociale || s.name || '').substring(0, 20), value: stats.total };
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
        payment_method: form.payment_method || 'bonifico',
        cost_center: form.cost_center || 'all',
        note: form.note.trim() || null,
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
        <KpiCard icon={Building2} label="Fornitori attivi" value={kpis.active} sub={`${kpis.total} totali`} color="indigo" />
        <KpiCard icon={Banknote} label="Totale debiti" value={`€ ${kpis.totalPayables.toLocaleString('it-IT', { minimumFractionDigits: 0 })}`} color="blue" />
        <KpiCard icon={AlertTriangle} label="Scaduto" value={`€ ${kpis.overdue.toLocaleString('it-IT', { minimumFractionDigits: 0 })}`} color={kpis.overdue > 0 ? 'red' : 'green'} />
        <KpiCard icon={Clock} label="Termini medi" value={`${kpis.avgPaymentTerms} gg`} color="amber" />
        <KpiCard icon={FileText} label="Fatture ricevute" value={invoices.length} color="purple" />
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
            {/* Table header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-50 border-b text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <div className="col-span-3 flex items-center gap-1 cursor-pointer" onClick={() => toggleSort('ragione_sociale')}>
                Ragione Sociale <ArrowUpDown size={12} />
              </div>
              <div className="col-span-2">P.IVA / Cod. SDI</div>
              <div className="col-span-2">Contatti</div>
              <div className="col-span-1 flex items-center gap-1 cursor-pointer" onClick={() => toggleSort('category')}>
                Categoria <ArrowUpDown size={12} />
              </div>
              <div className="col-span-1 text-right">Debito</div>
              <div className="col-span-1 text-right">Scaduto</div>
              <div className="col-span-1 text-center">Termini</div>
              <div className="col-span-1 text-center">Azioni</div>
            </div>

            {/* Table rows */}
            {filteredSuppliers.length === 0 ? (
              <div className="p-12 text-center">
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
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredSuppliers.map(s => {
                  const name = getName(s);
                  const vat = getVat(s);
                  const stats = supplierStats[vat] || supplierStats[name] || { total: 0, overdue: 0, pending: 0, paid: 0, count: 0 };
                  const isExpanded = expandedId === s.id;

                  return (
                    <div key={s.id}>
                      {/* Main row */}
                      <div
                        className={`grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-slate-50/50 cursor-pointer transition ${isExpanded ? 'bg-indigo-50/30' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      >
                        <div className="col-span-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${s.is_active !== false ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                            <span className="font-medium text-slate-800 text-sm truncate">{name}</span>
                          </div>
                          {(s.citta || s.provincia) && (
                            <div className="text-xs text-slate-400 ml-4 mt-0.5">{[s.citta, s.provincia].filter(Boolean).join(', ')}</div>
                          )}
                        </div>
                        <div className="col-span-2">
                          <div className="text-sm text-slate-700 font-mono">{vat || '—'}</div>
                          {s.codice_sdi && <div className="text-xs text-slate-400">SDI: {s.codice_sdi}</div>}
                        </div>
                        <div className="col-span-2">
                          {s.email && <div className="text-xs text-slate-500 truncate flex items-center gap-1"><Mail size={10} />{s.email}</div>}
                          {s.telefono && <div className="text-xs text-slate-500 flex items-center gap-1"><Phone size={10} />{s.telefono}</div>}
                          {s.pec && <div className="text-xs text-indigo-500 truncate">PEC: {s.pec}</div>}
                        </div>
                        <div className="col-span-1">
                          {s.category ? (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{s.category}</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </div>
                        <div className="col-span-1 text-right text-sm font-medium text-slate-700">
                          {stats.total > 0 ? `€ ${stats.total.toLocaleString('it-IT', { minimumFractionDigits: 0 })}` : '—'}
                        </div>
                        <div className="col-span-1 text-right">
                          {stats.overdue > 0 ? (
                            <span className="text-sm font-semibold text-red-600">€ {stats.overdue.toLocaleString('it-IT', { minimumFractionDigits: 0 })}</span>
                          ) : (
                            <span className="text-xs text-emerald-500">In regola</span>
                          )}
                        </div>
                        <div className="col-span-1 text-center text-sm text-slate-600">
                          {s.payment_terms || s.default_payment_terms || 30} gg
                        </div>
                        <div className="col-span-1 flex items-center justify-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); openEdit(s); }} className="p-1.5 rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition" title="Modifica">
                            <Edit3 size={15} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition" title="Disattiva">
                            <Trash2 size={15} />
                          </button>
                          {isExpanded ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100">
                          <div className="grid grid-cols-3 gap-6">
                            {/* Col 1: Anagrafica */}
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Anagrafica completa</h4>
                              <div className="space-y-1.5 text-sm">
                                <Detail label="Ragione Sociale" value={name} />
                                <Detail label="P.IVA" value={vat} />
                                <Detail label="Codice Fiscale" value={s.codice_fiscale || s.fiscal_code} />
                                <Detail label="Codice SDI" value={s.codice_sdi} />
                                <Detail label="PEC" value={s.pec} />
                                <Detail label="IBAN" value={s.iban} mono />
                              </div>
                            </div>
                            {/* Col 2: Indirizzo & Contatti */}
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Indirizzo & contatti</h4>
                              <div className="space-y-1.5 text-sm">
                                <Detail label="Indirizzo" value={s.indirizzo} />
                                <Detail label="Città" value={[s.cap, s.citta, s.provincia].filter(Boolean).join(' ')} />
                                <Detail label="Email" value={s.email} />
                                <Detail label="Telefono" value={s.telefono} />
                                <Detail label="Note" value={s.note || s.notes} />
                              </div>
                            </div>
                            {/* Col 3: Condizioni e Statistiche */}
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Condizioni & statistiche</h4>
                              <div className="space-y-1.5 text-sm">
                                <Detail label="Termini pagamento" value={`${s.payment_terms || s.default_payment_terms || 30} giorni`} />
                                <Detail label="Metodo pagamento" value={s.payment_method || s.default_payment_method || 'bonifico'} />
                                <Detail label="Categoria" value={s.category} />
                                <Detail label="Centro di costo" value={s.cost_center === 'all' ? 'Tutti' : s.cost_center} />
                                <div className="border-t border-slate-200 pt-2 mt-2">
                                  <Detail label="Fatture totali" value={stats.count || 0} />
                                  <Detail label="Totale fatturato" value={stats.total > 0 ? `€ ${stats.total.toLocaleString('it-IT', { minimumFractionDigits: 2 })}` : '—'} />
                                  <Detail label="Già pagato" value={stats.paid > 0 ? `€ ${stats.paid.toLocaleString('it-IT', { minimumFractionDigits: 2 })}` : '—'} />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer */}
            <div className="px-4 py-3 bg-slate-50 border-t text-xs text-slate-500">
              {filteredSuppliers.length} fornitori visualizzati su {suppliers.length} totali
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
                          const key = getVat(s) || getName(s);
                          const st = supplierStats[key] || supplierStats[getName(s)] || { total: 0, paid: 0, pending: 0, overdue: 0, count: 0 };
                          return { ...s, ...st, displayName: getName(s) };
                        })
                        .filter(s => s.total > 0)
                        .sort((a, b) => b.total - a.total)
                        .slice(0, 15)
                        .map(s => (
                          <tr key={s.id} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-medium text-slate-700">{s.displayName}</td>
                            <td className="py-2 px-3 text-right font-semibold">€ {s.total.toLocaleString('it-IT', { minimumFractionDigits: 0 })}</td>
                            <td className="py-2 px-3 text-right text-emerald-600">€ {s.paid.toLocaleString('it-IT', { minimumFractionDigits: 0 })}</td>
                            <td className="py-2 px-3 text-right text-amber-600">€ {s.pending.toLocaleString('it-IT', { minimumFractionDigits: 0 })}</td>
                            <td className="py-2 px-3 text-right text-red-600 font-semibold">{s.overdue > 0 ? `€ ${s.overdue.toLocaleString('it-IT', { minimumFractionDigits: 0 })}` : '—'}</td>
                            <td className="py-2 px-3 text-right text-slate-500">{s.count}</td>
                          </tr>
                        ))}
                      {suppliers.every(s => {
                        const key = getVat(s) || getName(s);
                        const st = supplierStats[key] || supplierStats[getName(s)] || { total: 0 };
                        return st.total === 0;
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
                      <option value="bonifico">Bonifico</option>
                      <option value="riba">Ri.Ba.</option>
                      <option value="rid">RID / SDD</option>
                      <option value="assegno">Assegno</option>
                      <option value="contanti">Contanti</option>
                      <option value="carta">Carta</option>
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
