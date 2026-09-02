// ─────────────────────────────────────────────────────────────────────────────
// Persistenza delle chat con l'assistente AI (pannello "?" → Chiedi all'AI).
//
// Modello (migrazione 155):
//   help_chat_sessions  — una riga per conversazione, stato 'aperta'/'chiusa'.
//   help_chat_messages  — le battute in ordine, immutabili.
//
// Regola operativa: la chat di una sezione resta APERTA finche' non e'
// l'operatrice a chiuderla. Cambio pagina, logout e ricarica del browser NON
// la chiudono: tornando su quella sezione si riprende la stessa conversazione.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'

export type HelpChatRole = 'user' | 'assistant'
export type HelpChatStatus = 'aperta' | 'chiusa'

export interface HelpChatSession {
  id: string
  company_id: string
  user_id: string
  user_name: string | null
  page_path: string
  page_title: string | null
  title: string | null
  status: HelpChatStatus
  message_count: number
  last_message_at: string | null
  created_at: string
  closed_at: string | null
  closed_by: string | null
}

export interface HelpChatMessage {
  id: string
  session_id: string
  role: HelpChatRole
  content: string
  created_at: string
}

const SESSION_COLS =
  'id, company_id, user_id, user_name, page_path, page_title, title, status, message_count, last_message_at, created_at, closed_at, closed_by'

/** Chat ancora aperta dell'utente su quella sezione (al massimo una). */
export async function fetchOpenSession(
  companyId: string,
  userId: string,
  pagePath: string,
): Promise<HelpChatSession | null> {
  const { data, error } = await supabase
    .from('help_chat_sessions')
    .select(SESSION_COLS)
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('page_path', pagePath)
    .eq('status', 'aperta')
    .maybeSingle()
  if (error) throw error
  return (data as HelpChatSession | null) ?? null
}

/**
 * Apre una nuova chat per la sezione. Se un'altra scheda del browser l'ha
 * appena creata, l'indice unico parziale scatta (23505): in quel caso non e'
 * un errore, si riprende semplicemente quella gia' aperta.
 */
export async function createSession(params: {
  companyId: string
  userId: string
  userName: string | null
  pagePath: string
  pageTitle: string | null
}): Promise<HelpChatSession> {
  const { data, error } = await supabase
    .from('help_chat_sessions')
    .insert({
      company_id: params.companyId,
      user_id: params.userId,
      user_name: params.userName,
      page_path: params.pagePath,
      page_title: params.pageTitle,
    })
    .select(SESSION_COLS)
    .single()

  if (error) {
    if (error.code === '23505') {
      const existing = await fetchOpenSession(params.companyId, params.userId, params.pagePath)
      if (existing) return existing
    }
    throw error
  }
  return data as HelpChatSession
}

/** Tutte le battute di una chat, in ordine cronologico. */
export async function fetchMessages(sessionId: string): Promise<HelpChatMessage[]> {
  const { data, error } = await supabase
    .from('help_chat_messages')
    .select('id, session_id, role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as HelpChatMessage[] | null) ?? []
}

/** Aggiunge una battuta (domanda o risposta). Il trigger DB aggiorna i contatori. */
export async function appendMessage(params: {
  sessionId: string
  companyId: string
  role: HelpChatRole
  content: string
}): Promise<HelpChatMessage> {
  const { data, error } = await supabase
    .from('help_chat_messages')
    .insert({
      session_id: params.sessionId,
      company_id: params.companyId,
      role: params.role,
      content: params.content,
    })
    .select('id, session_id, role, content, created_at')
    .single()
  if (error) throw error
  return data as HelpChatMessage
}

/** Chiusura decisa dall'operatrice: da qui in poi la chat e' archivio. */
export async function closeSession(sessionId: string, userId: string): Promise<HelpChatSession> {
  const { data, error } = await supabase
    .from('help_chat_sessions')
    .update({
      status: 'chiusa',
      closed_at: new Date().toISOString(),
      closed_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .select(SESSION_COLS)
    .single()
  if (error) throw error
  return data as HelpChatSession
}

/**
 * Elenco per l'archivio: tutte le chat dell'azienda (visibilita' condivisa),
 * prima le aperte, poi per ultima attivita'.
 */
export async function fetchSessions(companyId: string, limit = 200): Promise<HelpChatSession[]> {
  const { data, error } = await supabase
    .from('help_chat_sessions')
    .select(SESSION_COLS)
    .eq('company_id', companyId)
    .order('status', { ascending: true }) // 'aperta' < 'chiusa'
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as HelpChatSession[] | null) ?? []
}

/** Etichetta breve per l'elenco archivio: "12 set, 14:30". */
export function formatChatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
