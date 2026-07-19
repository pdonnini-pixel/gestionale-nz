// @ts-nocheck
// Revisione pagamenti fornitori: chi rivede metodo/scadenze/banca preme
// "Salva e applica" e le SUE modifiche vengono applicate subito ai fornitori
// (flusso a un passo, deciso 2026-07-19 — audit A40: il doppio passo con
// approvazione del responsabile non veniva usato ed e' stato rimosso).
// Responsabilita' e tracciabilita' restano sul DB (supplier_payment_proposals):
// reviewed_by = chi ha proposto, applied_by/applied_at = chi ha applicato,
// prev_* = valori precedenti per l'annullo. Vengono applicate SOLO le proposte
// appena salvate (RPC per singolo id), mai quelle in sospeso di altri.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import {
  Search, Save, RotateCcw, ArrowLeft, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react'

// Famiglie di metodo mostrate all'operatrice (la "Tipologia")
const FAMIGLIE = ['Bonifico', 'RI.BA', 'RID', 'SDD', 'Contanti', 'Carta/Bancomat', 'Bollettino', 'Assegno', 'Altro']
// Opzioni scadenze (la "Modalità"), notazione DFFM
const SCAD_OPTS = ['A Vista', '30 gg DFFM', '60 gg DFFM', '90 gg DFFM', '120 gg DFFM',
  '30/60 gg DFFM', '30/60/90 gg DFFM', '60/90 gg DFFM', '60/90/120 gg DFFM', 'Data fissa mese']

const PER_PAGE = 20

// enum payment_method -> famiglia leggibile
function familyFromEnum(m: string): string {
  const v = String(m || '')
  if (v.startsWith('riba')) return 'RI.BA'
  if (v === 'rid') return 'RID'
  if (v.startsWith('sdd')) return 'SDD'
  if (v.startsWith('bonifico')) return 'Bonifico'
  if (v === 'carta_credito' || v === 'carta_debito') return 'Carta/Bancomat'
  if (v === 'contanti') return 'Contanti'
  if (v === 'bollettino_postale') return 'Bollettino'
  if (v === 'assegno') return 'Assegno'
  return 'Altro'
}
// famiglia + giorni -> valore enum payment_method valido
function enumFromFamily(fam: string, prima: number | null): string {
  switch (fam) {
    case 'Bonifico': return 'bonifico_ordinario'
    case 'RID': return 'rid'
    case 'SDD': return 'sdd_core'
    case 'Contanti': return 'contanti'
    case 'Carta/Bancomat': return 'carta_debito'
    case 'Bollettino': return 'bollettino_postale'
    case 'Assegno': return 'assegno'
    case 'RI.BA': {
      const g = Number(prima) || 30
      if (g <= 30) return 'riba_30'
      if (g <= 60) return 'riba_60'
      if (g <= 90) return 'riba_90'
      return 'riba_120'
    }
    default: return 'altro'
  }
}
// base+gg+rate -> etichetta "60/90/120 gg DFFM"
function scadLabel(base: string | null, gg: number | null, rate: number | null): string {
  if (gg == null) return 'da definire'
  const g = Number(gg); const n = Math.max(Number(rate) || 1, 1)
  if (g === 0) return 'A Vista'
  const parts: number[] = []; for (let i = 0; i < n; i++) parts.push(g + 30 * i)
  return parts.join('/') + (base === 'data_fattura' ? ' gg D.F.' : ' gg DFFM')
}
// etichetta -> {base, prima, rate, dataFissa}
function parseScad(label: string): { base: string | null; prima: number | null; rate: number | null; dataFissa: boolean } {
  const l = String(label || '').trim()
  if (/^Data fissa/i.test(l)) return { base: null, prima: null, rate: null, dataFissa: true }
  if (/^A Vista$/i.test(l)) return { base: 'data_fattura', prima: 0, rate: 1, dataFissa: false }
  const m = l.match(/^([\d/]+)\s*gg\s*(DFFM|D\.F\.)$/i)
  if (m) {
    const parts = m[1].split('/').map(Number).filter(n => !isNaN(n))
    const base = /D\.F\./i.test(m[2]) ? 'data_fattura' : 'fine_mese'
    return { base, prima: parts[0] ?? null, rate: parts.length || 1, dataFissa: false }
  }
  return { base: null, prima: null, rate: null, dataFissa: false }
}

// Nome banca breve e leggibile (nome completo resta nel tooltip)
function shortBank(name: string, iban: string): string {
  const head = String(name || '').split(/\s[-–·]\s/)[0].trim()
  const w = head.split(/\s+/).filter(Boolean).slice(0, 2).join(' ')
  return w || (iban ? iban.slice(-6) : '—')
}

type Supplier = Record<string, unknown> & { id: string }
type Bank = { id: string; label: string; full: string }
type Edit = { fam: string; scad: string; bank: string }

export default function RevisionePagamenti() {
  const { profile } = useAuth()
  const { toast } = useToast()
  const COMPANY_ID = profile?.company_id as string | undefined

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [dayFisso, setDayFisso] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [bankResolve, setBankResolve] = useState<Record<string, string>>({})

  const bankLabel = useCallback((id: string | null | undefined) => {
    if (!id) return '—'
    const key = bankResolve[String(id)] || String(id)
    return banks.find(b => b.id === key)?.label || '—'
  }, [banks, bankResolve])

  const load = useCallback(async () => {
    if (!COMPANY_ID) return
    setLoading(true)
    try {
      const [{ data: sup }, { data: ba }] = await Promise.all([
        supabase.from('suppliers')
          .select('id, ragione_sociale, name, payment_method, default_payment_method, payment_base, prima_scadenza_gg, numero_rate, payment_bank_account_id')
          .eq('company_id', COMPANY_ID)
          .or('is_deleted.is.null,is_deleted.eq.false')
          .or('is_active.is.null,is_active.eq.true'),
        supabase.from('bank_accounts').select('id, bank_name, account_name, iban')
          .eq('company_id', COMPANY_ID).or('is_active.is.null,is_active.eq.true'),
      ])
      const rows = (sup || []) as Supplier[]
      rows.sort((a, b) => String(a.ragione_sociale || a.name || '').localeCompare(String(b.ragione_sociale || b.name || ''), 'it'))
      setSuppliers(rows)
      // Deduplica le banche per IBAN (in anagrafica può esserci lo stesso conto
      // ripetuto) e usa un nome breve; mappa gli id "doppioni" a quello canonico.
      const rawB = ((ba || []) as Record<string, unknown>[]).map(b => ({
        id: String(b.id), name: String(b.bank_name || ''), iban: String(b.iban || ''),
        full: [b.bank_name, b.iban].filter(Boolean).join(' · ') || String(b.id).slice(0, 8),
      }))
      const seen: Record<string, string> = {}; const resolve: Record<string, string> = {}
      const dedup: typeof rawB = []
      for (const b of rawB) {
        const key = b.iban || b.id
        if (seen[key]) { resolve[b.id] = seen[key]; continue }
        seen[key] = b.id; resolve[b.id] = b.id; dedup.push(b)
      }
      const shortCount: Record<string, number> = {}
      dedup.forEach(b => { const s = shortBank(b.name, b.iban); shortCount[s] = (shortCount[s] || 0) + 1 })
      setBanks(dedup.map(b => {
        let label = shortBank(b.name, b.iban)
        if (shortCount[label] > 1 && b.iban) label += ' ·' + b.iban.slice(-4)
        return { id: b.id, label, full: b.full }
      }))
      setBankResolve(resolve)
      setEdits({}); setDayFisso({})
    } catch (e) {
      console.warn('[revisione-pagamenti]', e)
      toast({ type: 'error', message: 'Errore nel caricamento dei fornitori.' })
    } finally { setLoading(false) }
  }, [COMPANY_ID, toast])

  useEffect(() => { void load() }, [load])

  // stato "originale" (dal DB) di una riga
  const orig = useCallback((s: Supplier): Edit => {
    const method = String(s.default_payment_method || s.payment_method || '')
    const rawBank = String(s.payment_bank_account_id || '')
    return {
      fam: familyFromEnum(method),
      scad: scadLabel(s.payment_base as string | null, s.prima_scadenza_gg as number | null, s.numero_rate as number | null),
      bank: rawBank ? (bankResolve[rawBank] || rawBank) : '',
    }
  }, [bankResolve])
  const current = useCallback((s: Supplier): Edit => edits[s.id] || orig(s), [edits, orig])
  const isEdited = useCallback((s: Supplier): boolean => {
    const o = orig(s), c = current(s)
    return o.fam !== c.fam || o.scad !== c.scad || o.bank !== c.bank
  }, [orig, current])

  const setEdit = (s: Supplier, patch: Partial<Edit>) => {
    setEdits(prev => ({ ...prev, [s.id]: { ...orig(s), ...(prev[s.id] || {}), ...patch } }))
  }

  const editedList = useMemo(() => suppliers.filter(isEdited), [suppliers, isEdited])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter(s => String(s.ragione_sociale || s.name || '').toLowerCase().includes(q))
  }, [suppliers, search])

  // Paginazione: 20 fornitori per pagina
  useEffect(() => { setPage(1) }, [search])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const pageSafe = Math.min(page, totalPages)
  const pageStart = (pageSafe - 1) * PER_PAGE
  const pageRows = filtered.slice(pageStart, pageStart + PER_PAGE)

  async function saveChanges() {
    if (!COMPANY_ID || editedList.length === 0) { toast({ type: 'warning', message: 'Nessuna modifica da salvare.' }); return }
    setSaving(true)
    try {
      const payload = editedList.map(s => {
        const c = current(s)
        const scadTxt = c.scad === 'Data fissa mese'
          ? `Data fissa mese (giorno ${dayFisso[s.id] || '?'})`
          : c.scad
        const p = parseScad(scadTxt)
        return {
          company_id: COMPANY_ID,
          supplier_id: s.id,
          supplier_name: String(s.ragione_sociale || s.name || ''),
          proposed_method: enumFromFamily(c.fam, p.prima),
          proposed_base: p.base,
          proposed_prima_gg: p.prima,
          proposed_rate: p.rate,
          proposed_bank_account_id: c.bank || null,
          proposed_scad_label: scadTxt,
          note: p.dataFissa ? scadTxt : null,
          status: 'inviata',
          reviewed_by: profile?.id ?? null,
          updated_at: new Date().toISOString(),
        }
      })
      // L'upsert restituisce gli id delle SOLE proposte appena salvate: sono le
      // uniche che verranno applicate. Prima si chiamava
      // rpc_apply_all_payment_proposals, che applicava TUTTE le proposte
      // 'inviata' dell'azienda — comprese eventuali proposte pendenti di altri
      // (audit A40): chi salvava si prendeva la responsabilita' anche di
      // modifiche mai viste.
      const { data: savedRows, error } = await supabase.from('supplier_payment_proposals' as never)
        .upsert(payload as never, { onConflict: 'company_id,supplier_id' })
        .select('id')
      if (error) throw error
      const ids: string[] = ((savedRows || []) as Array<{ id: string }>).map(r => r.id)
      let applied = 0
      const failed: string[] = []
      for (const id of ids) {
        const { data: ok, error: applyErr } = await supabase.rpc('rpc_apply_payment_proposal' as never, { p_id: id } as never)
        if (applyErr || ok === false) failed.push(id)
        else applied++
      }
      if (failed.length > 0) {
        toast({ type: 'error', message: `${applied} modifiche applicate, ${failed.length} NON applicate: ricontrolla le righe evidenziate e riprova.` })
      } else {
        toast({ type: 'success', message: `${applied} modifiche salvate e applicate ai fornitori.` })
      }
      await load()
    } catch (e) {
      console.warn('[revisione-pagamenti:save]', e)
      toast({ type: 'error', message: 'Salvataggio non riuscito. Nessuna modifica applicata: riprova.' })
    } finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-4 max-w-[1600px] mx-auto">
      <PageHeader
        title="Revisione pagamenti fornitori"
        subtitle="Controlla Tipologia, Modalità (scadenze) e Banca, poi salva le modifiche"
        actions={
          <Link to="/fornitori" className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2">
            <ArrowLeft size={15} /> Torna a Fornitori
          </Link>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
          <Search size={16} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca fornitore…"
            className="w-full text-sm outline-none bg-transparent" />
        </div>
        <span className="text-sm text-slate-500">{suppliers.length} fornitori · <b className="text-amber-600">{editedList.length}</b> modificati</span>
        {editedList.length > 0 && (
          <button onClick={() => { setEdits({}); setDayFisso({}) }}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2">
            <RotateCcw size={15} /> Annulla modifiche
          </button>
        )}
        <button onClick={saveChanges} disabled={saving || editedList.length === 0}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salva e applica{editedList.length ? ` (${editedList.length})` : ''}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Modifica solo i fornitori sbagliati (la riga diventa gialla) e premi <b>Salva e applica</b>: le TUE correzioni vengono applicate subito ai fornitori, sotto la tua responsabilità. Ogni applicazione resta tracciata (chi ha proposto, chi ha applicato, quando) e salva il valore precedente, così è sempre annullabile.
      </p>

      {/* Griglia */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto scroll-shadow-x">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5 w-10 text-right">#</th>
                <th className="px-3 py-2.5">Ragione sociale</th>
                <th className="px-3 py-2.5 w-40">Tipologia</th>
                <th className="px-3 py-2.5 w-56">Modalità (scadenze)</th>
                <th className="px-3 py-2.5 w-48">Banca</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400"><Loader2 className="inline animate-spin mr-2" size={16} />Caricamento…</td></tr>
              )}
              {!loading && pageRows.map((s, i) => {
                const rowNum = pageStart + i + 1
                const c = current(s), edited = isEdited(s)
                const scadOpts = SCAD_OPTS.slice()
                const isFissa = c.scad === 'Data fissa mese' || /^Data fissa/i.test(c.scad)
                if (!isFissa && !scadOpts.includes(c.scad)) scadOpts.unshift(c.scad)
                return (
                  <tr key={s.id} className={`border-t border-slate-100 ${edited ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-2 text-right text-xs text-slate-400 tabular-nums">{rowNum}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{String(s.ragione_sociale || s.name || '')}</td>
                    <td className="px-3 py-2">
                      <select value={c.fam} onChange={e => setEdit(s, { fam: e.target.value })}
                        className={`w-full px-2 py-1.5 border rounded-lg text-sm ${c.fam !== orig(s).fam ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                        {(FAMIGLIE.includes(c.fam) ? FAMIGLIE : [c.fam, ...FAMIGLIE]).map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <select value={isFissa ? 'Data fissa mese' : c.scad} onChange={e => setEdit(s, { scad: e.target.value })}
                          className={`flex-1 px-2 py-1.5 border rounded-lg text-sm ${c.scad !== orig(s).scad ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                          {scadOpts.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        {(c.scad === 'Data fissa mese' || isFissa) && (
                          <input type="number" min={1} max={31} placeholder="giorno" value={dayFisso[s.id] || ''}
                            onChange={e => setDayFisso(prev => ({ ...prev, [s.id]: e.target.value }))}
                            className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <select value={c.bank} onChange={e => setEdit(s, { bank: e.target.value })}
                        title={banks.find(b => b.id === c.bank)?.full || ''}
                        className={`w-full px-2 py-1.5 border rounded-lg text-sm ${c.bank !== orig(s).bank ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                        <option value="">— nessuna —</option>
                        {banks.map(b => <option key={b.id} value={b.id} title={b.full}>{b.label}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Nessun fornitore trovato.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginazione — 20 fornitori per pagina */}
      {!loading && filtered.length > PER_PAGE && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-slate-500">
            {pageStart + 1}–{Math.min(pageStart + PER_PAGE, filtered.length)} di {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageSafe <= 1}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1">
              <ChevronLeft size={15} /> Precedente
            </button>
            <span className="text-slate-600 tabular-nums px-1">Pagina {pageSafe} di {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1">
              Successiva <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
