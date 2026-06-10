import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
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
import { GlassTooltip, AXIS_STYLE, GRID_STYLE, PALETTE, getOutletColor, fmtEuro } from '../components/ChartTheme';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';

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
}

// Vista persistita in URL come ?view=
type PersonaleView = 'panoramica' | 'per_outlet' | 'organico' | 'costi';
const VALID_VIEWS: PersonaleView[] = ['panoramica', 'per_outlet', 'organico', 'costi'];

const MONTHS = [
  { num: 1, label: 'Gennaio' }, { num: 2, label: 'Febbraio' }, { num: 3, label: 'Marzo' },
  { num: 4, label: 'Aprile' }, { num: 5, label: 'Maggio' }, { num: 6, label: 'Giugno' },
  { num: 7, label: 'Luglio' }, { num: 8, label: 'Agosto' }, { num: 9, label: 'Settembre' },
  { num: 10, label: 'Ottobre' }, { num: 11, label: 'Novembre' }, { num: 12, label: 'Dicembre' },
];

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
  return `${eurInt.format(n)} €`;
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

// Parsing numero italiano: "1.234,56" → 1234.56 ; gestisce anche "1234.56".
function parseItNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[€\s]/g, '');
  if (!s || s === '-') return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (hasComma) s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

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
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${maxW} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Chiudi"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
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

// KPI card pulita — stesso stile delle altre pagine (ConfrontoOutlet / Conto Economico):
// fondo bianco→slate, bordo tenue, accento solo sul numero. Niente tessere a gradiente pieno.
const KPI_ACCENT: Record<'cost' | 'cash' | 'emerald' | 'none', string> = {
  cost: '#7c3aed',
  cash: '#2563eb',
  emerald: '#059669',
  none: '#0f172a',
};
const KPI_CHIP: Record<'costo' | 'cassa', { bg: string; color: string }> = {
  costo: { bg: '#f5f3ff', color: '#7c3aed' },
  cassa: { bg: '#eff6ff', color: '#2563eb' },
};
function Kpi({ label, value, sub, icon: Icon, accent = 'none', chip }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent?: 'cost' | 'cash' | 'emerald' | 'none'; chip?: 'costo' | 'cassa';
}) {
  return (
    <div className="rounded-2xl shadow-lg p-5" style={{ background: 'linear-gradient(135deg,#ffffff 0%,#f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {chip && (
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0" style={{ background: KPI_CHIP[chip].bg, color: KPI_CHIP[chip].color }}>{chip}</span>
          )}
          <span className="text-xs font-medium text-slate-500 truncate">{label}</span>
        </div>
        <Icon size={16} className="text-slate-400 shrink-0" />
      </div>
      <div className="text-2xl font-bold tabular-nums leading-tight" style={{ color: KPI_ACCENT[accent] }}>{value}</div>
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
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  // Data state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allocations, setAllocations] = useState<EmployeeOutletAllocation[]>([]);
  const [costs, setCosts] = useState<EmployeeCost[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [outlets, setOutlets] = useState<OutletRow[]>([]);
  const [employeeDocs, setEmployeeDocs] = useState<EmployeeDocument[]>([]);
  const [bcByCenter, setBcByCenter] = useState<Record<string, number>>({});
  const [bilancioPersonale, setBilancioPersonale] = useState<number | null>(null);
  const [revenueYear, setRevenueYear] = useState<number>(0);
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
        supabase.from('employees').select('*').eq('company_id', COMPANY_ID).or('is_active.is.null,is_active.eq.true').order('cognome', { nullsFirst: false }),
        supabase.from('employee_outlet_allocations').select('*').eq('company_id', COMPANY_ID),
        supabase.from('employee_costs').select('*').eq('company_id', COMPANY_ID),
        supabase.from('cost_centers').select('*').eq('company_id', COMPANY_ID).eq('is_active', true).order('sort_order', { nullsFirst: false }),
        supabase.from('outlets').select('id, name, code, cost_center_key, is_active').eq('company_id', COMPANY_ID).eq('is_active', true).order('name'),
        supabase.from('employee_documents').select('*').eq('company_id', COMPANY_ID).order('created_at', { ascending: false }),
      ]);
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

  const allocByEmp = useMemo(() => {
    const m: Record<string, EmployeeOutletAllocation[]> = {};
    allocations.forEach((a) => { (m[a.employee_id] ||= []).push(a); });
    return m;
  }, [allocations]);

  const costForMonth = (empId: string) =>
    costs.find((c) => c.employee_id === empId && c.year === selectedYear && c.month === selectedMonth);

  // Netto mensile per dipendente
  const nettoOf = (empId: string) => Number(costForMonth(empId)?.netto || 0);

  // Netto mensile per outlet (via allocazioni, outlet_code == outlet.name)
  const nettoByOutlet = useMemo(() => {
    const m: Record<string, number> = {};
    activeEmployees.forEach((e) => {
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
  }, [activeEmployees, allocByEmp, costs, selectedYear, selectedMonth]);

  const headcountByOutlet = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    activeEmployees.forEach((e) => {
      if (isAdminRole(e)) return;
      (allocByEmp[e.id] || []).forEach((a) => {
        (m[a.outlet_code] ||= new Set()).add(e.id);
      });
    });
    return m;
  }, [activeEmployees, allocByEmp]);

  const bcByOutlet = (o: OutletRow) => (o.cost_center_key ? bcByCenter[o.cost_center_key] || 0 : 0);

  // KPI
  const totalNettoMese = useMemo(
    () => activeEmployees.reduce((s, e) => s + nettoOf(e.id), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeEmployees, costs, selectedYear, selectedMonth]
  );
  const nettoYear = useMemo(
    () => costs.filter((c) => c.year === selectedYear).reduce((s, c) => s + Number(c.netto || 0), 0),
    [costs, selectedYear]
  );
  const totalBC = useMemo(() => Object.values(bcByCenter).reduce((s, v) => s + v, 0), [bcByCenter]);
  const incidenza = revenueYear > 0 ? (totalBC / revenueYear) * 100 : null;
  const costoMedio = headcountEmployees.length > 0 ? totalBC / headcountEmployees.length : 0;

  // Chart costo per outlet (B&C) + netto×12 in trasparenza
  const chartData = useMemo(
    () => outlets.map((o) => ({
      name: o.name,
      bc: bcByOutlet(o),
      nettoX12: (nettoByOutlet[o.name] || 0) * 12,
    })).filter((d) => d.bc > 0 || d.nettoX12 > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outlets, bcByCenter, nettoByOutlet]
  );

  // Cost centers non agganciati ad alcun outlet (es. spese_non_divise) → "Non attribuito"
  const outletKeys = useMemo(() => new Set(outlets.map((o) => o.cost_center_key).filter(Boolean)), [outlets]);
  const nonAttribuito = useMemo(
    () => Object.entries(bcByCenter).filter(([k]) => !outletKeys.has(k)).reduce((s, [, v]) => s + v, 0),
    [bcByCenter, outletKeys]
  );

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
    if ('codice_fiscale' in out) out.fiscal_code = out.codice_fiscale || null;
    if ('data_assunzione' in out) out.hire_date = out.data_assunzione || null;
    if ('data_cessazione' in out) out.termination_date = out.data_cessazione || null;
    if ('livello' in out) out.level = out.livello || null;
    if ('note' in out) out.notes = out.note || null;
    if ('contratto' in out) { out.contratto_tipo = out.contratto; delete out.contratto; }
    if ('qualifica' in out) { out.role_description = out.qualifica; delete out.qualifica; }
    ['hire_date', 'termination_date', 'data_assunzione', 'data_cessazione'].forEach((k) => { if (out[k] === '') out[k] = null; });
    if (out.contratto_tipo === 'indeterminato' && !out.data_cessazione) {
      out.data_cessazione = '9999-12-31'; out.termination_date = '9999-12-31';
    }
    return out;
  };

  const handleSaveEmployee = async (formData: any) => {
    if (!formData.nome?.trim() || !formData.cognome?.trim()) { toast({ type: 'error', message: 'Nome e cognome sono obbligatori' }); return; }
    if (!COMPANY_ID) return;
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
        toast({ type: 'error', message: 'Errore nel salvataggio: ' + (err?.message || '') });
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

  const handleDeleteEmployee = (empId: string) => {
    const e = employees.find((x) => x.id === empId);
    setConfirmState({
      title: 'Disattiva dipendente',
      message: `Vuoi disattivare "${e ? empName(e) : ''}"? Resterà nello storico ma non comparirà nell'organico attivo.`,
      confirmLabel: 'Disattiva', danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        const { error } = await supabase.from('employees').update({ is_active: false }).eq('id', empId);
        if (error) { toast({ type: 'error', message: 'Errore' }); return; }
        toast({ type: 'success', message: 'Dipendente disattivato' });
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
      const realCols = {
        employee_id: payload.employee_id,
        company_id: COMPANY_ID,
        year: payload.year,
        month: payload.month,
        retribuzione: payload.retribuzione,
        contributi: payload.contributi,
        inail: payload.inail,
        tfr: payload.tfr,
        altri_costi: payload.altri_costi,
        netto: payload.netto,
      };
      const { error } = await supabase.from('employee_costs').upsert(realCols, { onConflict: 'employee_id,year,month' });
      if (error) throw error;
      toast({ type: 'success', message: 'Costo salvato' });
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
        title="Personale"
        subtitle={`Organico e costo del personale per outlet${companyName ? ` · ${companyName}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white">
              {yearOptions.map((y) => <option key={y} value={y}>Anno {y}</option>)}
            </select>
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white">
              {MONTHS.map((m) => <option key={m.num} value={m.num}>{m.label}</option>)}
            </select>
            <button onClick={() => setView('costi')} className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><FileUp size={15} /> Importa cedolini</button>
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

      {loading ? (
        <div className="text-slate-400 py-12 text-center">Caricamento…</div>
      ) : (
        <>
          {view === 'panoramica' && (
            <PanoramicaTab
              headcount={headcountEmployees.length}
              sedi={outlets.length}
              totalBC={totalBC}
              totalNettoMese={totalNettoMese}
              nettoYear={nettoYear}
              incidenza={incidenza}
              costoMedio={costoMedio}
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
              activeEmployees={activeEmployees}
              allocByEmp={allocByEmp}
              nettoOf={nettoOf}
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
              employees={activeEmployees}
              allocByEmp={allocByEmp}
              nettoOf={nettoOf}
              outlets={outlets}
              mm={String(selectedMonth).padStart(2, '0')}
              year={selectedYear}
              outletFilter={orgOutletFilter}
              setOutletFilter={setOrgOutletFilter}
              search={orgSearch}
              setSearch={setOrgSearch}
              onAdd={() => { setEditingEmployee(null); setShowEmployeeForm(true); }}
              onEdit={(e) => { setEditingEmployee(e); setShowEmployeeForm(true); }}
              onAlloc={openAllocEditor}
              onCedolino={triggerCedolino}
              onDelete={handleDeleteEmployee}
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
              employees={activeEmployees}
              allocByEmp={allocByEmp}
              costForMonth={costForMonth}
              docsForEmp={docsForEmp}
              onAddCost={(empId) => { setEditingCost(costForMonth(empId) || null); setCostFormEmp(empId); setShowCostForm(true); }}
              onEditCost={(c) => { setEditingCost(c); setCostFormEmp(c.employee_id); setShowCostForm(true); }}
              onDeleteCost={handleDeleteCost}
              onCedolino={triggerCedolino}
              onViewDoc={handleViewDoc}
              uploadingEmployee={uploadingEmployee}
              importPanel={
                <ImportMensile
                  companyId={COMPANY_ID}
                  userId={USER_ID}
                  outlets={outlets}
                  employees={employees}
                  existingCosts={costs}
                  defaultYear={selectedYear}
                  defaultMonth={selectedMonth}
                  onDone={reloadAll}
                />
              }
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
                <button onClick={() => setAllocEdits((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
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
  headcount: number; sedi: number; totalBC: number; totalNettoMese: number; nettoYear: number;
  incidenza: number | null; costoMedio: number; monthLabel: string; month: number;
  chartData: { name: string; bc: number; nettoX12: number }[];
  bilancioPersonale: number | null; nonAttribuito: number; year: number;
}) {
  const { headcount, sedi, totalBC, totalNettoMese, incidenza, costoMedio, month, chartData, bilancioPersonale, nonAttribuito, year } = props;
  const nettoAnnualizzato = totalNettoMese * 12;
  const empty = headcount === 0 && totalBC === 0 && totalNettoMese === 0;
  const mm = String(month).padStart(2, '0');
  const avgPerOutlet = sedi > 0 ? (headcount / sedi).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0';
  const maxVal = Math.max(1, ...chartData.map((d) => d.bc + d.nettoX12));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi label="Organico attivo" value={headcount} sub={`su ${sedi} sedi · ${avgPerOutlet} addetti/outlet`} icon={Users} accent="none" />
        <Kpi label="Costo personale" value={compactEur(totalBC)} sub="budget annuo · da Budget&Controllo" icon={BarChart3} accent="cost" chip="costo" />
        <Kpi label="Netto mensile" value={compactEur(totalNettoMese)} sub={`bonifici stipendi · da cedolini ${mm}/${year}`} icon={FileText} accent="cash" chip="cassa" />
        <Kpi label="Incidenza su ricavi" value={incidenza != null ? `${incidenza.toFixed(1).replace('.', ',')}%` : '—'} sub={`costo personale / ricavi ${year}`} icon={Percent} accent="emerald" />
        <Kpi label="Costo medio / addetto" value={compactEur(costoMedio)} sub="annuo lordo aziendale" icon={Users} accent="none" />
      </div>

      {/* Fascia-nota: le due grane (costo vs netto) non vanno mai confuse */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <AlertCircle size={18} className="text-amber-500 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800 leading-relaxed">
          <strong>Due grane diverse, mai confuse.</strong> Il <strong style={{ color: '#7c3aed' }}>Costo</strong> (viola) è il dato di controllo che carica Lilian in B&amp;C — lordo + contributi + INAIL + TFR. Il <strong style={{ color: '#2563eb' }}>Netto</strong> (blu) è l'uscita di cassa reale dei bonifici. Il netto ≈ metà del costo: non vanno mai sommati né sovrapposti.
        </p>
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
              <span className="text-xs text-slate-400">budget annuo (B&amp;C) vs netto mensile ×12 (payroll)</span>
            </div>
            {chartData.length === 0 ? (
              <div className="text-sm text-slate-400 py-8 text-center">Nessun costo per outlet disponibile.</div>
            ) : (
              <div className="space-y-3">
                {chartData.map((d) => {
                  const color = getOutletColor(d.name);
                  return (
                    <div key={d.name} className="flex items-center gap-3">
                      <div className="w-28 shrink-0 text-sm text-slate-600 truncate" title={d.name}>{d.name}</div>
                      <div className="flex-1 h-5 rounded-full bg-slate-100 overflow-hidden flex">
                        <div className="h-full" style={{ width: `${(d.bc / maxVal) * 100}%`, background: color.main }} />
                        <div className="h-full" style={{ width: `${(d.nettoX12 / maxVal) * 100}%`, background: color.light }} />
                      </div>
                      <div className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums" style={{ color: color.main }}>{eurInt.format(d.bc)}&nbsp;€</div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-4 pt-3 mt-1 border-t border-slate-100 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#6366f1' }} /> Costo budget annuo (B&amp;C)</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#c7d2fe' }} /> Netto ×12 (payroll)</span>
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
              <QuadCard label="Netto annualizzato" value={nettoAnnualizzato} sub="payroll ×12 (Gallo incl.)" color="#2563eb" />
              <div className="flex items-center justify-center text-xs font-semibold text-slate-300">VS</div>
              <QuadCard label="Costo budget B&C" value={totalBC} sub="conti 6701/6703/6705" color="#7c3aed" />
              <div className="flex items-center justify-center text-xs font-semibold text-slate-300">VS</div>
              <QuadCard label={`Costo bilancio ${year}`} value={bilancioPersonale ?? 0} sub={bilancioPersonale == null ? 'non disponibile' : 'consuntivo depositato'} muted={bilancioPersonale == null} />
            </div>
            <div className="mt-4 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3 leading-relaxed">
              Se il netto annualizzato supera il costo a bilancio, il costo personale a gestionale è incompleto: la spia serve proprio a renderlo visibile.
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
      <div className="text-2xl font-bold tabular-nums" style={{ color: muted ? '#0f172a' : (color || '#0f172a') }}>{eurInt.format(value)}&nbsp;€</div>
      <div className="text-[11px] text-slate-400 mt-1">{sub}</div>
    </div>
  );
}

// ============================================================================
// TAB 2 — PER OUTLET
// ============================================================================
function PerOutletTab(props: {
  outlets: OutletRow[];
  activeEmployees: Employee[];
  allocByEmp: Record<string, EmployeeOutletAllocation[]>;
  nettoOf: (id: string) => number;
  nettoByOutlet: Record<string, number>;
  headcountByOutlet: Record<string, Set<string>>;
  bcByOutlet: (o: OutletRow) => number;
  monthLabel: string;
  mm: string;
  year: number;
  nonAttribuito: number;
}) {
  const { outlets, activeEmployees, allocByEmp, nettoOf, nettoByOutlet, headcountByOutlet, bcByOutlet, mm, year, nonAttribuito } = props;
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

      {outlets.map((o) => {
        const color = getOutletColor(o.name);
        const isSede = o.cost_center_key === 'sede_magazzino';
        const persone = activeEmployees.filter((e) => (allocByEmp[e.id] || []).some((a) => a.outlet_code === o.name));
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
                <div className="font-extrabold tabular-nums" style={{ color: color.main }}>{eurInt.format(bcByOutlet(o))}&nbsp;€</div>
                <div className="text-xs text-slate-500">costo annuo (B&amp;C)</div>
              </div>
            </div>
            <div className="border-t border-slate-200 px-2 pb-2">
              {persone.length === 0 ? (
                <div className="text-xs text-slate-400 px-2 py-3">Nessun addetto allocato.</div>
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
          <div className="text-right"><div className="font-extrabold tabular-nums text-slate-600">{eurInt.format(nonAttribuito)}&nbsp;€</div><div className="text-xs text-slate-500">costo annuo (B&amp;C)</div></div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TAB 3 — ORGANICO
// ============================================================================
function OrganicoTab(props: {
  employees: Employee[];
  allocByEmp: Record<string, EmployeeOutletAllocation[]>;
  nettoOf: (id: string) => number;
  outlets: OutletRow[];
  mm: string; year: number;
  outletFilter: string; setOutletFilter: (s: string) => void;
  search: string; setSearch: (s: string) => void;
  onAdd: () => void;
  onEdit: (e: Employee) => void;
  onAlloc: (id: string) => void;
  onCedolino: (id: string) => void;
  onDelete: (id: string) => void;
  docsForEmp: (id: string) => EmployeeDocument[];
  uploadingEmployee: string | null;
}) {
  const { employees, allocByEmp, nettoOf, outlets, mm, year, outletFilter, setOutletFilter, search, setSearch, onAdd, onEdit, onAlloc, onCedolino, onDelete, docsForEmp, uploadingEmployee } = props;
  const filtered = employees.filter((e) => {
    if (search && !empName(e).toLowerCase().includes(search.toLowerCase()) && !(e.matricola || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (outletFilter && !(allocByEmp[e.id] || []).some((a) => a.outlet_code === outletFilter)) return false;
    return true;
  });
  const totNetto = filtered.reduce((s, e) => s + nettoOf(e.id), 0);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
        <h2 className="font-bold text-slate-800">Anagrafica organico</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white">
            <option value="">Tutte le sedi</option>
            {outlets.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca nome…" className="px-3 py-2 text-sm rounded-lg border border-slate-300 w-44" />
          <button onClick={onAdd} className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5"><Plus size={15} /> Dipendente</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-bold">Matricola</th>
              <th className="px-4 py-2.5 text-left font-bold">Dipendente</th>
              <th className="px-4 py-2.5 text-left font-bold">Sede</th>
              <th className="px-4 py-2.5 text-left font-bold">Contratto</th>
              <th className="px-4 py-2.5 text-right font-bold">Netto {mm}/{year}</th>
              <th className="px-4 py-2.5 text-center font-bold">Cedolino</th>
              <th className="px-4 py-2.5 text-center font-bold">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Nessun dipendente.</td></tr>
            ) : filtered.map((e) => {
              const allocs = allocByEmp[e.id] || [];
              const docs = docsForEmp(e.id);
              return (
                <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-500 tabular-nums">{e.matricola || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-slate-800">{empName(e)}</span>
                    {isAdminRole(e) && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">amministratore</span>}
                  </td>
                  <td className="px-4 py-2.5"><SedeCell allocs={allocs} /></td>
                  <td className="px-4 py-2.5 text-slate-500">{e.contratto_tipo || e.contract_type || 'da definire'}</td>
                  <td className="px-4 py-2.5 text-right"><Money v={nettoOf(e.id)} /></td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => onCedolino(e.id)} disabled={uploadingEmployee === e.id} className="text-slate-400 hover:text-emerald-600 inline-flex items-center gap-1 relative" title="Carica cedolino">
                      <Upload size={15} />
                      {docs.length > 0 && <span className="absolute -top-1 -right-2 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white text-[8px] flex items-center justify-center">{docs.length}</span>}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => onEdit(e)} className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50" title="Modifica"><Edit2 size={15} /></button>
                      <button onClick={() => onAlloc(e.id)} className="p-1.5 rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50" title="Allocazione"><Percent size={15} /></button>
                      <button onClick={() => onDelete(e.id)} className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50" title="Disattiva"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="font-bold border-t-2 border-slate-300">
                <td className="px-4 py-2.5" colSpan={4}>TOTALE — {filtered.length} dipendenti</td>
                <td className="px-4 py-2.5 text-right"><Money v={totNetto} strong /></td>
                <td /><td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
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
  const { contiMese, totalNettoMese, monthLabel, mm, year, employees, allocByEmp, costForMonth, docsForEmp, onAddCost, onEditCost, onDeleteCost, onCedolino, onViewDoc, uploadingEmployee, importPanel } = props;
  return (
    <div className="space-y-5">
      <div className="text-xs sm:text-[13px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5">
        <span className="text-amber-600 font-bold shrink-0">€</span>
        <div><strong>Qui convivono due livelli.</strong> In alto il <strong>costo aziendale per conto</strong> (quello che serve a B&amp;C, oggi inserito a mano). In basso i <strong>netti dai cedolini</strong> (quello che hai caricato). Obiettivo del redesign: i cedolini alimentano automaticamente l'aggregato, e la riga “costo” smette di essere digitata a mano.</div>
      </div>

      {/* Costo per conto */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
          <h2 className="font-bold text-slate-800">Costo personale per conto — {monthLabel} {year}</h2>
          <span className="text-xs text-slate-500">mappato sul piano dei conti civilistico</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-bold">Conto</th>
              <th className="px-4 py-2.5 text-left font-bold">Voce</th>
              <th className="px-4 py-2.5 text-right font-bold">Importo mese</th>
              <th className="px-4 py-2.5 text-center font-bold">Fonte</th>
            </tr>
          </thead>
          <tbody>
            {contiMese.map((c) => (
              <tr key={c.code} className="border-b border-slate-100">
                <td className="px-4 py-2.5 text-slate-500 tabular-nums">{c.code}</td>
                <td className="px-4 py-2.5 text-slate-700">{c.label}</td>
                <td className="px-4 py-2.5 text-right">{c.amount ? <Money v={c.amount} /> : <span className="text-slate-400">— da cedolino</span>}</td>
                <td className="px-4 py-2.5 text-center"><span className="text-[10.5px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700">manuale oggi</span></td>
              </tr>
            ))}
            <tr className="font-bold border-t-2 border-slate-300">
              <td className="px-4 py-2.5" colSpan={2}>NETTO PAGATO (dai cedolini)</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{eurFmt.format(totalNettoMese)}&nbsp;€</td>
              <td className="px-4 py-2.5 text-center"><span className="text-[10.5px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">automatico</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Cedolini per dipendente */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
          <h2 className="font-bold text-slate-800">Cedolini per dipendente</h2>
          <span className="text-xs text-slate-500">netto + upload PDF · {monthLabel} {year}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-bold">Dipendente</th>
                <th className="px-4 py-2.5 text-left font-bold">Sede</th>
                <th className="px-4 py-2.5 text-right font-bold">Netto {mm}/{year}</th>
                <th className="px-4 py-2.5 text-center font-bold">PDF cedolino</th>
                <th className="px-4 py-2.5 text-center font-bold">Costo</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Nessun dipendente. Usa l’import mensile qui sotto.</td></tr>
              ) : employees.map((e) => {
                const c = costForMonth(e.id);
                const docs = docsForEmp(e.id).filter((d) => d.year === year);
                return (
                  <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{empName(e)}</td>
                    <td className="px-4 py-2.5"><SedeCell allocs={allocByEmp[e.id] || []} /></td>
                    <td className="px-4 py-2.5 text-right"><Money v={c?.netto || 0} /></td>
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
      </div>

      {importPanel}
    </div>
  );
}

// ============================================================================
// EMPLOYEE FORM MODAL
// ============================================================================
function EmployeeFormModal({ initial, onCancel, onSave }: { initial: Employee | null; onCancel: () => void; onSave: (data: any) => Promise<void> }) {
  const [form, setForm] = useState({
    nome: initial?.nome || initial?.first_name || '',
    cognome: initial?.cognome || initial?.last_name || '',
    matricola: initial?.matricola || '',
    codice_fiscale: initial?.codice_fiscale || initial?.fiscal_code || '',
    data_assunzione: initial?.data_assunzione || initial?.hire_date || '',
    contratto: initial?.contratto_tipo || initial?.contract_type || 'indeterminato',
    data_cessazione: (initial?.data_cessazione === '9999-12-31' ? '' : (initial?.data_cessazione || '')) || '',
    livello: initial?.livello || initial?.level || '',
    qualifica: initial?.role_description || '',
    note: initial?.note || initial?.notes || '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [saving, setSaving] = useState(false);
  const submit = async () => { setSaving(true); await onSave({ ...form, id: initial?.id }); setSaving(false); };
  return (
    <Modal title={initial ? 'Modifica dipendente' : 'Nuovo dipendente'} onClose={onCancel}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cognome *"><input value={form.cognome} onChange={(e) => set('cognome', e.target.value)} className="inp" /></Field>
        <Field label="Nome *"><input value={form.nome} onChange={(e) => set('nome', e.target.value)} className="inp" /></Field>
        <Field label="Matricola"><input value={form.matricola} onChange={(e) => set('matricola', e.target.value)} className="inp" /></Field>
        <Field label="Codice fiscale"><input value={form.codice_fiscale} onChange={(e) => set('codice_fiscale', e.target.value)} className="inp" /></Field>
        <Field label="Data assunzione"><input type="date" value={form.data_assunzione || ''} onChange={(e) => set('data_assunzione', e.target.value)} className="inp" /></Field>
        <Field label="Contratto">
          <select value={form.contratto} onChange={(e) => set('contratto', e.target.value)} className="inp">
            <option value="indeterminato">Indeterminato</option>
            <option value="determinato">Determinato</option>
            <option value="apprendistato">Apprendistato</option>
            <option value="stage">Stage</option>
            <option value="somministrazione">Somministrazione</option>
          </select>
        </Field>
        {form.contratto !== 'indeterminato' && (
          <Field label="Data cessazione"><input type="date" value={form.data_cessazione || ''} onChange={(e) => set('data_cessazione', e.target.value)} className="inp" /></Field>
        )}
        <Field label="Livello"><input value={form.livello} onChange={(e) => set('livello', e.target.value)} className="inp" /></Field>
        <Field label="Qualifica / ruolo"><input value={form.qualifica} onChange={(e) => set('qualifica', e.target.value)} placeholder="es. Store manager, Amministratore" className="inp" /></Field>
        <Field label="Note" full><input value={form.note} onChange={(e) => set('note', e.target.value)} className="inp" /></Field>
      </div>
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
const FIELD_SYNS: Record<string, string[]> = {
  matricola: ['matricola', 'cod dip', 'cod. dip', 'coddip', 'cod.dip', 'cod dipendente', 'codice', 'id dip', 'cod'],
  cognome: ['cognome', 'surname'],
  nome: ['nome', 'name'],
  nominativo: ['nominativo', 'dipendente', 'cognome e nome', 'cognome nome', 'cognome/nome'],
  outlet: ['filiale', 'outlet', 'punto vendita', 'sede', 'negozio', 'store', 'ramo', 'punto'],
  netto: ['netto', 'netto in busta', 'netto a pagare', 'netto busta', 'netto mese', 'netto del mese'],
  retribuzione: ['lordo', 'retribuzione', 'stipendio', 'competenze', 'totale competenze', 'imponibile'],
  contributi: ['contributi', 'inps', 'oneri sociali', 'contributi inps'],
  inail: ['inail'],
  tfr: ['tfr', 'quota tfr', 'acc tfr', 'accantonamento tfr', 'acc.to tfr'],
  altri: ['altri', 'altri costi', 'altro', 'altre voci'],
};

interface PreviewRow {
  matricola: string; cognome: string; nome: string; outlet: string;
  netto: number | null; retribuzione: number | null; contributi: number | null; inail: number | null; tfr: number | null; altri: number | null;
  isNew: boolean; matchedId: string | null;
}

function ImportMensile({ companyId, userId, outlets, employees, existingCosts, defaultYear, defaultMonth, onDone }: {
  companyId: string; userId: string | null; outlets: OutletRow[]; employees: Employee[]; existingCosts: EmployeeCost[];
  defaultYear: number; defaultMonth: number; onDone: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [impYear, setImpYear] = useState(defaultYear);
  const [impMonth, setImpMonth] = useState(defaultMonth);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [fileTotal, setFileTotal] = useState<number | null>(null);
  const [hasComponents, setHasComponents] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [overwriteAck, setOverwriteAck] = useState(false);

  const monthHasData = existingCosts.some((c) => c.year === impYear && c.month === impMonth && (c.netto != null || c.retribuzione != null));

  const matchEmployee = (matricola: string, cognome: string, nome: string): string | null => {
    if (matricola) {
      const byMat = employees.find((e) => norm(e.matricola) === norm(matricola));
      if (byMat) return byMat.id;
    }
    const byName = employees.find((e) => norm(e.cognome || e.last_name) === norm(cognome) && norm(e.nome || e.first_name) === norm(nome));
    return byName ? byName.id : null;
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setFileName(file.name);
    setRows(null); setFileTotal(null); setOverwriteAck(false);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false });
      if (!matrix.length) { toast({ type: 'error', message: 'File vuoto' }); setParsing(false); return; }

      // Trova la riga di intestazione (entro le prime 12 righe)
      let headerIdx = -1;
      for (let i = 0; i < Math.min(12, matrix.length); i++) {
        const cells = matrix[i].map(norm);
        if (cells.some((c) => c === 'netto' || c.includes('matricola') || c === 'cognome' || c.includes('retribuzione') || c.includes('nominativo'))) { headerIdx = i; break; }
      }
      if (headerIdx === -1) { toast({ type: 'error', message: 'Intestazioni non riconosciute (attese: matricola, cognome/nome, netto…)' }); setParsing(false); return; }

      const header = matrix[headerIdx].map(norm);
      const findCol = (field: string): number => {
        const syns = FIELD_SYNS[field];
        // exact match first
        for (const s of syns) { const idx = header.indexOf(s); if (idx >= 0) return idx; }
        // includes fallback
        for (let i = 0; i < header.length; i++) { if (syns.some((s) => header[i].includes(s))) return i; }
        return -1;
      };
      const cols: Record<string, number> = {};
      Object.keys(FIELD_SYNS).forEach((f) => { cols[f] = findCol(f); });

      const componentsPresent = ['retribuzione', 'contributi', 'inail', 'tfr', 'altri'].some((f) => cols[f] >= 0);
      setHasComponents(componentsPresent);

      const get = (r: any[], field: string) => (cols[field] >= 0 ? r[cols[field]] : undefined);
      const out: PreviewRow[] = [];
      let detectedTotal: number | null = null;

      for (let i = headerIdx + 1; i < matrix.length; i++) {
        const r = matrix[i];
        if (!r || r.every((c) => c == null || String(c).trim() === '')) continue;

        let matricola = String(get(r, 'matricola') ?? '').trim().replace(/\.0$/, '');
        let cognome = String(get(r, 'cognome') ?? '').trim();
        let nome = String(get(r, 'nome') ?? '').trim();
        if (!cognome && cols.nominativo >= 0) {
          const full = String(get(r, 'nominativo') ?? '').trim();
          const parts = full.split(/\s+/);
          cognome = parts[0] || '';
          nome = parts.slice(1).join(' ');
        }
        const outlet = String(get(r, 'outlet') ?? '').trim();
        const netto = parseItNum(get(r, 'netto'));

        // Riga "Totale aziendale" → estrai totale, non importare
        const labelBlob = norm(`${matricola} ${cognome} ${nome} ${outlet}`);
        if (!matricola && /totale|totali|tot\.|t o t a l e/.test(labelBlob)) {
          if (netto != null) detectedTotal = netto;
          continue;
        }
        if (!cognome && !matricola && netto == null) continue;

        out.push({
          matricola, cognome, nome, outlet,
          netto,
          retribuzione: parseItNum(get(r, 'retribuzione')),
          contributi: parseItNum(get(r, 'contributi')),
          inail: parseItNum(get(r, 'inail')),
          tfr: parseItNum(get(r, 'tfr')),
          altri: parseItNum(get(r, 'altri')),
          isNew: false, matchedId: null,
        });
      }

      // match dipendenti
      out.forEach((row) => {
        const id = matchEmployee(row.matricola, row.cognome, row.nome);
        row.matchedId = id; row.isNew = !id;
      });

      if (!out.length) { toast({ type: 'error', message: 'Nessuna riga dipendente riconosciuta' }); setParsing(false); return; }
      setRows(out);
      setFileTotal(detectedTotal);
    } catch (err: any) {
      toast({ type: 'error', message: 'Errore parsing file: ' + (err?.message || '') });
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const totalNetto = rows ? rows.reduce((s, r) => s + (r.netto || 0), 0) : 0;
  const newCount = rows ? rows.filter((r) => r.isNew).length : 0;
  const scostamento = fileTotal != null ? totalNetto - fileTotal : null;
  const quadra = scostamento == null || Math.abs(scostamento) < 0.01;

  const reset = () => { setRows(null); setFileName(''); setFileTotal(null); setOverwriteAck(false); };

  const doImport = async () => {
    if (!rows) return;
    setImporting(true);
    try {
      // mappa nome outlet (case-insensitive) → nome esatto in DB
      const outletByNorm: Record<string, string> = {};
      outlets.forEach((o) => { outletByNorm[norm(o.name)] = o.name; });

      // log import (header) per ottenere import_id
      const { data: logRow, error: logErr } = await supabase.from('employee_cost_imports').insert([{
        company_id: companyId, year: impYear, month: impMonth, file_name: fileName,
        rows_total: rows.length, rows_new_employees: newCount, total_netto: totalNetto,
        file_total: fileTotal, scostamento: scostamento, imported_by: userId,
      }]).select('id').single();
      if (logErr) throw logErr;
      const importId = logRow?.id || null;

      const costPayloads: any[] = [];
      for (const row of rows) {
        let empId = row.matchedId;
        if (!empId) {
          const { data: newEmp, error: empErr } = await supabase.from('employees').insert([{
            company_id: companyId, matricola: row.matricola || null,
            nome: row.nome || null, cognome: row.cognome || null,
            first_name: row.nome || row.cognome || '—', last_name: row.cognome || row.nome || '—',
            is_active: true,
          }]).select('id').single();
          if (empErr) { console.error('Errore creazione dipendente', empErr); continue; }
          empId = newEmp?.id || null;
          // allocazione 100% sull'outlet (match per nome)
          if (empId && row.outlet) {
            const exact = outletByNorm[norm(row.outlet)];
            if (exact) {
              await supabase.from('employee_outlet_allocations').insert([{ employee_id: empId, company_id: companyId, outlet_code: exact, allocation_pct: 100, is_primary: true }]);
            }
          }
        }
        if (!empId) continue;

        // payload: solo i campi presenti nel file (netti-only NON azzera i componenti)
        const payload: any = { employee_id: empId, company_id: companyId, year: impYear, month: impMonth, source: 'import_mensile', import_id: importId };
        if (row.netto != null) payload.netto = row.netto;
        if (row.retribuzione != null) payload.retribuzione = row.retribuzione;
        if (row.contributi != null) payload.contributi = row.contributi;
        if (row.inail != null) payload.inail = row.inail;
        if (row.tfr != null) payload.tfr = row.tfr;
        if (row.altri != null) payload.altri_costi = row.altri;
        costPayloads.push(payload);
      }

      if (costPayloads.length) {
        const { error: upErr } = await supabase.from('employee_costs').upsert(costPayloads, { onConflict: 'employee_id,year,month' });
        if (upErr) throw upErr;
      }

      toast({ type: 'success', message: `Import completato: ${costPayloads.length} righe, ${newCount} nuovi dipendenti.` });
      reset();
      await onDone();
    } catch (err: any) {
      toast({ type: 'error', message: 'Errore import: ' + (err?.message || '') });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <FileUp size={18} className="text-blue-600" />
        <h3 className="font-semibold text-slate-900">Import mensile netti / costi</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">Carica un file CSV o Excel. Le intestazioni vengono riconosciute automaticamente (matricola, cognome, nome, filiale, netto, retribuzione, contributi, INAIL, TFR, altri).</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={impYear} onChange={(e) => setImpYear(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg border border-slate-200">
          {[defaultYear + 1, defaultYear, defaultYear - 1, defaultYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={impMonth} onChange={(e) => setImpMonth(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg border border-slate-200">
          {MONTHS.map((m) => <option key={m.num} value={m.num}>{m.label}</option>)}
        </select>
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={handleFile} />
        <button onClick={() => fileRef.current?.click()} disabled={parsing} className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5">
          <Upload size={15} /> {parsing ? 'Lettura…' : 'Scegli file'}
        </button>
      </div>

      {monthHasData && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>Il mese {MONTHS.find((m) => m.num === impMonth)?.label} {impYear} contiene già dati. Confermando, <strong>sovrascriverai solo questo mese</strong> (gli altri mesi non vengono toccati).</span>
        </div>
      )}

      {/* Anteprima */}
      {rows && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><div className="text-xs text-slate-500">Righe riconosciute</div><div className="font-semibold">{rows.length}</div></div>
            <div><div className="text-xs text-slate-500">Nuovi dipendenti</div><div className="font-semibold">{newCount}</div></div>
            <div><div className="text-xs text-slate-500">Totale netto calcolato</div><div className="font-semibold"><Money v={totalNetto} /></div></div>
            <div>
              <div className="text-xs text-slate-500">Totale file</div>
              <div className="font-semibold">{fileTotal != null ? <Money v={fileTotal} /> : <span className="text-slate-400">—</span>}</div>
            </div>
          </div>

          {scostamento != null && (
            <div className={`px-4 py-2 text-sm flex items-center gap-2 ${quadra ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {quadra ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              {quadra ? 'Quadratura OK con il totale del file.' : <>Scostamento dal totale file: <Money v={scostamento} /></>}
            </div>
          )}

          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-3 py-2 font-medium">Matr.</th>
                  <th className="px-3 py-2 font-medium">Dipendente</th>
                  <th className="px-3 py-2 font-medium">Outlet</th>
                  <th className="px-3 py-2 font-medium text-right">Netto</th>
                  {hasComponents && <th className="px-3 py-2 font-medium text-right">Retrib.</th>}
                  <th className="px-3 py-2 font-medium text-center">Stato</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-3 py-2 text-slate-500 tabular-nums">{r.matricola || '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{`${r.cognome} ${r.nome}`.trim() || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{r.outlet || '—'}</td>
                    <td className="px-3 py-2 text-right"><Money v={r.netto || 0} /></td>
                    {hasComponents && <td className="px-3 py-2 text-right text-slate-500"><Money v={r.retribuzione || 0} /></td>}
                    <td className="px-3 py-2 text-center">
                      {r.isNew
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
                Confermo la sovrascrittura del mese già presente
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
