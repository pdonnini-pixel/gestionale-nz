import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  Users, Search, Settings2, Store, Percent, DollarSign, Equal, ArrowRight,
  CheckCircle2, AlertCircle, X, Loader2, Plus, Trash2, Save
} from 'lucide-react'

/* ───────── helpers ───────── */

function fmt(n, dec = 2) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(n)
}

const MODE_META = {
  DIRETTO:       { label: 'Diretto',        color: 'blue',    icon: ArrowRight,   desc: 'Tutto a un solo outlet' },
  SPLIT_PCT:     { label: 'Split %',        color: 'purple',  icon: Percent,      desc: 'Ripartizione percentuale' },
  SPLIT_VALORE:  { label: 'Split Valore',   color: 'amber',   icon: DollarSign,   desc: 'Importi fissi per outlet' },
  QUOTE_UGUALI:  { label: 'Quote Uguali',   color: 'emerald', icon: Equal,        desc: 'Diviso in parti uguali' },
}

const COLOR_MAP = {
  blue:    { bg: 'bg-blue-50',    border: 'border-blue-300',    text: 'text-blue-700',    ring: 'ring-blue-500',    badge: 'bg-blue-100 text-blue-800' },
  purple:  { bg: 'bg-purple-50',  border: 'border-purple-300',  text: 'text-purple-700',  ring: 'ring-purple-500',  badge: 'bg-purple-100 text-purple-800' },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-300',   text: 'text-amber-700',   ring: 'ring-amber-500',   badge: 'bg-amber-100 text-amber-800' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', ring: 'ring-emerald-500', badge: 'bg-emerald-100 text-emerald-800' },
  gray:    { bg: 'bg-gray-50',    border: 'border-gray-300',    text: 'text-gray-500',    ring: 'ring-gray-400',    badge: 'bg-gray-100 text-gray-600' },
}

/* ───────── main component ───────── */

export default function AllocazioneFornitori() {
  const { profile } = useAuth()
  const COMPANY_ID = profile?.company_id

  /* ── state ── */
  const [suppliers, setSuppliers]     = useState([])
  const [outlets, setOutlets]         = useState([])
  const [rules, setRules]             = useState([])   // active rules with details
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState(null) // opens modal
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState(null)

  /* modal editor state */
  const [editMode, setEditMode]       = useState(null)           // 'DIRETTO' | 'SPLIT_PCT' | ...
  const [editDetails, setEditDetails] = useState([])             // [{outlet_id, percentage, fixed_value, selected}]
  const [existingRule, setExistingRule] = useState(null)          // rule record if editing

  /* ── data loading ── */

  const loadData = useCallback(async () => {
    if (!COMPANY_ID) return
    setLoading(true)
    setError(null)
    try {
      const [supRes, outRes, ruleRes] = await Promise.all([
        supabase
          .from('suppliers')
          .select('id, ragione_sociale, name, partita_iva, cost_center, is_active')
          .eq('company_id', COMPANY_ID)
          .or('is_deleted.is.null,is_deleted.eq.false')
          .order('ragione_sociale'),
        supabase
          .from('outlets')
          .select('id, code, name, is_active')
          .eq('company_id', COMPANY_ID)
          .eq('is_active', true)
          .order('code'),
        supabase
          .from('supplier_allocation_rules')
          .select('id, supplier_id, allocation_mode, description, is_active, created_at, updated_at')
          .eq('company_id', COMPANY_ID)
          .eq('is_active', true),
      ])

      if (supRes.error) throw supRes.error
      if (outRes.error) throw outRes.error
      if (ruleRes.error) throw ruleRes.error

      // Load details for all active rules
      const ruleIds = (ruleRes.data || []).map(r => r.id)
      let detailsData = []
      if (ruleIds.length > 0) {
        const detRes = await supabase
          .from('supplier_allocation_details')
          .select('id, rule_id, outlet_id, percentage, fixed_value')
          .in('rule_id', ruleIds)
        if (detRes.error) throw detRes.error
        detailsData = detRes.data || []
      }

      // Attach details to rules
      const rulesWithDetails = (ruleRes.data || []).map(r => ({
        ...r,
        details: detailsData.filter(d => d.rule_id === r.id),
      }))

      setSuppliers(supRes.data || [])
      setOutlets(outRes.data || [])
      setRules(rulesWithDetails)
    } catch (err) {
      console.error('[AllocazioneFornitori] load error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [COMPANY_ID])

  useEffect(() => { loadData() }, [loadData])

  /* ── derived data ── */

  const ruleBySupplier = useMemo(() => {
    const map = {}
    rules.forEach(r => { map[r.supplier_id] = r })
    return map
  }, [rules])

  const filteredSuppliers = useMemo(() => {
    const q = search.toLowerCase().trim()
    return suppliers.filter(s => {
      if (!q) return true
      const name = (s.ragione_sociale || s.name || '').toLowerCase()
      const piva = (s.partita_iva || '').toLowerCase()
      return name.includes(q) || piva.includes(q)
    })
  }, [suppliers, search])

  const withRule    = useMemo(() => filteredSuppliers.filter(s => ruleBySupplier[s.id]), [filteredSuppliers, ruleBySupplier])
  const withoutRule = useMemo(() => filteredSuppliers.filter(s => !ruleBySupplier[s.id]), [filteredSuppliers, ruleBySupplier])

  const stats = useMemo(() => {
    const total   = suppliers.length
    const conReg  = suppliers.filter(s => ruleBySupplier[s.id]).length
    const senzaR  = total - conReg
    const pct     = total > 0 ? (conReg / total) * 100 : 0
    return { total, conReg, senzaR, pct }
  }, [suppliers, ruleBySupplier])

  /* ── open modal ── */

  const openEditor = useCallback((supplier) => {
    const rule = ruleBySupplier[supplier.id] || null
    setSelectedSupplier(supplier)
    setExistingRule(rule)
    if (rule) {
      setEditMode(rule.allocation_mode)
      // Build detail rows from existing
      setEditDetails(outlets.map(o => {
        const det = rule.details.find(d => d.outlet_id === o.id)
        return {
          outlet_id: o.id,
          percentage: det?.percentage ?? 0,
          fixed_value: det?.fixed_value ?? 0,
          selected: !!det,
        }
      }))
    } else {
      setEditMode(null)
      setEditDetails(outlets.map(o => ({
        outlet_id: o.id,
        percentage: 0,
        fixed_value: 0,
        selected: false,
      })))
    }
    setError(null)
  }, [ruleBySupplier, outlets])

  const closeEditor = useCallback(() => {
    setSelectedSupplier(null)
    setEditMode(null)
    setEditDetails([])
    setExistingRule(null)
    setError(null)
  }, [])

  /* ── mode change resets details ── */

  const changeMode = useCallback((mode) => {
    setEditMode(mode)
    setEditDetails(prev => prev.map(d => ({
      ...d,
      percentage: 0,
      fixed_value: 0,
      selected: false,
    })))
  }, [])

  /* ── detail updaters ── */

  const setDetailField = useCallback((outletId, field, value) => {
    setEditDetails(prev => prev.map(d =>
      d.outlet_id === outletId ? { ...d, [field]: value } : d
    ))
  }, [])

  /* ── validation ── */

  const validation = useMemo(() => {
    if (!editMode) return { valid: false, message: 'Seleziona una modalità di allocazione' }

    if (editMode === 'DIRETTO') {
      const selected = editDetails.filter(d => d.selected)
      if (selected.length !== 1) return { valid: false, message: 'Seleziona esattamente un outlet' }
      return { valid: true, message: '' }
    }

    if (editMode === 'SPLIT_PCT') {
      const active = editDetails.filter(d => d.percentage > 0)
      if (active.length === 0) return { valid: false, message: 'Inserisci almeno una percentuale' }
      const total = editDetails.reduce((s, d) => s + (parseFloat(d.percentage) || 0), 0)
      if (Math.abs(total - 100) > 0.01) return { valid: false, message: `Il totale è ${fmt(total)}% — deve essere 100%` }
      return { valid: true, message: '' }
    }

    if (editMode === 'SPLIT_VALORE') {
      const active = editDetails.filter(d => d.fixed_value > 0)
      if (active.length === 0) return { valid: false, message: 'Inserisci almeno un importo' }
      return { valid: true, message: '' }
    }

    if (editMode === 'QUOTE_UGUALI') {
      const selected = editDetails.filter(d => d.selected)
      if (selected.length === 0) return { valid: false, message: 'Seleziona almeno un outlet' }
      return { valid: true, message: '' }
    }

    return { valid: false, message: 'Modalità non riconosciuta' }
  }, [editMode, editDetails])

  /* ── save ── */

  const handleSave = useCallback(async () => {
    if (!validation.valid || !selectedSupplier || !COMPANY_ID) return
    setSaving(true)
    setError(null)
    try {
      // 1. Deactivate existing rule if present
      if (existingRule) {
        const { error: deactErr } = await supabase
          .from('supplier_allocation_rules')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', existingRule.id)
        if (deactErr) throw deactErr
      }

      // 2. Insert new rule
      const { data: newRule, error: ruleErr } = await supabase
        .from('supplier_allocation_rules')
        .insert({
          company_id: COMPANY_ID,
          supplier_id: selectedSupplier.id,
          allocation_mode: editMode,
          description: MODE_META[editMode]?.label || editMode,
          is_active: true,
        })
        .select('id')
        .single()
      if (ruleErr) throw ruleErr

      // 3. Build detail rows
      let detailRows = []
      if (editMode === 'DIRETTO') {
        const sel = editDetails.find(d => d.selected)
        if (sel) {
          detailRows.push({
            rule_id: newRule.id,
            outlet_id: sel.outlet_id,
            percentage: 100,
            fixed_value: null,
          })
        }
      } else if (editMode === 'SPLIT_PCT') {
        detailRows = editDetails
          .filter(d => (parseFloat(d.percentage) || 0) > 0)
          .map(d => ({
            rule_id: newRule.id,
            outlet_id: d.outlet_id,
            percentage: parseFloat(d.percentage) || 0,
            fixed_value: null,
          }))
      } else if (editMode === 'SPLIT_VALORE') {
        detailRows = editDetails
          .filter(d => (parseFloat(d.fixed_value) || 0) > 0)
          .map(d => ({
            rule_id: newRule.id,
            outlet_id: d.outlet_id,
            percentage: null,
            fixed_value: parseFloat(d.fixed_value) || 0,
          }))
      } else if (editMode === 'QUOTE_UGUALI') {
        const selected = editDetails.filter(d => d.selected)
        const pctEach = selected.length > 0 ? parseFloat((100 / selected.length).toFixed(2)) : 0
        detailRows = selected.map(d => ({
          rule_id: newRule.id,
          outlet_id: d.outlet_id,
          percentage: pctEach,
          fixed_value: null,
        }))
      }

      if (detailRows.length > 0) {
        const { error: detErr } = await supabase
          .from('supplier_allocation_details')
          .insert(detailRows)
        if (detErr) throw detErr
      }

      // 4. Refresh and close
      await loadData()
      closeEditor()
    } catch (err) {
      console.error('[AllocazioneFornitori] save error:', err)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [validation, selectedSupplier, COMPANY_ID, existingRule, editMode, editDetails, loadData, closeEditor])

  /* ── delete rule ── */

  const handleDelete = useCallback(async () => {
    if (!existingRule) return
    if (!window.confirm('Eliminare la regola di allocazione per questo fornitore?')) return
    setSaving(true)
    setError(null)
    try {
      // details cascade on delete
      const { error: delErr } = await supabase
        .from('supplier_allocation_rules')
        .delete()
        .eq('id', existingRule.id)
      if (delErr) throw delErr

      await loadData()
      closeEditor()
    } catch (err) {
      console.error('[AllocazioneFornitori] delete error:', err)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [existingRule, loadData, closeEditor])

  /* ── outlet name helper ── */

  const outletName = useCallback((id) => {
    const o = outlets.find(o => o.id === id)
    return o ? `${o.code} — ${o.name}` : id
  }, [outlets])

  /* ── computed totals for editor ── */

  const pctTotal   = useMemo(() => editDetails.reduce((s, d) => s + (parseFloat(d.percentage) || 0), 0), [editDetails])
  const valTotal   = useMemo(() => editDetails.reduce((s, d) => s + (parseFloat(d.fixed_value) || 0), 0), [editDetails])
  const selCount   = useMemo(() => editDetails.filter(d => d.selected).length, [editDetails])
  const equalShare = useMemo(() => selCount > 0 ? 100 / selCount : 0, [selCount])

  /* ──────────────── RENDER ──────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        <span className="ml-3 text-gray-500">Caricamento allocazioni...</span>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 rounded-xl"><Settings2 size={22} className="text-indigo-600" /></div>
            Divisione Fornitori
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Definisci come i costi di ogni fornitore vengono ripartiti tra gli outlet
          </p>
        </div>
      </div>

      {/* ── STATISTICS BAR ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Totale fornitori" value={stats.total} color="indigo" />
        <StatCard icon={CheckCircle2} label="Con regola" value={stats.conReg} color="emerald" />
        <StatCard icon={AlertCircle} label="Senza regola" value={stats.senzaR} color="amber" />
        <StatCard icon={Percent} label="Copertura" value={`${fmt(stats.pct, 1)}%`} color="purple" />
      </div>

      {/* ── SEARCH ── */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Cerca fornitore per nome o P.IVA..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {/* ── SUPPLIER LIST ── */}
      {error && !selectedSupplier && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Con regola */}
      <SupplierSection
        title="Con regola"
        suppliers={withRule}
        ruleBySupplier={ruleBySupplier}
        outlets={outlets}
        onSelect={openEditor}
        outletName={outletName}
      />

      {/* Senza regola */}
      <SupplierSection
        title="Senza regola"
        suppliers={withoutRule}
        ruleBySupplier={ruleBySupplier}
        outlets={outlets}
        onSelect={openEditor}
        outletName={outletName}
        emptyColor
      />

      {filteredSuppliers.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          {search ? 'Nessun fornitore trovato per la ricerca.' : 'Nessun fornitore presente.'}
        </div>
      )}

      {/* ──────── MODAL ──────── */}
      {selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeEditor}>
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedSupplier.ragione_sociale || selectedSupplier.name}
                </h2>
                {selectedSupplier.partita_iva && (
                  <p className="text-sm text-gray-500">P.IVA {selectedSupplier.partita_iva}</p>
                )}
              </div>
              <button onClick={closeEditor} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Mode selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Modalità di allocazione</label>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(MODE_META).map(([key, meta]) => {
                    const c = COLOR_MAP[meta.color]
                    const active = editMode === key
                    const Icon = meta.icon
                    return (
                      <button
                        key={key}
                        onClick={() => changeMode(key)}
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all
                          ${active ? `${c.bg} ${c.border} ring-2 ${c.ring}` : 'border-gray-200 hover:border-gray-300 bg-white'}
                        `}
                      >
                        <div className={`p-2 rounded-lg ${active ? c.bg : 'bg-gray-50'}`}>
                          <Icon className={`w-5 h-5 ${active ? c.text : 'text-gray-400'}`} />
                        </div>
                        <div>
                          <div className={`text-sm font-medium ${active ? c.text : 'text-gray-700'}`}>{meta.label}</div>
                          <div className="text-xs text-gray-500">{meta.desc}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Mode-specific form */}
              {editMode === 'DIRETTO' && (
                <DirettoForm
                  outlets={outlets}
                  editDetails={editDetails}
                  setDetailField={setDetailField}
                  outletName={outletName}
                />
              )}

              {editMode === 'SPLIT_PCT' && (
                <SplitPctForm
                  outlets={outlets}
                  editDetails={editDetails}
                  setDetailField={setDetailField}
                  outletName={outletName}
                  pctTotal={pctTotal}
                />
              )}

              {editMode === 'SPLIT_VALORE' && (
                <SplitValoreForm
                  outlets={outlets}
                  editDetails={editDetails}
                  setDetailField={setDetailField}
                  outletName={outletName}
                  valTotal={valTotal}
                />
              )}

              {editMode === 'QUOTE_UGUALI' && (
                <QuoteUgualiForm
                  outlets={outlets}
                  editDetails={editDetails}
                  setDetailField={setDetailField}
                  outletName={outletName}
                  selCount={selCount}
                  equalShare={equalShare}
                />
              )}

              {/* Validation message */}
              {editMode && !validation.valid && (
                <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {validation.message}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-3 border-t">
                <div>
                  {existingRule && (
                    <button
                      onClick={handleDelete}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Elimina regola
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={closeEditor}
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!validation.valid || saving}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salva
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ════════════════════════════════════════════════════════ */

/* ── Stat Card ── */

function StatCard({ icon: Icon, label, value, color }) {
  const bgMap    = { indigo: 'bg-indigo-50', emerald: 'bg-emerald-50', amber: 'bg-amber-50', purple: 'bg-purple-50' }
  const iconMap  = { indigo: 'text-indigo-600', emerald: 'text-emerald-600', amber: 'text-amber-600', purple: 'text-purple-600' }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className={`p-2.5 rounded-lg ${bgMap[color] || 'bg-slate-50'} inline-flex mb-3`}>
        <Icon size={20} className={iconMap[color] || 'text-slate-500'} />
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  )
}

/* ── Supplier Section ── */

function SupplierSection({ title, suppliers, ruleBySupplier, outlets, onSelect, outletName, emptyColor }) {
  if (suppliers.length === 0) return null

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
        {title} ({suppliers.length})
      </h3>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        {suppliers.map(s => {
          const rule = ruleBySupplier[s.id]
          const mode = rule?.allocation_mode
          const meta = mode ? MODE_META[mode] : null
          const colorKey = meta ? meta.color : 'gray'
          const c = COLOR_MAP[colorKey]

          return (
            <button
              key={s.id}
              onClick={() => onSelect(s)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors group"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {s.ragione_sociale || s.name || '—'}
                </div>
                {s.partita_iva && (
                  <div className="text-xs text-gray-400">P.IVA {s.partita_iva}</div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                {rule ? (
                  <>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c.badge}`}>
                      {meta.label}
                    </span>
                    <RuleSummary rule={rule} outletName={outletName} />
                  </>
                ) : (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${COLOR_MAP.gray.badge}`}>
                    Non assegnato
                  </span>
                )}
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 transition-colors" />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Rule Summary (tiny inline) ── */

function RuleSummary({ rule, outletName }) {
  if (!rule?.details || rule.details.length === 0) return null

  if (rule.allocation_mode === 'DIRETTO') {
    const d = rule.details[0]
    return <span className="text-xs text-gray-500 hidden sm:inline">{outletName(d.outlet_id)}</span>
  }
  if (rule.allocation_mode === 'QUOTE_UGUALI') {
    return <span className="text-xs text-gray-500 hidden sm:inline">{rule.details.length} outlet</span>
  }
  if (rule.allocation_mode === 'SPLIT_PCT') {
    return <span className="text-xs text-gray-500 hidden sm:inline">{rule.details.length} outlet</span>
  }
  if (rule.allocation_mode === 'SPLIT_VALORE') {
    const total = rule.details.reduce((s, d) => s + (parseFloat(d.fixed_value) || 0), 0)
    return <span className="text-xs text-gray-500 hidden sm:inline">{fmt(total)} &euro;</span>
  }
  return null
}

/* ────── MODE FORMS ────── */

/* DIRETTO */
function DirettoForm({ outlets, editDetails, setDetailField, outletName }) {
  const selectedId = editDetails.find(d => d.selected)?.outlet_id || null

  const handleSelect = (outletId) => {
    // Deselect all, then select this one
    editDetails.forEach(d => {
      setDetailField(d.outlet_id, 'selected', d.outlet_id === outletId)
    })
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Seleziona l'outlet destinatario</label>
      <div className="space-y-2">
        {outlets.map(o => {
          const active = selectedId === o.id
          return (
            <button
              key={o.id}
              onClick={() => handleSelect(o.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all
                ${active
                  ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-500'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
                }
              `}
            >
              <Store className={`w-5 h-5 ${active ? 'text-blue-600' : 'text-gray-400'}`} />
              <span className={`text-sm font-medium ${active ? 'text-blue-700' : 'text-gray-700'}`}>
                {o.code} — {o.name}
              </span>
              {active && <CheckCircle2 className="w-5 h-5 text-blue-600 ml-auto" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* SPLIT_PCT */
function SplitPctForm({ outlets, editDetails, setDetailField, outletName, pctTotal }) {
  const isValid = Math.abs(pctTotal - 100) <= 0.01

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Percentuali per outlet</label>
      <div className="space-y-2">
        {outlets.map(o => {
          const det = editDetails.find(d => d.outlet_id === o.id)
          const pct = det?.percentage ?? 0
          return (
            <div key={o.id} className="flex items-center gap-3">
              <Store className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-700 w-40 truncate">{o.code} — {o.name}</span>
              <div className="relative flex-1 max-w-[140px]">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={pct || ''}
                  onChange={e => setDetailField(o.id, 'percentage', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                  className="w-full pr-8 pl-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className={`mt-3 flex items-center justify-end gap-2 text-sm font-medium
        ${isValid ? 'text-emerald-600' : 'text-red-600'}`}
      >
        {isValid ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
        Totale: {fmt(pctTotal)}%
      </div>
    </div>
  )
}

/* SPLIT_VALORE */
function SplitValoreForm({ outlets, editDetails, setDetailField, outletName, valTotal }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Importo fisso per outlet (EUR)</label>
      <div className="space-y-2">
        {outlets.map(o => {
          const det = editDetails.find(d => d.outlet_id === o.id)
          const val = det?.fixed_value ?? 0
          return (
            <div key={o.id} className="flex items-center gap-3">
              <Store className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-700 w-40 truncate">{o.code} — {o.name}</span>
              <div className="relative flex-1 max-w-[140px]">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={val || ''}
                  onChange={e => setDetailField(o.id, 'fixed_value', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                  className="w-full pr-8 pl-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  placeholder="0,00"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">&euro;</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-sm font-medium text-amber-700">
        <DollarSign className="w-4 h-4" />
        Totale: {fmt(valTotal)} &euro;
      </div>
    </div>
  )
}

/* QUOTE_UGUALI */
function QuoteUgualiForm({ outlets, editDetails, setDetailField, outletName, selCount, equalShare }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Seleziona gli outlet (divisione uguale)</label>
      <div className="space-y-2">
        {outlets.map(o => {
          const det = editDetails.find(d => d.outlet_id === o.id)
          const checked = det?.selected || false
          return (
            <label
              key={o.id}
              className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all
                ${checked
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
                }
              `}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={e => setDetailField(o.id, 'selected', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              <Store className={`w-4 h-4 ${checked ? 'text-emerald-600' : 'text-gray-400'}`} />
              <span className={`text-sm font-medium ${checked ? 'text-emerald-700' : 'text-gray-700'}`}>
                {o.code} — {o.name}
              </span>
              {checked && (
                <span className="ml-auto text-xs font-medium text-emerald-600">
                  {fmt(equalShare, 1)}%
                </span>
              )}
            </label>
          )
        })}
      </div>
      {selCount > 0 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm font-medium text-emerald-700">
          <Equal className="w-4 h-4" />
          {selCount} outlet selezionati — {fmt(equalShare, 2)}% ciascuno
        </div>
      )}
    </div>
  )
}
