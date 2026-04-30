import { useState, useMemo, useEffect, useRef } from 'react'

interface SortEntry {
  key: string
  dir: 'asc' | 'desc'
}

interface UseTableSortOptions {
  persistKey?: string | null
  resetOn?: unknown[] | unknown | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getValue(obj: any, path: string): any {
  if (!obj) return undefined
  if (!path) return undefined
  if (!path.includes('.')) return obj[path]
  return path.split('.').reduce((o: unknown, k: string) => (o == null ? o : (o as Record<string, unknown>)[k]), obj)
}

function loadFromStorage(key: string | null, fallback: SortEntry[]): SortEntry[] {
  if (!key || typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(`tablesort:${key}`)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // ignore parse errors
  }
  return fallback
}

function saveToStorage(key: string | null, value: SortEntry[]) {
  if (!key || typeof window === 'undefined') return
  try {
    if (!value || value.length === 0) {
      window.localStorage.removeItem(`tablesort:${key}`)
    } else {
      window.localStorage.setItem(`tablesort:${key}`, JSON.stringify(value))
    }
  } catch {
    // ignore quota errors
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useTableSort<T = any>(rows: T[], defaultSort: SortEntry[] = [], options: UseTableSortOptions = {}) {
  const { persistKey = null, resetOn = null } = options

  const [sortBy, setSortBy] = useState<SortEntry[]>(() => loadFromStorage(persistKey, defaultSort))

  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    if (resetOn != null) {
      setSortBy(defaultSort)
      if (persistKey) saveToStorage(persistKey, [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, Array.isArray(resetOn) ? resetOn : [resetOn])

  useEffect(() => {
    if (persistKey) saveToStorage(persistKey, sortBy)
  }, [sortBy, persistKey])

  const sorted = useMemo(() => {
    if (!sortBy || sortBy.length === 0) return rows
    return [...rows].sort((a, b) => {
      for (const { key, dir } of sortBy) {
        const av = getValue(a, key)
        const bv = getValue(b, key)
        const aNull = av == null || av === ''
        const bNull = bv == null || bv === ''
        if (aNull && bNull) continue
        if (aNull) return 1
        if (bNull) return -1
        let cmp = 0
        const an = typeof av === 'number' ? av : Number(av)
        const bn = typeof bv === 'number' ? bv : Number(bv)
        const isNumericPair = !isNaN(an) && !isNaN(bn)
          && (typeof av === 'number' || /^-?\d+([.,]\d+)?$/.test(String(av).trim()))
          && (typeof bv === 'number' || /^-?\d+([.,]\d+)?$/.test(String(bv).trim()))
        if (isNumericPair) {
          cmp = an - bn
        } else if (av instanceof Date || bv instanceof Date) {
          cmp = new Date(av as string | number | Date).getTime() - new Date(bv as string | number | Date).getTime()
        } else if (
          typeof av === 'string' && /^\d{4}-\d{2}-\d{2}/.test(av) &&
          typeof bv === 'string' && /^\d{4}-\d{2}-\d{2}/.test(bv)
        ) {
          cmp = av < bv ? -1 : av > bv ? 1 : 0
        } else {
          cmp = String(av).localeCompare(String(bv), 'it', { numeric: true, sensitivity: 'base' })
        }
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
      }
      return 0
    })
  }, [rows, sortBy])

  const onSort = (key: string, multi = false) => {
    setSortBy(prev => {
      const existing = prev.find(s => s.key === key)
      const others = multi ? prev.filter(s => s.key !== key) : []
      if (!existing) return [...others, { key, dir: 'asc' as const }]
      if (existing.dir === 'asc') return [...others, { key, dir: 'desc' as const }]
      return others
    })
  }

  const reset = () => setSortBy(defaultSort)

  return { sorted, sortBy, onSort, reset }
}
