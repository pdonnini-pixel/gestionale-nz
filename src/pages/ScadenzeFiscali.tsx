import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Calendar, Receipt, AlertTriangle, CheckCircle2, Clock, Plus, Edit2,
  Trash2, Save, X, Search, Filter, ChevronDown, ChevronUp,
  FileText, DollarSign, CalendarClock, RefreshCw, Bell, BellOff,
  ArrowRight, Eye, Landmark
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

/* ───── helpers ───── */
function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const daysUntil = (d: string | null | undefined) => {
  if (!d) return null
  return Math.round((new Date(d) - new Date()) / (1000 * 60 * 60 * 24))
}

/* ───── configs ───── */
const TYPE_CONFIG = {
  f24: { label: 'F24', color: 'bg-blue-100 text-blue-700', icon: FileText },
  iva_periodica: { label: 'IVA periodica', color: 'bg-indigo-100 text-indigo-700', icon: Receipt },
  iva_annuale: { label: 'IVA annuale', color: 'bg-indigo-100 text-indigo-700', icon: Receipt },
  inps: { label: 'INPS', color: 'bg-emerald-100 text-emerald-700', icon: DollarSign },
  irpef: { label: 'IRPEF', color: 'bg-amber-100 text-amber-700', icon: DollarSign },
  irap: { label: 'IRAP', color: 'bg-purple-100 text-purple-700', icon: DollarSign },
  ires: { label: 'IRES', color: 'bg-purple-100 text-purple-700', icon: DollarSign },
  ritenute_acconto: { label: 'Ritenute', color: 'bg-orange-100 text-orange-700', icon: DollarSign },
  contributi_inail: { label: 'INAIL', color: 'bg-teal-100 text-teal-700', icon: DollarSign },
  diritto_camerale: { label: 'CCIAA', color: 'bg-cyan-100 text-cyan-700', icon: Landmark },
  imu: { label: 'IMU', color: 'bg-rose-100 text-rose-700', icon: Landmark },
  tari: { label: 'TARI', color: 'bg-lime-100 text-lime-700', icon: Landmark },
  bollo_auto: { label: 'Bollo', color: 'bg-slate-100 text-slate-600', icon: FileText },
  dichiarazione_redditi: { label: 'Dich. Redditi', color: 'bg-red-100 text-red-700', icon: FileText },
  bilancio_deposito: { label: 'Bilancio', color: 'bg-sky-100 text-sky-700', icon: FileText },
  lipe: { label: 'LIPE', color: 'bg-violet-100 text-violet-700', icon: FileText },
  esterometro: { label: 'Esterometro', color: 'bg-pink-100 text-pink-700', icon: FileText },
  intrastat: { label: 'Intrastat', color: 'bg-fuchsia-100 text-fuchsia-700', icon: FileText },
  cu_certificazione: { label: 'CU', color: 'bg-amber-100 text-amber-700', icon: FileText },
  altro: { label: 'Altro', color: 'bg-slate-100 text-slate-600', icon: Calendar },
}

const STATUS_CONFIG = {
  pending: { label: 'Da pagare', color: 'bg-blue-100 text-blue-700' },
  upcoming: { label: 'In scadenza', color: 'bg-amber-100 text-amber-700' },
  overdue: { label: 'Scaduto', color: 'bg-red-100 text-red-700' },
  paid: { label: 'Pagato', color: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Annullato', color: 'bg-slate-100 text-slate-500' },
  deferred: { label: 'Rinviato', color: 'bg-purple-100 text-purple-700' },
}

/* ───── Form modal ───── */
// TODO: tighten type
function ModalDeadline({ isOpen, isEdit, deadline, onClose, onSave, saving }: { isOpen: boolean; isEdit: boolean; deadline: any; onClose: () => void; onSave: (form: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    deadline_type: 'f24', title: '', description: '', amount: '',
    due_date: '', f24_code: '', tax_period: '', payment_method: 'f24',
    is_recurring: false, recurrence_rule: '', notes: '', status: 'pending',
  })

  useEffect(() => {
    if (isEdit && deadline) {
      setForm({
        deadline_type: deadline.deadline_type || 'f24',
        title: deadline.title || '',
        description: deadline.description || '',
        amount: deadline.amount || '',
        due_date: deadline.due_date || '',
        f24_code: deadline.f24_code || '',
        tax_period: deadline.tax_period || '',
        payment_method: deadline.payment_method || 'f24',
        is_recurring: deadline.is_recurring || false,
        recurrence_rule: deadline.recurrence_rule || '',
        notes: deadline.notes || '',
        status: deadline.status || 'pending',
      })
    } else {
      setForm({
        deadline_type: 'f24', title: '', description: '', amount: '',
        due_date: '', f24_code: '', tax_period: '', payment_method: 'f24',
        is_recurring: false, recurrence_rule: '', notes: '', status: 'pending',
      })
    }
  }, [isOpen, isEdit, deadline])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          {isEdit ? 'Modifica Scadenza' : 'Nuova Scadenza Fiscale'}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Titolo *</label>
            <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="es. IVA mensile — Maggio 2026" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tipo *</label>
            <select value={form.deadline_type} onChange={e => setForm({ ...form, deadline_type: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Scadenza *</label>
            <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Importo €</label>
            <input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0.00" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Codice F24</label>
            <input type="text" value={form.f24_code} onChange={e => setForm({ ...form, f24_code: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="es. 6001" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Periodo</label>
            <input type="text" value={form.tax_period} onChange={e => setForm({ ...form, tax_period: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="es. 04/2026 o Q1/2026" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Metodo pagamento</label>
            <select value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="f24">F24 telematico</option>
              <option value="bonifico">Bonifico</option>
              <option value="rid">RID/SDD</option>
              <option value="altro">Altro</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Stato</label>
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          <div className="col-span-2 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.is_recurring}
                onChange={e => setForm({ ...form, is_recurring: e.target.checked })}
                className="rounded border-slate-300" />
              Ricorrente
            </label>
            {form.is_recurring && (
              <select value={form.recurrence_rule} onChange={e => setForm({ ...form, recurrence_rule: e.target.value })}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Frequenza...</option>
                <option value="monthly">Mensile</option>
                <option value="quarterly">Trimestrale</option>
                <option value="semiannual">Semestrale</option>
                <option value="annual">Annuale</option>
              </select>
            )}
          </div>

          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Note</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" rows="2" />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
            Annulla
          </button>
          <button onClick={() => onSave(form)} disabled={saving || !form.title || !form.due_date}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition">
            {saving ? 'Salvataggio...' : isEdit ? 'Salva modifiche' : 'Crea scadenza'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════
   PAGINA PRINCIPALE SCADENZE FISCALI
   ═══════════════════════════════════════ */
export default function ScadenzeFiscali() {
  const { profile } = useAuth()
  const COMPANY_ID = profile?.company_id

  // TODO: tighten type — Supabase rows
  const [deadlines, setDeadlines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('active')
  const [filterType, setFilterType] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  // TODO: tighten type
  const [editingDeadline, setEditingDeadline] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    if (!COMPANY_ID) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('fiscal_deadlines')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('due_date', { ascending: true })
      if (!error) setDeadlines(data || [])
    } catch (e) {
      console.error('Load fiscal deadlines error:', e)
    } finally {
      setLoading(false)
    }
  }, [COMPANY_ID])

  useEffect(() => { loadData() }, [loadData])

  // Filtered deadlines
  const filtered = useMemo(() => {
    let list = deadlines
    if (filterStatus === 'active') list = list.filter(d => !['paid', 'cancelled'].includes(d.status))
    else if (filterStatus === 'paid') list = list.filter(d => d.status === 'paid')
    if (filterType !== 'all') list = list.filter(d => d.deadline_type === filterType)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        (d.title || '').toLowerCase().includes(q) ||
        (d.f24_code || '').toLowerCase().includes(q) ||
        (d.tax_period || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [deadlines, filterStatus, filterType, search])

  // KPIs
  const kpi = useMemo(() => {
    const active = deadlines.filter(d => !['paid', 'cancelled'].includes(d.status))
    const overdue = active.filter(d => daysUntil(d.due_date) < 0)
    const thisWeek = active.filter(d => {
      const days = daysUntil(d.due_date)
      return days >= 0 && days <= 7
    })
    const thisMonth = active.filter(d => {
      const days = daysUntil(d.due_date)
      return days >= 0 && days <= 30
    })
    const totalDue = active.reduce((s, d) => s + Number(d.amount || 0), 0)
    const paid = deadlines.filter(d => d.status === 'paid')
    const totalPaid = paid.reduce((s, d) => s + Number(d.amount_paid || d.amount || 0), 0)
    return { active: active.length, overdue: overdue.length, thisWeek: thisWeek.length, thisMonth: thisMonth.length, totalDue, totalPaid }
  }, [deadlines])

  // Save handler
  // TODO: tighten type
  const handleSave = async (form: any) => {
    setSaving(true)
    try {
      const record = {
        company_id: COMPANY_ID,
        deadline_type: form.deadline_type,
        title: form.title,
        description: form.description || null,
        amount: form.amount ? parseFloat(form.amount) : null,
        due_date: form.due_date,
        f24_code: form.f24_code || null,
        tax_period: form.tax_period || null,
        payment_method: form.payment_method || null,
        is_recurring: form.is_recurring,
        recurrence_rule: form.is_recurring ? form.recurrence_rule || null : null,
        notes: form.notes || null,
        status: form.status,
        reminder_date: form.due_date ? new Date(new Date(form.due_date).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
      }

      if (editingDeadline?.id) {
        const { error } = await supabase.from('fiscal_deadlines').update(record).eq('id', editingDeadline.id)
        if (error) throw error
      } else {
        record.created_by = profile?.id
        const { error } = await supabase.from('fiscal_deadlines').insert(record)
        if (error) throw error
      }
      setModalOpen(false)
      setEditingDeadline(null)
      await loadData()
    } catch (e) {
      console.error('Save error:', e)
      alert('Errore nel salvataggio: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // Quick mark as paid
  // TODO: tighten type
  const markPaid = async (dl: any) => {
    try {
      await supabase.from('fiscal_deadlines').update({
        status: 'paid',
        paid_date: new Date().toISOString().split('T')[0],
        amount_paid: dl.amount || 0,
      }).eq('id', dl.id)
      await loadData()
    } catch (e) {
      console.error('Mark paid error:', e)
    }
  }

  // Delete
  const handleDelete = async (id: string) => {
    if (!confirm('Eliminare questa scadenza?')) return
    try {
      await supabase.from('fiscal_deadlines').delete().eq('id', id)
      await loadData()
    } catch (e) {
      console.error('Delete error:', e)
    }
  }

  // Unique types for filter
  const uniqueTypes = [...new Set(deadlines.map(d => d.deadline_type))].sort()

  const statusTabs = [
    { key: 'active', label: 'Da pagare', count: kpi.active },
    { key: 'paid', label: 'Pagati', count: deadlines.filter(d => d.status === 'paid').length },
    { key: 'all', label: 'Tutti', count: deadlines.length },
  ]

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Sticky header */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200/60 px-6 py-3">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <CalendarClock size={20} className="text-blue-600" />
              Scadenze Fiscali & F24
            </h1>
            <button onClick={() => { setEditingDeadline(null); setModalOpen(true) }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition shadow-sm">
              <Plus size={15} /> Nuova scadenza
            </button>
          </div>

          {/* KPI bar */}
          <div className="flex items-center gap-6 mt-3 text-sm flex-wrap">
            {kpi.overdue > 0 && (
              <>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-red-500" />
                  <span className="text-red-600 font-semibold">{kpi.overdue} scadute</span>
                </div>
                <div className="text-slate-200">|</div>
              </>
            )}
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="text-amber-500" />
              <span className="text-slate-500 text-xs">Questa settimana</span>
              <span className="font-semibold text-amber-600">{kpi.thisWeek}</span>
            </div>
            <div className="text-slate-200">|</div>
            <div className="flex items-center gap-1.5">
              <Calendar size={13} className="text-blue-500" />
              <span className="text-slate-500 text-xs">Entro 30gg</span>
              <span className="font-semibold text-blue-600">{kpi.thisMonth}</span>
            </div>
            <div className="text-slate-200">|</div>
            <div className="flex items-center gap-1.5">
              <DollarSign size={13} className="text-red-500" />
              <span className="text-slate-500 text-xs">Totale dovuto</span>
              <span className="font-bold text-slate-800">{fmt(kpi.totalDue)} €</span>
            </div>
            <div className="text-slate-200">|</div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-500" />
              <span className="text-slate-500 text-xs">Pagati</span>
              <span className="font-semibold text-emerald-600">{fmt(kpi.totalPaid)} €</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
        {/* Filter bar */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-1 bg-slate-100/80 rounded-lg p-0.5">
            {statusTabs.map(t => (
              <button key={t.key} onClick={() => setFilterStatus(t.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  filterStatus === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {t.label}
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                  filterStatus === t.key ? 'bg-slate-100 text-slate-600' : 'bg-transparent text-slate-400'
                }`}>{t.count}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400/40 bg-white">
              <option value="all">Tutti i tipi</option>
              {uniqueTypes.map(t => (
                <option key={t} value={t}>{TYPE_CONFIG[t]?.label || t}</option>
              ))}
            </select>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
              <input type="text" placeholder="Cerca..." value={search} onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400/40 bg-white w-48" />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              <RefreshCw size={18} className="animate-spin mx-auto mb-2" />
              Caricamento scadenze...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              Nessuna scadenza trovata. Crea una nuova scadenza per iniziare.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] text-slate-400 uppercase tracking-wider">
                    <th className="py-2.5 px-4 text-left font-medium">Scadenza</th>
                    <th className="py-2.5 px-4 text-left font-medium">Tipo</th>
                    <th className="py-2.5 px-4 text-left font-medium">Titolo</th>
                    <th className="py-2.5 px-4 text-left font-medium">Periodo</th>
                    <th className="py-2.5 px-4 text-right font-medium">Importo</th>
                    <th className="py-2.5 px-4 text-center font-medium">Stato</th>
                    <th className="py-2.5 px-4 text-center font-medium">Giorni</th>
                    <th className="py-2.5 px-4 text-center font-medium w-36">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(dl => {
                    const days = daysUntil(dl.due_date)
                    const isOverdue = days !== null && days < 0 && dl.status !== 'paid'
                    const isUrgent = days !== null && days >= 0 && days <= 7 && dl.status !== 'paid'
                    const typeConfig = TYPE_CONFIG[dl.deadline_type] || TYPE_CONFIG.altro
                    const statusCfg = STATUS_CONFIG[dl.status] || STATUS_CONFIG.pending
                    const TypeIcon = typeConfig.icon

                    return (
                      <tr key={dl.id} className={`border-b border-slate-50 hover:bg-blue-50/30 transition ${
                        isOverdue ? 'bg-red-50/30' : isUrgent ? 'bg-amber-50/20' : ''
                      }`}>
                        <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap text-xs font-medium">
                          {fmtDate(dl.due_date)}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${typeConfig.color}`}>
                            <TypeIcon size={10} />
                            {typeConfig.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-800 max-w-[250px]">
                          <span className="block truncate text-[13px] font-medium" title={dl.title}>{dl.title}</span>
                          {dl.f24_code && <span className="text-[10px] text-slate-400">Cod. {dl.f24_code}</span>}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-500">
                          {dl.tax_period || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-medium text-slate-800 whitespace-nowrap">
                          {dl.amount ? `${fmt(dl.amount)} €` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${statusCfg.color}`}>
                            {statusCfg.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          {dl.status === 'paid' ? (
                            <span className="text-emerald-500 text-xs">✓</span>
                          ) : days !== null ? (
                            <span className={`text-xs font-medium ${
                              days < 0 ? 'text-red-600' : days <= 7 ? 'text-amber-600' : 'text-slate-500'
                            }`}>
                              {days < 0 ? `${Math.abs(days)}gg fa` : days === 0 ? 'OGGI' : `${days}gg`}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <div className="flex items-center gap-1 justify-center">
                            {dl.status !== 'paid' && (
                              <button onClick={() => markPaid(dl)}
                                className="inline-flex items-center gap-0.5 px-2 py-1 text-[10px] font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition"
                                title="Segna come pagato">
                                <CheckCircle2 size={10} /> Pagato
                              </button>
                            )}
                            <button onClick={() => { setEditingDeadline(dl); setModalOpen(true) }}
                              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                              title="Modifica">
                              <Edit2 size={12} />
                            </button>
                            <button onClick={() => handleDelete(dl.id)}
                              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                              title="Elimina">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <ModalDeadline
        isOpen={modalOpen}
        isEdit={!!editingDeadline}
        deadline={editingDeadline}
        onClose={() => { setModalOpen(false); setEditingDeadline(null) }}
        onSave={handleSave}
        saving={saving}
      />
    </div>
  )
}
