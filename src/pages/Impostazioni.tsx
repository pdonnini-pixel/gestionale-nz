import { useState, useEffect, useCallback } from 'react'
import {
  Settings, Users, Tag, Building2, Shield, Plus, Trash2, Pencil, Save, X,
  ChevronDown, ChevronUp, Check, AlertCircle, Search, Copy, Eye, EyeOff, Loader,
  CornerDownRight, Lock, ShieldCheck, FileText, RefreshCw, Zap, Send,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

// Role-based permissions
const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_advisor: ['company', 'users', 'costs', 'centri', 'sdi'],
  ceo: ['company', 'users', 'costs', 'centri', 'sdi'],
  cfo: ['company', 'costs', 'centri', 'sdi'],
  coo: ['company', 'costs', 'centri'],
  contabile: ['costs', 'centri'],
  store_manager: [],
  operatrice: [],
}

// Toast helper (shared via props)
function ToastBar({ toast }: { toast: { type: string; msg: string } | null }) {
  if (!toast) return null
  return (
    <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 transition-all ${
      toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
    }`}>
      {toast.type === 'error' ? <AlertCircle size={16} /> : <ShieldCheck size={16} />}
      {toast.msg}
    </div>
  )
}

// ========================
// UI CONSTANTS
// ========================
const ROLE_OPTIONS = [
  { value: 'super_advisor', label: 'Super Advisor', color: 'bg-purple-100 text-purple-700' },
  { value: 'ceo', label: 'CEO', color: 'bg-blue-100 text-blue-700' },
  { value: 'cfo', label: 'CFO', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'coo', label: 'COO', color: 'bg-amber-100 text-amber-700' },
  { value: 'contabile', label: 'Contabile', color: 'bg-slate-100 text-slate-700' },
  { value: 'store_manager', label: 'Store Manager', color: 'bg-rose-100 text-rose-700' },
  { value: 'operatrice', label: 'Operatrice', color: 'bg-sky-100 text-sky-700' },
]

const MACRO_GROUPS = [
  'Costo del venduto',
  'Locazione',
  'Personale',
  'Generali & Amministrative',
  'Finanziarie',
  'Utenze & Servizi',
  'Marketing',
  'Manutenzione',
  'Oneri diversi',
]

// ========================
// HELPER FUNCTIONS
// ========================
function fmt(n: number | null | undefined | string) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(Number(n))
}

interface CostCenterLite { id?: string; code: string; label: string }

function getCentroLabel(id: string, costCenters: CostCenterLite[]) {
  const c = costCenters?.find(x => x.code === id)
  return c ? c.label : id
}

function getCentroColor(id: string) {
  const colors: Record<string, string> = {
    'all': 'bg-slate-600',
    'sede_magazzino': 'bg-amber-600',
    'valdichiana': 'bg-blue-600',
    'barberino': 'bg-emerald-600',
    'palmanova': 'bg-sky-600',
    'franciacorta': 'bg-rose-600',
    'brugnato': 'bg-orange-600',
    'valmontone': 'bg-purple-600',
    'torino': 'bg-indigo-600',
  }
  return colors[id] || 'bg-slate-500'
}

// ==========================================
// SEZIONE AZIENDA
// ==========================================
interface SectionProps {
  showToast: (msg: string, type?: string) => void
  companyId: string | undefined
}

interface SocioForm { nome: string; ruolo: string; quota: string }
interface CompanyForm {
  partita_iva?: string
  codice_fiscale?: string
  pec?: string
  soci?: SocioForm[]
  [key: string]: unknown
}

function CompanySection({ showToast, companyId: COMPANY_ID }: SectionProps) {
  const [company, setCompany] = useState<CompanyForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [formData, setFormData] = useState<CompanyForm>({})
  const [editingSoci, setEditingSoci] = useState(false)
  const [sociForm, setSociForm] = useState<SocioForm[]>([])
  const [savingSoci, setSavingSoci] = useState(false)

  useEffect(() => {
    loadCompany()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadCompany = async () => {
    if (!COMPANY_ID) { setLoading(false); return }
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('company_settings')
        .select('*')
        .eq('id', COMPANY_ID)
        .single()

      if (error) throw error
      setCompany(data as unknown as CompanyForm)
      setFormData((data as unknown as CompanyForm) || {})
    } catch {
      showToast?.('Errore caricamento dati azienda', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    // Validazioni
    const piva = typeof formData.partita_iva === 'string' ? formData.partita_iva : ''
    const cf = typeof formData.codice_fiscale === 'string' ? formData.codice_fiscale : ''
    const pec = typeof formData.pec === 'string' ? formData.pec : ''
    if (piva && !/^\d{11}$/.test(piva.replace(/\s/g, ''))) {
      showToast?.('P.IVA deve avere 11 cifre', 'error'); return
    }
    if (cf && cf.length > 0 && cf.length < 11) {
      showToast?.('Codice fiscale non valido', 'error'); return
    }
    if (pec && pec.length > 0 && !pec.includes('@')) {
      showToast?.('PEC non valida', 'error'); return
    }
    try {
      if (!COMPANY_ID) { showToast?.('ID azienda mancante', 'error'); return }
      const { error } = await supabase
        .from('company_settings')
        .update(formData as never)
        .eq('id', COMPANY_ID)

      if (error) throw error
      setCompany(formData)
      setEditing(null)
      showToast?.('Dati azienda aggiornati')
    } catch {
      showToast?.('Errore salvataggio dati azienda', 'error')
    }
  }

  // Soci CRUD
  const startEditSoci = () => {
    setSociForm(JSON.parse(JSON.stringify(company?.soci || [])))
    setEditingSoci(true)
  }
  const addSocio = () => {
    setSociForm(prev => [...prev, { nome: '', ruolo: '', quota: '' }])
  }
  const removeSocio = (idx: number) => {
    setSociForm(prev => prev.filter((_, i) => i !== idx))
  }
  const updateSocio = <K extends keyof SocioForm>(idx: number, field: K, value: SocioForm[K]) => {
    setSociForm(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }
  const saveSoci = async () => {
    // Validazione quote
    const totalQuota = sociForm.reduce((s, soc) => s + (parseFloat(soc.quota) || 0), 0)
    if (totalQuota > 100) {
      showToast?.(`Le quote superano il 100% (${totalQuota}%)`, 'error'); return
    }
    if (sociForm.some(s => !s.nome || !s.nome.trim())) {
      showToast?.('Tutti i soci devono avere un nome', 'error'); return
    }
    try {
      setSavingSoci(true)
      if (!COMPANY_ID) { showToast?.('ID azienda mancante', 'error'); return }
      // soci è jsonb in DB → cast strutturale richiesto
      const { error } = await supabase
        .from('company_settings')
        .update({ soci: sociForm } as never)
        .eq('id', COMPANY_ID)
      if (error) throw error
      setCompany(prev => ({ ...(prev || {}), soci: sociForm }))
      setEditingSoci(false)
      showToast?.('Compagine societaria aggiornata')
    } catch {
      showToast?.('Errore salvataggio soci', 'error')
    } finally {
      setSavingSoci(false)
    }
  }

  if (loading) return <div className="px-5 py-4 text-center text-slate-500">Caricamento...</div>

  const d = company || formData

  return (
    <div className="px-5 py-4 space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-2">
        {([
          ['ragione_sociale', 'Ragione sociale'],
          ['forma_giuridica', 'Forma giuridica'],
          ['sede_legale', 'Sede legale'],
          ['partita_iva', 'P.IVA'],
          ['codice_fiscale', 'Codice Fiscale'],
          ['rea', 'REA'],
          ['capitale_sociale', 'Capitale sociale'],
          ['data_costituzione', 'Anno costituzione'],
          ['pec', 'PEC'],
          ['codice_sdi', 'Codice SDI'],
          ['ateco', 'ATECO'],
          ['amministratore', 'Amministratore'],
        ] as const).map(([field, label]) => (
          <div key={field} className="flex justify-between py-2 border-b border-slate-50">
            <span className="text-sm text-slate-500">{label}</span>
            {editing === field ? (
              <input
                type="text"
                value={String(formData[field] ?? '')}
                onChange={(e) => setFormData(p => ({ ...p, [field]: e.target.value }))}
                className="text-sm font-medium text-slate-900 border border-blue-200 rounded px-2 py-1"
              />
            ) : (
              <span className="text-sm font-medium text-slate-900 text-right">{(d[field] as string | undefined) || '—'}</span>
            )}
          </div>
        ))}
      </div>

      {/* Soci CRUD */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-slate-700">Compagine societaria</h4>
          {!editingSoci && (
            <button onClick={startEditSoci} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
              <Pencil size={12} /> Modifica soci
            </button>
          )}
        </div>
        {editingSoci ? (
          <div className="space-y-3 bg-blue-50/50 border border-blue-200 rounded-xl p-4">
            {sociForm.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={s.nome} onChange={(e) => updateSocio(i, 'nome', e.target.value)} placeholder="Nome"
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                <input value={s.ruolo} onChange={(e) => updateSocio(i, 'ruolo', e.target.value)} placeholder="Ruolo"
                  className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                <input value={s.quota} onChange={(e) => updateSocio(i, 'quota', e.target.value)} placeholder="Quota %"
                  className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                <button onClick={() => removeSocio(i)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button onClick={addSocio} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
              <Plus size={14} /> Aggiungi socio
            </button>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditingSoci(false)} className="px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Annulla</button>
              <button onClick={saveSoci} disabled={savingSoci}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40">
                {savingSoci ? <Loader size={13} className="animate-spin" /> : <Save size={13} />} Salva
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {d.soci && Array.isArray(d.soci) && d.soci.map((s, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">{s.nome}</div>
                  <div className="text-xs text-slate-400">{s.ruolo}</div>
                </div>
                <span className="text-lg font-bold text-slate-700">{s.quota}</span>
              </div>
            ))}
            {(!d.soci || d.soci.length === 0) && (
              <div className="col-span-full text-center py-4 text-sm text-slate-400">Nessun socio configurato</div>
            )}
          </div>
        )}
      </div>

      {d.note != null && d.note !== '' && (
        <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle size={16} className="text-slate-400 mt-0.5 shrink-0" />
          {String(d.note)}
        </div>
      )}

      {editing && (
        <div className="flex gap-2 pt-2 border-t border-slate-100">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Save size={14} />
            Salva
          </button>
          <button
            onClick={() => { setEditing(null); setFormData(company || {}) }}
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Annulla
          </button>
        </div>
      )}
    </div>
  )
}

// ==========================================
// SEZIONE UTENTI (CRUD)
// ==========================================
function UserSection({ showToast, companyId: COMPANY_ID }: SectionProps) {
  // TODO: tighten type — Supabase rows
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [costCenters, setCostCenters] = useState<any[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ nome: '', cognome: '', email: '', ruolo: 'operatrice', is_active: true, outlet_access: ['all'] as string[] })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadUsers()
    loadCostCenters()
  }, [])

  const loadUsers = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('app_users')
        .select('*')
        .eq('company_id', COMPANY_ID || '')
        .order('nome', { ascending: true })

      if (error) throw error
      setUsers(data || [])
    } catch (err) {
      showToast?.('Errore caricamento utenti', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadCostCenters = async () => {
    try {
      const { data, error } = await supabase
        .from('cost_centers')
        .select('*')
        .eq('company_id', COMPANY_ID || '')
        .order('sort_order', { ascending: true })

      if (error) throw error
      setCostCenters(data || [])
    } catch (err) {
      showToast?.('Errore caricamento centri di costo', 'error')
    }
  }

  const resetForm = () => {
    setForm({ nome: '', cognome: '', email: '', ruolo: 'operatrice', is_active: true, outlet_access: ['all'] })
    setShowForm(false)
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!form.nome.trim() || !form.cognome.trim() || !form.email.trim()) return

    try {
      setSaving(true)
      const payload = {
        nome: form.nome,
        cognome: form.cognome,
        email: form.email,
        ruolo: form.ruolo,
        is_active: form.is_active,
        outlet_access: form.outlet_access,
        company_id: COMPANY_ID,
      }

      if (editingId) {
        const { error } = await supabase
          .from('app_users')
          .update(payload)
          .eq('id', editingId)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('app_users')
          .insert([payload])

        if (error) throw error
      }

      await loadUsers()
      resetForm()
      showToast?.(editingId ? 'Utente aggiornato' : 'Utente creato')
    } catch (err) {
      showToast?.('Errore salvataggio utente', 'error')
    } finally {
      setSaving(false)
    }
  }

  // TODO: tighten type
  const handleEdit = (u: any) => {
    setForm({
      nome: u.nome,
      cognome: u.cognome,
      email: u.email,
      ruolo: u.ruolo,
      is_active: u.is_active,
      outlet_access: [...(u.outlet_access || ['all'])]
    })
    setEditingId(u.id)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('app_users')
        .delete()
        .eq('id', id)

      if (error) throw error
      await loadUsers()
      setConfirmDelete(null)
      showToast?.('Utente eliminato')
    } catch (err) {
      showToast?.('Errore eliminazione utente', 'error')
    }
  }

  const toggleOutlet = (outletCode: string) => {
    setForm(prev => {
      if (outletCode === 'all') return { ...prev, outlet_access: ['all'] }
      let newOutlets = prev.outlet_access.filter(o => o !== 'all')
      if (newOutlets.includes(outletCode)) {
        newOutlets = newOutlets.filter(o => o !== outletCode)
      } else {
        newOutlets.push(outletCode)
      }
      if (newOutlets.length === 0) newOutlets = ['all']
      return { ...prev, outlet_access: newOutlets }
    })
  }

  const filtered = users.filter(u => {
    const q = search.toLowerCase()
    return !q || u.nome.toLowerCase().includes(q) || u.cognome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  const getRoleStyle = (ruolo: string) => {
    const r = ROLE_OPTIONS.find(o => o.value === ruolo)
    return r ? r.color : 'bg-slate-100 text-slate-700'
  }

  const getRoleLabel = (ruolo: string) => {
    const r = ROLE_OPTIONS.find(o => o.value === ruolo)
    return r ? r.label : ruolo
  }

  if (loading) return <div className="px-5 py-4 text-center text-slate-500">Caricamento utenti...</div>

  return (
    <div className="px-5 py-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Cerca utente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={16} />
          Nuovo utente
        </button>
      </div>

      {/* Form nuovo/modifica */}
      {showForm && (
        <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-slate-800">
            {editingId ? 'Modifica utente' : 'Nuovo utente'}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nome *</label>
              <input value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cognome *</label>
              <input value={form.cognome} onChange={e => setForm(p => ({ ...p, cognome: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ruolo</label>
              <select value={form.ruolo} onChange={e => setForm(p => ({ ...p, ruolo: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500">
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm text-slate-700">Utente attivo</span>
              </label>
            </div>
          </div>
          {/* Outlet assegnati */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Outlet visibili</label>
            <div className="flex flex-wrap gap-2">
              {[{ code: 'all', label: 'Tutti gli outlet' }, ...costCenters].map(c => {
                const selected = form.outlet_access.includes(c.code)
                return (
                  <button key={c.code}
                    onClick={() => toggleOutlet(c.code)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                      selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={resetForm} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
              Annulla
            </button>
            <button onClick={handleSave}
              disabled={!form.nome.trim() || !form.cognome.trim() || !form.email.trim() || saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition">
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {editingId ? 'Aggiorna' : 'Aggiungi'}
            </button>
          </div>
        </div>
      )}

      {/* Lista utenti */}
      <div className="divide-y divide-slate-100">
        {filtered.map(u => (
          <div key={u.id} className="py-3 flex items-center justify-between group">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${u.is_active ? 'bg-blue-500' : 'bg-slate-300'}`}>
                {u.nome[0]}{u.cognome[0]}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-slate-900">{u.nome} {u.cognome}</span>
                  {!u.is_active && <span className="text-[10px] text-slate-400 uppercase tracking-wide">inattivo</span>}
                </div>
                <div className="text-xs text-slate-400 truncate">{u.email}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {u.outlet_access && u.outlet_access.map((o: string) => (
                    <span key={o} className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                      {getCentroLabel(o, costCenters)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getRoleStyle(u.ruolo)}`}>
                {getRoleLabel(u.ruolo)}
              </span>
              <button onClick={() => handleEdit(u)}
                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition opacity-0 group-hover:opacity-100">
                <Pencil size={14} />
              </button>
              {confirmDelete === u.id ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => handleDelete(u.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition">
                    <Check size={14} />
                  </button>
                  <button onClick={() => setConfirmDelete(null)} className="p-1.5 text-slate-400 hover:bg-slate-50 rounded-lg transition">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(u.id)}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition opacity-0 group-hover:opacity-100">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-400">Nessun utente trovato</div>
        )}
      </div>
      <div className="text-xs text-slate-400 pt-2">{users.length} utenti totali &middot; {users.filter(u => u.is_active).length} attivi</div>
    </div>
  )
}

// ==========================================
// SEZIONE COSTI (CRUD)
// ==========================================
function CostSection({ showToast, companyId: COMPANY_ID }: SectionProps) {
  // TODO: tighten type — Supabase rows
  const [costs, setCosts] = useState<any[]>([])
  const [costCenters, setCostCenters] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [filterCentro, setFilterCentro] = useState('all')
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const emptyForm = { code: '', name: '', macro_group: MACRO_GROUPS[0], is_fixed: false, is_recurring: true, default_centers: ['all'], annual_amount: '', note: '', parent_id: '' }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    loadCosts()
    loadCostCenters()
  }, [])

  const loadCosts = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('company_id', COMPANY_ID || '')
        .order('code', { ascending: true })

      if (error) throw error
      setCosts(data || [])
    } catch (err) {
      showToast?.('Errore caricamento voci di costo', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadCostCenters = async () => {
    try {
      const { data, error } = await supabase
        .from('cost_centers')
        .select('*')
        .eq('company_id', COMPANY_ID || '')
        .order('sort_order', { ascending: true })

      if (error) throw error
      setCostCenters(data || [])
    } catch (err) {
      showToast?.('Errore caricamento centri di costo', 'error')
    }
  }

  const resetForm = () => {
    setForm(emptyForm)
    setShowForm(false)
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      showToast?.('Codice e nome sono obbligatori', 'error'); return
    }
    // Check duplicate code
    const existingCode = costs.find(c => c.code === form.code.toUpperCase() && c.id !== editingId)
    if (existingCode) {
      showToast?.(`Codice "${form.code.toUpperCase()}" già esistente`, 'error'); return
    }
    // Guard against circular parent
    if (form.parent_id && form.parent_id === editingId) {
      showToast?.('Una voce non può essere sotto-conto di sé stessa', 'error'); return
    }

    try {
      setSaving(true)
      const payload = {
        code: form.code.toUpperCase(),
        name: form.name,
        macro_group: form.macro_group,
        is_fixed: form.is_fixed,
        is_recurring: form.is_recurring,
        default_centers: form.default_centers,
        annual_amount: Number(form.annual_amount) || 0,
        note: form.note,
        parent_id: form.parent_id || null,
        company_id: COMPANY_ID,
      }

      if (editingId) {
        const { error } = await supabase
          .from('chart_of_accounts')
          .update(payload)
          .eq('id', editingId)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('chart_of_accounts')
          .insert([payload])

        if (error) throw error
      }

      await loadCosts()
      resetForm()
      showToast?.(editingId ? 'Voce aggiornata' : 'Voce creata')
    } catch (err) {
      showToast?.('Errore salvataggio voce di costo', 'error')
    } finally {
      setSaving(false)
    }
  }

  // TODO: tighten type
  const handleEdit = (c: any) => {
    setForm({
      code: c.code,
      name: c.name,
      macro_group: c.macro_group,
      is_fixed: c.is_fixed,
      is_recurring: c.is_recurring,
      default_centers: [...(c.default_centers || ['all'])],
      annual_amount: c.annual_amount,
      note: c.note || '',
      parent_id: c.parent_id || '',
    })
    setEditingId(c.id)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('chart_of_accounts')
        .delete()
        .eq('id', id)

      if (error) throw error
      await loadCosts()
      setConfirmDelete(null)
      showToast?.('Voce eliminata')
    } catch (err) {
      showToast?.('Errore eliminazione voce di costo', 'error')
    }
  }

  // Get parent options for hierarchy
  const parentOptions = costs.filter(c => !c.parent_id) // only root items can be parents

  const toggleCentroCost = (centroCode: string) => {
    setForm(prev => {
      if (centroCode === 'all') return { ...prev, default_centers: ['all'] }
      let newCentri = prev.default_centers.filter(o => o !== 'all')
      if (newCentri.includes(centroCode)) {
        newCentri = newCentri.filter(o => o !== centroCode)
      } else {
        newCentri.push(centroCode)
      }
      if (newCentri.length === 0) newCentri = ['all']
      return { ...prev, default_centers: newCentri }
    })
  }

  const filtered = costs.filter(c => {
    const q = search.toLowerCase()
    const matchSearch = !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    const matchCentro = filterCentro === 'all' || c.default_centers.includes('all') || c.default_centers.includes(filterCentro)
    return matchSearch && matchCentro
  })

  type CostItem = typeof filtered[number]
  const groups: Record<string, CostItem[]> = {}
  filtered.forEach(c => {
    if (!groups[c.macro_group]) groups[c.macro_group] = []
    groups[c.macro_group].push(c)
  })

  const totale = filtered.reduce((s, c) => s + (c.annual_amount || 0), 0)

  if (loading) return <div className="px-5 py-4 text-center text-slate-500">Caricamento costi...</div>

  return (
    <div className="px-5 py-4 space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Cerca voce di costo..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={filterCentro} onChange={e => setFilterCentro(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500">
            <option value="all">Tutti i centri</option>
            {costCenters.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
          <Plus size={16} />
          Nuova voce
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-slate-800">{editingId ? 'Modifica voce di costo' : 'Nuova voce di costo'}</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Codice *</label>
              <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="ES: LOC003"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Nome voce *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Importo annuo</label>
              <input type="number" value={form.annual_amount} onChange={e => setForm(p => ({ ...p, annual_amount: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Macro gruppo</label>
              <select value={form.macro_group} onChange={e => setForm(p => ({ ...p, macro_group: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                {MACRO_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_fixed} onChange={e => setForm(p => ({ ...p, is_fixed: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300" />
                <span className="text-sm text-slate-700">Costo fisso</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_recurring} onChange={e => setForm(p => ({ ...p, is_recurring: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300" />
                <span className="text-sm text-slate-700">Ricorrente</span>
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Note</label>
              <input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
          </div>
          {/* Parent account (hierarchy) */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              <CornerDownRight size={12} className="inline mr-1" />
              Sottoconto di (opzionale)
            </label>
            <select value={form.parent_id} onChange={e => setForm(p => ({ ...p, parent_id: e.target.value }))}
              className="w-full md:w-1/2 px-3 py-2 text-sm border border-slate-200 rounded-lg">
              <option value="">— Nessuno (voce principale) —</option>
              {parentOptions.filter(p => p.id !== editingId).map(p => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Seleziona un conto padre per creare una struttura gerarchica conti/sottoconti.</p>
          </div>
          {/* Centri di costo */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Assegna a centro/i di costo</label>
            <div className="flex flex-wrap gap-2">
              <button key="all" onClick={() => toggleCentroCost('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                  form.default_centers.includes('all') ? 'bg-slate-600 text-white border-transparent' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                Tutti gli outlet
              </button>
              {costCenters.map(c => {
                const selected = form.default_centers.includes(c.code)
                return (
                  <button key={c.code} onClick={() => toggleCentroCost(c.code)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                      selected ? `${c.color} text-white border-transparent` : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Seleziona uno o più centri di costo. "Tutti" assegna il costo a tutte le entità.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={resetForm} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Annulla</button>
            <button onClick={handleSave}
              disabled={!form.code.trim() || !form.name.trim() || saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition">
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {editingId ? 'Aggiorna' : 'Aggiungi'}
            </button>
          </div>
        </div>
      )}

      {/* Grouped costs */}
      <div className="space-y-2">
        {Object.entries(groups).length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">Nessuna voce di costo trovata</div>
        ) : (
          Object.entries(groups).map(([group, cats]) => {
            const isOpen = expandedGroup === group
            const groupTotal = cats.reduce((s, c) => s + (c.annual_amount || 0), 0)
            return (
              <div key={group} className="border border-slate-200 rounded-xl overflow-hidden">
                <div
                  className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50/80 transition bg-white"
                  onClick={() => setExpandedGroup(isOpen ? null : group)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-800">{group}</span>
                    <span className="text-xs text-slate-400">({cats.length} voci)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-700">€ {fmt(groupTotal)}</span>
                    {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-slate-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50/80 text-xs text-slate-500 uppercase tracking-wide">
                          <th className="px-4 py-2 text-left font-medium">Codice</th>
                          <th className="px-4 py-2 text-left font-medium">Voce</th>
                          <th className="px-4 py-2 text-right font-medium">Importo annuo</th>
                          <th className="px-4 py-2 text-center font-medium">Tipo</th>
                          <th className="px-4 py-2 text-left font-medium">Centri di costo</th>
                          <th className="px-4 py-2 text-left font-medium">Note</th>
                          <th className="px-4 py-2 text-center font-medium w-20">Azioni</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {cats.map(c => (
                          <tr key={c.id} className="hover:bg-slate-50/50 group/row">
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{c.code}</td>
                            <td className="px-4 py-2.5 font-medium text-slate-800">
                              {c.parent_id && <CornerDownRight size={12} className="inline mr-1 text-slate-300" />}
                              {c.name}
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold text-slate-700">€ {fmt(c.annual_amount)}</td>
                            <td className="px-4 py-2.5 text-center">
                              <div className="flex justify-center gap-1">
                                {c.is_fixed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Fisso</span>}
                                {!c.is_fixed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">Variabile</span>}
                                {c.is_recurring && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">Ric.</span>}
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {c.default_centers && c.default_centers.map((cc: string) => (
                                  <span key={cc} className={`text-[10px] px-1.5 py-0.5 rounded-full text-white ${getCentroColor(cc)}`}>
                                    {getCentroLabel(cc, costCenters)}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-400 max-w-[150px] truncate">{c.note || '—'}</td>
                            <td className="px-4 py-2.5 text-center">
                              <div className="flex justify-center gap-1">
                                <button onClick={(e) => { e.stopPropagation(); handleEdit(c) }}
                                  className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition opacity-0 group-hover/row:opacity-100">
                                  <Pencil size={13} />
                                </button>
                                {confirmDelete === c.id ? (
                                  <>
                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }}
                                      className="p-1 text-red-600 hover:bg-red-50 rounded transition"><Check size={13} /></button>
                                    <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(null) }}
                                      className="p-1 text-slate-400 hover:bg-slate-50 rounded transition"><X size={13} /></button>
                                  </>
                                ) : (
                                  <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(c.id) }}
                                    className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition opacity-0 group-hover/row:opacity-100">
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Totale */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          <span className="text-sm text-slate-600">{filtered.length} voci di costo {filterCentro !== 'all' && `(filtro: ${getCentroLabel(filterCentro, costCenters)})`}</span>
          <span className="text-base font-bold text-slate-900">Totale: € {fmt(totale)}</span>
        </div>
      )}
    </div>
  )
}

// ==========================================
// SEZIONE CENTRI DI COSTO
// ==========================================
function CentriDiCostoSection({ showToast, companyId: COMPANY_ID }: SectionProps) {
  // TODO: tighten type — Supabase rows
  const [centers, setCenters] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ code: '', label: '', color: 'bg-blue-600', sort_order: 0 })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const colorOptions = [
    'bg-slate-600', 'bg-amber-600', 'bg-blue-600', 'bg-emerald-600',
    'bg-sky-600', 'bg-rose-600', 'bg-orange-600', 'bg-purple-600', 'bg-indigo-600'
  ]

  useEffect(() => {
    loadCenters()
  }, [])

  const loadCenters = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('cost_centers')
        .select('*')
        .eq('company_id', COMPANY_ID || '')
        .order('sort_order', { ascending: true })

      if (error) throw error
      setCenters(data || [])
    } catch (err) {
      showToast?.('Errore caricamento centri di costo', 'error')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm({ code: '', label: '', color: 'bg-blue-600', sort_order: centers.length })
    setShowForm(false)
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!form.code.trim() || !form.label.trim()) return

    try {
      setSaving(true)
      const payload = {
        code: form.code.toUpperCase(),
        label: form.label,
        color: form.color,
        sort_order: form.sort_order,
        is_active: true,
        company_id: COMPANY_ID,
      }

      if (editingId) {
        const { error } = await supabase
          .from('cost_centers')
          .update(payload)
          .eq('id', editingId)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('cost_centers')
          .insert([payload])

        if (error) throw error
      }

      await loadCenters()
      resetForm()
      showToast?.(editingId ? 'Centro aggiornato' : 'Centro creato')
    } catch (err) {
      showToast?.('Errore salvataggio centro di costo', 'error')
    } finally {
      setSaving(false)
    }
  }

  // TODO: tighten type
  const handleEdit = (c: any) => {
    setForm({
      code: c.code,
      label: c.label,
      color: c.color,
      sort_order: c.sort_order
    })
    setEditingId(c.id)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('cost_centers')
        .delete()
        .eq('id', id)

      if (error) throw error
      await loadCenters()
      setConfirmDelete(null)
      showToast?.('Centro eliminato')
    } catch (err) {
      showToast?.('Errore eliminazione centro di costo', 'error')
    }
  }

  if (loading) return <div className="px-5 py-4 text-center text-slate-500">Caricamento centri di costo...</div>

  return (
    <div className="px-5 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">I centri di costo definiscono a quali entità vengono assegnate le voci di spesa.</p>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={16} />
          Nuovo centro
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-slate-800">
            {editingId ? 'Modifica centro di costo' : 'Nuovo centro di costo'}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Codice *</label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="ES: VDC"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Etichetta *</label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm(p => ({ ...p, label: e.target.value }))}
                placeholder="es. Punto vendita Centro"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Colore</label>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map(color => (
                <button
                  key={color}
                  onClick={() => setForm(p => ({ ...p, color }))}
                  className={`w-8 h-8 rounded-lg border-2 transition ${
                    form.color === color ? 'border-slate-900' : 'border-transparent'
                  } ${color}`}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={resetForm} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
              Annulla
            </button>
            <button
              onClick={handleSave}
              disabled={!form.code.trim() || !form.label.trim() || saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition"
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {editingId ? 'Aggiorna' : 'Aggiungi'}
            </button>
          </div>
        </div>
      )}

      {/* Lista centri */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {centers.map(c => (
          <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-lg group">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${c.color}`} />
              <div>
                <div className="text-sm font-medium text-slate-800">{c.label}</div>
                <div className="text-xs text-slate-400">{c.code}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
              <button
                onClick={() => handleEdit(c)}
                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
              >
                <Pencil size={14} />
              </button>
              {confirmDelete === c.id ? (
                <>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="p-1.5 text-slate-400 hover:bg-slate-50 rounded-lg transition"
                  >
                    <X size={14} />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmDelete(c.id)}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {centers.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-slate-400">Nessun centro di costo configurato</div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// SEZIONE SDI (Fatturazione Elettronica)
// ==========================================
function SdiSection({ showToast, companyId: COMPANY_ID }: SectionProps) {
  // TODO: tighten type — Supabase row
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; data?: any; error?: string } | null>(null)

  useEffect(() => { loadConfig() }, [])

  const loadConfig = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('sdi_config')
        .select('*')
        .eq('company_id', COMPANY_ID || '')
        .single()
      if (error && error.code !== 'PGRST116') throw error
      setConfig(data)
    } catch (err) {
      showToast?.('Errore caricamento config SDI', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleEnvironment = async () => {
    if (!config) return
    const newEnv = config.environment === 'TEST' ? 'PRODUCTION' : 'TEST'
    setSaving(true)
    try {
      const { error } = await supabase
        .from('sdi_config')
        .update({ environment: newEnv, updated_at: new Date().toISOString() })
        .eq('id', config.id)
      if (error) throw error
      setConfig({ ...config, environment: newEnv })
      showToast?.(`Ambiente SDI impostato su ${newEnv === 'PRODUCTION' ? 'Produzione' : 'Test'}`)
    } catch (err: unknown) {
      showToast?.('Errore aggiornamento: ' + (err instanceof Error ? err.message : ''), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateField = async (field: string, value: string | null) => {
    if (!config) return
    setSaving(true)
    try {
      // sdi_config è una tabella tipata in DB → cast strutturale per chiave dinamica.
      const { error } = await supabase
        .from('sdi_config')
        .update({ [field]: value, updated_at: new Date().toISOString() } as never)
        .eq('id', config.id)
      if (error) throw error
      setConfig({ ...config, [field]: value })
      showToast?.('Configurazione aggiornata')
    } catch (err: unknown) {
      showToast?.('Errore: ' + (err instanceof Error ? err.message : ''), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdmZ4c3ZxcG5wdmliZ2VxcHFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNDkwNDcsImV4cCI6MjA5MDcyNTA0N30.ohYziAXiOWS0TKU9HHuhUAbf5Geh10xbLGEoftOMJZA'
      const baseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xfvfxsvqpnpvibgeqpqp.supabase.co'
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Non autenticato')
      const res = await fetch(`${baseUrl}/functions/v1/sdi-status-check`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          'apikey': anonKey,
        },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Errore test')
      setTestResult({ success: true, data: json.data })
      showToast?.('Connessione SDI verificata')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      setTestResult({ success: false, error: msg })
      showToast?.('Test fallito: ' + msg, 'error')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-center text-slate-400"><Loader size={20} className="animate-spin mx-auto" /></div>
  }

  if (!config) {
    return (
      <div className="p-6 text-center text-slate-500">
        <FileText size={32} className="mx-auto mb-2 text-slate-300" />
        <p className="text-sm">Nessuna configurazione SDI trovata.</p>
        <p className="text-xs text-slate-400 mt-1">Contatta l'amministratore per configurare l'accreditamento SDI.</p>
      </div>
    )
  }

  const STATUS_COLORS: Record<string, string> = {
    COMPLETED: 'bg-green-100 text-green-700',
    ACTIVE: 'bg-green-100 text-green-700',
    TESTING: 'bg-amber-100 text-amber-700',
    PENDING: 'bg-slate-100 text-slate-600',
    SUSPENDED: 'bg-red-100 text-red-700',
  }

  return (
    <div className="p-5 space-y-6">
      {/* Stato accreditamento */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Stato Accreditamento</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[config.accreditation_status] || STATUS_COLORS.PENDING}`}>
              <ShieldCheck size={12} />
              {config.accreditation_status === 'COMPLETED' ? 'Accreditato' :
               config.accreditation_status === 'ACTIVE' ? 'Attivo' :
               config.accreditation_status === 'TESTING' ? 'In test' :
               config.accreditation_status === 'SUSPENDED' ? 'Sospeso' : 'In attesa'}
            </span>
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
              config.environment === 'PRODUCTION' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {config.environment === 'PRODUCTION' ? 'Produzione' : 'Test'}
            </span>
          </div>
        </div>
        <button
          onClick={handleTestConnection}
          disabled={testing}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition disabled:opacity-50"
        >
          {testing ? <Loader size={14} className="animate-spin" /> : <Zap size={14} />}
          Test connessione
        </button>
      </div>

      {/* Risultato test */}
      {testResult && (
        <div className={`p-3 rounded-lg text-sm ${testResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {testResult.success ? (
            <div className="flex items-center gap-2">
              <Check size={14} />
              <span>Connessione SDI funzionante — {testResult.data?.config?.environment || 'TEST'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AlertCircle size={14} />
              <span>{testResult.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Configurazione */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Codice Fiscale Trasmittente</label>
          <div className="px-3 py-2 bg-slate-50 rounded-lg text-sm font-mono text-slate-800 border border-slate-200">
            {config.codice_fiscale_trasmittente || '—'}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Canale di trasmissione</label>
          <div className="px-3 py-2 bg-slate-50 rounded-lg text-sm text-slate-800 border border-slate-200">
            {config.channel_type || 'WEBSERVICE'}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Codice SDI (7 caratteri)</label>
          <input
            type="text"
            maxLength={7}
            value={config.codice_sdi || ''}
            onChange={e => setConfig({ ...config, codice_sdi: e.target.value })}
            onBlur={e => e.target.value !== (config.codice_sdi || '') && handleUpdateField('codice_sdi', e.target.value || null)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
            placeholder="0000000"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">PEC ricezione</label>
          <input
            type="email"
            value={config.pec_ricezione || ''}
            onChange={e => setConfig({ ...config, pec_ricezione: e.target.value })}
            onBlur={e => handleUpdateField('pec_ricezione', e.target.value || null)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            placeholder="fatturazione@pec.azienda.it"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Progressivo invio</label>
          <div className="px-3 py-2 bg-slate-50 rounded-lg text-sm font-mono text-slate-800 border border-slate-200">
            {config.progressivo_invio ?? 0}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Endpoint SDI</label>
          <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs font-mono text-slate-600 border border-slate-200 truncate" title={config.endpoint_url}>
            {config.endpoint_url || '—'}
          </div>
        </div>
      </div>

      {/* Toggle ambiente */}
      <div className="border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-slate-700">Ambiente</h4>
            <p className="text-xs text-slate-400 mt-0.5">
              {config.environment === 'TEST'
                ? 'In test le fatture vengono inviate all\'ambiente di validazione AdE.'
                : 'In produzione le fatture vengono inviate al Sistema di Interscambio reale.'}
            </p>
          </div>
          <button
            onClick={handleToggleEnvironment}
            disabled={saving}
            className={`relative inline-flex h-8 w-[120px] items-center rounded-full transition-colors ${
              config.environment === 'PRODUCTION' ? 'bg-green-500' : 'bg-amber-400'
            }`}
          >
            <span className={`inline-block h-6 w-[56px] transform rounded-full bg-white shadow-sm transition-transform text-xs font-medium flex items-center justify-center ${
              config.environment === 'PRODUCTION' ? 'translate-x-[60px]' : 'translate-x-1'
            }`}>
              {config.environment === 'PRODUCTION' ? 'PROD' : 'TEST'}
            </span>
          </button>
        </div>
      </div>

      {/* Certificati */}
      <div className="border-t border-slate-100 pt-4">
        <h4 className="text-sm font-medium text-slate-700 mb-2">Certificati SSL</h4>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Client Certificate', name: config.ssl_cert_secret_name },
            { label: 'Client Key', name: config.ssl_key_secret_name },
          ].map(cert => (
            <div key={cert.label} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
              <ShieldCheck size={14} className={cert.name ? 'text-green-500' : 'text-slate-300'} />
              <div>
                <div className="text-xs font-medium text-slate-700">{cert.label}</div>
                <div className="text-xs text-slate-400">{cert.name ? `Vault: ${cert.name}` : 'Non configurato'}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-2">
          I certificati sono conservati in modo sicuro nel Vault di Supabase e non sono mai esposti al frontend.
        </p>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
        <strong>Intermediario:</strong> EPPI S.R.L. (CF {config.codice_fiscale_trasmittente}) —
        Endpoint ricezione e notifiche registrati su Agenzia delle Entrate.
        In ambiente test le fatture vengono validate ma non trasmesse ai destinatari.
      </div>
    </div>
  )
}

// ==========================================
// PAGINA PRINCIPALE
// ==========================================
export default function Impostazioni() {
  const { profile } = useAuth()
  const COMPANY_ID = profile?.company_id
  const userRole = profile?.role || 'super_advisor'
  const allowedSections = ROLE_PERMISSIONS[userRole] || []
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)

  const showToast = (msg: string, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const sections = [
    { id: 'company', icon: Building2, title: 'Dati azienda', subtitle: 'Visura e compagine societaria', component: CompanySection },
    { id: 'users', icon: Users, title: 'Utenti', subtitle: 'Gestione utenti, ruoli e accessi', component: UserSection },
    { id: 'costs', icon: Tag, title: 'Voci di costo', subtitle: 'Catalogo costi con assegnazione a centri di costo e gerarchia conti/sottoconti', component: CostSection },
    { id: 'centri', icon: Shield, title: 'Centri di costo', subtitle: 'Punti vendita, sede, magazzino — entità di allocazione', component: CentriDiCostoSection },
    { id: 'sdi', icon: FileText, title: 'Fatturazione SDI', subtitle: 'Accreditamento, certificati e configurazione Sistema di Interscambio', component: SdiSection },
  ]

  const [openSection, setOpenSection] = useState<string | null>('company')

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Impostazioni</h1>
        <p className="text-sm text-slate-500">Configurazione azienda, utenti e struttura costi</p>
      </div>

      {allowedSections.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex items-center gap-3">
          <Lock size={20} className="text-amber-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Accesso limitato</p>
            <p className="text-xs text-amber-600">Il tuo ruolo ({userRole}) non ha permessi per modificare le impostazioni. Contatta un amministratore per richiedere l'accesso.</p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {sections.map(section => {
          const isOpen = openSection === section.id
          const Component = section.component
          const hasAccess = allowedSections.includes(section.id)
          return (
            <div key={section.id} className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ${!hasAccess ? 'opacity-50' : ''}`}>
              <div className="p-5 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition"
                onClick={() => hasAccess && setOpenSection(isOpen ? null : section.id)}>
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg ${hasAccess ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-300'}`}>
                    <section.icon size={20} />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                      {section.title}
                      {!hasAccess && <Lock size={12} className="text-slate-400" />}
                    </div>
                    <div className="text-xs text-slate-400">{section.subtitle}</div>
                  </div>
                </div>
                {hasAccess && (isOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />)}
              </div>
              {isOpen && hasAccess && (
                <div className="border-t border-slate-100">
                  <Component showToast={showToast} companyId={COMPANY_ID ?? undefined} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ToastBar toast={toast} />
    </div>
  )
}
