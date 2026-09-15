// Modale: carica una DISTINTA di ricevute bancarie (RiBa) e chiude, AL CENTESIMO,
// le scadenze RiBa che vi trovano riscontro. Niente "a fiducia".
//
// I dati reali (distinta MPS) mostrano che un effetto e' spesso CUMULATIVO (un
// importo = somma di N fatture del fornitore) e che il ponte sul numero fattura
// non e' affidabile. Percio': il fornitore si risolve per P.IVA (o nome), poi
// l'operatrice COMPONE l'effetto selezionando le sue RiBa aperte; la conferma
// passa SOLO se la SOMMA delle selezionate coincide con l'importo AL CENTESIMO.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './ui/Modal'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { extractDistinta, DistintaExtractError, type DistintaExtract } from '../lib/ribaDistintaExtract'
import { fmt } from '../pages/scadenzario/helpers'
import { Upload, CheckCircle2, AlertTriangle, Loader2, ChevronDown, ChevronRight } from 'lucide-react'

type SupplierLite = { id: string; name?: string | null; partita_iva?: string | null; vat_number?: string | null }
type RibaPayable = { id: string; supplier_id: string | null; invoice_number: string | null; supplier: string | null; gross_amount: number; due_date: string | null }
type LineRow = {
  id: string
  raw_supplier: string | null
  raw_vat: string | null
  raw_invoice: string | null
  raw_amount: number | null
  raw_due_date: string | null
  matched_supplier_id: string | null
  matched_payable_ids: string[] | null
  match_status: 'unmatched' | 'matched' | 'ambiguous' | 'confirmed'
}

const cents = (n: number | null | undefined) => Math.round((Number(n) || 0) * 100)
const up = (s: unknown) => String(s ?? '').toUpperCase()
const words = (s: string) => up(s).split(/[^A-Z0-9]+/).filter(w => w.length >= 4)

function resolveSupplierId(vat: string | null, name: string | null, suppliers: SupplierLite[]): string | null {
  if (vat) {
    const v = up(vat)
    const byVat = suppliers.find(s => up(s.partita_iva) === v || up(s.vat_number) === v)
    if (byVat) return byVat.id
  }
  if (name) {
    const nw = words(name)
    const hit = suppliers.find(s => {
      const sn = up(s.name)
      if (!sn) return false
      return nw.some(w => sn.includes(w)) || words(sn).some(w => up(name).includes(w))
    })
    if (hit) return hit.id
  }
  return null
}

export default function RibaDistintaModal({
  open, onClose, companyId, bankAccounts, suppliers, onDone,
}: {
  open: boolean
  onClose: () => void
  companyId: string
  bankAccounts: { id: string; bank_name?: string | null; account_name?: string | null; iban?: string | null }[]
  suppliers: SupplierLite[]
  onDone: () => void
}) {
  const { toast } = useToast()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [file, setFile] = useState<File | null>(null)
  const [bankId, setBankId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'upload' | 'review'>('upload')
  const [distintaId, setDistintaId] = useState<string | null>(null)
  const [extract, setExtract] = useState<DistintaExtract | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [payables, setPayables] = useState<RibaPayable[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // selezione operatrice: lineId -> Set(payableId)
  const [sel, setSel] = useState<Record<string, Set<string>>>({})

  const reset = useCallback(() => {
    setFile(null); setBankId(''); setBusy(false); setPhase('upload')
    setDistintaId(null); setExtract(null); setLines([]); setPayables([]); setExpanded({}); setSel({})
  }, [])
  useEffect(() => { if (open) reset() }, [open, reset])

  const loadPayables = useCallback(async () => {
    const { data } = await supabase
      .from('payables')
      .select('id, supplier_id, invoice_number, supplier_name, gross_amount, due_date, payment_method, default_payment_method, is_provisional_paid, status, bank_transaction_id, is_placeholder, closed_manually, suppliers(name, payment_method, default_payment_method)')
      .eq('company_id', companyId)
    const rows = (data || []) as unknown as Array<Record<string, unknown>>
    const list: RibaPayable[] = rows
      .filter(r => {
        if (r.is_placeholder) return false
        const sup = (r.suppliers as { payment_method?: string; default_payment_method?: string } | null) || {}
        const pm = String(r.payment_method || sup.payment_method || sup.default_payment_method || '')
        if (!pm.startsWith('riba')) return false
        const gross = Number(r.gross_amount) || 0
        if (gross < 0) {
          // nota di credito RiBa: disponibile finché non chiusa/compensata
          return !r.closed_manually
        }
        // fattura RiBa: aperta o già provvisoria, senza movimento reale
        const openOrProv = ['da_pagare', 'in_scadenza', 'scaduto'].includes(String(r.status)) || Boolean(r.is_provisional_paid)
        return gross > 0 && openOrProv && !r.bank_transaction_id
      })
      .map(r => ({
        id: String(r.id),
        supplier_id: (r.supplier_id as string) ?? null,
        invoice_number: (r.invoice_number as string) ?? null,
        supplier: ((r.suppliers as { name?: string } | null)?.name) || (r.supplier_name as string) || null,
        gross_amount: Number(r.gross_amount) || 0,
        due_date: (r.due_date as string) ?? null,
      }))
    setPayables(list)
  }, [companyId])

  const reloadLines = useCallback(async (did: string): Promise<LineRow[]> => {
    const { data } = await sb
      .from('riba_distinta_lines')
      .select('id, raw_supplier, raw_vat, raw_invoice, raw_amount, raw_due_date, matched_supplier_id, matched_payable_ids, match_status')
      .eq('distinta_id', did)
      .order('created_at', { ascending: true })
    const rows = ((data || []) as unknown as LineRow[])
    setLines(rows)
    return rows
  }, [sb])

  const analyze = useCallback(async () => {
    if (!file) { toast({ type: 'warning', message: 'Scegli prima un file della distinta.' }); return }
    setBusy(true)
    try {
      const ex = await extractDistinta(file)
      setExtract(ex)

      const { data: dRow, error: dErr } = await sb
        .from('riba_distinte')
        .insert({ company_id: companyId, source_kind: ex.sourceKind, file_name: file.name, bank_account_id: bankId || null, declared_total: ex.declaredTotal, line_count: ex.lines.length })
        .select('id').single()
      if (dErr || !dRow) throw new Error(dErr?.message || 'Creazione distinta fallita')
      const did = (dRow as { id: string }).id
      setDistintaId(did)

      try {
        const path = `${companyId}/${did}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        await sb.storage.from('riba-distinte').upload(path, file, { upsert: true })
        await sb.from('riba_distinte').update({ file_path: path }).eq('id', did)
      } catch { /* upload non bloccante */ }

      const payload = ex.lines.map(l => ({
        distinta_id: did, company_id: companyId,
        raw_supplier: l.supplier, raw_vat: l.vat, raw_invoice: l.invoice,
        raw_amount: l.amount, raw_due_date: l.dueDate,
        matched_supplier_id: resolveSupplierId(l.vat, l.supplier, suppliers),
      }))
      const { error: lErr } = await sb.from('riba_distinta_lines').insert(payload)
      if (lErr) throw new Error(lErr.message)

      const { error: mErr } = await sb.rpc('rpc_automatch_riba_distinta', { p_distinta_id: did })
      if (mErr) throw new Error(mErr.message)

      await loadPayables()
      const rows = await reloadLines(did)
      // pre-seleziona ciò che l'automatch ha già agganciato
      const init: Record<string, Set<string>> = {}
      rows.forEach(r => { if (r.matched_payable_ids?.length) init[r.id] = new Set(r.matched_payable_ids) })
      setSel(init)
      setPhase('review')
    } catch (e) {
      const msg = e instanceof DistintaExtractError ? e.message : (e as Error)?.message || 'Errore imprevisto'
      toast({ type: 'error', message: msg })
    } finally { setBusy(false) }
  }, [file, bankId, companyId, suppliers, toast, loadPayables, reloadLines, sb])

  const candidatesFor = useCallback((l: LineRow): RibaPayable[] => {
    const base = l.matched_supplier_id ? payables.filter(p => p.supplier_id === l.matched_supplier_id) : payables
    // fatture prima, note di credito (che scalano) in fondo
    return [...base].sort((a, b) => (b.gross_amount > 0 ? 1 : 0) - (a.gross_amount > 0 ? 1 : 0))
  }, [payables])

  const selSum = useCallback((lineId: string) => {
    const set = sel[lineId]; if (!set) return 0
    return payables.filter(p => set.has(p.id)).reduce((s, p) => s + p.gross_amount, 0)
  }, [sel, payables])

  const lineReady = useCallback((l: LineRow) => {
    if (l.match_status === 'confirmed') return false
    const set = sel[l.id]
    return !!set && set.size > 0 && cents(selSum(l.id)) === cents(l.raw_amount)
  }, [sel, selSum])

  const toggle = (lineId: string, pid: string) => setSel(prev => {
    const cur = new Set(prev[lineId] || [])
    if (cur.has(pid)) cur.delete(pid); else cur.add(pid)
    return { ...prev, [lineId]: cur }
  })

  const readyCount = useMemo(() => lines.filter(lineReady).length, [lines, lineReady])

  const confirm = useCallback(async () => {
    if (!distintaId) return
    setBusy(true)
    try {
      let confirmed = 0, skipped = 0
      for (const l of lines) {
        if (!lineReady(l)) { if (l.match_status !== 'confirmed') skipped++; continue }
        const ids = Array.from(sel[l.id]!)
        const { error } = await sb.rpc('rpc_confirm_riba_distinta_line', { p_line_id: l.id, p_payable_ids: ids })
        if (error) skipped++; else confirmed++
      }
      await sb.from('riba_distinte').update({ status: 'confermata', confirmed_at: new Date().toISOString(), matched_count: confirmed }).eq('id', distintaId)
      toast({ type: confirmed > 0 ? 'success' : 'warning', message: `Distinta confermata: ${confirmed} effetti chiusi al centesimo${skipped > 0 ? `, ${skipped} da verificare` : ''}` })
      onDone(); onClose()
    } catch (e) {
      toast({ type: 'error', message: (e as Error)?.message || 'Conferma fallita' })
    } finally { setBusy(false) }
  }, [distintaId, lines, sel, lineReady, toast, onDone, onClose, sb])

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="Distinta ricevute bancarie (RiBa)" maxWidthClass="max-w-3xl" closeOnBackdrop={false}>
      {phase === 'upload' ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Carica la distinta che ti restituisce la banca (PDF, CSV o Excel). Il sistema legge le
            righe e le confronta con le scadenze RiBa: chiude <strong>solo</strong> ciò che coincide
            <strong> al centesimo</strong>. Gli effetti cumulativi li componi selezionando le fatture.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Banca di addebito (facoltativa)</label>
            <select value={bankId} onChange={e => setBankId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white">
              <option value="">— nessuna —</option>
              {bankAccounts.map(b => {
                const label = [b.bank_name, b.account_name].filter(Boolean).join(' — ') || b.iban || b.id
                return <option key={b.id} value={b.id}>{label}</option>
              })}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">File della distinta</label>
            <input type="file" accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv" onChange={e => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Annulla</button>
            <button onClick={analyze} disabled={busy || !file} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-teal-700">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Analizza
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">{lines.length} effetti{extract?.declaredTotal != null ? ` · totale distinta ${fmt(extract.declaredTotal)} €` : ''}</span>
            <span className="text-slate-500"><span className="text-emerald-700 font-medium">{readyCount}</span> pronti da chiudere</span>
          </div>

          <div className="max-h-[56vh] overflow-auto space-y-2 pr-1">
            {lines.map(l => {
              const cands = candidatesFor(l)
              const sum = selSum(l.id)
              const ready = lineReady(l)
              const confirmed = l.match_status === 'confirmed'
              const isOpen = expanded[l.id]
              const diff = cents(l.raw_amount) - cents(sum)
              return (
                <div key={l.id} className={`rounded-lg border ${confirmed ? 'border-emerald-200 bg-emerald-50/40' : ready ? 'border-emerald-300' : 'border-slate-200'}`}>
                  <button onClick={() => setExpanded(e => ({ ...e, [l.id]: !e[l.id] }))} disabled={confirmed}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left">
                    {confirmed ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                      : isOpen ? <ChevronDown size={15} className="text-slate-400 shrink-0" /> : <ChevronRight size={15} className="text-slate-400 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800 truncate">{l.raw_supplier || '—'}{l.raw_vat ? <span className="text-slate-400 font-normal"> · {l.raw_vat}</span> : null}</div>
                      <div className="text-[11px] text-slate-400 truncate">{l.raw_invoice || ''}{!l.matched_supplier_id && <span className="text-amber-600"> · fornitore non riconosciuto</span>}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-slate-800">{fmt(l.raw_amount)} €</div>
                      {confirmed ? <div className="text-[11px] text-emerald-700">confermato</div>
                        : ready ? <div className="text-[11px] text-emerald-700">✓ quadra</div>
                        : (sel[l.id]?.size ? <div className="text-[11px] text-amber-600">{diff > 0 ? 'mancano' : 'eccede'} {fmt(Math.abs(diff) / 100)} €</div> : <div className="text-[11px] text-slate-400">da comporre</div>)}
                    </div>
                  </button>
                  {isOpen && !confirmed && (
                    <div className="border-t border-slate-100 px-3 py-2">
                      {cands.length === 0 ? (
                        <div className="text-xs text-amber-700 inline-flex items-center gap-1 py-1"><AlertTriangle size={13} /> nessuna RiBa aperta per questo fornitore</div>
                      ) : (
                        <>
                          <div className="text-[11px] text-slate-400 mb-1">Seleziona le fatture e le eventuali note di credito (che scalano) che compongono l'effetto — il netto deve fare l'importo:</div>
                          <div className="max-h-52 overflow-auto divide-y divide-slate-50">
                            {cands.map(p => {
                              const checked = sel[l.id]?.has(p.id) || false
                              const isNc = p.gross_amount < 0
                              return (
                                <label key={p.id} className="flex items-center gap-2 py-1 text-xs cursor-pointer hover:bg-slate-50 rounded px-1">
                                  <input type="checkbox" checked={checked} onChange={() => toggle(l.id, p.id)} className="rounded border-slate-300" />
                                  <span className={`w-24 shrink-0 ${isNc ? 'text-rose-500' : 'text-slate-500'}`}>{isNc ? 'NC' : 'fatt.'} {p.invoice_number || '—'}</span>
                                  <span className="text-slate-400 flex-1 truncate">{p.supplier || ''}</span>
                                  <span className={`font-medium ${isNc ? 'text-rose-600' : 'text-slate-700'}`}>{isNc ? '−' : ''}{fmt(Math.abs(p.gross_amount))} €</span>
                                </label>
                              )
                            })}
                          </div>
                          <div className={`mt-1 text-xs font-medium ${ready ? 'text-emerald-700' : 'text-slate-500'}`}>
                            Selezionato: {fmt(sum)} € / {fmt(l.raw_amount)} € {ready && '✓'}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <p className="text-[11px] text-slate-400">
            Si chiudono solo gli effetti la cui selezione somma esattamente all'importo. Gli altri restano
            aperti: verifica gli importi o componili più tardi.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Chiudi senza confermare</button>
            <button onClick={confirm} disabled={busy || readyCount === 0} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-emerald-700">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Conferma {readyCount} effetti
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
