import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Row } from '../types/business';
import { usePeriod } from '../hooks/usePeriod';
import PageHeader from '../components/PageHeader';
import { useToast } from '../components/Toast';
import {
  BarChart3,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  Upload,
  FileText,
  Eye,
  AlertCircle,
  Percent,
  RefreshCw,
  FileUp,
  Store,
  Users,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { Modal as UIModal } from '../components/ui/Modal';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE, PALETTE, getOutletColor, fmtEuro } from '../components/ChartTheme';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
// lib/pdfText importa pdfjs-dist a livello modulo (~350KB gzip): la si carica
// on-demand con import() solo quando l'utente seleziona davvero un PDF.
import {
  parseItNum, norm,
  parseInfinityNettiItems, parsePdfLordi, parseSpreadsheet,
  parseProspettoPaghe, contrAziendaOutlet, tabulatoNetti,
  parseStatisticaCostoOrario, listStatisticaCompanies,
  LORDI_FIELDS, rowLordo, rowHasLordo,
  type PreviewRow, type ParsedImport, type ProspettoOutletRow, type StatEmpMonth,
} from '../lib/payrollParse';
import { mergeSumByKey, keepLastByKey, duplicateKeys, readableDbError } from '../lib/upsertDedupe';
import { archiviaFile, avvisoArchiviazioneFallita } from '../lib/archivioFile';
import { UiTooltip } from '../components/Tooltip'; // alias: 'Tooltip' collide con recharts
import ExportMenu from '../components/ExportMenu';
// Organico granitico: fonte unica del conteggio dipendenti (vedi src/lib/headcount.ts).
import {
  companyHeadcount, headcountByOutlet as headcountByOutletOf, paidEmployeeIds,
  lastGranitedPeriod, periodLabel,
} from '../lib/headcount';

const PdfViewer = lazy(() => import('../components/PdfViewer'));

// ============================================================================
// TYPES
// ============================================================================
type Employee = Row<'employees'>;
type EmployeeOutletAllocation = Row<'employee_outlet_allocations'>;
type EmployeeCost = Row<'employee_costs'>;
type CostCenterRow = Row<'cost_centers'>;
type EmployeeDocument = Row<'employee_documents'>;

interface OutletRow {
  id: string;
  name: string;
  code: string | null;
  cost_center_key: string | null;
  is_active: boolean | null;
  mall_name: string | null;
  city: string | null;
  // Alias di filiale del file paghe (migration 168): serve al parser dei netti.
  payroll_filiali: string[] | null;
}

// Vista persistita in URL come ?view=
type PersonaleView = 'panoramica' | 'per_outlet' | 'organico' | 'costi' | 'lordi';
const VALID_VIEWS: PersonaleView[] = ['panoramica', 'per_outlet', 'organico', 'costi', 'lordi'];

const MONTHS = [
  { num: 1, label: 'Gennaio' }, { num: 2, label: 'Febbraio' }, { num: 3, label: 'Marzo' },
  { num: 4, label: 'Aprile' }, { num: 5, label: 'Maggio' }, { num: 6, label: 'Giugno' },
  { num: 7, label: 'Luglio' }, { num: 8, label: 'Agosto' }, { num: 9, label: 'Settembre' },
  { num: 10, label: 'Ottobre' }, { num: 11, label: 'Novembre' }, { num: 12, label: 'Dicembre' },
];

// I cedolini che possono arrivare per uno stesso mese. Il mese vale la somma
// dei cedolini caricati, salvo una correzione manuale che vince su tutti.
const TIPI_CEDOLINO = [
  { key: 'normale', label: 'Mensilità normale' },
  { key: 'tredicesima', label: 'Tredicesima' },
  { key: 'quattordicesima', label: 'Quattordicesima' },
  { key: 'aggiuntivo', label: 'Cedolino aggiuntivo' },
] as const;
const labelTipo = (t: string) => TIPI_CEDOLINO.find((x) => x.key === t)?.label || (t === 'manuale' ? 'Correzione manuale' : t);

// Conti 67xx del personale → colonna employee_costs corrispondente.
const COSTO_CONTI = [
  { code: '670103', label: 'Salari e stipendi (lordo)', field: 'retribuzione' as const },
  { code: '670303', label: 'Contributi INPS', field: 'contributi' as const },
  { code: '670307', label: 'INAIL', field: 'inail' as const },
  { code: '670501', label: 'TFR', field: 'tfr' as const },
  { code: '670909', label: 'Altri costi personale', field: 'altri_costi' as const },
];

// Cella "sede" con pallino colore outlet (usata in Organico e Cedolini).
function SedeCell({ allocs }: { allocs: EmployeeOutletAllocation[] }) {
  if (!allocs.length) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {allocs.map((a, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: getOutletColor(a.outlet_code).main }} />
          <span className="text-slate-600">{a.outlet_code}</span>
        </span>
      ))}
    </span>
  );
}

// Outlet (sede) primario di un dipendente: prima allocazione (is_primary o la prima).
const primaryOutlet = (allocs: EmployeeOutletAllocation[]): string => {
  if (!allocs.length) return 'Senza sede';
  return (allocs.find((a) => a.is_primary) || allocs[0]).outlet_code;
};

// Sezione collassabile per outlet (accordion). Default collassata.
function OutletAccordion({ name, count, total, defaultOpen = false, children }: {
  name: string; count: number; total: number | null; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const color = name === 'Senza sede' ? { main: '#94a3b8' } : getOutletColor(name);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors">
        <span className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color.main }} />
          <span className="font-semibold text-slate-800 truncate">{name}</span>
          <span className="text-xs font-normal text-slate-500 shrink-0">· {count} dipendenti</span>
        </span>
        <span className="text-sm shrink-0">{total == null ? <span className="text-slate-300">—</span> : <Money v={total} strong />}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// ORDINAMENTO GRANITICO: outlet veri (alfabetico) → SEDE / MAGAZZINO → (Amministratori a parte).
const isSedeOutlet = (o: OutletRow) => o.cost_center_key === 'sede_magazzino';
function sortOutlets(outlets: OutletRow[]): OutletRow[] {
  return [...outlets].sort((a, b) => {
    const as = isSedeOutlet(a) ? 1 : 0, bs = isSedeOutlet(b) ? 1 : 0;
    return as - bs || a.name.localeCompare(b.name, 'it');
  });
}
function sortGroupNames(names: string[], outlets: OutletRow[]): string[] {
  const order = sortOutlets(outlets).map((o) => o.name);
  const rank = (n: string) => { const i = order.indexOf(n); return i >= 0 ? i : 9000; };
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'it'));
}

// Sezione "Amministratori" — sempre in fondo. Netto del mese (no-zero) + costo lordo annuo.
function AmministratoriAccordion({ admins, nettoCell, lordoTot, mm, year }: {
  admins: Employee[]; nettoCell: (id: string) => number | null; lordoTot: number; mm: string; year: number;
}) {
  const [open, setOpen] = useState(false);
  if (!admins.length && !lordoTot) return null;
  const totNetto = admins.reduce((s, e) => s + (nettoCell(e.id) || 0), 0);
  const single = admins.length === 1;
  return (
    <div className="border border-amber-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-amber-50 hover:bg-amber-100 transition-colors">
        <span className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown size={16} className="text-amber-500 shrink-0" /> : <ChevronRight size={16} className="text-amber-500 shrink-0" />}
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: '#f59e0b' }} />
          <span className="font-semibold text-amber-800 truncate">Amministratori</span>
          <span className="text-xs font-normal text-amber-700/70 shrink-0">· {admins.length} · esclusi dai conteggi dipendenti</span>
        </span>
        <span className="text-sm shrink-0">{totNetto ? <Money v={totNetto} strong /> : <span className="text-slate-300">—</span>}</span>
      </button>
      {open && (
        <div className="overflow-x-auto scroll-shadow-x">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500 bg-white border-b border-slate-200">
                <th className="px-4 py-2 text-left font-bold">Amministratore</th>
                <th className="px-4 py-2 text-right font-bold">Netto {mm}/{year}</th>
                <th className="px-4 py-2 text-right font-bold">Costo lordo {year}</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((e) => {
                const netto = nettoCell(e.id);
                return (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{empName(e)}</td>
                    <td className="px-4 py-2.5 text-right">{netto == null ? <span className="text-slate-300">—</span> : <Money v={netto} />}</td>
                    <td className="px-4 py-2.5 text-right">{single ? <Money v={lordoTot} /> : <span className="text-slate-300">—</span>}</td>
                  </tr>
                );
              })}
              <tr className="font-bold border-t-2 border-slate-300">
                <td className="px-4 py-2.5">Totale amministratori</td>
                <td className="px-4 py-2.5 text-right"><Money v={totNetto} strong /></td>
                <td className="px-4 py-2.5 text-right"><Money v={lordoTot} strong /></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================
const eurFmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eurInt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

// Valuta compatta: ≥1M → "1,21 M€", altrimenti intero "60.926 €".
function compactEur(v: number): string {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M€`;
  }
  return `${eurFmt.format(n)} €`;
}

// Render valuta: positivo nero senza segno, negativo rosso con il meno.
function Money({ v, className = '', strong = false }: { v: number | null | undefined; className?: string; strong?: boolean }) {
  const n = Number(v || 0);
  const neg = n < 0;
  return (
    <span className={`tabular-nums ${neg ? 'text-red-600' : 'text-slate-900'} ${strong ? 'font-semibold' : ''} ${className}`}>
      {eurFmt.format(n)}&nbsp;€
    </span>
  );
}

// Un dipendente è "Amministratore" se la qualifica lo indica (data-driven, niente nome hardcoded).
const isAdminRole = (e: Employee) =>
  /amministrat/i.test(e.role_description || '') || /amministrat/i.test((e as any).note || e.notes || '');

const empName = (e: Employee) =>
  `${e.cognome || e.last_name || ''} ${e.nome || e.first_name || ''}`.trim() || '—';

// ============================================================================
// UI SHELLS (Modal custom — mai dialog nativi)
// ============================================================================
function Modal({ title, onClose, children, maxW = 'max-w-lg' }: { title: string; onClose: () => void; children: React.ReactNode; maxW?: string }) {
  return (
    <UIModal
      open
      onClose={onClose}
      bare
      ariaLabel={title}
      containerClassName="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      panelClassName={`bg-white rounded-2xl shadow-2xl w-full ${maxW} max-h-[90dvh] overflow-y-auto`}
    >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Chiudi"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
    </UIModal>
  );
}

function ConfirmModal({ open, title, message, confirmLabel = 'Conferma', danger = false, onConfirm, onCancel }: {
  open: boolean; title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <Modal title={title} onClose={onCancel} maxW="max-w-md">
      <div className="text-sm text-slate-600 mb-5 whitespace-pre-line">{message}</div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Annulla</button>
        <button onClick={onConfirm} className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

// KPI card: il BORDO colorato indica la FONTE del dato (arancione = B&C, verde =
// netti/consuntivo, neutro = anagrafico). Valore e label sempre in NERO (slate-900).
const KPI_BORDER: Record<'bc' | 'netto' | 'neutro', string> = {
  bc: '#ea580c',
  netto: '#16a34a',
  neutro: '#e2e8f0',
};
function Kpi({ label, value, sub, icon: Icon, source = 'neutro' }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  source?: 'bc' | 'netto' | 'neutro';
}) {
  return (
    <div className="rounded-2xl shadow-lg p-5 bg-white" style={{ border: `2px solid ${KPI_BORDER[source]}` }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-slate-500 truncate">{label}</span>
        <Icon size={16} className="text-slate-400 shrink-0" />
      </div>
      <div className="text-2xl font-bold tabular-nums leading-tight text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function Dipendenti() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { company } = useCompany();
  const companyName = company?.name || '';
  const COMPANY_ID = profile?.company_id || undefined;
  const USER_ID = profile?.id || null;
  const { year: globalYear } = usePeriod();

  // view persistita in URL
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const view: PersonaleView = VALID_VIEWS.includes(viewParam as PersonaleView) ? (viewParam as PersonaleView) : 'panoramica';
  const setView = (next: PersonaleView) => {
    const p = new URLSearchParams(searchParams);
    p.set('view', next);
    setSearchParams(p);
  };

  const [selectedYear, setSelectedYear] = useState(globalYear);
  // Il mese parte da quello di calendario, ma appena i cedolini sono caricati si
  // sposta sull'ultimo mese granito dell'anno (a settembre non ha senso aprire su
  // un mese vuoto). Il salto avviene una sola volta: se l'utente sceglie un mese,
  // la sua scelta comanda.
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const monthTouched = useRef(false);
  const pickMonth = (m: number) => { monthTouched.current = true; setSelectedMonth(m); };

  // Data state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allocations, setAllocations] = useState<EmployeeOutletAllocation[]>([]);
  const [costs, setCosts] = useState<EmployeeCost[]>([]);
  // I cedolini che compongono ogni mese: il totale non deve restare inspiegato.
  const [slips, setSlips] = useState<{ employee_id: string; year: number; month: number; tipo: string; netto: number | null }[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [outlets, setOutlets] = useState<OutletRow[]>([]);
  const [employeeDocs, setEmployeeDocs] = useState<EmployeeDocument[]>([]);
  const [bcByCenter, setBcByCenter] = useState<Record<string, number>>({});
  const [adminBudgetRows, setAdminBudgetRows] = useState<{ cost_center: string; amount: number }[]>([]);
  const [bilancioPersonale, setBilancioPersonale] = useState<number | null>(null);
  const [revenueYear, setRevenueYear] = useState<number>(0); // ricavi PREVISTI (budget)
  const [revenueConsAnnual, setRevenueConsAnnual] = useState<number>(0); // consuntivo a oggi ANNUALIZZATO
  const [consMesi, setConsMesi] = useState<number>(0); // n. mesi consuntivati
  const [loading, setLoading] = useState(true);

  // UI state
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [showCostForm, setShowCostForm] = useState(false);
  const [editingCost, setEditingCost] = useState<EmployeeCost | null>(null);
  const [costFormEmp, setCostFormEmp] = useState<string | null>(null);
  const [showAllocEditor, setShowAllocEditor] = useState<string | null>(null);
  const [allocEdits, setAllocEdits] = useState<{ outlet_code: string; allocation_pct: number }[]>([]);
  const [allocErrors, setAllocErrors] = useState('');
  const [uploadingEmployee, setUploadingEmployee] = useState<string | null>(null);
  const [showDocViewer, setShowDocViewer] = useState<EmployeeDocument | null>(null);
  const [docPdfData, setDocPdfData] = useState<ArrayBuffer | null>(null);
  const [confirmState, setConfirmState] = useState<{ title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void } | null>(null);
  const cedolinoRef = useRef<HTMLInputElement>(null);
  const cedolinoEmpRef = useRef<string | null>(null);

  // Filtri organico
  const [orgOutletFilter, setOrgOutletFilter] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [orgStatus, setOrgStatus] = useState<'attivi' | 'cessati' | 'tutti'>('attivi');

  // Cessazione dipendente (modale custom)
  const [cessaEmp, setCessaEmp] = useState<Employee | null>(null);
  const [cessaDate, setCessaDate] = useState('');
  // Scheda dipendente (netto mese per mese)
  const [schedaEmp, setSchedaEmp] = useState<Employee | null>(null);

  // ========== LOAD ==========
  useEffect(() => {
    if (!COMPANY_ID) return;
    loadStatic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [COMPANY_ID]);

  useEffect(() => {
    if (!COMPANY_ID) return;
    loadYearScoped(COMPANY_ID, selectedYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [COMPANY_ID, selectedYear]);

  const loadStatic = async () => {
    if (!COMPANY_ID) return;
    try {
      setLoading(true);
      const [empRes, allocRes, costRes, ccRes, outRes, docRes] = await Promise.all([
        supabase.from('employees').select('*').eq('company_id', COMPANY_ID).order('cognome', { nullsFirst: false }),
        supabase.from('employee_outlet_allocations').select('*').eq('company_id', COMPANY_ID),
        supabase.from('employee_costs').select('*').eq('company_id', COMPANY_ID),
        supabase.from('cost_centers').select('*').eq('company_id', COMPANY_ID).eq('is_active', true).order('sort_order', { nullsFirst: false }),
        supabase.from('outlets').select('id, name, code, cost_center_key, is_active, mall_name, city, payroll_filiali').eq('company_id', COMPANY_ID).eq('is_active', true).order('name'),
        supabase.from('employee_documents').select('*').eq('company_id', COMPANY_ID).order('created_at', { ascending: false }),
      ]);
      const { data: slipRes } = await supabase.from('employee_cost_slips')
        .select('employee_id, year, month, tipo, netto').eq('company_id', COMPANY_ID);
      setSlips((slipRes as any[]) || []);
      setEmployees((empRes.data as Employee[]) || []);
      setAllocations((allocRes.data as EmployeeOutletAllocation[]) || []);
      setCosts((costRes.data as EmployeeCost[]) || []);
      setCostCenters((ccRes.data as CostCenterRow[]) || []);
      setOutlets((outRes.data as OutletRow[]) || []);
      setEmployeeDocs((docRes.data as EmployeeDocument[]) || []);
    } catch (err) {
      console.error('Errore caricamento Personale:', err);
      toast({ type: 'error', message: 'Errore nel caricamento dei dati' });
    } finally {
      setLoading(false);
    }
  };

  // Budget B&C (conti 67xx), bilancio totale personale, ricavi — dipendono dall'anno.
  const loadYearScoped = async (cid: string, year: number) => {
    try {
      // Costo personale = budget_entries 67xx, raggruppati per cost_center (SOLA LETTURA)
      const { data: be } = await supabase
        .from('budget_entries')
        .select('account_code, cost_center, budget_amount, actual_amount')
        .eq('company_id', cid)
        .eq('year', year)
        .like('account_code', '67%');
      const byCenter: Record<string, number> = {};
      (be || []).forEach((r) => {
        if (r.cost_center === 'all') return; // 'all' è il roll-up: evita doppio conteggio
        const v = Number(r.budget_amount) || 0;
        byCenter[r.cost_center] = (byCenter[r.cost_center] || 0) + v;
      });
      setBcByCenter(byCenter);

      // Bilancio: totale personale a CE
      const { data: bil } = await supabase
        .from('balance_sheet_data')
        .select('amount')
        .eq('company_id', cid)
        .eq('account_code', 'totale_personale')
        .eq('section', 'conto_economico')
        .eq('year', year)
        .maybeSingle();
      setBilancioPersonale(bil?.amount != null ? Number(bil.amount) : null);

      // Ricavi (per incidenza) — sempre via chart_of_accounts.is_revenue, MAI macro_group
      const { data: revAccts } = await supabase
        .from('chart_of_accounts')
        .select('code')
        .eq('company_id', cid)
        .eq('is_revenue', true);
      const codes = (revAccts || []).map((r) => r.code);
      let revenue = 0;
      if (codes.length) {
        const { data: rev } = await supabase
          .from('budget_entries')
          .select('budget_amount, actual_amount')
          .eq('company_id', cid)
          .eq('year', year)
          .in('account_code', codes);
        revenue = (rev || []).reduce((s, r) => s + (Number(r.actual_amount) || Number(r.budget_amount) || 0), 0);
      }
      setRevenueYear(revenue);

      // Ricavi CONSUNTIVO a oggi (granitico, budget_confronto.cons_monthly) → annualizzati
      // (tot / mesi_consuntivati × 12) per l'incidenza "proiezione a fine anno".
      let consTot = 0; let mesiSet = new Set<number>();
      if (codes.length) {
        const { data: cons } = await supabase
          .from('budget_confronto')
          .select('amount, month')
          .eq('company_id', cid)
          .eq('year', year)
          .eq('entry_type', 'cons_monthly')
          .in('account_code', codes);
        (cons || []).forEach((r) => { consTot += Number(r.amount) || 0; if (r.month != null) mesiSet.add(Number(r.month)); });
      }
      const nMesi = mesiSet.size;
      setConsMesi(nMesi);
      setRevenueConsAnnual(nMesi > 0 ? (consTot / nMesi) * 12 : 0);

      // Costo lordo amministratori = budget_entries dei conti is_admin_compensation,
      // per cost_center mappato a un outlet reale (escluso 'all'). Codici da DB, niente hardcoded.
      const { data: admAccts } = await supabase
        .from('chart_of_accounts')
        .select('code')
        .eq('company_id', cid)
        .eq('is_admin_compensation', true);
      const admCodes = (admAccts || []).map((r) => r.code);
      if (admCodes.length) {
        const { data: ab } = await supabase
          .from('budget_entries')
          .select('cost_center, budget_amount')
          .eq('company_id', cid)
          .eq('year', year)
          .in('account_code', admCodes)
          .neq('cost_center', 'all');
        setAdminBudgetRows((ab || []).map((r) => ({ cost_center: r.cost_center as string, amount: Number(r.budget_amount) || 0 })));
      } else {
        setAdminBudgetRows([]);
      }
    } catch (err) {
      console.error('Errore year-scoped Personale:', err);
    }
  };

  const reloadAll = async () => {
    if (!COMPANY_ID) return;
    await Promise.all([loadStatic(), loadYearScoped(COMPANY_ID, selectedYear)]);
  };

  // ========== DERIVED ==========
  const activeEmployees = useMemo(() => employees.filter((e) => e.is_active !== false), [employees]);
  const headcountEmployees = useMemo(() => activeEmployees.filter((e) => !isAdminRole(e)), [activeEmployees]);
  const empById = useMemo(() => { const m: Record<string, Employee> = {}; employees.forEach((e) => { m[e.id] = e; }); return m; }, [employees]);
  const isAdminId = (id: string) => { const e = empById[id]; return e ? isAdminRole(e) : false; };

  const allocByEmp = useMemo(() => {
    const m: Record<string, EmployeeOutletAllocation[]> = {};
    allocations.forEach((a) => { (m[a.employee_id] ||= []).push(a); });
    return m;
  }, [allocations]);

  const costForMonth = (empId: string) =>
    costs.find((c) => c.employee_id === empId && c.year === selectedYear && c.month === selectedMonth);

  // Netto mensile (busta paga) per dipendente — null se non caricato (empty-state, non 0 fuorviante)
  const nettoCell = (empId: string): number | null => {
    const c = costForMonth(empId);
    return c && c.netto != null ? Number(c.netto) : null;
  };
  const nettoOf = (empId: string) => Number(nettoCell(empId) || 0);

  // Da cosa e' composto il netto del mese: serve a spiegare un dicembre che vale
  // il doppio, invece di lasciare l'utente a chiedersi se e' un errore.
  const cedoliniDelMese = (empId: string) => slips
    .filter((s) => s.employee_id === empId && s.year === selectedYear && s.month === selectedMonth)
    .sort((a, b) => Number(b.netto || 0) - Number(a.netto || 0));

  // Costo lordo aziendale = somma componenti; null se nessun componente caricato
  const lordoCell = (empId: string): number | null => {
    const c = costForMonth(empId);
    if (!c) return null;
    const parts = [c.retribuzione, c.contributi, c.inail, c.tfr, c.altri_costi];
    if (parts.every((p) => p == null)) return null;
    return parts.reduce<number>((s, p) => s + Number(p || 0), 0);
  };

  // Netto mensile per outlet (via allocazioni, outlet_code == outlet.name).
  // Itera su TUTTI i dipendenti, non solo gli attivi di oggi: il netto pagato a
  // marzo a chi cessa a maggio è comunque un costo di marzo.
  const nettoByOutlet = useMemo(() => {
    const m: Record<string, number> = {};
    employees.forEach((e) => {
      if (isAdminRole(e)) return; // gli amministratori non entrano nei totali outlet
      const netto = nettoOf(e.id);
      if (!netto) return;
      const allocs = allocByEmp[e.id] || [];
      if (allocs.length === 0) return;
      allocs.forEach((a) => {
        const pct = Number(a.allocation_pct || 100) / 100;
        m[a.outlet_code] = (m[a.outlet_code] || 0) + netto * pct;
      });
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, allocByEmp, costs, selectedYear, selectedMonth]);

  // ORGANICO GRANITICO (src/lib/headcount.ts): un dipendente "esiste" per il mese
  // SOLO se ha un cedolino di quel mese. Amministratori esclusi (sezione dedicata),
  // cessati inclusi nei mesi in cui sono stati pagati (la cessazione non riscrive
  // il passato), persone deduplicate per codice fiscale.
  const period = useMemo(() => ({ year: selectedYear, month: selectedMonth }), [selectedYear, selectedMonth]);
  const paidThisMonth = useMemo(
    () => costs.filter((c) => c.year === selectedYear && c.month === selectedMonth && c.netto != null && c.employee_id != null && !isAdminId(c.employee_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [costs, selectedYear, selectedMonth, empById]
  );
  const paidEmpIds = useMemo(() => paidEmployeeIds(costs, employees, period), [costs, employees, period]);
  const isPaid = (empId: string) => paidEmpIds.has(empId);
  // organico del MESE = PERSONE distinte con cedolino
  const organicoAttivo = useMemo(() => companyHeadcount(costs, employees, period), [costs, employees, period]);
  // Ultimo mese con cedolini caricati: default del selettore e etichetta di fallback.
  const lastGranited = useMemo(() => lastGranitedPeriod(costs), [costs]);
  const lastGranitedInYear = useMemo(() => lastGranitedPeriod(costs, selectedYear), [costs, selectedYear]);
  const meseGranito = paidEmpIds.size > 0;

  const headcountByOutlet = useMemo(
    () => headcountByOutletOf(costs, employees, allocations, period),
    [costs, employees, allocations, period]
  );

  // Default granitico: al primo caricamento porta il selettore sull'ultimo mese
  // con cedolini dell'anno scelto, così la pagina non si apre mai vuota.
  useEffect(() => {
    if (monthTouched.current || !lastGranitedInYear) return;
    if (lastGranitedInYear.month !== selectedMonth) setSelectedMonth(lastGranitedInYear.month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastGranitedInYear]);

  const bcByOutlet = (o: OutletRow) => (o.cost_center_key ? bcByCenter[o.cost_center_key] || 0 : 0);

  // KPI
  const totalNettoMese = useMemo(
    () => paidThisMonth.reduce((s, c) => s + Number(c.netto || 0), 0),
    [paidThisMonth]
  );
  const nettoYear = useMemo(
    () => costs.filter((c) => c.year === selectedYear).reduce((s, c) => s + Number(c.netto || 0), 0),
    [costs, selectedYear]
  );
  const totalBC = useMemo(() => Object.values(bcByCenter).reduce((s, v) => s + v, 0), [bcByCenter]);
  // Costo medio/addetto: SOLO dipendenti (67xx) / organico — l'amministratore non è un addetto.
  const costoMedio = organicoAttivo > 0 ? totalBC / organicoAttivo : 0;

  // Chart costo per outlet (B&C) + netto×12 in trasparenza
  // Cost centers non agganciati ad alcun outlet (es. spese_non_divise) → "Non attribuito"
  const outletKeys = useMemo(() => new Set(outlets.map((o) => o.cost_center_key).filter(Boolean)), [outlets]);
  const nonAttribuito = useMemo(
    () => Object.entries(bcByCenter).filter(([k]) => !outletKeys.has(k)).reduce((s, [, v]) => s + v, 0),
    [bcByCenter, outletKeys]
  );

  // Amministratori (role_description='Amministratore', via isAdminRole) e relativo costo lordo annuo.
  const admins = useMemo(() => activeEmployees.filter(isAdminRole), [activeEmployees]);
  const lordoAmministratori = useMemo(
    () => adminBudgetRows.filter((r) => outletKeys.has(r.cost_center)).reduce((s, r) => s + r.amount, 0),
    [adminBudgetRows, outletKeys]
  );
  // Totale budget B&C COMPLETO = dipendenti (67xx) + amministratori → combacia col grafico.
  const totalBCConAmministratori = totalBC + lordoAmministratori;
  // Incidenza personale/ricavi: sui ricavi PREVISTI (budget) e sui ricavi A OGGI annualizzati (consuntivo).
  const incidenzaPrevisti = revenueYear > 0 ? (totalBCConAmministratori / revenueYear) * 100 : null;
  const incidenzaAOggi = revenueConsAnnual > 0 ? (totalBCConAmministratori / revenueConsAnnual) * 100 : null;
  const nettoAmministratoriMese = useMemo(
    () => admins.reduce((s, e) => s + (nettoCell(e.id) || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [admins, costs, selectedYear, selectedMonth]
  );
  // Amministratori del mese (con cedolino) per il "costo medio incluso amministratore".
  const nAdminMese = useMemo(
    () => admins.filter((e) => nettoCell(e.id) != null).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [admins, costs, selectedYear, selectedMonth]
  );
  // Costo medio/addetto: escluso amministratore (solo 67xx / organico) e incluso (67xx+admin / organico+admin).
  const costoMedioEscl = organicoAttivo > 0 ? totalBC / organicoAttivo : null;
  const costoMedioIncl = (organicoAttivo + nAdminMese) > 0 ? totalBCConAmministratori / (organicoAttivo + nAdminMese) : null;

  // Grafico Panoramica: ordine granitico (outlet A-Z → SEDE → Amministratori per ultimi).
  const chartData = useMemo(() => {
    const rows = sortOutlets(outlets).map((o) => ({ name: o.name, bc: bcByOutlet(o), netto: nettoByOutlet[o.name] || 0 }))
      .filter((d) => d.bc > 0 || d.netto > 0);
    if (lordoAmministratori > 0 || nettoAmministratoriMese > 0) {
      rows.push({ name: 'Amministratori', bc: lordoAmministratori, netto: nettoAmministratoriMese });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlets, bcByCenter, nettoByOutlet, lordoAmministratori, nettoAmministratoriMese]);

  // Componenti del mese per conto (da employee_costs)
  const contiMese = useMemo(() => {
    const monthCosts = costs.filter((c) => c.year === selectedYear && c.month === selectedMonth);
    return COSTO_CONTI.map((cc) => ({
      ...cc,
      amount: monthCosts.reduce((s, c) => s + Number((c as any)[cc.field] || 0), 0),
    }));
  }, [costs, selectedYear, selectedMonth]);
  const totaleConti = contiMese.reduce((s, c) => s + c.amount, 0);

  const yearOptions = useMemo(() => {
    const ys = new Set<number>(costs.map((c) => c.year));
    const cur = new Date().getFullYear();
    [cur - 2, cur - 1, cur, cur + 1, selectedYear, globalYear].forEach((y) => ys.add(y));
    return Array.from(ys).sort((a, b) => b - a);
  }, [costs, selectedYear, globalYear]);

  // ========== MUTATIONS ==========
  const mapFormToDb = (formData: any) => {
    const out: any = { ...formData };
    if ('nome' in out) out.first_name = out.nome;
    if ('cognome' in out) out.last_name = out.cognome;
    if ('codice_fiscale' in out) { out.codice_fiscale = out.codice_fiscale || null; out.fiscal_code = out.codice_fiscale; }
    if ('data_assunzione' in out) out.hire_date = out.data_assunzione || null;
    if ('data_cessazione' in out) out.termination_date = out.data_cessazione || null;
    if ('livello' in out) { out.livello = out.livello || null; out.level = out.livello; }
    if ('note' in out) out.notes = out.note || null;
    if ('contratto' in out) { out.contratto_tipo = out.contratto; delete out.contratto; }
    // Qualifica: salva la COLONNA e allinea role_description (la sezione "Amministratori"
    // rileva via role_description ILIKE 'amministrat' — così Gallo resta amministratore).
    if ('qualifica' in out) { out.qualifica = out.qualifica || null; out.role_description = out.qualifica || null; }
    if ('filiale' in out) out.filiale = out.filiale || null;
    if ('outlet_id' in out) out.outlet_id = out.outlet_id || null;
    if ('stato_td' in out) out.stato_td = out.stato_td || null;
    // numerici: '' → null, altrimenti Number
    ['part_time_pct', 'durata_mesi', 'proroghe', 'proroghe_disponibili', 'mesi_disp_senza_causale', 'mesi_disp_con_causale'].forEach((k) => {
      if (k in out) out[k] = (out[k] === '' || out[k] == null) ? null : Number(out[k]);
    });
    // date: '' → null. Data fine resta APERTA finché non c'è cessazione (niente sentinella 9999).
    ['hire_date', 'termination_date', 'data_assunzione', 'data_cessazione', 'scadenza_td'].forEach((k) => { if (out[k] === '') out[k] = null; });
    // Campi "tempo determinato" valgono solo se contratto determinato: altrimenti azzera.
    if (out.contratto_tipo !== 'determinato') {
      ['scadenza_td', 'durata_mesi', 'proroghe', 'proroghe_disponibili', 'mesi_disp_senza_causale', 'mesi_disp_con_causale', 'stato_td'].forEach((k) => { out[k] = null; });
    }
    return out;
  };

  const handleSaveEmployee = async (formData: any) => {
    if (!formData.nome?.trim() || !formData.cognome?.trim()) { toast({ type: 'error', message: 'Nome e cognome sono obbligatori' }); return; }
    if (!formData.data_assunzione) { toast({ type: 'error', message: 'La data di inizio contratto è obbligatoria' }); return; }
    if (!COMPANY_ID) return;
    // La matricola identifica la persona nel software paghe: una sola per azienda.
    // Il vincolo vero e' sul database (indice unico company_id + matricola), qui
    // lo si dice prima e col nome di chi la sta gia' usando. Mai in silenzio.
    const matricolaIns = String(formData.matricola || '').trim();
    if (matricolaIns) {
      const clash = employees.find((e) => norm(e.matricola) === norm(matricolaIns) && e.id !== editingEmployee?.id);
      if (clash) {
        setConfirmState({
          title: 'Matricola già in uso',
          message: <>La matricola <strong>{matricolaIns}</strong> è già assegnata a <strong>{empName(clash)}</strong>. Due persone non possono avere la stessa matricola: correggi il numero, oppure apri la scheda di {empName(clash)} se si tratta della stessa persona.</>,
          confirmLabel: 'Ho capito',
          onConfirm: () => setConfirmState(null),
        });
        return;
      }
    }
    const doSave = async () => {
      try {
        const dbPayload = mapFormToDb(formData);
        if (editingEmployee) {
          const { error } = await supabase.from('employees').update(dbPayload).eq('id', editingEmployee.id);
          if (error) throw error;
          toast({ type: 'success', message: 'Dipendente aggiornato' });
        } else {
          const { error } = await supabase.from('employees').insert([{ ...dbPayload, company_id: COMPANY_ID, is_active: true }]);
          if (error) throw error;
          toast({ type: 'success', message: 'Dipendente creato. Assegnagli un outlet (icona %) per vederlo nei consuntivi.' });
        }
        setShowEmployeeForm(false); setEditingEmployee(null);
        await reloadAll();
      } catch (err: any) {
        const dupMatricola = err?.code === '23505' && /matricola/i.test(err?.message || '');
        toast({ type: 'error', message: dupMatricola
          ? `La matricola ${matricolaIns} è già usata da un'altra persona di questa azienda: correggila prima di salvare.`
          : 'Errore nel salvataggio: ' + readableDbError(err) });
      }
    };
    if (!editingEmployee) {
      const dup = employees.find((e) => norm(e.cognome) === norm(formData.cognome) && norm(e.nome) === norm(formData.nome));
      if (dup) {
        setConfirmState({
          title: 'Dipendente già esistente',
          message: `"${formData.cognome} ${formData.nome}" risulta già presente. Vuoi crearlo comunque?`,
          confirmLabel: 'Crea comunque',
          onConfirm: () => { setConfirmState(null); doSave(); },
        });
        return;
      }
    }
    await doSave();
  };

  // Cessazione: NON cancella il record — is_active=false + data di cessazione (storico preservato).
  const openCessa = (e: Employee) => {
    setCessaEmp(e);
    setCessaDate(new Date().toISOString().split('T')[0]);
  };
  const handleCessa = async () => {
    if (!cessaEmp) return;
    if (!cessaDate) { toast({ type: 'error', message: 'Indica la data di cessazione' }); return; }
    const { error } = await supabase.from('employees')
      .update({ is_active: false, data_cessazione: cessaDate, termination_date: cessaDate })
      .eq('id', cessaEmp.id);
    if (error) { toast({ type: 'error', message: 'Errore nella cessazione: ' + error.message }); return; }
    toast({ type: 'success', message: 'Dipendente cessato (resta in archivio)' });
    setCessaEmp(null); setCessaDate('');
    await reloadAll();
  };
  // Riattivazione di un cessato.
  const handleRiattiva = (e: Employee) => {
    setConfirmState({
      title: 'Riattiva dipendente',
      message: `Vuoi riportare "${empName(e)}" tra gli attivi? La data di cessazione verrà azzerata.`,
      confirmLabel: 'Riattiva',
      onConfirm: async () => {
        setConfirmState(null);
        const { error } = await supabase.from('employees').update({ is_active: true, data_cessazione: null, termination_date: null }).eq('id', e.id);
        if (error) { toast({ type: 'error', message: 'Errore' }); return; }
        toast({ type: 'success', message: 'Dipendente riattivato' });
        await reloadAll();
      },
    });
  };

  // Salvataggio costo — SOLO colonne reali (niente totale_costo). Total calcolato a runtime.
  const handleSaveCost = async (payload: {
    employee_id: string; year: number; month: number;
    retribuzione: number; contributi: number; inail: number; tfr: number; altri_costi: number; netto: number;
  }) => {
    if (!COMPANY_ID) return;
    if (!payload.employee_id) { toast({ type: 'error', message: 'Seleziona un dipendente' }); return; }
    try {
      // Il mese puo' essere composto da piu' cedolini. La correzione a mano non
      // li cancella: diventa un cedolino «manuale» che vale come totale del mese,
      // e gli altri restano come storico (migration 161).
      const realCols = {
        employee_id: payload.employee_id,
        company_id: COMPANY_ID,
        year: payload.year,
        month: payload.month,
        tipo: 'manuale',
        retribuzione: payload.retribuzione,
        contributi: payload.contributi,
        inail: payload.inail,
        tfr: payload.tfr,
        altri_costi: payload.altri_costi,
        netto: payload.netto,
        source: 'manuale',
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('employee_cost_slips').upsert(realCols, { onConflict: 'company_id,employee_id,year,month,tipo' });
      if (error) throw error;
      const { count: nAltri } = await supabase.from('employee_cost_slips')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', COMPANY_ID).eq('employee_id', payload.employee_id)
        .eq('year', payload.year).eq('month', payload.month).neq('tipo', 'manuale');
      toast({ type: 'success', message: nAltri
        ? `Costo salvato. Il mese aveva ${nAltri} cedolin${nAltri === 1 ? 'o' : 'i'} caricat${nAltri === 1 ? 'o' : 'i'}: restano come storico, ma il totale del mese è ora il valore che hai scritto.`
        : 'Costo salvato' });
      setShowCostForm(false); setEditingCost(null); setCostFormEmp(null);
      await reloadAll();
    } catch (err: any) {
      toast({ type: 'error', message: 'Errore nel salvataggio costo: ' + (err?.message || '') });
    }
  };

  const handleDeleteCost = (costId: string) => {
    setConfirmState({
      title: 'Elimina costo',
      message: 'Vuoi eliminare questa riga di costo mensile?',
      confirmLabel: 'Elimina', danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        const { error } = await supabase.from('employee_costs').delete().eq('id', costId);
        if (error) { toast({ type: 'error', message: 'Errore' }); return; }
        toast({ type: 'success', message: 'Costo eliminato' });
        await reloadAll();
      },
    });
  };

  // Allocazioni
  const openAllocEditor = (empId: string) => {
    const cur = (allocByEmp[empId] || []).map((a) => ({ outlet_code: a.outlet_code, allocation_pct: Number(a.allocation_pct || 0) }));
    setAllocEdits(cur.length ? cur : [{ outlet_code: '', allocation_pct: 100 }]);
    setAllocErrors('');
    setShowAllocEditor(empId);
  };

  const handleSaveAllocations = async () => {
    if (!COMPANY_ID || !showAllocEditor) return;
    const total = allocEdits.reduce((s, a) => s + (Number(a.allocation_pct) || 0), 0);
    if (total > 100.01) { setAllocErrors(`Le allocazioni sommano ${total.toFixed(1)}% — il massimo è 100%`); return; }
    if (allocEdits.some((a) => !a.outlet_code)) { setAllocErrors('Seleziona un outlet per ogni riga'); return; }
    try {
      const empId = showAllocEditor;
      await supabase.from('employee_outlet_allocations').delete().eq('employee_id', empId);
      const rows = allocEdits
        .filter((a) => a.outlet_code && Number(a.allocation_pct) > 0)
        .map((a) => ({ employee_id: empId, company_id: COMPANY_ID, outlet_code: a.outlet_code, allocation_pct: Number(a.allocation_pct) || 0 }));
      if (rows.length) {
        const { error } = await supabase.from('employee_outlet_allocations').insert(rows);
        if (error) throw error;
      }
      setShowAllocEditor(null);
      toast({ type: 'success', message: 'Allocazioni salvate' });
      await reloadAll();
    } catch (err: any) {
      setAllocErrors('Errore nel salvataggio: ' + (err?.message || ''));
    }
  };

  // Cedolino upload/view
  const triggerCedolino = (empId: string) => { cedolinoEmpRef.current = empId; cedolinoRef.current?.click(); };
  const onCedolinoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const empId = cedolinoEmpRef.current;
    if (!file || !empId || !COMPANY_ID) return;
    try {
      setUploadingEmployee(empId);
      const ext = file.name.split('.').pop();
      const path = `employee-documents/${empId}_${selectedYear}_${selectedMonth}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('employee-documents').upload(path, file);
      if (upErr) throw upErr;
      const { error: docErr } = await supabase.from('employee_documents').insert([{
        employee_id: empId, company_id: COMPANY_ID, doc_type: 'cedolino', year: selectedYear, month: selectedMonth,
        file_name: file.name, file_path: path, file_size: file.size, status: 'uploaded',
      }]);
      if (docErr) throw docErr;
      toast({ type: 'success', message: 'Cedolino caricato' });
      await reloadAll();
    } catch (err: any) {
      toast({ type: 'error', message: 'Errore upload cedolino: ' + (err?.message || '') });
    } finally {
      setUploadingEmployee(null);
      if (cedolinoRef.current) cedolinoRef.current.value = '';
    }
  };

  const handleViewDoc = async (doc: EmployeeDocument) => {
    try {
      if (!doc.file_path) return;
      const { data, error } = await supabase.storage.from('employee-documents').download(doc.file_path);
      if (error) throw error;
      setDocPdfData(await data.arrayBuffer());
      setShowDocViewer(doc);
    } catch (err) {
      toast({ type: 'error', message: 'Impossibile aprire il documento' });
    }
  };
  const docsForEmp = (empId: string) => employeeDocs.filter((d) => d.employee_id === empId);

  // ========== EMPTY / LOADING ==========
  if (!COMPANY_ID) {
    return <div className="p-8 text-slate-500">Nessuna azienda selezionata.</div>;
  }

  const monthLabel = MONTHS.find((m) => m.num === selectedMonth)?.label || '';

  // ========== RENDER ==========
  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Dipendenti"
        subtitle={`Organico e costo del personale per outlet${companyName ? ` · ${companyName}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white">
              {yearOptions.map((y) => <option key={y} value={y}>Anno {y}</option>)}
            </select>
            <select value={selectedMonth} onChange={(e) => pickMonth(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white">
              {MONTHS.map((m) => <option key={m.num} value={m.num}>{m.label}</option>)}
            </select>
            <button onClick={() => { setEditingEmployee(null); setShowEmployeeForm(true); }} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-1.5"><Plus size={15} /> Dipendente</button>
            <button onClick={reloadAll} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" title="Ricarica"><RefreshCw size={16} /></button>
          </div>
        }
      />

      {/* Sub-tab pill */}
      <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
        {([
          { k: 'panoramica', label: 'Panoramica', icon: BarChart3 },
          { k: 'per_outlet', label: 'Per outlet', icon: Store },
          { k: 'organico', label: 'Organico', icon: Users },
          { k: 'costi', label: 'Costi & cedolini', icon: FileText },
          { k: 'lordi', label: 'Costo lordo', icon: Percent },
        ] as { k: PersonaleView; label: string; icon: any }[]).map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.k} onClick={() => setView(t.k)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${view === t.k ? 'bg-white shadow text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icon size={15} />{t.label}
            </button>
          );
        })}
      </div>

      {/* Mese senza cedolini: il numero NON è zero, è "non ancora caricato".
          Si dichiara l'ultimo mese granito e si offre il salto. */}
      {!loading && !meseGranito && (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5">
          <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <strong>Nessun cedolino caricato per {monthLabel} {selectedYear}.</strong>{' '}
            {lastGranited
              ? <>L'organico non è zero: è non ancora caricato. Ultimo mese granito: <strong>{periodLabel(lastGranited)}</strong>.{' '}
                  <button
                    onClick={() => { monthTouched.current = true; setSelectedYear(lastGranited.year); setSelectedMonth(lastGranited.month); }}
                    className="underline font-semibold hover:text-amber-700"
                  >Vai a {periodLabel(lastGranited)}</button>
                </>
              : <>Carica i netti dalla scheda «Costi &amp; cedolini»: è il carico che rende granitico l'organico del mese.</>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-slate-400 py-12 text-center">Caricamento…</div>
      ) : (
        <>
          {view === 'panoramica' && (
            <PanoramicaTab
              headcount={organicoAttivo}
              sedi={outlets.length}
              totalBC={totalBC}
              totalBCAll={totalBCConAmministratori}
              totalNettoMese={totalNettoMese}
              nettoYear={nettoYear}
              incidenzaPrevisti={incidenzaPrevisti}
              incidenzaAOggi={incidenzaAOggi}
              consMesi={consMesi}
              costoMedioEscl={costoMedioEscl}
              costoMedioIncl={costoMedioIncl}
              monthLabel={monthLabel}
              month={selectedMonth}
              chartData={chartData}
              bilancioPersonale={bilancioPersonale}
              nonAttribuito={nonAttribuito}
              year={selectedYear}
            />
          )}

          {view === 'per_outlet' && (
            <PerOutletTab
              outlets={outlets}
              allEmployees={employees}
              allocByEmp={allocByEmp}
              nettoOf={nettoOf}
              nettoCell={nettoCell}
              isPaid={isPaid}
              admins={admins}
              lordoAmministratori={lordoAmministratori}
              nettoByOutlet={nettoByOutlet}
              headcountByOutlet={headcountByOutlet}
              bcByOutlet={bcByOutlet}
              monthLabel={monthLabel}
              mm={String(selectedMonth).padStart(2, '0')}
              year={selectedYear}
              nonAttribuito={nonAttribuito}
            />
          )}

          {view === 'organico' && (
            <OrganicoTab
              employees={employees}
              allocByEmp={allocByEmp}
              nettoCell={nettoCell}
              lordoCell={lordoCell}
              isPaid={isPaid}
              lordoAmministratori={lordoAmministratori}
              outlets={outlets}
              mm={String(selectedMonth).padStart(2, '0')}
              year={selectedYear}
              status={orgStatus}
              setStatus={setOrgStatus}
              outletFilter={orgOutletFilter}
              setOutletFilter={setOrgOutletFilter}
              search={orgSearch}
              setSearch={setOrgSearch}
              onAdd={() => { setEditingEmployee(null); setShowEmployeeForm(true); }}
              onEdit={(e) => { setEditingEmployee(e); setShowEmployeeForm(true); }}
              onAlloc={openAllocEditor}
              onCedolino={triggerCedolino}
              onCessa={openCessa}
              onRiattiva={handleRiattiva}
              onScheda={(e) => setSchedaEmp(e)}
              docsForEmp={docsForEmp}
              uploadingEmployee={uploadingEmployee}
            />
          )}

          {view === 'costi' && (
            <CostiTab
              contiMese={contiMese}
              totaleConti={totaleConti}
              totalNettoMese={totalNettoMese}
              monthLabel={monthLabel}
              mm={String(selectedMonth).padStart(2, '0')}
              year={selectedYear}
              employees={employees}
              allocByEmp={allocByEmp}
              outlets={outlets}
              isPaid={isPaid}
              nettoCell={nettoCell}
              cedoliniDelMese={cedoliniDelMese}
              admins={admins}
              lordoAmministratori={lordoAmministratori}
              costForMonth={costForMonth}
              docsForEmp={docsForEmp}
              onAddCost={(empId) => { setEditingCost(costForMonth(empId) || null); setCostFormEmp(empId); setShowCostForm(true); }}
              onEditCost={(c) => { setEditingCost(c); setCostFormEmp(c.employee_id); setShowCostForm(true); }}
              onDeleteCost={handleDeleteCost}
              onCedolino={triggerCedolino}
              onViewDoc={handleViewDoc}
              uploadingEmployee={uploadingEmployee}
              importPanel={
                <div className="space-y-5">
                  <ImportLane
                    mode="netto"
                    companyId={COMPANY_ID}
                    userId={USER_ID}
                    outlets={outlets}
                    employees={employees}
                    existingCosts={costs}
                    defaultYear={selectedYear}
                    defaultMonth={selectedMonth}
                    onDone={reloadAll}
                  />
                  {/* La corsia «costi lordi» viveva qui ed era un doppione: lo
                      stesso numero (costo aziendale per persona e per mese) si
                      carica dalla scheda «Costo lordo», da un documento preciso
                      («Statistica costo orario») e con la sua formula. Due strade
                      per lo stesso dato significano due verita' diverse, quindi
                      resta una sola porta e qui c'e' l'indicazione di dov'e'.
                      Il componente ImportLane sa ancora fare mode="lordi": e' la
                      porta a essere chiusa, non la capacita' a essere stata tolta. */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
                    <Percent size={18} className="text-slate-400 mt-0.5 shrink-0" />
                    <div className="text-sm text-slate-600">
                      <div className="font-semibold text-slate-800 mb-0.5">I costi lordi si caricano dalla scheda «Costo lordo»</div>
                      Il costo aziendale per persona (retribuzione + contributi + INAIL + TFR) arriva
                      dalla «Statistica costo orario» del software paghe. Qui si caricano solo i netti,
                      così lo stesso numero ha una sola fonte.
                      <button onClick={() => setView('lordi')} className="ml-1 text-blue-600 hover:text-blue-700 font-medium underline underline-offset-2">
                        Vai a «Costo lordo»
                      </button>
                    </div>
                  </div>
                </div>
              }
            />
          )}

          {view === 'lordi' && (
            <CostiLordoTab
              companyId={COMPANY_ID}
              userId={USER_ID}
              outlets={outlets}
              year={selectedYear}
              month={selectedMonth}
              monthLabel={monthLabel}
            />
          )}
        </>
      )}

      {/* Hidden cedolino input */}
      <input ref={cedolinoRef} type="file" accept=".pdf" className="hidden" onChange={onCedolinoSelected} />

      {/* Modals */}
      {showEmployeeForm && (
        <EmployeeFormModal
          initial={editingEmployee}
          outlets={outlets}
          onCancel={() => { setShowEmployeeForm(false); setEditingEmployee(null); }}
          onSave={handleSaveEmployee}
        />
      )}

      {showCostForm && (
        <CostFormModal
          initial={editingCost}
          employeeId={costFormEmp}
          employees={employees}
          year={selectedYear}
          month={selectedMonth}
          onCancel={() => { setShowCostForm(false); setEditingCost(null); setCostFormEmp(null); }}
          onSave={handleSaveCost}
        />
      )}

      {showAllocEditor && (
        <Modal title="Allocazione per outlet" onClose={() => setShowAllocEditor(null)}>
          <div className="space-y-3">
            {allocEdits.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={a.outlet_code} onChange={(e) => setAllocEdits((prev) => prev.map((x, j) => j === i ? { ...x, outlet_code: e.target.value } : x))}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200">
                  <option value="">— outlet —</option>
                  {outlets.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
                </select>
                <div className="relative w-28">
                  <input type="number" value={a.allocation_pct} min={0} max={100}
                    onChange={(e) => setAllocEdits((prev) => prev.map((x, j) => j === i ? { ...x, allocation_pct: Number(e.target.value) } : x))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 pr-7 tabular-nums" />
                  <Percent size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
                <button onClick={() => setAllocEdits((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" title="Rimuovi outlet"><Trash2 size={16} /></button>
              </div>
            ))}
            <button onClick={() => setAllocEdits((prev) => [...prev, { outlet_code: '', allocation_pct: 0 }])} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Aggiungi outlet</button>
            {allocErrors && <div className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} />{allocErrors}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAllocEditor(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Annulla</button>
              <button onClick={handleSaveAllocations} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5"><Save size={15} /> Salva</button>
            </div>
          </div>
        </Modal>
      )}

      {showDocViewer && (
        <Modal title={showDocViewer.file_name || 'Documento'} onClose={() => { setShowDocViewer(null); setDocPdfData(null); }} maxW="max-w-3xl">
          <Suspense fallback={<div className="text-slate-400 py-8 text-center">Caricamento documento…</div>}>
            <PdfViewer pdfData={docPdfData} />
          </Suspense>
        </Modal>
      )}

      {cessaEmp && (
        <Modal title="Cessazione dipendente" onClose={() => { setCessaEmp(null); setCessaDate(''); }} maxW="max-w-md">
          <p className="text-sm text-slate-600 mb-4">
            Cessazione di <strong>{empName(cessaEmp)}</strong>. Il record <strong>non viene cancellato</strong>: resta in archivio tra i “Cessati” con la data indicata.
          </p>
          <Field label="Data di cessazione *">
            <input type="date" value={cessaDate} onChange={(e) => setCessaDate(e.target.value)} className="inp" />
          </Field>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => { setCessaEmp(null); setCessaDate(''); }} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Annulla</button>
            <button onClick={handleCessa} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700">Conferma cessazione</button>
          </div>
          <style>{`.inp{width:100%;padding:0.5rem 0.75rem;font-size:0.875rem;border-radius:0.5rem;border:1px solid rgb(226 232 240)}`}</style>
        </Modal>
      )}

      {schedaEmp && (
        <SchedaDipendenteModal
          employee={schedaEmp}
          year={selectedYear}
          costs={costs}
          allocs={allocByEmp[schedaEmp.id] || []}
          outlets={outlets}
          companyId={COMPANY_ID}
          onClose={() => setSchedaEmp(null)}
          onSaved={reloadAll}
          onEdit={() => { setEditingEmployee(schedaEmp); setSchedaEmp(null); setShowEmployeeForm(true); }}
        />
      )}

      <ConfirmModal
        open={!!confirmState}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmLabel={confirmState?.confirmLabel}
        danger={confirmState?.danger}
        onConfirm={() => confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}

// ============================================================================
// TAB 1 — PANORAMICA
// ============================================================================
function PanoramicaTab(props: {
  headcount: number; sedi: number; totalBC: number; totalBCAll: number; totalNettoMese: number; nettoYear: number;
  incidenzaPrevisti: number | null; incidenzaAOggi: number | null; consMesi: number; costoMedioEscl: number | null; costoMedioIncl: number | null; monthLabel: string; month: number;
  chartData: { name: string; bc: number; netto: number }[];
  bilancioPersonale: number | null; nonAttribuito: number; year: number;
}) {
  const { headcount, sedi, totalBC, totalBCAll, totalNettoMese, nettoYear, incidenzaPrevisti, incidenzaAOggi, consMesi, costoMedioEscl, costoMedioIncl, monthLabel, month, chartData, bilancioPersonale, nonAttribuito, year } = props;
  const pct = (v: number | null) => (v != null ? `${v.toFixed(1).replace('.', ',')}%` : '—');
  const empty = headcount === 0 && totalBC === 0 && totalNettoMese === 0;
  const mm = String(month).padStart(2, '0');
  const avgPerOutlet = sedi > 0 ? (headcount / sedi).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
  const maxVal = Math.max(1, ...chartData.map((d) => Math.max(d.bc, d.netto)));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi label="Organico attivo" value={headcount} sub={`cedolini ${mm}/${year} · su ${sedi} sedi`} icon={Users} source="neutro" />
        <Kpi label="Costo personale" value={`${eurFmt.format(totalBCAll)} €`} sub="budget annuo · incl. amministratori" icon={BarChart3} source="bc" />
        <Kpi label="Netto mensile totale" value={`${eurFmt.format(totalNettoMese)} €`} sub={`bonifici stipendi · da cedolini ${mm}/${year}`} icon={FileText} source="netto" />
        <Kpi
          label="Costo medio / addetto"
          value={costoMedioEscl != null ? `${eurFmt.format(costoMedioEscl)} €` : '—'}
          sub={<>
            <div>escluso amministratore</div>
            <div className="text-[11px] text-slate-400 mt-0.5">incl. amministratore: {costoMedioIncl != null ? `${eurFmt.format(costoMedioIncl)} €` : '—'}</div>
          </>}
          icon={Users}
          source="bc"
        />
        <Kpi
          label="Incidenza su ricavi"
          value={pct(incidenzaPrevisti)}
          sub={<>
            <div>su ricavi previsti {year}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">a oggi (consuntivo {consMesi}m ann.): {pct(incidenzaAOggi)}</div>
          </>}
          icon={Percent}
          source="neutro"
        />
      </div>

      {empty ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
          Nessun dato di personale per il {year}. Importa i netti mensili dalla tab “Costi &amp; cedolini”.
        </div>
      ) : (
        <>
          {/* Costo per outlet — barre orizzontali, una per outlet col suo colore */}
          <div className="bg-white rounded-2xl shadow-lg p-5">
            <div className="flex items-baseline justify-between mb-5">
              <h3 className="font-semibold text-slate-900">Costo personale per outlet — {year}</h3>
              <span className="text-xs text-slate-400">costo budget annuo (B&amp;C) vs netto del mese {mm}/{year}</span>
            </div>
            {chartData.length === 0 ? (
              <div className="text-sm text-slate-400 py-8 text-center">Nessun costo per outlet disponibile.</div>
            ) : (
              <div className="space-y-4">
                {chartData.map((d) => (
                  <div key={d.name} className="flex items-center gap-3">
                    <div className="w-28 shrink-0 text-sm text-slate-600 truncate" title={d.name}>{d.name}</div>
                    <div className="flex-1 space-y-1">
                      {/* Costo budget (viola) — tutte le barre stesso colore e stessa forma */}
                      <div className="h-3.5 rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${(d.bc / maxVal) * 100}%`, background: '#ea580c' }} />
                      </div>
                      {/* Netto del mese (blu) — valore così com'è, mai ×12 */}
                      <div className="h-3.5 rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${(d.netto / maxVal) * 100}%`, background: '#16a34a' }} />
                      </div>
                    </div>
                    <div className="w-44 shrink-0 text-right text-sm tabular-nums leading-tight">
                      <div className="font-semibold" style={{ color: '#ea580c' }}>{d.bc ? <>{eurFmt.format(d.bc)}&nbsp;€</> : <span className="text-slate-300">—</span>}</div>
                      <div className="text-xs" style={{ color: '#16a34a' }}>{d.netto ? <>{eurFmt.format(d.netto)}&nbsp;€</> : <span className="text-slate-300">—</span>}</div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-4 pt-3 mt-1 border-t border-slate-100 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#ea580c' }} /> Costo budget annuo (B&amp;C)</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#16a34a' }} /> Netto del mese</span>
                </div>
              </div>
            )}
          </div>

          {/* Quadratura */}
          <div className="bg-white rounded-2xl shadow-lg p-5">
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2"><span aria-hidden>🔍</span> Quadratura del personale</h3>
              <span className="text-xs text-slate-400">spia di controllo — le tre fonti devono avvicinarsi</span>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch gap-3">
              <QuadCard label={`Netto anno ${year}`} value={nettoYear} sub="somma mensilità importate (no ×12)" color="#16a34a" />
              <div className="flex items-center justify-center text-xs font-semibold text-slate-300">VS</div>
              <QuadCard label="Costo budget B&C" value={totalBCAll} sub="67xx + amministratori" color="#ea580c" />
              <div className="flex items-center justify-center text-xs font-semibold text-slate-300">VS</div>
              <QuadCard label={`Costo bilancio ${year}`} value={bilancioPersonale ?? 0} sub={bilancioPersonale == null ? 'non disponibile' : 'consuntivo depositato'} muted={bilancioPersonale == null} />
            </div>
            <div className="mt-4 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3 leading-relaxed">
              Il “Netto anno” è la <strong>somma dei netti dei mesi effettivamente caricati</strong> (13ª e 14ª comprese nel mese in cui vengono erogate) — mai una stima mese×12. Più mesi importi, più la quadratura diventa attendibile.
            </div>
            {nonAttribuito > 0 && (
              <div className="mt-3 text-xs text-slate-500 flex items-center gap-1.5">
                <AlertCircle size={13} /> Costi non attribuiti ad alcun outlet: <Money v={nonAttribuito} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function QuadCard({ label, value, sub, muted = false, color }: { label: string; value: number; sub: string; muted?: boolean; color?: string }) {
  return (
    <div className="flex-1 rounded-xl border border-slate-200 p-4 text-center" style={{ background: '#f8fafc' }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: muted ? '#0f172a' : (color || '#0f172a') }}>{eurFmt.format(value)}&nbsp;€</div>
      <div className="text-[11px] text-slate-400 mt-1">{sub}</div>
    </div>
  );
}

// ============================================================================
// TAB 2 — PER OUTLET
// ============================================================================
function PerOutletTab(props: {
  outlets: OutletRow[];
  allEmployees: Employee[];
  allocByEmp: Record<string, EmployeeOutletAllocation[]>;
  nettoOf: (id: string) => number;
  nettoCell: (id: string) => number | null;
  isPaid: (id: string) => boolean;
  admins: Employee[];
  lordoAmministratori: number;
  nettoByOutlet: Record<string, number>;
  headcountByOutlet: Record<string, Set<string>>;
  bcByOutlet: (o: OutletRow) => number;
  monthLabel: string;
  mm: string;
  year: number;
  nonAttribuito: number;
}) {
  const { outlets, allEmployees, allocByEmp, nettoOf, nettoCell, isPaid, admins, lordoAmministratori, nettoByOutlet, headcountByOutlet, bcByOutlet, mm, year, nonAttribuito } = props;
  if (outlets.length === 0) {
    return <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">Nessun outlet configurato per questo tenant.</div>;
  }
  const totHc = new Set<string>();
  Object.values(headcountByOutlet).forEach((s) => s.forEach((id) => totHc.add(id)));
  return (
    <div className="space-y-3.5">
      <div className="text-xs sm:text-[13px] text-blue-900 bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex items-start gap-2.5">
        <Store size={16} className="text-blue-600 mt-0.5 shrink-0" />
        <div><strong>{totHc.size} dipendenti su {outlets.length} sedi.</strong> Ogni persona è su una sola sede (ripartizione payroll secca). I punti vendita sono outlet veri; la sede operativa (magazzino + direzione) è trattata come location di primo livello, non come “orfana”.</div>
      </div>

      {sortOutlets(outlets).map((o) => {
        const color = getOutletColor(o.name);
        const isSede = o.cost_center_key === 'sede_magazzino';
        // NO-ZERO: solo chi ha il cedolino del mese viene elencato (amministratori esclusi: sezione dedicata)
        const persone = allEmployees.filter((e) => isPaid(e.id) && (allocByEmp[e.id] || []).some((a) => a.outlet_code === o.name));
        return (
          <div key={o.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white shrink-0" style={{ background: color.main }}><Store size={18} /></div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-800 flex items-center gap-2 truncate">
                  {o.name}
                  {isSede && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0">sede — no outlet</span>}
                </div>
                <div className="text-xs text-slate-500">{(headcountByOutlet[o.name]?.size || 0)} dipendenti · netto {eurFmt.format(nettoByOutlet[o.name] || 0)} €/mese</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-extrabold tabular-nums" style={{ color: color.main }}>{eurFmt.format(bcByOutlet(o))}&nbsp;€</div>
                <div className="text-xs text-slate-500">costo annuo (B&amp;C)</div>
              </div>
            </div>
            <div className="border-t border-slate-200 px-2 pb-2">
              {persone.length === 0 ? (
                <div className="text-xs text-slate-400 px-2 py-3">Nessun cedolino caricato per {mm}/{year}.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2 text-left font-semibold">Dipendente</th>
                      <th className="px-3 py-2 text-right font-semibold">Netto {mm}/{year}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {persone.map((e) => (
                      <tr key={e.id} className="border-t border-slate-50">
                        <td className="px-3 py-2 text-slate-700">
                          {empName(e)}
                          {isAdminRole(e) && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">amministratore</span>}
                        </td>
                        <td className="px-3 py-2 text-right"><Money v={nettoOf(e.id)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
      })}

      {nonAttribuito > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-[10px] bg-slate-300 flex items-center justify-center text-white shrink-0"><Store size={18} /></div>
          <div className="flex-1">
            <div className="font-bold text-slate-600">Non attribuito</div>
            <div className="text-xs text-slate-400">Centri di costo non agganciati a un punto vendita (es. spese da ripartire).</div>
          </div>
          <div className="text-right"><div className="font-extrabold tabular-nums text-slate-600">{eurFmt.format(nonAttribuito)}&nbsp;€</div><div className="text-xs text-slate-500">costo annuo (B&amp;C)</div></div>
        </div>
      )}

      <AmministratoriAccordion admins={admins} nettoCell={nettoCell} lordoTot={lordoAmministratori} mm={mm} year={year} />
    </div>
  );
}

// ============================================================================
// TAB 3 — ORGANICO
// ============================================================================
function OrganicoTab(props: {
  employees: Employee[];
  allocByEmp: Record<string, EmployeeOutletAllocation[]>;
  nettoCell: (id: string) => number | null;
  lordoCell: (id: string) => number | null;
  isPaid: (id: string) => boolean;
  lordoAmministratori: number;
  outlets: OutletRow[];
  mm: string; year: number;
  status: 'attivi' | 'cessati' | 'tutti'; setStatus: (s: 'attivi' | 'cessati' | 'tutti') => void;
  outletFilter: string; setOutletFilter: (s: string) => void;
  search: string; setSearch: (s: string) => void;
  onAdd: () => void;
  onEdit: (e: Employee) => void;
  onAlloc: (id: string) => void;
  onCedolino: (id: string) => void;
  onCessa: (e: Employee) => void;
  onRiattiva: (e: Employee) => void;
  onScheda: (e: Employee) => void;
  docsForEmp: (id: string) => EmployeeDocument[];
  uploadingEmployee: string | null;
}) {
  const { employees, allocByEmp, nettoCell, lordoCell, isPaid, lordoAmministratori, outlets, mm, year, status, setStatus, outletFilter, setOutletFilter, search, setSearch, onAdd, onEdit, onAlloc, onCedolino, onCessa, onRiattiva, onScheda, docsForEmp, uploadingEmployee } = props;
  const filtered = employees.filter((e) => {
    const active = e.is_active !== false;
    if (status === 'attivi' && !active) return false;
    if (status === 'cessati' && active) return false;
    if (search && !empName(e).toLowerCase().includes(search.toLowerCase()) && !(e.matricola || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (outletFilter && !(allocByEmp[e.id] || []).some((a) => a.outlet_code === outletFilter)) return false;
    return true;
  });
  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('it-IT') : '');
  const STATUS: { k: 'attivi' | 'cessati' | 'tutti'; label: string }[] = [
    { k: 'attivi', label: 'Attivi' }, { k: 'cessati', label: 'Cessati' }, { k: 'tutti', label: 'Tutti' },
  ];

  // Amministratori a parte (sezione in fondo); gli altri raggruppati per sede.
  const adminRows = filtered.filter(isAdminRole);
  const groups: Record<string, Employee[]> = {};
  filtered.filter((e) => !isAdminRole(e)).forEach((e) => { const k = primaryOutlet(allocByEmp[e.id] || []); (groups[k] ||= []).push(e); });
  const orderedNames = sortGroupNames(Object.keys(groups), outlets);

  const renderRow = (e: Employee) => {
    const allocs = allocByEmp[e.id] || [];
    const docs = docsForEmp(e.id);
    const netto = nettoCell(e.id);
    const lordo = lordoCell(e.id);
    const cessato = e.is_active === false;
    const inizio = e.data_assunzione || e.hire_date;
    const fine = e.data_cessazione || e.termination_date;
    return (
      <tr key={e.id} className={`border-b border-slate-100 hover:bg-slate-50 ${cessato ? 'opacity-60' : ''}`}>
        <td className="px-4 py-2.5 text-slate-500 tabular-nums">{e.matricola || '—'}</td>
        <td className="px-4 py-2.5">
          <button onClick={() => onScheda(e)} className="font-semibold text-slate-800 hover:text-blue-700 hover:underline text-left" title="Apri scheda dipendente">{empName(e)}</button>
          {isAdminRole(e) && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">amministratore</span>}
          {cessato && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">cessato</span>}
        </td>
        <td className="px-4 py-2.5 text-slate-500">
          <div>{e.contratto_tipo || e.contract_type || 'da definire'}</div>
          <div className="text-[11px] text-slate-400">{inizio ? `dal ${fmtDate(inizio)}` : ''}{cessato && fine ? ` · al ${fmtDate(fine)}` : ''}</div>
        </td>
        <td className="px-4 py-2.5 text-right">{netto == null ? <span className="text-slate-300">—</span> : <Money v={netto} />}</td>
        <td className="px-4 py-2.5 text-right">{lordo == null ? <span className="text-slate-300">—</span> : <Money v={lordo} />}</td>
        <td className="px-4 py-2.5 text-center">
          <button onClick={() => onCedolino(e.id)} disabled={uploadingEmployee === e.id} className="text-slate-400 hover:text-emerald-600 inline-flex items-center gap-1 relative" title="Carica cedolino">
            <Upload size={15} />
            {docs.length > 0 && <span className="absolute -top-1 -right-2 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white text-[8px] flex items-center justify-center">{docs.length}</span>}
          </button>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center justify-center gap-1.5">
            <button onClick={() => onScheda(e)} className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50" title="Scheda dipendente"><FileText size={15} /></button>
            <button onClick={() => onEdit(e)} className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50" title="Modifica"><Edit2 size={15} /></button>
            <button onClick={() => onAlloc(e.id)} className="p-1.5 rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50" title="Allocazione"><Percent size={15} /></button>
            {cessato ? (
              <button onClick={() => onRiattiva(e)} className="p-1.5 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50" title="Riattiva"><RefreshCw size={15} /></button>
            ) : (
              <button onClick={() => onCessa(e)} className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50" title="Cessa"><Trash2 size={15} /></button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="font-bold text-slate-800">Anagrafica organico</h2>
          <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
            {STATUS.map((s) => (
              <button key={s.k} onClick={() => setStatus(s.k)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${status === s.k ? 'bg-white shadow text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white">
            <option value="">Tutte le sedi</option>
            {outlets.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca nome…" className="px-3 py-2 text-sm rounded-lg border border-slate-300 w-44" />
          <button onClick={onAdd} className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5"><Plus size={15} /> Dipendente</button>
        </div>
      </div>

      {orderedNames.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">Nessun dipendente.</div>
      ) : orderedNames.map((name) => {
        const emps = groups[name];
        const paidEmps = emps.filter((e) => isPaid(e.id));
        const totMese = paidEmps.reduce((s, e) => s + (nettoCell(e.id) || 0), 0);
        return (
          <OutletAccordion key={name} name={name} count={paidEmps.length} total={paidEmps.length ? totMese : null}>
            <div className="overflow-x-auto scroll-shadow-x">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 bg-white border-b border-slate-200">
                    <th className="px-4 py-2 text-left font-bold">Matricola</th>
                    <th className="px-4 py-2 text-left font-bold">Dipendente</th>
                    <th className="px-4 py-2 text-left font-bold">Contratto</th>
                    <th className="px-4 py-2 text-right font-bold">Netto busta {mm}/{year}</th>
                    <th className="px-4 py-2 text-right font-bold">Costo lordo {mm}/{year}</th>
                    <th className="px-4 py-2 text-center font-bold">Cedolino</th>
                    <th className="px-4 py-2 text-center font-bold">Azioni</th>
                  </tr>
                </thead>
                <tbody>{emps.map(renderRow)}</tbody>
              </table>
            </div>
          </OutletAccordion>
        );
      })}

      {adminRows.length > 0 && (
        <AmministratoriAccordion admins={adminRows} nettoCell={nettoCell} lordoTot={lordoAmministratori} mm={mm} year={year} />
      )}
    </div>
  );
}

// ============================================================================
// TAB 4 — COSTI & CEDOLINI
// ============================================================================
function CostiTab(props: {
  contiMese: { code: string; label: string; field: string; amount: number }[];
  totaleConti: number;
  totalNettoMese: number;
  monthLabel: string;
  mm: string;
  year: number;
  employees: Employee[];
  allocByEmp: Record<string, EmployeeOutletAllocation[]>;
  outlets: OutletRow[];
  isPaid: (id: string) => boolean;
  nettoCell: (id: string) => number | null;
  cedoliniDelMese: (id: string) => { tipo: string; netto: number | null }[];
  admins: Employee[];
  lordoAmministratori: number;
  costForMonth: (id: string) => EmployeeCost | undefined;
  docsForEmp: (id: string) => EmployeeDocument[];
  onAddCost: (empId: string) => void;
  onEditCost: (c: EmployeeCost) => void;
  onDeleteCost: (id: string) => void;
  onCedolino: (id: string) => void;
  onViewDoc: (d: EmployeeDocument) => void;
  uploadingEmployee: string | null;
  importPanel: React.ReactNode;
}) {
  const { contiMese, totalNettoMese, monthLabel, mm, year, employees, allocByEmp, outlets, isPaid, nettoCell, cedoliniDelMese, admins, lordoAmministratori, costForMonth, docsForEmp, onAddCost, onEditCost, onDeleteCost, onCedolino, onViewDoc, uploadingEmployee, importPanel } = props;
  // NO-ZERO: solo chi ha il cedolino del mese; raggruppato in accordion per outlet (admin a parte).
  const paid = employees.filter((e) => isPaid(e.id));
  const cedGroups: Record<string, Employee[]> = {};
  paid.forEach((e) => { const k = primaryOutlet(allocByEmp[e.id] || []); (cedGroups[k] ||= []).push(e); });
  const cedNames = sortGroupNames(Object.keys(cedGroups), outlets);
  return (
    <div className="space-y-5">
      <div className="text-xs sm:text-[13px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5">
          <span className="text-slate-400 font-bold shrink-0">€</span>
          <div>Questa vista mostra i <strong>netti dai cedolini</strong> per dipendente e mese. Il <strong>costo lordo</strong> (retribuzione + contributi + INAIL, per dipendente e outlet) vive ora nella scheda <strong>«Costo lordo»</strong>.</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] text-slate-400">Netto pagato · {monthLabel} {year}</div>
          <div className="font-semibold tabular-nums text-slate-900">{eurFmt.format(totalNettoMese)}&nbsp;€</div>
        </div>
      </div>

      {/* Cedolini per dipendente — solo chi ha il cedolino del mese, raggruppato per outlet */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2 px-1">
          <h2 className="font-bold text-slate-800">Cedolini per dipendente</h2>
          <span className="text-xs text-slate-500">netto + upload PDF · {monthLabel} {year}</span>
        </div>
        {paid.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">Nessun cedolino per {mm}/{year}. Usa l’import mensile qui sotto.</div>
        ) : (
          <div className="space-y-3">
            {cedNames.map((name) => {
              const emps = cedGroups[name];
              const totMese = emps.reduce((s, e) => s + (nettoCell(e.id) || 0), 0);
              return (
                <OutletAccordion key={name} name={name} count={emps.length} total={totMese}>
                  <div className="overflow-x-auto scroll-shadow-x">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-slate-500 bg-white border-b border-slate-200">
                          <th className="px-4 py-2 text-left font-bold">Dipendente</th>
                          <th className="px-4 py-2 text-right font-bold">Netto {mm}/{year}</th>
                          <th className="px-4 py-2 text-center font-bold">PDF cedolino</th>
                          <th className="px-4 py-2 text-center font-bold">Costo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emps.map((e) => {
                          const c = costForMonth(e.id);
                          const docs = docsForEmp(e.id).filter((d) => d.year === year);
                          return (
                            <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-4 py-2.5 font-semibold text-slate-800">{empName(e)}</td>
                              <td className="px-4 py-2.5 text-right">
                                <Money v={nettoCell(e.id)} />
                                {(() => {
                                  // Un mese composto da piu' cedolini (13a, aggiuntivo) non deve
                                  // sembrare un errore: si dice da cosa e' fatto.
                                  const cd = cedoliniDelMese(e.id);
                                  if (cd.length < 2) return null;
                                  const manuale = cd.find((x) => x.tipo === 'manuale');
                                  const testo = manuale
                                    ? `Totale corretto a mano. Cedolini caricati: ${cd.filter((x) => x.tipo !== 'manuale').map((x) => `${labelTipo(x.tipo)} ${eurFmt.format(Number(x.netto || 0))} €`).join(' · ')}`
                                    : `Somma di ${cd.length} cedolini: ${cd.map((x) => `${labelTipo(x.tipo)} ${eurFmt.format(Number(x.netto || 0))} €`).join(' + ')}`;
                                  return (
                                    <UiTooltip content={testo}>
                                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 cursor-help align-middle">
                                        {manuale ? 'corretto' : `${cd.length} cedolini`}
                                      </span>
                                    </UiTooltip>
                                  );
                                })()}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                {docs.length > 0 ? (
                                  <button onClick={() => onViewDoc(docs[0])} className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-blue-600 hover:bg-blue-50 inline-flex items-center gap-1"><Eye size={13} /> Vedi</button>
                                ) : (
                                  <button onClick={() => onCedolino(e.id)} disabled={uploadingEmployee === e.id} className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1"><Upload size={13} /> carica</button>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                {c ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <button onClick={() => onEditCost(c)} className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50" title="Modifica costo"><Edit2 size={14} /></button>
                                    <button onClick={() => onDeleteCost(c.id)} className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50" title="Elimina costo"><Trash2 size={14} /></button>
                                  </span>
                                ) : (
                                  <button onClick={() => onAddCost(e.id)} className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50" title="Aggiungi costo"><Plus size={14} /></button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </OutletAccordion>
              );
            })}
          </div>
        )}
        {admins.length > 0 && (
          <div className="mt-3">
            <AmministratoriAccordion admins={admins} nettoCell={nettoCell} lordoTot={lordoAmministratori} mm={mm} year={year} />
          </div>
        )}
      </div>

      {importPanel}
    </div>
  );
}

// ============================================================================
// EMPLOYEE FORM MODAL
// ============================================================================
// Codici natura contratto (DB) → label IT.
const CONTRATTO_OPTS: { v: string; l: string }[] = [
  { v: 'indeterminato', l: 'Tempo indeterminato' },
  { v: 'determinato', l: 'Tempo determinato' },
  { v: 'a_chiamata', l: 'A chiamata' },
  { v: 'amministratore', l: 'Amministratore' },
];
const contrattoLabel = (v?: string | null) => CONTRATTO_OPTS.find((o) => o.v === v)?.l || v || '—';

function EmployeeFormModal({ initial, outlets, onCancel, onSave }: { initial: Employee | null; outlets: OutletRow[]; onCancel: () => void; onSave: (data: any) => Promise<void> }) {
  const i = (initial || {}) as any;
  const numStr = (v: any) => (v == null ? '' : String(v));
  const [form, setForm] = useState({
    nome: initial?.nome || initial?.first_name || '',
    cognome: initial?.cognome || initial?.last_name || '',
    matricola: initial?.matricola || '',
    codice_fiscale: initial?.codice_fiscale || initial?.fiscal_code || '',
    data_assunzione: initial?.data_assunzione || initial?.hire_date || '',
    contratto: initial?.contratto_tipo || initial?.contract_type || 'indeterminato',
    data_cessazione: (initial?.data_cessazione === '9999-12-31' ? '' : (initial?.data_cessazione || '')) || '',
    livello: initial?.livello || initial?.level || '',
    qualifica: i.qualifica || initial?.role_description || '',
    note: initial?.note || initial?.notes || '',
    part_time_pct: numStr(i.part_time_pct),
    outlet_id: initial?.outlet_id || '',
    filiale: i.filiale || '',
    // tempo determinato
    scadenza_td: i.scadenza_td || '',
    durata_mesi: numStr(i.durata_mesi),
    proroghe: numStr(i.proroghe),
    proroghe_disponibili: numStr(i.proroghe_disponibili),
    mesi_disp_senza_causale: numStr(i.mesi_disp_senza_causale),
    mesi_disp_con_causale: numStr(i.mesi_disp_con_causale),
    stato_td: i.stato_td || '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [saving, setSaving] = useState(false);
  const submit = async () => { setSaving(true); await onSave({ ...form, id: initial?.id }); setSaving(false); };
  const isTD = form.contratto === 'determinato';
  return (
    <Modal title={initial ? 'Modifica dipendente' : 'Nuovo dipendente'} onClose={onCancel} maxW="max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cognome *"><input value={form.cognome} onChange={(e) => set('cognome', e.target.value)} className="inp" /></Field>
        <Field label="Nome *"><input value={form.nome} onChange={(e) => set('nome', e.target.value)} className="inp" /></Field>
        <Field label="Matricola"><input value={form.matricola} onChange={(e) => set('matricola', e.target.value)} className="inp" /></Field>
        <Field label="Codice fiscale"><input value={form.codice_fiscale} onChange={(e) => set('codice_fiscale', e.target.value)} className="inp" /></Field>
        <Field label="Qualifica">
          <select value={form.qualifica} onChange={(e) => set('qualifica', e.target.value)} className="inp">
            <option value="">—</option>
            <option value="Impiegato">Impiegato</option>
            <option value="Operaio">Operaio</option>
            <option value="Amministratore">Amministratore</option>
            {!['Impiegato', 'Operaio', 'Amministratore', ''].includes(form.qualifica) && <option value={form.qualifica}>{form.qualifica}</option>}
          </select>
        </Field>
        <Field label="Livello"><input value={form.livello} onChange={(e) => set('livello', e.target.value)} placeholder="es. 4 Livello" className="inp" /></Field>
        <Field label="Tipo contratto">
          <select value={form.contratto} onChange={(e) => set('contratto', e.target.value)} className="inp">
            {CONTRATTO_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            {!CONTRATTO_OPTS.some((o) => o.v === form.contratto) && <option value={form.contratto}>{form.contratto}</option>}
          </select>
        </Field>
        <Field label="% part time"><input value={form.part_time_pct} onChange={(e) => set('part_time_pct', e.target.value)} inputMode="decimal" placeholder="(full time)" className="inp tabular-nums" /></Field>
        <Field label="Data inizio contratto *"><input type="date" value={form.data_assunzione || ''} onChange={(e) => set('data_assunzione', e.target.value)} className="inp" /></Field>
        <Field label="Filiale / sede">
          <select value={form.outlet_id} onChange={(e) => set('outlet_id', e.target.value)} className="inp">
            <option value="">—</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {form.filiale && <span className="text-[11px] text-slate-400 mt-1 block">da file: {form.filiale}</span>}
        </Field>
        {!isTD && (
          <Field label="Data fine">
            <div className="text-sm text-slate-400 px-3 py-2 rounded-lg border border-slate-100 bg-slate-50">{form.contratto === 'indeterminato' ? 'Aperta — si valorizza alla cessazione' : '—'}</div>
          </Field>
        )}
        <Field label="Note" full><input value={form.note} onChange={(e) => set('note', e.target.value)} className="inp" /></Field>
      </div>

      {/* Blocco Tempo determinato — solo se contratto determinato */}
      {isTD && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <div className="text-xs font-semibold text-amber-800 mb-2">Tempo determinato</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Scadenza TD"><input type="date" value={form.scadenza_td || ''} onChange={(e) => set('scadenza_td', e.target.value)} className="inp" /></Field>
            <Field label="Durata (mesi)"><input value={form.durata_mesi} onChange={(e) => set('durata_mesi', e.target.value)} inputMode="decimal" className="inp tabular-nums" /></Field>
            <Field label="Proroghe usate"><input value={form.proroghe} onChange={(e) => set('proroghe', e.target.value)} inputMode="numeric" className="inp tabular-nums" /></Field>
            <Field label="Proroghe disponibili"><input value={form.proroghe_disponibili} onChange={(e) => set('proroghe_disponibili', e.target.value)} inputMode="numeric" className="inp tabular-nums" /></Field>
            <Field label="Mesi disp. senza causale"><input value={form.mesi_disp_senza_causale} onChange={(e) => set('mesi_disp_senza_causale', e.target.value)} inputMode="decimal" className="inp tabular-nums" /></Field>
            <Field label="Mesi disp. con causale"><input value={form.mesi_disp_con_causale} onChange={(e) => set('mesi_disp_con_causale', e.target.value)} inputMode="decimal" className="inp tabular-nums" /></Field>
            <Field label="Stato" full><input value={form.stato_td} onChange={(e) => set('stato_td', e.target.value)} placeholder="es. Prorogabile/Riassumibile" className="inp" /></Field>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Annulla</button>
        <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5"><Save size={15} /> {saving ? 'Salvataggio…' : 'Salva'}</button>
      </div>
      <style>{`.inp{width:100%;padding:0.5rem 0.75rem;font-size:0.875rem;border-radius:0.5rem;border:1px solid rgb(226 232 240)}`}</style>
    </Modal>
  );
}

function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span className="text-xs text-slate-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

// ============================================================================
// SCHEDA DIPENDENTE — netto mese per mese (14 mensilità; totale = somma, mai ×12)
// ============================================================================
function SchedaDipendenteModal({ employee, year, costs, allocs, outlets, companyId, onClose, onSaved, onEdit }: {
  employee: Employee; year: number; costs: EmployeeCost[]; allocs: EmployeeOutletAllocation[]; outlets: OutletRow[];
  companyId: string; onClose: () => void; onSaved: () => Promise<void>; onEdit: () => void;
}) {
  const { toast } = useToast();
  const emp = employee as any;
  const initial: Record<number, string> = {};
  for (let m = 1; m <= 12; m++) {
    const c = costs.find((x) => x.employee_id === employee.id && x.year === year && x.month === m);
    initial[m] = c?.netto != null ? eurFmt.format(Number(c.netto)) : '';
  }
  const [vals, setVals] = useState<Record<number, string>>(initial);
  const [saving, setSaving] = useState(false);
  const setM = (m: number, v: string) => setVals((s) => ({ ...s, [m]: v }));
  const totale = Object.values(vals).reduce<number>((s, v) => s + (parseItNum(v) || 0), 0);
  const mesiCompilati = Object.values(vals).filter((v) => parseItNum(v) != null).length;
  const sede = allocs.map((a) => a.outlet_code).join(', ') || '—';
  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('it-IT') : '—');
  const inizio = employee.data_assunzione || employee.hire_date;
  const fine = employee.data_cessazione || employee.termination_date;

  const save = async () => {
    setSaving(true);
    try {
      const payloads: any[] = [];
      for (let m = 1; m <= 12; m++) {
        const n = parseItNum(vals[m]);
        const had = initial[m] !== '';
        // Cedolino «manuale»: vale come totale del mese e non cancella i cedolini
        // caricati dagli import, che restano visibili come storico.
        const base = { employee_id: employee.id, company_id: companyId, year, month: m, tipo: 'manuale', source: 'scheda_dipendente', updated_at: new Date().toISOString() };
        if (n != null) payloads.push({ ...base, netto: n });
        else if (had) payloads.push({ ...base, netto: null });
      }
      if (payloads.length) {
        const { rows: uniq } = keepLastByKey(payloads, (r: any) => `${r.employee_id}|${r.year}|${r.month}|${r.tipo}`);
        const { error } = await supabase.from('employee_cost_slips').upsert(uniq, { onConflict: 'company_id,employee_id,year,month,tipo' });
        if (error) throw error;
      }
      toast({ type: 'success', message: 'Scheda salvata' });
      onClose();
      await onSaved();
    } catch (err: any) {
      toast({ type: 'error', message: 'Errore nel salvataggio: ' + (err?.message || '') });
    } finally {
      setSaving(false);
    }
  };

  const val = (v: any) => (v == null || v === '' ? '—' : String(v));
  const pct = (v: any) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%`);
  const outletName = outlets.find((o) => o.id === employee.outlet_id)?.name;
  const isTD = (emp.contratto_tipo || '') === 'determinato';
  const Cell = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div><div className="text-xs text-slate-400">{label}</div><div className="font-medium">{children}</div></div>
  );

  return (
    <Modal title={`Scheda — ${empName(employee)}`} onClose={onClose} maxW="max-w-2xl">
      {/* Sezione Contratto (sola lettura) + Modifica */}
      <div className="mb-4 rounded-xl border border-slate-200 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contratto e anagrafica</span>
          <button onClick={onEdit} className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-medium text-blue-600 hover:bg-blue-50 inline-flex items-center gap-1"><Edit2 size={13} /> Modifica</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Cell label="Matricola"><span className="tabular-nums">{val(employee.matricola)}</span></Cell>
          <Cell label="Qualifica">{val(emp.qualifica || employee.role_description)}</Cell>
          <Cell label="Livello">{val(employee.livello || (employee as any).level)}</Cell>
          <Cell label="Tipo contratto">{contrattoLabel(emp.contratto_tipo || (employee as any).contract_type)}</Cell>
          <Cell label="% part time">{pct(emp.part_time_pct)}</Cell>
          <Cell label="Sede">{val(outletName || sede)}</Cell>
          <Cell label="Codice fiscale"><span className="tabular-nums text-xs">{val(employee.codice_fiscale || (employee as any).fiscal_code)}</span></Cell>
          <Cell label="Data assunzione">{fmtDate(inizio)}</Cell>
        </div>
        {emp.filiale && <div className="text-[11px] text-slate-400 mt-2">Filiale (da file contratti): {emp.filiale}</div>}

        {isTD ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
            <div className="text-[11px] font-semibold text-amber-800 mb-1.5">Tempo determinato</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Cell label="Scadenza TD">{fmtDate(emp.scadenza_td)}</Cell>
              <Cell label="Durata (mesi)"><span className="tabular-nums">{val(emp.durata_mesi)}</span></Cell>
              <Cell label="Proroghe (usate/disp.)"><span className="tabular-nums">{val(emp.proroghe)} / {val(emp.proroghe_disponibili)}</span></Cell>
              <Cell label="Stato">{val(emp.stato_td)}</Cell>
              <Cell label="Mesi disp. senza causale"><span className="tabular-nums">{val(emp.mesi_disp_senza_causale)}</span></Cell>
              <Cell label="Mesi disp. con causale"><span className="tabular-nums">{val(emp.mesi_disp_con_causale)}</span></Cell>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-slate-400 mt-2">Contratto non a termine: nessuna scadenza/proroga (il blocco "Tempo determinato" compare solo per i contratti a tempo determinato).</div>
        )}
      </div>

      <div className="mb-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 leading-relaxed">
        Inserisci il <strong>netto del mese</strong> (così come arriva dalla busta paga). Ci sono <strong>14 mensilità</strong>: la <strong>13ª</strong> e la <strong>14ª</strong> vanno sommate nel netto del mese in cui vengono erogate (tipicamente dicembre e giugno). Il totale annuo è la <strong>somma dei mesi</strong>, mai mese×12. I valori inseriti qui a mano sono <strong>provvisori</strong>: l'import del mese (Elenco netti) li <strong>sovrascrive</strong> con il dato ufficiale.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {MONTHS.map((m) => (
          <label key={m.num} className="block">
            <span className="text-xs text-slate-500 mb-1 flex items-center gap-1">
              {m.label}
              {m.num === 12 && <span className="text-[10px] px-1 rounded bg-amber-50 text-amber-700">+13ª</span>}
              {m.num === 6 && <span className="text-[10px] px-1 rounded bg-amber-50 text-amber-700">+14ª</span>}
            </span>
            <div className="relative">
              <input value={vals[m.num]} onChange={(e) => setM(m.num, e.target.value)} placeholder="—" inputMode="decimal"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 tabular-nums text-right pr-6" />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">€</span>
            </div>
          </label>
        ))}
      </div>

      <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-sm">
        <span className="text-slate-600">Totale netto {year} <span className="text-slate-400">({mesiCompilati} mesi compilati)</span></span>
        <strong className="tabular-nums" style={{ color: '#16a34a' }}>{eurFmt.format(totale)}&nbsp;€</strong>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Chiudi</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5"><Save size={15} /> {saving ? 'Salvataggio…' : 'Salva netti'}</button>
      </div>
    </Modal>
  );
}

// ============================================================================
// COST FORM MODAL — solo colonne reali (fix totale_costo)
// ============================================================================
function CostFormModal({ initial, employeeId, employees, year, month, onCancel, onSave }: {
  initial: EmployeeCost | null; employeeId: string | null; employees: Employee[]; year: number; month: number;
  onCancel: () => void;
  onSave: (p: { employee_id: string; year: number; month: number; retribuzione: number; contributi: number; inail: number; tfr: number; altri_costi: number; netto: number }) => Promise<void>;
}) {
  const [empId, setEmpId] = useState(employeeId || initial?.employee_id || '');
  const [vals, setVals] = useState({
    retribuzione: Number(initial?.retribuzione || 0),
    contributi: Number(initial?.contributi || 0),
    inail: Number(initial?.inail || 0),
    tfr: Number(initial?.tfr || 0),
    altri_costi: Number(initial?.altri_costi || 0),
    netto: Number(initial?.netto || 0),
  });
  const set = (k: keyof typeof vals, v: string) => setVals((s) => ({ ...s, [k]: Number(v) || 0 }));
  // Totale costo aziendale = somma componenti reali (NON una colonna DB).
  const totale = vals.retribuzione + vals.contributi + vals.inail + vals.tfr + vals.altri_costi;
  const [saving, setSaving] = useState(false);
  const submit = async () => { setSaving(true); await onSave({ employee_id: empId, year, month, ...vals }); setSaving(false); };
  const fields: { k: keyof typeof vals; label: string }[] = [
    { k: 'retribuzione', label: 'Retribuzione (670103)' },
    { k: 'contributi', label: 'Contributi INPS (670303)' },
    { k: 'inail', label: 'INAIL (670307)' },
    { k: 'tfr', label: 'TFR (670501)' },
    { k: 'altri_costi', label: 'Altri costi (670909)' },
    { k: 'netto', label: 'Netto in busta' },
  ];
  return (
    <Modal title={initial ? 'Modifica costo mensile' : 'Nuovo costo mensile'} onClose={onCancel}>
      <div className="mb-3 text-xs text-slate-500">Periodo: {MONTHS.find((m) => m.num === month)?.label} {year}</div>
      <Field label="Dipendente">
        <select value={empId} onChange={(e) => setEmpId(e.target.value)} disabled={!!employeeId} className="inp">
          <option value="">— seleziona —</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{empName(e)}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3 mt-3">
        {fields.map((f) => (
          <Field key={f.k} label={f.label}>
            <input type="number" step="0.01" value={vals[f.k]} onChange={(e) => set(f.k, e.target.value)} className="inp tabular-nums" />
          </Field>
        ))}
      </div>
      <div className="mt-4 p-3 rounded-lg bg-blue-50 text-sm text-blue-800 flex items-center justify-between">
        <span>Totale costo aziendale</span>
        <strong className="tabular-nums">{eurFmt.format(totale)}&nbsp;€</strong>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Annulla</button>
        <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5"><Save size={15} /> {saving ? 'Salvataggio…' : 'Salva'}</button>
      </div>
      <style>{`.inp{width:100%;padding:0.5rem 0.75rem;font-size:0.875rem;border-radius:0.5rem;border:1px solid rgb(226 232 240)}`}</style>
    </Modal>
  );
}

// ============================================================================
// IMPORT MENSILE (employee_costs) — mapping-driven, anteprima, upsert
// ============================================================================

// Cedolino gia' a database per il mese scelto: servono gli importi di ENTRAMBE
// le corsie, per capire quale delle due e' davvero gia' stata caricata.
type SlipMese = {
  employee_id: string; tipo: string; netto: number | null;
  retribuzione: number | null; contributi: number | null; inail: number | null;
  tfr: number | null; altri_costi: number | null;
};

// Una corsia di import: mode='netto' (busta paga) | 'lordi' (costo aziendale). Entrambe PDF + CSV/Excel.
function ImportLane({ mode, companyId, userId, outlets, employees, existingCosts, defaultYear, defaultMonth, onDone }: {
  mode: 'netto' | 'lordi'; companyId: string; userId: string | null; outlets: OutletRow[]; employees: Employee[]; existingCosts: EmployeeCost[];
  defaultYear: number; defaultMonth: number; onDone: () => Promise<void>;
}) {
  const isNetto = mode === 'netto';
  const { toast } = useToast();
  const [impYear, setImpYear] = useState(defaultYear);
  const [impMonth, setImpMonth] = useState(defaultMonth);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  // Il File resta a disposizione fino alla conferma: alla conferma va in archivio,
  // cosi' il mese si puo' sempre riaprire dal documento che l'ha prodotto.
  const [fileObj, setFileObj] = useState<File | null>(null);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [fileTotal, setFileTotal] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [overwriteAck, setOverwriteAck] = useState(false);
  // Fase 3: togliere dal mese chi non è più nel file. Spento di default e mai
  // automatico: è una scelta esplicita di chi importa.
  const [removeMissing, setRemoveMissing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [rawPreview, setRawPreview] = useState<string[] | null>(null);
  // Che cedolino stiamo caricando. A giugno e dicembre ne arrivano due.
  const [tipoCedolino, setTipoCedolino] = useState<string>('normale');
  // Registro matricole: una persona puo' averne piu' di una (trasformazione
  // del contratto). La ricerca deve guardarle tutte, altrimenti la stessa
  // persona diventa due schede e l'organico conta una testa di troppo.
  const [matricoleReg, setMatricoleReg] = useState<{ matricola: string; employee_id: string }[]>([]);
  // Cedolini gia' a database per il mese scelto, per dire cosa c'e' gia'.
  const [slipsMese, setSlipsMese] = useState<SlipMese[]>([]);

  const caricaRegistroECedolini = useCallback(async () => {
    if (!companyId) return;
    const [{ data: mats }, { data: slips }] = await Promise.all([
      supabase.from('employee_matricole').select('matricola, employee_id').eq('company_id', companyId),
      supabase.from('employee_cost_slips').select('employee_id, tipo, netto, retribuzione, contributi, inail, tfr, altri_costi')
        .eq('company_id', companyId).eq('year', impYear).eq('month', impMonth),
    ]);
    setMatricoleReg((mats as any[]) || []);
    setSlipsMese((slips as SlipMese[]) || []);
  }, [companyId, impYear, impMonth]);

  useEffect(() => { void caricaRegistroECedolini(); }, [caricaRegistroECedolini]);

  // ATTENZIONE: retribuzione/contributi/inail/tfr/altri_costi hanno DEFAULT 0 a
  // database. Un carico di soli netti le riempie di zeri, quindi "il cedolino
  // esiste" non vuol dire "questa corsia e' gia' stata caricata": ogni corsia
  // deve guardare i PROPRI importi, altrimenti la corsia lordi avvisa di una
  // sostituzione inesistente su ogni mese gia' toccato dai netti.
  const importoDiCorsia = useCallback(
    (s: SlipMese) => (isNetto
      ? Number(s.netto || 0)
      : Number(s.retribuzione || 0) + Number(s.contributi || 0) + Number(s.inail || 0) + Number(s.tfr || 0) + Number(s.altri_costi || 0)),
    [isNetto],
  );
  const monthHasData = slipsMese.some((s) => s.tipo === tipoCedolino && importoDiCorsia(s) !== 0);
  // Gli altri cedolini gia' presenti nel mese: non vengono toccati, e si dice.
  // Si contano solo quelli che hanno un importo in QUESTA corsia.
  const altriCedolini = useMemo(() => {
    const altri = slipsMese.filter((s) => s.tipo !== tipoCedolino && importoDiCorsia(s) !== 0);
    const tipi = Array.from(new Set(altri.map((s) => s.tipo)));
    return tipi.map((t) => ({ tipo: t, label: labelTipo(t), persone: altri.filter((s) => s.tipo === t).length,
      totale: altri.filter((s) => s.tipo === t).reduce((a, s) => a + importoDiCorsia(s), 0) }));
  }, [slipsMese, tipoCedolino, importoDiCorsia]);

  const matchEmployee = (matricola: string, cognome: string, nome: string): string | null => {
    if (matricola) {
      // prima il registro (comprende le matricole precedenti), poi l'anagrafica
      const reg = matricoleReg.find((m) => norm(m.matricola) === norm(matricola));
      if (reg) return reg.employee_id;
      const byMat = employees.find((e) => norm(e.matricola) === norm(matricola));
      if (byMat) return byMat.id;
    }
    const byName = employees.find((e) => norm(e.cognome || e.last_name) === norm(cognome) && norm(e.nome || e.first_name) === norm(nome));
    return byName ? byName.id : null;
  };

  const amountOf = (r: PreviewRow) => (isNetto ? Number(r.netto || 0) : rowLordo(r));

  // Archivia un file che il riconoscimento ha scartato. Prima il tentativo
  // spariva senza lasciare traccia, ed era proprio il file da guardare per
  // capire perche' il tracciato non veniva letto.
  const archiviaScartato = async (file: File, motivo: string) => {
    const esito = await archiviaFile({
      file, companyId, userId, modulo: 'Personale',
      funzione: `${isNetto ? 'Elenco netti' : 'Costi lordi'} per dipendente · file non riconosciuto`,
      bucket: 'employee-documents', year: impYear, month: impMonth,
      referenceTable: null, note: motivo,
    });
    if (!esito.errore) {
      toast({ type: 'info', message: 'Il file resta comunque in archivio (Archivio documenti → Caricamenti), così possiamo guardarlo.' });
    }
  };

  const processFile = async (file: File) => {
    setParsing(true); setFileName(file.name); setFileObj(file);
    setRows(null); setFileTotal(null); setOverwriteAck(false); setRawPreview(null);
    try {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      let parsed: ParsedImport;
      let rawLines: string[] = [];
      if (isPdf) {
        const { extractPdfLines, extractPdfItems } = await import('../lib/pdfText');
        if (isNetto) {
          // PDF ruotato: righe per asse X. Una filiale per pagina, nome+matricola+netto sulla stessa riga.
          const pages = await extractPdfItems(file);
          rawLines = pages.flatMap((items, i) => [`— pagina ${i + 1} —`, items.map((t) => t.str).join(' ')]);
          parsed = parseInfinityNettiItems(pages, outlets);
        } else {
          rawLines = await extractPdfLines(file);
          // Il "Prospetto riepilogativo elaborazione paghe" è per OUTLET (non per dipendente):
          // si importa dalla scheda «Costo lordo», non da questa corsia per-cedolino.
          if (parseProspettoPaghe(rawLines, outlets).isProspetto) {
            // Mai un messaggio che sparisce: l'estratto resta a video, cosi' si
            // vede da cosa e' stato riconosciuto e si puo' segnalarlo se sbaglia.
            setRawPreview(['⚠︎ Riconosciuto come «Prospetto riepilogativo elaborazione paghe» (costo per OUTLET, non per dipendente).',
              'Va importato dalla scheda «Costo lordo». Se non è quel documento, segnala questo estratto:', '', ...rawLines.slice(0, 25)]);
            toast({ type: 'info', message: 'Questo è un «Prospetto paghe» (costo per outlet): importalo dalla scheda «Costo lordo». Sotto trovi l’estratto del file.' });
            await archiviaScartato(file, 'Riconosciuto come «Prospetto riepilogativo elaborazione paghe»: va importato dalla scheda «Costo lordo».');
            return;
          }
          parsed = parsePdfLordi(rawLines, outlets);
        }
      } else {
        const buf = await file.arrayBuffer();
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false });
        rawLines = matrix.slice(0, 25).map((r) => r.join(' | '));
        parsed = parseSpreadsheet(matrix);
      }
      // I «Netti negativi» sono un tabulato a parte: chi ci finisce, quel mese non
      // incassa nulla e deve restituire, quindi l'importo NON entra nella distinta
      // dei bonifici. Per scelta il gestionale non lo importa: il netto del mese
      // resta quello effettivamente pagato, e il negativo si recupera dal cedolino
      // successivo. Va detto a chi ci prova, non lasciato a «nessun netto trovato».
      if (tabulatoNetti(rawLines.join(' ')) === 'negativi') {
        setRawPreview(['⚠︎ Riconosciuto come «Netti negativi»: è il tabulato di chi, quel mese, non incassa e deve restituire.',
          'Il gestionale non lo importa per scelta: il netto del mese resta quello pagato davvero, e il negativo si recupera dal cedolino successivo.',
          'Se non è quel documento, segnala questo estratto:', '', ...rawLines.slice(0, 25)]);
        toast({ type: 'info', message: 'Questo è l’elenco dei «Netti negativi»: non viene importato. Il netto del mese resta quello pagato, il negativo si recupera dal cedolino successivo.' });
        await archiviaScartato(file, 'Riconosciuto come «Netti negativi»: non importato per scelta.');
        return;
      }
      // tieni solo le righe pertinenti alla corsia
      const relevant = parsed.rows.filter((r) => (isNetto ? r.netto != null : rowHasLordo(r)));
      if (!relevant.length) {
        // mostra un estratto del testo grezzo per capire il formato
        setRawPreview(rawLines.slice(0, 25));
        toast({ type: 'error', message: isNetto
          ? 'Nessun netto riconosciuto: vedi l’estratto del file in anteprima.'
          : 'Nessun componente di costo riconosciuto: vedi l’estratto del file (tracciato PDF lordi definitivo in arrivo).' });
        await archiviaScartato(file, isNetto ? 'Nessun netto riconosciuto nel file.' : 'Nessun componente di costo lordo riconosciuto nel file.');
        return;
      }
      relevant.forEach((row) => { const id = matchEmployee(row.matricola, row.cognome, row.nome); row.matchedId = id; row.isNew = !id; });
      setRows(relevant); setFileTotal(parsed.fileTotal);
    } catch (err: any) {
      toast({ type: 'error', message: 'Errore parsing file: ' + (err?.message || '') });
      await archiviaScartato(file, `Errore in lettura: ${err?.message || 'motivo non noto'}`);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  // campi lordi effettivamente presenti nel file (per payload uniforme nel batch)
  const lordiPresent = useMemo(() => (rows ? LORDI_FIELDS.filter((f) => rows.some((r) => (r as any)[f.key] != null)) : []), [rows]);
  const total = rows ? rows.reduce((s, r) => s + amountOf(r), 0) : 0;
  const newCount = rows ? rows.filter((r) => r.isNew).length : 0;
  const scostamento = fileTotal != null ? total - fileTotal : null;
  const quadra = scostamento == null || Math.abs(scostamento) < 0.01;
  const warnOutlets = rows ? Array.from(new Set(rows.filter((r) => r.warn).map((r) => r.outlet || '—'))) : [];
  // Righe di cui il file non dice (o non fa riconoscere) la filiale: senza
  // punto vendita la persona finisce «da definire» nelle schede. Meglio saperlo
  // PRIMA di confermare che scoprirlo un mese dopo.
  const senzaFiliale = rows ? rows.filter((r) => !r.outlet) : [];
  // Chiave PERSONA di una riga: la stessa che usa il salvataggio per sommare le
  // righe doppie. Serve anche all'anteprima, altrimenti conta righe dove il mese
  // conta persone e sembra che il carico faccia crescere l'organico.
  // Per chi e' gia' in anagrafica la chiave e' l'id. Per chi e' NUOVO e' il nome:
  // due righe dello stesso file con lo stesso cognome e nome sono la stessa
  // persona anche se il software paghe le ha dato due matricole (caso BALADA
  // ANNALAURA, luglio 2026: 0000095 e 0000097 nello stesso elenco).
  const chiavePersona = (r: PreviewRow) => {
    if (r.matchedId) return r.matchedId;
    const nome = `${norm(r.cognome)}|${norm(r.nome)}`;
    return nome !== '|' ? `nome:${nome}` : `mat:${norm(r.matricola)}`;
  };
  // Persone presenti in piu' righe dello stesso file (tipicamente su due filiali):
  // il salvataggio le somma, e l'anteprima lo dice prima di confermare.
  const dupPeople = useMemo(() => {
    if (!rows) return [] as string[];
    const keyed = rows.filter((r) => r.matchedId || r.matricola)
      .map((r) => ({ k: chiavePersona(r), label: `${r.cognome || ''} ${r.nome || ''}`.trim() || r.matricola || '—' }));
    const dupKeys = duplicateKeys(keyed, (r) => r.k);
    return Array.from(new Set(keyed.filter((r) => dupKeys.includes(r.k)).map((r) => r.label)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  // Quante PERSONE porta il file: le righe doppie valgono una sola persona.
  const personeNelFile = useMemo(() => (rows ? new Set(rows.map(chiavePersona)).size : 0), [rows]);
  const reset = () => { setRows(null); setFileName(''); setFileObj(null); setFileTotal(null); setOverwriteAck(false); setRawPreview(null); setRemoveMissing(false); };

  // ── FASE 3 — il carico è una SOSTITUZIONE del mese, non un'aggiunta ─────────
  // Prima di confermare si mostra cosa cambia rispetto a quello che c'è già:
  // chi entra, chi esce, chi cambia punto vendita. Senza questo confronto, un
  // file ricaricato corretto lasciava a database le persone del file sbagliato
  // e il mese continuava a contarne una di troppo.
  const diff = useMemo(() => {
    if (!rows || !isNetto) return null;
    const nelFile = new Set<string>();
    const outletNelFile: Record<string, string> = {};
    const outletByNormPrev: Record<string, string> = {};
    outlets.forEach((o) => { outletByNormPrev[norm(o.name)] = o.name; });
    rows.forEach((r) => {
      if (!r.matchedId) return;
      nelFile.add(r.matchedId);
      const exact = r.outlet ? outletByNormPrev[norm(r.outlet)] : '';
      if (exact) outletNelFile[r.matchedId] = exact;
    });
    // Confronto con i cedolini dello STESSO tipo: la tredicesima non c'entra
    // niente con la mensilita' normale e non deve risultare «uscita».
    const outletDi = (id: string) => existingCosts.find((c) => c.employee_id === id && c.year === impYear && c.month === impMonth)?.outlet_code || null;
    const aDb = slipsMese.filter((s) => s.tipo === tipoCedolino && s.netto != null)
      .map((s) => ({ employee_id: s.employee_id, netto: s.netto, outlet_code: outletDi(s.employee_id) }));
    const nomeDi = (id: string) => { const e = employees.find((x) => x.id === id); return e ? empName(e) : '—'; };

    const usciti = aDb
      .filter((c) => !nelFile.has(c.employee_id as string))
      .map((c) => ({ id: c.employee_id as string, nome: nomeDi(c.employee_id as string), netto: Number(c.netto || 0) }));
    const idsADb = new Set(aDb.map((c) => c.employee_id as string));
    // Chi ENTRA e' una persona, non una riga: chi lavora su due filiali compare
    // due volte nel file ma entra una volta sola.
    const entratiMap = new Map<string, { nome: string }>();
    rows.filter((r) => !r.matchedId || !idsADb.has(r.matchedId))
      .forEach((r) => { entratiMap.set(chiavePersona(r), { nome: `${r.cognome} ${r.nome}`.trim() || r.matricola || '—' }); });
    const entrati = [...entratiMap.values()];
    const cambioOutlet = aDb
      .map((c) => {
        const id = c.employee_id as string;
        const nuovo = outletNelFile[id];
        const vecchio = c.outlet_code;
        if (!nuovo || !vecchio || nuovo === vecchio) return null;
        return { id, nome: nomeDi(id), da: vecchio, a: nuovo };
      })
      .filter((x): x is { id: string; nome: string; da: string; a: string } => x !== null);

    return { usciti, entrati, cambioOutlet, presenti: aDb.length };
  }, [rows, isNetto, existingCosts, slipsMese, tipoCedolino, impYear, impMonth, employees, outlets]);

  const doImport = async () => {
    if (!rows) return;
    setImporting(true);
    try {
      const outletByNorm: Record<string, string> = {};
      outlets.forEach((o) => { outletByNorm[norm(o.name)] = o.name; });

      // Chi ha gia' un punto vendita in anagrafica. Serve per non sovrascrivere
      // nessuno e, insieme, per non lasciare senza sede chi il file ha appena
      // collocato in una filiale.
      const { data: allocNow } = await supabase.from('employee_outlet_allocations')
        .select('employee_id').eq('company_id', companyId);
      const conAlloc = new Set(((allocNow as { employee_id: string }[]) || []).map((a) => a.employee_id));

      // Anagrafica FRESCA dal database. Se un tentativo precedente e' fallito DOPO
      // aver creato le persone nuove, qui le ritroviamo per matricola e non le
      // duplichiamo: senza questo, ogni ritentativo aggiunge doppioni in anagrafica.
      const [{ data: freshEmps }, { data: freshMats }] = await Promise.all([
        supabase.from('employees').select('id, matricola').eq('company_id', companyId),
        supabase.from('employee_matricole').select('matricola, employee_id').eq('company_id', companyId),
      ]);
      const idByMatricola = new Map<string, string>();
      (freshEmps || []).forEach((e: any) => { if (e?.matricola) idByMatricola.set(norm(String(e.matricola)), e.id); });
      // Il registro vince: contiene anche le matricole precedenti di chi ha avuto
      // una trasformazione di contratto.
      (freshMats || []).forEach((m: any) => { if (m?.matricola) idByMatricola.set(norm(String(m.matricola)), m.employee_id); });
      // Indice per NOME delle persone create DA QUESTO carico. Dentro un solo file
      // paghe, due righe con identico cognome e nome sono la stessa persona anche
      // con due matricole diverse: senza questo indice la seconda riga creava una
      // seconda scheda (caso BALADA ANNALAURA, luglio 2026, matricole 0000095 e
      // 0000097). Non tocca l'anagrafica esistente: guarda solo i nuovi del file.
      const idByNomeNuovi = new Map<string, string>();

      // Il file va in archivio PRIMA dei dati: se l'archiviazione fallisce si va
      // avanti lo stesso, ma l'utente lo viene a sapere (mai in silenzio).
      let documentId: string | null = null;
      if (fileObj) {
        const archiviato = await archiviaFile({
          file: fileObj, companyId, userId, modulo: 'Personale',
          funzione: isNetto ? `Elenco netti per dipendente · ${labelTipo(tipoCedolino)}` : 'Costi lordi per dipendente',
          bucket: 'employee-documents', year: impYear, month: impMonth,
          referenceTable: 'employee_cost_imports',
        });
        documentId = archiviato.id;
        if (archiviato.errore) toast({ type: 'error', message: avvisoArchiviazioneFallita(fileName, archiviato.errore) });
      }

      const { data: logRow, error: logErr } = await supabase.from('employee_cost_imports').insert([{
        company_id: companyId, year: impYear, month: impMonth, file_name: fileName,
        rows_total: rows.length, rows_new_employees: newCount, total_netto: total,
        file_total: fileTotal, scostamento, imported_by: userId, note: isNetto ? 'busta_paga' : 'lordi',
        import_document_id: documentId,
      }]).select('id').single();
      if (logErr) throw logErr;
      const importId = logRow?.id || null;
      if (documentId && importId) {
        await supabase.from('import_documents').update({ reference_id: importId }).eq('id', documentId);
      }

      const payloads: any[] = [];
      const failedNew: string[] = [];
      for (const row of rows) {
        const nomeChiave = `${norm(row.cognome)}|${norm(row.nome)}`;
        let empId = row.matchedId;
        if (!empId && row.matricola) empId = idByMatricola.get(norm(row.matricola)) || null;
        // Persona nuova gia' creata da una riga precedente di QUESTO file, con
        // un'altra matricola: si riusa la sua scheda invece di sdoppiarla.
        if (!empId && nomeChiave !== '|') empId = idByNomeNuovi.get(nomeChiave) || null;
        if (!empId) {
          // Il nome arriva dall'import (PDF ruotato → riga completa). Mai la matricola come nome:
          // se davvero manca il testo-nome, usa un placeholder editabile dalla scheda.
          const hasName = !!(row.cognome || row.nome);
          const cognome = hasName ? (row.cognome || row.nome) : '(nome da completare)';
          const nome = hasName ? row.nome : '';
          const { data: newEmp, error: empErr } = await supabase.from('employees').insert([{
            company_id: companyId, matricola: row.matricola || null,
            nome: nome || null, cognome,
            first_name: nome || cognome, last_name: cognome,
            is_active: true,
          }]).select('id').single();
          if (empErr) {
            // Mai in silenzio: chi non e' stato creato finisce nel messaggio finale.
            console.error('Errore creazione dipendente', empErr);
            failedNew.push(`${cognome} ${nome}`.trim() || row.matricola || '—');
            continue;
          }
          empId = newEmp?.id || null;
          if (empId && nomeChiave !== '|') idByNomeNuovi.set(nomeChiave, empId);
          if (empId && row.matricola) {
            idByMatricola.set(norm(row.matricola), empId);
            // la matricola entra nel registro: da qui in poi la persona e' trovabile
            // anche se domani il software paghe gliene assegna una nuova.
            await supabase.from('employee_matricole').insert([{
              company_id: companyId, employee_id: empId, matricola: String(row.matricola).trim(), is_current: true,
            }]);
          }
        } else if (row.matricola && !idByMatricola.has(norm(row.matricola))) {
          // Matricola nuova per una persona che il gestionale conosce gia': entra
          // nel registro come non corrente, cosi' il mese prossimo si aggancia da se'.
          idByMatricola.set(norm(row.matricola), empId);
          await supabase.from('employee_matricole').insert([{
            company_id: companyId, employee_id: empId, matricola: String(row.matricola).trim(), is_current: false,
            note: `vista nel file ${fileName}`,
          }]);
        }
        if (!empId) continue;
        // Il punto vendita dell'anagrafica si crea SOLO se manca del tutto: chi
        // ce l'ha gia' non viene mai riscritto dall'import. Vale anche per le
        // persone gia' presenti, non solo per quelle appena create: altrimenti
        // chi era entrato senza filiale restava «da definire» per sempre.
        if (!conAlloc.has(empId) && row.outlet) {
          const exact = outletByNorm[norm(row.outlet)];
          if (exact) {
            const { error: allErr } = await supabase.from('employee_outlet_allocations')
              .insert([{ employee_id: empId, company_id: companyId, outlet_code: exact, allocation_pct: 100, is_primary: true }]);
            if (!allErr) conAlloc.add(empId);
          }
        }
        // Payload con SOLO i campi della corsia (l'altra corsia non viene toccata).
        const payload: any = {
          employee_id: empId, company_id: companyId, year: impYear, month: impMonth,
          tipo: tipoCedolino, matricola: row.matricola || null, file_name: fileName,
          source: isNetto ? 'import_busta_paga' : 'import_lordi', import_id: importId,
          import_document_id: documentId,
          updated_at: new Date().toISOString(),
        };
        if (isNetto) {
          payload.netto = Number(row.netto || 0);
          // FASE 2 — la filiale del file diventa l'outlet DI QUEL MESE. È il
          // fatto storico: se domani la persona cambia negozio, questo mese
          // resta com'era.
          const exactOutlet = row.outlet ? outletByNorm[norm(row.outlet)] : '';
          if (exactOutlet) { payload.outlet_code = exactOutlet; payload.outlet_source = 'file'; }
        } else {
          lordiPresent.forEach((f) => { payload[f.col] = Number((row as any)[f.key] || 0); });
        }
        payloads.push(payload);
      }

      // Stessa persona su due righe (due filiali nello stesso PDF, oppure due
      // mensilita'): il database rifiuta l'intero lotto. Le righe si sommano, cosi'
      // il totale del file resta quadrato e nessun netto va perso.
      const sumCols = isNetto ? ['netto'] : lordiPresent.map((f) => f.col);
      const { rows: uniquePayloads, mergedKeys } = mergeSumByKey(
        payloads, (r) => `${r.employee_id}|${r.year}|${r.month}|${r.tipo}`, sumCols,
      );

      // Si scrive il CEDOLINO. Il totale del mese in employee_costs lo ricalcola
      // il database sommando i cedolini (migration 161), cosi' tredicesima e
      // mensilita' normale convivono invece di sovrascriversi.
      if (uniquePayloads.length) {
        const { error: upErr } = await supabase.from('employee_cost_slips')
          .upsert(uniquePayloads, { onConflict: 'company_id,employee_id,year,month,tipo' });
        if (upErr) throw upErr;
      }

      // FASE 3 — chi non è più nel file esce dal mese, ma SOLO se richiesto e
      // senza perdere nulla: si azzera il netto (la riga e gli eventuali costi
      // lordi restano) dopo aver salvato lo snapshot nell'audit dell'import.
      let removedCount = 0;
      if (isNetto && removeMissing && diff && diff.usciti.length > 0 && importId) {
        const snapshot = diff.usciti.map((u) => ({ employee_id: u.id, nome: u.nome, netto: u.netto, year: impYear, month: impMonth }));
        const { error: snapErr } = await supabase.from('employee_cost_imports')
          .update({ removed_snapshot: snapshot, rows_removed: snapshot.length })
          .eq('id', importId);
        if (snapErr) throw snapErr;
        // Si toglie solo il cedolino di QUESTO tipo: gli altri del mese restano.
        const { error: rmErr } = await supabase.from('employee_cost_slips')
          .delete()
          .eq('company_id', companyId).eq('year', impYear).eq('month', impMonth).eq('tipo', tipoCedolino)
          .in('employee_id', diff.usciti.map((u) => u.id));
        if (rmErr) throw rmErr;
        removedCount = snapshot.length;
      }

      const mergedTxt = mergedKeys.length ? ` · ${mergedKeys.length} ${mergedKeys.length === 1 ? 'persona presente' : 'persone presenti'} su più righe: importi sommati` : '';
      const removedTxt = removedCount ? ` · ${removedCount} tolt${removedCount === 1 ? 'a' : 'e'} dal mese` : '';
      toast({ type: 'success', message: `Import ${isNetto ? 'netti' : 'costi lordi'} completato: ${uniquePayloads.length} righe, ${newCount - failedNew.length} nuovi dipendenti.${mergedTxt}${removedTxt}` });
      if (failedNew.length) {
        toast({ type: 'error', message: `Non sono riuscito a creare in anagrafica: ${failedNew.join(', ')}. Di solito la matricola è già usata da un'altra persona: controlla in Organico, poi ripeti l'import.` });
      }
      reset();
      await caricaRegistroECedolini();
      await onDone();
    } catch (err: any) {
      toast({ type: 'error', message: 'Errore import: ' + readableDbError(err) });
    } finally {
      setImporting(false);
    }
  };

  const accent = isNetto ? 'text-green-600' : 'text-orange-600';
  const chip = isNetto
    ? <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-50 text-green-600">cassa</span>
    : <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-50 text-orange-600">costo</span>;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <FileUp size={18} className={accent} />
        <h3 className="font-bold text-slate-800">{isNetto ? 'Import netti per dipendente' : 'Import costi lordi per dipendente'}</h3>
        {chip}
      </div>
      <p className="text-xs text-slate-500 mb-4">
        {isNetto
          ? 'Netto pagato al dipendente (take-home) → scrive solo employee_costs.netto. Formato tipico: PDF “Elenco netti” del software paghe. Accetta anche CSV/Excel.'
          : <>Costo lordo aziendale <strong>persona per persona</strong> (retribuzione lorda + contributi + INAIL + TFR + altri). Il «Prospetto riepilogativo elaborazione paghe», che è per <strong>outlet</strong> e non per persona, va invece nella scheda «Costo lordo»: qui non viene accettato.</>}
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={impYear} onChange={(e) => setImpYear(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg border border-slate-300">
          {[defaultYear + 1, defaultYear, defaultYear - 1, defaultYear - 2].map((y) => <option key={y} value={y}>Anno {y}</option>)}
        </select>
        <select value={impMonth} onChange={(e) => setImpMonth(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg border border-slate-300">
          {MONTHS.map((m) => <option key={m.num} value={m.num}>{m.label}</option>)}
        </select>
        <select value={tipoCedolino} onChange={(e) => { setTipoCedolino(e.target.value); setOverwriteAck(false); }}
          className="px-3 py-2 text-sm rounded-lg border border-slate-300" title="Quale cedolino stai caricando">
          {TIPI_CEDOLINO.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>

      {altriCedolini.length > 0 && (
        <div className="mb-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600 flex items-start gap-2">
          <FileText size={15} className="mt-0.5 shrink-0 text-slate-400" />
          <span>
            {MONTHS.find((m) => m.num === impMonth)?.label} {impYear} contiene già:{' '}
            {altriCedolini.map((c, i) => (
              <span key={c.tipo}>{i > 0 ? ', ' : ''}<strong>{c.label}</strong> ({c.persone} persone{c.totale ? `, ${eurFmt.format(c.totale)} €` : ''})</span>
            ))}. Questo carico <strong>si aggiunge</strong>: il mese varrà la somma dei cedolini.
          </span>
        </div>
      )}

      {/* Zona drag & drop */}
      <input ref={fileRef} type="file" accept=".pdf,.csv,.txt,.xlsx,.xls" className="hidden" onChange={handleFile} />
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`mb-4 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${dragOver ? (isNetto ? 'border-green-400 bg-green-50' : 'border-orange-400 bg-orange-50') : 'border-slate-300 hover:border-slate-400 bg-slate-50'}`}
      >
        <Upload size={22} className={`mx-auto mb-2 ${isNetto ? 'text-green-500' : 'text-orange-500'}`} />
        <div className="text-sm font-medium text-slate-700">{parsing ? 'Lettura del file…' : 'Trascina qui il file PDF / CSV / Excel'}</div>
        <div className="text-xs text-slate-400 mt-0.5">oppure clicca per sceglierlo {fileName && !parsing ? `· ${fileName}` : ''}</div>
      </div>

      {rawPreview && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold text-slate-500 mb-1.5">Estratto del file (per diagnosticare il formato):</div>
          <pre className="text-[11px] text-slate-600 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">{rawPreview.join('\n')}</pre>
        </div>
      )}

      {monthHasData && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>Per {MONTHS.find((m) => m.num === impMonth)?.label} {impYear} il cedolino «{labelTipo(tipoCedolino)}» è già stato caricato. Confermando <strong>sostituisci solo quello</strong>: gli altri cedolini dello stesso mese, l'altra corsia e gli altri mesi non vengono toccati.</span>
        </div>
      )}

      {rows && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><div className="text-xs text-slate-500">Righe riconosciute</div><div className="font-semibold">{rows.length}</div></div>
            <div><div className="text-xs text-slate-500">Nuovi dipendenti</div><div className="font-semibold">{newCount}</div></div>
            <div><div className="text-xs text-slate-500">{isNetto ? 'Totale netto calcolato' : 'Totale lordo calcolato'}</div><div className="font-semibold"><Money v={total} /></div></div>
            <div><div className="text-xs text-slate-500">Totale aziendale (file)</div><div className="font-semibold">{fileTotal != null ? <Money v={fileTotal} /> : <span className="text-slate-400">—</span>}</div></div>
          </div>

          {scostamento != null && (
            <div className={`px-4 py-2 text-sm flex items-center gap-2 ${quadra ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {quadra ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              {quadra ? 'Quadratura OK con il totale aziendale del file.' : <>Scostamento dal totale file: <Money v={scostamento} /></>}
            </div>
          )}

          {warnOutlets.length > 0 && (
            <div className="px-4 py-2 text-sm flex items-center gap-2 bg-amber-50 text-amber-800">
              <AlertCircle size={15} /> Filiali da verificare (somma netti ≠ totale di ripartizione): <strong>{warnOutlets.join(', ')}</strong>
            </div>
          )}

          {senzaFiliale.length > 0 && (
            <div className="px-4 py-2 text-sm flex items-start gap-2 bg-amber-50 text-amber-800">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>
                {senzaFiliale.length === 1 ? 'Una riga non ha' : `${senzaFiliale.length} righe non hanno`} una filiale
                riconosciuta: <strong>{senzaFiliale.slice(0, 8).map((r) => `${r.cognome} ${r.nome}`.trim() || r.matricola || '—').join(', ')}</strong>
                {senzaFiliale.length > 8 ? ', …' : ''}. {senzaFiliale.length === 1 ? 'Questa persona resta' : 'Queste persone restano'} col
                punto vendita che {senzaFiliale.length === 1 ? 'ha' : 'hanno'} già in anagrafica; chi non ne ha risulta «da assegnare»
                finché non glielo dai in Organico.
              </span>
            </div>
          )}

          {dupPeople.length > 0 && (
            <div className="px-4 py-2 text-sm flex items-start gap-2 bg-blue-50 text-blue-800">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>
                Nel file {dupPeople.length === 1 ? 'una persona compare' : `${dupPeople.length} persone compaiono`} su più righe
                (di solito perché lavorano su due filiali): <strong>{dupPeople.join(', ')}</strong>.
                Confermando, gli importi delle righe doppie vengono <strong>sommati</strong> in un unico dato del mese.
              </span>
            </div>
          )}

          {/* FASE 3 — cosa cambia nel mese rispetto a quello che c'è già. */}
          {diff && diff.presenti > 0 && (
            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-sm space-y-2">
              <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                <Users size={15} className="text-slate-400" />
                Cosa cambia in {MONTHS.find((m) => m.num === impMonth)?.label} {impYear}
              </div>
              <div className="text-slate-600">
                Nel mese ci sono già <strong>{diff.presenti}</strong> cedolini. Questo file ne porta <strong>{personeNelFile}</strong>
                {personeNelFile !== rows.length && <> ({rows.length} righe nel file, {rows.length - personeNelFile} sommate perché la stessa persona compare su più filiali)</>}.
              </div>
              <ul className="space-y-1 text-slate-600">
                <li>
                  <span className="text-emerald-700 font-medium">Entrano {diff.entrati.length}</span>
                  {diff.entrati.length > 0 && <span className="text-slate-500">: {diff.entrati.slice(0, 6).map((e) => e.nome).join(', ')}{diff.entrati.length > 6 ? ', …' : ''}</span>}
                </li>
                <li>
                  <span className={diff.usciti.length ? 'text-red-700 font-medium' : 'text-slate-500'}>Escono {diff.usciti.length}</span>
                  {diff.usciti.length > 0 && <span className="text-slate-500">: {diff.usciti.map((u) => u.nome).join(', ')}</span>}
                </li>
                <li>
                  <span className={diff.cambioOutlet.length ? 'text-amber-700 font-medium' : 'text-slate-500'}>Cambiano sede {diff.cambioOutlet.length}</span>
                  {diff.cambioOutlet.length > 0 && <span className="text-slate-500">: {diff.cambioOutlet.map((c) => `${c.nome} (${c.da} → ${c.a})`).join(', ')}</span>}
                </li>
              </ul>
              {diff.usciti.length > 0 && (
                <label className="flex items-start gap-2 pt-1 text-slate-700">
                  <input type="checkbox" className="mt-0.5" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} />
                  <span>
                    <strong>Togli dal mese chi non è nel file</strong> ({diff.usciti.length} person{diff.usciti.length === 1 ? 'a' : 'e'}).
                    Il mese conterà {rows.length} dipendenti invece di {diff.presenti + diff.entrati.length}.
                    Niente viene cancellato: il netto viene azzerato e i valori restano recuperabili nello storico degli import.
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-3 py-2 font-medium">Matr.</th>
                  <th className="px-3 py-2 font-medium">Dipendente</th>
                  <th className="px-3 py-2 font-medium">Outlet</th>
                  <th className="px-3 py-2 font-medium text-right">{isNetto ? 'Netto' : 'Costo lordo'}</th>
                  <th className="px-3 py-2 font-medium text-center">Stato</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-3 py-2 text-slate-500 tabular-nums">{r.matricola || '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{`${r.cognome} ${r.nome}`.trim() || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{r.outlet || <span className="text-amber-600">filiale non mappata</span>}</td>
                    <td className="px-3 py-2 text-right"><Money v={amountOf(r)} /></td>
                    <td className="px-3 py-2 text-center">
                      {r.warn
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">da verificare</span>
                        : r.isNew
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Nuovo</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Esistente</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            {monthHasData ? (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={overwriteAck} onChange={(e) => setOverwriteAck(e.target.checked)} />
                Confermo la sostituzione del cedolino «{labelTipo(tipoCedolino)}» già presente
              </label>
            ) : <span />}
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={reset} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Annulla</button>
              <button onClick={doImport} disabled={importing || (monthHasData && !overwriteAck)} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1.5">
                <Save size={15} /> {importing ? 'Import in corso…' : 'Conferma import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TAB "COSTO LORDO" — import del "Prospetto riepilogativo elaborazione paghe"
// (Zucchetti Paghe Infinity) → costo del lavoro per OUTLET/MESE. Tabella
// personnel_gross_cost + vista v_personnel_gross_cost (INAIL = Σ imponibile×tasso).
// Amministratori in voce SEPARATA. Import idempotente (upsert), NO DATA LOSS.
// ============================================================================

type GrossPat = { code: string; label: string; imponibile: number };
type GrossRow = {
  id: string; outlet_id: string | null; outlet_label: string | null; filiale_code: string;
  year: number; month: number; numero_dipendenti: number | null;
  retribuzioni_lorde: number | null; totale_retribuzioni: number | null;
  compensi_amm: number; contr_inps: number; contr_ebinter: number; contr_est: number;
  contr_gestione_separata: number; tfr_fondo: number; inail_pat: GrossPat[];
  contr_azienda: number; inail_calcolato: number; inail_incompleto: boolean;
  costo_lordo_outlet: number; amministratori_totale: number; source_file: string | null;
};
type InailRateRow = { id: string; pat_label: string; outlet_id: string | null; rate_percent: number | null; note: string | null };

const MESI_LBL = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

// ============================================================================
// Costo lordo PER DIPENDENTE/MESE — layer drillabile dentro la scheda "Costo
// lordo". Sorgente: report "Statistica costo orario" (Paghe Infinity, ruotato)
// → tabella personnel_gross_cost_employee (migration 082).
// Lordo = retribuzione + contribuzione + inail. TFR già dentro la retribuzione.
// ============================================================================
type PgceRow = {
  id: string; matricola: string; employee_name: string | null; outlet_code: string | null;
  is_admin: boolean; year: number; month: number; employee_id: string | null;
  retribuzione: number; contribuzione: number; inail: number; tfr: number; lordo: number;
};
const DA_ASSEGNARE = 'Da assegnare';
const AMMINISTRATORI = 'Amministratori';

// Indice cognome+nome → dipendente, usato solo quando la matricola non basta.
// I nomi ripetuti vengono ESCLUSI: meglio una riga da assegnare che una riga
// attribuita alla persona sbagliata.
function nameIndex(emps: { id: string; nome: string | null; cognome: string | null }[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const e of emps) {
    const k = norm(`${e.cognome || ''} ${e.nome || ''}`);
    if (!k) continue;
    seen.set(k, seen.has(k) ? null : e.id); // seconda occorrenza → nome ambiguo
  }
  const out = new Map<string, string>();
  seen.forEach((id, k) => { if (id) out.set(k, id); });
  return out;
}

function CostiLordoDipendentiBlock({ companyId, userId, outlets, year, month, monthLabel, prospettoByOutlet }: {
  companyId: string; userId: string | null; outlets: OutletRow[]; year: number; month: number; monthLabel: string;
  prospettoByOutlet: Map<string, number>;
}) {
  const { toast } = useToast();
  const sb: any = supabase; // tabelle nuove (082) non ancora nei tipi generati
  const [rows, setRows] = useState<PgceRow[]>([]);
  // Il punto vendita salvato sulla riga e' una FOTOGRAFIA del momento dell'import.
  // Chi arriva nuovo col file dei costi lordi non ha ancora una sede: la riga
  // nasce «da assegnare» e ci restava anche dopo che la sede veniva data in
  // Organico. Qui si tiene l'anagrafica di oggi per ripiegarci sopra a lettura.
  const [outletByEmp, setOutletByEmp] = useState<Map<string, string>>(new Map());
  // Registro matricole: il software paghe puo' cambiare la matricola di una
  // persona. Senza il registro la riga resta orfana (nessun dipendente, nessuna sede).
  const [empIdByMat, setEmpIdByMat] = useState<Map<string, string>>(new Map());
  // Ultima spiaggia: cognome+nome, ma SOLO se in anagrafica c'e' una persona
  // sola con quel nome. Stesso criterio dell'import dei netti.
  const [empIdByName, setEmpIdByName] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [companyPick, setCompanyPick] = useState<{ pages: any[][]; companies: { code: string; name: string }[]; fileName: string } | null>(null);
  const [preview, setPreview] = useState<{ companyCode: string; companyName: string; res: ReturnType<typeof parseStatisticaCostoOrario>; fileName: string } | null>(null);
  // Il PDF resta a disposizione fino alla conferma, poi va in archivio.
  const [fileObj, setFileObj] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: allocs }, { data: mats }, { data: emps }] = await Promise.all([
      sb.from('personnel_gross_cost_employee').select('*').eq('company_id', companyId).eq('year', year),
      sb.from('employee_outlet_allocations').select('employee_id, outlet_code, is_primary').eq('company_id', companyId),
      sb.from('employee_matricole').select('matricola, employee_id').eq('company_id', companyId),
      sb.from('employees').select('id, nome, cognome').eq('company_id', companyId),
    ]);
    const byEmp = new Map<string, string>();
    for (const a of ((allocs as { employee_id: string; outlet_code: string; is_primary: boolean }[]) || [])) {
      if (!byEmp.has(a.employee_id) || a.is_primary) byEmp.set(a.employee_id, a.outlet_code);
    }
    setOutletByEmp(byEmp);
    setEmpIdByMat(new Map(((mats as { matricola: string; employee_id: string }[]) || []).map((m) => [norm(m.matricola), m.employee_id])));
    setEmpIdByName(nameIndex(((emps as { id: string; nome: string | null; cognome: string | null }[]) || [])));
    setRows(((data as PgceRow[]) || []).map((r) => ({ ...r, lordo: Number(r.lordo), retribuzione: Number(r.retribuzione), contribuzione: Number(r.contribuzione), inail: Number(r.inail), tfr: Number(r.tfr) })));
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId, year]);

  const monthRows = useMemo(() => rows.filter((r) => r.month === month), [rows, month]);
  // Punto vendita della riga, a cascata: prima quello letto al momento dell'import
  // (fatto del mese), poi l'anagrafica di oggi — trovata anche per matricola
  // precedente. Solo se non c'e' nulla la riga e' davvero «da assegnare».
  const outletOf = (r: PgceRow): string | null => {
    if (r.outlet_code) return r.outlet_code;
    const empId = r.employee_id || empIdByMat.get(norm(r.matricola)) || empIdByName.get(norm(r.employee_name)) || null;
    return (empId && outletByEmp.get(empId)) || null;
  };
  const bucketOf = (r: PgceRow) => (r.is_admin ? AMMINISTRATORI : (outletOf(r) || DA_ASSEGNARE));

  // Ordine bucket: outlet (alfabetici, SEDE in coda) → Da assegnare → Amministratori.
  const outletRank = useMemo(() => {
    const order = sortOutlets(outlets).map((o) => o.name.toLowerCase());
    return (name: string) => {
      if (name === AMMINISTRATORI) return 100000;
      if (name === DA_ASSEGNARE) return 90000;
      const i = order.indexOf(name.toLowerCase());
      return i >= 0 ? i : 80000;
    };
  }, [outlets]);

  // Raggruppamento del mese selezionato: bucket → dipendenti.
  const groups = useMemo(() => {
    const byBucket = new Map<string, PgceRow[]>();
    for (const r of monthRows) {
      const k = bucketOf(r);
      if (!byBucket.has(k)) byBucket.set(k, []);
      byBucket.get(k)!.push(r);
    }
    return [...byBucket.entries()]
      .map(([name, emps]) => ({ name, emps: emps.sort((a, b) => b.lordo - a.lordo), tot: Math.round(emps.reduce((s, e) => s + e.lordo, 0) * 100) / 100 }))
      .sort((a, b) => outletRank(a.name) - outletRank(b.name) || a.name.localeCompare(b.name, 'it'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthRows, outletRank, outletByEmp, empIdByMat, empIdByName]);

  const monthTotal = useMemo(() => monthRows.reduce((s, r) => s + r.lordo, 0), [monthRows]);
  const periodTotal = useMemo(() => rows.reduce((s, r) => s + r.lordo, 0), [rows]);
  const periodMonths = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) m.set(r.month, (m.get(r.month) || 0) + r.lordo);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([mm, lordo]) => ({ mm, lordo }));
  }, [rows]);
  const periodLabel = periodMonths.length ? `${MESI_LBL[periodMonths[0].mm].slice(0, 3)}–${MESI_LBL[periodMonths[periodMonths.length - 1].mm].slice(0, 3)} ${year}` : `${year}`;

  const toggle = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // -------------------------------------------------------------- import
  const onPick = async (file?: File | null) => {
    if (!file) return;
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (!isPdf) { toast({ type: 'error', message: 'Carica la «Statistica costo orario» in formato PDF.' }); return; }
    setFileObj(file);
    try {
      const { extractPdfItemsOriented } = await import('../lib/pdfText');
      const pages = await extractPdfItemsOriented(file);
      const companies = listStatisticaCompanies(pages);
      if (companies.length === 0) {
        toast({ type: 'error', message: 'Il PDF non sembra una «Statistica costo orario»: nessuna azienda riconosciuta. Il file resta in archivio (Archivio documenti → Caricamenti).' });
        await archiviaFile({ file, companyId, userId, modulo: 'Personale',
          funzione: 'Statistica costo orario · file non riconosciuto', bucket: 'employee-documents',
          note: 'Nessuna azienda riconosciuta nel PDF.' });
        return;
      }
      if (companies.length === 1) { runParse(pages, companies[0], file.name); return; }
      setCompanyPick({ pages, companies, fileName: file.name });
    } catch (e) { console.error(e); toast({ type: 'error', message: 'Impossibile leggere il PDF.' }); }
  };
  const runParse = (pages: any[][], company: { code: string; name: string }, fileName: string) => {
    const res = parseStatisticaCostoOrario(pages, { companyCode: company.code });
    if (!res.isStatistica || res.rows.length === 0) {
      // Il caso piu' frequente non e' «manca l'azienda»: e' il documento
      // sbagliato. I tabulati dei netti hanno il nome dell'azienda in testa, per
      // cui l'azienda viene riconosciuta e il vecchio messaggio diceva
      // «Nessun dato per NEW ZAGO SRL», che non aiuta nessuno.
      const testo = pages.map((items) => (items || []).map((i: any) => i?.str ?? '').join(' ')).join(' ');
      const quale = tabulatoNetti(testo);
      toast({ type: 'error', message: quale
        ? `Questo è ${quale === 'negativi' ? 'l’elenco dei netti negativi' : 'l’elenco netti'}, non la «Statistica costo orario»: il netto in busta si carica dalla scheda «Costi & cedolini».`
        : `Nessun dato per ${company.name} nel file: sembra un altro documento. Qui va la «Statistica costo orario» del software paghe.` });
      return;
    }
    setCompanyPick(null);
    setPreview({ companyCode: company.code, companyName: company.name, res, fileName });
  };

  const confirmSave = async () => {
    if (!preview) return;
    const { res, fileName } = preview;
    // Guardia totale di controllo: se il file stampa "Totale aziendale" e non quadra, blocca.
    if (res.controlTotal != null && Math.abs(res.totalLordo - res.controlTotal) > 0.01) {
      toast({ type: 'error', message: `Totale letto ${eurFmt.format(res.totalLordo)} € ≠ totale di controllo del file ${eurFmt.format(res.controlTotal)} €. Import annullato (parser da rivedere).` });
      return;
    }
    setImporting(true);
    try {
      // Risoluzione data-driven: matricola → employee_id, outlet (allocazione primaria), is_admin (ruolo).
      let documentId: string | null = null;
      if (fileObj) {
        const archiviato = await archiviaFile({
          file: fileObj, companyId, userId, modulo: 'Personale',
          funzione: 'Statistica costo orario (costo lordo per dipendente)',
          bucket: 'employee-documents', year: res.rows[0]?.year ?? null, month: null,
          referenceTable: 'personnel_gross_cost_employee_imports',
        });
        documentId = archiviato.id;
        if (archiviato.errore) toast({ type: 'error', message: avvisoArchiviazioneFallita(fileName, archiviato.errore) });
      }

      const [{ data: emps }, { data: allocs }, { data: mats }] = await Promise.all([
        sb.from('employees').select('id, matricola, role_description, qualifica, notes, note').eq('company_id', companyId),
        sb.from('employee_outlet_allocations').select('employee_id, outlet_code, is_primary').eq('company_id', companyId),
        sb.from('employee_matricole').select('matricola, employee_id').eq('company_id', companyId),
      ]);
      const empById = new Map<string, any>((emps || []).map((e: any) => [String(e.id), e]));
      const empByMat = new Map<string, any>((emps || []).map((e: any) => [norm(e.matricola), e]));
      // Il registro copre le matricole precedenti: senza, chi cambia matricola
      // diventa una riga orfana, senza dipendente e senza punto vendita.
      for (const m of ((mats as { matricola: string; employee_id: string }[]) || [])) {
        const e = empById.get(String(m.employee_id));
        if (e && !empByMat.has(norm(m.matricola))) empByMat.set(norm(m.matricola), e);
      }
      const byName = nameIndex((emps as { id: string; nome: string | null; cognome: string | null }[]) || []);
      // Persona trovata: matricola corrente, matricola precedente, e in ultimo il
      // nome (solo se unico). Senza questa cascata la riga resta senza dipendente
      // e senza punto vendita ogni volta che il software paghe cambia matricola.
      const findEmp = (matricola: string, nomeCompleto: string | null) =>
        empByMat.get(norm(matricola)) || empById.get(String(byName.get(norm(nomeCompleto)) || '')) || undefined;
      const outletByEmp = new Map<string, string>();
      for (const a of (allocs || []) as any[]) {
        if (!outletByEmp.has(a.employee_id) || a.is_primary) outletByEmp.set(a.employee_id, a.outlet_code);
      }
      const isAdminMat = (e: any) => !!e && /amministrat/i.test(`${e.qualifica || ''} ${e.role_description || ''} ${e.note || e.notes || ''}`);

      const months = [...new Set(res.rows.map((r) => r.month))].sort((a, b) => a - b);
      const periodTxt = months.length ? `${MESI_LBL[months[0]].slice(0, 3)}–${MESI_LBL[months[months.length - 1]].slice(0, 3)} ${res.rows[0].year}` : null;
      const { data: imp, error: impErr } = await sb.from('personnel_gross_cost_employee_imports').insert({
        company_id: companyId, file_name: fileName, period_label: periodTxt,
        rows_total: res.rows.length, employees_total: res.employees, file_total: res.totalLordo, imported_by: userId,
        import_document_id: documentId,
      }).select('id').single();
      if (impErr) throw impErr;
      const importId = (imp as any)?.id ?? null;
      if (documentId && importId) await supabase.from('import_documents').update({ reference_id: importId }).eq('id', documentId);

      const payload = res.rows.map((r) => {
        const e = findEmp(r.matricola, r.name);
        const admin = isAdminMat(e);
        return {
          company_id: companyId, employee_id: e?.id ?? null, matricola: r.matricola, employee_name: r.name,
          outlet_code: admin ? null : (e ? (outletByEmp.get(e.id) ?? null) : null), is_admin: admin,
          year: r.year, month: r.month, retribuzione: r.retribuzione, contribuzione: r.contribuzione,
          inail: r.inail, tfr: r.tfr, lordo: r.lordo, source_file: fileName, import_id: importId, updated_at: new Date().toISOString(),
        };
      });
      // Stessa matricola due volte nello stesso mese (persona su due filiali):
      // il lotto verrebbe rifiutato in blocco. Si sommano le componenti.
      const { rows: uniquePayload, mergedKeys } = mergeSumByKey(
        payload as any[], (r: any) => `${r.company_id}|${r.matricola}|${r.year}|${r.month}`,
        ['retribuzione', 'contribuzione', 'inail', 'tfr', 'lordo'],
      );
      const { error: upErr } = await sb.from('personnel_gross_cost_employee').upsert(uniquePayload, { onConflict: 'company_id,matricola,year,month' });
      if (upErr) throw upErr;

      const unmatched = uniquePayload.filter((p: any) => !p.employee_id).length;
      const mergedTxt = mergedKeys.length ? ` · ${mergedKeys.length} righe doppie sommate` : '';
      toast({ type: 'success', message: `Importati ${res.employees} dipendenti · ${uniquePayload.length} righe mese · totale ${eurFmt.format(res.totalLordo)} €${unmatched ? ` · ${unmatched} righe da assegnare` : ''}${mergedTxt}.` });
      setPreview(null); setFileObj(null);
      await load();
    } catch (e: any) {
      console.error(e);
      toast({ type: 'error', message: `Errore nel salvataggio: ${readableDbError(e)}` });
    } finally { setImporting(false); }
  };

  const exportData = monthRows
    .slice().sort((a, b) => outletRank(bucketOf(a)) - outletRank(bucketOf(b)) || b.lordo - a.lordo)
    .map((r) => ({ outlet: bucketOf(r), matricola: r.matricola, dipendente: r.employee_name || r.matricola, retribuzione: r.retribuzione, contribuzione: r.contribuzione, inail: r.inail, tfr: r.tfr, lordo: r.lordo }));
  const exportCols = [
    { key: 'outlet', label: 'Outlet' }, { key: 'matricola', label: 'Matricola' }, { key: 'dipendente', label: 'Dipendente' },
    { key: 'retribuzione', label: 'Retribuzione', format: 'euro' as const }, { key: 'contribuzione', label: 'Contribuzione', format: 'euro' as const },
    { key: 'inail', label: 'INAIL', format: 'euro' as const }, { key: 'tfr', label: 'TFR (incl. in retrib.)', format: 'euro' as const },
    { key: 'lordo', label: 'Costo lordo', format: 'euro' as const },
  ];

  return (
    <div className="space-y-5">
      {/* KPI periodo / mese */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi label={`Costo lordo · ${monthLabel} ${year}`} value={`${eurFmt.format(monthTotal)} €`} sub={`${monthRows.length} dipendenti nel mese`} icon={Users} source="neutro" />
        <Kpi label={`Costo lordo · ${periodLabel}`} value={`${eurFmt.format(periodTotal)} €`} sub={`${new Set(rows.map((r) => r.matricola)).size} dipendenti · ${periodMonths.length} mesi`} icon={FileText} source="neutro" />
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">Riepilogo periodo</div>
            <div className="mt-1 space-y-0.5">
              {periodMonths.map((m) => (
                <div key={m.mm} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">{MESI_LBL[m.mm]}</span><Money v={m.lordo} />
                </div>
              ))}
            </div>
          </div>
          {monthRows.length > 0 && <div className="mt-3"><ExportMenu data={exportData} columns={exportCols} filename={`costo_lordo_dipendenti_${year}_${String(month).padStart(2, '0')}`} title={`Costo lordo per dipendente · ${monthLabel} ${year}`} /></div>}
        </div>
      </div>

      {/* Import "Statistica costo orario" */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onPick(e.dataTransfer.files?.[0]); }}
        className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}
      >
        <FileUp size={26} className="mx-auto text-slate-400 mb-2" />
        <div className="text-sm font-semibold text-slate-800">Import costo lordo per dipendente — «Statistica costo orario» (PDF)</div>
        <div className="text-xs text-slate-500 mt-1 mb-3">Report Paghe Infinity con il dettaglio per dipendente e mese. Trascina qui il PDF, oppure</div>
        <button onClick={() => fileRef.current?.click()} className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center gap-1.5"><Upload size={15} /> Scegli il PDF</button>
        <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="text-[11px] text-slate-400 mt-3">Il file può contenere più aziende: sceglierai quale importare. Re-importare lo stesso mese <strong>aggiorna</strong> i dati, non li duplica.</div>
      </div>

      {/* Breakdown per outlet → dipendente */}
      {loading ? (
        <div className="text-slate-400 py-10 text-center">Caricamento…</div>
      ) : monthRows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">
          Nessun costo lordo per dipendente in <strong>{monthLabel} {year}</strong>.{' '}
          {periodMonths.length > 0 ? <>Seleziona un mese tra <strong>{periodMonths.map((m) => MESI_LBL[m.mm]).join(', ')}</strong> dal selettore in alto, oppure importa il report del mese.</> : <>Importa la «Statistica costo orario» qui sopra.</>}
        </div>
      ) : (
        <div className="space-y-2.5">
          {groups.map((g) => {
            const isOpen = expanded.has(g.name);
            const prosp = prospettoByOutlet.get(g.name.toLowerCase());
            const diff = prosp != null ? g.tot - prosp : null;
            const special = g.name === DA_ASSEGNARE || g.name === AMMINISTRATORI;
            return (
              <div key={g.name} className={`bg-white rounded-2xl border overflow-hidden ${g.name === DA_ASSEGNARE ? 'border-amber-200' : 'border-slate-200'}`}>
                <button onClick={() => toggle(g.name)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    {isOpen ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                    <span className={`font-semibold truncate ${g.name === DA_ASSEGNARE ? 'text-amber-700' : 'text-slate-800'}`}>{g.name}</span>
                    <span className="text-xs text-slate-400 shrink-0">· {g.emps.length} dip.</span>
                    {g.name === DA_ASSEGNARE && <span className="text-[11px] text-amber-600 hidden sm:inline">matricole non in anagrafica o senza outlet — assegnabili</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {!special && diff != null && Math.abs(diff) > 1 && (
                      <UiTooltip content={`Prospetto paghe (per outlet): ${eurFmt.format(prosp!)} €\nSomma dipendenti: ${eurFmt.format(g.tot)} €\nDifferenza: ${eurFmt.format(diff)} €\n(i due report definiscono le voci in modo diverso: scarto atteso)`}>
                        <span className="text-[11px] text-slate-400 cursor-help border-b border-dotted border-slate-300">Δ Prospetto {eurFmt.format(diff)} €</span>
                      </UiTooltip>
                    )}
                    <Money v={g.tot} strong />
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 overflow-x-auto scroll-shadow-x">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-5 py-2 text-left font-bold">Dipendente</th>
                          <th className="px-3 py-2 text-right font-bold">Retrib.</th>
                          <th className="px-3 py-2 text-right font-bold">Contrib.</th>
                          <th className="px-3 py-2 text-right font-bold">INAIL</th>
                          <th className="px-4 py-2 text-right font-bold">Costo lordo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {g.emps.map((e) => (
                          <tr key={e.id} className="hover:bg-slate-50">
                            <td className="px-5 py-2">
                              <UiTooltip content={`Matricola ${e.matricola}${e.employee_id ? '' : ' · non in anagrafica'}\nRetribuzione: ${eurFmt.format(e.retribuzione)} € (di cui TFR ${eurFmt.format(e.tfr)} €, già incluso)\nContribuzione: ${eurFmt.format(e.contribuzione)} €\nINAIL: ${eurFmt.format(e.inail)} €`}>
                                <span className="text-slate-800 cursor-help border-b border-dotted border-slate-300">{e.employee_name || e.matricola}</span>
                              </UiTooltip>
                              {!e.employee_id && <span className="ml-2 text-[11px] text-amber-600">nuova matricola</span>}
                            </td>
                            <td className="px-3 py-2 text-right"><Money v={e.retribuzione} /></td>
                            <td className="px-3 py-2 text-right"><Money v={e.contribuzione} /></td>
                            <td className="px-3 py-2 text-right"><Money v={e.inail} /></td>
                            <td className="px-4 py-2 text-right"><Money v={e.lordo} strong /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between px-5 py-3 bg-slate-50 rounded-2xl border border-slate-200">
            <span className="font-semibold text-slate-700">Totale costo lordo · {monthLabel} {year}</span>
            <Money v={monthTotal} strong />
          </div>
        </div>
      )}

      {/* Scelta azienda (file multi-azienda) */}
      {companyPick && (
        <Modal title="Quale azienda importare?" onClose={() => !importing && setCompanyPick(null)} maxW="max-w-md">
          <div className="text-xs text-slate-500 mb-3">Il file <strong>{companyPick.fileName}</strong> contiene più aziende. Importa quella di questo gestionale.</div>
          <div className="space-y-2">
            {companyPick.companies.map((c) => (
              <button key={c.code} onClick={() => runParse(companyPick.pages, c, companyPick.fileName)} className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors">
                <div className="font-medium text-slate-800">{c.name}</div>
                <div className="text-xs text-slate-400">codice {c.code}</div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* Anteprima import */}
      {preview && (
        <Modal title="Anteprima import — Statistica costo orario" onClose={() => !importing && setPreview(null)} maxW="max-w-2xl">
          <div className="text-xs text-slate-500 mb-3">File: <strong>{preview.fileName}</strong> · Azienda <strong>{preview.companyName}</strong> · {preview.res.employees} dipendenti · {preview.res.rows.length} righe mese.</div>
          <div className="rounded-xl border border-slate-200 overflow-hidden mb-3">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-2 text-left font-bold">Mese</th><th className="px-4 py-2 text-right font-bold">Costo lordo</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {preview.res.monthly.map((m) => (
                  <tr key={m.month}><td className="px-4 py-2 text-slate-700">{MESI_LBL[m.month]} {preview.res.rows[0]?.year}</td><td className="px-4 py-2 text-right"><Money v={m.lordo} /></td></tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-semibold"><tr><td className="px-4 py-2 text-slate-700">Totale</td><td className="px-4 py-2 text-right"><Money v={preview.res.totalLordo} strong /></td></tr></tfoot>
            </table>
          </div>
          {preview.res.controlTotal != null && (
            <div className={`flex items-start gap-2 text-sm rounded-xl px-4 py-2.5 ${Math.abs(preview.res.totalLordo - preview.res.controlTotal) > 0.01 ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`}>
              {Math.abs(preview.res.totalLordo - preview.res.controlTotal) > 0.01 ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
              <div>Totale di controllo del file («Totale aziendale»): <strong>{eurFmt.format(preview.res.controlTotal)} €</strong>. {Math.abs(preview.res.totalLordo - preview.res.controlTotal) > 0.01 ? 'NON quadra con il totale letto: l’import sarà bloccato.' : 'Quadra con il totale letto.'}</div>
            </div>
          )}
          <div className="flex items-center justify-between mt-4">
            <div className="text-xs text-slate-400">Salvataggio idempotente: outlet e amministratori risolti dall’anagrafica.</div>
            <div className="flex gap-2">
              <button onClick={() => setPreview(null)} disabled={importing} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Annulla</button>
              <button onClick={confirmSave} disabled={importing} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 inline-flex items-center gap-1.5"><CheckCircle2 size={15} /> {importing ? 'Salvataggio…' : 'Conferma e salva'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CostiLordoTab({ companyId, userId, outlets, year, month, monthLabel }: {
  companyId: string; userId: string | null; outlets: OutletRow[]; year: number; month: number; monthLabel: string;
}) {
  const { toast } = useToast();
  // I tipi generati di Supabase non includono ancora le tabelle nuove (migration 068):
  // accesso untyped a personnel_gross_cost / inail_rates / v_personnel_gross_cost.
  const sb: any = supabase;
  const [rows, setRows] = useState<GrossRow[]>([]);
  const [rates, setRates] = useState<InailRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ rows: ProspettoOutletRow[]; fileName: string; tipiCedolino: string[]; soloNormale: boolean } | null>(null);
  const [fileObj, setFileObj] = useState<File | null>(null);
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);

  const outletById = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const outletIdByName = useMemo(() => new Map(outlets.map((o) => [o.name, o.id])), [outlets]);
  const rateByPat = useMemo(() => new Map(rates.map((r) => [r.pat_label, r.rate_percent])), [rates]);

  const load = async () => {
    setLoading(true);
    const [g, r] = await Promise.all([
      sb.from('v_personnel_gross_cost').select('*').eq('company_id', companyId).eq('year', year).eq('month', month),
      sb.from('inail_rates').select('*').eq('company_id', companyId).order('pat_label'),
    ]);
    setRows((g.data as any as GrossRow[]) || []);
    setRates((r.data as any as InailRateRow[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId, year, month]);

  // INAIL stimato in anteprima usando i tassi già salvati (0 dove il tasso manca).
  const inailPreview = (pats: ProspettoOutletRow['inailPat']) =>
    pats.reduce((s, p) => s + p.imponibile * ((rateByPat.get(p.label) ?? 0) / 100), 0);
  const costoLordoPreview = (r: ProspettoOutletRow) =>
    (r.totaleRetribuzioni || 0) - r.compensiAmm + contrAziendaOutlet(r) + inailPreview(r.inailPat) + r.tfrFondo;

  const onPick = (file?: File | null) => {
    if (!file) return;
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (!isPdf) { toast({ type: 'error', message: 'Carica il Prospetto paghe in formato PDF.' }); return; }
    (async () => {
      try {
        const { extractPdfLines } = await import('../lib/pdfText');
        const lines = await extractPdfLines(file);
        const parsed = parseProspettoPaghe(lines, outlets as any);
        if (!parsed.isProspetto || parsed.rows.length === 0) {
          toast({ type: 'error', message: 'Il PDF non sembra un «Prospetto riepilogativo elaborazione paghe»: nessun dato per outlet riconosciuto. Il file resta in archivio (Archivio documenti → Caricamenti).' });
          await archiviaFile({ file, companyId, userId, modulo: 'Personale',
            funzione: 'Prospetto paghe · file non riconosciuto', bucket: 'employee-documents',
            note: 'Nessun dato per outlet riconosciuto nel PDF.' });
          return;
        }
        setFileObj(file);
        setPreview({ rows: parsed.rows, fileName: file.name, tipiCedolino: parsed.tipiCedolino, soloNormale: parsed.soloNormale });
      } catch (e) {
        console.error(e);
        toast({ type: 'error', message: 'Impossibile leggere il PDF.' });
      }
    })();
  };

  const confirmSave = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const pr = preview.rows;
      const fileTotal = pr.reduce((s, r) => s + (r.totaleRetribuzioni || 0), 0);
      const first = pr[0];
      // Log import (uno per file). I mesi reali sono comunque sulle singole righe.
      let documentId: string | null = null;
      if (fileObj) {
        const archiviato = await archiviaFile({
          file: fileObj, companyId, userId, modulo: 'Personale',
          funzione: 'Prospetto riepilogativo elaborazione paghe (costo lordo per outlet)',
          bucket: 'employee-documents', year: first.year, month: first.month,
          referenceTable: 'personnel_gross_cost_imports',
        });
        documentId = archiviato.id;
        if (archiviato.errore) toast({ type: 'error', message: avvisoArchiviazioneFallita(preview.fileName, archiviato.errore) });
      }

      const { data: imp, error: impErr } = await sb.from('personnel_gross_cost_imports').insert({
        company_id: companyId, year: first.year, month: first.month, file_name: preview.fileName,
        outlets_total: pr.length, file_total: fileTotal, imported_by: userId,
        import_document_id: documentId,
      }).select('id').single();
      if (impErr) throw impErr;
      const importId = (imp as any)?.id ?? null;
      if (documentId && importId) await supabase.from('import_documents').update({ reference_id: importId }).eq('id', documentId);

      const payload = pr.map((r) => ({
        company_id: companyId,
        outlet_id: outletIdByName.get(r.outlet) ?? null,
        outlet_label: r.filialeName,
        filiale_code: r.filialeCode,
        year: r.year, month: r.month,
        numero_dipendenti: r.numeroDipendenti,
        retribuzioni_lorde: r.retribuzioniLorde,
        totale_retribuzioni: r.totaleRetribuzioni,
        compensi_amm: r.compensiAmm,
        contr_inps: r.contrInps, contr_ebinter: r.contrEbinter, contr_est: r.contrEst,
        contr_gestione_separata: r.contrGestioneSeparata, tfr_fondo: r.tfrFondo,
        inail_pat: r.inailPat,
        source_file: preview.fileName, import_id: importId,
        updated_at: new Date().toISOString(),
      }));
      // Stessa filiale ripetuta nel file per lo stesso mese: si sommano gli importi
      // invece di far rifiutare l'intero lotto al database.
      const { rows: uniqueGross } = mergeSumByKey(
        payload as any[], (r: any) => `${r.company_id}|${r.filiale_code}|${r.year}|${r.month}`,
        ['numero_dipendenti', 'retribuzioni_lorde', 'totale_retribuzioni', 'compensi_amm',
         'contr_inps', 'contr_ebinter', 'contr_est', 'contr_gestione_separata', 'tfr_fondo'],
      );
      const { error: upErr } = await sb.from('personnel_gross_cost')
        .upsert(uniqueGross, { onConflict: 'company_id,filiale_code,year,month' });
      if (upErr) throw upErr;

      // Seed PAT INAIL (senza mai sovrascrivere i tassi già inseriti da Lilian).
      const patSeen = new Map<string, string | null>();
      for (const r of pr) for (const p of r.inailPat) {
        if (!patSeen.has(p.label)) patSeen.set(p.label, outletIdByName.get(r.outlet) ?? null);
      }
      if (patSeen.size) {
        const ratePayload = [...patSeen.entries()].map(([pat_label, outlet_id]) => ({
          company_id: companyId, pat_label, outlet_id, rate_percent: null as number | null,
        }));
        await sb.from('inail_rates').upsert(ratePayload, { onConflict: 'company_id,pat_label', ignoreDuplicates: true });
      }

      const monthsLbl = [...new Set(pr.map((r) => `${MESI_LBL[r.month]} ${r.year}`))].join(', ');
      toast({ type: 'success', message: `Salvati ${pr.length} outlet (${monthsLbl}). Totale retribuzioni ${eurFmt.format(fileTotal)} €.` });
      setPreview(null); setFileObj(null);
      await load();
    } catch (e: any) {
      console.error(e);
      toast({ type: 'error', message: `Errore nel salvataggio: ${readableDbError(e)}` });
    } finally {
      setImporting(false);
    }
  };

  const saveRate = async (rate: InailRateRow) => {
    const raw = rateDraft[rate.id];
    if (raw === undefined) return;
    const val = raw.trim() === '' ? null : parseItNum(raw);
    const { error } = await sb.from('inail_rates').update({ rate_percent: val, updated_at: new Date().toISOString() }).eq('id', rate.id);
    if (error) { toast({ type: 'error', message: 'Tasso non salvato: ' + error.message }); return; }
    toast({ type: 'success', message: `Tasso INAIL aggiornato per ${rate.pat_label}.` });
    setRateDraft((d) => { const n = { ...d }; delete n[rate.id]; return n; });
    await load();
  };

  // Ordinamento: outlet veri (alfabetici) → SEDE → "Non attribuito" in fondo.
  const sortedRows = useMemo(() => {
    const order = sortOutlets(outlets).map((o) => o.id);
    return [...rows].sort((a, b) => {
      const ia = a.outlet_id ? order.indexOf(a.outlet_id) : 999;
      const ib = b.outlet_id ? order.indexOf(b.outlet_id) : 999;
      return (ia < 0 ? 998 : ia) - (ib < 0 ? 998 : ib);
    });
  }, [rows, outlets]);

  const outletNameOf = (r: GrossRow) => (r.outlet_id ? (outletById.get(r.outlet_id)?.name || r.outlet_label || '—') : (r.outlet_label || 'Non attribuito'));

  // Costo lordo per outlet dal Prospetto (per riconciliare col rollup dipendenti).
  const prospettoByOutlet = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(outletNameOf(r).toLowerCase(), (m.get(outletNameOf(r).toLowerCase()) || 0) + r.costo_lordo_outlet);
    return m;
  }, [rows, outletById]);

  const tot = useMemo(() => rows.reduce((a, r) => ({
    dip: a.dip + (r.numero_dipendenti || 0),
    retr: a.retr + (r.totale_retribuzioni || 0),
    ca: a.ca + r.contr_azienda,
    inail: a.inail + r.inail_calcolato,
    tfr: a.tfr + r.tfr_fondo,
    costo: a.costo + r.costo_lordo_outlet,
    amm: a.amm + r.amministratori_totale,
  }), { dip: 0, retr: 0, ca: 0, inail: 0, tfr: 0, costo: 0, amm: 0 }), [rows]);

  const adminRows = useMemo(() => rows.filter((r) => r.amministratori_totale > 0), [rows]);
  const anyInailMissing = rows.some((r) => r.inail_incompleto);

  const exportData = sortedRows.map((r) => ({
    outlet: outletNameOf(r), filiale: r.filiale_code, dipendenti: r.numero_dipendenti ?? 0,
    totale_retribuzioni: r.totale_retribuzioni ?? 0, compensi_amm: r.compensi_amm,
    contr_azienda: r.contr_azienda, inail: r.inail_calcolato, tfr_fondo: r.tfr_fondo,
    contr_gestione_separata: r.contr_gestione_separata, costo_lordo_outlet: r.costo_lordo_outlet,
    amministratori_totale: r.amministratori_totale,
  }));
  const exportCols = [
    { key: 'outlet', label: 'Outlet' }, { key: 'filiale', label: 'Codice filiale' },
    { key: 'dipendenti', label: 'N. dipendenti' },
    { key: 'totale_retribuzioni', label: 'Totale retribuzioni', format: 'euro' as const },
    { key: 'compensi_amm', label: 'Compensi amministratori (escl. outlet)', format: 'euro' as const },
    { key: 'contr_azienda', label: 'Contributi azienda (INPS+EBINTER+EST)', format: 'euro' as const },
    { key: 'inail', label: 'INAIL calcolato', format: 'euro' as const },
    { key: 'tfr_fondo', label: 'TFR a fondo', format: 'euro' as const },
    { key: 'contr_gestione_separata', label: 'INPS Gestione separata (amministratori)', format: 'euro' as const },
    { key: 'costo_lordo_outlet', label: 'Costo lordo outlet', format: 'euro' as const },
    { key: 'amministratori_totale', label: 'Totale amministratori', format: 'euro' as const },
  ];

  return (
    <div className="space-y-8">
      {/* Layer per DIPENDENTE/MESE — drillabile outlet → dipendente (sorgente: Statistica costo orario) */}
      <CostiLordoDipendentiBlock
        companyId={companyId}
        userId={userId}
        outlets={outlets}
        year={year}
        month={month}
        monthLabel={monthLabel}
        prospettoByOutlet={prospettoByOutlet}
      />

      {/* Vista per OUTLET dal Prospetto paghe — riconciliazione e tassi INAIL */}
      <div className="pt-2">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-sm font-semibold text-slate-700">Vista per outlet — Prospetto paghe</div>
          <span className="text-xs text-slate-400">riconciliazione e tassi INAIL · {monthLabel} {year}</span>
        </div>
    <div className="space-y-5">
      {/* Import tile + export */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onPick(e.dataTransfer.files?.[0]); }}
            className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}
          >
            <FileUp size={26} className="mx-auto text-slate-400 mb-2" />
            <div className="text-sm font-semibold text-slate-800">Import costi lordi — Prospetto paghe (PDF)</div>
            <div className="text-xs text-slate-500 mt-1 mb-3">Trascina qui il «Prospetto riepilogativo elaborazione paghe» del mese, oppure</div>
            <button onClick={() => fileRef.current?.click()} className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center gap-1.5"><Upload size={15} /> Scegli il PDF</button>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="text-[11px] text-slate-400 mt-3">Il sistema riconosce gli outlet e il mese dal file. Re-importare lo stesso mese <strong>aggiorna</strong> i dati, non li duplica.</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">Periodo</div>
            <div className="text-lg font-bold text-slate-900">{monthLabel} {year}</div>
            <div className="text-xs text-slate-400 mt-1">{rows.length} outlet con dati</div>
          </div>
          {rows.length > 0 && <div className="mt-3"><ExportMenu data={exportData} columns={exportCols} filename={`costo_lordo_${year}_${String(month).padStart(2, '0')}`} title={`Costo lordo ${monthLabel} ${year}`} /></div>}
        </div>
      </div>

      {anyInailMissing && (
        <div className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>Alcune PAT non hanno ancora il <strong>tasso INAIL</strong>: il loro INAIL è calcolato a 0. Inseriscili nella sezione <strong>Tassi INAIL</strong> qui sotto perché il costo lordo sia completo.</div>
        </div>
      )}

      {/* Breakdown per outlet */}
      {loading ? (
        <div className="text-slate-400 py-10 text-center">Caricamento…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">
          Nessun costo lordo per <strong>{monthLabel} {year}</strong>. Importa il Prospetto paghe del mese qui sopra.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">Costo del lavoro per outlet · {monthLabel} {year}</div>
          <div className="overflow-x-auto scroll-shadow-x">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-bold">Outlet</th>
                  <th className="px-3 py-2.5 text-right font-bold">Dip.</th>
                  <th className="px-3 py-2.5 text-right font-bold">Totale retrib.</th>
                  <th className="px-3 py-2.5 text-right font-bold">Contributi azienda</th>
                  <th className="px-3 py-2.5 text-right font-bold">INAIL</th>
                  <th className="px-3 py-2.5 text-right font-bold">TFR fondo</th>
                  <th className="px-4 py-2.5 text-right font-bold">Costo lordo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRows.map((r) => {
                  const breakdown = `Filiale ${r.filiale_code}${r.outlet_label ? ' · ' + r.outlet_label : ''}\nTotale retribuzioni: ${eurFmt.format(r.totale_retribuzioni || 0)} €\n  di cui compensi amministratori (esclusi): ${eurFmt.format(r.compensi_amm)} €\nINPS: ${eurFmt.format(r.contr_inps)} €  ·  EBINTER: ${eurFmt.format(r.contr_ebinter)} €  ·  EST: ${eurFmt.format(r.contr_est)} €\nTFR a fondo: ${eurFmt.format(r.tfr_fondo)} €`;
                  const inailTip = r.inail_pat.length
                    ? r.inail_pat.map((p) => `${p.label}: imponibile ${eurFmt.format(p.imponibile)} € × ${rateByPat.get(p.label) != null ? rateByPat.get(p.label) + '%' : 'tasso da inserire'}`).join('\n')
                    : 'Nessuna PAT INAIL nel prospetto';
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <UiTooltip content={breakdown}>
                          <span className="font-medium text-slate-800 cursor-help border-b border-dotted border-slate-300">{outletNameOf(r)}</span>
                        </UiTooltip>
                        {!r.outlet_id && <span className="ml-2 text-[11px] text-amber-600">non attribuito</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{r.numero_dipendenti ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right"><Money v={r.totale_retribuzioni} /></td>
                      <td className="px-3 py-2.5 text-right"><Money v={r.contr_azienda} /></td>
                      <td className="px-3 py-2.5 text-right">
                        <UiTooltip content={inailTip}>
                          <span className="cursor-help inline-flex items-center gap-1">
                            {r.inail_incompleto && <AlertCircle size={13} className="text-amber-500" />}
                            <Money v={r.inail_calcolato} />
                          </span>
                        </UiTooltip>
                      </td>
                      <td className="px-3 py-2.5 text-right"><Money v={r.tfr_fondo} /></td>
                      <td className="px-4 py-2.5 text-right"><Money v={r.costo_lordo_outlet} strong /></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 font-semibold">
                <tr>
                  <td className="px-4 py-2.5 text-slate-700">Totale outlet</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{tot.dip}</td>
                  <td className="px-3 py-2.5 text-right"><Money v={tot.retr} /></td>
                  <td className="px-3 py-2.5 text-right"><Money v={tot.ca} /></td>
                  <td className="px-3 py-2.5 text-right"><Money v={tot.inail} /></td>
                  <td className="px-3 py-2.5 text-right"><Money v={tot.tfr} /></td>
                  <td className="px-4 py-2.5 text-right"><Money v={tot.costo} strong /></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Amministratori — voce SEPARATA dal costo outlet */}
          {adminRows.length > 0 && (
            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/60">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-700">Amministratori <span className="font-normal text-slate-400">· fuori dal costo outlet</span></div>
                <Money v={tot.amm} strong />
              </div>
              <div className="mt-2 space-y-1">
                {adminRows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs text-slate-500">
                    <UiTooltip content={`Compensi Collaboratori/Amministratori: ${eurFmt.format(r.compensi_amm)} €\nINPS Gestione separata (Contr.Azienda): ${eurFmt.format(r.contr_gestione_separata)} €`}>
                      <span className="cursor-help">{outletNameOf(r)} — compensi {eurFmt.format(r.compensi_amm)} € + gest. separata {eurFmt.format(r.contr_gestione_separata)} €</span>
                    </UiTooltip>
                    <Money v={r.amministratori_totale} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tassi INAIL */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-700"><Percent size={15} /> Tassi INAIL per PAT</div>
        {rates.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">
            Nessuna PAT ancora rilevata. <strong>Importa un Prospetto paghe</strong>: le PAT compaiono qui e potrai inserire il tasso di ciascuna.<br />
            <span className="text-xs">Il tasso INAIL si recupera dall'autoliquidazione INAIL annuale, dal portale INAIL o dallo studio paghe (è un'aliquota %, es. 1,2345).</span>
          </div>
        ) : (
          <div className="overflow-x-auto scroll-shadow-x">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-bold">PAT</th>
                  <th className="px-4 py-2.5 text-left font-bold">Outlet</th>
                  <th className="px-4 py-2.5 text-right font-bold">Tasso %</th>
                  <th className="px-4 py-2.5 text-right font-bold"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rates.map((rt) => {
                  const draft = rateDraft[rt.id];
                  const dirty = draft !== undefined && draft !== (rt.rate_percent == null ? '' : String(rt.rate_percent).replace('.', ','));
                  const missing = rt.rate_percent == null;
                  return (
                    <tr key={rt.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{rt.pat_label}{missing && <span className="ml-2 text-[11px] text-amber-600">tasso da inserire</span>}</td>
                      <td className="px-4 py-2.5 text-slate-500">{rt.outlet_id ? (outletById.get(rt.outlet_id)?.name || '—') : '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <input
                          value={draft !== undefined ? draft : (rt.rate_percent == null ? '' : String(rt.rate_percent).replace('.', ','))}
                          onChange={(e) => setRateDraft((d) => ({ ...d, [rt.id]: e.target.value }))}
                          placeholder="—"
                          inputMode="decimal"
                          className={`w-24 text-right px-2 py-1 rounded-lg border tabular-nums ${missing && draft === undefined ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => saveRate(rt)} disabled={!dirty} className={`px-2.5 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1 ${dirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400'}`}><Save size={13} /> Salva</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Anteprima import */}
      {preview && (
        <Modal title="Anteprima import — Prospetto paghe" onClose={() => !importing && setPreview(null)} maxW="max-w-4xl">
          <div className="text-xs text-slate-500 mb-3">
            File: <strong>{preview.fileName}</strong> · {[...new Set(preview.rows.map((r) => `${MESI_LBL[r.month]} ${r.year}`))].join(', ')} · {preview.rows.length} outlet
            {preview.tipiCedolino.length > 0 && <> · cedolini <strong>{preview.tipiCedolino.join(' + ')}</strong></>}. Controlla i valori prima di salvare.
          </div>
          {/* Il consulente stampa DUE prospetti per lo stesso mese: uno col solo
              cedolino normale e uno che parte dall'aggiuntivo e arriva al normale,
              cioe' il mese intero. Sono cumulativi, e il salvataggio sostituisce il
              mese: caricare la stampa corta per ultima toglierebbe la tredicesima o
              la quattordicesima dal costo del mese, in silenzio. */}
          {preview.soloNormale && (
            <div className="mb-3 flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div>
                Questo file contiene <strong>solo la mensilità normale</strong>. Se per lo stesso mese il consulente ha stampato anche
                il prospetto che parte dal <strong>cedolino aggiuntivo</strong> (tredicesima o quattordicesima), carica quello: comprende
                tutto il mese, mentre questo no. Salvando ora, il mese varrà solo la mensilità normale.
              </div>
            </div>
          )}
          <div className="overflow-x-auto scroll-shadow-x border border-slate-200 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">Outlet</th>
                  <th className="px-3 py-2 text-right font-bold">Totale retrib.</th>
                  <th className="px-3 py-2 text-right font-bold">Contr. azienda</th>
                  <th className="px-3 py-2 text-right font-bold">INAIL</th>
                  <th className="px-3 py-2 text-right font-bold">TFR fondo</th>
                  <th className="px-3 py-2 text-right font-bold">Costo lordo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.map((r, i) => {
                  const inail = inailPreview(r.inailPat);
                  const noRate = r.inailPat.some((p) => rateByPat.get(p.label) == null && p.imponibile > 0);
                  return (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <span className="font-medium text-slate-800">{r.outlet || r.filialeName}</span>
                        {!r.outlet && <span className="ml-2 text-[11px] text-amber-600">non riconosciuto</span>}
                        {r.compensiAmm > 0 && <div className="text-[11px] text-slate-400">amministratori esclusi: {eurFmt.format(r.compensiAmm)} € + gest.sep. {eurFmt.format(r.contrGestioneSeparata)} €</div>}
                      </td>
                      <td className="px-3 py-2 text-right"><Money v={r.totaleRetribuzioni} /></td>
                      <td className="px-3 py-2 text-right"><Money v={contrAziendaOutlet(r)} /></td>
                      <td className="px-3 py-2 text-right">{noRate ? <span className="text-amber-600 text-xs">0 (tasso da inserire)</span> : <Money v={inail} />}</td>
                      <td className="px-3 py-2 text-right"><Money v={r.tfrFondo} /></td>
                      <td className="px-3 py-2 text-right"><Money v={costoLordoPreview(r)} strong /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4">
            <div className="text-xs text-slate-400">Salvataggio idempotente: aggiorna i mesi/outlet esistenti, non duplica.</div>
            <div className="flex gap-2">
              <button onClick={() => setPreview(null)} disabled={importing} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Annulla</button>
              <button onClick={confirmSave} disabled={importing} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 inline-flex items-center gap-1.5"><CheckCircle2 size={15} /> {importing ? 'Salvataggio…' : 'Conferma e salva'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
      </div>
    </div>
  );
}
