import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { useCompanyLabels } from '../hooks/useCompanyLabels';
import { useToast } from '../components/Toast';

// Vista temporale Cashflow Prospettico — persistita in URL come ?view=
type CashflowView = 'giornaliero' | 'settimanale' | 'mensile';
const VALID_CASHFLOW_VIEWS: CashflowView[] = ['giornaliero', 'settimanale', 'mensile'];
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Download,
  Loader,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  X
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { usePeriod } from '../hooks/usePeriod';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import TextTooltip from '../components/Tooltip';
import { PlaceholderDot, PlaceholderLegend } from '../components/PlaceholderMark';

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

// Override manuale della stima viva: tag in recurring_costs.notes [override:<voce>:<YYYY-MM>]
const OVERRIDE_TAG = (key: string, y: number, m1: number) => `[override:${key}:${y}-${String(m1).padStart(2, '0')}]`;
const OVERRIDE_RE = /\[override:([a-z0-9-]+):(\d{4})-(\d{2})\]/;

const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '€ 0';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value) + ' €';
};

const formatDate = (date: string | Date): string => {
  const d = new Date(date);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
};

const formatDateFull = (date: string | Date): string => {
  const d = new Date(date);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
};

const parseMonth = (dateString: string | null | undefined): number | null => {
  if (!dateString) return null;
  const date = new Date(dateString);
  return date.getMonth(); // 0-11
};

const getMonthName = (month: number): string => {
  return MONTHS[month] || 'N/A';
};

// Helper: get ISO date string YYYY-MM-DD
const toISODate = (date: Date | string): string => {
  const d = new Date(date);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
};

// Helper: get Monday of the week containing the given date
const getWeekStart = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  return new Date(d.setDate(diff));
};

export default function CashflowProspettico() {
  const { profile } = useAuth();
  const labels = useCompanyLabels();
  const { toast } = useToast();
  const COMPANY_ID = profile?.company_id;
  const { year, quarter, getDateRange } = usePeriod();

  // State
  const [selectedOutlet, setSelectedOutlet] = useState('all');
  const [scenario, setScenario] = useState('base'); // 'base', 'ottimistico', 'pessimistico'
  // viewMode persistito in URL come ?view=… (default 'mensile')
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const viewMode: CashflowView = VALID_CASHFLOW_VIEWS.includes(viewParam as CashflowView)
    ? (viewParam as CashflowView)
    : 'mensile';
  const setViewMode = (next: CashflowView) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', next);
    setSearchParams(params);
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal "Aggiungi previsione uscita" (alimenta cashflow prospettico)
  const [showForecastModal, setShowForecastModal] = useState(false);
  const [forecastDate, setForecastDate] = useState<string>('');
  const [forecastAmount, setForecastAmount] = useState<string>('');
  const [forecastDescription, setForecastDescription] = useState<string>('');
  const [forecastSaving, setForecastSaving] = useState(false);
  const [editingForecastId, setEditingForecastId] = useState<string | null>(null); // null = creazione, valore = modifica
  // B.1 — tipo previsione: una tantum (payables) o ricorrente (recurring_costs)
  const [forecastTipo, setForecastTipo] = useState<'una_tantum' | 'ricorrente'>('una_tantum');
  const [forecastFrequency, setForecastFrequency] = useState<'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual'>('monthly');
  const [forecastDayOfMonth, setForecastDayOfMonth] = useState<string>('');
  const [forecastEndDate, setForecastEndDate] = useState<string>('');
  // Lista previsioni manuali (is_forecast=true) per gestione inline
  type ForecastRow = { id: string; due_date: string | null; gross_amount: number | null; notes: string | null; invoice_number: string | null; status: string | null };
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [showForecastList, setShowForecastList] = useState(false);

  const fetchForecasts = useCallback(async () => {
    if (!COMPANY_ID) return;
    const { data } = await (supabase.from('payables') as unknown as { select: (s: string) => { eq: (k: string, v: string) => { eq: (k2: string, v2: boolean) => { order: (k3: string, opts: { ascending: boolean }) => Promise<{ data: ForecastRow[] | null }> } } } })
      .select('id, due_date, gross_amount, notes, invoice_number, status')
      .eq('company_id', COMPANY_ID)
      .eq('is_forecast', true)
      .order('due_date', { ascending: true });
    setForecasts((data || []).filter(f => f.status !== 'annullato'));
  }, [COMPANY_ID]);

  const handleSaveForecast = async () => {
    if (!COMPANY_ID || !forecastDate || !forecastDescription.trim() || !forecastAmount) {
      toast({ type: 'warning', message: 'Compila tutti i campi obbligatori (data, descrizione, importo)' });
      return;
    }
    const amount = parseFloat(forecastAmount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      toast({ type: 'error', message: 'Importo non valido' });
      return;
    }
    setForecastSaving(true);
    try {
      // B.1 — Ricorrente (solo in creazione): scrive in recurring_costs, non in payables.
      if (forecastTipo === 'ricorrente' && !editingForecastId) {
        const start = new Date(forecastDate);
        const { error } = await supabase.from('recurring_costs').insert({
          company_id: COMPANY_ID,
          cost_center: 'all',
          description: forecastDescription.trim(),
          supplier_name: forecastDescription.trim(),
          amount,
          frequency: forecastFrequency,
          day_of_month: forecastDayOfMonth ? parseInt(forecastDayOfMonth, 10) : start.getDate(),
          month_start: start.getMonth() + 1,
          start_date: forecastDate,
          end_date: forecastEndDate || null,
          is_active: true,
          notes: 'Previsione ricorrente manuale. [manuale]',
        } as never);
        if (error) throw new Error(error.message);
        toast({ type: 'success', message: `Uscita ricorrente aggiunta: € ${amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })} (${forecastFrequency})` });
        setShowForecastModal(false);
        setEditingForecastId(null);
        setForecastDate(''); setForecastAmount(''); setForecastDescription('');
        setForecastTipo('una_tantum'); setForecastDayOfMonth(''); setForecastEndDate('');
        await fetchAllData();
        setForecastSaving(false);
        return;
      }
      if (editingForecastId) {
        // MODIFICA previsione esistente
        const { error } = await supabase.from('payables').update({
          invoice_number: '[PREV] ' + forecastDescription.trim().slice(0, 40),
          invoice_date: forecastDate,
          due_date: forecastDate,
          original_due_date: forecastDate,
          gross_amount: amount,
          amount_remaining: amount,
          notes: forecastDescription.trim(),
        } as never).eq('id', editingForecastId);
        if (error) throw new Error(error.message);
        toast({ type: 'success', message: 'Previsione aggiornata' });
      } else {
        // INSERT nuova previsione
        const { error } = await supabase.from('payables').insert({
          company_id: COMPANY_ID,
          is_forecast: true,
          invoice_number: '[PREV] ' + forecastDescription.trim().slice(0, 40),
          invoice_date: forecastDate,
          due_date: forecastDate,
          original_due_date: forecastDate,
          gross_amount: amount,
          amount_paid: 0,
          amount_remaining: amount,
          status: 'da_pagare',
          payment_method: 'bonifico_ordinario',
          supplier_name: '[Previsione manuale]',
          notes: forecastDescription.trim(),
        } as never);
        if (error) throw new Error(error.message);
        toast({ type: 'success', message: `Previsione aggiunta: € ${amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })} il ${new Date(forecastDate).toLocaleDateString('it-IT')}` });
      }
      setShowForecastModal(false);
      setEditingForecastId(null);
      setForecastDate('');
      setForecastAmount('');
      setForecastDescription('');
      await fetchForecasts();
      await fetchAllData();
    } catch (err) {
      toast({ type: 'error', message: 'Errore: ' + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setForecastSaving(false);
    }
  };

  // Apri modal in modalità MODIFICA su una previsione esistente
  const handleEditForecast = (f: ForecastRow) => {
    setEditingForecastId(f.id);
    setForecastTipo('una_tantum');
    setForecastDate(f.due_date || new Date().toISOString().slice(0, 10));
    setForecastAmount(String(f.gross_amount ?? 0));
    setForecastDescription(f.notes || (f.invoice_number || '').replace('[PREV] ', ''));
    setShowForecastModal(true);
  };

  // Conferma elimina previsione — stato per Modal custom (no confirm nativo)
  const [forecastToDelete, setForecastToDelete] = useState<{ id: string; descr: string } | null>(null);
  const handleConfirmDeleteForecast = async () => {
    if (!forecastToDelete) return;
    try {
      const { error } = await supabase.from('payables').update({ status: 'annullato' } as never).eq('id', forecastToDelete.id);
      if (error) throw new Error(error.message);
      toast({ type: 'success', message: 'Previsione eliminata' });
      setForecastToDelete(null);
      await fetchForecasts();
      await fetchAllData();
    } catch (err) {
      toast({ type: 'error', message: 'Errore eliminazione: ' + (err instanceof Error ? err.message : String(err)) });
      setForecastToDelete(null);
    }
  };

  // ─── B (rettifica): STIMA VIVA, calcolata on-the-fly ad ogni render ───────
  // Niente più bottone/scrittura auto: stipendi netti e compensi amministratori si
  // ricalcolano in fetchAllData dai dati reali più recenti e si proiettano sui mesi
  // futuri (azzurro "≈"). F24/INAIL solo se contributi/inail>0 (altrimenti empty-state).
  // Override manuale (no data loss): una riga recurring_costs taggata
  // [override:<voce>:<YYYY-MM>] sostituisce il calcolato per quella voce+mese; la
  // ricomputazione non tocca mai le righe manuali e per quel mese vince l'override.
  type EstimateVoice = { key: string; label: string; amount: number; day: number };
  const [estimateVoices, setEstimateVoices] = useState<EstimateVoice[]>([]);

  // Salva un override (inline-edit dal Dettaglio Uscite) come riga recurring_costs.
  const handleSaveOverride = async (voiceKey: string, voiceLabel: string, monthIdx: number, amount: number) => {
    if (!COMPANY_ID) return;
    const sbAny = supabase as unknown as { from: (t: string) => any };
    const tag = OVERRIDE_TAG(voiceKey, year, monthIdx + 1);
    try {
      const { data: existing } = await sbAny.from('recurring_costs').select('id').eq('company_id', COMPANY_ID).ilike('notes', `%${tag}%`);
      const row = {
        company_id: COMPANY_ID, cost_center: 'all', description: voiceLabel, supplier_name: voiceLabel,
        amount: Math.round(amount), frequency: 'monthly', day_of_month: 27, month_start: monthIdx + 1, is_active: true,
        notes: `Override manuale stima (${MONTHS[monthIdx]} ${year}). ${tag}`,
      };
      if (existing && existing.length > 0) await sbAny.from('recurring_costs').update(row).eq('id', existing[0].id);
      else await sbAny.from('recurring_costs').insert(row);
      toast({ type: 'success', message: `Stima ${voiceLabel} aggiornata per ${MONTHS[monthIdx]} ${year}` });
      await fetchAllData();
    } catch (err) {
      toast({ type: 'error', message: 'Errore salvataggio override: ' + (err instanceof Error ? err.message : String(err)) });
    }
  };

  // Carica previsioni all'avvio + ad ogni refresh dei dati cashflow
  useEffect(() => { fetchForecasts(); }, [fetchForecasts]);

  // Data state
  const [initialBalance, setInitialBalance] = useState(0);
  // TODO: tighten type
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [hasNegativeMonth, setHasNegativeMonth] = useState(false);

  // Raw data for daily/weekly views
  type AnyRow = Record<string, unknown>
  const [rawPayables, setRawPayables] = useState<AnyRow[]>([]);
  const [rawDailyRevenue, setRawDailyRevenue] = useState<AnyRow[]>([]);
  const [rawOutlets, setRawOutlets] = useState<AnyRow[]>([]);
  const [rawRecurringCosts, setRawRecurringCosts] = useState<AnyRow[]>([]);
  const [rawLoans, setRawLoans] = useState<AnyRow[]>([]);
  const [rawFiscal, setRawFiscal] = useState<AnyRow[]>([]); // E — scadenze fiscali (fiscal_deadlines)
  const [rawBudgetConfronto, setRawBudgetConfronto] = useState<AnyRow[]>([]);
  // budget_entries (TUTTI i conti) + mappa di classificazione da chart_of_accounts.
  // Classifichiamo ricavi/costi via is_revenue e cassa via is_cash, MAI per prefisso conto.
  type CoaInfo = { is_revenue: boolean; is_cash: boolean }
  const [rawBudgetEntries, setRawBudgetEntries] = useState<AnyRow[]>([]);
  const [coaCashMap, setCoaCashMap] = useState<Record<string, CoaInfo>>({});

  // Actual monthly data from cash_movements
  type ActualMonth = { month: number; entrate: number; uscite: number; netto: number; hasData: boolean }
  const [actualMonthlyData, setActualMonthlyData] = useState<ActualMonth[]>([]);

  // Summary KPIs
  const [totalInflows, setTotalInflows] = useState(0);
  const [totalOutflows, setTotalOutflows] = useState(0);
  const [finalBalance, setFinalBalance] = useState(0);

  // Drill-down state
  const [expandedRow, setExpandedRow] = useState<number | null>(null); // index of expanded row
  const [expandedColumn, setExpandedColumn] = useState<'entrate' | 'uscite' | null>(null); // 'entrate' | 'uscite'

  // Negative balance alert
  const [negativeAlert, setNegativeAlert] = useState<{ period: string; uscite: number; saldo: number } | null>(null);

  // Fetch all data
  useEffect(() => {
    if (!COMPANY_ID) return;
    fetchAllData();
  }, [COMPANY_ID, year, quarter, selectedOutlet, scenario]);

  // FIX 2 — Refresh cross-pagina: ri-legge i dati quando la finestra/scheda torna
  // attiva (es. dopo aver modificato un importo fiscale nello Scadenzario), così il
  // cashflow non resta fermo ai dati del mount. Re-registrato quando cambiano i filtri
  // (cattura la fetchAllData corrente).
  useEffect(() => {
    if (!COMPANY_ID) return;
    const onActive = () => { if (document.visibilityState === 'visible') fetchAllData(); };
    window.addEventListener('focus', onActive);
    document.addEventListener('visibilitychange', onActive);
    return () => {
      window.removeEventListener('focus', onActive);
      document.removeEventListener('visibilitychange', onActive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [COMPANY_ID, year, quarter, selectedOutlet, scenario]);

  // Reset expanded row when view mode changes
  useEffect(() => {
    setExpandedRow(null);
    setExpandedColumn(null);
  }, [viewMode]);

  const fetchAllData = async () => {
    try {
      if (!COMPANY_ID) return;
      const companyId = COMPANY_ID;
      setLoading(true);
      setError(null);

      // 1. Get cost centers
      const { data: costCenterData, error: ccError } = await supabase
        .from('cost_centers')
        .select('*');

      if (ccError) throw ccError;
      setCostCenters(costCenterData || []);

      // 2. Get initial bank balance (somma di tutti i conti bancari)
      // BUG-004 fix: v_cash_position restituisce 1 riga per banca, .single() falliva con 406
      // quando ci sono più conti. Sommiamo i current_balance in JS, come fa Dashboard.tsx
      const { data: balanceData, error: balError } = await supabase
        .from('v_cash_position')
        .select('current_balance')
        .eq('company_id', companyId);

      const balance = (balanceData || []).reduce((s, b) => s + (b.current_balance || 0), 0);
      setInitialBalance(balance);

      // 3. Fetch all required data
      const [
        { data: recurringCosts },
        { data: payablesData },
        { data: budgetConfrontoData },
        { data: loansData },
        { data: outletsData },
        { data: payablesScadenze },
        { data: dailyRevenueData },
        { data: budgetEntriesData },
        { data: chartAccountsData }
      ] = await Promise.all([
        supabase
          .from('recurring_costs')
          .select('*')
          .eq('company_id', companyId)
          .eq('is_active', true),
        supabase
          .from('v_payables_operative')
          .select('*')
          .eq('company_id', companyId),
        supabase
          .from('budget_confronto')
          .select('*')
          .eq('company_id', companyId)
          .eq('year', year),
        supabase
          .from('loans')
          .select('*')
          .eq('company_id', companyId)
          .eq('is_active', true),
        supabase
          .from('outlets')
          .select('id, code, name, rent_monthly')
          .eq('company_id', companyId)
          .eq('is_active', true),
        supabase
          .from('payables')
          .select('id, due_date, gross_amount, amount_paid, outlet_id, status, supplier_id, supplier_name, invoice_number, installment_number, installment_total')
          .eq('company_id', companyId)
          .in('status', ['da_pagare', 'in_scadenza', 'scaduto']),
        // Daily revenue for daily/weekly views
        supabase
          .from('daily_revenue')
          .select('id, date, outlet_id, gross_revenue, net_revenue')
          .eq('company_id', companyId)
          .gte('date', getDateRange().from)
          .lte('date', getDateRange().to),
        // Budget entries: TUTTI i conti (ricavi + costi). La classificazione avviene in memoria
        // via chart_of_accounts (is_revenue / is_cash), MAI per prefisso conto.
        supabase
          .from('budget_entries')
          .select('cost_center, account_code, budget_amount, month, is_placeholder')
          .eq('company_id', companyId)
          .eq('year', year)
          .range(0, 9999),
        // Piano dei conti: mappa code -> { is_revenue, is_cash } per classificare budget_entries.
        // select('*') + cast: is_cash è nuova (067) e non ancora nei tipi DB generati.
        supabase
          .from('chart_of_accounts')
          .select('*')
          .eq('company_id', companyId)
      ]);

      // Mappa di classificazione conti: code -> { is_revenue, is_cash }. is_cash default true.
      const coaMap: Record<string, CoaInfo> = {};
      (chartAccountsData || []).forEach((c) => {
        const row = c as unknown as Record<string, unknown>;
        if (row.code != null) coaMap[String(row.code)] = { is_revenue: row.is_revenue === true, is_cash: row.is_cash !== false };
      });
      // Ricavo a budget: conto is_revenue=true (per il marcatore segnaposto sulle entrate).
      const isRevenueCode = (code: unknown) => coaMap[String(code ?? '')]?.is_revenue === true;
      // Cast: is_placeholder non è ancora nei tipi DB generati (database.ts stale).
      type BERow = { cost_center?: string | null; account_code?: string | null; budget_amount?: number | null; month?: number | null; is_placeholder?: boolean | null };
      const beRows: BERow[] = (budgetEntriesData as unknown as BERow[]) || [];

      // Store raw data for drill-down
      setRawPayables(payablesScadenze || []);
      setRawDailyRevenue(dailyRevenueData || []);
      setRawOutlets(outletsData || []);
      setRawRecurringCosts(recurringCosts || []);
      setRawLoans(loansData || []);
      setRawBudgetConfronto(budgetConfrontoData || []);
      setRawBudgetEntries((beRows as unknown as AnyRow[]) || []);
      setCoaCashMap(coaMap);

      // E — scadenze fiscali (IVA/imposte) da fiscal_deadlines: uscite STIMA (azzurro).
      // Solo non pagate; se non ci sono dati → nessuna riga (empty-state).
      const { data: fiscalData } = await (supabase as unknown as { from: (t: string) => any })
        .from('fiscal_deadlines').select('due_date, amount, amount_paid, status, title, deadline_type').eq('company_id', companyId);
      setRawFiscal((fiscalData || []) as AnyRow[]);
      const monthlyFiscal: number[] = Array(12).fill(0);
      ((fiscalData || []) as Array<Record<string, unknown>>).forEach(f => {
        if (['paid', 'cancelled', 'pagato', 'annullato'].includes(String(f.status || '').toLowerCase())) return;
        if (!f.due_date) return;
        const dd = new Date(String(f.due_date));
        if (dd.getFullYear() !== year) return;
        const residuo = (Number(f.amount) || 0) - (Number(f.amount_paid) || 0);
        if (residuo > 0) monthlyFiscal[dd.getMonth()] += residuo;
      });

      // ─── B (rettifica): STIME VIVE calcolate dai dati reali più recenti ───────
      const sbAnyE = supabase as unknown as { from: (t: string) => any };
      let estNetti = 0, estAdmin = 0;
      // Stipendi netti = Σ netto ULTIMO mese con cedolini, dipendenti in forza.
      const { data: lastRows } = await sbAnyE.from('employee_costs').select('year, month').eq('company_id', companyId).not('netto', 'is', null).order('year', { ascending: false }).order('month', { ascending: false }).limit(1);
      const lm = ((lastRows || []) as Array<{ year: number; month: number }>)[0];
      if (lm) {
        const { data: ecData } = await sbAnyE.from('employee_costs').select('netto, employee_id').eq('company_id', companyId).eq('year', lm.year).eq('month', lm.month);
        const { data: empData } = await sbAnyE.from('employees').select('id').eq('company_id', companyId).eq('is_active', true);
        const activeIds = new Set(((empData || []) as Array<{ id: string }>).map(e => e.id));
        ((ecData || []) as Array<{ netto: number | null; employee_id: string }>).forEach(r => { if (activeIds.has(r.employee_id)) estNetti += Number(r.netto) || 0; });
      }
      // Compensi amministratori = Σ budget_entries.is_admin_compensation / 12
      const { data: coaAdmin } = await sbAnyE.from('chart_of_accounts').select('code').eq('company_id', companyId).eq('is_admin_compensation', true);
      const adminCodes = new Set(((coaAdmin || []) as Array<{ code: string }>).map(c => c.code));
      if (adminCodes.size > 0) {
        const totAdmin = beRows.reduce((s, r) => adminCodes.has(String(r.account_code ?? '')) ? s + (Number(r.budget_amount) || 0) : s, 0);
        estAdmin = totAdmin / 12;
      }
      // F24/INAIL: oggi non valorizzati (contributi/inail=0) → NON inventare, empty-state.
      const estVoices: EstimateVoice[] = [
        { key: 'stipendi-netti', label: 'Stipendi netti (stima)', amount: Math.round(estNetti), day: 27 },
        { key: 'amministratori', label: 'Compensi amministratori (stima)', amount: Math.round(estAdmin), day: 27 },
      ].filter(v => v.amount > 0);
      setEstimateVoices(estVoices);

      // Override manuali (recurring_costs taggati [override:voce:YYYY-MM]) per voce+mese (anno corrente).
      const overrideByVoiceMonth: Record<string, number> = {};
      (recurringCosts || []).forEach(rc => {
        const mm = OVERRIDE_RE.exec(String((rc as Record<string, unknown>).notes || ''));
        if (!mm) return;
        if (Number(mm[2]) !== year) return;
        overrideByVoiceMonth[`${mm[1]}|${Number(mm[3]) - 1}`] = Number((rc as Record<string, unknown>).amount) || 0;
      });

      // Filter by outlet if not 'all'
      let filteredOutlet = selectedOutlet === 'all' ? null : selectedOutlet;

      // B4: Calculate total monthly rent from active outlets
      let totalMonthlyRent = 0;
      if (outletsData) {
        outletsData.forEach(outlet => {
          if (!filteredOutlet || outlet.code === filteredOutlet) {
            totalMonthlyRent += Number(outlet.rent_monthly) || 0;
          }
        });
      }

      // B1: Build a map of outlet_id -> outlet.code for payables filtering
      const outletIdToCode: Record<string, string> = {};
      if (outletsData) {
        outletsData.forEach(outlet => {
          if (outlet.id && outlet.code) outletIdToCode[outlet.id] = outlet.code;
        });
      }

      // Process monthly data
      type MonthData = {
        month: number; monthName: string;
        entrate_sdi: number; entrate_budget: number;
        uscite_sdi: number; uscite_ricorrenti: number; uscite_scadenze: number;
        uscite_canoni: number; rate_finanziamenti: number; uscite_fiscali: number; uscite_stima: number;
        tot_entrate: number; tot_uscite: number; flusso_netto: number; saldo_progressivo: number | null;
        // Marcatore segnaposto sulle ENTRATE previsionali (ricavi a budget clone non granito).
        entrate_ph: boolean;
        tipo?: string;
      }
      const monthData: MonthData[] = Array.from({ length: 12 }, (_, i) => ({
        month: i,
        monthName: MONTHS[i],
        entrate_sdi: 0,
        entrate_budget: 0,
        uscite_sdi: 0,
        uscite_ricorrenti: 0,
        uscite_scadenze: 0,
        uscite_canoni: totalMonthlyRent,
        rate_finanziamenti: 0,
        uscite_fiscali: monthlyFiscal[i] || 0,
        uscite_stima: 0,
        tot_entrate: 0, tot_uscite: 0, flusso_netto: 0, saldo_progressivo: 0,
        entrate_ph: false,
      }));

      // Mappa placeholder ricavi per mese da budget_entries (OR di is_placeholder sulle righe
      // ricavo sottostanti). Guida il marcatore arancio sulle ENTRATE previsionali.
      const revPhByMonth: boolean[] = Array(12).fill(false);
      beRows.forEach(entry => {
        if (entry.is_placeholder !== true) return;
        const m = (Number(entry.month) || 1) - 1;
        if (m < 0 || m > 11) return;
        if (filteredOutlet && entry.cost_center !== filteredOutlet) return;
        if (isRevenueCode(entry.account_code)) revPhByMonth[m] = true;
      });

      // 3.1 Add budget revenues from budget_confronto
      let hasConfrontoRevenue = false;
      if (budgetConfrontoData) {
        budgetConfrontoData.forEach(entry => {
          if (entry.entry_type === 'rev_monthly') {
            hasConfrontoRevenue = true;
            const month = (Number(entry.month) || 1) - 1; // 1-12 to 0-11
            if (!filteredOutlet || entry.cost_center === filteredOutlet) {
              monthData[month].entrate_budget += Number(entry.amount) || 0;
            }
          }
        });
      }

      // 3.1b Fallback: ricavi a budget da budget_entries, classificati via is_revenue (MAI per prefisso conto)
      if (!hasConfrontoRevenue && beRows.length > 0) {
        beRows.forEach(entry => {
          if (!isRevenueCode(entry.account_code)) return;
          const month = (Number(entry.month) || 1) - 1; // 1-12 to 0-11
          if (month >= 0 && month < 12) {
            if (!filteredOutlet || entry.cost_center === filteredOutlet) {
              monthData[month].entrate_budget += Number(entry.budget_amount) || 0;
            }
          }
        });
      }

      // 3.2 Add SDI payables
      if (payablesData) {
        payablesData.forEach(payable => {
          const p = payable as Record<string, unknown>
          if (!['pagato', 'annullato'].includes(String(p.status || ''))) {
            const month = parseMonth(String(p.due_date || ''));
            if (month !== null && (!filteredOutlet || p.cost_center_code === filteredOutlet)) {
              const outstandingAmount = (Number(p.amount_total) || 0) - (Number(p.amount_paid) || 0);
              monthData[month].uscite_sdi += outstandingAmount;
            }
          }
        });
      }

      // 3.2b Add payables scadenze (B1: uscite previste from payables table)
      if (payablesScadenze) {
        payablesScadenze.forEach(payable => {
          const dueDate = payable.due_date;
          if (!dueDate) return;
          const payableDate = new Date(String(dueDate));
          // Only include payables for the selected year
          if (payableDate.getFullYear() !== year) return;
          const month = payableDate.getMonth();
          // Filter by outlet if selected
          const oid = payable.outlet_id ? String(payable.outlet_id) : '';
          if (filteredOutlet && outletIdToCode[oid] !== filteredOutlet) return;
          const outstanding = (Number(payable.gross_amount) || 0) - (Number(payable.amount_paid) || 0);
          if (outstanding > 0) {
            monthData[month].uscite_scadenze += outstanding;
          }
        });
      }

      // 3.3 Add recurring costs (escluse le righe-stima: override [override:...] e
      // deprecate [auto:...] sono gestite dalla stima viva, non dal loop generico → no doppio conteggio)
      if (recurringCosts) {
        recurringCosts.forEach(cost => {
          const notes = String((cost as Record<string, unknown>).notes || '');
          if (OVERRIDE_RE.test(notes) || notes.includes('[auto:')) return;
          if (!filteredOutlet || cost.cost_center === filteredOutlet) {
            const startMonth = (Number(cost.month_start) || 1) - 1; // 1-12 to 0-11

            for (let m = 0; m < 12; m++) {
              let shouldInclude = false;

              if (cost.frequency === 'monthly') {
                shouldInclude = true;
              } else if (cost.frequency === 'bimonthly') {
                shouldInclude = (m - startMonth) % 2 === 0 && m >= startMonth;
              } else if (cost.frequency === 'quarterly') {
                shouldInclude = (m - startMonth) % 3 === 0 && m >= startMonth;
              } else if (cost.frequency === 'semiannual') {
                shouldInclude = (m - startMonth) % 6 === 0 && m >= startMonth;
              } else if (cost.frequency === 'annual') {
                shouldInclude = m === startMonth;
              }

              if (shouldInclude) {
                monthData[m].uscite_ricorrenti += Number(cost.amount) || 0;
              }
            }
          }
        });
      }

      // 3.4 Add loan payments
      if (loansData) {
        loansData.forEach(loan => {
          for (let m = 0; m < 12; m++) {
            monthData[m].rate_finanziamenti += Number((loan as Record<string, unknown>).monthly_payment) || Number((loan as Record<string, unknown>).installment_amount) || 0;
          }
        });
      }

      // 3.5 Determina il tipo (Consuntivo / In corso / Previsione) PRIMA di stimare le uscite
      // a budget e i totali, perché la stima vale solo per i mesi previsionali.
      const today = new Date();
      const currentMonth = today.getMonth(); // 0-11
      const currentYear = today.getFullYear();
      monthData.forEach((month, idx) => {
        if (year < currentYear || (year === currentYear && idx < currentMonth)) {
          month.tipo = 'Consuntivo';
        } else if (year === currentYear && idx === currentMonth) {
          month.tipo = 'In corso';
        } else {
          month.tipo = 'Previsione';
        }
      });

      // Modello A (tesoreria): le USCITE future NON usano più la stima costi-a-budget (§3).
      // Le uscite future = scadenzario (payables per due_date) + ricorrenti (recurring_costs,
      // generate dal workstream B) + canoni reali (outlets.rent_monthly) + rate finanziamenti
      // + previsioni manuali. Niente uscite_budget. Il flag is_cash resta usato dal Conto
      // Economico (qui non più letto per le uscite).
      monthData.forEach((month, idx) => {
        const isForecast = month.tipo === 'Previsione' || month.tipo === 'In corso';
        month.uscite_canoni = totalMonthlyRent;       // canone reale per tutti i mesi
        // Le entrate previsionali restano dal B&C: il marcatore segnaposto sui ricavi resta.
        month.entrate_ph = isForecast ? revPhByMonth[idx] : false;
        // Stima viva (solo mesi futuri): per ogni voce usa l'OVERRIDE del mese se presente,
        // altrimenti il calcolato. Le voci con solo override (senza stima auto) entrano lo stesso.
        if (isForecast) {
          let stima = 0;
          const seen = new Set<string>();
          estVoices.forEach(v => {
            const ov = overrideByVoiceMonth[`${v.key}|${idx}`];
            stima += ov !== undefined ? ov : v.amount;
            seen.add(v.key);
          });
          Object.keys(overrideByVoiceMonth).forEach(k => {
            const [vk, mi] = k.split('|');
            if (Number(mi) === idx && !seen.has(vk)) stima += overrideByVoiceMonth[k];
          });
          month.uscite_stima = stima;
        }
      });

      // 4. Apply scenario multiplier to revenues
      const multiplier = scenario === 'ottimistico' ? 1.1 : scenario === 'pessimistico' ? 0.9 : 1;

      // 5. Calculate totals, flows. Il saldo cumulativo (Modello A) PARTE DA OGGI:
      // è ancorato alla cassa reale di oggi (balance da v_cash_position) al mese corrente
      // e proietta in avanti. I mesi già passati NON vengono ricostruiti dalla cassa di oggi
      // (saldo_progressivo = null: mostrano i consuntivi reali nelle barre, non sulla linea).
      const now = new Date();
      const curMonth = now.getMonth();
      const curYear = now.getFullYear();
      let cumulativeBalance = balance;
      let totalIn = 0, totalOut = 0;
      let foundNegative = false;

      monthData.forEach((month, idx) => {
        month.entrate_sdi = Math.round(month.entrate_sdi * multiplier);
        month.entrate_budget = Math.round(month.entrate_budget * multiplier);

        month.tot_entrate = month.entrate_sdi + month.entrate_budget;
        month.tot_uscite = month.uscite_sdi + month.uscite_ricorrenti + month.uscite_scadenze + month.uscite_canoni + month.rate_finanziamenti + month.uscite_fiscali + month.uscite_stima;
        month.flusso_netto = month.tot_entrate - month.tot_uscite;

        totalIn += month.tot_entrate;
        totalOut += month.tot_uscite;

        // La linea di liquidità esiste solo da "oggi" in avanti.
        const isPast = (year < curYear) || (year === curYear && idx < curMonth);
        if (isPast) {
          month.saldo_progressivo = null;
        } else {
          cumulativeBalance += month.flusso_netto;
          month.saldo_progressivo = cumulativeBalance;
          if (cumulativeBalance < 0) foundNegative = true;
        }
      });

      // 7. Fetch actual monthly data from cash_movements for the selected year
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const { data: rawMovements, error: movError } = await supabase
        .from('cash_movements')
        .select('date, type, amount')
        .eq('company_id', companyId)
        .gte('date', yearStart)
        .lte('date', yearEnd)
        .order('date', { ascending: true });

      if (!movError && rawMovements && rawMovements.length > 0) {
        const monthActual = Array.from({ length: 12 }, (_, i) => ({
          month: i,
          entrate: 0,
          uscite: 0,
          netto: 0,
          hasData: false
        }));

        rawMovements.forEach(m => {
          if (!m.date) return;
          const monthIdx = new Date(m.date).getMonth();
          monthActual[monthIdx].hasData = true;
          if (m.type === 'entrata') {
            monthActual[monthIdx].entrate += Math.abs(Number(m.amount) || 0);
          } else {
            monthActual[monthIdx].uscite += Math.abs(Number(m.amount) || 0);
          }
        });

        monthActual.forEach(m => {
          m.netto = m.entrate - m.uscite;
        });

        setActualMonthlyData(monthActual);
      } else {
        setActualMonthlyData([]);
      }

      setMonthlyData(monthData);
      setTotalInflows(totalIn);
      setTotalOutflows(totalOut);
      setFinalBalance(cumulativeBalance);
      setHasNegativeMonth(foundNegative);

    } catch (err: unknown) {
      console.error('Error fetching cashflow data:', err);
      setError((err as Error).message || 'Errore nel caricamento dei dati');
    } finally {
      setLoading(false);
    }
  };

  // ===== DAILY VIEW COMPUTATION =====
  const dailyData = useMemo(() => {
    if (viewMode !== 'giornaliero') return [];

    const filteredOutlet = selectedOutlet === 'all' ? null : selectedOutlet;
    const multiplier = scenario === 'ottimistico' ? 1.1 : scenario === 'pessimistico' ? 0.9 : 1;

    const outletIdToCode: Record<string, string> = {};
    const outletIdToName: Record<string, string> = {};
    rawOutlets.forEach(o => {
      const id = String(o.id || ''); if (!id) return;
      outletIdToCode[id] = String(o.code || '');
      outletIdToName[id] = String(o.name || o.code || '');
    });

    // Total daily rent (monthly rent / 30)
    let totalDailyRent = 0;
    rawOutlets.forEach(outlet => {
      if (!filteredOutlet || outlet.code === filteredOutlet) {
        totalDailyRent += (Number(outlet.rent_monthly) || 0) / 30;
      }
    });

    // Daily recurring costs (monthly costs prorated to daily)
    let dailyRecurring = 0;
    (rawRecurringCosts || []).forEach(cost => {
      if (!filteredOutlet || cost.cost_center === filteredOutlet) {
        const amt = Number(cost.amount) || 0;
        if (cost.frequency === 'monthly') {
          dailyRecurring += amt / 30;
        } else if (cost.frequency === 'quarterly') {
          dailyRecurring += amt / 90;
        } else if (cost.frequency === 'annual') {
          dailyRecurring += amt / 365;
        } else if (cost.frequency === 'semiannual') {
          dailyRecurring += amt / 180;
        } else if (cost.frequency === 'bimonthly') {
          dailyRecurring += amt / 60;
        }
      }
    });

    // Daily loan payment
    let dailyLoan = 0;
    (rawLoans || []).forEach(loan => {
      dailyLoan += (Number(loan.monthly_payment) || Number(loan.installment_amount) || 0) / 30;
    });

    // Build revenue by date
    type RevItem = { outlet_name: string; gross_revenue: number }
    const revenueByDate: Record<string, RevItem[]> = {};
    (rawDailyRevenue || []).forEach(rev => {
      const dateKey = String(rev.date || '');
      if (!dateKey) return;
      if (!revenueByDate[dateKey]) revenueByDate[dateKey] = [];
      const oid = String(rev.outlet_id || '');
      if (!filteredOutlet || outletIdToCode[oid] === filteredOutlet) {
        revenueByDate[dateKey].push({
          outlet_name: outletIdToName[oid] || 'N/A',
          gross_revenue: Number(rev.gross_revenue) || 0
        });
      }
    });

    // Build payables by date
    type PayItem = { invoice_number: string; supplier_id: unknown; gross_amount: number }
    const payablesByDate: Record<string, PayItem[]> = {};
    (rawPayables || []).forEach(p => {
      if (!p.due_date) return;
      const oid = String(p.outlet_id || '');
      if (filteredOutlet && outletIdToCode[oid] !== filteredOutlet) return;
      const outstanding = (Number(p.gross_amount) || 0) - (Number(p.amount_paid) || 0);
      if (outstanding <= 0) return;
      const dateKey = String(p.due_date);
      if (!payablesByDate[dateKey]) payablesByDate[dateKey] = [];
      payablesByDate[dateKey].push({
        invoice_number: String(p.invoice_number || '-'),
        supplier_id: p.supplier_id,
        gross_amount: outstanding
      });
    });

    // Build budget-based daily revenue estimate (monthly budget / days in month)
    const monthlyBudgetRevenue: number[] = Array(12).fill(0);
    let hasConfrontoRev = false;
    (rawBudgetConfronto || []).forEach(entry => {
      if (entry.entry_type === 'rev_monthly') {
        hasConfrontoRev = true;
        const month = (Number(entry.month) || 1) - 1;
        if (!filteredOutlet || entry.cost_center === filteredOutlet) {
          monthlyBudgetRevenue[month] += Number(entry.amount) || 0;
        }
      }
    });
    // Fallback ricavi: budget_entries classificati via is_revenue (MAI per prefisso conto)
    if (!hasConfrontoRev && rawBudgetEntries && rawBudgetEntries.length > 0) {
      rawBudgetEntries.forEach(entry => {
        if (coaCashMap[String(entry.account_code ?? '')]?.is_revenue !== true) return;
        const month = (Number(entry.month) || 1) - 1;
        if (month >= 0 && month < 12) {
          if (!filteredOutlet || entry.cost_center === filteredOutlet) {
            monthlyBudgetRevenue[month] += Number(entry.budget_amount) || 0;
          }
        }
      });
    }

    const today = new Date();
    const startDate = new Date(today);
    startDate.setHours(0, 0, 0, 0);
    const days = [];
    let cumBalance = initialBalance;

    for (let i = 0; i < 30; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const dateKey = toISODate(date);
      const month = date.getMonth();
      const daysInMonth = new Date(date.getFullYear(), month + 1, 0).getDate();

      // Entrate: daily_revenue records + prorated budget
      const revenueItems = revenueByDate[dateKey] || [];
      const revenueTotal = revenueItems.reduce((sum, r) => sum + r.gross_revenue, 0);
      const budgetDaily = monthlyBudgetRevenue[month] / daysInMonth;
      const entrateRaw = revenueTotal > 0 ? revenueTotal : budgetDaily;
      const entrate = Math.round(entrateRaw * multiplier);

      // Uscite (Modello A): scadenzario (payables, incl. previsioni manuali) + canoni reali
      // (pro-rata) + ricorrenti + rate finanziamenti. Niente stima costi-a-budget.
      const payableItems = payablesByDate[dateKey] || [];
      const payablesTotal = payableItems.reduce((sum, p) => sum + p.gross_amount, 0);
      const uscite = Math.round(payablesTotal + totalDailyRent + dailyRecurring + dailyLoan);

      const flusso = entrate - uscite;
      cumBalance += flusso;

      // Dettaglio canoni reali per outlet (pro-rata giornaliero)
      const costBaseItems = rawOutlets
        .filter(o => !filteredOutlet || o.code === filteredOutlet)
        .map(o => ({
          label: String(o.name || o.code || ''),
          amount: Math.round((Number(o.rent_monthly) || 0) / 30)
        }))
        .filter(item => item.amount > 0);

      days.push({
        label: `${DAYS_SHORT[date.getDay()]} ${formatDate(date)}`,
        dateKey,
        dateFull: formatDateFull(date),
        entrate,
        uscite,
        flusso_netto: flusso,
        saldo_progressivo: cumBalance,
        // Drill-down data
        entrateItems: revenueItems.length > 0
          ? revenueItems.map(r => ({ label: r.outlet_name, amount: Math.round(r.gross_revenue * multiplier) }))
          : [{ label: 'Stima da budget', amount: Math.round(budgetDaily * multiplier) }],
        usciteItems: [
          ...payableItems.map(p => ({ label: `Fatt. ${p.invoice_number}`, amount: Math.round(p.gross_amount) })),
          ...costBaseItems,
          ...(dailyRecurring > 0 ? [{ label: 'Costi ricorrenti (pro-rata)', amount: Math.round(dailyRecurring) }] : []),
          ...(dailyLoan > 0 ? [{ label: 'Rate finanziamenti (pro-rata)', amount: Math.round(dailyLoan) }] : [])
        ]
      });
    }

    return days;
  }, [viewMode, rawDailyRevenue, rawPayables, rawOutlets, rawRecurringCosts, rawLoans, rawBudgetConfronto, rawBudgetEntries, coaCashMap, initialBalance, selectedOutlet, scenario]);

  // ===== WEEKLY VIEW COMPUTATION =====
  const weeklyData = useMemo(() => {
    if (viewMode !== 'settimanale') return [];
    // Note: weeklyData computes independently from raw data, NOT from dailyData

    const filteredOutlet = selectedOutlet === 'all' ? null : selectedOutlet;
    const multiplier = scenario === 'ottimistico' ? 1.1 : scenario === 'pessimistico' ? 0.9 : 1;

    const outletIdToCode: Record<string, string> = {};
    const outletIdToName: Record<string, string> = {};
    rawOutlets.forEach(o => {
      const id = String(o.id || ''); if (!id) return;
      outletIdToCode[id] = String(o.code || '');
      outletIdToName[id] = String(o.name || o.code || '');
    });

    let totalDailyRent = 0;
    rawOutlets.forEach(outlet => {
      if (!filteredOutlet || outlet.code === filteredOutlet) {
        totalDailyRent += (Number(outlet.rent_monthly) || 0) / 30;
      }
    });

    let dailyRecurring = 0;
    (rawRecurringCosts || []).forEach(cost => {
      if (!filteredOutlet || cost.cost_center === filteredOutlet) {
        const amt = Number(cost.amount) || 0;
        if (cost.frequency === 'monthly') dailyRecurring += amt / 30;
        else if (cost.frequency === 'quarterly') dailyRecurring += amt / 90;
        else if (cost.frequency === 'annual') dailyRecurring += amt / 365;
        else if (cost.frequency === 'semiannual') dailyRecurring += amt / 180;
        else if (cost.frequency === 'bimonthly') dailyRecurring += amt / 60;
      }
    });

    let dailyLoan = 0;
    (rawLoans || []).forEach(loan => {
      dailyLoan += (Number(loan.monthly_payment) || Number(loan.installment_amount) || 0) / 30;
    });

    type RevItem = { outlet_name: string; gross_revenue: number }
    const revenueByDate: Record<string, RevItem[]> = {};
    (rawDailyRevenue || []).forEach(rev => {
      const oid = String(rev.outlet_id || '');
      const dateKey = String(rev.date || '');
      if (!dateKey) return;
      if (!filteredOutlet || outletIdToCode[oid] === filteredOutlet) {
        if (!revenueByDate[dateKey]) revenueByDate[dateKey] = [];
        revenueByDate[dateKey].push({
          outlet_name: outletIdToName[oid] || 'N/A',
          gross_revenue: Number(rev.gross_revenue) || 0
        });
      }
    });

    type PayItem = { invoice_number: string; supplier_id: unknown; gross_amount: number }
    const payablesByDate: Record<string, PayItem[]> = {};
    (rawPayables || []).forEach(p => {
      if (!p.due_date) return;
      const oid = String(p.outlet_id || '');
      if (filteredOutlet && outletIdToCode[oid] !== filteredOutlet) return;
      const outstanding = (Number(p.gross_amount) || 0) - (Number(p.amount_paid) || 0);
      if (outstanding <= 0) return;
      const dateKey = String(p.due_date);
      if (!payablesByDate[dateKey]) payablesByDate[dateKey] = [];
      payablesByDate[dateKey].push({
        invoice_number: String(p.invoice_number || '-'),
        supplier_id: p.supplier_id,
        gross_amount: outstanding
      });
    });

    const monthlyBudgetRevenue: number[] = Array(12).fill(0);
    let hasConfrontoRevW = false;
    (rawBudgetConfronto || []).forEach(entry => {
      if (entry.entry_type === 'rev_monthly') {
        hasConfrontoRevW = true;
        const month = (Number(entry.month) || 1) - 1;
        if (!filteredOutlet || entry.cost_center === filteredOutlet) {
          monthlyBudgetRevenue[month] += Number(entry.amount) || 0;
        }
      }
    });
    // Fallback ricavi: budget_entries classificati via is_revenue (MAI per prefisso conto)
    if (!hasConfrontoRevW && rawBudgetEntries && rawBudgetEntries.length > 0) {
      rawBudgetEntries.forEach(entry => {
        if (coaCashMap[String(entry.account_code ?? '')]?.is_revenue !== true) return;
        const month = (Number(entry.month) || 1) - 1;
        if (month >= 0 && month < 12) {
          if (!filteredOutlet || entry.cost_center === filteredOutlet) {
            monthlyBudgetRevenue[month] += Number(entry.budget_amount) || 0;
          }
        }
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Start from Monday of current week
    const weekStart = getWeekStart(today);

    type WeekItem = { label: string; amount: number }
    type Week = { label: string; dateKey: string; entrate: number; uscite: number; flusso_netto: number; saldo_progressivo: number; entrateItems: WeekItem[]; usciteItems: WeekItem[] }
    const weeks: Week[] = [];
    let cumBalance = initialBalance;

    for (let w = 0; w < 13; w++) {
      const wStart = new Date(weekStart);
      wStart.setDate(weekStart.getDate() + w * 7);
      const wEnd = new Date(wStart);
      wEnd.setDate(wStart.getDate() + 6);

      let weekEntrate = 0;
      let weekUscite = 0;
      let weekCostBase = 0; // somma quota giornaliera canoni reali
      const weekEntrateItems: WeekItem[] = [];
      const weekUsciteItems: WeekItem[] = [];

      for (let d = 0; d < 7; d++) {
        const date = new Date(wStart);
        date.setDate(wStart.getDate() + d);
        const dateKey = toISODate(date);
        const month = date.getMonth();
        const daysInMonth = new Date(date.getFullYear(), month + 1, 0).getDate();

        const revenueItems = revenueByDate[dateKey] || [];
        const revenueTotal = revenueItems.reduce((sum, r) => sum + r.gross_revenue, 0);
        const budgetDaily = monthlyBudgetRevenue[month] / daysInMonth;
        const dayEntrate = Math.round((revenueTotal > 0 ? revenueTotal : budgetDaily) * multiplier);
        weekEntrate += dayEntrate;

        revenueItems.forEach(r => {
          weekEntrateItems.push({ label: `${formatDate(date)} - ${r.outlet_name}`, amount: Math.round(r.gross_revenue * multiplier) });
        });
        if (revenueItems.length === 0 && budgetDaily > 0) {
          weekEntrateItems.push({ label: `${formatDate(date)} - Stima budget`, amount: Math.round(budgetDaily * multiplier) });
        }

        const payableItems = payablesByDate[dateKey] || [];
        const payablesTotal = payableItems.reduce((sum, p) => sum + p.gross_amount, 0);
        // Modello A: canoni reali (pro-rata), niente stima costi-a-budget.
        weekCostBase += totalDailyRent;
        const dayUscite = Math.round(payablesTotal + totalDailyRent + dailyRecurring + dailyLoan);
        weekUscite += dayUscite;

        payableItems.forEach(p => {
          weekUsciteItems.push({ label: `${formatDate(date)} - Fatt. ${p.invoice_number}`, amount: Math.round(p.gross_amount) });
        });
      }

      // Add weekly cost-base/recurring/loan totals
      const weeklyCostBase = Math.round(weekCostBase);
      const weeklyRecurring = Math.round(dailyRecurring * 7);
      const weeklyLoan = Math.round(dailyLoan * 7);
      if (weeklyCostBase > 0) weekUsciteItems.push({ label: 'Canoni affitto (settimana)', amount: weeklyCostBase });
      if (weeklyRecurring > 0) weekUsciteItems.push({ label: 'Costi ricorrenti (settimana)', amount: weeklyRecurring });
      if (weeklyLoan > 0) weekUsciteItems.push({ label: 'Rate finanziamenti (settimana)', amount: weeklyLoan });

      const flusso = weekEntrate - weekUscite;
      cumBalance += flusso;

      weeks.push({
        label: `${formatDate(wStart)} - ${formatDate(wEnd)}`,
        dateKey: toISODate(wStart),
        entrate: weekEntrate,
        uscite: weekUscite,
        flusso_netto: flusso,
        saldo_progressivo: cumBalance,
        entrateItems: weekEntrateItems,
        usciteItems: weekUsciteItems
      });
    }

    return weeks;
  }, [viewMode, rawDailyRevenue, rawPayables, rawOutlets, rawRecurringCosts, rawLoans, rawBudgetConfronto, rawBudgetEntries, coaCashMap, initialBalance, selectedOutlet, scenario]);

  // Force daily computation for weekly view by making dailyData not depend on viewMode for weekly
  // Actually, weeklyData computes independently. Let's fix the dependency:
  // weeklyData already computes from raw data, not from dailyData. Good.

  // ===== ACTIVE DATA based on viewMode =====
  const activeData = useMemo(() => {
    if (viewMode === 'giornaliero') return dailyData;
    if (viewMode === 'settimanale') return weeklyData;
    return monthlyData;
  }, [viewMode, dailyData, weeklyData, monthlyData]);

  // ===== RECALCULATE KPIs FROM ACTIVE DATA =====
  useEffect(() => {
    if (!activeData || activeData.length === 0) return;

    let totIn = 0, totOut = 0, negative = false;
    activeData.forEach(row => {
      // Monthly view uses tot_entrate/tot_uscite, daily/weekly uses entrate/uscite
      totIn += row.tot_entrate || row.entrate || 0;
      totOut += row.tot_uscite || row.uscite || 0;
      if ((row.saldo_progressivo || 0) < 0) negative = true;
    });

    setTotalInflows(totIn);
    setTotalOutflows(totOut);
    const lastRow = activeData[activeData.length - 1];
    setFinalBalance(lastRow?.saldo_progressivo || (initialBalance + totIn - totOut));
    setHasNegativeMonth(negative);
  }, [activeData, viewMode]);

  // ===== NEGATIVE ALERT COMPUTATION =====
  useEffect(() => {
    let alertInfo = null;

    if (viewMode === 'mensile') {
      for (const m of monthlyData) {
        if (m.saldo_progressivo != null && m.saldo_progressivo < 0) {
          alertInfo = {
            period: `${m.monthName} ${year}`,
            uscite: m.tot_uscite,
            saldo: m.saldo_progressivo
          };
          break;
        }
      }
    } else if (viewMode === 'giornaliero') {
      for (const d of dailyData) {
        if (d.saldo_progressivo < 0) {
          alertInfo = {
            period: d.dateFull || d.label,
            uscite: d.uscite,
            saldo: d.saldo_progressivo
          };
          break;
        }
      }
    } else if (viewMode === 'settimanale') {
      for (const w of weeklyData) {
        if (w.saldo_progressivo < 0) {
          alertInfo = {
            period: `Settimana ${w.label}`,
            uscite: w.uscite,
            saldo: w.saldo_progressivo
          };
          break;
        }
      }
    }

    setNegativeAlert(alertInfo);
  }, [viewMode, monthlyData, dailyData, weeklyData, year]);

  // ===== DRILL-DOWN DETAIL FOR MONTHLY VIEW =====
  type DrillGroup = 'FORNITORI' | 'AFFITTI' | 'PERSONALE' | 'FINANZIAMENTI' | 'FISCALI' | 'RICORRENTI'
  type DrillItem = { label: string; amount: number; state?: 'certo' | 'stima'; group?: DrillGroup; sub?: string; editable?: { voiceKey: string; label: string; monthIdx: number } }
  const getMonthlyDrillDown = (monthIdx: number, column: string): DrillItem[] => {
    const filteredOutlet = selectedOutlet === 'all' ? null : selectedOutlet;
    const outletIdToCode: Record<string, string> = {};
    const outletIdToName: Record<string, string> = {};
    rawOutlets.forEach(o => {
      const id = String(o.id || ''); if (!id) return;
      outletIdToCode[id] = String(o.code || '');
      outletIdToName[id] = String(o.name || o.code || '');
    });

    if (column === 'entrate') {
      const items: DrillItem[] = [];
      // Daily revenue records for this month
      (rawDailyRevenue || []).forEach(rev => {
        const dateStr = String(rev.date || '');
        if (!dateStr) return;
        const d = new Date(dateStr);
        if (d.getMonth() === monthIdx && d.getFullYear() === year) {
          const oid = String(rev.outlet_id || '');
          if (!filteredOutlet || outletIdToCode[oid] === filteredOutlet) {
            items.push({
              label: `${formatDateFull(dateStr)} - ${outletIdToName[oid] || 'N/A'}`,
              amount: Math.round(Number(rev.gross_revenue) || 0),
              state: 'certo'
            });
          }
        }
      });
      // Budget entries
      (rawBudgetConfronto || []).forEach(entry => {
        if (entry.entry_type === 'rev_monthly' && ((Number(entry.month) || 0) - 1) === monthIdx) {
          if (!filteredOutlet || entry.cost_center === filteredOutlet) {
            items.push({
              label: `Budget - ${String(entry.cost_center || 'Generale')}`,
              amount: Math.round(Number(entry.amount) || 0),
              state: 'stima'
            });
          }
        }
      });
      return items;
    } else {
      const items: DrillItem[] = [];
      // Payables due this month — nome fornitore in chiaro, fattura+scadenza come dettaglio.
      (rawPayables || []).forEach(p => {
        if (!p.due_date) return;
        const due = String(p.due_date);
        const d = new Date(due);
        if (d.getMonth() !== monthIdx || d.getFullYear() !== year) return;
        const oid = String(p.outlet_id || '');
        if (filteredOutlet && outletIdToCode[oid] !== filteredOutlet) return;
        const outstanding = (Number(p.gross_amount) || 0) - (Number(p.amount_paid) || 0);
        if (outstanding > 0) {
          const num = String(p.invoice_number || '-');
          const supplier = String(p.supplier_name || '').trim() || `Fatt. ${num}`;
          // Fattura a rate (installment_total>1): indica "rata X/N" nel sottotitolo.
          const instTot = Number(p.installment_total) || 0;
          const instNum = Number(p.installment_number) || 0;
          const rata = instTot > 1 ? ` · rata ${instNum}/${instTot}` : '';
          items.push({
            label: supplier,
            sub: `Fatt. ${num}${rata} · scad. ${formatDate(due)}`,
            amount: Math.round(outstanding),
            state: 'certo',
            group: 'FORNITORI',
          });
        }
      });
      // Canoni reali per outlet (Modello A: niente stima costi-a-budget).
      rawOutlets.forEach(o => {
        if (!filteredOutlet || o.code === filteredOutlet) {
          const rent = Number(o.rent_monthly) || 0;
          if (rent > 0) {
            items.push({ label: String(o.name || o.code || ''), amount: Math.round(rent), state: 'certo', group: 'AFFITTI' });
          }
        }
      });
      // Recurring costs (escluse righe-stima override/auto: gestite sotto come stima viva)
      (rawRecurringCosts || []).forEach(cost => {
        const notes = String((cost as Record<string, unknown>).notes || '');
        if (OVERRIDE_RE.test(notes) || notes.includes('[auto:')) return;
        if (!filteredOutlet || cost.cost_center === filteredOutlet) {
          // Check if this cost applies to this month
          const startMonth = (Number(cost.month_start) || 1) - 1;
          let applies = false;
          if (cost.frequency === 'monthly') applies = true;
          else if (cost.frequency === 'bimonthly') applies = (monthIdx - startMonth) % 2 === 0 && monthIdx >= startMonth;
          else if (cost.frequency === 'quarterly') applies = (monthIdx - startMonth) % 3 === 0 && monthIdx >= startMonth;
          else if (cost.frequency === 'semiannual') applies = (monthIdx - startMonth) % 6 === 0 && monthIdx >= startMonth;
          else if (cost.frequency === 'annual') applies = monthIdx === startMonth;
          if (applies) {
            items.push({ label: `≈ ${String(cost.description || cost.category || 'Costo ricorrente')}`, amount: Math.round(Number(cost.amount) || 0), state: 'stima', group: 'RICORRENTI' });
          }
        }
      });
      // STIMA VIVA (B rettifica): stipendi netti + amministratori, solo mesi futuri.
      // Override per voce+mese (recurring_costs [override:...]) vince sul calcolato. Editabile inline.
      {
        const md = monthlyData[monthIdx];
        const isForecast = md?.tipo === 'Previsione' || md?.tipo === 'In corso';
        if (isForecast && !filteredOutlet) {
          const ovMap: Record<string, number> = {};
          (rawRecurringCosts || []).forEach(rc => {
            const mm = OVERRIDE_RE.exec(String((rc as Record<string, unknown>).notes || ''));
            if (mm && Number(mm[2]) === year && Number(mm[3]) - 1 === monthIdx) ovMap[mm[1]] = Number((rc as Record<string, unknown>).amount) || 0;
          });
          const seen = new Set<string>();
          estimateVoices.forEach(v => {
            seen.add(v.key);
            const ov = ovMap[v.key];
            const amount = ov !== undefined ? ov : v.amount;
            if (amount > 0) items.push({ label: `≈ ${v.label}${ov !== undefined ? ' (corretto)' : ''}`, amount: Math.round(amount), state: 'stima', group: 'PERSONALE', editable: { voiceKey: v.key, label: v.label, monthIdx } });
          });
          Object.keys(ovMap).forEach(vk => {
            if (seen.has(vk)) return;
            const amount = ovMap[vk];
            if (amount > 0) items.push({ label: `≈ ${vk} (corretto)`, amount: Math.round(amount), state: 'stima', group: 'PERSONALE', editable: { voiceKey: vk, label: vk, monthIdx } });
          });
        }
      }
      // Loan payments
      (rawLoans || []).forEach(loan => {
        const monthly = Number(loan.monthly_payment) || Number(loan.installment_amount) || 0;
        if (monthly > 0) {
          items.push({ label: `Rata - ${String(loan.description || 'Finanziamento')}`, amount: Math.round(monthly), state: 'certo', group: 'FINANZIAMENTI' });
        }
      });
      // E — scadenze fiscali (IVA/imposte): stima variabile (azzurro)
      (rawFiscal || []).forEach(f => {
        if (['paid', 'cancelled', 'pagato', 'annullato'].includes(String(f.status || '').toLowerCase())) return;
        if (!f.due_date) return;
        const dd = new Date(String(f.due_date));
        if (dd.getMonth() !== monthIdx || dd.getFullYear() !== year) return;
        const residuo = (Number(f.amount) || 0) - (Number(f.amount_paid) || 0);
        if (residuo > 0) {
          items.push({ label: `≈ ${String(f.title || f.deadline_type || 'Scadenza fiscale')}`, sub: `scad. ${formatDate(String(f.due_date))}`, amount: Math.round(residuo), state: 'stima', group: 'FISCALI' });
        }
      });
      return items;
    }
  };

  const handleDrillDown = (rowIdx: number, column: 'entrate' | 'uscite') => {
    if (expandedRow === rowIdx && expandedColumn === column) {
      setExpandedRow(null);
      setExpandedColumn(null);
    } else {
      setExpandedRow(rowIdx);
      setExpandedColumn(column);
    }
  };

  const getDrillDownItems = (rowIdx: number, column: string) => {
    if (viewMode === 'mensile') {
      return getMonthlyDrillDown(rowIdx, column);
    }
    // For daily/weekly, items are pre-computed
    const row = activeData[rowIdx];
    if (!row) return [];
    return column === 'entrate' ? (row.entrateItems || []) : (row.usciteItems || []);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <Loader className="w-12 h-12 animate-spin mx-auto mb-4 text-indigo-600" />
          <p className="text-slate-600">Caricamento cashflow...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">Errore: {error}</p>
        </div>
      </div>
    );
  }

  // Determine chart data based on view mode
  const chartData = viewMode === 'mensile'
    ? monthlyData.map((m, idx) => {
        const actual = actualMonthlyData[idx];
        const hasActual = actual && actual.hasData;
        return {
          ...m,
          entrate_reali: hasActual ? Math.round(actual.entrate) : null,
          uscite_reali: hasActual ? Math.round(actual.uscite) : null,
          netto_reale: hasActual ? Math.round(actual.netto) : null,
        };
      })
    : viewMode === 'giornaliero'
      ? dailyData.map(d => ({
          monthName: d.label,
          tot_entrate: d.entrate,
          tot_uscite: d.uscite,
          saldo_progressivo: d.saldo_progressivo,
          flusso_netto: d.flusso_netto
        }))
      : weeklyData.map(w => ({
          monthName: w.label,
          tot_entrate: w.entrate,
          tot_uscite: w.uscite,
          saldo_progressivo: w.saldo_progressivo,
          flusso_netto: w.flusso_netto
        }));

  const chartTitle = viewMode === 'giornaliero'
    ? 'Andamento Cashflow 30 Giorni'
    : viewMode === 'settimanale'
      ? 'Andamento Cashflow 13 Settimane'
      : 'Andamento Cashflow 12 Mesi';

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Negative Balance Alert */}
      {negativeAlert && (
        <div className="mb-6 bg-red-600 text-white rounded-xl p-4 shadow-lg sticky top-4 z-10">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 flex-shrink-0" />
            <div>
              <p className="font-bold text-lg">
                Attenzione: il saldo diventera negativo il {negativeAlert.period}
              </p>
              <p className="text-red-100 mt-1">
                Uscite previste: {formatCurrency(negativeAlert.uscite)} — Saldo atteso: {formatCurrency(negativeAlert.saldo)}
              </p>
            </div>
          </div>
        </div>
      )}

      <PageHeader
        title="Cashflow Prospettico"
        subtitle="Proiezione liquidità giornaliera, settimanale e mensile"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchAllData()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium rounded-lg transition disabled:opacity-50"
              title="Ri-leggi i dati (scadenze, fiscali, ricorrenti) modificati in altre pagine"
            >
              {loading ? 'Aggiorno…' : 'Aggiorna'}
            </button>
            <button
              onClick={() => {
                setEditingForecastId(null);
                setForecastTipo('una_tantum');
                setForecastFrequency('monthly');
                setForecastDayOfMonth('');
                setForecastEndDate('');
                setForecastAmount('');
                setForecastDescription('');
                setForecastDate(new Date().toISOString().slice(0, 10));
                setShowForecastModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition"
              title="Crea una previsione di uscita futura, una tantum o ricorrente"
            >
              <span className="text-lg leading-none">+</span> Previsione uscita
            </button>
          </div>
        }
      />

      {/* Lista previsioni manuali — sezione collassabile */}
      {forecasts.length > 0 && (
        <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm">
          <button onClick={() => setShowForecastList(!showForecastList)}
            className="w-full px-5 py-3 flex items-center justify-between hover:bg-indigo-50/50 transition">
            <div className="flex items-center gap-2">
              <span className="text-indigo-600 font-semibold text-sm">📋 Previsioni manuali ({forecasts.length})</span>
              <span className="text-xs text-slate-500">— totale € {forecasts.reduce((s, f) => s + (Number(f.gross_amount) || 0), 0).toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
            </div>
            <span className="text-indigo-500 text-sm">{showForecastList ? '▼ Nascondi' : '▶ Mostra'}</span>
          </button>
          {showForecastList && (
            <div className="border-t border-indigo-100 max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-indigo-50/50 text-xs text-indigo-700 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Data</th>
                    <th className="px-4 py-2 text-left">Descrizione</th>
                    <th className="px-4 py-2 text-right">Importo</th>
                    <th className="px-4 py-2 text-center w-24">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {forecasts.map(f => (
                    <tr key={f.id} className="border-t border-slate-50 hover:bg-indigo-50/20">
                      <td className="px-4 py-2 text-slate-700 font-mono text-xs">{f.due_date ? new Date(f.due_date).toLocaleDateString('it-IT') : '—'}</td>
                      <td className="px-4 py-2 text-slate-800">{f.notes || (f.invoice_number || '').replace('[PREV] ', '')}</td>
                      <td className="px-4 py-2 text-right font-mono font-medium text-slate-900">€ {Number(f.gross_amount ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex justify-center gap-1">
                          <button onClick={() => handleEditForecast(f)} className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600" title="Modifica">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button onClick={() => setForecastToDelete({ id: f.id, descr: f.notes || (f.invoice_number || '').replace('[PREV] ', '') })} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600" title="Elimina">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
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
      )}

      {/* Modal conferma elimina previsione (sostituisce confirm() nativo) */}
      {forecastToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setForecastToDelete(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Elimina previsione?</h2>
            <p className="text-sm text-slate-600 mb-5">Verrà eliminata: <span className="font-medium text-slate-900">{forecastToDelete.descr}</span></p>
            <div className="flex gap-2">
              <button onClick={() => setForecastToDelete(null)}
                className="flex-1 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">
                Annulla
              </button>
              <button onClick={handleConfirmDeleteForecast}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg">
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Previsione uscita inline (creazione o modifica) */}
      {showForecastModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => !forecastSaving && setShowForecastModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 mb-1">{editingForecastId ? 'Modifica previsione' : 'Aggiungi previsione uscita'}</h2>
            <p className="text-xs text-slate-500 mb-4">Entra solo nel cashflow prospettico, NON nel Conto Economico</p>
            <div className="space-y-3">
              {/* B.1 — Tipo: una tantum o ricorrente (solo in creazione) */}
              {!editingForecastId && (
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Tipo</label>
                  <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                    {([['una_tantum', 'Una tantum'], ['ricorrente', 'Ricorrente']] as const).map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setForecastTipo(v)}
                        className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${forecastTipo === v ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-500'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">{forecastTipo === 'ricorrente' ? 'Data inizio *' : 'Data prevista *'}</label>
                <input type="date" value={forecastDate} onChange={(e) => setForecastDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
              {forecastTipo === 'ricorrente' && !editingForecastId && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">Frequenza *</label>
                    <select value={forecastFrequency} onChange={(e) => setForecastFrequency(e.target.value as typeof forecastFrequency)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
                      <option value="monthly">Mensile</option>
                      <option value="bimonthly">Bimestrale</option>
                      <option value="quarterly">Trimestrale</option>
                      <option value="semiannual">Semestrale</option>
                      <option value="annual">Annuale</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">Giorno mese</label>
                    <input type="number" min="1" max="31" value={forecastDayOfMonth} onChange={(e) => setForecastDayOfMonth(e.target.value)}
                      placeholder="es. 27" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-slate-600 block mb-1">Data fine (vuoto = indeterminato)</label>
                    <input type="date" value={forecastEndDate} onChange={(e) => setForecastEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Importo (€) *</label>
                <input type="number" step="0.01" min="0" value={forecastAmount} onChange={(e) => setForecastAmount(e.target.value)}
                  placeholder="es. 5000.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Descrizione *</label>
                <input type="text" value={forecastDescription} onChange={(e) => setForecastDescription(e.target.value)}
                  placeholder="es. Ristrutturazione outlet Valdichiana"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowForecastModal(false)} disabled={forecastSaving}
                className="flex-1 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50">
                Annulla
              </button>
              <button onClick={handleSaveForecast} disabled={forecastSaving}
                className="flex-1 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50">
                {forecastSaving ? 'Salvataggio...' : 'Aggiungi previsione'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="mb-8">
        {/* View Mode Selector */}
        <div className="flex gap-1 mb-4 bg-slate-200 rounded-lg p-1 w-fit">
          {([
            { value: 'giornaliero', label: 'Giornaliero', sub: '30 giorni' },
            { value: 'settimanale', label: 'Settimanale', sub: '3 mesi' },
            { value: 'mensile', label: 'Mensile', sub: '12 mesi' }
          ] as const).map(mode => (
            <button
              key={mode.value}
              onClick={() => setViewMode(mode.value)}
              className={`px-4 py-2 rounded-md font-medium transition text-sm ${
                viewMode === mode.value
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {mode.label}
              <span className={`ml-1 text-xs ${viewMode === mode.value ? 'text-indigo-400' : 'text-slate-400'}`}>
                ({mode.sub})
              </span>
            </button>
          ))}
        </div>

        {/* Modello A: toolbar minimale. Rimossi anno (resta il selettore globale in alto),
            filtro outlet (la cassa è di società), scenario ±10% ed Esporta. */}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
          <p className="text-slate-600 text-sm font-medium mb-2">Saldo Iniziale</p>
          <p className={`text-2xl font-bold ${initialBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(initialBalance)}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <p className="text-slate-600 text-sm font-medium">Entrate Stimate</p>
          </div>
          <p className="text-2xl font-bold text-green-600">
            {formatCurrency(totalInflows)}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-red-600" />
            <p className="text-slate-600 text-sm font-medium">Uscite Stimate</p>
          </div>
          <p className="text-2xl font-bold text-red-600">
            {formatCurrency(totalOutflows)}
          </p>
        </div>

        <div className={`rounded-xl shadow-sm p-6 border ${
          hasNegativeMonth
            ? 'bg-red-50 border-red-200'
            : 'bg-white border-slate-200'
        }`}>
          <p className={`text-sm font-medium mb-2 ${hasNegativeMonth ? 'text-red-700' : 'text-slate-600'}`}>
            Saldo Finale Stimato
          </p>
          <p className={`text-2xl font-bold ${finalBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(finalBalance)}
          </p>
          {hasNegativeMonth && (
            <div className="flex items-center gap-1 mt-3 text-red-600 text-xs">
              <AlertTriangle className="w-4 h-4" />
              <span>Saldo negativo in alcuni mesi</span>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-8 border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900 mb-2">{chartTitle}</h2>
        {viewMode === 'mensile' && (
          <div className="flex flex-wrap items-center gap-4 mb-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><CheckCircle size={14} className="text-emerald-700" /> Consuntivo (barre piene)</span>
            <span className="flex items-center gap-1"><Clock size={14} className="text-emerald-400" /> Previsione (barre sfumate)</span>
            <PlaceholderLegend />
          </div>
        )}
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={chartData}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="monthName"
              {...AXIS_STYLE}
              angle={viewMode !== 'mensile' ? -45 : 0}
              textAnchor={viewMode !== 'mensile' ? 'end' : 'middle'}
              height={viewMode !== 'mensile' ? 60 : 30}
              interval={viewMode === 'giornaliero' ? 2 : 0}
              tick={{ fontSize: viewMode !== 'mensile' ? 10 : 12 }}
            />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<GlassTooltip />} />
            <Legend />
            {viewMode === 'mensile' && (
              <>
                <Bar dataKey="entrate_reali" fill="#059669" name="Entrate Reali" radius={[8, 8, 0, 0]} />
                <Bar dataKey="uscite_reali" fill="#dc2626" name="Uscite Reali" radius={[8, 8, 0, 0]} />
              </>
            )}
            <Bar dataKey="tot_entrate" fill="#10b981" name="Entrate Previste" radius={[8, 8, 0, 0]} opacity={viewMode === 'mensile' ? 0.5 : 0.8} />
            <Bar dataKey="tot_uscite" fill="#ef4444" name="Uscite Previste" radius={[8, 8, 0, 0]} opacity={viewMode === 'mensile' ? 0.5 : 0.8} />
            <Line
              type="monotone"
              dataKey="saldo_progressivo"
              stroke="#3b82f6"
              strokeWidth={3}
              name="Saldo Cumulativo"
              dot={{ fill: '#3b82f6', r: viewMode === 'giornaliero' ? 2 : 4 }}
              activeDot={{ r: 6 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Detail Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-900">
                  {viewMode === 'giornaliero' ? 'Giorno' : viewMode === 'settimanale' ? 'Settimana' : 'Mese'}
                </th>
                {viewMode === 'mensile' && (
                  <>
                    <th className="px-4 py-3 text-center font-semibold text-slate-900">Tipo</th>
                    <th className="px-4 py-3 text-right font-semibold text-emerald-800">Entrate Reali</th>
                    <th className="px-4 py-3 text-right font-semibold text-red-800">Uscite Reali</th>
                  </>
                )}
                <th className="px-4 py-3 text-right font-semibold text-slate-900">
                  {viewMode === 'mensile' ? 'Tot Entrate (prev.)' : 'Entrate'}
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">
                  {viewMode === 'mensile' ? (
                    <TextTooltip content="Mesi in Previsione / In corso: stima da budget costi-cassa (esclusi ammortamenti e variazione rimanenze; i canoni di affitto sono già inclusi nel godimento beni di terzi). I mesi a Consuntivo mostrano le uscite reali.">
                      <span className="border-b border-dotted border-slate-400 cursor-help">Tot Uscite (prev.)</span>
                    </TextTooltip>
                  ) : 'Uscite'}
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Flusso Netto</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Saldo Progressivo</th>
              </tr>
            </thead>
            <tbody>
              {viewMode === 'mensile' ? (
                // Monthly view (original)
                monthlyData.map((month, idx) => {
                  const actual = actualMonthlyData[idx];
                  const hasActual = actual && actual.hasData;
                  const isConsuntivo = month.tipo === 'Consuntivo';
                  const isInCorso = month.tipo === 'In corso';
                  const isExpanded = expandedRow === idx;

                  return (
                    <React.Fragment key={idx}>
                      <tr
                        className={`border-b border-slate-200 hover:bg-slate-50 transition ${
                          (month.saldo_progressivo ?? 0) < 0 ? 'bg-red-50' : ''
                        } ${isConsuntivo ? 'bg-emerald-50/30' : ''}`}
                      >
                        <td className="px-4 py-3 font-semibold text-slate-900">{month.monthName}</td>
                        <td className="px-4 py-3 text-center">
                          {isConsuntivo && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                              <CheckCircle size={12} /> Consuntivo
                            </span>
                          )}
                          {isInCorso && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                              <Clock size={12} /> In corso
                            </span>
                          )}
                          {month.tipo === 'Previsione' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                              <Clock size={12} /> Previsione
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-700 font-medium">
                          {hasActual ? formatCurrency(Math.round(actual.entrate)) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-red-700 font-medium">
                          {hasActual ? formatCurrency(Math.round(actual.uscite)) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDrillDown(idx, 'entrate')}
                            className={`font-semibold hover:underline cursor-pointer inline-flex items-center gap-1 ${(month.tipo === 'Previsione' || month.tipo === 'In corso') ? 'text-sky-600' : 'text-slate-900'}`}
                            title={(month.tipo === 'Previsione' || month.tipo === 'In corso') ? 'Stima da budget B&C (preventivo), variabile' : undefined}
                          >
                            {(month.tipo === 'Previsione' || month.tipo === 'In corso') ? '≈ ' : ''}{formatCurrency(month.tot_entrate)}
                            <PlaceholderDot show={month.entrate_ph} tip="Entrate previsionali: la quota a budget di questo mese deriva da righe segnaposto (clone 2025) non ancora granite in Budget & Controllo." />
                            {isExpanded && expandedColumn === 'entrate'
                              ? <ChevronDown size={14} />
                              : <ChevronRight size={14} className="opacity-40" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDrillDown(idx, 'uscite')}
                            className="font-semibold text-red-600 hover:underline cursor-pointer inline-flex items-center gap-1"
                          >
                            {formatCurrency(month.tot_uscite)}
                            {isExpanded && expandedColumn === 'uscite'
                              ? <ChevronDown size={14} />
                              : <ChevronRight size={14} className="opacity-40" />}
                          </button>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${
                          (hasActual ? actual.netto : month.flusso_netto) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {hasActual
                            ? formatCurrency(Math.round(actual.netto))
                            : formatCurrency(month.flusso_netto)
                          }
                          {hasActual && (
                            <span className="text-xs text-slate-400 ml-1">(reale)</span>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          month.saldo_progressivo == null ? 'text-slate-300' : month.saldo_progressivo >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {month.saldo_progressivo == null ? '—' : formatCurrency(month.saldo_progressivo)}
                        </td>
                      </tr>
                      {/* Drill-down detail row */}
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-6 py-4">
                            <DrillDownPanel
                              items={getDrillDownItems(idx, expandedColumn || '')}
                              column={expandedColumn || ''}
                              title={`${month.monthName} ${year}`}
                              onClose={() => { setExpandedRow(null); setExpandedColumn(null); }}
                              onEdit={handleSaveOverride}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                // Daily / Weekly view
                activeData.map((row, idx) => {
                  const isExpanded = expandedRow === idx;
                  return (
                    <React.Fragment key={idx}>
                      <tr
                        className={`border-b border-slate-200 hover:bg-slate-50 transition ${
                          row.saldo_progressivo < 0 ? 'bg-red-50' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">{row.label}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDrillDown(idx, 'entrate')}
                            className="font-semibold text-green-600 hover:underline cursor-pointer inline-flex items-center gap-1"
                          >
                            {formatCurrency(row.entrate)}
                            {isExpanded && expandedColumn === 'entrate'
                              ? <ChevronDown size={14} />
                              : <ChevronRight size={14} className="opacity-40" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDrillDown(idx, 'uscite')}
                            className="font-semibold text-red-600 hover:underline cursor-pointer inline-flex items-center gap-1"
                          >
                            {formatCurrency(row.uscite)}
                            {isExpanded && expandedColumn === 'uscite'
                              ? <ChevronDown size={14} />
                              : <ChevronRight size={14} className="opacity-40" />}
                          </button>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${
                          row.flusso_netto >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {formatCurrency(row.flusso_netto)}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          row.saldo_progressivo >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {formatCurrency(row.saldo_progressivo)}
                        </td>
                      </tr>
                      {/* Drill-down detail row */}
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={5} className="px-6 py-4">
                            <DrillDownPanel
                              items={getDrillDownItems(idx, expandedColumn || '')}
                              column={expandedColumn || ''}
                              title={String(row.label || '')}
                              onClose={() => { setExpandedRow(null); setExpandedColumn(null); }}
                              onEdit={handleSaveOverride}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary row */}
      <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
        <div className="grid grid-cols-5 gap-4 text-center">
          <div>
            <p className="text-xs font-medium text-indigo-700 mb-1">TOTALE ENTRATE</p>
            <p className="text-lg font-bold text-indigo-900">{formatCurrency(totalInflows)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-indigo-700 mb-1">TOTALE USCITE</p>
            <p className="text-lg font-bold text-indigo-900">{formatCurrency(totalOutflows)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-indigo-700 mb-1">FLUSSO NETTO ANNUALE</p>
            <p className={`text-lg font-bold ${totalInflows - totalOutflows >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(totalInflows - totalOutflows)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-indigo-700 mb-1">SALDO INIZIALE</p>
            <p className="text-lg font-bold text-indigo-900">{formatCurrency(initialBalance)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-indigo-700 mb-1">SALDO FINALE</p>
            <p className={`text-lg font-bold ${finalBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(finalBalance)}
            </p>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

// ===== DRILL-DOWN PANEL COMPONENT =====
type DrillPanelItem = { label: string; amount: number; state?: 'certo' | 'stima'; group?: string; sub?: string; editable?: { voiceKey: string; label: string; monthIdx: number } };
// Ordine ed etichette dei gruppi del Dettaglio Uscite (i gruppi-stima hanno "(stima)").
const DRILL_GROUPS: { key: string; label: string; stima?: boolean }[] = [
  { key: 'FORNITORI', label: 'FORNITORI' },
  { key: 'AFFITTI', label: 'AFFITTI' },
  { key: 'PERSONALE', label: 'PERSONALE (stima)', stima: true },
  { key: 'FINANZIAMENTI', label: 'FINANZIAMENTI' },
  { key: 'FISCALI', label: 'FISCALI (stima)', stima: true },
  { key: 'RICORRENTI', label: 'RICORRENTI' },
];
function DrillDownPanel({ items, column, onClose, onEdit, title }: { items: DrillPanelItem[]; column: string; onClose: () => void; onEdit?: (voiceKey: string, label: string, monthIdx: number, amount: number) => void; title?: string }) {
  const isEntrate = column === 'entrate';
  const total = items.reduce((sum, item) => sum + (item.amount || 0), 0);
  // Inline-edit override stima (hook PRIMA di ogni return)
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');

  // Voci con indice originale stabile (per l'inline-edit anche dopo il raggruppamento).
  const indexed = items.map((item, i) => ({ item, i }));
  const grouped = !isEntrate && indexed.some(x => x.item.group);

  // Riga voce singola (riuso per render flat e raggruppato).
  const renderRow = (item: DrillPanelItem, i: number, indent: boolean) => (
    <div key={i} className={`flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0 ${indent ? 'pl-3' : ''}`}>
      <div className="min-w-0 mr-4">
        <TextTooltip content={item.state === 'stima' ? `${item.label} — stima variabile, modificabile` : (item.label || '')}>
          <span className="text-slate-700 truncate block">{item.label}</span>
        </TextTooltip>
        {item.sub && <span className="text-[10px] text-slate-400 truncate block">{item.sub}</span>}
      </div>
      {editingKey === i && item.editable ? (
        <span className="flex items-center gap-1 shrink-0">
          <input type="number" autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
            className="w-24 px-1.5 py-0.5 border border-sky-300 rounded text-right text-xs tabular-nums" />
          <button onClick={() => { const v = parseFloat(editVal.replace(',', '.')); if (!isNaN(v) && v >= 0 && item.editable && onEdit) onEdit(item.editable.voiceKey, item.editable.label, item.editable.monthIdx, v); setEditingKey(null); }}
            className="text-emerald-600 font-bold px-1" title="Salva">✓</button>
          <button onClick={() => setEditingKey(null)} className="text-slate-400 px-1" title="Annulla">✕</button>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 shrink-0">
          {/* Colore-numero per CERTEZZA: nero=certo, azzurro=stima (≈). Mai rosso qui (riservato al saldo). */}
          <span className={`font-medium whitespace-nowrap tabular-nums ${item.state === 'stima' ? 'text-sky-600' : 'text-slate-900'}`}>
            {item.state === 'stima' ? '≈ ' : ''}{formatCurrency(item.amount)}
          </span>
          {item.editable && onEdit && (
            <button onClick={() => { setEditingKey(i); setEditVal(String(item.amount)); }}
              className="text-slate-400 hover:text-sky-600" title="Correggi questa stima per il mese">✎</button>
          )}
        </span>
      )}
    </div>
  );

  return (
    <div className={`rounded-lg border p-4 ${isEntrate ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className={`font-semibold text-sm ${isEntrate ? 'text-green-800' : 'text-red-800'}`}>
          {(isEntrate ? 'Dettaglio Entrate' : 'Dettaglio Uscite')}{title ? ` — ${title}` : ''}
          {items.length > 0 && <span className="ml-1 font-normal text-slate-500">· {formatCurrency(total)}</span>}
        </h4>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
          <X size={16} />
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-slate-500 text-xs italic">Nessun dettaglio disponibile per questo periodo.</p>
      ) : grouped ? (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {DRILL_GROUPS.map(g => {
            const rows = indexed.filter(x => x.item.group === g.key).sort((a, b) => b.item.amount - a.item.amount);
            if (rows.length === 0) return null;
            const sub = rows.reduce((s, x) => s + (x.item.amount || 0), 0);
            return (
              <div key={g.key}>
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide bg-slate-100 rounded px-2 py-1">
                  <span className="text-slate-600">{g.label}</span>
                  <span className={`tabular-nums ${g.stima ? 'text-sky-600' : 'text-slate-900'}`}>{g.stima ? '≈ ' : ''}{formatCurrency(sub)}</span>
                </div>
                {rows.map(x => renderRow(x.item, x.i, true))}
              </div>
            );
          })}
          <div className="flex items-center justify-between text-xs py-2 border-t-2 border-slate-300 font-bold">
            <span className="text-slate-900">TOTALE USCITE</span>
            <span className="text-slate-900 tabular-nums">{formatCurrency(total)}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {indexed.map(x => renderRow(x.item, x.i, false))}
          {items.length > 1 && (
            <div className="flex items-center justify-between text-xs py-2 border-t-2 border-slate-300 font-bold mt-1">
              <span className="text-slate-900">Totale</span>
              <span className="text-slate-900 tabular-nums">{formatCurrency(total)}</span>
            </div>
          )}
        </div>
      )}
      {items.some(it => it.state === 'stima') && (
        <div className="mt-2 text-[11px] text-sky-600 flex items-center gap-1">
          <span className="font-medium">≈ azzurro = stima variabile</span>
          <span className="text-slate-400">(modificabile)</span>
        </div>
      )}
    </div>
  );
}
