// Chat di Documenti banca (R28): le cose che dopo un caricamento non tornano e
// che solo una persona puo' sapere. Il sistema chiede una cosa alla volta,
// Sabrina risponde a parole sue, l'edge function `bank-doc-chat` capisce cosa
// ha detto, lo applica con traccia e risponde.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare, Send, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Domanda = {
  id: string
  kind: string
  question: string
  status: 'aperta' | 'risolta' | 'archiviata'
  created_at: string
}
type Messaggio = { id: string; question_id: string; author: 'sistema' | 'utente'; body: string; created_at: string }

const quando = (iso: string): string =>
  new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function ChatDocumentiBanca({ companyId }: { companyId: string | null }) {
  const [domande, setDomande] = useState<Domanda[]>([])
  const [messaggi, setMessaggi] = useState<Messaggio[]>([])
  const [carico, setCarico] = useState(false)
  const [attiva, setAttiva] = useState<string | null>(null)
  const [bozza, setBozza] = useState('')
  const [invio, setInvio] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const carica = useCallback(async () => {
    if (!companyId) return
    setCarico(true)
    try {
      const { data: qs } = await supabase.from('bank_document_questions')
        .select('id, kind, question, status, created_at')
        .eq('company_id', companyId).eq('status', 'aperta')
        .order('created_at', { ascending: true }).limit(200)
      const lista = (qs ?? []) as Domanda[]
      setDomande(lista)
      if (lista.length > 0) {
        const { data: ms } = await supabase.from('bank_document_messages')
          .select('id, question_id, author, body, created_at')
          .in('question_id', lista.map((q) => q.id))
          .order('created_at', { ascending: true })
        setMessaggi((ms ?? []) as Messaggio[])
      } else {
        setMessaggi([])
      }
      setAttiva((a) => (a && lista.some((q) => q.id === a) ? a : lista[0]?.id ?? null))
      window.dispatchEvent(new Event('banche-domande-aggiornate'))
    } finally {
      setCarico(false)
    }
  }, [companyId])

  useEffect(() => { void carica() }, [carica])

  const thread = useMemo(() => messaggi.filter((m) => m.question_id === attiva), [messaggi, attiva])

  const invia = useCallback(async () => {
    const testo = bozza.trim()
    if (!attiva || !testo) return
    setInvio(true)
    setErrore(null)
    // Mostra subito la risposta di Sabrina, senza aspettare il modello.
    setMessaggi((ms) => [...ms, { id: `tmp-${Date.now()}`, question_id: attiva, author: 'utente', body: testo, created_at: new Date().toISOString() }])
    setBozza('')
    try {
      const { data, error } = await supabase.functions.invoke('bank-doc-chat', { body: { question_id: attiva, text: testo } })
      if (error) {
        // L'edge function salva la risposta prima di chiamare il modello: il testo non va perso.
        const ctx = (error as { context?: Response }).context
        let msg = 'Ho salvato la tua risposta, ma adesso non riesco a leggerla. La riprendo appena posso.'
        try { const j = ctx ? await ctx.json() : null; if (j?.error) msg = j.error } catch { /* resta il messaggio generico */ }
        setErrore(msg)
      } else if ((data as { status?: string } | null)?.status !== 'aperta') {
        // Domanda chiusa: si passa alla prossima.
        await carica()
        return
      }
      await carica()
    } finally {
      setInvio(false)
    }
  }, [attiva, bozza, carica])

  if (!companyId) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <MessageSquare size={16} className="text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-900">Da chiarire</h3>
        {domande.length > 0 && (
          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold">{domande.length}</span>
        )}
        {carico && <Loader2 size={14} className="animate-spin text-slate-400" />}
      </div>

      {domande.length === 0 ? (
        <div className="p-4 text-sm text-slate-500 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600" /> Niente da chiarire: tutto quello che hai caricato torna.
        </div>
      ) : (
        <div className="flex flex-col md:flex-row">
          <ol className="md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-slate-100 max-h-72 md:max-h-[28rem] overflow-y-auto">
            {domande.map((q, i) => (
              <li key={q.id}>
                <button
                  type="button" onClick={() => setAttiva(q.id)}
                  className={`w-full text-left px-4 py-2.5 text-xs border-l-2 ${q.id === attiva ? 'border-blue-600 bg-blue-50 text-slate-900' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}
                >
                  <span className="font-medium">{i + 1}.</span> {q.question.length > 90 ? `${q.question.slice(0, 90)}…` : q.question}
                </button>
              </li>
            ))}
          </ol>

          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 p-4 space-y-3 max-h-[28rem] overflow-y-auto">
              {thread.map((m) => (
                <div key={m.id} className={`flex ${m.author === 'utente' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${m.author === 'utente' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                    <div className="whitespace-pre-wrap">{m.body}</div>
                    <div className={`mt-1 text-[10px] ${m.author === 'utente' ? 'text-blue-100' : 'text-slate-400'}`}>{quando(m.created_at)}</div>
                  </div>
                </div>
              ))}
              {invio && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-3.5 py-2 bg-slate-100 text-slate-500 text-sm inline-flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin" /> Leggo la tua risposta…
                  </div>
                </div>
              )}
            </div>
            {errore && <div className="px-4 pb-2 text-xs text-amber-800">{errore}</div>}
            <form
              className="p-3 border-t border-slate-100 flex items-end gap-2"
              onSubmit={(e) => { e.preventDefault(); void invia() }}
            >
              <textarea
                value={bozza} onChange={(e) => setBozza(e.target.value)} rows={2} maxLength={1500}
                placeholder="Rispondi come faresti con una collega…" disabled={!attiva || invio}
                className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit" disabled={!attiva || invio || !bozza.trim()} aria-label="Invia la risposta"
                className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
