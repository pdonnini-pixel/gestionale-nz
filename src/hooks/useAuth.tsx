import { useState, useEffect, useRef, createContext, useContext, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

interface UserProfile {
  id: string
  company_id: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
  email: string | null
  [key: string]: unknown
}

interface AuthContextValue {
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  /** Errore di caricamento profilo (rete/RLS) dopo i retry: se valorizzato con
   *  sessione valida, l'app mostra una schermata "Riprova" invece di uno spinner
   *  infinito (prima il profilo restava null per sempre e ogni pagina girava). */
  profileError: string | null
  signIn: (email: string, password: string) => Promise<{ error: unknown }>
  resetPassword: (email: string) => Promise<{ error: unknown }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  // Id dell'utente per cui il profilo è già stato caricato. Serve a NON
  // rifare la fetch del profilo (e quindi evitare re-render a cascata) sugli
  // eventi di puro refresh token che Supabase emette al ritorno sul tab del
  // browser. (Patrizio 01/06/2026 — fix reset sotto-pagina)
  const loadedProfileId = useRef<string | null>(null)

  useEffect(() => {
    // Recupera sessione corrente
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else setLoading(false)
    })

    // Ascolta cambi autenticazione
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      const uid = session?.user?.id ?? null
      if (uid) {
        // Solo se cambia davvero l'utente ricarichiamo il profilo. Sugli eventi
        // TOKEN_REFRESHED/SIGNED_IN con stesso utente (focus sul tab) evitiamo
        // la refetch che innescava lo smontaggio della pagina attiva.
        if (uid !== loadedProfileId.current) fetchProfile(uid)
        else setLoading(false)
      } else {
        loadedProfileId.current = null
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId: string) {
    // Retry su errori transitori (rete instabile, glitch RLS): prima un singolo
    // errore lasciava profile=null PER SEMPRE -> ogni pagina (COMPANY_ID mancante)
    // restava su spinner infinito, con sessione valida. Ora si riprova qualche
    // volta con backoff e, se proprio non si carica, si espone profileError così
    // l'app puo' mostrare una schermata "Riprova" invece di bloccarsi.
    setProfileError(null)
    const delays = [0, 400, 1000]
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) await new Promise(r => setTimeout(r, delays[attempt]))
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (!error && data) {
        setProfile(data as unknown as UserProfile)
        loadedProfileId.current = userId
        setProfileError(null)
        setLoading(false)
        return
      }
      // Ultimo tentativo fallito -> esponi l'errore (con sessione valida)
      if (attempt === delays.length - 1) {
        console.error('[useAuth] fetchProfile fallito dopo i retry:', error?.message)
        setProfileError(error?.message || 'Impossibile caricare il profilo utente.')
      }
    }
    setLoading(false)
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  // Recupero password: invia la mail con il link di reset. Il link riporta a
  // /reset-password sul dominio del tenant corrente (window.location.origin),
  // dove l'utente imposta la nuova password. redirectTo va incluso tra i
  // "Redirect URLs" consentiti nelle impostazioni Auth di ciascun tenant.
  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    // Force redirect a /login + full page reload per ripulire eventuali
    // state React stale (es. company_id cached, tenants config ecc.).
    window.location.href = '/login'
  }

  // Ricarica il profilo dal DB (chiamare dopo update di first_name/last_name
  // dalla pagina /profilo per riflettere subito i nuovi dati nel topbar)
  async function refreshProfile() {
    if (!session?.user?.id) return
    setLoading(true)
    await fetchProfile(session.user.id)
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, profileError, signIn, resetPassword, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
