import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface DateRange {
  from: string
  to: string
  label: string
}

interface PeriodContextValue {
  year: number
  quarter: string
  setYear: (y: number) => void
  setQuarter: (q: string) => void
  getDateRange: () => DateRange
}

const PeriodContext = createContext<PeriodContextValue | null>(null)

const CURRENT_YEAR = new Date().getFullYear()

export function PeriodProvider({ children }: { children: ReactNode }) {
  // Al refresh: SEMPRE anno corrente e vista anno intero (no localStorage)
  const [year, setYear] = useState(CURRENT_YEAR)
  const [quarter, setQuarter] = useState('year')

  const updateYear = useCallback((y: number) => {
    setYear(y)
    try { localStorage.setItem('nz_period_year', String(y)) } catch { /* ignore */ }
  }, [])

  const updateQuarter = useCallback((q: string) => {
    setQuarter(q)
    try { localStorage.setItem('nz_period_quarter', q) } catch { /* ignore */ }
  }, [])

  // Compute date range based on year + quarter
  const getDateRange = useCallback((): DateRange => {
    const y = year
    if (quarter === 'year') return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Anno ${y}` }
    if (quarter === 'ytd') {
      const today = new Date().toISOString().split('T')[0]
      return { from: `${y}-01-01`, to: y === CURRENT_YEAR ? today : `${y}-12-31`, label: `YTD ${y}` }
    }
    if (quarter === 'q1') return { from: `${y}-01-01`, to: `${y}-03-31`, label: `Q1 ${y}` }
    if (quarter === 'q2') return { from: `${y}-04-01`, to: `${y}-06-30`, label: `Q2 ${y}` }
    if (quarter === 'q3') return { from: `${y}-07-01`, to: `${y}-09-30`, label: `Q3 ${y}` }
    if (quarter === 'q4') return { from: `${y}-10-01`, to: `${y}-12-31`, label: `Q4 ${y}` }
    // Month format: "m01" - "m12"
    if (quarter.startsWith('m')) {
      const m = parseInt(quarter.slice(1))
      const lastDay = new Date(y, m, 0).getDate()
      const monthName = new Date(y, m - 1).toLocaleString('it-IT', { month: 'long' })
      return {
        from: `${y}-${String(m).padStart(2, '0')}-01`,
        to: `${y}-${String(m).padStart(2, '0')}-${lastDay}`,
        label: `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${y}`
      }
    }
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Anno ${y}` }
  }, [year, quarter])

  return (
    <PeriodContext.Provider value={{ year, quarter, setYear: updateYear, setQuarter: updateQuarter, getDateRange }}>
      {children}
    </PeriodContext.Provider>
  )
}

export function usePeriod() {
  const ctx = useContext(PeriodContext)
  if (!ctx) throw new Error('usePeriod must be used within PeriodProvider')
  return ctx
}
