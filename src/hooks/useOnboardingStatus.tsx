import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

/**
 * Determina se il tenant attivo è "vergine" (no company creata) e va guidato
 * al wizard /onboarding prima di poter usare il resto dell'app.
 *
 * Caso d'uso: provisioning ADR-001 di un nuovo cliente. Lilian apre il
 * subdomain, fa login, deve essere costretta al wizard. Sabrina/Veronica
 * che aprono lo stesso subdomain prima del completamento vedono un
 * placeholder.
 *
 * Implementazione: query `companies LIMIT 1` con RLS attiva.
 *  - se zero righe → tenant vergine
 *  - se >= 1 → onboardato
 *
 * Si rivaluta solo a re-mount o quando cambia la sessione (al re-login
 * il tenant probabilmente non cambia, ma il check è cheap).
 */
export interface OnboardingStatus {
  /** true mentre stiamo facendo la prima query. */
  loading: boolean
  /** true se il tenant non ha alcuna `companies` row (= vergine). */
  needsOnboarding: boolean
  /** Errore della query, se presente. */
  error: string | null
}

export function useOnboardingStatus(): OnboardingStatus {
  const { session, loading: authLoading } = useAuth()
  const [state, setState] = useState<OnboardingStatus>({
    loading: true,
    needsOnboarding: false,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    if (authLoading) return
    if (!session) {
      setState({ loading: false, needsOnboarding: false, error: null })
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    ;(async () => {
      // Usa RPC `get_or_associate_tenant_company` (SECURITY DEFINER) invece
      // di SELECT diretta su companies (che con RLS nasconde le righe a utenti
      // senza company_id). La RPC:
      //  - se utente ha già company_id → ritorna quello
      //  - se utente senza company_id MA tenant ha company → auto-associa
      //  - se tenant vergine (0 companies) → ritorna NULL → wizard
      // Questo evita che un nuovo utente di un tenant già onboardato venga
      // erroneamente reindirizzato al wizard.
      // I tipi DB auto-generati non includono la RPC `get_or_associate_tenant_company`
      // (creata nella migrazione 013). Cast minimo finché non si rigenerano i tipi via CLI.
      const rpcCall = (supabase.rpc as unknown as (
        fn: string,
      ) => Promise<{ data: string | null; error: { message: string } | null }>).bind(supabase)
      const { data, error } = await rpcCall('get_or_associate_tenant_company')
      if (cancelled) return
      if (error) {
        setState({ loading: false, needsOnboarding: false, error: error.message })
        return
      }
      const empty = data == null
      setState({ loading: false, needsOnboarding: empty, error: null })
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, session])

  return state
}
