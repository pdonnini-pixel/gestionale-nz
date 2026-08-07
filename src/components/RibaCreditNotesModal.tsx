// Modale FASE 3: coda delle NOTE DI CREDITO dei fornitori a RICEVUTA BANCARIA
// (RiBa) da abbinare A MANO a una scadenza/pagamento. Le NC RiBa non vengono mai
// compensate in automatico: qui l'operatrice (Sabrina/Lilian/Patrizio) sceglie a
// quale scadenza dello stesso fornitore abbinarle. L'abbinamento CHIUDE la NC e la
// registra in AVERE nel partitario del fornitore. Reversibile (annulla).
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './ui/Modal'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { fmt, fmtDate } from '../pages/scadenzario/helpers'
import { Link2, Loader2, CheckCircle2, AlertTriangle, ChevronRight, ArrowLeft, Search } from 'lucide-react'

type NcRow = { id: string; supplier_id: string | null; supplier: string | null; invoice_number: string | null; invoice_date: string | null; amount: number }
type TargetRow = { id: string; supplier_id: string | null; invoice_number: string | null; gross_amount: number; due_date: string | null; status: string; provisional: boolean }

export default function RibaCreditNotesModal({
  open, onClose, companyId, onDone,
}: {
  open: boolean
  onClose: () => void
  companyId: string
  onDone: () => void
}) {
  const { toast } = useToast()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ncs, setNcs] = useState<NcRow[]>([])
  const [targets, setTargets] = useState<TargetRow[]>([])
  const [pick, setPick] = useState<Record<string, string>>({}) // ncId -> targetPayableId
  // Passo 1 → Passo 2: prima si sceglie il FORNITORE (ordine alfabetico), poi si
  // abbinano solo le sue note di credito. Evita la lista unica e lunghissima.
  const [selSupplier, setSelSupplier] = useState<string | null>(null)
  // Ricerca scadenze nel Passo 2 (per numero fattura / importo / data).
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('payables')
        .select('id, supplier_id, invoice_number, invoice_date, gross_amount, supplier_name, closed_manually, status, payment_method, suppliers(name, payment_method, default_payment_method)')
        .eq('company_id', companyId)
        .lt('gross_amount', 0)
      const rows = (data || []) as unknown as Array<Record<string, unknown>>
      const isRiba = (r: Record<string, unknown>) => {
        const sup = (r.suppliers as { payment_method?: string; default_payment_method?: string } | null) || {}
        const pm = String(r.payment_method || sup.payment_method || sup.default_payment_method || '')
        return pm.startsWith('riba')
      }
      const openNcs: NcRow[] = rows
        .filter(r => !r.closed_manually && isRiba(r))
        .map(r => ({
          id: String(r.id),
          supplier_id: (r.supplier_id as string) ?? null,
          supplier: ((r.suppliers as { name?: string } | null)?.name) || (r.supplier_name as string) || null,
          invoice_number: (r.invoice_number as string) ?? null,
          invoice_date: (r.invoice_date as string) ?? null,
          amount: Math.abs(Number(r.gross_amount) || 0),
        }))
      setNcs(openNcs)

      // Scadenze APERTE dei fornitori con NC aperte, come destinazione.
      // Una nota di credito si abbina a un debito ANCORA DOVUTO, mai a una
      // fattura gia' saldata: quindi si escludono le scadenze pagate/chiuse
      // (payment_date valorizzata, closed_manually, pagata in via provvisoria)
      // e gli stati terminali non piu' dovuti (pagato, annullato, nota_credito).
      const supIds = Array.from(new Set(openNcs.map(n => n.supplier_id).filter(Boolean))) as string[]
      if (supIds.length) {
        const { data: pd } = await supabase
          .from('payables')
          .select('id, supplier_id, invoice_number, gross_amount, due_date, status, is_provisional_paid, payment_date, closed_manually')
          .eq('company_id', companyId)
          .gt('gross_amount', 0)
          .in('supplier_id', supIds)
        const CLOSED_STATUS = new Set(['pagato', 'annullato', 'nota_credito'])
        const isOpenTarget = (r: Record<string, unknown>) =>
          !r.closed_manually &&
          !r.payment_date &&
          !r.is_provisional_paid &&
          !CLOSED_STATUS.has(String(r.status || ''))
        setTargets(((pd || []) as unknown as Array<Record<string, unknown>>)
          .filter(isOpenTarget)
          .map(r => ({
            id: String(r.id), supplier_id: (r.supplier_id as string) ?? null,
            invoice_number: (r.invoice_number as string) ?? null,
            gross_amount: Number(r.gross_amount) || 0, due_date: (r.due_date as string) ?? null,
            status: String(r.status), provisional: Boolean(r.is_provisional_paid),
          })))
      } else setTargets([])
    } finally { setLoading(false) }
  }, [companyId])

  useEffect(() => { if (open) { setSelSupplier(null); load() } }, [open, load])
  // Azzera la ricerca ogni volta che si cambia fornitore (o si torna indietro).
  useEffect(() => { setSearch('') }, [selSupplier])

  // Chiave di raggruppamento fornitore (per id; fallback sul nome se manca l'id).
  const supKey = useCallback((n: NcRow) => n.supplier_id || `name:${n.supplier || '—'}`, [])

  // Passo 1: fornitori con NC RiBa aperte, in ORDINE ALFABETICO, con conteggio e totale.
  const suppliers = useMemo(() => {
    const map = new Map<string, { key: string; name: string; count: number; total: number }>()
    for (const n of ncs) {
      const key = supKey(n)
      const cur = map.get(key) || { key, name: n.supplier || '—', count: 0, total: 0 }
      cur.count += 1; cur.total += n.amount
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'it'))
  }, [ncs, supKey])

  // Passo 2: NC del solo fornitore selezionato.
  const ncsForSel = useMemo(
    () => (selSupplier ? ncs.filter(n => supKey(n) === selSupplier) : []),
    [ncs, selSupplier, supKey],
  )

  // Scadenze del fornitore, ORDINATE per data (poi numero fattura): più leggibili.
  const targetsFor = useCallback((n: NcRow) => targets
    .filter(t => t.supplier_id === n.supplier_id)
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')
      || (a.invoice_number || '').localeCompare(b.invoice_number || '', 'it', { numeric: true })),
    [targets])

  const link = useCallback(async (n: NcRow) => {
    const tgt = pick[n.id]
    if (!tgt) { toast({ type: 'warning', message: 'Scegli la scadenza a cui abbinare la nota di credito.' }); return }
    setBusy(true)
    try {
      const { error } = await sb.rpc('rpc_link_riba_credit_note', { p_credit_note_id: n.id, p_target_payable_id: tgt })
      if (error) throw new Error(error.message)
      toast({ type: 'success', message: `Nota di credito ${n.invoice_number || ''} abbinata e registrata nel partitario.` })
      setNcs(prev => {
        const next = prev.filter(x => x.id !== n.id)
        // Se il fornitore non ha più NC aperte, torna alla lista fornitori.
        if (selSupplier && !next.some(x => supKey(x) === selSupplier)) setSelSupplier(null)
        return next
      })
      onDone()
    } catch (e) {
      toast({ type: 'error', message: (e as Error)?.message || 'Abbinamento fallito' })
    } finally { setBusy(false) }
  }, [pick, toast, onDone, sb, selSupplier, supKey])

  const totalOpen = useMemo(() => ncs.reduce((s, n) => s + n.amount, 0), [ncs])

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="Note di credito RiBa da abbinare" maxWidthClass="max-w-3xl">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Le note di credito dei fornitori a ricevuta bancaria non si compensano da sole: qui le
          <strong> abbini a mano</strong> a una scadenza/pagamento dello stesso fornitore. L'abbinamento
          chiude la nota di credito e la registra nel partitario.
        </p>

        {loading ? (
          <div className="py-8 text-center text-slate-400 text-sm inline-flex items-center gap-2 justify-center w-full"><Loader2 size={16} className="animate-spin" /> Carico…</div>
        ) : ncs.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-sm inline-flex items-center gap-2 justify-center w-full">
            <CheckCircle2 size={16} className="text-emerald-500" /> Nessuna nota di credito RiBa da abbinare.
          </div>
        ) : !selSupplier ? (
          /* PASSO 1 — scelta del fornitore (ordine alfabetico) */
          <>
            <div className="text-xs text-slate-500">{ncs.length} note di credito aperte · {suppliers.length} fornitori · totale {fmt(totalOpen)} €</div>
            <div className="text-xs text-slate-500">Scegli prima il fornitore, poi abbini le sue note di credito.</div>
            <div className="max-h-[56vh] overflow-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {suppliers.map(s => (
                <button key={s.key} onClick={() => setSelSupplier(s.key)}
                  className="w-full p-3 flex items-center gap-3 text-left hover:bg-slate-50 transition">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800 truncate">{s.name}</div>
                    <div className="text-[11px] text-slate-400">{s.count} nota{s.count === 1 ? '' : 'e'} di credito da abbinare</div>
                  </div>
                  <div className="text-sm font-semibold text-rose-600 shrink-0">−{fmt(s.total)} €</div>
                  <ChevronRight size={16} className="text-slate-300 shrink-0" />
                </button>
              ))}
            </div>
          </>
        ) : (
          /* PASSO 2 — abbinamento delle NC del fornitore scelto */
          <>
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => setSelSupplier(null)}
                className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
                <ArrowLeft size={14} /> Tutti i fornitori
              </button>
              <div className="text-sm font-semibold text-slate-800 truncate">{ncsForSel[0]?.supplier || '—'}</div>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cerca scadenza: numero fattura, importo o data…"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 text-xs bg-white"
              />
            </div>
            <div className="max-h-[56vh] overflow-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {ncsForSel.map(n => {
                const q = search.trim().toLowerCase()
                // Filtra le scadenze per la ricerca, ma tiene sempre quella già scelta.
                const opts = targetsFor(n).filter(t =>
                  !q
                  || t.id === pick[n.id]
                  || `fatt ${t.invoice_number || ''} ${fmt(t.gross_amount)} ${fmtDate(t.due_date)}`.toLowerCase().includes(q))
                return (
                  <div key={n.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-slate-400">NC {n.invoice_number || '—'}{n.invoice_date ? ` · ${fmtDate(n.invoice_date)}` : ''}</div>
                    </div>
                    <div className="text-sm font-semibold text-rose-600 shrink-0 sm:w-28 sm:text-right">−{fmt(n.amount)} €</div>
                    <div className="shrink-0 sm:w-72 flex items-center gap-2">
                      {opts.length === 0 ? (
                        <span className="text-[11px] text-amber-700 inline-flex items-center gap-1">
                          <AlertTriangle size={12} />
                          {targetsFor(n).length === 0 ? 'nessuna scadenza aperta del fornitore' : 'nessun risultato per la ricerca'}
                        </span>
                      ) : (
                        <select value={pick[n.id] || ''} onChange={e => setPick(p => ({ ...p, [n.id]: e.target.value }))}
                          className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
                          <option value="">— scegli scadenza —</option>
                          {opts.map(t => (
                            <option key={t.id} value={t.id}>
                              fatt. {t.invoice_number || '—'} · {fmt(t.gross_amount)} €{t.due_date ? ` · scad. ${fmtDate(t.due_date)}` : ''}{t.provisional ? ' · provv.' : ''}
                            </option>
                          ))}
                        </select>
                      )}
                      <button onClick={() => link(n)} disabled={busy || !pick[n.id]}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium disabled:opacity-40 hover:bg-teal-700">
                        <Link2 size={13} /> Abbina
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Chiudi</button>
        </div>
      </div>
    </Modal>
  )
}
