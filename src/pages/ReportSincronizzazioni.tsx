// Report Sincronizzazioni — storico osservabilità di tutti i feed dati.
//
// Una riga per run (dalla più recente). In alto, riepilogo "ultimo aggiornamento
// per feed" (vista ridotta, senza gergo, per chiunque). La colonna Errore è
// visibile solo ai ruoli consulente (super_advisor/cfo/contabile).
//
// Fonte unica: public.sync_runs (stessa del pallino SyncStatusBadge) → coerenza.

import { Fragment, useEffect, useMemo, useState, useCallback } from 'react'
import PageHeader from '../components/PageHeader'
import Tooltip from '../components/Tooltip'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  RefreshCw, Filter, X, Inbox, Landmark, FileText, Store, Receipt, AlertCircle,
  ChevronRight, ChevronDown,
} from 'lucide-react'
import {
  type SyncFeed, type SyncRun, type SyncRunDetail, SYNC_FEEDS, SYNC_FEED_ORDER,
  computeSyncState, SYNC_TONE_CLASSES, SYNC_STATUS_LABEL, SYNC_STATUS_TONE,
  SYNC_ORIGIN_LABEL, fmtDateTime,
} from '../lib/syncFeeds'

const FEED_ICON: Record<SyncFeed, typeof Inbox> = {
  banche: Landmark,
  fatture_passive: FileText,
  corrispettivi: Store,
  cassetto_fiscale: Receipt,
}

// Ruoli "consulente" che vedono il dettaglio tecnico dell'errore.
const CONSULTANT_ROLES = ['super_advisor', 'cfo', 'contabile']

const fmtPeriod = (from: string | null, to: string | null): string => {
  if (!from && !to) return '—'
  const f = from ? new Date(from).toLocaleDateString('it-IT') : '…'
  const t = to ? new Date(to).toLocaleDateString('it-IT') : '…'
  return `${f} → ${t}`
}

const fmtEur = (n: number | null): string => {
  if (n == null) return '—'
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
}

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('it-IT') : '—'

// Singolo movimento bancario scaricato in una run (per l'espansione banche).
interface RunMovement {
  id: string
  transaction_date: string
  amount: number
  description: string | null
  currency: string | null
  bank_account_id: string | null
}

// Sotto-tabella "cosa è stato scaricato" per una run espansa.
function RunDetails({ feed, details, movements, movementsTotal, bankNames, loading, showErrors }: {
  feed: SyncFeed
  details: SyncRunDetail[] | undefined
  movements: RunMovement[] | undefined
  movementsTotal: number
  bankNames: Record<string, string>
  loading: boolean
  showErrors: boolean
}) {
  if (loading) {
    return <div className="px-6 py-4 text-sm text-slate-400">Caricamento dettaglio…</div>
  }
  if (!details || details.length === 0) {
    return (
      <div className="px-6 py-4 text-sm text-slate-400">
        Nessun dettaglio registrato per questa sincronizzazione.
      </div>
    )
  }

  if (feed === 'fatture_passive') {
    return (
      <div className="px-6 py-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-200">
              <th className="py-1.5 pr-4 font-medium">Numero</th>
              <th className="py-1.5 pr-4 font-medium">Fornitore</th>
              <th className="py-1.5 pr-4 font-medium">Data</th>
              <th className="py-1.5 pr-4 font-medium text-right">Importo</th>
            </tr>
          </thead>
          <tbody>
            {details.map((d) => (
              <tr key={d.id} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5 pr-4 text-slate-700 whitespace-nowrap">{d.label}</td>
                <td className="py-1.5 pr-4 text-slate-600">{d.counterparty ?? '—'}</td>
                <td className="py-1.5 pr-4 text-slate-500 whitespace-nowrap">{fmtDate(d.doc_date)}</td>
                <td className="py-1.5 pr-4 text-slate-700 text-right tabular-nums whitespace-nowrap">{fmtEur(d.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // banche (e fallback): riepilogo per banca + elenco dei singoli movimenti
  return (
    <div className="px-6 py-3 space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Per banca</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-200">
              <th className="py-1.5 pr-4 font-medium">Banca</th>
              <th className="py-1.5 pr-4 font-medium text-right">Conti</th>
              <th className="py-1.5 pr-4 font-medium text-right">Movimenti scaricati</th>
              <th className="py-1.5 pr-4 font-medium text-right">Saldo</th>
              {showErrors && <th className="py-1.5 pr-4 font-medium">Errore</th>}
            </tr>
          </thead>
          <tbody>
            {details.map((d) => (
              <tr key={d.id} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5 pr-4 text-slate-700">{d.label}</td>
                <td className="py-1.5 pr-4 text-slate-500 text-right tabular-nums">{d.extra?.accounts ?? '—'}</td>
                <td className="py-1.5 pr-4 text-slate-700 text-right tabular-nums">{d.items_count}</td>
                <td className="py-1.5 pr-4 text-slate-700 text-right tabular-nums whitespace-nowrap">{fmtEur(d.amount)}</td>
                {showErrors && (
                  <td className="py-1.5 pr-4 text-red-700">{d.error_message ?? <span className="text-slate-300">—</span>}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {movements && movements.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
            Movimenti scaricati {movements.length < movementsTotal
              ? `(primi ${movements.length} di ${movementsTotal})`
              : `(${movements.length})`}
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-200">
                <th className="py-1.5 pr-4 font-medium">Data</th>
                <th className="py-1.5 pr-4 font-medium">Banca</th>
                <th className="py-1.5 pr-4 font-medium">Descrizione</th>
                <th className="py-1.5 pr-4 font-medium text-right">Importo</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-4 text-slate-500 whitespace-nowrap">{fmtDate(m.transaction_date)}</td>
                  <td className="py-1.5 pr-4 text-slate-500 whitespace-nowrap">{(m.bank_account_id && bankNames[m.bank_account_id]) || '—'}</td>
                  <td className="py-1.5 pr-4 text-slate-600 max-w-[380px] truncate">{m.description ?? '—'}</td>
                  <td className={`py-1.5 pr-4 text-right tabular-nums whitespace-nowrap ${m.amount < 0 ? 'text-red-600' : 'text-slate-700'}`}>{fmtEur(m.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function ReportSincronizzazioni() {
  const { profile } = useAuth()
  const showErrors = CONSULTANT_ROLES.includes(profile?.role ?? '')

  const [runs, setRuns] = useState<SyncRun[]>([])
  const [latestByFeed, setLatestByFeed] = useState<Record<string, SyncRun>>({})
  const [loading, setLoading] = useState(true)

  // riga espansa + dettaglio "cosa scarico" (lazy-load per run)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailsByRun, setDetailsByRun] = useState<Record<string, SyncRunDetail[]>>({})
  const [movementsByRun, setMovementsByRun] = useState<Record<string, RunMovement[]>>({})
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  const [bankNames, setBankNames] = useState<Record<string, string>>({})

  // filtri
  const [feedFilter, setFeedFilter] = useState<SyncFeed | 'all'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('sync_runs')
      .select('id, company_id, feed, origine, period_from, period_to, status, items_downloaded, error_message, duration_ms, run_at')
      .order('run_at', { ascending: false })
      .limit(1000)
    if (feedFilter !== 'all') q = q.eq('feed', feedFilter)
    if (dateFrom) q = q.gte('run_at', `${dateFrom}T00:00:00`)
    if (dateTo) q = q.lte('run_at', `${dateTo}T23:59:59`)

    const { data } = await (q as unknown as Promise<{ data: SyncRun[] | null }>)
    const rows = data ?? []
    setRuns(rows)

    // ultimo per feed (sempre globale, non filtrato, per le card riepilogo)
    const { data: allLatest } = await (supabase
      .from('sync_runs')
      .select('id, company_id, feed, origine, period_from, period_to, status, items_downloaded, error_message, duration_ms, run_at')
      .order('run_at', { ascending: false })
      .limit(400) as unknown as Promise<{ data: SyncRun[] | null }>)
    const map: Record<string, SyncRun> = {}
    for (const r of allLatest ?? []) { if (!map[r.feed]) map[r.feed] = r }
    setLatestByFeed(map)
    setLoading(false)
  }, [feedFilter, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  // mappa id conto → nome banca (per la colonna Banca nell'elenco movimenti)
  useEffect(() => {
    (async () => {
      const { data } = await (supabase
        .from('bank_accounts')
        .select('id, bank_name') as unknown as Promise<{ data: { id: string; bank_name: string | null }[] | null }>)
      const map: Record<string, string> = {}
      for (const b of data ?? []) { if (b.bank_name) map[b.id] = b.bank_name }
      setBankNames(map)
    })()
  }, [])

  // scarta la cache dei dettagli quando cambiano i filtri (le run cambiano)
  useEffect(() => { setExpandedId(null); setDetailsByRun({}); setMovementsByRun({}) }, [feedFilter, dateFrom, dateTo])

  const toggleExpand = useCallback(async (run: SyncRun) => {
    if (expandedId === run.id) { setExpandedId(null); return }
    setExpandedId(run.id)
    if (detailsByRun[run.id]) return  // già in cache
    setDetailLoading(run.id)
    const { data } = await (supabase
      .from('sync_run_details')
      .select('id, sync_run_id, company_id, feed, detail_type, label, reference, counterparty, doc_date, items_count, amount, currency, error_message, extra, created_at')
      .eq('sync_run_id', run.id)
      .order('created_at', { ascending: true }) as unknown as Promise<{ data: SyncRunDetail[] | null }>)
    setDetailsByRun((prev) => ({ ...prev, [run.id]: data ?? [] }))

    // per le banche, carica anche l'elenco dei singoli movimenti scaricati
    if (run.feed === 'banche') {
      const { data: mv } = await (supabase
        .from('bank_transactions')
        .select('id, transaction_date, amount, description, currency, bank_account_id')
        .eq('sync_run_id', run.id)
        .order('transaction_date', { ascending: false })
        .limit(500) as unknown as Promise<{ data: RunMovement[] | null }>)
      setMovementsByRun((prev) => ({ ...prev, [run.id]: mv ?? [] }))
    }
    setDetailLoading(null)
  }, [expandedId, detailsByRun])

  const hasFilters = feedFilter !== 'all' || !!dateFrom || !!dateTo
  const clearFilters = () => { setFeedFilter('all'); setDateFrom(''); setDateTo('') }

  const colSpan = showErrors ? 8 : 7

  const summaryCards = useMemo(() => SYNC_FEED_ORDER.map((feed) => {
    const last = latestByFeed[feed] ?? null
    const state = computeSyncState(last, feed)
    return { feed, last, state }
  }), [latestByFeed])

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Report Sincronizzazioni"
        subtitle="Stato e storico degli aggiornamenti automatici dei dati (banche, fatture, cassetto fiscale)"
        actions={
          <button onClick={load} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition shadow-sm">
            <RefreshCw size={14} /> Aggiorna
          </button>
        }
      />

      {/* Riepilogo "ultimo aggiornamento per feed" — vista ridotta per tutti */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {summaryCards.map(({ feed, last, state }) => {
          const Icon = FEED_ICON[feed]
          const tone = SYNC_TONE_CLASSES[state.tone]
          const tip = state.error ? `${state.detail}\n\nDettaglio: ${state.error}` : state.detail
          return (
            <Tooltip key={feed} content={tip}>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 bg-slate-50 rounded-lg"><Icon size={16} className="text-slate-500" /></div>
                  <span className="text-sm font-semibold text-slate-800">{SYNC_FEEDS[feed].label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
                  <span className={`text-xs font-medium ${tone.text}`}>{state.label}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{state.detail}</p>
              </div>
            </Tooltip>
          )
        })}
      </div>

      {/* Filtri */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-slate-500 text-sm font-medium mr-1">
          <Filter size={15} /> Filtri
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Feed</span>
          <select value={feedFilter} onChange={(e) => setFeedFilter(e.target.value as SyncFeed | 'all')}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
            <option value="all">Tutti i feed</option>
            {SYNC_FEED_ORDER.map((f) => <option key={f} value={f}>{SYNC_FEEDS[f].label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Dal</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Al</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white" />
        </label>
        {hasFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-slate-700">
            <X size={14} /> Azzera
          </button>
        )}
      </div>

      {/* Tabella run */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-2 py-3 w-8" />
                <th className="px-4 py-3">Data e ora</th>
                <th className="px-4 py-3">Feed</th>
                <th className="px-4 py-3">Origine</th>
                <th className="px-4 py-3">Periodo</th>
                <th className="px-4 py-3">Esito</th>
                <th className="px-4 py-3 text-right">Scaricati</th>
                {showErrors && <th className="px-4 py-3">Errore</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">Caricamento…</td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={colSpan} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <Inbox size={28} />
                    <p className="text-sm font-medium text-slate-500">Nessuna sincronizzazione registrata{hasFilters ? ' con questi filtri' : ''}.</p>
                    <p className="text-xs">{hasFilters ? 'Prova ad allargare il periodo o azzerare i filtri.' : 'Gli aggiornamenti automatici compaiono qui dopo la prima esecuzione (ogni 6 ore).'}</p>
                  </div>
                </td></tr>
              ) : runs.map((r) => {
                const stTone = SYNC_TONE_CLASSES[SYNC_STATUS_TONE[r.status]]
                const isOpen = expandedId === r.id
                const canExpand = r.items_downloaded > 0
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => canExpand && toggleExpand(r)}
                      className={`border-b border-slate-100 ${canExpand ? 'cursor-pointer hover:bg-slate-50/60' : ''} ${isOpen ? 'bg-slate-50/60' : ''}`}
                    >
                      <td className="px-2 py-3 text-slate-400">
                        {canExpand
                          ? (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />)
                          : null}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">{fmtDateTime(r.run_at)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">{SYNC_FEEDS[r.feed]?.label ?? r.feed}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">{SYNC_ORIGIN_LABEL[r.origine]}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">{fmtPeriod(r.period_from, r.period_to)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${stTone.chip}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${stTone.dot}`} />
                          {SYNC_STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{r.items_downloaded}</td>
                      {showErrors && (
                        <td className="px-4 py-3 max-w-[320px]">
                          {r.error_message ? (
                            <Tooltip content={r.error_message}>
                              <span className="inline-flex items-center gap-1 text-xs text-red-700 truncate max-w-[300px]">
                                <AlertCircle size={13} className="shrink-0" />
                                <span className="truncate">{r.error_message}</span>
                              </span>
                            </Tooltip>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/40">
                        <td colSpan={colSpan} className="p-0 border-b border-slate-100">
                          <RunDetails
                            feed={r.feed}
                            details={detailsByRun[r.id]}
                            movements={movementsByRun[r.id]}
                            movementsTotal={r.items_downloaded}
                            bankNames={bankNames}
                            loading={detailLoading === r.id}
                            showErrors={showErrors}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Una riga per esecuzione. Una run riuscita con 0 documenti significa che il sistema ha controllato ma non c’erano dati nuovi: è normale, non un errore.
      </p>
    </div>
  )
}
