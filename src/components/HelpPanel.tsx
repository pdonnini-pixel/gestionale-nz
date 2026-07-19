import React, { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import {
  HelpCircle, X, ChevronRight,
  LayoutDashboard, Store, Receipt, Landmark, Users, FileText,
  Calculator, BarChart3, GitCompare, Wallet, Building2,
  CalendarClock, DatabaseZap, Archive, FileCode, Settings,
  Sparkles, Send, Loader2, BookOpen, Package, UserCircle,
  LucideIcon,
} from 'lucide-react'
import { PAGE_GUIDES, type PageGuide } from '../data/pageGuides'

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

type ChatMsg = { role: 'user' | 'assistant'; content: string }

// Tab chat: invoca l'edge function help-chat (proxy verso Claude, chiave nel
// Vault). L'AI risponde solo su come si usa il gestionale, non vede i dati.
function AssistantChat({ path, pageTitle, pageContext }: { path: string; pageTitle: string; pageContext: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  async function send(text: string) {
    const question = text.trim()
    if (!question || loading) return
    setError(null)
    const next: ChatMsg[] = [...messages, { role: 'user', content: question }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      const { supabase } = await import('../lib/supabase')
      const { data, error: fnErr } = await supabase.functions.invoke('help-chat', {
        body: { page: path, pageTitle, pageContext, messages: next },
      })
      if (fnErr) throw fnErr
      const reply = (data as { reply?: string } | null)?.reply?.trim()
      if (!reply) throw new Error('Risposta vuota')
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
    } catch (e) {
      console.warn('[help-chat]', e)
      setError('Non riesco a rispondere in questo momento. Riprova tra poco.')
    } finally {
      setLoading(false)
    }
  }

  const suggestions = [
    'Cosa posso fare in questa pagina?',
    'Come importo i dati?',
    'Cosa significa questo termine?',
  ]

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-slate-600 bg-blue-50 rounded-xl p-3">
              <Sparkles size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <span>Ciao! Chiedimi come funziona <strong>{pageTitle}</strong> o qualsiasi altra parte del gestionale. Rispondo su <em>come si usa il sistema</em> (non vedo i tuoi dati).</span>
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

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-700 rounded-bl-sm'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

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
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void send(input) }}
        className="shrink-0 border-t border-slate-100 p-3 flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input) }
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
              <p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>
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

export default function HelpPanel() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'guida' | 'chat'>('guida')

  const guide = resolveGuide(location.pathname)
  const pageTitle = guide?.title || titleFromPath(location.pathname)
  const pageContext = buildPageContext(guide)
  const canonicalPath = '/' + location.pathname.split('/').filter(Boolean).join('/')

  // Su pagine senza guida, apri direttamente la chat.
  const effectiveTab: 'guida' | 'chat' = guide ? tab : 'chat'

  // Cambiando pagina: chiudi il pannello e torna alla tab Guida. Evita che
  // un pannello lasciato aperto resti "appeso" o sovrapposto sulla pagina nuova.
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
          </div>

          {/* Body */}
          {effectiveTab === 'chat' ? (
            <AssistantChat path={canonicalPath} pageTitle={pageTitle} pageContext={pageContext} />
          ) : (
            <GuideView guide={guide!} />
          )}
        </div>
      )}
    </>
  )
}
