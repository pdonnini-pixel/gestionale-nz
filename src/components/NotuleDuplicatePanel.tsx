import { useEffect, useState, useCallback } from 'react'
import { GitMerge, Loader2, ChevronDown, ChevronUp, AlertTriangle, Link2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useCompany } from '../hooks/useCompany'

// Pannello "Notule da verificare".
// Elenca le possibili coppie NOTULA MANUALE ↔ FATTURA A-Cube (SDI) rilevate dalla
// RPC rpc_detect_notula_duplicates: casi in cui una parcella (commercialista,
// consulente) inserita a mano corrisponde a una fattura elettronica arrivata dopo.
// L'operatrice conferma l'aggancio con "Unisci" (rpc_merge_manual_notula): la
// fattura vera assorbe la notula, tenendo lo stato pagato/riconciliazione.

interface NotulaPair {
  manual_id: string
  manual_number: string | null
  manual_date: string | null
  manual_amount: number | null
  manual_status: string | null
  acube_id: string
  acube_number: string | null
  acube_date: string | null
  acube_amount: number | null
  acube_status: string | null
  supplier_name: string | null
  match_reason: string
  ambiguo: boolean
}

const fmtEur = (n: number | null) =>
  `€ ${(Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('it-IT') : '—'

export default function NotuleDuplicatePanel() {
  const { company } = useCompany()
  const [rows, setRows] = useState<NotulaPair[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [mergingId, setMergingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!company?.id) return
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc(
        'rpc_detect_notula_duplicates' as never,
        { p_company: company.id } as never,
      )
      if (error) throw error
      setRows(((data as unknown as NotulaPair[]) || []))
    } catch (e) {
      console.warn('[notule-duplicate]', e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [company?.id])

  useEffect(() => { void load() }, [load])

  async function merge(pair: NotulaPair) {
    if (!company?.id) return
    setMergingId(pair.manual_id)
    try {
      const { data, error } = await supabase.rpc(
        'rpc_merge_manual_notula' as never,
        { p_company: company.id, p_manual_id: pair.manual_id, p_acube_id: pair.acube_id } as never,
      )
      const res = data as unknown as { ok?: boolean; error?: string } | null
      if (error || !res?.ok) {
        console.warn('[notule-merge]', error || res?.error)
        window.alert(`Impossibile unire: ${res?.error || error?.message || 'errore'}`)
        return
      }
      setRows(prev => prev.filter(r => r.manual_id !== pair.manual_id))
    } catch (e) {
      console.warn('[notule-merge]', e)
    } finally {
      setMergingId(null)
    }
  }

  if (loading && rows.length === 0) return null
  if (rows.length === 0) return null

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Link2 size={18} className="text-amber-500" />
          <span className="font-semibold text-amber-700">
            {rows.length} {rows.length === 1 ? 'notula da verificare' : 'notule da verificare'} (possibile fattura già arrivata)
          </span>
        </div>
        {expanded ? <ChevronUp size={18} className="text-amber-400" /> : <ChevronDown size={18} className="text-amber-400" />}
      </button>

      {expanded && (
        <div className="divide-y divide-amber-100 border-t border-amber-100">
          {rows.map(r => (
            <div key={`${r.manual_id}-${r.acube_id}`} className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-800 truncate">{r.supplier_name || 'Fornitore'}</span>
                  {r.ambiguo && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-rose-600 bg-rose-100 px-2 py-0.5 rounded">
                      <AlertTriangle size={11} /> ambiguo
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">
                    match per {r.match_reason === 'numero' ? 'numero documento' : 'importo e data'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Notula a mano <span className="font-medium">{r.manual_number || '—'}</span> del {fmtDate(r.manual_date)} · {fmtEur(r.manual_amount)}
                  {r.manual_status ? ` (${r.manual_status})` : ''}
                  {' → '}
                  fattura SDI <span className="font-medium">{r.acube_number || '—'}</span> del {fmtDate(r.acube_date)} · {fmtEur(r.acube_amount)}
                  {r.acube_status ? ` (${r.acube_status})` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => merge(r)}
                  disabled={mergingId === r.manual_id}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  title="Aggancia la notula alla fattura vera (la fattura assorbe la notula)"
                >
                  {mergingId === r.manual_id ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
                  Unisci
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
