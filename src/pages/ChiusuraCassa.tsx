// Chiusura cassa — la schermata della cassiera (ruolo operatore_cassa).
//
// Un solo compito, pensato per lo smartphone a fine giornata:
//   1. scrivere totale corrispettivi (con la foto dello scontrino di chiusura,
//      l'unica OBBLIGATORIA), un importo per ogni canale di incasso
//      dell'outlet, le spese cassa (una riga per spesa), il versamento e il
//      fondo cassa contato;
//   2. fotografare, riga per riga, lo scontrino che giustifica ogni valore:
//      chiusura POS di ogni terminale, scontrino di ogni spesa, ricevuta del
//      versamento. Sono facoltative, ma senza foto potra' essere chiesto un
//      chiarimento (decisione di Patrizio, 2026-09-04). Agganciare la foto
//      alla riga serve anche alla lettura automatica (fase 1b);
//   3. vedere in tempo reale se la giornata quadra (totale = somma canali,
//      fondo contato = fondo atteso);
//   4. salvare la bozza o confermare. Dopo la conferma il giorno e' in sola
//      lettura: si puo' solo chiedere la riapertura (notifica a chi amministra).
//
// super_advisor e contabile usano la stessa pagina scegliendo l'outlet (e
// possono riaprire direttamente). La sicurezza vera e' la RLS (migrazioni
// 172-174): l'operatore di cassa vede e scrive solo il proprio outlet, solo
// in bozza. I campi calcolati li rifà il DB (trigger); qui si calcolano per
// il feedback immediato.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Camera, CalendarDays, ChevronLeft, ChevronRight, Check, AlertTriangle, Lock,
  Unlock, Trash2, Loader2, Save, Store, Image as ImageIcon, MessageSquareWarning, Plus, X,
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
  type PaymentChannel, type AttachmentTarget, type ExpenseKind, type ExtractedData, CLOSING_STATUS_LABELS, EXPENSE_KIND_LABELS, kindForTarget,
  parseAmount, formatAmount, formatEuro, computeQuadrature, todayIso, addDaysIso, monthDays,
  formatDateIt, MESI_IT, attachmentPath, compressImage, extractedAmount,
} from '../lib/cashClosings'

type ClosingRow = Database['public']['Tables']['outlet_daily_closings']['Row']
type AttachmentRow = Database['public']['Tables']['outlet_daily_closing_attachments']['Row']
type ExpenseRow = Database['public']['Tables']['outlet_daily_closing_expenses']['Row']

interface ExpenseDraft { id: string; kind: ExpenseKind; amount: string; description: string }

interface FormState {
  total: string
  amounts: Record<string, string>
  cashDeposit: string
  cashDepositNote: string
  cashFloatDeclared: string
  cashFloatOpening: string
  closedByName: string
  notes: string
  isClosedDay: boolean
}

/** Riga a cui agganciare la prossima foto scattata. */
interface PhotoTarget { target: AttachmentTarget; channelId?: string; expenseId?: string }

const emptyForm = (closedBy: string): FormState => ({
  total: '', amounts: {}, cashDeposit: '', cashDepositNote: '',
  cashFloatDeclared: '', cashFloatOpening: '', closedByName: closedBy, notes: '', isClosedDay: false,
})

const LS_CLOSED_BY = 'nz_cassa_closed_by'
const BUCKET = 'cash-closings'
const NO_PHOTO_HINT = 'senza foto potrà essere chiesto un chiarimento'

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export default function ChiusuraCassa() {
  const { profile, session } = useAuth()
  const { company } = useCompany()
  // Solo punti vendita: sede e magazzino non hanno cassa.
  const { outlets, loading: outletsLoading } = useOutlets({ sellingOnly: true })
  const { toast } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const role = profile?.role ?? ''
  const isAdmin = role === 'super_advisor' || role === 'contabile'
  const isSuper = role === 'super_advisor'
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
  const [lineIds, setLineIds] = useState<Record<string, string>>({})
  const [expenses, setExpenses] = useState<ExpenseDraft[]>([])
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
  const [missingPhotos, setMissingPhotos] = useState<string[] | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleting, setDeleting] = useState(false)
  /** Foto in lettura automatica (edge function closing-photo-extract), per id allegato. */
  const [readingIds, setReadingIds] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingTarget = useRef<PhotoTarget | null>(null)

  const readOnly = !!closing && closing.status !== 'bozza'
  const editable = canWrite && !readOnly

  // ─── Caricamento ──────────────────────────────────────────────────────
  const loadClosingChildren = useCallback(async (closingId: string) => {
    const [lRes, eRes, aRes] = await Promise.all([
      supabase.from('outlet_daily_closing_lines').select('id, channel_id, amount').eq('closing_id', closingId),
      supabase.from('outlet_daily_closing_expenses').select('*').eq('closing_id', closingId).order('sort_order'),
      supabase.from('outlet_daily_closing_attachments').select('*').eq('closing_id', closingId).order('uploaded_at'),
    ])
    const amounts: Record<string, string> = {}
    const ids: Record<string, string> = {}
    for (const l of lRes.data ?? []) { amounts[l.channel_id] = formatAmount(Number(l.amount)); ids[l.channel_id] = l.id }
    setLineIds(ids)
    setExpenses(((eRes.data ?? []) as ExpenseRow[]).map((e) => ({ id: e.id, kind: (e.kind as ExpenseKind) ?? 'spesa', amount: Number(e.amount) ? formatAmount(Number(e.amount)) : '', description: e.description ?? '' })))
    setAttachments((aRes.data ?? []) as AttachmentRow[])
    return amounts
  }, [])

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
    setPrevFloat(prev == null ? null : Number(prev))
    const ms: Record<string, string> = {}
    for (const r of monthRes.data ?? []) ms[r.closing_date] = r.is_closed_day ? 'chiuso' : r.status
    setMonthStatus(ms)

    const c = clRes.data ?? null
    setClosing(c)
    if (c) {
      const amounts = await loadClosingChildren(c.id)
      setForm({
        total: formatAmount(Number(c.total_receipts)),
        amounts,
        cashDeposit: Number(c.cash_deposit) ? formatAmount(Number(c.cash_deposit)) : '',
        cashDepositNote: c.cash_deposit_note ?? '',
        cashFloatDeclared: c.cash_float_declared == null ? '' : formatAmount(Number(c.cash_float_declared)),
        cashFloatOpening: c.cash_float_opening == null ? '' : formatAmount(Number(c.cash_float_opening)),
        closedByName: c.closed_by_name ?? safeGetLs(LS_CLOSED_BY),
        notes: c.notes ?? '',
        isClosedDay: c.is_closed_day,
      })
    } else {
      setForm(emptyForm(safeGetLs(LS_CLOSED_BY)))
      setLineIds({}); setExpenses([]); setAttachments([])
    }
    setDirty(false)
    setLoading(false)
  }, [companyId, outletId, dateIso, loadClosingChildren])

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
  const expensesTotal = useMemo(() => expenses.filter((e) => e.kind === 'spesa').reduce((s, e) => s + (parseAmount(e.amount) ?? 0), 0), [expenses])
  const refundsTotal = useMemo(() => expenses.filter((e) => e.kind === 'rimborso_cliente').reduce((s, e) => s + (parseAmount(e.amount) ?? 0), 0), [expenses])
  const quad = useMemo(() => computeQuadrature({
    totalReceipts: form.isClosedDay ? 0 : parseAmount(form.total) ?? 0,
    lines: channels.map((ch) => ({ kind: ch.kind, counts_in_total: ch.counts_in_total, amount: parseAmount(form.amounts[ch.id]) ?? 0 })),
    cashExpenses: expensesTotal,
    customerRefunds: refundsTotal,
    cashDeposit: parseAmount(form.cashDeposit) ?? 0,
    prevFloat: prevFloat ?? parseAmount(form.cashFloatOpening),
    cashFloatDeclared: parseAmount(form.cashFloatDeclared),
  }), [form, channels, prevFloat, expensesTotal, refundsTotal])

  const needsNote = quad.receiptsDifference !== 0 || (quad.cashDifference != null && quad.cashDifference !== 0)

  const update = (patch: Partial<FormState>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true) }
  const updateAmount = (channelId: string, v: string) => { setForm((f) => ({ ...f, amounts: { ...f.amounts, [channelId]: v } })); setDirty(true) }
  const updateExpense = (id: string, patch: Partial<ExpenseDraft>) => { setExpenses((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e))); setDirty(true) }

  // Foto per riga
  const photosFor = (t: AttachmentTarget, id?: string) => attachments.filter((a) =>
    a.target === t && (t === 'canale' ? a.line_id === id : t === 'spesa' ? a.expense_id === id : true))
  const totalPhotos = photosFor('totale')

  // ─── Persistenza ──────────────────────────────────────────────────────
  const closingPayload = () => ({
    total_receipts: form.isClosedDay ? 0 : parseAmount(form.total) ?? 0,
    cash_deposit: parseAmount(form.cashDeposit) ?? 0,
    cash_deposit_note: form.cashDepositNote.trim() || null,
    cash_float_declared: parseAmount(form.cashFloatDeclared),
    cash_float_opening: prevFloat == null ? parseAmount(form.cashFloatOpening) : null,
    closed_by_name: form.closedByName.trim() || null,
    notes: form.notes.trim() || null,
    is_closed_day: form.isClosedDay,
  })

  /** Crea la riga di chiusura se non esiste ancora (serve prima di foto e spese). */
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

  /** Salva chiusura, righe canale e spese; restituisce la chiusura aggiornata (o null se fallisce). */
  const saveDraft = async (silent = false): Promise<ClosingRow | null> => {
    if (!editable) return closing
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
      for (const [i, e] of expenses.entries()) {
        const { error: eErr } = await supabase.from('outlet_daily_closing_expenses')
          .update({ amount: parseAmount(e.amount) ?? 0, description: e.description.trim() || null, sort_order: i + 1, updated_at: new Date().toISOString() })
          .eq('id', e.id)
        if (eErr) throw new Error(eErr.message)
      }
      safeSetLs(LS_CLOSED_BY, form.closedByName.trim())
      const { data: fresh } = await supabase.from('outlet_daily_closings').select('*').eq('id', c.id).single()
      if (fresh) setClosing(fresh)
      const { data: lines } = await supabase.from('outlet_daily_closing_lines').select('id, channel_id').eq('closing_id', c.id)
      const ids: Record<string, string> = {}
      for (const l of lines ?? []) ids[l.channel_id] = l.id
      setLineIds(ids)
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

  const addExpense = async (kind: ExpenseKind) => {
    if (!companyId || !editable) return
    try {
      const c = await ensureClosing()
      const { data, error } = await supabase.from('outlet_daily_closing_expenses')
        .insert({ closing_id: c.id, company_id: companyId, outlet_id: outletId, kind, amount: 0, sort_order: expenses.length + 1 })
        .select('*').single()
      if (error || !data) throw new Error(errMsg(error))
      setExpenses((list) => [...list, { id: data.id, kind, amount: '', description: '' }])
    } catch (e) {
      toast({ type: 'error', message: 'Spesa non aggiunta: ' + errMsg(e) })
    }
  }

  const removeExpense = async (id: string) => {
    const { error } = await supabase.from('outlet_daily_closing_expenses').delete().eq('id', id)
    if (error) { toast({ type: 'error', message: error.message }); return }
    const orphan = attachments.filter((a) => a.expense_id === id)
    for (const a of orphan) {
      await supabase.from('outlet_daily_closing_attachments').delete().eq('id', a.id)
      await supabase.storage.from(BUCKET).remove([a.storage_path])
    }
    setExpenses((list) => list.filter((e) => e.id !== id))
    setAttachments((list) => list.filter((a) => a.expense_id !== id))
  }

  /** Righe con importo ma senza foto: solo un avviso, la conferma resta possibile. */
  const missingOptionalPhotos = (): string[] => {
    const out: string[] = []
    for (const ch of channels) {
      if ((ch.kind === 'pos' || ch.kind === 'pos_amex') && (parseAmount(form.amounts[ch.id]) ?? 0) > 0 && photosFor('canale', lineIds[ch.id]).length === 0) out.push(`chiusura POS di ${ch.label}`)
    }
    for (const e of expenses) {
      if (e.kind === 'spesa' && photosFor('spesa', e.id).length === 0) out.push(`scontrino della spesa "${e.description.trim() || 'senza descrizione'}"`)
    }
    if ((parseAmount(form.cashDeposit) ?? 0) > 0 && photosFor('versamento').length === 0) out.push('ricevuta del versamento')
    return out
  }

  const confirm = async (force = false) => {
    if (!form.isClosedDay && totalPhotos.length === 0) {
      toast({ type: 'warning', message: 'Serve la foto dello scontrino di chiusura: è l\'unica obbligatoria.' })
      return
    }
    if (needsNote && !form.notes.trim()) {
      toast({ type: 'warning', message: 'La giornata non quadra: scrivi una nota che spieghi la differenza.' })
      return
    }
    if (expenses.some((e) => e.kind === 'rimborso_cliente' && !e.description.trim())) {
      toast({ type: 'warning', message: 'Ogni rimborso a cliente deve avere una nota di spiegazione.' })
      return
    }
    if (!force && !form.isClosedDay) {
      const missing = missingOptionalPhotos()
      if (missing.length > 0) { setMissingPhotos(missing); return }
    }
    setMissingPhotos(null)
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

  /**
   * Cancella l'intera giornata (solo super advisor): prima i file nel bucket
   * via Storage API, poi la RPC che toglie righe, spese, foto, la proiezione
   * in daily_revenue e lascia una notifica di traccia. La giornata torna
   * vuota e si puo' reinserire da zero.
   */
  const deleteDay = async () => {
    if (!closing || !isSuper) return
    setDeleting(true)
    try {
      const paths = attachments.map((a) => a.storage_path)
      if (paths.length > 0) {
        const { error: stErr } = await supabase.storage.from(BUCKET).remove(paths)
        if (stErr) console.warn('[chiusura-cassa] file non rimossi dal bucket', stErr)
      }
      const { error } = await supabase.rpc('delete_cash_closing', { p_closing_id: closing.id, p_reason: deleteReason || undefined })
      if (error) throw new Error(error.message)
      setDeleteOpen(false); setDeleteReason('')
      toast({ type: 'success', message: 'Giornata cancellata: ora puoi reinserirla da zero' })
      await load()
    } catch (e) {
      toast({ type: 'error', message: 'Cancellazione non riuscita: ' + errMsg(e) })
    } finally {
      setDeleting(false)
    }
  }

  const requestReopen = async () => {
    if (!closing) return
    const { error } = await supabase.rpc('request_cash_closing_reopen', { p_closing_id: closing.id, p_reason: reopenReason || undefined })
    if (error) { toast({ type: 'error', message: error.message }); return }
    setReopenOpen(false); setReopenReason('')
    toast({ type: 'success', message: 'Richiesta inviata: chi amministra riceverà un avviso' })
  }

  // ─── Foto ─────────────────────────────────────────────────────────────
  // Il click sull'input file deve avvenire nel gesto dell'utente (altrimenti
  // iOS non apre la fotocamera): si memorizza la riga e si apre subito; il
  // salvataggio della bozza avviene dopo, alla scelta del file.
  const takePhoto = (t: PhotoTarget) => {
    pendingTarget.current = t
    fileRef.current?.click()
  }

  const onFiles = async (files: FileList | null) => {
    const t = pendingTarget.current
    if (!files || files.length === 0 || !companyId || !userId || !t) return
    setUploading(true)
    const newIds: string[] = []
    try {
      const c = await ensureClosing()
      let lineId: string | null = null
      if (t.target === 'canale' && t.channelId) {
        lineId = lineIds[t.channelId] ?? null
        if (!lineId) {
          const saved = await saveDraft(true)
          if (!saved) return
          const { data: l } = await supabase.from('outlet_daily_closing_lines').select('id').eq('closing_id', c.id).eq('channel_id', t.channelId).maybeSingle()
          lineId = l?.id ?? null
        }
      }
      const channelKind = t.channelId ? channels.find((ch) => ch.id === t.channelId)?.kind : undefined
      for (const file of Array.from(files)) {
        const blob = await compressImage(file)
        const id = crypto.randomUUID()
        const path = attachmentPath(companyId, outletId, dateIso, id)
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
        if (upErr) throw new Error(upErr.message)
        const { data: ins, error: insErr } = await supabase.from('outlet_daily_closing_attachments').insert({
          closing_id: c.id, company_id: companyId, outlet_id: outletId,
          target: t.target, kind: kindForTarget(t.target, channelKind),
          line_id: lineId, expense_id: t.expenseId ?? null,
          storage_path: path, mime_type: 'image/jpeg', size_bytes: blob.size, uploaded_by: userId,
        }).select('id').single()
        if (insErr || !ins) throw new Error(errMsg(insErr))
        newIds.push(ins.id)
      }
      const { data } = await supabase.from('outlet_daily_closing_attachments').select('*').eq('closing_id', c.id).order('uploaded_at')
      setAttachments((data ?? []) as AttachmentRow[])
    } catch (e) {
      toast({ type: 'error', message: 'Foto non caricata: ' + errMsg(e) })
    } finally {
      setUploading(false)
      pendingTarget.current = null
      if (fileRef.current) fileRef.current.value = ''
    }
    // La lettura automatica parte dopo il caricamento e non blocca la cassiera.
    for (const id of newIds) void readPhoto(id, t)
  }

  /**
   * Lettura automatica della foto (fase 1b): chiede alla edge function di
   * leggere lo scontrino e, se il campo della riga è ancora vuoto, lo
   * precompila col valore letto. Se il campo è già scritto non lo tocca:
   * la differenza si vede nel chip "dalla foto" sotto la foto.
   */
  const readPhoto = async (attachmentId: string, t: PhotoTarget) => {
    setReadingIds((set) => new Set(set).add(attachmentId))
    try {
      const { data, error } = await supabase.functions.invoke<{ data?: { status: string; extracted: ExtractedData } }>('closing-photo-extract', { body: { attachment_id: attachmentId } })
      const res = data?.data
      if (error || !res) throw new Error(error?.message ?? 'risposta vuota')
      setAttachments((list) => list.map((a) => (a.id === attachmentId
        ? { ...a, extraction_status: res.status, extracted: res.extracted as AttachmentRow['extracted'], extracted_at: new Date().toISOString() }
        : a)))
      if (res.status === 'letta' || res.status === 'da_rivedere') prefillFromPhoto(t, res.extracted)
    } catch (e) {
      // Nessun errore bloccante: la cassiera scrive i numeri a mano come prima.
      console.warn('[chiusura-cassa] lettura foto non riuscita', e)
      setAttachments((list) => list.map((a) => (a.id === attachmentId ? { ...a, extraction_status: 'fallita' } : a)))
    } finally {
      setReadingIds((set) => { const n = new Set(set); n.delete(attachmentId); return n })
    }
  }

  const isBlank = (v: string | undefined) => parseAmount(v) == null
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')

  /** Precompila SOLO i campi vuoti della riga con i valori letti dalla foto. */
  const prefillFromPhoto = (t: PhotoTarget, ex: ExtractedData) => {
    const amount = extractedAmount(ex)
    setForm((f) => {
      const next = { ...f, amounts: { ...f.amounts } }
      let changed = false
      if (t.target === 'totale') {
        if (amount != null && isBlank(f.total)) { next.total = formatAmount(amount); changed = true }
        const cash = typeof ex.cash === 'number' ? ex.cash : null
        const cashCh = channels.find((c) => c.kind === 'contanti')
        if (cash != null && cashCh && isBlank(f.amounts[cashCh.id])) { next.amounts[cashCh.id] = formatAmount(cash); changed = true }
      } else if (t.target === 'canale' && t.channelId) {
        if (amount != null && isBlank(f.amounts[t.channelId])) { next.amounts[t.channelId] = formatAmount(amount); changed = true }
      } else if (t.target === 'versamento') {
        if (amount != null && isBlank(f.cashDeposit)) { next.cashDeposit = formatAmount(amount); changed = true }
        if (!f.cashDepositNote.trim() && str(ex.bank)) { next.cashDepositNote = `Versamento ${str(ex.bank)}`; changed = true }
      }
      if (changed) setDirty(true)
      return changed ? next : f
    })
    if (t.target === 'spesa' && t.expenseId) {
      setExpenses((list) => list.map((e) => {
        if (e.id !== t.expenseId) return e
        const patch: Partial<ExpenseDraft> = {}
        if (amount != null && isBlank(e.amount)) patch.amount = formatAmount(amount)
        if (!e.description.trim()) { const d = str(ex.description) || str(ex.merchant); if (d) patch.description = d }
        if (Object.keys(patch).length === 0) return e
        setDirty(true)
        return { ...e, ...patch }
      }))
    }
  }

  /** Valore scritto nel campo della riga, per confrontarlo con la lettura. */
  const fieldValueFor = (t: PhotoTarget): number | null => {
    if (t.target === 'totale') return parseAmount(form.total)
    if (t.target === 'canale' && t.channelId) return parseAmount(form.amounts[t.channelId])
    if (t.target === 'spesa' && t.expenseId) return parseAmount(expenses.find((e) => e.id === t.expenseId)?.amount)
    if (t.target === 'versamento') return parseAmount(form.cashDeposit)
    return null
  }

  /** "Usa" nel chip: scrive nel campo il valore letto dalla foto. */
  const useExtracted = (t: PhotoTarget, amount: number) => {
    const v = formatAmount(amount)
    if (t.target === 'totale') update({ total: v })
    else if (t.target === 'canale' && t.channelId) updateAmount(t.channelId, v)
    else if (t.target === 'spesa' && t.expenseId) updateExpense(t.expenseId, { amount: v })
    else if (t.target === 'versamento') update({ cashDeposit: v })
  }

  /** Chip sotto la foto: stato della lettura e confronto col campo. */
  const ExtractionChip = ({ a, t }: { a: AttachmentRow; t: PhotoTarget }) => {
    if (a.target === 'altro') return null
    if (readingIds.has(a.id)) return <span className="inline-flex items-center gap-1 text-[11px] text-blue-700"><Loader2 size={11} className="animate-spin" />lettura…</span>
    const amount = extractedAmount(a.extracted)
    const status = a.extraction_status
    if (status === 'in_attesa') {
      return editable ? <button type="button" onClick={() => void readPhoto(a.id, t)} className="text-[11px] text-blue-700 underline">leggi la foto</button> : null
    }
    if (status === 'fallita' || amount == null) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
          {status === 'fallita' ? 'lettura non riuscita' : 'importo non leggibile'}
          {editable && <button type="button" onClick={() => void readPhoto(a.id, t)} className="underline text-blue-700">riprova</button>}
        </span>
      )
    }
    const field = fieldValueFor(t)
    const same = field != null && Math.abs(field - amount) < 0.005
    const uncertain = status === 'da_rivedere'
    if (same) return <span className={`inline-flex items-center gap-1 text-[11px] ${uncertain ? 'text-amber-700' : 'text-emerald-700'}`}><Check size={11} />dalla foto: {formatEuro(amount)}{uncertain ? ' (da controllare)' : ''}</span>
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
        dalla foto: <strong>{formatEuro(amount)}</strong>{uncertain ? ' ?' : ''}
        {editable && <button type="button" onClick={() => useExtracted(t, amount)} className="underline font-medium">usa</button>}
      </span>
    )
  }

  const removeAttachment = async (a: AttachmentRow) => {
    const { error } = await supabase.from('outlet_daily_closing_attachments').delete().eq('id', a.id)
    if (error) { toast({ type: 'error', message: error.message }); return }
    await supabase.storage.from(BUCKET).remove([a.storage_path])
    setAttachments((list) => list.filter((x) => x.id !== a.id))
  }

  /** Pulsante fotocamera + anteprime per una riga. */
  const PhotoStrip = ({ t, required = false, hint = true }: { t: PhotoTarget; required?: boolean; hint?: boolean }) => {
    const list = photosFor(t.target, t.channelId ? lineIds[t.channelId] : t.expenseId)
    return (
      <div className="flex items-center gap-2 flex-wrap mt-1.5">
        {editable && !form.isClosedDay && (
          <button type="button" onClick={() => takePhoto(t)} disabled={uploading}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border ${required && list.length === 0 ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-slate-300 text-slate-700'} disabled:opacity-60`}>
            <Camera size={16} />{list.length === 0 ? 'Foto' : 'Altra foto'}
          </button>
        )}
        {list.map((a) => (
          <span key={a.id} className="relative inline-block">
            {signedUrls[a.storage_path] ? (
              <a href={signedUrls[a.storage_path]} target="_blank" rel="noreferrer">
                <img src={signedUrls[a.storage_path]} alt="" className="w-12 h-12 object-cover rounded-md border border-slate-200" />
              </a>
            ) : (
              <span className="inline-flex w-12 h-12 rounded-md bg-slate-100 items-center justify-center text-slate-400"><ImageIcon size={16} /></span>
            )}
            {editable && a.uploaded_by === userId && (
              <button type="button" onClick={() => void removeAttachment(a)} title="Togli questa foto" className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-white text-red-600 shadow border border-slate-200"><X size={12} /></button>
            )}
          </span>
        ))}
        {list.length === 0 && !form.isClosedDay && (
          <span className={`text-[11px] ${required ? 'text-red-600 font-medium' : 'text-slate-400'}`}>{required ? 'obbligatoria' : hint ? NO_PHOTO_HINT : ''}</span>
        )}
        {list.length > 0 && (
          <div className="basis-full flex flex-wrap gap-2">
            {list.map((a) => <ExtractionChip key={a.id} a={a} t={t} />)}
          </div>
        )}
      </div>
    )
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
  const textCls = 'w-full rounded-xl border border-slate-300 px-4 py-3 text-base disabled:bg-slate-100'
  const labelCls = 'block text-sm font-medium text-slate-700 mb-1'
  const okCls = 'text-emerald-700 bg-emerald-50 border-emerald-200'
  const koCls = 'text-red-700 bg-red-50 border-red-200'

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto pb-28">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFiles(e.target.files)} />
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
          {uploading && (
            <div className="mb-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Caricamento foto…</div>
          )}

          {/* Negozio chiuso */}
          {(!readOnly || form.isClosedDay) && (
            <label className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 mb-4 cursor-pointer">
              <input type="checkbox" checked={form.isClosedDay} disabled={!editable} onChange={(e) => update({ isClosedDay: e.target.checked })} className="w-5 h-5" />
              <span className="text-sm text-slate-700"><strong>Negozio chiuso</strong> in questo giorno (nessun incasso, foto non richieste)</span>
            </label>
          )}

          {!form.isClosedDay && (
            <>
              {/* 1. Totale + canali */}
              <section className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-4">
                <h2 className="font-semibold text-slate-900">1. Incassi del giorno</h2>
                <p className="text-xs text-slate-500 -mt-2">Per ogni riga puoi fotografare lo scontrino che la giustifica. Solo la foto dello scontrino di chiusura è obbligatoria. I numeri vengono letti dalla foto e proposti nei campi vuoti: controllali sempre.</p>
                <div>
                  <label className={labelCls}>Totale corrispettivi (dallo scontrino di chiusura)</label>
                  <input inputMode="decimal" value={form.total} disabled={!editable} onChange={(e) => update({ total: e.target.value })} placeholder="0,00" className={`${inputCls} border-blue-300 bg-blue-50/40`} />
                  <PhotoStrip t={{ target: 'totale' }} required />
                </div>
                {channels.map((ch) => (
                  <div key={ch.id}>
                    <label className={labelCls}>{ch.label}{!ch.counts_in_total && <span className="text-xs text-slate-400 ml-1">(fuori totale)</span>}</label>
                    <input inputMode="decimal" value={form.amounts[ch.id] ?? ''} disabled={!editable} onChange={(e) => updateAmount(ch.id, e.target.value)} placeholder="0,00" className={inputCls} />
                    {ch.kind !== 'contanti' && <PhotoStrip t={{ target: 'canale', channelId: ch.id }} hint={(ch.kind === 'pos' || ch.kind === 'pos_amex') && (parseAmount(form.amounts[ch.id]) ?? 0) > 0} />}
                  </div>
                ))}
                <div className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${quad.receiptsDifference === 0 ? okCls : koCls}`}>
                  <span>Somma mezzi di pagamento: <strong>{formatEuro(quad.channelsTotal)}</strong></span>
                  <span className="font-semibold">{quad.receiptsDifference === 0 ? <><Check size={16} className="inline" /> quadra</> : `differenza ${formatEuro(quad.receiptsDifference)}`}</span>
                </div>
              </section>

              {/* 2. Spese cassa e rimborsi */}
              <section className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-slate-900">2. Spese cassa e rimborsi</h2>
                  <span className="text-sm text-slate-600 font-mono tabular-nums">{formatEuro(expensesTotal + refundsTotal)}</span>
                </div>
                {expenses.length === 0 && <p className="text-xs text-slate-500">Nessuna uscita pagata con i contanti del negozio.</p>}
                {expenses.map((e, i) => {
                  const isRefund = e.kind === 'rimborso_cliente'
                  return (
                    <div key={e.id} className={`border rounded-xl p-3 space-y-2 ${isRefund ? 'border-violet-200 bg-violet-50/30' : 'border-slate-200'}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 w-5">{i + 1}.</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isRefund ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700'}`}>{EXPENSE_KIND_LABELS[e.kind]}</span>
                        <div className="flex-1" />
                        {editable && <button type="button" onClick={() => void removeExpense(e.id)} title="Togli la riga" className="p-2 text-red-600 rounded-lg hover:bg-red-50"><Trash2 size={18} /></button>}
                      </div>
                      <input inputMode="decimal" value={e.amount} disabled={!editable} onChange={(ev) => updateExpense(e.id, { amount: ev.target.value })} placeholder="0,00" className={inputCls} />
                      <input value={e.description} disabled={!editable} onChange={(ev) => updateExpense(e.id, { description: ev.target.value })}
                        placeholder={isRefund ? 'Motivo del rimborso (obbligatorio)' : 'Descrizione (es. cancelleria)'}
                        className={`${textCls} ${isRefund && !e.description.trim() ? 'border-red-300' : ''}`} />
                      {isRefund
                        ? <p className="text-[11px] text-slate-500">Nessuna foto richiesta: basta la spiegazione.</p>
                        : <PhotoStrip t={{ target: 'spesa', expenseId: e.id }} />}
                    </div>
                  )
                })}
                {editable && (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => void addExpense('spesa')} className="flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"><Plus size={16} />Spesa cassa</button>
                    <button type="button" onClick={() => void addExpense('rimborso_cliente')} className="flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-violet-300 text-violet-800 text-sm font-medium hover:bg-violet-50"><Plus size={16} />Rimborso a cliente</button>
                  </div>
                )}
              </section>

              {/* 3. Cassa */}
              <section className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-4">
                <h2 className="font-semibold text-slate-900">3. Versamento e fondo cassa</h2>
                {prevFloat == null && (
                  <div>
                    <label className={labelCls}>Fondo cassa di ieri (solo la prima volta)</label>
                    <input inputMode="decimal" value={form.cashFloatOpening} disabled={!editable} onChange={(e) => update({ cashFloatOpening: e.target.value })} placeholder="0,00" className={inputCls} />
                    <p className="text-xs text-slate-500 mt-1">Non c'è ancora una chiusura confermata precedente: scrivi il contante che c'era in cassa stamattina.</p>
                  </div>
                )}
                <div>
                  <label className={labelCls}>Versamento in banca</label>
                  <input inputMode="decimal" value={form.cashDeposit} disabled={!editable} onChange={(e) => update({ cashDeposit: e.target.value })} placeholder="0,00" className={inputCls} />
                  <input value={form.cashDepositNote} disabled={!editable} onChange={(e) => update({ cashDepositNote: e.target.value })} placeholder="Causale (es. ATM MPS)" className={`${textCls} mt-2`} />
                  <PhotoStrip t={{ target: 'versamento' }} hint={(parseAmount(form.cashDeposit) ?? 0) > 0} />
                </div>
                <div>
                  <label className={labelCls}>Fondo cassa contato stasera</label>
                  <input inputMode="decimal" value={form.cashFloatDeclared} disabled={!editable} onChange={(e) => update({ cashFloatDeclared: e.target.value })} placeholder="0,00" className={inputCls} />
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
              <input value={form.closedByName} disabled={!editable} onChange={(e) => update({ closedByName: e.target.value })} placeholder="Nome" className={textCls} />
            </div>
            <div>
              <label className={labelCls}>Note {needsNote && !readOnly && <span className="text-red-600">(obbligatorie: la giornata non quadra)</span>}</label>
              <textarea value={form.notes} disabled={!editable} onChange={(e) => update({ notes: e.target.value })} rows={2} placeholder="Spiega eventuali differenze" className={textCls} />
            </div>
            {closing?.reopen_reason && closing.status === 'bozza' && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Riaperta: {closing.reopen_reason}</div>
            )}
            {readOnly && photosFor('altro').length > 0 && <PhotoStrip t={{ target: 'altro' }} hint={false} />}
          </section>

          {/* Azioni */}
          {/* Su telefono la barra sta sopra la bottom nav; il padding a destra lascia
              libero il pulsante "?" dell'aiuto (fixed bottom-20 right-4), che altrimenti
              copre "Conferma chiusura". */}
          {canWrite && (
            <div className="fixed bottom-14 md:bottom-0 left-0 right-0 md:static bg-white/95 backdrop-blur border-t md:border-0 border-slate-200 p-3 pr-20 md:p-0 z-30">
              <div className="max-w-xl mx-auto flex gap-2">
                {readOnly ? (
                  isAdmin ? (
                    <button onClick={() => setReopenOpen(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-amber-300 text-amber-800 bg-amber-50 font-semibold"><Unlock size={18} />Riapri la chiusura</button>
                  ) : (
                    <button onClick={() => setReopenOpen(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-300 text-slate-700 bg-white font-semibold"><MessageSquareWarning size={18} />Chiedi riapertura</button>
                  )
                ) : (
                  <>
                    <button onClick={() => void saveDraft()} disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-300 text-slate-700 bg-white font-semibold disabled:opacity-60">
                      {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}Salva bozza{dirty && ' •'}
                    </button>
                    <button onClick={() => void confirm()} disabled={saving || uploading} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60">
                      <Check size={18} />Conferma chiusura
                    </button>
                  </>
                )}
                {isSuper && closing && (
                  <button onClick={() => setDeleteOpen(true)} title="Cancella la giornata per reinserirla da zero (solo super advisor)"
                    className="flex items-center justify-center gap-1 px-3 py-3 rounded-xl border border-red-300 text-red-700 bg-white font-semibold">
                    <Trash2 size={18} /><span className="hidden sm:inline">Cancella giornata</span>
                  </button>
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

      {/* Avviso foto facoltative mancanti */}
      <Modal open={missingPhotos != null} onClose={() => setMissingPhotos(null)} title="Mancano alcune foto">
        <p className="text-sm text-slate-600 mb-2">Puoi confermare lo stesso, ma senza queste foto potrà esserti chiesto un chiarimento:</p>
        <ul className="text-sm text-slate-800 list-disc pl-5 mb-4 space-y-1">
          {(missingPhotos ?? []).map((m) => <li key={m}>{m}</li>)}
        </ul>
        <div className="flex justify-end gap-2">
          <button onClick={() => setMissingPhotos(null)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg inline-flex items-center gap-1"><Camera size={14} />Torna a fotografare</button>
          <button onClick={() => void confirm(true)} className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium inline-flex items-center gap-1"><Check size={14} />Conferma comunque</button>
        </div>
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Cancella la giornata">
        <p className="text-sm text-slate-700">
          Cancelli la chiusura di <strong>{outlet?.name}</strong> del <strong>{formatDateIt(dateIso)}</strong>: importi, spese, rimborsi, foto e il ricavo
          giornaliero proiettato. La giornata torna vuota e va reinserita da zero. L'operazione resta tracciata tra le notifiche.
        </p>
        <input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Motivo (facoltativo, es. dati di prova)" className={`${textCls} mt-3`} />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setDeleteOpen(false)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg">Annulla</button>
          <button onClick={() => void deleteDay()} disabled={deleting} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium inline-flex items-center gap-1 disabled:opacity-60">
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}Cancella davvero
          </button>
        </div>
      </Modal>

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
