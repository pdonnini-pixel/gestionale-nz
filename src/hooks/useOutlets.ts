import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useCompany } from './useCompany'

/**
 * Hook che ritorna la lista outlet del tenant attivo. Fonte unica di verità
 * per ogni pagina che mostra una lista di punti vendita (Dipendenti,
 * Produttività, Margini, StockSellthrough, AnalyticsPOS, ecc.).
 *
 * Sostituisce le costanti hardcoded sparse nel codice MVP storico di NZ
 * (es. `const OUTLETS = ['Valdichiana', 'Barberino', ...]`) che bloccavano
 * il prodotto come SaaS multi-tenant.
 *
 * Caching: per ora ricarica ad ogni mount; potremmo aggiungere un Context
 * dedicato se cresce il volume di chiamate, ma con 1-30 outlet per tenant
 * è trascurabile.
 *
 * Empty state: se il tenant non ha outlet configurati (Made/Zago vergini),
 * `outlets = []` e la pagina deve mostrare un empty state UX-friendly.
 */
export interface OutletLite {
  id: string
  name: string
  code: string | null
  city: string | null
  outlet_type: string | null
  is_active: boolean | null
  sort_order: number | null
}

/**
 * Tipi di "outlet" che NON vendono al pubblico (sede, magazzino, ufficio):
 * stanno in anagrafica per costi e personale, ma non hanno cassa. Le pagine
 * della chiusura di cassa li escludono con `useOutlets({ sellingOnly: true })`.
 */
export const NON_SELLING_OUTLET_TYPES = ['sede', 'magazzino', 'warehouse', 'hq', 'ufficio']

export function isSellingOutlet(o: { outlet_type: string | null }): boolean {
  return !NON_SELLING_OUTLET_TYPES.includes((o.outlet_type ?? '').trim().toLowerCase())
}

export interface UseOutletsResult {
  outlets: OutletLite[]
  loading: boolean
  error: string | null
}

export function useOutlets(opts?: { includeInactive?: boolean; sellingOnly?: boolean }): UseOutletsResult {
  const { company } = useCompany()
  const [outlets, setOutlets] = useState<OutletLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const includeInactive = opts?.includeInactive ?? false
  const sellingOnly = opts?.sellingOnly ?? false

  useEffect(() => {
    if (!company?.id) {
      setOutlets([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      const baseQuery = supabase
        .from('outlets')
        .select('id, name, code, city, outlet_type, is_active')
        .eq('company_id', company.id)
        .order('name')
      const q = includeInactive
        ? baseQuery
        : baseQuery.eq('is_active', true)
      const { data, error: dbErr } = await q
      if (cancelled) return
      if (dbErr) {
        setError(dbErr.message)
        setOutlets([])
      } else {
        // sort_order non sempre presente — non lo includiamo in SELECT per
        // evitare type errors sui DB pre-013. Aggiungiamo null come fallback.
        const rows = (data ?? []).map((r) => ({
          id: r.id as string,
          name: (r.name as string) ?? '',
          code: (r.code as string | null) ?? null,
          city: (r.city as string | null) ?? null,
          outlet_type: (r.outlet_type as string | null) ?? null,
          is_active: (r.is_active as boolean | null) ?? true,
          sort_order: null,
        }))
        setOutlets(sellingOnly ? rows.filter(isSellingOutlet) : rows)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [company?.id, includeInactive, sellingOnly])

  return { outlets, loading, error }
}
