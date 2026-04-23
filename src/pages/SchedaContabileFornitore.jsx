import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Eye, CreditCard, ChevronDown, ChevronRight,
  Download, FileText, Printer, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, Clock, Building2, Mail, Phone, MapPin
} from 'lucide-react';
import InvoiceViewer from '../components/InvoiceViewer';
import StatusBadge from '../components/ui/StatusBadge';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// ─── Utility ───────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtEUR(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysDiff(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
}

function worstStatus(statuses) {
  if (statuses.includes('scaduto')) return 'scaduto';
  if (statuses.includes('in_scadenza')) return 'in_scadenza';
  if (statuses.includes('da_pagare')) return 'da_pagare';
  if (statuses.includes('parziale')) return 'parziale';
  return 'pagato';
}

const paymentMethodLabels = {
  bonifico_ordinario: 'Bonifico', bonifico_urgente: 'Bonifico urgente', bonifico_sepa: 'Bonifico SEPA',
  riba_30: 'RiBa 30gg', riba_60: 'RiBa 60gg', riba_90: 'RiBa 90gg', riba_120: 'RiBa 120gg',
  rid: 'RID', sdd_core: 'SDD Core', sdd_b2b: 'SDD B2B', carta_credito: 'Carta',
  contanti: 'Contanti', compensazione: 'Compensazione', mav: 'MAV', altro: 'Altro',
};

// ─── Component ─────────────────────────────────────────────────
export default function SchedaContabileFornitore() {
  const { supplierId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [supplier, setSupplier] = useState(null);
  const [payables, setPayables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState('latest');
  const [expandedInvoices, setExpandedInvoices] = useState(new Set());
  const [viewingXml, setViewingXml] = useState(null);
  const [categories, setCategories] = useState([]);

  // ─── Fetch data ────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!COMPANY_ID || !supplierId) return;
    setLoading(true);
    try {
      // Supplier info
      const { data: sup } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', supplierId)
        .single();
      setSupplier(sup);

      // Payables — match by supplier_id OR supplier_vat
      let allPayables = [];

      // By supplier_id
      const { data: byId } = await supabase
        .from('payables')
        .select('*, electronic_invoices:electronic_invoice_id(id, xml_content)')
        .eq('supplier_id', supplierId)
        .eq('company_id', COMPANY_ID)
        .order('invoice_date', { ascending: false });
      allPayables = byId || [];

      // Also match by supplier_vat if supplier has vat
      if (sup?.vat_number || sup?.partita_iva) {
        const vat = sup.vat_number || sup.partita_iva;
        const { data: byVat } = await supabase
          .from('payables')
          .select('*, electronic_invoices:electronic_invoice_id(id, xml_content)')
          .eq('supplier_vat', vat)
          .eq('company_id', COMPANY_ID)
          .is('supplier_id', null)
          .order('invoice_date', { ascending: false });
        if (byVat?.length > 0) {
          const existingIds = new Set(allPayables.map(p => p.id));
          byVat.forEach(p => { if (!existingIds.has(p.id)) allPayables.push(p); });
        }
      }

      // Also match by name
      if (sup?.name || sup?.ragione_sociale) {
        const name = sup.name || sup.ragione_sociale;
        const { data: byName } = await supabase
          .from('payables')
          .select('*, electronic_invoices:electronic_invoice_id(id, xml_content)')
          .eq('supplier_name', name)
          .eq('company_id', COMPANY_ID)
          .is('supplier_id', null)
          .order('invoice_date', { ascending: false });
        if (byName?.length > 0) {
          const existingIds = new Set(allPayables.map(p => p.id));
          byName.forEach(p => { if (!existingIds.has(p.id)) allPayables.push(p); });
        }
      }

      allPayables.sort((a, b) => new Date(b.invoice_date || 0) - new Date(a.invoice_date || 0));
      setPayables(allPayables);

      // Categories
      const { data: cats } = await supabase
        .from('cost_categories')
        .select('id, name')
        .eq('company_id', COMPANY_ID);
      setCategories(cats || []);

    } catch (err) {
      console.error('Errore caricamento scheda contabile:', err);
    } finally {
      setLoading(false);
    }
  }, [COMPANY_ID, supplierId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Derived data ──────────────────────────────────────────
  const anni = useMemo(() => {
    const set = new Set(payables.map(p => new Date(p.invoice_date || p.created_at).getFullYear()));
    return [...set].sort((a, b) => b - a);
  }, [payables]);

  // Set default year
  useEffect(() => {
    if (selectedYear === 'latest' && anni.length > 0) {
      setSelectedYear(anni[0]);
    }
  }, [anni, selectedYear]);

  const filteredPayables = useMemo(() => {
    if (selectedYear === 'all') return payables;
    return payables.filter(p => new Date(p.invoice_date || p.created_at).getFullYear() === selectedYear);
  }, [payables, selectedYear]);

  // Group by invoice_number for rate
  const fattureGrouped = useMemo(() => {
    const map = new Map();
    for (const p of filteredPayables) {
      const key = p.invoice_number || p.id;
      if (!map.has(key)) {
        map.set(key, {
          invoice_number: p.invoice_number,
          invoice_date: p.invoice_date,
          net_amount: 0,
          vat_amount: 0,
          gross_amount: 0,
          rate: [],
          electronic_invoice: p.electronic_invoices,
          due_date: p.due_date,
          payment_method: p.payment_method,
        });
      }
      const f = map.get(key);
      f.net_amount += parseFloat(p.net_amount || 0);
      f.vat_amount += parseFloat(p.vat_amount || 0);
      f.gross_amount += parseFloat(p.gross_amount || 0);
      f.rate.push(p);
      f.status = worstStatus(f.rate.map(r => r.status));
      // Use earliest due_date
      if (p.due_date && (!f.due_date || p.due_date < f.due_date)) f.due_date = p.due_date;
    }
    return [...map.values()].sort((a, b) => new Date(b.invoice_date || 0) - new Date(a.invoice_date || 0));
  }, [filteredPayables]);

  // KPIs — gestione Note Credito
  const kpis = useMemo(() => {
    const totFatturato = payables.filter(p => parseFloat(p.gross_amount || 0) > 0)
      .reduce((s, p) => s + parseFloat(p.gross_amount || 0), 0);
    const totCrediti = payables.filter(p => p.status === 'nota_credito' || parseFloat(p.gross_amount || 0) < 0)
      .reduce((s, p) => s + Math.abs(parseFloat(p.gross_amount || 0)), 0);
    const totPagato = payables.filter(p => p.status === 'pagato')
      .reduce((s, p) => s + parseFloat(p.gross_amount || 0), 0);
    const esposto = totFatturato - totCrediti - totPagato;
    const scadute = payables.filter(p => p.status === 'scaduto').length;
    return { totFatturato, totPagato, totCrediti, esposto, scadute, totali: payables.length };
  }, [payables]);

  // Year totals
  const yearTotals = useMemo(() => {
    const tot = { net: 0, vat: 0, gross: 0, pagato: 0, count: fattureGrouped.length };
    fattureGrouped.forEach(f => {
      tot.net += f.net_amount;
      tot.vat += f.vat_amount;
      tot.gross += f.gross_amount;
      if (f.status === 'pagato') tot.pagato += f.gross_amount;
    });
    return tot;
  }, [fattureGrouped]);

  // ─── Partitario ────────────────────────────────────────────
  const partitario = useMemo(() => {
    // Raggruppare fatture per invoice_number
    const invoiceMap = new Map();
    for (const p of filteredPayables) {
      const key = p.invoice_number || p.id;
      if (!invoiceMap.has(key)) {
        invoiceMap.set(key, { date: p.invoice_date, amount: 0, isNotaCredito: false });
      }
      const entry = invoiceMap.get(key);
      entry.amount += parseFloat(p.gross_amount || 0);
      if (p.status === 'nota_credito' || parseFloat(p.gross_amount || 0) < 0) {
        entry.isNotaCredito = true;
      }
    }

    // DARE: fatture positive, AVERE: note credito
    const movimenti = [];
    for (const [invoiceNumber, entry] of invoiceMap) {
      if (entry.isNotaCredito) {
        movimenti.push({
          data: entry.date,
          tipo: 'avere',
          descrizione: `Nota Credito ${invoiceNumber}`,
          importo: Math.abs(entry.amount),
        });
      } else {
        movimenti.push({
          data: entry.date,
          tipo: 'dare',
          descrizione: `Fatt. ${invoiceNumber}`,
          importo: entry.amount,
        });
      }
    }

    // AVERE: pagamenti reali (payables con status='pagato' e payment_date)
    filteredPayables
      .filter(p => p.status === 'pagato' && p.payment_date)
      .forEach(p => {
        movimenti.push({
          data: p.payment_date,
          tipo: 'avere',
          descrizione: `Pagamento — Fatt. ${p.invoice_number || '—'}`,
          importo: parseFloat(p.gross_amount || 0),
        });
      });

    // Sort cronologico
    movimenti.sort((a, b) => new Date(a.data || 0) - new Date(b.data || 0));

    // Saldo progressivo
    let saldo = 0;
    return movimenti.map(m => {
      if (m.tipo === 'dare') saldo += m.importo;
      else saldo -= m.importo;
      return { ...m, saldo };
    });
  }, [filteredPayables]);

  // ─── Actions ───────────────────────────────────────────────
  const toggleExpand = (invoiceNumber) => {
    setExpandedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(invoiceNumber)) next.delete(invoiceNumber);
      else next.add(invoiceNumber);
      return next;
    });
  };

  const handleViewInvoice = (fattura) => {
    const xml = fattura.electronic_invoice?.xml_content || fattura.rate?.[0]?.electronic_invoices?.xml_content;
    if (xml) {
      setViewingXml(xml);
    } else {
      alert('XML non disponibile per questa fattura');
    }
  };

  const handlePayAll = () => {
    const ids = payables
      .filter(p => p.status === 'scaduto' || p.status === 'in_scadenza')
      .map(p => p.id)
      .join(',');
    if (ids) navigate(`/scadenzario?supplier=${supplierId}&select=${ids}`);
  };

  const handlePrintScheda = () => {
    const w = window.open('', '_blank');
    if (!w) return;

    const righeHTML = fattureGrouped.map(f => `
      <tr>
        <td>${f.invoice_number || '—'}</td>
        <td>${fmtDate(f.invoice_date)}</td>
        <td>${fmtDate(f.due_date)}</td>
        <td style="text-align:right">${fmt(f.net_amount)}</td>
        <td style="text-align:right">${fmt(f.vat_amount)}</td>
        <td style="text-align:right;font-weight:bold">${fmt(f.gross_amount)}</td>
        <td>${f.status || '—'}</td>
      </tr>
    `).join('');

    const partitarioHTML = partitario.map(m => `
      <tr style="background:${m.tipo === 'avere' ? '#f0fdf4' : 'white'}">
        <td>${fmtDate(m.data)}</td>
        <td>${m.descrizione}</td>
        <td style="text-align:right">${m.tipo === 'dare' ? fmt(m.importo) : ''}</td>
        <td style="text-align:right;color:green">${m.tipo === 'avere' ? fmt(m.importo) : ''}</td>
        <td style="text-align:right;font-weight:bold;color:${m.saldo > 0 ? '#dc2626' : '#16a34a'}">${fmt(m.saldo)}</td>
      </tr>
    `).join('');

    w.document.write(`<!DOCTYPE html><html><head>
      <title>Scheda Contabile — ${supplier?.name || supplier?.ragione_sociale || ''}</title>
      <style>
        @page { size: A4; margin: 15mm 20mm; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #333; }
        h1 { font-size: 14pt; color: #1e40af; margin-bottom: 4px; }
        h2 { font-size: 11pt; color: #1e40af; margin-top: 20px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th { background: #f0f4ff; padding: 6px; text-align: left; font-size: 8pt; text-transform: uppercase; color: #555; border-bottom: 2px solid #2563eb; }
        td { padding: 5px 6px; border-bottom: 1px solid #eee; font-size: 9pt; }
        .info { font-size: 9pt; color: #555; }
        .kpi { display: flex; gap: 20px; margin: 15px 0; }
        .kpi-card { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; text-align: center; }
        .kpi-label { font-size: 8pt; text-transform: uppercase; color: #888; }
        .kpi-value { font-size: 14pt; font-weight: bold; }
        .footer { margin-top: 20px; font-size: 8pt; color: #999; text-align: center; border-top: 1px solid #ddd; padding-top: 8px; }
      </style>
    </head><body>
      <h1>${supplier?.name || supplier?.ragione_sociale || ''}</h1>
      <div class="info">P.IVA: ${supplier?.vat_number || supplier?.partita_iva || '—'} | CF: ${supplier?.codice_fiscale || supplier?.fiscal_code || '—'}</div>
      <div class="info">${supplier?.indirizzo || ''} ${supplier?.cap || ''} ${supplier?.comune || ''} ${supplier?.provincia ? `(${supplier.provincia})` : ''}</div>
      <div class="kpi">
        <div class="kpi-card"><div class="kpi-label">Fatturato</div><div class="kpi-value">${fmtEUR(kpis.totFatturato)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Pagato</div><div class="kpi-value" style="color:#16a34a">${fmtEUR(kpis.totPagato)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Esposto</div><div class="kpi-value" style="color:#dc2626">${fmtEUR(kpis.esposto)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Scadute</div><div class="kpi-value" style="color:#d97706">${kpis.scadute}/${kpis.totali}</div></div>
      </div>
      <h2>FATTURE ${selectedYear === 'all' ? '— TUTTI GLI ANNI' : selectedYear}</h2>
      <table>
        <thead><tr><th>N. Fattura</th><th>Data</th><th>Scadenza</th><th style="text-align:right">Imponibile</th><th style="text-align:right">IVA</th><th style="text-align:right">Totale</th><th>Stato</th></tr></thead>
        <tbody>${righeHTML}
          <tr style="background:#eff6ff;font-weight:bold"><td colspan="3">TOTALE ${selectedYear === 'all' ? '' : selectedYear} — ${yearTotals.count} fatture</td>
            <td style="text-align:right">${fmt(yearTotals.net)}</td><td style="text-align:right">${fmt(yearTotals.vat)}</td><td style="text-align:right">${fmt(yearTotals.gross)}</td><td></td></tr>
        </tbody>
      </table>
      <h2>PARTITARIO</h2>
      <table>
        <thead><tr><th>Data</th><th>Descrizione</th><th style="text-align:right">Dare (Fatture)</th><th style="text-align:right">Avere (Pagamenti)</th><th style="text-align:right">Saldo</th></tr></thead>
        <tbody>${partitarioHTML}</tbody>
      </table>
      <div class="footer">Generato il ${new Date().toLocaleDateString('it-IT')} — Gestionale New Zago</div>
      <script>window.onload = function() { window.print(); };</script>
    </body></html>`);
    w.document.close();
  };

  // ─── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="p-8 text-center text-slate-500">
        <AlertTriangle className="mx-auto mb-4 text-amber-500" size={40} />
        <p className="text-lg font-medium">Fornitore non trovato</p>
        <button onClick={() => navigate('/fornitori')} className="mt-4 text-blue-600 hover:underline">← Torna ai fornitori</button>
      </div>
    );
  }

  const supplierCategory = categories.find(c => c.id === supplier.default_cost_category_id);

  return (
    <div className="space-y-6">
      {/* InvoiceViewer modal */}
      {viewingXml && <InvoiceViewer xmlContent={viewingXml} onClose={() => setViewingXml(null)} />}

      {/* Breadcrumb + Back */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/fornitori')} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition">
          <ArrowLeft size={18} />
        </button>
        <div className="text-sm text-slate-500">
          <Link to="/fornitori" className="hover:text-blue-600 transition">Fornitori</Link>
          <span className="mx-1.5">›</span>
          <span className="text-slate-900 font-medium">{supplier.name || supplier.ragione_sociale}</span>
          <span className="mx-1.5">›</span>
          <span className="text-slate-700">Scheda Contabile</span>
        </div>
      </div>

      {/* ─── INTESTAZIONE ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <Building2 size={20} className="text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{supplier.name || supplier.ragione_sociale}</h1>
                {supplierCategory && (
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">{supplierCategory.name}</span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-sm text-slate-600 mt-3">
              {(supplier.vat_number || supplier.partita_iva) && (
                <div><span className="text-slate-400">P.IVA:</span> {supplier.vat_number || supplier.partita_iva}</div>
              )}
              {(supplier.codice_fiscale || supplier.fiscal_code) && (
                <div><span className="text-slate-400">CF:</span> {supplier.codice_fiscale || supplier.fiscal_code}</div>
              )}
              {supplier.indirizzo && (
                <div className="flex items-center gap-1.5">
                  <MapPin size={12} className="text-slate-400" />
                  {supplier.indirizzo}, {supplier.cap} {supplier.comune} {supplier.provincia && `(${supplier.provincia})`}
                </div>
              )}
              {supplier.iban && (
                <div><span className="text-slate-400">IBAN:</span> <span className="font-mono text-xs">{supplier.iban}</span></div>
              )}
              {supplier.email && (
                <div className="flex items-center gap-1.5"><Mail size={12} className="text-slate-400" />{supplier.email}</div>
              )}
              {supplier.pec && (
                <div className="flex items-center gap-1.5"><Mail size={12} className="text-blue-400" />{supplier.pec} <span className="text-xs text-blue-400">(PEC)</span></div>
              )}
              {supplier.telefono && (
                <div className="flex items-center gap-1.5"><Phone size={12} className="text-slate-400" />{supplier.telefono}</div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handlePrintScheda} className="flex items-center gap-1.5 px-3 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              <Printer size={14} /> Stampa PDF
            </button>
            {kpis.scadute > 0 && (
              <button onClick={handlePayAll} className="flex items-center gap-1.5 px-3 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition">
                <CreditCard size={14} /> Paga scadute ({kpis.scadute})
              </button>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="rounded-xl bg-blue-50 p-4 text-center">
            <div className="text-xs text-blue-600 uppercase font-semibold">Totale fatturato</div>
            <div className="text-lg font-bold text-blue-900 mt-1">{fmtEUR(kpis.totFatturato)}</div>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4 text-center">
            <div className="text-xs text-emerald-600 uppercase font-semibold">Totale pagato</div>
            <div className="text-lg font-bold text-emerald-900 mt-1">{fmtEUR(kpis.totPagato)}</div>
          </div>
          <div className={`rounded-xl p-4 text-center ${kpis.esposto > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
            <div className={`text-xs uppercase font-semibold ${kpis.esposto > 0 ? 'text-red-600' : 'text-slate-500'}`}>Esposto</div>
            <div className={`text-lg font-bold mt-1 ${kpis.esposto > 0 ? 'text-red-900' : 'text-slate-700'}`}>{fmtEUR(kpis.esposto)}</div>
          </div>
          <div className={`rounded-xl p-4 text-center ${kpis.scadute > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
            <div className={`text-xs uppercase font-semibold ${kpis.scadute > 0 ? 'text-amber-600' : 'text-slate-500'}`}>Scadute</div>
            <div className={`text-lg font-bold mt-1 ${kpis.scadute > 0 ? 'text-amber-900' : 'text-slate-700'}`}>{kpis.scadute} / {kpis.totali}</div>
          </div>
        </div>
      </div>

      {/* ─── TAB ANNI + TABELLA FATTURE ───────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-5 pt-4 pb-2 border-b border-slate-100 overflow-x-auto">
          <BookOpen size={16} className="text-blue-600 mr-2 flex-shrink-0" />
          <span className="text-sm font-semibold text-slate-700 mr-4 flex-shrink-0">Fatture</span>
          {anni.map(y => (
            <button key={y}
              onClick={() => setSelectedYear(y)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition flex-shrink-0 ${
                selectedYear === y ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >{y}</button>
          ))}
          <button
            onClick={() => setSelectedYear('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition flex-shrink-0 ${
              selectedYear === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >Tutti</button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase">
                <th className="px-3 py-2.5 text-left w-8"></th>
                <th className="px-3 py-2.5 text-left">N. Fattura</th>
                <th className="px-3 py-2.5 text-left">Data</th>
                <th className="px-3 py-2.5 text-left">Scadenza</th>
                <th className="px-3 py-2.5 text-right">Imponibile</th>
                <th className="px-3 py-2.5 text-right">IVA</th>
                <th className="px-3 py-2.5 text-right">Totale</th>
                <th className="px-3 py-2.5 text-center">Stato</th>
                <th className="px-3 py-2.5 text-center">Pagamento</th>
                <th className="px-3 py-2.5 text-center w-20">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {fattureGrouped.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400">Nessuna fattura per il periodo selezionato</td></tr>
              )}
              {fattureGrouped.map((f, idx) => {
                const hasRate = f.rate.length > 1 && f.rate.some(r => r.installment_number != null);
                const isExpanded = expandedInvoices.has(f.invoice_number);
                const dd = daysDiff(f.due_date);
                const dueBadge = f.status === 'pagato'
                  ? fmtDate(f.rate[0]?.payment_date)
                  : dd != null
                    ? dd < 0 ? <span className="text-red-600 font-medium">{dd}gg</span> : <span className="text-slate-500">tra {dd}gg</span>
                    : '—';

                return (
                  <React.Fragment key={f.invoice_number || idx}>
                    <tr className={`border-b border-slate-50 hover:bg-slate-25 transition ${idx % 2 === 0 ? '' : 'bg-slate-25/50'}`}>
                      <td className="px-2 py-2">
                        {hasRate && (
                          <button onClick={() => toggleExpand(f.invoice_number)} className="p-0.5 rounded hover:bg-slate-100 text-slate-400">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {f.invoice_number || '—'}
                        {hasRate && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-medium">{f.rate.length} rate</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{fmtDate(f.invoice_date)}</td>
                      <td className={`px-3 py-2 ${dd != null && dd < 0 && f.status !== 'pagato' ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                        {fmtDate(f.due_date)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{fmt(f.net_amount)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{fmt(f.vat_amount)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${f.gross_amount < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>{fmt(f.gross_amount)}</td>
                      <td className="px-3 py-2 text-center"><StatusBadge status={f.status} size="sm" /></td>
                      <td className="px-3 py-2 text-center text-xs">{dueBadge}</td>
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <button onClick={() => handleViewInvoice(f)} className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition" title="Vedi fattura">
                            <Eye size={14} />
                          </button>
                          {f.status !== 'pagato' && f.status !== 'nota_credito' && parseFloat(f.gross_amount) > 0 && (
                            <button onClick={() => navigate(`/scadenzario?select=${f.rate[0]?.id}`)} className="p-1 rounded hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition" title="Paga">
                              <CreditCard size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded rate */}
                    {hasRate && isExpanded && f.rate.map((r, ri) => (
                      <tr key={r.id} className="bg-indigo-50/30 border-b border-indigo-100/50">
                        <td className="px-2 py-1.5"></td>
                        <td className="px-3 py-1.5 text-xs text-indigo-600 pl-8">
                          Rata {r.installment_number || ri + 1}/{f.rate.length}
                          {r.payment_method && <span className="ml-2 text-slate-500">{paymentMethodLabels[r.payment_method] || r.payment_method}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">{fmtDate(r.invoice_date)}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">{fmtDate(r.due_date)}</td>
                        <td className="px-3 py-1.5 text-right text-xs text-slate-400"></td>
                        <td className="px-3 py-1.5 text-right text-xs text-slate-400"></td>
                        <td className="px-3 py-1.5 text-right text-xs font-medium text-slate-700">{fmt(parseFloat(r.gross_amount || 0))}</td>
                        <td className="px-3 py-1.5 text-center"><StatusBadge status={r.status} size="sm" /></td>
                        <td className="px-3 py-1.5 text-center text-xs text-slate-500">
                          {r.status === 'pagato' ? fmtDate(r.payment_date) : daysDiff(r.due_date) != null ? `${daysDiff(r.due_date)}gg` : '—'}
                        </td>
                        <td className="px-2 py-1.5"></td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {/* Totale anno */}
              {fattureGrouped.length > 0 && (
                <tr className="bg-blue-50 font-semibold text-sm">
                  <td className="px-2 py-3"></td>
                  <td className="px-3 py-3 text-blue-800" colSpan={3}>
                    TOTALE {selectedYear === 'all' ? '' : selectedYear} — {yearTotals.count} fatture
                  </td>
                  <td className="px-3 py-3 text-right text-blue-800">{fmt(yearTotals.net)}</td>
                  <td className="px-3 py-3 text-right text-blue-800">{fmt(yearTotals.vat)}</td>
                  <td className="px-3 py-3 text-right text-blue-900">{fmt(yearTotals.gross)}</td>
                  <td className="px-3 py-3 text-center text-xs text-blue-600">
                    Pagato: {fmt(yearTotals.pagato)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── PARTITARIO ───────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="px-5 pt-4 pb-2 border-b border-slate-100 flex items-center gap-2">
          <FileText size={16} className="text-blue-600" />
          <span className="text-sm font-semibold text-slate-700">Partitario — Dare / Avere / Saldo</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase">
                <th className="px-4 py-2.5 text-left">Data</th>
                <th className="px-4 py-2.5 text-left">Descrizione</th>
                <th className="px-4 py-2.5 text-right">Dare (Fatture)</th>
                <th className="px-4 py-2.5 text-right">Avere (Pagamenti)</th>
                <th className="px-4 py-2.5 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {partitario.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Nessun movimento</td></tr>
              )}
              {partitario.map((m, i) => (
                <tr key={i} className={`border-b border-slate-50 ${m.tipo === 'avere' ? 'bg-emerald-50/30' : i % 2 === 0 ? '' : 'bg-slate-25/50'}`}>
                  <td className="px-4 py-2 text-slate-600">{fmtDate(m.data)}</td>
                  <td className="px-4 py-2 text-slate-800">{m.descrizione}</td>
                  <td className="px-4 py-2 text-right text-slate-900">{m.tipo === 'dare' ? fmt(m.importo) : ''}</td>
                  <td className="px-4 py-2 text-right text-emerald-700 font-medium">{m.tipo === 'avere' ? fmt(m.importo) : ''}</td>
                  <td className={`px-4 py-2 text-right font-bold ${m.saldo > 0.01 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(m.saldo)}</td>
                </tr>
              ))}
              {/* Riga saldo finale */}
              {partitario.length > 0 && (
                <tr className={`font-bold text-sm ${partitario[partitario.length - 1]?.saldo > 0.01 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                  <td className="px-4 py-3" colSpan={4}>SALDO PARTITE APERTE</td>
                  <td className={`px-4 py-3 text-right text-lg ${partitario[partitario.length - 1]?.saldo > 0.01 ? 'text-red-800' : 'text-emerald-800'}`}>
                    {fmtEUR(partitario[partitario.length - 1]?.saldo || 0)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
