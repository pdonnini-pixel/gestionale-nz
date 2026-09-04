// Chiusura cassa — la schermata della cassiera (ruolo operatore_cassa).
//
// Un solo compito, pensato per lo smartphone a fine giornata:
//   1. fotografare gli scontrini di chiusura (obbligatorio per confermare);
//   2. scrivere totale corrispettivi, un importo per ogni canale di incasso
//      dell'outlet, spese cassa, versamento, fondo cassa contato;
//   3. vedere in tempo reale se la giornata quadra (totale = somma canali,
//      fondo contato = fondo atteso);
//   4. salvare la bozza o confermare. Dopo la conferma il giorno e' in sola
//      lettura: si puo' solo chiedere la riapertura (notifica a chi amministra).
//
// super_advisor e contabile usano la stessa pagina scegliendo l'outlet (e
// possono riaprire direttamente). La sicurezza vera e' la RLS (migrazione 173):
// l'operatore di cassa vede e scrive solo il proprio outlet, solo in bozza.
// I campi calcolati li rifà il DB (trigger); qui si calcolano per il feedback.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Camera, CalendarDays, ChevronLeft, ChevronRight, Check, AlertTriangle, Lock,
  Unlock, Trash2, Loader2, Save, Store, Image as ImageIcon, MessageSquareWarning,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useCompany } from '../hooks/useCompany'
import { useOutlets } from '../hooks/useOutlets'
import { useToast } from '../components/Toast'
import { Modal } from '../components/ui/Modal'
import PageHeader from '../components/PageHeader'
import type { Database } from '../types/database'
import {
  type PaymentChannel, type AttachmentKind, ATTACHMENT_KIND_LABELS, CLOSING_STATUS_LABELS,
  parseAmount, formatAmount, formatEuro, computeQuadrature, todayIso, addDaysIso, monthDays,
  formatDateIt, MESI_IT, attachmentPath, compressImage,
} from '../lib/cashClosings'

type ClosingRow = Database['public']['Tables']['outlet_daily_closings']['Row']
type AttachmentRow = Database['public']['Tables']['outlet_daily_closing_attachments']['Row']

interface FormState {
  total: string
  amounts: Record<string, string>
  cashExpenses: string
  cashExpensesNote: string
  cashDeposit: string
  cashDepositNote: string
  cashFloatDeclared: string
  cashFloatOpening: string
  closedByName: string
  notes: string
  isClosedDay: boolean
}

const emptyForm = (closedBy: string): FormState => ({
  total: '', amounts: {}, cashExpenses: '', cashExpensesNote: '', cashDeposit: '', cashDepositNote: '',
  cashFloatDeclared: '', cashFloatOpening: '', closedByName: closedBy, notes: '', isClosedDay: false,
})

const LS_CLOSED_BY = 'nz_cassa_closed_by'
const BUCKET = 'cash-closings'

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export default function ChiusuraCassa() {
  const { profile, session } = useAuth()
  const { company } = useCompany()
  const { outlets, loading: outletsLoading } = useOutlets()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const role = profile?.role ?? ''
  const isAdmin = role === 'super_advisor' || role === 'contabile'
  const canWrite = isAdmin || role === 'operatore_cassa'
  const userId = session?.user?.id ?? null
  const companyId = company?.id ?? null

  // Outlet e giorno selezionati (da URL se presenti: la notifica di riapertura e la pagina admin li passano)
  const outletId = params.get('outlet') || outlets[0]?.id || ''
  const dateIso = params.get('date') || todayIso()
  const outlet = outlets.find((o) => o.id === outletId) ?? null
  const setOutlet = (id: string) => setParams((p) => { p.set('outlet', id); return p })
  const setDate = (iso: string) => setParams((p) => { p.set('date', iso); return p })

  const [channels, setChannels] = useState<PaymentChannel[]>([])
  const [closing, setClosing] = useState<ClosingRow | null>(null)
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [prevFloat, setPrevFloat] = useState<number | null>(null)
  const [monthStatus, setMonthStatus] = useState<Record<string, string>>({})
  const [form, setForm] = useState<FormState>(() => emptyForm(safeGetLs(LS_CLOSED_BY)))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const readOnly = !!closing && closing.status !== 'bozza'

  // ─── Caricamento ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!companyId || !outletId || !dateIso) return
    setLoading(true)
    const [y, m] = dateIso.split('-').map(Number)
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
    const monthEnd = monthDays(y, m).slice(-1)[0]
    const [chRes, clRes, prevRes, monthRes] = await Promise.all([
      supabase.from('outlet_payment_channels').select('*').eq('outlet_id', outletId).eq('is_active', true).order('sort_order'),
      supabase.from('outlet_daily_closings').select('*').eq('outlet_id', outletId).eq('closing_date', dateIso).maybeSingle(),
      supabase.from('outlet_daily_closings').select('cash_float_declared, closing_date')
        .eq('outlet_id', outletId).lt('closing_date', dateIso).in('status', ['confermata', 'verificata'])
        .not('cash_float_declared', 'is', null).order('closing_date', { ascending: false }).limit(1),
      supabase.from('outlet_daily_closings').select('closing_date, status, is_closed_day')
        .eq('outlet_id', outletId).gte('closing_date', monthStart).lte('closing_date', monthEnd),
    ])
    setChannels((chRes.data ?? []) as PaymentChannel[])
    const prev = prevRes.data?.[0]?.cash_float_declared
    setPrevFloat(typeof prev === 'number' ? prev : prev != null ? Number(prev) : null)
    const ms: Record<string, string> = {}
    for (const r of monthRes.data ?? []) ms[r.closing_date] = r.is_closed_day ? 'chiuso' : r.status
    setMonthStatus(ms)

    const c = clRes.data ?? null
    setClosing(c)
    if (c) {
      const [lRes, aRes] = await Promise.all([
        supabase.from('outlet_daily_closing_lines').select('channel_id, amount').eq('closing_id', c.id),
        supabase.from('outlet_daily_closing_attachments').select('*').eq('closing_id', c.id).order('uploaded_at'),
      ])
      const amounts: Record<string, string> = {}
      for (const l of lRes.data ?? []) amounts[l.channel_id] = formatAmount(Number(l.amount))
      setForm({
        total: formatAmount(Number(c.total_receipts)),
        amounts,
        cashExpenses: Number(c.cash_expenses) ? formatAmount(Number(c.cash_expenses)) : '',
        cashExpensesNote: c.cash_expenses_note ?? '',
        cashDeposit: Number(c.cash_deposit) ? formatAmount(Number(c.cash_deposit)) : '',
        cashDepositNote: c.cash_deposit_note ?? '',
        cashFloatDeclared: c.cash_float_declared == null ? '' : formatAmount(Number(c.cash_float_declared)),
        cashFloatOpening: c.cash_float_opening == null ? '' : formatAmount(Number(c.cash_float_opening)),
        closedByName: c.closed_by_name ?? safeGetLs(LS_CLOSED_BY),
        notes: c.notes ?? '',
        isClosedDay: c.is_closed_day,
      })
      setAttachments((aRes.data ?? []) as AttachmentRow[])
    } else {
      setForm(emptyForm(safeGetLs(LS_CLOSED_BY)))
      setAttachments([])
    }
    setDirty(false)
    setLoading(false)
  }, [companyId, outletId, dateIso])

  useEffect(() => { void load() }, [load])

  // URL firmate per le anteprime (bucket privato)
  useEffect(() => {
    if (attachments.length === 0) { setSignedUrls({}); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(attachments.map((a) => a.storage_path), 3600)
      if (cancelled || !data) return
      const map: Record<string, string> = {}
      data.forEach((d, i) => { if (d.signedUrl) map[attachments[i].storage_path] = d.signedUrl })
      setSignedUrls(map)
    })()
    return () => { cancelled = true }
  }, [attachments])

  // ─── Quadratura in tempo reale ────────────────────────────────────────
  const quad = useMemo(() => computeQuadrature({
    totalReceipts: form.isClosedDay ? 0 : parseAmount(form.total) ?? 0,
    lines: channels.map((ch) => ({ kind: ch.kind, counts_in_total: ch.counts_in_total, amount: parseAmount(form.amounts[ch.id]) ?? 0 })),
    cashExpenses: parseAmount(form.cashExpenses) ?? 0,
    cashDeposit: parseAmount(form.cashDeposit) ?? 0,
    prevFloat: prevFloat ?? parseAmount(form.cashFloatOpening),
    cashFloatDeclared: parseAmount(form.cashFloatDeclared),
  }), [form, channels, prevFloat])

  const needsNote = quad.receiptsDifference !== 0 || (quad.cashDifference != null && quad.cashDifference !== 0)

  const update = (patch: Partial<FormState>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true) }
  const updateAmount = (channelId: string, v: string) => { setForm((f) => ({ ...f, amounts: { ...f.amounts, [channelId]: v } })); setDirty(true) }

  // ─── Persistenza ──────────────────────────────────────────────────────
  const closingPayload = () => ({
    total_receipts: form.isClosedDay ? 0 : parseAmount(form.total) ?? 0,
    cash_expenses: parseAmount(form.cashExpenses) ?? 0,
    cash_expenses_note: form.cashExpensesNote.trim() || null,
    cash_deposit: parseAmount(form.cashDeposit) ?? 0,
    cash_deposit_note: form.cashDepositNote.trim() || null,
    cash_float_declared: parseAmount(form.cashFloatDeclared),
    cash_float_opening: prevFloat == null ? parseAmount(form.cashFloatOpening) : null,
    closed_by_name: form.closedByName.trim() || null,
    notes: form.notes.trim() || null,
    is_closed_day: form.isClosedDay,
  })

  /** Crea la riga di chiusura se non esiste ancora (serve prima di caricare foto). */
  const ensureClosing = async (): Promise<ClosingRow> => {
    if (closing) return closing
    if (!companyId || !outletId) throw new Error('Outlet non selezionato')
    const { data, error } = await supabase.from('outlet_daily_closings')
      .insert({ company_id: companyId, outlet_id: outletId, closing_date: dateIso, created_by: userId, ...closingPayload() })
      .select('*').single()
    if (error || !data) throw new Error(errMsg(error))
    setClosing(data)
    return data
  }

  const saveDraft = async (silent = false): Promise<ClosingRow | null> => {
    if (!canWrite || readOnly) return closing
    setSaving(true)
    try {
      const c = await ensureClosing()
      const { error: upErr } = await supabase.from('outlet_daily_closings').update(closingPayload()).eq('id', c.id)
      if (upErr) throw new Error(upErr.message)
      if (channels.length > 0 && companyId) {
        const rows = channels.map((ch) => ({
          closing_id: c.id, company_id: companyId, outlet_id: outletId, channel_id: ch.id,
          amount: form.isClosedDay ? 0 : parseAmount(form.amounts[ch.id]) ?? 0,
        }))
        const { error: lErr } = await supabase.from('outlet_daily_closing_lines').upsert(rows, { onConflict: 'closing_id,channel_id' })
        if (lErr) throw new Error(lErr.message)
      }
      safeSetLs(LS_CLOSED_BY, form.closedByName.trim())
      const { data: fresh } = await supabase.from('outlet_daily_closings').select('*').eq('id', c.id).single()
      if (fresh) setClosing(fresh)
      setDirty(false)
      if (!silent) toast({ type: 'success', message: 'Bozza salvata' })
      return fresh ?? c
    } catch (e) {
      toast({ type: 'error', message: 'Salvataggio non riuscito: ' + errMsg(e) })
      return null
    } finally {
      setSaving(false)
    }
  }

  const confirm = async () => {
    if (!form.isClosedDay && attachments.length === 0) {
      toast({ type: 'warning', message: 'Prima fotografa gli scontrini di chiusura: le foto sono obbligatorie.' })
      return
    }
    if (needsNote && !form.notes.trim()) {
      toast({ type: 'warning', message: 'La giornata non quadra: scrivi una nota che spieghi la differenza.' })
      return
    }
    const c = await saveDraft(true)
    if (!c) return
    setSaving(true)
    const { error } = await supabase.rpc('confirm_cash_closing', { p_closing_id: c.id, p_note: form.notes.trim() || undefined })
    setSaving(false)
    if (error) { toast({ type: 'error', message: error.message }); return }
    toast({ type: 'success', message: `Chiusura del ${formatDateIt(dateIso)} confermata` })
    await load()
  }

  const reopen = async () => {
    if (!closing) return
    const { error } = await supabase.rpc('reopen_cash_closing', { p_closing_id: closing.id, p_reason: reopenReason || undefined })
    if (error) { toast({ type: 'error', message: error.message }); return }
    setReopenOpen(false); setReopenReason('')
    toast({ type: 'success', message: 'Chiusura riaperta: ora si può correggere' })
    await load()
  }

  const requestReopen = async () => {
    if (!closing) return
    const { error } = await supabase.rpc('request_cash_closing_reopen', { p_closing_id: closing.id, p_reason: reopenReason || undefined })
    if (error) { toast({ type: 'error', message: error.message }); return }
    setReopenOpen(false); setReopenReason('')
    toast({ type: 'success', message: 'Richiesta inviata: chi amministra riceverà un avviso' })
  }

  // ─── Foto ─────────────────────────────────────────────────────────────
  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !companyId || !userId) return
    setUploading(true)
    try {
      const c = await ensureClosing()
      for (const file of Array.from(files)) {
        const blob = await compressImage(file)
        const id = crypto.randomUUID()
        const path = attachmentPath(companyId, outletId, dateIso, id)
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
        if (upErr) throw new Error(upErr.message)
        const { error: insErr } = await supabase.from('outlet_daily_closing_attachments').insert({
          closing_id: c.id, company_id: companyId, outlet_id: outletId, kind: 'altro',
          storage_path: path, mime_type: 'image/jpeg', size_bytes: blob.size, uploaded_by: userId,
        })
        if (insErr) throw new Error(insErr.message)
      }
      const { data } = await supabase.from('outlet_daily_closing_attachments').select('*').eq('closing_id', c.id).order('uploaded_at')
      setAttachments((data ?? []) as AttachmentRow[])
      toast({ type: 'success', message: `${files.length} foto caricat${files.length === 1 ? 'a' : 'e'}` })
    } catch (e) {
      toast({ type: 'error', message: 'Foto non caricata: ' + errMsg(e) })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const setAttachmentKind = async (a: AttachmentRow, kind: AttachmentKind) => {
    // La cassiera non ha UPDATE sugli allegati: il tipo lo si sceglie al volo
    // solo lato UI per l'ordine; l'aggiornamento riesce per super_advisor/contabile.
    const { error } = await supabase.from('outlet_daily_closing_attachments').update({ kind }).eq('id', a.id)
    if (!error) setAttachments((list) => list.map((x) => (x.id === a.id ? { ...x, kind } : x)))
  }

  const removeAttachment = async (a: AttachmentRow) => {
    const { error } = await supabase.from('outlet_daily_closing_attachments').delete().eq('id', a.id)
    if (error) { toast({ type: 'error', message: error.message }); return }
    await supabase.storage.from(BUCKET).remove([a.storage_path])
    setAttachments((list) => list.filter((x) => x.id !== a.id))
  }

  // ─── Calendario del mese ──────────────────────────────────────────────
  const [cy, cm] = dateIso.split('-').map(Number)
  const days = monthDays(cy, cm)
  const today = todayIso()
  const firstDow = (new Date(cy, cm - 1, 1).getDay() + 6) % 7 // lunedì = 0

  // ─── Render ───────────────────────────────────────────────────────────
  if (outletsLoading) return <div className="p-6 text-center text-slate-500">Caricamento…</div>
  if (outlets.length === 0) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <PageHeader title="Chiusura cassa" />
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
          Nessun punto vendita è collegato a questo accesso. Chiedi a chi amministra il gestionale di assegnarti un outlet da
          Impostazioni → Utenti.
        </div>
      </div>
    )
  }

  const inputCls = 'w-full rounded-xl border border-slate-300 px-4 py-3 text-lg text-right font-mono tabular-nums focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500'
  const labelCls = 'block text-sm font-medium text-slate-700 mb-1'
  const okCls = 'text-emerald-700 bg-emerald-50 border-emerald-200'
  const koCls = 'text-red-700 bg-red-50 border-red-200'

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto pb-28">
      <PageHeader
        title="Chiusura cassa"
        subtitle={outlet ? outlet.name : undefined}
        actions={isAdmin && outlets.length > 1 ? (
          <select value={outletId} onChange={(e) => setOutlet(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : undefined}
      />

      {/* Giorno */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-2 py-2 mb-4">
        <button onClick={() => setDate(addDaysIso(dateIso, -1))} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Giorno precedente"><ChevronLeft size={20} /></button>
        <div className="text-center">
          <div className="font-semibold text-slate-900 capitalize">{formatDateIt(dateIso, true)}</div>
          {closing && (
            <div className={`text-xs mt-0.5 ${readOnly ? 'text-emerald-700' : 'text-amber-700'}`}>
              {readOnly ? <><Lock size={12} className="inline mr-1" />{CLOSING_STATUS_LABELS[closing.status as keyof typeof CLOSING_STATUS_LABELS]}</> : 'Bozza'}
            </div>
          )}
        </div>
        <button onClick={() => setDate(addDaysIso(dateIso, 1))} disabled={dateIso >= today} className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30" aria-label="Giorno successivo"><ChevronRight size={20} /></button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-500"><Loader2 className="inline animate-spin mr-2" size={18} />Caricamento…</div>
      ) : channels.length === 0 && !form.isClosedDay ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
          Per questo punto vendita non sono ancora configurati i canali di incasso (contanti, POS, …).
          {isAdmin ? (
            <button onClick={() => navigate(`/incassi-giornalieri?outlet=${outletId}&tab=canali`)} className="ml-1 underline font-medium">Configurali in Incassi giornalieri</button>
          ) : ' Chiedi a chi amministra il gestionale di configurarli.'}
        </div>
      ) : (
        <>
          {/* 1. Foto */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Camera size={18} className="text-blue-600" />1. Foto delle chiusure</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full ${attachments.length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {attachments.length > 0 ? `${attachments.length} foto` : 'obbligatorie'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-3">Scontrino di chiusura del registratore, chiusura POS di ogni terminale, esito trasmissione. Una foto per scontrino.</p>
            {!readOnly && canWrite && !form.isClosedDay && (
              <>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-blue-600 text-white font-semibold text-base hover:bg-blue-700 disabled:opacity-60">
                  {uploading ? <Loader2 className="animate-spin" size={20} /> : <Camera size={20} />}
                  {uploading ? 'Caricamento…' : 'Fotografa le chiusure'}
                </button>
              </>
            )}
            {attachments.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {attachments.map((a) => (
                  <div key={a.id} className="relative group">
                    {signedUrls[a.storage_path] ? (
                      <a href={signedUrls[a.storage_path]} target="_blank" rel="noreferrer">
                        <img src={signedUrls[a.storage_path]} alt={ATTACHMENT_KIND_LABELS[a.kind as AttachmentKind] ?? 'Foto'} className="w-full h-28 object-cover rounded-lg border border-slate-200" />
                      </a>
                    ) : (
                      <div className="w-full h-28 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400"><ImageIcon size={20} /></div>
                    )}
                    {isAdmin ? (
                      <select value={a.kind} onChange={(e) => void setAttachmentKind(a, e.target.value as AttachmentKind)} className="mt-1 w-full text-[11px] border border-slate-200 rounded px-1 py-0.5">
                        {(Object.keys(ATTACHMENT_KIND_LABELS) as AttachmentKind[]).map((k) => <option key={k} value={k}>{ATTACHMENT_KIND_LABELS[k]}</option>)}
                      </select>
                    ) : (
                      <div className="mt-1 text-[11px] text-slate-500 truncate">{ATTACHMENT_KIND_LABELS[a.kind as AttachmentKind] ?? a.kind}</div>
                    )}
                    {!readOnly && a.uploaded_by === userId && (
                      <button onClick={() => void removeAttachment(a)} title="Togli questa foto" className="absolute top-1 right-1 p-1 rounded-full bg-white/90 text-red-600 shadow"><Trash2 size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Negozio chiuso */}
          {(!readOnly || form.isClosedDay) && (
            <label className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 mb-4 cursor-pointer">
              <input type="checkbox" checked={form.isClosedDay} disabled={readOnly || !canWrite} onChange={(e) => update({ isClosedDay: e.target.checked })} className="w-5 h-5" />
              <span className="text-sm text-slate-700"><strong>Negozio chiuso</strong> in questo giorno (nessun incasso, foto non richieste)</span>
            </label>
          )}

          {!form.isClosedDay && (
            <>
              {/* 2. Importi */}
              <section className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-4">
                <h2 className="font-semibold text-slate-900">2. Incassi del giorno</h2>
                <div>
                  <label className={labelCls}>Totale corrispettivi (dallo scontrino di chiusura)</label>
                  <input inputMode="decimal" value={form.total} disabled={readOnly || !canWrite} onChange={(e) => update({ total: e.target.value })} placeholder="0,00" className={`${inputCls} border-blue-300 bg-blue-50/40`} />
                </div>
                {channels.map((ch) => (
                  <div key={ch.id}>
                    <label className={labelCls}>{ch.label}{!ch.counts_in_total && <span className="text-xs text-slate-400 ml-1">(fuori totale)</span>}</label>
                    <input inputMode="decimal" value={form.amounts[ch.id] ?? ''} disabled={readOnly || !canWrite} onChange={(e) => updateAmount(ch.id, e.target.value)} placeholder="0,00" className={inputCls} />
                  </div>
                ))}
                <div className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${quad.receiptsDifference === 0 ? okCls : koCls}`}>
                  <span>Somma mezzi di pagamento: <strong>{formatEuro(quad.channelsTotal)}</strong></span>
                  <span className="font-semibold">{quad.receiptsDifference === 0 ? <><Check size={16} className="inline" /> quadra</> : `differenza ${formatEuro(quad.receiptsDifference)}`}</span>
                </div>
              </section>

              {/* 3. Cassa */}
              <section className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-4">
                <h2 className="font-semibold text-slate-900">3. Cassa contanti</h2>
                {prevFloat == null && (
                  <div>
                    <label className={labelCls}>Fondo cassa di ieri (solo la prima volta)</label>
                    <input inputMode="decimal" value={form.cashFloatOpening} disabled={readOnly || !canWrite} onChange={(e) => update({ cashFloatOpening: e.target.value })} placeholder="0,00" className={inputCls} />
                    <p className="text-xs text-slate-500 mt-1">Non c'è ancora una chiusura confermata precedente: scrivi il contante che c'era in cassa stamattina.</p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Spese cassa</label>
                    <input inputMode="decimal" value={form.cashExpenses} disabled={readOnly || !canWrite} onChange={(e) => update({ cashExpenses: e.target.value })} placeholder="0,00" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Descrizione spese</label>
                    <input value={form.cashExpensesNote} disabled={readOnly || !canWrite} onChange={(e) => update({ cashExpensesNote: e.target.value })} placeholder="es. cancelleria" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base disabled:bg-slate-100" />
                  </div>
                  <div>
                    <label className={labelCls}>Versamento in banca</label>
                    <input inputMode="decimal" value={form.cashDeposit} disabled={readOnly || !canWrite} onChange={(e) => update({ cashDeposit: e.target.value })} placeholder="0,00" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Causale versamento</label>
                    <input value={form.cashDepositNote} disabled={readOnly || !canWrite} onChange={(e) => update({ cashDepositNote: e.target.value })} placeholder="es. ATM MPS" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base disabled:bg-slate-100" />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Fondo cassa contato stasera</label>
                  <input inputMode="decimal" value={form.cashFloatDeclared} disabled={readOnly || !canWrite} onChange={(e) => update({ cashFloatDeclared: e.target.value })} placeholder="0,00" className={inputCls} />
                </div>
                {quad.cashFloatExpected != null ? (
                  <div className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${quad.cashDifference === 0 ? okCls : quad.cashDifference == null ? 'text-slate-600 bg-slate-50 border-slate-200' : koCls}`}>
                    <span>Fondo cassa atteso: <strong>{formatEuro(quad.cashFloatExpected)}</strong></span>
                    <span className="font-semibold">
                      {quad.cashDifference == null ? 'conta il fondo' : quad.cashDifference === 0 ? <><Check size={16} className="inline" /> quadra</> : `${quad.cashDifference > 0 ? 'eccedenza' : 'ammanco'} ${formatEuro(Math.abs(quad.cashDifference))}`}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Il fondo atteso si calcola dopo aver scritto il fondo di ieri.</p>
                )}
              </section>
            </>
          )}

          {/* 4. Chi chiude + note */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
            <div>
              <label className={labelCls}>Chi ha fatto la chiusura</label>
              <input value={form.closedByName} disabled={readOnly || !canWrite} onChange={(e) => update({ closedByName: e.target.value })} placeholder="Nome" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base disabled:bg-slate-100" />
            </div>
            <div>
              <label className={labelCls}>Note {needsNote && !readOnly && <span className="text-red-600">(obbligatorie: la giornata non quadra)</span>}</label>
              <textarea value={form.notes} disabled={readOnly || !canWrite} onChange={(e) => update({ notes: e.target.value })} rows={2} placeholder="Spiega eventuali differenze" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base disabled:bg-slate-100" />
            </div>
            {closing?.reopen_reason && closing.status === 'bozza' && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Riaperta: {closing.reopen_reason}</div>
            )}
          </section>

          {/* Azioni */}
          {canWrite && (
            <div className="fixed bottom-14 md:bottom-0 left-0 right-0 md:static bg-white/95 backdrop-blur border-t md:border-0 border-slate-200 p-3 md:p-0 z-30">
              <div className="max-w-xl mx-auto flex gap-2">
                {readOnly ? (
                  <>
                    {isAdmin ? (
                      <button onClick={() => setReopenOpen(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-amber-300 text-amber-800 bg-amber-50 font-semibold"><Unlock size={18} />Riapri la chiusura</button>
                    ) : (
                      <button onClick={() => setReopenOpen(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-300 text-slate-700 bg-white font-semibold"><MessageSquareWarning size={18} />Chiedi riapertura</button>
                    )}
                  </>
                ) : (
                  <>
                    <button onClick={() => void saveDraft()} disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-300 text-slate-700 bg-white font-semibold disabled:opacity-60">
                      {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}Salva bozza{dirty && ' •'}
                    </button>
                    <button onClick={() => void confirm()} disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60">
                      <Check size={18} />Conferma chiusura
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Calendario del mese */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 mt-4">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-3"><CalendarDays size={18} className="text-blue-600" />{MESI_IT[cm - 1]} {cy}</h2>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400 mb-1">
          {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDow }).map((_, i) => <div key={`pad${i}`} />)}
          {days.map((d) => {
            const st = monthStatus[d]
            const isFuture = d > today
            const isSel = d === dateIso
            const cls = isFuture ? 'bg-slate-50 text-slate-300'
              : st === 'confermata' || st === 'verificata' ? 'bg-emerald-500 text-white'
              : st === 'chiuso' ? 'bg-slate-300 text-white'
              : st === 'bozza' ? 'bg-amber-400 text-white'
              : d === today ? 'border-2 border-dashed border-slate-400 text-slate-700'
              : 'bg-red-100 text-red-700'
            return (
              <button key={d} disabled={isFuture} onClick={() => setDate(d)} title={d}
                className={`h-9 rounded-md text-sm font-medium ${cls} ${isSel ? 'ring-2 ring-blue-600 ring-offset-1' : ''} disabled:cursor-default`}>
                {Number(d.slice(-2))}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-slate-500">
          <span><i className="inline-block w-3 h-3 rounded bg-emerald-500 mr-1 align-middle" />confermata</span>
          <span><i className="inline-block w-3 h-3 rounded bg-amber-400 mr-1 align-middle" />bozza</span>
          <span><i className="inline-block w-3 h-3 rounded bg-red-100 mr-1 align-middle" />mancante</span>
          <span><i className="inline-block w-3 h-3 rounded bg-slate-300 mr-1 align-middle" />negozio chiuso</span>
        </div>
      </section>

      {isAdmin && (
        <div className="mt-4 text-center">
          <button onClick={() => navigate(`/incassi-giornalieri?outlet=${outletId}&date=${dateIso}`)} className="text-sm text-blue-600 underline inline-flex items-center gap-1"><Store size={14} />Vai agli incassi giornalieri</button>
        </div>
      )}

      <Modal open={reopenOpen} onClose={() => setReopenOpen(false)} title={isAdmin ? 'Riapri la chiusura' : 'Chiedi la riapertura'}>
        <p className="text-sm text-slate-600 mb-3">
          {isAdmin
            ? 'La chiusura torna in bozza e potrà essere corretta. Il motivo resta registrato.'
            : 'Chi amministra il gestionale riceverà un avviso e potrà riaprire la giornata. Indica il motivo.'}
        </p>
        <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={3} placeholder="Motivo" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={() => setReopenOpen(false)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg">Annulla</button>
          <button onClick={() => void (isAdmin ? reopen() : requestReopen())} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium inline-flex items-center gap-1">
            {isAdmin ? <Unlock size={14} /> : <AlertTriangle size={14} />}{isAdmin ? 'Riapri' : 'Invia richiesta'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function safeGetLs(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}
function safeSetLs(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* privato / bloccato */ }
}
