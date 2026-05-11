import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Tab principale BudgetControl — persistito in URL come ?tab=
type BudgetTab = 'bp' | 'confronto'
const VALID_BUDGET_TABS: BudgetTab[] = ['bp', 'confronto']

// Vista confronto Preventivo vs Consuntivo — persistita come ?confView=
type BudgetConfView = 'annuale' | 'mensile'
const VALID_BUDGET_CONF_VIEWS: BudgetConfView[] = ['annuale', 'mensile']
import { useRole } from '../hooks/useRole'
import { usePeriod } from '../hooks/usePeriod'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import PageHelp from '../components/PageHelp'
import {
  Calculator, ChevronDown, ChevronUp,
  Store, Building2, Save, Trash2,
  AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, Target,
  BarChart3, Copy, Lock, Unlock, Info
} from 'lucide-react'
import { supabase } from '../lib/supabase'

// Workflow approvazione preventivo per outlet x anno
type WorkflowStatus = 'bozza' | 'approvato' | 'sbloccato'
interface WorkflowMeta {
  status: WorkflowStatus
  approvedAt?: string | null
  approvedBy?: string | null
  unlockedAt?: string | null
  unlockedBy?: string | null
  unlockReason?: string | null
}
type WorkflowMap = Record<string, WorkflowMeta>  // chiave: cost_center
interface ApprovalLogRow {
  id: string
  cost_center: string
  year: number
  action: string
  actor_email: string | null
  reason: string | null
  rows_affected: number
  created_at: string
}

const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
const MESI_SHORT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const HQ_CODE = 'sede_magazzino'

// Mappa override per code raw -> label leggibile.
// Estendere qui per future label tecniche che non vogliamo mostrare.
const COST_CENTER_LABEL_OVERRIDES = {
  'sede_magazzino': 'Sede / Magazzino',
  'rettifica_bilancio': 'Rettifica bilancio',
  'spese_non_divise': 'Spese non divise',
  'all': 'Tutti',
}

/**
 * Trasforma il label di un cost_center in formato leggibile.
 * - Se ha un override esplicito, usa quello
 * - Se label e' uguale al code (es. 'sede_magazzino' duplicato), pulisce
 * - Altrimenti: title case con sostituzione underscore -> spazio
 */
// TODO: tighten type
function prettyCenterLabel(cc: { code?: string; label?: string; name?: string } | string | null | undefined): string {
  if (!cc) return '—'
  const code = (typeof cc === 'string' ? cc : (cc.code || ''))
  const override = (COST_CENTER_LABEL_OVERRIDES as Record<string, string>)[code]
  if (override) return override
  const raw = typeof cc === 'string' ? cc : (cc.label || cc.name || code)
  if (typeof raw !== 'string') return String(raw)
  // Se la stringa contiene underscore o e' tutto minuscolo "snake_case"
  if (/[_]/.test(raw) || raw === raw.toLowerCase()) {
    return raw
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
  }
  return raw
}

// Fix 13.3: voci di bilancio (account_name) lunghe e tecniche → mappa di
// abbreviazioni leggibili. Il nome completo originale resta sempre
// disponibile come tooltip (title=node.description sulle <span>).
// Estendere qui ogni volta che incontriamo un nuovo account_name lungo.
const ACCOUNT_NAME_ABBREVIATIONS = {
  'Variazione rimanenze materie prime sussidiarie e di consumo': 'Var. rimanenze MP',
  'Variazione rimanenze materie prime, sussidiarie e di consumo': 'Var. rimanenze MP',
  'Variazione rimanenze prodotti finiti': 'Var. rimanenze PF',
  'Variazione rimanenze semilavorati': 'Var. rimanenze SL',
  'Variazione lavori in corso su ordinazione': 'Var. lavori in corso',
  'Variazione delle rimanenze di prodotti in corso di lavorazione, semilavorati e finiti': 'Var. riman. prodotti',
  'Materie prime, sussidiarie, di consumo e merci': 'Materie prime / merci',
  'Materie prime sussidiarie di consumo e merci': 'Materie prime / merci',
  'Acquisti materie prime, sussidiarie, di consumo e merci': 'Acquisti MP / merci',
  'Costi per servizi': 'Servizi',
  'Costi per godimento beni di terzi': 'Godimento beni terzi',
  'Godimento beni di terzi': 'Godimento beni terzi',
  'Salari e stipendi': 'Salari e stipendi',
  'Trattamento di fine rapporto': 'TFR',
  'Trattamento di quiescenza e simili': 'Quiescenza',
  'Altri costi del personale': 'Altri costi pers.',
  'Ammortamenti delle immobilizzazioni immateriali': 'Amm. immat.',
  'Ammortamenti delle immobilizzazioni materiali': 'Amm. mat.',
  'Altre svalutazioni delle immobilizzazioni': 'Svalutaz. immob.',
  'Svalutazione dei crediti compresi nell\'attivo circolante': 'Svalut. crediti',
  'Variazioni delle rimanenze di materie prime, sussidiarie, di consumo e merci': 'Var. rimanenze MP / merci',
  'Accantonamenti per rischi': 'Accant. rischi',
  'Altri accantonamenti': 'Altri accant.',
  'Oneri diversi di gestione': 'Oneri diversi gest.',
  'Proventi e oneri finanziari': 'Proventi/oneri finanz.',
  'Rettifiche di valore di attivita\' finanziarie': 'Rett. attiv. finanz.',
  'Imposte sul reddito dell\'esercizio, correnti, differite e anticipate': 'Imposte esercizio',
}

/**
 * Restituisce un nome compatto per la voce di bilancio se troppo lunga
 * (>30 caratteri). Altrimenti torna il nome originale invariato.
 * Il chiamante DEVE usare title={originale} per il tooltip.
 */
function prettifyAccountName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return name || ''
  const direct = (ACCOUNT_NAME_ABBREVIATIONS as Record<string, string>)[name.trim()]
  if (direct) return direct
  // Match case-insensitive sul testo
  const lower = name.trim().toLowerCase()
  for (const [k, v] of Object.entries(ACCOUNT_NAME_ABBREVIATIONS)) {
    if (k.toLowerCase() === lower) return v
  }
  return name
}

/* ─── Badge workflow per outlet x anno ─────────────────────── */
function WorkflowBadge({ status, meta }: { status: WorkflowStatus; meta?: WorkflowMeta }) {
  if (status === 'bozza') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
        Bozza
      </span>
    )
  }
  if (status === 'approvato') {
    const ts = meta?.approvedAt ? new Date(meta.approvedAt).toLocaleString('it-IT') : ''
    return (
      <span title={`Approvato${ts ? ' il ' + ts : ''}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <Lock size={10} /> Approvato
      </span>
    )
  }
  // sbloccato
  const ts = meta?.unlockedAt ? new Date(meta.unlockedAt).toLocaleString('it-IT') : ''
  const reason = meta?.unlockReason || '—'
  return (
    <span
      title={`Sbloccato${ts ? ' il ' + ts : ''}\nMotivo: ${reason}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
    >
      <Unlock size={10} /> Sbloccato
    </span>
  )
}

/* ─── Dialog conferma approvazione preventivo ──────────────── */
function ApproveDialog({ outletLabel, year, onConfirm, onCancel, working }: { outletLabel: string; year: number; onConfirm: () => void; onCancel: () => void; working: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={working ? undefined : onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-full bg-emerald-50">
            <Lock size={22} className="text-emerald-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Approva preventivo</h3>
            <p className="text-sm text-slate-500">{outletLabel} — anno {year}</p>
          </div>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed">
          Una volta approvato, il preventivo non sarà più modificabile finché non lo sblocchi
          (lo sblocco richiede un motivo che resta tracciato).
        </p>
        <p className="text-xs text-slate-500 mt-2">
          L'azione viene registrata nel log di audit.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button disabled={working} onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50">Annulla</button>
          <button disabled={working} onClick={onConfirm} className="px-4 py-2 text-sm rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 transition disabled:opacity-50 flex items-center gap-2">
            <Lock size={14} /> {working ? 'Approvazione...' : 'Approva preventivo'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Dialog sblocco preventivo (motivo obbligatorio) ─────── */
function UnlockDialog({ outletLabel, year, onConfirm, onCancel, working }: { outletLabel: string; year: number; onConfirm: (reason: string) => void; onCancel: () => void; working: boolean }) {
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()
  const valid = trimmed.length >= 5
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={working ? undefined : onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-full bg-amber-50">
            <Unlock size={22} className="text-amber-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Sblocca preventivo</h3>
            <p className="text-sm text-slate-500">{outletLabel} — anno {year}</p>
          </div>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed mb-3">
          Lo sblocco rende di nuovo modificabile il preventivo. Specifica il motivo (resta nel log di audit).
        </p>
        <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
          Motivo sblocco <span className="text-red-500">*</span>
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          minLength={5}
          required
          placeholder="Es. correzione previsione costi servizi Q2 — allineamento con bilancio"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"
        />
        <p className={`text-[11px] mt-1 ${valid ? 'text-emerald-600' : 'text-slate-400'}`}>
          {trimmed.length}/5 caratteri minimi {valid ? '✓' : ''}
        </p>
        <div className="flex justify-end gap-3 mt-5">
          <button disabled={working} onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50">Annulla</button>
          <button disabled={!valid || working} onClick={() => onConfirm(trimmed)} className="px-4 py-2 text-sm rounded-lg text-white bg-amber-600 hover:bg-amber-700 transition disabled:opacity-50 flex items-center gap-2">
            <Unlock size={14} /> {working ? 'Sblocco...' : 'Sblocca preventivo'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = 'Svuota', destructive = true }: { title: string; message: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string; destructive?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2.5 rounded-full ${destructive ? 'bg-red-50' : 'bg-amber-50'}`}>
            <Trash2 size={22} className={destructive ? 'text-red-600' : 'text-amber-600'} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition">Annulla</button>
          <button onClick={onConfirm} className={`px-4 py-2 text-sm rounded-lg text-white transition ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null || isNaN(n)) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}
function fmtC(n: number | null | undefined) { return n == null || isNaN(n) ? '—' : `${fmt(n, 2)} €` }

function getCodeLevel(code: string | null | undefined) {
  if (!code) return 0
  const len = code.replace(/\s/g, '').length
  if (len <= 2) return 0; if (len <= 4) return 1; if (len <= 6) return 2; return 3
}

type TreeRow = { code: string; description?: string; amount?: number; level: number; [key: string]: unknown }
type TreeNodeT = TreeRow & { children: TreeNodeT[] }

function buildTree(rows: TreeRow[] | null | undefined): TreeNodeT[] {
  if (!rows || !rows.length) return []
  const tree: TreeNodeT[] = []
  const stack: { node: TreeNodeT; level: number }[] = []
  for (const row of rows) {
    const node: TreeNodeT = { ...row, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length === 0) tree.push(node); else stack[stack.length - 1].node.children.push(node)
    stack.push({ node, level: node.level })
  }
  return tree
}

function sumMacros(tree: TreeNodeT[]): number { return tree.reduce<number>((s, n) => s + (n.amount || 0), 0) }

// Apply edits to a tree, recomputing parent sums from edited children
function applyEdits(tree: TreeNodeT[], edits: Record<string, number>): TreeNodeT[] {
  if (!tree || !tree.length) return []
  return tree.map(node => {
    const children = node.children?.length ? applyEdits(node.children, edits) : []
    let amount: number
    if (children.length > 0) {
      amount = children.reduce<number>((s, c) => s + (c.amount || 0), 0)
    } else {
      amount = edits[node.code] != null ? edits[node.code] : (node.amount || 0)
    }
    return { ...node, amount, children }
  })
}

// Variante zero-based: foglie senza edit = 0 (per rettifica, che è solo manuale)
function applyEditsZero(tree: TreeNodeT[], edits: Record<string, number>): TreeNodeT[] {
  if (!tree || !tree.length) return []
  return tree.map(node => {
    const children = node.children?.length ? applyEditsZero(node.children, edits) : []
    let amount: number
    if (children.length > 0) {
      amount = children.reduce<number>((s, c) => s + (c.amount || 0), 0)
    } else {
      const v = edits[node.code]
      amount = (v != null && typeof v === 'number') ? v : 0
    }
    return { ...node, amount, children }
  })
}

// Flatten leaf codes from a tree
function flattenLeaves(tree: TreeNodeT[]): Record<string, number> {
  const result: Record<string, number> = {}
  const walk = (nodes: TreeNodeT[]) => nodes.forEach(n => {
    if (n.children?.length) walk(n.children)
    else result[n.code] = n.amount || 0
  })
  walk(tree)
  return result
}

/* ═══════════════════════════════════════════════════════════
   EDITABLE TREE NODE — always shows input on leaves
   ═══════════════════════════════════════════════════════════ */
function TreeNodeEdit({ node, depth = 0, edits, onEdit }: { node: TreeNodeT; depth?: number; edits: Record<string, number>; onEdit: (code: string, value: number | null) => void }) {
  const [open, setOpen] = useState(false) // start collapsed
  const hasKids = node.children?.length > 0
  const isMacro = node.level === 0
  const isLeaf = !hasKids

  const val = edits[node.code] != null ? edits[node.code] : (node.amount || 0)
  const isEdited = edits[node.code] != null

  return (
    <div>
      <div
        className={`flex items-center py-1 px-1 rounded transition ${hasKids ? 'cursor-pointer hover:bg-slate-50' : ''} ${isMacro ? 'bg-slate-50/80 mt-1' : ''}`}
        style={{ paddingLeft: `${4 + depth * 16}px` }}
        onClick={() => hasKids && setOpen(!open)}
      >
        <span className="w-4 shrink-0 text-center text-[10px] text-slate-400">{hasKids ? (open ? '▾' : '▸') : ''}</span>
        <span className={`font-mono text-slate-400 shrink-0 ml-0.5 ${isMacro ? 'text-[11px] font-bold' : 'text-[10px]'}`}
          style={{ width: node.code?.length > 4 ? '50px' : '26px' }}>{node.code}</span>
        <span
          className={`truncate ml-1 flex-1 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[11px] text-slate-600'}`}
          title={node.description}
        >
          {prettifyAccountName(node.description)}
        </span>
        {isLeaf ? (
          <input type="text" inputMode="numeric"
            value={isEdited ? val : (val || '')}
            onClick={e => e.stopPropagation()}
            onChange={e => {
              const raw = e.target.value.replace(/\./g, '').replace(',', '.')
              onEdit(node.code, parseFloat(raw) || 0)
            }}
            className={`w-24 text-right px-1 py-0.5 text-[11px] border rounded ml-1 tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 ${
              isEdited ? 'bg-indigo-50 border-indigo-300' : 'border-slate-200'
            }`}
            placeholder="0"
          />
        ) : (
          <span className={`tabular-nums text-right shrink-0 ml-1 text-[11px] ${isMacro ? 'font-bold text-slate-900 w-28' : 'text-slate-500 w-24'} ${(node.amount ?? 0) < 0 ? 'text-red-600' : ''}`}>
            {fmt(node.amount)} €
          </span>
        )}
      </div>
      {open && hasKids && node.children.map((c, i) => (
        <TreeNodeEdit key={`${c.code}-${i}`} node={c} depth={depth + 1} edits={edits} onEdit={onEdit} />
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   READ-ONLY TREE NODE
   ═══════════════════════════════════════════════════════════ */
function TreeNodeView({ node, depth = 0 }: { node: TreeNodeT; depth?: number }) {
  const [open, setOpen] = useState(false)
  const hasKids = node.children?.length > 0
  const isMacro = node.level === 0
  return (
    <div>
      <div className={`flex items-center py-1 px-1 rounded transition ${hasKids ? 'cursor-pointer hover:bg-slate-50' : ''} ${isMacro ? 'bg-slate-50' : ''}`}
        style={{ paddingLeft: `${4 + depth * 16}px` }} onClick={() => hasKids && setOpen(!open)}>
        <span className="text-slate-400 w-4 shrink-0 text-center text-[10px]">{hasKids ? (open ? '▾' : '▸') : ''}</span>
        <span className={`font-mono text-slate-400 shrink-0 ${isMacro ? 'text-[11px] font-bold' : 'text-[10px]'}`}
          style={{ width: node.code?.length > 4 ? '50px' : '26px' }}>{node.code}</span>
        <span
          className={`truncate ml-1 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[11px] text-slate-600'}`}
          title={node.description}
        >
          {prettifyAccountName(node.description)}
        </span>
        <span className={`tabular-nums text-right shrink-0 ml-auto ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[10px] text-slate-600'} ${(node.amount ?? 0) < 0 ? 'text-red-600' : ''}`}>
          {fmt(node.amount)} €
        </span>
      </div>
      {open && hasKids && node.children.map((c, i) => <TreeNodeView key={`${c.code}-${i}`} node={c} depth={depth + 1} />)}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   KPI
   ═══════════════════════════════════════════════════════════ */
type KpiColor = 'indigo' | 'blue' | 'green' | 'red' | 'amber' | 'purple'
function Kpi({ icon: Icon, label, value, sub, color = 'indigo', alert }: { icon: React.ComponentType<{ size?: number }>; label: string; value: string | number; sub?: string; color?: KpiColor; alert?: boolean }) {
  const cm: Record<KpiColor, string> = { indigo: 'bg-indigo-50 text-indigo-600', blue: 'bg-blue-50 text-blue-600', green: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600', purple: 'bg-purple-50 text-purple-600' }
  return (
    <div className={`bg-white rounded-xl border p-4 shadow-sm ${alert ? 'border-red-200 ring-1 ring-red-100' : 'border-slate-200'}`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${cm[color]||cm.indigo}`}><Icon size={18} /></div>
        <div className="min-w-0">
          <div className="text-lg font-bold text-slate-900 truncate">{value}</div>
          <div className="text-xs text-slate-500">{label}</div>
          {sub && <div className="text-xs text-slate-400">{sub}</div>}
        </div>
        {alert && <AlertTriangle size={16} className="text-red-500 ml-auto shrink-0" />}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════ */
export default function BudgetControl() {
  const { profile } = useAuth()
  const { hasRole } = useRole()
  const labels = useCompanyLabels()
  const canApproveBudget = hasRole('budget_approver')
  const CID = profile?.company_id
  const { year, quarter, getDateRange } = usePeriod()

  // tab + confView persistiti in URL come ?tab=… e ?confView=…
  // (default: tab=bp, confView=annuale)
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: BudgetTab = VALID_BUDGET_TABS.includes(tabParam as BudgetTab)
    ? (tabParam as BudgetTab)
    : 'bp'
  const setTab = (next: BudgetTab) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', next)
    setSearchParams(params)
  }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [workflow, setWorkflow] = useState<WorkflowMap>({})
  const [approveDialog, setApproveDialog] = useState<{ code: string; label: string } | null>(null)
  const [unlockDialog, setUnlockDialog] = useState<{ code: string; label: string } | null>(null)
  const [workflowBusy, setWorkflowBusy] = useState(false)
  const [toast, setToast] = useState<{ msg: string; t: string } | null>(null)
  const show = (msg: string, t = 'success') => { setToast({ msg, t }); setTimeout(() => setToast(null), 3000) }

  // Data
  type CostCenter = { code: string; label?: string; name?: string; sort_order?: number; [k: string]: unknown }
  type CeRow = TreeRow & { account_code?: string; account_name?: string; macro_group?: string }
  type BudgetEntry = {
    cost_center?: string; account_code?: string; account_name?: string
    budget_amount?: number; actual_amount?: number; month?: number; year?: number; macro_group?: string
    is_approved?: boolean | null
    approved_at?: string | null; approved_by?: string | null
    unlocked_at?: string | null; unlocked_by?: string | null; unlock_reason?: string | null
    [k: string]: unknown
  }
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [ceRawCosti, setCeRawCosti] = useState<CeRow[]>([])
  const [ceRawRicavi, setCeRawRicavi] = useState<CeRow[]>([])
  const [budgetEntries, setBudgetEntries] = useState<BudgetEntry[]>([])

  // Cash-basis data from cash_movements
  type CashByMonth = Record<string, { entrate: number; uscite: number }>
  const [cashTotals, setCashTotals] = useState({ entrate: 0, uscite: 0, netto: 0, count: 0 })
  const [cashByMonth, setCashByMonth] = useState<CashByMonth>({})
  const [cashLoaded, setCashLoaded] = useState(false)

  // BP edits: { outletCode: { accountCode: amount } }
  type EditMap = Record<string, Record<string, number>>
  const [bpEdits, setBpEdits] = useState<EditMap>({})

  // Estrae lo stato workflow per ciascun outlet a partire dai budget_entries.
  // Logica:
  //   - bozza: nessuna riga is_approved=true E nessuna unlocked_at presente
  //   - approvato: ALMENO UNA riga is_approved=true (lock vigente)
  //   - sbloccato: nessuna is_approved=true MA esiste almeno una unlocked_at
  const computeWorkflow = useCallback((entries: BudgetEntry[]): WorkflowMap => {
    const grouped: Record<string, BudgetEntry[]> = {}
    for (const e of entries) {
      const cc = (e.cost_center as string | undefined) || ''
      if (!cc || cc === 'rettifica_bilancio') continue
      if (!grouped[cc]) grouped[cc] = []
      grouped[cc].push(e)
    }
    const out: WorkflowMap = {}
    for (const [cc, rows] of Object.entries(grouped)) {
      const approved = rows.filter(r => r.is_approved === true)
      const unlocked = rows.filter(r => (r.unlocked_at as string | null | undefined))
      if (approved.length > 0) {
        const last = approved.reduce<BudgetEntry | null>((acc, r) => {
          const at = (r.approved_at as string | null | undefined) || ''
          const accAt = (acc?.approved_at as string | null | undefined) || ''
          return at > accAt ? r : acc
        }, null)
        out[cc] = {
          status: 'approvato',
          approvedAt: (last?.approved_at as string | null | undefined) ?? null,
          approvedBy: (last?.approved_by as string | null | undefined) ?? null,
        }
      } else if (unlocked.length > 0) {
        const last = unlocked.reduce<BudgetEntry | null>((acc, r) => {
          const at = (r.unlocked_at as string | null | undefined) || ''
          const accAt = (acc?.unlocked_at as string | null | undefined) || ''
          return at > accAt ? r : acc
        }, null)
        out[cc] = {
          status: 'sbloccato',
          unlockedAt: (last?.unlocked_at as string | null | undefined) ?? null,
          unlockedBy: (last?.unlocked_by as string | null | undefined) ?? null,
          unlockReason: (last?.unlock_reason as string | null | undefined) ?? null,
        }
      } else {
        out[cc] = { status: 'bozza' }
      }
    }
    return out
  }, [])

  // Confronto state
  const [confOutlet, setConfOutlet] = useState('')
  // confView persistito in URL come ?confView=… (default 'annuale')
  const confViewParam = searchParams.get('confView')
  const confView: BudgetConfView = VALID_BUDGET_CONF_VIEWS.includes(confViewParam as BudgetConfView)
    ? (confViewParam as BudgetConfView)
    : 'annuale'
  const setConfView = (next: BudgetConfView) => {
    const params = new URLSearchParams(searchParams)
    params.set('confView', next)
    setSearchParams(params)
  }
  const [consEdits, setConsEdits] = useState<EditMap>({}) // consuntivo edits per outlet
  const [rettEdits, setRettEdits] = useState<EditMap>({}) // rettifiche per outlet
  // Monthly edits: { outletCode: { accountCode: [12 values] } }
  type MonthlyEditMap = Record<string, Record<string, number[]>>
  const [prevMonthly, setPrevMonthly] = useState<MonthlyEditMap>({})   // preventivo costi mensile
  const [revMonthly, setRevMonthly] = useState<MonthlyEditMap>({})     // ricavi previsti mensile
  const [consMonthly, setConsMonthly] = useState<MonthlyEditMap>({})    // consuntivo mensile
  const [rettMonthly, setRettMonthly] = useState<MonthlyEditMap>({})    // rettifica € mensile
  const [rettMonthlyPct, setRettMonthlyPct] = useState<MonthlyEditMap>({}) // rettifica % mensile


  // ─── LOAD CASH MOVEMENTS ─────────────────────────────────
  const loadCashMovements = async () => {
    if (!CID) return
    try {
      const range = getDateRange()
      const { data, error } = await supabase
        .from('cash_movements')
        .select('id, date, type, amount')
        .eq('company_id', CID)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date')

      if (error) throw error

      if (!data || data.length === 0) {
        setCashTotals({ entrate: 0, uscite: 0, netto: 0, count: 0 })
        setCashByMonth({})
        setCashLoaded(true)
        return
      }

      let totalEntrate = 0, totalUscite = 0
      const byMonth: CashByMonth = {}
      data.forEach(row => {
        if (!row.date) return
        const month = new Date(row.date).getMonth() + 1
        const key = String(month)
        if (!byMonth[key]) byMonth[key] = { entrate: 0, uscite: 0 }
        const amt = Math.abs(row.amount || 0)
        if (row.type === 'entrata') {
          totalEntrate += amt
          byMonth[key].entrate += amt
        } else {
          totalUscite += amt
          byMonth[key].uscite += amt
        }
      })

      setCashTotals({ entrate: totalEntrate, uscite: totalUscite, netto: totalEntrate - totalUscite, count: data.length })
      setCashByMonth(byMonth)
      setCashLoaded(true)
    } catch (err: unknown) {
      console.error('Error loading cash movements:', err)
      setCashLoaded(true)
    }
  }

  // ─── LOAD ──────────────────────────────────────────────────
  useEffect(() => { if (CID) loadAll() }, [CID, year, quarter])

  const loadAll = async () => {
    setLoading(true)
    try {
      if (!CID) return
      const cid = CID
      const [ccR, bsR, buR, cfR] = await Promise.all([
        supabase.from('cost_centers').select('*').eq('company_id', cid).eq('is_active', true).order('sort_order'),
        supabase.from('balance_sheet_data').select('*').eq('company_id', cid).eq('year', 2025).in('section', ['ce_costi', 'ce_ricavi']).order('sort_order'),
        supabase.from('budget_entries').select('*').eq('company_id', cid).eq('year', 2026),
        supabase.from('budget_confronto').select('*').eq('company_id', cid).eq('year', year),
      ])
      setCostCenters((ccR.data || []) as CostCenter[])
      const beAll = (buR.data || []) as BudgetEntry[]
      setBudgetEntries(beAll)
      setWorkflow(computeWorkflow(beAll))

      const junk = /Azienda:|Cod\.\s*Fiscale|Partita\s*IVA|^VIA\s|PERIODO\s*DAL|Totali\s*fino|^Pag\.|Considera anche|movimenti provvisori/i
      const clean = (bsR.data || []).filter(r => (r.account_code && r.account_code.trim()) && !junk.test(r.account_name || ''))
      const co: CeRow[] = [], ri: CeRow[] = []
      clean.forEach(r => {
        const row: CeRow = { code: r.account_code||'', description: r.account_name||'', amount: r.amount||0, level: getCodeLevel(r.account_code), isMacro: (r.account_code||'').replace(/\s/g,'').length <= 2 }
        if (r.section === 'ce_costi') co.push(row); else ri.push(row)
      })
      setCeRawCosti(co); setCeRawRicavi(ri)

      // Reconstruct bpEdits from saved budget_entries (escludi rettifiche bilancio)
      const edits: EditMap = {}
      ;((buR.data || []) as BudgetEntry[]).filter(e => e.cost_center !== 'rettifica_bilancio').forEach(e => {
        const cc = e.cost_center || 'all'
        const ac = e.account_code
        if (!ac) return
        if (!edits[cc]) edits[cc] = {}
        edits[cc][ac] = (edits[cc][ac] || 0) + (Number(e.budget_amount) || 0)
      })
      setBpEdits(edits)

      // ─── Reconstruct confronto data from budget_confronto ───
      const newConsEdits: EditMap = {}, newRettEdits: EditMap = {}
      const newPrevM: MonthlyEditMap = {}, newRevM: MonthlyEditMap = {}, newConsM: MonthlyEditMap = {}
      const newRettM: MonthlyEditMap = {}, newRettMP: MonthlyEditMap = {}
      type CfRow = { cost_center?: string | null; account_code?: string | null; amount?: number | null; entry_type?: string | null; month?: number | null; rettifica_amount?: number | null; rettifica_pct?: number | null }
      ;((cfR.data || []) as CfRow[]).forEach(r => {
        const cc = r.cost_center, ac = r.account_code
        if (!cc || !ac) return
        const amt = Number(r.amount) || 0
        if (r.entry_type === 'consuntivo' && r.month === 0) {
          if (!newConsEdits[cc]) newConsEdits[cc] = {}
          newConsEdits[cc][ac] = amt
        } else if (r.entry_type === 'rettifica' && r.month === 0) {
          if (!newRettEdits[cc]) newRettEdits[cc] = {}
          // Per la rettifica annuale preferisco il rettifica_amount se presente, altrimenti amount
          const v = (r.rettifica_amount != null) ? Number(r.rettifica_amount) : amt
          newRettEdits[cc][ac] = v
        } else if (r.entry_type === 'prev_monthly' && (r.month || 0) >= 1) {
          if (!newPrevM[cc]) newPrevM[cc] = {}
          if (!newPrevM[cc][ac]) newPrevM[cc][ac] = Array(12).fill(0)
          newPrevM[cc][ac][(r.month || 1) - 1] = amt
        } else if (r.entry_type === 'rev_monthly' && (r.month || 0) >= 1) {
          if (!newRevM[cc]) newRevM[cc] = {}
          if (!newRevM[cc][ac]) newRevM[cc][ac] = Array(12).fill(0)
          newRevM[cc][ac][(r.month || 1) - 1] = amt
        } else if (r.entry_type === 'cons_monthly' && (r.month || 0) >= 1) {
          if (!newConsM[cc]) newConsM[cc] = {}
          if (!newConsM[cc][ac]) newConsM[cc][ac] = Array(12).fill(0)
          newConsM[cc][ac][(r.month || 1) - 1] = amt
        } else if (r.entry_type === 'rett_monthly' && (r.month || 0) >= 1) {
          if (!newRettM[cc]) newRettM[cc] = {}
          if (!newRettM[cc][ac]) newRettM[cc][ac] = Array(12).fill(0)
          if (!newRettMP[cc]) newRettMP[cc] = {}
          if (!newRettMP[cc][ac]) newRettMP[cc][ac] = Array(12).fill(0)
          const idx = (r.month || 1) - 1
          newRettM[cc][ac][idx] = (r.rettifica_amount != null) ? Number(r.rettifica_amount) : amt
          newRettMP[cc][ac][idx] = (r.rettifica_pct != null) ? Number(r.rettifica_pct) : 0
        }
      })
      setConsEdits(newConsEdits)
      setRettEdits(newRettEdits)
      setPrevMonthly(newPrevM)
      setRevMonthly(newRevM)
      setConsMonthly(newConsM)
      setRettMonthly(newRettM)
      setRettMonthlyPct(newRettMP)

      // Set first outlet with BP data as default for confronto
      const outletCodes = Object.keys(edits).filter(k => k !== 'all' && k !== HQ_CODE)
      if (outletCodes.length > 0 && !confOutlet) setConfOutlet(outletCodes[0])

      // Load cash movements for cassa column
      await loadCashMovements()
    } catch (err: unknown) { console.error(err) } finally { setLoading(false) }
  }

  // ─── TREES ─────────────────────────────────────────────────
  // `ops` = cost_centers che rappresentano punti vendita operativi, ESCLUSI:
  //   - HQ_CODE ('sede_magazzino')  → sede centrale
  //   - 'sede'                       → cost_center sede creato dal wizard onboarding
  //   - 'spese_non_divise'           → riga gap bilancio NZ
  //   - 'rettifica_bilancio'         → riga rettifica magazzino NZ
  // Su Made/Zago appena onboardati il wizard crea 1 cost_center 'sede' +
  // N cost_centers (uno per outlet). Senza l'esclusione di 'sede' il KPI
  // mostrava "2 Outlet operativi" per tenant con 1 outlet reale.
  const NON_OPERATIONAL_CODES = new Set(['sede', HQ_CODE, 'spese_non_divise', 'rettifica_bilancio'])
  const ops = useMemo(
    () => costCenters.filter(cc => !NON_OPERATIONAL_CODES.has(cc.code)),
    [costCenters],
  )
  const hq = useMemo(() => costCenters.find(cc => cc.code === HQ_CODE), [costCenters])
  const costiTree = useMemo(() => buildTree(ceRawCosti), [ceRawCosti])
  const ricaviTree = useMemo(() => buildTree(ceRawRicavi), [ceRawRicavi])
  const hasTree = ceRawCosti.length > 0 || ceRawRicavi.length > 0

  // ─── APPROVE / UNLOCK ──────────────────────────────────────
  const approveOutletYear = async (code: string) => {
    if (!CID) return
    setWorkflowBusy(true)
    try {
      const { data, error } = await supabase.rpc('approve_budget_outlet_year', { p_cost_center: code, p_year: 2026 })
      if (error) throw error
      const n = typeof data === 'number' ? data : 0
      show(n > 0 ? `Preventivo ${code} approvato (${n} righe lockate)` : `Preventivo ${code} già approvato`)
      // Reload entries per riallineare workflow
      const { data: reloaded } = await supabase
        .from('budget_entries').select('*')
        .eq('company_id', CID).eq('year', 2026)
      const beAll = (reloaded || []) as BudgetEntry[]
      setBudgetEntries(beAll)
      setWorkflow(computeWorkflow(beAll))
      setApproveDialog(null)
    } catch (e: unknown) {
      const msg = (e as Error).message || 'Errore approvazione'
      show(`Errore: ${msg}`, 'error')
    } finally {
      setWorkflowBusy(false)
    }
  }

  const unlockOutletYear = async (code: string, reason: string) => {
    if (!CID) return
    setWorkflowBusy(true)
    try {
      const { data, error } = await supabase.rpc('unlock_budget_outlet_year', { p_cost_center: code, p_year: 2026, p_reason: reason })
      if (error) throw error
      const n = typeof data === 'number' ? data : 0
      show(n > 0 ? `Preventivo ${code} sbloccato (${n} righe)` : `Preventivo ${code} già sbloccato`)
      const { data: reloaded } = await supabase
        .from('budget_entries').select('*')
        .eq('company_id', CID).eq('year', 2026)
      const beAll = (reloaded || []) as BudgetEntry[]
      setBudgetEntries(beAll)
      setWorkflow(computeWorkflow(beAll))
      setUnlockDialog(null)
    } catch (e: unknown) {
      const msg = (e as Error).message || 'Errore sblocco'
      show(`Errore: ${msg}`, 'error')
    } finally {
      setWorkflowBusy(false)
    }
  }

  // ─── SAVE BP ───────────────────────────────────────────────
  const saveBP = async (code: string) => {
    setSaving(true)
    try {
      const costEdits = bpEdits[code] || {}
      if (!Object.keys(costEdits).length) { show('Inserisci almeno un costo', 'error'); setSaving(false); return }

      // Unisci: costi editati + ricavi dal bilancio (filtrati per outlet)
      const filteredRicavi = filterRicaviTree(ricaviTree, code)
      const ricaviLeaves = flattenLeaves(filteredRicavi)
      const allEntries = { ...costEdits }
      Object.entries(ricaviLeaves).forEach(([ac, amt]) => { allEntries[ac] = amt })

      const entries = Object.entries(allEntries).map(([ac, amt]) =>
        Array.from({ length: 12 }, (_, i) => ({
          company_id: CID, account_code: ac, account_name: ac, macro_group: 'CE',
          cost_center: code, year: 2026, month: i + 1,
          budget_amount: Math.round((amt as number) / 12), is_approved: false,
        }))
      ).flat()
      const { error } = await supabase.from('budget_entries').upsert(entries as never, { onConflict: 'company_id,account_code,cost_center,year,month' })
      if (error) throw error
      show(`Preventivo ${code} salvato ✓ (${Object.keys(costEdits).length} costi + ${Object.keys(ricaviLeaves).length} ricavi)`)
    } catch (e: unknown) { show((e as Error).message, 'error') } finally { setSaving(false) }
  }

  // ─── SAVE CONFRONTO (annuale + mensile) ────────────────────
  const saveConfronto = async (outletCode: string) => {
    setSaving(true)
    try {
      type CfInsertRow = { company_id: string; cost_center: string; account_code: string; year: number; month: number; entry_type: string; amount: number; rettifica_amount?: number | null; rettifica_pct?: number | null; updated_at: string }
      const rows: CfInsertRow[] = []
      // Annuale: consuntivo
      Object.entries(consEdits[outletCode] || {}).forEach(([ac, amt]) => {
        if (typeof amt === 'number' && amt !== 0 && CID) rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: 0, entry_type: 'consuntivo', amount: amt, updated_at: new Date().toISOString() })
      })
      // Annuale: rettifica (in `amount` per compat lettura, e anche su rettifica_amount)
      Object.entries(rettEdits[outletCode] || {}).forEach(([ac, amt]) => {
        if (typeof amt === 'number' && amt !== 0 && CID) {
          // Calcolo % se preventivo annuale != 0
          const pv = (bpEdits[outletCode] || {})[ac] || 0
          const pct = pv !== 0 ? (amt / pv) * 100 : null
          rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: 0, entry_type: 'rettifica', amount: amt, rettifica_amount: amt, rettifica_pct: pct, updated_at: new Date().toISOString() })
        }
      })
      // Mensile: prev costi
      Object.entries(prevMonthly[outletCode] || {}).forEach(([ac, arr]) => {
        (arr as number[] || []).forEach((v, mi) => {
          if (typeof v === 'number' && v !== 0 && CID) rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: mi + 1, entry_type: 'prev_monthly', amount: v, updated_at: new Date().toISOString() })
        })
      })
      // Mensile: ricavi previsti
      Object.entries(revMonthly[outletCode] || {}).forEach(([ac, arr]) => {
        (arr as number[] || []).forEach((v, mi) => {
          if (typeof v === 'number' && v !== 0 && CID) rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: mi + 1, entry_type: 'rev_monthly', amount: v, updated_at: new Date().toISOString() })
        })
      })
      // Mensile: consuntivo
      Object.entries(consMonthly[outletCode] || {}).forEach(([ac, arr]) => {
        (arr as number[] || []).forEach((v, mi) => {
          if (typeof v === 'number' && v !== 0 && CID) rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: mi + 1, entry_type: 'cons_monthly', amount: v, updated_at: new Date().toISOString() })
        })
      })
      // Mensile: rettifica (€ + %)
      Object.entries(rettMonthly[outletCode] || {}).forEach(([ac, arr]) => {
        const pctArr = (rettMonthlyPct[outletCode] || {})[ac] || []
        const prevArr = (prevMonthly[outletCode] || {})[ac] || []
        ;(arr as number[] || []).forEach((v, mi) => {
          const pctV = pctArr[mi] || 0
          if (((typeof v === 'number' && v !== 0) || (typeof pctV === 'number' && pctV !== 0)) && CID) {
            // Se ho solo % calcolo €; se ho solo € calcolo %
            const prevMonth = prevArr[mi] || 0
            const amount = v !== 0 ? v : (prevMonth * pctV / 100)
            const pct = pctV !== 0 ? pctV : (prevMonth !== 0 ? (amount / prevMonth) * 100 : null)
            rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: mi + 1, entry_type: 'rett_monthly', amount, rettifica_amount: amount, rettifica_pct: pct, updated_at: new Date().toISOString() })
          }
        })
      })

      if (rows.length === 0) { show('Nessun dato da salvare', 'error'); setSaving(false); return }

      // Delete old data for this outlet/year, then insert fresh
      if (!CID) return
      await supabase.from('budget_confronto').delete().eq('company_id', CID).eq('cost_center', outletCode).eq('year', year)
      const { error } = await supabase.from('budget_confronto').insert(rows as never)
      if (error) throw error
      show(`Confronto ${outletCode} salvato ✓ (${rows.length} righe)`)
    } catch (e: unknown) { show((e as Error).message, 'error') } finally { setSaving(false) }
  }

  // ─── MAPPA RICAVI → OUTLET ─────────────────────────────────
  // I sottoconti del Valore della Produzione sono già per outlet:
  // 51010101 "Ricavi vendite Italia" → magazzino, 510107 "Corrispettivi Valdichiana" → valdichiana, ecc.
  const RICAVI_OUTLET_MAP = {
    '51010101': 'sede_magazzino',
    '510107': 'valdichiana',
    '510108': 'barberino',
    '510110': 'franciacorta',
    '510112': 'palmanova',
    '510114': 'brugnato',
    '510122': 'valmontone',
  }

  // Codici corrispettivi outlet (da escludere per gli altri)
  const OUTLET_CORRISP_CODES = new Set(Object.keys(RICAVI_OUTLET_MAP))

  // Filtra l'albero ricavi per outlet:
  // - Outlet: vede SOLO il suo corrispettivo (es. 510107 per Valdichiana). Nient'altro.
  // - Magazzino: vede TUTTO tranne i corrispettivi degli outlet (59, 81, 89 + 510101)
  const filterRicaviTree = (tree: TreeNodeT[], outletCode: string): TreeNodeT[] => {
    const isHQ = outletCode === HQ_CODE
    const walk = (nodes: TreeNodeT[]): TreeNodeT[] => nodes.map((node: TreeNodeT): TreeNodeT | null => {
      if (node.children?.length > 0) {
        const filteredKids = walk(node.children).filter((n): n is TreeNodeT => n !== null)
        if (filteredKids.length === 0) return null
        const amount = filteredKids.reduce<number>((s, c) => s + (c.amount || 0), 0)
        return { ...node, children: filteredKids, amount }
      }
      // Foglia
      if (OUTLET_CORRISP_CODES.has(node.code)) {
        // Corrispettivo outlet-specifico: tieni solo per il suo outlet
        return (RICAVI_OUTLET_MAP as Record<string, string>)[node.code] === outletCode ? node : null
      }
      // Tutti gli altri ricavi (59, 81, 89, ecc.): SOLO magazzino
      return isHQ ? node : null
    }).filter((n): n is TreeNodeT => n !== null)
    return walk(tree)
  }

  // I costi partono SEMPRE da zero — l'operatore compila manualmente
  // I ricavi vengono dal bilancio filtrato per outlet (read-only, auto-salvati con saveBP)

  // ─── CONFIRM DIALOG STATE ────────────────────────────────
  type ConfirmActionT = { title: string; message: string; action: () => void | Promise<void> } | null
  const [confirmAction, setConfirmAction] = useState<ConfirmActionT>(null)

  const clearOutlet = (code: string) => {
    setConfirmAction({
      title: `Svuota Business Plan — ${code}`,
      message: 'Tutti i costi inseriti per questo outlet verranno cancellati da memoria e database.',
      action: async () => {
        if (!CID) return
        setBpEdits(prev => { const next = { ...prev }; delete next[code]; return next })
        await supabase.from('budget_entries').delete().eq('company_id', CID).eq('cost_center', code).eq('year', year)
        show('Dati cancellati da memoria e database')
      }
    })
  }

  const clearAll = () => {
    setConfirmAction({
      title: 'Svuota tutti i Business Plan',
      message: 'Tutti i dati di tutti gli outlet verranno cancellati da memoria e database.',
      action: async () => {
        if (!CID) return
        setBpEdits({})
        await supabase.from('budget_entries').delete().eq('company_id', CID).eq('year', year)
        show('Tutti i dati cancellati da memoria e database')
      }
    })
  }

  // Svuota confronto annuale (consuntivo + rettifica) per outlet — anche da DB
  const clearConfrontoAnnuale = (outletCode: string) => {
    setConfirmAction({
      title: `Svuota Confronto Annuale — ${outletCode}`,
      message: 'Consuntivo e rettifiche annuali verranno cancellati da memoria e database.',
      action: async () => {
        if (!CID) return
        setConsEdits(prev => { const n = { ...prev }; delete n[outletCode]; return n })
        setRettEdits(prev => { const n = { ...prev }; delete n[outletCode]; return n })
        await supabase.from('budget_confronto').delete()
          .eq('company_id', CID).eq('cost_center', outletCode).eq('year', year)
          .in('entry_type', ['consuntivo', 'rettifica'])
        show('Confronto annuale svuotato')
      }
    })
  }

  // Svuota confronto mensile per outlet — anche da DB
  const clearConfrontoMensile = (outletCode: string) => {
    setConfirmAction({
      title: `Svuota Dati Mensili — ${outletCode}`,
      message: 'Costi preventivo, ricavi, consuntivo e rettifiche mensili verranno cancellati da memoria e database.',
      action: async () => {
        if (!CID) return
        setPrevMonthly(prev => { const n = { ...prev }; delete n[outletCode]; return n })
        setRevMonthly(prev => { const n = { ...prev }; delete n[outletCode]; return n })
        setConsMonthly(prev => { const n = { ...prev }; delete n[outletCode]; return n })
        setRettMonthly(prev => { const n = { ...prev }; delete n[outletCode]; return n })
        setRettMonthlyPct(prev => { const n = { ...prev }; delete n[outletCode]; return n })
        await supabase.from('budget_confronto').delete()
          .eq('company_id', CID).eq('cost_center', outletCode).eq('year', year)
          .in('entry_type', ['prev_monthly', 'rev_monthly', 'cons_monthly', 'rett_monthly'])
        show('Dati mensili svuotati')
      }
    })
  }

  // ─── RENDER ────────────────────────────────────────────────
  if (loading) return (
    <div className="p-6 flex items-center justify-center h-96">
      <div className="text-center">
        <div className="animate-spin inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mb-4" />
        <p className="text-slate-600">Caricamento...</p>
      </div>
    </div>
  )

  // Outlets that have saved BP data
  const outletsWithBP = ops.filter(cc => bpEdits[cc.code] && Object.keys(bpEdits[cc.code]).length > 0)

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Calculator className="text-indigo-600" size={28} /> Budget & Controllo
          </h1>
          <p className="text-slate-500 mt-1 text-sm">Business Plan preventivo/consuntivo per {labels.pointOfSaleLower}</p>
        </div>
        <span className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold bg-slate-50">{year}</span>
      </div>

      {/* TABS */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {([{ id:'bp', label:'Business Plan', icon:Target }, { id:'confronto', label:'Preventivo vs Consuntivo', icon:BarChart3 }] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition ${tab===t.id?'bg-white text-indigo-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════
         TAB 1: BUSINESS PLAN
         ════════════════════════════════════════════════════ */}
      {tab === 'bp' && (
        <div className="space-y-6">
          {!canApproveBudget && (
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
              <Info size={18} className="text-blue-600 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-800">
                <strong>Modalità sola lettura.</strong> Stai visualizzando i preventivi approvati per outlet × anno. Per modifiche o nuovi preventivi contatta Lilian (EPPI).
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi icon={Store} label={`${labels.pointOfSalePlural} operativi`} value={ops.length} sub={labels.pointOfSalePluralLower} color="indigo" />
            <Kpi icon={TrendingUp} label="Bilancio 2025" value={hasTree ? `${ceRawCosti.length+ceRawRicavi.length} voci` : 'Non trovato'} color={hasTree?'green':'amber'} />
            <Kpi icon={BarChart3} label="Budget salvati" value={budgetEntries.length} color="blue" />
            <Kpi icon={Target} label="Anno" value={year} color="purple" />
          </div>

          {!hasTree && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800"><strong>Bilancio 2025 non trovato.</strong> Importa dal Conto Economico per la struttura conti.</div>
            </div>
          )}

          {/* Info — visibile solo a chi può approvare/editare */}
          {hasTree && canApproveBudget && (
            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-indigo-800">Compila i costi previsti per ogni {labels.pointOfSaleLower}</p>
                <p className="text-xs text-indigo-600 mt-0.5">I ricavi sono assegnati automaticamente dal bilancio {year - 1}. Inserisci i costi previsti, poi salva e approva il preventivo per lockarlo.</p>
              </div>
              {Object.keys(bpEdits).length > 0 && (
                <button onClick={clearAll} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 flex items-center gap-2 shrink-0">
                  <Trash2 size={14} /> Cancella tutti
                </button>
              )}
            </div>
          )}

          {/* Sede card */}
          {hq && hasTree && (() => {
            const meta = workflow[HQ_CODE]
            const status = meta?.status ?? 'bozza'
            // Vista read-only utenti operativi: mostra solo card approvate/sbloccate (no Bozza)
            if (!canApproveBudget && status === 'bozza') return null
            return (
              <BPCard label={hq.label || HQ_CODE} code={HQ_CODE} isHQ numOps={ops.length}
                costiTree={costiTree} ricaviTree={filterRicaviTree(ricaviTree, HQ_CODE)}
                edits={bpEdits[HQ_CODE]||{}} setEdits={(ed: Record<string, number>) => setBpEdits(p => ({...p,[HQ_CODE]:ed}))}
                onClear={() => clearOutlet(HQ_CODE)}
                onSave={() => saveBP(HQ_CODE)} saving={saving} color="#f59e0b" year={year}
                workflowStatus={status} workflowMeta={meta}
                canApprove={canApproveBudget}
                onApprove={() => setApproveDialog({ code: HQ_CODE, label: hq.label || HQ_CODE })}
                onUnlock={() => setUnlockDialog({ code: HQ_CODE, label: hq.label || HQ_CODE })} />
            )
          })()}

          {/* Outlet cards */}
          {ops.map(cc => {
            const meta = workflow[cc.code]
            const status = meta?.status ?? 'bozza'
            if (!canApproveBudget && status === 'bozza') return null
            return (
              <BPCard key={cc.code} label={prettyCenterLabel(cc)} code={cc.code} isHQ={false} numOps={0}
                costiTree={costiTree} ricaviTree={filterRicaviTree(ricaviTree, cc.code)}
                edits={bpEdits[cc.code]||{}} setEdits={(ed: Record<string, number>) => setBpEdits(p => ({...p,[cc.code]:ed}))}
                onClear={() => clearOutlet(cc.code)}
                onSave={() => saveBP(cc.code)} saving={saving} color={(cc.color as string | undefined)||'#6366f1'} year={year}
                workflowStatus={status} workflowMeta={meta}
                canApprove={canApproveBudget}
                onApprove={() => setApproveDialog({ code: cc.code, label: prettyCenterLabel(cc) })}
                onUnlock={() => setUnlockDialog({ code: cc.code, label: prettyCenterLabel(cc) })} />
            )
          })}
        </div>
      )}

      {/* ════════════════════════════════════════════════════
         TAB 2: PREVENTIVO VS CONSUNTIVO
         ════════════════════════════════════════════════════ */}
      {tab === 'confronto' && (
        <div className="space-y-6">
          {!canApproveBudget && (
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
              <Info size={18} className="text-blue-600 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-800">
                <strong>Modalità sola lettura.</strong> Stai visualizzando il confronto dei preventivi approvati. Per inserire consuntivi/rettifiche contatta Lilian.
              </div>
            </div>
          )}
          {(canApproveBudget ? outletsWithBP : outletsWithBP.filter(cc => (workflow[cc.code]?.status ?? 'bozza') !== 'bozza')).length === 0 ? (
            <div className="text-center py-12 bg-slate-50 rounded-xl">
              <Lock className="mx-auto text-slate-300 mb-3" size={48} />
              <p className="text-slate-500 font-medium">{canApproveBudget ? 'Nessun preventivo creato' : 'Nessun preventivo approvato'}</p>
              <p className="text-sm text-slate-400 mt-1">{canApproveBudget ? 'Crea prima un Business Plan nel tab precedente' : 'I preventivi compaiono qui dopo l\'approvazione di Lilian'}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-slate-600 font-medium">{labels.pointOfSale}:</span>
                <select value={confOutlet} onChange={e => setConfOutlet(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  {(canApproveBudget ? outletsWithBP : outletsWithBP.filter(cc => (workflow[cc.code]?.status ?? 'bozza') !== 'bozza'))
                    .map(cc => <option key={cc.code} value={cc.code}>{prettyCenterLabel(cc)}</option>)}
                </select>
                <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                  {([{k:'annuale',l:'Annuale'},{k:'mensile',l:'Mensile'}] as const).map(v => (
                    <button key={v.k} onClick={() => setConfView(v.k)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${confView===v.k?'bg-white text-indigo-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
                      {v.l}
                    </button>
                  ))}
                </div>
                {canApproveBudget && (
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => confView === 'annuale' ? clearConfrontoAnnuale(confOutlet) : clearConfrontoMensile(confOutlet)}
                      className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 flex items-center gap-1.5">
                      <Trash2 size={14} /> Svuota {confView === 'annuale' ? 'annuale' : 'mensile'}
                    </button>
                    <button onClick={() => saveConfronto(confOutlet)} disabled={saving}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                      <Save size={14} /> {saving ? 'Salvo...' : 'Salva confronto'}
                    </button>
                  </div>
                )}
              </div>
              {confOutlet && confView === 'annuale' && (
                <ConfrontoPanel
                  outletCode={confOutlet}
                  outletLabel={prettyCenterLabel(costCenters.find(c => c.code === confOutlet)) || prettyCenterLabel({ code: confOutlet })}
                  prevEdits={bpEdits[confOutlet] || {}}
                  consEdits={consEdits[confOutlet] || {}}
                  onConsEdit={(code: string, val: number) => setConsEdits(prev => ({...prev, [confOutlet]: {...(prev[confOutlet]||{}), [code]: val}}))}
                  rettEdits={rettEdits[confOutlet] || {}}
                  onRettEdit={(code: string, val: number | string | undefined) => setRettEdits(prev => ({...prev, [confOutlet]: {...(prev[confOutlet]||{}), [code]: (typeof val === 'number' ? val : 0)}}))}
                  costiTree={costiTree}
                  ricaviTree={filterRicaviTree(ricaviTree, confOutlet)}
                  year={year}
                  cashTotals={cashTotals}
                  cashLoaded={cashLoaded}
                />
              )}
              {confOutlet && confView === 'mensile' && (
                <ConfrontoMensile
                  outletCode={confOutlet}
                  outletLabel={prettyCenterLabel(costCenters.find(c => c.code === confOutlet)) || prettyCenterLabel({ code: confOutlet })}
                  costiTree={costiTree}
                  ricaviTree={filterRicaviTree(ricaviTree, confOutlet)}
                  readOnly={!canApproveBudget || (workflow[confOutlet]?.status === 'approvato')}
                  prevMonthly={prevMonthly[confOutlet] || {}}
                  onPrevMonthly={(code: string, month: number, val: number) => setPrevMonthly(prev => {
                    const outlet = { ...(prev[confOutlet] || {}) }
                    const arr = [...(outlet[code] || Array(12).fill(0))]
                    arr[month] = val
                    return { ...prev, [confOutlet]: { ...outlet, [code]: arr } }
                  })}
                  revMonthly={revMonthly[confOutlet] || {}}
                  onRevMonthly={(code: string, month: number, val: number) => setRevMonthly(prev => {
                    const outlet = { ...(prev[confOutlet] || {}) }
                    const arr = [...(outlet[code] || Array(12).fill(0))]
                    arr[month] = val
                    return { ...prev, [confOutlet]: { ...outlet, [code]: arr } }
                  })}
                  consMonthly={consMonthly[confOutlet] || {}}
                  onConsMonthly={(code: string, month: number, val: number) => setConsMonthly(prev => {
                    const outlet = { ...(prev[confOutlet] || {}) }
                    const arr = [...(outlet[code] || Array(12).fill(0))]
                    arr[month] = val
                    return { ...prev, [confOutlet]: { ...outlet, [code]: arr } }
                  })}
                  rettMonthly={rettMonthly[confOutlet] || {}}
                  rettMonthlyPct={rettMonthlyPct[confOutlet] || {}}
                  onRettMonthly={(code, month, amount, pct) => {
                    setRettMonthly(prev => {
                      const outlet = { ...(prev[confOutlet] || {}) }
                      const arr = [...(outlet[code] || Array(12).fill(0))]
                      arr[month] = amount
                      return { ...prev, [confOutlet]: { ...outlet, [code]: arr } }
                    })
                    setRettMonthlyPct(prev => {
                      const outlet = { ...(prev[confOutlet] || {}) }
                      const arr = [...(outlet[code] || Array(12).fill(0))]
                      arr[month] = pct
                      return { ...prev, [confOutlet]: { ...outlet, [code]: arr } }
                    })
                  }}
                  year={year}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* CONFIRM DIALOG */}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          onConfirm={() => { confirmAction.action(); setConfirmAction(null) }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* APPROVE DIALOG */}
      {approveDialog && (
        <ApproveDialog
          outletLabel={approveDialog.label}
          year={2026}
          working={workflowBusy}
          onCancel={() => { if (!workflowBusy) setApproveDialog(null) }}
          onConfirm={() => approveOutletYear(approveDialog.code)}
        />
      )}

      {/* UNLOCK DIALOG */}
      {unlockDialog && (
        <UnlockDialog
          outletLabel={unlockDialog.label}
          year={2026}
          working={workflowBusy}
          onCancel={() => { if (!workflowBusy) setUnlockDialog(null) }}
          onConfirm={(reason) => unlockOutletYear(unlockDialog.code, reason)}
        />
      )}

      {/* TOAST */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.t==='error'?'bg-red-600 text-white':'bg-emerald-600 text-white'}`}>
          {toast.t==='error' ? <AlertTriangle size={16}/> : <CheckCircle2 size={16}/>} {toast.msg}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   BP CARD — Per outlet, struttura CE editabile
   ═══════════════════════════════════════════════════════════ */
type BPCardProps = {
  label: string; code: string; isHQ: boolean; numOps: number
  costiTree: TreeNodeT[]; ricaviTree: TreeNodeT[]
  edits: Record<string, number>; setEdits: (ed: Record<string, number>) => void
  onClear: () => void; onSave: () => void | Promise<void>; saving: boolean
  color: string; year: number
  workflowStatus: WorkflowStatus
  workflowMeta?: WorkflowMeta
  canApprove: boolean
  onApprove: () => void
  onUnlock: () => void
}
function BPCard({ label, code, isHQ, numOps: _numOps, costiTree, ricaviTree, edits, setEdits, onClear, onSave, saving, color, year, workflowStatus, workflowMeta, canApprove, onApprove, onUnlock }: BPCardProps) {
  const [open, setOpen] = useState(false)

  const isLocked = workflowStatus === 'approvato'
  // Lettura sola = non può approvare OPPURE preventivo già lockato
  const readOnly = !canApprove || isLocked

  // COSTI: partono da ZERO, l'operatore compila manualmente
  const editedC = applyEditsZero(costiTree, edits)
  // RICAVI: dal bilancio, read-only (già filtrati per outlet)
  const totC = sumMacros(editedC)
  const totR = sumMacros(ricaviTree)
  const ris = totR - totC
  const hasEdits = Object.keys(edits).length > 0

  const onEdit = (ac: string, val: number | null) => {
    if (readOnly) return
    setEdits({ ...edits, [ac]: val ?? 0 })
  }

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
      isLocked ? 'border-emerald-200' : workflowStatus === 'sbloccato' ? 'border-amber-200' : isHQ ? 'border-amber-200' : 'border-slate-200'
    }`}>
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50/50 transition" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3">
          {isHQ ? <Building2 size={16} className="text-amber-500" /> : <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />}
          <div>
            <div className="font-semibold text-slate-900 flex items-center gap-2">
              {label}
              <WorkflowBadge status={workflowStatus} meta={workflowMeta} />
            </div>
            <div className="text-xs text-slate-400">{code} {hasEdits ? <span className="text-indigo-500 ml-1">● costi inseriti</span> : <span className="text-slate-300 ml-1">○ costi da compilare</span>}</div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right"><div className="text-xs text-slate-400">Ricavi (bilancio)</div><div className="font-semibold text-emerald-600">{fmtC(totR)}</div></div>
          <div className="text-right"><div className="text-xs text-slate-400">Costi (preventivo)</div><div className="font-semibold text-red-600">{fmtC(totC)}</div></div>
          {!isHQ && <div className="text-right"><div className="text-xs text-slate-400">Risultato</div><div className={`font-bold ${ris>=0?'text-emerald-700':'text-red-700'}`}>{fmtC(ris)}</div></div>}
          {open ? <ChevronUp size={18} className="text-slate-400"/> : <ChevronDown size={18} className="text-slate-400"/>}
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-100 px-5 py-4">
          {isLocked && (
            <div className="mb-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-xs text-emerald-800">
              <Lock size={14} className="text-emerald-600 shrink-0" />
              <span>
                Preventivo approvato{workflowMeta?.approvedAt ? ` il ${new Date(workflowMeta.approvedAt).toLocaleString('it-IT')}` : ''}.
                {' '}{canApprove ? 'Sblocca per modificare.' : 'Per modifiche contatta Lilian.'}
              </span>
            </div>
          )}
          {workflowStatus === 'sbloccato' && workflowMeta && (
            <div className="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <div className="flex items-center gap-2 font-medium"><Unlock size={14} /> Preventivo sbloccato dopo approvazione</div>
              {workflowMeta.unlockReason && <div className="mt-1 italic">Motivo: {workflowMeta.unlockReason}</div>}
            </div>
          )}
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-slate-500">
              {readOnly ? 'Visualizzazione preventivo' : 'Compila i costi previsti'} — i ricavi vengono dal bilancio {year - 1}
            </p>
            <div className="flex items-center gap-2">
              {/* Bottoni di edit visibili solo se l'utente può approvare E il preventivo non è lockato */}
              {canApprove && !isLocked && (
                <>
                  {hasEdits && (
                    <button onClick={onClear} className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 flex items-center gap-1.5">
                      <Trash2 size={12} /> Cancella costi
                    </button>
                  )}
                  <button onClick={onSave} disabled={saving} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                    <Save size={14} /> {saving ? 'Salvo...' : 'Salva'}
                  </button>
                </>
              )}
              {/* Bottone Approva: solo budget_approver + status=Bozza/Sbloccato */}
              {canApprove && !isLocked && hasEdits && (
                <button onClick={onApprove}
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 flex items-center gap-1.5">
                  <Lock size={14} /> Approva preventivo
                </button>
              )}
              {/* Bottone Sblocca: solo budget_approver + status=Approvato */}
              {canApprove && isLocked && (
                <button onClick={onUnlock}
                  className="px-4 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 flex items-center gap-1.5">
                  <Unlock size={14} /> Sblocca preventivo
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* COSTI — editabili o lockati a seconda di readOnly */}
            <div>
              <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                Componenti Negative {readOnly ? <Lock size={11} className="text-slate-400" /> : '(da compilare)'}
              </div>
              <div className={`border border-slate-200 rounded-lg p-1.5 max-h-[500px] overflow-y-auto ${readOnly ? 'bg-slate-50/40' : ''}`}>
                {readOnly
                  ? editedC.map((n, i) => <TreeNodeView key={`${n.code}-${i}`} node={n} />)
                  : editedC.map((n, i) => <TreeNodeEdit key={`${n.code}-${i}`} node={n} edits={edits} onEdit={onEdit} />)}
              </div>
              <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                <span className="text-sm font-bold">TOTALE COSTI</span>
                <span className="text-sm font-bold text-red-600">{fmtC(totC)}</span>
              </div>
            </div>
            {/* RICAVI — read-only dal bilancio */}
            <div>
              <div className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-2">Componenti Positive (da bilancio)</div>
              <div className="border border-emerald-100 bg-emerald-50/30 rounded-lg p-1.5 max-h-[500px] overflow-y-auto">
                {ricaviTree.map((n, i) => <TreeNodeView key={`${n.code}-${i}`} node={n} />)}
              </div>
              <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                <span className="text-sm font-bold">TOTALE RICAVI</span>
                <span className="text-sm font-bold text-emerald-600">{fmtC(totR)}</span>
              </div>
            </div>
          </div>
          {!isHQ && (
            <div className={`mt-3 p-3 rounded-lg text-center font-bold text-sm ${ris>=0?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700'}`}>
              {ris>=0?'Utile':'Perdita'}: {fmtC(Math.abs(ris))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   CONFRONTO MENSILE — Albero CE con selettore mese + copia
   ═══════════════════════════════════════════════════════════ */

function CopyMonthPopover({ fromMonth, onCopy, onClose }: { fromMonth: number; onCopy: (selMonths: boolean[]) => void; onClose: () => void }) {
  const [sel, setSel] = useState<boolean[]>(Array(12).fill(false))
  const toggle = (i: number) => setSel(p => { const n = [...p]; n[i] = !n[i]; return n })
  const allSel = sel.every((v, i) => i === fromMonth || v)
  const toggleAll = () => setSel(Array(12).fill(!allSel).map((v, i) => i === fromMonth ? false : v))
  const count = sel.filter(Boolean).length

  return (
    <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-xl p-3 w-56"
      onClick={e => e.stopPropagation()}>
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
        Copia {MESI_SHORT[fromMonth]} in:
      </div>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {MESI_SHORT.map((m, i) => (
          <button key={i} disabled={i === fromMonth}
            onClick={() => toggle(i)}
            className={`px-1.5 py-1 text-[10px] rounded transition ${
              i === fromMonth ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed font-bold' :
              sel[i] ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}>
            {m}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 pt-2">
        <button onClick={toggleAll} className="text-[10px] text-indigo-600 hover:underline">
          {allSel ? 'Deseleziona tutti' : 'Seleziona tutti'}
        </button>
        <div className="flex gap-1.5">
          <button onClick={onClose} className="px-2 py-1 text-[10px] rounded border border-slate-200 text-slate-500 hover:bg-slate-50">Annulla</button>
          <button onClick={() => { onCopy(sel); onClose() }} disabled={count === 0}
            className="px-2 py-1 text-[10px] rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            Copia ({count})
          </button>
        </div>
      </div>
    </div>
  )
}

type MonthlyTreeNodeProps = {
  node: TreeNodeT; depth?: number
  prevByCode: Record<string, number>; consByCode: Record<string, number>
  rettAmtByCode: Record<string, number>; rettPctByCode: Record<string, number>
  onPrev: (code: string, val: number) => void
  onCons: (code: string, val: number) => void
  onRett: (code: string, amount: number, pct: number) => void
  mese: number  // -1 = Anno
  monthly: MonthlyMap
  onCopyToMonths: (code: string, mi: number, val: number) => void
  readOnly?: boolean
}
// Props grid: code | descrizione | Prev | Cons | Rett € | Rett % | Scost | %dev | (copy)
const MONTHLY_COLS = '20px 60px 1fr 80px 80px 70px 60px 70px 55px 24px'

function MonthlyTreeNode({ node, depth = 0, prevByCode, consByCode, rettAmtByCode, rettPctByCode, onPrev, onCons, onRett, mese, monthly, onCopyToMonths, readOnly }: MonthlyTreeNodeProps) {
  const [open, setOpen] = useState(false)
  const [showCopy, setShowCopy] = useState(false)
  const hasKids = node.children?.length > 0
  const isMacro = node.level === 0
  const isLeaf = !hasKids
  const isAnnualView = mese === -1

  const pv = isLeaf ? (prevByCode[node.code] ?? 0) : (node.amount || 0)
  const cv = isLeaf ? (consByCode[node.code] ?? 0) : sumDescendants(node, consByCode)
  const ra = isLeaf ? (rettAmtByCode[node.code] ?? 0) : sumDescendants(node, rettAmtByCode)
  const rp = isLeaf ? (rettPctByCode[node.code] ?? 0) : (pv !== 0 ? (ra / pv) * 100 : 0)
  const delta = cv + ra - pv
  const pctDev = pv !== 0 ? (delta / Math.abs(pv)) * 100 : (delta !== 0 ? 100 : 0)

  const collectLeaves = (n: TreeNodeT): string[] => !n.children?.length ? [n.code] : n.children.flatMap(collectLeaves)

  const handleCopy = (selMonths: boolean[]) => {
    if (isAnnualView) return
    const codes = collectLeaves(node)
    codes.forEach(code => {
      const srcVal = monthly[code]?.[mese] || 0
      if (srcVal) selMonths.forEach((checked, mi) => { if (checked) onCopyToMonths(code, mi, srcVal) })
    })
  }
  const hasValueToCopy = !isAnnualView && (() => {
    const codes = collectLeaves(node)
    return codes.some(c => monthly[c]?.[mese])
  })()

  // Badge color per pctDev
  const pctBadgeClass = (() => {
    const abs = Math.abs(pctDev)
    if (delta === 0) return 'text-slate-400'
    if (abs <= 5) return 'text-emerald-600 font-medium'
    if (abs <= 15) return 'text-amber-600 font-medium'
    return 'text-red-600 font-bold'
  })()

  return (
    <div>
      <div className={`grid items-center py-1 px-1 rounded transition ${hasKids ? 'cursor-pointer hover:bg-slate-50' : ''} ${isMacro ? 'bg-slate-50/80 mt-1' : ''}`}
        style={{ gridTemplateColumns: MONTHLY_COLS, paddingLeft: `${4 + depth * 12}px` }}
        onClick={() => hasKids && setOpen(!open)}>
        <span className="text-[10px] text-slate-400 text-center">{hasKids ? (open ? '▾' : '▸') : ''}</span>
        <span className={`font-mono text-slate-400 ${isMacro ? 'text-[10px] font-bold' : 'text-[9px]'}`}>{node.code}</span>
        <span className={`truncate min-w-0 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[10px] text-slate-600'}`} title={node.description}>
          {prettifyAccountName(node.description)}
        </span>
        {/* Preventivo */}
        {isLeaf && !readOnly && !isAnnualView ? (
          <input type="text" inputMode="numeric"
            value={pv || ''}
            onClick={e => e.stopPropagation()}
            onChange={e => { const raw = e.target.value.replace(/\./g, '').replace(',', '.'); onPrev(node.code, parseFloat(raw) || 0) }}
            className="text-right px-1 py-0.5 text-[10px] border rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 border-slate-200"
            placeholder="0" />
        ) : (
          <span className={`tabular-nums text-right text-[10px] ${isMacro ? 'font-bold text-indigo-700' : 'text-indigo-500'}`}>{fmt(pv)}</span>
        )}
        {/* Consuntivo */}
        {isLeaf && !readOnly && !isAnnualView ? (
          <input type="text" inputMode="numeric"
            value={cv || ''}
            onClick={e => e.stopPropagation()}
            onChange={e => { const raw = e.target.value.replace(/\./g, '').replace(',', '.'); onCons(node.code, parseFloat(raw) || 0) }}
            className="text-right px-1 py-0.5 text-[10px] border rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400 border-slate-200"
            placeholder="0" />
        ) : (
          <span className={`tabular-nums text-right text-[10px] ${isMacro ? 'font-bold text-emerald-700' : 'text-emerald-600'}`}>{fmt(cv)}</span>
        )}
        {/* Rettifica € (bidirezionale: scrivendo € ricalcola %) */}
        {isLeaf && !readOnly && !isAnnualView ? (
          <input type="text" inputMode="numeric"
            value={ra || ''}
            onClick={e => e.stopPropagation()}
            onChange={e => {
              const raw = e.target.value.replace(/\./g, '').replace(',', '.')
              const amount = parseFloat(raw) || 0
              const pct = pv !== 0 ? (amount / pv) * 100 : 0
              onRett(node.code, amount, pct)
            }}
            className="text-right px-1 py-0.5 text-[10px] border rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-purple-400 border-slate-200"
            placeholder="±0" />
        ) : (
          <span className={`tabular-nums text-right text-[10px] ${isMacro ? 'font-bold text-purple-700' : 'text-purple-500'}`}>{ra !== 0 ? fmt(ra) : '—'}</span>
        )}
        {/* Rettifica % (bidirezionale: scrivendo % ricalcola €) */}
        {isLeaf && !readOnly && !isAnnualView ? (
          <input type="text" inputMode="decimal"
            value={rp ? rp.toFixed(2) : ''}
            onClick={e => e.stopPropagation()}
            onChange={e => {
              const raw = e.target.value.replace(/\./g, '').replace(',', '.')
              const pct = parseFloat(raw) || 0
              const amount = pv !== 0 ? (pv * pct / 100) : 0
              onRett(node.code, amount, pct)
            }}
            className="text-right px-1 py-0.5 text-[10px] border rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-purple-400 border-slate-200"
            placeholder="±0%" />
        ) : (
          <span className={`tabular-nums text-right text-[10px] ${isMacro ? 'font-bold text-purple-700' : 'text-purple-500'}`}>{rp !== 0 ? `${rp.toFixed(1)}%` : '—'}</span>
        )}
        {/* Scostamento (cons + rett - prev) */}
        <span className={`tabular-nums text-right text-[10px] font-medium ${delta > 0 ? 'text-red-600' : delta < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
          {delta !== 0 ? `${delta > 0 ? '+' : ''}${fmt(delta)}` : '—'}
        </span>
        {/* % dev */}
        <span className={`tabular-nums text-right text-[10px] ${pctBadgeClass}`}>
          {pv !== 0 && delta !== 0 ? `${pctDev > 0 ? '+' : ''}${pctDev.toFixed(1)}%` : ''}
        </span>
        {/* Copy */}
        {hasValueToCopy ? (
          <div className="relative">
            <button onClick={e => { e.stopPropagation(); setShowCopy(!showCopy) }}
              title="Copia in altri mesi"
              className="p-0.5 rounded hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600 transition">
              <Copy size={11} />
            </button>
            {showCopy && <CopyMonthPopover fromMonth={mese} onCopy={handleCopy} onClose={() => setShowCopy(false)} />}
          </div>
        ) : <span />}
      </div>
      {open && hasKids && node.children.map((c, i) => (
        <MonthlyTreeNode key={`${c.code}-${i}`} node={c} depth={depth + 1}
          prevByCode={prevByCode} consByCode={consByCode}
          rettAmtByCode={rettAmtByCode} rettPctByCode={rettPctByCode}
          onPrev={onPrev} onCons={onCons} onRett={onRett}
          mese={mese} monthly={monthly} onCopyToMonths={onCopyToMonths}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}

// Somma valori delle foglie discendenti (usata per macro readonly su Cons/Rett)
function sumDescendants(node: TreeNodeT, byCode: Record<string, number>): number {
  if (!node.children?.length) return byCode[node.code] ?? 0
  return node.children.reduce<number>((s, c) => s + sumDescendants(c, byCode), 0)
}

type MonthlyMap = Record<string, number[]>
type ConfrontoMensileProps = {
  outletCode: string; outletLabel: string
  costiTree: TreeNodeT[]; ricaviTree: TreeNodeT[]
  readOnly: boolean
  prevMonthly: MonthlyMap; onPrevMonthly: (code: string, month: number, val: number) => void
  revMonthly: MonthlyMap; onRevMonthly: (code: string, month: number, val: number) => void
  consMonthly: MonthlyMap; onConsMonthly: (code: string, month: number, val: number) => void
  rettMonthly: MonthlyMap; rettMonthlyPct: MonthlyMap
  onRettMonthly: (code: string, month: number, amount: number, pct: number) => void
  year: number
}
function ConfrontoMensile({
  outletCode: _outletCode, outletLabel,
  costiTree, ricaviTree,
  readOnly,
  prevMonthly, onPrevMonthly,
  revMonthly, onRevMonthly,
  consMonthly, onConsMonthly,
  rettMonthly, rettMonthlyPct,
  onRettMonthly,
  year,
}: ConfrontoMensileProps) {
  // mese: -1 = Anno (somma 12 mesi), 0..11 = mese specifico
  const [mese, setMese] = useState<number>(0)
  const isAnnualView = mese === -1

  // Estrae i dati per il mese selezionato (o somma annuale)
  const pickByMonth = (m: MonthlyMap): Record<string, number> => {
    const out: Record<string, number> = {}
    Object.entries(m).forEach(([code, arr]) => {
      if (!arr) return
      if (isAnnualView) out[code] = arr.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0)
      else if (arr[mese]) out[code] = arr[mese]
    })
    return out
  }
  const pickPctByMonth = (m: MonthlyMap, amounts: Record<string, number>, prevs: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {}
    Object.keys(m).forEach(code => {
      const arr = m[code]
      if (!arr) return
      if (isAnnualView) {
        const pv = prevs[code] ?? 0
        const ra = amounts[code] ?? 0
        out[code] = pv !== 0 ? (ra / pv) * 100 : 0
      } else {
        if (arr[mese] != null) out[code] = arr[mese] || 0
      }
    })
    return out
  }

  const prevByCode = pickByMonth(prevMonthly)
  const revByCode = pickByMonth(revMonthly)
  const consByCode = pickByMonth(consMonthly)
  const rettAmtByCode = pickByMonth(rettMonthly)
  const rettPctByCode = pickPctByMonth(rettMonthlyPct, rettAmtByCode, prevByCode)

  const editedC = applyEditsZero(costiTree, prevByCode)
  const editedR = applyEditsZero(ricaviTree, revByCode)
  const totC = sumMacros(editedC)
  const totR = sumMacros(editedR)
  const totConsC = Object.entries(consByCode).filter(([code]) => isLeafCode(code, costiTree)).reduce((s, [, v]) => s + v, 0)
  const totConsR = Object.entries(consByCode).filter(([code]) => isLeafCode(code, ricaviTree)).reduce((s, [, v]) => s + v, 0)
  const totRettC = Object.entries(rettAmtByCode).filter(([code]) => isLeafCode(code, costiTree)).reduce((s, [, v]) => s + v, 0)
  const totRettR = Object.entries(rettAmtByCode).filter(([code]) => isLeafCode(code, ricaviTree)).reduce((s, [, v]) => s + v, 0)
  const scostC = totConsC + totRettC - totC
  const scostR = totConsR + totRettR - totR
  const ris = totR - totC
  const risCons = (totConsR + totRettR) - (totConsC + totRettC)
  const scostTot = risCons - ris

  // Annual totals (always shown for context, indipendenti dalla vista mese)
  const annualC = (() => { let t = 0; Object.values(prevMonthly).forEach(arr => arr?.forEach(v => { t += (typeof v === 'number' ? v : 0) })); return t })()
  const annualR = (() => { let t = 0; Object.values(revMonthly).forEach(arr => arr?.forEach(v => { t += (typeof v === 'number' ? v : 0) })); return t })()

  const labelMese = isAnnualView ? `Anno ${year}` : MESI[mese]

  return (
    <div className="space-y-6">
      {/* KPI scostamento mensile/annuale */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={Lock} label={`Preventivo ${labelMese}`} value={fmtC(ris)} color={ris >= 0 ? 'green' : 'red'} />
        <Kpi icon={Unlock} label={`Cons.+Rett. ${labelMese}`} value={fmtC(risCons)} color={risCons >= 0 ? 'green' : 'red'} />
        <Kpi icon={TrendingDown} label="Scost. costi" value={totC > 0 ? `${(scostC / totC * 100).toFixed(1)}%` : '—'} sub={fmtC(scostC)} color={scostC > 0 ? 'red' : 'green'} />
        <Kpi icon={TrendingUp} label="Scost. ricavi" value={totR > 0 ? `${(scostR / totR * 100).toFixed(1)}%` : '—'} sub={fmtC(scostR)} color={scostR >= 0 ? 'green' : 'red'} />
        <Kpi icon={Target} label="Δ Risultato" value={fmtC(scostTot)} color={scostTot >= 0 ? 'green' : 'red'} alert={Math.abs(scostTot) > Math.abs(ris) * 0.15} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-700">{outletLabel} — Vista Mensile {year}</h3>
          <div className="flex gap-2 text-xs items-center">
            <span className="text-slate-500">Totale anno: Costi {fmtC(annualC)} — Ricavi {fmtC(annualR)}</span>
          </div>
        </div>

        {/* MONTH SELECTOR + Anno solare */}
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="flex gap-1 flex-wrap items-center">
            <button onClick={() => setMese(-1)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${
                isAnnualView ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              Anno solare
            </button>
            <span className="text-slate-300 mx-1">|</span>
            {MESI.map((m, i) => {
              const hasCData = Object.values(prevMonthly).some(arr => arr && arr[i])
              const hasRData = Object.values(revMonthly).some(arr => arr && arr[i])
              const hasCons = Object.values(consMonthly).some(arr => arr && arr[i])
              const hasRett = Object.values(rettMonthly).some(arr => arr && arr[i])
              const hasData = hasCData || hasRData || hasCons || hasRett
              return (
                <button key={i} onClick={() => setMese(i)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition relative ${
                    mese === i ? 'bg-indigo-600 text-white shadow-sm' : hasData ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {m}
                  {hasData && mese !== i && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                </button>
              )
            })}
          </div>
          {isAnnualView && (
            <p className="text-[11px] text-slate-500 mt-2 italic">Vista annuale: somma dei 12 mesi. Per modificare i valori passa al singolo mese.</p>
          )}
        </div>

        {/* Header colonne */}
        <div className="px-3 py-2 border-b border-slate-100 grid bg-slate-50/60 text-[9px] font-semibold uppercase tracking-wider text-slate-500"
          style={{ gridTemplateColumns: MONTHLY_COLS }}>
          <span></span>
          <span>Cod.</span>
          <span>Voce</span>
          <span className="text-right text-indigo-500">Prev. {labelMese}</span>
          <span className="text-right text-emerald-500">Cons.</span>
          <span className="text-right text-purple-500">Rett. €</span>
          <span className="text-right text-purple-500">Rett. %</span>
          <span className="text-right text-amber-500">Scost.</span>
          <span className="text-right text-amber-500">% dev.</span>
          <span></span>
        </div>

        {/* CE — COSTI */}
        <div className="p-3 border-b border-slate-100">
          <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">Componenti Negative — {labelMese}</div>
          <div className="border border-slate-200 rounded-lg p-1.5 max-h-[420px] overflow-y-auto">
            {editedC.map((n, i) => (
              <MonthlyTreeNode key={`mc-${n.code}-${i}-${mese}`} node={n}
                prevByCode={prevByCode} consByCode={consByCode}
                rettAmtByCode={rettAmtByCode} rettPctByCode={rettPctByCode}
                onPrev={(code, val) => !isAnnualView && onPrevMonthly(code, mese, val)}
                onCons={(code, val) => !isAnnualView && onConsMonthly(code, mese, val)}
                onRett={(code, amount, pct) => !isAnnualView && onRettMonthly(code, mese, amount, pct)}
                mese={mese} monthly={prevMonthly} onCopyToMonths={onPrevMonthly}
                readOnly={readOnly}
              />
            ))}
          </div>
          <div className="mt-2 pt-2 border-t-2 border-slate-300 grid font-bold text-[11px]" style={{ gridTemplateColumns: MONTHLY_COLS }}>
            <span></span><span></span>
            <span className="text-slate-700">TOTALE COSTI</span>
            <span className="text-right text-indigo-700 tabular-nums">{fmt(totC)}</span>
            <span className="text-right text-emerald-700 tabular-nums">{fmt(totConsC)}</span>
            <span className="text-right text-purple-700 tabular-nums">{totRettC !== 0 ? fmt(totRettC) : '—'}</span>
            <span className="text-right text-purple-700 tabular-nums">{totC !== 0 ? `${(totRettC/totC*100).toFixed(1)}%` : '—'}</span>
            <span className={`text-right tabular-nums ${scostC>0?'text-red-600':'text-emerald-600'}`}>{scostC>0?'+':''}{fmt(scostC)}</span>
            <span className={`text-right text-[10px] tabular-nums ${scostC>0?'text-red-500':'text-emerald-500'}`}>
              {totC>0 ? `${scostC>0?'+':''}${(scostC/totC*100).toFixed(1)}%` : ''}
            </span>
            <span></span>
          </div>
        </div>

        {/* CE — RICAVI */}
        <div className="p-3">
          <div className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-2">Componenti Positive — {labelMese}</div>
          <div className="border border-slate-200 rounded-lg p-1.5 max-h-[420px] overflow-y-auto">
            {editedR.map((n, i) => (
              <MonthlyTreeNode key={`mr-${n.code}-${i}-${mese}`} node={n}
                prevByCode={revByCode} consByCode={consByCode}
                rettAmtByCode={rettAmtByCode} rettPctByCode={rettPctByCode}
                onPrev={(code, val) => !isAnnualView && onRevMonthly(code, mese, val)}
                onCons={(code, val) => !isAnnualView && onConsMonthly(code, mese, val)}
                onRett={(code, amount, pct) => !isAnnualView && onRettMonthly(code, mese, amount, pct)}
                mese={mese} monthly={revMonthly} onCopyToMonths={onRevMonthly}
                readOnly={readOnly}
              />
            ))}
          </div>
          <div className="mt-2 pt-2 border-t-2 border-slate-300 grid font-bold text-[11px]" style={{ gridTemplateColumns: MONTHLY_COLS }}>
            <span></span><span></span>
            <span className="text-slate-700">TOTALE RICAVI</span>
            <span className="text-right text-indigo-700 tabular-nums">{fmt(totR)}</span>
            <span className="text-right text-emerald-700 tabular-nums">{fmt(totConsR)}</span>
            <span className="text-right text-purple-700 tabular-nums">{totRettR !== 0 ? fmt(totRettR) : '—'}</span>
            <span className="text-right text-purple-700 tabular-nums">{totR !== 0 ? `${(totRettR/totR*100).toFixed(1)}%` : '—'}</span>
            <span className={`text-right tabular-nums ${scostR>=0?'text-emerald-600':'text-red-600'}`}>{scostR>0?'+':''}{fmt(scostR)}</span>
            <span className={`text-right text-[10px] tabular-nums ${scostR>=0?'text-emerald-500':'text-red-500'}`}>
              {totR>0 ? `${scostR>0?'+':''}${(scostR/totR*100).toFixed(1)}%` : ''}
            </span>
            <span></span>
          </div>
        </div>

        {/* Risultato mese/anno */}
        <div className="border-t border-slate-200 px-5 py-3 grid grid-cols-3 gap-3">
          <div className={`p-3 rounded-lg text-center font-bold text-sm ${ris>=0?'bg-indigo-50 text-indigo-700':'bg-red-50 text-red-700'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Preventivo {labelMese}</div>
            {ris>=0?'Utile':'Perdita'} {fmtC(Math.abs(ris))}
          </div>
          <div className={`p-3 rounded-lg text-center font-bold text-sm ${risCons>=0?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Cons.+Rett. {labelMese}</div>
            {risCons>=0?'Utile':'Perdita'} {fmtC(Math.abs(risCons))}
          </div>
          <div className={`p-3 rounded-lg text-center font-bold text-sm ${scostTot>=0?'bg-amber-50 text-amber-700':'bg-red-50 text-red-700'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Δ Scostamento</div>
            {scostTot>=0?'+':''}{fmtC(scostTot)}
            {ris !== 0 && (
              <div className="text-[10px] font-normal opacity-70 mt-0.5">{`${(scostTot/Math.abs(ris)*100).toFixed(1)}% del prev.`}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Determina se un account_code è una FOGLIA in un dato albero
// (no children → leaf). Usato per discriminare ricavi vs costi nella somma totale.
function isLeafCode(code: string, tree: TreeNodeT[]): boolean {
  const walk = (nodes: TreeNodeT[]): boolean => {
    for (const n of nodes) {
      if (n.code === code) return !n.children?.length
      if (n.children?.length && walk(n.children)) return true
    }
    return false
  }
  return walk(tree)
}

/* ═══════════════════════════════════════════════════════════
   CONFRONTO ROW — Voce | Preventivo | Consuntivo | Rettifica | Scostamento | %
   Scostamento = Consuntivo + Rettifica - Preventivo
   ═══════════════════════════════════════════════════════════ */
const CONF_COLS = '1fr 85px 95px 90px 85px 55px'

type ConfrontoRowProps = { prevNode: TreeNodeT; consNode: TreeNodeT; rettNode: TreeNodeT; depth?: number; consEdits: Record<string, number>; onConsEdit: (code: string, val: number) => void; rettEdits: Record<string, number | string>; onRettEdit: (code: string, val: number | string | undefined) => void }
function ConfrontoRow({ prevNode, consNode, rettNode, depth = 0, consEdits, onConsEdit, rettEdits, onRettEdit }: ConfrontoRowProps) {
  const [open, setOpen] = useState(false)
  const hasKids = prevNode.children?.length > 0
  const isMacro = prevNode.level === 0
  const isLeaf = !hasKids

  const pv = prevNode.amount || 0

  const consVal = consEdits[prevNode.code] != null ? consEdits[prevNode.code] : 0
  const consIsEdited = consEdits[prevNode.code] != null
  const rettRaw = rettEdits[prevNode.code]
  const rettVal = rettRaw != null ? rettRaw : 0
  const rettIsEdited = rettRaw != null && rettRaw !== undefined
  const rettNum = typeof rettVal === 'number' ? rettVal : 0  // stringa temporanea ('-','+') → 0

  // Per foglie: usa valori da input; per macro: usa totali dal tree
  const cv = isLeaf ? consVal : (consNode.amount || 0)
  const rv = isLeaf ? rettNum : (rettNode.amount || 0)
  const delta = cv + rv - pv
  const pct = pv !== 0 ? ((delta / Math.abs(pv)) * 100) : (delta !== 0 ? 100 : 0)

  return (
    <div>
      <div className={`grid items-center py-1 px-1 rounded transition ${hasKids ? 'cursor-pointer hover:bg-slate-50' : ''} ${isMacro ? 'bg-slate-50/80 mt-1' : ''}`}
        style={{ gridTemplateColumns: CONF_COLS, paddingLeft: `${4 + depth * 14}px` }}
        onClick={() => hasKids && setOpen(!open)}>
        {/* Voce */}
        <div className="flex items-center gap-1 min-w-0">
          <span className="w-3 shrink-0 text-[10px] text-slate-400">{hasKids ? (open ? '▾' : '▸') : ''}</span>
          <span className={`font-mono text-slate-400 shrink-0 ${isMacro ? 'text-[11px] font-bold' : 'text-[10px]'}`}
            style={{ width: prevNode.code?.length > 4 ? '46px' : '24px' }}>{prevNode.code}</span>
          <span className={`truncate ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[10px] text-slate-600'}`}>{prevNode.description}</span>
        </div>
        {/* Preventivo (bloccato) */}
        <span className={`tabular-nums text-right text-[10px] ${isMacro ? 'font-bold text-indigo-700' : 'text-indigo-500'}`}>{fmt(pv)}</span>
        {/* Consuntivo — input for leaves */}
        {isLeaf ? (
          <input type="text" inputMode="numeric"
            value={consIsEdited ? consVal : (consVal || '')}
            onClick={e => e.stopPropagation()}
            onChange={e => { const raw = e.target.value.replace(/\./g, '').replace(',', '.'); onConsEdit(prevNode.code, parseFloat(raw) || 0) }}
            className={`w-full text-right px-1 py-0.5 text-[10px] border rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400 ${consIsEdited ? 'bg-emerald-50 border-emerald-300' : 'border-slate-200'}`} placeholder="0" />
        ) : (
          <span className={`tabular-nums text-right text-[10px] ${isMacro ? 'font-bold text-emerald-700' : 'text-emerald-600'}`}>{fmt(cv)}</span>
        )}
        {/* Rettifica — input for leaves, accetta +/- */}
        {isLeaf ? (
          <input type="text" inputMode="text"
            value={rettIsEdited ? rettVal : ''}
            onClick={e => e.stopPropagation()}
            onChange={e => {
              const v = e.target.value.trim()
              if (v === '' || v === '-' || v === '+') { onRettEdit(prevNode.code, v === '' ? undefined : v); return }
              const raw = v.replace(/\./g, '').replace(',', '.')
              const num = parseFloat(raw)
              onRettEdit(prevNode.code, isNaN(num) ? 0 : num)
            }}
            className={`w-full text-right px-1 py-0.5 text-[10px] border rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-purple-400 ${rettIsEdited ? 'bg-purple-50 border-purple-300' : 'border-slate-200'}`} placeholder="±0" />
        ) : (
          <span className={`tabular-nums text-right text-[10px] ${isMacro ? 'font-bold text-purple-700' : 'text-purple-500'}`}>{rv !== 0 ? fmt(rv) : '—'}</span>
        )}
        {/* Scostamento = cons + rett - prev */}
        <span className={`tabular-nums text-right text-[10px] font-medium ${delta > 0 ? 'text-red-600' : delta < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
          {delta !== 0 ? `${delta > 0 ? '+' : ''}${fmt(delta)}` : '—'}
        </span>
        {/* % */}
        <span className={`tabular-nums text-right text-[9px] ${Math.abs(pct) > 10 ? (delta > 0 ? 'text-red-500 font-semibold' : 'text-emerald-500 font-semibold') : 'text-slate-400'}`}>
          {pv !== 0 && delta !== 0 ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : ''}
        </span>
      </div>
      {open && hasKids && prevNode.children.map((c, i) => (
        <ConfrontoRow key={`${c.code}-${i}`}
          prevNode={c} consNode={consNode.children?.[i] || c} rettNode={rettNode.children?.[i] || { ...c, amount: 0, children: [] }}
          depth={depth + 1} consEdits={consEdits} onConsEdit={onConsEdit} rettEdits={rettEdits} onRettEdit={onRettEdit} />
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   CONFRONTO PANEL — Preventivo | Consuntivo | Rettifica | Scostamento
   Scostamento = Consuntivo + Rettifica - Preventivo
   ═══════════════════════════════════════════════════════════ */
type CashTotalsT = { entrate: number; uscite: number; netto: number; count: number }
type ConfrontoPanelProps = { outletCode: string; outletLabel: string; prevEdits: Record<string, number>; consEdits: Record<string, number>; onConsEdit: (code: string, val: number) => void; rettEdits: Record<string, number>; onRettEdit: (code: string, val: number | string | undefined) => void; costiTree: TreeNodeT[]; ricaviTree: TreeNodeT[]; year: number; cashTotals: CashTotalsT; cashLoaded: boolean }
function ConfrontoPanel({ outletCode, outletLabel, prevEdits, consEdits, onConsEdit, rettEdits, onRettEdit, costiTree, ricaviTree, year, cashTotals, cashLoaded }: ConfrontoPanelProps) {
  const prevC = applyEdits(costiTree, prevEdits)
  const prevR = applyEdits(ricaviTree, prevEdits)
  const consC = applyEditsZero(costiTree, consEdits)
  const consR = applyEditsZero(ricaviTree, consEdits)
  const rettC = applyEditsZero(costiTree, rettEdits)
  const rettR = applyEditsZero(ricaviTree, rettEdits)

  const totPrevC = sumMacros(prevC), totPrevR = sumMacros(prevR)
  const totConsC = sumMacros(consC), totConsR = sumMacros(consR)
  const totRettC = sumMacros(rettC), totRettR = sumMacros(rettR)
  const risPrev = totPrevR - totPrevC
  const risCons = totConsR - totConsC
  const risRett = totRettR - totRettC
  const scostC = totConsC + totRettC - totPrevC
  const scostR = totConsR + totRettR - totPrevR
  const scostTot = (risCons + risRett) - risPrev

  // Cash-basis values
  const cashNetto = cashTotals?.netto || 0
  const hasCash = cashLoaded && cashTotals?.count > 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={Lock} label="Risultato preventivo" value={fmtC(risPrev)} color={risPrev>=0?'green':'red'} />
        <Kpi icon={Unlock} label="Consuntivo + Rettifica" value={fmtC(risCons + risRett)} color={(risCons+risRett)>=0?'green':'red'} />
        <Kpi icon={Target} label="Netto Cassa" value={hasCash ? fmtC(cashNetto) : '—'} color={hasCash ? (cashNetto>=0?'green':'red') : 'amber'}
          sub={hasCash ? `${cashTotals.count} movimenti bancari` : 'Nessun dato bancario'} />
        <Kpi icon={TrendingDown} label="Δ costi" value={totPrevC>0 ? `${(scostC/totPrevC*100).toFixed(1)}%` : '—'} color={scostC>0?'red':'green'} />
        <Kpi icon={TrendingUp} label="Δ ricavi" value={totPrevR>0 ? `${(scostR/totPrevR*100).toFixed(1)}%` : '—'} color={scostR>=0?'green':'red'} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">{outletLabel} — Preventivo vs Consuntivo {year}</h3>
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1"><Lock size={10} className="text-indigo-400"/> <span className="text-indigo-600 font-medium">Preventivo</span></span>
            <span className="flex items-center gap-1"><Unlock size={10} className="text-emerald-400"/> <span className="text-emerald-600 font-medium">Consuntivo</span></span>
            <span className="text-purple-600 font-medium">Rettifica</span>
            <span className="text-amber-600 font-medium">Δ Scostamento</span>
          </div>
        </div>

        {/* Column headers */}
        <div className="grid px-5 py-2 bg-slate-50/50 border-b border-slate-100 text-[9px] font-semibold uppercase tracking-wider text-slate-400"
          style={{ gridTemplateColumns: CONF_COLS }}>
          <span>Voce</span>
          <span className="text-right text-indigo-400">Preventivo</span>
          <span className="text-right text-emerald-400">Consuntivo</span>
          <span className="text-right text-purple-400">Rettifica</span>
          <span className="text-right text-amber-500">Scostamento</span>
          <span className="text-right text-amber-500">%</span>
        </div>

        {/* COSTI */}
        <div className="px-3 py-2 border-b border-slate-200">
          <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-1">Componenti Negative (Costi)</div>
          <div className="max-h-[400px] overflow-y-auto">
            {prevC.map((n, i) => (
              <ConfrontoRow key={`c-${n.code}-${i}`} prevNode={n} consNode={consC[i] || n} rettNode={rettC[i] || { ...n, amount: 0, children: [] }}
                consEdits={consEdits} onConsEdit={onConsEdit} rettEdits={rettEdits} onRettEdit={onRettEdit} />
            ))}
          </div>
          <div className="grid mt-2 pt-2 border-t-2 border-slate-300 font-bold text-[11px]"
            style={{ gridTemplateColumns: CONF_COLS }}>
            <span className="text-slate-700">TOTALE COSTI</span>
            <span className="text-right text-indigo-700 tabular-nums">{fmt(totPrevC)}</span>
            <span className="text-right text-emerald-700 tabular-nums">{fmt(totConsC)}</span>
            <span className="text-right text-purple-700 tabular-nums">{totRettC !== 0 ? fmt(totRettC) : '—'}</span>
            <span className={`text-right tabular-nums ${scostC>0?'text-red-600':'text-emerald-600'}`}>{scostC>0?'+':''}{fmt(scostC)}</span>
            <span className={`text-right text-[10px] tabular-nums ${scostC>0?'text-red-500':'text-emerald-500'}`}>
              {totPrevC>0 ? `${scostC>0?'+':''}${(scostC/totPrevC*100).toFixed(1)}%` : ''}
            </span>
          </div>
        </div>

        {/* RICAVI */}
        <div className="px-3 py-2">
          <div className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-1">Componenti Positive (Ricavi)</div>
          <div className="max-h-[400px] overflow-y-auto">
            {prevR.map((n, i) => (
              <ConfrontoRow key={`r-${n.code}-${i}`} prevNode={n} consNode={consR[i] || n} rettNode={rettR[i] || { ...n, amount: 0, children: [] }}
                consEdits={consEdits} onConsEdit={onConsEdit} rettEdits={rettEdits} onRettEdit={onRettEdit} />
            ))}
          </div>
          <div className="grid mt-2 pt-2 border-t-2 border-slate-300 font-bold text-[11px]"
            style={{ gridTemplateColumns: CONF_COLS }}>
            <span className="text-slate-700">TOTALE RICAVI</span>
            <span className="text-right text-indigo-700 tabular-nums">{fmt(totPrevR)}</span>
            <span className="text-right text-emerald-700 tabular-nums">{fmt(totConsR)}</span>
            <span className="text-right text-purple-700 tabular-nums">{totRettR !== 0 ? fmt(totRettR) : '—'}</span>
            <span className={`text-right tabular-nums ${scostR>=0?'text-emerald-600':'text-red-600'}`}>{scostR>0?'+':''}{fmt(scostR)}</span>
            <span className={`text-right text-[10px] tabular-nums ${scostR>=0?'text-emerald-500':'text-red-500'}`}>
              {totPrevR>0 ? `${scostR>0?'+':''}${(scostR/totPrevR*100).toFixed(1)}%` : ''}
            </span>
          </div>
        </div>

        {/* Risultati */}
        <div className="border-t border-slate-200 px-5 py-3 grid grid-cols-4 gap-4">
          <div className={`p-3 rounded-lg text-center font-bold text-sm ${risPrev>=0?'bg-indigo-50 text-indigo-700':'bg-red-50 text-red-700'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Budget</div>
            {risPrev>=0?'Utile':'Perdita'} {fmtC(Math.abs(risPrev))}
          </div>
          <div className={`p-3 rounded-lg text-center font-bold text-sm ${(risCons+risRett)>=0?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Consuntivo</div>
            {(risCons+risRett)>=0?'Utile':'Perdita'} {fmtC(Math.abs(risCons+risRett))}
          </div>
          <div className={`p-3 rounded-lg text-center font-bold text-sm ${hasCash ? (cashNetto>=0?'bg-teal-50 text-teal-700':'bg-red-50 text-red-700') : 'bg-slate-50 text-slate-400'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Cassa</div>
            {hasCash ? (
              <>
                {cashNetto>=0?'Entrate nette':'Uscite nette'} {fmtC(Math.abs(cashNetto))}
              </>
            ) : 'Nessun dato bancario importato'}
          </div>
          <div className={`p-3 rounded-lg text-center font-bold text-sm ${scostTot>=0?'bg-amber-50 text-amber-700':'bg-red-50 text-red-700'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Varianza</div>
            {scostTot>=0?'+':''}{fmtC(scostTot)}
          </div>
        </div>

        {/* Variance table: Budget → Consuntivo → Cassa */}
        {hasCash && (
          <div className="border-t border-slate-200 px-5 py-3">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Budget → Consuntivo (competenza) → Cassa</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] text-slate-400 uppercase tracking-wider">
                    <th className="py-1.5 px-2 text-left">Voce</th>
                    <th className="py-1.5 px-2 text-right text-indigo-400">Budget</th>
                    <th className="py-1.5 px-2 text-right text-emerald-400">Consuntivo</th>
                    <th className="py-1.5 px-2 text-right text-teal-400">Cassa</th>
                    <th className="py-1.5 px-2 text-right text-amber-500">Var. Budget→Cassa</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  <tr className="border-b border-slate-50">
                    <td className="py-1.5 px-2 text-slate-700 font-medium">Entrate / Ricavi</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-indigo-600">{fmt(totPrevR)} €</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-emerald-600">{fmt(totConsR + totRettR)} €</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-teal-600">{fmt(cashTotals.entrate)} €</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${(cashTotals.entrate - totPrevR) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {(cashTotals.entrate - totPrevR) >= 0 ? '+' : ''}{fmt(cashTotals.entrate - totPrevR)} €
                    </td>
                  </tr>
                  <tr className="border-b border-slate-50">
                    <td className="py-1.5 px-2 text-slate-700 font-medium">Uscite / Costi</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-indigo-600">{fmt(totPrevC)} €</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-emerald-600">{fmt(totConsC + totRettC)} €</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-teal-600">{fmt(cashTotals.uscite)} €</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${(cashTotals.uscite - totPrevC) <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {(cashTotals.uscite - totPrevC) > 0 ? '+' : ''}{fmt(cashTotals.uscite - totPrevC)} €
                    </td>
                  </tr>
                  <tr className="border-t-2 border-slate-300 font-bold">
                    <td className="py-2 px-2 text-slate-900">Risultato netto</td>
                    <td className={`py-2 px-2 text-right tabular-nums ${risPrev>=0?'text-indigo-700':'text-red-700'}`}>{fmt(risPrev)} €</td>
                    <td className={`py-2 px-2 text-right tabular-nums ${(risCons+risRett)>=0?'text-emerald-700':'text-red-700'}`}>{fmt(risCons+risRett)} €</td>
                    <td className={`py-2 px-2 text-right tabular-nums ${cashNetto>=0?'text-teal-700':'text-red-700'}`}>{fmt(cashNetto)} €</td>
                    <td className={`py-2 px-2 text-right tabular-nums ${(cashNetto - risPrev)>=0?'text-emerald-700':'text-red-700'}`}>
                      {(cashNetto - risPrev) >= 0 ? '+' : ''}{fmt(cashNetto - risPrev)} €
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 text-center">
              I dati di cassa provengono dai movimenti bancari reali. Le differenze con il consuntivo sono normali (tempistiche incasso/pagamento).
            </p>
          </div>
        )}

        {/* No cash data notice */}
        {cashLoaded && !hasCash && (
          <div className="border-t border-slate-200 px-5 py-3">
            <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
              <AlertTriangle size={14} className="text-slate-400 shrink-0" />
              <p className="text-xs text-slate-500">Nessun dato bancario importato per {year}. Importa i movimenti dalla sezione Banche per visualizzare la colonna Cassa.</p>
            </div>
          </div>
        )}
      </div>
      <PageHelp page="budget" />
    </div>
  )
}

