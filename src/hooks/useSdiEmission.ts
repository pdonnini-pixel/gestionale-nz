import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

/**
 * Flag "invio attivo" SDI (app_config.sdi_emission_enabled), default OFF.
 * Tutto l'apparato di emissione SDI nella pagina Fatturazione e' gatato dietro
 * questo flag: con OFF la pagina e' un archivio di sola consultazione.
 * Fail-safe: durante il caricamento e in assenza di config -> false (nascosto).
 */
export function useSdiEmission(): { sdiEmissionEnabled: boolean; loading: boolean } {
  const { profile } = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const companyId = profile?.company_id
    if (!companyId) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      // sdi_emission_enabled non e' ancora nei tipi generati: cast minimo del
      // risultato (nessun any) come fatto in useCompany per point_of_sale_label.
      const { data } = (await (supabase
        .from('app_config')
        .select('sdi_emission_enabled')
        .eq('company_id', companyId)
        .maybeSingle() as unknown as Promise<{ data: { sdi_emission_enabled: boolean | null } | null }>))
      if (!cancelled) {
        setEnabled(Boolean(data?.sdi_emission_enabled))
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [profile?.company_id])

  return { sdiEmissionEnabled: enabled, loading }
}
