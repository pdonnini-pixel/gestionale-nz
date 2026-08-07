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
import { Link2, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

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

      // scadenze RiBa (qualsiasi stato) dei fornitori con NC aperte, come destinazione
      const supIds = Array.from(new Set(openNcs.map(n => n.supplier_id).filter(Boolean))) as string[]
      if (supIds.length) {
        const { data: pd } = await supabase
          .from('payables')
          .select('id, supplier_id, invoice_number, gross_amount, due_date, status, is_provisional_paid')
          .eq('company_id', companyId)
          .gt('gross_amount', 0)
          .in('supplier_id', supIds)
        setTargets(((pd || []) as unknown as Array<Record<string, unknown>>).map(r => ({
          id: String(r.id), supplier_id: (r.supplier_id as string) ?? null,
          invoice_number: (r.invoice_number as string) ?? null,
          gross_amount: Number(r.gross_amount) || 0, due_date: (r.due_date as string) ?? null,
          status: String(r.status), provisional: Boolean(r.is_provisional_paid),
        })))
      } else setTargets([])
    } finally { setLoading(false) }
  }, [companyId])

  useEffect(() => { if (open) load() }, [open, load])

  const targetsFor = useCallback((n: NcRow) => targets.filter(t => t.supplier_id === n.supplier_id), [targets])

  const link = useCallback(async (n: NcRow) => {
    const tgt = pick[n.id]
    if (!tgt) { toast({ type: 'warning', message: 'Scegli la scadenza a cui abbinare la nota di credito.' }); return }
    setBusy(true)
    try {
      const { error } = await sb.rpc('rpc_link_riba_credit_note', { p_credit_note_id: n.id, p_target_payable_id: tgt })
      if (error) throw new Error(error.message)
      toast({ type: 'success', message: `Nota di credito ${n.invoice_number || ''} abbinata e registrata nel partitario.` })
      setNcs(prev => prev.filter(x => x.id !== n.id))
      onDone()
    } catch (e) {
      toast({ type: 'error', message: (e as Error)?.message || 'Abbinamento fallito' })
    } finally { setBusy(false) }
  }, [pick, toast, onDone, sb])

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
        ) : (
          <>
            <div className="text-xs text-slate-500">{ncs.length} note di credito aperte · totale {fmt(totalOpen)} €</div>
            <div className="max-h-[56vh] overflow-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {ncs.map(n => {
                const opts = targetsFor(n)
                return (
                  <div key={n.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800 truncate">{n.supplier || '—'}</div>
                      <div className="text-[11px] text-slate-400">NC {n.invoice_number || '—'}{n.invoice_date ? ` · ${fmtDate(n.invoice_date)}` : ''}</div>
                    </div>
                    <div className="text-sm font-semibold text-rose-600 shrink-0 sm:w-28 sm:text-right">−{fmt(n.amount)} €</div>
                    <div className="shrink-0 sm:w-72 flex items-center gap-2">
                      {opts.length === 0 ? (
                        <span className="text-[11px] text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={12} /> nessuna scadenza RiBa del fornitore</span>
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
