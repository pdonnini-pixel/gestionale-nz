import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Search, Download, Eye, RefreshCw,
  X, FileWarning, CheckCircle,
  AlertCircle, Database, FolderOpen, Archive, Users, Receipt,
  ShieldCheck, AlertTriangle, Lock, Unlock, BarChart3,
  ChevronDown, ChevronRight, Building2, ExternalLink
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import InvoiceViewer from '../components/InvoiceViewer';

// ─── HELPERS ───────────────────────────────────────────────────
function formatDate(d) {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '-'; }
}

function formatCurrency(n) {
  if (n == null) return '-';
  return `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

const MONTH_LABELS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTH_FULL = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPALE
// ═══════════════════════════════════════════════════════════════

export default function ArchivioDocumenti() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [activeTab, setActiveTab] = useState('archivio'); // archivio | conservazione
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Conservazione state (invariato rispetto alla versione precedente) ──
  const [retentionDocs, setRetentionDocs] = useState([]);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionFilter, setRetentionFilter] = useState('all');
  const [retentionSearch, setRetentionSearch] = useState('');

  useEffect(() => {
    if (!COMPANY_ID || activeTab !== 'conservazione') return;
    loadRetention();
  }, [COMPANY_ID, activeTab]);

  async function loadRetention() {
    setRetentionLoading(true);
    const results = [];
    try {
      const { data } = await supabase
        .from('electronic_invoices')
        .select('id, company_id, invoice_number, invoice_date, supplier_name, customer_name, total_amount, direction, sdi_status, retention_start, retention_end, retention_status, storage_path, xml_file_path, created_at')
        .eq('company_id', COMPANY_ID)
        .not('retention_start', 'is', null)
        .order('retention_end', { ascending: true })
        .limit(1000);
      (data || []).forEach(d => results.push({ ...d, _source: 'invoice' }));
    } catch (e) { console.warn('retention invoices:', e.message); }
    try {
      const { data } = await supabase
        .from('documents')
        .select('id, company_id, title, category, file_name, file_path, storage_bucket, retention_start, retention_end, retention_status, created_at')
        .eq('company_id', COMPANY_ID)
        .not('retention_start', 'is', null)
        .order('retention_end', { ascending: true })
        .limit(1000);
      (data || []).forEach(d => results.push({ ...d, _source: 'document' }));
    } catch (e) { console.warn('retention documents:', e.message); }
    setRetentionDocs(results);
    setRetentionLoading(false);
  }

  const today = new Date();
  const sixMonthsFromNow = new Date(today.getTime() + 180 * 86400000);
  function getRetentionStatus(doc) {
    if (!doc.retention_end) return 'unknown';
    const end = new Date(doc.retention_end);
    if (end < today) return 'expired';
    if (end < sixMonthsFromNow) return 'expiring';
    return 'active';
  }
  function daysUntilExpiry(doc) {
    if (!doc.retention_end) return null;
    return Math.ceil((new Date(doc.retention_end) - today) / 86400000);
  }
  const retentionStats = useMemo(() => {
    const active = retentionDocs.filter(d => getRetentionStatus(d) === 'active').length;
    const expiring = retentionDocs.filter(d => getRetentionStatus(d) === 'expiring').length;
    const expired = retentionDocs.filter(d => getRetentionStatus(d) === 'expired').length;
    const invoices = retentionDocs.filter(d => d._source === 'invoice').length;
    const documents = retentionDocs.filter(d => d._source === 'document').length;
    return { total: retentionDocs.length, active, expiring, expired, invoices, documents };
  }, [retentionDocs]);
  const filteredRetention = useMemo(() => {
    let docs = [...retentionDocs];
    if (retentionFilter !== 'all') docs = docs.filter(d => getRetentionStatus(d) === retentionFilter);
    if (retentionSearch.trim()) {
      const q = retentionSearch.toLowerCase();
      docs = docs.filter(d =>
        (d.invoice_number || '').toLowerCase().includes(q) ||
        (d.supplier_name || '').toLowerCase().includes(q) ||
        (d.customer_name || '').toLowerCase().includes(q) ||
        (d.title || '').toLowerCase().includes(q) ||
        (d.file_name || '').toLowerCase().includes(q)
      );
    }
    return docs;
  }, [retentionDocs, retentionFilter, retentionSearch]);

  async function updateRetentionStatus(docId, source, newStatus) {
    const table = source === 'invoice' ? 'electronic_invoices' : 'documents';
    const { error } = await supabase.from(table).update({ retention_status: newStatus }).eq('id', docId);
    if (error) { showToast('Errore aggiornamento: ' + error.message, 'error'); return; }
    showToast('Stato conservazione aggiornato');
    loadRetention();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 p-6 space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-100 rounded-xl">
            <Archive className="w-7 h-7 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Archivio Documenti</h1>
            <p className="text-sm text-slate-500">
              {activeTab === 'conservazione' ? 'Conservazione sostitutiva — 10 anni' : 'Fatture, bilanci ed estratti conto'}
            </p>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 shadow-sm">
        {[
          { key: 'archivio', label: 'Archivio', icon: FolderOpen },
          { key: 'conservazione', label: 'Conservazione Sostitutiva', icon: ShieldCheck },
        ].map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition flex-1 justify-center ${
                active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'archivio' && <ArchivioTab companyId={COMPANY_ID} showToast={showToast} />}

      {activeTab === 'conservazione' && (
        <ConservazioneTab
          docs={filteredRetention}
          stats={retentionStats}
          loading={retentionLoading}
          filter={retentionFilter}
          setFilter={setRetentionFilter}
          search={retentionSearch}
          setSearch={setRetentionSearch}
          getRetentionStatus={getRetentionStatus}
          daysUntilExpiry={daysUntilExpiry}
          updateStatus={updateRetentionStatus}
        />
      )}

      {/* TOAST */}
      {toast && (
        <div className={'fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ' + (toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white')}>
          {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB ARCHIVIO — 3 SEZIONI (Fatture, Bilanci, Estratti Conto)
// ═══════════════════════════════════════════════════════════════

function ArchivioTab({ companyId, showToast }) {
  const navigate = useNavigate();
  const [allInvoices, setAllInvoices] = useState([]); // tutte le fatture (minimal fields) — per anni disponibili e count globale
  const [invoices, setInvoices] = useState([]);       // fatture dell'anno selezionato (dati completi)
  const [balanceSheets, setBalanceSheets] = useState([]);
  const [ecFiles, setEcFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingYear, setLoadingYear] = useState(false);

  // Anno corrente selezionato per la sezione Fatture
  const [year, setYear] = useState(new Date().getFullYear());
  // Raggruppamento: fornitore | mese
  const [groupBy, setGroupBy] = useState('supplier');
  const [searchInvoices, setSearchInvoices] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  // Viewer fattura. autoPrintViewer = true → il modal si apre e triggera
  // subito la stampa/PDF senza mostrare l'anteprima (usato da "Scarica PDF")
  const [viewerXml, setViewerXml] = useState(null);
  const [autoPrintViewer, setAutoPrintViewer] = useState(false);
  const [loadingXml, setLoadingXml] = useState(null);

  // Anteprima EC: mostra i movimenti della banca in un modal sull'Archivio
  // senza dover navigare a Banche.
  const [ecPreview, setEcPreview] = useState(null); // { ec, rows, loading }

  // Collasso delle 3 sezioni principali. Fatture parte CHIUSA perche'
  // con 199 fatture e' la sezione piu' rumorosa. Bilanci ed EC restano
  // aperti perche' sono liste corte (1-5 elementi).
  const [sectionOpen, setSectionOpen] = useState({
    fatture: false,
    bilanci: true,
    ec: true,
  });
  const toggleSection = (k) => setSectionOpen(s => ({ ...s, [k]: !s[k] }));

  useEffect(() => {
    if (!companyId) return;
    loadAll();
  }, [companyId]);

  // Quando cambia anno, ricarica solo le fatture dell'anno (filtro DB-level)
  useEffect(() => {
    if (!companyId) return;
    loadInvoicesForYear(year);
  }, [companyId, year]);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadAllInvoicesMinimal(), loadBalanceSheets(), loadEcFiles()]);
    setLoading(false);
  }

  /**
   * Carica TUTTE le fatture con campi minimi per alimentare il selettore anno
   * e il count globale delle KPI card. Non viene usato per il rendering.
   */
  async function loadAllInvoicesMinimal() {
    try {
      const { data, error } = await supabase
        .from('electronic_invoices')
        .select('id, invoice_date')
        .eq('company_id', companyId)
        .order('invoice_date', { ascending: false });
      if (error) throw error;
      setAllInvoices(data || []);
    } catch (e) {
      console.warn('load all invoices:', e.message);
      setAllInvoices([]);
    }
  }

  /**
   * Carica le fatture dell'anno via range DB-level su invoice_date.
   * IMPORTANTE: electronic_invoices NON ha colonna `year`, quindi il filtro
   * deve passare da invoice_date. Usiamo gte/lt sull'anno successivo cosi
   * includiamo anche il 31/12 senza problemi di fuso.
   */
  async function loadInvoicesForYear(y) {
    setLoadingYear(true);
    try {
      const { data, error } = await supabase
        .from('electronic_invoices')
        .select('*')
        .eq('company_id', companyId)
        .gte('invoice_date', `${y}-01-01`)
        .lt('invoice_date', `${y + 1}-01-01`)
        .order('invoice_date', { ascending: false });
      if (error) throw error;
      setInvoices(data || []);
    } catch (e) {
      console.warn('load invoices year:', e.message);
      showToast && showToast('Errore caricamento fatture: ' + e.message, 'error');
      setInvoices([]);
    } finally {
      setLoadingYear(false);
    }
  }

  async function loadBalanceSheets() {
    try {
      const { data } = await supabase
        .from('balance_sheet_imports')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50);
      setBalanceSheets(data || []);
    } catch (e) {
      console.warn('load balance sheets:', e.message);
      setBalanceSheets([]);
    }
  }

  /**
   * Estratti conto: leggiamo da `bank_statements` (metadati "operativi":
   * filename, transaction_count, status) e da `bank_imports` (file fisico
   * nel bucket). Le due tabelle non si matchano perfettamente perche'
   * possono essere popolate da flussi diversi (TesoreriaManuale vs
   * ImportHub) con formati filename leggermente diversi.
   *
   * Matching a 3 livelli (ognuno piu' permissivo del precedente):
   *  1. bank_account_id + filename esatto
   *  2. filename esatto (qualsiasi conto)
   *  3. ultimo upload del bank_account_id (fallback)
   */
  async function loadEcFiles() {
    try {
      const [stmtRes, impRes] = await Promise.all([
        supabase
          .from('bank_statements')
          .select('id, filename, file_type, transaction_count, status, bank_account_id, created_at, bank_accounts(bank_name, account_name)')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('bank_imports')
          .select('id, file_name, file_path, file_size, bank_account_id, uploaded_at, created_at')
          .eq('company_id', companyId)
          .order('uploaded_at', { ascending: false })
          .limit(200),
      ]);

      if (stmtRes.error) throw stmtRes.error;

      const imports = impRes.data || [];
      // 3 indici per i diversi livelli di matching
      const byAccountAndName = new Map(); // bank_account_id + filename
      const byName = new Map();            // solo filename
      const byAccount = new Map();         // solo bank_account_id (piu' recente)
      for (const imp of imports) {
        const fn = (imp.file_name || '').toLowerCase();
        const keyA = `${imp.bank_account_id || ''}::${fn}`;
        if (!byAccountAndName.has(keyA)) byAccountAndName.set(keyA, imp);
        if (fn && !byName.has(fn)) byName.set(fn, imp);
        if (imp.bank_account_id && !byAccount.has(imp.bank_account_id)) {
          byAccount.set(imp.bank_account_id, imp);
        }
      }

      const enriched = (stmtRes.data || []).map(ec => {
        const fn = (ec.filename || '').toLowerCase();
        const byFull = byAccountAndName.get(`${ec.bank_account_id || ''}::${fn}`);
        const byFn = byName.get(fn);
        const byAcc = byAccount.get(ec.bank_account_id);
        const src = byFull || byFn || byAcc || null;
        return {
          ...ec,
          file_path: src?.file_path || null,
          file_size: src?.file_size || null,
        };
      });

      // Deduplica per bank_account_id: tieni l'import piu' recente
      const latestByAccount = new Map();
      for (const ec of enriched) {
        const key = ec.bank_account_id || ec.id;
        if (!latestByAccount.has(key)) latestByAccount.set(key, ec);
      }
      setEcFiles(Array.from(latestByAccount.values()));
    } catch (e) {
      console.warn('load ec files:', e.message);
      setEcFiles([]);
    }
  }

  /**
   * Apre il modal di anteprima EC con i movimenti bancari. Legge da
   * ENTRAMBE le tabelle dei movimenti (bank_transactions da TesoreriaManuale
   * e cash_movements da ImportHub) con query separate in modo che se una
   * fallisce (FK mancante) l'altra continua a funzionare.
   */
  async function openEcPreview(ec) {
    setEcPreview({ ec, rows: [], loading: true });
    const rows = [];
    try {
      try {
        const { data, error } = await supabase
          .from('bank_transactions')
          .select('id, transaction_date, description, amount, running_balance, is_reconciled')
          .eq('company_id', companyId)
          .eq('bank_account_id', ec.bank_account_id)
          .order('transaction_date', { ascending: false })
          .limit(100);
        if (error) throw error;
        for (const r of (data || [])) {
          rows.push({
            id: 'bt_' + r.id,
            transaction_date: r.transaction_date,
            description: r.description,
            amount: r.amount,
            running_balance: r.running_balance,
            is_reconciled: r.is_reconciled,
          });
        }
      } catch (e) { console.warn('bt preview:', e.message); }

      try {
        const { data, error } = await supabase
          .from('cash_movements')
          .select('id, date, description, amount, balance_after, is_reconciled')
          .eq('company_id', companyId)
          .eq('bank_account_id', ec.bank_account_id)
          .order('date', { ascending: false })
          .limit(100);
        if (error) throw error;
        for (const r of (data || [])) {
          rows.push({
            id: 'cm_' + r.id,
            transaction_date: r.date,
            description: r.description,
            amount: r.amount,
            running_balance: r.balance_after,
            is_reconciled: r.is_reconciled,
          });
        }
      } catch (e) { console.warn('cm preview:', e.message); }

      rows.sort((a, b) => new Date(b.transaction_date || 0) - new Date(a.transaction_date || 0));
      setEcPreview({ ec, rows: rows.slice(0, 100), loading: false });
    } catch (err) {
      showToast('Errore anteprima EC: ' + err.message, 'error');
      setEcPreview(null);
    }
  }

  /**
   * Download robusto del file EC originale.
   * Fallback: se file_path non e' valido prova a cercare il file nel bucket
   * bank-statements via storage.list finche' non trova un filename che
   * contenga il nome dell'EC.
   */
  async function downloadEcFile(ec) {
    if (ec.file_path) {
      return downloadFile('bank-statements', ec.file_path, ec.filename);
    }
    // Fallback: cerca nel bucket per nome file
    try {
      const { data: files, error } = await supabase.storage
        .from('bank-statements')
        .list(`${companyId}/imports/bank`, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });
      if (error) throw error;
      const target = (ec.filename || '').toLowerCase();
      const match = (files || []).find(f => (f.name || '').toLowerCase().includes(target.replace(/\.(xls|xlsx|csv)$/i, '')));
      if (!match) {
        showToast('File originale non trovato nello storage', 'error');
        return;
      }
      const path = `${companyId}/imports/bank/${match.name}`;
      await downloadFile('bank-statements', path, ec.filename || match.name);
    } catch (err) {
      showToast('Errore ricerca file: ' + err.message, 'error');
    }
  }

  // ─── DATI DERIVATI ─────────────────────────────────────────

  // Anni presenti nelle fatture (per il selector). Legge da allInvoices che
  // contiene solo id + invoice_date di TUTTE le fatture.
  const availableYears = useMemo(() => {
    const years = new Set([new Date().getFullYear()]);
    allInvoices.forEach(inv => {
      if (!inv.invoice_date) return;
      // Uso substring per evitare problemi di timezone sul Date parsing
      const y = parseInt((inv.invoice_date + '').substring(0, 4), 10);
      if (y && !isNaN(y)) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [allInvoices]);

  // Conteggio fatture per ciascun anno (usato per i KPI "fatture nell'anno")
  const invoicesPerYear = useMemo(() => {
    const counts = {};
    allInvoices.forEach(inv => {
      if (!inv.invoice_date) return;
      const y = (inv.invoice_date + '').substring(0, 4);
      counts[y] = (counts[y] || 0) + 1;
    });
    return counts;
  }, [allInvoices]);

  // Fatture filtrate per ricerca (il filtro anno e' gia' DB-level)
  const filteredInvoices = useMemo(() => {
    if (!searchInvoices.trim()) return invoices;
    const q = searchInvoices.toLowerCase();
    return invoices.filter(inv =>
      (inv.supplier_name || '').toLowerCase().includes(q) ||
      (inv.invoice_number || '').toLowerCase().includes(q) ||
      (inv.supplier_vat || '').toLowerCase().includes(q)
    );
  }, [invoices, searchInvoices]);

  // Fatture raggruppate
  const groups = useMemo(() => {
    const map = new Map();
    for (const inv of filteredInvoices) {
      let key, label, sortKey;
      if (groupBy === 'supplier') {
        key = inv.supplier_vat || inv.supplier_name || 'unknown';
        label = inv.supplier_name || 'Fornitore sconosciuto';
        sortKey = label.toLowerCase();
      } else {
        const d = new Date(inv.invoice_date);
        const m = d.getMonth();
        key = `${d.getFullYear()}-${String(m).padStart(2, '0')}`;
        label = `${MONTH_FULL[m]} ${d.getFullYear()}`;
        sortKey = `${d.getFullYear()}-${String(11 - m).padStart(2, '0')}`; // mesi piu' recenti prima
      }
      if (!map.has(key)) {
        map.set(key, { key, label, sortKey, invoices: [], total: 0 });
      }
      const g = map.get(key);
      g.invoices.push(inv);
      g.total += Number(inv.gross_amount || inv.total_amount || 0);
    }
    // Ordina: per fornitore alfabetico, per mese cronologico inverso
    return Array.from(map.values()).sort((a, b) => {
      if (groupBy === 'supplier') return a.sortKey.localeCompare(b.sortKey);
      return a.sortKey.localeCompare(b.sortKey);
    });
  }, [filteredInvoices, groupBy]);

  const totalInvoicesAmount = useMemo(
    () => filteredInvoices.reduce((s, i) => s + Number(i.gross_amount || i.total_amount || 0), 0),
    [filteredInvoices]
  );

  // Quando l'utente inizia a cercare, espande automaticamente i gruppi che
  // contengono risultati cosi vede subito cosa ha trovato senza click extra.
  // Se cancella la ricerca tornano tutti chiusi.
  useEffect(() => {
    if (!searchInvoices.trim()) {
      setExpandedGroups(new Set());
      return;
    }
    const matches = new Set(groups.map(g => g.key));
    setExpandedGroups(matches);
  }, [searchInvoices]); // eslint-disable-line react-hooks/exhaustive-deps

  const allExpanded = groups.length > 0 && groups.every(g => expandedGroups.has(g.key));

  function toggleAllGroups() {
    if (allExpanded) {
      setExpandedGroups(new Set());
    } else {
      setExpandedGroups(new Set(groups.map(g => g.key)));
    }
  }

  function toggleGroup(key) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ─── OPEN VIEWER ───────────────────────────────────────────

  /**
   * Apre il viewer fattura. Se autoPrint=true viene lanciata subito la
   * stampa/PDF con layout A4 leggibile — cosi il bottone "Scarica PDF"
   * produce un PDF tipografico (non l'XML grezzo) riutilizzando la stessa
   * funzione handlePrint del viewer.
   */
  async function openInvoiceViewer(inv, { autoPrint = false } = {}) {
    setLoadingXml(inv.id);
    try {
      let xml = inv.xml_content;
      if (!xml && inv.xml_file_path) {
        const { data: blob } = await supabase.storage.from('invoices').download(inv.xml_file_path);
        if (blob) xml = await blob.text();
      }
      if (!xml) {
        showToast('XML fattura non disponibile', 'error');
        return;
      }
      setAutoPrintViewer(autoPrint);
      setViewerXml(xml);
    } catch (err) {
      showToast('Errore apertura fattura: ' + err.message, 'error');
    } finally {
      setLoadingXml(null);
    }
  }

  async function downloadFile(bucket, path, fileName) {
    try {
      const { data: blob, error } = await supabase.storage.from(bucket).download(path);
      if (error) throw error;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Download completato');
    } catch (err) {
      showToast('Errore download: ' + err.message, 'error');
    }
  }

  async function openPdfPreview(bucket, path) {
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
      if (error) throw error;
      window.open(data.signedUrl, '_blank');
    } catch (err) {
      showToast('Errore apertura PDF: ' + err.message, 'error');
    }
  }

  // ─── RENDER ────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* KPI CARDS — conteggi dinamici sull'anno selezionato per le fatture */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label={`Fatture ${year}`}
          value={invoices.length}
          icon={Receipt}
          color="blue"
          sub={`Totale: ${allInvoices.length} su ${availableYears.length} ann${availableYears.length === 1 ? 'o' : 'i'}`}
        />
        <KpiCard label="Bilanci" value={balanceSheets.length} icon={BarChart3} color="indigo" sub="PDF archiviati" />
        <KpiCard label="Estratti Conto" value={ecFiles.length} icon={Database} color="emerald" sub={`${ecFiles.reduce((s, e) => s + (e.transaction_count || 0), 0)} movimenti totali`} />
        <KpiCard label={`Totale ${year}`} value={invoices.length + balanceSheets.length + ecFiles.length} icon={FolderOpen} color="slate" sub="documenti consultabili" />
      </div>

      {loading && (
        <div className="text-center py-8">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Caricamento documenti...</p>
        </div>
      )}

      {/* ═══════════ SEZIONE FATTURE ═══════════ */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <button
            onClick={() => toggleSection('fatture')}
            className="flex items-center gap-2 hover:bg-slate-50 -mx-2 -my-1 px-2 py-1 rounded-lg transition text-left"
            title={sectionOpen.fatture ? 'Chiudi sezione' : 'Apri sezione'}
          >
            {sectionOpen.fatture ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
            <div className="p-2 bg-blue-50 rounded-lg">
              <Receipt size={18} className="text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                Fatture Ricevute {year}
                {loadingYear && <RefreshCw size={14} className="animate-spin text-blue-500" />}
              </h2>
              <p className="text-xs text-slate-500">
                {filteredInvoices.length} fattur{filteredInvoices.length === 1 ? 'a' : 'e'} · {formatCurrency(totalInvoicesAmount)}
              </p>
            </div>
          </button>

          <div className={`flex items-center gap-2 ml-auto ${sectionOpen.fatture ? '' : 'opacity-50 pointer-events-none'}`}>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cerca fornitore, numero..."
                value={searchInvoices}
                onChange={e => setSearchInvoices(e.target.value)}
                className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm w-56"
              />
            </div>
            {groups.length > 0 && (
              <button
                onClick={toggleAllGroups}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                title={allExpanded ? 'Chiudi tutti i gruppi' : 'Apri tutti i gruppi'}
              >
                {allExpanded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                {allExpanded ? 'Comprimi tutti' : 'Espandi tutti'}
              </button>
            )}
            <select
              value={groupBy}
              onChange={e => { setGroupBy(e.target.value); setExpandedGroups(new Set()); }}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
              title="Raggruppa per"
            >
              <option value="supplier">Per fornitore</option>
              <option value="month">Per mese</option>
            </select>
            <select
              value={year}
              onChange={e => { setYear(Number(e.target.value)); setExpandedGroups(new Set()); }}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
              title="Anno fatture"
            >
              {availableYears.map(y => {
                const count = invoicesPerYear[String(y)] || 0;
                return (
                  <option key={y} value={y}>
                    {y}{count > 0 ? ` (${count})` : ''}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {sectionOpen.fatture && (
        <div className="divide-y divide-slate-100">
          {groups.length === 0 && !loading && (
            <div className="text-center py-12">
              <FileWarning size={32} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nessuna fattura per {year}</p>
            </div>
          )}

          {groups.map(group => {
            const expanded = expandedGroups.has(group.key);
            return (
              <div key={group.key}>
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition text-left"
                >
                  {expanded ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronRight size={16} className="text-slate-400" />}
                  {groupBy === 'supplier'
                    ? <Building2 size={14} className="text-blue-500 shrink-0" />
                    : <div className="w-7 h-7 bg-indigo-100 text-indigo-700 rounded font-semibold text-xs flex items-center justify-center">{MONTH_LABELS[new Date(group.invoices[0].invoice_date).getMonth()]}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 truncate">{group.label}</div>
                    <div className="text-xs text-slate-500">{group.invoices.length} fattur{group.invoices.length === 1 ? 'a' : 'e'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold text-slate-900">{formatCurrency(group.total)}</div>
                  </div>
                </button>

                {expanded && (
                  <div className="bg-slate-50/60 border-t border-slate-100">
                    <table className="w-full">
                      <thead>
                        <tr className="text-[10px] uppercase text-slate-500">
                          <th className="px-5 py-2 text-left font-semibold">Numero</th>
                          <th className="px-4 py-2 text-left font-semibold">Data</th>
                          {groupBy === 'month' && <th className="px-4 py-2 text-left font-semibold">Fornitore</th>}
                          <th className="px-4 py-2 text-right font-semibold">Importo</th>
                          <th className="px-4 py-2 text-center font-semibold">SDI</th>
                          <th className="px-5 py-2 text-right font-semibold">Azioni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.invoices.map(inv => (
                          <tr key={inv.id} className="border-t border-slate-200/70 hover:bg-white">
                            <td className="px-5 py-2.5 text-sm font-medium text-slate-800">{inv.invoice_number || '—'}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600">{formatDate(inv.invoice_date)}</td>
                            {groupBy === 'month' && (
                              <td className="px-4 py-2.5 text-sm text-slate-600 truncate max-w-xs" title={inv.supplier_name}>{inv.supplier_name || '—'}</td>
                            )}
                            <td className="px-4 py-2.5 text-sm text-right font-medium text-slate-900">
                              {formatCurrency(inv.gross_amount || inv.total_amount)}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {inv.sdi_status && (
                                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  inv.sdi_status === 'ACCEPTED' ? 'bg-emerald-50 text-emerald-700' :
                                  inv.sdi_status === 'REJECTED' ? 'bg-red-50 text-red-700' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {inv.sdi_status}
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-2.5 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={() => openInvoiceViewer(inv)}
                                  disabled={loadingXml === inv.id}
                                  className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 border border-blue-200 inline-flex items-center gap-1 disabled:opacity-50"
                                  title="Apri la fattura in formato leggibile"
                                >
                                  {loadingXml === inv.id ? <RefreshCw size={12} className="animate-spin" /> : <Eye size={12} />}
                                  Anteprima
                                </button>
                                <button
                                  onClick={() => openInvoiceViewer(inv, { autoPrint: true })}
                                  disabled={loadingXml === inv.id}
                                  className="px-2.5 py-1 bg-white text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 border border-slate-200 inline-flex items-center gap-1 disabled:opacity-50"
                                  title="Genera PDF leggibile e apri dialogo di stampa"
                                >
                                  <Download size={12} /> Scarica PDF
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </section>

      {/* ═══════════ SEZIONE BILANCI ═══════════ */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          onClick={() => toggleSection('bilanci')}
          className="w-full px-5 py-4 border-b border-slate-100 flex items-center gap-2 hover:bg-slate-50 text-left transition"
          title={sectionOpen.bilanci ? 'Chiudi sezione' : 'Apri sezione'}
        >
          {sectionOpen.bilanci ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
          <div className="p-2 bg-indigo-50 rounded-lg">
            <BarChart3 size={18} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Bilanci</h2>
            <p className="text-xs text-slate-500">{balanceSheets.length} document{balanceSheets.length === 1 ? 'o' : 'i'}</p>
          </div>
        </button>
        {sectionOpen.bilanci && (
        <div className="divide-y divide-slate-100">
          {balanceSheets.length === 0 ? (
            <div className="text-center py-10">
              <BarChart3 size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nessun bilancio caricato</p>
              <p className="text-xs text-slate-400">Caricali da Import Hub → Bilanci</p>
            </div>
          ) : (
            balanceSheets.map(bs => (
              <div key={bs.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
                <div className="p-2 bg-red-50 rounded-lg shrink-0">
                  <FileText size={16} className="text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 truncate" title={bs.file_name}>
                    {bs.file_name || 'Bilancio senza nome'}
                  </div>
                  <div className="text-xs text-slate-500 flex gap-3">
                    {bs.year && <span>Anno {bs.year}</span>}
                    <span>{formatDate(bs.created_at || bs.uploaded_at)}</span>
                    {bs.file_size && <span>{formatSize(bs.file_size)}</span>}
                    {bs.status && <span className="text-indigo-600">· {bs.status}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {bs.file_path && (
                    <>
                      <button
                        onClick={() => openPdfPreview('balance-sheets', bs.file_path)}
                        className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-100 border border-indigo-200 inline-flex items-center gap-1"
                        title="Apri il PDF in una nuova scheda"
                      >
                        <Eye size={12} /> Anteprima
                      </button>
                      <button
                        onClick={() => downloadFile('balance-sheets', bs.file_path, bs.file_name)}
                        className="px-2.5 py-1 bg-white text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 border border-slate-200 inline-flex items-center gap-1"
                      >
                        <Download size={12} /> Scarica
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        )}
      </section>

      {/* ═══════════ SEZIONE ESTRATTI CONTO ═══════════ */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          onClick={() => toggleSection('ec')}
          className="w-full px-5 py-4 border-b border-slate-100 flex items-center gap-2 hover:bg-slate-50 text-left transition"
          title={sectionOpen.ec ? 'Chiudi sezione' : 'Apri sezione'}
        >
          {sectionOpen.ec ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
          <div className="p-2 bg-emerald-50 rounded-lg">
            <Database size={18} className="text-emerald-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Estratti Conto Bancari</h2>
            <p className="text-xs text-slate-500">{ecFiles.length} file</p>
          </div>
        </button>
        {sectionOpen.ec && (
        <div className="divide-y divide-slate-100">
          {ecFiles.length === 0 ? (
            <div className="text-center py-10">
              <Database size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nessun estratto conto</p>
              <p className="text-xs text-slate-400">Importali da Import Hub → Estratti Conto</p>
            </div>
          ) : (
            ecFiles.map(ec => {
              const bankLabel = ec.bank_accounts?.bank_name
                ? `${ec.bank_accounts.bank_name}${ec.bank_accounts.account_name ? ` — ${ec.bank_accounts.account_name}` : ''}`
                : 'Banca';
              const statusColor = ec.status === 'completed' ? 'text-emerald-600'
                : ec.status === 'processing' ? 'text-amber-600'
                : 'text-slate-500';
              return (
                <div key={ec.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
                  <div className="p-2 bg-emerald-50 rounded-lg shrink-0">
                    <FileText size={16} className="text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 truncate" title={ec.filename}>
                      {ec.filename || 'EC senza nome'}
                    </div>
                    <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                      <span className="font-medium text-slate-700">{bankLabel}</span>
                      {ec.transaction_count != null && (
                        <span>{ec.transaction_count.toLocaleString('it-IT')} movimenti</span>
                      )}
                      <span>{formatDate(ec.created_at)}</span>
                      {ec.status && <span className={statusColor}>· {ec.status}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEcPreview(ec)}
                      className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100 border border-emerald-200 inline-flex items-center gap-1"
                      title="Vedi i primi 100 movimenti importati"
                    >
                      <Eye size={12} /> Anteprima
                    </button>
                    <button
                      onClick={() => downloadEcFile(ec)}
                      className="px-2.5 py-1 bg-white text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 border border-slate-200 inline-flex items-center gap-1"
                      title="Scarica il file originale (.xls/.xlsx) dal bucket bank-statements"
                    >
                      <Download size={12} /> Scarica
                    </button>
                    {ec.bank_account_id && (
                      <button
                        onClick={() => navigate(`/banche?tab=movimenti&account=${ec.bank_account_id}`)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                        title="Apri la pagina Movimenti della banca"
                      >
                        <ExternalLink size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        )}
      </section>

      {/* INVOICE VIEWER MODAL */}
      {viewerXml && (
        <InvoiceViewer
          xmlContent={viewerXml}
          autoPrint={autoPrintViewer}
          onClose={() => { setViewerXml(null); setAutoPrintViewer(false); }}
        />
      )}

      {/* ═══════════ EC PREVIEW MODAL ═══════════ */}
      {ecPreview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEcPreview(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 rounded-lg">
                  <Database size={18} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">{ecPreview.ec?.filename || 'Estratto Conto'}</h3>
                  <p className="text-xs text-slate-500">
                    {ecPreview.ec?.bank_accounts?.bank_name || 'Banca'}
                    {ecPreview.ec?.transaction_count != null && ` · ${ecPreview.ec.transaction_count.toLocaleString('it-IT')} movimenti`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadEcFile(ecPreview.ec)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white rounded-lg hover:bg-slate-50 border border-slate-200 flex items-center gap-1"
                >
                  <Download size={13} /> Scarica file
                </button>
                <button onClick={() => setEcPreview(null)} className="p-1.5 hover:bg-slate-100 rounded-lg">
                  <X size={18} className="text-slate-500" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {ecPreview.loading ? (
                <div className="text-center py-16">
                  <RefreshCw className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Caricamento movimenti...</p>
                </div>
              ) : ecPreview.rows.length === 0 ? (
                <div className="text-center py-16">
                  <FileWarning className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Nessun movimento trovato per questa banca</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Data</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase">Descrizione</th>
                      <th className="px-4 py-2 text-right text-[11px] font-semibold text-slate-600 uppercase">Importo</th>
                      <th className="px-4 py-2 text-right text-[11px] font-semibold text-slate-600 uppercase">Saldo</th>
                      <th className="px-4 py-2 text-center text-[11px] font-semibold text-slate-600 uppercase">Stato</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ecPreview.rows.map(tx => (
                      <tr key={tx.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{formatDate(tx.transaction_date)}</td>
                        <td className="px-4 py-2 text-slate-700 truncate max-w-md" title={tx.description}>{tx.description || '—'}</td>
                        <td className={`px-4 py-2 text-right font-medium whitespace-nowrap ${tx.amount < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {tx.amount != null ? formatCurrency(tx.amount) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-500 whitespace-nowrap">
                          {tx.running_balance != null ? formatCurrency(tx.running_balance) : '—'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {tx.is_reconciled ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">riconciliato</span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">aperto</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50 text-xs text-slate-500 flex items-center justify-between shrink-0">
              <span>Mostrati {ecPreview.rows.length} movimenti{(ecPreview.ec?.transaction_count || 0) > ecPreview.rows.length ? ` di ${ecPreview.ec.transaction_count}` : ''}</span>
              {ecPreview.ec?.bank_account_id && (
                <button
                  onClick={() => { setEcPreview(null); navigate(`/banche?tab=movimenti&account=${ecPreview.ec.bank_account_id}`); }}
                  className="text-emerald-700 hover:underline flex items-center gap-1"
                >
                  Apri tutti in Movimenti <ExternalLink size={11} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// KPI Card
// ═══════════════════════════════════════════════════════════════
function KpiCard({ label, value, icon: Icon, color, sub }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className={`inline-flex p-2 rounded-lg mb-2 border ${colorMap[color] || colorMap.slate}`}>
        <Icon size={16} />
      </div>
      <div className="text-xs text-slate-500 uppercase font-semibold">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB CONSERVAZIONE SOSTITUTIVA (invariato)
// ═══════════════════════════════════════════════════════════════

function ConservazioneTab({ docs, stats, loading, filter, setFilter, search, setSearch, getRetentionStatus, daysUntilExpiry, updateStatus }) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={14} className="text-blue-500" />
            <span className="text-xs font-semibold text-slate-500 uppercase">Totale</span>
          </div>
          <div className="text-xl font-bold text-slate-900">{stats.total}</div>
        </div>
        <div className="bg-white rounded-xl border border-emerald-200 p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Lock size={14} className="text-emerald-500" />
            <span className="text-xs font-semibold text-emerald-600 uppercase">In conservazione</span>
          </div>
          <div className="text-xl font-bold text-emerald-700">{stats.active}</div>
        </div>
        <div className="bg-white rounded-xl border border-amber-200 p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-amber-500" />
            <span className="text-xs font-semibold text-amber-600 uppercase">In scadenza</span>
          </div>
          <div className="text-xl font-bold text-amber-700">{stats.expiring}</div>
          <div className="text-[10px] text-amber-500">prossimi 6 mesi</div>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Unlock size={14} className="text-red-500" />
            <span className="text-xs font-semibold text-red-600 uppercase">Scaduti</span>
          </div>
          <div className="text-xl font-bold text-red-700">{stats.expired}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Receipt size={14} className="text-violet-500" />
            <span className="text-xs font-semibold text-slate-500 uppercase">Fatture</span>
          </div>
          <div className="text-xl font-bold text-slate-900">{stats.invoices}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <FileText size={14} className="text-slate-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase">Documenti</span>
          </div>
          <div className="text-xl font-bold text-slate-900">{stats.documents}</div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <ShieldCheck size={20} className="text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-900">Conservazione sostitutiva a norma</p>
          <p className="text-xs text-blue-700 mt-1">
            I documenti fiscali (fatture elettroniche, corrispettivi, registri IVA) devono essere conservati per 10 anni dalla data di emissione,
            secondo l'art. 2220 del Codice Civile e il D.M. 17/06/2014.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cerca per numero fattura, fornitore, cliente..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            {[
              { key: 'all', label: 'Tutti' },
              { key: 'active', label: 'Attivi' },
              { key: 'expiring', label: 'In scadenza' },
              { key: 'expired', label: 'Scaduti' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${filter === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400 ml-auto">{docs.length} risultati</span>
        </div>
      </div>

      {loading && (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Caricamento dati conservazione...</p>
        </div>
      )}

      {!loading && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {docs.length === 0 ? (
            <div className="text-center py-16">
              <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">Nessun documento in conservazione</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Documento</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Data doc.</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Importo</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Fine cons.</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Stato</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {docs.map(doc => {
                    const status = getRetentionStatus(doc);
                    const days = daysUntilExpiry(doc);
                    const isInvoice = doc._source === 'invoice';
                    const name = isInvoice ? (doc.invoice_number || 'Fattura') : (doc.title || doc.file_name || 'Documento');
                    return (
                      <tr key={doc._source + '-' + doc.id} className="hover:bg-slate-50/60 group">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={'p-2 rounded-lg shrink-0 ' + (isInvoice ? 'bg-violet-50' : 'bg-slate-50')}>
                              {isInvoice ? <Receipt size={16} className="text-violet-500" /> : <FileText size={16} className="text-slate-500" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-800 truncate max-w-xs">{name}</div>
                              {isInvoice && (
                                <div className="text-xs text-slate-400 truncate">
                                  {doc.direction === 'inbound' ? doc.supplier_name : doc.customer_name}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isInvoice ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                            {isInvoice ? (doc.direction === 'inbound' ? 'Fatt. passiva' : 'Fatt. attiva') : 'Documento'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{formatDate(doc.invoice_date || doc.created_at)}</td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{doc.total_amount ? formatCurrency(doc.total_amount) : '-'}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{formatDate(doc.retention_end)}</td>
                        <td className="px-4 py-3">
                          {status === 'active' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Lock size={10} /> Conservato
                            </span>
                          )}
                          {status === 'expiring' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              <AlertTriangle size={10} /> Scade tra {days}gg
                            </span>
                          )}
                          {status === 'expired' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                              <Unlock size={10} /> Scaduto
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                            {status === 'expired' && doc.retention_status !== 'extended' && (
                              <button
                                onClick={() => updateStatus(doc.id, doc._source, 'extended')}
                                className="px-2 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                              >
                                Estendi
                              </button>
                            )}
                            {status === 'expired' && (
                              <button
                                onClick={() => updateStatus(doc.id, doc._source, 'dismissed')}
                                className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200"
                              >
                                Archivia
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
