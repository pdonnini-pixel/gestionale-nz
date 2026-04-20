import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { usePeriod } from '../hooks/usePeriod'
import PageHelp from '../components/PageHelp'
import {
  Calculator, ChevronDown, ChevronUp,
  Store, Building2, Save, Trash2,
  AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, Target,
  BarChart3, Copy, Lock, Unlock
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
const MESI_SHORT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const HQ_CODE = 'sede_magazzino'

function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = 'Svuota', destructive = true }) {
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

function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}
function fmtC(n) { return n == null || isNaN(n) ? '—' : `${fmt(n, 2)} €` }

function getCodeLevel(code) {
  if (!code) return 0
  const len = code.replace(/\s/g, '').length
  if (len <= 2) return 0; if (len <= 4) return 1; if (len <= 6) return 2; return 3
}

function buildTree(rows) {
  if (!rows || !rows.length) return []
  const tree = [], stack = []
  for (const row of rows) {
    const node = { ...row, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length === 0) tree.push(node); else stack[stack.length - 1].node.children.push(node)
    stack.push({ node, level: node.level })
  }
  return tree
}

function sumMacros(tree) { return tree.reduce((s, n) => s + (n.amount || 0), 0) }

// Apply edits to a tree, recomputing parent sums from edited children
function applyEdits(tree, edits) {
  if (!tree || !tree.length) return []
  return tree.map(node => {
    const children = node.children?.length ? applyEdits(node.children, edits) : []
    let amount
    if (children.length > 0) {
      amount = children.reduce((s, c) => s + (c.amount || 0), 0)
    } else {
      amount = edits[node.code] != null ? edits[node.code] : (node.amount || 0)
    }
    return { ...node, amount, children }
  })
}

// Variante zero-based: foglie senza edit = 0 (per rettifica, che è solo manuale)
function applyEditsZero(tree, edits) {
  if (!tree || !tree.length) return []
  return tree.map(node => {
    const children = node.children?.length ? applyEditsZero(node.children, edits) : []
    let amount
    if (children.length > 0) {
      amount = children.reduce((s, c) => s + (c.amount || 0), 0)
    } else {
      const v = edits[node.code]
      amount = (v != null && typeof v === 'number') ? v : 0
    }
    return { ...node, amount, children }
  })
}

// Flatten leaf codes from a tree
function flattenLeaves(tree) {
  const result = {}
  const walk = nodes => nodes.forEach(n => {
    if (n.children?.length) walk(n.children)
    else result[n.code] = n.amount || 0
  })
  walk(tree)
  return result
}

/* ═══════════════════════════════════════════════════════════
   EDITABLE TREE NODE — always shows input on leaves
   ═══════════════════════════════════════════════════════════ */
function TreeNodeEdit({ node, depth = 0, edits, onEdit }) {
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
        <span className={`truncate ml-1 flex-1 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[11px] text-slate-600'}`}>
          {node.description}
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
          <span className={`tabular-nums text-right shrink-0 ml-1 text-[11px] ${isMacro ? 'font-bold text-slate-900 w-28' : 'text-slate-500 w-24'} ${node.amount < 0 ? 'text-red-600' : ''}`}>
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
function TreeNodeView({ node, depth = 0 }) {
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
        <span className={`truncate ml-1 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[11px] text-slate-600'}`}>{node.description}</span>
        <span className={`tabular-nums text-right shrink-0 ml-auto ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[10px] text-slate-600'} ${node.amount < 0 ? 'text-red-600' : ''}`}>
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
function Kpi({ icon: Icon, label, value, sub, color = 'indigo', alert }) {
  const cm = { indigo: 'bg-indigo-50 text-indigo-600', blue: 'bg-blue-50 text-blue-600', green: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600', purple: 'bg-purple-50 text-purple-600' }
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
  const CID = profile?.company_id
  const { year, quarter, getDateRange } = usePeriod()

  const [tab, setTab] = useState('bp')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const show = (msg, t = 'success') => { setToast({ msg, t }); setTimeout(() => setToast(null), 3000) }

  // Data
  const [costCenters, setCostCenters] = useState([])
  const [ceRawCosti, setCeRawCosti] = useState([])
  const [ceRawRicavi, setCeRawRicavi] = useState([])
  const [budgetEntries, setBudgetEntries] = useState([])

  // Cash-basis data from cash_movements
  const [cashTotals, setCashTotals] = useState({ entrate: 0, uscite: 0, netto: 0, count: 0 })
  const [cashByMonth, setCashByMonth] = useState({}) // { month: { entrate, uscite } }
  const [cashLoaded, setCashLoaded] = useState(false)

  // BP edits: { outletCode: { accountCode: amount } }
  const [bpEdits, setBpEdits] = useState({})

  // Confronto state
  const [confOutlet, setConfOutlet] = useState('')
  const [confView, setConfView] = useState('annuale') // 'annuale' | 'mensile'
  const [consEdits, setConsEdits] = useState({}) // consuntivo edits per outlet
  const [rettEdits, setRettEdits] = useState({}) // rettifiche per outlet: { outletCode: { accountCode: amount } }
  // Monthly edits: { outletCode: { accountCode: [12 values] } }
  const [prevMonthly, setPrevMonthly] = useState({})  // preventivo costi mensile
  const [revMonthly, setRevMonthly] = useState({})    // ricavi previsti mensile
  const [consMonthly, setConsMonthly] = useState({})   // consuntivo mensile


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
      const byMonth = {}
      data.forEach(row => {
        const month = new Date(row.date).getMonth() + 1
        if (!byMonth[month]) byMonth[month] = { entrate: 0, uscite: 0 }
        const amt = Math.abs(row.amount || 0)
        if (row.type === 'entrata') {
          totalEntrate += amt
          byMonth[month].entrate += amt
        } else {
          totalUscite += amt
          byMonth[month].uscite += amt
        }
      })

      setCashTotals({ entrate: totalEntrate, uscite: totalUscite, netto: totalEntrate - totalUscite, count: data.length })
      setCashByMonth(byMonth)
      setCashLoaded(true)
    } catch (err) {
      console.error('Error loading cash movements:', err)
      setCashLoaded(true)
    }
  }

  // ─── LOAD ──────────────────────────────────────────────────
  useEffect(() => { if (CID) loadAll() }, [CID, year, quarter])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [ccR, bsR, buR, cfR] = await Promise.all([
        supabase.from('cost_centers').select('*').eq('company_id', CID).eq('is_active', true).order('sort_order'),
        supabase.from('balance_sheet_data').select('*').eq('company_id', CID).eq('year', 2025).in('section', ['ce_costi', 'ce_ricavi']).order('sort_order'),
        supabase.from('budget_entries').select('*').eq('company_id', CID).eq('year', 2026),
        supabase.from('budget_confronto').select('*').eq('company_id', CID).eq('year', year),
      ])
      setCostCenters(ccR.data || [])
      setBudgetEntries(buR.data || [])

      const junk = /Azienda:|Cod\.\s*Fiscale|Partita\s*IVA|^VIA\s|PERIODO\s*DAL|Totali\s*fino|^Pag\.|Considera anche|movimenti provvisori/i
      const clean = (bsR.data || []).filter(r => (r.account_code && r.account_code.trim()) && !junk.test(r.account_name || ''))
      const co = [], ri = []
      clean.forEach(r => {
        const row = { code: r.account_code||'', description: r.account_name||'', amount: r.amount||0, level: getCodeLevel(r.account_code), isMacro: (r.account_code||'').replace(/\s/g,'').length <= 2 }
        r.section === 'ce_costi' ? co.push(row) : ri.push(row)
      })
      setCeRawCosti(co); setCeRawRicavi(ri)

      // Reconstruct bpEdits from saved budget_entries
      const edits = {}
      ;(buR.data || []).forEach(e => {
        const cc = e.cost_center || 'all'
        if (!edits[cc]) edits[cc] = {}
        edits[cc][e.account_code] = (edits[cc][e.account_code] || 0) + (parseFloat(e.budget_amount) || 0)
      })
      setBpEdits(edits)

      // ─── Reconstruct confronto data from budget_confronto ───
      const newConsEdits = {}, newRettEdits = {}
      const newPrevM = {}, newRevM = {}, newConsM = {}
      ;(cfR.data || []).forEach(r => {
        const cc = r.cost_center, ac = r.account_code, amt = parseFloat(r.amount) || 0
        if (r.entry_type === 'consuntivo' && r.month === 0) {
          if (!newConsEdits[cc]) newConsEdits[cc] = {}
          newConsEdits[cc][ac] = amt
        } else if (r.entry_type === 'rettifica' && r.month === 0) {
          if (!newRettEdits[cc]) newRettEdits[cc] = {}
          newRettEdits[cc][ac] = amt
        } else if (r.entry_type === 'prev_monthly' && r.month >= 1) {
          if (!newPrevM[cc]) newPrevM[cc] = {}
          if (!newPrevM[cc][ac]) newPrevM[cc][ac] = Array(12).fill(0)
          newPrevM[cc][ac][r.month - 1] = amt
        } else if (r.entry_type === 'rev_monthly' && r.month >= 1) {
          if (!newRevM[cc]) newRevM[cc] = {}
          if (!newRevM[cc][ac]) newRevM[cc][ac] = Array(12).fill(0)
          newRevM[cc][ac][r.month - 1] = amt
        } else if (r.entry_type === 'cons_monthly' && r.month >= 1) {
          if (!newConsM[cc]) newConsM[cc] = {}
          if (!newConsM[cc][ac]) newConsM[cc][ac] = Array(12).fill(0)
          newConsM[cc][ac][r.month - 1] = amt
        }
      })
      setConsEdits(newConsEdits)
      setRettEdits(newRettEdits)
      setPrevMonthly(newPrevM)
      setRevMonthly(newRevM)
      setConsMonthly(newConsM)

      // Set first outlet with BP data as default for confronto
      const outletCodes = Object.keys(edits).filter(k => k !== 'all' && k !== HQ_CODE)
      if (outletCodes.length > 0 && !confOutlet) setConfOutlet(outletCodes[0])

      // Load cash movements for cassa column
      await loadCashMovements()
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  // ─── TREES ─────────────────────────────────────────────────
  const ops = useMemo(() => costCenters.filter(cc => cc.code !== HQ_CODE), [costCenters])
  const hq = useMemo(() => costCenters.find(cc => cc.code === HQ_CODE), [costCenters])
  const costiTree = useMemo(() => buildTree(ceRawCosti), [ceRawCosti])
  const ricaviTree = useMemo(() => buildTree(ceRawRicavi), [ceRawRicavi])
  const hasTree = ceRawCosti.length > 0 || ceRawRicavi.length > 0

  // ─── SAVE BP ───────────────────────────────────────────────
  const saveBP = async (code) => {
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
          budget_amount: Math.round(amt / 12), is_approved: false,
        }))
      ).flat()
      const { error } = await supabase.from('budget_entries').upsert(entries, { onConflict: 'company_id,account_code,cost_center,year,month' })
      if (error) throw error
      show(`Preventivo ${code} salvato ✓ (${Object.keys(costEdits).length} costi + ${Object.keys(ricaviLeaves).length} ricavi)`)
    } catch (e) { show(e.message, 'error') } finally { setSaving(false) }
  }

  // ─── SAVE CONFRONTO (annuale + mensile) ────────────────────
  const saveConfronto = async (outletCode) => {
    setSaving(true)
    try {
      const rows = []
      // Annuale: consuntivo
      Object.entries(consEdits[outletCode] || {}).forEach(([ac, amt]) => {
        if (typeof amt === 'number' && amt !== 0) rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: 0, entry_type: 'consuntivo', amount: amt, updated_at: new Date().toISOString() })
      })
      // Annuale: rettifica
      Object.entries(rettEdits[outletCode] || {}).forEach(([ac, amt]) => {
        if (typeof amt === 'number' && amt !== 0) rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: 0, entry_type: 'rettifica', amount: amt, updated_at: new Date().toISOString() })
      })
      // Mensile: prev costi
      Object.entries(prevMonthly[outletCode] || {}).forEach(([ac, arr]) => {
        (arr || []).forEach((v, mi) => {
          if (typeof v === 'number' && v !== 0) rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: mi + 1, entry_type: 'prev_monthly', amount: v, updated_at: new Date().toISOString() })
        })
      })
      // Mensile: ricavi previsti
      Object.entries(revMonthly[outletCode] || {}).forEach(([ac, arr]) => {
        (arr || []).forEach((v, mi) => {
          if (typeof v === 'number' && v !== 0) rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: mi + 1, entry_type: 'rev_monthly', amount: v, updated_at: new Date().toISOString() })
        })
      })
      // Mensile: consuntivo
      Object.entries(consMonthly[outletCode] || {}).forEach(([ac, arr]) => {
        (arr || []).forEach((v, mi) => {
          if (typeof v === 'number' && v !== 0) rows.push({ company_id: CID, cost_center: outletCode, account_code: ac, year, month: mi + 1, entry_type: 'cons_monthly', amount: v, updated_at: new Date().toISOString() })
        })
      })

      if (rows.length === 0) { show('Nessun dato da salvare', 'error'); setSaving(false); return }

      // Delete old data for this outlet/year, then insert fresh
      await supabase.from('budget_confronto').delete().eq('company_id', CID).eq('cost_center', outletCode).eq('year', year)
      const { error } = await supabase.from('budget_confronto').insert(rows)
      if (error) throw error
      show(`Confronto ${outletCode} salvato ✓ (${rows.length} righe)`)
    } catch (e) { show(e.message, 'error') } finally { setSaving(false) }
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
  const filterRicaviTree = (tree, outletCode) => {
    const isHQ = outletCode === HQ_CODE
    const walk = (nodes) => nodes.map(node => {
      if (node.children?.length > 0) {
        const filteredKids = walk(node.children).filter(Boolean)
        if (filteredKids.length === 0) return null
        const amount = filteredKids.reduce((s, c) => s + (c.amount || 0), 0)
        return { ...node, children: filteredKids, amount }
      }
      // Foglia
      if (OUTLET_CORRISP_CODES.has(node.code)) {
        // Corrispettivo outlet-specifico: tieni solo per il suo outlet
        return RICAVI_OUTLET_MAP[node.code] === outletCode ? node : null
      }
      // Tutti gli altri ricavi (59, 81, 89, ecc.): SOLO magazzino
      return isHQ ? node : null
    }).filter(Boolean)
    return walk(tree)
  }

  // I costi partono SEMPRE da zero — l'operatore compila manualmente
  // I ricavi vengono dal bilancio filtrato per outlet (read-only, auto-salvati con saveBP)

  // ─── CONFIRM DIALOG STATE ────────────────────────────────
  const [confirmAction, setConfirmAction] = useState(null)
  // confirmAction = { title, message, action: () => void }

  const clearOutlet = (code) => {
    setConfirmAction({
      title: `Svuota Business Plan — ${code}`,
      message: 'Tutti i costi inseriti per questo outlet verranno cancellati da memoria e database.',
      action: async () => {
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
        setBpEdits({})
        await supabase.from('budget_entries').delete().eq('company_id', CID).eq('year', year)
        show('Tutti i dati cancellati da memoria e database')
      }
    })
  }

  // Svuota confronto annuale (consuntivo + rettifica) per outlet — anche da DB
  const clearConfrontoAnnuale = (outletCode) => {
    setConfirmAction({
      title: `Svuota Confronto Annuale — ${outletCode}`,
      message: 'Consuntivo e rettifiche annuali verranno cancellati da memoria e database.',
      action: async () => {
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
  const clearConfrontoMensile = (outletCode) => {
    setConfirmAction({
      title: `Svuota Dati Mensili — ${outletCode}`,
      message: 'Costi preventivo, ricavi e consuntivo mensili verranno cancellati da memoria e database.',
      action: async () => {
        setPrevMonthly(prev => { const n = { ...prev }; delete n[outletCode]; return n })
        setRevMonthly(prev => { const n = { ...prev }; delete n[outletCode]; return n })
        setConsMonthly(prev => { const n = { ...prev }; delete n[outletCode]; return n })
        await supabase.from('budget_confronto').delete()
          .eq('company_id', CID).eq('cost_center', outletCode).eq('year', year)
          .in('entry_type', ['prev_monthly', 'rev_monthly', 'cons_monthly'])
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
          <p className="text-slate-500 mt-1 text-sm">Business Plan preventivo/consuntivo per outlet</p>
        </div>
        <span className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold bg-slate-50">{year}</span>
      </div>

      {/* TABS */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[{ id:'bp', label:'Business Plan', icon:Target }, { id:'confronto', label:'Preventivo vs Consuntivo', icon:BarChart3 }].map(t => (
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi icon={Store} label="Outlet operativi" value={ops.length} sub="punti vendita" color="indigo" />
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

          {/* Info */}
          {hasTree && (
            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-indigo-800">Compila i costi previsti per ogni outlet</p>
                <p className="text-xs text-indigo-600 mt-0.5">I ricavi sono assegnati automaticamente dal bilancio {year - 1}. Inserisci i costi previsti, poi salva.</p>
              </div>
              {Object.keys(bpEdits).length > 0 && (
                <button onClick={clearAll} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 flex items-center gap-2 shrink-0">
                  <Trash2 size={14} /> Cancella tutti
                </button>
              )}
            </div>
          )}

          {/* Sede card */}
          {hq && hasTree && (
            <BPCard label={hq.label} code={HQ_CODE} isHQ numOps={ops.length}
              costiTree={costiTree} ricaviTree={filterRicaviTree(ricaviTree, HQ_CODE)}
              edits={bpEdits[HQ_CODE]||{}} setEdits={ed => setBpEdits(p => ({...p,[HQ_CODE]:ed}))}
              onClear={() => clearOutlet(HQ_CODE)}
              onSave={() => saveBP(HQ_CODE)} saving={saving} color="#f59e0b" year={year} />
          )}

          {/* Outlet cards */}
          {ops.map(cc => (
            <BPCard key={cc.code} label={cc.label} code={cc.code}
              costiTree={costiTree} ricaviTree={filterRicaviTree(ricaviTree, cc.code)}
              edits={bpEdits[cc.code]||{}} setEdits={ed => setBpEdits(p => ({...p,[cc.code]:ed}))}
              onClear={() => clearOutlet(cc.code)}
              onSave={() => saveBP(cc.code)} saving={saving} color={cc.color||'#6366f1'} year={year} />
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════════
         TAB 2: PREVENTIVO VS CONSUNTIVO
         ════════════════════════════════════════════════════ */}
      {tab === 'confronto' && (
        <div className="space-y-6">
          {outletsWithBP.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 rounded-xl">
              <Lock className="mx-auto text-slate-300 mb-3" size={48} />
              <p className="text-slate-500 font-medium">Nessun preventivo creato</p>
              <p className="text-sm text-slate-400 mt-1">Crea prima un Business Plan nel tab precedente</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-slate-600 font-medium">Outlet:</span>
                <select value={confOutlet} onChange={e => setConfOutlet(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  {outletsWithBP.map(cc => <option key={cc.code} value={cc.code}>{cc.label}</option>)}
                </select>
                <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                  {[{k:'annuale',l:'Annuale'},{k:'mensile',l:'Mensile'}].map(v => (
                    <button key={v.k} onClick={() => setConfView(v.k)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${confView===v.k?'bg-white text-indigo-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
                      {v.l}
                    </button>
                  ))}
                </div>
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
              </div>
              {confOutlet && confView === 'annuale' && (
                <ConfrontoPanel
                  outletCode={confOutlet}
                  outletLabel={costCenters.find(c => c.code === confOutlet)?.label || confOutlet}
                  prevEdits={bpEdits[confOutlet] || {}}
                  consEdits={consEdits[confOutlet] || {}}
                  onConsEdit={(code, val) => setConsEdits(prev => ({...prev, [confOutlet]: {...(prev[confOutlet]||{}), [code]: val}}))}
                  rettEdits={rettEdits[confOutlet] || {}}
                  onRettEdit={(code, val) => setRettEdits(prev => ({...prev, [confOutlet]: {...(prev[confOutlet]||{}), [code]: val}}))}
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
                  outletLabel={costCenters.find(c => c.code === confOutlet)?.label || confOutlet}
                  costiTree={costiTree}
                  ricaviTree={filterRicaviTree(ricaviTree, confOutlet)}
                  prevMonthly={prevMonthly[confOutlet] || {}}
                  onPrevMonthly={(code, month, val) => setPrevMonthly(prev => {
                    const outlet = { ...(prev[confOutlet] || {}) }
                    const arr = [...(outlet[code] || Array(12).fill(0))]
                    arr[month] = val
                    return { ...prev, [confOutlet]: { ...outlet, [code]: arr } }
                  })}
                  revMonthly={revMonthly[confOutlet] || {}}
                  onRevMonthly={(code, month, val) => setRevMonthly(prev => {
                    const outlet = { ...(prev[confOutlet] || {}) }
                    const arr = [...(outlet[code] || Array(12).fill(0))]
                    arr[month] = val
                    return { ...prev, [confOutlet]: { ...outlet, [code]: arr } }
                  })}
                  consMonthly={consMonthly[confOutlet] || {}}
                  onConsMonthly={(code, month, val) => setConsMonthly(prev => {
                    const outlet = { ...(prev[confOutlet] || {}) }
                    const arr = [...(outlet[code] || Array(12).fill(0))]
                    arr[month] = val
                    return { ...prev, [confOutlet]: { ...outlet, [code]: arr } }
                  })}
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
function BPCard({ label, code, isHQ, numOps, costiTree, ricaviTree, edits, setEdits, onClear, onSave, saving, color, year }) {
  const [open, setOpen] = useState(false)

  // COSTI: partono da ZERO, l'operatore compila manualmente
  const editedC = applyEditsZero(costiTree, edits)
  // RICAVI: dal bilancio, read-only (già filtrati per outlet)
  const totC = sumMacros(editedC)
  const totR = sumMacros(ricaviTree)
  const ris = totR - totC
  const hasEdits = Object.keys(edits).length > 0

  const onEdit = (ac, val) => setEdits({ ...edits, [ac]: val })

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${isHQ ? 'border-amber-200' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50/50 transition" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3">
          {isHQ ? <Building2 size={16} className="text-amber-500" /> : <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />}
          <div>
            <div className="font-semibold text-slate-900">{label}</div>
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
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-slate-500">Compila i costi previsti — i ricavi vengono dal bilancio {year - 1}</p>
            <div className="flex items-center gap-2">
              {hasEdits && (
                <button onClick={onClear} className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 flex items-center gap-1.5">
                  <Trash2 size={12} /> Cancella costi
                </button>
              )}
              <button onClick={onSave} disabled={saving} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                <Save size={14} /> {saving ? 'Salvo...' : 'Salva'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* COSTI — editabili, partono da zero */}
            <div>
              <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">Componenti Negative (da compilare)</div>
              <div className="border border-slate-200 rounded-lg p-1.5 max-h-[500px] overflow-y-auto">
                {editedC.map((n, i) => <TreeNodeEdit key={`${n.code}-${i}`} node={n} edits={edits} onEdit={onEdit} />)}
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

function CopyMonthPopover({ fromMonth, onCopy, onClose }) {
  const [sel, setSel] = useState(Array(12).fill(false))
  const toggle = i => setSel(p => { const n = [...p]; n[i] = !n[i]; return n })
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

function MonthlyTreeNode({ node, depth = 0, edits, onEdit, mese, monthly, onCopyToMonths }) {
  const [open, setOpen] = useState(false)
  const [showCopy, setShowCopy] = useState(false)
  const hasKids = node.children?.length > 0
  const isMacro = node.level === 0
  const isLeaf = !hasKids
  const val = edits[node.code] != null ? edits[node.code] : (node.amount || 0)
  const isEdited = edits[node.code] != null

  // Collect all leaf codes under this node
  const collectLeaves = (n) => {
    if (!n.children?.length) return [n.code]
    return n.children.flatMap(collectLeaves)
  }

  const handleCopy = (selMonths) => {
    const codes = collectLeaves(node)
    codes.forEach(code => {
      const srcVal = monthly[code]?.[mese] || 0
      if (srcVal) {
        selMonths.forEach((checked, mi) => { if (checked) onCopyToMonths(code, mi, srcVal) })
      }
    })
  }

  // Does this node (or its leaves) have a value to copy?
  const hasValueToCopy = (() => {
    const codes = collectLeaves(node)
    return codes.some(c => monthly[c]?.[mese])
  })()

  return (
    <div>
      <div className={`flex items-center py-1 px-1 rounded transition ${hasKids ? 'cursor-pointer hover:bg-slate-50' : ''} ${isMacro ? 'bg-slate-50/80 mt-1' : ''}`}
        style={{ paddingLeft: `${4 + depth * 16}px` }} onClick={() => hasKids && setOpen(!open)}>
        <span className="w-4 shrink-0 text-center text-[10px] text-slate-400">{hasKids ? (open ? '▾' : '▸') : ''}</span>
        <span className={`font-mono text-slate-400 shrink-0 ml-0.5 ${isMacro ? 'text-[11px] font-bold' : 'text-[10px]'}`}
          style={{ width: node.code?.length > 4 ? '50px' : '26px' }}>{node.code}</span>
        <span className={`truncate ml-1 flex-1 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[11px] text-slate-600'}`}>{node.description}</span>
        {/* Copy button */}
        {hasValueToCopy && (
          <div className="relative shrink-0 ml-1">
            <button onClick={e => { e.stopPropagation(); setShowCopy(!showCopy) }}
              title={`Copia ${isLeaf ? 'valore' : 'valori'} in altri mesi`}
              className="p-0.5 rounded hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600 transition">
              <Copy size={11} />
            </button>
            {showCopy && <CopyMonthPopover fromMonth={mese} onCopy={handleCopy} onClose={() => setShowCopy(false)} />}
          </div>
        )}
        {isLeaf ? (
          <input type="text" inputMode="numeric"
            value={isEdited ? val : (val || '')}
            onClick={e => e.stopPropagation()}
            onChange={e => { const raw = e.target.value.replace(/\./g, '').replace(',', '.'); onEdit(node.code, parseFloat(raw) || 0) }}
            className={`w-20 text-right px-1 py-0.5 text-[11px] border rounded ml-1 tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 ${isEdited ? 'bg-indigo-50 border-indigo-300' : 'border-slate-200'}`}
            placeholder="0" />
        ) : (
          <span className={`tabular-nums text-right shrink-0 ml-1 text-[11px] ${isMacro ? 'font-bold text-slate-900 w-24' : 'text-slate-500 w-20'}`}>{fmt(node.amount)} €</span>
        )}
      </div>
      {open && hasKids && node.children.map((c, i) => (
        <MonthlyTreeNode key={`${c.code}-${i}`} node={c} depth={depth + 1} edits={edits} onEdit={onEdit}
          mese={mese} monthly={monthly} onCopyToMonths={onCopyToMonths} />
      ))}
    </div>
  )
}

function ConfrontoMensile({ outletCode, outletLabel, costiTree, ricaviTree, prevMonthly, onPrevMonthly, revMonthly, onRevMonthly, consMonthly, onConsMonthly, year }) {
  const [mese, setMese] = useState(0)

  // Edits for selected month
  const costiEditsForMonth = {}
  Object.entries(prevMonthly).forEach(([code, arr]) => {
    if (arr && arr[mese]) costiEditsForMonth[code] = arr[mese]
  })
  const ricaviEditsForMonth = {}
  Object.entries(revMonthly).forEach(([code, arr]) => {
    if (arr && arr[mese]) ricaviEditsForMonth[code] = arr[mese]
  })

  const editedC = applyEditsZero(costiTree, costiEditsForMonth)
  const editedR = applyEditsZero(ricaviTree, ricaviEditsForMonth)
  const totC = sumMacros(editedC)
  const totR = sumMacros(editedR)
  const ris = totR - totC

  // Annual totals
  const annualC = (() => {
    let tot = 0
    Object.values(prevMonthly).forEach(arr => { if (arr) arr.forEach(v => { tot += (typeof v === 'number' ? v : 0) }) })
    return tot
  })()
  const annualR = (() => {
    let tot = 0
    Object.values(revMonthly).forEach(arr => { if (arr) arr.forEach(v => { tot += (typeof v === 'number' ? v : 0) }) })
    return tot
  })()

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">{outletLabel} — Vista Mensile {year}</h3>
          <div className="flex gap-2 text-xs items-center">
            <span className="text-slate-500">Totale anno: Costi {fmtC(annualC)} — Ricavi {fmtC(annualR)}</span>
          </div>
        </div>

        {/* MONTH SELECTOR */}
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="flex gap-1 flex-wrap">
            {MESI.map((m, i) => {
              const hasCData = Object.values(prevMonthly).some(arr => arr && arr[i])
              const hasRData = Object.values(revMonthly).some(arr => arr && arr[i])
              const hasData = hasCData || hasRData
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
        </div>

        {/* CE TREE */}
        <div className="p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* COSTI */}
            <div>
              <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">Costi preventivo — {MESI[mese]}</div>
              <div className="border border-slate-200 rounded-lg p-1.5 max-h-[500px] overflow-y-auto">
                {editedC.map((n, i) => <MonthlyTreeNode key={`mc-${n.code}-${i}-${mese}`} node={n} edits={costiEditsForMonth}
                  onEdit={(code, val) => onPrevMonthly(code, mese, val)} mese={mese} monthly={prevMonthly} onCopyToMonths={onPrevMonthly} />)}
              </div>
              <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                <span className="text-sm font-bold">TOTALE COSTI {MESI_SHORT[mese]}</span>
                <span className="text-sm font-bold text-red-600">{fmtC(totC)}</span>
              </div>
            </div>
            {/* RICAVI */}
            <div>
              <div className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-2">Ricavi previsti — {MESI[mese]}</div>
              <div className="border border-slate-200 rounded-lg p-1.5 max-h-[500px] overflow-y-auto">
                {editedR.map((n, i) => <MonthlyTreeNode key={`mr-${n.code}-${i}-${mese}`} node={n} edits={ricaviEditsForMonth}
                  onEdit={(code, val) => onRevMonthly(code, mese, val)} mese={mese} monthly={revMonthly} onCopyToMonths={onRevMonthly} />)}
              </div>
              <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                <span className="text-sm font-bold">TOTALE RICAVI {MESI_SHORT[mese]}</span>
                <span className="text-sm font-bold text-emerald-600">{fmtC(totR)}</span>
              </div>
            </div>
          </div>

          {/* Risultato mese */}
          <div className={`p-4 rounded-lg text-center font-bold ${ris >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            <div className="text-lg">{MESI[mese]}: {ris >= 0 ? 'Utile' : 'Perdita'} {fmtC(Math.abs(ris))}</div>
            <div className="text-xs font-normal mt-1 opacity-70">
              Ricavi {fmtC(totR)} — Costi {fmtC(totC)}
              {totR > 0 && ` — Margine ${((ris / totR) * 100).toFixed(1)}%`}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   CONFRONTO ROW — Voce | Preventivo | Consuntivo | Rettifica | Scostamento | %
   Scostamento = Consuntivo + Rettifica - Preventivo
   ═══════════════════════════════════════════════════════════ */
const CONF_COLS = '1fr 85px 95px 90px 85px 55px'

function ConfrontoRow({ prevNode, consNode, rettNode, depth = 0, consEdits, onConsEdit, rettEdits, onRettEdit }) {
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
function ConfrontoPanel({ outletCode, outletLabel, prevEdits, consEdits, onConsEdit, rettEdits, onRettEdit, costiTree, ricaviTree, year, cashTotals, cashLoaded }) {
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

