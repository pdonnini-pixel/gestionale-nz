// Hook A-Cube Open Banking: wrapper Edge Functions Supabase
// 4 Edge Functions:
//   acube-ob-br-upsert       — crea/aggiorna Business Registry su A-Cube
//   acube-ob-br-enable       — POST /business-registry/{fid}/enable
//   acube-ob-connect-request — genera connectUrl per consenso PSD2
//   acube-ob-accounts-sync   — GET /accounts → bank_accounts + acube_accounts
//   acube-ob-tx-sync         — GET /transactions → bank_transactions + acube_transactions
//
// Pattern: ogni handler invoca supabase.functions.invoke(...) e restituisce
// data/error. Stage 'sandbox' di default (sicuro), 'production' esplicito.

import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'

export type AcubeStage = 'sandbox' | 'production'

export interface BrUpsertInput {
  stage: AcubeStage
  fiscalId: string
  businessName: string
  email: string
  country?: string
  companyId?: string
}

export interface BrUpsertResult {
  uuid: string
  fiscal_id: string
  business_name: string
  enabled: boolean
  stage: AcubeStage
  already_existed: boolean
  note: string | null
}

export interface ConnectRequestResult {
  url: string
  consent_id: string
}

export interface SyncResult {
  fetched?: number
  acube_upserted?: number
  bank_upserted?: number
  acube_inserted?: number
  bank_inserted?: number
  duplicates?: number
  accounts?: Array<{ uuid: string; iban: string | null; name: string; balance: number | null }>
}

export function useAcubeOB() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invoke = useCallback(async <T,>(fn: string, body: Record<string, unknown>): Promise<T> => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(fn, { body })
      if (invokeErr) {
        const errMsg = invokeErr.message || `Errore ${fn}`
        setError(errMsg)
        throw new Error(errMsg)
      }
      if (data?.error) {
        setError(data.error)
        throw new Error(data.error)
      }
      return data as T
    } finally {
      setLoading(false)
    }
  }, [])

  // STEP 1: crea o aggiorna BR (idempotente)
  const upsertBR = useCallback((input: BrUpsertInput) =>
    invoke<BrUpsertResult>('acube-ob-br-upsert', input as unknown as Record<string, unknown>), [invoke])

  // STEP 2: attiva BR (necessario prima di connect)
  const enableBR = useCallback((stage: AcubeStage, fiscalId: string) =>
    invoke<{ fiscal_id: string; enabled: boolean }>('acube-ob-br-enable', { stage, fiscalId }), [invoke])

  // STEP 3: genera URL di consenso PSD2
  const connectRequest = useCallback((stage: AcubeStage, fiscalId: string, locale = 'it') =>
    invoke<ConnectRequestResult>('acube-ob-connect-request', { stage, fiscalId, locale }), [invoke])

  // STEP 4: sync conti dopo consenso
  const syncAccounts = useCallback((stage: AcubeStage, fiscalId: string, companyId: string) =>
    invoke<SyncResult>('acube-ob-accounts-sync', { stage, fiscalId, companyId }), [invoke])

  // STEP 5: sync transazioni
  const syncTransactions = useCallback((stage: AcubeStage, fiscalId: string, companyId: string, accountUuid?: string) =>
    invoke<SyncResult>('acube-ob-tx-sync', { stage, fiscalId, companyId, ...(accountUuid ? { accountUuid } : {}) }), [invoke])

  // Wrapper end-to-end: 1 chiamata fa upsert + enable + connect-request, ritorna URL
  const startConnect = useCallback(async (input: BrUpsertInput) => {
    const br = await upsertBR(input)
    if (!br.enabled) {
      await enableBR(input.stage, input.fiscalId)
    }
    const c = await connectRequest(input.stage, input.fiscalId)
    return { br, connectUrl: c.url, consentId: c.consent_id }
  }, [upsertBR, enableBR, connectRequest])

  return {
    loading,
    error,
    upsertBR,
    enableBR,
    connectRequest,
    syncAccounts,
    syncTransactions,
    startConnect,
  }
}
