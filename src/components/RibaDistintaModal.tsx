// Modale: carica una DISTINTA di ricevute bancarie (RiBa) e chiude, AL CENTESIMO,
// le scadenze RiBa che vi trovano riscontro. Niente "a fiducia": ogni riga si
// chiude solo se l'importo coincide esatto con il dovuto di una scadenza RiBa.
//
// Flusso: scegli file (PDF/CSV/XLSX) -> "Analizza" (estrae le righe, crea la
// distinta, aggancia in automatico le righe alle scadenze RiBa per importo esatto)
// -> rivedi i riscontri (correggi gli ambigui) -> "Conferma": le scadenze
// agganciate diventano PAGATE definitive (la provvisoria perde il "provvisorio").
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './ui/Modal'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { extractDistinta, DistintaExtractError, type DistintaExtract } from '../lib/ribaDistintaExtract'
import { fmt } from '../pages/scadenzario/helpers'
import { Upload, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'

type RibaCandidate = { id: string; invoice_number: string | null; supplier: string | null; gross_amount: number }
type LineRow = {
  id: string
  raw_supplier: string | null
  raw_invoice: string | null
  raw_amount: number | null
  raw_due_date: string | null
  matched_payable_id: string | null
  match_status: 'unmatched' | 'matched' | 'ambiguous' | 'confirmed'
}

const cents = (n: number | null | undefined) => Math.round((Number(n) || 0) * 100)

export default function RibaDistintaModal({
  open, onClose, companyId, bankAccounts, onDone,
}: {
  open: boolean
  onClose: () => void
  companyId: string
  bankAccounts: { id: string; name?: string | null }[]
  onDone: () => void
}) {
  const { toast } = useToast()
  // Le tabelle/RPC della distinta RiBa non sono nei tipi generati (come per
  // payable_credit_note_links): client castato per gli accessi non tipizzati.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [file, setFile] = useState<File | null>(null)
  const [bankId, setBankId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'upload' | 'review'>('upload')
  const [distintaId, setDistintaId] = useState<string | null>(null)
  const [extract, setExtract] = useState<DistintaExtract | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [candidates, setCandidates] = useState<RibaCandidate[]>([])
  // scelta manuale operatrice: lineId -> payableId
  const [manual, setManual] = useState<Record<string, string>>({})

  const reset = useCallback(() => {
    setFile(null); setBankId(''); setBusy(false); setPhase('upload')
    setDistintaId(null); setExtract(null); setLines([]); setCandidates([]); setManual({})
  }, [])

  useEffect(() => { if (open) reset() }, [open, reset])

  // Candidati RiBa (aperte o provvisorie, senza movimento reale) per il riscontro.
  const loadCandidates = useCallback(async () => {
    const { data } = await supabase
      .from('payables')
      .select('id, invoice_number, supplier_name, gross_amount, payment_method, is_provisional_paid, status, bank_transaction_id, is_placeholder, suppliers(name), payment_method_code')
      .eq('company_id', companyId)
      .gt('gross_amount', 0)
    const rows = (data || []) as unknown as Array<Record<string, unknown>>
    const cand: RibaCandidate[] = rows
      .filter(r => {
        const pm = String((r.payment_method as string) || '')
        const isRiba = pm.startsWith('riba')
        const openOrProv = ['da_pagare', 'in_scadenza', 'scaduto'].includes(String(r.status)) || Boolean(r.is_provisional_paid)
        return isRiba && openOrProv && !r.bank_transaction_id && !r.is_placeholder
      })
      .map(r => ({
        id: String(r.id),
        invoice_number: (r.invoice_number as string) ?? null,
        supplier: ((r.suppliers as { name?: string } | null)?.name) || (r.supplier_name as string) || null,
        gross_amount: Number(r.gross_amount) || 0,
      }))
    setCandidates(cand)
  }, [companyId])

  const reloadLines = useCallback(async (did: string) => {
    const { data } = await sb
      .from('riba_distinta_lines')
      .select('id, raw_supplier, raw_invoice, raw_amount, raw_due_date, matched_payable_id, match_status')
      .eq('distinta_id', did)
      .order('created_at', { ascending: true })
    setLines(((data || []) as unknown as LineRow[]))
  }, [])

  // Analizza il file: estrae, crea distinta + righe, automatch.
  const analyze = useCallback(async () => {
    if (!file) { toast({ type: 'warning', message: 'Scegli prima un file della distinta.' }); return }
    setBusy(true)
    try {
      const ex = await extractDistinta(file)
      setExtract(ex)

      // crea la testata distinta
      const { data: dRow, error: dErr } = await sb
        .from('riba_distinte')
        .insert({
          company_id: companyId,
          source_kind: ex.sourceKind,
          file_name: file.name,
          bank_account_id: bankId || null,
          declared_total: ex.declaredTotal,
          line_count: ex.lines.length,
        })
        .select('id')
        .single()
      if (dErr || !dRow) throw new Error(dErr?.message || 'Creazione distinta fallita')
      const did = (dRow as { id: string }).id
      setDistintaId(did)

      // carica il file nel bucket (best-effort, non blocca il flusso)
      try {
        const path = `${companyId}/${did}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        await sb.storage.from('riba-distinte').upload(path, file, { upsert: true })
        await sb.from('riba_distinte').update({ file_path: path }).eq('id', did)
      } catch { /* upload non bloccante */ }

      // inserisce le righe
      const payload = ex.lines.map(l => ({
        distinta_id: did,
        company_id: companyId,
        raw_supplier: l.supplier,
        raw_invoice: l.invoice,
        raw_amount: l.amount,
        raw_due_date: l.dueDate,
      }))
      const { error: lErr } = await sb.from('riba_distinta_lines').insert(payload)
      if (lErr) throw new Error(lErr.message)

      // automatch al centesimo (lato DB)
      const { error: mErr } = await sb.rpc('rpc_automatch_riba_distinta', { p_distinta_id: did })
      if (mErr) throw new Error(mErr.message)

      await Promise.all([loadCandidates(), reloadLines(did)])
      setPhase('review')
    } catch (e) {
      const msg = e instanceof DistintaExtractError ? e.message : (e as Error)?.message || 'Errore imprevisto'
      toast({ type: 'error', message: msg })
    } finally {
      setBusy(false)
    }
  }, [file, bankId, companyId, toast, loadCandidates, reloadLines])

  // candidati con importo ESATTO (al centesimo) per una riga
  const candidatesForLine = useCallback((amount: number | null) => {
    if (amount == null) return []
    return candidates.filter(c => cents(c.gross_amount) === cents(amount))
  }, [candidates])

  const chosenFor = (l: LineRow): string => manual[l.id] ?? l.matched_payable_id ?? ''

  const confirmCounts = useMemo(() => {
    let ready = 0, tocheck = 0
    for (const l of lines) {
      if (l.match_status === 'confirmed') continue
      if (chosenFor(l)) ready++; else tocheck++
    }
    return { ready, tocheck }
  }, [lines, manual])

  const confirm = useCallback(async () => {
    if (!distintaId) return
    setBusy(true)
    try {
      // scritture manuali: porto le righe scelte a 'matched' col payable scelto
      for (const l of lines) {
        const chosen = chosenFor(l)
        if (chosen && chosen !== l.matched_payable_id) {
          await sb.from('riba_distinta_lines')
            .update({ matched_payable_id: chosen, match_status: 'matched' })
            .eq('id', l.id)
        }
      }
      const { data, error } = await sb.rpc('rpc_confirm_riba_distinta', { p_distinta_id: distintaId })
      if (error) throw new Error(error.message)
      const res = (data as { confirmed?: number; skipped?: number } | null) || {}
      toast({
        type: 'success',
        message: `Distinta confermata: ${res.confirmed ?? 0} scadenze chiuse al centesimo`
          + ((res.skipped ?? 0) > 0 ? `, ${res.skipped} saltate (importo non quadra)` : ''),
      })
      onDone()
      onClose()
    } catch (e) {
      toast({ type: 'error', message: (e as Error)?.message || 'Conferma fallita' })
    } finally {
      setBusy(false)
    }
  }, [distintaId, lines, manual, toast, onDone, onClose])

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="Distinta ricevute bancarie (RiBa)" maxWidthClass="max-w-3xl" closeOnBackdrop={false}>
      {phase === 'upload' ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Carica la distinta che ti restituisce la banca (PDF, CSV o Excel). Il sistema legge le
            righe e le confronta con le scadenze RiBa: chiude <strong>solo</strong> ciò che coincide
            <strong> al centesimo</strong>. Ciò che non quadra resta da verificare.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Banca di addebito (facoltativa)</label>
            <select value={bankId} onChange={e => setBankId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white">
              <option value="">— nessuna —</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">File della distinta</label>
            <input type="file" accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Annulla</button>
            <button onClick={analyze} disabled={busy || !file}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-teal-700">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Analizza
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">
              {lines.length} righe lette{extract?.declaredTotal != null ? ` · totale distinta ${fmt(extract.declaredTotal)} €` : ''}
            </span>
            <span className="text-slate-500">
              <span className="text-emerald-700 font-medium">{confirmCounts.ready}</span> pronte ·{' '}
              <span className="text-amber-700 font-medium">{confirmCounts.tocheck}</span> da verificare
            </span>
          </div>

          <div className="max-h-[52vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1.5">Fornitore</th>
                  <th className="text-left px-2 py-1.5">Fattura</th>
                  <th className="text-right px-2 py-1.5">Importo</th>
                  <th className="text-left px-2 py-1.5">Scadenza abbinata</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => {
                  const opts = candidatesForLine(l.raw_amount)
                  const chosen = chosenFor(l)
                  const confirmed = l.match_status === 'confirmed'
                  return (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-700">{l.raw_supplier || '—'}</td>
                      <td className="px-2 py-1.5 text-slate-500">{l.raw_invoice || '—'}</td>
                      <td className="px-2 py-1.5 text-right font-medium text-slate-800">{fmt(l.raw_amount)} €</td>
                      <td className="px-2 py-1.5">
                        {confirmed ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} /> confermata</span>
                        ) : opts.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={13} /> nessuna RiBa al centesimo</span>
                        ) : (
                          <select value={chosen} onChange={e => setManual(m => ({ ...m, [l.id]: e.target.value }))}
                            className={`w-full px-2 py-1 rounded border text-xs bg-white ${chosen ? 'border-emerald-300' : 'border-amber-300'}`}>
                            <option value="">— scegli scadenza —</option>
                            {opts.map(c => (
                              <option key={c.id} value={c.id}>
                                {(c.supplier || '—')} · fatt. {c.invoice_number || '—'} · {fmt(c.gross_amount)} €
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-slate-400">
            Vengono chiuse solo le righe con una scadenza RiBa dello stesso importo esatto. Le righe
            senza riscontro restano aperte: verifica l'importo o abbinale a mano più tardi.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Chiudi senza confermare</button>
            <button onClick={confirm} disabled={busy || confirmCounts.ready === 0}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-emerald-700">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Conferma {confirmCounts.ready} scadenze
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
