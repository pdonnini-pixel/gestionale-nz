// syncFeeds — configurazione UNICA dei feed di sincronizzazione e delle soglie
// del watchdog. Modificare QUI le soglie (nessun valore hardcoded nei componenti).
//
// Logica watchdog (regola di casa, niente verde):
//   - "Aggiornato"  → neutro/nero : ultima run riuscita entro la soglia ok
//   - "In ritardo"  → arancio #ea580c : oltre soglia ok ma entro warn, o run parziale
//   - "Fermo/errore"→ rosso : ultima run fallita, o nessuna run da troppo
//   - "Nessuna run" → grigio : feed mai eseguito (empty-state esplicativo)
//
// Si misura l'ULTIMA RUN (riuscita o meno), non l'ultima fattura: una run ok con
// items=0 (giorno senza documenti nuovi) è "Aggiornato", non un errore.

export type SyncFeed = 'banche' | 'fatture_passive' | 'corrispettivi' | 'cassetto_fiscale'
export type SyncOrigin = 'auto_cron' | 'manuale'
export type SyncRunStatus = 'ok' | 'parziale' | 'errore' | 'vuoto'

export interface SyncRun {
  id: string
  company_id: string
  feed: SyncFeed
  origine: SyncOrigin
  period_from: string | null
  period_to: string | null
  status: SyncRunStatus
  items_downloaded: number
  error_message: string | null
  duration_ms: number | null
  run_at: string
}

// Dettaglio "cosa scarico" per singola fonte/documento di una run.
//   banche          → una riga per banca (items_count = movimenti, amount = saldo)
//   fatture_passive → una riga per fattura (counterparty = fornitore, amount = importo)
export interface SyncRunDetail {
  id: string
  sync_run_id: string
  company_id: string
  feed: SyncFeed
  detail_type: string
  label: string
  reference: string | null
  counterparty: string | null
  doc_date: string | null
  items_count: number
  amount: number | null
  currency: string | null
  error_message: string | null
  extra: { accounts?: number } | null
  created_at: string
}

interface FeedMeta {
  key: SyncFeed
  label: string
  /** descrizione per empty-state / tooltip, senza gergo */
  blurb: string
  /** soglie in ORE sull'età dell'ultima run riuscita */
  okMaxH: number    // entro questa → Aggiornato (neutro)
  warnMaxH: number  // entro questa → In ritardo (arancio); oltre → Fermo (rosso)
}

// I feed su cron 6h (banche/fatture/corrispettivi): ok <12h, arancio 12–24h, rosso >24h.
// Cassetto (1×/giorno): ok <30h, arancio 30–48h, rosso >48h.
export const SYNC_FEEDS: Record<SyncFeed, FeedMeta> = {
  banche: {
    key: 'banche',
    label: 'Banche',
    blurb: 'Saldi e movimenti dai conti via Open Banking A-Cube. Aggiornamento automatico ogni 6 ore.',
    okMaxH: 12, warnMaxH: 24,
  },
  fatture_passive: {
    key: 'fatture_passive',
    label: 'Fatture passive',
    blurb: 'Fatture dei fornitori ricevute via SDI (A-Cube). Aggiornamento automatico ogni 6 ore.',
    okMaxH: 12, warnMaxH: 24,
  },
  corrispettivi: {
    key: 'corrispettivi',
    label: 'Corrispettivi',
    blurb: 'Corrispettivi telematici. Canale di sincronizzazione non ancora attivo.',
    okMaxH: 12, warnMaxH: 24,
  },
  cassetto_fiscale: {
    key: 'cassetto_fiscale',
    label: 'Cassetto Fiscale',
    blurb: 'Documenti dal Cassetto Fiscale dell’Agenzia delle Entrate (via A-Cube). Aggiornamento giornaliero.',
    okMaxH: 30, warnMaxH: 48,
  },
}

export const SYNC_FEED_ORDER: SyncFeed[] = ['banche', 'fatture_passive', 'corrispettivi', 'cassetto_fiscale']

export type SyncTone = 'neutral' | 'amber' | 'red' | 'gray'

export interface SyncState {
  tone: SyncTone
  /** etichetta breve di stato */
  label: string
  /** dettaglio leggibile (data/ora o spiegazione) */
  detail: string
  /** testo errore integrale, se presente (per tooltip) */
  error: string | null
  ageHours: number | null
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtAge(hours: number): string {
  if (hours < 1) return 'meno di un’ora fa'
  if (hours < 24) return `${Math.floor(hours)} ore fa`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 giorno fa' : `${days} giorni fa`
}

/**
 * Stato sintetico del feed a partire dall'ULTIMA riga sync_runs (o null).
 * Stessa fonte usata dalla pagina Report → pallino e report sempre coerenti.
 */
export function computeSyncState(last: SyncRun | null, feed: SyncFeed, now: Date = new Date()): SyncState {
  const meta = SYNC_FEEDS[feed]
  if (!last) {
    return {
      tone: 'gray',
      label: 'Nessuna sincronizzazione',
      detail: meta.blurb,
      error: null,
      ageHours: null,
    }
  }
  const ageH = (now.getTime() - new Date(last.run_at).getTime()) / 3_600_000
  const when = fmtDateTime(last.run_at)

  if (last.status === 'errore') {
    return { tone: 'red', label: 'Errore', detail: `Ultima sincronizzazione fallita (${when})`, error: last.error_message, ageHours: ageH }
  }
  if (last.status === 'parziale') {
    return { tone: 'amber', label: 'Parziale', detail: `Completata con avvisi (${when})`, error: last.error_message, ageHours: ageH }
  }
  // ok / vuoto → valutazione per età
  if (ageH <= meta.okMaxH) {
    return { tone: 'neutral', label: 'Aggiornato', detail: `Dati aggiornati al ${when}`, error: null, ageHours: ageH }
  }
  if (ageH <= meta.warnMaxH) {
    return { tone: 'amber', label: 'In ritardo', detail: `Ultimo aggiornamento ${when} (${fmtAge(ageH)})`, error: null, ageHours: ageH }
  }
  return { tone: 'red', label: 'Fermo', detail: `Nessun aggiornamento da ${fmtAge(ageH)} (ultimo: ${when})`, error: null, ageHours: ageH }
}

// Classi Tailwind per tono (coerenti con regola colori di casa).
export const SYNC_TONE_CLASSES: Record<SyncTone, { dot: string; text: string; chip: string }> = {
  neutral: { dot: 'bg-slate-800', text: 'text-slate-700', chip: 'bg-slate-100 text-slate-700 border-slate-200' },
  amber:   { dot: 'bg-[#ea580c]', text: 'text-[#ea580c]', chip: 'bg-orange-50 text-[#ea580c] border-orange-200' },
  red:     { dot: 'bg-red-600',   text: 'text-red-700',   chip: 'bg-red-50 text-red-700 border-red-200' },
  gray:    { dot: 'bg-slate-300', text: 'text-slate-400', chip: 'bg-slate-50 text-slate-400 border-slate-200' },
}

export const SYNC_STATUS_LABEL: Record<SyncRunStatus, string> = {
  ok: 'OK', parziale: 'Parziale', errore: 'Errore', vuoto: 'Vuoto',
}
export const SYNC_STATUS_TONE: Record<SyncRunStatus, SyncTone> = {
  ok: 'neutral', parziale: 'amber', errore: 'red', vuoto: 'gray',
}
export const SYNC_ORIGIN_LABEL: Record<SyncOrigin, string> = {
  auto_cron: 'Automatica', manuale: 'Manuale',
}
