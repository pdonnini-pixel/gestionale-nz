/**
 * Outlet in Valutazione — simulazioni CE per nuovi outlet
 * Salvate su DB, con nome, possibilità di confronto e attivazione
 */
import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ConfirmModal } from './ui/Modal'
import { useAuth } from '../hooks/useAuth'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import { usePeriod } from '../hooks/usePeriod'
import {
  getCodeLevel, buildTree, sumMacros, applyEditsZero, fmt2, fmtC2, parseImportoIt,
  CETreeNode,
} from '../lib/ceHelpers'
import {
  Rocket, Plus, Save, Trash2, CheckCircle2,
  AlertTriangle, Archive, Star, X
} from 'lucide-react'

// ─── TREE COMPONENTS ──────────────────────────────────────

interface TreeNode extends CETreeNode {
  description?: string
  isMacro?: boolean
  children: TreeNode[]
}

interface Simulation {
  id: string
  name: string
  status: string
  cost_edits: Record<string, number>
  rev_edits: Record<string, number>
  created_at: string
  created_by?: string
  company_id: string
  updated_at: string
}

type ToastType = 'ok' | 'error'

// La struttura CE viene dal piano dei conti (chart_of_accounts), classificata
// via is_revenue — stessa fonte/gerarchia di Budget & Controllo. Niente codici
// semantici di bilancio: ogni macro-voce ha i suoi sottoconti, tutto collassabile.

function TreeNodeEdit({ node, depth = 0, edits, onEdit }: { node: CETreeNode; depth?: number; edits: Record<string, number>; onEdit: (code: string, value: number) => void }) {
  // Nodi espansi di default a ogni livello: il form mostra subito i campi di
  // dettaglio compilabili. Restano collassabili a mano.
  const [open, setOpen] = useState(true)
  const hasKids = (node.children?.length ?? 0) > 0
  // Macro = livello 1 del piano dei conti (es. 61, 63, 67…). Stile in grassetto.
  const isMacro = node.level <= 1
  const isLeaf = !hasKids
  const val = edits[node.code] != null ? edits[node.code] : (node.amount || 0)
  const isEdited = edits[node.code] != null
  const description = (node as { description?: string }).description ?? ''

  // Editing importo: stato locale del testo digitato per NON riformattare a ogni
  // keystroke (la riformattazione mid-typing scartava virgola/punto → bug ×100).
  // In focus si mostra il draft (forma editabile, virgola decimale); fuori focus
  // si mostra il valore formattato con fmt2 ("1.250,50").
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const displayValue = focused ? draft : (val ? fmt2(val) : '')

  return (
    <div>
      <div className={`flex items-center py-1 px-1 rounded transition ${hasKids ? 'cursor-pointer hover:bg-slate-50' : ''} ${isMacro ? 'bg-slate-50/80 mt-1' : ''}`}
        style={{ paddingLeft: `${4 + depth * 16}px` }} onClick={() => hasKids && setOpen(!open)}
        title={hasKids ? 'Mostra/Nascondi dettaglio' : undefined}>
        <span className="w-4 shrink-0 text-center text-[10px] text-slate-400">{hasKids ? (open ? '▾' : '▸') : ''}</span>
        {/* Solo etichetta umana + riferimento CE: niente codici tecnici in UI */}
        <span className={`truncate ml-1 flex-1 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[11px] text-slate-600'}`} title={description}>{description}</span>
        {isLeaf ? (
          <input type="text" inputMode="decimal"
            value={displayValue}
            onClick={e => e.stopPropagation()}
            onFocus={() => { setFocused(true); setDraft(val ? String(val).replace('.', ',') : '') }}
            onChange={e => { setDraft(e.target.value); onEdit(node.code, parseImportoIt(e.target.value)) }}
            onBlur={() => setFocused(false)}
            className={`w-24 text-right px-1 py-0.5 text-[11px] border rounded ml-1 tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 ${isEdited ? 'bg-indigo-50 border-indigo-300' : 'border-slate-200'}`}
            placeholder="0" />
        ) : (
          <span className={`tabular-nums text-right shrink-0 ml-1 text-[11px] ${isMacro ? 'font-bold text-slate-900 w-28' : 'text-slate-500 w-24'}`}>{fmt2(node.amount)} €</span>
        )}
      </div>
      {open && hasKids && node.children.map((c, i) => (
        <TreeNodeEdit key={`${c.code}-${i}`} node={c} depth={depth + 1} edits={edits} onEdit={onEdit} />
      ))}
    </div>
  )
}

// ─── STATUS BADGE ─────────────────────────────────────────

function SimBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; label: string }> = {
    bozza: { bg: 'bg-amber-50 text-amber-700', label: 'Bozza' },
    approvato: { bg: 'bg-emerald-50 text-emerald-700', label: 'Approvato' },
    archiviato: { bg: 'bg-slate-100 text-slate-500', label: 'Archiviato' },
  }
  const s = map[status] || map.bozza
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${s.bg}`}>{s.label}</span>
}

// ─── MAIN COMPONENT ───────────────────────────────────────

// Slug leggibile da nome ("Outlet Milano City" → outlet-milano-city)
const slugify = (s: string) =>
  (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'simulazione'

// Slug univoco nella lista: nome-slug, con suffisso id solo se il nome collide
const simSlugFor = (sim: Simulation, all: Simulation[]) => {
  const base = slugify(sim.name)
  const dup = all.some(s => s.id !== sim.id && slugify(s.name) === base)
  return dup ? `${base}-${sim.id.slice(0, 8)}` : base
}

const findSimBySlug = (slug: string, all: Simulation[]): Simulation | null =>
  all.find(s => s.id === slug)
  || all.find(s => `${slugify(s.name)}-${s.id.slice(0, 8)}` === slug)
  || all.find(s => slugify(s.name) === slug)
  || null

export default function OutletValutazione() {
  const { profile } = useAuth()
  const labels = useCompanyLabels()
  const { year: periodYear } = usePeriod()
  const { simSlug } = useParams()
  const navigate = useNavigate()
  const CID = profile?.company_id

  // CE data
  type CeRow = { code: string; description: string; amount: number; level: number; isMacro: boolean }
  const [ceRawCosti, setCeRawCosti] = useState<CeRow[]>([])
  const [ceRawRicavi, setCeRawRicavi] = useState<CeRow[]>([])
  const [loading, setLoading] = useState(true)

  // Simulations
  const [simulations, setSimulations] = useState<Simulation[]>([])
  const [activeSimId, setActiveSimId] = useState<string | null>(null)
  const [simName, setSimName] = useState('')
  const [costEdits, setCostEdits] = useState<Record<string, number>>({})
  const [revEdits, setRevEdits] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; t: ToastType } | null>(null)
  // Modal custom di conferma eliminazione (niente confirm() nativo)
  const [deleteTarget, setDeleteTarget] = useState<Simulation | null>(null)
  // Visibilità del form: true solo dopo "+ Nuova simulazione" o aprendo una
  // simulazione esistente (anche da URL slug). activeSimId null + formOpen =
  // bozza nuova non ancora salvata.
  const [formOpen, setFormOpen] = useState(false)

  const show = (msg: string, t: ToastType = 'ok') => { setToast({ msg, t }); setTimeout(() => setToast(null), 3000) }

  // Load CE tree + simulations
  useEffect(() => { if (CID) loadAll() }, [CID, periodYear])

  async function loadAll() {
    if (!CID) return
    setLoading(true)
    try {
      // Struttura CE dal piano dei conti (chart_of_accounts), STESSA fonte e
      // gerarchia di Budget & Controllo: macro (livello 1) → sottoconti (2) →
      // conti di dettaglio (3). Ogni macro è quindi un nodo collassabile.
      // is_revenue separa ricavi/costi. Importi a 0: la simulazione parte da
      // base ZERO, i valori stanno negli edits.
      const [coaR, simR] = await Promise.all([
        supabase.from('chart_of_accounts')
          .select('code, name, level, is_revenue, sort_order')
          .eq('company_id', CID).eq('is_active', true).order('sort_order'),
        supabase.from('outlet_simulations').select('*').eq('company_id', CID).order('created_at', { ascending: false }),
      ])

      type CoaRow = { code: string; name: string | null; level: number | null; is_revenue: boolean | null }
      const co: CeRow[] = []
      const ri: CeRow[] = []
      ;((coaR.data || []) as CoaRow[]).forEach(c => {
        const lvl = c.level ?? getCodeLevel(c.code)
        const row: CeRow = { code: c.code, description: c.name || '', amount: 0, level: lvl, isMacro: lvl <= 1 }
        if (c.is_revenue) ri.push(row)
        else co.push(row)
      })
      setCeRawCosti(co)
      setCeRawRicavi(ri)
      setSimulations((simR.data ?? []) as unknown as Simulation[])
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  const costiTree = useMemo(() => buildTree(ceRawCosti), [ceRawCosti])
  const ricaviTree = useMemo(() => buildTree(ceRawRicavi), [ceRawRicavi])

  // ─── SIMULATION CRUD ─────────────────────────────────────

  function newSimulation() {
    setFormOpen(true)
    setActiveSimId(null)
    setSimName('')
    setCostEdits({})
    setRevEdits({})
    navigate('/outlet/valutazione')
  }

  // Carica la simulazione nello stato (senza navigare): usato dall'apertura via URL
  function openSimState(sim: Simulation) {
    setFormOpen(true)
    setActiveSimId(sim.id)
    setSimName(sim.name)
    setCostEdits(sim.cost_edits || {})
    setRevEdits(sim.rev_edits || {})
  }

  function editSimulation(sim: Simulation) {
    openSimState(sim)
    navigate(`/outlet/valutazione/${simSlugFor(sim, simulations)}`)
  }

  // Chiude il form (annulla bozza o esce dalla modifica)
  function closeForm() {
    setFormOpen(false)
    setActiveSimId(null)
    setSimName('')
    setCostEdits({})
    setRevEdits({})
    navigate('/outlet/valutazione')
  }

  // Apri la simulazione indicata dall'URL (/outlet/valutazione/:simSlug) dopo il load
  useEffect(() => {
    if (loading || !simSlug) return
    const sim = findSimBySlug(simSlug, simulations)
    if (sim && activeSimId !== sim.id) openSimState(sim)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simSlug, loading, simulations])

  async function saveSimulation() {
    if (!simName.trim()) { show('Inserisci un nome', 'error'); return }
    if (!CID) return
    setSaving(true)
    try {
      const payload: {
        company_id: string
        name: string
        cost_edits: Record<string, number>
        rev_edits: Record<string, number>
        updated_at: string
        created_by?: string
      } = {
        company_id: CID,
        name: simName.trim(),
        cost_edits: costEdits,
        rev_edits: revEdits,
        updated_at: new Date().toISOString(),
      }

      if (!activeSimId) {
        payload.created_by = profile?.id
        const { data, error } = await supabase.from('outlet_simulations').insert(payload).select('id').single()
        if (error) throw error
        setActiveSimId(data.id)
        const saved = { id: data.id, name: simName.trim() } as Simulation
        navigate(`/outlet/valutazione/${simSlugFor(saved, simulations)}`, { replace: true })
        show(`Simulazione "${simName}" salvata ✓`)
      } else if (activeSimId) {
        const { error } = await supabase.from('outlet_simulations').update(payload).eq('id', activeSimId)
        if (error) throw error
        const saved = { id: activeSimId, name: simName.trim() } as Simulation
        navigate(`/outlet/valutazione/${simSlugFor(saved, simulations)}`, { replace: true })
        show(`Simulazione "${simName}" aggiornata ✓`)
      }
      loadAll()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Errore'
      show(msg, 'error')
    } finally { setSaving(false) }
  }

  async function confirmDeleteSimulation() {
    const target = deleteTarget
    if (!target) return
    setDeleteTarget(null)
    const { error } = await supabase.from('outlet_simulations').delete().eq('id', target.id)
    if (error) { show(error.message, 'error'); return }
    if (activeSimId === target.id) {
      setFormOpen(false)
      setActiveSimId(null); setCostEdits({}); setRevEdits({})
      navigate('/outlet/valutazione')
    }
    show('Simulazione eliminata')
    loadAll()
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from('outlet_simulations').update({ status }).eq('id', id)
    if (error) { show(error.message, 'error'); return }
    show(`Stato aggiornato: ${status}`)
    loadAll()
  }

  function clearAll() {
    setCostEdits({})
    setRevEdits({})
    show('Dati cancellati')
  }

  function copyFromOutlet(simId: string) {
    const sim = simulations.find(s => s.id === simId)
    if (sim) {
      setCostEdits(sim.cost_edits || {})
      setRevEdits(sim.rev_edits || {})
      show(`Copiato da "${sim.name}"`)
    }
  }

  // ─── COMPUTED ────────────────────────────────────────────

  // Base ZERO sia per costi che per ricavi: una nuova simulazione parte con
  // tutti i campi a 0 (nessun precompilato dai dati reali del tenant). I valori
  // salvati restano negli edits e vengono riapplicati sopra la base a zero.
  const editedC = applyEditsZero(costiTree, costEdits)
  const editedR = applyEditsZero(ricaviTree, revEdits)
  const totC = sumMacros(editedC)
  const totR = sumMacros(editedR)
  const ris = totR - totC
  const hasEdits = Object.keys(costEdits).length > 0 || Object.keys(revEdits).length > 0

  if (loading) return <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>

  // ─── RENDER ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* LISTA SIMULAZIONI */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Simulazioni salvate</h2>
            <p className="text-xs text-slate-500 mt-0.5">{simulations.length} {simulations.length === 1 ? 'simulazione' : 'simulazioni'}{simulations.length > 0 ? ' — clicca per modificare' : ''}</p>
          </div>
          <button onClick={newSimulation} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2">
            <Plus size={16} /> Nuova simulazione
          </button>
        </div>

        {simulations.length === 0 ? (
          formOpen ? (
            <div className="text-center py-8 text-amber-600">
              <Rocket size={32} className="mx-auto mb-2 opacity-60" />
              <p className="text-sm font-medium">Bozza in corso — non ancora salvata</p>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400">
              <Rocket size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Nessuna simulazione. Crea la prima!</p>
            </div>
          )
        ) : (
          <div className="space-y-2">
            {formOpen && activeSimId === null && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium">
                <Rocket size={14} /> Bozza in corso — non ancora salvata
              </div>
            )}
            {simulations.map(sim => {
              const sC = Object.values(sim.cost_edits || {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
              const sR = Object.values(sim.rev_edits || {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
              const isActive = activeSimId === sim.id
              return (
                <div key={sim.id} className={`flex items-center justify-between p-3 rounded-lg border transition cursor-pointer ${isActive ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  onClick={() => editSimulation(sim)}>
                  <div className="flex items-center gap-3">
                    <Rocket size={16} className={isActive ? 'text-indigo-600' : 'text-slate-400'} />
                    <div>
                      <div className="font-medium text-sm text-slate-900">{sim.name}</div>
                      <div className="text-[10px] text-slate-400">
                        Costi {fmtC2(sC)} — Ricavi {fmtC2(sR)} — {new Date(sim.created_at).toLocaleDateString('it-IT')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <SimBadge status={sim.status} />
                    {sim.status === 'bozza' && (
                      <button onClick={() => setStatus(sim.id, 'approvato')} title="Approva" className="p-1 hover:bg-emerald-50 rounded"><Star size={14} className="text-emerald-500" /></button>
                    )}
                    {sim.status === 'approvato' && (
                      <button onClick={() => setStatus(sim.id, 'archiviato')} title="Archivia" className="p-1 hover:bg-slate-100 rounded"><Archive size={14} className="text-slate-400" /></button>
                    )}
                    <button onClick={() => setDeleteTarget(sim)} title="Elimina" className="p-1 hover:bg-red-50 rounded"><Trash2 size={14} className="text-red-400" /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* EDITOR — visibile solo se il form è aperto */}
      {formOpen && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div className="flex-1 max-w-md">
              <label className="text-xs font-medium text-slate-600">Nome simulazione</label>
              <input value={simName} onChange={e => setSimName(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder={`Es. ${labels.pointOfSale} Milano City`} />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={closeForm} title="Chiudi" className="px-3 py-1.5 border border-slate-200 text-slate-500 rounded-lg text-sm font-medium hover:bg-slate-50 flex items-center gap-1.5">
                <X size={14} /> Chiudi
              </button>
              {simulations.length > 0 && (
                <select onChange={e => e.target.value && copyFromOutlet(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs" defaultValue="">
                  <option value="">Copia da simulazione...</option>
                  {simulations.filter(s => s.id !== activeSimId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {hasEdits && (
                <button onClick={clearAll} className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 flex items-center gap-1.5">
                  <Trash2 size={12} /> Cancella dati
                </button>
              )}
              <button onClick={saveSimulation} disabled={saving} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                <Save size={14} /> {saving ? 'Salvo...' : 'Salva'}
              </button>
            </div>
          </div>

          {/* CE Tree */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Componenti Negative (da compilare)</div>
              <div className="border border-slate-200 rounded-lg p-1.5 max-h-[500px] overflow-y-auto">
                {editedC.map((n, i) => <TreeNodeEdit key={`c-${n.code}-${i}`} node={n} edits={costEdits} onEdit={(c, v) => setCostEdits(prev => ({ ...prev, [c]: v }))} />)}
              </div>
              <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                <span className="text-sm font-bold">TOTALE COSTI</span>
                <span className={`text-sm font-bold ${totC < 0 ? 'text-red-600' : 'text-slate-900'}`}>{fmtC2(totC)}</span>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Componenti Positive (da compilare)</div>
              <div className="border border-slate-200 rounded-lg p-1.5 max-h-[500px] overflow-y-auto">
                {editedR.map((n, i) => <TreeNodeEdit key={`r-${n.code}-${i}`} node={n} edits={revEdits} onEdit={(c, v) => setRevEdits(prev => ({ ...prev, [c]: v }))} />)}
              </div>
              <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                <span className="text-sm font-bold">TOTALE RICAVI</span>
                <span className={`text-sm font-bold ${totR < 0 ? 'text-red-600' : 'text-slate-900'}`}>{fmtC2(totR)}</span>
              </div>
            </div>
          </div>

          {/* Risultato */}
          {/* Convenzione colori: positivo = nero senza segno, negativo = rosso col meno, niente verde */}
          <div className={`p-4 rounded-lg text-center font-bold ${ris < 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
            <div className={`text-lg ${ris < 0 ? 'text-red-600' : 'text-slate-900'}`}>{ris >= 0 ? 'Utile previsto' : 'Perdita prevista'}: {fmtC2(ris)}</div>
            <div className="text-xs font-normal mt-1 opacity-70 text-slate-600">
              Ricavi {fmtC2(totR)} — Costi {fmtC2(totC)}
              {totR > 0 && ` — Margine ${(ris / totR * 100).toFixed(1)}%`}
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFERMA ELIMINAZIONE (custom del progetto, niente confirm nativo) */}
      {/* Conferma eliminazione: usa il Modal condiviso accessibile (Escape, focus
          trap, role=dialog) — prima adozione del componente ui/Modal (audit A25). */}
      <ConfirmModal
        open={!!deleteTarget}
        title="Elimina simulazione"
        message={<>Vuoi eliminare la simulazione <span className="font-semibold text-slate-900">«{deleteTarget?.name}»</span>? L'operazione non è reversibile.</>}
        confirmLabel="Elimina"
        onConfirm={confirmDeleteSimulation}
        onClose={() => setDeleteTarget(null)}
      />

      {/* TOAST */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.t === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
          {toast.t === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />} {toast.msg}
        </div>
      )}
    </div>
  )
}
