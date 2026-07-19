import { useState, useEffect } from 'react'

/**
 * true sotto il breakpoint md di Tailwind (768px). Serve dove il responsive
 * non si può fare in CSS: props dei grafici recharts (legende, tick, label),
 * numero di serie mostrate, ecc.
 */
export function useIsMobile(query = '(max-width: 767px)'): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return isMobile
}
