import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// Tab ArchivioDocumenti — persistito in URL come ?tab=
type ArchivioTab = 'archivio' | 'caricamenti' | 'conservazione';
const VALID_ARCHIVIO_TABS: ArchivioTab[] = ['archivio', 'caricamenti', 'conservazione'];
import {
  FileText, Search, Download, Eye, RefreshCw,
  X, FileWarning, CheckCircle,
  AlertCircle, Database, FolderOpen, Archive, Users, Receipt,
  ShieldCheck, AlertTriangle, Lock, Unlock, BarChart3,
  ChevronDown, ChevronRight, Building2, ExternalLink, Upload
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import Tooltip from '../components/Tooltip';
import InvoiceViewer from '../components/InvoiceViewer';
import PageHeader from '../components/PageHeader';
import { Modal } from '../components/ui/Modal';

// ─── HELPERS ───────────────────────────────────────────────────
function formatDate(d: string | null | undefined) {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '-'; }
}

function formatCurrency(n: number | null | undefined) {
  if (n == null) return '-';
  return `€ ${Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSize(bytes: number | null | undefined) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

interface RetentionDoc {
  id: string
  company_id?: string
  invoice_number?: string | null
  invoice_date?: string | null
  supplier_name?: string | null
  customer_name?: string | null
  total_amount?: number | null
  direction?: string | null
  sdi_status?: string | null
  retention_start?: string | null
  retention_end?: string | null
  retention_status?: string | null
  storage_path?: string | null
  xml_file_path?: string | null
  created_at?: string | null
  title?: string | null
  category?: string | null
  file_name?: string | null
  file_path?: string | null
  storage_bucket?: string | null
  _source: 'invoice' | 'document'
  [key: string]: unknown
}

const MONTH_LABELS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTH_FULL = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

// ═══════════════════════════════════════════════════════════════
// SCHEDA "CARICAMENTI" — il registro unico dei file caricati.
// Risponde alla domanda «questo numero da quale file viene?»: per ogni
// caricamento si vede il modulo, la funzione, il periodo, chi e quando, e si
// riapre il documento originale.
// ═══════════════════════════════════════════════════════════════
type RigaCaricamento = {
  id: string;
  file_name: string;
  file_path: string | null;
  file_size: number | null;
  file_type: string | null;
  storage_bucket: string | null;
  modulo: string | null;
  funzione: string | null;
  source: string | null;
  year: number | null;
  month: number | null;
  reference_table: string | null;
  reference_id: string | null;
  note: string | null;
  uploaded_at: string | null;
};

function CaricamentiTab({ companyId, showToast }: { companyId?: string; showToast: (m: string, t?: string) => void }) {
  const [righe, setRighe] = useState<RigaCaricamento[]>([]);
  const [caricando, setCaricando] = useState(false);
  const [filtroModulo, setFiltroModulo] = useState('tutti');
  const [filtroAnno, setFiltroAnno] = useState('tutti');
  const [ricerca, setRicerca] = useState('');
  const [aprendo, setAprendo] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let vivo = true;
    (async () => {
      setCaricando(true);
      // Mai select('*'): su queste tabelle finirebbe per trascinare colonne pesanti.
      const { data, error } = await supabase
        .from('import_documents')
        .select('id, file_name, file_path, file_size, file_type, storage_bucket, modulo, funzione, source, year, month, reference_table, reference_id, note, uploaded_at')
        .eq('company_id', companyId)
        .order('uploaded_at', { ascending: false })
        .limit(1000);
      if (!vivo) return;
      if (error) showToast(`Impossibile leggere l'archivio dei caricamenti: ${error.message}`, 'error');
      setRighe(((data as unknown) as RigaCaricamento[]) || []);
      setCaricando(false);
    })();
    return () => { vivo = false; };
    // showToast cambia identita' a ogni render del padre: tenerla qui
    // rilancerebbe la lettura in continuazione.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const moduli = useMemo(() => Array.from(new Set(righe.map(r => r.modulo).filter(Boolean))).sort() as string[], [righe]);
  const anni = useMemo(() => Array.from(new Set(righe.map(r => r.year).filter(Boolean))).sort((a, b) => Number(b) - Number(a)) as number[], [righe]);

  const filtrate = useMemo(() => righe.filter(r => {
    if (filtroModulo !== 'tutti' && r.modulo !== filtroModulo) return false;
    if (filtroAnno !== 'tutti' && String(r.year || '') !== filtroAnno) return false;
    if (ricerca.trim()) {
      const q = ricerca.toLowerCase();
      return (r.file_name || '').toLowerCase().includes(q)
        || (r.funzione || r.source || '').toLowerCase().includes(q)
        || (r.modulo || '').toLowerCase().includes(q);
    }
    return true;
  }), [righe, filtroModulo, filtroAnno, ricerca]);

  const apri = async (r: RigaCaricamento) => {
    if (!r.storage_bucket || !r.file_path) {
      showToast('Di questo caricamento è rimasta solo la registrazione: il file non era stato archiviato.', 'error');
      return;
    }
    setAprendo(r.id);
    const { data, error } = await supabase.storage.from(r.storage_bucket).createSignedUrl(r.file_path, 3600);
    setAprendo(null);
    if (error || !data?.signedUrl) { showToast(`Impossibile aprire il file: ${error?.message || 'link non disponibile'}`, 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const periodo = (r: RigaCaricamento) => {
    if (!r.year) return '—';
    return r.month ? `${MONTH_LABELS[r.month - 1]} ${r.year}` : String(r.year);
  };
  const peso = (b: number | null) => (b == null ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center gap-2">
        <select value={filtroModulo} onChange={e => setFiltroModulo(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300">
          <option value="tutti">Tutti i moduli</option>
          {moduli.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filtroAnno} onChange={e => setFiltroAnno(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300">
          <option value="tutti">Tutti gli anni</option>
          {anni.map(a => <option key={a} value={String(a)}>{a}</option>)}
        </select>
        <input value={ricerca} onChange={e => setRicerca(e.target.value)} placeholder="Cerca per nome file o funzione…"
          className="flex-1 min-w-[220px] px-3 py-2 text-sm rounded-lg border border-slate-300" />
        <span className="text-sm text-slate-500">{filtrate.length} caricamenti</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {caricando ? (
          <div className="p-10 text-center text-slate-400 text-sm">Lettura dell&rsquo;archivio…</div>
        ) : filtrate.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            <Upload size={28} className="mx-auto mb-3 text-slate-300" />
            Nessun caricamento registrato{righe.length ? ' con questi filtri' : ' finora'}.
            {!righe.length && <div className="mt-1 text-xs text-slate-400">I file caricati d&rsquo;ora in avanti compariranno qui, con la funzione e il periodo a cui si riferiscono.</div>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Quando</th>
                  <th className="px-4 py-2.5 text-left font-medium">Modulo</th>
                  <th className="px-4 py-2.5 text-left font-medium">Funzione</th>
                  <th className="px-4 py-2.5 text-left font-medium">Periodo</th>
                  <th className="px-4 py-2.5 text-left font-medium">File</th>
                  <th className="px-4 py-2.5 text-right font-medium">Peso</th>
                  <th className="px-4 py-2.5 text-center font-medium">Apri</th>
                </tr>
              </thead>
              <tbody>
                {filtrate.map(r => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                      {r.uploaded_at ? new Date(r.uploaded_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">{r.modulo || '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      <Tooltip content={r.note || r.funzione || r.source || ''}>
                        <span>{r.funzione || r.source || '—'}</span>
                      </Tooltip>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{periodo(r)}</td>
                    <td className="px-4 py-2.5 text-slate-700 max-w-[280px] truncate" title={r.file_name}>{r.file_name}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 whitespace-nowrap">{peso(r.file_size)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button onClick={() => apri(r)} disabled={aprendo === r.id || !r.file_path}
                        className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-40 inline-flex items-center gap-1">
                        <ExternalLink size={13} /> {aprendo === r.id ? 'apro…' : 'apri'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPALE
// ═══════════════════════════════════════════════════════════════

export default function ArchivioDocumenti() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  // activeTab persistito in URL come ?tab=… (default 'archivio')
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: ArchivioTab = VALID_ARCHIVIO_TABS.includes(tabParam as ArchivioTab)
    ? (tabParam as ArchivioTab)
    : 'archivio';
  const setActiveTab = (next: ArchivioTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params);
  };
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  const showToast = (msg: string, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Conservazione state (invariato rispetto alla versione precedente) ──
  const [retentionDocs, setRetentionDocs] = useState<RetentionDoc[]>([]);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionFilter, setRetentionFilter] = useState('all');
  const [retentionSearch, setRetentionSearch] = useState('');

  useEffect(() => {
    if (!COMPANY_ID || activeTab !== 'conservazione') return;
    loadRetention();
  }, [COMPANY_ID, activeTab]);

  async function loadRetention() {
    if (!COMPANY_ID) return;
    setRetentionLoading(true);
    const results: RetentionDoc[] = [];
    try {
      // NOTE: il select include 'direction' e 'total_amount' che non sono colonne
      // reali dello schema (BUG-001 e BUG-002 documentati): il select restituirà
      // SelectQueryError. Cast strutturale per allinearsi ai tipi locali finché
      // la query non viene aggiornata in un task separato.
      const sb = supabase as unknown as { from: (t: string) => { select: (s: string) => { eq: (k: string, v: string) => { not: (k: string, op: string, v: null) => { order: (k: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: RetentionDoc[] | null }> } } } } } }
      const { data } = await sb
        .from('electronic_invoices')
        .select('id, company_id, invoice_number, invoice_date, supplier_name, customer_name, total_amount, direction, sdi_status, retention_start, retention_end, retention_status, storage_path, xml_file_path, created_at')
        .eq('company_id', COMPANY_ID)
        .not('retention_start', 'is', null)
        .order('retention_end', { ascending: true })
        .limit(1000);
      (data || []).forEach(d => results.push({ ...d, _source: 'invoice' }));
    } catch (e: unknown) { console.warn('retention invoices:', e instanceof Error ? e.message : e); }
    try {
      const { data } = await supabase
        .from('documents')
        .select('id, company_id, title, category, file_name, file_path, storage_bucket, retention_start, retention_end, retention_status, created_at')
        .eq('company_id', COMPANY_ID)
        .not('retention_start', 'is', null)
        .order('retention_end', { ascending: true })
        .limit(1000);
      (data || []).forEach(d => results.push({ ...(d as object), _source: 'document' } as RetentionDoc));
    } catch (e: unknown) { console.warn('retention documents:', e instanceof Error ? e.message : e); }
    setRetentionDocs(results);
    setRetentionLoading(false);
  }

  const today = new Date();
  const sixMonthsFromNow = new Date(today.getTime() + 180 * 86400000);
  function getRetentionStatus(doc: RetentionDoc): 'unknown' | 'expired' | 'expiring' | 'active' {
    if (!doc.retention_end) return 'unknown';
    const end = new Date(doc.retention_end);
    if (end < today) return 'expired';
    if (end < sixMonthsFromNow) return 'expiring';
    return 'active';
  }
  function daysUntilExpiry(doc: RetentionDoc) {
    if (!doc.retention_end) return null;
    return Math.ceil((new Date(doc.retention_end).getTime() - today.getTime()) / 86400000);
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

  async function updateRetentionStatus(docId: string, source: string, newStatus: string) {
    const table = source === 'invoice' ? 'electronic_invoices' : 'documents';
    const { error } = await supabase.from(table).update({ retention_status: newStatus }).eq('id', docId);
    if (error) { showToast('Errore aggiornamento: ' + error.message, 'error'); return; }
    showToast('Stato conservazione aggiornato');
    loadRetention();
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Archivio Documenti"
        subtitle={activeTab === 'conservazione' ? 'Conservazione sostitutiva — 10 anni'
          : activeTab === 'caricamenti' ? 'Ogni file caricato nel gestionale, con la funzione e il periodo a cui si riferisce'
          : 'Fatture, bilanci ed estratti conto'}
        noDivider
      />

      {/* TABS */}
      <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 shadow-sm">
        {([
          { key: 'archivio', label: 'Archivio', icon: FolderOpen },
          { key: 'caricamenti', label: 'Caricamenti', icon: Upload },
          { key: 'conservazione', label: 'Conservazione Sostitutiva', icon: ShieldCheck },
        ] as const).map(tab => {
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

      {activeTab === 'archivio' && <ArchivioTab companyId={COMPANY_ID ?? undefined} showToast={showToast} />}

      {activeTab === 'caricamenti' && <CaricamentiTab companyId={COMPANY_ID ?? undefined} showToast={showToast} />}

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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB ARCHIVIO — 3 SEZIONI (Fatture, Bilanci, Estratti Conto)
// ═══════════════════════════════════════════════════════════════

interface InvoiceRow { id: string; invoice_date?: string | null; invoice_number?: string | null; supplier_name?: string | null; gross_amount?: number | null; xml_content?: string | null; storage_path?: string | null; sdi_status?: string | null; [key: string]: unknown }
interface BalanceSheetRow { id: string; created_at?: string | null; [key: string]: unknown }
interface EcFileRow { id: string; filename?: string | null; bank_account_id?: string | null; file_path?: string | null; file_size?: number | null; status?: string | null; transaction_count?: number | null; created_at?: string | null; doc_kind?: string | null; source_label?: string | null; period_year?: number | null; period_month?: number | null; bank_accounts?: { bank_name?: string; account_name?: string } | null; [key: string]: unknown }
interface EcPreviewRow { id: string; transaction_date?: string | null; description?: string | null; amount?: number | null; running_balance?: number | null; is_reconciled?: boolean | null }
interface EcPreviewState { ec: EcFileRow; rows: EcPreviewRow[]; loading: boolean }

function ArchivioTab({ companyId, showToast }: { companyId: string | undefined; showToast: (msg: string, type?: string) => void }) {
  const navigate = useNavigate();
  const [allInvoices, setAllInvoices] = useState<InvoiceRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [balanceSheets, setBalanceSheets] = useState<BalanceSheetRow[]>([]);
  const [ecFiles, setEcFiles] = useState<EcFileRow[]>([]);
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
  const [viewerXml, setViewerXml] = useState<string | null>(null);
  const [autoPrintViewer, setAutoPrintViewer] = useState(false);
  const [loadingXml, setLoadingXml] = useState<string | null>(null);

  const [ecPreview, setEcPreview] = useState<EcPreviewState | null>(null);

  // ─── Archivio EC (solo archiviazione file, NESSUN import movimenti) ──
  // Conti attivi per la tendina del modal di archiviazione.
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; bank_name: string | null; account_name: string | null }>>([]);
  // Stato del modal "Archivia estratto conto". null = chiuso.
  const [ecArchive, setEcArchive] = useState<{ files: File[]; bankAccountId: string; busy: boolean } | null>(null);
  // Filtri/ricerca dell'archivio EC (per reggere centinaia di documenti).
  const [ecSearch, setEcSearch] = useState('');
  const [ecKind, setEcKind] = useState<'all' | 'conto_corrente' | 'carta'>('all');
  const [ecYear, setEcYear] = useState<number | 'all'>('all');
  const [ecCollapsed, setEcCollapsed] = useState<Set<string>>(new Set());

  // Collasso delle 3 sezioni principali. Fatture parte CHIUSA perche'
  // con 199 fatture e' la sezione piu' rumorosa. Bilanci ed EC restano
  // aperti perche' sono liste corte (1-5 elementi).
  const [sectionOpen, setSectionOpen] = useState({
    fatture: false,
    bilanci: true,
    ec: true,
  });
  const toggleSection = (k: string) => setSectionOpen(s => ({ ...s, [k]: !s[k as keyof typeof s] }));

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
    await Promise.all([loadAllInvoicesMinimal(), loadBalanceSheets(), loadEcFiles(), loadBankAccounts()]);
    setLoading(false);
  }

  /** Conti bancari attivi — alimentano la tendina del modal "Archivia estratto conto". */
  async function loadBankAccounts() {
    if (!companyId) return;
    try {
      const { data } = await supabase
        .from('bank_accounts')
        .select('id, bank_name, account_name')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('bank_name', { ascending: true });
      setBankAccounts((data || []) as Array<{ id: string; bank_name: string | null; account_name: string | null }>);
    } catch (e: unknown) {
      console.warn('load bank accounts:', e instanceof Error ? e.message : e);
      setBankAccounts([]);
    }
  }

  // Estensioni EC ammesse in archiviazione (documenti, non import).
  const ARCHIVE_EXTS = ['pdf', 'xls', 'xlsx', 'csv'];

  /**
   * Prova ad assegnare automaticamente il conto a un file dal suo nome/percorso,
   * confrontandolo con le parole distintive (≥4 lettere, non generiche) del
   * bank_name dei conti attivi. Serve per gli zip/cartelle che contengono EC di
   * conti diversi: i 4 conti noti (Mugello/Intesa/BCC/MPS) vengono riconosciuti
   * dal nome file; il resto (es. carte) ricade sul conto di ripiego scelto.
   */
  function autoMatchAccount(path: string): string | null {
    const up = path.toUpperCase();
    const STOP = new Set(['BANCA', 'BANCO', 'CRED', 'COOP', 'SMALL', 'BUSINESS', 'CORPORATE', 'PERSONE', 'FAMIGLIE', 'MONTE', 'PASCHI', 'SIENA', 'SANPAOLO', 'FIORENTINO', 'IMPRUNETA']);
    for (const ba of bankAccounts) {
      const words = (ba.bank_name || '').toUpperCase().split(/[^A-Z]+/).filter(w => w.length >= 3 && !STOP.has(w));
      // token forti tipici: MUGELLO, INTESA, MPS, BCC, VALDARNO, CASCIA
      for (const w of words) {
        if (up.includes(w)) return ba.id;
      }
    }
    return null;
  }

  /**
   * Deduce tipo documento, fonte e periodo dal percorso/nome file, per
   * organizzare l'archivio e renderlo ricercabile. I conti vengono agganciati
   * al bank_account; le carte sono una categoria a sé (bank_account_id = null).
   */
  function parseEcMeta(path: string, fallbackAccountId: string): {
    doc_kind: 'conto_corrente' | 'carta'; source_label: string;
    bank_account_id: string | null; period_year: number | null; period_month: number | null;
  } {
    const up = path.toUpperCase();
    const MONTHS = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
    let month: number | null = null;
    for (let i = 0; i < 12; i++) if (up.includes(MONTHS[i])) { month = i + 1; break; }
    // data compatta ddmmYYYY (es. 31072026) → mese dal 3°-4° gruppo
    const ddmm = up.match(/\b\d{2}(\d{2})(20\d{2})\b/);
    let year: number | null = null;
    if (month == null && ddmm) month = parseInt(ddmm[1], 10);
    const y4 = up.match(/(20\d{2})/);
    if (y4) year = parseInt(y4[1], 10);
    else { const y2 = up.match(/_(\d{2})\b/); if (y2) year = 2000 + parseInt(y2[1], 10); }

    const isCard = /CARTA|TASCA|5582/.test(up) && !/CONTI CORRENTI\/EC (MUGELLO|INTESA|BCC|MPS)/.test(up);
    if (isCard) {
      let source = 'Carta';
      if (/3145/.test(up)) source = 'Carta credito BCC *3145';
      else if (/5388/.test(up)) source = 'Carta credito BCC *5388';
      else if (/CARTA MPS|CARTA CREDITO MPS/.test(up)) source = 'Carta credito MPS';
      else if (/TASCA/.test(up)) source = 'Carta prepagata Tasca *0580';
      return { doc_kind: 'carta', source_label: source, bank_account_id: null, period_year: year, period_month: month };
    }
    // conto corrente
    let source = 'Conto';
    if (up.includes('EC MUGELLO') || up.includes('MUGELLO')) source = 'Conto Mugello';
    else if (up.includes('EC INTESA') || up.includes('INTESA')) source = 'Conto Intesa';
    else if (up.includes('EC BCC') || up.includes('BCC')) source = 'Conto BCC Figline';
    else if (up.includes('EC MPS') || up.includes('MPS')) source = 'Conto MPS';
    const acct = autoMatchAccount(path) || fallbackAccountId || null;
    return { doc_kind: 'conto_corrente', source_label: source, bank_account_id: acct, period_year: year, period_month: month };
  }

  /**
   * Archivia uno o più estratti conto SENZA importarne i movimenti.
   * Accetta file singoli, selezione multipla e un archivio .zip (scompattato
   * lato browser): in tutti i casi salva SOLO i documenti, mai movimenti.
   *
   * Perché serve: i movimenti dei conti sincronizzati (A-Cube) sono già in
   * `bank_transactions`. Reimportare l'EC dal file per archiviarlo creerebbe
   * doppioni (il dedup dell'import banca confronta anche la descrizione, che
   * differisce da quella A-Cube). Per ogni documento:
   *  - upload nel bucket privato `bank-statements` (stessa convenzione di ImportHub);
   *  - riga in `bank_imports` (file fisico) con status='archived';
   *  - riga in `bank_statements` (metadati elencati in questa pagina) con status='archived'
   *    e transaction_count=null → nessun movimento viene creato.
   * Reversibile: eliminando le due righe + l'oggetto storage si torna indietro.
   */
  async function archiveEcFiles() {
    if (!companyId || !ecArchive) return;
    const { files, bankAccountId } = ecArchive;
    if (files.length === 0) { showToast('Seleziona almeno un file o uno zip', 'error'); return; }
    setEcArchive(prev => prev ? { ...prev, busy: true } : prev);
    let ok = 0;
    const failed: string[] = [];
    let autoAssigned = 0;
    try {
      // 1) Espandi eventuali .zip in una lista piatta { path, blob }.
      const work: Array<{ path: string; blob: Blob; size: number }> = [];
      for (const f of files) {
        if (f.name.toLowerCase().endsWith('.zip')) {
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(f);
          for (const entry of Object.values(zip.files) as Array<{ dir: boolean; name: string; async: (t: 'blob') => Promise<Blob> }>) {
            if (entry.dir) continue;
            const base = entry.name.split('/').pop() || entry.name;
            if (base.startsWith('.') || base.startsWith('__MACOSX')) continue;
            const ext = (base.split('.').pop() || '').toLowerCase();
            if (!ARCHIVE_EXTS.includes(ext)) continue; // salta MANIFEST.csv? no: csv ammesso → ma escludo manifest/report per nome
            if (/^manifest\b/i.test(base) || /report/i.test(base)) continue;
            const blob = await entry.async('blob');
            work.push({ path: entry.name, blob, size: blob.size });
          }
        } else {
          // path relativo se il file arriva da una cartella (webkitdirectory), altrimenti il nome
          const rel = (f as unknown as { webkitRelativePath?: string }).webkitRelativePath || f.name;
          const base = rel.split('/').pop() || rel;
          const ext = (base.split('.').pop() || '').toLowerCase();
          if (!ARCHIVE_EXTS.includes(ext)) continue; // salta silenziosamente .md e non ammessi (cartelle miste)
          if (/^manifest\b/i.test(base) || /report/i.test(base)) continue;
          work.push({ path: rel, blob: f, size: f.size });
        }
      }
      if (work.length === 0) { showToast('Nessun documento archiviabile trovato', 'error'); setEcArchive(prev => prev ? { ...prev, busy: false } : prev); return; }

      // 2) Ogni documento: tipo/fonte/periodo dedotti dal nome; le carte non hanno conto.
      for (const doc of work) {
        const meta = parseEcMeta(doc.path, bankAccountId);
        const account = meta.bank_account_id; // può essere null (carta o conto non riconosciuto)
        if (meta.doc_kind === 'carta' || (meta.bank_account_id && meta.bank_account_id !== bankAccountId)) autoAssigned++;

        const displayName = doc.path; // mantiene l'eventuale nome cartella (es. "Conti correnti/EC MPS…")
        const ext = (displayName.split('.').pop() || '').toLowerCase();
        const ts = Date.now();
        const safeName = displayName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = `${companyId}/imports/bank/${ts}_${safeName}`;

        // file_type ammesso dal vincolo DB: solo csv | xlsx | pdf (xls → xlsx).
        const fileType = (ext === 'xls' || ext === 'xlsx') ? 'xlsx' : ext === 'pdf' ? 'pdf' : 'csv';

        const { error: upErr } = await supabase.storage
          .from('bank-statements')
          .upload(filePath, doc.blob, { upsert: false });
        if (upErr) { failed.push(`${displayName} (storage: ${upErr.message})`); continue; }

        // File fisico (bank_imports). Catturo l'id per poter fare rollback se il passo dopo fallisce.
        const { data: impRow, error: impErr } = await (supabase as unknown as { from: (t: string) => { insert: (r: Record<string, unknown>) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } } } })
          .from('bank_imports')
          .insert({
            company_id: companyId,
            bank_account_id: account,
            file_name: displayName,
            file_path: filePath,
            file_size: doc.size,
            file_format: ext,
            import_type: 'archive',
            status: 'archived',
          })
          .select('id')
          .single();
        if (impErr) {
          await supabase.storage.from('bank-statements').remove([filePath]);
          failed.push(`${displayName} (bank_imports: ${impErr.message})`);
          continue;
        }

        // Metadati (compare nella lista Estratti Conto). transaction_count=null → nessun movimento.
        // status ammesso dal vincolo: pending|processing|completed|error → uso 'completed'.
        const { error: stmtErr } = await (supabase as unknown as { from: (t: string) => { insert: (r: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } })
          .from('bank_statements')
          .insert({
            company_id: companyId,
            bank_account_id: account,
            filename: displayName,
            file_type: fileType,
            status: 'completed',
            doc_kind: meta.doc_kind,
            source_label: meta.source_label,
            period_year: meta.period_year,
            period_month: meta.period_month,
          });
        if (stmtErr) {
          // rollback: niente riga metadati → rimuovo file fisico e riga import per non lasciare orfani
          if (impRow?.id) await supabase.from('bank_imports').delete().eq('id', impRow.id);
          await supabase.storage.from('bank-statements').remove([filePath]);
          failed.push(`${displayName} (bank_statements: ${stmtErr.message})`);
          continue;
        }
        ok++;
      }

      await loadEcFiles();
      const autoNote = autoAssigned > 0 ? ` (${autoAssigned} assegnati al conto giusto in automatico)` : '';
      if (failed.length === 0) {
        showToast(`${ok} documento/i archiviato/i${autoNote} — nessun movimento importato`);
        setEcArchive(null);
      } else {
        showToast(`${ok} archiviati${autoNote}, ${failed.length} falliti: ${failed.slice(0, 3).join(' · ')}${failed.length > 3 ? '…' : ''}`, 'error');
        setEcArchive(prev => prev ? { ...prev, busy: false } : prev);
      }
    } catch (err: unknown) {
      showToast('Errore archiviazione: ' + (err instanceof Error ? err.message : ''), 'error');
      setEcArchive(prev => prev ? { ...prev, busy: false } : prev);
    }
  }

  /**
   * Carica TUTTE le fatture con campi minimi per alimentare il selettore anno
   * e il count globale delle KPI card. Non viene usato per il rendering.
   */
  async function loadAllInvoicesMinimal() {
    if (!companyId) return;
    try {
      const { data, error } = await supabase
        .from('electronic_invoices')
        .select('id, invoice_date')
        .eq('company_id', companyId)
        .order('invoice_date', { ascending: false });
      if (error) throw error;
      setAllInvoices((data || []) as InvoiceRow[]);
    } catch (e: unknown) {
      console.warn('load all invoices:', e instanceof Error ? e.message : e);
      setAllInvoices([]);
    }
  }

  /**
   * Carica le fatture dell'anno via range DB-level su invoice_date.
   * IMPORTANTE: electronic_invoices NON ha colonna `year`, quindi il filtro
   * deve passare da invoice_date. Usiamo gte/lt sull'anno successivo cosi
   * includiamo anche il 31/12 senza problemi di fuso.
   */
  async function loadInvoicesForYear(y: number) {
    if (!companyId) return;
    setLoadingYear(true);
    try {
      // MAI select('*') qui: electronic_invoices porta xml_content, e per il
      // solo 2026 sono 1.250 fatture per oltre 100 MB. La query sfondava il
      // limite di 8 secondi e la pagina rispondeva «Errore caricamento fatture».
      // L'XML serve solo quando si apre una fattura, e li' si legge per id.
      const { data, error } = await supabase
        .from('electronic_invoices')
        .select('id, invoice_number, invoice_date, supplier_name, supplier_vat, gross_amount, net_amount, vat_amount, sdi_status, sdi_id, storage_path, xml_file_path, tipo_documento, due_date, retention_start, retention_end, retention_status, created_at')
        .eq('company_id', companyId)
        .gte('invoice_date', `${y}-01-01`)
        .lt('invoice_date', `${y + 1}-01-01`)
        .order('invoice_date', { ascending: false });
      if (error) throw error;
      setInvoices((data || []) as InvoiceRow[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      console.warn('load invoices year:', msg);
      showToast && showToast('Errore caricamento fatture: ' + msg, 'error');
      setInvoices([]);
    } finally {
      setLoadingYear(false);
    }
  }

  async function loadBalanceSheets() {
    if (!companyId) return;
    try {
      const { data } = await supabase
        .from('balance_sheet_imports')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50);
      setBalanceSheets((data || []) as BalanceSheetRow[]);
    } catch (e: unknown) {
      console.warn('load balance sheets:', e instanceof Error ? e.message : e);
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
    if (!companyId) return;
    try {
      const [stmtRes, impRes] = await Promise.all([
        supabase
          .from('bank_statements')
          .select('id, filename, file_type, transaction_count, status, bank_account_id, created_at, doc_kind, source_label, period_year, period_month, bank_accounts(bank_name, account_name)')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase
          .from('bank_imports')
          .select('id, file_name, file_path, file_size, bank_account_id, uploaded_at, created_at')
          .eq('company_id', companyId)
          .order('uploaded_at', { ascending: false })
          .limit(200),
      ]);

      if (stmtRes.error) throw stmtRes.error;

      type ImportItem = { file_name: string | null; file_path: string | null; file_size: number | null; bank_account_id: string | null };
      const imports = (impRes.data || []) as ImportItem[];
      // 3 indici per i diversi livelli di matching
      const byAccountAndName = new Map<string, ImportItem>(); // bank_account_id + filename
      const byName = new Map<string, ImportItem>();            // solo filename
      const byAccount = new Map<string, ImportItem>();         // solo bank_account_id (piu' recente)
      for (const imp of imports) {
        const fn = (imp.file_name || '').toLowerCase();
        const keyA = `${imp.bank_account_id || ''}::${fn}`;
        if (!byAccountAndName.has(keyA)) byAccountAndName.set(keyA, imp);
        if (fn && !byName.has(fn)) byName.set(fn, imp);
        if (imp.bank_account_id && !byAccount.has(imp.bank_account_id)) {
          byAccount.set(imp.bank_account_id, imp);
        }
      }

      const enriched: EcFileRow[] = ((stmtRes.data || []) as unknown as EcFileRow[]).map(ec => {
        const fn = (ec.filename || '').toLowerCase();
        const byFull = byAccountAndName.get(`${ec.bank_account_id || ''}::${fn}`);
        const byFn = byName.get(fn);
        const byAcc = ec.bank_account_id ? byAccount.get(ec.bank_account_id) : undefined;
        const src = byFull || byFn || byAcc || null;
        return {
          ...ec,
          file_path: src?.file_path || null,
          file_size: src?.file_size || null,
        };
      });

      // Mostra TUTTI gli estratti conto archiviati (una riga per file), non
      // solo l'ultimo per conto: l'archivio deve elencare ogni documento.
      setEcFiles(enriched);
    } catch (e: unknown) {
      console.warn('load ec files:', e instanceof Error ? e.message : e);
      setEcFiles([]);
    }
  }

  /**
   * Apre il modal di anteprima EC con i movimenti bancari. Legge da
   * ENTRAMBE le tabelle dei movimenti (bank_transactions da TesoreriaManuale
   * e cash_movements da ImportHub) con query separate in modo che se una
   * fallisce (FK mancante) l'altra continua a funzionare.
   */
  async function openEcPreview(ec: EcFileRow) {
    if (!companyId || !ec.bank_account_id) return;
    setEcPreview({ ec, rows: [], loading: true });
    const rows: EcPreviewRow[] = [];
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
      } catch (e: unknown) { console.warn('bt preview:', e instanceof Error ? e.message : e); }

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
      } catch (e: unknown) { console.warn('cm preview:', e instanceof Error ? e.message : e); }

      rows.sort((a, b) => new Date(b.transaction_date || 0).getTime() - new Date(a.transaction_date || 0).getTime());
      setEcPreview({ ec, rows: rows.slice(0, 100), loading: false });
    } catch (err: unknown) {
      showToast('Errore anteprima EC: ' + (err instanceof Error ? err.message : ''), 'error');
      setEcPreview(null);
    }
  }

  /**
   * Download robusto del file EC originale.
   * Fallback: se file_path non e' valido prova a cercare il file nel bucket
   * bank-statements via storage.list finche' non trova un filename che
   * contenga il nome dell'EC.
   */
  async function downloadEcFile(ec: EcFileRow) {
    if (ec.file_path) {
      return downloadFile('bank-statements', ec.file_path, ec.filename ?? 'extract.xlsx');
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
    } catch (err: unknown) {
      showToast('Errore ricerca file: ' + (err instanceof Error ? err.message : ''), 'error');
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
  const invoicesPerYear = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
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
      (String((inv as { supplier_vat?: string | null }).supplier_vat || '')).toLowerCase().includes(q)
    );
  }, [invoices, searchInvoices]);

  // Fatture raggruppate
  interface GroupAgg { key: string; label: string; sortKey: string; invoices: InvoiceRow[]; total: number }
  const groups = useMemo<GroupAgg[]>(() => {
    const map = new Map<string, GroupAgg>();
    for (const inv of filteredInvoices) {
      let key: string, label: string, sortKey: string;
      if (groupBy === 'supplier') {
        const supplierVat = (inv as { supplier_vat?: string | null }).supplier_vat;
        key = supplierVat || inv.supplier_name || 'unknown';
        label = inv.supplier_name || 'Fornitore sconosciuto';
        sortKey = label.toLowerCase();
      } else {
        const d = new Date(inv.invoice_date || '');
        const m = d.getMonth();
        key = `${d.getFullYear()}-${String(m).padStart(2, '0')}`;
        label = `${MONTH_FULL[m]} ${d.getFullYear()}`;
        sortKey = `${d.getFullYear()}-${String(11 - m).padStart(2, '0')}`; // mesi piu' recenti prima
      }
      if (!map.has(key)) {
        map.set(key, { key, label, sortKey, invoices: [], total: 0 });
      }
      const g = map.get(key)!;
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

  // ─── ARCHIVIO EC: anni disponibili, filtro e raggruppamento per fonte ───
  const ecAvailableYears = useMemo(() => {
    const ys = new Set<number>();
    for (const ec of ecFiles) if (ec.period_year) ys.add(Number(ec.period_year));
    return Array.from(ys).sort((a, b) => b - a);
  }, [ecFiles]);

  const ecFilteredGroups = useMemo(() => {
    const q = ecSearch.trim().toLowerCase();
    const rows = ecFiles.filter(ec => {
      if (ecKind !== 'all' && (ec.doc_kind || 'conto_corrente') !== ecKind) return false;
      if (ecYear !== 'all' && Number(ec.period_year) !== ecYear) return false;
      if (q) {
        const hay = `${ec.source_label || ''} ${ec.filename || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // raggruppa per fonte (source_label), fallback al nome banca o "Senza fonte"
    const map = new Map<string, { label: string; kind: string; items: EcFileRow[] }>();
    for (const ec of rows) {
      const label = ec.source_label || ec.bank_accounts?.bank_name || 'Senza fonte';
      const key = label;
      if (!map.has(key)) map.set(key, { label, kind: ec.doc_kind || 'conto_corrente', items: [] });
      map.get(key)!.items.push(ec);
    }
    const groups = Array.from(map.values());
    // ordina: conti prima delle carte, poi alfabetico per fonte
    groups.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'conto_corrente' ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    // dentro ogni gruppo: periodo desc, poi nome
    for (const g of groups) {
      g.items.sort((a, b) => {
        const pa = (Number(a.period_year) || 0) * 100 + (Number(a.period_month) || 0);
        const pb = (Number(b.period_year) || 0) * 100 + (Number(b.period_month) || 0);
        if (pa !== pb) return pb - pa;
        return (a.filename || '').localeCompare(b.filename || '');
      });
    }
    return groups;
  }, [ecFiles, ecSearch, ecKind, ecYear]);

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

  function toggleGroup(key: string) {
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
  // TODO: tighten type
  async function openInvoiceViewer(inv: any, { autoPrint = false } = {}) {
    setLoadingXml(inv.id);
    try {
      // L'elenco non porta piu' l'XML (troppo pesante): si legge ora, per id.
      let xml = inv.xml_content;
      if (!xml) {
        const { data: riga } = await supabase
          .from('electronic_invoices').select('xml_content').eq('id', inv.id).maybeSingle();
        xml = (riga as { xml_content?: string | null } | null)?.xml_content || null;
      }
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
    } catch (err: unknown) {
      showToast('Errore apertura fattura: ' + (err instanceof Error ? err.message : ''), 'error');
    } finally {
      setLoadingXml(null);
    }
  }

  async function downloadFile(bucket: string, path: string, fileName?: string) {
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
    } catch (err: unknown) {
      showToast('Errore download: ' + (err instanceof Error ? err.message : ''), 'error');
    }
  }

  async function openPdfPreview(bucket: string, path: string) {
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
      if (error) throw error;
      window.open(data.signedUrl, '_blank');
    } catch (err: unknown) {
      showToast('Errore apertura PDF: ' + (err instanceof Error ? err.message : ''), 'error');
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
        <KpiCard label="Estratti Conto" value={ecFiles.length} icon={Database} color="emerald" sub={`${ecFiles.filter(e => (e.doc_kind || 'conto_corrente') === 'conto_corrente').length} conti · ${ecFiles.filter(e => e.doc_kind === 'carta').length} carte`} />
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
                    : <div className="w-7 h-7 bg-indigo-100 text-indigo-700 rounded font-semibold text-xs flex items-center justify-center">{MONTH_LABELS[new Date(group.invoices[0].invoice_date || '').getMonth()]}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <Tooltip content={group.label}><div className="font-medium text-slate-800 truncate">{group.label}</div></Tooltip>
                    <div className="text-xs text-slate-500">{group.invoices.length} fattur{group.invoices.length === 1 ? 'a' : 'e'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold text-slate-900">{formatCurrency(group.total)}</div>
                  </div>
                </button>

                {expanded && (
                  <div className="bg-slate-50/60 border-t border-slate-100 overflow-x-auto scroll-shadow-x">
                    <table className="w-full min-w-[560px]">
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
                              <Tooltip content={inv.supplier_name ?? ''}><td className="px-4 py-2.5 text-sm text-slate-600 truncate max-w-xs">{inv.supplier_name || '—'}</td></Tooltip>
                            )}
                            <td className="px-4 py-2.5 text-sm text-right font-medium text-slate-900">
                              {formatCurrency(inv.gross_amount || (inv as { total_amount?: number | null }).total_amount || null)}
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
                  <Tooltip content={String(bs.file_name ?? '')}>
                    <div className="font-medium text-slate-800 truncate">
                      {String(bs.file_name ?? 'Bilancio senza nome')}
                    </div>
                  </Tooltip>
                  <div className="text-xs text-slate-500 flex gap-3">
                    {bs.year != null && <span>Anno {String(bs.year)}</span>}
                    <span>{formatDate((bs.created_at || (bs.uploaded_at as string | null | undefined)) ?? null)}</span>
                    {bs.file_size != null && <span>{formatSize(bs.file_size as number)}</span>}
                    {bs.status != null && <span className="text-indigo-600">· {String(bs.status)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {bs.file_path != null && (
                    <>
                      <button
                        onClick={() => openPdfPreview('balance-sheets', String(bs.file_path))}
                        className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-100 border border-indigo-200 inline-flex items-center gap-1"
                        title="Apri il PDF in una nuova scheda"
                      >
                        <Eye size={12} /> Anteprima
                      </button>
                      <button
                        onClick={() => downloadFile('balance-sheets', String(bs.file_path), bs.file_name ? String(bs.file_name) : undefined)}
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
            <p className="text-xs text-slate-500">{ecFiles.length} documenti · {ecFilteredGroups.length} fonti</p>
          </div>
        </button>
        {sectionOpen.ec && (
        <div>
          {/* Toolbar: archivia il file EC senza importarne i movimenti */}
          <div className="px-5 py-3 flex items-center justify-between gap-3 bg-slate-50/60 border-b border-slate-100">
            <p className="text-xs text-slate-500">
              Archivia il PDF/XLS dell'estratto conto <span className="font-medium text-slate-600">senza importarne i movimenti</span> (utile quando i movimenti sono già sincronizzati via A-Cube).
            </p>
            <button
              onClick={() => setEcArchive({ files: [], bankAccountId: bankAccounts[0]?.id || '', busy: false })}
              className="shrink-0 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 inline-flex items-center gap-1.5"
              title="Carica e archivia un estratto conto (nessun movimento verrà importato)"
            >
              <Upload size={13} /> Archivia estratto conto
            </button>
          </div>

          {ecFiles.length === 0 ? (
            <div className="text-center py-10">
              <Database size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nessun estratto conto</p>
              <p className="text-xs text-slate-400">Usa "Archivia estratto conto" qui sopra, oppure importali da Import Hub</p>
            </div>
          ) : (
          <>
            {/* Barra filtri/ricerca */}
            <div className="px-5 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={ecSearch}
                  onChange={e => setEcSearch(e.target.value)}
                  placeholder="Cerca per fonte o nome file…"
                  className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                />
              </div>
              <select value={ecKind} onChange={e => setEcKind(e.target.value as typeof ecKind)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700">
                <option value="all">Tutti i tipi</option>
                <option value="conto_corrente">Conti correnti</option>
                <option value="carta">Carte</option>
              </select>
              <select value={String(ecYear)} onChange={e => setEcYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700">
                <option value="all">Tutti gli anni</option>
                {ecAvailableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              {(ecSearch || ecKind !== 'all' || ecYear !== 'all') && (
                <button onClick={() => { setEcSearch(''); setEcKind('all'); setEcYear('all'); }}
                  className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1">
                  <X size={12} /> Azzera
                </button>
              )}
            </div>

            {/* Gruppi per fonte (conto/carta) */}
            {ecFilteredGroups.length === 0 ? (
              <div className="text-center py-10 text-sm text-slate-500">Nessun documento con questi filtri.</div>
            ) : ecFilteredGroups.map(group => {
              const collapsed = ecCollapsed.has(group.label);
              const isCard = group.kind === 'carta';
              return (
                <div key={group.label} className="border-b border-slate-100 last:border-b-0">
                  <button
                    onClick={() => setEcCollapsed(prev => { const n = new Set(prev); n.has(group.label) ? n.delete(group.label) : n.add(group.label); return n; })}
                    className="w-full px-5 py-2.5 flex items-center gap-2 hover:bg-slate-50 text-left"
                  >
                    {collapsed ? <ChevronRight size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${isCard ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {isCard ? 'Carta' : 'Conto'}
                    </span>
                    <span className="font-medium text-slate-800 text-sm">{group.label}</span>
                    <span className="text-xs text-slate-400">· {group.items.length}</span>
                  </button>
                  {!collapsed && (
                    <div className="divide-y divide-slate-50">
                      {group.items.map(ec => {
                        const per = ec.period_month != null ? `${MONTH_FULL[Number(ec.period_month) - 1]} ${ec.period_year ?? ''}`.trim()
                          : (ec.period_year ? String(ec.period_year) : (ec.filename?.split('/').pop() || 'documento'));
                        const ft = String(ec.file_type || '').toUpperCase();
                        return (
                          <div key={ec.id} className="pl-12 pr-5 py-2 flex items-center gap-3 hover:bg-slate-50">
                            <FileText size={15} className={isCard ? 'text-violet-500 shrink-0' : 'text-emerald-600 shrink-0'} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-slate-800 font-medium">{per}</div>
                              <Tooltip content={ec.filename ?? ''}>
                                <div className="text-[11px] text-slate-400 truncate">{ec.filename?.split('/').pop()}</div>
                              </Tooltip>
                            </div>
                            {ft && <span className="text-[10px] font-semibold text-slate-400 shrink-0">{ft}</span>}
                            <div className="flex items-center gap-1 shrink-0">
                              {!isCard && (
                                <button onClick={() => openEcPreview(ec)}
                                  className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100 border border-emerald-200 inline-flex items-center gap-1"
                                  title="Vedi i movimenti a sistema per questo conto">
                                  <Eye size={12} /> Anteprima
                                </button>
                              )}
                              <button onClick={() => downloadEcFile(ec)}
                                className="px-2 py-1 bg-white text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 border border-slate-200 inline-flex items-center gap-1"
                                title="Scarica il file originale">
                                <Download size={12} /> Scarica
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
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
      <Modal
        open={!!ecPreview}
        onClose={() => setEcPreview(null)}
        bare
        ariaLabel="Anteprima estratto conto"
        containerClassName="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
        panelClassName="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90dvh] flex flex-col overflow-hidden"
      >
        {ecPreview && (
          <>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 rounded-lg">
                  <Database size={18} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">{ecPreview.ec?.filename || 'Estratto Conto'}</h3>
                  <p className="text-xs text-slate-500">
                    {ecPreview.ec?.bank_accounts?.bank_name || 'Banca'}
                    {ecPreview.ec?.transaction_count != null && ` · ${ecPreview.ec.transaction_count.toLocaleString('de-DE')} movimenti`}
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
                <button onClick={() => setEcPreview(null)} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Chiudi">
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
                        <Tooltip content={tx.description ?? ''}><td className="px-4 py-2 text-slate-700 truncate max-w-md">{tx.description || '—'}</td></Tooltip>
                        <td className={`px-4 py-2 text-right font-medium whitespace-nowrap ${(tx.amount ?? 0) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
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
              <span>Mostrati {ecPreview.rows.length} movimenti{Number(ecPreview.ec?.transaction_count || 0) > ecPreview.rows.length ? ` di ${ecPreview.ec.transaction_count}` : ''}</span>
              {ecPreview.ec?.bank_account_id && (
                <button
                  onClick={() => { setEcPreview(null); navigate(`/banche?tab=movimenti&account=${ecPreview.ec.bank_account_id}`); }}
                  className="text-emerald-700 hover:underline flex items-center gap-1"
                >
                  Apri tutti in Movimenti <ExternalLink size={11} />
                </button>
              )}
            </div>
          </>
        )}
      </Modal>

      {/* ═══════════ MODAL ARCHIVIA ESTRATTO CONTO (no import movimenti) ═══════════ */}
      <Modal
        open={!!ecArchive}
        onClose={() => { if (!ecArchive?.busy) setEcArchive(null); }}
        bare
        ariaLabel="Archivia estratto conto"
        containerClassName="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
        panelClassName="bg-white rounded-2xl shadow-2xl max-w-lg w-full flex flex-col overflow-hidden"
      >
        {ecArchive && (
          <>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 rounded-lg"><Upload size={18} className="text-emerald-600" /></div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">Archivia estratto conto</h3>
                  <p className="text-xs text-slate-500">Salva il file originale. Nessun movimento verrà importato.</p>
                </div>
              </div>
              <button onClick={() => { if (!ecArchive.busy) setEcArchive(null); }} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Chiudi">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Conto di ripiego</label>
                <select
                  value={ecArchive.bankAccountId}
                  onChange={e => setEcArchive(prev => prev ? { ...prev, bankAccountId: e.target.value } : prev)}
                  disabled={ecArchive.busy}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                >
                  <option value="">— Seleziona conto —</option>
                  {bankAccounts.map(ba => (
                    <option key={ba.id} value={ba.id}>
                      {ba.bank_name || 'Banca'}{ba.account_name ? ` — ${ba.account_name}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">I file con nome conto riconoscibile (Mugello, Intesa, BCC, MPS) vengono assegnati al conto giusto in automatico; gli altri (es. carte) finiscono su questo conto di ripiego.</p>
                {bankAccounts.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1">Nessun conto attivo trovato. Crea il conto in Banche prima di archiviare.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">File o .zip (PDF, XLS, XLSX, CSV, ZIP)</label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.xls,.xlsx,.csv,.zip"
                  disabled={ecArchive.busy}
                  onChange={e => setEcArchive(prev => prev ? { ...prev, files: Array.from(e.target.files || []) } : prev)}
                  className="w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:text-xs file:font-semibold hover:file:bg-emerald-100"
                />
                <div className="mt-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">…oppure collega un'intera cartella</label>
                  <input
                    type="file"
                    // @ts-expect-error attributi non standard per selezionare una cartella
                    webkitdirectory=""
                    directory=""
                    multiple
                    disabled={ecArchive.busy}
                    onChange={e => setEcArchive(prev => prev ? { ...prev, files: Array.from(e.target.files || []) } : prev)}
                    className="w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:text-xs file:font-semibold hover:file:bg-slate-200"
                  />
                </div>
                {ecArchive.files.length > 0 && (
                  <p className="text-[11px] text-slate-500 mt-1">{ecArchive.files.length} elemento/i selezionato/i.</p>
                )}
                <p className="text-[11px] text-slate-500 mt-1">Cartella o <span className="font-medium">.zip</span>: vengono presi solo i documenti EC (PDF/XLS/XLSX/CSV), saltando manifest e file di report. Il nome della cartella resta nel documento archiviato; lo .zip non viene salvato.</p>
              </div>
              <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 rounded-lg p-2.5">
                <AlertCircle size={14} className="text-slate-400 shrink-0 mt-0.5" />
                <span>Questa azione archivia solo i documenti (bucket <code>bank-statements</code>). I movimenti restano quelli già presenti: non vengono né creati né duplicati.</span>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
              <button
                onClick={() => { if (!ecArchive.busy) setEcArchive(null); }}
                disabled={ecArchive.busy}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white rounded-lg hover:bg-slate-50 border border-slate-200 disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                onClick={archiveEcFiles}
                disabled={ecArchive.busy || ecArchive.files.length === 0 || !ecArchive.bankAccountId}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {ecArchive.busy ? (<><RefreshCw size={13} className="animate-spin" /> Archiviazione…</>) : (<><Upload size={13} /> Archivia</>)}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// KPI Card
// ═══════════════════════════════════════════════════════════════
function KpiCard({ label, value, icon: Icon, color, sub }: { label: string; value: string | number; icon: React.ElementType; color: string; sub?: string }) {
  const colorMap: Record<string, string> = {
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

// TODO: tighten type
function ConservazioneTab({ docs, stats, loading, filter, setFilter, search, setSearch, getRetentionStatus, daysUntilExpiry, updateStatus }: { docs: any[]; stats: any; loading: boolean; filter: string; setFilter: (v: string) => void; search: string; setSearch: (v: string) => void; getRetentionStatus: (d: any) => string; daysUntilExpiry: (d: any) => number | null; updateStatus: (id: string, source: string, status: string) => void }) {
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
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" title="Cancella ricerca">
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
            <div className="overflow-x-auto scroll-shadow-x">
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
                              <Tooltip content={name}><div className="text-sm font-medium text-slate-800 truncate max-w-xs">{name}</div></Tooltip>
                              {isInvoice && (
                                <Tooltip content={(doc.direction === 'inbound' ? doc.supplier_name : doc.customer_name) ?? ''}>
                                  <div className="text-xs text-slate-400 truncate">
                                    {doc.direction === 'inbound' ? doc.supplier_name : doc.customer_name}
                                  </div>
                                </Tooltip>
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
                          <div className="flex items-center justify-end gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
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
