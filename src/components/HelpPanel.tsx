import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  HelpCircle, X, ChevronRight, ChevronLeft,
  LayoutDashboard, Store, Receipt, Landmark, Users, FileText,
  Calculator, BarChart3, GitCompare, Wallet, Building2,
  CalendarClock, DatabaseZap, Archive, FileCode, Settings,
  Sparkles, Send, Loader2, BookOpen, Package, UserCircle,
  MessageSquare, Lock, Search, CheckCircle2, AlertTriangle,
  LucideIcon,
} from 'lucide-react'
import { PAGE_GUIDES, type PageGuide } from '../data/pageGuides'
import { useAuth } from '../hooks/useAuth'
import {
  fetchOpenSession, createSession, fetchMessages, appendMessage, closeSession,
  fetchSessions, formatChatDate,
  type HelpChatSession, type HelpChatRole,
} from '../lib/helpChat'

// Mappa nome-icona (stringa nel file dati) -> componente lucide.
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Store, Receipt, Landmark, Users, FileText,
  Calculator, BarChart3, GitCompare, Wallet, Building2,
  CalendarClock, DatabaseZap, Archive, FileCode, Settings,
  Sparkles, Package, UserCircle, HelpCircle,
}

const GUIDE_BY_PATH = new Map(PAGE_GUIDES.map((g) => [g.path, g]))

// Risolve la guida a partire dal pathname corrente: prova la corrispondenza
// esatta, poi le rotte con parametri note, infine risale ai percorsi padre.
function resolveGuide(pathname: string): PageGuide | null {
  const path = '/' + pathname.split('/').filter(Boolean).join('/')
  if (path === '/') return GUIDE_BY_PATH.get('/') ?? null
  if (GUIDE_BY_PATH.has(path)) return GUIDE_BY_PATH.get(path)!

  // Rotte con parametri → guida canonica
  if (/^\/fornitori\/[^/]+\/scheda-contabile$/.test(path)) return GUIDE_BY_PATH.get('/fornitori/scheda-contabile') ?? null
  if (path.startsWith('/outlet/valutazione')) return GUIDE_BY_PATH.get('/outlet/valutazione') ?? null
  if (path.startsWith('/outlet')) return GUIDE_BY_PATH.get('/outlet/operativi') ?? null
  if (path.startsWith('/ticket/admin')) return GUIDE_BY_PATH.get('/ticket/admin') ?? null
  if (path.startsWith('/ticket')) return GUIDE_BY_PATH.get('/ticket') ?? null

  // Fallback: risali ai percorsi padre (es. sottopagine non mappate)
  const parts = path.split('/').filter(Boolean)
  for (let i = parts.length - 1; i >= 1; i--) {
    const p = '/' + parts.slice(0, i).join('/')
    if (GUIDE_BY_PATH.has(p)) return GUIDE_BY_PATH.get(p)!
  }
  return null
}

// Costruisce il testo di contesto passato all'edge function help-chat:
// riusa la stessa guida mostrata all'utente, così l'AI resta allineata.
function buildPageContext(guide: PageGuide | null): string {
  if (!guide) return ''
  const parts: string[] = [guide.description]
  if (guide.sections.length > 0) {
    parts.push(
      guide.sections
        .map((s) => {
          const steps = s.steps?.length ? '\n' + s.steps.map((t) => `  - ${t}`).join('\n') : ''
          return `## ${s.heading}\n${s.body}${steps}`
        })
        .join('\n\n'),
    )
  }
  if (guide.faq.length > 0) {
    parts.push('Domande frequenti:\n' + guide.faq.map((f) => `D: ${f.q}\nR: ${f.a}`).join('\n'))
  }
  return parts.join('\n\n')
}

// Titolo leggibile per pagine senza guida (la chat è comunque disponibile).
function titleFromPath(pathname: string): string {
  const path = '/' + pathname.split('/').filter(Boolean).join('/')
  if (path === '/') return 'Dashboard'
  const seg = path.split('/').filter(Boolean).pop() || 'Pagina'
  return seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

type ChatMsg = { role: HelpChatRole; content: string }

// Bolla di conversazione, riusata da chat live e archivio.
function Bubble({ role, content }: ChatMsg) {
  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          role === 'user'
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-slate-100 text-slate-700 rounded-bl-sm'
        }`}
      >
        {content}
      </div>
    </div>
  )
}

function StatoChip({ status }: { status: HelpChatSession['status'] }) {
  return status === 'aperta' ? (
    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      Aperta
    </span>
  ) : (
    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
      Chiusa
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab chat: invoca l'edge function help-chat (proxy verso Claude, chiave nel
// Vault). L'AI risponde solo su come si usa il gestionale, non vede i dati.
//
// La conversazione è PERSISTITA (help_chat_sessions/help_chat_messages): resta
// aperta finché è l'operatrice a chiuderla col pulsante "Chiudi chat". Cambio
// pagina, ricarica o logout non la chiudono: tornando qui si riprende da dove
// si era rimasti.
// ─────────────────────────────────────────────────────────────────────────────
function AssistantChat({ path, pageTitle, pageContext }: { path: string; pageTitle: string; pageContext: string }) {
  const { profile } = useAuth()
  const companyId = (profile?.company_id as string | null) ?? null
  const userId = (profile?.id as string | undefined) ?? null
  const userName = useMemo(() => {
    const nome = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim()
    return nome || (profile?.email as string | null) || null
  }, [profile])

  const [session, setSession] = useState<HelpChatSession | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)        // risposta AI in corso
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveWarning, setSaveWarning] = useState(false) // chat non salvata (rete/RLS)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const isClosed = session?.status === 'chiusa'

  // Carica la chat aperta della sezione (se esiste) e il suo storico.
  useEffect(() => {
    let annullato = false
    async function load() {
      setLoadingHistory(true)
      setError(null)
      setConfirmClose(false)
      if (!companyId || !userId) {
        if (!annullato) { setSession(null); setMessages([]); setLoadingHistory(false) }
        return
      }
      try {
        const s = await fetchOpenSession(companyId, userId, path)
        if (annullato) return
        setSession(s)
        if (s) {
          const msgs = await fetchMessages(s.id)
          if (annullato) return
          setMessages(msgs.map((m) => ({ role: m.role, content: m.content })))
        } else {
          setMessages([])
        }
      } catch (e) {
        console.warn('[help-chat] storico non caricato', e)
        if (!annullato) { setSession(null); setMessages([]); setSaveWarning(true) }
      } finally {
        if (!annullato) setLoadingHistory(false)
      }
    }
    void load()
    return () => { annullato = true }
  }, [companyId, userId, path])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading, loadingHistory])

  async function send(text: string) {
    const question = text.trim()
    if (!question || loading || isClosed) return
    setError(null)
    const next: ChatMsg[] = [...messages, { role: 'user', content: question }]
    setMessages(next)
    setInput('')
    setLoading(true)

    // 1) Salva la domanda (apre la chat della sezione se non c'è ancora).
    let corrente = session
    if (companyId && userId) {
      try {
        if (!corrente) {
          corrente = await createSession({ companyId, userId, userName, pagePath: path, pageTitle })
          setSession(corrente)
        }
        await appendMessage({ sessionId: corrente.id, companyId, role: 'user', content: question })
      } catch (e) {
        console.warn('[help-chat] domanda non salvata', e)
        setSaveWarning(true)
      }
    }

    // 2) Chiedi all'AI e salva la risposta.
    try {
      const { supabase } = await import('../lib/supabase')
      const { data, error: fnErr } = await supabase.functions.invoke('help-chat', {
        body: { page: path, pageTitle, pageContext, messages: next },
      })
      if (fnErr) throw fnErr
      const reply = (data as { reply?: string } | null)?.reply?.trim()
      if (!reply) throw new Error('Risposta vuota')
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
      if (corrente && companyId) {
        try {
          await appendMessage({ sessionId: corrente.id, companyId, role: 'assistant', content: reply })
        } catch (e) {
          console.warn('[help-chat] risposta non salvata', e)
          setSaveWarning(true)
        }
      }
    } catch (e) {
      console.warn('[help-chat]', e)
      setError('Non riesco a rispondere in questo momento. Riprova tra poco.')
    } finally {
      setLoading(false)
    }
  }

  // Chiusura decisa dall'operatrice: da qui la chat diventa archivio.
  async function chiudiChat() {
    if (!session || !userId) return
    setClosing(true)
    try {
      const chiusa = await closeSession(session.id, userId)
      setSession(chiusa)
      setConfirmClose(false)
    } catch (e) {
      console.warn('[help-chat] chiusura fallita', e)
      setError('Non sono riuscito a chiudere la chat. Riprova.')
    } finally {
      setClosing(false)
    }
  }

  // Dopo la chiusura: si riparte da zero, la vecchia resta nell'archivio.
  function nuovaChat() {
    setSession(null)
    setMessages([])
    setError(null)
    setConfirmClose(false)
  }

  const suggestions = [
    'Cosa posso fare in questa pagina?',
    'Come importo i dati?',
    'Cosa significa questo termine?',
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Barra di stato della chat: c'è solo quando una chat esiste davvero */}
      {session && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50/70">
          <StatoChip status={session.status} />
          <span className="text-[11px] text-slate-500 truncate flex-1">
            {session.status === 'aperta'
              ? `Aperta il ${formatChatDate(session.created_at)}`
              : `Chiusa il ${formatChatDate(session.closed_at)}`}
          </span>
          {session.status === 'aperta' ? (
            <button
              onClick={() => setConfirmClose(true)}
              className="shrink-0 text-[11px] font-medium px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 transition"
            >
              Chiudi chat
            </button>
          ) : (
            <button
              onClick={nuovaChat}
              className="shrink-0 text-[11px] font-medium px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
            >
              Nuova chat
            </button>
          )}
        </div>
      )}

      {/* Conferma chiusura (niente confirm() nativo dentro al pannello) */}
      {confirmClose && (
        <div className="shrink-0 px-3 py-2.5 bg-amber-50 border-b border-amber-200">
          <p className="text-xs text-amber-900 leading-relaxed">
            Chiudo questa chat? Resta consultabile nell'archivio, ma non potrai più aggiungere domande:
            la prossima domanda in questa sezione ne aprirà una nuova.
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => void chiudiChat()}
              disabled={closing}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition"
            >
              {closing ? 'Chiusura…' : 'Sì, chiudi'}
            </button>
            <button
              onClick={() => setConfirmClose(false)}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 transition"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {loadingHistory && (
          <div className="flex items-center gap-2 text-sm text-slate-400 justify-center py-6">
            <Loader2 size={14} className="animate-spin" /> Carico la conversazione…
          </div>
        )}

        {!loadingHistory && messages.length === 0 && !loading && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-slate-600 bg-blue-50 rounded-xl p-3">
              <Sparkles size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <span>Ciao! Chiedimi come funziona <strong>{pageTitle}</strong> o qualsiasi altra parte del gestionale. Rispondo su <em>come si usa il sistema</em> (non vedo i tuoi dati). La conversazione resta aperta finché non la chiudi tu.</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs px-2.5 py-1.5 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 text-slate-500 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Sto pensando…
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
        )}

        {saveWarning && (
          <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>Questa conversazione potrebbe non essere finita nell'archivio: controlla la connessione.</span>
          </div>
        )}
      </div>

      {isClosed ? (
        <div className="shrink-0 border-t border-slate-100 p-3 flex items-center gap-2 text-xs text-slate-500 bg-slate-50">
          <Lock size={13} className="shrink-0" />
          <span className="flex-1">Chat chiusa e archiviata.</span>
          <button
            onClick={nuovaChat}
            className="shrink-0 font-medium px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Nuova chat
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); void send(input) }}
          className="shrink-0 border-t border-slate-100 p-3 flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter invia solo su dispositivi con mouse: da telefono Enter fa
            // l'a-capo (non c'e' Shift) e si invia col bottone.
            if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); void send(input) }
            }}
            placeholder="Scrivi la tua domanda…"
            rows={1}
            className="flex-1 resize-none max-h-24 text-sm px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="shrink-0 p-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            title="Invia"
          >
            <Send size={16} />
          </button>
        </form>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab archivio: elenco delle chat dell'azienda (aperte in cima) e lettura
// integrale di domande e risposte di una conversazione già chiusa.
// ─────────────────────────────────────────────────────────────────────────────
type FiltroArchivio = 'tutte' | 'aperte' | 'chiuse'

function ArchiveView({
  currentPath,
  onResume,
  onNavigate,
}: {
  currentPath: string
  onResume: () => void
  onNavigate: (path: string) => void
}) {
  const { profile } = useAuth()
  const companyId = (profile?.company_id as string | null) ?? null
  const userId = (profile?.id as string | undefined) ?? null

  const [sessions, setSessions] = useState<HelpChatSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroArchivio>('tutte')
  const [cerca, setCerca] = useState('')
  const [aperta, setAperta] = useState<HelpChatSession | null>(null)

  const ricarica = useCallback(async () => {
    if (!companyId) { setSessions([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      setSessions(await fetchSessions(companyId))
    } catch (e) {
      console.warn('[help-chat] archivio non caricato', e)
      setError('Non riesco a caricare l\'archivio delle chat.')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { void ricarica() }, [ricarica])

  const elenco = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    return sessions.filter((s) => {
      if (filtro === 'aperte' && s.status !== 'aperta') return false
      if (filtro === 'chiuse' && s.status !== 'chiusa') return false
      if (!q) return true
      return [s.title, s.page_title, s.page_path, s.user_name]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    })
  }, [sessions, filtro, cerca])

  if (aperta) {
    return <ArchiveDetail
      session={aperta}
      isMine={aperta.user_id === userId}
      isCurrentPage={aperta.page_path === currentPath}
      onBack={() => { setAperta(null); void ricarica() }}
      onResume={onResume}
      onNavigate={onNavigate}
    />
  }

  const aperteCount = sessions.filter((s) => s.status === 'aperta').length

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 p-3 space-y-2 border-b border-slate-100">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={cerca}
            onChange={(e) => setCerca(e.target.value)}
            placeholder="Cerca nelle chat…"
            className="w-full text-sm pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
          />
        </div>
        <div className="flex gap-1.5">
          {([
            ['tutte', `Tutte (${sessions.length})`],
            ['aperte', `Aperte (${aperteCount})`],
            ['chiuse', 'Archiviate'],
          ] as [FiltroArchivio, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFiltro(k)}
              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                filtro === k
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-400 justify-center py-6">
            <Loader2 size={14} className="animate-spin" /> Carico l'archivio…
          </div>
        )}

        {error && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

        {!loading && !error && elenco.length === 0 && (
          <div className="text-center text-sm text-slate-500 py-8 px-4">
            <MessageSquare size={22} className="mx-auto mb-2 text-slate-300" />
            {sessions.length === 0
              ? 'Nessuna chat ancora. Le conversazioni con l\'assistente restano qui, con domande e risposte.'
              : 'Nessuna chat corrisponde ai filtri.'}
          </div>
        )}

        {elenco.map((s) => (
          <button
            key={s.id}
            onClick={() => setAperta(s)}
            className="w-full text-left rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 transition p-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <StatoChip status={s.status} />
              <span className="text-[11px] text-slate-500 truncate">{s.page_title || s.page_path}</span>
              <span className="text-[11px] text-slate-400 ml-auto shrink-0">
                {formatChatDate(s.last_message_at ?? s.created_at)}
              </span>
            </div>
            <p className="text-sm text-slate-800 font-medium line-clamp-2">
              {s.title || 'Chat senza domande'}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              {s.message_count} messaggi
              {s.user_name ? ` · ${s.user_name}` : ''}
              {s.user_id === userId ? ' · tu' : ''}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

function ArchiveDetail({
  session, isMine, isCurrentPage, onBack, onResume, onNavigate,
}: {
  session: HelpChatSession
  isMine: boolean
  isCurrentPage: boolean
  onBack: () => void
  onResume: () => void
  onNavigate: (path: string) => void
}) {
  const { profile } = useAuth()
  const userId = (profile?.id as string | undefined) ?? null
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stato, setStato] = useState<HelpChatSession>(session)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    let annullato = false
    async function load() {
      setLoading(true)
      try {
        const msgs = await fetchMessages(session.id)
        if (!annullato) setMessages(msgs.map((m) => ({ role: m.role, content: m.content })))
      } catch (e) {
        console.warn('[help-chat] messaggi non caricati', e)
        if (!annullato) setError('Non riesco a caricare questa conversazione.')
      } finally {
        if (!annullato) setLoading(false)
      }
    }
    void load()
    return () => { annullato = true }
  }, [session.id])

  async function chiudi() {
    if (!userId) return
    setClosing(true)
    try {
      setStato(await closeSession(stato.id, userId))
    } catch (e) {
      console.warn('[help-chat] chiusura fallita', e)
      setError('Non sono riuscito a chiudere la chat.')
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-slate-100 p-3">
        <button
          onClick={onBack}
          className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2 transition"
        >
          <ChevronLeft size={14} /> Tutte le chat
        </button>
        <div className="flex items-center gap-2 mb-1">
          <StatoChip status={stato.status} />
          <span className="text-[11px] text-slate-500 truncate">{stato.page_title || stato.page_path}</span>
        </div>
        <p className="text-sm font-semibold text-slate-900 leading-snug">{stato.title || 'Chat senza domande'}</p>
        <p className="text-[11px] text-slate-500 mt-1">
          {stato.user_name || 'Utente'} · aperta il {formatChatDate(stato.created_at)}
          {stato.closed_at ? ` · chiusa il ${formatChatDate(stato.closed_at)}` : ''}
        </p>

        {stato.status === 'aperta' && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {isMine && isCurrentPage && (
              <button
                onClick={onResume}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
              >
                Riprendi la chat
              </button>
            )}
            {isMine && !isCurrentPage && (
              <button
                onClick={() => onNavigate(stato.page_path)}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition"
              >
                Vai a {stato.page_title || stato.page_path}
              </button>
            )}
            {isMine && (
              <button
                onClick={() => void chiudi()}
                disabled={closing}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition"
              >
                {closing ? 'Chiusura…' : 'Chiudi chat'}
              </button>
            )}
          </div>
        )}

        {stato.status === 'chiusa' && (
          <p className="text-[11px] text-emerald-700 flex items-center gap-1 mt-2">
            <CheckCircle2 size={12} /> Conversazione archiviata
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-400 justify-center py-6">
            <Loader2 size={14} className="animate-spin" /> Carico la conversazione…
          </div>
        )}
        {error && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
        {!loading && messages.length === 0 && !error && (
          <p className="text-sm text-slate-500 text-center py-6">Nessun messaggio in questa chat.</p>
        )}
        {messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)}
      </div>
    </div>
  )
}

// Tab guida: descrizione + sezioni (con eventuali passi) + FAQ.
function GuideView({ guide }: { guide: PageGuide }) {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)
  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      <p className="text-sm text-slate-600 leading-relaxed">{guide.description}</p>

      {guide.sections.length > 0 && (
        <div className="space-y-4">
          {guide.sections.map((s, i) => (
            <div key={i}>
              <h4 className="text-sm font-bold text-slate-900 mb-1">{s.heading}</h4>
              {/* whitespace-pre-line: alcune guide usano \n per gli elenchi
                  puntati (es. Report Sincronizzazioni) che altrimenti
                  collassano in un unico blocco */}
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{s.body}</p>
              {s.steps && s.steps.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {s.steps.map((step, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-slate-600">
                      <ChevronRight size={14} className="text-blue-500 shrink-0 mt-0.5" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {guide.faq.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Domande frequenti</h4>
          <div className="space-y-1.5">
            {guide.faq.map((item, i) => (
              <div key={i} className="border border-slate-100 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                  className="w-full text-left px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 flex items-center justify-between gap-2 transition"
                >
                  <span>{item.q}</span>
                  <ChevronRight size={14} className={`text-slate-400 shrink-0 transition-transform ${expandedFaq === i ? 'rotate-90' : ''}`} />
                </button>
                {expandedFaq === i && (
                  <div className="px-3 pb-3 text-sm text-slate-600 border-t border-slate-100 pt-2">
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type Tab = 'guida' | 'chat' | 'archivio'

export default function HelpPanel() {
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('guida')

  const guide = resolveGuide(location.pathname)
  const pageTitle = guide?.title || titleFromPath(location.pathname)
  const pageContext = buildPageContext(guide)
  const canonicalPath = '/' + location.pathname.split('/').filter(Boolean).join('/')

  // Su pagine senza guida, la tab Guida non esiste: si apre la chat.
  const effectiveTab: Tab = tab === 'guida' && !guide ? 'chat' : tab

  // Cambiando pagina: chiudi il pannello e torna alla tab Guida. Evita che
  // un pannello lasciato aperto resti "appeso" o sovrapposto sulla pagina nuova.
  // NB: la conversazione NON si perde più — resta salvata e aperta finché non
  // è l'operatrice a chiuderla dal pulsante "Chiudi chat".
  useEffect(() => {
    setOpen(false)
    setTab('guida')
  }, [location.pathname])

  const Icon = (guide && ICONS[guide.icon]) || HelpCircle

  return (
    <>
      {/* Floating help button */}
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 p-3 rounded-full shadow-lg transition-all ${
          open ? 'bg-slate-700 text-white rotate-45' : 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-105'
        }`}
        title="Aiuto"
      >
        {open ? <X size={20} /> : <HelpCircle size={20} />}
      </button>

      {/* Help panel */}
      {open && (
        <div className="fixed bottom-36 md:bottom-20 right-4 md:right-6 z-40 w-[380px] max-w-[calc(100vw-2rem)] h-[70dvh] max-h-[560px] bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-2">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-5 py-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <Icon size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base truncate">{pageTitle}</h3>
                <p className="text-blue-100 text-xs mt-0.5">Aiuto e assistente AI</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="shrink-0 flex border-b border-slate-100">
            {guide && (
              <button
                onClick={() => setTab('guida')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition ${
                  effectiveTab === 'guida'
                    ? 'text-blue-700 border-b-2 border-blue-600'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <BookOpen size={15} /> Guida
              </button>
            )}
            <button
              onClick={() => setTab('chat')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition ${
                effectiveTab === 'chat'
                  ? 'text-blue-700 border-b-2 border-blue-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Sparkles size={15} /> Chiedi all'AI
            </button>
            <button
              onClick={() => setTab('archivio')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition ${
                effectiveTab === 'archivio'
                  ? 'text-blue-700 border-b-2 border-blue-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Chat aperte e archiviate"
            >
              <MessageSquare size={15} /> Le chat
            </button>
          </div>

          {/* Body */}
          {effectiveTab === 'chat' && (
            <AssistantChat path={canonicalPath} pageTitle={pageTitle} pageContext={pageContext} />
          )}
          {effectiveTab === 'archivio' && (
            <ArchiveView
              currentPath={canonicalPath}
              onResume={() => setTab('chat')}
              onNavigate={(p) => { setOpen(false); navigate(p) }}
            />
          )}
          {effectiveTab === 'guida' && guide && <GuideView guide={guide} />}
        </div>
      )}
    </>
  )
}
