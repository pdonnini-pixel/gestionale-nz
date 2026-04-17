import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Hook per interagire con le Edge Functions Yapily.
 * Gestisce: lista banche, consent flow, sync conti/transazioni/saldi, pagamenti.
 */
export function useYapily() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Helper per chiamare Edge Functions autenticate
  const callFunction = useCallback(async (fnName, method = 'GET', body = null, params = null) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Non autenticato')

    const baseUrl = import.meta.env.VITE_SUPABASE_URL
    let url = `${baseUrl}/functions/v1/${fnName}`
    if (params) {
      const qs = new URLSearchParams(params).toString()
      if (qs) url += `?${qs}`
    }

    const headers = {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Errore ${res.status}`)
    return json
  }, [])

  // ────────── INSTITUTIONS ──────────

  const fetchInstitutions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-institutions')
      return res.data || []
    } catch (err) {
      setError(err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  // ────────── CONSENT FLOW ──────────

  const createConsent = useCallback(async (institutionId, institutionName, consentType = 'AIS') => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-auth', 'POST', {
        institutionId,
        institutionName,
        consentType,
      })
      return res.data // { consentId, authorisationUrl, consentToken }
    } catch (err) {
      setError(err.message)
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
    } catch (err) {
      setError(err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  const syncAccounts = useCallback(async (consentId) => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-accounts', 'POST', { consentId })
      return res.data || []
    } catch (err) {
      setError(err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  // ────────── TRANSACTIONS ──────────

  const fetchTransactions = useCallback(async (accountId, from, to, limit = 100) => {
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (accountId) params.accountId = accountId
      if (from) params.from = from
      if (to) params.to = to
      if (limit) params.limit = String(limit)
      const res = await callFunction('yapily-transactions', 'GET', null, params)
      return res.data || []
    } catch (err) {
      setError(err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  const syncTransactions = useCallback(async (accountId, from) => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-transactions', 'POST', { accountId, from })
      return res.data // { synced, total }
    } catch (err) {
      setError(err.message)
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
    } catch (err) {
      setError(err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [callFunction])

  const refreshBalances = useCallback(async (accountId) => {
    setLoading(true)
    setError(null)
    try {
      const res = await callFunction('yapily-balances', 'POST', { accountId })
      return res.data // { updated, total }
    } catch (err) {
      setError(err.message)
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
    // Institutions
    fetchInstitutions,
    // Consent
    createConsent,
    fetchConsents,
    // Accounts
    fetchAccounts,
    syncAccounts,
    // Transactions
    fetchTransactions,
    syncTransactions,
    // Balances
    fetchBalances,
    refreshBalances,
  }
}
