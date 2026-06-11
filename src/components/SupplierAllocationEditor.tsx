import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import {
  Store, Percent, DollarSign, Equal, ArrowRight,
  CheckCircle2, AlertCircle, Loader2, Trash2, Save,
} from 'lucide-react'
import type { Row } from '../types/business'
import Tooltip from './Tooltip'

/**
 * Editor riusabile per la "Divisione tra outlet" di un singolo fornitore.
 *
 * La logica (4 modalità, validazioni, salvataggio su supplier_allocation_rules
 * + supplier_allocation_details) è stata ESTRATTA dal modal della vecchia
 * pagina /allocazione-fornitori (AllocazioneFornitori.tsx) senza modifiche
 * funzionali: stesso schema, stesse regole, stessi salvataggi. Ora vive qui
 * per poter essere montato dentro il pannello "Gestione" di /fornitori.
 */

export type AllocationMode = 'DIRETTO' | 'SPLIT_PCT' | 'SPLIT_VALORE' | 'QUOTE_UGUALI'
type ColorKey = 'blue' | 'purple' | 'amber' | 'emerald' | 'gray'

type OutletLite = Pick<Row<'outlets'>, 'id' | 'code' | 'name' | 'is_active'>
type AllocationRule = Row<'supplier_allocation_rules'>
type AllocationDetail = Row<'supplier_allocation_details'>

interface RuleWithDetails extends AllocationRule {
  details: AllocationDetail[]
}

interface EditDetail {
  outlet_id: string
  percentage: number
  fixed_value: number
  selected: boolean
}

type SetDetailField = <K extends keyof EditDetail>(outletId: string, field: K, value: EditDetail[K]) => void

/* ───────── helpers ───────── */

function fmt(n: number | null | undefined, dec = 2): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(n)
}

interface ModeMeta { label: string; color: ColorKey; icon: typeof ArrowRight; desc: string }
export const MODE_META: Record<AllocationMode, ModeMeta> = {
  DIRETTO:       { label: 'Diretto',        color: 'blue',    icon: ArrowRight,   desc: 'Tutto a un solo outlet' },
  SPLIT_PCT:     { label: 'Split %',        color: 'purple',  icon: Percent,      desc: 'Ripartizione percentuale' },
  SPLIT_VALORE:  { label: 'Split Valore',   color: 'amber',   icon: DollarSign,   desc: 'Importi fissi per outlet' },
  QUOTE_UGUALI:  { label: 'Quote Uguali',   color: 'emerald', icon: Equal,        desc: 'Diviso in parti uguali' },
}

interface ColorTheme { bg: string; border: string; text: string; ring: string; badge: string }
const COLOR_MAP: Record<ColorKey, ColorTheme> = {
  blue:    { bg: 'bg-blue-50',    border: 'border-blue-300',    text: 'text-blue-700',    ring: 'ring-blue-500',    badge: 'bg-blue-100 text-blue-800' },
  purple:  { bg: 'bg-purple-50',  border: 'border-purple-300',  text: 'text-purple-700',  ring: 'ring-purple-500',  badge: 'bg-purple-100 text-purple-800' },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-300',   text: 'text-amber-700',   ring: 'ring-amber-500',   badge: 'bg-amber-100 text-amber-800' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', ring: 'ring-emerald-500', badge: 'bg-emerald-100 text-emerald-800' },
  gray:    { bg: 'bg-gray-50',    border: 'border-gray-300',    text: 'text-gray-500',    ring: 'ring-gray-400',    badge: 'bg-gray-100 text-gray-600' },
}

interface Props {
  supplierId: string
  /** Notifica il parent dopo un salvataggio/cancellazione riuscito.
   *  `mode` è la modalità della regola attiva (null se eliminata). */
  onSaved?: (mode: AllocationMode | null) => void
  /** Se presente, mostra il pulsante "Annulla" che lo invoca. */
  onCancel?: () => void
}

/* ───────── main component ───────── */

export default function SupplierAllocationEditor({ supplierId, onSaved, onCancel }: Props) {
  const { profile } = useAuth()
  const COMPANY_ID = profile?.company_id
  const labels = useCompanyLabels()

  const [outlets, setOutlets]         = useState<OutletLite[]>([])
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const [editMode, setEditMode]       = useState<AllocationMode | null>(null)
  const [editDetails, setEditDetails] = useState<EditDetail[]>([])
  const [existingRule, setExistingRule] = useState<RuleWithDetails | null>(null)

  /* ── data loading: outlet attivi + regola attiva del fornitore ── */

  const loadData = useCallback(async () => {
    if (!COMPANY_ID || !supplierId) return
    setLoading(true)
    setError(null)
    try {
      const [outRes, ruleRes] = await Promise.all([
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
          .eq('supplier_id', supplierId)
          .eq('is_active', true)
          .limit(1),
      ])

      if (outRes.error) throw outRes.error
      if (ruleRes.error) throw ruleRes.error

      const outletsData = (outRes.data || []) as OutletLite[]
      const ruleRow = (ruleRes.data || [])[0] as AllocationRule | undefined

      let rule: RuleWithDetails | null = null
      if (ruleRow) {
        const detRes = await supabase
          .from('supplier_allocation_details')
          .select('id, rule_id, outlet_id, percentage, fixed_value')
          .eq('rule_id', ruleRow.id)
        if (detRes.error) throw detRes.error
        rule = { ...ruleRow, details: (detRes.data || []) as AllocationDetail[] }
      }

      setOutlets(outletsData)
      setExistingRule(rule)
      if (rule) {
        setEditMode(rule.allocation_mode as AllocationMode)
        setEditDetails(outletsData.map(o => {
          const det = rule!.details.find(d => d.outlet_id === o.id)
          return {
            outlet_id: o.id,
            percentage: det?.percentage ?? 0,
            fixed_value: det?.fixed_value ?? 0,
            selected: !!det,
          }
        }))
      } else {
        setEditMode(null)
        setEditDetails(outletsData.map(o => ({
          outlet_id: o.id,
          percentage: 0,
          fixed_value: 0,
          selected: false,
        })))
      }
    } catch (err: unknown) {
      console.error('[SupplierAllocationEditor] load error:', err)
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [COMPANY_ID, supplierId])

  useEffect(() => { loadData() }, [loadData])

  /* ── mode change resets details ── */

  const changeMode = useCallback((mode: AllocationMode) => {
    setEditMode(mode)
    setEditDetails(prev => prev.map(d => ({
      ...d,
      percentage: 0,
      fixed_value: 0,
      // Quote Uguali: auto-seleziona TUTTI gli outlet. Se l'utente vuole
      // escludere qualcuno puo' deselezionare manualmente.
      selected: mode === 'QUOTE_UGUALI',
    })))
  }, [])

  /* ── detail updaters ── */

  const setDetailField = useCallback(<K extends keyof EditDetail>(outletId: string, field: K, value: EditDetail[K]) => {
    setEditDetails(prev => prev.map(d =>
      d.outlet_id === outletId ? { ...d, [field]: value } : d
    ))
  }, [])

  /* ── validation (identica a /allocazione-fornitori) ── */

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
      const total = editDetails.reduce((s, d) => s + (Number(d.percentage) || 0), 0)
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

  /* ── save (identico a /allocazione-fornitori) ── */

  const handleSave = useCallback(async () => {
    if (!validation.valid || !COMPANY_ID || !supplierId) return
    setSaving(true)
    setError(null)
    try {
      // 1. Disattiva la regola esistente se presente
      if (existingRule) {
        const { error: deactErr } = await supabase
          .from('supplier_allocation_rules')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', existingRule.id)
        if (deactErr) throw deactErr
      }

      // 2. Inserisce la nuova regola
      if (!editMode) return
      const { data: newRule, error: ruleErr } = await supabase
        .from('supplier_allocation_rules')
        .insert({
          company_id: COMPANY_ID,
          supplier_id: supplierId,
          allocation_mode: editMode,
          description: MODE_META[editMode]?.label || editMode,
          is_active: true,
        })
        .select('id')
        .single()
      if (ruleErr) throw ruleErr
      if (!newRule) return

      // 3. Costruisce le righe di dettaglio
      type DetailRow = { rule_id: string; outlet_id: string; percentage: number | null; fixed_value: number | null }
      let detailRows: DetailRow[] = []
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
          .filter(d => (Number(d.percentage) || 0) > 0)
          .map(d => ({
            rule_id: newRule.id,
            outlet_id: d.outlet_id,
            percentage: Number(d.percentage) || 0,
            fixed_value: null,
          }))
      } else if (editMode === 'SPLIT_VALORE') {
        detailRows = editDetails
          .filter(d => (Number(d.fixed_value) || 0) > 0)
          .map(d => ({
            rule_id: newRule.id,
            outlet_id: d.outlet_id,
            percentage: null,
            fixed_value: Number(d.fixed_value) || 0,
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

      // 4. Ricarica lo stato locale e notifica il parent
      await loadData()
      onSaved?.(editMode)
    } catch (err: unknown) {
      console.error('[SupplierAllocationEditor] save error:', err)
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [validation, COMPANY_ID, supplierId, existingRule, editMode, editDetails, loadData, onSaved])

  /* ── delete rule (identico a /allocazione-fornitori) ── */

  const handleDelete = useCallback(async () => {
    if (!existingRule) return
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
      onSaved?.(null)
    } catch (err: unknown) {
      console.error('[SupplierAllocationEditor] delete error:', err)
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [existingRule, loadData, onSaved])

  /* ── computed totals ── */

  const pctTotal   = useMemo(() => editDetails.reduce((s, d) => s + (Number(d.percentage) || 0), 0), [editDetails])
  const valTotal   = useMemo(() => editDetails.reduce((s, d) => s + (Number(d.fixed_value) || 0), 0), [editDetails])
  const selCount   = useMemo(() => editDetails.filter(d => d.selected).length, [editDetails])
  const equalShare = useMemo(() => selCount > 0 ? 100 / selCount : 0, [selCount])

  /* ──────────────── RENDER ──────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
        <span className="ml-2 text-sm text-slate-500">Caricamento divisione…</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-2">Modalità di allocazione</label>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(MODE_META) as Array<[AllocationMode, ModeMeta]>).map(([key, meta]) => {
            const c = COLOR_MAP[meta.color]
            const active = editMode === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => changeMode(key)}
                title={meta.desc}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all
                  ${active ? `${c.bg} ${c.border} ${c.text}` : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}
                `}
              >
                {meta.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Mode-specific form */}
      {editMode === 'DIRETTO' && (
        <DirettoForm outlets={outlets} editDetails={editDetails} setDetailField={setDetailField} labelSingular={labels.pointOfSaleLower} />
      )}
      {editMode === 'SPLIT_PCT' && (
        <SplitPctForm outlets={outlets} editDetails={editDetails} setDetailField={setDetailField} pctTotal={pctTotal} labelSingular={labels.pointOfSaleLower} />
      )}
      {editMode === 'SPLIT_VALORE' && (
        <SplitValoreForm outlets={outlets} editDetails={editDetails} setDetailField={setDetailField} valTotal={valTotal} labelSingular={labels.pointOfSaleLower} />
      )}
      {editMode === 'QUOTE_UGUALI' && (
        <QuoteUgualiForm outlets={outlets} editDetails={editDetails} setDetailField={setDetailField} selCount={selCount} equalShare={equalShare} labelPlural={labels.pointOfSalePluralLower} />
      )}

      {/* Validation message */}
      {editMode && !validation.valid && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg p-2.5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {validation.message}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-2.5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <div>
          {existingRule && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Elimina regola
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Annulla
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!validation.valid || saving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salva divisione
          </button>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════
   MODE FORMS (estratte da AllocazioneFornitori, logica identica)
   ════════════════════════════════════════════════════════ */

/* DIRETTO */
function DirettoForm({ outlets, editDetails, setDetailField, labelSingular }: { outlets: OutletLite[]; editDetails: EditDetail[]; setDetailField: SetDetailField; labelSingular: string }) {
  const selectedId = editDetails.find(d => d.selected)?.outlet_id || null

  const handleSelect = (outletId: string) => {
    // Deseleziona tutti, poi seleziona questo
    editDetails.forEach(d => {
      setDetailField(d.outlet_id, 'selected', d.outlet_id === outletId)
    })
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-2">Seleziona il {labelSingular} destinatario</label>
      <div className="space-y-2">
        {outlets.map(o => {
          const active = selectedId === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => handleSelect(o.id)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-lg border-2 text-left transition-all
                ${active ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-500' : 'border-slate-200 hover:border-slate-300 bg-white'}
              `}
            >
              <Store className={`w-4 h-4 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
              <span className={`text-sm font-medium ${active ? 'text-blue-700' : 'text-slate-700'}`}>
                {o.code} — {o.name}
              </span>
              {active && <CheckCircle2 className="w-4 h-4 text-blue-600 ml-auto" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* SPLIT_PCT */
function SplitPctForm({ outlets, editDetails, setDetailField, pctTotal, labelSingular }: { outlets: OutletLite[]; editDetails: EditDetail[]; setDetailField: SetDetailField; pctTotal: number; labelSingular: string }) {
  const isValid = Math.abs(pctTotal - 100) <= 0.01

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-2">Percentuali per {labelSingular}</label>
      <div className="space-y-2">
        {outlets.map(o => {
          const det = editDetails.find(d => d.outlet_id === o.id)
          const pct = det?.percentage ?? 0
          return (
            <div key={o.id} className="flex items-center gap-3">
              <Store className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <Tooltip content={`${o.code} — ${o.name}`}>
                <span className="text-sm text-slate-700 w-40 truncate">{o.code} — {o.name}</span>
              </Tooltip>
              <div className="relative flex-1 max-w-[140px]">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={pct || ''}
                  onChange={e => setDetailField(o.id, 'percentage', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                  className="w-full pr-8 pl-3 py-1.5 border border-slate-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className={`mt-3 flex items-center justify-end gap-2 text-sm font-medium ${isValid ? 'text-emerald-600' : 'text-red-600'}`}>
        {isValid ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
        Totale: {fmt(pctTotal)}%
      </div>
    </div>
  )
}

/* SPLIT_VALORE */
function SplitValoreForm({ outlets, editDetails, setDetailField, valTotal, labelSingular }: { outlets: OutletLite[]; editDetails: EditDetail[]; setDetailField: SetDetailField; valTotal: number; labelSingular: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-2">Importo fisso per {labelSingular} (EUR)</label>
      <div className="space-y-2">
        {outlets.map(o => {
          const det = editDetails.find(d => d.outlet_id === o.id)
          const val = det?.fixed_value ?? 0
          return (
            <div key={o.id} className="flex items-center gap-3">
              <Store className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <Tooltip content={`${o.code} — ${o.name}`}>
                <span className="text-sm text-slate-700 w-40 truncate">{o.code} — {o.name}</span>
              </Tooltip>
              <div className="relative flex-1 max-w-[140px]">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={val || ''}
                  onChange={e => setDetailField(o.id, 'fixed_value', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                  className="w-full pr-8 pl-3 py-1.5 border border-slate-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  placeholder="0,00"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">&euro;</span>
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
function QuoteUgualiForm({ outlets, editDetails, setDetailField, selCount, equalShare, labelPlural }: { outlets: OutletLite[]; editDetails: EditDetail[]; setDetailField: SetDetailField; selCount: number; equalShare: number; labelPlural: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-2">Seleziona gli {labelPlural} (divisione uguale)</label>
      <div className="space-y-2">
        {outlets.map(o => {
          const det = editDetails.find(d => d.outlet_id === o.id)
          const checked = det?.selected || false
          return (
            <label
              key={o.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border-2 cursor-pointer transition-all
                ${checked ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-slate-300 bg-white'}
              `}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={e => setDetailField(o.id, 'selected', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <Store className={`w-4 h-4 ${checked ? 'text-emerald-600' : 'text-slate-400'}`} />
              <span className={`text-sm font-medium ${checked ? 'text-emerald-700' : 'text-slate-700'}`}>
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
