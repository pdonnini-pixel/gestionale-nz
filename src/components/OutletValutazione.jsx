/**
 * Outlet in Valutazione — simulazioni CE per nuovi outlet
 * Salvate su DB, con nome, possibilità di confronto e attivazione
 */
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  getCodeLevel, buildTree, sumMacros, applyEditsZero, flattenLeaves, fmt, fmtC
} from '../lib/ceHelpers'
import {
  Rocket, Plus, Save, Trash2, Copy, ChevronDown, ChevronUp, CheckCircle2,
  AlertTriangle, Edit3, Eye, Archive, Star
} from 'lucide-react'

// ─── TREE COMPONENTS ──────────────────────────────────────

function TreeNodeEdit({ node, depth = 0, edits, onEdit }) {
  const [open, setOpen] = useState(false)
  const hasKids = node.children?.length > 0
  const isMacro = node.level === 0
  const isLeaf = !hasKids
  const val = edits[node.code] != null ? edits[node.code] : (node.amount || 0)
  const isEdited = edits[node.code] != null

  return (
    <div>
      <div className={`flex items-center py-1 px-1 rounded transition ${hasKids ? 'cursor-pointer hover:bg-slate-50' : ''} ${isMacro ? 'bg-slate-50/80 mt-1' : ''}`}
        style={{ paddingLeft: `${4 + depth * 16}px` }} onClick={() => hasKids && setOpen(!open)}>
        <span className="w-4 shrink-0 text-center text-[10px] text-slate-400">{hasKids ? (open ? '▾' : '▸') : ''}</span>
        <span className={`font-mono text-slate-400 shrink-0 ml-0.5 ${isMacro ? 'text-[11px] font-bold' : 'text-[10px]'}`}
          style={{ width: node.code?.length > 4 ? '50px' : '26px' }}>{node.code}</span>
        <span className={`truncate ml-1 flex-1 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[11px] text-slate-600'}`}>{node.description}</span>
        {isLeaf ? (
          <input type="text" inputMode="numeric"
            value={isEdited ? val : (val || '')}
            onClick={e => e.stopPropagation()}
            onChange={e => { const raw = e.target.value.replace(/\./g, '').replace(',', '.'); onEdit(node.code, parseFloat(raw) || 0) }}
            className={`w-24 text-right px-1 py-0.5 text-[11px] border rounded ml-1 tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 ${isEdited ? 'bg-indigo-50 border-indigo-300' : 'border-slate-200'}`}
            placeholder="0" />
        ) : (
          <span className={`tabular-nums text-right shrink-0 ml-1 text-[11px] ${isMacro ? 'font-bold text-slate-900 w-28' : 'text-slate-500 w-24'}`}>{fmt(node.amount)} €</span>
        )}
      </div>
      {open && hasKids && node.children.map((c, i) => (
        <TreeNodeEdit key={`${c.code}-${i}`} node={c} depth={depth + 1} edits={edits} onEdit={onEdit} />
      ))}
    </div>
  )
}

function TreeNodeView({ node, depth = 0 }) {
  const [open, setOpen] = useState(false)
  const hasKids = node.children?.length > 0
  const isMacro = node.level === 0
  return (
    <div>
      <div className={`flex items-center py-1 px-1 rounded transition ${hasKids ? 'cursor-pointer hover:bg-slate-50' : ''} ${isMacro ? 'bg-slate-50/80 mt-1' : ''}`}
        style={{ paddingLeft: `${4 + depth * 16}px` }} onClick={() => hasKids && setOpen(!open)}>
        <span className="w-4 shrink-0 text-center text-[10px] text-slate-400">{hasKids ? (open ? '▾' : '▸') : ''}</span>
        <span className={`font-mono text-slate-400 shrink-0 ml-0.5 ${isMacro ? 'text-[11px] font-bold' : 'text-[10px]'}`}
          style={{ width: node.code?.length > 4 ? '50px' : '26px' }}>{node.code}</span>
        <span className={`truncate ml-1 flex-1 ${isMacro ? 'text-[11px] font-bold text-slate-900' : 'text-[11px] text-slate-600'}`}>{node.description}</span>
        <span className={`tabular-nums text-right shrink-0 ml-1 text-[11px] ${isMacro ? 'font-bold text-slate-900 w-28' : 'text-slate-500 w-24'}`}>{fmt(node.amount)} €</span>
      </div>
      {open && hasKids && node.children.map((c, i) => (
        <TreeNodeView key={`${c.code}-${i}`} node={c} depth={depth + 1} />
      ))}
    </div>
  )
}

// ─── STATUS BADGE ─────────────────────────────────────────

function SimBadge({ status }) {
  const map = {
    bozza: { bg: 'bg-amber-50 text-amber-700', label: 'Bozza' },
    approvato: { bg: 'bg-emerald-50 text-emerald-700', label: 'Approvato' },
    archiviato: { bg: 'bg-slate-100 text-slate-500', label: 'Archiviato' },
  }
  const s = map[status] || map.bozza
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${s.bg}`}>{s.label}</span>
}

// ─── MAIN COMPONENT ───────────────────────────────────────

export default function OutletValutazione() {
  const { profile } = useAuth()
  const CID = profile?.company_id

  // CE data
  const [ceRawCosti, setCeRawCosti] = useState([])
  const [ceRawRicavi, setCeRawRicavi] = useState([])
  const [loading, setLoading] = useState(true)

  // Simulations
  const [simulations, setSimulations] = useState([])
  const [activeSimId, setActiveSimId] = useState(null)
  const [simName, setSimName] = useState('')
  const [costEdits, setCostEdits] = useState({})
  const [revEdits, setRevEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  const show = (msg, t = 'ok') => { setToast({ msg, t }); setTimeout(() => setToast(null), 3000) }

  // Load CE tree + simulations
  useEffect(() => { if (CID) loadAll() }, [CID])

  async function loadAll() {
    setLoading(true)
    try {
      const [bsR, simR] = await Promise.all([
        supabase.from('balance_sheet_data').select('*').eq('company_id', CID).eq('year', 2025).in('section', ['ce_costi', 'ce_ricavi']).order('sort_order'),
        supabase.from('outlet_simulations').select('*').eq('company_id', CID).order('created_at', { ascending: false }),
      ])

      // Parse CE
      const junk = /Azienda:|Cod\.\s*Fiscale|Partita\s*IVA|^VIA\s|PERIODO\s*DAL|Totali\s*fino|^Pag\.|Considera anche|movimenti provvisori/i
      const clean = (bsR.data || []).filter(r => (r.account_code && r.account_code.trim()) && !junk.test(r.account_name || ''))
      const co = [], ri = []
      clean.forEach(r => {
        const row = { code: r.account_code || '', description: r.account_name || '', amount: r.amount || 0, level: getCodeLevel(r.account_code), isMacro: (r.account_code || '').replace(/\s/g, '').length <= 2 }
        r.section === 'ce_costi' ? co.push(row) : ri.push(row)
      })
      setCeRawCosti(co)
      setCeRawRicavi(ri)
      setSimulations(simR.data || [])
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  const costiTree = useMemo(() => buildTree(ceRawCosti), [ceRawCosti])
  const ricaviTree = useMemo(() => buildTree(ceRawRicavi), [ceRawRicavi])

  // ─── SIMULATION CRUD ─────────────────────────────────────

  function newSimulation() {
    setActiveSimId('new')
    setSimName('')
    setCostEdits({})
    setRevEdits({})
  }

  function editSimulation(sim) {
    setActiveSimId(sim.id)
    setSimName(sim.name)
    setCostEdits(sim.cost_edits || {})
    setRevEdits(sim.rev_edits || {})
  }

  async function saveSimulation() {
    if (!simName.trim()) { show('Inserisci un nome', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        company_id: CID,
        name: simName.trim(),
        cost_edits: costEdits,
        rev_edits: revEdits,
        updated_at: new Date().toISOString(),
      }

      if (activeSimId === 'new') {
        payload.created_by = profile?.id
        const { data, error } = await supabase.from('outlet_simulations').insert(payload).select('id').single()
        if (error) throw error
        setActiveSimId(data.id)
        show(`Simulazione "${simName}" salvata ✓`)
      } else {
        const { error } = await supabase.from('outlet_simulations').update(payload).eq('id', activeSimId)
        if (error) throw error
        show(`Simulazione "${simName}" aggiornata ✓`)
      }
      loadAll()
    } catch (e) { show(e.message, 'error') } finally { setSaving(false) }
  }

  async function deleteSimulation(id) {
    if (!confirm('Eliminare questa simulazione?')) return
    const { error } = await supabase.from('outlet_simulations').delete().eq('id', id)
    if (error) { show(error.message, 'error'); return }
    if (activeSimId === id) { setActiveSimId(null); setCostEdits({}); setRevEdits({}) }
    show('Simulazione eliminata')
    loadAll()
  }

  async function setStatus(id, status) {
    const { error } = await supabase.from('outlet_simulations').update({ status }).eq('id', id)
    if (error) { show(error.message, 'error'); return }
    show(`Stato aggiornato: ${status}`)
    loadAll()
  }

  const [confirmAction, setConfirmAction] = useState(null)

  function clearAll() {
    setConfirmAction({
      title: 'Svuota simulazione',
      message: 'Tutti i costi e ricavi di questa simulazione verranno cancellati.',
      action: () => { setCostEdits({}); setRevEdits({}); show('Dati cancellati') }
    })
  }

  function copyFromOutlet(simId) {
    const sim = simulations.find(s => s.id === simId)
    if (sim) {
      setCostEdits(sim.cost_edits || {})
      setRevEdits(sim.rev_edits || {})
      show(`Copiato da "${sim.name}"`)
    }
  }

  // ─── COMPUTED ────────────────────────────────────────────

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
            <p className="text-xs text-slate-500 mt-0.5">{simulations.length} simulazioni — clicca per modificare</p>
          </div>
          <button onClick={newSimulation} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2">
            <Plus size={16} /> Nuova simulazione
          </button>
        </div>

        {simulations.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <Rocket size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nessuna simulazione. Crea la prima!</p>
          </div>
        ) : (
          <div className="space-y-2">
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
                        Costi {fmtC(sC)} — Ricavi {fmtC(sR)} — {new Date(sim.created_at).toLocaleDateString('it-IT')}
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
                    <button onClick={() => deleteSimulation(sim.id)} title="Elimina" className="p-1 hover:bg-red-50 rounded"><Trash2 size={14} className="text-red-400" /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* EDITOR */}
      {activeSimId && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div className="flex-1 max-w-md">
              <label className="text-xs font-medium text-slate-600">Nome simulazione</label>
              <input value={simName} onChange={e => setSimName(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="Es. Outlet Milano City" />
            </div>
            <div className="flex items-center gap-2">
              {simulations.length > 0 && (
                <select onChange={e => e.target.value && copyFromOutlet(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs" defaultValue="">
                  <option value="">Copia da simulazione...</option>
                  {simulations.filter(s => s.id !== activeSimId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <button onClick={clearAll} className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 flex items-center gap-1.5">
                <Trash2 size={12} /> Cancella dati
              </button>
              <button onClick={saveSimulation} disabled={saving} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                <Save size={14} /> {saving ? 'Salvo...' : 'Salva'}
              </button>
            </div>
          </div>

          {/* CE Tree */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">Componenti Negative (da compilare)</div>
              <div className="border border-slate-200 rounded-lg p-1.5 max-h-[500px] overflow-y-auto">
                {editedC.map((n, i) => <TreeNodeEdit key={`c-${n.code}-${i}`} node={n} edits={costEdits} onEdit={(c, v) => setCostEdits(prev => ({ ...prev, [c]: v }))} />)}
              </div>
              <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                <span className="text-sm font-bold">TOTALE COSTI</span>
                <span className="text-sm font-bold text-red-600">{fmtC(totC)}</span>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-2">Componenti Positive (da compilare)</div>
              <div className="border border-slate-200 rounded-lg p-1.5 max-h-[500px] overflow-y-auto">
                {editedR.map((n, i) => <TreeNodeEdit key={`r-${n.code}-${i}`} node={n} edits={revEdits} onEdit={(c, v) => setRevEdits(prev => ({ ...prev, [c]: v }))} />)}
              </div>
              <div className="mt-2 pt-2 border-t-2 border-slate-300 flex justify-between px-2">
                <span className="text-sm font-bold">TOTALE RICAVI</span>
                <span className="text-sm font-bold text-emerald-600">{fmtC(totR)}</span>
              </div>
            </div>
          </div>

          {/* Risultato */}
          <div className={`p-4 rounded-lg text-center font-bold ${ris >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            <div className="text-lg">{ris >= 0 ? 'Utile previsto' : 'Perdita prevista'}: {fmtC(Math.abs(ris))}</div>
            <div className="text-xs font-normal mt-1 opacity-70">
              Ricavi {fmtC(totR)} — Costi {fmtC(totC)}
              {totR > 0 && ` — Margine ${(ris / totR * 100).toFixed(1)}%`}
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DIALOG */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setConfirmAction(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-full bg-red-50"><Trash2 size={22} className="text-red-600" /></div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{confirmAction.title}</h3>
                <p className="text-sm text-slate-500">{confirmAction.message}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setConfirmAction(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition">Annulla</button>
              <button onClick={() => { confirmAction.action(); setConfirmAction(null) }} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition">Svuota</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.t === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
          {toast.t === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />} {toast.msg}
        </div>
      )}
    </div>
  )
}
