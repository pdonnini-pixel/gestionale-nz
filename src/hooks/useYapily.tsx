import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// TODO: tighten type — API response shapes from Yapily Edge Functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = any

export function useYapily() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Helper per chiamare Edge Functions autenticate (con auto-refresh token)
  const callFunction = useCallback(async (
    fnName: string,
    method: string = 'GET',
    body: Record<string, unknown> | null = null,
    params: Record<string, string> | null = null
  ): Promise<ApiResponse> => {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdmZ4c3ZxcG5wdmliZ2VxcHFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNDkwNDcsImV4cCI6MjA5MDcyNTA0N30.ohYziAXiOWS0TKU9HHuhUAbf5Geh10xbLGEoftOMJZA'
    const baseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xfvfxsvqpnpvibgeqpqp.supabase.co'

    const buildUrl = () => {
      let url = `${baseUrl}/functions/v1/${fnName}`
      if (params) {
        const qs = new URLSearchParams(params).toString()
        if (qs) url += `?${qs}`
      }
      return url
    }

    const doFetch = async (accessToken: string) => {
      return fetch(buildUrl(), {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'apikey': anonKey,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    }

    // Prima prova con il token corrente
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Non autenticato')

    let res = await doFetch(session.access_token)

    // Se 401, il token potrebbe essere scaduto — forza refresh e riprova
    if (res.status === 401) {
      console.warn('[useYapily] Token scaduto, refresh in corso...')
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError || !refreshData.session) {
        throw new Error('Sessione scaduta, effettua nuovamente il login')
      }
      res = await doFetch(refreshData.session.access_token)
    }

    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Errore ${res.status}`)
    return json
  }, [])

  // ────────── INSTITUTIONS ──────────

  const fetchInstitutions = useCallback(async (country = 'IT', sandbox = false) => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = { country }
      if (sandbox) params.sandbox = 'true'
      const res = await callFunction('yapily-institutions', 'GET', null, params)
      return { data: res.data || [], _debug: res._debug || null }
    } catch (err: unknown) {
      setError((err as Error).message)
      return { data: [], _debug: null }
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  // ────────── CONSENT FLOW ──────────

  const createConsent = useCallback(async (institutionId: string, institutionName: string, consentType = 'AIS') => {
    setLoading(true)
    setError(null)
    try {
      const callbackUrl = `${window.location.origin}/banking/callback`
      const res = await callFunction('yapily-auth', 'POST', {
        institutionId,
        institutionName,
        consentType,
        callbackUrl,
      })
      return res.data
    } catch (err: unknown) {
      setError((err as Error).message)
      return null
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  // ────────── ACCOUNTS ──────────

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-accounts')
      return res.data || []
    } catch (err: unknown) {
      setError((err as Error).message)
      return []
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  const syncAccounts = useCallback(async (consentId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-accounts', 'POST', { consentId })
      return res.data || []
    } catch (err: unknown) {
      setError((err as Error).message)
      return []
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  // ────────── TRANSACTIONS ──────────

  const fetchTransactions = useCallback(async (accountId: string, from: string, to: string, limit = 100) => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = {}
      if (accountId) params.accountId = accountId
      if (from) params.from = from
      if (to) params.to = to
      if (limit) params.limit = String(limit)
      const res = await callFunction('yapily-transactions', 'GET', null, params)
      return res.data || []
    } catch (err: unknown) {
      setError((err as Error).message)
      return []
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  const syncTransactions = useCallback(async (accountId: string, from: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-transactions', 'POST', { accountId, from })
      return res.data
    } catch (err: unknown) {
      setError((err as Error).message)
      return null
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  // ────────── BALANCES ──────────

  const fetchBalances = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-balances')
      return res.data || []
    } catch (err: unknown) {
      setError((err as Error).message)
      return []
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  const refreshBalances = useCallback(async (accountId?: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-balances', 'POST', { accountId })
      return res.data
    } catch (err: unknown) {
      setError((err as Error).message)
      return null
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  // ────────── FULL SYNC (Yapily → cash_movements) ──────────

  const fullSync = useCallback(async (accountId: string, from?: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-sync', 'POST', { accountId, from })
      return res.data
    } catch (err: unknown) {
      setError((err as Error).message)
      return null
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  // ────────── CONSENTS (local DB) ──────────

  const fetchConsents = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('yapily_consents')
      .select('*')
      .order('created_at', { ascending: false })

    if (err) {
      setError(err.message)
      return []
    }
    return data || []
  }, [])

  return {
    loading,
    error,
    setError,
    fetchInstitutions,
    createConsent,
    fetchConsents,
    fetchAccounts,
    syncAccounts,
    fetchTransactions,
    syncTransactions,
    fetchBalances,
    refreshBalances,
    fullSync,
  }
}
