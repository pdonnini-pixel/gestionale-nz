import React, { useState, useEffect, useMemo, useCallback } from 'react'
// sedeQuota: ripartisce un importo pro-quota su un denominatore (riuso per l'allocazione imposte).
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Tab principale BudgetControl — persistito in URL come ?tab=
type BudgetTab = 'bp' | 'confronto' | 'rapido'
const VALID_BUDGET_TABS: BudgetTab[] = ['bp', 'confronto', 'rapido']

// Vista confronto Preventivo vs Consuntivo — persistita come ?confView=
type BudgetConfView = 'annuale' | 'mensile'
const VALID_BUDGET_CONF_VIEWS: BudgetConfView[] = ['annuale', 'mensile']

// Pseudo-codice per "vista aggregata di tutti gli outlet operativi" nel
// selettore Confronto. Non e' un cost_center reale ma una vista UI che
// somma per account_code i prevEdits/consEdits/rettEdits di tutti gli outlet.
const ALL_OUTLETS_CODE = '__all_outlets__'
import { useRole } from '../hooks/useRole'
import { usePeriod } from '../hooks/usePeriod'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import { useCompany } from '../hooks/useCompany'
import PageHelp from '../components/PageHelp'
import PageHeader from '../components/PageHeader'
import Tooltip from '../components/Tooltip'
import { PlaceholderDot, PlaceholderLegend } from '../components/PlaceholderMark'
import ExportBilancioDialog from '../components/ExportBilancioDialog'
import { getCurrentTenant } from '../lib/tenants'
import { RICAVI_SOURCE_LABEL, sedeQuota } from '../lib/outletRevenue'
import {
  Calculator, ChevronDown, ChevronUp,
  Store, Building2, Save, Trash2,
  AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, Target,
  BarChart3, Copy, Lock, Unlock, Info, RefreshCw, FileSpreadsheet, Zap
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { computeConfrontoDiff, type ConfrontoRow, type ExistingConfrontoRow, type ConfrontoDiff } from './budgetConfrontoDiff'

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
// HQ_CODE rimosso dal top-level (Sprint 3): ora e' dinamico dal DB via
// cost_centers.role='hq'. Vedi sotto nel componente BudgetControl.

// Mappa override per code raw -> label leggibile.
// Estendere qui per future label tecniche che non vogliamo mostrare.
const COST_CENTER_LABEL_OVERRIDES = {
  'sede_magazzino': 'Sede / Magazzino',
  'rettifica_bilancio': 'Rettifica bilancio',
  'spese_non_divise': 'Spese non divise',
  // 'all': cost_center generico per costi/ricavi non allocati a un outlet specifico
  // (es. consulenze fiscali, ammortamenti, oneri finanziari, ricavi B2B Italia).
  // Rinominato da "Tutti" a "Sede / Costi generali" per chiarezza UX (richiesta 13/05/2026).
  'all': 'Sede / Costi generali',
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
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}
function fmtC(n: number | null | undefined) { return n == null || isNaN(n) ? '—' : `${fmt(n, 2)} €` }

// Formatta tempo relativo per "ultimo aggiornamento consuntivo".
// Pensato per Sabrina: stringhe brevi e parlanti, non timestamp ISO.
function fmtRelativeTime(date: Date | null | undefined): string {
  if (!date) return 'mai'
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return 'in arrivo'
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'pochi secondi fa'
  if (diffMin < 60) return `${diffMin} min fa`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH} ${diffH === 1 ? 'ora' : 'ore'} fa`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30) return `${diffD} ${diffD === 1 ? 'giorno' : 'giorni'} fa`
  return date.toLocaleDateString('it-IT')
}

function getCodeLevel(code: string | null | undefined) {
  if (!code) return 0
  const len = code.replace(/\s/g, '').length
  if (len <= 2) return 0; if (len <= 4) return 1; if (len <= 6) return 2; return 3
}

type TreeRow = { code: string; description?: string; amount?: number; level: number; [key: string]: unknown }
type TreeNodeT = TreeRow & { children: TreeNodeT[] }

function buildTree(rows: TreeRow[] | null | undefined): TreeNodeT[] {
  if (!rows || !rows.length) return []
  // Gerarchia PREFIX-BASED (non piu adiacenza per livello).
  // Bug fix (ticket 01/06/2026): con sort_order non perfettamente ordinato i
  // sottoconti finivano sotto il conto sbagliato (es. 630336 del mastro 6303
  // assegnato a "Viaggi e Trasferte" 6305), gonfiando il totale. Ora ogni nodo
  // viene agganciato al nodo esistente il cui codice e il prefisso piu lungo,
  // a prescindere dall'ordine: 6305 contiene SOLO i codici che iniziano per 6305.
  const norm = (c: string | null | undefined) => (c || '').replace(/\s/g, '')
  const nodes: TreeNodeT[] = rows.map(row => ({ ...row, children: [] }))
  const byCode = new Map<string, TreeNodeT>()
  nodes.forEach(n => { const k = norm(n.code); if (k && !byCode.has(k)) byCode.set(k, n) })
  const tree: TreeNodeT[] = []
  for (const node of nodes) {
    const nc = norm(node.code)
    let parent: TreeNodeT | null = null
    for (let l = nc.length - 1; l >= 1; l--) {
      const cand = byCode.get(nc.slice(0, l))
      if (cand && cand !== node) { parent = cand; break }
    }
    if (parent) parent.children.push(node); else tree.push(node)
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
// ─── INPUT NUMERICO FORMATO ITALIANO ────────────────────────────
// Accetta virgola decimale e punto migliaia in input.
// Mostra formato italiano (9.000,00 / 90.000,00 / 900.000,00) quando NON in focus.
// Mostra il draft raw quando l'utente sta digitando.
// Patrizio (29/05/2026): "nei campi che popolo non mi fa mettere la , !!!
// e ricorda che se sono migliaia devi mettere il punto esempio 9.000,00 ecc".
/**
 * Distribuisce un importo annuale su 12 mesi in modo che la SOMMA dei 12 mesi
 * sia ESATTAMENTE uguale all'annuale (al centesimo). Risolve il bug di
 * arrotondamento: 149.000 / 12 = 12.416,67 → ×12 = 149.004.
 * Lavora in centesimi (la colonna budget_amount è numeric(14,2)) e assegna il
 * resto ai primi mesi, gestendo anche importi negativi (rettifiche).
 * (Patrizio 01/06/2026)
 */
function splitMonthly(annual: number): number[] {
  const cents = Math.round((annual || 0) * 100)
  const base = Math.trunc(cents / 12)
  const rem = cents - base * 12 // può essere negativo
  const step = rem >= 0 ? 1 : -1
  const r = Math.abs(rem)
  return Array.from({ length: 12 }, (_, i) => (base + (i < r ? step : 0)) / 100)
}

function NumberInputIt({ value, onChange, onCommit, className, placeholder, edited, onClickStop }: {
  value: number
  onChange: (n: number) => void
  // Chiamato on blur con il valore finale, SOLO se diverso dal valore d'apertura.
  // Usato per autosave per-cella (Patrizio 29/05/2026): evita perdita dati se
  // l'utente cambia outlet senza cliccare Salva. Dopo successo, mostra '✓' 2s.
  onCommit?: (n: number) => Promise<void>
  className?: string
  placeholder?: string
  edited?: boolean
  onClickStop?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState<string>('')
  const [openValue, setOpenValue] = useState<number>(0) // valore al focus, per detect change
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const display = focused
    ? draft
    : (value !== 0 || edited)
      ? value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : ''
  const handleBlur = async () => {
    setFocused(false)
    if (onCommit && value !== openValue) {
      try {
        setSaveStatus('saving')
        await onCommit(value)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 1800)
      } catch {
        setSaveStatus('error')
        setTimeout(() => setSaveStatus('idle'), 3000)
      }
    }
  }
  // Feedback save via border colorato + background dell'input stesso (no wrapper
  // span che rompeva l'allineamento delle colonne grid).
  // Patrizio 29/05/2026: "le celle dove scrive sono spostate".
  const statusClass =
    saveStatus === 'saving' ? '!ring-2 !ring-amber-300 !bg-amber-50' :
    saveStatus === 'saved' ? '!ring-2 !ring-emerald-400 !bg-emerald-50' :
    saveStatus === 'error' ? '!ring-2 !ring-red-400 !bg-red-50' : ''
  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onClick={onClickStop ? (e => e.stopPropagation()) : undefined}
      onFocus={() => {
        setDraft(value !== 0 ? String(value).replace('.', ',') : '')
        setOpenValue(value)
        setFocused(true)
      }}
      onChange={e => {
        const v = e.target.value
        setDraft(v)
        const cleaned = v.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
        const num = parseFloat(cleaned)
        onChange(isNaN(num) ? 0 : num)
      }}
      onBlur={handleBlur}
      className={`${className || ''} ${statusClass}`}
      placeholder={placeholder}
      title={
        saveStatus === 'saving' ? 'Salvataggio in corso...' :
        saveStatus === 'saved' ? 'Salvato ✓' :
        saveStatus === 'error' ? 'Errore: riprova' : undefined
      }
    />
  )
}

function TreeNodeEdit({ node, depth = 0, edits, onEdit, onCommitAccount }: { node: TreeNodeT; depth?: number; edits: Record<string, number>; onEdit: (code: string, value: number | null) => void; onCommitAccount?: (code: string, value: number) => Promise<void> }) {
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
        <Tooltip content={node.description}>
          <span
            className={`truncate ml-1 flex-1 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[11px] text-slate-600'}`}
          >
            {prettifyAccountName(node.description)}
          </span>
        </Tooltip>
        {isLeaf ? (
          <NumberInputIt
            value={val}
            edited={isEdited}
            onChange={n => onEdit(node.code, n)}
            onCommit={onCommitAccount ? (n => onCommitAccount(node.code, n)) : undefined}
            onClickStop
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
        <TreeNodeEdit key={`${c.code}-${i}`} node={c} depth={depth + 1} edits={edits} onEdit={onEdit} onCommitAccount={onCommitAccount} />
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
        <Tooltip content={node.description}>
          <span
            className={`truncate ml-1 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[11px] text-slate-600'}`}
          >
            {prettifyAccountName(node.description)}
          </span>
        </Tooltip>
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
          <div className="text-lg font-bold text-slate-900 truncate" title={String(value)}>{value}</div>
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
  const { company } = useCompany()
  const canApproveBudget = hasRole('budget_approver')
  const CID = profile?.company_id
  const { year, quarter } = usePeriod()

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
  type CeRow = TreeRow & { account_code?: string; account_name?: string; macro_group?: string; outlet_link?: string | null }
  type BudgetEntry = {
    cost_center?: string; account_code?: string; account_name?: string
    budget_amount?: number; actual_amount?: number; month?: number; year?: number; macro_group?: string
    is_approved?: boolean | null
    approved_at?: string | null; approved_by?: string | null
    unlocked_at?: string | null; unlocked_by?: string | null; unlock_reason?: string | null
    actual_refreshed_at?: string | null
    actual_breakdown?: Record<string, number> | null
    // is_placeholder: TRUE se la riga è un preventivo provvisorio generato
    // automaticamente (es. copia dal consuntivo dell'anno precedente).
    // Diventa FALSE automaticamente quando l'utente modifica budget_amount
    // (trigger DB trg_budget_entries_unflag_placeholder).
    is_placeholder?: boolean
    [k: string]: unknown
  }
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [ceRawCosti, setCeRawCosti] = useState<CeRow[]>([])
  const [ceRawRicavi, setCeRawRicavi] = useState<CeRow[]>([])
  const [budgetEntries, setBudgetEntries] = useState<BudgetEntry[]>([])

  // Stato refresh consuntivo (chiamata RPC refresh_budget_consuntivo)
  const [consuntivoRefreshing, setConsuntivoRefreshing] = useState(false)

  // Stato dialog "Esporta bilancio consuntivo" (Lavoro 3)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

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

  // Imposte sul reddito annuali (input Lilian). Valore POSITIVO unico per anno,
  // editabile solo nella vista aggregata "Tutti gli outlet"; il segno meno e la
  // ripartizione (10% Sede + 90% outlet pro-quota ricavi) sono solo a display.
  const [imposteAmount, setImposteAmount] = useState(0)


  // ─── LOAD ──────────────────────────────────────────────────
  useEffect(() => { if (CID) loadAll() }, [CID, year, quarter])

  const loadAll = async () => {
    setLoading(true)
    try {
      if (!CID) return
      const cid = CID
      // ce structure ora viene da chart_of_accounts (piano dei conti completo
      // post-wipe). Sostituisce la vecchia query balance_sheet_data section
      // IN ('ce_costi', 'ce_ricavi') che era diventata vuota dopo il wipe del
      // 13/05/2026. Gli importi (amount) sono aggregati da budget_entries
      // dell'anno corrente.
      const [ccR, coaR, buR, cfR, impR] = await Promise.all([
        supabase.from('cost_centers').select('*').eq('company_id', cid).eq('is_active', true).order('sort_order'),
        supabase.from('chart_of_accounts').select('code, name, level, is_revenue, sort_order, macro_group, outlet_link').eq('company_id', cid).eq('is_active', true).order('sort_order'),
        supabase.from('budget_entries').select('*').eq('company_id', cid).eq('year', year).range(0, 9999),
        supabase.from('budget_confronto').select('*').eq('company_id', cid).eq('year', year).range(0, 9999),
        supabase.from('imposte_annuali').select('amount').eq('company_id', cid).eq('year', year).maybeSingle(),
      ])
      // Imposte annuali per l'anno selezionato (0 se nessun record: empty-state, mai inventato).
      setImposteAmount(Number(impR.data?.amount) || 0)
      setCostCenters((ccR.data || []) as CostCenter[])
      const beAll = (buR.data || []) as BudgetEntry[]
      setBudgetEntries(beAll)
      setWorkflow(computeWorkflow(beAll))

      // Aggrega budget_amount annuo per account_code (somma su tutti i mesi e
      // tutti i cost_center). Esclude rettifica_bilancio dalla vista per outlet.
      const amountByCode: Record<string, number> = {}
      beAll.forEach(e => {
        if (e.cost_center === 'rettifica_bilancio') return
        const code = e.account_code
        if (!code) return
        amountByCode[code] = (amountByCode[code] || 0) + (Number(e.budget_amount) || 0)
      })

      // Costruisci ceRawCosti/ceRawRicavi dal piano dei conti.
      // - Tutti i livelli (1, 2, 3) vanno inclusi: buildTree() raggruppa via
      //   gerarchia code-based, e i totali livello 1/2 saranno calcolati dai figli.
      // - is_revenue=true → ricavi, altrimenti costi.
      type CoaRow = { code: string; name: string | null; level: number | null; is_revenue: boolean | null; outlet_link?: string | null }
      const co: CeRow[] = []
      const ri: CeRow[] = []
      ;((coaR.data || []) as unknown as CoaRow[]).forEach(c => {
        const row: CeRow = {
          code: c.code,
          description: c.name || '',
          amount: amountByCode[c.code] || 0,
          level: c.level ?? getCodeLevel(c.code),
          isMacro: (c.level ?? getCodeLevel(c.code)) <= 1,
          outlet_link: c.outlet_link ?? null,
        }
        if (c.is_revenue) ri.push(row)
        else co.push(row)
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

      // Default Confronto gestito dall'effect (vista aggregata "Tutti gli outlet"),
      // rispettando il deep-link ?outlet=<code>.
    } catch (err: unknown) { console.error(err) } finally { setLoading(false) }
  }

  // ─── REFRESH CONSUNTIVO (RPC refresh_budget_consuntivo) ───────
  // Aggrega in tempo reale il consuntivo da fonti reali (daily_revenue,
  // active_invoices, electronic_invoices) e popola budget_entries.actual_amount.
  // Il bottone diventa giallo quando i trigger DB hanno invalidato
  // actual_refreshed_at (es: nuova fattura caricata in Fatturazione).
  const refreshConsuntivo = useCallback(async (outletId: string | null = null) => {
    if (!CID) return
    setConsuntivoRefreshing(true)
    try {
      const { data, error } = await supabase.rpc('refresh_budget_consuntivo', {
        p_outlet_id: outletId,
        p_year: year,
      })
      if (error) throw error
      const result = (data ?? {}) as {
        success?: boolean
        error?: string
        rows_updated?: number
        total_ricavi_consuntivo?: number
        total_costi_consuntivo?: number
        risultato_consuntivo?: number
      }
      if (result.success === false) throw new Error(result.error || 'Errore aggiornamento consuntivo')
      const rows = result.rows_updated ?? 0
      const ricavi = result.total_ricavi_consuntivo ?? 0
      const costi = result.total_costi_consuntivo ?? 0
      show(`Consuntivo aggiornato — ${rows} righe · Ricavi ${fmtC(ricavi)} · Costi ${fmtC(costi)}`)
      // Reload per riflettere actual_amount + actual_refreshed_at nello state
      await loadAll()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore sconosciuto'
      show(`Errore aggiornamento consuntivo: ${msg}`, 'error')
      console.error('[refreshConsuntivo]', err)
    } finally {
      setConsuntivoRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CID, year])

  // Meta del consuntivo: timestamp dell'ultimo refresh + flag stale.
  // Stale = qualche riga ha actual_refreshed_at NULL (trigger ha invalidato)
  // OPPURE l'ultimo refresh è più vecchio di 24h.
  const consuntivoMeta = useMemo(() => {
    const relevant = budgetEntries.filter(e => e.cost_center !== 'rettifica_bilancio')
    if (relevant.length === 0) {
      return { lastRefresh: null as Date | null, isStale: false, neverRefreshed: true }
    }
    const withRefresh = relevant.filter(e => e.actual_refreshed_at)
    const anyNull = relevant.some(e => !e.actual_refreshed_at)
    if (withRefresh.length === 0) {
      return { lastRefresh: null as Date | null, isStale: true, neverRefreshed: true }
    }
    const timestamps = withRefresh.map(e => new Date(e.actual_refreshed_at as string).getTime())
    const lastRefresh = new Date(Math.max(...timestamps))
    const olderThan24h = (Date.now() - lastRefresh.getTime()) > 24 * 60 * 60 * 1000
    return { lastRefresh, isStale: anyNull || olderThan24h, neverRefreshed: false }
  }, [budgetEntries])

  // ─── TREES ─────────────────────────────────────────────────
  // `ops` = cost_centers che rappresentano punti vendita operativi, ESCLUSI:
  //   - HQ_CODE ('sede_magazzino')  → sede centrale
  //   - 'sede'                       → cost_center sede creato dal wizard onboarding
  //   - 'spese_non_divise'           → riga gap bilancio NZ
  //   - 'rettifica_bilancio'         → riga rettifica magazzino NZ
  // Sprint 3 (Patrizio 29/05/2026): cost_centers.role e' la fonte di verita'.
  //   - role='hq'              → sede/magazzino (1 per tenant)
  //   - role='outlet'          → punto vendita operativo
  //   - role='non_operational' → spese non divise, rettifiche
  // HQ_CODE diventa dinamico dal DB (vedi sopra). Fallback 'sede_magazzino' per
  // retro-compatibilita' con tenant non ancora migrati.
  const HQ_CODE = useMemo(() => {
    const hq = costCenters.find(cc => (cc as { role?: string }).role === 'hq')
    return hq?.code || 'sede_magazzino'
  }, [costCenters])
  const ops = useMemo(
    () => costCenters.filter(cc => (cc as { role?: string }).role !== 'hq' && (cc as { role?: string }).role !== 'non_operational' && cc.code !== 'sede'),
    [costCenters],
  )
  const hq = useMemo(() => costCenters.find(cc => (cc as { role?: string }).role === 'hq') || costCenters.find(cc => cc.code === HQ_CODE), [costCenters, HQ_CODE])
  const costiTree = useMemo(() => buildTree(ceRawCosti), [ceRawCosti])
  const ricaviTree = useMemo(() => buildTree(ceRawRicavi), [ceRawRicavi])
  const hasTree = ceRawCosti.length > 0 || ceRawRicavi.length > 0

  // ─── Marcatore segnaposto (is_placeholder) ──────────────────────────────
  // NB: questi hook DEVONO stare prima di qualunque early return (es. if(loading)),
  // altrimenti React error #310 (ordine degli hook). Classificazione ricavo/costo
  // via chart_of_accounts.is_revenue (ceRawRicavi), MAI per prefisso conto.
  // NB: le righe ceRaw* usano `.code` (non `.account_code`, sempre undefined qui).
  const revenueCodeSet = useMemo(
    () => new Set(ceRawRicavi.map(r => r.code).filter(Boolean) as string[]),
    [ceRawRicavi]
  )
  // Set dei codici COSTO noti (piano dei conti, NON ricavi). Usato per marcare i
  // costi: così un codice ricavo (o un conto inattivo non in piano) NON finisce
  // per sbaglio sul marcatore dei costi.
  const costCodeSet = useMemo(
    () => new Set(ceRawCosti.map(r => r.code).filter(Boolean) as string[]),
    [ceRawCosti]
  )
  // Costi a budget con placeholder, per cost_center (OR sulle righe sottostanti).
  const phCostByCenter = useMemo(() => {
    const m: Record<string, boolean> = {}
    budgetEntries.forEach(e => {
      if (e.is_placeholder !== true) return
      const ac = e.account_code || ''
      if (!costCodeSet.has(ac)) return // marca solo costi noti (i ricavi vivono in budget_confronto)
      if (e.cost_center) m[e.cost_center] = true
    })
    return m
  }, [budgetEntries, costCodeSet])
  // Ricavi a budget con placeholder, per cost_center+mese (per Inserimento Rapido).
  const phRevByCenterMonth = useMemo(() => {
    const m: Record<string, boolean[]> = {}
    budgetEntries.forEach(e => {
      if (e.is_placeholder !== true) return
      const ac = e.account_code || ''
      if (!revenueCodeSet.has(ac)) return
      const mo = Number(e.month || 0)
      if (mo < 1 || mo > 12 || !e.cost_center) return
      if (!m[e.cost_center]) m[e.cost_center] = Array(12).fill(false)
      m[e.cost_center][mo - 1] = true
    })
    return m
  }, [budgetEntries, revenueCodeSet])

  // Alberi conti SPECIFICI per outlet (strategia C 13/05/2026):
  // ogni outlet vede SOLO i suoi valori (es. Valdichiana = ricavi corrispettivi
  // 510107 + costi specifici outlet). I costi non allocati a outlet stanno nel
  // cost_center 'all' (visualizzato come "Sede / Costi generali").
  // Per ALL_OUTLETS_CODE (vista aggregata) si usa l'albero globale.
  const costiTreeForOutlet = useMemo(() => {
    if (!confOutlet || confOutlet === ALL_OUTLETS_CODE) return costiTree
    const edits = bpEdits[confOutlet] || {}
    const filtered: CeRow[] = ceRawCosti.map(r => ({ ...r, amount: edits[r.code] || 0 }))
    return buildTree(filtered)
  }, [ceRawCosti, bpEdits, confOutlet, costiTree])

  const ricaviTreeForOutlet = useMemo(() => {
    if (!confOutlet || confOutlet === ALL_OUTLETS_CODE) return ricaviTree
    const edits = bpEdits[confOutlet] || {}
    const filtered: CeRow[] = ceRawRicavi.map(r => ({ ...r, amount: edits[r.code] || 0 }))
    return buildTree(filtered)
  }, [ceRawRicavi, bpEdits, confOutlet, ricaviTree])

  // Aggrega bpEdits/consEdits/rettEdits sommando per account_code su tutti
  // gli outlet operativi visibili al ruolo corrente. Usato per la vista
  // "Tutti gli outlet" nel selettore Confronto (default per CEO).
  const aggregatedConfrontoEdits = useMemo(() => {
    const empty = { prev: {} as Record<string, number>, cons: {} as Record<string, number>, rett: {} as Record<string, number>, outletCount: 0, sedeIncluded: false }
    if (confOutlet !== ALL_OUTLETS_CODE) return empty
    const operative = (canApproveBudget
      ? ops
      : ops.filter(cc => (workflow[cc.code]?.status ?? 'bozza') !== 'bozza')
    )
    if (operative.length === 0) return empty
    const sumInto = (dst: Record<string, number>, src: Record<string, number> | undefined) => {
      if (!src) return
      for (const [ac, amt] of Object.entries(src)) {
        dst[ac] = (dst[ac] || 0) + (amt || 0)
      }
    }
    const prev: Record<string, number> = {}, cons: Record<string, number> = {}, rett: Record<string, number> = {}
    // Includi la Sede (cost_center HQ) tra i centri sommati, con la STESSA regola
    // read-only della card BP: visibile se canApproveBudget o status Sede != 'bozza'.
    // Cosi' il Risultato aggregato del Confronto coincide col TOTALE COMPLESSIVO del BP e col CE.
    const sedeIncluded = !!hq && (canApproveBudget || (workflow[HQ_CODE]?.status ?? 'bozza') !== 'bozza')
    const centers = [...(sedeIncluded ? [HQ_CODE] : []), ...operative.map(o => o.code)]
    for (const code of centers) {
      sumInto(prev, bpEdits[code])
      sumInto(cons, consEdits[code])
      sumInto(rett, rettEdits[code])
    }
    return { prev, cons, rett, outletCount: operative.length, sedeIncluded }
  }, [confOutlet, bpEdits, consEdits, rettEdits, ops, workflow, canApproveBudget, hq, HQ_CODE])

  // I3 — deep-link da "Confronto Outlet": /budget?tab=confronto&outlet=<code>.
  // Preseleziona l'outlet richiesto (ha priorità sui default sotto).
  const outletParam = searchParams.get('outlet')
  useEffect(() => {
    if (outletParam) {
      setConfOutlet(outletParam)
      // consuma il deep-link: rimuovi ?outlet= dall'URL così i reload successivi
      // tornano al default "Tutti gli outlet" (l'effetto di default sotto NON riparte
      // perché confOutlet è ormai valorizzato).
      const p = new URLSearchParams(searchParams)
      p.delete('outlet')
      setSearchParams(p, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletParam])

  // Default selettore Confronto per TUTTI i ruoli: vista aggregata "Tutti gli outlet".
  // Il deep-link ?outlet=<code> ha priorita' (gestito dall'effect sopra).
  useEffect(() => {
    if (!loading && !confOutlet && !outletParam) {
      setConfOutlet(ALL_OUTLETS_CODE)
    }
  }, [loading, confOutlet, outletParam])

  // Stato placeholder: quante righe del preventivo sono provvisorie (copia
  // automatica dall'anno precedente, da confermare). Calcolato per anno
  // corrente, raggruppato per outlet (per badge BPCard) e totale (per banner).
  // placeholderStatus RIMOSSO: alimentava solo il banner "Preventivo provvisorio
  // / PROV", ora rimosso (il preventivo non è più precompilato dal bilancio).

  // ─── APPROVE / UNLOCK ──────────────────────────────────────
  const approveOutletYear = async (code: string) => {
    if (!CID) return
    setWorkflowBusy(true)
    try {
      const { data, error } = await supabase.rpc('approve_budget_outlet_year', { p_cost_center: code, p_year: year })
      if (error) throw error
      const n = typeof data === 'number' ? data : 0
      show(n > 0 ? `Preventivo ${code} approvato (${n} righe lockate)` : `Preventivo ${code} già approvato`)
      // Reload entries per riallineare workflow
      const { data: reloaded } = await supabase
        .from('budget_entries').select('*')
        .eq('company_id', CID).eq('year', year)
        .range(0, 9999)
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
      const { data, error } = await supabase.rpc('unlock_budget_outlet_year', { p_cost_center: code, p_year: year, p_reason: reason })
      if (error) throw error
      const n = typeof data === 'number' ? data : 0
      show(n > 0 ? `Preventivo ${code} sbloccato (${n} righe)` : `Preventivo ${code} già sbloccato`)
      const { data: reloaded } = await supabase
        .from('budget_entries').select('*')
        .eq('company_id', CID).eq('year', year)
        .range(0, 9999)
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
      if (!Object.keys(costEdits).length) { show('Inserisci almeno un costo o un ricavo', 'error'); setSaving(false); return }

      // Unisci: costi editati + ricavi (dal bilancio + eventuali override Lilian/Sabrina sulle foglie VdP)
      const filteredRicavi = filterRicaviTree(ricaviTree, code)
      const filteredRicaviWithEdits = applyEdits(filteredRicavi, costEdits)
      const ricaviLeaves = flattenLeaves(filteredRicaviWithEdits)
      const ricaviCodes = new Set(Object.keys(ricaviLeaves))
      const allEntries = { ...costEdits }
      Object.entries(ricaviLeaves).forEach(([ac, amt]) => { allEntries[ac] = amt })

      const entries = Object.entries(allEntries).map(([ac, amt]) => {
        const months = splitMonthly(amt as number)
        return Array.from({ length: 12 }, (_, i) => ({
          company_id: CID, account_code: ac, account_name: ac, macro_group: 'CE',
          cost_center: code, year, month: i + 1,
          budget_amount: months[i], is_approved: false,
        }))
      }).flat()
      const { error } = await supabase.from('budget_entries').upsert(entries as never, { onConflict: 'company_id,account_code,cost_center,year,month' })
      if (error) throw error

      // NB: i RICAVI mensili (budget_confronto.rev_monthly/cons_monthly) NON vengono
      // più toccati da questo salvataggio. Lilian li inserisce a mano mese per mese in
      // PrevVsCons / Inserimento Rapido; nessuno spalma /12 automatico li sovrascrive.
      // In particolare i valori GRANITICI (cons_monthly) restano intoccati: si
      // modificano solo per azione esplicita dell'utente.
      const nCosti = Object.keys(costEdits).filter(k => !ricaviCodes.has(k)).length
      show(`Preventivo ${code} salvato ✓ (${nCosti} costi + ${Object.keys(ricaviLeaves).length} ricavi)`)
    } catch (e: unknown) { show((e as Error).message, 'error') } finally { setSaving(false) }
  }

  // ─── AUTOSAVE PER-CONTO ANNUALE (on blur, card preventivo) ──────────
  // Patrizio 01/06/2026: nella card annuale i costi si salvavano solo col
  // bottone "Salva" → se l'utente cambiava outlet/pagina perdeva i dati.
  // Ora ogni cella costo salva da sola al blur, persistendo SOLO quel conto
  // (12 righe budget_entries spalmate con splitMonthly). NON tocca i ricavi
  // né rev_monthly (quelli restano gestiti dal bottone Salva, che avvisa che
  // sovrascrive le distribuzioni mensili manuali).
  const saveAnnualCostAccount = async (outletCode: string, accountCode: string, value: number) => {
    if (!CID) throw new Error('CID mancante')
    const months = splitMonthly(value)
    const rows = Array.from({ length: 12 }, (_, i) => ({
      company_id: CID, account_code: accountCode, account_name: accountCode, macro_group: 'CE',
      cost_center: outletCode, year, month: i + 1,
      budget_amount: months[i], is_approved: false,
    }))
    const { error } = await supabase.from('budget_entries').upsert(rows as never, { onConflict: 'company_id,account_code,cost_center,year,month' })
    if (error) throw error
  }

  // ─── SAVE CONFRONTO (annuale + mensile) ────────────────────
  // ─── SAVE PER-CELLA (autosave on blur, no Click 'Salva confronto' necessario) ───
  // Patrizio 29/05/2026: Lilian inserisce Barberino, cambia outlet senza Salva,
  // dati persi. Fix: ogni cella salva da sola al blur. Indicatore '✓' inline.
  const saveCellMonthly = async (
    outletCode: string,
    accCode: string,
    monthIdx: number,
    value: number,
    entryType: 'prev_monthly' | 'rev_monthly' | 'cons_monthly',
  ) => {
    if (!CID) throw new Error('CID mancante')
    // DELETE riga vecchia (idempotente)
    await supabase.from('budget_confronto').delete()
      .eq('company_id', CID).eq('cost_center', outletCode)
      .eq('account_code', accCode).eq('year', year)
      .eq('month', monthIdx + 1).eq('entry_type', entryType)
    // INSERT solo se valore non zero (mantiene tabella pulita)
    if (value !== 0) {
      const { error } = await supabase.from('budget_confronto').insert({
        company_id: CID,
        cost_center: outletCode,
        account_code: accCode,
        year,
        month: monthIdx + 1,
        entry_type: entryType,
        amount: value,
        // cons_monthly = consuntivo reale del mese chiuso = granitico; il resto è preventivo
        stato: entryType === 'cons_monthly' ? 'granitico' : 'preventivo',
        updated_at: new Date().toISOString(),
      } as never)
      if (error) throw error
    }
  }

  const saveConfronto = async (outletCode: string) => {
    setSaving(true)
    try {
      type CfInsertRow = { company_id: string; cost_center: string; account_code: string; year: number; month: number; entry_type: string; amount: number; rettifica_amount?: number | null; rettifica_pct?: number | null; stato?: string; updated_at: string }
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
          if (typeof v === 'number' && v !== 0 && CID) rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: mi + 1, entry_type: 'cons_monthly', amount: v, stato: 'granitico', updated_at: new Date().toISOString() })
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

      if (!CID) return
      // ─── SALVATAGGIO NON DISTRUTTIVO (NO DATA LOSS, ticket 9bf52ecc) ──────
      // Il vecchio codice faceva delete(company+cost_center+year) + insert(stato):
      // se lo stato React era parziale cancellava in silenzio i dati MANUALI di
      // Lilian. Ora leggo lo stato attuale del DB e applico SOLO il diff:
      //  • upsert mirato delle celle nuove/cambiate (onConflict sulla unique key);
      //  • cancellazione delle SOLE chiavi che l'utente ha svuotato, e solo dopo
      //    conferma esplicita (modale con riepilogo righe/totale prima→dopo).
      // Mai più un delete in blocco di righe non toccate dall'utente.
      const { data: existingData, error: exErr } = await supabase
        .from('budget_confronto')
        .select('id, entry_type, account_code, month, amount, rettifica_amount, rettifica_pct')
        .eq('company_id', CID).eq('cost_center', outletCode).eq('year', year)
        .range(0, 9999)
      if (exErr) throw exErr
      const diff = computeConfrontoDiff(rows as ConfrontoRow[], (existingData || []) as ExistingConfrontoRow[])

      if (diff.toUpsert.length === 0 && diff.toDeleteIds.length === 0) {
        show('Nessuna modifica da salvare'); setSaving(false); return
      }
      if (diff.toDeleteIds.length > 0) {
        // Conferma esplicita prima di rimuovere qualsiasi cella esistente.
        setConfirmAction({
          title: `Sovrascrivi Confronto — ${outletCode}`,
          message: `Righe ${diff.countBefore} → ${diff.countAfter} · Totale € ${fmt(diff.totalBefore)} → € ${fmt(diff.totalAfter)}. Verranno rimosse ${diff.toDeleteIds.length} righe svuotate${diff.toUpsert.length ? ` e aggiornate ${diff.toUpsert.length}` : ''}. Confermi?`,
          confirmLabel: 'Sovrascrivi',
          action: () => commitConfronto(outletCode, diff),
        })
        setSaving(false); return
      }
      // Solo aggiunte/modifiche → upsert mirato, nessuna cancellazione.
      await commitConfronto(outletCode, diff)
    } catch (e: unknown) { show((e as Error).message, 'error') } finally { setSaving(false) }
  }

  // Esegue il diff calcolato da saveConfronto: upsert mirato (onConflict sulla
  // unique key) + cancellazione SOLO delle chiavi esplicitamente confermate.
  const commitConfronto = async (outletCode: string, diff: ConfrontoDiff) => {
    if (!CID) return
    setSaving(true)
    try {
      if (diff.toDeleteIds.length > 0) {
        const { error: delErr } = await supabase.from('budget_confronto').delete().in('id', diff.toDeleteIds)
        if (delErr) throw delErr
      }
      if (diff.toUpsert.length > 0) {
        const { error: upErr } = await supabase.from('budget_confronto')
          .upsert(diff.toUpsert as never, { onConflict: 'company_id,cost_center,account_code,year,month,entry_type' })
        if (upErr) throw upErr
      }
      show(`Confronto ${outletCode} salvato ✓ (${diff.toUpsert.length} agg., ${diff.toDeleteIds.length} rim.)`)
    } catch (e: unknown) { show((e as Error).message, 'error') } finally { setSaving(false) }
  }

  // ─── MAPPA RICAVI → OUTLET ─────────────────────────────────
  // Sprint 3 (Patrizio 29/05/2026): mappa DINAMICA da chart_of_accounts.outlet_link.
  // Caricata da DB nella useEffect principale (vedi `coaR.data` con field `outlet_link`).
  // Su NZ: 8 codici mappati (51010101, 510107..510124). Su Made/Zago: vuoto finche'
  // non vengono popolati i propri corrispettivi outlet.
  const RICAVI_OUTLET_MAP = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    ;(ceRawCosti.concat(ceRawRicavi) as Array<{ code?: string; outlet_link?: string | null }>)
      .forEach(c => { if (c.code && c.outlet_link) m[c.code] = c.outlet_link })
    return m
  }, [ceRawCosti, ceRawRicavi])

  // Codici corrispettivi outlet (da escludere per gli altri)
  const OUTLET_CORRISP_CODES = useMemo(() => new Set(Object.keys(RICAVI_OUTLET_MAP)), [RICAVI_OUTLET_MAP])

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
  type ConfirmActionT = { title: string; message: string; action: () => void | Promise<void>; confirmLabel?: string } | null
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

  // clearAll() RIMOSSA: faceva un DELETE in blocco di tutti i budget_entries di
  // tutti gli outlet dell'anno (rischio data-loss). Lo svuotamento per-outlet
  // resta disponibile sulle singole card.

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

  // Somma annuale ricavi per outlet+account_code, REGOLA GRANITICO/PREVENTIVO:
  // per ogni mese usa il valore GRANITICO (consuntivo reale, consMonthly) se presente,
  // altrimenti il PREVENTIVO (revMonthly). Coerente con budget_confronto.stato.
  // Usato da BPCard per il "Totale Valore Produzione".
  const revYearlyByOutlet: Record<string, Record<string, number>> = {}
  const outletCodesRicavi = new Set<string>([...Object.keys(revMonthly), ...Object.keys(consMonthly)])
  outletCodesRicavi.forEach(outletCode => {
    const prevByCode = revMonthly[outletCode] || {}
    const consByCode = consMonthly[outletCode] || {}
    const accCodes = new Set<string>([...Object.keys(prevByCode), ...Object.keys(consByCode)])
    accCodes.forEach(accCode => {
      const prevArr = prevByCode[accCode] || []
      const consArr = consByCode[accCode] || []
      let sum = 0
      for (let mi = 0; mi < 12; mi++) {
        const cons = typeof consArr[mi] === 'number' ? consArr[mi] : 0
        const prev = typeof prevArr[mi] === 'number' ? prevArr[mi] : 0
        // granitico (consuntivo del mese chiuso) vince sul preventivo quando presente
        sum += cons !== 0 ? cons : prev
      }
      if (sum !== 0) {
        if (!revYearlyByOutlet[outletCode]) revYearlyByOutlet[outletCode] = {}
        revYearlyByOutlet[outletCode][accCode] = sum
      }
    })
  })

  // ─── Allocazione imposte (Sede 10% fisso + 90% outlet aperti pro-quota ricavi) ──
  // Stessa logica di ripartizione dei costi sede: riusa sedeQuota(). "Outlet aperti" =
  // ops (cost_centers.role='outlet', già filtrati is_active al load). Edge case: nessun
  // ricavo outlet nel periodo → l'intero importo resta su Sede (no divisione per zero).
  // imposteByCenter[code] = quota POSITIVA allocata a quel centro (Sede o singolo outlet).
  const imposteByCenter: Record<string, number> = (() => {
    const total = imposteAmount || 0
    const outletRev: Record<string, number> = {}
    ops.forEach(o => {
      outletRev[o.code] = Object.values(revYearlyByOutlet[o.code] || {}).reduce<number>((s, v) => s + (Number(v) || 0), 0)
    })
    const ricaviTot = ops.reduce<number>((s, o) => s + (outletRev[o.code] || 0), 0)
    const byCenter: Record<string, number> = {}
    if (total !== 0 && ricaviTot > 0) {
      byCenter[HQ_CODE] = total * 0.10
      const quota90 = total * 0.90
      ops.forEach(o => { byCenter[o.code] = sedeQuota(quota90, outletRev[o.code] || 0, ricaviTot) })
    } else {
      // Nessun outlet con ricavi → tutto su Sede (o importo 0). Niente NaN/Infinity.
      byCenter[HQ_CODE] = total
      ops.forEach(o => { byCenter[o.code] = 0 })
    }
    return byCenter
  })()

  // Persistenza imposte (upsert idempotente su company_id,year). Autosave on-blur
  // dell'input nella vista aggregata; toast custom (mai dialog nativi).
  const saveImposte = async (val: number) => {
    if (!CID) return
    const { error } = await supabase.from('imposte_annuali').upsert(
      { company_id: CID, year, amount: val, updated_at: new Date().toISOString() } as never,
      { onConflict: 'company_id,year' },
    )
    if (error) { show(`Errore salvataggio imposte: ${error.message}`, 'error'); throw error }
    show(`Imposte ${year} salvate ✓ (${fmtC(val)})`)
  }

  // Totali tab Business Plan: STESSA priorita' della BPCard (costi zero-based;
  // ricavi = mensile -> edit annuale BPCard -> 0), sommati SOLO sulle card
  // effettivamente renderizzate (rispetta il filtro read-only che nasconde le bozze),
  // cosi' il "TOTALE COMPLESSIVO" combacia con la somma di cio' che si vede.
  const bpTotals = (() => {
    const renderedCodes: string[] = []
    if (hq && hasTree) {
      const st = workflow[HQ_CODE]?.status ?? 'bozza'
      if (canApproveBudget || st !== 'bozza') renderedCodes.push(HQ_CODE)
    }
    ops.forEach(cc => {
      const st = workflow[cc.code]?.status ?? 'bozza'
      if (canApproveBudget || st !== 'bozza') renderedCodes.push(cc.code)
    })
    const revForCenter = (code: string): number => {
      const rev = revYearlyByOutlet[code]
      const ed = bpEdits[code] || {}
      const walk = (nodes: TreeNodeT[]): number => nodes.reduce<number>((s, n) => {
        if (n.children?.length) return s + walk(n.children)
        if (rev && rev[n.code] != null) return s + rev[n.code]
        if (ed[n.code] != null) return s + ed[n.code]
        return s
      }, 0)
      return walk(filterRicaviTree(ricaviTree, code))
    }
    let ric = 0, cos = 0
    renderedCodes.forEach(code => {
      ric += revForCenter(code)
      cos += sumMacros(applyEditsZero(costiTree, bpEdits[code] || {}))
    })
    return { ric, cos, ris: ric - cos, count: renderedCodes.length }
  })()

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Budget & Controllo"
        subtitle={`Business Plan preventivo/consuntivo per ${labels.pointOfSaleLower}`}
        actions={
          <>
            <span className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold bg-slate-50">{year}</span>
            {/* Rimosso il bottone "Aggiorna consuntivo" e il timestamp di refresh:
                il consuntivo (ricavi e costi) è ciò che Lilian inserisce nel tab
                "Preventivo vs Consuntivo", NON ciò che la RPC calcola dalle
                fatture/POS. La funzione refreshConsuntivo e la RPC restano nel
                codice/DB ma non sono più invocate da questa pagina. */}
          </>
        }
      />

      {/* Banner "Consuntivo da aggiornare / mai calcolato → Aggiorna ora" RIMOSSO:
          spingeva a calcolare il consuntivo dalle fatture/POS via RPC, in
          contraddizione col principio (il consuntivo lo inserisce Lilian nel tab
          "Preventivo vs Consuntivo"). consuntivoMeta/refreshConsuntivo restano
          definiti ma non più usati nella UI di questa pagina. */}

      {/* TABS */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {([
          { id:'bp', label:'Business Plan', icon:Target },
          { id:'confronto', label:'Preventivo vs Consuntivo', icon:BarChart3 },
          { id:'rapido', label:'Inserimento Rapido', icon:Zap },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition ${tab===t.id?'bg-white text-indigo-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {/* Banner "Preventivo provvisorio / PROV" RIMOSSO: il preventivo non è più
          precompilato dal bilancio anno precedente; ricavi e consuntivo vengono
          da Budget & Controllo (tab "Preventivo vs Consuntivo"). */}

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
            <Kpi icon={TrendingUp} label="Voci piano dei conti" value={hasTree ? `${ceRawCosti.length+ceRawRicavi.length} voci` : 'Non trovato'} color={hasTree?'green':'amber'} />
            <Kpi icon={BarChart3} label="Budget salvati" value={budgetEntries.length} color="blue" />
            <Kpi icon={Target} label="Anno" value={year} color="purple" />
          </div>

          {!hasTree && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800"><strong>Struttura del piano dei conti non trovata.</strong> Importa dal Conto Economico per la struttura conti.</div>
            </div>
          )}

          {/* Legenda solo se una card renderizzata (HQ o outlet) ha un marcatore costi. */}
          {[HQ_CODE, ...ops.map(o => o.code)].some(c => phCostByCenter[c]) && <PlaceholderLegend />}

          {/* Banner "Compila i costi previsti" + bottone "Cancella tutti" RIMOSSI:
              il testo sui ricavi dal bilancio anno precedente era ormai falso
              (ricavi e consuntivo vengono da Budget & Controllo), e "Cancella tutti"
              faceva un DELETE in blocco di tutti gli outlet (rischio data-loss).
              Il bottone per-outlet "Cancella costi" sulle card resta invariato. */}

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
                onUnlock={() => setUnlockDialog({ code: HQ_CODE, label: hq.label || HQ_CODE })}
                onSaveAccount={(ac, v) => saveAnnualCostAccount(HQ_CODE, ac, v)}
                revYearlyFromMonthly={revYearlyByOutlet[HQ_CODE]}
                costHasPlaceholder={!!phCostByCenter[HQ_CODE]} />
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
                onUnlock={() => setUnlockDialog({ code: cc.code, label: prettyCenterLabel(cc) })}
                onSaveAccount={(ac, v) => saveAnnualCostAccount(cc.code, ac, v)}
                revYearlyFromMonthly={revYearlyByOutlet[cc.code]}
                costHasPlaceholder={!!phCostByCenter[cc.code]} />
            )
          })}

          {/* TOTALE COMPLESSIVO: somma su tutte le card renderizzate (Sede + outlet),
              stessa priorita' della BPCard cosi' i totali combaciano con le card visibili. */}
          {hasTree && bpTotals.count > 0 && (
            <div className="bg-slate-50 rounded-xl border-2 border-slate-300 shadow-sm px-5 py-4">
              <div className="flex items-center justify-between gap-5 flex-wrap">
                <div className="font-bold text-slate-700">TOTALE COMPLESSIVO <span className="text-xs font-normal text-slate-400 ml-1">({bpTotals.count} {bpTotals.count === 1 ? 'scheda' : 'schede'})</span></div>
                <div className="flex items-center gap-5">
                  <div className="text-right"><div className="text-xs text-slate-400">{RICAVI_SOURCE_LABEL}</div><div className="font-bold text-emerald-700">{fmtC(bpTotals.ric)}</div></div>
                  <div className="text-right"><div className="text-xs text-slate-400">Costi (preventivo)</div><div className="font-bold text-red-700">{fmtC(bpTotals.cos)}</div></div>
                  <div className="text-right"><div className="text-xs text-slate-400">Risultato</div><div className={`font-bold ${bpTotals.ris >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtC(bpTotals.ris)}</div></div>
                </div>
              </div>
            </div>
          )}
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
                  <option value={ALL_OUTLETS_CODE}>📊 Tutti gli {labels.pointOfSalePluralLower} (vista aggregata)</option>
                  {hq && <option value={HQ_CODE}>🏢 {prettyCenterLabel(hq)}</option>}
                  {/* Tutti gli outlet operativi attivi (non solo quelli con preventivo
                      gia' popolato in budget_entries). Outlet senza preventivo (es. Torino
                      neoaperto 24/03/2026) appare comunque, pronto per data entry da Lilian. */}
                  {(canApproveBudget
                    ? ops
                    : ops.filter(cc => (workflow[cc.code]?.status ?? 'bozza') !== 'bozza')
                  ).map(cc => <option key={cc.code} value={cc.code}>{prettyCenterLabel(cc)}</option>)}
                </select>
                <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                  {([{k:'annuale',l:'Annuale'},{k:'mensile',l:'Mensile'}] as const).map(v => (
                    <button key={v.k} onClick={() => setConfView(v.k)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${confView===v.k?'bg-white text-indigo-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
                      {v.l}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex gap-2 flex-wrap">
                  {/* Esporta bilancio: sempre visibile (anche per CEO read-only) */}
                  <button onClick={() => setExportDialogOpen(true)}
                    className="px-3 py-2 border border-emerald-200 text-emerald-700 bg-emerald-50 rounded-lg text-sm font-medium hover:bg-emerald-100 flex items-center gap-1.5"
                    title="Genera file Excel con bilancio consuntivo per il periodo scelto">
                    <FileSpreadsheet size={14} /> Esporta bilancio
                  </button>
                  {canApproveBudget && confOutlet !== ALL_OUTLETS_CODE && (
                    <>
                      <button onClick={() => confView === 'annuale' ? clearConfrontoAnnuale(confOutlet) : clearConfrontoMensile(confOutlet)}
                        className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 flex items-center gap-1.5">
                        <Trash2 size={14} /> Svuota {confView === 'annuale' ? 'annuale' : 'mensile'}
                      </button>
                      <button onClick={() => saveConfronto(confOutlet)} disabled={saving}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                        <Save size={14} /> {saving ? 'Salvo...' : 'Salva confronto'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Banner informativo per vista aggregata "Tutti gli outlet" */}
              {confOutlet === ALL_OUTLETS_CODE && (
                <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                  <Info size={18} className="text-indigo-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-indigo-900 flex-1">
                    <strong>Vista aggregata di tutti gli {labels.pointOfSalePluralLower}.</strong>
                    {' '}I valori qui sotto sono la <strong>somma</strong> di preventivo, consuntivo e rettifica di {aggregatedConfrontoEdits.outletCount} {aggregatedConfrontoEdits.outletCount === 1 ? labels.pointOfSaleLower : labels.pointOfSalePluralLower}{aggregatedConfrontoEdits.sedeIncluded ? ' + la Sede' : ''}.
                    {' '}Per modificare i valori di un singolo {labels.pointOfSaleLower}, selezionalo dal menu sopra.
                  </div>
                </div>
              )}

              {/* Vista aggregata: solo "annuale" supportata in v1 */}
              {confOutlet === ALL_OUTLETS_CODE && confView === 'mensile' && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-amber-800">
                    La vista mensile aggregata non è ancora disponibile. Seleziona un singolo {labels.pointOfSaleLower} per la vista mensile, oppure passa alla vista <strong>Annuale</strong>.
                  </div>
                </div>
              )}

              {/* Pannello annuale: vista aggregata "Tutti gli outlet" */}
              {confOutlet === ALL_OUTLETS_CODE && confView === 'annuale' && (() => {
                // Aggrega revMonthly e consMonthly su tutti gli outlet (code -> 12 mesi sommati)
                const aggMonthly = (src: typeof revMonthly): Record<string, number[]> => {
                  const out: Record<string, number[]> = {}
                  Object.values(src).forEach(byCode => {
                    if (!byCode) return
                    Object.entries(byCode).forEach(([code, arr]) => {
                      if (!out[code]) out[code] = Array(12).fill(0) as number[]
                      ;(arr || []).forEach((v, i) => { out[code][i] += (typeof v === 'number' ? v : 0) })
                    })
                  })
                  return out
                }
                return (
                <ConfrontoPanel
                  outletCode={ALL_OUTLETS_CODE}
                  outletLabel={`Tutti gli ${labels.pointOfSalePluralLower}${aggregatedConfrontoEdits.sedeIncluded ? ' + Sede' : ''} (${aggregatedConfrontoEdits.outletCount}${aggregatedConfrontoEdits.sedeIncluded ? '+1' : ''})`}
                  prevEdits={aggregatedConfrontoEdits.prev}
                  consEdits={aggregatedConfrontoEdits.cons}
                  onConsEdit={() => { /* read-only nella vista aggregata */ }}
                  rettEdits={aggregatedConfrontoEdits.rett}
                  onRettEdit={() => { /* read-only nella vista aggregata */ }}
                  costiTree={costiTree}
                  ricaviTree={ricaviTree}
                  year={year}
                  revMonthlyOutlet={aggMonthly(revMonthly)}
                  consMonthlyOutlet={aggMonthly(consMonthly)}
                  prevHasPlaceholder={Object.keys(phCostByCenter).length > 0}
                  // Imposte: vista aggregata = importo annuale TOTALE, editabile da Lilian.
                  imposteAmount={imposteAmount}
                  imposteEditable={canApproveBudget}
                  onImposteEdit={(v) => setImposteAmount(v)}
                  onImposteCommit={saveImposte}
                />
                )
              })()}

              {/* Pannello annuale: vista singolo outlet o "Sede / Costi generali" (cost_center='all').
                  Usa costiTreeForOutlet/ricaviTreeForOutlet per mostrare SOLO i valori
                  del cost_center selezionato (strategia C: nessuna ripartizione automatica). */}
              {confOutlet && confOutlet !== ALL_OUTLETS_CODE && confView === 'annuale' && (
                <ConfrontoPanel
                  outletCode={confOutlet}
                  outletLabel={prettyCenterLabel(costCenters.find(c => c.code === confOutlet)) || prettyCenterLabel({ code: confOutlet })}
                  prevEdits={bpEdits[confOutlet] || {}}
                  consEdits={consEdits[confOutlet] || {}}
                  onConsEdit={(code: string, val: number) => setConsEdits(prev => ({...prev, [confOutlet]: {...(prev[confOutlet]||{}), [code]: val}}))}
                  rettEdits={rettEdits[confOutlet] || {}}
                  onRettEdit={(code: string, val: number | string | undefined) => setRettEdits(prev => ({...prev, [confOutlet]: {...(prev[confOutlet]||{}), [code]: (typeof val === 'number' ? val : 0)}}))}
                  costiTree={costiTreeForOutlet}
                  ricaviTree={ricaviTreeForOutlet}
                  year={year}
                  revMonthlyOutlet={revMonthly[confOutlet]}
                  consMonthlyOutlet={consMonthly[confOutlet]}
                  prevHasPlaceholder={!!phCostByCenter[confOutlet]}
                  // Preventivo costi editabile qui (singolo outlet), come nel tab Business Plan:
                  // live su bpEdits, persistenza on-blur in budget_entries. Bloccato se preventivo
                  // approvato o utente senza permesso (coerente con la card BP).
                  onPrevEdit={(!canApproveBudget || workflow[confOutlet]?.status === 'approvato')
                    ? undefined
                    : (code: string, val: number) => setBpEdits(prev => ({...prev, [confOutlet]: {...(prev[confOutlet]||{}), [code]: val}}))}
                  onPrevCommit={(!canApproveBudget || workflow[confOutlet]?.status === 'approvato')
                    ? undefined
                    : (code: string, val: number) => saveAnnualCostAccount(confOutlet, code, val)}
                  // Imposte: singolo outlet / Sede = quota allocata, sempre READ-ONLY.
                  imposteAmount={imposteByCenter[confOutlet] ?? 0}
                  imposteEditable={false}
                />
              )}
              {confOutlet && confOutlet !== ALL_OUTLETS_CODE && confView === 'mensile' && (
                <ConfrontoMensile
                  outletCode={confOutlet}
                  outletLabel={prettyCenterLabel(costCenters.find(c => c.code === confOutlet)) || prettyCenterLabel({ code: confOutlet })}
                  costiTree={costiTreeForOutlet}
                  ricaviTree={ricaviTreeForOutlet}
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
                  // Autosave per-cella: ogni input mensile (prev/rev/cons/rett)
                  // salva su DB on blur. No click 'Salva confronto' necessario.
                  onCommitPrev={async (code, mi, val) => { await saveCellMonthly(confOutlet, code, mi, val, 'prev_monthly') }}
                  onCommitRev={async (code, mi, val) => { await saveCellMonthly(confOutlet, code, mi, val, 'rev_monthly') }}
                  onCommitCons={async (code, mi, val) => { await saveCellMonthly(confOutlet, code, mi, val, 'cons_monthly') }}
                  onCommitRett={async (code, mi, val) => {
                    if (!CID) return
                    await supabase.from('budget_confronto').delete()
                      .eq('company_id', CID).eq('cost_center', confOutlet)
                      .eq('account_code', code).eq('year', year)
                      .eq('month', mi + 1).eq('entry_type', 'rett_monthly')
                    if (val !== 0) {
                      const pvNow = (prevMonthly[confOutlet]?.[code] || [])[mi] || 0
                      const pct = pvNow !== 0 ? (val / pvNow) * 100 : null
                      await supabase.from('budget_confronto').insert({
                        company_id: CID, cost_center: confOutlet, account_code: code, year,
                        month: mi + 1, entry_type: 'rett_monthly', amount: val,
                        rettifica_amount: val, rettifica_pct: pct,
                        updated_at: new Date().toISOString(),
                      } as never)
                    }
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════
         TAB 3: INSERIMENTO RAPIDO — matrice 7 outlet x 2 righe (prev/cons)
         per il mese selezionato. SOLO input. Niente scostamenti / percentuali
         (quelli stanno nelle altre tab). Save on blur su budget_confronto.
         ════════════════════════════════════════════════════ */}
      {tab === 'rapido' && CID && (
        <InserimentoRapidoMatrice
          year={year}
          companyId={CID}
          outlets={Object.entries(RICAVI_OUTLET_MAP)
            .filter(([, outletCode]) => outletCode !== 'sede_magazzino')
            .map(([accCode, outletCode]) => {
              const cc = costCenters.find(c => c.code === outletCode)
              return {
                code: outletCode,
                label: cc ? prettyCenterLabel(cc) : outletCode,
                accountCode: accCode,
              }
            })}
          phRevByCenterMonth={phRevByCenterMonth}
        />
      )}

      {/* CONFIRM DIALOG */}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          onConfirm={() => { confirmAction.action(); setConfirmAction(null) }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* APPROVE DIALOG */}
      {approveDialog && (
        <ApproveDialog
          outletLabel={approveDialog.label}
          year={year}
          working={workflowBusy}
          onCancel={() => { if (!workflowBusy) setApproveDialog(null) }}
          onConfirm={() => approveOutletYear(approveDialog.code)}
        />
      )}

      {/* UNLOCK DIALOG */}
      {unlockDialog && (
        <UnlockDialog
          outletLabel={unlockDialog.label}
          year={year}
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

      {/* EXPORT BILANCIO DIALOG */}
      <ExportBilancioDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        budgetEntries={budgetEntries}
        operativeOutlets={ops}
        hq={hq ?? null}
        revMonthly={revMonthly}
        consMonthly={consMonthly}
        coaCosti={ceRawCosti}
        coaRicavi={ceRawRicavi}
        year={year}
        tenantName={company?.name || 'Tenant'}
        tenantCode={getCurrentTenant().alias}
        userEmail={(profile as { email?: string } | null)?.email || ''}
      />
      </div>
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
  // Autosave on-blur per singolo conto costo annuale (budget_entries), senza
  // attendere il bottone Salva. Evita perdita dati se l'utente cambia outlet/
  // pagina dopo aver digitato. (Patrizio 01/06/2026)
  onSaveAccount?: (accountCode: string, value: number) => Promise<void>
  // Somma annuale dei ricavi mensili (da budget_confronto.rev_monthly per questo outlet).
  // Se presente per un codice ricavo, sovrascrive il valore del bilancio come default.
  // L'edit utente in edits[code] ha sempre priorita' (applyEdits lo gestisce).
  revYearlyFromMonthly?: Record<string, number>
  // true se i costi a budget di questo outlet contengono righe segnaposto (clone 2025)
  costHasPlaceholder?: boolean
}
function BPCard({ label, code, isHQ, numOps: _numOps, costiTree, ricaviTree, edits, setEdits, onClear, onSave, saving, color, year, workflowStatus, workflowMeta, canApprove, onApprove, onUnlock, onSaveAccount, revYearlyFromMonthly, costHasPlaceholder }: BPCardProps) {
  const [open, setOpen] = useState(false)

  const isLocked = workflowStatus === 'approvato'
  // Lettura sola = non può approvare OPPURE preventivo già lockato
  const readOnly = !canApprove || isLocked

  // COSTI: partono da ZERO, l'operatore compila manualmente
  const editedC = applyEditsZero(costiTree, edits)
  // RICAVI / Valore della Produzione: PARTONO DA ZERO. Si popolano per priorita':
  //   1. revYearlyFromMonthly[code] (somma 12 mesi salvati in budget_confronto.rev_monthly)
  //   2. edits[code] (override esplicito digitato in questo BPCard, NON ancora salvato)
  //   3. 0
  // Il mensile VINCE sull'edit annuale BPCard se entrambi presenti, per coerenza
  // con ConfrontoPanel. Bug 29/05/2026: prima edits[code] vinceva e Lilian
  // dopo aver salvato nel Confronto Mensile (-> budget_confronto) vedeva ancora
  // il vecchio bpEdits (budget_entries placeholder) -> pensava "non si e' salvato".
  // Edit annuale qui -> spalmato /12 in budget_confronto.rev_monthly al saveBP.
  const apply = (nodes: TreeNodeT[]): TreeNodeT[] => nodes.map(n => {
    const kids = n.children?.length ? apply(n.children) : []
    let amt: number
    if (kids.length > 0) {
      amt = kids.reduce<number>((s, c) => s + (c.amount || 0), 0)
    } else if (revYearlyFromMonthly && revYearlyFromMonthly[n.code] != null) {
      amt = revYearlyFromMonthly[n.code]
    } else if (edits[n.code] != null) {
      amt = edits[n.code]
    } else {
      amt = 0
    }
    return { ...n, children: kids, amount: amt }
  })
  const editedR = apply(ricaviTree)
  const totC = sumMacros(editedC)
  const totR = sumMacros(editedR)
  const ris = totR - totC
  const hasEdits = Object.keys(edits).length > 0
  // Flag: c'e' almeno un valore da mensile -> ridenominazione label
  const hasMonthlySum = revYearlyFromMonthly && Object.keys(revYearlyFromMonthly).length > 0

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
          <div className="text-right"><div className="text-xs text-slate-400">{RICAVI_SOURCE_LABEL}</div><div className="font-semibold text-emerald-600">{fmtC(totR)}</div></div>
          <div className="text-right"><div className="text-xs text-slate-400">Costi (preventivo)</div><div className="font-semibold text-red-600">{fmtC(totC)}<PlaceholderDot show={!!costHasPlaceholder} tip="I costi a budget di questo outlet contengono voci segnaposto (clone 2025) non ancora granite: apri la card e compila/conferma i valori." /></div></div>
          <div className="text-right"><div className="text-xs text-slate-400">Risultato</div><div className={`font-bold ${ris>=0?'text-emerald-700':'text-red-700'}`}>{fmtC(ris)}</div></div>
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
              {readOnly ? 'Visualizzazione preventivo' : 'Compila i costi previsti'} — i ricavi vengono dall'inserimento rapido (PrevVsCons), inseriti mese per mese
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
                  : editedC.map((n, i) => <TreeNodeEdit key={`${n.code}-${i}`} node={n} edits={edits} onEdit={onEdit} onCommitAccount={onSaveAccount} />)}
              </div>
              <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                <span className="text-sm font-bold">TOTALE COSTI</span>
                <span className="text-sm font-bold text-red-600">{fmtC(totC)}</span>
              </div>
            </div>
            {/* RICAVI / Valore della Produzione — SEMPRE sola lettura: i ricavi
                arrivano dall'inserimento rapido mese per mese (PrevVsCons),
                granitico-se-presente-altrimenti-preventivo. Nessun edit/spalma qui. */}
            <div>
              <div className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                Valore della Produzione <Lock size={11} className="text-slate-400" />
                <span className="text-emerald-400 normal-case font-normal text-[10px]">
                  {hasMonthlySum
                    ? `(somma dei mesi inseriti in PrevVsCons)`
                    : `(da compilare — inserisci i mesi in PrevVsCons)`}
                </span>
              </div>
              <div className="border rounded-lg p-1.5 max-h-[500px] overflow-y-auto border-emerald-100 bg-emerald-50/30">
                {editedR.map((n, i) => <TreeNodeView key={`${n.code}-${i}`} node={n} />)}
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
  // Autosave per-cella (Patrizio 29/05/2026): on blur ogni input chiama queste
  // funzioni che fanno save su budget_confronto per la singola cella.
  // Se assenti, no autosave (modalita' Anno o readOnly).
  onCommitPrev?: (code: string, mi: number, val: number) => Promise<void>
  onCommitCons?: (code: string, mi: number, val: number) => Promise<void>
  onCommitRett?: (code: string, mi: number, val: number) => Promise<void>
}
// Props grid: code | descrizione | Prev | Cons | Rett € | Rett % | Scost | %dev | (copy)
const MONTHLY_COLS = '20px 60px 1fr 80px 80px 70px 60px 70px 55px 24px'

function MonthlyTreeNode({ node, depth = 0, prevByCode, consByCode, rettAmtByCode, rettPctByCode, onPrev, onCons, onRett, mese, monthly, onCopyToMonths, readOnly, onCommitPrev, onCommitCons, onCommitRett }: MonthlyTreeNodeProps) {
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
        <Tooltip content={node.description}>
          <span className={`truncate min-w-0 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[10px] text-slate-600'}`}>
            {prettifyAccountName(node.description)}
          </span>
        </Tooltip>
        {/* Preventivo */}
        {isLeaf && !readOnly && !isAnnualView ? (
          <NumberInputIt
            value={pv}
            onChange={n => onPrev(node.code, n)}
            onCommit={onCommitPrev ? (n => onCommitPrev(node.code, mese, n)) : undefined}
            onClickStop
            className="text-right px-1 py-0.5 text-[10px] border rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 border-slate-200"
            placeholder="0" />
        ) : (
          <span className={`tabular-nums text-right text-[10px] ${isMacro ? 'font-bold text-indigo-700' : 'text-indigo-500'}`}>{fmt(pv)}</span>
        )}
        {/* Consuntivo */}
        {isLeaf && !readOnly && !isAnnualView ? (
          <NumberInputIt
            value={cv}
            onChange={n => onCons(node.code, n)}
            onCommit={onCommitCons ? (n => onCommitCons(node.code, mese, n)) : undefined}
            onClickStop
            className="text-right px-1 py-0.5 text-[10px] border rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400 border-slate-200"
            placeholder="0" />
        ) : (
          <span className={`tabular-nums text-right text-[10px] ${isMacro ? 'font-bold text-emerald-700' : 'text-emerald-600'}`}>{fmt(cv)}</span>
        )}
        {/* Rettifica € (bidirezionale: scrivendo € ricalcola %) */}
        {isLeaf && !readOnly && !isAnnualView ? (
          <NumberInputIt
            value={ra}
            onChange={n => {
              const amount = n
              const pct = pv !== 0 ? (amount / pv) * 100 : 0
              onRett(node.code, amount, pct)
            }}
            onCommit={onCommitRett ? (n => onCommitRett(node.code, mese, n)) : undefined}
            onClickStop
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
          onCommitPrev={onCommitPrev} onCommitCons={onCommitCons} onCommitRett={onCommitRett}
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
  // Autosave per-cella (Patrizio 29/05/2026)
  onCommitPrev?: (code: string, mi: number, val: number) => Promise<void>
  onCommitRev?: (code: string, mi: number, val: number) => Promise<void>
  onCommitCons?: (code: string, mi: number, val: number) => Promise<void>
  onCommitRett?: (code: string, mi: number, val: number) => Promise<void>
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
  onCommitPrev, onCommitRev, onCommitCons, onCommitRett,
}: ConfrontoMensileProps) {
  // mese: -1 = Anno (12 mesi), 0..11 = mese singolo, 12..15 = Q1..Q4 (trimestri)
  // Q1 = mesi [0,1,2], Q2 = [3,4,5], Q3 = [6,7,8], Q4 = [9,10,11].
  // customRange: se settato (e mese=-2), usa quel range invece dei preset.
  // Patrizio 29/05/2026: 'fare confronto preventivo vs consuntivo scegliendo
  // un periodo, gennaio su gennaio o a gruppi di mesi' + range custom 'es. ho
  // i dati consuntivi da gennaio ad aprile e vorrei confrontarli con quanto
  // avevo previsto per lo stesso periodo'.
  const [mese, setMese] = useState<number>(0)
  const [customRange, setCustomRange] = useState<[number, number] | null>(null) // null = usa mese preset
  const monthsForPeriod = (m: number, range: [number, number] | null): number[] => {
    if (range) {
      const [from, to] = range
      const arr: number[] = []
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) arr.push(i)
      return arr
    }
    if (m === -1) return [0,1,2,3,4,5,6,7,8,9,10,11]
    if (m >= 12 && m <= 15) {
      const q = m - 12
      return [q*3, q*3+1, q*3+2]
    }
    if (m >= 0 && m <= 11) return [m]
    return []
  }
  const periodMonths = monthsForPeriod(mese, customRange)
  const isAggregateView = periodMonths.length > 1
  const isAnnualView = mese === -1 || isAggregateView

  // Estrae i dati per il periodo selezionato (singolo mese o somma di piu' mesi)
  const pickByMonth = (m: MonthlyMap): Record<string, number> => {
    const out: Record<string, number> = {}
    Object.entries(m).forEach(([code, arr]) => {
      if (!arr) return
      const sum = periodMonths.reduce<number>((s, mi) => s + (typeof arr[mi] === 'number' ? arr[mi] : 0), 0)
      if (sum !== 0) out[code] = sum
    })
    return out
  }
  const pickPctByMonth = (m: MonthlyMap, amounts: Record<string, number>, prevs: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {}
    Object.keys(m).forEach(code => {
      const arr = m[code]
      if (!arr) return
      if (isAggregateView) {
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

  // ROLLING FORECAST / Anno proiettato. Patrizio 29/05/2026: 'sommare ai dati
  // consuntivi fino ad aprile i valori di preventivo dei mesi successivi
  // per vedere quale sarebbe il nuovo risultato d esercizio'.
  // Per ogni mese, per ogni voce CE: se c'e' consuntivo > 0 -> usa quello,
  // altrimenti usa preventivo. Somma sui 12 mesi -> proiezione annua.
  const proietta = (consM: MonthlyMap, prevM: MonthlyMap, tree: TreeNodeT[]): number => {
    let t = 0
    const codes = new Set([...Object.keys(consM), ...Object.keys(prevM)])
    codes.forEach(code => {
      if (!isLeafCode(code, tree)) return
      for (let mi = 0; mi < 12; mi++) {
        const c = consM[code]?.[mi] || 0
        const p = prevM[code]?.[mi] || 0
        t += c > 0 ? c : p
      }
    })
    return t
  }
  const projRicavi = proietta(consMonthly, revMonthly, ricaviTree)
  const projCosti = proietta(consMonthly, prevMonthly, costiTree)
  const projResult = projRicavi - projCosti
  const annualResult = annualR - annualC
  const projDelta = projResult - annualResult
  // Conta i mesi che hanno dati consuntivi (ricavi o costi)
  const mesiConsuntivi = (() => {
    const set = new Set<number>()
    Object.values(consMonthly).forEach(arr => {
      arr?.forEach((v, mi) => { if (typeof v === 'number' && v > 0) set.add(mi) })
    })
    return Array.from(set).sort((a, b) => a - b)
  })()

  const labelMese = customRange
    ? `${MESI[customRange[0]]}-${MESI[customRange[1]]} ${year}`
    : mese === -1
      ? `Anno ${year}`
      : (mese >= 12 && mese <= 15)
        ? `Q${mese - 11} ${year}`
        : MESI[mese]

  return (
    <div className="space-y-6">
      {/* KPI scostamento mensile/annuale */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={Lock} label={`Preventivo ${labelMese}`} value={fmtC(ris)} color={ris >= 0 ? 'green' : 'red'} />
        <Kpi icon={Unlock} label={`Consuntivo ${labelMese}`} value={fmtC(totConsR - totConsC)} color={(totConsR - totConsC) >= 0 ? 'green' : 'red'} />
        <Kpi icon={TrendingDown} label="Scostamento costi" value={totC > 0 ? `${(scostC / totC * 100).toFixed(1)}%` : '—'} sub={fmtC(scostC)} color={scostC > 0 ? 'red' : 'green'} />
        <Kpi icon={TrendingUp} label="Scostamento ricavi" value={totR > 0 ? `${(scostR / totR * 100).toFixed(1)}%` : '—'} sub={fmtC(scostR)} color={scostR >= 0 ? 'green' : 'red'} />
        <Kpi icon={Target} label="Scostamento" value={fmtC(ris - (totConsR - totConsC))} color={(ris - (totConsR - totConsC)) >= 0 ? 'green' : 'red'} alert={Math.abs(scostTot) > Math.abs(ris) * 0.15} />
      </div>

      {/* ROLLING FORECAST - Anno proiettato (cons fino oggi + prev futuro).
          Si attiva solo se ci sono mesi con consuntivo. */}
      {mesiConsuntivi.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex items-center gap-2 shrink-0">
              <TrendingUp size={18} className="text-amber-600" />
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Anno proiettato {year}</div>
                <div className="text-[10px] text-amber-600">consuntivo {MESI[mesiConsuntivi[0]]}-{MESI[mesiConsuntivi[mesiConsuntivi.length - 1]]} + preventivo mesi rimanenti</div>
              </div>
            </div>
            <div className="flex items-center gap-6 flex-wrap text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Ricavi proiettati</div>
                <div className="font-bold text-emerald-700 tabular-nums">{fmtC(projRicavi)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Costi proiettati</div>
                <div className="font-bold text-red-700 tabular-nums">{fmtC(projCosti)}</div>
              </div>
              <div className="border-l border-amber-300 pl-6">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Risultato anno (proiettato)</div>
                <div className={`font-bold text-lg tabular-nums ${projResult >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtC(projResult)}</div>
              </div>
              <div className="border-l border-amber-300 pl-6">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">vs Preventivo anno</div>
                <div className={`font-bold tabular-nums ${projDelta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {projDelta >= 0 ? '+' : ''}{fmtC(projDelta)}
                </div>
                <div className="text-[10px] text-slate-400">budget {fmtC(annualResult)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-700">{outletLabel} — Vista Mensile {year}</h3>
          <div className="flex gap-2 text-xs items-center">
            <span className="text-slate-500">Totale anno: Costi {fmtC(annualC)} — Ricavi {fmtC(annualR)}</span>
          </div>
        </div>

        {/* MONTH SELECTOR + Anno solare + Trimestri Q1-Q4 */}
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="flex gap-1 flex-wrap items-center">
            <button onClick={() => { setMese(-1); setCustomRange(null) }}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${
                mese === -1 && !customRange ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              Anno
            </button>
            <span className="text-slate-300 mx-1">|</span>
            {/* Trimestri: Q1=gen-mar (mese=12), Q2=apr-giu (13), Q3=lug-set (14), Q4=ott-dic (15) */}
            {[12, 13, 14, 15].map((qm) => {
              const qIdx = qm - 12
              const qLabel = ['Q1','Q2','Q3','Q4'][qIdx]
              const qRange = ['gen-mar','apr-giu','lug-set','ott-dic'][qIdx]
              return (
                <button key={qm} onClick={() => { setMese(qm); setCustomRange(null) }}
                  title={`Trimestre ${qRange}`}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${
                    mese === qm && !customRange ? 'bg-purple-600 text-white shadow-sm' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                  }`}>
                  {qLabel}
                </button>
              )
            })}
            <span className="text-slate-300 mx-1">|</span>
            {MESI.map((m, i) => {
              const hasCData = Object.values(prevMonthly).some(arr => arr && arr[i])
              const hasRData = Object.values(revMonthly).some(arr => arr && arr[i])
              const hasCons = Object.values(consMonthly).some(arr => arr && arr[i])
              const hasRett = Object.values(rettMonthly).some(arr => arr && arr[i])
              const hasData = hasCData || hasRData || hasCons || hasRett
              return (
                <button key={i} onClick={() => { setMese(i); setCustomRange(null) }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition relative ${
                    mese === i && !customRange ? 'bg-indigo-600 text-white shadow-sm' : hasData ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {m}
                  {hasData && (mese !== i || customRange) && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                </button>
              )
            })}
          </div>
          {/* Range custom Da/A: utile per "preventivo vs consuntivo per i mesi gia' chiusi"
              (es. Gen-Apr). I dropdown sono SINCRONIZZATI col periodo selezionato:
              se sei in Q1 mostrano Gen/Mar, se sei in Q2 mostrano Apr/Giu, etc.
              Cosi' non vedi mai un disallineamento Q1=gen-mar ma dropdown=gen-apr. */}
          {(() => {
            const currentFrom = customRange ? customRange[0] : (periodMonths.length > 0 ? Math.min(...periodMonths) : 0)
            const currentTo = customRange ? customRange[1] : (periodMonths.length > 0 ? Math.max(...periodMonths) : 11)
            return (
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Periodo custom:</span>
                <span className="text-xs text-slate-500">da</span>
                <select
                  value={currentFrom}
                  onChange={e => {
                    const from = parseInt(e.target.value)
                    setCustomRange([from, currentTo])
                    setMese(-2)
                  }}
                  className="text-xs px-2 py-1 border border-slate-200 rounded bg-white">
                  {MESI.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
                <span className="text-xs text-slate-500">a</span>
                <select
                  value={currentTo}
                  onChange={e => {
                    const to = parseInt(e.target.value)
                    setCustomRange([currentFrom, to])
                    setMese(-2)
                  }}
                  className="text-xs px-2 py-1 border border-slate-200 rounded bg-white">
                  {MESI.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
                {customRange && (
                  <button
                    onClick={() => { setCustomRange(null); setMese(-1) }}
                    className="text-[10px] px-2 py-1 rounded bg-slate-100 text-slate-500 hover:bg-slate-200">
                    Azzera range
                  </button>
                )}
                {customRange && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    Attivo: {labelMese}
                  </span>
                )}
              </div>
            )
          })()}
          {isAggregateView && (
            <p className="text-[11px] text-slate-500 mt-2 italic">
              Vista aggregata {labelMese}: somma dei mesi {periodMonths.map(mi => MESI[mi]).join(', ')}. Per modificare i valori passa al singolo mese.
            </p>
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
                onCommitPrev={onCommitPrev}
                onCommitCons={onCommitCons}
                onCommitRett={onCommitRett}
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
                onCommitPrev={onCommitRev}
                onCommitCons={onCommitCons}
                onCommitRett={onCommitRett}
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

type ConfrontoRowProps = { prevNode: TreeNodeT; consNode: TreeNodeT; rettNode: TreeNodeT; depth?: number; consEdits: Record<string, number>; onConsEdit: (code: string, val: number) => void; rettEdits: Record<string, number | string>; onRettEdit: (code: string, val: number | string | undefined) => void;
  // Editing del Preventivo sulle foglie (solo singolo outlet, sezione costi).
  // onPrevEdit = aggiornamento live (state); onPrevCommit = persistenza on-blur.
  onPrevEdit?: (code: string, val: number) => void; onPrevCommit?: (code: string, val: number) => Promise<void> }
function ConfrontoRow({ prevNode, consNode, rettNode, depth = 0, consEdits, onConsEdit, rettEdits, onRettEdit, onPrevEdit, onPrevCommit }: ConfrontoRowProps) {
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
          <Tooltip content={prevNode.description}><span className={`truncate ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[10px] text-slate-600'}`}>{prevNode.description}</span></Tooltip>
        </div>
        {/* Preventivo — input su foglie quando editabile (singolo outlet, costi); altrimenti bloccato */}
        {isLeaf && onPrevEdit ? (
          <NumberInputIt
            value={pv}
            edited={pv !== 0}
            onChange={n => onPrevEdit(prevNode.code, n)}
            onCommit={onPrevCommit ? (n => onPrevCommit(prevNode.code, n)) : undefined}
            onClickStop
            className={`w-full text-right px-1 py-0.5 text-[10px] border rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 ${pv !== 0 ? 'bg-indigo-50 border-indigo-300' : 'border-slate-200'}`}
            placeholder="0" />
        ) : (
          <span className={`tabular-nums text-right text-[10px] ${isMacro ? 'font-bold text-indigo-700' : 'text-indigo-500'}`}>{fmt(pv)}</span>
        )}
        {/* Consuntivo — input for leaves */}
        {isLeaf ? (
          <NumberInputIt
            value={consVal}
            edited={consIsEdited}
            onChange={n => onConsEdit(prevNode.code, n)}
            onClickStop
            className={`w-full text-right px-1 py-0.5 text-[10px] border rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400 ${consIsEdited ? 'bg-emerald-50 border-emerald-300' : 'border-slate-200'}`}
            placeholder="0" />
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
          depth={depth + 1} consEdits={consEdits} onConsEdit={onConsEdit} rettEdits={rettEdits} onRettEdit={onRettEdit}
          onPrevEdit={onPrevEdit} onPrevCommit={onPrevCommit} />
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   CONFRONTO PANEL — Preventivo | Consuntivo | Rettifica | Scostamento
   Scostamento = Consuntivo + Rettifica - Preventivo
   ═══════════════════════════════════════════════════════════ */
type ConfrontoPanelProps = {
  outletCode: string; outletLabel: string
  prevEdits: Record<string, number>
  consEdits: Record<string, number>; onConsEdit: (code: string, val: number) => void
  rettEdits: Record<string, number>; onRettEdit: (code: string, val: number | string | undefined) => void
  costiTree: TreeNodeT[]; ricaviTree: TreeNodeT[]
  year: number
  // Mensili (per account_code -> array di 12 valori). Servono per popolare
  // le colonne PREVENTIVO e CONSUNTIVO dei ricavi: il bilancio NON viene
  // piu' usato come default; i ricavi si popolano solo dalla somma del mensile.
  revMonthlyOutlet?: Record<string, number[]>
  consMonthlyOutlet?: Record<string, number[]>
  // true se la colonna Preventivo (costi) contiene voci segnaposto (clone 2025)
  prevHasPlaceholder?: boolean
  // Editing del Preventivo COSTI sulle foglie (solo singolo outlet, non aggregata).
  // onPrevEdit = live (state bpEdits); onPrevCommit = persistenza budget_entries on-blur.
  onPrevEdit?: (code: string, val: number) => void
  onPrevCommit?: (code: string, val: number) => Promise<void>
  // Imposte (valore POSITIVO): aggregata = totale annuale editabile; singolo/Sede =
  // quota allocata read-only. Segno meno e colore rosso solo a display.
  imposteAmount?: number
  imposteEditable?: boolean
  onImposteEdit?: (val: number) => void
  onImposteCommit?: (val: number) => Promise<void>
}
function ConfrontoPanel({ outletCode, outletLabel, prevEdits, consEdits, onConsEdit, rettEdits, onRettEdit, costiTree, ricaviTree, year, revMonthlyOutlet, consMonthlyOutlet, prevHasPlaceholder, onPrevEdit, onPrevCommit, imposteAmount, imposteEditable, onImposteEdit, onImposteCommit }: ConfrontoPanelProps) {
  // Somma annuale (per code) dei mensili gia' caricati da budget_confronto.
  // Patrizio (29/05/2026): "il numero si popola solo dalla somma dei mensili
  // per i preventivi e dalla somma dei mensili per i consuntivi". Quindi NO
  // fallback al bilancio: foglia senza edit ne' mensile -> 0.
  const sumMonthlyByCode = (m?: Record<string, number[]>): Record<string, number> => {
    if (!m) return {}
    const r: Record<string, number> = {}
    Object.entries(m).forEach(([k, arr]) => {
      const s = (arr || []).reduce<number>((acc, v) => acc + (typeof v === 'number' ? v : 0), 0)
      if (s !== 0) r[k] = s
    })
    return r
  }
  const revYearly = sumMonthlyByCode(revMonthlyOutlet)
  const consYearly = sumMonthlyByCode(consMonthlyOutlet)

  // applyZeroWithMonthly: foglie 0 di default, popolate per priorita':
  //   monthlySum[code] > edits[code] > 0
  // Il mensile VINCE sull'edit annuale BPCard perche':
  //  - e' piu' granulare (12 valori vs 1)
  //  - e' la fonte autorevole quando Lilian compila il mensile in PrevVsCons
  //  - bug 29/05/2026: l'annuale BPCard (=bpEdits) bloccava la visualizzazione
  //    del mensile salvato. Lilian salvava in budget_confronto rev_monthly,
  //    poi al refresh vedeva il vecchio numero di budget_entries e pensava
  //    "non si e' salvato".
  // Nodi intermedi = somma figli (mai bilancio).
  const applyZeroWithMonthly = (tree: TreeNodeT[], edits: Record<string, number>, monthlySum: Record<string, number>): TreeNodeT[] => {
    if (!tree || !tree.length) return []
    return tree.map(node => {
      const children = node.children?.length ? applyZeroWithMonthly(node.children, edits, monthlySum) : []
      let amount: number
      if (children.length > 0) {
        amount = children.reduce<number>((s, c) => s + (c.amount || 0), 0)
      } else {
        if (monthlySum[node.code] != null) amount = monthlySum[node.code]
        else if (edits[node.code] != null) amount = edits[node.code]
        else amount = 0
      }
      return { ...node, amount, children }
    })
  }

  // Costi preventivo: zero-based, solo le voci compilate per outlet. NO fallback al bilancio
  // (coerente con consC/rettC e con i ricavi applyZeroWithMonthly). applyEdits ripiegava su
  // node.amount (somma globale di TUTTI i cost_center, incluso 'all') facendo leakare nella
  // vista aggregata gli ammortamenti (69x/71x) e i costi di Sede che nessun outlet ha a budget.
  const prevC = applyEditsZero(costiTree, prevEdits)
  // RICAVI preventivo: NO bilancio. Popolato da edit annuale BPCard o somma mensile.
  const prevR = applyZeroWithMonthly(ricaviTree, prevEdits, revYearly)
  const consC = applyEditsZero(costiTree, consEdits)
  // RICAVI consuntivo: NO bilancio. Popolato da edit annuale Confronto o somma mensile.
  const consR = applyZeroWithMonthly(ricaviTree, consEdits, consYearly)
  const rettC = applyEditsZero(costiTree, rettEdits)
  const rettR = applyEditsZero(ricaviTree, rettEdits)

  const totPrevC = sumMacros(prevC), totPrevR = sumMacros(prevR)
  const totConsC = sumMacros(consC), totConsR = sumMacros(consR)
  const totRettC = sumMacros(rettC), totRettR = sumMacros(rettR)
  const risPrev = totPrevR - totPrevC
  const risCons = totConsR - totConsC
  // Scostamenti per la tabella di dettaglio (TOTALE): includono la rettifica, INVARIATI.
  const scostC = totConsC + totRettC - totPrevC
  const scostR = totConsR + totRettR - totPrevR
  // KPI/box riepilogo: usano consuntivo PURO (senza rettifica).
  const scostCostiPuro = totConsC - totPrevC
  const scostRicaviPuro = totConsR - totPrevR

  // ─── Imposte ──────────────────────────────────────────────────────────────
  // imposte = importo POSITIVO (aggregata: totale annuale; singolo/Sede: quota
  // allocata). "Risultato prima delle imposte" = risultato preventivo ante imposte;
  // "Risultato dopo le imposte" = risPrev − imposte (l'imposta si somma in negativo).
  const isAggregate = outletCode === ALL_OUTLETS_CODE
  const imposte = imposteAmount || 0
  const risDopoImposte = risPrev - imposte

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Lock} label="Risultato preventivo" value={fmtC(risPrev)} color={risPrev>=0?'green':'red'} />
        <Kpi icon={Unlock} label="Risultato consuntivo" value={fmtC(risCons)} color={risCons>=0?'green':'red'} />
        <Kpi icon={TrendingDown} label="Scostamento costi" value={totPrevC>0 ? `${(scostCostiPuro/totPrevC*100).toFixed(1)}%` : '—'} sub={fmtC(scostCostiPuro)} color={scostCostiPuro>0?'red':'green'} />
        <Kpi icon={TrendingUp} label="Scostamento ricavi" value={totPrevR>0 ? `${(scostRicaviPuro/totPrevR*100).toFixed(1)}%` : '—'} sub={fmtC(scostRicaviPuro)} color={scostRicaviPuro>=0?'green':'red'} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">{outletLabel} — Preventivo vs Consuntivo {year}</h3>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1"><Lock size={10} className="text-indigo-400"/> <span className="text-indigo-600 font-medium">Preventivo</span><PlaceholderDot show={!!prevHasPlaceholder} tip="La colonna Preventivo contiene voci segnaposto (clone 2025) non ancora granite in Budget & Controllo." /></span>
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
                consEdits={consEdits} onConsEdit={onConsEdit} rettEdits={rettEdits} onRettEdit={onRettEdit}
                onPrevEdit={onPrevEdit} onPrevCommit={onPrevCommit} />
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

        {/* IMPOSTE — riga subito sotto i Ricavi. Vista aggregata: importo annuale
            editabile (Lilian), autosave on-blur + toast. Singolo outlet / Sede:
            quota allocata READ-ONLY. Sempre in rosso col segno meno. */}
        <div className="px-5 py-3 border-t-2 border-slate-200 bg-rose-50/40 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm font-bold text-slate-900">Imposte</span>
              <span className="text-[11px] text-slate-500 ml-2">
                {isAggregate ? 'valore annuale (inserito da Lilian)' : 'quota allocata'}
              </span>
            </div>
            {isAggregate && imposteEditable ? (
              <div className="flex items-center gap-1.5">
                <span className="text-red-600 font-bold text-base">-</span>
                <NumberInputIt
                  value={imposte}
                  edited={imposte !== 0}
                  onChange={n => onImposteEdit?.(n)}
                  onCommit={onImposteCommit ? (n => onImposteCommit(n)) : undefined}
                  className="w-36 text-right px-2 py-1 text-sm font-bold text-red-600 border border-rose-300 rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-rose-400 bg-white"
                  placeholder="0" />
                <span className="text-slate-400 text-xs">€</span>
              </div>
            ) : (
              <span className="text-base font-bold text-red-600 tabular-nums">
                {imposte !== 0 ? `-${fmtC(imposte)}` : '—'}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-rose-200">
            <span className="text-sm font-bold text-slate-900">Risultato dopo le imposte</span>
            <span className={`text-base font-bold tabular-nums ${risDopoImposte >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
              {fmtC(risDopoImposte)}
            </span>
          </div>
          {isAggregate && imposteEditable && (
            <p className="text-[10px] text-slate-400">
              Salvataggio automatico all'uscita dal campo. Ripartizione: 10% Sede/Magazzino, 90% sugli outlet aperti pro-quota ricavi.
            </p>
          )}
        </div>

        {/* Risultati — Risultato prima delle imposte | Imposte | Risultato dopo le imposte */}
        <div className="border-t border-slate-200 px-5 py-3 grid grid-cols-3 gap-4">
          <div className={`p-3 rounded-lg text-center font-bold text-sm ${risPrev>=0?'bg-indigo-50 text-indigo-700':'bg-red-50 text-red-700'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Risultato prima delle imposte</div>
            {risPrev>=0?'Utile':'Perdita'} {fmtC(Math.abs(risPrev))}
          </div>
          <div className="p-3 rounded-lg text-center font-bold text-sm bg-rose-50 text-red-700">
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Imposte</div>
            {imposte !== 0 ? `-${fmtC(imposte)}` : '—'}
          </div>
          <div className={`p-3 rounded-lg text-center font-bold text-sm ${risDopoImposte>=0?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">Risultato dopo le imposte</div>
            {risDopoImposte>=0?'Utile':'Perdita'} {fmtC(Math.abs(risDopoImposte))}
          </div>
        </div>
      </div>
      <PageHelp page="budget" />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   INSERIMENTO RAPIDO MATRICE — 7 outlet x 2 righe (prev/cons)
   per il mese selezionato. SOLO input. Save on blur.
   Patrizio 29/05/2026: "crea una sezione semplice nuova dove lilian ha
   per orizzontale la lista dei 7 outlet e per verticale 2 campi, uno
   preventivo produzione e quello accanto consuntivo, questi campi
   scriveranno a sua volta in automatico nella parte del bilancio".
   ═══════════════════════════════════════════════════════════ */
type OutletForRapido = { code: string; label: string; accountCode: string }
function InserimentoRapidoMatrice({ year, companyId, outlets, phRevByCenterMonth }: {
  year: number; companyId: string; outlets: OutletForRapido[]
  phRevByCenterMonth?: Record<string, boolean[]>
}) {
  const MESI_NOMI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
  const [mese, setMese] = useState<number>(new Date().getMonth()) // mese corrente di default
  const [matrix, setMatrix] = useState<Record<string, { prev: number; cons: number }>>({})
  const [loading, setLoading] = useState(true)

  // Carica dati per il mese selezionato
  useEffect(() => {
    let alive = true
    const load = async () => {
      setLoading(true)
      const accCodes = outlets.map(o => o.accountCode)
      const { data } = await supabase.from('budget_confronto')
        .select('cost_center, account_code, amount, entry_type')
        .eq('company_id', companyId)
        .eq('year', year)
        .eq('month', mese + 1)
        .in('entry_type', ['rev_monthly', 'cons_monthly'])
        .in('account_code', accCodes)
      if (!alive) return
      const m: Record<string, { prev: number; cons: number }> = {}
      outlets.forEach(o => { m[o.code] = { prev: 0, cons: 0 } })
      ;(data || []).forEach(r => {
        const o = outlets.find(x => x.accountCode === r.account_code)
        if (!o) return
        const amt = Number(r.amount) || 0
        if (r.entry_type === 'rev_monthly') m[o.code].prev = amt
        else if (r.entry_type === 'cons_monthly') m[o.code].cons = amt
      })
      setMatrix(m)
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [companyId, year, mese, outlets])

  // Save on blur per singola cella (entry_type rev_monthly o cons_monthly)
  const saveCell = async (outlet: OutletForRapido, kind: 'prev' | 'cons', value: number) => {
    const entryType = kind === 'prev' ? 'rev_monthly' : 'cons_monthly'
    // DELETE riga esistente (idempotente), poi INSERT se valore non zero
    await supabase.from('budget_confronto').delete()
      .eq('company_id', companyId).eq('cost_center', outlet.code)
      .eq('account_code', outlet.accountCode).eq('year', year)
      .eq('month', mese + 1).eq('entry_type', entryType)
    if (value !== 0) {
      const { error } = await supabase.from('budget_confronto').insert({
        company_id: companyId, cost_center: outlet.code, account_code: outlet.accountCode,
        year, month: mese + 1, entry_type: entryType, amount: value,
        // riga Consuntivo = granitico (mese chiuso reale); riga Preventivo = preventivo
        stato: kind === 'cons' ? 'granitico' : 'preventivo',
        updated_at: new Date().toISOString(),
      } as never)
      if (error) throw error
    }
  }

  const totalePrev = outlets.reduce((s, o) => s + (matrix[o.code]?.prev || 0), 0)
  const totaleCons = outlets.reduce((s, o) => s + (matrix[o.code]?.cons || 0), 0)

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <Zap size={18} className="text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-900">
          <div className="font-semibold mb-1">Inserimento Rapido Corrispettivi</div>
          <p className="text-blue-700 text-xs">
            Scegli il mese, inserisci preventivo e consuntivo per ogni outlet. Il <strong>Consuntivo</strong> è il dato <strong>granitico</strong> (corrispettivi reali dei mesi chiusi); il <strong>Preventivo</strong> è previsionale. Salvataggio automatico (vedi ✓ verde). I numeri popolano direttamente il bilancio e le viste Preventivo vs Consuntivo / Business Plan.
          </p>
        </div>
      </div>

      {/* Selettore mese */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2">Mese {year}:</span>
        {MESI_NOMI.map((nome, idx) => (
          <button key={idx}
            onClick={() => setMese(idx)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              mese === idx
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}>
            {nome.slice(0, 3)}
          </button>
        ))}
      </div>

      {/* Matrice */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b">
          <h3 className="text-sm font-semibold text-slate-700">Corrispettivi outlet — {MESI_NOMI[mese]} {year}</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Caricamento…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/50 border-b border-slate-100">
                <tr>
                  <th className="text-left py-3 px-4 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-32">Tipologia</th>
                  {outlets.map(o => (
                    <th key={o.code} className="text-right py-3 px-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      <Tooltip content={o.label}><div className="truncate">{o.label.split('(')[0].trim()}</div></Tooltip>
                    </th>
                  ))}
                  <th className="text-right py-3 px-4 text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">Totale mese</th>
                </tr>
              </thead>
              <tbody>
                {/* PREVENTIVO */}
                <tr className="border-b border-slate-100">
                  <td className="py-3 px-4 text-sm font-semibold text-indigo-700 bg-indigo-50/40">
                    <div className="flex items-center gap-1.5"><Lock size={12} />Preventivo</div>
                    <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-500">Preventivo</span>
                  </td>
                  {outlets.map(o => (
                    <td key={o.code} className="py-2 px-3">
                      <div className="flex items-center justify-end gap-0.5">
                        <NumberInputIt
                          value={matrix[o.code]?.prev || 0}
                          onChange={n => setMatrix(prev => ({ ...prev, [o.code]: { ...(prev[o.code] || { prev: 0, cons: 0 }), prev: n } }))}
                          onCommit={async n => { await saveCell(o, 'prev', n) }}
                          className="w-full text-right px-2 py-1.5 text-sm border rounded tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-400 border-slate-200"
                          placeholder="0"
                        />
                        <PlaceholderDot show={!!phRevByCenterMonth?.[o.code]?.[mese]} />
                      </div>
                    </td>
                  ))}
                  <td className="py-3 px-4 text-right text-sm font-bold text-indigo-700 tabular-nums bg-indigo-50/40">
                    {totalePrev.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
                {/* CONSUNTIVO */}
                <tr>
                  <td className="py-3 px-4 text-sm font-semibold text-emerald-700 bg-emerald-50/40">
                    <div className="flex items-center gap-1.5"><Unlock size={12} />Consuntivo</div>
                    <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide bg-emerald-100 text-emerald-700">Granitico</span>
                  </td>
                  {outlets.map(o => (
                    <td key={o.code} className="py-2 px-3">
                      <NumberInputIt
                        value={matrix[o.code]?.cons || 0}
                        onChange={n => setMatrix(prev => ({ ...prev, [o.code]: { ...(prev[o.code] || { prev: 0, cons: 0 }), cons: n } }))}
                        onCommit={async n => { await saveCell(o, 'cons', n) }}
                        className="w-full text-right px-2 py-1.5 text-sm border rounded tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-400 border-slate-200"
                        placeholder="0"
                      />
                    </td>
                  ))}
                  <td className="py-3 px-4 text-right text-sm font-bold text-emerald-700 tabular-nums bg-emerald-50/40">
                    {totaleCons.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {outlets.some(o => phRevByCenterMonth?.[o.code]?.[mese]) && (
        <PlaceholderLegend className="px-2" />
      )}

      <div className="text-xs text-slate-400 px-2">
        Esci dal campo per salvare (Tab oppure click fuori). Cambiare mese non perde i dati: ogni cella e' gia' sul DB. Scostamenti, percentuali e dettagli per voce di bilancio sono nella tab <strong>Preventivo vs Consuntivo</strong>.
      </div>
    </div>
  )
}

