import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPaged } from '../lib/fetchAllPaged'
import { useAuth } from './useAuth'

/**
 * Anni realmente presenti nei dati del tenant (budget_entries), in ordine
 * decrescente. Sostituisce le liste fisse tipo [2024..2027] nei dropdown anno
 * delle pagine analytics (audit M54): quelle liste invecchiano — dal 2028 il
 * menu sarebbe rimasto fermo. Fallback: anno corrente.
 */
export function useAvailableYears(): number[] {
  const { profile } = useAuth()
  const [years, setYears] = useState<number[]>([new Date().getFullYear()])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const rows = await fetchAllPaged<{ year: number | null }>(
          (from, to) => {
            let q = supabase.from('budget_entries').select('year').order('year', { ascending: false })
            if (profile?.company_id) q = q.eq('company_id', profile.company_id)
            return q.range(from, to)
          },
          'budget_entries (anni disponibili)',
        )
        if (cancelled) return
        const ys = Array.from(new Set(rows.map(r => Number(r.year)).filter(y => Number.isInteger(y) && y > 2000)))
          .sort((a, b) => b - a)
        if (ys.length) setYears(ys)
      } catch {
        /* fallback: resta l'anno corrente */
      }
    }
    void load()
    return () => { cancelled = true }
  }, [profile?.company_id])

  return years
}
