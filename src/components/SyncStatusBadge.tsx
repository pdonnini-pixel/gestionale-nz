// SyncStatusBadge — pallino di stato "ultimo aggiornamento" per un feed.
//
// Legge l'ULTIMA riga di public.sync_runs per il feed (RLS la limita all'azienda
// dell'utente) e mostra lo stato secondo le soglie definite in lib/syncFeeds.
// Stessa fonte della pagina Report → pallino e report sono sempre coerenti.
//
// Niente verde: Aggiornato=neutro, In ritardo=arancio #ea580c, Fermo/errore=rosso.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Tooltip from './Tooltip'
import {
  type SyncFeed, type SyncRun, computeSyncState, SYNC_TONE_CLASSES,
} from '../lib/syncFeeds'

interface Props {
  feed: SyncFeed
  /** cambia per forzare il refresh (es. dopo una sync manuale) */
  refreshKey?: number
  className?: string
}

export default function SyncStatusBadge({ feed, refreshKey = 0, className = '' }: Props) {
  const [last, setLast] = useState<SyncRun | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase
      .from('sync_runs')
      .select('id, company_id, feed, origine, period_from, period_to, status, items_downloaded, error_message, duration_ms, run_at')
      .eq('feed', feed)
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle() as unknown as Promise<{ data: SyncRun | null }>)
    setLast(data ?? null)
    setLoading(false)
  }, [feed])

  useEffect(() => { load() }, [load, refreshKey])

  if (loading) {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-slate-200 bg-slate-50 text-slate-400 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-pulse" />
        Stato sync…
      </span>
    )
  }

  const state = computeSyncState(last, feed)
  const tone = SYNC_TONE_CLASSES[state.tone]
  const tip = state.error ? `${state.detail}\n\nDettaglio: ${state.error}` : state.detail

  return (
    <Tooltip content={tip}>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${tone.chip} ${className}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
        <span className="hidden sm:inline">{state.detail}</span>
        <span className="sm:hidden">{state.label}</span>
      </span>
    </Tooltip>
  )
}
