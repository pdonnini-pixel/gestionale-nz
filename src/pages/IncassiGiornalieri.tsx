// Incassi giornalieri — la vista amministrativa dello specchietto incassi.
//
// Chi amministra (super_advisor, contabile, cfo, ceo) vede qui:
//   * il mese per tutti gli outlet (giorni × outlet, con lo stato di ogni
//     chiusura e i giorni mancanti in evidenza), oppure
//   * il mese di un solo outlet nella stessa forma del foglio Excel: una riga
//     al giorno, una colonna per canale di incasso, spese, versamento, fondo
//     cassa, differenze, stato, foto;
//   * il dettaglio di ogni giornata con le foto degli scontrini;
//   * la configurazione dei canali di incasso per outlet (tab "Canali"):
//     e' qui che si decidono le "colonne" che la cassiera vede.
// La riapertura di una chiusura confermata passa da qui (o dalla pagina
// Chiusura cassa) tramite la funzione reopen_cash_closing.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Unlock, Pencil, Image as ImageIcon, Plus, Save, Loader2, Settings2, Table2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useCompany } from '../hooks/useCompany'
import { useOutlets } from '../hooks/useOutlets'
import { useToast } from '../components/Toast'
import { Modal } from '../components/ui/Modal'
import PageHeader from '../components/PageHeader'
import { fetchAllPaged } from '../lib/fetchAllPaged'
import type { Database } from '../types/database'
import {
  type PaymentChannel, type ChannelKind, type AttachmentKind, CHANNEL_KIND_LABELS, ATTACHMENT_KIND_LABELS,
  CLOSING_STATUS_LABELS, DEFAULT_CHANNELS, formatEuro, monthDays, todayIso, formatDateIt, MESI_IT,
} from '../lib/cashClosings'

type ClosingRow = Database['public']['Tables']['outlet_daily_closings']['Row']
interface LineLite { closing_id: string; channel_id: string; amount: number }
interface AttachmentLite { id: string; closing_id: string; storage_path: string; kind: string }
interface BankAccountLite { id: string; bank_name: string | null; account_name: string | null }

const BUCKET = 'cash-closings'
const ALL = 'all'

export default function IncassiGiornalieri() {
  const { profile } = useAuth()
  const { company } = useCompany()
  const { outlets } = useOutlets()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const role = profile?.role ?? ''
  const canManage = role === 'super_advisor' || role === 'contabile'
  const companyId = company?.id ?? null

  const outletFilter = params.get('outlet') || ALL
  const tab = params.get('tab') === 'canali' ? 'canali' : 'riepilogo'
  const initialDate = params.get('date') || todayIso()
  const [ym, setYm] = useState<{ y: number; m: number }>(() => {
    const [y, m] = initialDate.split('-').map(Number)
    return { y, m }
  })
  const [detail, setDetail] = useState<{ outletId: string; date: string } | null>(
    params.get('date') && params.get('outlet') && params.get('outlet') !== ALL ? { outletId: params.get('outlet')!, date: params.get('date')! } : null,
  )

  const [channels, setChannels] = useState<PaymentChannel[]>([])
  const [closings, setClosings] = useState<ClosingRow[]>([])
  const [lines, setLines] = useState<LineLite[]>([])
  const [attachments, setAttachments] = useState<AttachmentLite[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccountLite[]>([])
  const [loading, setLoading] = useState(true)

  const setFilter = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p })

  const days = useMemo(() => monthDays(ym.y, ym.m), [ym])
  const today = todayIso()
  const visibleOutlets = useMemo(
    () => outlets.filter((o) => outletFilter === ALL || o.id === outletFilter),
    [outlets, outletFilter],
  )

  // ─── Caricamento del mese ─────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!companyId || outlets.length === 0) return
    setLoading(true)
    const from = days[0]
    const to = days[days.length - 1]
    const [chRes, clRes, baRes] = await Promise.all([
      supabase.from('outlet_payment_channels').select('*').eq('company_id', companyId).order('outlet_id').order('sort_order'),
      supabase.from('outlet_daily_closings').select('*').eq('company_id', companyId).gte('closing_date', from).lte('closing_date', to).order('closing_date'),
      supabase.from('bank_accounts').select('id, bank_name, account_name').eq('company_id', companyId).eq('is_active', true).order('bank_name'),
    ])
    setChannels((chRes.data ?? []) as PaymentChannel[])
    const cls = (clRes.data ?? []) as ClosingRow[]
    setClosings(cls)
    setBankAccounts((baRes.data ?? []) as BankAccountLite[])
    if (cls.length > 0) {
      const ids = cls.map((c) => c.id)
      const [ls, as] = await Promise.all([
        fetchAllPaged<LineLite>((f, t) => supabase.from('outlet_daily_closing_lines').select('closing_id, channel_id, amount').in('closing_id', ids).order('id').range(f, t), 'closing_lines'),
        fetchAllPaged<AttachmentLite>((f, t) => supabase.from('outlet_daily_closing_attachments').select('id, closing_id, storage_path, kind').in('closing_id', ids).order('id').range(f, t), 'closing_attachments'),
      ])
      setLines(ls.map((l) => ({ ...l, amount: Number(l.amount) })))
      setAttachments(as)
    } else {
      setLines([]); setAttachments([])
    }
    setLoading(false)
  }, [companyId, outlets.length, days])

  useEffect(() => { void load() }, [load])

  const closingAt = useMemo(() => {
    const map = new Map<string, ClosingRow>()
    for (const c of closings) map.set(`${c.outlet_id}|${c.closing_date}`, c)
    return map
  }, [closings])
  const linesByClosing = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const l of lines) {
      if (!map.has(l.closing_id)) map.set(l.closing_id, new Map())
      map.get(l.closing_id)!.set(l.channel_id, l.amount)
    }
    return map
  }, [lines])
  const attCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of attachments) map.set(a.closing_id, (map.get(a.closing_id) ?? 0) + 1)
    return map
  }, [attachments])

  const prevMonth = () => setYm(({ y, m }) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }))
  const nextMonth = () => setYm(({ y, m }) => (m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }))

  const statusCls = (c: ClosingRow | undefined, d: string) => {
    if (!c) return d < today ? 'bg-red-50 text-red-700' : 'bg-white text-slate-300'
    if (c.is_closed_day) return 'bg-slate-100 text-slate-500'
    if (c.status === 'bozza') return 'bg-amber-50 text-amber-800'
    return 'bg-emerald-50 text-emerald-800'
  }

  const openClosingPage = (outletId: string, date: string) => navigate(`/chiusura-cassa?outlet=${outletId}&date=${date}`)

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Incassi giornalieri"
        subtitle="Chiusure di cassa dei punti vendita: totali, canali, foto degli scontrini"
        actions={(
          <div className="flex items-center gap-2">
            <button onClick={() => setFilter('tab', '')} className={`px-3 py-1.5 text-sm rounded-lg border ${tab === 'riepilogo' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-300 text-slate-700'}`}><Table2 size={14} className="inline mr-1" />Riepilogo</button>
            <button onClick={() => setFilter('tab', 'canali')} className={`px-3 py-1.5 text-sm rounded-lg border ${tab === 'canali' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-300 text-slate-700'}`}><Settings2 size={14} className="inline mr-1" />Canali di incasso</button>
          </div>
        )}
      />

      {tab === 'riepilogo' && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center bg-white border border-slate-200 rounded-lg">
              <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-l-lg" aria-label="Mese precedente"><ChevronLeft size={18} /></button>
              <span className="px-3 text-sm font-semibold text-slate-800 min-w-[140px] text-center">{MESI_IT[ym.m - 1]} {ym.y}</span>
              <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-r-lg" aria-label="Mese successivo"><ChevronRight size={18} /></button>
            </div>
            <select value={outletFilter} onChange={(e) => setFilter('outlet', e.target.value === ALL ? '' : e.target.value)} className="text-sm border border-slate-300 rounded-lg px-2 py-2 bg-white">
              <option value={ALL}>Tutti i punti vendita</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <div className="flex gap-3 text-[11px] text-slate-500 ml-auto">
              <span><i className="inline-block w-3 h-3 rounded bg-emerald-100 border border-emerald-300 mr-1 align-middle" />confermata</span>
              <span><i className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-300 mr-1 align-middle" />bozza</span>
              <span><i className="inline-block w-3 h-3 rounded bg-red-50 border border-red-200 mr-1 align-middle" />mancante</span>
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-slate-500"><Loader2 className="inline animate-spin mr-2" size={18} />Caricamento…</div>
          ) : outletFilter === ALL ? (
            <MatrixView days={days} outlets={visibleOutlets} closingAt={closingAt} statusCls={statusCls} onOpen={(o, d) => setDetail({ outletId: o, date: d })} />
          ) : (
            <OutletSheet
              days={days} outletId={outletFilter} channels={channels.filter((c) => c.outlet_id === outletFilter && c.is_active)}
              closingAt={closingAt} linesByClosing={linesByClosing} attCount={attCount} statusCls={statusCls}
              onOpen={(d) => setDetail({ outletId: outletFilter, date: d })}
            />
          )}
        </>
      )}

      {tab === 'canali' && (
        <ChannelsEditor outlets={outlets} channels={channels} bankAccounts={bankAccounts} companyId={companyId} canManage={canManage} onChanged={load} />
      )}

      {detail && (
        <ClosingDetail
          outletName={outlets.find((o) => o.id === detail.outletId)?.name ?? ''}
          date={detail.date}
          closing={closingAt.get(`${detail.outletId}|${detail.date}`) ?? null}
          channels={channels.filter((c) => c.outlet_id === detail.outletId)}
          lines={linesByClosing}
          attachments={attachments}
          canManage={canManage}
          onClose={() => setDetail(null)}
          onEdit={() => openClosingPage(detail.outletId, detail.date)}
          onReopened={async () => { setDetail(null); await load(); toast({ type: 'success', message: 'Chiusura riaperta' }) }}
        />
      )}
    </div>
  )
}

// ─── Vista giorni × outlet ─────────────────────────────────────────────
function MatrixView({ days, outlets, closingAt, statusCls, onOpen }: {
  days: string[]
  outlets: Array<{ id: string; name: string }>
  closingAt: Map<string, ClosingRow>
  statusCls: (c: ClosingRow | undefined, d: string) => string
  onOpen: (outletId: string, date: string) => void
}) {
  const today = todayIso()
  const colTotal = (oid: string) => days.reduce((s, d) => s + Number(closingAt.get(`${oid}|${d}`)?.total_receipts ?? 0), 0)
  const rowTotal = (d: string) => outlets.reduce((s, o) => s + Number(closingAt.get(`${o.id}|${d}`)?.total_receipts ?? 0), 0)
  return (
    <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left sticky left-0 bg-slate-50">Giorno</th>
            {outlets.map((o) => <th key={o.id} className="px-3 py-2 text-right whitespace-nowrap">{o.name}</th>)}
            <th className="px-3 py-2 text-right">Totale</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d} className={`border-t border-slate-100 ${d === today ? 'bg-blue-50/40' : ''}`}>
              <td className="px-3 py-1.5 sticky left-0 bg-white whitespace-nowrap text-slate-700">{formatDateIt(d, true).replace(/ \d{4}$/, '')}</td>
              {outlets.map((o) => {
                const c = closingAt.get(`${o.id}|${d}`)
                return (
                  <td key={o.id} className="px-1 py-1">
                    <button onClick={() => onOpen(o.id, d)} className={`w-full text-right px-2 py-1 rounded-md font-mono tabular-nums ${statusCls(c, d)} hover:ring-1 hover:ring-blue-400`}>
                      {c ? (c.is_closed_day ? 'chiuso' : formatEuro(Number(c.total_receipts))) : d <= today ? '—' : ''}
                    </button>
                  </td>
                )
              })}
              <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold text-slate-800">{d <= today ? formatEuro(rowTotal(d)) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-50 font-semibold">
          <tr>
            <td className="px-3 py-2 sticky left-0 bg-slate-50">Totale mese</td>
            {outlets.map((o) => <td key={o.id} className="px-3 py-2 text-right font-mono tabular-nums">{formatEuro(colTotal(o.id))}</td>)}
            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatEuro(outlets.reduce((s, o) => s + colTotal(o.id), 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── Vista di un outlet come il foglio Excel ───────────────────────────
function OutletSheet({ days, outletId, channels, closingAt, linesByClosing, attCount, statusCls, onOpen }: {
  days: string[]
  outletId: string
  channels: PaymentChannel[]
  closingAt: Map<string, ClosingRow>
  linesByClosing: Map<string, Map<string, number>>
  attCount: Map<string, number>
  statusCls: (c: ClosingRow | undefined, d: string) => string
  onOpen: (date: string) => void
}) {
  const today = todayIso()
  const sum = (pick: (c: ClosingRow) => number) => days.reduce((s, d) => { const c = closingAt.get(`${outletId}|${d}`); return s + (c ? pick(c) : 0) }, 0)
  const sumCh = (chId: string) => days.reduce((s, d) => { const c = closingAt.get(`${outletId}|${d}`); return s + (c ? linesByClosing.get(c.id)?.get(chId) ?? 0 : 0) }, 0)
  const num = (n: number | null | undefined) => (n == null ? '' : formatEuro(Number(n)))
  return (
    <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left sticky left-0 bg-slate-50">Data</th>
            <th className="px-3 py-2 text-right">Totale corrispettivi</th>
            {channels.map((ch) => <th key={ch.id} className="px-3 py-2 text-right whitespace-nowrap">{ch.label}</th>)}
            <th className="px-3 py-2 text-right">Spese cassa</th>
            <th className="px-3 py-2 text-right">Versamenti</th>
            <th className="px-3 py-2 text-right">Fondo cassa</th>
            <th className="px-3 py-2 text-right">Diff. cassa</th>
            <th className="px-3 py-2 text-center">Foto</th>
            <th className="px-3 py-2 text-left">Stato</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const c = closingAt.get(`${outletId}|${d}`)
            const lm = c ? linesByClosing.get(c.id) : undefined
            return (
              <tr key={d} className={`border-t border-slate-100 cursor-pointer hover:bg-blue-50/40 ${statusCls(c, d)}`} onClick={() => onOpen(d)}>
                <td className="px-3 py-1.5 sticky left-0 bg-inherit whitespace-nowrap">{formatDateIt(d, true).replace(/ \d{4}$/, '')}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold">{c ? (c.is_closed_day ? 'chiuso' : num(c.total_receipts)) : d <= today ? '—' : ''}</td>
                {channels.map((ch) => <td key={ch.id} className="px-3 py-1.5 text-right font-mono tabular-nums">{lm ? num(lm.get(ch.id) ?? 0) : ''}</td>)}
                <td className="px-3 py-1.5 text-right font-mono tabular-nums" title={c?.cash_expenses_note ?? ''}>{c ? num(c.cash_expenses) : ''}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums" title={c?.cash_deposit_note ?? ''}>{c ? num(c.cash_deposit) : ''}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{c ? num(c.cash_float_declared) : ''}</td>
                <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${c && Number(c.cash_difference) !== 0 ? 'text-red-700 font-semibold' : ''}`}>{c ? num(c.cash_difference) : ''}</td>
                <td className="px-3 py-1.5 text-center">{c ? (attCount.get(c.id) ?? 0) : ''}</td>
                <td className="px-3 py-1.5 text-xs">{c ? (c.is_closed_day ? 'Negozio chiuso' : CLOSING_STATUS_LABELS[c.status as keyof typeof CLOSING_STATUS_LABELS]) : d < today ? 'Mancante' : ''}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="bg-slate-50 font-semibold">
          <tr>
            <td className="px-3 py-2 sticky left-0 bg-slate-50">Totale mese</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatEuro(sum((c) => Number(c.total_receipts)))}</td>
            {channels.map((ch) => <td key={ch.id} className="px-3 py-2 text-right font-mono tabular-nums">{formatEuro(sumCh(ch.id))}</td>)}
            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatEuro(sum((c) => Number(c.cash_expenses)))}</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatEuro(sum((c) => Number(c.cash_deposit)))}</td>
            <td colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── Dettaglio di una giornata ─────────────────────────────────────────
function ClosingDetail({ outletName, date, closing, channels, lines, attachments, canManage, onClose, onEdit, onReopened }: {
  outletName: string
  date: string
  closing: ClosingRow | null
  channels: PaymentChannel[]
  lines: Map<string, Map<string, number>>
  attachments: AttachmentLite[]
  canManage: boolean
  onClose: () => void
  onEdit: () => void
  onReopened: () => Promise<void>
}) {
  const { toast } = useToast()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const atts = closing ? attachments.filter((a) => a.closing_id === closing.id) : []

  useEffect(() => {
    if (atts.length === 0) { setUrls({}); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(atts.map((a) => a.storage_path), 3600)
      if (cancelled || !data) return
      const map: Record<string, string> = {}
      data.forEach((d, i) => { if (d.signedUrl) map[atts[i].storage_path] = d.signedUrl })
      setUrls(map)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing?.id, attachments.length])

  const reopen = async () => {
    if (!closing) return
    setBusy(true)
    const { error } = await supabase.rpc('reopen_cash_closing', { p_closing_id: closing.id, p_reason: reason || undefined })
    setBusy(false)
    if (error) { toast({ type: 'error', message: error.message }); return }
    await onReopened()
  }

  const lm = closing ? lines.get(closing.id) : undefined
  const row = (label: string, value: string, strong = false) => (
    <div className="flex justify-between py-1 border-b border-slate-100 text-sm"><span className="text-slate-600">{label}</span><span className={`font-mono tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</span></div>
  )

  return (
    <Modal open onClose={onClose} title={`${outletName} · ${formatDateIt(date, true)}`} maxWidthClass="max-w-2xl">
      {!closing ? (
        <div className="text-sm text-slate-600">
          <p>Nessuna chiusura registrata per questo giorno.</p>
          <button onClick={onEdit} className="mt-3 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium inline-flex items-center gap-1"><Pencil size={14} />Compila la chiusura</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded-full ${closing.status === 'bozza' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {closing.is_closed_day ? 'Negozio chiuso' : CLOSING_STATUS_LABELS[closing.status as keyof typeof CLOSING_STATUS_LABELS]}
            </span>
            {closing.closed_by_name && <span className="text-slate-500">chiusa da {closing.closed_by_name}</span>}
            {closing.confirmed_at && <span className="text-slate-500">confermata il {new Date(closing.confirmed_at).toLocaleString('it-IT')}</span>}
            {closing.reopen_reason && <span className="text-amber-700">riaperta: {closing.reopen_reason}</span>}
          </div>
          {!closing.is_closed_day && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              <div>
                {row('Totale corrispettivi', formatEuro(Number(closing.total_receipts)), true)}
                {channels.map((ch) => <div key={ch.id}>{row(ch.label, formatEuro(lm?.get(ch.id) ?? 0))}</div>)}
                {row('Somma canali', formatEuro(Number(closing.channels_total)))}
                {row('Differenza', formatEuro(Number(closing.receipts_difference)), Number(closing.receipts_difference) !== 0)}
              </div>
              <div>
                {row(`Spese cassa${closing.cash_expenses_note ? ` (${closing.cash_expenses_note})` : ''}`, formatEuro(Number(closing.cash_expenses)))}
                {row(`Versamento${closing.cash_deposit_note ? ` (${closing.cash_deposit_note})` : ''}`, formatEuro(Number(closing.cash_deposit)))}
                {row('Fondo cassa atteso', closing.cash_float_expected == null ? '—' : formatEuro(Number(closing.cash_float_expected)))}
                {row('Fondo cassa contato', closing.cash_float_declared == null ? '—' : formatEuro(Number(closing.cash_float_declared)))}
                {row('Differenza di cassa', closing.cash_difference == null ? '—' : formatEuro(Number(closing.cash_difference)), Number(closing.cash_difference) !== 0)}
              </div>
            </div>
          )}
          {closing.notes && <div className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"><span className="text-slate-500">Note: </span>{closing.notes}</div>}
          <div>
            <div className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1"><ImageIcon size={14} />Foto ({atts.length})</div>
            {atts.length === 0 ? <p className="text-xs text-slate-500">Nessuna foto allegata.</p> : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {atts.map((a) => (
                  <a key={a.id} href={urls[a.storage_path]} target="_blank" rel="noreferrer" className="block">
                    {urls[a.storage_path] ? <img src={urls[a.storage_path]} alt={ATTACHMENT_KIND_LABELS[a.kind as AttachmentKind] ?? ''} className="w-full h-28 object-cover rounded-lg border border-slate-200" /> : <div className="h-28 bg-slate-100 rounded-lg" />}
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">{ATTACHMENT_KIND_LABELS[a.kind as AttachmentKind] ?? a.kind}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
            {closing.status === 'bozza' ? (
              <button onClick={onEdit} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium inline-flex items-center gap-1"><Pencil size={14} />Apri per modificare</button>
            ) : canManage && (
              <>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo riapertura" className="flex-1 min-w-[160px] text-sm border border-slate-300 rounded-lg px-3 py-2" />
                <button onClick={() => void reopen()} disabled={busy} className="px-4 py-2 text-sm rounded-lg border border-amber-300 bg-amber-50 text-amber-800 font-medium inline-flex items-center gap-1 disabled:opacity-60">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}Riapri
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── Configurazione canali per outlet ──────────────────────────────────
interface ChannelDraft {
  id?: string
  outlet_id: string
  label: string
  kind: ChannelKind
  bank_account_id: string
  terminal_code: string
  pos_terminal_id: string
  counts_in_total: boolean
  sort_order: number
  is_active: boolean
}

function ChannelsEditor({ outlets, channels, bankAccounts, companyId, canManage, onChanged }: {
  outlets: Array<{ id: string; name: string }>
  channels: PaymentChannel[]
  bankAccounts: BankAccountLite[]
  companyId: string | null
  canManage: boolean
  onChanged: () => Promise<void>
}) {
  const { toast } = useToast()
  const [drafts, setDrafts] = useState<Record<string, ChannelDraft>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const toDraft = (c: PaymentChannel): ChannelDraft => ({
    id: c.id, outlet_id: c.outlet_id, label: c.label, kind: c.kind, bank_account_id: c.bank_account_id ?? '',
    terminal_code: c.terminal_code ?? '', pos_terminal_id: c.pos_terminal_id ?? '', counts_in_total: c.counts_in_total,
    sort_order: c.sort_order, is_active: c.is_active,
  })
  const key = (d: ChannelDraft) => d.id ?? `new-${d.outlet_id}-${d.sort_order}`
  const draftOf = (c: PaymentChannel) => drafts[c.id] ?? toDraft(c)
  const setDraft = (k: string, patch: Partial<ChannelDraft>, base: ChannelDraft) => setDrafts((m) => ({ ...m, [k]: { ...(m[k] ?? base), ...patch } }))

  const save = async (k: string, d: ChannelDraft) => {
    if (!companyId) return
    if (!d.label.trim()) { toast({ type: 'warning', message: 'Serve un nome per il canale' }); return }
    setBusy(k)
    const payload = {
      company_id: companyId, outlet_id: d.outlet_id, label: d.label.trim(), kind: d.kind,
      bank_account_id: d.bank_account_id || null, terminal_code: d.terminal_code.trim() || null,
      pos_terminal_id: d.pos_terminal_id.trim() || null, counts_in_total: d.counts_in_total,
      sort_order: d.sort_order, is_active: d.is_active, updated_at: new Date().toISOString(),
    }
    const { error } = d.id
      ? await supabase.from('outlet_payment_channels').update(payload).eq('id', d.id)
      : await supabase.from('outlet_payment_channels').insert(payload)
    setBusy(null)
    if (error) { toast({ type: 'error', message: error.message }); return }
    setDrafts((m) => { const n = { ...m }; delete n[k]; return n })
    await onChanged()
    toast({ type: 'success', message: 'Canale salvato' })
  }

  const createDefaults = async (outletId: string) => {
    if (!companyId) return
    setBusy(`def-${outletId}`)
    const { error } = await supabase.from('outlet_payment_channels').insert(DEFAULT_CHANNELS.map((c) => ({ ...c, company_id: companyId, outlet_id: outletId })))
    setBusy(null)
    if (error) { toast({ type: 'error', message: error.message }); return }
    await onChanged()
    toast({ type: 'success', message: 'Canali standard creati: rinominali e aggiungi i POS della banca' })
  }

  const addNew = (outletId: string) => {
    const existing = channels.filter((c) => c.outlet_id === outletId)
    const d: ChannelDraft = { outlet_id: outletId, label: '', kind: 'pos', bank_account_id: '', terminal_code: '', pos_terminal_id: '', counts_in_total: true, sort_order: existing.length + 1, is_active: true }
    setDrafts((m) => ({ ...m, [key(d)]: d }))
  }

  const inp = 'w-full text-sm border border-slate-300 rounded-md px-2 py-1 disabled:bg-slate-50'

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 max-w-3xl">
        I canali sono le colonne che la cassiera compila ogni sera (contanti, POS per banca, pay by link, fatture, bonifico…).
        Il <strong>codice terminale</strong> (es. COD.SIA <code>6181087-00002</code> nella causale dell'accredito) e l'<strong>ID terminale POS</strong> (TML sulla chiusura POS)
        servono alla verifica automatica con la banca. Un canale non più usato si disattiva, non si cancella.
      </p>
      {outlets.map((o) => {
        const list = channels.filter((c) => c.outlet_id === o.id).sort((a, b) => a.sort_order - b.sort_order)
        const news = Object.values(drafts).filter((d) => !d.id && d.outlet_id === o.id)
        return (
          <div key={o.id} className="bg-white border border-slate-200 rounded-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">{o.name}</h3>
              {canManage && (
                <div className="flex gap-2">
                  {list.length === 0 && (
                    <button onClick={() => void createDefaults(o.id)} disabled={busy === `def-${o.id}`} className="text-xs px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 bg-blue-50 font-medium">Crea canali standard</button>
                  )}
                  <button onClick={() => addNew(o.id)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 inline-flex items-center gap-1"><Plus size={12} />Aggiungi canale</button>
                </div>
              )}
            </div>
            {list.length === 0 && news.length === 0 ? (
              <div className="px-4 py-4 text-sm text-slate-500">Nessun canale configurato: la cassiera non può ancora compilare la chiusura di questo punto vendita.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left">Ordine</th>
                      <th className="px-3 py-2 text-left">Nome</th>
                      <th className="px-3 py-2 text-left">Tipo</th>
                      <th className="px-3 py-2 text-left">Conto di accredito</th>
                      <th className="px-3 py-2 text-left">Codice terminale (banca)</th>
                      <th className="px-3 py-2 text-left">ID terminale POS</th>
                      <th className="px-3 py-2 text-center">Nel totale</th>
                      <th className="px-3 py-2 text-center">Attivo</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {[...list.map(draftOf), ...news].map((d) => {
                      const k = key(d)
                      const changed = !!drafts[k]
                      const set = (patch: Partial<ChannelDraft>) => setDraft(k, patch, d)
                      return (
                        <tr key={k} className={`border-t border-slate-100 ${d.is_active ? '' : 'opacity-60'}`}>
                          <td className="px-3 py-1.5 w-16"><input type="number" value={d.sort_order} disabled={!canManage} onChange={(e) => set({ sort_order: Number(e.target.value) })} className={inp} /></td>
                          <td className="px-3 py-1.5 min-w-[140px]"><input value={d.label} disabled={!canManage} onChange={(e) => set({ label: e.target.value })} placeholder="es. POS MPS" className={inp} /></td>
                          <td className="px-3 py-1.5">
                            <select value={d.kind} disabled={!canManage} onChange={(e) => set({ kind: e.target.value as ChannelKind })} className={inp}>
                              {(Object.keys(CHANNEL_KIND_LABELS) as ChannelKind[]).map((kk) => <option key={kk} value={kk}>{CHANNEL_KIND_LABELS[kk]}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 min-w-[160px]">
                            <select value={d.bank_account_id} disabled={!canManage || d.kind === 'contanti'} onChange={(e) => set({ bank_account_id: e.target.value })} className={inp}>
                              <option value="">—</option>
                              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.bank_name ?? ''} {b.account_name ? `(${b.account_name.slice(-6)})` : ''}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-1.5"><input value={d.terminal_code} disabled={!canManage} onChange={(e) => set({ terminal_code: e.target.value })} placeholder="6181087-00002" className={`${inp} font-mono`} /></td>
                          <td className="px-3 py-1.5"><input value={d.pos_terminal_id} disabled={!canManage} onChange={(e) => set({ pos_terminal_id: e.target.value })} placeholder="40092505" className={`${inp} font-mono`} /></td>
                          <td className="px-3 py-1.5 text-center"><input type="checkbox" checked={d.counts_in_total} disabled={!canManage} onChange={(e) => set({ counts_in_total: e.target.checked })} /></td>
                          <td className="px-3 py-1.5 text-center"><input type="checkbox" checked={d.is_active} disabled={!canManage} onChange={(e) => set({ is_active: e.target.checked })} /></td>
                          <td className="px-3 py-1.5 text-right">
                            {canManage && changed && (
                              <button onClick={() => void save(k, d)} disabled={busy === k} className="text-xs px-3 py-1 rounded-lg bg-blue-600 text-white font-medium inline-flex items-center gap-1 disabled:opacity-60">
                                {busy === k ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}Salva
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
