import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  Calculator, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Store, Building2, Plus, Trash2, Edit3, Save, Lock, Unlock,
  AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, Target,
  Calendar, ClipboardCheck, BarChart3, Info, X, Download, MessageSquare
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, CartesianGrid,
  LineChart, Line, ResponsiveContainer as RCLine
} from 'recharts'
import { supabase } from '../lib/supabase'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE, BAR_RADIUS, ModernLegend, fmtEuro, fmtK } from '../components/ChartTheme'
const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
              'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
const MESI_SHORT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

function fmt(n, dec = 0) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}

function deltaPercent(budget, actual) {
  if (actual == null || budget == null || budget === 0) return null
  return ((actual - budget) / Math.abs(budget)) * 100
}

function deltaClass(d, isCost = true) {
  if (d == null) return 'text-slate-400'
  if (isCost) {
    // For costs: negative = good (under budget), positive = bad (over budget)
    if (d > 2) return 'text-red-600'
    if (d < -2) return 'text-emerald-600'
  } else {
    // For revenue: positive = good (over budget), negative = bad (under budget)
    if (d > 2) return 'text-emerald-600'
    if (d < -2) return 'text-red-600'
  }
  return 'text-slate-500'
}

/* ═══════════════════════════════════════════════════════════
   BUDGET ENTRY ROW
   ═══════════════════════════════════════════════════════════ */
function BudgetEntryRow({ entry, macroGroup, onUpdate, onDelete, isEditable, isCost = true }) {
  const variance = entry.actual_amount != null && entry.budget_amount != null
    ? entry.actual_amount - entry.budget_amount
    : null
  const variancePercent = deltaPercent(entry.budget_amount, entry.actual_amount)

  return (
    <tr className="border-t border-slate-50 hover:bg-slate-50/30 transition text-sm group">
      <td className="py-2 px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-700 font-medium">{entry.account_name}</span>
        </div>
        <span className="text-xs text-slate-400">{entry.account_code}</span>
      </td>
      <td className="py-2 px-3 text-right">
        {isEditable ? (
          <input
            type="number"
            value={entry.budget_amount || ''}
            onChange={e => onUpdate({...entry, budget_amount: parseFloat(e.target.value) || 0})}
            className="w-24 text-right px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
          />
        ) : (
          <span className="text-slate-700">{fmt(entry.budget_amount, 0)} €</span>
        )}
      </td>
      <td className="py-2 px-3 text-right">
        {entry.is_approved ? (
          <span className="text-slate-700">{entry.actual_amount != null ? `${fmt(entry.actual_amount, 0)} €` : '—'}</span>
        ) : (
          <input
            type="number"
            value={entry.actual_amount ?? ''}
            onChange={e => onUpdate({...entry, actual_amount: e.target.value === '' ? null : parseFloat(e.target.value)})}
            placeholder="—"
            className="w-24 text-right px-2 py-1 text-sm border border-blue-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-blue-50/30"
          />
        )}
      </td>
      <td className="py-2 px-3 text-right">
        {variance != null ? (
          <span className={`text-sm font-medium ${isCost ? (variance >= 0 ? 'text-red-600' : 'text-emerald-600') : (variance >= 0 ? 'text-emerald-600' : 'text-red-600')}`}>
            {variance >= 0 ? '+' : ''}{fmt(variance, 0)} €
          </span>
        ) : '—'}
      </td>
      <td className={`py-2 px-3 text-right text-xs font-medium ${deltaClass(variancePercent, isCost)}`}>
        {variancePercent != null ? `${variancePercent >= 0 ? '+' : ''}${variancePercent.toFixed(1)}%` : '—'}
      </td>
      <td className="py-2 px-1 text-center">
        {onDelete && (
          <button
            onClick={() => onDelete(entry.account_code)}
            className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
            title="Rimuovi voce"
          >
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  )
}

/* ═══════════════════════════════════════════════════════════
   BUDGET GRID GROUPED BY MACRO_GROUP
   ═══════════════════════════════════════════════════════════ */
function BudgetGrid({ entries, costCenter, onUpdate, onDelete, isEditable }) {
  const grouped = useMemo(() => {
    const groups = {}
    entries.forEach(e => {
      if (!groups[e.macro_group]) groups[e.macro_group] = []
      groups[e.macro_group].push(e)
    })
    return groups
  }, [entries])

  const macroGroups = Object.keys(grouped).sort()

  if (macroGroups.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400 text-sm">
        Nessuna voce di budget. Carica il template da chart of accounts.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {macroGroups.map(mg => (
        <div key={mg} className="rounded-lg overflow-hidden border border-slate-100">
          <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">{mg}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-xs text-slate-500 uppercase tracking-wider">
                  <th className="py-2 px-3 text-left font-medium">Voce</th>
                  <th className="py-2 px-3 text-right font-medium w-32">Budget (€)</th>
                  <th className="py-2 px-3 text-right font-medium w-32">Consuntivo (€)</th>
                  <th className="py-2 px-3 text-right font-medium w-28">Scostamento (€)</th>
                  <th className="py-2 px-3 text-right font-medium w-24">Scost. (%)</th>
                  <th className="py-2 px-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {grouped[mg].map(entry => (
                  <BudgetEntryRow
                    key={entry.account_code}
                    entry={entry}
                    macroGroup={mg}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    isEditable={isEditable}
                    isCost={mg !== 'Ricavi'}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   MAIN BUDGET CONTROL PAGE
   ═══════════════════════════════════════════════════════════ */
export default function BudgetControl() {
  const { profile } = useAuth()
  const COMPANY_ID = profile?.company_id
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [monthView, setMonthView] = useState('single') // 'single' | 'annual'
  const [costCenter, setCostCenter] = useState('all')
  const [view, setView] = useState('grid') // 'grid' | 'chart' | 'variance'

  // Data loading states
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [costCenters, setCostCenters] = useState([])
  const [chartOfAccounts, setChartOfAccounts] = useState([])
  const [budgetEntries, setBudgetEntries] = useState([])
  const [editedEntries, setEditedEntries] = useState(new Map())
  const [showApproveConfirm, setShowApproveConfirm] = useState(false)
  const [showNoteModal, setShowNoteModal] = useState(null) // entry per cui mostrare note
  const [annualData, setAnnualData] = useState([]) // dati 12 mesi per vista annuale

  // Load initial data
  useEffect(() => {
    if (!COMPANY_ID) return
    const loadData = async () => {
      setLoading(true)
      try {
        // Load cost centers
        const { data: ccData } = await supabase
          .from('cost_centers')
          .select('*')
          .eq('company_id', COMPANY_ID)
        setCostCenters(ccData || [])

        // Load chart of accounts
        const { data: coaData } = await supabase
          .from('chart_of_accounts')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .order('code')
        setChartOfAccounts(coaData || [])

        // Load budget entries for current month
        await loadBudgetForMonth(year, month)
      } catch (err) {
        console.error('Error loading data:', err)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [year, month, COMPANY_ID])

  // Ricarica quando cambia il centro di costo
  useEffect(() => {
    if (!loading) {
      loadBudgetForMonth(year, month, costCenter)
      if (monthView === 'annual') loadAnnualData(year)
    }
  }, [costCenter])

  // Carica dati annuali quando si passa a vista annuale
  useEffect(() => {
    if (monthView === 'annual' && !loading) loadAnnualData(year)
  }, [monthView, year])

  const loadBudgetForMonth = async (y, m, cc = costCenter) => {
    try {
      let query = supabase
        .from('v_budget_variance')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .eq('year', y)
        .eq('month', m)
        .order('account_code')

      // Filtro centro di costo effettivo
      if (cc && cc !== 'all') {
        query = query.eq('cost_center', cc)
      }

      const { data, error } = await query
      if (error) throw error

      if (data && data.length > 0) {
        setBudgetEntries(data)
      } else {
        await initBudgetFromTemplate(y, m, cc)
      }
    } catch (err) {
      console.error('Error loading budget:', err)
    }
  }

  // Vista annuale: carica tutti i 12 mesi
  const loadAnnualData = async (y) => {
    try {
      let query = supabase
        .from('v_budget_variance')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .eq('year', y)
        .order('month')
        .order('account_code')

      if (costCenter && costCenter !== 'all') {
        query = query.eq('cost_center', costCenter)
      }

      const { data } = await query
      setAnnualData(data || [])
    } catch (err) {
      console.error('Error loading annual data:', err)
    }
  }

  const initBudgetFromTemplate = async (y, m, cc = costCenter) => {
    try {
      // Create entries from chart_of_accounts
      const entries = chartOfAccounts.map(coa => ({
        company_id: COMPANY_ID,
        account_code: coa.code,
        account_name: coa.name,
        macro_group: coa.macro_group,
        cost_center: cc === 'all' ? null : cc,
        year: y,
        month: m,
        budget_amount: Math.round((coa.annual_amount || 0) / 12),
        actual_amount: null,
        is_approved: false,
        note: '',
      }))

      // Upsert to database
      const { data, error } = await supabase
        .from('budget_entries')
        .upsert(entries, { onConflict: 'company_id,account_code,cost_center,year,month' })
        .select()

      if (error) throw error
      setBudgetEntries(data || entries)
    } catch (err) {
      console.error('Error initializing budget:', err)
    }
  }

  const handleEntryUpdate = (updated) => {
    setEditedEntries(prev => {
      const newMap = new Map(prev)
      newMap.set(updated.account_code, updated)
      return newMap
    })

    // Update local display immediately
    setBudgetEntries(prev =>
      prev.map(e => e.account_code === updated.account_code ? updated : e)
    )
  }

  const handleDelete = async (accountCode) => {
    if (!window.confirm('Vuoi rimuovere questa voce di budget?')) {
      return
    }

    try {
      const entryToDelete = budgetEntries.find(e => e.account_code === accountCode)
      if (!entryToDelete || !entryToDelete.id) {
        console.error('Entry not found or missing ID')
        return
      }

      const { error } = await supabase
        .from('budget_entries')
        .delete()
        .eq('id', entryToDelete.id)

      if (error) throw error

      console.log('Budget entry deleted successfully:', accountCode)
      // Reload data after deletion
      await loadBudgetForMonth(year, month, costCenter)
    } catch (err) {
      console.error('Error deleting budget entry:', err)
      alert('Errore nella rimozione: ' + err.message)
    }
  }

  const handleSave = async () => {
    if (editedEntries.size === 0) return

    setSaving(true)
    try {
      const entriesToSave = Array.from(editedEntries.values())

      const { error } = await supabase
        .from('budget_entries')
        .upsert(entriesToSave, { onConflict: 'company_id,account_code,cost_center,year,month' })

      if (error) throw error
      setEditedEntries(new Map())
      // Reload to refresh variance calculations
      await loadBudgetForMonth(year, month)
    } catch (err) {
      console.error('Error saving budget:', err)
      alert('Errore nel salvataggio: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleApprovMonth = async () => {
    setShowApproveConfirm(false)
    try {
      const userId = profile?.id || null
      const userName = profile?.full_name || profile?.email || 'Utente'
      const { error } = await supabase
        .from('budget_entries')
        .update({
          is_approved: true,
          approved_at: new Date().toISOString(),
          approved_by: userId || userName,
        })
        .eq('company_id', COMPANY_ID)
        .eq('year', year)
        .eq('month', month)

      if (error) throw error
      await loadBudgetForMonth(year, month)
    } catch (err) {
      console.error('Error approving month:', err)
      alert('Errore nell\'approvazione: ' + err.message)
    }
  }

  // Salva nota su singola entry
  const handleSaveNote = async (entry, note) => {
    try {
      await supabase.from('budget_entries')
        .update({ note })
        .eq('id', entry.id)
      setShowNoteModal(null)
      await loadBudgetForMonth(year, month)
    } catch (err) {
      console.error('Error saving note:', err)
    }
  }

  const handleLoadTemplate = async () => {
    if (budgetEntries.length === 0) {
      await initBudgetFromTemplate(year, month)
    }
  }

  // KPI Calculations
  const kpis = useMemo(() => {
    const revenueEntry = budgetEntries.find(e => e.macro_group === 'Ricavi')
    const costEntries = budgetEntries.filter(e => e.macro_group !== 'Ricavi')

    const totalBudgetRevenue = revenueEntry?.budget_amount || 0
    const totalActualRevenue = revenueEntry?.actual_amount || 0
    const totalBudgetCosts = costEntries.reduce((s, e) => s + (e.budget_amount || 0), 0)
    const totalActualCosts = costEntries.reduce((s, e) => s + (e.actual_amount || 0), 0)

    const resultBudget = totalBudgetRevenue - totalBudgetCosts
    const resultActual = totalActualRevenue > 0
      ? totalActualRevenue - totalActualCosts
      : null

    const overallVariance = totalBudgetCosts > 0
      ? ((totalActualCosts - totalBudgetCosts) / totalBudgetCosts * 100)
      : null

    return {
      totalBudgetRevenue,
      totalActualRevenue,
      totalBudgetCosts,
      totalActualCosts,
      resultBudget,
      resultActual,
      overallVariance,
      variancePct: totalBudgetRevenue > 0 ? (Math.abs(resultActual - resultBudget) / Math.abs(resultBudget) * 100) : 0
    }
  }, [budgetEntries])

  // Chart data
  const chartData = useMemo(() => {
    const grouped = {}
    budgetEntries.forEach(e => {
      if (e.macro_group !== 'Ricavi') {
        if (!grouped[e.macro_group]) {
          grouped[e.macro_group] = { budget: 0, actual: 0 }
        }
        grouped[e.macro_group].budget += e.budget_amount || 0
        grouped[e.macro_group].actual += e.actual_amount || 0
      }
    })

    return Object.entries(grouped).map(([name, data]) => ({
      name,
      Budget: data.budget,
      Consuntivo: data.actual || 0
    }))
  }, [budgetEntries])

  const prevMonth = () => {
    if (month === 1) {
      setYear(y => y - 1)
      setMonth(12)
    } else {
      setMonth(m => m - 1)
    }
  }

  const nextMonth = () => {
    if (month === 12) {
      setYear(y => y + 1)
      setMonth(1)
    } else {
      setMonth(m => m + 1)
    }
  }

  const isApproved = budgetEntries.length > 0 && budgetEntries.every(e => e.is_approved)

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mb-4"></div>
          <p className="text-slate-600">Caricamento budget...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Budget & Controllo di Gestione</h1>
          <p className="text-sm text-slate-500">
            Preventivo e consuntivo mensile — Sincronizzato con Supabase
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleLoadTemplate}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition"
          >
            <Download size={16} />
            Carica template
          </button>
          {editedEntries.size > 0 && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? 'Salvataggio...' : `Salva (${editedEntries.size})`}
            </button>
          )}
          {!isApproved && (
            <button
              onClick={() => setShowApproveConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
            >
              <CheckCircle2 size={16} />
              Approva mese
            </button>
          )}
          {isApproved && (
            <div className="flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
              <CheckCircle2 size={16} className="text-emerald-600" />
              <span className="text-sm text-emerald-700 font-medium">Approvato</span>
            </div>
          )}
        </div>
      </div>

      {/* Month/Year Navigation */}
      <div className="flex items-center justify-between rounded-2xl p-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-slate-100 transition">
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <select
              value={year}
              onChange={e => setYear(parseInt(e.target.value))}
              className="text-lg font-bold text-slate-900 px-3 py-1 border border-slate-200 rounded"
            >
              {[2023, 2024, 2025, 2026, 2027].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="text-center">
            <select
              value={month}
              onChange={e => setMonth(parseInt(e.target.value))}
              className="text-lg font-bold text-slate-900 px-3 py-1 border border-slate-200 rounded"
            >
              {MESI.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="text-center">
            <div className="text-xs text-slate-400">Vista</div>
            <select
              value={monthView}
              onChange={e => setMonthView(e.target.value)}
              className="text-xs px-2 py-1 border border-slate-200 rounded"
            >
              <option value="single">Mese singolo</option>
              <option value="annual">Annuale</option>
            </select>
          </div>
        </div>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-slate-100 transition">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl p-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="text-xs text-slate-400">Ricavi budget</div>
          <div className="text-xl font-bold text-slate-900">{fmt(kpis.totalBudgetRevenue, 0)} €</div>
          {kpis.totalActualRevenue > 0 && (
            <div className="text-xs text-slate-500 mt-1">vs {fmt(kpis.totalActualRevenue, 0)} €</div>
          )}
        </div>
        <div className="rounded-2xl p-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="text-xs text-slate-400">Costi budget</div>
          <div className="text-xl font-bold text-red-600">{fmt(kpis.totalBudgetCosts, 0)} €</div>
          {kpis.totalActualCosts > 0 && (
            <div className="text-xs text-slate-500 mt-1">vs {fmt(kpis.totalActualCosts, 0)} €</div>
          )}
        </div>
        <div className="rounded-2xl p-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="text-xs text-slate-400">Risultato budget</div>
          <div className={`text-xl font-bold ${kpis.resultBudget >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {fmt(kpis.resultBudget, 0)} €
          </div>
        </div>
        <div className="rounded-2xl p-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="text-xs text-slate-400">Scostamento complessivo</div>
          <div className={`text-xl font-bold ${kpis.overallVariance && kpis.overallVariance <= 2 ? 'text-emerald-600' : 'text-red-600'}`}>
            {kpis.overallVariance != null ? `${kpis.overallVariance.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      {/* View Selector */}
      <div className="flex gap-2 border border-slate-200 rounded-lg p-1 w-fit">
        <button
          onClick={() => setView('grid')}
          className={`px-4 py-2 text-sm font-medium rounded transition ${
            view === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Griglia
        </button>
        <button
          onClick={() => setView('chart')}
          className={`px-4 py-2 text-sm font-medium rounded transition ${
            view === 'chart' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Grafici
        </button>
        <button
          onClick={() => setView('variance')}
          className={`px-4 py-2 text-sm font-medium rounded transition ${
            view === 'variance' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Scostamenti
        </button>
      </div>

      {/* Cost Center Filter */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-600 font-medium">Centro di costo:</span>
        <select
          value={costCenter}
          onChange={e => setCostCenter(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Tutti</option>
          {costCenters.map(cc => (
            <option key={cc.code} value={cc.code}>
              {cc.label}
            </option>
          ))}
        </select>
      </div>

      {/* Info Message */}
      <div className="flex items-start gap-3 bg-blue-50/50 border border-blue-100 rounded-xl p-4">
        <Info size={16} className="text-blue-600 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-800">
          <strong>Budget sincronizzato con Supabase:</strong> I dati sono salvati automaticamente.
          Il budget è inizializzato con {fmtK(chartOfAccounts.length)} voci dal piano dei conti.
          Modifica i valori di budget e consuntivo, quindi clicca "Salva" per sincronizzare.
        </div>
      </div>

      {/* Main Content */}
      {view === 'grid' && (
        <div className="space-y-4">
          {budgetEntries.length > 0 ? (
            <BudgetGrid
              entries={budgetEntries}
              costCenter={costCenter}
              onUpdate={handleEntryUpdate}
              onDelete={handleDelete}
              isEditable={!isApproved}
            />
          ) : (
            <div className="text-center py-12 bg-slate-50 rounded-lg">
              <Calendar size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500">Nessun budget caricato per {MESI[month - 1]} {year}</p>
              <button
                onClick={handleLoadTemplate}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
              >
                Carica template
              </button>
            </div>
          )}
        </div>
      )}

      {view === 'chart' && chartData.length > 0 && (
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Budget vs Consuntivo per categoria</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="grad-budget" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={1} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.5} />
                </linearGradient>
                <linearGradient id="grad-actual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={1} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.5} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="name" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} tickFormatter={fmtK} />
              <Tooltip content={<GlassTooltip formatter={fmtEuro} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
              <Legend content={<ModernLegend />} />
              <Bar dataKey="Budget" fill="url(#grad-budget)" radius={[8, 8, 0, 0]} animationDuration={800} />
              <Bar dataKey="Consuntivo" fill="url(#grad-actual)" radius={[8, 8, 0, 0]} animationDuration={800} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {view === 'variance' && budgetEntries.length > 0 && (
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Analisi scostamenti</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-xs text-slate-500 uppercase tracking-wider">
                  <th className="py-2 px-3 text-left font-medium">Voce</th>
                  <th className="py-2 px-3 text-right font-medium">Budget (€)</th>
                  <th className="py-2 px-3 text-right font-medium">Consuntivo (€)</th>
                  <th className="py-2 px-3 text-right font-medium">Scost. (€)</th>
                  <th className="py-2 px-3 text-right font-medium">Scost. (%)</th>
                  <th className="py-2 px-3 text-center font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {budgetEntries.map(e => {
                  const variance = e.actual_amount != null ? e.actual_amount - e.budget_amount : null
                  const varPct = deltaPercent(e.budget_amount, e.actual_amount)
                  const isCost = e.macro_group !== 'Ricavi'
                  return (
                    <tr key={e.account_code} className="border-t border-slate-50 hover:bg-slate-50/30">
                      <td className="py-2 px-3">
                        <div className="font-medium text-slate-700">{e.account_name}</div>
                        <div className="text-xs text-slate-400">{e.account_code}</div>
                      </td>
                      <td className="py-2 px-3 text-right">{fmt(e.budget_amount, 0)} €</td>
                      <td className="py-2 px-3 text-right">{e.actual_amount != null ? `${fmt(e.actual_amount, 0)} €` : '—'}</td>
                      <td className={`py-2 px-3 text-right font-medium ${variance ? (isCost ? (variance >= 0 ? 'text-red-600' : 'text-emerald-600') : (variance >= 0 ? 'text-emerald-600' : 'text-red-600')) : 'text-slate-400'}`}>
                        {variance != null ? `${variance >= 0 ? '+' : ''}${fmt(variance, 0)} €` : '—'}
                      </td>
                      <td className={`py-2 px-3 text-right text-xs font-medium ${deltaClass(varPct, isCost)}`}>
                        {varPct != null ? `${varPct >= 0 ? '+' : ''}${varPct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => setShowNoteModal(e)}
                          className={`p-1 rounded transition ${e.note ? 'text-blue-600 hover:bg-blue-50' : 'text-slate-300 hover:text-slate-500'}`}
                          title={e.note || 'Aggiungi nota'}
                        >
                          <MessageSquare size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vista Annuale */}
      {monthView === 'annual' && annualData.length > 0 && (
        <div className="rounded-2xl p-5 shadow-lg overflow-hidden" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Vista annuale {year}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-xs text-slate-500 uppercase tracking-wider">
                  <th className="py-2 px-2 text-left font-medium sticky left-0 bg-slate-50 z-10 min-w-[140px]">Voce</th>
                  {MESI_SHORT.map((m, i) => (
                    <th key={i} className="py-2 px-2 text-right font-medium min-w-[70px]">{m}</th>
                  ))}
                  <th className="py-2 px-2 text-right font-medium min-w-[80px] bg-slate-100">Totale</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Raggruppa per account_code
                  const accounts = {}
                  annualData.forEach(e => {
                    if (!accounts[e.account_code]) {
                      accounts[e.account_code] = { name: e.account_name, macro: e.macro_group, months: {} }
                    }
                    accounts[e.account_code].months[e.month] = e.budget_amount || 0
                  })
                  return Object.entries(accounts).map(([code, acc]) => {
                    const total = Object.values(acc.months).reduce((s, v) => s + v, 0)
                    return (
                      <tr key={code} className="border-t border-slate-50 hover:bg-slate-50/30">
                        <td className="py-1.5 px-2 sticky left-0 bg-white z-10">
                          <div className="font-medium text-slate-700 truncate">{acc.name}</div>
                        </td>
                        {Array.from({ length: 12 }, (_, i) => (
                          <td key={i} className="py-1.5 px-2 text-right text-slate-600">
                            {acc.months[i + 1] ? fmt(acc.months[i + 1]) : '—'}
                          </td>
                        ))}
                        <td className="py-1.5 px-2 text-right font-semibold text-slate-900 bg-slate-50">
                          {fmt(total)} €
                        </td>
                      </tr>
                    )
                  })
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Conferma Approvazione Modal */}
      {showApproveConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowApproveConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Conferma approvazione</h3>
            <p className="text-sm text-slate-700 mb-4">
              Sei sicuro di voler approvare il budget di <strong>{MESI[month - 1]} {year}</strong>?
              {costCenter !== 'all' && <> (Centro: <strong>{costCenter}</strong>)</>}
            </p>
            <p className="text-xs text-amber-600 mb-4">
              Dopo l'approvazione, i valori di budget e consuntivo non saranno più modificabili.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowApproveConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition">
                Annulla
              </button>
              <button onClick={handleApprovMonth}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                Approva
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note Modal */}
      {showNoteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowNoteModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Nota</h3>
            <p className="text-sm text-slate-500 mb-3">{showNoteModal.account_name}</p>
            <textarea
              defaultValue={showNoteModal.note || ''}
              id="note-textarea"
              rows={4}
              className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Scrivi una nota per questa voce..."
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowNoteModal(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition">
                Annulla
              </button>
              <button onClick={() => handleSaveNote(showNoteModal, document.getElementById('note-textarea').value)}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                Salva nota
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
